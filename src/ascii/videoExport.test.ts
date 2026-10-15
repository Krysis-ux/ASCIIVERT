import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "./presets";
import type { AsciiFrame } from "./types";
import * as videoExport from "./videoExport";

const frame: AsciiFrame = {
  cols: 2,
  rows: 1,
  chars: new Uint16Array([0, 0]),
  fg: new Uint8Array([255, 255, 255, 255, 255, 255]),
  bg: null,
  glyphs: ["#"],
  ink: new Float32Array([1, 1]),
};

vi.mock("./convert", () => ({
  convert: () => ({ frame, elapsed: 1 }),
}));

vi.mock("./render", () => ({
  renderOptionsFrom: () => ({}),
  renderToCanvas: (canvas: HTMLCanvasElement) => {
    canvas.width = 20;
    canvas.height = 10;
    return { width: 20, height: 10, cellW: 10, cellH: 10 };
  },
}));

class SuccessfulRecorder {
  static instances: SuccessfulRecorder[] = [];
  static onStart: (() => void) | null = null;
  static isTypeSupported(mime: string) {
    return mime === "video/webm";
  }

  state: RecordingState = "inactive";
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  start = vi.fn(() => {
    this.state = "recording";
    SuccessfulRecorder.onStart?.();
  });
  stop = vi.fn(() => {
    if (this.state === "inactive") return;
    this.state = "inactive";
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob(["video"]) } as BlobEvent);
      this.onstop?.();
    });
  });

  constructor() {
    SuccessfulRecorder.instances.push(this);
  }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];

  state: AudioContextState = "running";
  destination = {} as AudioDestinationNode;
  audioTrack = { stop: vi.fn() } as unknown as MediaStreamTrack;
  destinationStream = {
    getAudioTracks: () => [this.audioTrack],
  } as unknown as MediaStream;
  monitor = {
    gain: { value: 0 },
    connect: vi.fn(),
  } as unknown as GainNode;
  source = { connect: vi.fn() } as unknown as MediaElementAudioSourceNode;

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  createMediaElementSource = vi.fn(() => this.source);
  createMediaStreamDestination = vi.fn(
    () => ({ stream: this.destinationStream }) as MediaStreamAudioDestinationNode
  );
  createGain = vi.fn(() => this.monitor);
  resume = vi.fn(async () => undefined);
}

function videoWithState({
  currentTime,
  loop,
  muted,
  volume,
  paused,
}: {
  currentTime: number;
  loop: boolean;
  muted: boolean;
  volume: number;
  paused: boolean;
}) {
  const video = document.createElement("video");
  let isPaused = paused;
  Object.defineProperty(video, "paused", {
    configurable: true,
    get: () => isPaused,
  });
  video.currentTime = currentTime;
  video.loop = loop;
  video.muted = muted;
  video.volume = volume;
  const pause = vi.fn(() => {
    isPaused = true;
  });
  const play = vi.fn(async () => {
    isPaused = false;
  });
  Object.defineProperties(video, {
    pause: { configurable: true, value: pause },
    play: { configurable: true, value: play },
  });
  return { video, pause, play };
}

function resolveSeeksImmediately(video: HTMLVideoElement) {
  let currentTime = video.currentTime;
  Object.defineProperty(video, "currentTime", {
    configurable: true,
    get: () => currentTime,
    set: (value: number) => {
      currentTime = value;
      queueMicrotask(() => video.dispatchEvent(new Event("seeked")));
    },
  });
}

afterEach(() => {
  delete (HTMLCanvasElement.prototype as { captureStream?: unknown })
    .captureStream;
  SuccessfulRecorder.instances = [];
  SuccessfulRecorder.onStart = null;
  FakeAudioContext.instances = [];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("video state", () => {
  it("captures and restores time, loop, mute, volume, and playback intent", async () => {
    const { video, play } = videoWithState({
      currentTime: 3.25,
      loop: true,
      muted: false,
      volume: 0.35,
      paused: false,
    });
    const helpers = videoExport as typeof videoExport & {
      captureVideoState: (video: HTMLVideoElement) => {
        currentTime: number;
        loop: boolean;
        muted: boolean;
        volume: number;
        wasPlaying: boolean;
      };
      restoreVideoState: (
        video: HTMLVideoElement,
        state: {
          currentTime: number;
          loop: boolean;
          muted: boolean;
          volume: number;
          wasPlaying: boolean;
        }
      ) => Promise<void>;
    };

    const state = helpers.captureVideoState(video);
    expect(state).toEqual({
      currentTime: 3.25,
      loop: true,
      muted: false,
      volume: 0.35,
      wasPlaying: true,
    });

    video.currentTime = 9;
    video.loop = false;
    video.muted = true;
    video.volume = 1;
    video.pause();

    await helpers.restoreVideoState(video, state);

    expect(video.currentTime).toBe(3.25);
    expect(video.loop).toBe(true);
    expect(video.muted).toBe(false);
    expect(video.volume).toBe(0.35);
    expect(play).toHaveBeenCalledTimes(1);
  });
});

describe("seek cleanup", () => {
  it("aborts promptly and clears its fallback timer and listener", async () => {
    vi.useFakeTimers();
    const video = document.createElement("video");
    Object.defineProperty(video, "readyState", {
      configurable: true,
      value: 1,
    });
    const removeEventListener = vi.spyOn(video, "removeEventListener");
    const clearTimeout = vi.spyOn(window, "clearTimeout");
    const controller = new AbortController();
    const seekTo = videoExport.seekTo as (
      video: HTMLVideoElement,
      time: number,
      signal?: AbortSignal
    ) => Promise<void>;

    const seeking = seekTo(video, 1.5, controller.signal);
    const rejected = expect(seeking).rejects.toMatchObject({
      name: "AbortError",
    });
    controller.abort();
    await vi.advanceTimersByTimeAsync(2_000);
    await rejected;

    expect(removeEventListener).toHaveBeenCalledWith(
      "seeked",
      expect.any(Function)
    );
    expect(clearTimeout).toHaveBeenCalled();
  });
});

describe("video export lifecycle", () => {
  it("restores audible output after the first audio export creates a graph", async () => {
    const { video, play } = videoWithState({
      currentTime: 0,
      loop: true,
      muted: false,
      volume: 0.35,
      paused: true,
    });
    Object.defineProperties(video, {
      duration: { configurable: true, value: 2 },
      readyState: { configurable: true, value: 2 },
    });
    const gainDuringPlay: number[] = [];
    const mutedDuringPlay: boolean[] = [];
    play.mockImplementation(async () => {
      gainDuringPlay.push(FakeAudioContext.instances[0].monitor.gain.value);
      mutedDuringPlay.push(video.muted);
      video.currentTime = video.duration;
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "captureStream", {
      configurable: true,
      value: vi.fn(() => ({
        addTrack: vi.fn(),
        removeTrack: vi.fn(),
        getAudioTracks: () => [],
        getVideoTracks: () => [],
      })),
    });
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("MediaRecorder", SuccessfulRecorder);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      queueMicrotask(() => callback(performance.now()));
      return 1;
    });

    await videoExport.exportAsciiVideo({
      video,
      settings: DEFAULT_SETTINGS,
      cellW: 10.5,
      fps: 24,
      includeAudio: true,
    });

    expect(gainDuringPlay).toEqual([0]);
    expect(mutedDuringPlay).toEqual([false]);
    expect(FakeAudioContext.instances[0].monitor.gain.value).toBe(1);
    expect(video.muted).toBe(false);
    expect(video.volume).toBe(0.35);
  });

  it("silences and restores an existing audible graph for an export without audio", async () => {
    const { video, play } = videoWithState({
      currentTime: 0,
      loop: true,
      muted: false,
      volume: 0.6,
      paused: true,
    });
    Object.defineProperties(video, {
      duration: { configurable: true, value: 2 },
      readyState: { configurable: true, value: 2 },
    });
    const outputDuringPlay: Array<{ gain: number; muted: boolean }> = [];
    play.mockImplementation(async () => {
      const context = FakeAudioContext.instances[0];
      if (context) {
        outputDuringPlay.push({
          gain: context.monitor.gain.value,
          muted: video.muted,
        });
      }
      video.currentTime = video.duration;
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "captureStream", {
      configurable: true,
      value: vi.fn(() => ({
        addTrack: vi.fn(),
        removeTrack: vi.fn(),
        getAudioTracks: () => [],
        getVideoTracks: () => [],
      })),
    });
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("MediaRecorder", SuccessfulRecorder);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      queueMicrotask(() => callback(performance.now()));
      return 1;
    });
    const options = {
      video,
      settings: DEFAULT_SETTINGS,
      cellW: 10.5,
      fps: 24,
    };

    await videoExport.exportAsciiVideo({ ...options, includeAudio: true });
    videoExport.setMonitorVolume(video, 1);
    outputDuringPlay.length = 0;

    await videoExport.exportAsciiVideo({ ...options, includeAudio: false });

    expect(outputDuringPlay).toEqual([{ gain: 0, muted: true }]);
    expect(FakeAudioContext.instances[0].monitor.gain.value).toBe(1);
    expect(video.muted).toBe(false);
    expect(video.volume).toBe(0.6);
  });

  it("silences direct element output when exporting without an audio graph", async () => {
    const { video, play } = videoWithState({
      currentTime: 0,
      loop: true,
      muted: false,
      volume: 0.45,
      paused: true,
    });
    Object.defineProperties(video, {
      duration: { configurable: true, value: 2 },
      readyState: { configurable: true, value: 2 },
    });
    const mutedDuringPlay: boolean[] = [];
    play.mockImplementation(async () => {
      mutedDuringPlay.push(video.muted);
      video.currentTime = video.duration;
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "captureStream", {
      configurable: true,
      value: vi.fn(() => ({
        addTrack: vi.fn(),
        removeTrack: vi.fn(),
        getAudioTracks: () => [],
        getVideoTracks: () => [],
      })),
    });
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("MediaRecorder", SuccessfulRecorder);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      queueMicrotask(() => callback(performance.now()));
      return 1;
    });

    await videoExport.exportAsciiVideo({
      video,
      settings: DEFAULT_SETTINGS,
      cellW: 10.5,
      fps: 24,
      includeAudio: false,
    });

    expect(mutedDuringPlay).toEqual([true]);
    expect(videoExport.hasAudioGraph(video)).toBe(false);
    expect(video.muted).toBe(false);
    expect(video.volume).toBe(0.45);
  });

  it("restores a muted monitor across repeated exports with audio", async () => {
    const { video, play } = videoWithState({
      currentTime: 0,
      loop: true,
      muted: true,
      volume: 0.25,
      paused: true,
    });
    Object.defineProperties(video, {
      duration: { configurable: true, value: 2 },
      readyState: { configurable: true, value: 2 },
    });
    const outputDuringPlay: Array<{ gain: number; muted: boolean }> = [];
    play.mockImplementation(async () => {
      outputDuringPlay.push({
        gain: FakeAudioContext.instances[0].monitor.gain.value,
        muted: video.muted,
      });
      video.currentTime = video.duration;
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "captureStream", {
      configurable: true,
      value: vi.fn(() => ({
        addTrack: vi.fn(),
        removeTrack: vi.fn(),
        getAudioTracks: () => [],
        getVideoTracks: () => [],
      })),
    });
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("MediaRecorder", SuccessfulRecorder);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      queueMicrotask(() => callback(performance.now()));
      return 1;
    });
    const options = {
      video,
      settings: DEFAULT_SETTINGS,
      cellW: 10.5,
      fps: 24,
      includeAudio: true,
    };

    await videoExport.exportAsciiVideo(options);
    outputDuringPlay.length = 0;
    await videoExport.exportAsciiVideo(options);

    expect(outputDuringPlay).toEqual([{ gain: 0, muted: false }]);
    expect(FakeAudioContext.instances[0].monitor.gain.value).toBe(0);
    expect(video.muted).toBe(true);
    expect(video.volume).toBe(0.25);
  });

  it("cleans the temporary stream, pending frame callback, and recorder handlers", async () => {
    const { video, play } = videoWithState({
      currentTime: 0,
      loop: true,
      muted: false,
      volume: 0.5,
      paused: true,
    });
    Object.defineProperties(video, {
      duration: { configurable: true, value: 2 },
      readyState: { configurable: true, value: 2 },
    });
    play.mockImplementation(async () => {
      video.currentTime = video.duration;
      window.setTimeout(() => video.dispatchEvent(new Event("ended")), 0);
    });
    const videoTrack = { stop: vi.fn() } as unknown as MediaStreamTrack;
    const addTrack = vi.fn();
    const removeTrack = vi.fn();
    const stream = {
      addTrack,
      removeTrack,
      getAudioTracks: () => [],
      getVideoTracks: () => [videoTrack],
    } as unknown as MediaStream;
    Object.defineProperty(HTMLCanvasElement.prototype, "captureStream", {
      configurable: true,
      value: vi.fn(() => stream),
    });
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("MediaRecorder", SuccessfulRecorder);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 77));
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);

    await videoExport.exportAsciiVideo({
      video,
      settings: DEFAULT_SETTINGS,
      cellW: 10.5,
      fps: 24,
      includeAudio: true,
    });

    const audioTrack = FakeAudioContext.instances[0].audioTrack;
    const recorder = SuccessfulRecorder.instances[0];
    expect(cancelAnimationFrame).toHaveBeenCalledWith(77);
    expect(videoTrack.stop).toHaveBeenCalledTimes(1);
    expect(addTrack).toHaveBeenCalledWith(audioTrack);
    expect(removeTrack).toHaveBeenCalledWith(audioTrack);
    expect(audioTrack.stop).not.toHaveBeenCalled();
    expect(recorder.ondataavailable).toBeNull();
    expect(recorder.onstop).toBeNull();
    expect(recorder.onerror).toBeNull();
  });

  it("cancels a pending video-frame callback during cleanup", async () => {
    const { video, play } = videoWithState({
      currentTime: 0,
      loop: true,
      muted: true,
      volume: 0.5,
      paused: true,
    });
    Object.defineProperties(video, {
      duration: { configurable: true, value: 2 },
      readyState: { configurable: true, value: 2 },
    });
    play.mockImplementation(async () => {
      video.currentTime = video.duration;
      window.setTimeout(() => video.dispatchEvent(new Event("ended")), 0);
    });
    const requestVideoFrameCallback = vi.fn(() => 91);
    const cancelVideoFrameCallback = vi.fn();
    Object.assign(video, {
      requestVideoFrameCallback,
      cancelVideoFrameCallback,
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "captureStream", {
      configurable: true,
      value: vi.fn(() => ({
        addTrack: vi.fn(),
        removeTrack: vi.fn(),
        getAudioTracks: () => [],
        getVideoTracks: () => [],
      })),
    });
    vi.stubGlobal("MediaRecorder", SuccessfulRecorder);

    await videoExport.exportAsciiVideo({
      video,
      settings: DEFAULT_SETTINGS,
      cellW: 10.5,
      fps: 24,
      includeAudio: false,
    });

    expect(requestVideoFrameCallback).toHaveBeenCalledTimes(1);
    expect(cancelVideoFrameCallback).toHaveBeenCalledWith(91);
  });

  it("captures one duration with loop disabled, reports completion, and restores state", async () => {
    const { video, play } = videoWithState({
      currentTime: 1.25,
      loop: true,
      muted: false,
      volume: 0.35,
      paused: false,
    });
    Object.defineProperties(video, {
      duration: { configurable: true, value: 2 },
      readyState: { configurable: true, value: 2 },
    });
    const assignedTimes: number[] = [];
    let currentTime = 1.25;
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => {
        currentTime = value;
        assignedTimes.push(value);
        queueMicrotask(() => video.dispatchEvent(new Event("seeked")));
      },
    });
    const loopDuringPlay: boolean[] = [];
    play.mockImplementation(async () => {
      loopDuringPlay.push(video.loop);
      if (loopDuringPlay.length === 1) video.currentTime = video.duration;
    });

    Object.defineProperty(HTMLCanvasElement.prototype, "captureStream", {
      configurable: true,
      value: vi.fn(() => ({
        addTrack: vi.fn(),
        removeTrack: vi.fn(),
        getAudioTracks: () => [],
        getVideoTracks: () => [],
      })),
    });
    vi.stubGlobal("MediaRecorder", SuccessfulRecorder);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      queueMicrotask(() => callback(performance.now()));
      return 1;
    });
    const progress: number[] = [];

    const result = await videoExport.exportAsciiVideo({
      video,
      settings: DEFAULT_SETTINGS,
      cellW: 10.5,
      fps: 24,
      includeAudio: false,
      onProgress: (fraction) => progress.push(fraction),
    });

    expect(loopDuringPlay[0]).toBe(false);
    expect(assignedTimes).toContain(2);
    expect(Math.max(...assignedTimes)).toBe(2);
    expect(progress.at(-1)).toBe(1);
    expect(result.blob.size).toBeGreaterThan(0);
    expect(SuccessfulRecorder.instances[0].stop).toHaveBeenCalledTimes(1);
    expect(video.currentTime).toBe(1.25);
    expect(video.loop).toBe(true);
    expect(video.muted).toBe(false);
    expect(video.volume).toBe(0.35);
    expect(play).toHaveBeenCalledTimes(2);
  });

  it("rejects cancellation without completion progress and restores state", async () => {
    const controller = new AbortController();
    const { video } = videoWithState({
      currentTime: 0.75,
      loop: true,
      muted: true,
      volume: 0.2,
      paused: true,
    });
    Object.defineProperties(video, {
      duration: { configurable: true, value: 4 },
      readyState: { configurable: true, value: 2 },
    });
    resolveSeeksImmediately(video);
    Object.defineProperty(HTMLCanvasElement.prototype, "captureStream", {
      configurable: true,
      value: vi.fn(() => ({
        addTrack: vi.fn(),
        removeTrack: vi.fn(),
        getAudioTracks: () => [],
        getVideoTracks: () => [],
      })),
    });
    vi.stubGlobal("MediaRecorder", SuccessfulRecorder);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    SuccessfulRecorder.onStart = () => queueMicrotask(() => controller.abort());
    const progress: number[] = [];

    await expect(
      videoExport.exportAsciiVideo({
        video,
        settings: DEFAULT_SETTINGS,
        cellW: 10.5,
        fps: 24,
        includeAudio: false,
        signal: controller.signal,
        onProgress: (fraction) => progress.push(fraction),
      })
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(progress).not.toContain(1);
    expect(video.currentTime).toBe(0.75);
    expect(video.loop).toBe(true);
    expect(video.muted).toBe(true);
    expect(video.volume).toBe(0.2);
    expect(video.paused).toBe(true);
  });

  it("restores state when the recorder errors", async () => {
    const { video, play } = videoWithState({
      currentTime: 1.5,
      loop: true,
      muted: false,
      volume: 0.6,
      paused: false,
    });
    Object.defineProperties(video, {
      duration: { configurable: true, value: 4 },
      readyState: { configurable: true, value: 2 },
    });
    resolveSeeksImmediately(video);
    Object.defineProperty(HTMLCanvasElement.prototype, "captureStream", {
      configurable: true,
      value: vi.fn(() => ({
        addTrack: vi.fn(),
        removeTrack: vi.fn(),
        getAudioTracks: () => [],
        getVideoTracks: () => [],
      })),
    });
    vi.stubGlobal("MediaRecorder", SuccessfulRecorder);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    SuccessfulRecorder.onStart = () =>
      queueMicrotask(() => SuccessfulRecorder.instances[0].onerror?.());

    await expect(
      videoExport.exportAsciiVideo({
        video,
        settings: DEFAULT_SETTINGS,
        cellW: 10.5,
        fps: 24,
        includeAudio: false,
      })
    ).rejects.toThrow("Recording failed.");

    expect(video.currentTime).toBe(1.5);
    expect(video.loop).toBe(true);
    expect(video.muted).toBe(false);
    expect(video.volume).toBe(0.6);
    expect(play).toHaveBeenCalledTimes(2);
  });

  it("times out a stalled recording without relying on ended", async () => {
    vi.useFakeTimers();
    const { video } = videoWithState({
      currentTime: 0,
      loop: true,
      muted: true,
      volume: 0.5,
      paused: true,
    });
    Object.defineProperties(video, {
      duration: { configurable: true, value: 4 },
      readyState: { configurable: true, value: 2 },
      ended: { configurable: true, value: false },
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "captureStream", {
      configurable: true,
      value: vi.fn(() => ({
        addTrack: vi.fn(),
        removeTrack: vi.fn(),
        getAudioTracks: () => [],
        getVideoTracks: () => [],
      })),
    });
    vi.stubGlobal("MediaRecorder", SuccessfulRecorder);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));

    const exporting = videoExport.exportAsciiVideo({
      video,
      settings: DEFAULT_SETTINGS,
      cellW: 10.5,
      fps: 24,
      includeAudio: false,
    });
    const rejected = expect(exporting).rejects.toThrow(
      "Video recording timed out before the clip finished."
    );

    await vi.advanceTimersByTimeAsync(9_000);
    await rejected;
    expect(SuccessfulRecorder.instances[0].stop).toHaveBeenCalledTimes(1);
    expect(video.loop).toBe(true);
    expect(video.currentTime).toBe(0);
  });
});

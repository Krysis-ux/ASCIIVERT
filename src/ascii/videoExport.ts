/** Video export. */

import { convert } from "./convert";
import { renderToCanvas, renderOptionsFrom } from "./render";
import { createTemporalState } from "./types";
import type { AsciiSettings } from "./types";

const MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm;codecs=vp9",
  "video/webm",
  "video/mp4",
];

export function pickRecorderMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const mime of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return null;
}

export function isVideoExportSupported(): boolean {
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof HTMLCanvasElement !== "undefined" &&
    typeof HTMLCanvasElement.prototype.captureStream === "function" &&
    pickRecorderMime() !== null
  );
}

/** A media element can only get one audio source node, so cache it. */
interface AudioGraph {
  context: AudioContext;
  destination: MediaStreamAudioDestinationNode;
  monitor: GainNode;
}
const audioGraphs = new WeakMap<HTMLVideoElement, AudioGraph>();

function getAudioGraph(video: HTMLVideoElement): AudioGraph | null {
  const existing = audioGraphs.get(video);
  if (existing) return existing;
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;

    const context = new Ctor();
    const source = context.createMediaElementSource(video);
    const destination = context.createMediaStreamDestination();
    // Monitor stays muted; the preview can turn it up.
    const monitor = context.createGain();
    monitor.gain.value = 0;

    source.connect(destination);
    source.connect(monitor);
    monitor.connect(context.destination);

    const graph = { context, destination, monitor };
    audioGraphs.set(video, graph);
    return graph;
  } catch {
    return null;
  }
}

/** Lets the preview player toggle audible playback without breaking capture. */
export function setMonitorVolume(video: HTMLVideoElement, volume: number): void {
  const graph = audioGraphs.get(video);
  if (graph) graph.monitor.gain.value = Math.max(0, Math.min(1, volume));
}

export function hasAudioGraph(video: HTMLVideoElement): boolean {
  return audioGraphs.has(video);
}

export interface VideoExportOptions {
  video: HTMLVideoElement;
  settings: AsciiSettings;
  /** Cell width in pixels — sets output resolution independently of detail. */
  cellW: number;
  fps: number;
  includeAudio: boolean;
  startTime?: number;
  endTime?: number;
  onProgress?: (fraction: number, stats: { frames: number; fps: number }) => void;
  signal?: AbortSignal;
}

export interface VideoExportResult {
  blob: Blob;
  mimeType: string;
  frames: number;
  /** Real rendered fps, lower than `fps` if we fell behind. */
  effectiveFps: number;
}

export interface CapturedVideoState {
  currentTime: number;
  loop: boolean;
  muted: boolean;
  volume: number;
  wasPlaying: boolean;
}

export function captureVideoState(video: HTMLVideoElement): CapturedVideoState {
  return {
    currentTime: video.currentTime,
    loop: video.loop,
    muted: video.muted,
    volume: video.volume,
    wasPlaying: !video.paused,
  };
}

export async function restoreVideoState(
  video: HTMLVideoElement,
  state: CapturedVideoState
): Promise<void> {
  video.pause();
  video.loop = state.loop;
  video.muted = state.muted;
  video.volume = state.volume;
  video.currentTime = state.currentTime;
  if (state.wasPlaying) {
    try {
      await video.play();
    } catch {
      // Playback intent is best-effort when browser autoplay policy changed.
    }
  }
}

export async function exportAsciiVideo(
  options: VideoExportOptions
): Promise<VideoExportResult> {
  const { video, settings, cellW, fps, includeAudio } = options;

  const mimeType = pickRecorderMime();
  if (!mimeType) throw new Error("This browser cannot record video.");

  const start = Math.max(0, options.startTime ?? 0);
  const end =
    options.endTime && options.endTime > start
      ? Math.min(options.endTime, video.duration || Infinity)
      : video.duration;
  if (!isFinite(end) || end <= start) {
    throw new Error("Video duration is unknown — try re-uploading the file.");
  }
  const span = end - start;
  const originalState = captureVideoState(video);
  const originalAudioGraph = audioGraphs.get(video) ?? null;
  const originalMonitorGain =
    originalAudioGraph?.monitor.gain.value ??
    (originalState.muted || originalState.volume === 0 ? 0 : 1);
  const temporal = createTemporalState();
  const canvas = document.createElement("canvas");
  const renderOptions = renderOptionsFrom(settings, cellW);
  const chunks: BlobPart[] = [];
  let recorder: MediaRecorder | null = null;
  let activeAudioGraph: AudioGraph | null = originalAudioGraph;
  let captureStream: MediaStream | null = null;
  let captureAudioTrack: MediaStreamTrack | null = null;
  let scheduledFrame: ScheduledFrame | null = null;
  let guard: number | null = null;
  let frames = 0;
  let wallStart = 0;
  let stopped = false;
  let aborted = options.signal?.aborted ?? false;
  let guardExpired = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (scheduledFrame) {
      cancelScheduledFrame(video, scheduledFrame);
      scheduledFrame = null;
    }
    video.pause();
    if (recorder && recorder.state !== "inactive") recorder.stop();
  };
  const onAbort = () => {
    aborted = true;
    stop();
  };
  const onEnded = () => stop();

  options.signal?.addEventListener("abort", onAbort);
  video.addEventListener("ended", onEnded);

  try {
    video.pause();
    video.loop = false;
    video.muted = true;
    if (activeAudioGraph) activeAudioGraph.monitor.gain.value = 0;
    if (aborted) throw new DOMException("Video export cancelled.", "AbortError");

    // Decode the actual first export frame before sizing and recording.
    await seekTo(video, start, options.signal);
    if (aborted) throw new DOMException("Video export cancelled.", "AbortError");

    const first = convert(video, settings, temporal);
    renderToCanvas(canvas, first.frame, renderOptions);
    const stream = canvas.captureStream(fps);
    captureStream = stream;

    let usedAudio = false;
    if (includeAudio) {
      const graph = getAudioGraph(video);
      if (graph) {
        activeAudioGraph = graph;
        graph.monitor.gain.value = 0;
        if (graph.context.state === "suspended") {
          try {
            await graph.context.resume();
          } catch {
            /* Autoplay policy; fall through to a silent export. */
          }
        }
        const track = graph.destination.stream.getAudioTracks()[0];
        if (track) {
          stream.addTrack(track);
          captureAudioTrack = track;
          usedAudio = true;
        }
      }
    }

    // The element must be unmuted for its audio to reach the WebAudio tap.
    if (usedAudio) video.muted = false;

    const pixels = canvas.width * canvas.height;
    recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: Math.max(
        1_500_000,
        Math.min(40_000_000, Math.round(pixels * fps * 0.12))
      ),
      ...(usedAudio ? { audioBitsPerSecond: 128_000 } : {}),
    });
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };
    const finished = new Promise<void>((resolve, reject) => {
      recorder!.onstop = () => resolve();
      recorder!.onerror = () => reject(new Error("Recording failed."));
    });

    wallStart = performance.now();
    recorder.start(1000);

    const renderFrame = () => {
      scheduledFrame = null;
      if (stopped) return;
      try {
        const result = convert(video, settings, temporal);
        renderToCanvas(canvas, result.frame, renderOptions);
        frames++;
      } catch {
        // A transient decode gap shouldn't kill the whole export.
      }

      const elapsed = video.currentTime - start;
      options.onProgress?.(Math.max(0, Math.min(1, elapsed / span)), {
        frames,
        fps:
          frames /
          Math.max(0.001, (performance.now() - wallStart) / 1000),
      });

      if (video.currentTime >= end - 1e-3 || video.ended) {
        stop();
        return;
      }
      scheduledFrame = schedule(video, renderFrame);
    };

    try {
      await video.play();
    } catch {
      stop();
      throw new Error(
        "Playback was blocked, so the video could not be recorded. Click the preview once and try again."
      );
    }

    if (!stopped) scheduledFrame = schedule(video, renderFrame);
    // Hard timeout for media that stalls and never fires `ended`.
    guard = window.setTimeout(() => {
      guardExpired = true;
      stop();
    }, Math.max(1000, (span + 5) * 1000));

    await finished;
    if (aborted) throw new DOMException("Video export cancelled.", "AbortError");
    if (guardExpired) {
      throw new Error("Video recording timed out before the clip finished.");
    }

    const finalStats = {
      frames,
      fps:
        frames / Math.max(0.001, (performance.now() - wallStart) / 1000),
    };
    options.onProgress?.(1, finalStats);

    return {
      blob: new Blob(chunks, { type: mimeType }),
      mimeType,
      frames,
      effectiveFps: finalStats.fps,
    };
  } finally {
    if (guard !== null) window.clearTimeout(guard);
    options.signal?.removeEventListener("abort", onAbort);
    video.removeEventListener("ended", onEnded);
    if (scheduledFrame) {
      cancelScheduledFrame(video, scheduledFrame);
      scheduledFrame = null;
    }
    if (recorder && recorder.state !== "inactive") recorder.stop();
    if (captureAudioTrack && captureStream) {
      captureStream.removeTrack(captureAudioTrack);
    }
    captureStream?.getVideoTracks().forEach((track) => track.stop());
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
    }
    try {
      await restoreVideoState(video, originalState);
    } finally {
      if (activeAudioGraph) {
        activeAudioGraph.monitor.gain.value = originalMonitorGain;
      }
    }
  }
}

/** Schedules the next render on the video's own frame cadence when available. */
interface ScheduledFrame {
  kind: "video" | "animation";
  id: number;
}

function schedule(
  video: HTMLVideoElement,
  callback: () => void
): ScheduledFrame {
  const withRvfc = video as HTMLVideoElement & {
    requestVideoFrameCallback?: (cb: () => void) => number;
  };
  if (typeof withRvfc.requestVideoFrameCallback === "function") {
    return {
      kind: "video",
      id: withRvfc.requestVideoFrameCallback(callback),
    };
  }
  return { kind: "animation", id: requestAnimationFrame(callback) };
}

function cancelScheduledFrame(
  video: HTMLVideoElement,
  scheduled: ScheduledFrame
): void {
  if (scheduled.kind === "video") {
    const withRvfc = video as HTMLVideoElement & {
      cancelVideoFrameCallback?: (id: number) => void;
    };
    withRvfc.cancelVideoFrameCallback?.(scheduled.id);
    return;
  }
  cancelAnimationFrame(scheduled.id);
}

export function seekTo(
  video: HTMLVideoElement,
  time: number,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: number | null = null;
    let settled = false;
    const cleanup = () => {
      video.removeEventListener("seeked", onSeeked);
      signal?.removeEventListener("abort", onAbort);
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };
    const finish = (error?: DOMException) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onSeeked = () => finish();
    const onAbort = () =>
      finish(new DOMException("Video export cancelled.", "AbortError"));

    if (signal?.aborted) {
      onAbort();
      return;
    }
    if (Math.abs(video.currentTime - time) < 0.005 && video.readyState >= 2) {
      finish();
      return;
    }
    video.addEventListener("seeked", onSeeked);
    signal?.addEventListener("abort", onAbort, { once: true });
    // Some browsers never fire `seeked` for a seek to the current position.
    timer = window.setTimeout(onSeeked, 2000);
    try {
      video.currentTime = time;
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

export function extensionForMime(mime: string): string {
  if (mime.includes("mp4")) return "mp4";
  return "webm";
}

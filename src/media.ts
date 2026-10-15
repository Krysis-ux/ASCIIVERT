/** Loading user media. */

export type MediaKind = "image" | "video";

export interface LoadedMedia {
  kind: MediaKind;
  url: string;
  element: HTMLImageElement | HTMLVideoElement;
  width: number;
  height: number;
  name: string;
  /** Seconds. Videos only. */
  duration: number;
  /** Bytes. */
  size: number;
}

export const ACCEPTED_TYPES =
  "image/*,video/*,.png,.jpg,.jpeg,.gif,.webp,.avif,.bmp,.mp4,.webm,.mov,.m4v,.ogv";

/** Rejecting oversized files early beats freezing the tab on a decode. */
const MAX_BYTES = 2 * 1024 * 1024 * 1024;

export function detectKind(file: File): MediaKind | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";

  // Some drags come with no MIME type, so fall back to the extension.
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg"].includes(ext)) {
    return "image";
  }
  if (["mp4", "webm", "mov", "m4v", "ogv", "mkv", "avi"].includes(ext)) {
    return "video";
  }
  return null;
}

export class MediaLoadError extends Error {}

export async function loadMedia(file: File): Promise<LoadedMedia> {
  const kind = detectKind(file);
  if (!kind) {
    throw new MediaLoadError(
      `“${file.name}” isn’t an image or video this browser can open.`
    );
  }
  if (file.size > MAX_BYTES) {
    throw new MediaLoadError("That file is over 2 GB — try a smaller one.");
  }

  const url = URL.createObjectURL(file);

  try {
    if (kind === "image") {
      const element = await loadImage(url);
      return {
        kind,
        url,
        element,
        width: element.naturalWidth,
        height: element.naturalHeight,
        name: file.name,
        duration: 0,
        size: file.size,
      };
    }

    const element = await loadVideo(url);
    return {
      kind,
      url,
      element,
      width: element.videoWidth,
      height: element.videoHeight,
      name: file.name,
      duration: Number.isFinite(element.duration) ? element.duration : 0,
      size: file.size,
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (!img.naturalWidth || !img.naturalHeight) {
        reject(new MediaLoadError("That image has no dimensions."));
        return;
      }
      resolve(img);
    };
    img.onerror = () =>
      reject(new MediaLoadError("That image couldn’t be decoded."));
    img.src = url;
  });
}

function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";
    // Attached but hidden; detached videos get throttled or won't decode.
    video.style.position = "fixed";
    video.style.opacity = "0";
    video.style.pointerEvents = "none";
    video.style.width = "1px";
    video.style.height = "1px";
    video.style.left = "-10px";
    video.style.top = "-10px";

    const cleanup = () => {
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("error", onError);
    };

    const onReady = () => {
      if (!video.videoWidth || !video.videoHeight) {
        cleanup();
        video.remove();
        reject(
          new MediaLoadError(
            "That video's format isn't supported by this browser. Try an MP4 (H.264) or WebM."
          )
        );
        return;
      }
      cleanup();
      resolve(video);
    };

    const onError = () => {
      cleanup();
      video.remove();
      reject(
        new MediaLoadError(
          "That video couldn’t be decoded. Try an MP4 (H.264) or WebM file."
        )
      );
    };

    video.addEventListener("loadeddata", onReady);
    video.addEventListener("error", onError);
    document.body.appendChild(video);
    video.src = url;
    video.load();
  });
}

export function releaseMedia(media: LoadedMedia | null): void {
  if (!media) return;
  if (media.kind === "video") {
    const video = media.element as HTMLVideoElement;
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.remove();
  }
  URL.revokeObjectURL(media.url);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

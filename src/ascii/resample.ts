/** High-quality downscaling. */

let canvasA: HTMLCanvasElement | null = null;
let canvasB: HTMLCanvasElement | null = null;

function ping(which: 0 | 1, w: number, h: number): CanvasRenderingContext2D {
  let canvas = which === 0 ? canvasA : canvasB;
  if (!canvas) {
    canvas = document.createElement("canvas");
    if (which === 0) canvasA = canvas;
    else canvasB = canvas;
  }
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d", { willReadFrequently: false });
  if (!ctx) throw new Error("2D canvas context unavailable");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, w, h);
  return ctx;
}

/** Halving passes are capped so live video doesn't pay for a long chain. */
const MAX_STEPS = 3;

export function drawDownscaled(
  dest: CanvasRenderingContext2D,
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  dw: number,
  dh: number
): void {
  dest.imageSmoothingEnabled = true;
  dest.imageSmoothingQuality = "high";

  let current: CanvasImageSource = source;
  let curW = srcW;
  let curH = srcH;
  let step = 0;
  let slot: 0 | 1 = 0;

  // Halve while we'd still overshoot the target by more than 2x.
  while (curW / dw > 2 && curH / dh > 2 && step < MAX_STEPS) {
    const nw = Math.max(dw, Math.floor(curW / 2));
    const nh = Math.max(dh, Math.floor(curH / 2));
    const ctx = ping(slot, nw, nh);
    ctx.drawImage(current, 0, 0, curW, curH, 0, 0, nw, nh);
    current = ctx.canvas;
    curW = nw;
    curH = nh;
    // Alternate targets so we never read from the canvas we're writing to.
    slot = slot === 0 ? 1 : 0;
    step++;
  }

  dest.drawImage(current, 0, 0, curW, curH, 0, 0, dw, dh);
}

export function releaseResampleCanvases(): void {
  canvasA = null;
  canvasB = null;
}

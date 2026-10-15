/** Edge detection for direction-aware characters. */

export interface EdgeField {
  /** Per cell, 0–1. Edge energy weighted by how consistent the direction is. */
  strength: Float32Array;
  /** Per cell, quantised orientation: 0=`-` 1=`\` 2=`|` 3=`/`. */
  direction: Uint8Array;
}

/** Computes per-cell edge strength and orientation from a luminance plane. */
export function computeEdges(
  luma: Float32Array,
  sw: number,
  sh: number,
  cols: number,
  rows: number,
  subW: number,
  subH: number
): EdgeField {
  const strength = new Float32Array(cols * rows);
  const direction = new Uint8Array(cols * rows);
  if (sw < 3 || sh < 3) return { strength, direction };

  // Accumulate the structure tensor per cell.
  const gxx = new Float32Array(cols * rows);
  const gyy = new Float32Array(cols * rows);
  const gxy = new Float32Array(cols * rows);

  for (let y = 1; y < sh - 1; y++) {
    const cy = Math.min(rows - 1, (y / subH) | 0);
    for (let x = 1; x < sw - 1; x++) {
      const i = y * sw + x;

      const tl = luma[i - sw - 1], tc = luma[i - sw], tr = luma[i - sw + 1];
      const ml = luma[i - 1],                        mr = luma[i + 1];
      const bl = luma[i + sw - 1], bc = luma[i + sw], br = luma[i + sw + 1];

      // Sobel kernels.
      const gx = tr + 2 * mr + br - tl - 2 * ml - bl;
      const gy = bl + 2 * bc + br - tl - 2 * tc - tr;

      const cx = Math.min(cols - 1, (x / subW) | 0);
      const c = cy * cols + cx;
      gxx[c] += gx * gx;
      gyy[c] += gy * gy;
      gxy[c] += gx * gy;
    }
  }

  const perCell = Math.max(1, subW * subH);

  for (let c = 0; c < strength.length; c++) {
    const xx = gxx[c] / perCell;
    const yy = gyy[c] / perCell;
    const xy = gxy[c] / perCell;

    const trace = xx + yy;
    if (trace < 1e-6) {
      strength[c] = 0;
      direction[c] = 0;
      continue;
    }

    // Eigen-decomposition of the 2x2 tensor, in closed form.
    const diff = xx - yy;
    const root = Math.sqrt(diff * diff + 4 * xy * xy);

    // Coherence: 1 when one orientation dominates, 0 for isotropic noise.
    const coherence = root / trace;

    // sqrt so the threshold slider feels linear.
    const magnitude = Math.sqrt(trace);
    strength[c] = Math.min(1, magnitude * coherence * 0.5);

    // Gradient orientation; the edge itself runs perpendicular to it.
    const gradAngle = 0.5 * Math.atan2(2 * xy, diff);
    let edgeAngle = gradAngle + Math.PI / 2;

    // Fold into 0..PI — an edge at 10° and one at 190° look identical.
    edgeAngle = ((edgeAngle % Math.PI) + Math.PI) % Math.PI;

    // Quantise to four characters.
    const bucket = Math.floor((edgeAngle + Math.PI / 8) / (Math.PI / 4)) % 4;
    direction[c] = bucket;
  }

  return { strength, direction };
}

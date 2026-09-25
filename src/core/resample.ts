/**
 * Quality-conscious scaling.
 *
 * A single `drawImage` that shrinks by more than ~2× drops source pixels in
 * most browsers, which turns fine detail into aliasing — exactly the kind of
 * thing you notice on a printed poster. So we step the image down by halves
 * (each halving is a clean box average with smoothing on) until the remaining
 * reduction is under 2×, then do the final resize.
 *
 * Upscaling goes straight through `drawImage` with high-quality smoothing,
 * which is bilinear/bicubic depending on the engine. Nothing here invents
 * detail — that is what an AI upscale before import is for.
 */

import type { Rect, Size } from './units.ts';

function make(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const g = c.getContext('2d', { alpha: true, willReadFrequently: false });
  if (!g) throw new Error('Could not get a 2D canvas context.');
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  return g;
}

/** Free a canvas's backing store — important when tiles are 35 megapixels each. */
export function release(c: HTMLCanvasElement | null | undefined) {
  if (!c) return;
  c.width = 0;
  c.height = 0;
}

export function createCanvas(w: number, h: number) {
  const canvas = make(w, h);
  return { canvas, g: ctx2d(canvas) };
}

/**
 * Draw `src[srcRect]` into `dst[dstRect]`, stepping down for large reductions.
 */
export function drawResampled(
  dst: CanvasRenderingContext2D,
  src: CanvasImageSource,
  srcRect: Rect,
  dstRect: Rect,
  opts: { quality?: 'fast' | 'lanczos'; srcSize?: Size } = {},
): void {
  const sw = srcRect.w;
  const sh = srcRect.h;
  const dw = dstRect.w;
  const dh = dstRect.h;
  if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return;
  // A released (0×0) canvas would make drawImage throw; skip instead.
  if (src instanceof HTMLCanvasElement && (src.width === 0 || src.height === 0)) return;

  if (opts.quality === 'lanczos' && opts.srcSize) {
    drawLanczos(dst, src, srcRect, dstRect, opts.srcSize);
    return;
  }

  dst.imageSmoothingEnabled = true;
  dst.imageSmoothingQuality = 'high';

  const shrink = Math.min(sw / dw, sh / dh);
  if (shrink < 2) {
    dst.drawImage(src, srcRect.x, srcRect.y, sw, sh, dstRect.x, dstRect.y, dw, dh);
    return;
  }

  // Copy the crop out at native size, then halve repeatedly.
  let cur = make(Math.ceil(sw), Math.ceil(sh));
  let curG = ctx2d(cur);
  curG.drawImage(src, srcRect.x, srcRect.y, sw, sh, 0, 0, cur.width, cur.height);

  while (cur.width / 2 >= dw && cur.height / 2 >= dh && cur.width > 2 && cur.height > 2) {
    const next = make(Math.max(1, Math.floor(cur.width / 2)), Math.max(1, Math.floor(cur.height / 2)));
    const nextG = ctx2d(next);
    nextG.drawImage(cur, 0, 0, cur.width, cur.height, 0, 0, next.width, next.height);
    release(cur);
    cur = next;
    curG = nextG;
  }

  dst.drawImage(cur, 0, 0, cur.width, cur.height, dstRect.x, dstRect.y, dw, dh);
  release(cur);
}

/* ── Lanczos ─────────────────────────────────────────────────────────────────
   `drawImage` upscales with a bilinear-ish filter, which on a poster-sized
   enlargement reads as soft and slightly blocky. Lanczos-3 keeps edges crisp
   and is what the print tools this imitates use. It is a separable filter, so
   the resize is two passes of a 1-D convolution.

   Weights are precomputed per output row/column: for an upscale the support is
   3 source pixels either side; for a downscale it widens by 1/scale so no
   source pixel is skipped (the same anti-aliasing the stepped path provides). */

const LANCZOS_A = 3;

function lanczos(x: number): number {
  if (x === 0) return 1;
  const ax = Math.abs(x);
  if (ax >= LANCZOS_A) return 0;
  const px = Math.PI * ax;
  return (LANCZOS_A * Math.sin(px) * Math.sin(px / LANCZOS_A)) / (px * px);
}

interface Taps {
  /** First source index contributing to each output index. */
  start: Int32Array;
  /** Number of taps for each output index. */
  count: Int32Array;
  /** Flattened weights, `count[i]` of them starting at `offset[i]`. */
  weights: Float32Array;
  offset: Int32Array;
}

function buildTaps(srcLen: number, dstLen: number): Taps {
  const scale = dstLen / srcLen;
  const support = scale < 1 ? LANCZOS_A / scale : LANCZOS_A;
  const start = new Int32Array(dstLen);
  const count = new Int32Array(dstLen);
  const offset = new Int32Array(dstLen);
  const all: number[] = [];
  for (let i = 0; i < dstLen; i++) {
    // Map the output pixel's centre into source space.
    const centre = (i + 0.5) / scale - 0.5;
    const lo = Math.max(0, Math.ceil(centre - support));
    const hi = Math.min(srcLen - 1, Math.floor(centre + support));
    offset[i] = all.length;
    start[i] = lo;
    let sum = 0;
    const local: number[] = [];
    for (let j = lo; j <= hi; j++) {
      const w = lanczos(scale < 1 ? (j - centre) * scale : j - centre);
      local.push(w);
      sum += w;
    }
    // Normalise so flat areas keep their exact value even at the edges, where
    // the window is clipped.
    if (sum !== 0) for (let t = 0; t < local.length; t++) local[t] /= sum;
    for (const w of local) all.push(w);
    count[i] = local.length;
  }
  return { start, count, weights: new Float32Array(all), offset };
}

/**
 * Lanczos-3 resize of RGBA pixel data. Alpha is premultiplied for the duration
 * so partially transparent edges do not bleed the colour of transparent pixels.
 */
export function lanczosResize(
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Uint8ClampedArray {
  // Premultiply into floats.
  const pm = new Float32Array(sw * sh * 4);
  for (let i = 0, n = sw * sh; i < n; i++) {
    const a = src[i * 4 + 3] / 255;
    pm[i * 4] = src[i * 4] * a;
    pm[i * 4 + 1] = src[i * 4 + 1] * a;
    pm[i * 4 + 2] = src[i * 4 + 2] * a;
    pm[i * 4 + 3] = src[i * 4 + 3];
  }

  // Pass 1: horizontal, sw → dw.
  const hTaps = buildTaps(sw, dw);
  const mid = new Float32Array(dw * sh * 4);
  for (let y = 0; y < sh; y++) {
    const rowIn = y * sw * 4;
    const rowOut = y * dw * 4;
    for (let x = 0; x < dw; x++) {
      const n = hTaps.count[x];
      const o = hTaps.offset[x];
      const s0 = hTaps.start[x];
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let t = 0; t < n; t++) {
        const w = hTaps.weights[o + t];
        const p = rowIn + (s0 + t) * 4;
        r += pm[p] * w;
        g += pm[p + 1] * w;
        b += pm[p + 2] * w;
        a += pm[p + 3] * w;
      }
      const q = rowOut + x * 4;
      mid[q] = r;
      mid[q + 1] = g;
      mid[q + 2] = b;
      mid[q + 3] = a;
    }
  }

  // Pass 2: vertical, sh → dh.
  const vTaps = buildTaps(sh, dh);
  const out = new Uint8ClampedArray(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const n = vTaps.count[y];
    const o = vTaps.offset[y];
    const s0 = vTaps.start[y];
    const rowOut = y * dw * 4;
    for (let x = 0; x < dw; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let t = 0; t < n; t++) {
        const w = vTaps.weights[o + t];
        const p = ((s0 + t) * dw + x) * 4;
        r += mid[p] * w;
        g += mid[p + 1] * w;
        b += mid[p + 2] * w;
        a += mid[p + 3] * w;
      }
      const q = rowOut + x * 4;
      // Un-premultiply.
      if (a > 0.5) {
        const inv = 255 / a;
        out[q] = r * inv;
        out[q + 1] = g * inv;
        out[q + 2] = b * inv;
        out[q + 3] = a;
      } else {
        out[q] = 0;
        out[q + 1] = 0;
        out[q + 2] = 0;
        out[q + 3] = 0;
      }
    }
  }
  return out;
}

/**
 * Lanczos path for `drawResampled`.
 *
 * The source crop is widened by the filter's support before resizing, so the
 * filter window never has to clamp at the crop boundary. Without that, every
 * tile edge would be filtered against a wall of repeated pixels and adjacent
 * sheets would disagree along the seam by a fraction of a pixel.
 */
function drawLanczos(
  dst: CanvasRenderingContext2D,
  src: CanvasImageSource,
  srcRect: Rect,
  dstRect: Rect,
  srcSize: Size,
): void {
  const scaleX = dstRect.w / srcRect.w;
  const scaleY = dstRect.h / srcRect.h;
  const padX = Math.ceil(LANCZOS_A / Math.min(1, scaleX)) + 1;
  const padY = Math.ceil(LANCZOS_A / Math.min(1, scaleY)) + 1;

  // Integer source window, widened for filter support and clamped to the image.
  const x0 = Math.max(0, Math.floor(srcRect.x) - padX);
  const y0 = Math.max(0, Math.floor(srcRect.y) - padY);
  const x1 = Math.min(srcSize.w, Math.ceil(srcRect.x + srcRect.w) + padX);
  const y1 = Math.min(srcSize.h, Math.ceil(srcRect.y + srcRect.h) + padY);
  const sw = Math.max(1, x1 - x0);
  const sh = Math.max(1, y1 - y0);

  const grab = make(sw, sh);
  const gg = ctx2d(grab);
  gg.imageSmoothingEnabled = false;
  gg.drawImage(src, x0, y0, sw, sh, 0, 0, sw, sh);
  const data = gg.getImageData(0, 0, sw, sh).data;

  const dw = Math.max(1, Math.round(sw * scaleX));
  const dh = Math.max(1, Math.round(sh * scaleY));
  const resized = lanczosResize(data, sw, sh, dw, dh);
  release(grab);

  const holder = make(dw, dh);
  const hg = ctx2d(holder);
  const out = hg.createImageData(dw, dh);
  out.data.set(resized);
  hg.putImageData(out, 0, 0);

  // Take back exactly the region asked for. Scales here are ~1, so this final
  // placement costs no real quality but keeps the geometry exact.
  const fx = dw / sw;
  const fy = dh / sh;
  dst.drawImage(
    holder,
    (srcRect.x - x0) * fx,
    (srcRect.y - y0) * fy,
    srcRect.w * fx,
    srcRect.h * fy,
    dstRect.x,
    dstRect.y,
    dstRect.w,
    dstRect.h,
  );
  release(holder);
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: 'image/png' | 'image/jpeg',
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Canvas encoding failed — the image may be too large.'))),
      type,
      quality,
    );
  });
}

/** Yield to the browser so progress UI can paint between heavy tiles. */
export const breathe = () => new Promise<void>((r) => setTimeout(r, 0));

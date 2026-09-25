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

import type { Rect } from './units.ts';

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
): void {
  const sw = srcRect.w;
  const sh = srcRect.h;
  const dw = dstRect.w;
  const dh = dstRect.h;
  if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return;
  // A released (0×0) canvas would make drawImage throw; skip instead.
  if (src instanceof HTMLCanvasElement && (src.width === 0 || src.height === 0)) return;

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

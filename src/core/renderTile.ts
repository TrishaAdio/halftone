/**
 * Rasterise one sheet: white paper, the image slice placed at true scale, then
 * whatever assembly marks the join style allows.
 */

import { tileAt, type Layout, type Tile } from './layout.ts';
import { drawMarks } from './marks.ts';
import { createCanvas, drawResampled } from './resample.ts';
import { fmtMm, pxPerCm, SHEETS } from './units.ts';

export interface RenderOptions {
  /** Render at a different density than the export DPI (for on-screen previews). */
  dpi?: number;
  withMarks?: boolean;
  /** Override the configured resampler — previews use the fast path. */
  quality?: 'fast' | 'lanczos';
}

export function sheetSpec(layout: Layout): string {
  const s = layout.settings;
  const parts = [
    `${SHEETS[s.sheet].label} ${s.orientation === 'portrait' ? 'P' : 'L'}`,
    `${s.dpi} DPI`,
  ];
  if (s.join === 'trim') {
    parts.push(`trim ${fmtMm(layout.marginCm)}`);
    if (layout.hiddenCm > 0) parts.push(`overlap ${fmtMm(layout.hiddenCm)}`);
  } else if (s.join === 'borderless') {
    parts.push(`borderless, bleed ${fmtMm(layout.bleedCm)}`);
  } else {
    parts.push(`no cut, gutter ${fmtMm(layout.gutterCm)}`);
  }
  return parts.join(' · ');
}

export function renderTile(
  layout: Layout,
  image: CanvasImageSource,
  tile: Tile,
  opts: RenderOptions = {},
): HTMLCanvasElement {
  const dpi = opts.dpi ?? layout.settings.dpi;
  const withMarks = opts.withMarks ?? true;
  const k = pxPerCm(dpi);

  const { canvas, g } = createCanvas(layout.sheetCm.w * k, layout.sheetCm.h * k);

  // Printers ignore white ink, but a white matte keeps the PNG opaque and makes
  // the PDF/JPEG path behave identically to the PNG one.
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, canvas.width, canvas.height);

  drawResampled(
    g,
    image,
    tile.srcPx,
    {
      x: tile.placeCm.x * k,
      y: tile.placeCm.y * k,
      w: tile.placeCm.w * k,
      h: tile.placeCm.h * k,
    },
    { quality: opts.quality ?? layout.settings.resample, srcSize: layout.imagePx },
  );

  if (withMarks) {
    drawMarks(
      g,
      layout,
      tile,
      dpi,
      {
        right: tileAt(layout, tile.row, tile.col + 1)?.id,
        bottom: tileAt(layout, tile.row + 1, tile.col)?.id,
      },
      sheetSpec(layout),
    );
  }

  return canvas;
}

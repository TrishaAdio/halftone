/**
 * Rasterise one sheet: white paper, the image slice placed inside the margin at
 * true scale, then the assembly marks.
 */

import { tileAt, type Layout, type Tile } from './layout.ts';
import { drawMarks } from './marks.ts';
import { createCanvas, drawResampled } from './resample.ts';
import { pxPerCm, SHEETS } from './units.ts';

export interface RenderOptions {
  /** Render at a different density than the export DPI (used for on-screen previews). */
  dpi?: number;
  /** Skip marks entirely (used for the "assembled result" preview). */
  withMarks?: boolean;
}

export function sheetSpec(layout: Layout): string {
  const s = layout.settings;
  const parts = [
    `${SHEETS[s.sheet].label} ${s.orientation === 'portrait' ? 'P' : 'L'}`,
    `${s.dpi} DPI`,
    `trim ${(layout.marginCm * 10).toFixed(0)} mm`,
  ];
  if (layout.overlapCm > 0) parts.push(`overlap ${(layout.overlapCm * 10).toFixed(1)} mm`);
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

  // Paper. Printers ignore white ink, but a white matte keeps the PNG opaque
  // and makes the PDF/JPEG path behave identically to the PNG one.
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, canvas.width, canvas.height);

  drawResampled(g, image, tile.srcPx, {
    x: tile.placeCm.x * k,
    y: tile.placeCm.y * k,
    w: tile.placeCm.w * k,
    h: tile.placeCm.h * k,
  });

  if (withMarks) {
    drawMarks({
      g,
      dpi,
      sheetCm: layout.sheetCm,
      marginCm: layout.marginCm,
      overlapCm: layout.overlapCm,
      tile,
      cols: layout.cols,
      rows: layout.rows,
      marks: layout.settings.marks,
      neighborIds: {
        right: tileAt(layout, tile.row, tile.col + 1)?.id,
        bottom: tileAt(layout, tile.row + 1, tile.col)?.id,
      },
      info: sheetSpec(layout),
    });
  }

  return canvas;
}

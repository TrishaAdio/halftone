/**
 * Export paths. Three of them, all client-side:
 *
 *   PNG  — one sheet, tagged with its real DPI so "print at 100%" is honest.
 *   ZIP  — every sheet plus the assembly map, stored (not deflated: PNG is
 *          already compressed, so deflating again costs seconds and saves ~1%).
 *   PDF  — one page per sheet at the exact physical page size in PDF points.
 *          The image is drawn to fill the page, so no scaling decision is left
 *          to the print dialog: "Actual size" reproduces the design in cm.
 */

import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { assemblySteps, joinLabel, printSteps, renderAssemblyMap } from './assemblyMap.ts';
import { tileFileName, type Layout, type Tile } from './layout.ts';
import { pngBlobWithDpi } from './png.ts';
import { renderTile } from './renderTile.ts';
import { breathe, canvasToBlob, release } from './resample.ts';
import { cmToPt, fmtMm, SHEETS } from './units.ts';

export type RasterFormat = 'png' | 'jpeg';

export interface ExportMeta {
  fileName: string;
}

export interface Progress {
  done: number;
  total: number;
  label: string;
}

export interface ExportOptions {
  format?: RasterFormat;
  /** JPEG quality, 0–1. Ignored for PNG. */
  quality?: number;
  includeMap?: boolean;
  onProgress?: (p: Progress) => void;
  signal?: AbortSignal;
}

const abortIfNeeded = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
};

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a beat to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function baseName(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, '') || 'poster';
  return stem.replace(/[^\w.\- ]+/g, '_').slice(0, 60).trim() || 'poster';
}

/** Rasterise one sheet to a blob, DPI-tagged when PNG. */
async function tileBlob(
  layout: Layout,
  image: CanvasImageSource,
  tile: Tile,
  format: RasterFormat,
  quality: number,
): Promise<Blob> {
  const canvas = renderTile(layout, image, tile);
  try {
    if (format === 'jpeg') return await canvasToBlob(canvas, 'image/jpeg', quality);
    const raw = await canvasToBlob(canvas, 'image/png');
    return await pngBlobWithDpi(raw, layout.settings.dpi);
  } finally {
    release(canvas);
  }
}

async function mapBlob(
  layout: Layout,
  image: CanvasImageSource,
  meta: ExportMeta,
  format: RasterFormat,
  quality: number,
): Promise<Blob> {
  const canvas = renderAssemblyMap(layout, image, meta);
  try {
    if (format === 'jpeg') return await canvasToBlob(canvas, 'image/jpeg', quality);
    const raw = await canvasToBlob(canvas, 'image/png');
    return await pngBlobWithDpi(raw, 200);
  } finally {
    release(canvas);
  }
}

export async function exportSingleTile(
  layout: Layout,
  image: CanvasImageSource,
  tile: Tile,
  meta: ExportMeta,
): Promise<void> {
  const blob = await tileBlob(layout, image, tile, 'png', 1);
  downloadBlob(blob, `${baseName(meta.fileName)}_${tileFileName(tile)}.png`);
}

export async function exportMapImage(
  layout: Layout,
  image: CanvasImageSource,
  meta: ExportMeta,
): Promise<void> {
  const blob = await mapBlob(layout, image, meta, 'png', 1);
  downloadBlob(blob, `${baseName(meta.fileName)}_assembly-map.png`);
}

export async function exportZip(
  layout: Layout,
  image: CanvasImageSource,
  meta: ExportMeta,
  opts: ExportOptions = {},
): Promise<void> {
  const blob = await buildZip(layout, image, meta, opts);
  downloadBlob(blob, `${baseName(meta.fileName)}_${layout.cols}x${layout.rows}_tiles.zip`);
  opts.onProgress?.({ done: 1, total: 1, label: 'Done' });
}

export async function buildZip(
  layout: Layout,
  image: CanvasImageSource,
  meta: ExportMeta,
  opts: ExportOptions = {},
): Promise<Blob> {
  const { format = 'png', quality = 0.92, includeMap = true, onProgress, signal } = opts;
  const zip = new JSZip();
  const total = layout.tiles.length + (includeMap ? 1 : 0) + 1;
  let done = 0;
  const step = (label: string) => onProgress?.({ done, total, label });

  step('Preparing');

  if (includeMap) {
    abortIfNeeded(signal);
    step('Assembly map');
    const blob = await mapBlob(layout, image, meta, format, quality);
    zip.file(`00_assembly-map.${format === 'jpeg' ? 'jpg' : 'png'}`, blob);
    done++;
  }

  zip.file('PRINT-ME.txt', printInstructions(layout, meta));

  for (const tile of layout.tiles) {
    abortIfNeeded(signal);
    step(`Sheet ${tile.id}`);
    const blob = await tileBlob(layout, image, tile, format, quality);
    zip.file(`${tileFileName(tile)}.${format === 'jpeg' ? 'jpg' : 'png'}`, blob);
    done++;
    await breathe();
  }

  step('Packing ZIP');
  // STORE: the payload is already-compressed image data.
  return zip.generateAsync({ type: 'blob', compression: 'STORE' }, (m) => {
    onProgress?.({ done: total - 1 + m.percent / 100, total, label: 'Packing ZIP' });
  });
}

export async function exportPdf(
  layout: Layout,
  image: CanvasImageSource,
  meta: ExportMeta,
  opts: ExportOptions = {},
): Promise<void> {
  const bytes = await buildPdf(layout, image, meta, opts);
  downloadBlob(
    new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }),
    `${baseName(meta.fileName)}_${layout.cols}x${layout.rows}_${layout.settings.sheet}tiles.pdf`,
  );
  opts.onProgress?.({ done: 1, total: 1, label: 'Done' });
}

export async function buildPdf(
  layout: Layout,
  image: CanvasImageSource,
  meta: ExportMeta,
  opts: ExportOptions = {},
): Promise<Uint8Array> {
  const { format = 'jpeg', quality = 0.92, includeMap = true, onProgress, signal } = opts;
  const doc = await PDFDocument.create();
  const pageW = cmToPt(layout.sheetCm.w);
  const pageH = cmToPt(layout.sheetCm.h);
  const total = layout.tiles.length + (includeMap ? 1 : 0) + 1;
  let done = 0;

  doc.setTitle(`${baseName(meta.fileName)} — ${layout.cols}×${layout.rows} poster tiles`);
  doc.setCreator('TileCraft');
  doc.setProducer('TileCraft');
  doc.setSubject(
    `Print every page at 100% / Actual size on ${SHEETS[layout.settings.sheet].label}. ` +
      `Assembled size ${layout.imageCm.w.toFixed(1)} × ${layout.imageCm.h.toFixed(1)} cm.`,
  );

  const addPage = async (blob: Blob) => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const img = format === 'jpeg' ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
    const page = doc.addPage([pageW, pageH]);
    page.drawImage(img, { x: 0, y: 0, width: pageW, height: pageH });
  };

  if (includeMap) {
    abortIfNeeded(signal);
    onProgress?.({ done, total, label: 'Assembly map' });
    await addPage(await mapBlob(layout, image, meta, format, quality));
    done++;
  }

  for (const tile of layout.tiles) {
    abortIfNeeded(signal);
    onProgress?.({ done, total, label: `Page ${tile.id}` });
    await addPage(await tileBlob(layout, image, tile, format, quality));
    done++;
    await breathe();
  }

  onProgress?.({ done, total, label: 'Writing PDF' });
  return doc.save();
}

export function printInstructions(layout: Layout, meta: ExportMeta): string {
  const L = layout;
  const s = L.settings;
  const wrapAt = (str: string, width: number, indent: string) => {
    const out: string[] = [];
    let line = '';
    for (const word of str.split(' ')) {
      if ((line + ' ' + word).trim().length > width && line) {
        out.push(line);
        line = word;
      } else line = (line ? line + ' ' : '') + word;
    }
    if (line) out.push(line);
    return out.map((l, i) => (i === 0 ? l : indent + l));
  };
  return [
    `TileCraft — ${baseName(meta.fileName)}`,
    ''.padEnd(60, '='),
    '',
    `Source image      ${L.imagePx.w} x ${L.imagePx.h} px`,
    `Final print size  ${L.imageCm.w.toFixed(1)} x ${L.imageCm.h.toFixed(1)} cm`,
    `Grid              ${L.cols} columns x ${L.rows} rows = ${L.tiles.length} sheets`,
    `Paper             ${SHEETS[s.sheet].label} ${s.orientation} (${L.sheetCm.w} x ${L.sheetCm.h} cm)`,
    `Export density    ${s.dpi} DPI -> ${L.sheetPx.w} x ${L.sheetPx.h} px per sheet`,
    `Effective detail  ${Math.round(L.effectiveDpi)} DPI of real source pixels`,
    `Join              ${joinLabel(L)}`,
    s.join === 'borderless'
      ? `Bleed per edge    ${fmtMm(L.bleedCm)} (set driver Expansion to Standard)`
      : `Printer margin    ${fmtMm(L.marginCm)} each edge${s.join === 'trim' ? ', trimmed off' : ', cannot print here'}`,
    L.gutterCm > 0
      ? `White line/seam   ${fmtMm(L.gutterCm)} (${(L.inkedFraction * 100).toFixed(1)}% of the picture is inked)`
      : `Seams             seamless`,
    L.hiddenCm > 0
      ? `${(s.join === 'trim' ? 'Overlap per seam' : 'Covered strip').padEnd(18)}${fmtMm(L.hiddenCm)}`
      : null,
    '',
    'PRINTING',
    ''.padEnd(60, '-'),
    ...printSteps(L).flatMap((step, i) => wrapAt(`${i + 1}. ${step}`, 68, '   ')),
    '',
    'ASSEMBLY',
    ''.padEnd(60, '-'),
    ...assemblySteps(L).flatMap((step, i) => wrapAt(`${i + 1}. ${step}`, 68, '   ')),
    '',
    'NOTES',
    ''.padEnd(60, '-'),
    '- Colours assume sRGB. Printer, driver and paper calibration will shift',
    '  the result; print one sheet as a test first.',
    '- The last column and/or row can be narrower than the others. That is',
    '  correct: those sheets simply carry less picture.',
    '',
  ]
    .filter((l): l is string => l !== null)
    .join('\n');
}

/** Rough download-size estimate for the UI. Photographic content, 24-bit. */
export function estimateBytes(layout: Layout, format: RasterFormat): number {
  const perPx = format === 'png' ? 0.9 : 0.12;
  return Math.round(layout.totalTilePx * perPx);
}

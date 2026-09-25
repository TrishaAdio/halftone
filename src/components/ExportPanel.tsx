import { useRef, useState } from 'react';
import {
  estimateBytes,
  exportMapImage,
  exportPdf,
  exportZip,
  type Progress,
  type RasterFormat,
} from '../core/exporters.ts';
import type { Layout } from '../core/layout.ts';
import { fmtBytes } from '../core/units.ts';
import { Check, Field, Section, Segmented, Slider } from './ui.tsx';

export function ExportPanel({
  layout: L,
  source,
  fileName,
}: {
  layout: Layout;
  source: CanvasImageSource;
  fileName: string;
}) {
  const [format, setFormat] = useState<RasterFormat>('jpeg');
  const [quality, setQuality] = useState(0.92);
  const [includeMap, setIncludeMap] = useState(true);
  const [job, setJob] = useState<{ kind: string; p: Progress } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const blocked = L.notices.some((n) => n.level === 'error');

  const run = async (
    kind: string,
    fn: (opts: {
      onProgress: (p: Progress) => void;
      signal: AbortSignal;
    }) => Promise<void>,
  ) => {
    if (job) return;
    const ac = new AbortController();
    abort.current = ac;
    setError(null);
    setJob({ kind, p: { done: 0, total: 1, label: 'Starting' } });
    try {
      await fn({ onProgress: (p) => setJob({ kind, p }), signal: ac.signal });
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') {
        setError(
          e instanceof Error
            ? `${e.message} — try 150 or 300 DPI, or export in two halves.`
            : 'Export failed.',
        );
      }
    } finally {
      abort.current = null;
      setJob(null);
    }
  };

  const pdfBytes = estimateBytes(L, format);
  const zipBytes = estimateBytes(L, 'png');

  return (
    <Section title="Export" tag={`${L.tiles.length + (includeMap ? 1 : 0)} pages`}>
      <button
        type="button"
        className="btn primary block"
        disabled={!!job || blocked}
        onClick={() =>
          run('pdf', (o) =>
            exportPdf(L, source, { fileName }, { format, quality, includeMap, ...o }),
          )
        }
      >
        Print-ready PDF · {L.tiles.length + (includeMap ? 1 : 0)} pages
      </button>

      <button
        type="button"
        className="btn block"
        disabled={!!job || blocked}
        onClick={() =>
          run('zip', (o) => exportZip(L, source, { fileName }, { format: 'png', includeMap, ...o }))
        }
      >
        ZIP of {L.tiles.length} PNG sheets
      </button>

      <button
        type="button"
        className="btn ghost block sm"
        disabled={!!job || blocked}
        onClick={() => run('map', () => exportMapImage(L, source, { fileName }))}
      >
        Assembly map only (PNG)
      </button>

      {job && (
        <div className="progress">
          <div className="bar">
            <i style={{ width: `${Math.min(100, (job.p.done / Math.max(1, job.p.total)) * 100)}%` }} />
          </div>
          <div className="meta">
            <span>{job.p.label}</span>
            <span>
              {Math.floor(job.p.done)}/{job.p.total}
            </span>
          </div>
          <button type="button" className="btn sm" onClick={() => abort.current?.abort()}>
            Cancel
          </button>
        </div>
      )}

      {error && (
        <div className="notice error">
          <span className="ico">×</span>
          <span>
            <b>Export failed</b>
            {error}
          </span>
        </div>
      )}

      <Field label="Images inside the PDF" hint={`≈ ${fmtBytes(pdfBytes)}`}>
        <Segmented
          value={format}
          onChange={setFormat}
          options={[
            { value: 'jpeg', label: 'JPEG', title: 'Much smaller files, near-invisible loss' },
            { value: 'png', label: 'PNG', title: 'Lossless, very large files' },
          ]}
        />
      </Field>
      {format === 'jpeg' && (
        <Field label="JPEG quality">
          <Slider
            min={0.6}
            max={1}
            step={0.01}
            value={quality}
            onChange={setQuality}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </Field>
      )}
      <Check compact checked={includeMap} onChange={setIncludeMap}>
        Put the assembly map first
      </Check>

      <div className="footnote">
        ZIP always holds lossless PNGs (≈ {fmtBytes(zipBytes)}) tagged at {L.settings.dpi} DPI, plus a{' '}
        <code>PRINT-ME.txt</code> with the specification and assembly steps. PDF pages are exactly{' '}
        {L.sheetCm.w} × {L.sheetCm.h} cm, so printing at <b>100% / Actual size</b> — never "fit to
        page" — reproduces the design to the millimetre.
      </div>
      <div className="footnote">
        Colours assume sRGB and are passed through untouched. Your printer, driver and paper decide
        the rest, so test one sheet before committing {L.tiles.length} of them.
      </div>
    </Section>
  );
}

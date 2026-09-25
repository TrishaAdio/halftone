import { useEffect, useRef, useState } from 'react';
import { tileAt, tileFileName, type Layout } from '../core/layout.ts';
import { exportSingleTile } from '../core/exporters.ts';
import { renderTile } from '../core/renderTile.ts';
import { release } from '../core/resample.ts';
import { Check, Section } from './ui.tsx';

const PREVIEW_DPI = 96;
const MAX_CELLS = 900;

export function SheetPicker({
  layout: L,
  source,
  fileName,
  selected,
  onSelect,
}: {
  layout: Layout;
  source: CanvasImageSource;
  fileName: string;
  selected: { row: number; col: number } | null;
  onSelect: (s: { row: number; col: number } | null) => void;
}) {
  const [withMarks, setWithMarks] = useState(true);
  const [busy, setBusy] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const tile = selected ? tileAt(L, selected.row, selected.col) : undefined;

  // Render the selected sheet exactly as it will export, just at screen density.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    el.replaceChildren();
    if (!tile) return;
    const canvas = renderTile(L, source, tile, { dpi: PREVIEW_DPI, withMarks });
    canvas.style.width = '100%';
    canvas.style.height = 'auto';
    el.appendChild(canvas);
    return () => {
      canvas.remove();
      release(canvas);
    };
  }, [L, source, tile, withMarks]);

  const cells = L.cols * L.rows;
  const tooMany = cells > MAX_CELLS;

  return (
    <Section title="Sheets" defaultOpen tag={`${L.tiles.length} to print`}>
      {tooMany ? (
        <div className="footnote">
          {cells} cells is too many to list. Click a sheet in the preview to inspect or download it
          individually.
        </div>
      ) : (
        <div className="tile-scroll">
          <div
            className="tile-grid"
            style={{ gridTemplateColumns: `repeat(${L.cols}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: cells }, (_, i) => {
              const row = Math.floor(i / L.cols);
              const col = i % L.cols;
              const t = tileAt(L, row, col);
              if (!t) {
                return (
                  <div key={i} className="tile-cell empty" title="No image on this sheet — not exported">
                    ·
                  </div>
                );
              }
              const isSel = selected?.row === row && selected?.col === col;
              return (
                <button
                  key={i}
                  type="button"
                  className={`tile-cell${t.partial ? ' partial' : ''}`}
                  aria-pressed={isSel}
                  title={`${t.id}${t.partial ? ' (partial sheet)' : ''} — ${t.contentCm.w.toFixed(
                    1,
                  )} × ${t.contentCm.h.toFixed(1)} cm of image`}
                  onClick={() => onSelect(isSel ? null : { row, col })}
                >
                  {t.id.replace('-', '')}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {tile ? (
        <>
          <div className="sheet-preview">
            <div className="paper" ref={host} style={{ width: '100%' }} />
            <div className="caption">
              {tile.id} · {tile.contentCm.w.toFixed(2)} × {tile.contentCm.h.toFixed(2)} cm of image
              <br />
              source crop {Math.round(tile.srcPx.w)} × {Math.round(tile.srcPx.h)} px at (
              {Math.round(tile.srcPx.x)}, {Math.round(tile.srcPx.y)})
              {tile.partial && ' · partial sheet'}
            </div>
          </div>
          <Check compact checked={withMarks} onChange={setWithMarks}>
            Show marks in this preview
          </Check>
          <button
            type="button"
            className="btn block"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await exportSingleTile(L, source, tile, { fileName });
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Rendering…' : `Download ${tileFileName(tile)}.png`}
          </button>
        </>
      ) : (
        <div className="footnote">
          Pick a sheet above or click one in the preview to see exactly what will print, and to
          download it on its own.
        </div>
      )}
    </Section>
  );
}

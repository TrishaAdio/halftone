import { useEffect, useMemo, useState } from 'react';
import { Controls } from './components/Controls.tsx';
import { Dropzone } from './components/Dropzone.tsx';
import { ExportPanel } from './components/ExportPanel.tsx';
import { PreviewCanvas } from './components/PreviewCanvas.tsx';
import { SheetPicker } from './components/SheetPicker.tsx';
import { Summary } from './components/Summary.tsx';
import { Check, Segmented } from './components/ui.tsx';
import type { LoadedImage } from './core/imageMeta.ts';
import {
  computeLayout,
  DEFAULT_SETTINGS,
  MARK_COLORS,
  type MarkOptions,
  type Settings,
} from './core/layout.ts';
import { createCanvas, drawResampled, release } from './core/resample.ts';
import { fmtBytes } from './core/units.ts';

/** Cap for the on-screen preview source; keeps redraws snappy on 8000px inputs. */
const PREVIEW_MAX_W = 2000;

export default function App() {
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const [showIds, setShowIds] = useState(true);
  const [showOverlap, setShowOverlap] = useState(true);
  const [zoom, setZoom] = useState(1);

  const patch = (p: Partial<Settings>) => setSettings((s) => ({ ...s, ...p }));
  const patchMarks = (p: Partial<MarkOptions>) =>
    setSettings((s) => ({ ...s, marks: { ...s.marks, ...p } }));

  const layout = useMemo(
    () => (image ? computeLayout({ w: image.width, h: image.height }, settings) : null),
    [image, settings],
  );

  /* A downscaled copy of the source for previews; the export path always uses
     the full-resolution bitmap. This must stay side-effect free — under
     StrictMode the memo body runs twice, so freeing anything here would free
     the canvas the surviving render is still holding. Disposal happens in the
     effect below instead. */
  const preview = useMemo(() => {
    if (!image) return null;
    if (image.width <= PREVIEW_MAX_W) {
      return {
        src: image.bitmap as CanvasImageSource,
        px: { w: image.width, h: image.height },
        owned: null as HTMLCanvasElement | null,
      };
    }
    const scale = PREVIEW_MAX_W / image.width;
    const { canvas, g } = createCanvas(PREVIEW_MAX_W, Math.max(1, Math.round(image.height * scale)));
    drawResampled(
      g,
      image.bitmap,
      { x: 0, y: 0, w: image.width, h: image.height },
      { x: 0, y: 0, w: canvas.width, h: canvas.height },
    );
    return { src: canvas as CanvasImageSource, px: { w: canvas.width, h: canvas.height }, owned: canvas };
  }, [image]);

  useEffect(() => () => release(preview?.owned), [preview]);

  /* A selection can fall outside the grid when the settings change. Derive
     validity during render rather than clearing the state in an effect — the
     pick then comes back by itself if the old grid does. */
  const active =
    layout && selected && layout.tiles.some((t) => t.row === selected.row && t.col === selected.col)
      ? selected
      : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const reset = () => {
    if (image) URL.revokeObjectURL(image.url);
    image?.bitmap.close();
    setImage(null);
    setSelected(null);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="mark" aria-hidden>
            <i />
            <i />
            <i />
            <i />
          </span>
          TileCraft
          <small>high-resolution image to paper tiles</small>
        </div>
        {image && layout && (
          <div className="file">
            <b title={image.name}>{image.name}</b>
            <span>
              {image.width} × {image.height} px
            </span>
            <span>{fmtBytes(image.bytes)}</span>
            <button type="button" className="btn sm" onClick={reset}>
              New image
            </button>
          </div>
        )}
      </header>

      {!image || !layout || !preview ? (
        <Dropzone onLoad={setImage} />
      ) : (
        <div className="main">
          <div className="stage">
            <div className="stage-bar">
              <Segmented
                value={showGrid ? 'grid' : 'clean'}
                onChange={(v) => setShowGrid(v === 'grid')}
                options={[
                  { value: 'grid', label: 'Sheet grid' },
                  { value: 'clean', label: 'Assembled' },
                ]}
              />
              <Check compact checked={showIds} onChange={setShowIds} disabled={!showGrid}>
                Ids
              </Check>
              <Check
                compact
                checked={showOverlap}
                onChange={setShowOverlap}
                disabled={!showGrid || layout.overlapCm === 0}
              >
                Overlap
              </Check>
              <div className="slider" style={{ width: 132 }}>
                <input
                  type="range"
                  min={1}
                  max={5}
                  step={0.25}
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                  aria-label="Zoom"
                />
                <span className="val" style={{ minWidth: 34 }}>
                  {zoom.toFixed(2).replace(/\.00$/, '')}×
                </span>
              </div>
              <div className="spacer" />
              <div className="readout">
                <b>
                  {layout.cols}×{layout.rows}
                </b>{' '}
                sheets · {layout.imageCm.w.toFixed(1)} × {layout.imageCm.h.toFixed(1)} cm
              </div>
            </div>

            <div className="stage-body">
              <PreviewCanvas
                layout={layout}
                source={preview.src}
                sourcePx={preview.px}
                showIds={showIds}
                showOverlap={showOverlap}
                showGrid={showGrid}
                zoom={zoom}
                selected={active}
                onSelect={setSelected}
              />
            </div>

            <div className="legend">
              <span>
                <i style={{ background: '#fff' }} /> seam — where the next sheet's cut edge lands
              </span>
              {layout.overlapCm > 0 && (
                <span>
                  <i style={{ background: MARK_COLORS.magenta, opacity: 0.45 }} /> shared overlap strip
                </span>
              )}
              <span>
                <i
                  style={{
                    background:
                      'repeating-linear-gradient(45deg,#2a2f3a 0 3px,#1b1f27 3px 6px)',
                  }}
                />{' '}
                blank paper — no image on this part of the sheet
              </span>
              <span>
                <i style={{ background: '#38e08c' }} /> partial sheet / selection
              </span>
              <span style={{ marginLeft: 'auto' }}>click a sheet to inspect it</span>
            </div>
          </div>

          <aside className="sidebar">
            <Summary layout={layout} image={image} />
            <Controls settings={settings} layout={layout} patch={patch} patchMarks={patchMarks} />
            <SheetPicker
              layout={layout}
              source={image.bitmap}
              fileName={image.name}
              selected={active}
              onSelect={setSelected}
            />
            <ExportPanel layout={layout} source={image.bitmap} fileName={image.name} />
            <div className="section">
              <div className="body">
                <div className="footnote">
                  Everything happens in this tab — the image never leaves your machine. Reload to
                  start over.
                </div>
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

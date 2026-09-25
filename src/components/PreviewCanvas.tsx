import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Layout } from '../core/layout.ts';
import { drawOverlay, SCREEN_THEME } from '../core/overlay.ts';
import { drawResampled } from '../core/resample.ts';

export interface PreviewProps {
  layout: Layout;
  source: CanvasImageSource;
  sourcePx: { w: number; h: number };
  showIds: boolean;
  showOverlap: boolean;
  showGrid: boolean;
  zoom: number;
  selected: { row: number; col: number } | null;
  onSelect: (sel: { row: number; col: number } | null) => void;
}

/**
 * The live poster preview: the image drawn at poster scale with the sheet grid
 * on top. Clicking picks a sheet — the pick uses `floor(cm / step)`, which in an
 * overlapping grid is the sheet that ends up on top at that point.
 */
export function PreviewCanvas(props: PreviewProps) {
  const { layout: L, source, sourcePx, zoom } = props;
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  // Track the available stage size.
  useLayoutEffect(() => {
    const el = wrap.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setBox({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit the whole sheet grid into the stage, then apply zoom.
  const pad = 40;
  const availW = Math.max(160, box.w - pad);
  const availH = Math.max(160, box.h - pad);
  const fit = Math.min(availW / L.gridCm.w, availH / L.gridCm.h);
  const scale = Math.max(0.5, fit * zoom); // px per cm
  const cssW = Math.round(L.gridCm.w * scale);
  const cssH = Math.round(L.gridCm.h * scale);

  useEffect(() => {
    const el = canvas.current;
    if (!el || cssW < 2) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    el.width = Math.round(cssW * dpr);
    el.height = Math.round(cssH * dpr);
    el.style.width = `${cssW}px`;
    el.style.height = `${cssH}px`;
    const g = el.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cssW, cssH);

    // Paper, then the image at poster scale.
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, cssW, cssH);
    drawResampled(
      g,
      source,
      { x: 0, y: 0, w: sourcePx.w, h: sourcePx.h },
      { x: 0, y: 0, w: L.imageCm.w * scale, h: L.imageCm.h * scale },
    );

    if (props.showGrid) {
      drawOverlay(g, L, {
        scale,
        theme: SCREEN_THEME,
        showIds: props.showIds,
        showOverlap: props.showOverlap,
        selected: props.selected,
      });
    }
  }, [L, source, sourcePx, scale, cssW, cssH, props.showIds, props.showOverlap, props.showGrid, props.selected]);

  const pick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const el = canvas.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cmX = ((e.clientX - r.left) / r.width) * L.gridCm.w;
    const cmY = ((e.clientY - r.top) / r.height) * L.gridCm.h;
    const col = Math.max(0, Math.min(L.cols - 1, Math.floor(cmX / L.stepCm.w)));
    const row = Math.max(0, Math.min(L.rows - 1, Math.floor(cmY / L.stepCm.h)));
    const exists = L.tiles.some((t) => t.row === row && t.col === col);
    if (!exists) {
      props.onSelect(null);
      return;
    }
    const same = props.selected?.row === row && props.selected?.col === col;
    props.onSelect(same ? null : { row, col });
  };

  return (
    <div className="paper-wrap" ref={wrap} style={{ width: cssW, height: cssH }}>
      <canvas ref={canvas} onClick={pick} style={{ cursor: 'pointer' }} />
    </div>
  );
}

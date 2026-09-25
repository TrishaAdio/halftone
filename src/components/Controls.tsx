import {
  MARK_COLORS,
  MAX_COLS,
  MAX_ROWS,
  cleanFits,
  gridBasics,
  suggestGrid,
  type Layout,
  type MarkColor,
  type MarkOptions,
  type Settings,
} from '../core/layout.ts';
import { SHEETS, type SheetId } from '../core/units.ts';
import { Check, Field, NumberInput, Section, Segmented, Slider } from './ui.tsx';
import { useState } from 'react';

export interface ControlsProps {
  settings: Settings;
  layout: Layout;
  patch: (p: Partial<Settings>) => void;
  patchMarks: (p: Partial<MarkOptions>) => void;
}

export function Controls({ settings: s, layout: L, patch, patchMarks }: ControlsProps) {
  const [sheetCount, setSheetCount] = useState(() => Math.max(1, L.tiles.length));

  /** Switching sizing mode carries the current physical size across. */
  const switchMode = (mode: Settings['mode']) => {
    if (mode === s.mode) return;
    if (mode === 'grid') patch({ mode, cols: L.cols, rows: L.rows, autoRows: true });
    else
      patch({
        mode,
        targetCm: Number((s.targetAxis === 'width' ? L.imageCm.w : L.imageCm.h).toFixed(1)),
      });
  };

  const switchAxis = (axis: Settings['targetAxis']) => {
    if (axis === s.targetAxis) return;
    patch({
      targetAxis: axis,
      targetCm: Number((axis === 'width' ? L.imageCm.w : L.imageCm.h).toFixed(1)),
    });
  };

  const applySuggestion = () => {
    const b = gridBasics(s);
    const g = suggestGrid(b, L.imagePx, sheetCount);
    patch({ mode: 'grid', cols: g.cols, rows: g.rows, autoRows: false });
  };

  // Nearby sizes with no sliver column, offered only when they are a real
  // improvement on what the current numbers produce.
  const snaps =
    s.mode === 'target' && L.coverage < 0.97
      ? cleanFits(gridBasics(s), L.imagePx, L.cols, s.targetAxis)
          .filter((f) => f.coverage > L.coverage + 0.02)
          .sort((a, b2) => Math.abs(a.targetCm - s.targetCm) - Math.abs(b2.targetCm - s.targetCm))
          .slice(0, 2)
      : [];

  const mm = (cm: number) => `${(cm * 10).toFixed(cm * 10 < 10 ? 1 : 0)} mm`;

  return (
    <>
      <Section title="Output size" tag={`${L.cols} × ${L.rows}`}>
        <Segmented
          accent
          value={s.mode}
          onChange={switchMode}
          options={[
            { value: 'grid', label: 'By sheet grid', title: 'Choose how many sheets to use' },
            { value: 'target', label: 'By print size', title: 'Choose the finished size in cm' },
          ]}
        />

        {s.mode === 'grid' ? (
          <>
            <div className="row">
              <Field label="Columns">
                <NumberInput
                  value={s.cols}
                  min={1}
                  max={MAX_COLS}
                  onChange={(cols) => patch({ cols })}
                />
              </Field>
              <Field label="Rows" hint={s.autoRows ? 'auto' : undefined}>
                <NumberInput
                  value={s.autoRows ? L.rows : s.rows}
                  min={1}
                  max={MAX_ROWS}
                  readOnly={s.autoRows}
                  onChange={(rows) => patch({ rows })}
                />
              </Field>
            </div>
            <Check
              compact
              checked={s.autoRows}
              onChange={(autoRows) => patch({ autoRows, rows: autoRows ? s.rows : L.rows })}
            >
              Fill the columns and let rows follow the aspect ratio
            </Check>
            <Field
              label="Or aim for a sheet count"
              hint={`${L.tiles.length} now`}
            >
              <div className="row">
                <NumberInput value={sheetCount} min={1} max={400} onChange={setSheetCount} />
                <button type="button" className="btn sm" onClick={applySuggestion}>
                  Fit {sheetCount} sheets
                </button>
              </div>
            </Field>
            {!s.autoRows && L.coverage < 0.999 && (
              <div className="footnote">
                The image is scaled to fit inside {s.cols} × {s.rows} sheets without distortion, so{' '}
                {((1 - L.coverage) * 100).toFixed(0)}% of the grid stays blank.
              </div>
            )}
          </>
        ) : (
          <>
            <Segmented
              value={s.targetAxis}
              onChange={switchAxis}
              options={[
                { value: 'height', label: 'Set height' },
                { value: 'width', label: 'Set width' },
              ]}
            />
            <div className="row">
              <Field label={s.targetAxis === 'height' ? 'Height' : 'Width'}>
                <NumberInput
                  value={s.targetCm}
                  min={1}
                  max={2000}
                  step={5}
                  precision={1}
                  unit="cm"
                  onChange={(targetCm) => patch({ targetCm })}
                />
              </Field>
              <Field
                label={s.targetAxis === 'height' ? 'Width' : 'Height'}
                hint="from aspect"
              >
                <NumberInput
                  value={s.targetAxis === 'height' ? L.imageCm.w : L.imageCm.h}
                  precision={1}
                  unit="cm"
                  readOnly
                  onChange={() => {}}
                />
              </Field>
            </div>
            <div className="footnote">
              The picture keeps the size you set. {L.cols} × {L.rows} sheets span{' '}
              {L.gridCm.w.toFixed(1)} × {L.gridCm.h.toFixed(1)} cm, so the surplus stays as blank
              paper on the last column and row.
            </div>
            {snaps.length > 0 && (
              <Field label="Sizes that use whole sheets">
                {snaps.map((f) => (
                  <button
                    key={`${f.cols}x${f.rows}`}
                    type="button"
                    className="btn sm block"
                    style={{ justifyContent: 'space-between', marginBottom: 4 }}
                    onClick={() => patch({ targetCm: f.targetCm })}
                  >
                    <span>
                      {f.imageCm.w.toFixed(1)} × {f.imageCm.h.toFixed(1)} cm
                    </span>
                    <span className="kbd">
                      {f.cols}×{f.rows} · {f.sheets} sheets
                    </span>
                  </button>
                ))}
              </Field>
            )}
          </>
        )}
      </Section>

      <Section title="Paper" tag={`${SHEETS[s.sheet].label} ${s.orientation}`}>
        <Field label="Sheet size">
          <Segmented
            value={s.sheet}
            onChange={(sheet) => patch({ sheet: sheet as SheetId })}
            options={(Object.keys(SHEETS) as SheetId[]).map((id) => ({
              value: id,
              label: id === 'Letter' ? 'Letter' : id === 'Legal' ? 'Legal' : id,
              title: `${SHEETS[id].w} × ${SHEETS[id].h} cm`,
            }))}
          />
        </Field>
        <Field label="Sheet orientation" hint={`${L.sheetCm.w} × ${L.sheetCm.h} cm`}>
          <Segmented
            value={s.orientation}
            onChange={(orientation) => patch({ orientation })}
            options={[
              { value: 'portrait', label: 'Portrait' },
              { value: 'landscape', label: 'Landscape' },
            ]}
          />
        </Field>
        <Field
          label="Export density"
          hint={`${L.sheetPx.w} × ${L.sheetPx.h} px per sheet`}
        >
          <Segmented
            value={s.dpi}
            onChange={(dpi) => patch({ dpi })}
            options={[
              { value: 150, label: '150 DPI', title: 'Draft / very large posters' },
              { value: 300, label: '300 DPI', title: 'Standard photo quality' },
              { value: 600, label: '600 DPI', title: 'Fine line art, big files' },
            ]}
          />
        </Field>
      </Section>

      <Section
        title="Trim & overlap"
        tag={`${mm(L.marginCm)}${L.overlapCm > 0 ? ` + ${mm(L.overlapCm)}` : ''}`}
      >
        <Field
          label="Printer margin, each edge"
          hint={`image block ${L.printableCm.w.toFixed(1)} × ${L.printableCm.h.toFixed(1)} cm`}
        >
          <Slider
            min={0}
            max={2}
            step={0.05}
            value={s.marginCm}
            onChange={(marginCm) => patch({ marginCm })}
            format={mm}
          />
        </Field>
        <div className="footnote">
          Almost no home printer reaches the paper edge. This band is left blank, carries the marks,
          and gets cut off.
        </div>
        <Check checked={s.overlapEnabled} onChange={(overlapEnabled) => patch({ overlapEnabled })}>
          Overlap seams (recommended)
        </Check>
        {s.overlapEnabled && (
          <Field
            label="Shared strip per seam"
            hint={`${L.stepCm.w.toFixed(1)} × ${L.stepCm.h.toFixed(1)} cm net per sheet`}
          >
            <Slider
              min={0.1}
              max={1.5}
              step={0.05}
              value={s.overlapCm}
              onChange={(overlapCm) => patch({ overlapCm })}
              format={mm}
            />
          </Field>
        )}
        <div className="footnote">
          {s.overlapEnabled
            ? 'Neighbouring sheets repeat this strip of picture, so a cut that wanders by less than the strip width still leaves no white gap. Each sheet covers less ground, so you may need one more row or column.'
            : 'Without an overlap every seam is a butt joint: both edges must be cut exactly on the line.'}
        </div>
      </Section>

      <Section title="Assembly marks" defaultOpen={false} tag={markCount(s.marks)}>
        <Check compact checked={s.marks.trimLines} onChange={(v) => patchMarks({ trimLines: v })}>
          Dashed trim lines
        </Check>
        <Check compact checked={s.marks.cornerMarks} onChange={(v) => patchMarks({ cornerMarks: v })}>
          Corner registration L-marks
        </Check>
        <Check compact checked={s.marks.edgeTicks} onChange={(v) => patchMarks({ edgeTicks: v })}>
          Mid-edge skew ticks
        </Check>
        <Check
          compact
          checked={s.marks.overlapGuides}
          disabled={!s.overlapEnabled}
          onChange={(v) => patchMarks({ overlapGuides: v })}
          title={s.overlapEnabled ? undefined : 'Needs seam overlap'}
        >
          Overlap alignment guides
        </Check>
        <Check compact checked={s.marks.tileId} onChange={(v) => patchMarks({ tileId: v })}>
          Sheet id and spec in the margin
        </Check>
        <Check compact checked={s.marks.orientation} onChange={(v) => patchMarks({ orientation: v })}>
          TOP orientation arrow
        </Check>
        <Field label="Mark colour">
          <div className="swatches">
            {(Object.keys(MARK_COLORS) as MarkColor[]).map((c) => (
              <button
                key={c}
                type="button"
                title={c}
                aria-pressed={s.marks.color === c}
                onClick={() => patchMarks({ color: c })}
              >
                <span style={{ background: MARK_COLORS[c] }} />
              </button>
            ))}
          </div>
        </Field>
        <div className="footnote">
          Marks only ever land in the margin you cut away, or inside the overlap strip that the next
          sheet covers. None of them can end up on the finished poster.
        </div>
      </Section>
    </>
  );
}

function markCount(m: MarkOptions): string {
  const n = [m.trimLines, m.cornerMarks, m.edgeTicks, m.overlapGuides, m.tileId, m.orientation].filter(
    Boolean,
  ).length;
  return `${n}/6`;
}

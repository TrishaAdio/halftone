import {
  MARK_COLORS,
  MAX_COLS,
  MAX_ROWS,
  cleanFits,
  gridBasics,
  idIsPermanent,
  marksAvailable,
  suggestGrid,
  type Layout,
  type MarkColor,
  type MarkOptions,
  type Settings,
} from '../core/layout.ts';
import { isBorderlessCapable, SHEETS, type SheetId } from '../core/units.ts';
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
  const avail = marksAvailable(s);
  const permanentId = idIsPermanent(s);

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
        <Field label="Resampling" hint={s.resample === 'lanczos' ? 'slower export' : 'instant'}>
          <Segmented
            value={s.resample}
            onChange={(resample) => patch({ resample })}
            options={[
              { value: 'lanczos', label: 'Lanczos 3', title: 'Sharper enlargements; a second or two per sheet' },
              { value: 'fast', label: 'Fast', title: 'Browser bilinear with stepped downscale' },
            ]}
          />
        </Field>
        <div className="footnote">
          {s.resample === 'lanczos'
            ? 'Lanczos keeps edges crisp when the poster is larger than the source, which is the usual case here. Each crop is filtered with its surroundings included, so neighbouring sheets agree exactly along the seam. Previews stay on the fast path.'
            : 'The browser resizer: instant, but visibly softer on a big enlargement.'}
        </div>
      </Section>

      <Section
        title="Joining the sheets"
        tag={L.gutterCm > 0 ? `${mm(L.gutterCm)} lines` : 'seamless'}
      >
        <Segmented
          accent
          value={s.join}
          onChange={(join) => patch({ join })}
          options={[
            { value: 'nocut', label: 'No cutting', title: 'Assemble whole sheets — white lines at the seams' },
            { value: 'trim', label: 'Trim & overlap', title: 'Seamless, but every sheet must be cut' },
            { value: 'borderless', label: 'Borderless', title: 'Seamless with no cutting — needs 10×15 or 13×18 paper' },
          ]}
        />

        {s.join === 'nocut' && (
          <>
            <Field label="Where the next sheet goes">
              <Segmented
                value={s.placement}
                onChange={(placement) => patch({ placement })}
                options={[
                  { value: 'tight', label: `On the ink · ${mm(L.marginCm)}` },
                  { value: 'butt', label: `Edges touch · ${mm(L.marginCm * 2)}` },
                ]}
              />
            </Field>
            <div className="footnote">
              {s.placement === 'tight'
                ? `Lay each sheet so its edge covers the dashed line on its neighbour's ink. Overshooting is harmless — the white line stays ${mm(
                    L.gutterCm,
                  )} either way — so it is forgiving to do by hand, and it hides the sheet ids.`
                : `Butt the paper edges so they just touch. Nothing to judge at all, but two unprinted edges meet, so the white line is twice as wide: ${mm(
                    L.gutterCm,
                  )}.`}
            </div>
            {s.placement === 'tight' && (
              <Field
                label="Ink sacrificed under the next sheet"
                hint={`${L.stepCm.w.toFixed(1)} × ${L.stepCm.h.toFixed(1)} cm gain per sheet`}
              >
                <Slider
                  min={0.2}
                  max={1.5}
                  step={0.05}
                  value={s.coverCm}
                  onChange={(coverCm) => patch({ coverCm })}
                  format={mm}
                />
              </Field>
            )}
          </>
        )}

        {s.join === 'trim' && (
          <>
            <Field label="What the overlap is for">
              <Segmented
                value={s.seam}
                onChange={(seam) => patch({ seam })}
                options={[
                  { value: 'cut', label: 'Cut & butt', title: 'Cut both sheets on the marks, discard the duplicate' },
                  { value: 'lap', label: 'Lap & glue', title: 'Cut leading edges only, lay each sheet over the strip' },
                ]}
              />
            </Field>
            <div className="footnote">
              {s.seam === 'cut'
                ? `The marks sit ${mm(
                    L.hiddenCm,
                  )} inside the printed picture, not at the paper edge. Cut there on both sheets, throw the duplicated strip away, and the two cut edges meet on identical content — so the seam closes exactly. The overlap is your error budget: a cut that wanders by less than its width still lands on real picture.`
                : 'Cut only the leading edge of each sheet, then lay it over its neighbour, aligning the cut edge to the guide line inside the strip. Half the cuts, but the seam is a lap rather than a butt joint.'}
            </div>
            <Check checked={s.overlapEnabled} onChange={(overlapEnabled) => patch({ overlapEnabled })}>
              Overlap seams (recommended)
            </Check>
            {s.overlapEnabled && (
              <Field
                label="Shared strip per seam"
                hint={`${L.stepCm.w.toFixed(1)} × ${L.stepCm.h.toFixed(1)} cm gain per sheet`}
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
            {!s.overlapEnabled && (
              <div className="footnote">
                With no overlap there is no error budget at all: every seam must be cut exactly on the
                line on both sheets, and any wander shows as a white hairline.
              </div>
            )}
          </>
        )}

        {s.join === 'borderless' && (
          <>
            <Field label="Bleed per edge" hint="driver Expansion: Standard">
              <Slider
                min={0}
                max={0.8}
                step={0.05}
                value={s.bleedCm}
                onChange={(bleedCm) => patch({ bleedCm })}
                format={mm}
              />
            </Field>
            <div className="footnote">
              Truly seamless and no cutting — but only on paper your printer can print edge to edge.
              On the L3200 series that means {SHEETS.P10x15.label} or {SHEETS.P13x18.label}, not A4.
              The driver enlarges each page and sprays the excess off the paper; this bleed is the
              extra picture that gets sprayed away, so the join lands where it should.
            </div>
            {!isBorderlessCapable(s.sheet) && (
              <div className="row">
                {(['P13x18', 'P10x15'] as SheetId[]).map((id) => (
                  <button
                    key={id}
                    type="button"
                    className="btn sm"
                    onClick={() => patch({ sheet: id })}
                  >
                    Use {SHEETS[id].label}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        <Field
          label={s.join === 'borderless' ? 'Printer margin (not used)' : 'Printer margin, each edge'}
          hint={`printed block ${L.printableCm.w.toFixed(1)} × ${L.printableCm.h.toFixed(1)} cm`}
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
        <div className="row">
          <button type="button" className="btn sm" onClick={() => patch({ marginCm: 0.3 })}>
            Epson L3200 · 3 mm
          </button>
          <button type="button" className="btn sm" onClick={() => patch({ marginCm: 0.5 })}>
            Safe · 5 mm
          </button>
        </div>
        <div className="footnote">
          {s.join === 'nocut'
            ? 'The band your printer physically cannot reach. It is what creates the white lines, so measure it from a test print if the lines come out wider than expected.'
            : 'Almost no home printer reaches the paper edge. This band stays blank, carries the marks, and gets cut off.'}
        </div>
      </Section>

      <Section title="Assembly marks" defaultOpen={false} tag={markCount(s.marks, avail)}>
        {avail.trimLines && (
          <Check compact checked={s.marks.trimLines} onChange={(v) => patchMarks({ trimLines: v })}>
            Dashed trim lines
          </Check>
        )}
        {avail.cornerMarks && (
          <Check
            compact
            checked={s.marks.cornerMarks}
            onChange={(v) => patchMarks({ cornerMarks: v })}
          >
            Corner registration L-marks
          </Check>
        )}
        {avail.edgeTicks && (
          <Check compact checked={s.marks.edgeTicks} onChange={(v) => patchMarks({ edgeTicks: v })}>
            Mid-edge skew ticks
          </Check>
        )}
        {avail.overlapGuides && (
          <Check
            compact
            checked={s.marks.overlapGuides}
            onChange={(v) => patchMarks({ overlapGuides: v })}
          >
            {s.join === 'trim' ? 'Overlap alignment guides' : 'Dashed "cover to here" line'}
          </Check>
        )}
        <Check compact checked={s.marks.tileId} onChange={(v) => patchMarks({ tileId: v })}>
          {permanentId ? 'Sheet id — stays on the poster' : 'Sheet id and spec'}
        </Check>
        {avail.orientation && (
          <Check
            compact
            checked={s.marks.orientation}
            onChange={(v) => patchMarks({ orientation: v })}
          >
            TOP orientation arrow
          </Check>
        )}
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
          {permanentId
            ? 'Nothing is cut and nothing is covered in this mode, so any mark is permanent ink on the finished poster. Only the id is offered, and it is printed faint in a corner.'
            : s.join === 'trim'
              ? 'Marks only ever land in the margin you cut away, or inside the overlap strip the next sheet covers. None of them can end up on the finished poster.'
              : 'There is no margin to print in here, so every mark lives inside the strip the next sheet is laid over. They vanish as you assemble.'}
        </div>
      </Section>
    </>
  );
}

function markCount(m: MarkOptions, avail: Record<string, boolean>): string {
  const keys = ['trimLines', 'cornerMarks', 'edgeTicks', 'overlapGuides', 'tileId', 'orientation'] as const;
  const usable = keys.filter((k) => avail[k]);
  const on = usable.filter((k) => m[k]).length;
  return `${on}/${usable.length}`;
}

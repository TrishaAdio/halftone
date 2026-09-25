import type { Layout, Notice } from '../core/layout.ts';
import type { LoadedImage } from '../core/imageMeta.ts';
import { aspectLabel, SHEETS } from '../core/units.ts';
import { KV, Section } from './ui.tsx';

export function Summary({ layout: L, image }: { layout: Layout; image: LoadedImage }) {
  const sheets = L.tiles.length;
  const seams = L.tiles.reduce(
    (n, t) => n + (t.neighbors.right ? 1 : 0) + (t.neighbors.bottom ? 1 : 0),
    0,
  );
  const paperM2 = (sheets * L.sheetCm.w * L.sheetCm.h) / 10_000;
  const posterM2 = (L.imageCm.w * L.imageCm.h) / 10_000;

  return (
    <Section title="Result" tag={`${sheets} sheet${sheets === 1 ? '' : 's'}`}>
      <div className="headline">
        <div className="big">
          {L.cols} columns × {L.rows} rows = <em>{sheets}</em> sheets of {SHEETS[L.settings.sheet].label}
        </div>
        <div className="sub">
          final print size <b>{L.imageCm.w.toFixed(1)} × {L.imageCm.h.toFixed(1)} cm</b>
          {' · '}
          {(L.imageCm.w / 100).toFixed(2)} × {(L.imageCm.h / 100).toFixed(2)} m
        </div>
      </div>

      <KV
        rows={[
          ['Source', `${L.imagePx.w} × ${L.imagePx.h} px`],
          ['Aspect ratio', aspectLabel(L.imagePx.w, L.imagePx.h)],
          [
            'Density in file',
            image.density
              ? `${Math.round(image.density.x)} DPI${
                  Math.abs(image.density.x - image.density.y) > 1
                    ? ` × ${Math.round(image.density.y)}`
                    : ''
                }`
              : 'not embedded',
            !image.density,
          ],
          [
            'Effective print detail',
            `${Math.round(L.effectiveDpi)} DPI`,
            L.effectiveDpi < L.settings.dpi - 1,
          ],
          ['Native size at ' + L.settings.dpi + ' DPI', `${L.nativeMaxCm.w.toFixed(1)} × ${L.nativeMaxCm.h.toFixed(1)} cm`, true],
          ['Sheets to print', `${sheets}${L.emptyCells ? ` (+${L.emptyCells} blank, skipped)` : ''}`],
          ['Seams to join', `${seams}`],
          ['Poster area', `${posterM2.toFixed(2)} m²`],
          ['Paper used', `${paperM2.toFixed(2)} m²`, true],
          ['Output pixels', `${(L.totalTilePx / 1e6).toFixed(1)} MP total`, true],
        ]}
      />
      {L.notices.map((n, i) => (
        <NoticeCard key={`${n.title}-${i}`} notice={n} />
      ))}
    </Section>
  );
}

export function NoticeCard({ notice }: { notice: Notice }) {
  const ico = notice.level === 'error' ? '×' : notice.level === 'warn' ? '!' : 'i';
  return (
    <div className={`notice ${notice.level}`}>
      <span className="ico" aria-hidden>
        {ico}
      </span>
      <span>
        <b>{notice.title}</b>
        {notice.body}
      </span>
    </div>
  );
}

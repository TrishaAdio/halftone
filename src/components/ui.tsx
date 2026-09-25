import { useEffect, useRef, useState, type ReactNode } from 'react';

export function Section({
  title,
  tag,
  children,
  defaultOpen = true,
}: {
  title: string;
  tag?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`section${open ? '' : ' closed'}`}>
      <header onClick={() => setOpen((o) => !o)} role="button" aria-expanded={open}>
        <span className="chev" aria-hidden />
        {title}
        {tag != null && <span className="tag">{tag}</span>}
      </header>
      {open && <div className="body">{children}</div>}
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="field">
      {label != null && (
        <div className="field-label">
          {label}
          {hint != null && <span className="hint">{hint}</span>}
        </div>
      )}
      {children}
    </div>
  );
}

export function NumberInput({
  value,
  onChange,
  min = 0,
  max = 100000,
  step = 1,
  unit,
  readOnly,
  precision = 0,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  readOnly?: boolean;
  precision?: number;
  disabled?: boolean;
}) {
  const fixed = (v: number) => Number(v.toFixed(precision));
  // Keep a text buffer so typing "1." or clearing the box does not fight the
  // controlled value.
  const [text, setText] = useState(String(fixed(value)));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(String(Number(value.toFixed(precision))));
  }, [value, precision]);

  const commit = (raw: string) => {
    const n = Number.parseFloat(raw.replace(',', '.'));
    if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
    else setText(String(fixed(value)));
  };
  const bump = (dir: 1 | -1) => {
    const next = Math.min(max, Math.max(min, fixed(value + dir * step)));
    onChange(next);
    setText(String(next));
  };

  return (
    <div className={`num${readOnly ? ' readonly' : ''}`}>
      <input
        type="text"
        inputMode="decimal"
        value={text}
        readOnly={readOnly}
        disabled={disabled}
        onFocus={() => (focused.current = true)}
        onChange={(e) => {
          setText(e.target.value);
          if (/^-?\d*\.?\d*$/.test(e.target.value) && e.target.value !== '') commit(e.target.value);
        }}
        onBlur={(e) => {
          focused.current = false;
          commit(e.target.value);
          setText(String(fixed(value)));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            bump(1);
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            bump(-1);
          }
        }}
      />
      {unit && <span className="unit">{unit}</span>}
      {!readOnly && !disabled && (
        <>
          <button type="button" onClick={() => bump(-1)} disabled={value <= min} aria-label="Decrease">
            −
          </button>
          <button type="button" onClick={() => bump(1)} disabled={value >= max} aria-label="Increase">
            +
          </button>
        </>
      )}
    </div>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  accent,
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode; title?: string }>;
  onChange: (v: T) => void;
  accent?: boolean;
}) {
  return (
    <div className={`seg${accent ? ' accent' : ''}`}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          title={o.title}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Check({
  checked,
  onChange,
  children,
  compact,
  disabled,
  title,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
  compact?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <label className={`check${compact ? ' compact' : ''}`} title={title}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{children}</span>
    </label>
  );
}

export function Slider({
  value,
  onChange,
  min,
  max,
  step,
  format,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
}) {
  return (
    <div className="slider">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="val">{format(value)}</span>
    </div>
  );
}

export function KV({ rows }: { rows: Array<[ReactNode, ReactNode, boolean?]> }) {
  return (
    <dl className="kv">
      {rows.map(([k, v, dim], i) => (
        <div key={i} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd className={dim ? 'dim' : undefined}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

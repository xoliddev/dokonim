/**
 * Small seller controls: Toggle (switch), Segmented (sliding ink thumb), MoneyInput (so'm ↔ tiyin),
 * and useConfirm() — an in-app confirmation sheet (no blocking window.confirm in the demo).
 */
import { useCallback, useId, useRef, useState, type ReactNode } from 'react';
import { m } from 'motion/react';
import { useI18n } from '../../i18n';
import { spring } from '../../motion';
import { haptic } from '../../telegram/shim';
import { Button, Input, Sheet } from '../../ui';
import { parseSom, somText } from '../lib/ctx';

export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <label className={`sl-toggle-row${disabled ? ' is-disabled' : ''}`} htmlFor={id}>
      {(label || hint) && (
        <span className="sl-toggle-text">
          {label && <span className="sl-toggle-label">{label}</span>}
          {hint && <span className="sl-toggle-hint muted">{hint}</span>}
        </span>
      )}
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        className={`sl-switch${checked ? ' is-on' : ''}`}
        onClick={() => {
          haptic.selection();
          onChange(!checked);
        }}
      >
        <span className="sl-switch-knob" />
      </button>
    </label>
  );
}

export function Segmented<V extends string>({ value, options, onChange, size = 'md', label }: { value: V; options: Array<{ value: V; label: ReactNode; count?: number }>; onChange: (v: V) => void; size?: 'sm' | 'md'; label?: string }) {
  const group = useId();
  return (
    <div className={`sl-seg sl-seg-${size}`} role="tablist" aria-label={label}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            className={`sl-seg-btn${on ? ' is-on' : ''}`}
            onClick={() => {
              if (on) return;
              haptic.selection();
              onChange(o.value);
            }}
          >
            {on && <m.span className="sl-seg-thumb" layoutId={`seg-${group}`} transition={spring.snappy} />}
            <span className="sl-seg-label">{o.label}</span>
            {o.count != null && <span className="sl-seg-count">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Price field in so'm; reports integer tiyin (null = empty, NaN = invalid). */
export function MoneyInput({ label, value, onChange, error, hint, placeholder }: { label?: ReactNode; value: number | null; onChange: (minor: number | null) => void; error?: ReactNode; hint?: ReactNode; placeholder?: string }) {
  const [text, setText] = useState(() => somText(value));
  const last = useRef(value);
  if (value !== last.current && parseSom(text) !== value) {
    last.current = value;
    setText(somText(value));
  }
  return (
    <Input
      label={label}
      inputMode="decimal"
      value={text}
      placeholder={placeholder ?? '0'}
      suffix={<span className="sl-som">soʻm</span>}
      error={error}
      hint={hint}
      onChange={(e) => {
        const v = e.target.value;
        setText(v);
        const minor = parseSom(v);
        last.current = minor;
        onChange(minor);
      }}
      onBlur={() => {
        const minor = parseSom(text);
        if (minor != null && Number.isFinite(minor)) setText(somText(minor));
      }}
    />
  );
}

interface ConfirmOpts {
  title: ReactNode;
  body?: ReactNode;
  confirm?: string;
  danger?: boolean;
}

/** const [confirmUi, ask] = useConfirm();  if (await ask({ title, danger: true })) … ; render {confirmUi} */
export function useConfirm(): [ReactNode, (o: ConfirmOpts) => Promise<boolean>] {
  const { t } = useI18n();
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const ask = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const done = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  const ui = (
    <Sheet
      open={!!state}
      onClose={() => done(false)}
      title={state?.title}
      footer={
        <div className="sl-sheet-actions">
          <Button variant="secondary" onClick={() => done(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant={state?.danger ? 'danger' : 'primary'} onClick={() => done(true)}>
            {state?.confirm ?? t('common.confirm')}
          </Button>
        </div>
      }
    >
      {state?.body && <div className="sl-confirm-body">{state.body}</div>}
    </Sheet>
  );
  return [ui, ask];
}

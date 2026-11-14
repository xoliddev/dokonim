/**
 * Input / Textarea with label, hint and error (error is announced and wired via aria-describedby).
 *   <Input label={t('checkout.phone')} inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} error={err} />
 *   <Input multiline rows={4} label={t('seller.productDescription')} … />
 */
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';

interface Common {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Adornment before the control (named `leading` because `prefix` is an HTML attribute with a string type). */
  leading?: ReactNode;
  suffix?: ReactNode;
}

export type InputProps = Common & ((InputHTMLAttributes<HTMLInputElement> & { multiline?: false }) | (TextareaHTMLAttributes<HTMLTextAreaElement> & { multiline: true }));

export const Input = forwardRef<HTMLInputElement | HTMLTextAreaElement, InputProps>(function Input(props, ref) {
  const { label, hint, error, leading, suffix, className, id: idProp, multiline, ...rest } = props as Common & { className?: string; id?: string; multiline?: boolean } & Record<string, unknown>;
  const auto = useId();
  const id = idProp ?? auto;
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined;
  const field = multiline ? (
    <textarea ref={ref as never} id={id} className="field-control" aria-invalid={!!error || undefined} aria-describedby={describedBy} {...(rest as TextareaHTMLAttributes<HTMLTextAreaElement>)} />
  ) : (
    <input ref={ref as never} id={id} className="field-control" aria-invalid={!!error || undefined} aria-describedby={describedBy} {...(rest as InputHTMLAttributes<HTMLInputElement>)} />
  );
  return (
    <div className={`field${error ? ' has-error' : ''} ${className ?? ''}`}>
      {label && (
        <label className="field-label" htmlFor={id}>
          {label}
        </label>
      )}
      <div className="field-box">
        {leading && <span className="field-affix">{leading}</span>}
        {field}
        {suffix && <span className="field-affix">{suffix}</span>}
      </div>
      {error ? (
        <div className="field-error" id={`${id}-err`} role="alert">
          {error}
        </div>
      ) : hint ? (
        <div className="field-hint" id={`${id}-hint`}>
          {hint}
        </div>
      ) : null}
    </div>
  );
});

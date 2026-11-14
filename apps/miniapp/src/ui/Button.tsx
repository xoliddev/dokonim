/**
 * Button: primary (accent fill), secondary (raised + outline), ghost, danger. Press feedback is a 90 ms
 * transform; primary taps fire the `impactOccurred('light')` haptic (§13.8).
 *
 *   <Button onClick={save} loading={saving}>{t('common.save')}</Button>
 *   <Button variant="secondary" size="sm" icon={<Icon name="plus" />}>…</Button>
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { haptic } from '../telegram/shim';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  /** Skip the tap haptic (e.g. when the handler fires its own). */
  silent?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', block, loading, icon, silent, className, children, onClick, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`btn btn-${variant} btn-${size}${block ? ' btn-block' : ''}${loading ? ' is-loading' : ''} ${className ?? ''}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      onClick={(e) => {
        if (!silent) variant === 'danger' ? haptic.impact('rigid') : variant === 'primary' ? haptic.impact('light') : haptic.selection();
        onClick?.(e);
      }}
      {...rest}
    >
      {loading && <span className="btn-spinner" aria-hidden="true" />}
      {icon && <span className="btn-icon">{icon}</span>}
      {children && <span className="btn-label">{children}</span>}
    </button>
  );
});

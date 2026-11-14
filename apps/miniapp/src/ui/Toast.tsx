/**
 * Toasts: `toast.success(t('common.saved'))`, `toast.error(msg)`, `toast.show(msg, { action: { label, onClick } })`.
 * Rendered by <ToastHost/> (mounted once by the shell inside the phone viewport), announced politely,
 * auto-dismissed after 3.2 s; success/error toasts fire the matching notification haptic.
 */
import { AnimatePresence, m } from 'motion/react';
import { createStore, useStore } from '../lib/store';
import { spring } from '../motion/tokens';
import { haptic } from '../telegram/shim';

export type ToastKind = 'info' | 'success' | 'error';
export interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
  action?: { label: string; onClick: () => void };
}

const toasts = createStore<ToastItem[]>([]);
let seq = 0;

function show(message: string, opts: { kind?: ToastKind; action?: ToastItem['action']; ms?: number } = {}) {
  const item: ToastItem = { id: ++seq, message, kind: opts.kind ?? 'info', action: opts.action };
  if (item.kind !== 'info') haptic.notify(item.kind);
  toasts.set((xs) => [...xs.slice(-2), item]);
  setTimeout(() => dismiss(item.id), opts.ms ?? 3200);
  return item.id;
}

export function dismiss(id: number) {
  toasts.set((xs) => xs.filter((x) => x.id !== id));
}

export const toast = {
  show,
  success: (m: string) => show(m, { kind: 'success' }),
  error: (m: string) => show(m, { kind: 'error', ms: 4500 }),
  dismiss,
};

export function ToastHost() {
  const items = useStore(toasts);
  return (
    <div className="toast-host" role="status" aria-live="polite">
      <AnimatePresence initial={false}>
        {items.map((x) => (
          <m.div key={x.id} layout className={`toast toast-${x.kind}`} initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }} transition={spring.snappy}>
            <span className="toast-msg">{x.message}</span>
            {x.action && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  x.action!.onClick();
                  dismiss(x.id);
                }}
              >
                {x.action.label}
              </button>
            )}
          </m.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

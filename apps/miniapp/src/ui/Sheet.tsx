/**
 * Bottom sheet (§13.7): `spring.sheet`, velocity-aware drag-to-close, scrim, Esc to close, and it claims the
 * Telegram BackButton while open. Renders into the phone viewport's overlay layer (not the desktop page).
 *
 *   <Sheet open={open} onClose={() => setOpen(false)} title={t('store.filterPrice')}>…</Sheet>
 */
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, m, type PanInfo } from 'motion/react';
import { useMotionTier } from '../motion/tier';
import { dur, spring } from '../motion/tokens';
import { useBackButton } from '../telegram/shim';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  /** Sticky footer (actions). */
  footer?: ReactNode;
  /** Max height as a fraction of the viewport (default 0.9). */
  maxHeight?: number;
}

export const overlayRoot = () => (typeof document !== 'undefined' ? (document.getElementById('overlay-root') ?? document.body) : null);

export function Sheet(props: SheetProps) {
  const root = overlayRoot();
  if (!root) return null;
  return createPortal(<AnimatePresence>{props.open && <SheetBody key="sheet" {...props} />}</AnimatePresence>, root);
}

function SheetBody({ onClose, title, children, footer, maxHeight = 0.9 }: SheetProps) {
  const tier = useMotionTier();
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  useBackButton(onClose);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);

  const end = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 100 || info.velocity.y > 500) onClose();
  };
  const slide = tier !== 'minimal';

  return (
    <div className="sheet-layer">
      <m.div className="sheet-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: dur.sm }} onClick={onClose} />
      <m.div
        ref={panel}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        style={{ maxHeight: `${maxHeight * 100}%` }}
        initial={slide ? { y: '100%' } : { opacity: 0 }}
        animate={slide ? { y: 0 } : { opacity: 1 }}
        exit={slide ? { y: '100%' } : { opacity: 0 }}
        transition={slide ? spring.sheet : { duration: dur.sm }}
        drag={slide ? 'y' : false}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0.05, bottom: 1 }}
        onDragEnd={end}
      >
        <div className="sheet-grip" aria-hidden="true" />
        {title && (
          <h2 className="sheet-title" id={titleId}>
            {title}
          </h2>
        )}
        <div className="sheet-content" onPointerDownCapture={(e) => e.stopPropagation()}>
          {children}
        </div>
        {footer && <div className="sheet-footer">{footer}</div>}
      </m.div>
    </div>
  );
}

/**
 * Success moment — the receipt print (§13.7): the order card feeds out of a printer slot (translateY −100% → 0,
 * ease.decel 420 ms), then a round store-coloured stamp lands (scale 1.3 → 1, rotate −8°) with the success
 * haptic. No confetti. Minimal tier: the card simply fades in and the stamp appears.
 */
import { useEffect, type ReactNode } from 'react';
import { m } from 'motion/react';
import { useI18n } from '../../i18n';
import { ease, useMotionTier } from '../../motion';
import { haptic } from '../../telegram/shim';

export function Receipt({ paid, number, children }: { paid: boolean; number: number; children: ReactNode }) {
  const { t } = useI18n();
  const tier = useMotionTier();
  const still = tier === 'minimal';
  useEffect(() => {
    const id = setTimeout(() => haptic.notify('success'), still ? 0 : 640);
    return () => clearTimeout(id);
  }, [still]);
  return (
    <div className="st-receipt-wrap">
      <div className="st-printer" aria-hidden="true">
        <span />
      </div>
      <div className="st-receipt-slot">
        <m.div
          className="st-receipt"
          initial={still ? { opacity: 0 } : { y: '-100%' }}
          animate={still ? { opacity: 1 } : { y: 0 }}
          transition={{ duration: still ? 0.14 : 0.42, ease: ease.decel }}
        >
          <div className="st-receipt-head">
            <span className="display">{t('store.orderNumber', { number: String(number) })}</span>
            <span className="st-receipt-sub">{t('checkout.orderPlaced')}</span>
          </div>
          {children}
          <div className="st-receipt-zig" aria-hidden="true" />
          <m.div
            className={`st-stamp${paid ? ' is-paid' : ''}`}
            role="img"
            aria-label={paid ? t('checkout.stampPaid') : t('checkout.stampAccepted')}
            initial={still ? { opacity: 0 } : { opacity: 0, scale: 1.3, rotate: -20 }}
            animate={{ opacity: 1, scale: 1, rotate: -8 }}
            transition={still ? { duration: 0.14 } : { type: 'spring', stiffness: 520, damping: 22, delay: 0.5 }}
          >
            <span>{paid ? t('checkout.stampPaid') : t('checkout.stampAccepted')}</span>
          </m.div>
        </m.div>
      </div>
    </div>
  );
}

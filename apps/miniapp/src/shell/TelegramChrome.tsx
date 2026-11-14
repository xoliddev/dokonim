/**
 * Demo-only Telegram chrome: the faux header (BackButton / Close, title, ⋯) and the native-looking MainButton
 * bar, both driven by the same shim state screens set via useMainButton/useBackButton. Hidden inside real Telegram.
 */
import { AnimatePresence, m } from 'motion/react';
import { useI18n } from '../i18n';
import { spring } from '../motion/tokens';
import { useShim } from '../telegram/shim';
import { Icon } from '../ui';

export function TelegramHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const { t } = useI18n();
  const { back, haptic } = useShim();
  return (
    <div className="tg-header">
      <button type="button" className="tg-header-btn" onClick={() => back?.()} aria-label={back ? t('common.back') : t('common.close')}>
        <Icon name={back ? 'back' : 'close'} size={20} />
        <span>{back ? t('common.back') : t('common.close')}</span>
      </button>
      <div className="tg-header-title">
        <strong>{title}</strong>
        {subtitle && <span>{subtitle}</span>}
      </div>
      <span className="tg-header-menu" aria-hidden="true">
        <Icon name="more" size={20} />
        {haptic && <span key={haptic.at} className="tg-haptic-tick" title={haptic.kind} />}
      </span>
    </div>
  );
}

export function MainButtonBar() {
  const { main } = useShim();
  const visible = !!main && !main.hidden;
  return (
    <AnimatePresence initial={false}>
      {visible && (
        <m.div className="tg-bottom-bar" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={spring.sheet}>
          <button
            type="button"
            className={`tg-main-btn${main!.shine ? ' has-shine' : ''}`}
            style={{ background: main!.color ?? undefined, color: main!.textColor ?? undefined }}
            disabled={main!.disabled || main!.progress}
            onClick={() => main!.onClick()}
          >
            {main!.progress ? <span className="btn-spinner" aria-hidden="true" /> : main!.text}
          </button>
        </m.div>
      )}
    </AnimatePresence>
  );
}

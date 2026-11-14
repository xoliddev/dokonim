/** Wizard finale: §13 "stamp" celebration, the store link (Telegram deep link), QR, copy / share / download. */
import { useRef } from 'react';
import { m } from 'motion/react';
import { miniAppLink, type ThemeTokens } from '@dokonim/core';
import { IS_DEMO } from '../../../api';
import { useI18n } from '../../../i18n';
import { spring, useMotionTier } from '../../../motion';
import { navigate } from '../../../router/router';
import { haptic, useMainButton } from '../../../telegram/shim';
import { Button, toast } from '../../../ui';
import { downloadQrPng, QrCode } from '../../components/QrCode';
import { SIcon } from '../../components/SIcon';
import { StorefrontPreview } from '../../components/StorefrontPreview';

export function storeLink(slug: string) {
  return miniAppLink(IS_DEMO ? 'dokonim_demo_bot' : 'dokonim_bot', 'shop', { kind: 'store', slug });
}

export async function copyText(text: string, ok: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  haptic.notify('success');
  toast.success(ok);
}

export function Done({ slug, name, tokens, logoUrl, businessType }: { slug: string; name: string; tokens: Partial<ThemeTokens>; logoUrl: string | null; businessType: string }) {
  const { t } = useI18n();
  const tier = useMotionTier();
  const qr = useRef<HTMLDivElement>(null);
  const link = storeLink(slug);
  useMainButton({ text: t('seller.wzGoDashboard'), onClick: () => navigate(`/m/${slug}`, { replace: true }), shine: true });

  const share = async () => {
    const text = t('seller.wzShareText', { name });
    if (navigator.share) {
      try {
        await navigator.share({ title: name, text, url: link });
        return;
      } catch {
        /* cancelled → fall through to copy */
      }
    }
    await copyText(`${text}\n${link}`, t('common.copied'));
  };

  return (
    <div className="sl-screen wz">
      <div className="sl-body wz-done">
        <m.div
          className="wz-stamp"
          initial={tier === 'minimal' ? { opacity: 0 } : { opacity: 0, scale: 1.8, rotate: -14 }}
          animate={{ opacity: 1, scale: 1, rotate: -6 }}
          transition={spring.bouncy}
          onAnimationComplete={() => haptic.impact('rigid')}
        >
          <SIcon name="check" size={30} />
          <span>{slug}</span>
        </m.div>
        <h1 className="sl-title wz-done-title">{t('seller.wzDoneTitle')}</h1>
        <p className="muted wz-hint">{t('seller.wzDoneHint')}</p>
        <div className="wz-link">
          <SIcon name="link" size={18} />
          <span className="wz-link-text">{link.replace('https://', '')}</span>
          <button type="button" className="sl-icon-btn is-plain" aria-label={t('seller.copyLink')} onClick={() => void copyText(link, t('common.copied'))}>
            <SIcon name="copy" size={18} />
          </button>
        </div>
        <m.div className="wz-qr" ref={qr} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.sheet, delay: 0.25 }}>
          <QrCode text={link} size={176} label={link} />
        </m.div>
        <div className="wz-done-actions">
          <Button variant="secondary" icon={<SIcon name="share" size={18} />} onClick={() => void share()}>
            {t('common.share')}
          </Button>
          <Button variant="secondary" icon={<SIcon name="qr" size={18} />} onClick={() => void downloadQrPng(qr.current?.querySelector('svg') ?? null, `${slug}-qr.png`)}>
            {t('seller.wzDownloadQr')}
          </Button>
        </div>
        <Button variant="ghost" icon={<SIcon name="external" size={18} />} onClick={() => navigate(`/s/${slug}`)}>
          {t('seller.wzViewStore')}
        </Button>
        <div className="wz-done-preview">
          <StorefrontPreview tokens={tokens} name={name} logoUrl={logoUrl} businessType={businessType} />
        </div>
      </div>
    </div>
  );
}

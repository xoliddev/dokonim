/**
 * Live storefront preview: the owner's tokens are compiled with the same `core.compileTheme` the storefront uses
 * and written as inline custom properties on this subtree only. Every token change re-keys the "paper" layer,
 * which crossfades + settles in (a cheap theme morph that animates only opacity/transform).
 */
import { useMemo, type CSSProperties } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { compileTheme, DEFAULT_TOKENS, sanitizeTokens, type ThemeTokens } from '@dokonim/core';
import { useI18n } from '../../i18n';
import { dur, ease, useMotionTier } from '../../motion';
import { ART_FOR, artImage } from '../lib/art';
import './preview.css';

const SAMPLE: Record<string, Array<{ uz: string; ru: string; en: string; price: number; was?: number }>> = {
  clothing: [{ uz: 'Atlas koʻylak', ru: 'Платье из атласа', en: 'Atlas dress', price: 45000000, was: 52000000 }, { uz: 'Chopon', ru: 'Чапан', en: 'Chapan', price: 89000000 }],
  cosmetics: [{ uz: 'Namlovchi krem', ru: 'Увлажняющий крем', en: 'Moisturiser', price: 18900000, was: 21000000 }, { uz: 'Atir', ru: 'Парфюм', en: 'Perfume', price: 42000000 }],
  food: [{ uz: 'Koʻk choy', ru: 'Зелёный чай', en: 'Green tea', price: 3500000 }, { uz: 'Tandir non', ru: 'Лепёшка', en: 'Tandir bread', price: 600000, was: 800000 }],
  electronics: [{ uz: 'Smartfon', ru: 'Смартфон', en: 'Smartphone', price: 349900000, was: 389900000 }, { uz: 'Quloqchin', ru: 'Наушники', en: 'Headphones', price: 59900000 }],
  handmade: [{ uz: 'Sopol vaza', ru: 'Керамическая ваза', en: 'Ceramic vase', price: 27000000 }, { uz: 'Suzani yostiq', ru: 'Подушка сюзане', en: 'Suzani pillow', price: 31000000, was: 36000000 }],
  digital: [{ uz: 'Kurs', ru: 'Курс', en: 'Course', price: 19900000 }, { uz: 'Shablonlar', ru: 'Шаблоны', en: 'Templates', price: 9900000, was: 14900000 }],
};

export interface PreviewProps {
  tokens: Partial<ThemeTokens>;
  name: string;
  logoUrl?: string | null;
  businessType?: string;
  headline?: string;
  scheme?: 'light' | 'dark';
  className?: string;
}

export function StorefrontPreview({ tokens, name, logoUrl, businessType = 'clothing', headline, scheme = 'light', className }: PreviewProps) {
  const { t, money, locale } = useI18n();
  const tier = useMotionTier();
  const full = useMemo(() => sanitizeTokens({ ...DEFAULT_TOKENS, ...tokens }), [tokens]);
  const compiled = useMemo(() => compileTheme(full, { prefersDark: scheme === 'dark' }), [full, scheme]);
  const style = compiled.vars as CSSProperties;
  const key = JSON.stringify(full) + scheme;
  const kinds = ART_FOR[businessType] ?? ART_FOR.clothing!;
  const items = SAMPLE[businessType] ?? SAMPLE.clothing!;
  const brand = compiled.vars['--c-accent'] ?? full.brand;
  const initial = (name.trim()[0] ?? 'D').toUpperCase();

  return (
    <div className={`pv-frame ${className ?? ''}`} aria-label={t('seller.preview')} role="img">
      <AnimatePresence initial={false} mode="popLayout">
        <m.div
          key={key}
          className="pv-paper"
          data-scheme={compiled.scheme}
          data-card={full.cardStyle}
          data-motif={full.motif}
          data-density={full.density}
          style={style}
          initial={tier === 'minimal' ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: dur.lg, ease: ease.decel }}
        >
          <div className="pv-top">
            <span className="pv-logo">{logoUrl ? <img src={logoUrl} alt="" /> : initial}</span>
            <strong className="pv-name">{name || 'Doʻkonim'}</strong>
            <span className="pv-cart" aria-hidden="true" />
          </div>
          <div className="pv-hero">
            {full.motif !== 'none' && <span className={`pv-motif pv-motif-${full.motif}`} aria-hidden="true" />}
            <span className="pv-hero-text">{headline || name || 'Doʻkonim'}</span>
            <span className="pv-hero-btn">{t('seller.pvShop')}</span>
          </div>
          <div className="pv-chips">
            {[t('seller.pvNew'), t('seller.pvSale'), t('seller.pvAll')].map((c, i) => (
              <span key={c} className={`pv-chip${i === 0 ? ' is-on' : ''}`}>
                {c}
              </span>
            ))}
          </div>
          <div className="pv-grid">
            {items.map((p, i) => (
              <div key={i} className="pv-card">
                <img className="pv-img" src={artImage(kinds[i % kinds.length]!, i === 0 ? brand : undefined, i === 0 ? 'ikat' : 'suzani')} alt="" />
                <div className="pv-info">
                  <span className="pv-title">{p[locale] ?? p.uz}</span>
                  <span className="pv-price">
                    {money(p.price)}
                    {p.was && <s>{money(p.was)}</s>}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div className="pv-buy">{t('seller.pvBuy')}</div>
        </m.div>
      </AnimatePresence>
    </div>
  );
}

/**
 * Brand header: a sticky search row (logo · search pill · wishlist) and the hero — the store's own colours,
 * an ikat edge, its headline, and a fan of three bestseller covers that drifts with scroll (full tier only).
 */
import { useEffect, useRef } from 'react';
import { m } from 'motion/react';
import type { L10n } from '@dokonim/core';
import { useI18n } from '../../i18n';
import { spring, useMotionTier } from '../../motion';
import { navigate } from '../../router/router';
import { Button, Icon } from '../../ui';
import type { StoreInfo } from '../lib/types';

export function Monogram({ name, logoUrl, size = 36 }: { name: string; logoUrl?: string | null; size?: number }) {
  return logoUrl ? (
    <img className="st-mono" src={logoUrl} alt="" width={size} height={size} />
  ) : (
    <span className="st-mono" style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden="true">
      {name.trim().slice(0, 1).toUpperCase()}
    </span>
  );
}

export function SearchRow({ slug, store }: { slug: string; store: StoreInfo['store'] }) {
  const { t, l } = useI18n();
  return (
    <div className="st-searchrow">
      <Monogram name={l(store.name)} logoUrl={store.logoUrl} />
      <button type="button" className="st-search-pill" onClick={() => navigate(`/s/${slug}/search`)}>
        <Icon name="search" size={20} />
        <span>{t('store.searchIn', { store: l(store.name) })}</span>
      </button>
      <button type="button" className="st-icon-btn is-raised" aria-label={t('store.wishlist')} onClick={() => navigate(`/s/${slug}/wishlist`)}>
        <Icon name="heart" size={22} />
      </button>
    </div>
  );
}

interface HeroSettings {
  headline?: L10n;
  sub?: L10n;
  ctaLabel?: L10n;
  imageUrl?: string;
}

export function Hero({ slug, store, settings, covers }: { slug: string; store: StoreInfo['store']; settings: HeroSettings; covers: string[] }) {
  const { t, l } = useI18n();
  const tier = useMotionTier();
  const art = useRef<HTMLDivElement>(null);

  // scroll-linked drift of the cover fan: transform only, rAF-throttled, full tier only
  useEffect(() => {
    const el = art.current;
    const scroller = el?.closest('.screen-scroll');
    if (!el || !scroller || tier !== 'full') return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => el.style.setProperty('--drift', `${Math.min(scroller.scrollTop, 300) * 0.18}px`));
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      scroller.removeEventListener('scroll', onScroll);
    };
  }, [tier]);

  const name = l(store.name);
  const headline = l(settings.headline) || name;
  const sub = l(settings.sub) || l(store.tagline);
  const fan = covers.slice(0, 3);
  return (
    <section className="st-hero">
      <div className="st-hero-copy">
        <span className="st-hero-store">{name}</span>
        <h2 className="st-hero-title display">{headline}</h2>
        {sub && sub !== headline && sub !== name && <p className="st-hero-sub">{sub}</p>}
        <Button size="sm" className="st-hero-cta" onClick={() => navigate(`/s/${slug}/catalog`)} icon={<Icon name="chevron-right" size={18} />}>
          {l(settings.ctaLabel) || t('store.shopNow')}
        </Button>
      </div>
      <div className="st-hero-art" ref={art} aria-hidden="true">
        {fan.map((src, i) => (
          <m.img
            key={src.slice(-24) + i}
            src={src}
            alt=""
            className={`st-hero-fan is-${i}`}
            initial={tier === 'minimal' ? false : { opacity: 0, y: 30, rotate: 0 }}
            animate={{ opacity: 1, y: 0, rotate: [-9, 2, 11][i] }}
            transition={{ ...spring.bouncy, delay: 0.08 + i * 0.07 }}
          />
        ))}
      </div>
      <div className="st-hero-edge ikat-band" aria-hidden="true" />
    </section>
  );
}

export function TrustRow() {
  const { t } = useI18n();
  return (
    <ul className="st-trust">
      <li>
        <Icon name="truck" size={18} />
        {t('store.trustDelivery')}
      </li>
      <li>
        <Icon name="refresh" size={18} />
        {t('store.trustReturns')}
      </li>
      <li>
        <Icon name="check" size={18} />
        {t('store.trustPay')}
      </li>
    </ul>
  );
}

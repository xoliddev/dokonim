/**
 * Storefront chrome: <StoreScreen> wraps a buyer screen with an optional sticky top bar and the bottom tab bar
 * (Home · Catalog · Cart · Profile, §6.2). The cart tab is The Arc's landing target and rolls its badge.
 */
import type { ReactNode } from 'react';
import { useI18n } from '../lib/i18n';
import { Odometer, useCartTarget } from '../../motion';
import { navigate } from '../../router/router';
import { haptic } from '../../telegram/shim';
import { Icon, type IconName } from '../../ui';
import { useCart } from '../lib/data';
import '../styles/base.css';
import '../styles/card.css';

export type Tab = 'home' | 'catalog' | 'cart' | 'profile';

export function TabBar({ slug, active }: { slug: string; active: Tab | null }) {
  const { t } = useI18n();
  const cart = useCart(slug);
  const target = useCartTarget();
  const count = cart.data?.count ?? 0;
  const tabs: Array<{ id: Tab; icon: IconName; label: string; to: string }> = [
    { id: 'home', icon: 'home', label: t('store.home'), to: `/s/${slug}` },
    { id: 'catalog', icon: 'grid', label: t('store.catalog'), to: `/s/${slug}/catalog` },
    { id: 'cart', icon: 'cart', label: t('store.cart'), to: `/s/${slug}/cart` },
    { id: 'profile', icon: 'user', label: t('store.profile'), to: `/s/${slug}/profile` },
  ];
  return (
    <nav className="st-tabs" aria-label={t('store.catalog')}>
      {tabs.map((tab) => {
        const on = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            className={`st-tab${on ? ' is-active' : ''}`}
            aria-current={on ? 'page' : undefined}
            onClick={() => {
              haptic.selection();
              if (!on) navigate(tab.to);
            }}
          >
            <span className="st-tab-icon" ref={tab.id === 'cart' ? target : undefined}>
              {on && <span className="st-tab-ind" />}
              <Icon name={tab.icon} filled={on} size={22} />
              {tab.id === 'cart' && count > 0 && (
                <span className="st-tab-badge">
                  <Odometer value={count > 99 ? '99+' : count} label={t('store.cartItems', { n: count })} />
                </span>
              )}
            </span>
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}

export function TopBar({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="st-top">
      <h1 className="st-top-title">
        {title}
        {sub && <span className="st-top-sub">{sub}</span>}
      </h1>
      {actions}
    </header>
  );
}

/** Search + cart shortcuts for top bars. */
export function TopActions({ slug, search = true, cart = false }: { slug: string; search?: boolean; cart?: boolean }) {
  const { t } = useI18n();
  const c = useCart(slug);
  const target = useCartTarget();
  const n = c.data?.count ?? 0;
  return (
    <>
      {search && (
        <button type="button" className="st-icon-btn" aria-label={t('common.search')} onClick={() => navigate(`/s/${slug}/search`)}>
          <Icon name="search" />
        </button>
      )}
      {cart && (
        <button type="button" className="st-icon-btn" aria-label={t('store.cart')} onClick={() => navigate(`/s/${slug}/cart`)}>
          <span ref={target} style={{ display: 'grid' }}>
            <Icon name="cart" />
          </span>
          {n > 0 && (
            <span className="st-dot">
              <Odometer value={n > 99 ? '99+' : n} />
            </span>
          )}
        </button>
      )}
    </>
  );
}

export function StoreScreen({ slug, tab, top, children, flush, tight }: { slug: string; tab?: Tab | null; top?: ReactNode; children: ReactNode; flush?: boolean; tight?: boolean }) {
  return (
    <div className="st-page">
      {top}
      <div className={`st-body${flush ? ' is-flush' : ''}${tight ? ' is-tight' : ''}`}>{children}</div>
      {tab !== undefined && <TabBar slug={slug} active={tab} />}
    </div>
  );
}

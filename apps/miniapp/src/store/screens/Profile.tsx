/** Profile (§6.2 #10): greeting, orders, favourites, language, order notifications, other stores. */
import { useState } from 'react';
import type { Locale } from '@dokonim/core';
import { useApi, useQuery } from '../../api';
import { setLocale } from '../../i18n';
import { useI18n } from '../lib/i18n';
import { navigate, type RouteProps } from '../../router/router';
import { useCurrentStore } from '../../shell/session';
import { haptic } from '../../telegram/shim';
import { Icon, Skeleton, toast } from '../../ui';
import { StoreScreen, TopBar } from '../components/Chrome';
import { Monogram } from '../home/Hero';
import '../styles/home.css';
import '../styles/orders.css';

const LOCALES: Locale[] = ['uz', 'ru', 'en'];

export default function Profile({ params }: RouteProps) {
  const slug = params.slug!;
  const { t, l, locale } = useI18n();
  const { api } = useApi();
  const store = useCurrentStore();
  const me = useQuery('me.get', {}, { staleMs: 60_000 });
  const orders = useQuery('orders.mine', { slug }, { staleMs: 10_000 });
  const user = me.data?.user as { firstName?: string; notify?: { orders?: boolean } } | undefined;
  const [notify, setNotify] = useState<boolean | null>(null);
  const on = notify ?? user?.notify?.orders !== false;

  const pickLocale = (lc: Locale) => {
    haptic.selection();
    setLocale(lc);
    api['me.update']({ languageCode: lc }).catch(() => {});
  };
  const toggleNotify = async () => {
    haptic.selection();
    setNotify(!on);
    try {
      await api['me.update']({ notify: { orders: !on } });
    } catch {
      setNotify(on);
      toast.error(t('common.errorGeneric'));
    }
  };
  const count = Array.isArray(orders.data) ? orders.data.length : 0;

  return (
    <StoreScreen slug={slug} tab="profile" top={<TopBar title={t('store.profile')} />}>
      <section className="st-hello">
        {me.data ? (
          <>
            <span className="st-hello-avatar" aria-hidden="true">
              {(user?.firstName ?? '?').slice(0, 1)}
            </span>
            <span>
              <b className="display">{t('store.hello', { name: user?.firstName ?? '' })}</b>
              {store.data && (
                <span className="st-hello-store">
                  <Monogram name={l(store.data.store.name)} logoUrl={store.data.store.logoUrl} size={20} /> {l(store.data.store.name)}
                </span>
              )}
            </span>
          </>
        ) : (
          <Skeleton h={56} radius="var(--r-card)" />
        )}
      </section>
      <nav className="st-card st-menu" style={{ padding: 0 }}>
        <button type="button" className="st-link-row" onClick={() => navigate(`/s/${slug}/orders`)}>
          <Icon name="receipt" /> {t('store.myOrders')}
          {count > 0 && <span className="st-menu-n">{count}</span>}
          <Icon name="chevron-right" size={18} />
        </button>
        <button type="button" className="st-link-row" onClick={() => navigate(`/s/${slug}/wishlist`)}>
          <Icon name="heart" /> {t('store.wishlist')}
          <Icon name="chevron-right" size={18} />
        </button>
        <button type="button" className="st-link-row" onClick={() => navigate(`/s/${slug}/cart`)}>
          <Icon name="cart" /> {t('store.cart')}
          <Icon name="chevron-right" size={18} />
        </button>
      </nav>
      <section className="st-card st-stack">
        <h2 className="st-card-title">
          <Icon name="globe" size={20} /> {t('common.language')}
        </h2>
        <div className="st-seg" role="radiogroup" aria-label={t('common.language')}>
          {LOCALES.map((lc) => (
            <button key={lc} type="button" role="radio" aria-checked={locale === lc} className={locale === lc ? 'is-on' : ''} onClick={() => pickLocale(lc)}>
              {t(`common.lang_${lc}`)}
            </button>
          ))}
        </div>
      </section>
      <section className="st-card">
        <label className="st-switch-row">
          <span>
            <b>{t('store.notifications')}</b>
            <span className="muted">{t('store.orderUpdates')}</span>
          </span>
          <button type="button" role="switch" aria-checked={on} className={`st-switch${on ? ' is-on' : ''}`} onClick={toggleNotify}>
            <span />
          </button>
        </label>
      </section>
      <nav className="st-card" style={{ padding: 0 }}>
        <button type="button" className="st-link-row" onClick={() => navigate('/')}>
          <Icon name="store" /> {t('store.otherStores')}
          <Icon name="chevron-right" size={18} />
        </button>
      </nav>
      {store.data?.store.showBadge !== false && <p className="st-end">{t('store.poweredBy')}</p>}
    </StoreScreen>
  );
}

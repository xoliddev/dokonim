/** "More" tab: catalogue, sales and store sections, plus store switching / creating another store. */
import type { MessageKey } from '@dokonim/i18n';
import { useI18n } from '../../i18n';
import type { RouteProps } from '../../router/router';
import { Link, navigate } from '../../router/router';
import { Section, SellerScreen } from '../components/Layout';
import { SIcon } from '../components/SIcon';
import { useSeller } from '../lib/ctx';

const GROUPS: Array<{ title: MessageKey; rows: Array<{ to: string; icon: string; label: MessageKey; hint: MessageKey }> }> = [
  {
    title: 'seller.moreCatalog',
    rows: [
      { to: 'categories', icon: 'layers', label: 'seller.categories', hint: 'seller.hint_categories' },
      { to: 'collections', icon: 'grid', label: 'seller.collections', hint: 'seller.hint_collections' },
    ],
  },
  { title: 'seller.moreSales', rows: [{ to: 'promos', icon: 'percent', label: 'seller.promos', hint: 'seller.hint_promos' }] },
  {
    title: 'seller.moreStore',
    rows: [
      { to: 'settings/theme', icon: 'palette', label: 'seller.theme', hint: 'seller.hint_theme' },
      { to: 'settings/payments', icon: 'wallet', label: 'seller.payments', hint: 'seller.hint_payments' },
      { to: 'settings/shipping', icon: 'truck', label: 'seller.shipping', hint: 'seller.hint_shipping' },
      { to: 'settings/store', icon: 'store', label: 'seller.storeInfo', hint: 'seller.hint_store' },
      { to: 'settings/staff', icon: 'users', label: 'seller.staff', hint: 'seller.hint_staff' },
    ],
  },
];

export default function More(_: RouteProps) {
  const { t, l } = useI18n();
  const s = useSeller();
  return (
    <SellerScreen tab="more" kicker={s.store ? `@${s.store.slug}` : undefined} title={s.store ? l(s.store.name) : t('seller.tabMore')}>
      {GROUPS.map((g) => (
        <Section key={g.title} title={t(g.title)}>
          <div className="sl-list">
            {g.rows.map((r) => (
              <Link key={r.to} className="sl-row" to={`/m/${s.slug}/${r.to}`}>
                <span className="sl-row-icon"><SIcon name={r.icon} size={20} /></span>
                <span className="sl-row-main">
                  <span className="sl-row-title">{t(r.label)}</span>
                  <span className="sl-row-sub">{t(r.hint)}</span>
                </span>
                <SIcon name="chevron-right" size={18} className="pl-chev" />
              </Link>
            ))}
          </div>
        </Section>
      ))}
      <div className="sl-list">
        <button type="button" className="sl-row" onClick={() => navigate(`/s/${s.slug}`)}>
          <span className="sl-row-icon"><SIcon name="external" size={20} /></span>
          <span className="sl-row-main"><span className="sl-row-title">{t('seller.openStore')}</span></span>
        </button>
        <button type="button" className="sl-row" onClick={() => navigate(`/m/${s.slug}/create-store`)}>
          <span className="sl-row-icon"><SIcon name="plus" size={20} /></span>
          <span className="sl-row-main"><span className="sl-row-title">{t('seller.newStore')}</span></span>
        </button>
        <button type="button" className="sl-row" onClick={() => navigate('/')}>
          <span className="sl-row-icon"><SIcon name="store" size={20} /></span>
          <span className="sl-row-main"><span className="sl-row-title">{t('seller.allStores')}</span></span>
        </button>
      </div>
    </SellerScreen>
  );
}

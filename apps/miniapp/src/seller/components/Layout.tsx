/**
 * Seller chrome: a big display header with an ikat rule, and the bottom tab bar (§6.3: Home · Orders ·
 * Products · More). The active tab's ink pill glides between tabs (shared layoutId), so switching sections
 * feels like one surface, not four pages.
 */
import type { ReactNode } from 'react';
import { m } from 'motion/react';
import { useI18n } from '../../i18n';
import { spring } from '../../motion';
import { navigate, useLocation } from '../../router/router';
import { haptic } from '../../telegram/shim';
import { SIcon } from './SIcon';
import '../seller.css';

export type TabId = 'home' | 'orders' | 'products' | 'more';

export function SellerScreen({ tab, title, kicker, actions, children, wide }: { tab?: TabId; title?: ReactNode; kicker?: ReactNode; actions?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`sl-screen${tab ? ' has-tabs' : ''}`}>
      <div className={`sl-body${wide ? ' is-wide' : ''}`}>
        {(title || actions) && (
          <header className="sl-head">
            <div className="sl-head-text">
              {kicker && <div className="sl-kicker">{kicker}</div>}
              {title && <h1 className="sl-title">{title}</h1>}
            </div>
            {actions && <div className="sl-head-actions">{actions}</div>}
          </header>
        )}
        {children}
      </div>
      {tab && <TabBar active={tab} />}
    </div>
  );
}

export function TabBar({ active, badge }: { active: TabId; badge?: number }) {
  const { t } = useI18n();
  const { path } = useLocation();
  const slug = /^\/m\/([^/]+)/.exec(path)?.[1] ?? '';
  const tabs: Array<{ id: TabId; icon: string; label: string; to: string }> = [
    { id: 'home', icon: 'home', label: t('seller.tabHome'), to: `/m/${slug}` },
    { id: 'orders', icon: 'receipt', label: t('seller.orders'), to: `/m/${slug}/orders` },
    { id: 'products', icon: 'box', label: t('seller.products'), to: `/m/${slug}/products` },
    { id: 'more', icon: 'grid', label: t('seller.tabMore'), to: `/m/${slug}/more` },
  ];
  return (
    <nav className="sl-tabs" aria-label={t('seller.dashboard')}>
      {tabs.map((x) => {
        const on = x.id === active;
        return (
          <button
            key={x.id}
            type="button"
            className={`sl-tab${on ? ' is-on' : ''}`}
            aria-current={on ? 'page' : undefined}
            onClick={() => {
              if (on) return;
              haptic.selection();
              navigate(x.to, { replace: true });
            }}
          >
            {on && <m.span className="sl-tab-ink" layoutId="sl-tab-ink" transition={spring.snappy} />}
            <span className="sl-tab-icon">
              <SIcon name={x.icon} size={22} />
              {x.id === 'orders' && !!badge && <span className="sl-tab-badge">{badge > 99 ? '99+' : badge}</span>}
            </span>
            <span className="sl-tab-label">{x.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

/** Section heading inside a screen. */
export function Section({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`sl-section ${className ?? ''}`}>
      {(title || action) && (
        <div className="sl-section-head">
          {title && <h2 className="sl-section-title">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

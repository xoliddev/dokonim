/** PDP blocks: rich-text description, specs, delivery promise, price header. */
import { fromMarkup, sanitizeRichText, type L10n, type RichText as RichDoc, type TextNode } from '@dokonim/core';
import type { ReactNode } from 'react';
import { useI18n } from '../../i18n';
import { Icon, type IconName } from '../../ui';
import type { ShippingOpt } from '../lib/types';

function Inline({ nodes }: { nodes: TextNode[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        let el: ReactNode = n.text;
        if (n.marks?.includes('b')) el = <b>{el}</b>;
        if (n.marks?.includes('i')) el = <i>{el}</i>;
        if (n.href)
          el = (
            <a href={n.href} target="_blank" rel="noopener noreferrer">
              {el}
            </a>
          );
        return <span key={i}>{el}</span>;
      })}
    </>
  );
}

/** Picks the buyer's locale from a per-locale rich-text map (descriptions are stored as AST per locale). */
export function pickDoc(v: unknown, locale: string): RichDoc | string | null {
  if (!v || typeof v !== 'object') return typeof v === 'string' ? v : null;
  const m = v as Record<string, unknown>;
  if ((m as { t?: string }).t === 'doc') return m as unknown as RichDoc;
  const hit = m[locale] ?? m.uz ?? m.ru ?? m.en ?? Object.values(m)[0];
  return (hit as RichDoc | string | undefined) ?? null;
}

export const isEmptyDoc = (d: RichDoc | string | null) => !d || (typeof d === 'string' ? !d.trim() : !d.blocks?.length);

/** Owner content → safe AST → React (never innerHTML). Accepts markup or an already-parsed document. */
export function RichText({ source }: { source: string | RichDoc }) {
  const doc = typeof source === 'string' ? fromMarkup(source) : sanitizeRichText(source);
  return (
    <div className="st-rich">
      {doc.blocks.map((b, i) =>
        b.t === 'p' ? (
          <p key={i}>
            <Inline nodes={b.children} />
          </p>
        ) : b.t === 'h' ? (
          <h3 key={i}>
            <Inline nodes={b.children} />
          </h3>
        ) : b.t === 'ul' ? (
          <ul key={i}>
            {b.items.map((it, k) => (
              <li key={k}>
                <Inline nodes={it} />
              </li>
            ))}
          </ul>
        ) : (
          <ol key={i}>
            {b.items.map((it, k) => (
              <li key={k}>
                <Inline nodes={it} />
              </li>
            ))}
          </ol>
        ),
      )}
    </div>
  );
}

export function Specs({ rows, extra }: { rows: Array<{ name: L10n; value: L10n }>; extra: Array<[string, string]> }) {
  const { l } = useI18n();
  const all: Array<[string, string]> = [...extra.filter(([, v]) => !!v), ...rows.map((r) => [l(r.name), l(r.value)] as [string, string])];
  if (!all.length) return null;
  return (
    <dl className="st-specs">
      {all.map(([k, v], i) => (
        <div key={i} className="st-kv">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const METHOD_ICON: Record<string, IconName> = { courier: 'truck', post: 'box', pickup_point: 'store', self_pickup: 'store' };

/** Baymard: show a concrete date, not a speed (§2.4). */
export function DeliveryCard({ options, isDigital }: { options: ShippingOpt[]; isDigital: boolean }) {
  const { t, l, money, relativeDay } = useI18n();
  return (
    <section className="st-card st-delivery">
      <h3 className="st-card-title">
        <Icon name="truck" size={20} /> {t('store.delivery')}
      </h3>
      {isDigital ? (
        <p className="muted" style={{ margin: 0 }}>{t('store.digitalInstant')}</p>
      ) : (
        <ul>
          {options.map((o) => {
            const from = relativeDay(o.promise.from);
            const to = relativeDay(o.promise.to);
            const pickup = o.type === 'pickup_point' || o.type === 'self_pickup';
            return (
              <li key={o.methodId}>
                <Icon name={METHOD_ICON[o.type] ?? 'truck'} size={18} />
                <span className="st-delivery-main">
                  <b>{pickup ? t('store.pickupFrom', { date: from }) : t('store.deliveryBy', { date: from === to ? from : t('checkout.deliveryRange', { from, to }) })}</b>
                  <span className="muted">
                    {l(o.name)}
                    {o.freeOver && o.amount > 0 ? ` · ${t('checkout.freeOver', { amount: money(o.freeOver) })}` : ''}
                  </span>
                </span>
                <span className={`st-delivery-price${o.amount === 0 ? ' is-free' : ''}`}>{o.amount === 0 ? t('store.freeDelivery') : money(o.amount)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

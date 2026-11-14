/**
 * Variant matrix — "The Split" applied to the editor: when options change, the formula (3 × 2 = 6) rolls on an
 * Odometer and the rows fan out from the header with a 30 ms stagger. Sticky first column, per-variant
 * price / old price / stock / SKU, row selection with a bulk-edit bar, auto SKUs, remove a combination.
 */
import { useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { useI18n } from '../../../i18n';
import { Odometer, spring, useMotionTier } from '../../../motion';
import { haptic } from '../../../telegram/shim';
import { Button } from '../../../ui';
import { SIcon } from '../../components/SIcon';
import { parseSom, somText } from '../../lib/ctx';
import { activeOptions, applyBulk, autoSku, type OptionDraft, type VariantDraft } from '../../lib/product';

function MoneyCell({ value, onChange, invalid, label }: { value: number | null; onChange: (v: number | null) => void; invalid?: boolean; label: string }) {
  const [text, setText] = useState(somText(value));
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    if (parseSom(text) !== value) setText(somText(value));
  }
  return (
    <input
      className={`vm-in vm-money${invalid ? ' is-bad' : ''}`}
      inputMode="decimal"
      aria-label={label}
      aria-invalid={invalid || undefined}
      value={text}
      placeholder="0"
      onChange={(e) => {
        setText(e.target.value);
        const v = parseSom(e.target.value);
        setSeen(v);
        onChange(v);
      }}
      onBlur={() => setText(somText(parseSom(text)))}
    />
  );
}

export function VariantMatrix({ options, variants, onChange, bad, skuPrefix }: { options: OptionDraft[]; variants: VariantDraft[]; onChange: (v: VariantDraft[]) => void; bad?: Record<string, string>; skuPrefix: string }) {
  const { t } = useI18n();
  const tier = useMotionTier();
  const opts = activeOptions(options);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<{ price: number | null; compare: number | null; stock: string }>({ price: null, compare: null, stock: '' });
  const formula = opts.map((o) => o.values.length).join(' × ');
  const key = opts.map((o) => o.values.map((v) => v.id).join(',')).join('|');
  const patch = (id: string, p: Partial<VariantDraft>) => onChange(variants.map((v) => (v.id === id ? { ...v, ...p } : v)));
  const allOn = sel.size > 0 && sel.size === variants.length;

  if (opts.length === 0) return null;
  return (
    <div className="vm">
      <div className="vm-formula" aria-live="polite">
        <span className="vm-formula-f">{formula} =</span>
        <Odometer className="vm-formula-n" value={variants.length} />
        <span className="muted">{t('seller.variantsCount', { n: variants.length }).replace(/^\d+\s*/, '')}</span>
      </div>
      <div className="vm-tools">
        <button type="button" className="sl-link" onClick={() => setSel(allOn ? new Set() : new Set(variants.map((v) => v.id)))}>{t('seller.matrixSelectAll')}</button>
        <button type="button" className="sl-link" onClick={() => { haptic.selection(); onChange(autoSku(skuPrefix, options, variants)); }}>
          <SIcon name="sparkle" size={14} /> {t('seller.matrixAutoSku')}
        </button>
      </div>
      {variants.length === 0 ? (
        <p className="sl-hint">{t('seller.matrixEmpty')}</p>
      ) : (
        <div className="vm-scroll">
          <table className="vm-table">
            <thead>
              <tr>
                <th className="vm-sticky">{opts.map((o) => o.name).join(' / ')}</th>
                <th>{t('seller.price')}</th>
                <th>{t('seller.compareAtPrice')}</th>
                <th>{t('seller.stock')}</th>
                <th>{t('seller.sku')}</th>
                <th aria-label={t('seller.matrixRemove')} />
              </tr>
            </thead>
            <tbody key={key}>
              <AnimatePresence initial={false}>
                {variants.map((v, i) => {
                  const on = sel.has(v.id);
                  const err = bad?.[v.id];
                  return (
                    <m.tr
                      key={v.id}
                      className={on ? 'is-sel' : undefined}
                      initial={tier === 'minimal' ? false : { opacity: 0, y: -14, scaleY: 0.6 }}
                      animate={{ opacity: 1, y: 0, scaleY: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ ...spring.snappy, delay: Math.min(i, 12) * 0.03 }}
                      style={{ transformOrigin: 'top' }}
                    >
                      <th className="vm-sticky" scope="row">
                        <label className="vm-label">
                          <input type="checkbox" checked={on} onChange={() => { haptic.selection(); setSel((x) => { const n = new Set(x); if (n.has(v.id)) n.delete(v.id); else n.add(v.id); return n; }); }} />
                          {v.optionValueIds.map((id, k) => {
                            const val = opts[k]?.values.find((x) => x.id === id);
                            return val ? (
                              <span key={id} className="vm-val">
                                {opts[k]!.display === 'swatch' && <span className="vm-sw" style={{ background: val.swatchHex ?? '#ccc' }} />}
                                {val.label}
                              </span>
                            ) : null;
                          })}
                        </label>
                      </th>
                      <td><MoneyCell label={t('seller.price')} value={v.price} invalid={err === 'price'} onChange={(x) => patch(v.id, { price: x })} /></td>
                      <td><MoneyCell label={t('seller.compareAtPrice')} value={v.compareAtPrice} invalid={err === 'compare'} onChange={(x) => patch(v.id, { compareAtPrice: x })} /></td>
                      <td><input className={`vm-in vm-stock${err === 'stock' ? ' is-bad' : ''}`} inputMode="numeric" aria-label={t('seller.stock')} value={String(v.stock)} onChange={(e) => patch(v.id, { stock: e.target.value === '' ? 0 : Number(e.target.value.replace(/\D/g, '')) })} /></td>
                      <td><input className="vm-in vm-sku" aria-label={t('seller.sku')} value={v.sku} maxLength={64} onChange={(e) => patch(v.id, { sku: e.target.value })} /></td>
                      <td>
                        <button type="button" className="vm-del" aria-label={t('seller.matrixRemove')} disabled={variants.length <= 1} onClick={() => onChange(variants.filter((x) => x.id !== v.id))}>
                          <SIcon name="close" size={14} />
                        </button>
                      </td>
                    </m.tr>
                  );
                })}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      )}
      <AnimatePresence>
        {sel.size > 0 && (
          <m.div className="vm-bulk" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} transition={spring.sheet}>
            <span className="vm-bulk-title">{t('seller.matrixBulk')}</span>
            <div className="vm-bulk-fields">
              <MoneyCell label={t('seller.price')} value={bulk.price} onChange={(x) => setBulk((b) => ({ ...b, price: x }))} />
              <MoneyCell label={t('seller.compareAtPrice')} value={bulk.compare} onChange={(x) => setBulk((b) => ({ ...b, compare: x }))} />
              <input className="vm-in vm-stock" inputMode="numeric" placeholder={t('seller.stock')} aria-label={t('seller.stock')} value={bulk.stock} onChange={(e) => setBulk((b) => ({ ...b, stock: e.target.value.replace(/\D/g, '') }))} />
            </div>
            <Button
              size="sm"
              onClick={() => {
                onChange(applyBulk(variants, sel, { ...(bulk.price != null && Number.isFinite(bulk.price) ? { price: bulk.price } : {}), ...(bulk.compare != null && Number.isFinite(bulk.compare) ? { compareAtPrice: bulk.compare } : {}), ...(bulk.stock ? { stock: Number(bulk.stock) } : {}) }));
                haptic.notify('success');
                setSel(new Set());
                setBulk({ price: null, compare: null, stock: '' });
              }}
            >
              {t('seller.matrixApply', { n: sel.size })}
            </Button>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}

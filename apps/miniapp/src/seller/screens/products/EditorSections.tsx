/** Product editor sections: basics (names, description), single-variant pricing, organisation, more. */
import { useState } from 'react';
import { useQuery } from '../../../api/provider';
import { useI18n } from '../../../i18n';
import { Chip, Input } from '../../../ui';
import { CategoryPicker } from '../../components/CategoryPicker';
import { MoneyInput, Toggle } from '../../components/Controls';
import { SIcon } from '../../components/SIcon';
import type { ProductDraft, VariantDraft } from '../../lib/product';
import { pathTo, type CatNode } from '../../lib/tree';

type Set = (fn: (d: ProductDraft) => ProductDraft) => void;

export function Basics({ d, set, titleErr }: { d: ProductDraft; set: Set; titleErr?: string }) {
  const { t } = useI18n();
  const [more, setMore] = useState(!!(d.title.ru || d.title.en));
  const title = (k: 'uz' | 'ru' | 'en', v: string) => set((x) => ({ ...x, title: { ...x.title, [k]: v } }));
  const desc = (k: 'uz' | 'ru' | 'en', v: string) => set((x) => ({ ...x, description: { ...x.description, [k]: v } }));
  return (
    <div className="sl-form">
      <Input label={t('seller.titleUz')} value={d.title.uz} maxLength={200} error={titleErr} onChange={(e) => title('uz', e.target.value)} />
      <Input multiline rows={4} label={t('seller.productDescription')} hint={t('seller.descHint')} value={d.description.uz} maxLength={20000} onChange={(e) => desc('uz', e.target.value)} />
      {more ? (
        <>
          <Input label={t('seller.titleRu')} value={d.title.ru} maxLength={200} onChange={(e) => title('ru', e.target.value)} />
          <Input multiline rows={3} label={`${t('seller.productDescription')} (RU)`} value={d.description.ru} onChange={(e) => desc('ru', e.target.value)} />
          <Input label={t('seller.titleEn')} value={d.title.en} maxLength={200} onChange={(e) => title('en', e.target.value)} />
          <Input multiline rows={3} label={`${t('seller.productDescription')} (EN)`} value={d.description.en} onChange={(e) => desc('en', e.target.value)} />
        </>
      ) : (
        <button type="button" className="cf-more" onClick={() => setMore(true)}>
          <SIcon name="globe" size={16} /> {t('seller.catsTranslations')} (RU, EN)
        </button>
      )}
    </div>
  );
}

export function SinglePricing({ v, onChange, err }: { v: VariantDraft; onChange: (p: Partial<VariantDraft>) => void; err?: string }) {
  const { t } = useI18n();
  const margin = v.price && v.costPrice && v.price > 0 ? Math.round(((v.price - v.costPrice) / v.price) * 100) : null;
  return (
    <div className="sl-form">
      <div className="pe-2col">
        <MoneyInput label={t('seller.price')} value={v.price} error={err === 'price' ? t('seller.e_price') : undefined} onChange={(x) => onChange({ price: x })} />
        <MoneyInput label={t('seller.compareAtPrice')} value={v.compareAtPrice} error={err === 'compare' ? t('seller.e_compare') : undefined} onChange={(x) => onChange({ compareAtPrice: x })} />
      </div>
      <div className="pe-2col">
        <MoneyInput label={t('seller.costPrice')} value={v.costPrice} hint={margin != null ? t('seller.margin', { p: margin }) : t('seller.costHint')} onChange={(x) => onChange({ costPrice: x })} />
        <Input label={t('seller.stock')} inputMode="numeric" value={String(v.stock)} error={err === 'stock' ? t('seller.e_stock') : undefined} onChange={(e) => onChange({ stock: Number(e.target.value.replace(/\D/g, '') || 0) })} />
      </div>
      <Input label={t('seller.sku')} value={v.sku} maxLength={64} onChange={(e) => onChange({ sku: e.target.value })} />
    </div>
  );
}

export function Organisation({ d, set, nodes, storeId }: { d: ProductDraft; set: Set; nodes: CatNode[]; storeId: string }) {
  const { t, l } = useI18n();
  const [picking, setPicking] = useState(false);
  const [tag, setTag] = useState('');
  const cols = useQuery('admin.collections.list', { storeId });
  const manual = ((cols.data ?? []) as Array<{ id: string; title: Record<string, string>; kind: string }>).filter((c) => c.kind === 'manual');
  const crumbs = pathTo(nodes, d.categoryId).map((n) => l(n.name));
  const addTag = () => {
    const v = tag.trim().toLowerCase();
    if (v && !d.tags.includes(v)) set((x) => ({ ...x, tags: [...x.tags, v].slice(0, 30) }));
    setTag('');
  };
  return (
    <div className="sl-form">
      <div className="field">
        <span className="field-label">{t('seller.category')}</span>
        <button type="button" className="pe-cat" onClick={() => setPicking(true)}>
          <SIcon name="folder" size={18} />
          <span className="pe-cat-path">{crumbs.length ? crumbs.join(' › ') : t('seller.noCategory')}</span>
          <SIcon name="chevron-right" size={18} />
        </button>
      </div>
      {manual.length > 0 && (
        <div className="field">
          <span className="field-label">{t('seller.collections')}</span>
          <div className="pe-wrap">
            {manual.map((c) => {
              const on = d.collectionIds.includes(c.id);
              return (
                <Chip key={c.id} selected={on} onClick={() => set((x) => ({ ...x, collectionIds: on ? x.collectionIds.filter((i) => i !== c.id) : [...x.collectionIds, c.id] }))}>
                  {l(c.title)}
                </Chip>
              );
            })}
          </div>
        </div>
      )}
      <div className="field">
        <span className="field-label">{t('seller.tags')}</span>
        <div className="pe-wrap">
          {d.tags.map((x) => (
            <Chip key={x} selected onClick={() => set((p) => ({ ...p, tags: p.tags.filter((y) => y !== x) }))}>
              #{x} ✕
            </Chip>
          ))}
          <input className="pe-tag-in" value={tag} placeholder={t('seller.tagPh')} maxLength={40} onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())} onBlur={addTag} />
        </div>
      </div>
      <CategoryPicker open={picking} onClose={() => setPicking(false)} title={t('seller.category')} nodes={nodes} mode="select" allowNone value={d.categoryId} onPick={(id) => set((x) => ({ ...x, categoryId: id }))} />
    </div>
  );
}

export function More({ d, set }: { d: ProductDraft; set: Set }) {
  const { t } = useI18n();
  const w = d.variants[0]?.weightG ?? 0;
  return (
    <div className="sl-form">
      <div className="pe-2col">
        <Input label={t('seller.brand')} value={d.brand} maxLength={80} onChange={(e) => set((x) => ({ ...x, brand: e.target.value }))} />
        <Input label={t('seller.vendorCode')} value={d.vendorCode} maxLength={80} onChange={(e) => set((x) => ({ ...x, vendorCode: e.target.value }))} />
      </div>
      {!d.isDigital && (
        <Input label={t('seller.weight')} inputMode="numeric" value={String(w)} onChange={(e) => { const g = Number(e.target.value.replace(/\D/g, '') || 0); set((x) => ({ ...x, variants: x.variants.map((v) => ({ ...v, weightG: g })) })); }} />
      )}
      <Toggle checked={d.isDigital} onChange={(v) => set((x) => ({ ...x, isDigital: v }))} label={t('seller.digital')} hint={t('seller.digitalHint')} />
    </div>
  );
}

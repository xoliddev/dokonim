/**
 * Collection editor sheet. Manual: pick products (search, tap to toggle). Automated: rules (field / op / value)
 * with a live preview count + sample from `admin.collections.previewRules`.
 */
import { useEffect, useState } from 'react';
import type { MessageKey } from '@dokonim/i18n';
import { useMutation, useQuery } from '../../../api/provider';
import { useI18n } from '../../../i18n';
import { haptic } from '../../../telegram/shim';
import { Button, Input, Sheet, toast } from '../../../ui';
import { CategoryPicker } from '../../components/CategoryPicker';
import { Segmented, Toggle } from '../../components/Controls';
import { SIcon } from '../../components/SIcon';
import { fieldError, toastError } from '../../lib/errors';
import { findNode, type CatNode } from '../../lib/tree';

type Field = 'tag' | 'price' | 'category' | 'on_sale' | 'created_within_days' | 'in_stock' | 'vendor' | 'title';
type Op = 'eq' | 'lt' | 'gt' | 'contains' | 'in_subtree';
export interface Rule { field: Field; op: Op; value: string | number | boolean }
export interface Coll { id: string; title: Record<string, string>; kind: 'manual' | 'automated'; rules: { match: 'all' | 'any'; rules: Rule[] }; isHidden: boolean; productCount: number }

const OPS: Record<Field, Op[]> = { tag: ['eq'], price: ['lt', 'gt'], category: ['in_subtree'], on_sale: ['eq'], created_within_days: ['lt'], in_stock: ['eq'], vendor: ['eq'], title: ['contains'] };
const DEFAULT: Record<Field, Rule['value']> = { tag: '', price: 0, category: '', on_sale: true, created_within_days: 14, in_stock: true, vendor: '', title: '' };

/**
 * The name field edits the UI locale's translation only (like product titles). Untouched, the stored title is kept
 * as is, so a ru/en seller flipping "hidden" neither copies a fallback translation around nor changes the uz name
 * (and with it the slug). A new collection also gets the name as its uz title, the default.
 */
export function collectionTitle(orig: Record<string, string> | null, shown: string, name: string, locale: string): Record<string, string> {
  const v = name.trim();
  if (!orig) return { uz: v, [locale]: v };
  if (v === shown.trim()) return orig;
  return { ...orig, [locale]: v };
}

export function CollectionForm({ open, coll, storeId, nodes, onClose }: { open: boolean; coll: Coll | null; storeId: string; nodes: CatNode[]; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Sheet open={open} onClose={onClose} title={coll ? t('seller.colEdit') : t('seller.colNew')} maxHeight={0.94}>
      {open && <Body key={coll?.id ?? 'new'} coll={coll} storeId={storeId} nodes={nodes} onClose={onClose} />}
    </Sheet>
  );
}

function Body({ coll, storeId, nodes, onClose }: { coll: Coll | null; storeId: string; nodes: CatNode[]; onClose: () => void }) {
  const { t, l, money, locale } = useI18n();
  const shown = coll ? l(coll.title) : ''; // may be a fallback from another locale
  const [name, setName] = useState(shown);
  const [kind, setKind] = useState<Coll['kind']>(coll?.kind ?? 'manual');
  const [match, setMatch] = useState<'all' | 'any'>(coll?.rules?.match ?? 'all');
  const [rules, setRules] = useState<Rule[]>(coll?.rules?.rules?.length ? coll.rules.rules : [{ field: 'on_sale', op: 'eq', value: true }]);
  const [hidden, setHidden] = useState(!!coll?.isHidden);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [catFor, setCatFor] = useState<number | null>(null);
  const [touched, setTouched] = useState(false);
  const [apiErr, setApiErr] = useState<unknown>(null);
  const detail = useQuery('admin.collections.get', coll ? { storeId, id: coll.id } : null);
  const products = useQuery('admin.products.list', kind === 'manual' ? { storeId, q: search.trim() || undefined, status: 'active', limit: 60 } : null);
  const ready = rules.every((r) => r.value !== '');
  const preview = useQuery('admin.collections.previewRules', kind === 'automated' && ready ? { storeId, rules: { match, rules } } : null, { staleMs: 2000 });
  const save = useMutation('admin.collections.save', { invalidates: ['admin.collections', 'admin.products', 'store.'] });

  useEffect(() => {
    const ps = (detail.data as { products?: Array<{ id: string }> } | undefined)?.products;
    if (ps) setPicked(new Set(ps.map((p) => p.id)));
  }, [detail.data]);

  const nameErr = touched && !name.trim() ? t('seller.catsNameRequired') : fieldError(apiErr, 'title', t);
  const setRule = (i: number, p: Partial<Rule>) => setRules((rs) => rs.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const submit = async () => {
    setTouched(true);
    if (!name.trim()) return haptic.notify('error');
    setApiErr(null);
    try {
      const title = collectionTitle(coll?.title ?? null, shown, name, locale);
      await save.run({ storeId, ...(coll ? { id: coll.id } : {}), title, kind, isHidden: hidden, ...(kind === 'manual' ? { productIds: [...picked] } : { rules: { match, rules } }) });
      haptic.notify('success');
      toast.success(t('seller.colSaved'));
      onClose();
    } catch (e) {
      setApiErr(e);
      toastError(e, t);
    }
  };
  const items = (products.data?.items ?? []) as unknown as Array<{ id: string; title: Record<string, string>; coverUrl: string | null; minPrice: number }>;
  const pv = preview.data as { count: number; sample: Array<{ id: string; coverUrl: string | null }> } | undefined;

  return (
    <div className="sl-form">
      <Input label={t('seller.colName')} value={name} maxLength={120} error={nameErr} onChange={(e) => setName(e.target.value)} />
      <Segmented<Coll['kind']> value={kind} onChange={setKind} options={[{ value: 'manual', label: t('seller.colManual') }, { value: 'automated', label: t('seller.colAuto') }]} />
      {kind === 'manual' ? (
        <div className="cl-pick">
          <span className="field-label">{t('seller.colPick')} · {picked.size}</span>
          <label className="sl-search"><SIcon name="search" size={18} /><input value={search} placeholder={t('seller.prodSearch')} onChange={(e) => setSearch(e.target.value)} /></label>
          <div className="cl-grid">
            {items.map((p) => {
              const on = picked.has(p.id);
              return (
                <button key={p.id} type="button" className={`cl-item${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => { haptic.selection(); setPicked((x) => { const n = new Set(x); if (on) n.delete(p.id); else n.add(p.id); return n; }); }}>
                  {p.coverUrl ? <img src={p.coverUrl} alt="" /> : <span className="cl-noimg" />}
                  <span className="cl-item-title">{l(p.title)}</span>
                  <span className="cl-item-price">{money(p.minPrice)}</span>
                  {on && <span className="cl-tick"><SIcon name="check" size={14} /></span>}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="cl-rules">
          <Segmented<'all' | 'any'> size="sm" value={match} onChange={setMatch} options={[{ value: 'all', label: t('seller.colMatchAll') }, { value: 'any', label: t('seller.colMatchAny') }]} />
          {rules.map((r, i) => (
            <div key={i} className="cl-rule">
              <select className="cl-select" value={r.field} aria-label={t('seller.colRules')} onChange={(e) => { const f = e.target.value as Field; setRule(i, { field: f, op: OPS[f][0]!, value: DEFAULT[f] }); }}>
                {(Object.keys(OPS) as Field[]).map((f) => <option key={f} value={f}>{t(`seller.rf_${f}` as MessageKey)}</option>)}
              </select>
              {OPS[r.field].length > 1 && (
                <select className="cl-select cl-op" value={r.op} aria-label="op" onChange={(e) => setRule(i, { op: e.target.value as Op })}>
                  {OPS[r.field].map((o) => <option key={o} value={o}>{t(`seller.op_${o}` as MessageKey)}</option>)}
                </select>
              )}
              {r.field === 'category' ? (
                <button type="button" className="cl-val cl-cat" onClick={() => setCatFor(i)}>{r.value ? l(findNode(nodes, String(r.value))?.name) : '…'}</button>
              ) : typeof DEFAULT[r.field] === 'boolean' ? (
                <span className="cl-val cl-bool">✓</span>
              ) : (
                <input className="cl-val" inputMode={typeof DEFAULT[r.field] === 'number' ? 'numeric' : 'text'} value={r.field === 'price' ? String(Number(r.value) / 100 || '') : String(r.value)} placeholder={r.field === 'price' ? 'soʻm' : ''} onChange={(e) => setRule(i, { value: r.field === 'price' ? Number(e.target.value.replace(/\D/g, '')) * 100 : typeof DEFAULT[r.field] === 'number' ? Number(e.target.value.replace(/\D/g, '')) : e.target.value })} />
              )}
              <button type="button" className="oe-x" aria-label={t('common.delete')} disabled={rules.length <= 1} onClick={() => setRules((rs) => rs.filter((_, k) => k !== i))}><SIcon name="close" size={14} /></button>
            </div>
          ))}
          {rules.length < 20 && <button type="button" className="cf-more" onClick={() => setRules((rs) => [...rs, { field: 'tag', op: 'eq', value: '' }])}><SIcon name="plus" size={16} /> {t('seller.colAddRule')}</button>}
          <div className="cl-preview" aria-live="polite">
            <strong>{pv ? t('seller.colPreview', { n: pv.count }) : '…'}</strong>
            <div className="cl-sample">{pv?.sample.map((x) => (x.coverUrl ? <img key={x.id} src={x.coverUrl} alt="" /> : null))}</div>
          </div>
          <CategoryPicker open={catFor != null} onClose={() => setCatFor(null)} title={t('seller.category')} nodes={nodes} mode="select" onPick={(id) => catFor != null && id && setRule(catFor, { value: id })} />
        </div>
      )}
      <Toggle checked={hidden} onChange={setHidden} label={t('seller.colHidden')} />
      <div className="sl-sheet-actions">
        <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
        <Button loading={save.loading} onClick={() => void submit()}>{t('common.save')}</Button>
      </div>
    </div>
  );
}

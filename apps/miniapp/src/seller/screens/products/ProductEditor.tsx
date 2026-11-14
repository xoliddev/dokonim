/**
 * Product editor (§6.3): Media → Basics → Pricing / Options & Variants → Organisation → More. The cover photo is the
 * Continuity target from the list; sections stagger in after the morph. MainButton = Save. Unsaved changes are
 * guarded on Back. Errors are validated locally first, then mapped from the API.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { invalidate, useMutation, useQuery } from '../../../api/provider';
import { useI18n } from '../../../i18n';
import { MorphContent } from '../../../motion';
import type { RouteProps } from '../../../router/router';
import { back, navigate } from '../../../router/router';
import { haptic, useBackButton, useMainButton } from '../../../telegram/shim';
import { toast } from '../../../ui';
import { Toggle, useConfirm } from '../../components/Controls';
import { Section, SellerScreen } from '../../components/Layout';
import { SIcon } from '../../components/SIcon';
import { Gate } from '../../components/States';
import { useSeller } from '../../lib/ctx';
import { errorMessage, toastError } from '../../lib/errors';
import { emptyDraft, hasErrors, regenerate, validateDraft, type OptionDraft, type ProductDraft } from '../../lib/product';
import { fromAggregate, toInput } from '../../lib/productIO';
import type { CatNode } from '../../lib/tree';
import { Basics, More, Organisation, SinglePricing } from './EditorSections';
import { MediaEditor } from './MediaEditor';
import { OptionsEditor } from './OptionsEditor';
import { VariantMatrix } from './VariantMatrix';
import './products.css';

const INV = ['admin.products', 'admin.dashboard', 'admin.inventory', 'admin.categories', 'admin.collections', 'store.'];

export default function ProductEditor({ params, query }: RouteProps) {
  const { t, locale } = useI18n();
  const s = useSeller();
  const isNew = !params.id;
  const q = useQuery('admin.products.get', !isNew && s.storeId ? { storeId: s.storeId, id: params.id! } : null, { staleMs: 0 });
  const cats = useQuery('admin.categories.tree', s.storeId ? { storeId: s.storeId } : null);
  const [d, setD] = useState<ProductDraft | null>(() => (isNew ? emptyDraft(query.get('category')) : null));
  const initial = useRef<string>(isNew ? JSON.stringify(d) : '');
  const [showErr, setShowErr] = useState(false);
  const save = useMutation('admin.products.save', { invalidates: INV });
  const dup = useMutation('admin.products.duplicate', { invalidates: INV });
  const bulk = useMutation('admin.products.bulk', { invalidates: INV });
  const [confirmUi, ask] = useConfirm();

  useEffect(() => {
    if (!isNew && q.data && (!d || d.id !== (q.data as { id: string }).id)) {
      const draft = fromAggregate(q.data, locale);
      initial.current = JSON.stringify(draft);
      setD(draft);
    }
  }, [q.data, isNew, d, locale]);

  const errors = useMemo(() => (d ? validateDraft(d) : {}), [d]);
  const dirty = !!d && JSON.stringify(d) !== initial.current;
  const set = (fn: (x: ProductDraft) => ProductDraft) => setD((x) => (x ? fn(x) : x));
  const setOptions = (options: OptionDraft[]) => {
    try {
      set((x) => ({ ...x, options, variants: regenerate(options, x.variants) }));
    } catch (e) {
      toastError(e, t);
    }
  };

  const doSave = async () => {
    if (!d || !s.storeId) return;
    setShowErr(true);
    if (hasErrors(errors)) {
      const n = Object.keys(errors).filter((k) => k !== 'variant').length + Object.keys(errors.variant ?? {}).length;
      haptic.notify('error');
      toast.error(t('seller.e_fix', { n }));
      document.querySelector('.pe [aria-invalid="true"], .pe .field.has-error, .pe .field-error')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    try {
      const r = await save.run(toInput(d, s.storeId, locale) as never);
      const next = fromAggregate(r, locale);
      initial.current = JSON.stringify(next);
      setD(next);
      setShowErr(false);
      haptic.notify('success');
      toast.success(t('seller.productSaved'));
      if (isNew) navigate(`/m/${s.slug}/products/${next.id}`, { replace: true });
    } catch (e) {
      toastError(e, t);
    }
  };

  const leave = async () => {
    if (dirty && !(await ask({ title: t('seller.unsavedTitle'), body: t('seller.unsavedBody'), confirm: t('seller.discard'), danger: true }))) return;
    back(`/m/${s.slug}/products`);
  };
  useBackButton(() => void leave());
  useMainButton(d ? { text: t('common.save'), onClick: () => void doSave(), progress: save.loading, disabled: save.loading } : null);

  const duplicate = async () => {
    if (!d?.id || !s.storeId) return;
    try {
      const r = (await dup.run({ storeId: s.storeId, id: d.id })) as { id: string };
      toast.success(t('seller.duplicated'));
      navigate(`/m/${s.slug}/products/${r.id}`);
    } catch (e) {
      toastError(e, t);
    }
  };
  const archive = async () => {
    if (!d?.id || !s.storeId) return;
    const restoring = d.status === 'archived';
    if (!restoring && !(await ask({ title: t('seller.archiveConfirm'), body: t('seller.archiveBody'), confirm: t('common.delete'), danger: true }))) return;
    try {
      await bulk.run({ storeId: s.storeId, ids: [d.id], action: restoring ? 'activate' : 'archive' });
      haptic.notify('success');
      if (restoring) {
        set((x) => ({ ...x, status: 'active' }));
        initial.current = JSON.stringify({ ...d, status: 'active' });
        invalidate('admin.products.get');
      } else {
        toast.success(t('seller.archived'));
        navigate(`/m/${s.slug}/products`, { replace: true });
      }
    } catch (e) {
      toastError(e, t);
    }
  };

  const loadErr = !isNew && !q.data ? (s.error ?? q.error) : undefined;
  const single = d && d.options.filter((o) => o.values.length).length === 0;
  const optErr = showErr && errors.options ? t(`seller.e_opt_${errors.options}` as never) : undefined;
  const varErr = showErr ? errors.variant : undefined;

  return (
    <SellerScreen
      kicker={isNew ? undefined : t('seller.editProduct')}
      title={isNew ? t('seller.newProduct') : d?.title.uz || d?.title.ru || d?.title.en || '…'}
      actions={
        !isNew && d ? (
          <>
            <button type="button" className="sl-icon-btn" aria-label={t('seller.duplicate')} disabled={dup.loading} onClick={() => void duplicate()}>
              <SIcon name="copy" size={20} />
            </button>
            <button type="button" className="sl-icon-btn" aria-label={d.status === 'archived' ? t('seller.restore') : t('common.delete')} disabled={bulk.loading} onClick={() => void archive()}>
              <SIcon name={d.status === 'archived' ? 'undo' : 'trash'} size={20} />
            </button>
          </>
        ) : undefined
      }
    >
      <Gate loading={!d && !loadErr} error={loadErr} onRetry={q.reload}>
        {d && s.storeId && (
          <div className="pe">
            <MorphContent index={0}>
              <MediaEditor productId={d.id} media={d.media} onChange={(media) => set((x) => ({ ...x, media }))} />
            </MorphContent>
            <MorphContent index={1}>
              <div className={`pe-status${d.status === 'active' ? ' is-on' : ''}`}>
                <Toggle checked={d.status === 'active'} onChange={(v) => set((x) => ({ ...x, status: v ? 'active' : 'draft' }))} label={d.status === 'active' ? t('seller.publishOn') : d.status === 'archived' ? t('seller.status_archived') : t('seller.publishOff')} />
              </div>
            </MorphContent>
            <MorphContent index={2}>
              <Section title={t('seller.secBasics')}>
                <Basics d={d} set={set} titleErr={showErr && errors.title ? t('seller.e_title') : undefined} />
              </Section>
            </MorphContent>
            {single && d.variants[0] && (
              <MorphContent index={3}>
                <Section title={t('seller.secPricing')}>
                  <SinglePricing v={d.variants[0]} err={varErr?.[d.variants[0].id]} onChange={(p) => set((x) => ({ ...x, variants: x.variants.map((v, i) => (i === 0 ? { ...v, ...p } : v)) }))} />
                </Section>
              </MorphContent>
            )}
            <MorphContent index={4}>
              <Section title={t('seller.secVariants')}>
                <OptionsEditor options={d.options} onChange={setOptions} error={optErr} />
                <VariantMatrix options={d.options} variants={d.variants} bad={varErr} skuPrefix={d.vendorCode || d.title.uz || 'SKU'} onChange={(variants) => set((x) => ({ ...x, variants }))} />
                {varErr && !single && <p className="field-error">{t('seller.e_fix', { n: Object.keys(varErr).length })}</p>}
              </Section>
            </MorphContent>
            <MorphContent index={5}>
              <Section title={t('seller.secOrg')}>
                <Organisation d={d} set={set} nodes={(cats.data ?? []) as CatNode[]} storeId={s.storeId} />
              </Section>
            </MorphContent>
            <MorphContent index={6}>
              <Section title={t('seller.secMore')}>
                <More d={d} set={set} />
              </Section>
            </MorphContent>
            {save.error && <p className="field-error" role="alert">{errorMessage(save.error, t)}</p>}
          </div>
        )}
      </Gate>
      {confirmUi}
    </SellerScreen>
  );
}

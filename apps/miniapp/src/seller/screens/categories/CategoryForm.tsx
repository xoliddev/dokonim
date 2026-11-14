/** Create / edit a category: names in uz (+ ru/en translations), URL slug, hidden flag. Client checks first, then API errors per field. */
import { useState } from 'react';
import { useMutation } from '../../../api/provider';
import { useI18n } from '../../../i18n';
import { haptic } from '../../../telegram/shim';
import { Button, Input, Sheet, toast } from '../../../ui';
import { Toggle } from '../../components/Controls';
import { SIcon } from '../../components/SIcon';
import { errorMessage, fieldError, toastError } from '../../lib/errors';
import { pathTo, type CatNode } from '../../lib/tree';

export type FormMode = { kind: 'create'; parentId: string | null } | { kind: 'edit'; node: CatNode };

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function CategoryForm({ mode, nodes, storeId, onClose, onSaved }: { mode: FormMode | null; nodes: CatNode[]; storeId: string; onClose: () => void; onSaved: (id: string, parentId: string | null) => void }) {
  const { t } = useI18n();
  return (
    <Sheet open={!!mode} onClose={onClose} title={mode?.kind === 'edit' ? t('seller.catsRename') : mode?.parentId ? t('seller.addSubcategory') : t('seller.addCategory')}>
      {mode && <FormBody key={mode.kind === 'edit' ? mode.node.id : `new-${mode.parentId}`} mode={mode} nodes={nodes} storeId={storeId} onClose={onClose} onSaved={onSaved} t={t} />}
    </Sheet>
  );
}

function FormBody({ mode, nodes, storeId, onClose, onSaved, t }: { mode: FormMode; nodes: CatNode[]; storeId: string; onClose: () => void; onSaved: (id: string, parentId: string | null) => void; t: ReturnType<typeof useI18n>['t'] }) {
  const { l } = useI18n();
  const edit = mode.kind === 'edit' ? mode.node : null;
  const [name, setName] = useState({ uz: edit?.name.uz ?? '', ru: edit?.name.ru ?? '', en: edit?.name.en ?? '' });
  const [slug, setSlug] = useState(edit?.slug ?? '');
  const [hidden, setHidden] = useState(edit?.isHidden ?? false);
  const [more, setMore] = useState(!!(edit?.name.ru || edit?.name.en));
  const [touched, setTouched] = useState(false);
  const [apiErr, setApiErr] = useState<unknown>(null);
  const create = useMutation('admin.categories.create', { invalidates: ['admin.categories', 'admin.products', 'store.'] });
  const update = useMutation('admin.categories.update', { invalidates: ['admin.categories', 'store.'] });
  const busy = create.loading || update.loading;

  const parentId = mode.kind === 'create' ? mode.parentId : mode.node.parentId;
  const where = pathTo(nodes, parentId).map((n) => l(n.name));
  const primary = name.uz.trim() || name.ru.trim() || name.en.trim();
  const nameErr = !touched ? undefined : !primary ? t('seller.catsNameRequired') : Object.values(name).some((v) => v.trim().length > 80) ? t('seller.catsNameLong') : undefined;
  const slugErr = slug && !SLUG.test(slug) ? t('seller.catsSlugBad') : (fieldError(apiErr, 'slug', t) ?? ((apiErr as { code?: string })?.code === 'SLUG_TAKEN' ? errorMessage(apiErr, t) : undefined));

  const submit = async () => {
    setTouched(true);
    if (!primary || Object.values(name).some((v) => v.trim().length > 80) || (slug && !SLUG.test(slug))) {
      haptic.notify('error');
      return;
    }
    const clean = Object.fromEntries(Object.entries(name).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v)) as Record<string, string>;
    setApiErr(null);
    try {
      if (mode.kind === 'create') {
        const r = (await create.run({ storeId, parentId: mode.parentId, name: clean, slug: slug || undefined, isHidden: hidden })) as { id: string };
        toast.success(t('seller.catsCreated', { name: primary }));
        onSaved(r.id, mode.parentId);
      } else {
        await update.run({ storeId, id: mode.node.id, name: clean, slug: slug || undefined, isHidden: hidden });
        toast.success(t('seller.catsRenamed'));
        onSaved(mode.node.id, mode.node.parentId);
      }
      haptic.notify('success');
      onClose();
    } catch (e) {
      setApiErr(e);
      const code = (e as { code?: string }).code;
      if (code !== 'SLUG_TAKEN' && !fieldError(e, 'slug', t)) toastError(e, t);
      else haptic.notify('error');
    }
  };

  return (
    <form
      className="sl-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="cf-where">
        <SIcon name="folder" size={16} /> {t('seller.catsInside', { path: where.length ? where.join(' › ') : t('seller.catsTop') })}
      </p>
      <Input label={t('seller.catsNameUz')} value={name.uz} autoFocus maxLength={90} error={nameErr ?? fieldError(apiErr, 'name', t)} onChange={(e) => setName({ ...name, uz: e.target.value })} />
      {more ? (
        <>
          <Input label={t('seller.catsNameRu')} value={name.ru} maxLength={90} onChange={(e) => setName({ ...name, ru: e.target.value })} />
          <Input label={t('seller.catsNameEn')} value={name.en} maxLength={90} onChange={(e) => setName({ ...name, en: e.target.value })} />
        </>
      ) : (
        <button type="button" className="cf-more" onClick={() => setMore(true)}>
          <SIcon name="globe" size={16} /> {t('seller.catsTranslations')} (RU, EN)
        </button>
      )}
      <Input label={t('seller.catsSlug')} hint={slugErr ? undefined : t('seller.catsSlugHint')} value={slug} error={slugErr} maxLength={64} autoCapitalize="off" spellCheck={false} onChange={(e) => { setSlug(e.target.value.toLowerCase().replace(/\s+/g, '-')); setApiErr(null); }} />
      <Toggle checked={hidden} onChange={setHidden} label={t('seller.catsHide')} hint={t('seller.catsHideHint')} />
      <div className="sl-sheet-actions">
        <Button variant="secondary" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" loading={busy}>
          {mode.kind === 'create' ? t('common.create') : t('common.save')}
        </Button>
      </div>
    </form>
  );
}

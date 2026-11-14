/** Store details: name & tagline per language, store languages + default, contacts, hours, open/draft. */
import { useEffect, useState } from 'react';
import type { Locale } from '@dokonim/core';
import { useMutation } from '../../../api/provider';
import { useI18n } from '../../../i18n';
import type { RouteProps } from '../../../router/router';
import { haptic, useMainButton } from '../../../telegram/shim';
import { Chip, Input, toast } from '../../../ui';
import { Toggle } from '../../components/Controls';
import { Section, SellerScreen } from '../../components/Layout';
import { Gate } from '../../components/States';
import { useSeller } from '../../lib/ctx';
import { fieldError, toastError } from '../../lib/errors';
import './settings.css';

const LOCALES: Locale[] = ['uz', 'ru', 'en'];
type Contacts = { phone?: string; telegram?: string; instagram?: string; address?: string };

export default function StoreSettings(_: RouteProps) {
  const { t } = useI18n();
  const s = useSeller();
  const st = s.store as (typeof s.store & { settings?: { contacts?: Contacts; hours?: string } }) | undefined;
  const [name, setName] = useState<Record<Locale, string>>({ uz: '', ru: '', en: '' });
  const [tagline, setTagline] = useState<Record<Locale, string>>({ uz: '', ru: '', en: '' });
  const [locales, setLocales] = useState<Locale[]>(['uz']);
  const [def, setDef] = useState<Locale>('uz');
  const [contacts, setContacts] = useState<Contacts>({});
  const [hours, setHours] = useState('');
  const [open, setOpen] = useState(true);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [apiErr, setApiErr] = useState<unknown>(null);
  const save = useMutation('admin.store.update', { invalidates: ['store.', 'me.', 'admin.'] });

  useEffect(() => {
    if (!st || loadedId === st.id) return;
    setLoadedId(st.id);
    setName({ uz: st.name.uz ?? '', ru: st.name.ru ?? '', en: st.name.en ?? '' });
    setTagline({ uz: st.tagline?.uz ?? '', ru: st.tagline?.ru ?? '', en: st.tagline?.en ?? '' });
    setLocales(st.locales as Locale[]);
    setDef(st.defaultLocale as Locale);
    setContacts(st.settings?.contacts ?? {});
    setHours(st.settings?.hours ?? '');
    setOpen(st.status === 'active');
  }, [st, loadedId]);

  const nameErr = !Object.values(name).some((v) => v.trim()) ? t('seller.catsNameRequired') : fieldError(apiErr, 'name', t);
  const submit = async () => {
    if (!s.storeId || nameErr) return haptic.notify('error');
    setApiErr(null);
    try {
      const clean = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
      await save.run({ storeId: s.storeId, name: clean(name), tagline: clean(tagline), locales, defaultLocale: def, settings: { contacts: clean(contacts as Record<string, string>), hours: hours.trim() }, status: open ? 'active' : 'draft' });
      haptic.notify('success');
      toast.success(t('seller.stSaved'));
    } catch (e) {
      setApiErr(e);
      toastError(e, t);
    }
  };
  useMainButton(loadedId ? { text: t('common.save'), onClick: () => void submit(), progress: save.loading, disabled: save.loading } : null);

  const toggleLocale = (l: Locale) => {
    if (locales.includes(l)) {
      if (locales.length === 1) return toast.error(t('seller.stLangReq'));
      const next = locales.filter((x) => x !== l);
      setLocales(next);
      if (def === l) setDef(next[0]!);
    } else setLocales([...locales, l]);
  };

  return (
    <SellerScreen title={t('seller.storeInfo')}>
      <Gate loading={!loadedId && !s.error} error={s.error} onRetry={s.reload}>
        <Section title={t('seller.stLanguages')}>
          <p className="sl-hint">{t('seller.stLangHint')}</p>
          <div className="st-langs">
            {LOCALES.map((l) => (
              <div key={l} className={`st-lang${locales.includes(l) ? ' is-on' : ''}`}>
                <Chip selected={locales.includes(l)} onClick={() => toggleLocale(l)}>{t(`common.lang_${l}`)}</Chip>
                {locales.includes(l) && (
                  <button type="button" className={`st-def${def === l ? ' is-on' : ''}`} onClick={() => setDef(l)}>{t('seller.stDefault')}</button>
                )}
              </div>
            ))}
          </div>
        </Section>
        <Section title={t('seller.stName')}>
          <div className="sl-form">
            {locales.map((l) => (
              <Input key={l} label={`${t('seller.stName')} · ${l.toUpperCase()}`} value={name[l]} maxLength={60} error={l === def ? nameErr : undefined} onChange={(e) => setName({ ...name, [l]: e.target.value })} />
            ))}
            {locales.map((l) => (
              <Input key={`t${l}`} label={`${t('seller.stTagline')} · ${l.toUpperCase()}`} value={tagline[l]} maxLength={120} onChange={(e) => setTagline({ ...tagline, [l]: e.target.value })} />
            ))}
          </div>
        </Section>
        <Section title={t('seller.stContacts')}>
          <div className="sl-form">
            <Input label={t('seller.stPhone')} inputMode="tel" value={contacts.phone ?? ''} placeholder="+998 90 123 45 67" onChange={(e) => setContacts({ ...contacts, phone: e.target.value })} />
            <div className="pe-2col">
              <Input label="Telegram" value={contacts.telegram ?? ''} placeholder="@username" onChange={(e) => setContacts({ ...contacts, telegram: e.target.value })} />
              <Input label="Instagram" value={contacts.instagram ?? ''} placeholder="@shop" onChange={(e) => setContacts({ ...contacts, instagram: e.target.value })} />
            </div>
            <Input label={t('seller.stAddress')} value={contacts.address ?? ''} onChange={(e) => setContacts({ ...contacts, address: e.target.value })} />
            <Input label={t('seller.stHours')} value={hours} placeholder="10:00–20:00" onChange={(e) => setHours(e.target.value)} />
          </div>
        </Section>
        <Toggle checked={open} onChange={setOpen} label={t('seller.stOpen')} hint={t('seller.stOpenHint')} />
      </Gate>
    </SellerScreen>
  );
}

/**
 * Payment providers (§6.3 / §11): Payme, Click, Uzum, Telegram Stars, cash on delivery. Each card expands into:
 * show-to-buyers switch, sandbox / live, credential fields (write-only — the server never returns them),
 * webhook URLs to copy, Save, and "Test payment" (provider config check, marks it verified).
 */
import { useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import type { MessageKey } from '@dokonim/i18n';
import { useMutation, useQuery } from '../../../api/provider';
import { useI18n } from '../../../i18n';
import { spring } from '../../../motion';
import type { RouteProps } from '../../../router/router';
import { haptic } from '../../../telegram/shim';
import { Button, Input, toast } from '../../../ui';
import { Segmented, Toggle } from '../../components/Controls';
import { SellerScreen } from '../../components/Layout';
import { SIcon } from '../../components/SIcon';
import { Gate } from '../../components/States';
import { useSeller } from '../../lib/ctx';
import { toastError } from '../../lib/errors';
import { copyText } from '../onboarding/Done';
import '../onboarding/wizard.css';
import './settings.css';

type Provider = 'payme' | 'click' | 'uzum' | 'stars' | 'cod';
interface Row { provider: Provider; mode: 'sandbox' | 'live'; enabled: boolean; hasCredentials: boolean; lastVerifiedAt: string | null; webhookUrls: string[]; publicConfig: Record<string, string> }
const ORDER: Provider[] = ['payme', 'click', 'uzum', 'stars', 'cod'];
const CREDS: Record<Provider, string[]> = { payme: ['merchant_id', 'key'], click: ['service_id', 'merchant_id', 'merchant_user_id', 'secret_key'], uzum: ['terminal_id', 'api_key'], stars: [], cod: [] };

export default function Payments(_: RouteProps) {
  const { t } = useI18n();
  const s = useSeller();
  const q = useQuery('admin.payments.list', s.storeId ? { storeId: s.storeId } : null);
  const [open, setOpen] = useState<Provider | null>(null);
  const rows = (q.data ?? []) as unknown as Row[];
  const get = (p: Provider): Row => rows.find((r) => r.provider === p) ?? { provider: p, mode: 'sandbox', enabled: false, hasCredentials: false, lastVerifiedAt: null, webhookUrls: [], publicConfig: {} };
  return (
    <SellerScreen title={t('seller.payments')}>
      <p className="sl-hint">{t('seller.pmHint')}</p>
      <Gate loading={!q.data && q.loading} error={!q.data && (s.error ?? q.error)} onRetry={q.reload}>
        <div className="pm-list">
          {ORDER.map((p) => (
            <ProviderCard key={p} row={get(p)} open={open === p} onToggle={() => setOpen(open === p ? null : p)} storeId={s.storeId!} />
          ))}
        </div>
      </Gate>
    </SellerScreen>
  );
}

function ProviderCard({ row, open, onToggle, storeId }: { row: Row; open: boolean; onToggle: () => void; storeId: string }) {
  const { t, dateTime } = useI18n();
  const name = t(`seller.pay_${row.provider}` as MessageKey);
  const [enabled, setEnabled] = useState(row.enabled);
  const [mode, setMode] = useState(row.mode);
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ ok: boolean; problems: string[] } | null>(null);
  const save = useMutation('admin.payments.save', { invalidates: ['admin.payments', 'store.'] });
  const test = useMutation('admin.payments.test', { invalidates: ['admin.payments'] });
  const status = !row.enabled ? 'off' : row.mode;
  const fields = CREDS[row.provider];

  const doSave = async () => {
    try {
      const filled = Object.fromEntries(Object.entries(creds).filter(([, v]) => v.trim()));
      await save.run({ storeId, provider: row.provider === 'stars' ? 'stars' : row.provider, mode: row.provider === 'cod' ? 'sandbox' : mode, enabled, credentials: Object.keys(filled).length ? filled : null });
      setCreds({});
      haptic.notify('success');
      toast.success(t('seller.pmSaved', { name }));
    } catch (e) {
      toastError(e, t);
    }
  };
  const doTest = async () => {
    try {
      const r = (await test.run({ storeId, provider: row.provider })) as { ok: boolean; problems: string[] };
      setResult(r);
      haptic.notify(r.ok ? 'success' : 'error');
    } catch (e) {
      toastError(e, t);
    }
  };

  return (
    <m.div layout className={`pm-card${open ? ' is-open' : ''}`} transition={spring.snappy}>
      <button type="button" className="pm-head" aria-expanded={open} onClick={() => { haptic.selection(); onToggle(); }}>
        <span className={`wz-pay-logo pay-${row.provider}`}>{row.provider === 'cod' ? <SIcon name="wallet" size={20} /> : row.provider === 'stars' ? '★' : row.provider[0]!.toUpperCase()}</span>
        <span className="sl-row-main">
          <span className="sl-row-title">{name}</span>
          <span className="sl-row-sub">{t(`seller.payHint_${row.provider}` as MessageKey)}</span>
        </span>
        <span className={`sl-pill ${status === 'off' ? 'is-muted' : status === 'live' ? 'is-good' : 'is-warn'}`}>{t(`seller.pmStatus_${status}` as MessageKey)}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <m.div className="pm-body" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring.snappy}>
            <Toggle checked={enabled} onChange={setEnabled} label={t('seller.pmEnable')} />
            {row.provider !== 'cod' && row.provider !== 'stars' && (
              <Segmented<'sandbox' | 'live'> size="sm" value={mode} onChange={setMode} options={[{ value: 'sandbox', label: t('seller.pmSandbox') }, { value: 'live', label: t('seller.pmLive') }]} />
            )}
            {fields.length > 0 && (
              <div className="pm-creds">
                <span className="wz-label">{t('seller.pmCreds')}</span>
                <p className="sl-hint">{row.hasCredentials ? t('seller.pmCredsSaved') : t('seller.pmCredsHint')}</p>
                {fields.map((f) => (
                  <Input key={f} label={f} type={/key|secret/.test(f) ? 'password' : 'text'} autoComplete="off" spellCheck={false} value={creds[f] ?? ''} placeholder={row.hasCredentials ? '••••••••' : ''} onChange={(e) => setCreds((c) => ({ ...c, [f]: e.target.value }))} />
                ))}
              </div>
            )}
            {row.webhookUrls.length > 0 && (
              <div className="pm-hooks">
                <span className="wz-label">{t('seller.pmWebhooks')}</span>
                {row.webhookUrls.map((u) => (
                  <button key={u} type="button" className="pm-hook" onClick={() => void copyText(u, t('common.copied'))}>
                    <span>{u}</span>
                    <SIcon name="copy" size={16} />
                  </button>
                ))}
              </div>
            )}
            {result && (
              <p className={`pm-result ${result.ok ? 'is-ok' : 'is-bad'}`} role="status">
                <SIcon name={result.ok ? 'check' : 'alert'} size={16} /> {result.ok ? t('seller.pmTestOk', { name }) : t('seller.pmTestFail', { p: result.problems.join('; ') })}
              </p>
            )}
            {row.lastVerifiedAt && !result && <p className="sl-hint">{t('seller.pmVerified', { at: dateTime(row.lastVerifiedAt) })}</p>}
            <div className="sl-sheet-actions">
              <Button variant="secondary" loading={test.loading} icon={<SIcon name="bolt" size={16} />} onClick={() => void doTest()}>{t('seller.pmTest')}</Button>
              <Button loading={save.loading} onClick={() => void doSave()}>{t('common.save')}</Button>
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </m.div>
  );
}

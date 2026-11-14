/**
 * The Demo bar (§19.6): role switcher (Seller / Buyer), store picker, language, light/dark, motion tier override
 * and Reset demo. Lives outside the phone on desktop, collapsible on phones.
 */
import { pick, type Locale } from '@dokonim/core';
import { useApi, invalidate, useBackendStatus, useQuery } from '../api/provider';
import { setLocale, useI18n } from '../i18n';
import { setTierOverride, tierStore, type MotionTier } from '../motion/tier';
import { useStore } from '../lib/store';
import { navigate } from '../router/router';
import { tg, useShim } from '../telegram/shim';
import { Button, Icon, toast } from '../ui';
import { switchRole, switchStore, useSession } from './session';

const LOCALES: Locale[] = ['uz', 'ru', 'en'];
const TIERS: Array<MotionTier | null> = [null, 'full', 'lite', 'minimal'];

export function DemoBar({ compact }: { compact?: boolean }) {
  const { t, locale } = useI18n();
  const client = useApi();
  const status = useBackendStatus();
  const { role, slug } = useSession();
  const { scheme } = useShim();
  const override = useStore(tierStore, (s) => s.override);
  const me = useQuery('me.get', status.phase === 'ready' ? undefined : null);
  const stores = (me.data?.stores ?? []) as Array<{ slug: string; name: Record<string, string> }>;

  const reset = async () => {
    if (!client.resetDemo || !(await tg.confirm(t('common.demoResetConfirm')))) return;
    await client.resetDemo();
    invalidate('');
    navigate('/', { replace: true });
    toast.success(t('common.done'));
  };

  return (
    <div className={`demo-bar${compact ? ' is-compact' : ''}`} aria-label="Demo">
      <div className="demo-group" role="radiogroup" aria-label={t('common.roleSeller') + ' / ' + t('common.roleBuyer')}>
        {(['seller', 'buyer'] as const).map((r) => (
          <button key={r} type="button" role="radio" aria-checked={role === r} className={`seg${role === r ? ' is-on' : ''}`} onClick={() => switchRole(r)} disabled={!slug}>
            <Icon name={r === 'seller' ? 'chart' : 'cart'} size={16} />
            {r === 'seller' ? t('common.roleSeller') : t('common.roleBuyer')}
          </button>
        ))}
      </div>
      <label className="demo-select">
        <Icon name="store" size={16} />
        <select aria-label={t('common.pickStore')} value={slug ?? ''} onChange={(e) => (e.target.value ? switchStore(e.target.value) : navigate('/'))}>
          <option value="">{t('common.myStores')}</option>
          {stores.map((s) => (
            <option key={s.slug} value={s.slug}>
              {pick(s.name, locale)}
            </option>
          ))}
        </select>
      </label>
      <div className="demo-group" role="radiogroup" aria-label={t('common.language')}>
        {LOCALES.map((l) => (
          <button key={l} type="button" role="radio" aria-checked={locale === l} className={`seg seg-sm${locale === l ? ' is-on' : ''}`} onClick={() => setLocale(l)}>
            {l.toUpperCase()}
          </button>
        ))}
      </div>
      <button type="button" className="seg seg-icon" onClick={() => tg.setScheme(scheme === 'dark' ? 'light' : 'dark')} aria-label={scheme === 'dark' ? 'Light' : 'Dark'}>
        <Icon name={scheme === 'dark' ? 'sun' : 'moon'} size={16} />
      </button>
      <label className="demo-select">
        <Icon name="sparkle" size={16} />
        <select aria-label="Motion" value={override ?? ''} onChange={(e) => setTierOverride((e.target.value || null) as MotionTier | null)}>
          {TIERS.map((x) => (
            <option key={x ?? 'auto'} value={x ?? ''}>
              {x ? `Motion: ${x}` : 'Motion: auto'}
            </option>
          ))}
        </select>
      </label>
      {client.resetDemo && (
        <Button size="sm" variant="ghost" icon={<Icon name="refresh" size={16} />} onClick={reset} disabled={status.phase !== 'ready'}>
          {t('common.demoReset')}
        </Button>
      )}
    </div>
  );
}

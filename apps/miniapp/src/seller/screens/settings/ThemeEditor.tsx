/**
 * Theme customiser (§6.3 / §12): a sticky live storefront preview on top (same compileTheme as the store), every
 * owner token editable below, presets, auto-saved draft (debounced), publish (MainButton) and version restore.
 */
import { useEffect, useRef, useState } from 'react';
import { DEFAULT_TOKENS, FONT_PAIRS, sanitizeTokens, type ThemeTokens } from '@dokonim/core';
import type { MessageKey } from '@dokonim/i18n';
import { useApi, useMutation, useQuery } from '../../../api/provider';
import { useI18n } from '../../../i18n';
import type { RouteProps } from '../../../router/router';
import { haptic, useMainButton } from '../../../telegram/shim';
import { Button, Chip, toast } from '../../../ui';
import { Segmented, Toggle } from '../../components/Controls';
import { Section, SellerScreen } from '../../components/Layout';
import { SIcon } from '../../components/SIcon';
import { Gate } from '../../components/States';
import { StorefrontPreview } from '../../components/StorefrontPreview';
import { useSeller } from '../../lib/ctx';
import { toastError } from '../../lib/errors';
import { Swatch } from '../onboarding/StepsBrand';
import '../onboarding/wizard.css';
import './settings.css';

interface ThemeGet {
  draft: { tokens: ThemeTokens; sections: unknown[]; version: number; preset: string | null } | null;
  published: { tokens: ThemeTokens; sections: unknown[]; version: number } | null;
  versions: Array<{ version: number; status: string; createdAt: string; preset: string | null }>;
  presets: Array<{ id: string; name: string; tokens: ThemeTokens }>;
}
type Key = keyof ThemeTokens;
const ENUMS: Array<[Key, MessageKey, string, string[]]> = [
  ['mode', 'seller.thMode', 'mode', ['telegram', 'light', 'dark', 'brand']],
  ['radius', 'seller.radius', 'radius', ['sharp', 'soft', 'round', 'pill']],
  ['cardStyle', 'seller.cardStyle', 'card', ['gallery', 'catalog', 'editorial', 'ticket']],
  ['density', 'seller.thDensity', 'density', ['compact', 'comfortable']],
  ['motif', 'seller.thMotif', 'motif', ['ikat', 'suzani', 'none']],
  ['buttonShape', 'seller.thButtons', 'btn', ['soft', 'pill', 'sharp']],
  ['imageFit', 'seller.thImages', 'fit', ['cover', 'contain']],
  ['motion', 'seller.thMotion', 'motion', ['expressive', 'calm']],
];
const BRANDS = ['#a3195b', '#c0392b', '#b5552b', '#d9a21b', '#1f6e5a', '#0e7c86', '#1f4fa8', '#0f6fd6', '#6b4fd8', '#2b2622'];

export default function ThemeEditor(_: RouteProps) {
  const { t, l, dateTime } = useI18n();
  const s = useSeller();
  const q = useQuery('admin.theme.get', s.storeId ? { storeId: s.storeId } : null, { staleMs: 0 });
  const data = q.data as ThemeGet | undefined;
  const [tokens, setTokens] = useState<ThemeTokens | null>(null);
  const [preset, setPreset] = useState<string | null>(null);
  const [dark, setDark] = useState(false);
  const [saved, setSaved] = useState(true);
  const loaded = useRef(false);
  const saveDraft = useMutation('admin.theme.saveDraft', { invalidates: [] });
  const publish = useMutation('admin.theme.publish', { invalidates: ['admin.theme', 'store.'] });
  const restore = useMutation('admin.theme.restore', { invalidates: [] });

  useEffect(() => {
    if (data && !loaded.current) {
      loaded.current = true;
      setTokens(sanitizeTokens(data.draft?.tokens ?? data.published?.tokens ?? DEFAULT_TOKENS));
      setPreset(data.draft?.preset ?? null);
    }
  }, [data]);

  // debounced draft autosave
  const api = useApi().api;
  const draftInput = () => (tokens && s.storeId && data ? { storeId: s.storeId, tokens: tokens as never, sections: (data.draft?.sections ?? data.published?.sections ?? []) as never, preset } : null);
  const snapOf = (x: { tokens: unknown; preset: unknown }) => JSON.stringify([x.tokens, x.preset]);
  const latest = useRef({ snap: '', saved, input: draftInput });
  latest.current = { snap: snapOf({ tokens, preset }), saved, input: draftInput };
  useEffect(() => {
    if (!tokens || saved || !s.storeId || !data) return;
    const id = setTimeout(() => {
      const input = draftInput()!;
      const snap = snapOf(input);
      saveDraft
        .run(input)
        // a change made while this save was in flight is not saved yet: leave it to its own (still pending) timer
        .then(() => latest.current.snap === snap && setSaved(true))
        .catch((e) => toastError(e, t));
    }, 700);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokens, preset, saved]);
  // leaving within the debounce window (or mid-save) still persists the last change
  useEffect(
    () => () => {
      const input = latest.current.saved ? null : latest.current.input();
      if (input) void api['admin.theme.saveDraft'](input).catch(() => {});
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const set = <K extends Key>(k: K, v: ThemeTokens[K]) => {
    haptic.selection();
    setTokens((x) => (x ? { ...x, [k]: v } : x));
    setSaved(false);
  };
  const dirtyVsLive = !!tokens && !!data?.published && JSON.stringify(sanitizeTokens(tokens)) !== JSON.stringify(sanitizeTokens(data.published.tokens));

  const doPublish = async () => {
    if (!s.storeId || !tokens || !data) return;
    try {
      await saveDraft.run({ storeId: s.storeId, tokens: tokens as never, sections: (data.draft?.sections ?? data.published?.sections ?? []) as never, preset });
      const r = (await publish.run({ storeId: s.storeId })) as { version: number };
      setSaved(true);
      loaded.current = false;
      haptic.notify('success');
      toast.success(t('seller.thPublished', { v: r.version }));
    } catch (e) {
      toastError(e, t);
    }
  };
  const doRestore = async (v: number) => {
    if (!s.storeId) return;
    try {
      const r = (await restore.run({ storeId: s.storeId, version: v })) as { tokens: ThemeTokens };
      setTokens(sanitizeTokens(r.tokens));
      setSaved(true);
      toast.success(t('seller.thRestored', { v }));
    } catch (e) {
      toastError(e, t);
    }
  };
  useMainButton(tokens ? { text: t('seller.publishTheme'), onClick: () => void doPublish(), progress: publish.loading, disabled: publish.loading || (!dirtyVsLive && saved), shine: dirtyVsLive } : null);

  return (
    <SellerScreen title={t('seller.theme')}>
      <Gate loading={!tokens && !q.error} error={!data && (s.error ?? q.error)} onRetry={q.reload}>
        {tokens && data && (
          <>
            <div className="th-stage">
              <StorefrontPreview className="th-preview" tokens={tokens} name={s.store ? l(s.store.name) : ''} logoUrl={s.store?.logoUrl} businessType={s.store?.businessType} scheme={dark ? 'dark' : 'light'} />
              <div className="th-status">
                <span className={`sl-pill ${dirtyVsLive ? 'is-warn' : 'is-good'}`}>{dirtyVsLive ? t('seller.thUnpublished') : t('seller.thUpToDate')}</span>
                <span className="sl-hint">{saveDraft.loading ? t('common.saving') : saved ? t('common.saved') : '…'}</span>
              </div>
            </div>
            <Section title={t('seller.thPresets')}>
              <div className="th-presets">
                {data.presets.map((p) => (
                  <button key={p.id} type="button" className={`wz-preset${preset === p.id ? ' is-on' : ''}`} onClick={() => { haptic.selection(); setTokens(sanitizeTokens(p.tokens)); setPreset(p.id); setSaved(false); }}>
                    <span className="wz-preset-chip" style={{ background: p.tokens.brand }} data-mode={p.tokens.mode} />
                    <span className="wz-preset-name">{p.name}</span>
                    <span className="wz-preset-meta">{t(`seller.card_${p.tokens.cardStyle}` as MessageKey)}</span>
                  </button>
                ))}
              </div>
            </Section>
            <Section title={t('seller.thColors')}>
              <span className="wz-label">{t('seller.brandColor')}</span>
              <div className="wz-swatches">
                {BRANDS.map((h) => <Swatch key={h} hex={h} on={tokens.brand.toLowerCase() === h} onPick={() => set('brand', h)} />)}
                <label className="wz-swatch wz-swatch-custom"><SIcon name="palette" size={18} /><input type="color" value={tokens.brand} aria-label={t('seller.wzCustomColor')} onChange={(e) => set('brand', e.target.value)} /></label>
              </div>
              <Toggle checked={!!tokens.accent2} onChange={(v) => set('accent2', v ? '#1f6e5a' : null)} label={t('seller.thAccent2')} />
              {tokens.accent2 && <input className="th-color" type="color" value={tokens.accent2} aria-label={t('seller.thAccent2')} onChange={(e) => set('accent2', e.target.value)} />}
            </Section>
            <Section title={t('seller.font')}>
              <div className="pe-wrap">
                {(Object.keys(FONT_PAIRS) as Array<ThemeTokens['fontPair']>).map((f) => (
                  <Chip key={f} selected={tokens.fontPair === f} onClick={() => set('fontPair', f)}><span style={{ fontFamily: FONT_PAIRS[f].display }}>{FONT_PAIRS[f].label}</span></Chip>
                ))}
              </div>
            </Section>
            {ENUMS.map(([k, label, prefix, values]) => (
              <Section key={k} title={t(label)}>
                <Segmented size="sm" value={String(tokens[k])} onChange={(v) => set(k, v as never)} options={values.map((v) => ({ value: v, label: t(`seller.${prefix}_${v}` as MessageKey) }))} />
              </Section>
            ))}
            <Toggle checked={dark} onChange={setDark} label={t('seller.thDarkPreview')} />
            {data.versions.length > 0 && (
              <Section title={t('seller.thVersions')}>
                <div className="sl-list">
                  {data.versions.map((v) => (
                    <div key={v.version} className="sl-row">
                      <span className="sl-row-icon"><SIcon name="layers" size={18} /></span>
                      <span className="sl-row-main">
                        <span className="sl-row-title">v{v.version} {v.status === 'published' && <span className="sl-pill is-good">{t('seller.status_active')}</span>}</span>
                        <span className="sl-row-sub">{dateTime(v.createdAt)}{v.preset ? ` · ${v.preset}` : ''}</span>
                      </span>
                      <Button size="sm" variant="secondary" disabled={restore.loading} onClick={() => void doRestore(v.version)}>{t('seller.thRestore')}</Button>
                    </div>
                  ))}
                </div>
              </Section>
            )}
          </>
        )}
      </Gate>
    </SellerScreen>
  );
}

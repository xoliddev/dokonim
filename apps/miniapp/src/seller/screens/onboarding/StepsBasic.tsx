/** Wizard steps 1–2: name + live slug check, business type tiles. */
import { useEffect, useState } from 'react';
import { m } from 'motion/react';
import { BUSINESS_TYPES, checkStoreSlug, type BusinessType } from '@dokonim/core';
import type { MessageKey } from '@dokonim/i18n';
import { useQuery } from '../../../api/provider';
import { useI18n } from '../../../i18n';
import { spring } from '../../../motion';
import { haptic } from '../../../telegram/shim';
import { Chip, Input } from '../../../ui';
import { ART_FOR, artImage } from '../../lib/art';
import { SIcon } from '../../components/SIcon';
import { withName, withSlug, withType, type WizardDraft } from './draft';

type Set = (fn: (d: WizardDraft) => WizardDraft) => void;

/** Debounced `stores.slugAvailable`; reports free/taken to the wizard. */
export function useSlugCheck(slug: string): { checking: boolean; free: boolean | null; problem: string | null; suggestions: string[] } {
  const [debounced, setDebounced] = useState(slug);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(slug), 320);
    return () => clearTimeout(id);
  }, [slug]);
  const local = checkStoreSlug(slug);
  const q = useQuery('stores.slugAvailable', !local && debounced === slug && slug ? { slug } : null, { staleMs: 5_000 });
  if (!slug) return { checking: false, free: null, problem: null, suggestions: [] };
  if (local) return { checking: false, free: false, problem: local, suggestions: [] };
  if (debounced !== slug || q.loading || !q.data) return { checking: true, free: null, problem: null, suggestions: [] };
  const d = q.data as { available: boolean; problem: string | null; suggestions: string[] };
  return { checking: false, free: d.available, problem: d.problem, suggestions: d.suggestions ?? [] };
}

export function StepName({ d, set, check }: { d: WizardDraft; set: Set; check: ReturnType<typeof useSlugCheck> }) {
  const { t } = useI18n();
  const nameErr = d.name.length > 0 && d.name.trim().length < 2 ? t('seller.wzNameShort') : undefined;
  return (
    <div className="wz-step-body">
      <Input label={t('seller.wzName')} placeholder={t('seller.wzNamePh')} value={d.name} maxLength={60} autoFocus error={nameErr} onChange={(e) => set((x) => withName(x, e.target.value))} />
      <Input
        label={t('seller.wzSlug')}
        prefix="startapp="
        value={d.slug}
        inputMode="url"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        onChange={(e) => set((x) => withSlug(x, e.target.value))}
      />
      <div className="wz-slug-status" aria-live="polite">
        {check.checking && (
          <span className="wz-slug-line is-wait">
            <span className="wz-dot-spin" /> {t('seller.wzSlugChecking')}
          </span>
        )}
        {!check.checking && check.free === true && (
          <m.span className="wz-slug-line is-ok" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
            <SIcon name="check" size={18} /> {t('seller.wzSlugFree')}
          </m.span>
        )}
        {!check.checking && check.free === false && (
          <m.span className="wz-slug-line is-bad" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }}>
            <SIcon name="alert" size={18} /> {t(`seller.wzSlug_${check.problem ?? 'taken'}` as MessageKey)}
          </m.span>
        )}
        {!check.checking && check.suggestions.length > 0 && (
          <div className="wz-suggest">
            <span className="muted">{t('seller.wzSlugTry')}</span>
            {check.suggestions.map((s) => (
              <Chip key={s} onClick={() => set((x) => withSlug(x, s))}>
                {s}
              </Chip>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function StepType({ d, set }: { d: WizardDraft; set: Set }) {
  const { t } = useI18n();
  return (
    <div className="wz-types" role="radiogroup" aria-label={t('seller.wzTypeTitle')}>
      {BUSINESS_TYPES.map((bt: BusinessType, i) => {
        const on = d.businessType === bt;
        return (
          <m.button
            key={bt}
            type="button"
            role="radio"
            aria-checked={on}
            className={`wz-type${on ? ' is-on' : ''}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring.snappy, delay: i * 0.03 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => {
              haptic.selection();
              set((x) => withType(x, bt));
            }}
          >
            <img className="wz-type-art" src={artImage(ART_FOR[bt]![0]!, on ? undefined : '#c9bfae', 'ikat')} alt="" />
            <span className="wz-type-name">{t(`seller.bt_${bt}` as MessageKey)}</span>
            <span className="wz-type-hint">{t(`seller.btHint_${bt}` as MessageKey)}</span>
            {on && (
              <m.span className="wz-type-check" layoutId="wz-type-check" transition={spring.bouncy}>
                <SIcon name="check" size={16} />
              </m.span>
            )}
          </m.button>
        );
      })}
    </div>
  );
}

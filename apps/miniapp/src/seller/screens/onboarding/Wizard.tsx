/**
 * Create-store wizard (§6.4): name & slug → business type → brand (live storefront preview) → first product →
 * payments → done (link + QR). Steps slide in the travel direction; the MainButton drives "Next" / "Create".
 */
import { useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { invalidate, useMutation } from '../../../api/provider';
import { useI18n } from '../../../i18n';
import { dur, ease, spring, useMotionTier } from '../../../motion';
import type { RouteProps } from '../../../router/router';
import { back } from '../../../router/router';
import { haptic, useBackButton, useMainButton } from '../../../telegram/shim';
import { toastError } from '../../lib/errors';
import { StorefrontPreview } from '../../components/StorefrontPreview';
import { createInput, draftTokens, initialDraft, STEPS, stepValid, type WizardDraft } from './draft';
import { StepName, StepType, useSlugCheck } from './StepsBasic';
import { StepBrand, StepFirst, StepPay } from './StepsBrand';
import { Done } from './Done';
import '../../seller.css';
import './wizard.css';

export default function Wizard({ params }: RouteProps) {
  const { t, locale } = useI18n();
  const tier = useMotionTier();
  const [d, setD] = useState<WizardDraft>(initialDraft);
  const [i, setI] = useState(0);
  const [dir, setDir] = useState(1);
  const [created, setCreated] = useState<{ slug: string; name: string } | null>(null);
  const create = useMutation('stores.create', { invalidates: ['me.', 'store.'] });
  const check = useSlugCheck(d.slug);
  const step = STEPS[i]!;
  const valid = stepValid(step, d, check.free);
  const last = i === STEPS.length - 1;
  const set = (fn: (x: WizardDraft) => WizardDraft) => setD(fn);

  const go = (to: number) => {
    setDir(to > i ? 1 : -1);
    setI(to);
    haptic.selection();
  };

  const submit = async () => {
    try {
      const r = await create.run(createInput(d, locale));
      const s = (r as { store: { slug: string } }).store;
      haptic.notify('success');
      invalidate('me.');
      setCreated({ slug: s.slug, name: d.name.trim() });
    } catch (e) {
      toastError(e, t);
      if ((e as { code?: string }).code === 'SLUG_TAKEN') go(0);
    }
  };

  useBackButton(created ? null : i > 0 ? () => go(i - 1) : () => back(params.slug && params.slug !== 'new' ? `/m/${params.slug}` : '/'));
  useMainButton(
    created
      ? null
      : {
          text: last ? t('seller.wzCreate') : step === 'first' && !d.first.title.trim() ? t('seller.wzSkip') : t('common.next'),
          disabled: !valid || create.loading,
          progress: create.loading,
          shine: last && valid,
          onClick: () => (last ? void submit() : go(i + 1)),
        },
  );

  if (created) return <Done slug={created.slug} name={created.name} tokens={draftTokens(d)} logoUrl={d.logoUrl} businessType={d.businessType} />;

  const titles = { name: t('seller.wzNameTitle'), type: t('seller.wzTypeTitle'), brand: t('seller.wzBrandTitle'), first: t('seller.wzFirstTitle'), pay: t('seller.wzPayTitle') };
  const hints = { name: t('seller.wzNameHint'), type: t('seller.wzTypeHint'), brand: t('seller.wzBrandHint'), first: t('seller.wzFirstHint'), pay: t('seller.wzPayHint') };
  const slide = tier === 'minimal' ? 0 : 36;
  const showPreview = step === 'brand' || step === 'first' || step === 'type';

  return (
    <div className="sl-screen wz">
      <div className="sl-body wz-body">
        <div className="wz-progress" aria-label={t('seller.wzStep', { n: i + 1, total: STEPS.length })}>
          {STEPS.map((s, k) => (
            <span key={s} className="wz-progress-seg">
              {k <= i && <m.span className="wz-progress-fill" initial={k === i ? { scaleX: 0 } : false} animate={{ scaleX: 1 }} transition={{ duration: dur.lg, ease: ease.decel }} />}
            </span>
          ))}
        </div>
        <div className="sl-kicker">{t('seller.wzTitle')} · {t('seller.wzStep', { n: i + 1, total: STEPS.length })}</div>
        <AnimatePresence mode="wait" initial={false} custom={dir}>
          <m.div
            key={step}
            className="wz-step"
            initial={{ opacity: 0, x: dir * slide }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -dir * slide }}
            transition={tier === 'minimal' ? { duration: dur.sm } : spring.snappy}
          >
            <h1 className="sl-title wz-title">{titles[step]}</h1>
            <p className="muted wz-hint">{hints[step]}</p>
            {step === 'name' && <StepName d={d} set={set} check={check} />}
            {step === 'type' && <StepType d={d} set={set} />}
            {step === 'brand' && <StepBrand d={d} set={set} />}
            {step === 'first' && <StepFirst d={d} set={set} />}
            {step === 'pay' && <StepPay d={d} set={set} />}
          </m.div>
        </AnimatePresence>
        {showPreview && (
          <m.div className="wz-preview" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={spring.sheet}>
            <span className="sl-kicker">{t('seller.preview')}</span>
            <StorefrontPreview tokens={draftTokens(d)} name={d.name || t('seller.wzNamePh')} logoUrl={d.logoUrl} businessType={d.businessType} />
          </m.div>
        )}
      </div>
    </div>
  );
}

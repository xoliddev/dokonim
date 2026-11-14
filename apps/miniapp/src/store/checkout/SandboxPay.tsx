/**
 * Sandbox payment sheet (§11.4): a neutral card form, clearly striped "SANDBOX — no real money", with the
 * provider's test scenarios. "Pay" drives the real protocol handlers through `sandbox.pay`; failures offer
 * a retry (new payment attempt) or paying later from the order page.
 */
import { useState } from 'react';
import { useApi } from '../../api';
import type { MessageKey } from '../../i18n';
import { useI18n } from '../../i18n';
import { shake } from '../../motion';
import { haptic } from '../../telegram/shim';
import { Button, Icon, Sheet } from '../../ui';

const SCENARIOS: Record<string, string[]> = {
  payme: ['success', 'insufficient_funds', 'timeout'],
  click: ['success', 'user_cancelled'],
  uzum: ['success', 'reversed'],
  stars: ['success'],
  telegram: ['success'],
};

export interface SandboxTarget {
  provider: string;
  paymentId: string;
  orderId: string;
  amount: number;
  currency: 'UZS' | 'XTR';
}

export function SandboxPay({ slug, target, onPaid, onLater, onClose }: { slug: string; target: SandboxTarget | null; onPaid: () => void; onLater: () => void; onClose: () => void }) {
  const { t, money } = useI18n();
  const { api } = useApi();
  const [scenario, setScenario] = useState('success');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const provider = target?.provider ?? 'payme';
  const providerName = t(`checkout.pay_${provider}` as MessageKey);
  const scenarios = SCENARIOS[provider] ?? ['success'];
  const amount = target ? (target.currency === 'XTR' ? `${target.amount} ⭐` : money(target.amount)) : '';

  const pay = async (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!target) return;
    const btn = e.currentTarget;
    setBusy(true);
    setFailed(null);
    try {
      let pid = paymentId ?? target.paymentId;
      if (failed !== null || paymentId) {
        // a failed attempt is final on the provider side: open a fresh payment for the same order
        const r = await api['orders.retryPayment']({ slug, id: target.orderId, provider: provider as 'payme' });
        if (r.nextAction.type === 'sandbox') pid = r.nextAction.paymentId;
        setPaymentId(pid);
      }
      const r = await api['sandbox.pay']({ slug, paymentId: pid, scenario });
      if (r.status === 'paid') {
        haptic.notify('success');
        onPaid();
      } else {
        setPaymentId(pid);
        setFailed(t(`checkout.scenario_${scenario}` as MessageKey));
        shake(btn);
      }
    } catch (err) {
      setFailed((err as Error).message || t('checkout.paymentFailed'));
      shake(btn);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={!!target}
      onClose={onClose}
      title={t('checkout.sandboxTitle', { provider: providerName })}
      footer={
        <div className="st-sbx-actions">
          <Button variant="ghost" onClick={onLater} disabled={busy}>
            {t('checkout.payLater')}
          </Button>
          <Button size="lg" block loading={busy} onClick={pay}>
            {failed ? t('checkout.retryPay') : t('checkout.payAmount', { amount })}
          </Button>
        </div>
      }
    >
      <div className="st-sbx">
        <div className="st-sbx-stripe" role="note">
          <Icon name="settings" size={16} /> {t('checkout.sandbox')}
        </div>
        <div className={`st-sbx-card is-${provider}`} aria-hidden="true">
          <span className="st-sbx-brand">{providerName}</span>
          <span className="st-sbx-chip" />
          <span className="st-sbx-pan">8600 •••• •••• {scenario === 'success' ? '0001' : scenario === 'insufficient_funds' ? '0051' : '0099'}</span>
          <span className="st-sbx-amount price">{amount}</span>
        </div>
        <p className="muted st-sbx-hint">{t('checkout.sandboxHint')}</p>
        <div className="st-sbx-list" role="radiogroup">
          {scenarios.map((s) => (
            <label key={s} className={`st-sbx-opt${scenario === s ? ' is-on' : ''}`}>
              <input type="radio" name="scenario" value={s} checked={scenario === s} onChange={() => (haptic.selection(), setScenario(s))} />
              <span>{t(`checkout.scenario_${s}` as MessageKey)}</span>
              <code>{s}</code>
            </label>
          ))}
        </div>
        {failed && (
          <p className="st-sbx-error" role="alert">
            {t('checkout.paymentFailed')}: {failed}
          </p>
        )}
      </div>
    </Sheet>
  );
}

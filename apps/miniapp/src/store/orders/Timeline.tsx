/**
 * Order status timeline (Uzum-style stages): the canonical path for the order's payment and fulfilment,
 * with real timestamps from order events; the current step pulses, terminal states replace the tail.
 */
import type { MessageKey } from '../../i18n';
import { useI18n } from '../../i18n';
import { Icon } from '../../ui';
import type { OrderEventRow } from '../lib/types';

export function stepsFor(status: string, paymentMethod: string, fulfilment: 'delivery' | 'pickup', events: OrderEventRow[]): string[] {
  const prepaid = !['cod', 'bank_transfer'].includes(paymentMethod);
  const head = prepaid ? ['pending_payment', 'paid'] : ['awaiting_confirmation'];
  const tail = fulfilment === 'pickup' ? ['ready_for_pickup', 'delivered'] : ['shipped', 'delivered'];
  const steps = [...head, 'confirmed', 'packing', ...tail];
  const seen = new Set(events.map((e) => e.toStatus).filter(Boolean) as string[]);
  if (['cancelled', 'returned', 'return_requested'].includes(status)) {
    const reached = steps.filter((s) => seen.has(s));
    return [...(reached.length ? reached : [steps[0]!]), ...(status === 'returned' ? ['return_requested', 'returned'] : [status])].filter((s, i, a) => a.indexOf(s) === i);
  }
  if (status === 'completed') return [...steps, 'completed'];
  return steps;
}

export function Timeline({ status, paymentMethod, fulfilment, events }: { status: string; paymentMethod: string; fulfilment: 'delivery' | 'pickup'; events: OrderEventRow[] }) {
  const { t, dateTime } = useI18n();
  const steps = stepsFor(status, paymentMethod, fulfilment, events);
  const at = new Map<string, string>();
  for (const e of events) if (e.toStatus) at.set(e.toStatus, e.createdAt);
  const cur = steps.indexOf(status);
  const bad = status === 'cancelled' || status === 'returned';
  return (
    <ol className="st-timeline">
      {steps.map((s, i) => {
        const done = i <= cur;
        const now = i === cur && !['delivered', 'completed', 'cancelled', 'returned'].includes(s);
        const when = at.get(s);
        return (
          <li key={s} className={`st-tl-step${done ? ' is-done' : ''}${now ? ' is-now' : ''}${bad && i === cur ? ' is-bad' : ''}`}>
            <span className="st-tl-dot" aria-hidden="true">
              {done && <Icon name={bad && i === cur ? 'close' : 'check'} size={14} />}
            </span>
            <span className="st-tl-text">
              <b>{t(`checkout.status_${s}` as MessageKey)}</b>
              {when && <span className="muted">{dateTime(when)}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

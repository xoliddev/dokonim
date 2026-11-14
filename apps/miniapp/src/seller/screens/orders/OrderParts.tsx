/** Order detail parts: types, the timeline (status events + notes, newest last) and the ship / cancel / refund sheet. */
import { useState } from 'react';
import type { MessageKey } from '@dokonim/i18n';
import { useI18n } from '../../../i18n';
import { Button, Input, Sheet } from '../../../ui';

export interface Detail {
  id: string;
  number: number;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  fulfilmentKind: 'delivery' | 'pickup';
  subtotal: number;
  discountTotal: number;
  shippingTotal: number;
  total: number;
  contact: { name: string; phone: string };
  shippingAddress: { regionCode?: string; district?: string; line1?: string } | null;
  shippingMethodName: Record<string, string> | null;
  note: string;
  placedAt: string;
  items: Array<{ id: string; title: string; variantTitle: string; sku: string; imageUrl: string | null; unitPrice: number; qty: number; lineTotal: number }>;
  events: Array<{ type: string; fromStatus: string | null; toStatus: string | null; actor: string; data: Record<string, unknown> | null; createdAt: string }>;
  payments: Array<{ provider: string; mode: string; status: string; amount: number }>;
  notes: Array<{ data: { text?: string; author?: string }; createdAt: string }>;
  allowed: string[];
  canManage: boolean;
}

export function Timeline({ events, notes }: { events: Detail['events']; notes: Detail['notes'] }) {
  const { t, dateTime } = useI18n();
  const rows = [
    ...events.filter((e) => e.type !== 'note').map((e) => ({ at: e.createdAt, kind: 'status' as const, e })),
    ...notes.map((n) => ({ at: n.createdAt, kind: 'note' as const, n })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  return (
    <ol className="od-tl">
      {rows.map((r, i) => (
        <li key={i} className={`od-tl-item is-${r.kind}${i === rows.length - 1 ? ' is-last' : ''}`}>
          <span className="od-tl-dot" />
          <div className="od-tl-body">
            {r.kind === 'status' ? (
              <strong>{r.e.toStatus ? t(`checkout.status_${r.e.toStatus}` as MessageKey) : t('seller.ev_status')}</strong>
            ) : (
              <>
                <strong>{t('seller.ev_note')}</strong>
                <span className="od-tl-note">{r.n.data?.text}</span>
              </>
            )}
            <span className="od-tl-meta">
              {dateTime(r.at)}
              {r.kind === 'status' && r.e.actor ? ` · ${t(`seller.actor_${r.e.actor}` as MessageKey)}` : r.kind === 'note' && r.n.data?.author ? ` · ${r.n.data.author}` : ''}
              {r.kind === 'status' && typeof r.e.data?.trackingNumber === 'string' ? ` · ${r.e.data.trackingNumber}` : ''}
              {r.kind === 'status' && typeof r.e.data?.reason === 'string' && r.e.data.reason ? ` · ${r.e.data.reason}` : ''}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function ActionSheet({ kind, busy, onClose, onShip, onCancel, onRefund }: { kind: null | 'ship' | 'cancel' | 'refund' | 'reject_return'; busy: boolean; onClose: () => void; onShip: (x: { trackingNumber?: string; carrier?: string }) => void; onCancel: (reason: string) => void; onRefund: (reason: string) => void }) {
  const { t } = useI18n();
  const title = kind === 'ship' ? t('seller.ordShipTitle') : kind === 'refund' ? t('seller.ordRefundTitle') : kind === 'reject_return' ? t('seller.act_reject_return') : t('seller.ordCancelTitle');
  return (
    <Sheet open={!!kind} onClose={onClose} title={title}>
      {kind && <Body key={kind} kind={kind} busy={busy} onClose={onClose} onShip={onShip} onCancel={onCancel} onRefund={onRefund} />}
    </Sheet>
  );
}

function Body({ kind, busy, onClose, onShip, onCancel, onRefund }: { kind: 'ship' | 'cancel' | 'refund' | 'reject_return'; busy: boolean; onClose: () => void; onShip: (x: { trackingNumber?: string; carrier?: string }) => void; onCancel: (reason: string) => void; onRefund: (reason: string) => void }) {
  const { t } = useI18n();
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const go = () => (kind === 'ship' ? onShip({ ...(a.trim() ? { trackingNumber: a.trim() } : {}), ...(b.trim() ? { carrier: b.trim() } : {}) }) : kind === 'refund' ? onRefund(a.trim()) : onCancel(a.trim()));
  return (
    <div className="sl-form">
      {kind === 'ship' ? (
        <>
          <Input label={t('seller.trackingNumber')} value={a} maxLength={60} autoFocus onChange={(e) => setA(e.target.value)} hint={t('common.optional')} />
          <Input label={t('seller.ordCarrier')} value={b} maxLength={60} placeholder="Uzpost, Yandex, BTS…" onChange={(e) => setB(e.target.value)} />
        </>
      ) : (
        <>
          <p className="sl-confirm-body">{kind === 'refund' ? t('seller.ordRefundBody') : kind === 'cancel' ? t('seller.ordCancelBody') : ''}</p>
          <Input label={t('seller.ordReason')} value={a} maxLength={200} onChange={(e) => setA(e.target.value)} />
        </>
      )}
      <div className="sl-sheet-actions">
        <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant={kind === 'ship' ? 'primary' : 'danger'} loading={busy} onClick={go}>
          {kind === 'ship' ? t('seller.act_ship') : kind === 'refund' ? t('seller.refund') : kind === 'reject_return' ? t('seller.act_reject_return') : t('seller.act_cancel')}
        </Button>
      </div>
    </div>
  );
}

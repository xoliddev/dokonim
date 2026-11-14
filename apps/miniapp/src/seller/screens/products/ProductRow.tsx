/** Product list row (thumbnail morphs into the editor hero) + the bulk "adjust price %" sheet. */
import { useState } from 'react';
import { m } from 'motion/react';
import type { MessageKey } from '@dokonim/i18n';
import { useI18n } from '../../../i18n';
import { MorphMedia, spring, staggerDelay, useMotionTier } from '../../../motion';
import { Button, Input, Sheet } from '../../../ui';
import { SIcon } from '../../components/SIcon';

export interface ListItem {
  id: string;
  status: 'active' | 'draft' | 'archived';
  title: Record<string, string>;
  coverUrl: string | null;
  minPrice: number;
  maxPrice: number;
  maxCompareAt: number | null;
  inStock: boolean;
  available: number;
  variantCount: number;
}

const TONE = { active: 'is-good', draft: 'is-muted', archived: 'is-bad' } as const;

export function ProductRow({ p, index, selecting, selected, onToggle, onOpen }: { p: ListItem; index: number; selecting: boolean; selected: boolean; onToggle: () => void; onOpen: () => void }) {
  const { t, l, money } = useI18n();
  const tier = useMotionTier();
  const price = p.minPrice === p.maxPrice ? money(p.minPrice) : `${money(p.minPrice)} – ${money(p.maxPrice)}`;
  return (
    <m.button
      type="button"
      className={`sl-row pl-row${selected ? ' is-selected' : ''}`}
      initial={tier === 'minimal' ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring.snappy, delay: staggerDelay(index) }}
      aria-pressed={selecting ? selected : undefined}
      onClick={selecting ? onToggle : onOpen}
    >
      {selecting && (
        <span className={`pl-check${selected ? ' is-on' : ''}`} aria-hidden="true">
          {selected && <SIcon name="check" size={16} />}
        </span>
      )}
      {p.coverUrl ? <MorphMedia id={p.id} src={p.coverUrl} alt="" className="sl-thumb pl-thumb" radius={10} /> : <span className="sl-thumb pl-thumb pl-thumb-empty"><SIcon name="image" size={20} /></span>}
      <span className="sl-row-main">
        <span className="sl-row-title">{l(p.title) || '—'}</span>
        <span className="sl-row-sub">
          <span className="price">{price}</span>
          {p.maxCompareAt ? <s className="pl-was">{money(p.maxCompareAt)}</s> : null}
        </span>
        <span className="pl-meta">
          <span className={`sl-pill ${TONE[p.status]}`}>{t(`seller.status_${p.status}` as MessageKey)}</span>
          <span className={p.available <= 0 && !p.inStock ? 'pl-out' : 'pl-stock'}>{p.inStock || p.available > 0 ? t('seller.stockN', { n: Math.max(0, p.available) }) : t('seller.soldOut')}</span>
          {p.variantCount > 1 && <span className="pl-stock">· {t('seller.variantsCount', { n: p.variantCount })}</span>}
        </span>
      </span>
      {!selecting && <SIcon name="chevron-right" size={18} className="pl-chev" />}
    </m.button>
  );
}

export function PercentSheet({ open, busy, onClose, onApply }: { open: boolean; busy: boolean; onClose: () => void; onApply: (p: number) => void }) {
  const { t } = useI18n();
  const [v, setV] = useState('');
  const n = Number(v.replace(',', '.').replace('−', '-'));
  const bad = v !== '' && (!Number.isFinite(n) || n <= -100 || n > 1000 || n === 0);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('seller.bulkPriceTitle')}
      footer={
        <div className="sl-sheet-actions">
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button loading={busy} disabled={!v || bad} onClick={() => onApply(n)}>{t('common.apply')}</Button>
        </div>
      }
    >
      <div className="sl-form">
        <Input label={t('seller.bulkPriceLabel')} inputMode="numeric" value={v} suffix="%" hint={bad ? undefined : t('seller.bulkPriceHint')} error={bad ? t('seller.bulkPriceBad') : undefined} onChange={(e) => setV(e.target.value)} />
        <div className="sl-chips">
          {[-20, -10, -5, 5, 10].map((x) => (
            <button key={x} type="button" className="chip" onClick={() => setV(String(x))}>{x > 0 ? `+${x}` : x}%</button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

/** Order status → tone + tab bucket (same buckets the API's `admin.orders.list` understands). */
export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'muted';

export const STATUS_TONE: Record<string, Tone> = {
  pending_payment: 'muted',
  awaiting_confirmation: 'warn',
  paid: 'warn',
  confirmed: 'info',
  packing: 'info',
  shipped: 'info',
  ready_for_pickup: 'info',
  delivered: 'good',
  completed: 'good',
  cancelled: 'bad',
  return_requested: 'warn',
  returned: 'bad',
};

export type Bucket = 'attention' | 'active' | 'done' | 'closed' | 'pending';

export const BUCKETS: Record<Bucket, string[]> = {
  attention: ['paid', 'awaiting_confirmation', 'return_requested'],
  active: ['confirmed', 'packing', 'shipped', 'ready_for_pickup'],
  done: ['delivered', 'completed'],
  closed: ['cancelled', 'returned'],
  pending: ['pending_payment'],
};

export function bucketCount(counts: Record<string, number> | undefined, b: Bucket): number {
  if (!counts) return 0;
  return BUCKETS[b].reduce((n, s) => n + (counts[s] ?? 0), 0);
}

export const toneClass = (status: string) => `sl-pill is-${STATUS_TONE[status] ?? 'muted'}`;

/**
 * `startapp` payload grammar (§6.1), ≤ 64 chars of [A-Za-z0-9_-]:
 *   <slug> | <slug>-p-<productShortId> | <slug>-c-<campaign> | <slug>-o-<orderShortId> | new | m-<slug> | i-<inviteToken>
 * Store slugs may contain '-', so we split on the LAST "-p-/-c-/-o-" marker.
 */
export type StartPayload =
  | { kind: 'hub' }
  | { kind: 'new' }
  | { kind: 'manage'; slug: string }
  | { kind: 'invite'; token: string }
  | { kind: 'store'; slug: string; campaign?: string }
  | { kind: 'product'; slug: string; productShortId: string }
  | { kind: 'order'; slug: string; orderShortId: string };

const OK = /^[A-Za-z0-9_-]{1,64}$/;

export function parseStartParam(raw: string | null | undefined): StartPayload {
  if (!raw || !OK.test(raw)) return { kind: 'hub' };
  if (raw === 'new') return { kind: 'new' };
  if (raw.startsWith('m-')) return { kind: 'manage', slug: raw.slice(2) };
  if (raw.startsWith('i-')) return { kind: 'invite', token: raw.slice(2) };
  const m = /^(.+)-([pco])-([A-Za-z0-9_]+)$/.exec(raw);
  if (m) {
    const [, slug, k, rest] = m as unknown as [string, string, 'p' | 'c' | 'o', string];
    if (k === 'p') return { kind: 'product', slug, productShortId: rest };
    if (k === 'o') return { kind: 'order', slug, orderShortId: rest };
    return { kind: 'store', slug, campaign: rest };
  }
  return { kind: 'store', slug: raw };
}

export function buildStartParam(p: StartPayload): string {
  switch (p.kind) {
    case 'hub':
      return '';
    case 'new':
      return 'new';
    case 'manage':
      return `m-${p.slug}`;
    case 'invite':
      return `i-${p.token}`;
    case 'store':
      return p.campaign ? `${p.slug}-c-${p.campaign}` : p.slug;
    case 'product':
      return `${p.slug}-p-${p.productShortId}`;
    case 'order':
      return `${p.slug}-o-${p.orderShortId}`;
  }
}

export function campaignTag(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').slice(0, 24);
}

export function miniAppLink(botUsername: string, appName: string, payload: StartPayload): string {
  const sp = buildStartParam(payload);
  return `https://t.me/${botUsername}/${appName}${sp ? `?startapp=${sp}` : ''}`;
}

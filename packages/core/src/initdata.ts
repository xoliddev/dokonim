/**
 * Telegram Mini App initData validation (§14.3):
 *   secret = HMAC_SHA256(key = "WebAppData", msg = bot_token)
 *   hash   = hex(HMAC_SHA256(key = secret, msg = data_check_string))
 * data_check_string = "key=value" lines sorted by key, excluding `hash` (and `signature`, which is
 * the Ed25519 third-party field). The demo signs its mock initData with the same function.
 */
import { hmacSha256, timingSafeEqual, toHex } from './crypto';
import { DomainError } from './errors';

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
  is_premium?: boolean;
}

export interface InitData {
  user: TelegramUser;
  authDate: Date;
  queryId?: string;
  startParam?: string;
  chatType?: string;
  raw: Record<string, string>;
}

export function dataCheckString(params: URLSearchParams): string {
  const pairs: string[] = [];
  for (const [k, v] of params) if (k !== 'hash' && k !== 'signature') pairs.push(`${k}=${v}`);
  return pairs.sort().join('\n');
}

async function computeHash(params: URLSearchParams, botToken: string): Promise<string> {
  const secret = await hmacSha256('WebAppData', botToken);
  return toHex(await hmacSha256(secret, dataCheckString(params)));
}

export async function validateInitData(
  initData: string,
  botToken: string,
  opts: { maxAgeSec?: number; now?: Date } = {},
): Promise<InitData> {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new DomainError('UNAUTHENTICATED', 'initData has no hash');
  const expected = await computeHash(params, botToken);
  if (!timingSafeEqual(expected, hash.toLowerCase())) throw new DomainError('UNAUTHENTICATED', 'initData signature mismatch');
  const authDate = new Date(Number(params.get('auth_date') ?? 0) * 1000);
  const maxAge = opts.maxAgeSec ?? 86_400;
  const now = opts.now ?? new Date();
  if (!Number.isFinite(authDate.getTime()) || now.getTime() - authDate.getTime() > maxAge * 1000)
    throw new DomainError('UNAUTHENTICATED', 'initData expired');
  const userRaw = params.get('user');
  if (!userRaw) throw new DomainError('UNAUTHENTICATED', 'initData has no user');
  let user: TelegramUser;
  try {
    user = JSON.parse(userRaw) as TelegramUser;
  } catch {
    throw new DomainError('UNAUTHENTICATED', 'initData user is not JSON');
  }
  if (typeof user.id !== 'number' || !user.first_name) throw new DomainError('UNAUTHENTICATED', 'initData user invalid');
  const raw = Object.fromEntries(params);
  return {
    user,
    authDate,
    queryId: params.get('query_id') ?? undefined,
    startParam: params.get('start_param') ?? undefined,
    chatType: params.get('chat_type') ?? undefined,
    raw,
  };
}

/** Builds signed initData (used by the demo's mocked Telegram environment and by tests). */
export async function signInitData(
  fields: { user: TelegramUser; authDate?: Date; queryId?: string; startParam?: string },
  botToken: string,
): Promise<string> {
  const params = new URLSearchParams();
  params.set('auth_date', String(Math.floor((fields.authDate ?? new Date()).getTime() / 1000)));
  if (fields.queryId) params.set('query_id', fields.queryId);
  if (fields.startParam) params.set('start_param', fields.startParam);
  params.set('user', JSON.stringify(fields.user));
  params.set('hash', await computeHash(params, botToken));
  return params.toString();
}

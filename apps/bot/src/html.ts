/** Escapes text for Telegram's HTML parse_mode (&, <, > and " — the four entities Telegram understands). */
export function escapeHtml(s: string | number): string {
  return String(s).replace(/[&<>"]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'));
}

/** Byte length in UTF-8 (Telegram limits callback_data and inline result ids to 64 bytes). */
export function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}

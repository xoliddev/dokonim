/**
 * Owner content is untrusted (§16.5). Descriptions are a restricted rich-text AST, never HTML.
 * Allowed: paragraphs, headings (h3), bullet/numbered lists, bold/italic marks, links (http/https/tg).
 */
export type Mark = 'b' | 'i';
export interface TextNode {
  t: 'text';
  text: string;
  marks?: Mark[];
  href?: string;
}
export type RichBlock =
  | { t: 'p'; children: TextNode[] }
  | { t: 'h'; children: TextNode[] }
  | { t: 'ul' | 'ol'; items: TextNode[][] };
export interface RichText {
  t: 'doc';
  blocks: RichBlock[];
}

const MAX_TEXT = 20_000;

export function safeHref(href: unknown): string | undefined {
  if (typeof href !== 'string') return undefined;
  const h = href.trim();
  return /^(https?:\/\/|tg:\/\/)[^\s<>"']+$/i.test(h) && h.length < 2048 ? h : undefined;
}

function cleanInline(nodes: unknown): TextNode[] {
  if (!Array.isArray(nodes)) return [];
  const out: TextNode[] = [];
  for (const n of nodes.slice(0, 200)) {
    if (!n || typeof n !== 'object' || (n as TextNode).t !== 'text') continue;
    const text = String((n as TextNode).text ?? '').slice(0, MAX_TEXT);
    if (!text) continue;
    const marks = Array.isArray((n as TextNode).marks)
      ? ((n as TextNode).marks!.filter((m) => m === 'b' || m === 'i') as Mark[])
      : undefined;
    const href = safeHref((n as TextNode).href);
    out.push({ t: 'text', text, ...(marks?.length ? { marks } : {}), ...(href ? { href } : {}) });
  }
  return out;
}

export function sanitizeRichText(input: unknown): RichText {
  const blocks: RichBlock[] = [];
  const src = input && typeof input === 'object' && Array.isArray((input as RichText).blocks) ? (input as RichText).blocks : [];
  for (const b of src.slice(0, 200)) {
    if (!b || typeof b !== 'object') continue;
    if (b.t === 'p' || b.t === 'h') {
      const children = cleanInline(b.children);
      if (children.length) blocks.push({ t: b.t, children });
    } else if (b.t === 'ul' || b.t === 'ol') {
      const items = Array.isArray(b.items) ? b.items.slice(0, 100).map(cleanInline).filter((i) => i.length) : [];
      if (items.length) blocks.push({ t: b.t, items });
    }
  }
  return { t: 'doc', blocks };
}

/** Light markup the owner types: blank line = paragraph, "- " bullets, "1. " numbers, "## " heading, **bold**, _italic_, [text](url). */
export function fromMarkup(src: string): RichText {
  const blocks: RichBlock[] = [];
  const inline = (s: string): TextNode[] => {
    const out: TextNode[] = [];
    const re = /\*\*(.+?)\*\*|_(.+?)_|\[([^\]]+)\]\(([^)\s]+)\)/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      if (m.index > last) out.push({ t: 'text', text: s.slice(last, m.index) });
      if (m[1]) out.push({ t: 'text', text: m[1], marks: ['b'] });
      else if (m[2]) out.push({ t: 'text', text: m[2], marks: ['i'] });
      else if (m[3]) {
        const href = safeHref(m[4]);
        out.push(href ? { t: 'text', text: m[3], href } : { t: 'text', text: m[3] });
      }
      last = m.index + m[0].length;
    }
    if (last < s.length) out.push({ t: 'text', text: s.slice(last) });
    return out;
  };
  for (const chunk of src.replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = chunk.split('\n').filter((l) => l.trim());
    if (!lines.length) continue;
    if (lines.every((l) => /^\s*[-•*]\s+/.test(l))) blocks.push({ t: 'ul', items: lines.map((l) => inline(l.replace(/^\s*[-•*]\s+/, ''))) });
    else if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) blocks.push({ t: 'ol', items: lines.map((l) => inline(l.replace(/^\s*\d+[.)]\s+/, ''))) });
    else if (lines.length === 1 && /^#{1,3}\s+/.test(lines[0]!)) blocks.push({ t: 'h', children: inline(lines[0]!.replace(/^#{1,3}\s+/, '')) });
    else blocks.push({ t: 'p', children: inline(lines.join('\n')) });
  }
  return sanitizeRichText({ t: 'doc', blocks });
}

export function toMarkup(doc: RichText | null | undefined): string {
  if (!doc) return '';
  const inl = (ns: TextNode[]) =>
    ns
      .map((n) => {
        let s = n.text;
        if (n.marks?.includes('b')) s = `**${s}**`;
        if (n.marks?.includes('i')) s = `_${s}_`;
        if (n.href) s = `[${s}](${n.href})`;
        return s;
      })
      .join('');
  return doc.blocks
    .map((b) =>
      b.t === 'p' ? inl(b.children) : b.t === 'h' ? `## ${inl(b.children)}` : b.items.map((it, i) => `${b.t === 'ul' ? '-' : `${i + 1}.`} ${inl(it)}`).join('\n'),
    )
    .join('\n\n');
}

export function toPlainText(doc: RichText | null | undefined): string {
  if (!doc) return '';
  const inl = (ns: TextNode[]) => ns.map((n) => n.text).join('');
  return doc.blocks.map((b) => (b.t === 'p' || b.t === 'h' ? inl(b.children) : b.items.map(inl).join('\n'))).join('\n\n');
}

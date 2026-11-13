/**
 * Nested categories: adjacency list (parent_id) + materialised ltree path.
 * Labels are 'c' + uuid-without-dashes, so renames never touch paths and moves rewrite one prefix.
 * These pure functions are the single source of the rules; SQL re-checks them (see packages/db).
 */
import { DomainError } from './errors';

export interface TreeNode {
  id: string;
  parentId: string | null;
  path: string; // ltree text, e.g. "c0190...a.c0190...b"
  slug: string;
  position: number;
}

export const POSITION_STEP = 1024;
export const SOFT_DEPTH_LIMIT = 8;
export const HARD_DEPTH_LIMIT = 64;

export function labelFor(id: string): string {
  return `c${id.replace(/-/g, '').toLowerCase()}`;
}

export function pathFor(parentPath: string | null, id: string): string {
  return parentPath ? `${parentPath}.${labelFor(id)}` : labelFor(id);
}

export function depthOf(path: string): number {
  return path.split('.').length;
}

/** `a <@ b` in ltree: is `a` equal to or a descendant of `b`? */
export function isDescendantOrSelf(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}.`);
}

/**
 * Validates a move. Moving N under P is rejected when P is N or inside N's subtree (would form a cycle).
 * Returns the new path for N.
 */
export function planMove(node: TreeNode, newParent: TreeNode | null, subtreeMaxDepth?: number): { newPath: string } {
  if (newParent && isDescendantOrSelf(newParent.path, node.path)) {
    throw new DomainError('CATEGORY_CYCLE', 'A category cannot be moved inside itself', {
      nodeId: node.id,
      parentId: newParent.id,
    });
  }
  const newPath = pathFor(newParent?.path ?? null, node.id);
  if (subtreeMaxDepth !== undefined) {
    const extra = subtreeMaxDepth - depthOf(node.path);
    if (depthOf(newPath) + extra > HARD_DEPTH_LIMIT) throw new DomainError('CATEGORY_DEPTH');
  }
  return { newPath };
}

/** Rewrites a descendant path after its ancestor moved from oldPrefix to newPrefix. */
export function rebasePath(path: string, oldPrefix: string, newPrefix: string): string {
  if (!isDescendantOrSelf(path, oldPrefix)) return path;
  return newPrefix + path.slice(oldPrefix.length);
}

/**
 * Sibling ordering. Inserting at `index` among ordered siblings: we prefer a midpoint between neighbours,
 * and renumber all siblings in POSITION_STEP increments only when there is no gap left.
 */
export function positionUpdates(
  siblings: Array<{ id: string; position: number }>,
  movedId: string,
  index: number,
): Array<{ id: string; position: number }> {
  const ordered = siblings.filter((s) => s.id !== movedId).sort((a, b) => a.position - b.position);
  const i = Math.max(0, Math.min(index, ordered.length));
  const prev = ordered[i - 1]?.position;
  const next = ordered[i]?.position;
  let pos: number | null;
  if (prev === undefined && next === undefined) pos = POSITION_STEP;
  else if (prev === undefined) pos = next! - POSITION_STEP;
  else if (next === undefined) pos = prev + POSITION_STEP;
  else pos = next - prev >= 2 ? Math.floor((prev + next) / 2) : null;
  if (pos !== null) return [{ id: movedId, position: pos }];
  const all = [...ordered];
  all.splice(i, 0, { id: movedId, position: 0 });
  return all.map((s, k) => ({ id: s.id, position: (k + 1) * POSITION_STEP }));
}

export function nextPosition(siblings: Array<{ position: number }>): number {
  return siblings.reduce((m, s) => Math.max(m, s.position), 0) + POSITION_STEP;
}

export interface TreeView<T extends TreeNode = TreeNode> {
  node: T;
  children: TreeView<T>[];
  depth: number;
}

export function buildTree<T extends TreeNode>(nodes: T[]): TreeView<T>[] {
  const byParent = new Map<string | null, T[]>();
  for (const n of nodes) {
    const k = n.parentId;
    const arr = byParent.get(k) ?? [];
    arr.push(n);
    byParent.set(k, arr);
  }
  const build = (parentId: string | null, depth: number): TreeView<T>[] =>
    (byParent.get(parentId) ?? [])
      .sort((a, b) => a.position - b.position || a.slug.localeCompare(b.slug))
      .map((node) => ({ node, depth, children: build(node.id, depth + 1) }));
  return build(null, 1);
}

export function flattenTree<T extends TreeNode>(tree: TreeView<T>[]): Array<TreeView<T>> {
  const out: TreeView<T>[] = [];
  const walk = (ts: TreeView<T>[]) => {
    for (const t of ts) {
      out.push(t);
      walk(t.children);
    }
  };
  walk(tree);
  return out;
}

/** Ancestors from root to the node itself. */
export function breadcrumbs<T extends TreeNode>(node: T, byId: Map<string, T>): T[] {
  const out: T[] = [];
  const labels = node.path.split('.');
  const byLabel = new Map<string, T>();
  for (const n of byId.values()) byLabel.set(labelFor(n.id), n);
  for (const l of labels) {
    const n = byLabel.get(l);
    if (n) out.push(n);
  }
  return out;
}

/** Resolve "kiyim/ayollar/koylaklar" by walking sibling slugs from the root. */
export function resolveSlugPath<T extends TreeNode>(nodes: T[], slugs: string[]): T[] | null {
  const chain: T[] = [];
  let parent: string | null = null;
  for (const s of slugs) {
    const found = nodes.find((n) => n.parentId === parent && n.slug === s);
    if (!found) return null;
    chain.push(found);
    parent = found.id;
  }
  return chain;
}

export function slugPathOf<T extends TreeNode>(node: T, byId: Map<string, T>): string[] {
  return breadcrumbs(node, byId).map((n) => n.slug);
}

export type DeleteStrategy =
  | { kind: 'reparent_children' }
  | { kind: 'reassign_products'; targetId: string }
  | { kind: 'archive_subtree' };

/** Make a sibling-unique slug ("koylak", "koylak-2", …). */
export function uniqueSiblingSlug(base: string, siblingSlugs: Iterable<string>): string {
  const taken = new Set(siblingSlugs);
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const c = `${base}-${i}`;
    if (!taken.has(c)) return c;
  }
}

/** Invariant check used by tests and the DB parity suite. */
export function verifyTree(nodes: TreeNode[]): string[] {
  const errors: string[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    const parent = n.parentId ? byId.get(n.parentId) : null;
    if (n.parentId && !parent) errors.push(`${n.id}: missing parent`);
    const expected = pathFor(parent?.path ?? null, n.id);
    if (n.path !== expected) errors.push(`${n.id}: path ${n.path} != ${expected}`);
    // cycle: walk up at most nodes.length steps
    let cur: TreeNode | undefined = n;
    for (let i = 0; cur && i <= nodes.length; i++) cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    if (cur) errors.push(`${n.id}: cycle`);
  }
  return errors;
}

/**
 * Category tree editor state — pure functions (unit-tested in test/seller-tree.test.ts).
 *
 * The server tree (`admin.categories.tree`) is nested; the editor renders a flattened list of the *visible* rows
 * (collapsed subtrees skipped, search shows matches with their ancestors). Moves are applied locally first
 * (optimistic) with the same rules the server enforces: no cycles, `index` = position among new siblings.
 */
export interface CatNode {
  id: string;
  parentId: string | null;
  name: Record<string, string | undefined>;
  slug: string;
  isHidden: boolean;
  productCount: number;
  subtreeCount: number;
  children: CatNode[];
}

export interface Row<N extends CatNode = CatNode> {
  node: N;
  depth: number; // 0 = root level
  index: number; // position among siblings
  siblings: number;
  hasChildren: boolean;
  expanded: boolean;
  /** Ancestor ids, root first. */
  trail: string[];
}

export function walk<N extends CatNode>(nodes: N[], fn: (n: N, depth: number, trail: string[]) => void, depth = 0, trail: string[] = []) {
  for (const n of nodes) {
    fn(n, depth, trail);
    walk(n.children as N[], fn, depth + 1, [...trail, n.id]);
  }
}

export function findNode<N extends CatNode>(nodes: N[], id: string | null): N | null {
  if (!id) return null;
  let hit: N | null = null;
  walk(nodes, (n) => {
    if (n.id === id) hit = n;
  });
  return hit;
}

/** Root-first chain of nodes from the top level down to `id` itself (breadcrumbs). */
export function pathTo<N extends CatNode>(nodes: N[], id: string | null): N[] {
  if (!id) return [];
  const stack: N[] = [];
  const go = (list: N[]): boolean => {
    for (const n of list) {
      stack.push(n);
      if (n.id === id || go(n.children as N[])) return true;
      stack.pop();
    }
    return false;
  };
  return go(nodes) ? stack : [];
}

export function subtreeIds(node: CatNode): Set<string> {
  const out = new Set<string>([node.id]);
  walk(node.children, (n) => out.add(n.id));
  return out;
}

export function countDescendants(node: CatNode): number {
  return subtreeIds(node).size - 1;
}

export function maxDepth(nodes: CatNode[]): number {
  let d = 0;
  walk(nodes, (_, depth) => (d = Math.max(d, depth + 1)));
  return d;
}

const matches = (n: CatNode, q: string) => Object.values(n.name).some((v) => v?.toLowerCase().includes(q)) || n.slug.includes(q);

/** Visible rows for rendering. With a query: matches + their ancestors, everything on the path expanded. */
export function visibleRows<N extends CatNode>(nodes: N[], expanded: ReadonlySet<string>, query = ''): Row<N>[] {
  const q = query.trim().toLowerCase();
  let keep: Set<string> | null = null;
  if (q) {
    const k = new Set<string>();
    walk(nodes, (n, _d, trail) => {
      if (matches(n, q)) {
        k.add(n.id);
        trail.forEach((id) => k.add(id));
      }
    });
    keep = k;
  }
  const out: Row<N>[] = [];
  const go = (list: N[], depth: number, trail: string[]) => {
    const shown = keep ? list.filter((n) => keep!.has(n.id)) : list;
    shown.forEach((n, index) => {
      const kids = n.children as N[];
      const open = keep ? kids.some((c) => keep!.has(c.id)) : expanded.has(n.id);
      out.push({ node: n, depth, index, siblings: shown.length, hasChildren: kids.length > 0, expanded: open && kids.length > 0, trail });
      if (open) go(kids, depth + 1, [...trail, n.id]);
    });
  };
  go(nodes, 0, []);
  return out;
}

/** Can `id` be moved under `parentId`? (not into itself or its own subtree) */
export function canMoveTo(nodes: CatNode[], id: string, parentId: string | null): boolean {
  if (parentId === null) return true;
  const node = findNode(nodes, id);
  if (!node) return false;
  return !subtreeIds(node).has(parentId);
}

const clone = <N extends CatNode>(nodes: N[]): N[] => nodes.map((n) => ({ ...n, children: clone(n.children as N[]) }));

function detach<N extends CatNode>(nodes: N[], id: string): { tree: N[]; node: N | null; from: { parentId: string | null; index: number } | null } {
  const tree = clone(nodes);
  let node: N | null = null;
  let from: { parentId: string | null; index: number } | null = null;
  const go = (list: N[], parentId: string | null): boolean => {
    const i = list.findIndex((n) => n.id === id);
    if (i >= 0) {
      node = list.splice(i, 1)[0]!;
      from = { parentId, index: i };
      return true;
    }
    return list.some((n) => go(n.children as N[], n.id));
  };
  go(tree, null);
  return { tree, node, from };
}

function childrenOf<N extends CatNode>(tree: N[], parentId: string | null): N[] | null {
  if (parentId === null) return tree;
  const p = findNode(tree, parentId);
  return p ? (p.children as N[]) : null;
}

/** Optimistic move: same semantics as `admin.categories.move` (index among the new siblings, clamped). */
export function moveNode<N extends CatNode>(nodes: N[], id: string, parentId: string | null, index: number): N[] {
  if (!canMoveTo(nodes, id, parentId)) throw new Error('CATEGORY_CYCLE');
  const { tree, node } = detach(nodes, id);
  if (!node) return nodes;
  const list = childrenOf(tree, parentId);
  if (!list) return nodes;
  const at = Math.max(0, Math.min(index, list.length));
  list.splice(at, 0, { ...(node as N), parentId } as N);
  return tree;
}

export type DeleteKind = 'reparent_children' | 'reassign_products' | 'archive_subtree';

/** Optimistic delete. reparent: children take the node's place in its parent; otherwise the subtree goes. */
export function deleteNode<N extends CatNode>(nodes: N[], id: string, kind: DeleteKind): N[] {
  const { tree, node, from } = detach(nodes, id);
  if (!node || !from) return nodes;
  if (kind === 'reparent_children') {
    const list = childrenOf(tree, from.parentId)!;
    const kids = (node as N).children.map((c) => ({ ...c, parentId: from!.parentId })) as N[];
    list.splice(from.index, 0, ...kids);
  }
  return tree;
}

export type DropZone = 'before' | 'inside' | 'after';

/** Zone inside a hovered row from the pointer's offset (0..1 of the row height). */
export function zoneOf(offset: number, allowInside = true): DropZone {
  if (!allowInside) return offset < 0.5 ? 'before' : 'after';
  return offset < 0.28 ? 'before' : offset > 0.72 ? 'after' : 'inside';
}

/**
 * Resolves a drop on visible row `overIndex` into `{ parentId, index }` for the move API, or null when the drop is
 * a no-op or would create a cycle. Indices are computed *after* removing the dragged node from its siblings.
 */
export function resolveDrop<N extends CatNode>(rows: Row<N>[], draggedId: string, overIndex: number, zone: DropZone, nodes: N[]): { parentId: string | null; index: number } | null {
  const over = rows[overIndex];
  if (!over || over.node.id === draggedId) return null;
  if (over.trail.includes(draggedId)) return null; // dropping into own subtree
  let parentId: string | null;
  let index: number;
  if (zone === 'inside') {
    parentId = over.node.id;
    index = over.node.children.filter((c) => c.id !== draggedId).length; // append as last child
  } else {
    parentId = over.trail.at(-1) ?? null;
    const sibs = (childrenOf(nodes, parentId) ?? []).filter((n) => n.id !== draggedId);
    const at = sibs.findIndex((n) => n.id === over.node.id);
    index = zone === 'before' ? at : at + 1;
  }
  if (!canMoveTo(nodes, draggedId, parentId)) return null;
  const cur = rows.find((r) => r.node.id === draggedId);
  if (cur && (cur.trail.at(-1) ?? null) === parentId && cur.index === index) return null; // same place
  return { parentId, index };
}

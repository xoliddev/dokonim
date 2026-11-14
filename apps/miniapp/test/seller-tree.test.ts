import { describe, expect, it } from 'vitest';
import { canMoveTo, deleteNode, findNode, maxDepth, moveNode, pathTo, resolveDrop, visibleRows, zoneOf, type CatNode } from '../src/seller/lib/tree';

const n = (id: string, children: CatNode[] = [], parentId: string | null = null): CatNode => ({
  id, parentId, name: { uz: id }, slug: id, isHidden: false, productCount: 0, subtreeCount: 0,
  children: children.map((c) => ({ ...c, parentId: id })),
});

// kiyim ─┬─ ayollar ─┬─ koylak
//        │           └─ yubka
//        └─ erkaklar
// aksessuar
const tree = () => [n('kiyim', [n('ayollar', [n('koylak'), n('yubka')]), n('erkaklar')]), n('aksessuar')];
const ids = (rows: { node: CatNode }[]) => rows.map((r) => r.node.id);

describe('seller category tree — visible rows', () => {
  it('shows only expanded subtrees, with depth, trail and sibling index', () => {
    const rows = visibleRows(tree(), new Set(['kiyim']));
    expect(ids(rows)).toEqual(['kiyim', 'ayollar', 'erkaklar', 'aksessuar']);
    expect(rows[1]).toMatchObject({ depth: 1, index: 0, siblings: 2, hasChildren: true, expanded: false, trail: ['kiyim'] });
    const all = visibleRows(tree(), new Set(['kiyim', 'ayollar']));
    expect(ids(all)).toEqual(['kiyim', 'ayollar', 'koylak', 'yubka', 'erkaklar', 'aksessuar']);
    expect(all[3]!.trail).toEqual(['kiyim', 'ayollar']);
  });

  it('search keeps matches plus their ancestors, auto-expanded', () => {
    const rows = visibleRows(tree(), new Set(), 'YUB');
    expect(ids(rows)).toEqual(['kiyim', 'ayollar', 'yubka']);
    expect(rows.every((r) => r.node.id === 'yubka' || r.expanded)).toBe(true);
  });

  it('breadcrumbs and depth', () => {
    expect(pathTo(tree(), 'yubka').map((x) => x.id)).toEqual(['kiyim', 'ayollar', 'yubka']);
    expect(pathTo(tree(), null)).toEqual([]);
    expect(maxDepth(tree())).toBe(3);
  });
});

describe('seller category tree — moves', () => {
  it('rejects cycles (into itself or its subtree), allows the root', () => {
    expect(canMoveTo(tree(), 'kiyim', 'koylak')).toBe(false);
    expect(canMoveTo(tree(), 'kiyim', 'kiyim')).toBe(false);
    expect(canMoveTo(tree(), 'koylak', null)).toBe(true);
    expect(() => moveNode(tree(), 'ayollar', 'yubka', 0)).toThrow('CATEGORY_CYCLE');
  });

  it('re-parents a 3-level branch and keeps its children', () => {
    const t = moveNode(tree(), 'ayollar', 'aksessuar', 0);
    expect(findNode(t, 'aksessuar')!.children.map((c) => c.id)).toEqual(['ayollar']);
    expect(findNode(t, 'ayollar')!.parentId).toBe('aksessuar');
    expect(findNode(t, 'ayollar')!.children.map((c) => c.id)).toEqual(['koylak', 'yubka']);
    expect(findNode(t, 'kiyim')!.children.map((c) => c.id)).toEqual(['erkaklar']);
  });

  it('reorders among siblings with a clamped index and never mutates the input', () => {
    const before = tree();
    const t = moveNode(before, 'aksessuar', null, 0);
    expect(t.map((x) => x.id)).toEqual(['aksessuar', 'kiyim']);
    expect(moveNode(before, 'kiyim', null, 99).map((x) => x.id)).toEqual(['aksessuar', 'kiyim']);
    expect(before.map((x) => x.id)).toEqual(['kiyim', 'aksessuar']);
  });

  it('delete: reparent puts children in the node’s place; archive drops the subtree', () => {
    const up = deleteNode(tree(), 'ayollar', 'reparent_children');
    expect(findNode(up, 'kiyim')!.children.map((c) => c.id)).toEqual(['koylak', 'yubka', 'erkaklar']);
    expect(findNode(up, 'koylak')!.parentId).toBe('kiyim');
    const gone = deleteNode(tree(), 'kiyim', 'archive_subtree');
    expect(gone.map((x) => x.id)).toEqual(['aksessuar']);
    expect(findNode(gone, 'koylak')).toBeNull();
  });
});

describe('seller category tree — drag & drop resolution', () => {
  const nodes = tree();
  const rows = visibleRows(nodes, new Set(['kiyim', 'ayollar']));
  // rows: 0 kiyim, 1 ayollar, 2 koylak, 3 yubka, 4 erkaklar, 5 aksessuar

  it('maps pointer offset to zones', () => {
    expect(zoneOf(0.1)).toBe('before');
    expect(zoneOf(0.5)).toBe('inside');
    expect(zoneOf(0.9)).toBe('after');
    expect(zoneOf(0.4, false)).toBe('before');
  });

  it('inside appends as the last child; before/after index among new siblings', () => {
    expect(resolveDrop(rows, 'aksessuar', 1, 'inside', nodes)).toEqual({ parentId: 'ayollar', index: 2 });
    expect(resolveDrop(rows, 'aksessuar', 3, 'before', nodes)).toEqual({ parentId: 'ayollar', index: 1 });
    expect(resolveDrop(rows, 'koylak', 0, 'before', nodes)).toEqual({ parentId: null, index: 0 });
    // after "yubka" among siblings without "koylak" → index 1
    expect(resolveDrop(rows, 'koylak', 4, 'before', nodes)).toEqual({ parentId: 'kiyim', index: 1 });
  });

  it('rejects drops into the dragged subtree and no-op drops', () => {
    expect(resolveDrop(rows, 'kiyim', 2, 'inside', nodes)).toBeNull();
    expect(resolveDrop(rows, 'ayollar', 1, 'inside', nodes)).toBeNull();
    expect(resolveDrop(rows, 'yubka', 2, 'after', nodes)).toBeNull(); // already right after koylak
    expect(resolveDrop(rows, 'koylak', 3, 'before', nodes)).toBeNull(); // already before yubka
  });
});

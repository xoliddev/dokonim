import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  breadcrumbs, buildTree, DomainError, flattenTree, isDescendantOrSelf, labelFor, nextPosition, pathFor, planMove,
  positionUpdates, rebasePath, resolveSlugPath, uniqueSiblingSlug, verifyTree, type TreeNode,
} from '../src';

const id = (n: number) => `00000000-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;

/** In-memory model of the SQL implementation: same operations, same rules. */
class Tree {
  nodes = new Map<string, TreeNode>();
  add(n: number, parent: number | null): void {
    const pid = parent === null ? null : id(parent);
    const p = pid ? this.nodes.get(pid)! : null;
    const siblings = [...this.nodes.values()].filter((x) => x.parentId === pid);
    this.nodes.set(id(n), { id: id(n), parentId: pid, path: pathFor(p?.path ?? null, id(n)), slug: `s${n}`, position: nextPosition(siblings) });
  }
  move(n: string, parent: string | null): void {
    const node = this.nodes.get(n)!;
    const p = parent ? this.nodes.get(parent)! : null;
    const { newPath } = planMove(node, p);
    const old = node.path;
    for (const x of this.nodes.values()) {
      if (isDescendantOrSelf(x.path, old)) x.path = rebasePath(x.path, old, newPath);
    }
    node.parentId = parent;
  }
  remove(n: string): void {
    // reparent_children strategy
    const node = this.nodes.get(n)!;
    for (const c of [...this.nodes.values()].filter((x) => x.parentId === n)) this.move(c.id, node.parentId);
    this.nodes.delete(n);
  }
}

describe('category tree', () => {
  it('builds labels and paths from ids', () => {
    expect(labelFor(id(1))).toBe('c000000000000700080000000000000' + '01');
    expect(pathFor('a', id(2))).toBe(`a.${labelFor(id(2))}`);
    expect(isDescendantOrSelf('a.b.c', 'a.b')).toBe(true);
    expect(isDescendantOrSelf('a.bc', 'a.b')).toBe(false);
  });

  it('rejects moving a node into itself or its subtree', () => {
    const t = new Tree();
    t.add(1, null);
    t.add(2, 1);
    t.add(3, 2);
    expect(() => t.move(id(1), id(3))).toThrow(DomainError);
    expect(() => t.move(id(1), id(1))).toThrow(/inside itself/);
    t.move(id(3), null);
    expect(verifyTree([...t.nodes.values()])).toEqual([]);
  });

  it('builds a nested view, breadcrumbs and resolves slug paths (4 levels)', () => {
    const t = new Tree();
    t.add(1, null);
    t.add(2, 1);
    t.add(3, 2);
    t.add(4, 3);
    t.add(5, null);
    const nodes = [...t.nodes.values()];
    const tree = buildTree(nodes);
    expect(tree.map((x) => x.node.slug)).toEqual(['s1', 's5']);
    expect(flattenTree(tree).map((x) => x.depth)).toEqual([1, 2, 3, 4, 1]);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    expect(breadcrumbs(t.nodes.get(id(4))!, byId).map((n) => n.slug)).toEqual(['s1', 's2', 's3', 's4']);
    expect(resolveSlugPath(nodes, ['s1', 's2', 's3'])?.at(-1)?.id).toBe(id(3));
    expect(resolveSlugPath(nodes, ['s1', 's3'])).toBeNull();
  });

  it('positions: midpoint when there is a gap, renumber when not', () => {
    const sib = [{ id: 'a', position: 1024 }, { id: 'b', position: 2048 }, { id: 'c', position: 3072 }];
    expect(positionUpdates(sib, 'c', 0)).toEqual([{ id: 'c', position: 0 }]);
    expect(positionUpdates(sib, 'c', 1)).toEqual([{ id: 'c', position: 1536 }]);
    const tight = [{ id: 'a', position: 1 }, { id: 'b', position: 2 }, { id: 'x', position: 9 }];
    const up = positionUpdates(tight, 'x', 1);
    expect(up.map((u) => u.id)).toEqual(['a', 'x', 'b']);
    expect(new Set(up.map((u) => u.position)).size).toBe(3);
  });

  it('unique sibling slugs', () => {
    expect(uniqueSiblingSlug('koylak', ['koylak', 'koylak-2'])).toBe('koylak-3');
    expect(uniqueSiblingSlug('shim', [])).toBe('shim');
  });

  it('PROPERTY: random add/move/delete sequences never create cycles and keep path ≡ parent chain', () => {
    const op = fc.oneof(
      fc.record({ k: fc.constant('add' as const), parent: fc.nat(40) }),
      fc.record({ k: fc.constant('move' as const), a: fc.nat(40), b: fc.nat(41) }),
      fc.record({ k: fc.constant('del' as const), a: fc.nat(40) }),
    );
    fc.assert(
      fc.property(fc.array(op, { maxLength: 80 }), (ops) => {
        const t = new Tree();
        let next = 1;
        for (const o of ops) {
          const ids = [...t.nodes.keys()];
          if (o.k === 'add') {
            const parent = ids.length && o.parent % 3 !== 0 ? ids[o.parent % ids.length]! : null;
            const pn = parent ? Number.parseInt(parent.slice(-12), 16) : null;
            t.add(next++, pn);
          } else if (o.k === 'move' && ids.length) {
            const a = ids[o.a % ids.length]!;
            const b = o.b % (ids.length + 1) === ids.length ? null : ids[o.b % ids.length]!;
            try {
              t.move(a, b);
            } catch (e) {
              // the only allowed refusal is a cycle — and it must really have been one
              expect((e as DomainError).code).toBe('CATEGORY_CYCLE');
              expect(isDescendantOrSelf(t.nodes.get(b!)!.path, t.nodes.get(a)!.path)).toBe(true);
            }
          } else if (o.k === 'del' && ids.length) t.remove(ids[o.a % ids.length]!);
          expect(verifyTree([...t.nodes.values()])).toEqual([]);
        }
      }),
      { numRuns: 200 },
    );
  });
});

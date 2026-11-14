/**
 * Pointer drag for the category tree (mouse + touch, no library). Rows have a fixed height, so the hovered row and
 * the zone inside it (before / inside / after) come straight from the pointer Y; `resolveDrop` turns that into a
 * `{ parentId, index }` move or rejects it (own subtree, no-op). Auto-scrolls near the scroller edges.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { haptic } from '../../../telegram/shim';
import { resolveDrop, zoneOf, type CatNode, type DropZone, type Row } from '../../lib/tree';

export interface DragState {
  id: string;
  dy: number;
  overIndex: number;
  zone: DropZone;
  target: { parentId: string | null; index: number } | null;
}

export function useTreeDrag({ rows, nodes, rowH, listRef, onDrop }: { rows: Row[]; nodes: CatNode[]; rowH: number; listRef: React.RefObject<HTMLElement | null>; onDrop: (id: string, t: { parentId: string | null; index: number }) => void }) {
  const [state, setState] = useState<DragState | null>(null);
  const last = useRef<DragState | null>(null);
  const live = useRef<{ id: string; startY: number; startScroll: number; y: number; raf: number; scroller: HTMLElement | null; key: string } | null>(null);
  const ctx = useRef({ rows, nodes, onDrop });
  ctx.current = { rows, nodes, onDrop };

  const compute = useCallback(() => {
    const d = live.current;
    const list = listRef.current;
    if (!d || !list) return;
    const top = list.getBoundingClientRect().top;
    const rel = d.y - top;
    const { rows: rs, nodes: ns } = ctx.current;
    const overIndex = Math.max(0, Math.min(rs.length - 1, Math.floor(rel / rowH)));
    const frac = Math.max(0, Math.min(1, rel / rowH - overIndex));
    const zone = zoneOf(frac);
    const target = resolveDrop(rs, d.id, overIndex, zone, ns);
    const scrollDelta = (d.scroller?.scrollTop ?? 0) - d.startScroll;
    const key = `${overIndex}:${zone}:${!!target}`;
    if (key !== d.key) {
      d.key = key;
      if (target) haptic.selection();
    }
    last.current = { id: d.id, dy: d.y - d.startY + scrollDelta, overIndex, zone, target };
    setState(last.current);
  }, [listRef, rowH]);

  const tick = useCallback(() => {
    const d = live.current;
    if (!d) return;
    const sc = d.scroller;
    if (sc) {
      const r = sc.getBoundingClientRect();
      const edge = 64;
      let v = 0;
      if (d.y < r.top + edge) v = -Math.ceil((r.top + edge - d.y) / 6);
      else if (d.y > r.bottom - edge) v = Math.ceil((d.y - (r.bottom - edge)) / 6);
      if (v) {
        sc.scrollTop += v;
        compute();
      }
    }
    d.raf = requestAnimationFrame(tick);
  }, [compute]);

  const end = useCallback(
    (commit: boolean) => {
      const d = live.current;
      if (!d) return;
      cancelAnimationFrame(d.raf);
      live.current = null;
      const s = last.current;
      last.current = null;
      setState(null);
      if (commit && s?.target) ctx.current.onDrop(s.id, s.target);
    },
    [],
  );

  useEffect(() => {
    if (!state) return;
    const move = (e: PointerEvent) => {
      if (!live.current) return;
      live.current.y = e.clientY;
      compute();
    };
    const up = () => end(true);
    const cancel = () => end(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && end(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key);
    };
  }, [state, compute, end]);

  const start = (id: string) => (e: RPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const scroller = (e.currentTarget.closest('.screen-scroll') as HTMLElement | null) ?? null;
    live.current = { id, startY: e.clientY, startScroll: scroller?.scrollTop ?? 0, y: e.clientY, raf: 0, scroller, key: '' };
    haptic.impact('medium');
    compute();
    live.current.raf = requestAnimationFrame(tick);
  };

  return { state, start };
}

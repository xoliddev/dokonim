/**
 * Skeleton: the ikat stripe drifts 0 → 40px over 1.6 s instead of the usual grey shimmer (§13.7); offscreen
 * skeletons skip rendering via content-visibility. Static under reduced motion / minimal tier.
 *   <Skeleton w="60%" />  <Skeleton h={180} radius="var(--r-card)" />  <Skeleton circle h={40} />
 *   <SkeletonCard />  — a product-card placeholder
 */
import type { CSSProperties, ReactNode } from 'react';

export interface SkeletonProps {
  w?: number | string;
  h?: number | string;
  radius?: number | string;
  circle?: boolean;
  className?: string;
  style?: CSSProperties;
}

const px = (v: number | string | undefined) => (typeof v === 'number' ? `${v}px` : v);

export function Skeleton({ w = '100%', h = 14, radius, circle, className, style }: SkeletonProps) {
  return (
    <span
      className={`skeleton ${className ?? ''}`}
      aria-hidden="true"
      style={{ width: circle ? px(h) : px(w), height: px(h), borderRadius: circle ? '50%' : (px(radius) ?? 'var(--r-chip)'), ...style }}
    />
  );
}

export function SkeletonCard() {
  return (
    <div className="skeleton-card" aria-hidden="true">
      <Skeleton h="auto" radius="var(--r-media)" style={{ aspectRatio: 'var(--card-aspect)' }} />
      <Skeleton w="80%" h={12} />
      <Skeleton w="45%" h={16} />
    </div>
  );
}

/** Screen-reader friendly loading region wrapper. */
export function Loading({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

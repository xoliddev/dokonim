/**
 * PDP gallery (§13.5): edge-to-edge 4:5 slides with scroll-snap swipe, the first slide is the Continuity
 * morph target, double-tap zooms 2× at the tap point (transform only), dots morph into a progress pill
 * beyond six images, and picking a variant glides to that variant's image.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { MorphMedia, useMotionTier } from '../../motion';

export interface GalleryHandle {
  /** The image element currently in view (The Arc launches from it). */
  current: () => HTMLElement | null;
  currentUrl: () => string | undefined;
}

export const Gallery = forwardRef<GalleryHandle, { morphId: string; urls: string[]; alt: string; focusUrl?: string | null; badge?: React.ReactNode }>(function Gallery(
  { morphId, urls, alt, focusUrl, badge },
  ref,
) {
  const tier = useMotionTier();
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState<{ i: number; x: number; y: number } | null>(null);
  const lastTap = useRef(0);

  useImperativeHandle(ref, () => ({
    current: () => (track.current?.children[index] as HTMLElement | undefined) ?? track.current,
    currentUrl: () => urls[index],
  }));

  useEffect(() => {
    if (!focusUrl) return;
    const i = urls.indexOf(focusUrl);
    const el = track.current;
    if (i < 0 || !el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: tier === 'minimal' ? 'auto' : 'smooth' });
  }, [focusUrl, urls, tier]);

  const onScroll = () => {
    const el = track.current;
    if (!el) return;
    const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
    if (i !== index) {
      setIndex(i);
      setZoom(null);
    }
  };

  const onTap = (e: React.MouseEvent, i: number) => {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setZoom((z) => (z ? null : { i, x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 }));
    }
    lastTap.current = now;
  };

  const many = urls.length > 6;
  return (
    <div className="st-gallery">
      <div className="st-gallery-track" ref={track} onScroll={onScroll} onPointerDown={(e) => e.stopPropagation()}>
        {urls.map((src, i) => (
          <div key={`${i}-${src.slice(-16)}`} className="st-gallery-slide" onClick={(e) => onTap(e, i)}>
            <div className="st-gallery-zoom" style={zoom?.i === i ? { transform: 'scale(2)', transformOrigin: `${zoom.x}% ${zoom.y}%` } : undefined}>
              {i === 0 ? (
                <MorphMedia id={morphId} src={src} alt={alt} radius={0} priority />
              ) : (
                <img className="morph-media" src={src} alt={alt} loading="lazy" decoding="async" draggable={false} />
              )}
            </div>
          </div>
        ))}
      </div>
      {badge && <div className="st-gallery-badge">{badge}</div>}
      {urls.length > 1 &&
        (many ? (
          <div className="st-gallery-pill" aria-hidden="true">
            {index + 1} / {urls.length}
          </div>
        ) : (
          <div className="st-gallery-dots" aria-hidden="true">
            {urls.map((_, i) => (
              <span key={i} className={i === index ? 'is-on' : ''} />
            ))}
          </div>
        ))}
    </div>
  );
});

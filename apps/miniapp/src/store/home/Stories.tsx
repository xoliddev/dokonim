/**
 * Stories (§5.1, Ozon/Instagram): a row of rings (seen-state per device) and a full-screen viewer that grows
 * out of the tapped ring. Tap left/right to step, hold to pause, swipe down to close; frames can link to a
 * product, category or collection (shoppable stories). Claims the Telegram BackButton while open.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, m, type PanInfo } from 'motion/react';
import { useI18n } from '../lib/i18n';
import { local } from '../../lib/store';
import { dur, spring, useMotionTier } from '../../motion';
import { haptic, useBackButton } from '../../telegram/shim';
import { Button, Icon, overlayRoot } from '../../ui';
import type { LinkTarget, Story } from '../lib/types';

const seenKey = (slug: string) => `dokonim.seen.${slug}`;

export function StoriesRow({ slug, stories, onLink }: { slug: string; stories: Story[]; onLink: (l: LinkTarget) => void }) {
  const { l } = useI18n();
  const [seen, setSeen] = useState<string[]>(() => local.get<string[]>(seenKey(slug), []));
  const [open, setOpen] = useState<{ index: number; origin: { x: number; y: number } } | null>(null);
  const list = stories.filter((s) => s.frames?.length);
  if (!list.length) return null;
  const markSeen = (id: string) =>
    setSeen((s) => {
      if (s.includes(id)) return s;
      const next = [...s, id].slice(-60);
      local.set(seenKey(slug), next);
      return next;
    });
  return (
    <>
      <div className="st-stories" role="list">
        {list.map((s, i) => (
          <button
            key={s.id}
            type="button"
            role="listitem"
            className={`st-story${seen.includes(s.id) ? ' is-seen' : ''}`}
            onClick={(e) => {
              haptic.selection();
              const r = e.currentTarget.getBoundingClientRect();
              const root = overlayRoot()?.getBoundingClientRect();
              setOpen({ index: i, origin: { x: r.left + r.width / 2 - (root?.left ?? 0), y: r.top + 32 - (root?.top ?? 0) } });
            }}
          >
            <span className="st-story-ring">
              <img src={s.coverUrl ?? s.frames[0]!.media_url} alt="" loading="lazy" />
            </span>
            <span className="st-story-label">{l(s.title)}</span>
          </button>
        ))}
      </div>
      {overlayRoot() &&
        createPortal(
          <AnimatePresence>
            {open && (
              <StoryViewer
                key="viewer"
                stories={list}
                start={open.index}
                origin={open.origin}
                onSeen={markSeen}
                onClose={() => setOpen(null)}
                onLink={(lnk) => {
                  setOpen(null);
                  onLink(lnk);
                }}
              />
            )}
          </AnimatePresence>,
          overlayRoot()!,
        )}
    </>
  );
}

function StoryViewer({ stories, start, origin, onClose, onSeen, onLink }: { stories: Story[]; start: number; origin: { x: number; y: number }; onClose: () => void; onSeen: (id: string) => void; onLink: (l: LinkTarget) => void }) {
  const { l, t } = useI18n();
  const tier = useMotionTier();
  const [pos, setPos] = useState({ s: start, f: 0 });
  const [paused, setPaused] = useState(false);
  const story = stories[pos.s]!;
  const frame = story.frames[pos.f]!;
  const duration = Math.max(2500, Math.min(15000, frame.duration_ms || 5000));
  useBackButton(onClose);

  const step = (dir: 1 | -1) => {
    haptic.selection();
    setPos((p) => {
      const st = stories[p.s]!;
      if (dir === 1) {
        if (p.f + 1 < st.frames.length) return { s: p.s, f: p.f + 1 };
        if (p.s + 1 < stories.length) return { s: p.s + 1, f: 0 };
        onClose();
        return p;
      }
      if (p.f > 0) return { s: p.s, f: p.f - 1 };
      if (p.s > 0) return { s: p.s - 1, f: 0 };
      return p;
    });
  };

  useEffect(() => onSeen(story.id), [story.id, onSeen]);
  useEffect(() => {
    if (paused) return;
    const id = setTimeout(() => step(1), duration);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos, paused, duration]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => (e.key === 'ArrowRight' ? step(1) : e.key === 'ArrowLeft' ? step(-1) : e.key === 'Escape' ? onClose() : undefined);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const end = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 110 || info.velocity.y > 700) onClose();
  };
  const grow = tier !== 'minimal';
  const cta = frame.link && frame.link.type !== 'none';

  return (
    <m.div
      className="st-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={l(story.title)}
      style={{ transformOrigin: `${origin.x}px ${origin.y}px` }}
      initial={grow ? { opacity: 0, scale: 0.2 } : { opacity: 0 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={grow ? { opacity: 0, scale: 0.2 } : { opacity: 0 }}
      transition={grow ? spring.sheet : { duration: dur.sm }}
      drag={grow ? 'y' : false}
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0, bottom: 0.9 }}
      onDragEnd={end}
    >
      <AnimatePresence initial={false} mode="popLayout">
        <m.img key={`${pos.s}-${pos.f}`} className="st-viewer-img" src={frame.media_url} alt="" draggable={false}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: dur.md }} />
      </AnimatePresence>
      <div className="st-viewer-top">
        <div className="st-viewer-bars">
          {story.frames.map((f, i) => (
            <span key={f.id} className="st-viewer-bar">
              <span
                key={`${pos.s}-${pos.f}-${i}`}
                className={`st-viewer-fill${i < pos.f ? ' is-done' : i === pos.f ? ' is-run' : ''}`}
                style={{ animationDuration: `${duration}ms`, animationPlayState: paused ? 'paused' : 'running' }}
              />
            </span>
          ))}
        </div>
        <div className="st-viewer-head">
          <strong>{l(story.title)}</strong>
          <button type="button" className="st-viewer-close" aria-label={t('common.close')} onClick={onClose}>
            <Icon name="close" size={22} />
          </button>
        </div>
      </div>
      <button type="button" className="st-viewer-tap is-prev" aria-label={t('common.back')} onClick={() => step(-1)}
        onPointerDown={() => setPaused(true)} onPointerUp={() => setPaused(false)} onPointerLeave={() => setPaused(false)} />
      <button type="button" className="st-viewer-tap is-next" aria-label={t('common.next')} onClick={() => step(1)}
        onPointerDown={() => setPaused(true)} onPointerUp={() => setPaused(false)} onPointerLeave={() => setPaused(false)} />
      {cta && (
        <div className="st-viewer-cta">
          <Button block size="lg" onClick={() => onLink(frame.link)} icon={<Icon name="chevron-right" size={18} />}>
            {l(frame.cta_label) || t('store.storyOpen')}
          </Button>
        </div>
      )}
    </m.div>
  );
}

/**
 * Screen-reader announcements: `announce(t('store.addedToCart', { title }))` (§13.4 accessibility).
 * <LiveRegion/> is mounted once by the shell.
 */
import { createStore, useStore } from '../lib/store';

const live = createStore<{ text: string; n: number }>({ text: '', n: 0 });

export function announce(text: string) {
  live.set((s) => ({ text, n: s.n + 1 }));
}

export function LiveRegion() {
  const { text, n } = useStore(live);
  return (
    <div className="sr-only" aria-live="polite" aria-atomic="true">
      <span key={n}>{text}</span>
    </div>
  );
}

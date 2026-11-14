/**
 * Shell session: which surface (buyer storefront `/s/:slug` or seller dashboard `/m/:slug`) and which store.
 * The URL is the source of truth; this store only remembers the last choice for the role switcher / picker.
 *
 *   const { slug, role } = useSession();
 *   const { data } = useCurrentStore();   // store.get for the slug in the URL (store, theme, nav, role)
 */
import { useQuery } from '../api/provider';
import { createStore, local, useStore } from '../lib/store';
import { navigate, routerStore, useLocation } from '../router/router';

export type Role = 'buyer' | 'seller';

interface Session {
  role: Role;
  slug: string | null;
}

export const sessionStore = createStore<Session>(local.get<Session>('dokonim.session', { role: 'buyer', slug: null }));
sessionStore.subscribe(() => local.set('dokonim.session', sessionStore.get()));

/** Parses `/s/:slug/...` and `/m/:slug/...`. */
export function surfaceOf(path: string): { role: Role | null; slug: string | null } {
  const m = /^\/(s|m)\/([^/?#]+)/.exec(path);
  if (!m) return { role: null, slug: null };
  return { role: m[1] === 'm' ? 'seller' : 'buyer', slug: decodeURIComponent(m[2]!) };
}

// keep the remembered choice in sync with the URL
routerStore.subscribe(() => {
  const s = surfaceOf(routerStore.get().path);
  if (s.role && s.slug) sessionStore.set((prev) => (prev.role === s.role && prev.slug === s.slug ? prev : { role: s.role!, slug: s.slug }));
});

export const homeOf = (role: Role, slug: string) => (role === 'seller' ? `/m/${slug}` : `/s/${slug}`);

export function switchRole(role: Role) {
  const slug = surfaceOf(routerStore.get().path).slug ?? sessionStore.get().slug;
  sessionStore.set((s) => ({ ...s, role }));
  if (slug) navigate(homeOf(role, slug));
}

export function switchStore(slug: string) {
  const role = surfaceOf(routerStore.get().path).role ?? sessionStore.get().role;
  sessionStore.set({ role, slug });
  navigate(homeOf(role, slug));
}

export function useSession(): Session & { inSurface: boolean } {
  const loc = useLocation();
  const remembered = useStore(sessionStore);
  const s = surfaceOf(loc.path);
  return { role: s.role ?? remembered.role, slug: s.slug ?? remembered.slug, inSurface: !!s.role };
}

/** `store.get` for the store in the URL (cached; shared by the shell, buyer and seller screens). */
export function useCurrentStore() {
  const { slug, inSurface } = useSession();
  return useQuery('store.get', inSurface && slug ? { slug } : null, { staleMs: 60_000 });
}

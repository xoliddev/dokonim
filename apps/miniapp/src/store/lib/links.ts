/** Opens a story/banner link target (product, category, collection, external URL). */
import { useCallback } from 'react';
import { useApi } from '../../api';
import { navigate } from '../../router/router';
import { categoryUrl, productUrl } from './data';
import type { CategoryNode, CollectionTile, LinkTarget } from './types';

export function pathOf(tree: CategoryNode[], id: string, trail: string[] = []): string[] | null {
  for (const n of tree) {
    const here = [...trail, n.slug];
    if (n.id === id) return here;
    const sub = pathOf(n.children as CategoryNode[], id, here);
    if (sub) return sub;
  }
  return null;
}

export function useLinkOpener(slug: string, collections: CollectionTile[]) {
  const { api } = useApi();
  return useCallback(
    async (l: LinkTarget) => {
      switch (l.type) {
        case 'product':
          return navigate(productUrl(slug, l.id));
        case 'collection': {
          const c = collections.find((x) => x.id === l.id || x.slug === l.id);
          return navigate(`/s/${slug}/collection/${c?.slug ?? l.id}`);
        }
        case 'category': {
          const tree = await api['store.categories']({ slug });
          const path = pathOf(tree, l.id);
          return navigate(path ? categoryUrl(slug, path) : `/s/${slug}/catalog`);
        }
        case 'url':
          if (/^https?:\/\//.test(l.url)) window.open(l.url, '_blank', 'noopener');
          return;
      }
    },
    [api, slug, collections],
  );
}

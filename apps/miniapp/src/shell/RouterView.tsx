/** Renders the matched route with the shared-axis page transition and a skeleton while lazy screens load. */
import { Suspense, useEffect, useRef } from 'react';
import { AnimatePresence } from 'motion/react';
import { useI18n } from '../i18n';
import { PageTransition } from '../motion/Reveal';
import { matchRoute, useLocation, type RouteDef } from '../router/router';
import { EmptyState, Loading, Skeleton, SkeletonCard } from '../ui';

export function ScreenSkeleton() {
  const { t } = useI18n();
  return (
    <Loading label={t('common.loading')}>
      <div className="screen-pad" style={{ display: 'grid', gap: 14 }}>
        <Skeleton h={150} radius="var(--r-card)" />
        <Skeleton w="50%" h={18} />
        <div className="grid-2">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    </Loading>
  );
}

function NotFound() {
  const { t } = useI18n();
  return <EmptyState icon="search" title={t('common.errorNotFound')} />;
}

export function RouterView({ routes }: { routes: RouteDef[] }) {
  const loc = useLocation();
  const match = matchRoute(routes, loc.path);
  const scroller = useRef<HTMLDivElement>(null);
  const Screen = match?.route.component ?? NotFound;
  const key = loc.path;

  useEffect(() => {
    if (loc.direction !== 'back') scroller.current?.scrollTo({ top: 0 });
  }, [key, loc.direction]);

  return (
    <div className="screen-scroll" ref={scroller} data-surface={match?.route.surface ?? 'shell'}>
      <AnimatePresence mode="popLayout" initial={false}>
        <PageTransition key={key} path={key} direction={loc.direction} className="screen">
          <Suspense fallback={<ScreenSkeleton />}>
            <Screen params={match?.params ?? {}} query={loc.query} />
          </Suspense>
        </PageTransition>
      </AnimatePresence>
    </div>
  );
}

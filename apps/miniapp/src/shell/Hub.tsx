/** `/` — the "My stores" hub (§6.1): stores the user owns/staffs, each openable as buyer or seller. */
import { pick } from '@dokonim/core';
import { useQuery } from '../api/provider';
import { useI18n } from '../i18n';
import { Stagger } from '../motion/Reveal';
import { Button, Card, EmptyState, Icon, Skeleton } from '../ui';
import { homeOf, sessionStore } from './session';
import { navigate } from '../router/router';

export default function Hub() {
  const { t, locale } = useI18n();
  const me = useQuery('me.get', undefined);
  const stores = (me.data?.stores ?? []) as Array<{ id: string; slug: string; name: Record<string, string>; businessType: string; role: string }>;

  return (
    <div className="screen-pad hub">
      <header className="hub-head">
        <div className="ikat-band hub-band" aria-hidden="true" />
        <h1 className="display hub-title">{t('common.myStores')}</h1>
        {me.data?.user && <p className="muted">{(me.data.user as { firstName?: string }).firstName ?? ''}</p>}
      </header>
      {me.loading && !me.data ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <Skeleton h={88} radius="var(--r-card)" />
          <Skeleton h={88} radius="var(--r-card)" />
        </div>
      ) : stores.length === 0 ? (
        <EmptyState icon="store" title={t('common.empty')} />
      ) : (
        <Stagger className="hub-list">
          {stores.map((s) => (
            <Card key={s.id} className="hub-store">
              <div className="hub-store-name">
                <Icon name="store" />
                <div>
                  <div className="hub-store-title">{pick(s.name, locale)}</div>
                  <div className="muted hub-store-slug">@{s.slug}</div>
                </div>
              </div>
              <div className="hub-store-actions">
                <Button size="sm" variant="secondary" onClick={() => go('buyer', s.slug)}>
                  {t('common.roleBuyer')}
                </Button>
                <Button size="sm" onClick={() => go('seller', s.slug)}>
                  {t('common.roleSeller')}
                </Button>
              </div>
            </Card>
          ))}
        </Stagger>
      )}
      <Button variant="secondary" block icon={<Icon name="plus" />} onClick={() => navigate('/m/new/create-store')} style={{ marginTop: 16 }}>
        {t('common.createStore')}
      </Button>
    </div>
  );
}

function go(role: 'buyer' | 'seller', slug: string) {
  sessionStore.set({ role, slug });
  navigate(homeOf(role, slug));
}

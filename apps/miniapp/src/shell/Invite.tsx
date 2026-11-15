/** `/invite/:token` — a staff invite link (`startapp=i-<token>`): confirm, join the store's team, open its dashboard. */
import { useMutation } from '../api/provider';
import { useI18n } from '../i18n';
import { navigate, type RouteProps } from '../router/router';
import { haptic } from '../telegram/shim';
import { Button, EmptyState, toast } from '../ui';
import { errorMessage } from '../seller/lib/errors';

export default function Invite({ params }: RouteProps) {
  const { t } = useI18n();
  const accept = useMutation('invites.accept', { invalidates: ['me.', 'store.'] });

  const run = async () => {
    try {
      const r = (await accept.run({ token: params.token ?? '' })) as { slug: string };
      haptic.notify('success');
      navigate(`/m/${r.slug}`, { replace: true });
    } catch (e) {
      haptic.notify('error');
      toast.error((e as { code?: string }).code === 'INVITE_INVALID' ? t('common.inviteInvalid') : errorMessage(e, t));
    }
  };

  return (
    <div className="screen-pad">
      <EmptyState
        icon="store"
        title={t('common.inviteTitle')}
        hint={t('common.inviteHint')}
        action={
          <Button loading={accept.loading} onClick={() => void run()}>
            {t('common.inviteAccept')}
          </Button>
        }
      />
    </div>
  );
}

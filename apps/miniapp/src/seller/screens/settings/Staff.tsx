/** Staff & roles: members with role switcher, one-time invite links (with QR), active invites, revoke, remove. */
import { useState } from 'react';
import type { MessageKey } from '@dokonim/i18n';
import { useMutation, useQuery } from '../../../api/provider';
import { useI18n } from '../../../i18n';
import type { RouteProps } from '../../../router/router';
import { haptic, useMainButton } from '../../../telegram/shim';
import { Button, Chip, Sheet, toast } from '../../../ui';
import { useConfirm } from '../../components/Controls';
import { Section, SellerScreen } from '../../components/Layout';
import { QrCode } from '../../components/QrCode';
import { SIcon } from '../../components/SIcon';
import { Gate } from '../../components/States';
import { useSeller } from '../../lib/ctx';
import { toastError } from '../../lib/errors';
import { copyText } from '../onboarding/Done';
import './settings.css';

type Role = 'owner' | 'admin' | 'manager' | 'catalog_editor' | 'order_operator' | 'viewer';
const ASSIGNABLE: Role[] = ['admin', 'manager', 'catalog_editor', 'order_operator', 'viewer'];
interface StaffData {
  members: Array<{ userId: string; role: Role; firstName: string; lastName: string | null; username: string | null }>;
  invites: Array<{ id: string; role: Role; expiresAt: string }>;
  roles: Array<{ role: Role; permissions: string[] }>;
}

export default function Staff(_: RouteProps) {
  const { t, dateTime } = useI18n();
  const s = useSeller();
  const q = useQuery('admin.staff.list', s.storeId ? { storeId: s.storeId } : null);
  const inv = useMutation('admin.staff.invite', { invalidates: ['admin.staff'] });
  const revoke = useMutation('admin.staff.revokeInvite', { invalidates: ['admin.staff'] });
  const upd = useMutation('admin.staff.update', { invalidates: ['admin.staff'] });
  const rem = useMutation('admin.staff.remove', { invalidates: ['admin.staff'] });
  const [inviting, setInviting] = useState(false);
  const [role, setRole] = useState<Role>('order_operator');
  const [link, setLink] = useState<string | null>(null);
  const [editing, setEditing] = useState<StaffData['members'][number] | null>(null);
  const [confirmUi, ask] = useConfirm();
  const data = q.data as StaffData | undefined;
  const perms = (r: Role) => data?.roles.find((x) => x.role === r)?.permissions.length ?? 0;
  useMainButton({ text: t('seller.inviteStaff'), onClick: () => { setLink(null); setInviting(true); }, hidden: inviting || !!editing || !s.storeId });

  const create = async () => {
    if (!s.storeId) return;
    try {
      const r = (await inv.run({ storeId: s.storeId, role, ttlHours: 48 })) as { link: string };
      setLink(r.link);
      haptic.notify('success');
      toast.success(t('seller.sfCreated'));
    } catch (e) {
      toastError(e, t);
    }
  };
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      haptic.notify('success');
      toast.success(ok);
    } catch (e) {
      toastError(e, t);
    }
  };
  const nameOf = (m: StaffData['members'][number]) => [m.firstName, m.lastName].filter(Boolean).join(' ') || (m.username ? `@${m.username}` : '—');

  return (
    <SellerScreen title={t('seller.staff')}>
      <Gate loading={!data && q.loading} error={!data && (s.error ?? q.error)} onRetry={q.reload}>
        {data && (
          <>
            <Section title={t('seller.sfMembers')}>
              <div className="sl-list">
                {data.members.map((m) => (
                  <button key={m.userId} type="button" className="sl-row" disabled={m.role === 'owner'} onClick={() => setEditing(m)}>
                    <span className="sl-row-icon">{(m.firstName || '?')[0]}</span>
                    <span className="sl-row-main">
                      <span className="sl-row-title">{nameOf(m)}</span>
                      <span className="sl-row-sub">{t(`seller.role_${m.role}` as MessageKey)} · {t('seller.sfPerms', { n: perms(m.role) })}</span>
                    </span>
                    {m.role !== 'owner' && <SIcon name="chevron-right" size={18} className="pl-chev" />}
                  </button>
                ))}
              </div>
            </Section>
            {data.invites.length > 0 && (
              <Section title={t('seller.sfInvites')}>
                <div className="sl-list">
                  {data.invites.map((i) => (
                    <div key={i.id} className="sl-row">
                      <span className="sl-row-icon"><SIcon name="link" size={18} /></span>
                      <span className="sl-row-main">
                        <span className="sl-row-title">{t(`seller.role_${i.role}` as MessageKey)}</span>
                        <span className="sl-row-sub">{t('seller.sfExpires', { at: dateTime(i.expiresAt) })}</span>
                      </span>
                      <Button size="sm" variant="danger" disabled={revoke.loading} onClick={() => void run(() => revoke.run({ storeId: s.storeId!, id: i.id }), t('seller.sfRevoked'))}>{t('seller.sfRevoke')}</Button>
                    </div>
                  ))}
                </div>
              </Section>
            )}
          </>
        )}
      </Gate>
      <Sheet open={inviting} onClose={() => setInviting(false)} title={t('seller.inviteStaff')}>
        <div className="sl-form">
          <span className="field-label">{t('seller.sfRole')}</span>
          <div className="pe-wrap">
            {ASSIGNABLE.map((r) => <Chip key={r} selected={role === r} onClick={() => { setRole(r); setLink(null); }}>{t(`seller.role_${r}` as MessageKey)}</Chip>)}
          </div>
          <p className="sl-hint">{t('seller.sfPerms', { n: perms(role) })}</p>
          {link ? (
            <div className="sf-link">
              <QrCode text={link} size={150} />
              <button type="button" className="pm-hook" onClick={() => void copyText(link, t('common.copied'))}><span>{link}</span><SIcon name="copy" size={16} /></button>
              <p className="sl-hint">{t('seller.sfLinkHint', { h: 48 })}</p>
            </div>
          ) : (
            <Button block loading={inv.loading} onClick={() => void create()}>{t('seller.sfLink')}</Button>
          )}
        </div>
      </Sheet>
      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing ? nameOf(editing) : ''}>
        {editing && (
          <div className="sl-form">
            <span className="field-label">{t('seller.sfRole')}</span>
            <div className="pe-wrap">
              {ASSIGNABLE.map((r) => (
                <Chip key={r} selected={editing.role === r} onClick={() => void run(async () => { await upd.run({ storeId: s.storeId!, userId: editing.userId, role: r }); setEditing({ ...editing, role: r }); }, t('seller.sfRoleSaved'))}>
                  {t(`seller.role_${r}` as MessageKey)}
                </Chip>
              ))}
            </div>
            <Button variant="danger" block onClick={async () => {
              if (!(await ask({ title: t('seller.sfRemoveConfirm', { name: nameOf(editing) }), danger: true, confirm: t('seller.sfRemove') }))) return;
              await run(() => rem.run({ storeId: s.storeId!, userId: editing.userId }), t('seller.sfRemoved'));
              setEditing(null);
            }}>{t('seller.sfRemove')}</Button>
          </div>
        )}
      </Sheet>
      {confirmUi}
    </SellerScreen>
  );
}

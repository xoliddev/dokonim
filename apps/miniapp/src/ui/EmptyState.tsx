/** Empty state with the ikat band motif (no cartoon illustrations). */
import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export function EmptyState({ icon = 'box', title, hint, action }: { icon?: IconName; title: ReactNode; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="ikat-band empty-band" aria-hidden="true" />
      <div className="empty-icon">
        <Icon name={icon} size={28} />
      </div>
      <h3 className="empty-title">{title}</h3>
      {hint && <p className="empty-hint muted">{hint}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

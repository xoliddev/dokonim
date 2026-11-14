/** Rating stars (display only). `single` renders one filled star for compact meta rows. */
import { Icon } from '../../ui';

export function Stars({ value, size = 14, single }: { value: number; size?: number; single?: boolean }) {
  if (single)
    return (
      <span className="st-stars" aria-hidden="true">
        <Icon name="star" filled size={size} />
      </span>
    );
  const full = Math.round(value);
  return (
    <span className="st-stars" role="img" aria-label={`${value.toFixed(1)} / 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Icon key={i} name="star" filled size={size} className={i <= full ? '' : 'is-off'} />
      ))}
    </span>
  );
}

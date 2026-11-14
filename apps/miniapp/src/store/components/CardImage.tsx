/** Card media: the Continuity morph image when it is this screen's morph owner, otherwise a plain lazy image. */
import { MorphMedia } from '../../motion';
import { Icon } from '../../ui';

export function CardImage({ id, src, alt, morph = true, priority, tint }: { id: string; src: string | null; alt: string; morph?: boolean; priority?: boolean; tint?: string | null }) {
  if (!src)
    return (
      <span className="st-img-empty" aria-hidden="true">
        <Icon name="box" size={32} />
      </span>
    );
  if (morph) return <MorphMedia id={id} src={src} alt={alt} radius={0} priority={priority} style={tint ? { background: tint } : undefined} />;
  return <img className="morph-media" src={src} alt={alt} loading={priority ? 'eager' : 'lazy'} decoding="async" draggable={false} style={tint ? { background: tint } : undefined} />;
}

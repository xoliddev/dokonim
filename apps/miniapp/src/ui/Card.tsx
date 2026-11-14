/**
 * Card: paper surface with a crisp outline and an offset "print" shadow (elevation e1; `raised` = e2).
 *   <Card>…</Card>   <Card as="button" onClick={open} interactive>…</Card>   <Card padding="none">…</Card>
 */
import type { ElementType, HTMLAttributes, ReactNode } from 'react';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  interactive?: boolean;
  raised?: boolean;
  padding?: 'none' | 'sm' | 'md';
  children?: ReactNode;
  [key: string]: unknown;
}

export function Card({ as: Tag = 'div', interactive, raised, padding = 'md', className, children, ...rest }: CardProps) {
  return (
    <Tag className={`card card-pad-${padding}${interactive ? ' card-interactive' : ''}${raised ? ' card-raised' : ''} ${className ?? ''}`} {...rest}>
      {children}
    </Tag>
  );
}

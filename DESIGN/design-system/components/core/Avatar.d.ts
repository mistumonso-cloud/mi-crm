import * as React from 'react';

export interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Full name — initials are derived and a deterministic tint is chosen. */
  name?: string;
  /** Optional image URL; falls back to initials. */
  src?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | number;
  style?: React.CSSProperties;
}

/** Circular avatar with initials (or image). Calm slate/neutral tint family. */
export function Avatar(props: AvatarProps): JSX.Element;

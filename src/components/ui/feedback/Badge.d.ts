import * as React from 'react';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: 'success' | 'warning' | 'danger' | 'neutral' | 'accent';
  /** Show a leading dot in the current text color. */
  dot?: boolean;
  style?: React.CSSProperties;
}

/** Generic semantic badge. Color communicates state, never decorates. */
export function Badge(props: BadgeProps): JSX.Element;

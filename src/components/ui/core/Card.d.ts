import * as React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  padding?: 'sm' | 'md' | 'lg' | number;
  /** Adds hover elevation + pointer cursor. */
  interactive?: boolean;
  /** Accent border to mark selection. */
  selected?: boolean;
  style?: React.CSSProperties;
}

/** White surface container: hairline border, subtle navy-tinted shadow, radius.lg. */
export function Card(props: CardProps): JSX.Element;

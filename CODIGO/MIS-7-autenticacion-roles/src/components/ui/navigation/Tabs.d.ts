import * as React from 'react';

export interface TabItem { value: string; label: string; }

export interface TabsProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
  tabs: Array<TabItem | string>;
  value?: string;
  onChange?: (value: string) => void;
  style?: React.CSSProperties;
}

/** Underlined tab bar. Active tab uses the brand accent. */
export function Tabs(props: TabsProps): JSX.Element;

import * as React from 'react';

export interface SelectOption { value: string; label: string; }

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  label?: React.ReactNode;
  options: Array<SelectOption | string>;
  size?: 'sm' | 'md';
  containerStyle?: React.CSSProperties;
}

/** Styled native select matching the Input aesthetic. */
export function Select(props: SelectProps): JSX.Element;

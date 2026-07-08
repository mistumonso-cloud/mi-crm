import * as React from 'react';

export interface SelectOption { value: string; label: string; }

export interface SelectProps {
  label?: React.ReactNode;
  options: Array<SelectOption | string>;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  size?: 'sm' | 'md';
  disabled?: boolean;
  containerStyle?: React.CSSProperties;
  style?: React.CSSProperties;
}

/** Styled native select matching the Input aesthetic. */
export function Select(props: SelectProps): JSX.Element;

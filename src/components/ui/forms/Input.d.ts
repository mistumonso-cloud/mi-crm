import * as React from 'react';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'> {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  /** Error message — turns the field red and shows below. */
  error?: React.ReactNode;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  size?: 'sm' | 'md';
  disabled?: boolean;
  containerStyle?: React.CSSProperties;
  style?: React.CSSProperties;
}

/** Text field with label, hint and error states. Accent focus ring. */
export function Input(props: InputProps): JSX.Element;

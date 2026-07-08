import * as React from 'react';

export interface SwitchProps {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  label?: React.ReactNode;
  disabled?: boolean;
  style?: React.CSSProperties;
}

/** Toggle switch. Active state uses the brand accent. */
export function Switch(props: SwitchProps): JSX.Element;

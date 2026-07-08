import * as React from 'react';

export interface CheckboxProps {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  label?: React.ReactNode;
  disabled?: boolean;
  style?: React.CSSProperties;
}

/** Checkbox with label. Checked state uses the brand accent. */
export function Checkbox(props: CheckboxProps): JSX.Element;

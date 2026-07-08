import * as React from 'react';

/**
 * Primary action button for Vibe Coder CRM. Slate-blue brand accent; one primary per screen.
 * @startingPoint section="Core" subtitle="Botón de acción con variantes y tamaños" viewport="700x150"
 */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual variant. Use `primary` for the single primary action per screen. */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  disabled?: boolean;
  /** Stretch to fill the container width. */
  full?: boolean;
  style?: React.CSSProperties;
}

export function Button(props: ButtonProps): JSX.Element;

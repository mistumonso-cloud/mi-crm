"use client";

import React from 'react';

const SIZES = {
  sm: { padding: '6px 10px', fontSize: 13, height: 32, radius: 'var(--radius-md)' },
  md: { padding: '9px 14px', fontSize: 14, height: 38, radius: 'var(--radius-md)' },
  lg: { padding: '11px 18px', fontSize: 15, height: 44, radius: 'var(--radius-md)' },
};

const VARIANTS = {
  primary: {
    background: 'var(--color-accent)',
    color: 'var(--color-accent-contrast)',
    border: '1px solid transparent',
  },
  secondary: {
    background: 'var(--color-surface)',
    color: 'var(--color-neutral-fg)',
    border: '1px solid var(--color-border)',
  },
  ghost: {
    background: 'transparent',
    color: 'var(--color-neutral-fg)',
    border: '1px solid transparent',
  },
  danger: {
    background: 'var(--color-danger)',
    color: '#fff',
    border: '1px solid transparent',
  },
};

/**
 * Botón de acción. Una sola acción primaria por pantalla.
 */
export function Button({
  children,
  variant = 'primary',
  size = 'md',
  iconLeft = null,
  iconRight = null,
  disabled = false,
  full = false,
  style = {},
  ...rest
}) {
  const s = SIZES[size] || SIZES.md;
  const v = VARIANTS[variant] || VARIANTS.primary;
  const [hover, setHover] = React.useState(false);
  const [active, setActive] = React.useState(false);

  const hoverBg = {
    primary: 'var(--color-accent-hover)',
    secondary: 'var(--color-muted)',
    ghost: 'var(--color-muted)',
    danger: 'var(--color-danger-fg)',
  }[variant];

  return (
    <button
      type="button"
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setActive(false); }}
      onMouseDown={() => setActive(true)}
      onMouseUp={() => setActive(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        width: full ? '100%' : 'auto',
        minHeight: s.height,
        padding: s.padding,
        fontSize: s.fontSize,
        fontWeight: 600,
        fontFamily: 'var(--font-sans)',
        lineHeight: 1,
        whiteSpace: 'nowrap',
        cursor: disabled ? 'not-allowed' : 'pointer',
        borderRadius: s.radius,
        transition: 'background .18s ease-out, transform .12s ease-out, box-shadow .18s ease-out',
        transform: active && !disabled ? 'scale(0.97)' : 'scale(1)',
        opacity: disabled ? 0.5 : 1,
        ...v,
        background: hover && !disabled ? hoverBg : v.background,
        ...style,
      }}
      {...rest}
    >
      {iconLeft}
      {children}
      {iconRight}
    </button>
  );
}

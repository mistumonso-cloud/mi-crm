"use client";

import React from 'react';

const PADS = { sm: 12, md: 16, lg: 20 };

/**
 * Contenedor de superficie: card blanca con borde hairline y sombra sutil.
 */
export function Card({
  children,
  padding = 'md',
  interactive = false,
  selected = false,
  style = {},
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const pad = typeof padding === 'number' ? padding : (PADS[padding] ?? 16);

  return (
    <div
      onMouseEnter={() => interactive && setHover(true)}
      onMouseLeave={() => interactive && setHover(false)}
      style={{
        background: 'var(--color-surface)',
        border: `1px solid ${selected ? 'var(--color-accent)' : 'var(--color-border)'}`,
        borderRadius: 'var(--radius-lg)',
        boxShadow: hover ? 'var(--shadow-md)' : 'var(--shadow-sm)',
        padding: pad,
        cursor: interactive ? 'pointer' : 'default',
        transition: 'box-shadow .18s ease-out, border-color .18s ease-out',
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

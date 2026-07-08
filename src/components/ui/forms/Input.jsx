"use client";

import React from 'react';

/**
 * Campo de texto con label, hint y estado de error opcionales.
 */
export function Input({
  label = null,
  hint = null,
  error = null,
  prefix = null,
  suffix = null,
  size = 'md',
  style = {},
  containerStyle = {},
  disabled = false,
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  const pad = size === 'sm' ? '7px 10px' : '10px 12px';
  const fontSize = size === 'sm' ? 13 : 14;
  const borderColor = error
    ? 'var(--color-danger)'
    : focus ? 'var(--color-accent)' : 'var(--color-border-strong)';
  const ring = error
    ? '0 0 0 3px rgba(239,68,68,.18)'
    : focus ? '0 0 0 3px rgba(59,82,102,.18)' : 'none';

  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontFamily: 'var(--font-sans)', ...containerStyle }}>
      {label && (
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</span>
      )}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: disabled ? 'var(--color-muted)' : 'var(--color-surface)',
          border: `1px solid ${borderColor}`,
          borderRadius: 'var(--radius-md)',
          padding: pad,
          boxShadow: ring,
          transition: 'border-color .18s ease-out, box-shadow .18s ease-out',
        }}
      >
        {prefix && <span style={{ color: 'var(--text-tertiary)', display: 'inline-flex' }}>{prefix}</span>}
        <input
          disabled={disabled}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontFamily: 'var(--font-sans)',
            fontSize,
            color: 'var(--text-primary)',
            minWidth: 0,
            ...style,
          }}
          {...rest}
        />
        {suffix && <span style={{ color: 'var(--text-tertiary)', display: 'inline-flex' }}>{suffix}</span>}
      </div>
      {(error || hint) && (
        <span style={{ fontSize: 12, color: error ? 'var(--color-danger-fg)' : 'var(--text-tertiary)' }}>
          {error || hint}
        </span>
      )}
    </label>
  );
}

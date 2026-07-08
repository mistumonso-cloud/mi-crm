"use client";

import React from 'react';

/**
 * Select nativo estilizado con la misma estética que Input.
 * options: array de { value, label } o de strings.
 */
export function Select({
  label = null,
  options = [],
  value,
  onChange,
  size = 'md',
  disabled = false,
  style = {},
  containerStyle = {},
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  const pad = size === 'sm' ? '7px 10px' : '10px 12px';
  const fontSize = size === 'sm' ? 13 : 14;
  const norm = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));

  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontFamily: 'var(--font-sans)', ...containerStyle }}>
      {label && (
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</span>
      )}
      <div style={{ position: 'relative', display: 'flex' }}>
        <select
          value={value}
          onChange={onChange}
          disabled={disabled}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          style={{
            appearance: 'none',
            WebkitAppearance: 'none',
            width: '100%',
            padding: pad,
            paddingRight: 34,
            fontFamily: 'var(--font-sans)',
            fontSize,
            color: 'var(--text-primary)',
            background: disabled ? 'var(--color-muted)' : 'var(--color-surface)',
            border: `1px solid ${focus ? 'var(--color-accent)' : 'var(--color-border-strong)'}`,
            borderRadius: 'var(--radius-md)',
            boxShadow: focus ? '0 0 0 3px rgba(59,82,102,.18)' : 'none',
            outline: 'none',
            cursor: disabled ? 'not-allowed' : 'pointer',
            transition: 'border-color .18s ease-out, box-shadow .18s ease-out',
            ...style,
          }}
          {...rest}
        >
          {norm.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ position: 'absolute', right: 11, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </div>
    </label>
  );
}

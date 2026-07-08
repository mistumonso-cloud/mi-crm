import React from 'react';

/**
 * Checkbox con label. Marcado usa el acento de marca.
 */
export function Checkbox({ checked = false, onChange, label = null, disabled = false, style = {}, ...rest }) {
  return (
    <label
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        fontFamily: 'var(--font-sans)',
        fontSize: 14,
        color: 'var(--text-primary)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        userSelect: 'none',
        ...style,
      }}
      {...rest}
    >
      <span
        onClick={() => !disabled && onChange && onChange(!checked)}
        style={{
          width: 18,
          height: 18,
          flexShrink: 0,
          borderRadius: 'var(--radius-sm)',
          border: `1.5px solid ${checked ? 'var(--color-accent)' : 'var(--color-border-strong)'}`,
          background: checked ? 'var(--color-accent)' : 'var(--color-surface)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background .15s ease-out, border-color .15s ease-out',
        }}
      >
        {checked && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        )}
      </span>
      {label}
    </label>
  );
}

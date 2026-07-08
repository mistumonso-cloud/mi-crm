import React from 'react';

/**
 * Switch (toggle) on/off. Estado activo usa el acento de marca.
 */
export function Switch({ checked = false, onChange, label = null, disabled = false, style = {}, ...rest }) {
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
          width: 36,
          height: 20,
          flexShrink: 0,
          borderRadius: 'var(--radius-full)',
          background: checked ? 'var(--color-accent)' : 'var(--color-border-strong)',
          position: 'relative',
          transition: 'background .18s ease-out',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: checked ? 18 : 2,
            width: 16,
            height: 16,
            borderRadius: 'var(--radius-full)',
            background: '#fff',
            boxShadow: '0 1px 2px rgba(16,24,40,.2)',
            transition: 'left .18s ease-out',
          }}
        />
      </span>
      {label}
    </label>
  );
}

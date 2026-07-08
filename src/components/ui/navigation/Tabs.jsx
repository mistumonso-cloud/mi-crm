"use client";

import React from 'react';

/**
 * Tabs subrayadas. tabs: array de { value, label } o strings.
 */
export function Tabs({ tabs = [], value, onChange, style = {}, ...rest }) {
  const norm = tabs.map((t) => (typeof t === 'string' ? { value: t, label: t } : t));
  return (
    <div
      style={{
        display: 'flex',
        gap: 4,
        borderBottom: '1px solid var(--color-border)',
        fontFamily: 'var(--font-sans)',
        ...style,
      }}
      {...rest}
    >
      {norm.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            onClick={() => onChange && onChange(t.value)}
            style={{
              appearance: 'none',
              border: 'none',
              background: 'transparent',
              padding: '10px 12px',
              marginBottom: -1,
              fontFamily: 'var(--font-sans)',
              fontSize: 14,
              fontWeight: 600,
              color: active ? 'var(--color-accent)' : 'var(--text-secondary)',
              borderBottom: `2px solid ${active ? 'var(--color-accent)' : 'transparent'}`,
              cursor: 'pointer',
              transition: 'color .15s ease-out, border-color .15s ease-out',
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

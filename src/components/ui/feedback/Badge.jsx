"use client";

import React from 'react';

const TONES = {
  success: { bg: 'var(--color-success-bg)', fg: 'var(--color-success-fg)' },
  warning: { bg: 'var(--color-warning-bg)', fg: 'var(--color-warning-fg)' },
  danger: { bg: 'var(--color-danger-bg)', fg: 'var(--color-danger-fg)' },
  neutral: { bg: 'var(--color-neutral-bg)', fg: 'var(--color-neutral-fg)' },
  accent: { bg: 'var(--color-accent-tint)', fg: 'var(--color-accent)' },
};

/**
 * Badge semántico genérico (success / warning / danger / neutral / accent).
 * El color comunica estado, no decora.
 */
export function Badge({ children, tone = 'neutral', dot = false, style = {}, ...rest }) {
  const t = TONES[tone] || TONES.neutral;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontFamily: 'var(--font-sans)',
        fontSize: 12,
        fontWeight: 600,
        lineHeight: 1,
        padding: '5px 10px',
        borderRadius: 'var(--radius-full)',
        background: t.bg,
        color: t.fg,
        whiteSpace: 'nowrap',
        ...style,
      }}
      {...rest}
    >
      {dot && (
        <span style={{ width: 6, height: 6, borderRadius: 999, background: 'currentColor' }} />
      )}
      {children}
    </span>
  );
}

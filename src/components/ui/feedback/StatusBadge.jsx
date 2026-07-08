"use client";

import React from 'react';

// The 7 canonical pipeline states. dot = the saturated accent color for the left dot.
export const PIPELINE_STATES = {
  lead:        { label: 'Lead nuevo',        bg: 'var(--status-lead-bg)',        fg: 'var(--status-lead-fg)',        dot: '#0EA5E9' },
  talking:     { label: 'En conversación',   bg: 'var(--status-talking-bg)',     fg: 'var(--status-talking-fg)',     dot: '#5B7387' },
  proposal:    { label: 'Propuesta enviada', bg: 'var(--status-proposal-bg)',    fg: 'var(--status-proposal-fg)',    dot: '#A855F7' },
  negotiating: { label: 'Negociando',        bg: 'var(--status-negotiating-bg)', fg: 'var(--status-negotiating-fg)', dot: '#F97316' },
  won:         { label: 'Ganado',            bg: 'var(--status-won-bg)',         fg: 'var(--status-won-fg)',         dot: '#22C55E' },
  lost:        { label: 'Perdido',           bg: 'var(--status-lost-bg)',        fg: 'var(--status-lost-fg)',        dot: '#EF4444' },
  inactive:    { label: 'Inactivo',          bg: 'var(--status-inactive-bg)',    fg: 'var(--status-inactive-fg)',    dot: '#9CA3AF' },
};

/**
 * Badge de estado del pipeline de ventas. Pill con punto de color a la izquierda.
 */
export function StatusBadge({ state = 'lead', label = null, dot = true, style = {}, ...rest }) {
  const s = PIPELINE_STATES[state] || PIPELINE_STATES.lead;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontFamily: 'var(--font-sans)',
        fontSize: 13,
        fontWeight: 600,
        lineHeight: 1,
        padding: '6px 12px',
        borderRadius: 'var(--radius-full)',
        background: s.bg,
        color: s.fg,
        whiteSpace: 'nowrap',
        ...style,
      }}
      {...rest}
    >
      {dot && (
        <span style={{ width: 7, height: 7, borderRadius: 999, background: s.dot, flexShrink: 0 }} />
      )}
      {label || s.label}
    </span>
  );
}

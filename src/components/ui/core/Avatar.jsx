"use client";

import React from 'react';

const SIZES = { xs: 24, sm: 32, md: 40, lg: 48 };

function initials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Deterministic muted tint from name — stays within the calm slate/neutral family.
const TINTS = [
  ['#EAEFF3', '#3B5266'],
  ['#E0F2FE', '#0369A1'],
  ['#DCFCE7', '#15803D'],
  ['#FEF3C7', '#B45309'],
  ['#F3E8FF', '#7E22CE'],
  ['#F3F4F6', '#374151'],
];

/**
 * Avatar con iniciales (o imagen). Forma circular (radius.full).
 */
export function Avatar({ name = '', src = null, size = 'md', style = {}, ...rest }) {
  const px = typeof size === 'number' ? size : (SIZES[size] ?? 40);
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const [bg, fg] = TINTS[hash % TINTS.length];

  return (
    <div
      style={{
        width: px,
        height: px,
        borderRadius: 'var(--radius-full)',
        background: src ? 'var(--color-muted)' : bg,
        color: fg,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font-sans)',
        fontWeight: 600,
        fontSize: Math.round(px * 0.38),
        lineHeight: 1,
        overflow: 'hidden',
        flexShrink: 0,
        userSelect: 'none',
        ...style,
      }}
      {...rest}
    >
      {src
        ? <img src={src} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : initials(name)}
    </div>
  );
}

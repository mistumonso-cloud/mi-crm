// Lucide icon path data (ISC-licensed, lucide.dev) — the closest match to the
// Linear/Notion minimalist stroke aesthetic this brand references. 24x24, stroke 2.
const PATHS = {
  dashboard: ['M3 3h7v9H3z', 'M14 3h7v5h-7z', 'M14 12h7v9h-7z', 'M3 16h7v5H3z'],
  pipeline: ['M6 5v11', 'M12 5v6', 'M18 5v14', 'M3 5h6v0', 'M9 5h6', 'M15 5h6'],
  contacts: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 7m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  tasks: ['M9 11l3 3L22 4', 'M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11'],
  settings: ['M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z', 'M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0'],
  search: ['M11 11m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0', 'M21 21l-4.35-4.35'],
  plus: ['M12 5v14', 'M5 12h14'],
  bell: ['M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9', 'M10.3 21a1.94 1.94 0 0 0 3.4 0'],
  chevronRight: ['M9 18l6-6-6-6'],
  chevronDown: ['M6 9l6 6 6-6'],
  phone: ['M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z'],
  mail: ['M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M22 7l-10 6L2 7'],
  calendar: ['M8 2v4', 'M16 2v4', 'M3 6h18v15a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M3 10h18'],
  more: ['M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0', 'M19 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0', 'M5 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0'],
  trendingUp: ['M22 7l-8.5 8.5-5-5L2 17', 'M16 7h6v6'],
  arrowLeft: ['M19 12H5', 'M12 19l-7-7 7-7'],
  building: ['M3 21h18', 'M5 21V7l8-4v18', 'M19 21V11l-6-4', 'M9 9v.01', 'M9 12v.01', 'M9 15v.01', 'M9 18v.01'],
  filter: ['M22 3H2l8 9.46V19l4 2v-8.54z'],
  check: ['M20 6L9 17l-5-5'],
  logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
  note: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M16 13H8', 'M16 17H8', 'M10 9H8'],
  zap: ['M13 2L3 14h9l-1 8 10-12h-9l1-8z'],
};

function Icon({ name, size = 20, color = 'currentColor', strokeWidth = 2, style = {}, ...rest }) {
  const d = PATHS[name];
  if (!d) return null;
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      style={{ display: 'block', flexShrink: 0, ...style }}
      {...rest}
    >
      {d.map((p, i) => <path key={i} d={p} />)}
    </svg>
  );
}

window.Icon = Icon;

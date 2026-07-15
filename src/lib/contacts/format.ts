// Fecha relativa en español para la lista de contactos (MIS-9). `now` es
// inyectable (por defecto Date.now()) para que page.tsx pueda capturarlo una
// sola vez y pasarlo a todas las filas — evita que servidor y cliente
// calculen "ahora" en instantes distintos y produzcan un mismatch de
// hidratación cerca de un umbral (ej. "hace 59 minutos" vs "hace 1 hora").
export function formatRelativeTime(ms: number, now: number = Date.now()): string {
  const diffMs = Math.max(0, now - ms);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  const month = 30 * day;

  if (diffMs < minute) return "ahora mismo";
  if (diffMs < hour) {
    const m = Math.floor(diffMs / minute);
    return `hace ${m} minuto${m === 1 ? "" : "s"}`;
  }
  if (diffMs < day) {
    const h = Math.floor(diffMs / hour);
    return `hace ${h} hora${h === 1 ? "" : "s"}`;
  }
  if (diffMs < 2 * day) return "ayer";
  if (diffMs < week) {
    const d = Math.floor(diffMs / day);
    return `hace ${d} días`;
  }
  if (diffMs < month) {
    const w = Math.floor(diffMs / week);
    return `hace ${w} semana${w === 1 ? "" : "s"}`;
  }
  const mo = Math.floor(diffMs / month);
  return `hace ${mo} mes${mo === 1 ? "" : "es"}`;
}

// Fecha/hora absoluta para notas reales de MIS-11 (formatRelativeTime sigue
// usándose sin cambios para "Contacto añadido"/initialNote). timeZone fijo a
// "Europe/Madrid" a propósito: ContactDetailView se renderiza tanto en el
// servidor (HTML inicial) como en el cliente (hidratación); sin timeZone
// explícito, Intl.DateTimeFormat usaría la zona ambiente de cada entorno y
// produciría un mismatch de hidratación. Con una zona fija, ambos entornos
// producen siempre el mismo string. Asunción documentada: CRM de un solo
// país (Carlos/Marta operan desde España).
export function formatDateTime(ms: number): string {
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Madrid",
  }).format(new Date(ms));
}

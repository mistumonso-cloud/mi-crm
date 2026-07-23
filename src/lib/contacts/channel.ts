// Canales de captación (MIS-8, reapertura jul 2026). Claves estables en
// inglés, etiqueta en español desacoplada — mismo patrón que NOTE_TYPES en
// src/lib/notes/types.ts frente al v.union(v.literal(...)) de
// convex/schema.ts: sin fuente de verdad compartida entre schema y UI, ya
// aceptado hoy en el repo.
export const CONTACT_CHANNELS = {
  instagram: { label: "Instagram" },
  web: { label: "Web" },
  llamada: { label: "Llamada" },
  whatsapp: { label: "WhatsApp" },
  referido: { label: "Referido" },
} as const;

export type ContactChannel = keyof typeof CONTACT_CHANNELS;

export const CONTACT_CHANNEL_OPTIONS: Array<{ value: ContactChannel; label: string }> = (
  Object.keys(CONTACT_CHANNELS) as ContactChannel[]
).map((value) => ({ value, label: CONTACT_CHANNELS[value].label }));

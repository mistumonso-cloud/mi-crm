// Tipos de nota (MIS-11). Claves estables en inglés, etiqueta en español
// desacoplada — mismo patrón que PIPELINE_STATES en StatusBadge.jsx frente al
// v.union(v.literal(...)) de convex/schema.ts: sin fuente de verdad
// compartida entre schema y UI, ya aceptado hoy en el repo.
export const NOTE_TYPES = {
  whatsapp: { label: "WhatsApp" },
  call: { label: "Llamada" },
  email: { label: "Email" },
  dm: { label: "DM Instagram" },
  meeting: { label: "Reunión" },
} as const;

export type NoteType = keyof typeof NOTE_TYPES;

export const NOTE_TYPE_OPTIONS: Array<{ value: NoteType; label: string }> = (
  Object.keys(NOTE_TYPES) as NoteType[]
).map((value) => ({ value, label: NOTE_TYPES[value].label }));

// Tipo del estado de pipeline de un contacto — mismos 7 literales que
// contacts.status en convex/schema.ts / contactStatusValidator en
// convex/contacts.ts. Tipo puro (sin v.union de Convex), duplicado a
// propósito frente al schema — mismo criterio ya aceptado en el repo (ver
// contactStatusValidator duplicado en convex/reminders.ts). Existe para
// tipar código de src/ (incluido src/lib/notes/history.ts) sin acoplar a
// los tipos generados de Convex.
export type ContactStatus =
  | "lead"
  | "talking"
  | "proposal"
  | "negotiating"
  | "won"
  | "lost"
  | "inactive";

// Subconjunto seleccionable desde "Cambiar estado" (MIS-14): exactamente
// los 6 estados del AC del ticket en Linear, en el orden en que se
// muestran los botones del picker. Excluye "inactive" a propósito (ver
// CHANGEABLE_STATUSES en convex/contacts.ts, comentario gemelo).
//
// Sin labels propios aquí: los textos a mostrar vienen siempre de
// PIPELINE_STATES en StatusBadge.jsx (única fuente de verdad de etiquetas
// de estado ya usada en ContactList/Pendientes/ficha) — no se duplica
// texto en este archivo para no arriesgar una etiqueta inconsistente con
// lo que ya se muestra en el resto de la app.
export const SELECTABLE_STATUSES: readonly Exclude<ContactStatus, "inactive">[] = [
  "lead",
  "talking",
  "proposal",
  "negotiating",
  "won",
  "lost",
];

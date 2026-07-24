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

// Subconjunto seleccionable desde "Cambiar estado" (MIS-14, reapertura jul
// 2026): los 6 estados del AC reabierto, de "Lead nuevo" a "Perdido", SIN
// "Ganado". "Ganado" deja de ser alcanzable por este picker manual a partir
// de esta reapertura: solo se asigna al cerrar una venta (closeSale en
// convex/sales.ts, MIS-15) — closeSale nunca consultó esta constante, no le
// afecta este cambio. "Inactivo" entra a cambio: existe en el schema desde
// MIS-9, pero hasta esta reapertura ningún código podía asignarlo. v1/v2 de
// este ticket tenía la combinación inversa exacta — ver
// PLANS/MIS-14-gestion-estados-contacto.md, sección histórica.
//
// No confundir con PIPELINE_SUMMARY_STATUSES, más abajo: consumidor
// distinto (panel de Marta / filtro de la lista), que conserva a propósito
// los 6 valores ANTIGUOS.
//
// Sin labels propios aquí: los textos vienen siempre de PIPELINE_STATES en
// StatusBadge.jsx (única fuente de verdad ya usada en
// ContactList/Pendientes/ficha) — no se duplica texto en este archivo.
export const SELECTABLE_STATUSES: readonly Exclude<ContactStatus, "won">[] = [
  "lead",
  "talking",
  "proposal",
  "negotiating",
  "inactive",
  "lost",
];

// Subconjunto usado por el desglose del panel de Marta (MIS-17,
// panel/page.tsx) y por el filtro ?status= de /contactos (contactos/
// page.tsx, que valida los deep links que el propio panel genera) — los 6
// estados "activos canónicos" del AC de MIS-17 (de "Lead nuevo" a
// "Perdido", CON "Ganado", SIN "Inactivo"), en la misma forma que devuelve
// getPipelineSummary en convex/contacts.ts.
//
// Deliberadamente DISTINTO de SELECTABLE_STATUSES a partir de esta
// reapertura de MIS-14 (jul 2026). Antes de este cambio ambas constantes
// coincidían por COINCIDENCIA, no por diseño: panel/page.tsx y
// contactos/page.tsx importaban SELECTABLE_STATUSES (el array del picker
// de "Cambiar estado") sin motivo real para compartirlo con el panel — un
// acoplamiento accidental. El checklist de esta reapertura de MIS-14 no
// incluye al panel entre las pantallas a revisar; su propio rediseño (que
// sí tocaría este array, para incluir "Inactivo" y mover "Ganado" a su
// propia tarjeta de ventas) queda para la futura reapertura de MIS-17, que
// ya referencia este cambio en su propio ticket de Linear ("Depende de la
// migración de datos de MIS-14").
export const PIPELINE_SUMMARY_STATUSES: readonly Exclude<ContactStatus, "inactive">[] = [
  "lead",
  "talking",
  "proposal",
  "negotiating",
  "won",
  "lost",
];

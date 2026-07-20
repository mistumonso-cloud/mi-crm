import type { NoteType } from "./types";

export type HistoryEntry =
  | { key: string; kind: "created"; timestamp: number }
  | { key: string; kind: "initialNote"; timestamp: number; text: string }
  | { key: string; kind: "note"; timestamp: number; type: NoteType; text: string; authorName: string }
  | { key: string; kind: "reminderDone"; timestamp: number; reason: string; completedByName: string };

export function buildHistory(
  contact: { initialNote?: string; _creationTime: number },
  notes: Array<{ _id: string; type: NoteType; occurredAt: number; text: string; authorName: string }>,
  completedReminders: Array<{ _id: string; completedAt: number; reason: string; completedByName: string }> = [],
): HistoryEntry[] {
  const entries: HistoryEntry[] = [];

  // Orden de inserción deliberado: initialNote ANTES que "created". Ambas
  // comparten el mismo timestamp (contact._creationTime, sin cambios respecto
  // a hoy) — Array.prototype.sort es estable desde ES2019, así que un empate
  // exacto conserva este orden relativo tras ordenar desc, igual que el
  // orden visual que ya existe hoy en el JSX.
  if (contact.initialNote) {
    entries.push({ key: "initial-note", kind: "initialNote", timestamp: contact._creationTime, text: contact.initialNote });
  }
  entries.push({ key: "created", kind: "created", timestamp: contact._creationTime });

  for (const n of notes) {
    entries.push({ key: n._id, kind: "note", timestamp: n.occurredAt, type: n.type, text: n.text, authorName: n.authorName });
  }

  // MIS-12: los seguimientos ya completados también forman parte del
  // historial (AC explícito: "el seguimiento hecho queda en el historial").
  // timestamp = completedAt (el instante REAL de la acción de completar),
  // no dueAt (la fecha que se había programado) — mismo criterio que
  // occurredAt en notes: el momento del evento real, no el de creación del
  // registro ni el de la fecha originalmente programada.
  for (const r of completedReminders) {
    entries.push({ key: r._id, kind: "reminderDone", timestamp: r.completedAt, reason: r.reason, completedByName: r.completedByName });
  }

  return entries.sort((a, b) => b.timestamp - a.timestamp);
}

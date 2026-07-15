import type { NoteType } from "./types";

export type HistoryEntry =
  | { key: string; kind: "created"; timestamp: number }
  | { key: string; kind: "initialNote"; timestamp: number; text: string }
  | { key: string; kind: "note"; timestamp: number; type: NoteType; text: string; authorName: string };

export function buildHistory(
  contact: { initialNote?: string; _creationTime: number },
  notes: Array<{ _id: string; type: NoteType; occurredAt: number; text: string; authorName: string }>,
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

  return entries.sort((a, b) => b.timestamp - a.timestamp);
}

import type { NoteType } from "./types";
import type { ContactStatus } from "@/lib/contacts/status";

export type HistoryEntry =
  | { key: string; kind: "created"; timestamp: number; createdByName: string }
  | { key: string; kind: "initialNote"; timestamp: number; text: string; createdByName: string }
  | { key: string; kind: "note"; timestamp: number; type: NoteType; text: string; authorName: string }
  | { key: string; kind: "reminderDone"; timestamp: number; reason: string; completedByName: string }
  | {
      key: string;
      kind: "statusChanged";
      timestamp: number;
      fromStatus: ContactStatus;
      toStatus: ContactStatus;
      changedByName: string;
    }
  // MIS-15: unión discriminada anidada (kind + outcome) — evita que este
  // tipo permita estados imposibles (una entrada "saleClosed" con
  // product/amountCents pero sin ellos siendo realmente aplicables, o con
  // lossReason y product a la vez). Mismo razonamiento que el documento de
  // saleClosures en convex/schema.ts, trasladado a este tipo puro de src/.
  | {
      key: string;
      kind: "saleClosed";
      timestamp: number;
      outcome: "won";
      product: string;
      amountCents: number;
      purchaseDate: number;
      closedByName: string;
    }
  | {
      key: string;
      kind: "saleClosed";
      timestamp: number;
      outcome: "lost";
      lossReason: string;
      closedByName: string;
    };

export function buildHistory(
  // MIS-16: responsibleName ya lo devuelve getContact (convex/contacts.ts) —
  // obligatorio en el schema (contacts.createdBy no es opcional), así que
  // tampoco lo es aquí. Se usa para poblar createdByName en las entradas
  // "created"/"initialNote" (AC: "Creación del contacto... y quién lo
  // registró", antes ausente).
  contact: { initialNote?: string; _creationTime: number; responsibleName: string },
  notes: Array<{ _id: string; type: NoteType; occurredAt: number; text: string; authorName: string }>,
  completedReminders: Array<{ _id: string; completedAt: number; reason: string; completedByName: string }> = [],
  statusChanges: Array<{
    _id: string;
    fromStatus: ContactStatus;
    toStatus: ContactStatus;
    changedByName: string;
    changedAt: number;
  }> = [],
  saleClosures: Array<
    | {
        _id: string;
        outcome: "won";
        product: string;
        amountCents: number;
        purchaseDate: number;
        closedByName: string;
        closedAt: number;
      }
    | { _id: string; outcome: "lost"; lossReason: string; closedByName: string; closedAt: number }
  > = [],
): HistoryEntry[] {
  const entries: HistoryEntry[] = [];

  // Orden de inserción deliberado: initialNote ANTES que "created". Ambas
  // comparten el mismo timestamp (contact._creationTime, sin cambios respecto
  // a hoy) — Array.prototype.sort es estable desde ES2019, así que un empate
  // exacto conserva este orden relativo tras ordenar desc, igual que el
  // orden visual que ya existe hoy en el JSX.
  if (contact.initialNote) {
    entries.push({
      key: "initial-note",
      kind: "initialNote",
      timestamp: contact._creationTime,
      text: contact.initialNote,
      createdByName: contact.responsibleName, // MIS-16
    });
  }
  entries.push({
    key: "created",
    kind: "created",
    timestamp: contact._creationTime,
    createdByName: contact.responsibleName, // MIS-16
  });

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

  // MIS-14: cada cambio de estado también forma parte del historial (AC
  // explícito). timestamp = changedAt (instante real del cambio,
  // server-authoritative) — mismo criterio que completedAt en reminders.
  for (const s of statusChanges) {
    entries.push({
      key: s._id,
      kind: "statusChanged",
      timestamp: s.changedAt,
      fromStatus: s.fromStatus,
      toStatus: s.toStatus,
      changedByName: s.changedByName,
    });
  }

  // MIS-15: cada cierre de venta también forma parte del historial (AC
  // explícito: "el cierre queda en el historial de actividad del
  // contacto"). timestamp = closedAt (instante REAL en que se registró el
  // cierre, server-authoritative) — NO purchaseDate, que puede ser una
  // fecha pasada elegida por el usuario. Mismo criterio que completedAt en
  // reminders/changedAt en statusChanges: el momento del evento real, no
  // una fecha de negocio elegida. closeSale (convex/sales.ts) inserta
  // también una fila en statusChanges con el MISMO changedAt/closedAt, así
  // que un cierre de venta produce dos entradas con idéntico timestamp —
  // el sort estable (ver comentario de arriba) las mantiene juntas y en
  // orden de inserción relativo entre sí.
  for (const s of saleClosures) {
    if (s.outcome === "won") {
      entries.push({
        key: s._id,
        kind: "saleClosed",
        timestamp: s.closedAt,
        outcome: "won",
        product: s.product,
        amountCents: s.amountCents,
        purchaseDate: s.purchaseDate,
        closedByName: s.closedByName,
      });
    } else {
      entries.push({
        key: s._id,
        kind: "saleClosed",
        timestamp: s.closedAt,
        outcome: "lost",
        lossReason: s.lossReason,
        closedByName: s.closedByName,
      });
    }
  }

  return entries.sort((a, b) => b.timestamp - a.timestamp);
}

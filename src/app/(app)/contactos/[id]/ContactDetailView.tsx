"use client";

import { useState } from "react";
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../../../convex/_generated/api";
import { Card } from "@/components/ui/core/Card";
import { Button } from "@/components/ui/core/Button";
import { Avatar } from "@/components/ui/core/Avatar";
import { StatusBadge } from "@/components/ui/feedback/StatusBadge";
import { BottomSheet } from "@/components/ui/overlays/BottomSheet";
import { formatRelativeTime, formatDateTime, formatDate } from "@/lib/contacts/format";
import { buildHistory } from "@/lib/notes/history";
import { NOTE_TYPES } from "@/lib/notes/types";
import { AddNoteForm } from "./AddNoteForm";
import { ScheduleReminderForm } from "./ScheduleReminderForm";
import { CompleteReminderButton } from "@/components/crm/CompleteReminderButton";

type Contact = NonNullable<FunctionReturnType<typeof api.contacts.getContact>>;
type Notes = FunctionReturnType<typeof api.notes.listNotes>;
type Reminders = FunctionReturnType<typeof api.reminders.listRemindersForContact>;
type SheetKind = "note" | "status" | "schedule" | "close" | null;

const SHEET_TITLES: Record<"note" | "status" | "close", string> = {
  note: "Nueva nota",
  status: "Cambiar estado",
  close: "Cerrar venta",
};

// "schedule" tiene título dinámico (Programar vs. Reprogramar) según si ya
// existe un recordatorio pendiente — el resto usa el mapa estático de arriba.
function sheetTitleFor(sheet: SheetKind, hasCurrentReminder: boolean): string | undefined {
  if (sheet === null) return undefined;
  if (sheet === "schedule") return hasCurrentReminder ? "Reprogramar seguimiento" : "Programar seguimiento";
  return SHEET_TITLES[sheet];
}

function PhoneIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-10 6L2 7" />
    </svg>
  );
}

export function ContactDetailView({
  contact,
  now,
  notes,
  reminders,
}: {
  contact: Contact;
  now: number;
  notes: Notes;
  reminders: Reminders;
}) {
  const [sheet, setSheet] = useState<SheetKind>(null);
  const isClosed = contact.status === "won" || contact.status === "lost";
  const history = buildHistory(contact, notes, reminders.completed);

  return (
    <div className="flex flex-1 flex-col" style={{ padding: "16px 20px 24px", gap: 16 }}>
      <Card padding="md" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Avatar name={contact.name} size="lg" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>{contact.name}</h1>
            <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
              Responsable: {contact.responsibleName}
            </span>
          </div>
          <StatusBadge state={contact.status} />
        </div>

        {contact.phone && (
          <a
            href={`tel:${contact.phone}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 14,
              color: "var(--text-secondary)",
              textDecoration: "none",
            }}
          >
            <PhoneIcon />
            {contact.phone}
          </a>
        )}
        {contact.email && (
          <a
            href={`mailto:${contact.email}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 14,
              color: "var(--text-secondary)",
              textDecoration: "none",
            }}
          >
            <MailIcon />
            {contact.email}
          </a>
        )}
      </Card>

      {/* MIS-12: Card real de "Próximo seguimiento". Se sigue ocultando por
          completo cuando el contacto está cerrado (won/lost) y NO hay
          ningún recordatorio pendiente ya existente — igual que hacía el
          placeholder de MIS-11. Pero si SÍ hay uno pendiente, se sigue
          mostrando aunque el contacto se cierre después (para no perder de
          vista un seguimiento ya programado ni impedir completarlo); en ese
          caso se oculta solo "Reprogramar" (no tiene sentido programar un
          seguimiento nuevo sobre un contacto cerrado), pero "Marcar hecho"
          sigue disponible. */}
      {reminders.current && (
        <Card
          padding="md"
          style={{ background: "var(--color-warning-bg)", display: "flex", flexDirection: "column", gap: 10 }}
        >
          <div>
            <p style={{ fontSize: 12, fontWeight: 700, color: "var(--color-warning-fg)", marginBottom: 2 }}>
              Próximo seguimiento · {formatDate(reminders.current.dueAt)}
            </p>
            <p style={{ fontSize: 14, color: "var(--text-primary)" }}>{reminders.current.reason}</p>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {!isClosed && (
              <Button variant="secondary" size="sm" style={{ flex: "1 1 130px" }} onClick={() => setSheet("schedule")}>
                Reprogramar
              </Button>
            )}
            <CompleteReminderButton reminderId={reminders.current._id} style={{ flex: "1 1 130px" }} />
          </div>
        </Card>
      )}
      {!reminders.current && !isClosed && (
        <Card
          padding="md"
          style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}
        >
          <p style={{ fontSize: 13, color: "var(--text-secondary)", flex: "1 1 160px" }}>
            Sin seguimiento programado
          </p>
          <Button variant="secondary" size="sm" onClick={() => setSheet("schedule")}>
            Programar seguimiento
          </Button>
        </Card>
      )}

      {/* flexWrap + flex-basis (no solo flex:1): en viewports estrechos
          (320-390px) 3 botones de ancho igual con texto sin salto de línea
          (Button fuerza whiteSpace: nowrap) desbordaban o se comprimían
          ilegibles — hallazgo mayor de la auditoría de código v1 (MIS-10).
          Con flex-basis de 130px, 2 caben por fila y el tercero baja a una
          segunda fila y se estira a todo el ancho, sin overflow horizontal
          en ningún tamaño. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <Button variant="secondary" size="sm" style={{ flex: "1 1 130px" }} onClick={() => setSheet("note")}>
          Añadir nota
        </Button>
        <Button variant="secondary" size="sm" style={{ flex: "1 1 130px" }} onClick={() => setSheet("status")}>
          Cambiar estado
        </Button>
        {!isClosed && (
          <Button variant="primary" size="sm" style={{ flex: "1 1 130px" }} onClick={() => setSheet("close")}>
            Cerrar venta
          </Button>
        )}
      </div>

      <div>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>
          Historial
        </h2>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {history.map((entry) => (
            <li key={entry.key}>
              <Card padding="sm">
                <p style={{ fontSize: 12, color: "var(--text-tertiary)", marginBottom: 4 }}>
                  {entry.kind === "note"
                    ? `${NOTE_TYPES[entry.type].label} · ${formatDateTime(entry.timestamp)} · ${entry.authorName}`
                    : entry.kind === "reminderDone"
                    ? `Seguimiento · ${formatDateTime(entry.timestamp)} · ${entry.completedByName}`
                    : formatRelativeTime(entry.timestamp, now)}
                </p>
                <p style={{ fontSize: 14, color: "var(--text-primary)" }}>
                  {entry.kind === "created"
                    ? "Contacto añadido"
                    : entry.kind === "reminderDone"
                    ? `Seguimiento completado: ${entry.reason}`
                    : entry.text}
                </p>
              </Card>
            </li>
          ))}
        </ul>
        {!contact.initialNote && notes.length === 0 && reminders.completed.length === 0 && (
          <p style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 8 }}>
            Aún no hay más actividad registrada.
          </p>
        )}
      </div>

      <BottomSheet
        open={sheet !== null}
        onClose={() => setSheet(null)}
        title={sheetTitleFor(sheet, reminders.current !== null)}
      >
        {sheet === "note" ? (
          <AddNoteForm contactId={contact._id} onDone={() => setSheet(null)} />
        ) : sheet === "schedule" ? (
          <ScheduleReminderForm
            contactId={contact._id}
            initialDueAt={reminders.current?.dueAt}
            initialReason={reminders.current?.reason}
            onDone={() => setSheet(null)}
          />
        ) : (
          <>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 16 }}>
              Disponible próximamente.
            </p>
            <Button variant="secondary" full onClick={() => setSheet(null)}>
              Cancelar
            </Button>
          </>
        )}
      </BottomSheet>
    </div>
  );
}

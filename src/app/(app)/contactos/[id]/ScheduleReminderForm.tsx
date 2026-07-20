"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/core/Button";
import { Input } from "@/components/ui/forms/Input";
import { scheduleReminderAction, type ScheduleReminderState } from "@/lib/reminders/actions";

const initialState: ScheduleReminderState = undefined;

// "YYYY-MM-DD" en la zona LOCAL del navegador (getFullYear/getMonth/getDate,
// nunca los getUTC*) — mismo cuidado que nowForDatetimeLocal() en
// AddNoteForm.tsx, para reconstruir exactamente el mismo día civil con el
// que se creó/editó el valor.
function msToDateLocal(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// input type="date" produce "YYYY-MM-DD". new Date("YYYY-MM-DD") lo
// interpretaría como MEDIANOCHE UTC (el spec ECMA-262 trata las formas
// fecha-only como UTC, a diferencia de datetime-local) — un desfase de
// zona horaria real para cualquier usuario al oeste de Greenwich.
// Troceamos el string y usamos el constructor new Date(y, m, d) (LOCAL),
// igual que el propio input lo interpreta visualmente. Se calcula en el
// NAVEGADOR: la Server Action nunca reparsea el string.
function dateLocalToMs(dateLocal: string): number {
  const [y, m, d] = dateLocal.split("-").map(Number);
  if (!y || !m || !d) return NaN;
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

export function ScheduleReminderForm({
  contactId,
  initialDueAt,
  initialReason,
  onDone,
}: {
  contactId: string;
  initialDueAt?: number;
  initialReason?: string;
  onDone: () => void;
}) {
  const [state, formAction, isPending] = useActionState(scheduleReminderAction, initialState);
  // Inicializador perezoso: se evalúa una sola vez al montar. Este
  // componente solo se monta cuando se abre la hoja ("schedule") —
  // BottomSheet desmonta los children al cerrar, así que al reabrir (p.ej.
  // para reprogramar otro contacto, o el mismo tras cambiar de fecha) se
  // recalcula con las props actuales.
  const [dueDateLocal, setDueDateLocal] = useState(() => msToDateLocal(initialDueAt ?? Date.now()));

  useEffect(() => {
    if (state?.success) onDone();
  }, [state, onDone]);

  const dueDateMs = dueDateLocal ? dateLocalToMs(dueDateLocal) : NaN;

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <input type="hidden" name="contactId" value={contactId} />
      <input type="hidden" name="dueDateMs" value={Number.isFinite(dueDateMs) ? dueDateMs : ""} />
      <Input
        label="Fecha del próximo contacto"
        type="date"
        value={dueDateLocal}
        onChange={(e) => setDueDateLocal(e.target.value)}
        required
        disabled={isPending}
        error={state && "field" in state && state.field === "dueAt" ? state.error : null}
      />
      {/* Campo de texto corto, no controlado (name="reason" + defaultValue
          para el caso "Reprogramar") — mismo patrón que name/phone en
          NewContactForm.tsx: sin useState salvo que haga falta cómputo
          derivado en el cliente (que sí hace falta para la fecha, no para
          este campo). */}
      <Input
        label="Motivo o qué hay que hacer"
        name="reason"
        placeholder="Ej.: Llamar para cerrar la propuesta"
        defaultValue={initialReason}
        required
        maxLength={200} // mismo límite que REASON_MAX en convex/reminders.ts — solo hint de UI, la mutation es la autoridad real
        disabled={isPending}
        error={state && "field" in state && state.field === "reason" ? state.error : null}
      />
      {state && "error" in state && !state.field && (
        <div role="alert" style={{ fontSize: 13, color: "var(--color-danger-fg)" }}>
          {state.error}
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <Button type="button" variant="secondary" full onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" full disabled={isPending}>
          {isPending ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    </form>
  );
}

"use client";

import { useActionState } from "react";
import type { CSSProperties } from "react";
import { Button } from "@/components/ui/core/Button";
import { completeReminderAction, type CompleteReminderState } from "@/lib/reminders/actions";

const initialState: CompleteReminderState = undefined;

// Botón "Marcar hecho" reutilizado tal cual en la ficha del contacto
// (ContactDetailView.tsx) y en la lista de Pendientes (pendientes/page.tsx)
// — misma Server Action, mismo componente, sin duplicar formulario ni
// manejo de estado en dos sitios (AC: "marcar como hecho desde ficha o
// pendientes").
export function CompleteReminderButton({
  reminderId,
  style,
}: {
  reminderId: string;
  style?: CSSProperties;
}) {
  const [state, formAction, isPending] = useActionState(completeReminderAction, initialState);

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 4, ...style }}>
      <input type="hidden" name="reminderId" value={reminderId} />
      <Button type="submit" variant="primary" size="sm" full disabled={isPending}>
        {isPending ? "Guardando…" : "Marcar hecho"}
      </Button>
      {state && !state.success && (
        <span role="alert" style={{ fontSize: 12, color: "var(--color-danger-fg)" }}>
          {state.error}
        </span>
      )}
    </form>
  );
}

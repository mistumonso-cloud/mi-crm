"use client";

import { useActionState, useEffect } from "react";
import { Button } from "@/components/ui/core/Button";
import { StatusBadge } from "@/components/ui/feedback/StatusBadge";
import { SELECTABLE_STATUSES, type ContactStatus } from "@/lib/contacts/status";
import { changeStatusAction, type ChangeStatusState } from "@/lib/contacts/actions";

const initialState: ChangeStatusState = undefined;

// Único <form> con un <button type="submit" name="status" value="..."> por
// estado destino — al pulsar uno, el navegador solo incluye ESE par
// name/value en el FormData (semántica nativa de <button type="submit">
// múltiples en un mismo form), sin JS adicional ni confirmación aparte.
// Satisface "se guarda en un solo paso" y "máximo 2 toques" del AC: toque
// 1 = abrir la hoja (botón "Cambiar estado" en ContactDetailView), toque 2
// = pulsar el estado destino aquí, que ya envía el formulario.
export function ChangeStatusForm({
  contactId,
  currentStatus,
  onDone,
}: {
  contactId: string;
  currentStatus: ContactStatus;
  onDone: () => void;
}) {
  const [state, formAction, isPending] = useActionState(changeStatusAction, initialState);

  useEffect(() => {
    if (state?.success) onDone();
  }, [state, onDone]);

  // Excluye el estado actual: no tiene sentido "cambiar" a lo mismo, y así
  // ningún botón envía una petición no-op (que la mutation rechazaría
  // igualmente como defensa en profundidad si se manipulara el POST — ver
  // changeContactStatus en convex/contacts.ts).
  const targets = SELECTABLE_STATUSES.filter((s) => s !== currentStatus);

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <input type="hidden" name="contactId" value={contactId} />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {targets.map((s) => (
          <Button
            key={s}
            type="submit"
            name="status"
            value={s}
            variant="secondary"
            full
            disabled={isPending}
            style={{ justifyContent: "flex-start" }}
          >
            <StatusBadge state={s} />
          </Button>
        ))}
      </div>
      {state && "error" in state && (
        <div role="alert" style={{ fontSize: 13, color: "var(--color-danger-fg)" }}>
          {state.error}
        </div>
      )}
      <Button type="button" variant="ghost" full onClick={onDone} disabled={isPending}>
        Cancelar
      </Button>
    </form>
  );
}

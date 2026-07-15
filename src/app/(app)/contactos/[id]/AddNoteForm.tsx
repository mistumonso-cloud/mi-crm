"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/core/Button";
import { Input } from "@/components/ui/forms/Input";
import { Select } from "@/components/ui/forms/Select";
import { NOTE_TYPE_OPTIONS } from "@/lib/notes/types";
import { addNoteAction, type AddNoteState } from "@/lib/notes/actions";

const initialState: AddNoteState = undefined;

function nowForDatetimeLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AddNoteForm({ contactId, onDone }: { contactId: string; onDone: () => void }) {
  const [state, formAction, isPending] = useActionState(addNoteAction, initialState);
  // Inicializador perezoso: se evalúa una sola vez al montar (este componente
  // solo se monta tras un click de usuario — BottomSheet devuelve null con
  // open=false, así que nunca se renderiza en el servidor). Se recalcula cada
  // vez que se reabre la hoja porque BottomSheet desmonta los children al
  // cerrar. Deliberadamente NO se reutiliza el `now` del Server Component:
  // ese valor se capturó una sola vez en la carga de la página y puede llevar
  // minutos de retraso para cuando el usuario abre este formulario.
  const [occurredAtLocal, setOccurredAtLocal] = useState(nowForDatetimeLocal);

  useEffect(() => {
    if (state?.success) onDone();
  }, [state, onDone]);

  // new Date(occurredAtLocal) corre en el NAVEGADOR: se interpreta en la zona
  // horaria real del usuario, justo lo que queremos. Se envía como epoch ms
  // — la Server Action nunca vuelve a parsear el string datetime-local (ver
  // hallazgo bloqueante de la auditoría de plan v1→v2).
  const occurredAtMs = occurredAtLocal ? new Date(occurredAtLocal).getTime() : NaN;

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <input type="hidden" name="contactId" value={contactId} />
      <input type="hidden" name="occurredAtMs" value={Number.isFinite(occurredAtMs) ? occurredAtMs : ""} />
      <Select
        label="Tipo de contacto"
        name="type"
        options={NOTE_TYPE_OPTIONS}
        defaultValue={NOTE_TYPE_OPTIONS[0].value}
        disabled={isPending}
      />
      {state && "field" in state && state.field === "type" && (
        <span style={{ fontSize: 12, color: "var(--color-danger-fg)" }}>{state.error}</span>
      )}
      <Input
        label="Fecha y hora"
        type="datetime-local"
        value={occurredAtLocal}
        onChange={(e) => setOccurredAtLocal(e.target.value)}
        required
        disabled={isPending}
        error={state && "field" in state && state.field === "occurredAt" ? state.error : null}
      />
      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>Resumen</span>
        <textarea
          name="text"
          required
          rows={4}
          maxLength={2000}
          disabled={isPending}
          style={{
            width: "100%",
            padding: "10px 12px",
            fontFamily: "var(--font-sans)",
            fontSize: 14,
            color: "var(--text-primary)",
            background: isPending ? "var(--color-muted)" : "var(--color-surface)",
            border: "1px solid var(--color-border-strong)",
            borderRadius: "var(--radius-md)",
            outline: "none",
            resize: "vertical",
          }}
        />
        {state && "field" in state && state.field === "text" && (
          <span style={{ fontSize: 12, color: "var(--color-danger-fg)" }}>{state.error}</span>
        )}
      </label>
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

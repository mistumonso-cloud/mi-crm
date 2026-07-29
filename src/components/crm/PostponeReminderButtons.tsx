"use client";

import { useActionState, useRef } from "react";
import type { CSSProperties } from "react";
import { Button } from "@/components/ui/core/Button";
import { postponeReminderAction, type PostponeReminderState } from "@/lib/reminders/actions";

const initialState: PostponeReminderState = undefined;

// Suma `days` días naturales a la fecha LOCAL de "ahora" (no al dueAt
// existente del recordatorio) — "mañana"/"+3 días" es una expectativa
// relativa al momento en que se pulsa el botón, no al vencimiento original
// (relevante para un recordatorio ya atrasado). Mismo constructor
// new Date(y, m, d) LOCAL que dateLocalToMs en ScheduleReminderForm.tsx.
function addDaysFromNow(days: number): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, 0, 0, 0, 0).getTime();
}

// Un mini-form por opción (mismo patrón que CompleteReminderButton.tsx:
// useActionState + <input type="hidden"> + submit), reutilizado dos veces
// desde PostponeReminderButtons. El hidden "dueAt" se calcula en el
// onClick del botón, no al montar el componente (sugerencia media de la
// auditoría de plan: si la pantalla de Pendientes se deja abierta durante
// la noche, un valor calculado solo al montar quedaría obsoleto) —
// mutación directa del input vía ref, síncrona con el propio evento de
// click, así que el valor ya actualizado es el que lee el navegador al
// construir el FormData del envío nativo del formulario.
function PostponeForm({
  reminderId,
  days,
  label,
  style,
}: {
  reminderId: string;
  days: number;
  label: string;
  style?: CSSProperties;
}) {
  const [state, formAction, isPending] = useActionState(postponeReminderAction, initialState);
  const dueAtRef = useRef<HTMLInputElement>(null);

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 4, ...style }}>
      <input type="hidden" name="reminderId" value={reminderId} />
      <input type="hidden" name="dueAt" ref={dueAtRef} />
      <Button
        type="submit"
        variant="secondary"
        size="sm"
        full
        disabled={isPending}
        onClick={() => {
          if (dueAtRef.current) dueAtRef.current.value = String(addDaysFromNow(days));
        }}
      >
        {isPending ? "…" : label}
      </Button>
      {state && !state.success && (
        <span role="alert" style={{ fontSize: 12, color: "var(--color-danger-fg)" }}>
          {state.error}
        </span>
      )}
    </form>
  );
}

// MIS-254: "Posponer" un recordatorio desde Pendientes del día, sin abrir
// la ficha — dos opciones rápidas, "Mañana" y "+3 días" (AC del ticket).
// Reutilizado tal cual en pendientes/page.tsx, mismo criterio que
// CompleteReminderButton (un componente, sin duplicar formulario/estado).
//
// Devuelve los dos <form> como hermanos PLANOS (Fragment, sin <div>
// envolvente) a propósito — hallazgo Major de la auditoría de código:
// un contenedor intermedio con su propio flexWrap y flex-shrink:0 en el
// padre (pendientes/page.tsx) es un flex container ANIDADO cuyo tamaño
// "auto" puede calcularse sin contar el wrap interno, arriesgando overflow
// horizontal en 320px. Mismo patrón ya probado en ContactDetailView.tsx:
// varios botones PLANOS, cada uno con su propio flex-basis, todos dentro
// del ÚNICO flexWrap del contenedor padre — sin niveles de flex anidados.
// `style` se aplica a cada uno de los dos <form> individualmente (el
// llamador decide su flex-basis, igual que con CompleteReminderButton).
export function PostponeReminderButtons({
  reminderId,
  style,
}: {
  reminderId: string;
  style?: CSSProperties;
}) {
  return (
    <>
      <PostponeForm reminderId={reminderId} days={1} label="Mañana" style={style} />
      <PostponeForm reminderId={reminderId} days={3} label="+3 días" style={style} />
    </>
  );
}

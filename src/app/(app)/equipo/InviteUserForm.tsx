"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/core/Button";
import { Input } from "@/components/ui/forms/Input";
import { Select } from "@/components/ui/forms/Select";
import { inviteUserAction, type InviteUserState } from "@/lib/team/actions";

const initialState: InviteUserState = undefined;

// MIS-309: alta por invitación. Mismo patrón progresivo que NewContactForm
// (useActionState + <form action>; `disabled` solo por isPending, nunca por
// estado derivado de cliente). En éxito, eleva el resultado al contenedor
// (onResult) ANTES de cerrar el sheet, para que el aviso de `delivered:false`
// (email no enviado) viva en la página y no se pierda al desmontarse el sheet.
export function InviteUserForm({
  onDone,
  onResult,
}: {
  onDone: () => void;
  onResult: (state: { delivered: boolean }) => void;
}) {
  const [state, formAction, isPending] = useActionState(inviteUserAction, initialState);
  // Consumo único: BottomSheet desmonta a sus hijos al cerrar, así que este ref
  // se reinicia en cada apertura; evita procesar el mismo éxito dos veces dentro
  // de un mismo montaje.
  const handledRef = useRef(false);

  useEffect(() => {
    if (state?.success && !handledRef.current) {
      handledRef.current = true;
      onResult({ delivered: state.delivered });
      onDone();
    }
  }, [state, onResult, onDone]);

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Input
        label="Nombre"
        name="name"
        placeholder="Nombre y apellido"
        autoFocus
        autoComplete="name"
        required
        maxLength={120}
        disabled={isPending}
        error={state && !state.success && state.field === "name" ? state.error : null}
      />
      <Input
        label="Email"
        name="email"
        type="email"
        placeholder="correo@ejemplo.com"
        autoComplete="email"
        required
        maxLength={254}
        disabled={isPending}
        error={state && !state.success && state.field === "email" ? state.error : null}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <Select
          label="Rol"
          name="role"
          options={[
            { value: "rep", label: "Comercial" },
            { value: "supervisor", label: "Propietaria" },
          ]}
          defaultValue="rep"
          disabled={isPending}
        />
        {state && !state.success && state.field === "role" && (
          <span style={{ fontSize: 12, color: "var(--color-danger-fg)" }}>{state.error}</span>
        )}
      </div>

      <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>
        Recibirá un email para establecer su contraseña. También podrá entrar con Google con ese
        correo.
      </p>

      {state && !state.success && !state.field && (
        <div role="alert" style={{ fontSize: 13, color: "var(--color-danger-fg)" }}>
          {state.error}
        </div>
      )}

      <Button type="submit" full size="lg" disabled={isPending}>
        {isPending ? "Enviando…" : "Enviar invitación"}
      </Button>
      <Button type="button" variant="ghost" full onClick={onDone} disabled={isPending}>
        Cancelar
      </Button>
    </form>
  );
}

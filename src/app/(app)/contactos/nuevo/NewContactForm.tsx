"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/core/Button";
import { Input } from "@/components/ui/forms/Input";
import { Select } from "@/components/ui/forms/Select";
import { CONTACT_CHANNEL_OPTIONS } from "@/lib/contacts/channel";
import { createContactAction, type CreateContactState } from "@/lib/contacts/actions";

const initialState: CreateContactState = undefined;

// "disabled" del botón depende solo de isPending (envío en curso), no de
// estado de cliente derivado de los campos: con JS sin hidratar, un
// "disabled" basado en useState nace en true para siempre y deja el
// formulario inutilizable, pese a que las Server Actions de Next soportan
// envío progresivo sin JS. `required` nativo + la validación real del
// servidor son la única autoridad.
export function NewContactForm() {
  const [state, formAction, isPending] = useActionState(createContactAction, initialState);

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Input
        label="Nombre completo"
        name="name"
        placeholder="Nombre y apellido"
        autoFocus
        autoComplete="name"
        required
        maxLength={120}
        disabled={isPending}
        error={state?.field === "name" ? state.error : null}
      />
      <Input
        label="Teléfono / WhatsApp"
        name="phone"
        type="tel"
        placeholder="+34 600 000 000"
        autoComplete="tel"
        required
        maxLength={40}
        disabled={isPending}
        error={state?.field === "phone" ? state.error : null}
      />
      <Input
        label={
          <>
            Email <span style={{ color: "var(--text-tertiary)", fontWeight: 400 }}>(opcional)</span>
          </>
        }
        name="email"
        type="email"
        placeholder="correo@ejemplo.com"
        autoComplete="email"
        maxLength={254}
        disabled={isPending}
        error={state?.field === "email" ? state.error : null}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <Select
          label={
            <>
              Canal de captación <span style={{ color: "var(--text-tertiary)", fontWeight: 400 }}>(opcional)</span>
            </>
          }
          name="channel"
          options={[{ value: "", label: "Selecciona un canal (opcional)" }, ...CONTACT_CHANNEL_OPTIONS]}
          defaultValue=""
          disabled={isPending}
        />
        {state?.field === "channel" && (
          <span style={{ fontSize: 12, color: "var(--color-danger-fg)" }}>{state.error}</span>
        )}
      </div>
      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
          Notas iniciales <span style={{ color: "var(--text-tertiary)", fontWeight: 400 }}>(opcional)</span>
        </span>
        <textarea
          name="initialNote"
          placeholder="De dónde viene, qué preguntó, cualquier detalle..."
          disabled={isPending}
          rows={3}
          maxLength={2000}
          style={{
            padding: "10px 12px",
            border: "1px solid var(--color-border-strong)",
            borderRadius: "var(--radius-md)",
            fontFamily: "var(--font-sans)",
            fontSize: 14,
            color: "var(--text-primary)",
            background: "var(--color-surface)",
            resize: "none",
          }}
        />
        {state?.field === "initialNote" && (
          <span style={{ fontSize: 12, color: "var(--color-danger-fg)" }}>{state.error}</span>
        )}
      </label>

      {state?.error && !state.field && (
        <div role="alert" style={{ fontSize: 13, color: "var(--color-danger-fg)" }}>
          {state.error}
        </div>
      )}

      <Button type="submit" full size="lg" disabled={isPending}>
        {isPending ? "Guardando…" : "Guardar"}
      </Button>
    </form>
  );
}

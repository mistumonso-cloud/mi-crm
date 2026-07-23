"use client";

import { useActionState, useEffect } from "react";
import { Button } from "@/components/ui/core/Button";
import { Input } from "@/components/ui/forms/Input";
import { Select } from "@/components/ui/forms/Select";
import { CONTACT_CHANNEL_OPTIONS, type ContactChannel } from "@/lib/contacts/channel";
import { updateContactAction, type UpdateContactState } from "@/lib/contacts/actions";

const initialState: UpdateContactState = undefined;

// MIS-252: edita nombre/teléfono/email/canal de un contacto existente.
// Campo "channel" con opción vacía etiquetada "Sin canal" (no "Selecciona
// un canal (opcional)", el copy de NewContactForm.tsx) — en un formulario
// de EDICIÓN el valor del <select> en el submit siempre es el estado
// final deseado, sin ambigüedad "no tocado" vs "borrado": si el contacto
// ya tenía canal, defaultValue lo preselecciona; si el usuario elige
// "Sin canal", updateContact lo borra explícitamente (ver comentario en
// convex/contacts.ts sobre ctx.db.patch + undefined).
export function EditContactForm({
  contactId,
  initialName,
  initialPhone,
  initialEmail,
  initialChannel,
  onDone,
}: {
  contactId: string;
  initialName: string;
  initialPhone?: string;
  initialEmail?: string;
  initialChannel?: ContactChannel;
  onDone: () => void;
}) {
  const [state, formAction, isPending] = useActionState(updateContactAction, initialState);

  useEffect(() => {
    if (state?.success) onDone();
  }, [state, onDone]);

  const fieldError = (f: "name" | "phone" | "email" | "channel") =>
    state && !state.success && state.field === f ? state.error : null;

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <input type="hidden" name="contactId" value={contactId} />
      <Input
        label="Nombre completo"
        name="name"
        defaultValue={initialName}
        autoFocus
        autoComplete="name"
        required
        maxLength={120}
        disabled={isPending}
        error={fieldError("name")}
      />
      <Input
        label="Teléfono / WhatsApp"
        name="phone"
        type="tel"
        defaultValue={initialPhone ?? ""}
        autoComplete="tel"
        required
        maxLength={40}
        disabled={isPending}
        error={fieldError("phone")}
      />
      <Input
        label={
          <>
            Email <span style={{ color: "var(--text-tertiary)", fontWeight: 400 }}>(opcional)</span>
          </>
        }
        name="email"
        type="email"
        defaultValue={initialEmail ?? ""}
        autoComplete="email"
        maxLength={254}
        disabled={isPending}
        error={fieldError("email")}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <Select
          label={
            <>
              Canal de captación <span style={{ color: "var(--text-tertiary)", fontWeight: 400 }}>(opcional)</span>
            </>
          }
          name="channel"
          options={[{ value: "", label: "Sin canal" }, ...CONTACT_CHANNEL_OPTIONS]}
          defaultValue={initialChannel ?? ""}
          disabled={isPending}
        />
        {fieldError("channel") && (
          <span style={{ fontSize: 12, color: "var(--color-danger-fg)" }}>{fieldError("channel")}</span>
        )}
      </div>

      {state && !state.success && !state.field && (
        <div role="alert" style={{ fontSize: 13, color: "var(--color-danger-fg)" }}>
          {state.error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <Button type="button" variant="secondary" full onClick={onDone} disabled={isPending}>
          Cancelar
        </Button>
        <Button type="submit" full disabled={isPending}>
          {isPending ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    </form>
  );
}

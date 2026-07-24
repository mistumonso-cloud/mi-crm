"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../../../convex/_generated/api";
import { Button } from "@/components/ui/core/Button";
import { Card } from "@/components/ui/core/Card";
import { Input } from "@/components/ui/forms/Input";
import { Select } from "@/components/ui/forms/Select";
import { CONTACT_CHANNEL_OPTIONS } from "@/lib/contacts/channel";
import { phoneKey } from "@/lib/contacts/phone";
import { createContactAction, type CreateContactState } from "@/lib/contacts/actions";

const initialState: CreateContactState = undefined;

// Mismo patrón que el `Contact` local de ContactList.tsx y de
// ContactDetailView.tsx (ninguno de los dos exporta el suyo — cada
// consumidor de una query redeclara su propio alias junto al punto de
// uso). Se redeclara aquí a propósito, no se importa de ningún sitio.
type Contact = FunctionReturnType<typeof api.contacts.listContacts>[number];

// "disabled" del botón depende solo de isPending (envío en curso), no de
// estado de cliente derivado de los campos: con JS sin hidratar, un
// "disabled" basado en useState nace en true para siempre y deja el
// formulario inutilizable, pese a que las Server Actions de Next soportan
// envío progresivo sin JS. `required` nativo + la validación real del
// servidor son la única autoridad. El aviso de duplicado de MIS-255 (más
// abajo) respeta esto: es puramente informativo, nunca gatea "Guardar".
export function NewContactForm({ existingContacts }: { existingContacts: Contact[] }) {
  const [state, formAction, isPending] = useActionState(createContactAction, initialState);

  // MIS-255: espejo de e.target.value SOLO para alimentar el aviso de
  // duplicado — no la fuente de verdad del campo. El <input> de teléfono
  // sigue sin `value=` (no controlado por React), mismo espíritu de
  // progressive enhancement que el resto de este formulario (ver
  // comentario de arriba): sin JS hidratado no hay onChange que alimente
  // este estado, y el campo funciona exactamente igual que hoy — esto es
  // una mejora puramente aditiva, nunca una condición para poder escribir
  // o enviar el formulario.
  const [phone, setPhone] = useState("");

  // Aviso no bloqueante de posible contacto duplicado por teléfono,
  // recalculado en cada tecla. Comparación por clave normalizada
  // (phoneKey — ver src/lib/contacts/phone.ts), no por el string crudo,
  // para tolerar espacios/guiones/prefijo tal como pide el AC.
  const duplicate = useMemo(() => {
    const key = phoneKey(phone);
    if (!key) return null; // menos de 9 dígitos todavía — ver phoneKey
    return existingContacts.find((c) => c.phone && phoneKey(c.phone) === key) ?? null;
  }, [phone, existingContacts]);

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
        onChange={(e) => setPhone(e.target.value)}
      />
      {duplicate && (
        // Mismo patrón visual que la card de "Próximo seguimiento" de
        // ContactDetailView.tsx (background var(--color-warning-bg), texto
        // var(--color-warning-fg)) — único precedente en el repo de
        // "informativo, no bloqueante". No gatea "Guardar": isPending
        // sigue siendo la única condición del botón, tal como pide el AC
        // ("el aviso no bloquea, solo advierte").
        <Card
          padding="md"
          style={{ background: "var(--color-warning-bg)", display: "flex", flexDirection: "column", gap: 6 }}
        >
          <p style={{ fontSize: 13, color: "var(--color-warning-fg)" }}>
            Ya existe un contacto con este teléfono: <strong>{duplicate.name}</strong>
          </p>
          <Link
            href={`/contactos/${duplicate._id}`}
            style={{ fontSize: 13, fontWeight: 600, color: "var(--color-accent)", textDecoration: "none" }}
          >
            Ver ficha existente →
          </Link>
        </Card>
      )}
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

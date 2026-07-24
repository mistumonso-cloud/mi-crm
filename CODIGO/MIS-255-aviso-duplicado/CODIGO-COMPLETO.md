# MIS-255 — Código completo (Aviso de contacto duplicado al crear)

Todos los archivos de esta tarea, concatenados en un único documento para copiar a auditoría. Cada sección indica la ruta real de destino y si es NUEVO o EDITAR. Ver `PLANS/MIS-255-aviso-duplicado.md` para el porqué de cada decisión.

Ya verificado antes de generar este documento: `npx tsc --noEmit`, `npm run lint`, `npm run build` limpios; suite Playwright completa 15/15 en verde; 2 comprobaciones manuales de los comportamientos nuevos (aviso con formato distinto + enlace a ficha existente + crear igualmente; sin coincidencia no hay aviso, y el aviso desaparece al borrar).

---

## `src/lib/contacts/phone.ts` (NUEVO)

```ts
// Normalización de teléfono para detectar posibles duplicados al crear un
// contacto (MIS-255, AC: "comparar por teléfono normalizado — ignorar
// espacios, guiones, prefijo"). Vive en su propio archivo, no en
// src/lib/contacts/format.ts: format.ts son formatters de SALIDA (fecha,
// hora, importe -> texto para mostrar); esto es una clave de comparación
// para lógica de negocio (¿es "el mismo" teléfono que otro ya guardado?),
// categoría distinta — mismo criterio de un concepto por archivo pequeño
// que ya usa este directorio (channel.ts para el enum de canal, status.ts
// para los enums de estado).
//
// No reutiliza el `digitsOnly` privado de ContactList.tsx (MIS-9): aquel
// existe para búsqueda por SUBSTRING mientras se escribe en el buscador de
// la lista (cualquier fragmento de dígitos que aparezca dentro del
// teléfono cuenta como acierto). Esto necesita una CLAVE DE IGUALDAD
// EXACTA para duplicados — semántica distinta, aunque ambas empiecen
// quitando lo que no sea dígito. Se duplica esa línea a propósito, mismo
// criterio ya aceptado en el repo para pequeñas normalizaciones sin fuente
// compartida entre módulos (p.ej. contactChannelValidator duplicado entre
// convex/schema.ts y convex/contacts.ts).

// Longitud de un número de teléfono español completo — igual para móvil y
// fijo (España no distingue longitud por tipo de línea, a diferencia de
// otros países). Mismo supuesto de un solo país ya aceptado en este
// directorio (ver timeZone "Europe/Madrid" fija en format.ts).
const SPAIN_PHONE_DIGITS = 9;

// Deja solo los dígitos y, si hay más de 9, se queda con los últimos 9 —
// el número nacional real, sea cual sea lo que venga delante (+34, 0034,
// un 0 de marcación de más...). Así "+34600000000", "34 600 000 000",
// "0034-600-000-000" y "600000000" normalizan los 4 al mismo valor, sin
// necesitar un parser de prefijos internacionales real (tipo
// libphonenumber) — el AC solo pide tolerar espacios/guiones/prefijo, no
// validación de formato completa.
//
// Por debajo de 9 dígitos se devuelve "" (no los dígitos parciales tal
// cual): un número de España real nunca tiene una coincidencia válida por
// debajo de esa longitud, y devolver el prefijo parcial arriesgaba (a)
// avisos prematuros mientras Carlos todavía está escribiendo, y (b) un
// falso aviso si algún contacto antiguo tuviera un teléfono igual de
// corto/mal formado (phone es v.optional(v.string()) en el schema, sin
// regex de formato server-side — ver PHONE_MAX en convex/contacts.ts). El
// llamador (NewContactForm.tsx) trata "" como "todavía sin clave, no
// comprobar".
//
// Colisión entre dos personas reales distintas: para un número de España
// completo, esta clave ES el número entero — dos contactos con la misma
// clave son, por definición, el mismo teléfono, no una coincidencia de
// "últimos 9 dígitos" entre números distintos.
export function phoneKey(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < SPAIN_PHONE_DIGITS) return "";
  return digits.slice(-SPAIN_PHONE_DIGITS);
}
```

---

## `src/app/(app)/contactos/nuevo/page.tsx` (EDITAR)

```tsx
import Link from "next/link";
import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../../convex/_generated/api";
import { getUser } from "@/lib/auth/dal";
import { readSessionToken } from "@/lib/auth/cookie";
import { NewContactForm } from "./NewContactForm";

// Placeholder de MIS-18 sustituido por el formulario real (MIS-8). Solo
// "rep" (Carlos) puede crear contactos — ver requireRole en
// convex/contacts.ts::createContact. Se comprueba el rol aquí para mostrar
// un mensaje claro a Marta en vez de dejarle rellenar un formulario
// condenado a fallar en el servidor. Desde MIS-20, el FAB de
// (with-nav)/layout.tsx ya no trae hasta aquí para Marta (se oculta si
// user.role !== "rep") — este guard pasa a ser defensa en profundidad para
// quien llegue por navegación directa a la URL (bookmark, escritura
// manual), no la única barrera como antes.
export default async function NuevoContactoPage() {
  const user = await getUser();
  const token = await readSessionToken(); // getUser() ya garantiza sesión válida aquí — mismo patrón que contactos/[id]/page.tsx

  // MIS-255: lista completa de contactos existentes, para el aviso de
  // posible duplicado por teléfono dentro del propio formulario
  // (NewContactForm, useMemo sobre `existingContacts`). Reutiliza
  // literalmente la MISMA query que ya usa /contactos (ContactList.tsx) —
  // sin query nueva, sin índice nuevo: listContacts ya devuelve {_id,
  // name, phone, status, _creationTime} de cada contacto sin paginar (ver
  // comentario en convex/contacts.ts). Se pide también cuando
  // user.role !== "rep" (Marta, caso de navegación directa a la URL):
  // mismo criterio de "fetch primero, rama después" ya usado en
  // contactos/[id]/page.tsx, en vez de complicar este archivo con un
  // fetch condicional. No hay fuga hacia Marta por esto: <NewContactForm>
  // no se instancia en su rama, así que existingContacts nunca se
  // serializa en el payload de RSC que llega a su navegador.
  const existingContacts = await fetchQuery(api.contacts.listContacts, { token: token! });

  return (
    <div className="flex flex-1 flex-col" style={{ padding: "16px 20px" }}>
      <Link
        href="/contactos"
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: "var(--color-accent)",
          textDecoration: "none",
          alignSelf: "flex-start",
          marginBottom: 16,
        }}
      >
        ‹ Cancelar
      </Link>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)", marginBottom: 20 }}>
        Nuevo contacto
      </h1>
      {user.role === "rep" ? (
        <NewContactForm existingContacts={existingContacts} />
      ) : (
        <p style={{ fontSize: 14, color: "var(--text-secondary)" }}>
          Solo el rol operativo puede añadir contactos. Tu cuenta tiene acceso de lectura.
        </p>
      )}
    </div>
  );
}
```

---

## `src/app/(app)/contactos/nuevo/NewContactForm.tsx` (EDITAR)

```tsx
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
```

---

## Archivos afectados

| Archivo | Tipo |
|---|---|
| `src/lib/contacts/phone.ts` | Nuevo |
| `src/app/(app)/contactos/nuevo/page.tsx` | Editar |
| `src/app/(app)/contactos/nuevo/NewContactForm.tsx` | Editar |

No se toca ningún otro archivo (`convex/contacts.ts`, `convex/schema.ts`, `src/lib/contacts/actions.ts`, `ContactList.tsx`, ningún test e2e) — ver "Fuera de alcance" en `PLANS/MIS-255-aviso-duplicado.md`.

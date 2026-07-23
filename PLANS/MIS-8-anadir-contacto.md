# MIS-8 — Pantalla: Añadir contacto (formulario rápido)

> **Estado**: v2 instalado en producción. **Reabierto en Linear el 2026-07-23** — plan v3 (sección "Reapertura" más abajo) con GO condicionado de auditoría (2026-07-23) y código v3 con GO condicionado de auditoría de código (2026-07-23), instalado en la rama `feature/mis-8-anadir-contacto` (build/lint/tsc/e2e en verde, ver `CODIGO/MIS-8-anadir-contacto/NOTES.md`). Pendiente: PR a `main` y, tras fusionar, `npx convex deploy` a producción.

## Reapertura (jul 2026) — v3: añadir Email y Canal de captación

El alcance del MVP se amplía: Linear reabrió el ticket para pedir un campo opcional **Email** y un selector opcional **Canal de captación** (Instagram · web · llamada · WhatsApp · referido) en el formulario de alta, sin romper el alta en <30s, persistiendo ambos en el contacto.

### Discrepancia ticket vs. estado real del código (verificado leyendo el repo)

El ticket dice "el modelo ya contempla email y canal". Comprobado en `convex/schema.ts` y `convex/contacts.ts` (estado actual, tras v2 + MIS-9/10/14/15/17):

| Campo | Estado real |
|---|---|
| `email` | Ya existe en `contacts` (`v.optional(v.string())`) desde v2, y `getContact` ya lo devuelve. **Pero ninguna mutation lo escribe nunca** — `createContact` no lo acepta como argumento, así que hoy siempre es `undefined`. `ContactDetailView.tsx` ya lo renderiza condicionalmente (icono + `mailto:`) desde MIS-10, sin cambios necesarios ahí. |
| `channel` (canal de captación) | **No existe** en el schema, en ningún validator, ni en ninguna pantalla. Hay que crearlo desde cero. |

Para email "falta un punto de captura" (tal como dice el propio ticket); para canal falta también el modelo. Se resuelve todo en este plan v3.

### 1. `convex/schema.ts` — nuevo campo `channel`

```ts
channel: v.optional(
  v.union(
    v.literal("instagram"),
    v.literal("web"),
    v.literal("llamada"),
    v.literal("whatsapp"),
    v.literal("referido"),
  ),
),
```
Añadido a la tabla `contacts`, junto a `email`. `email` no cambia (ya es correcto).

### 2. `src/lib/contacts/channel.ts` (archivo nuevo)

Mismo patrón que `src/lib/notes/types.ts` (`NOTE_TYPES` / `NOTE_TYPE_OPTIONS`): claves estables en inglés/código, etiqueta en español, sin acoplarse al schema de Convex (duplicado deliberado, mismo criterio ya aceptado en el repo).

```ts
export const CONTACT_CHANNELS = {
  instagram: { label: "Instagram" },
  web: { label: "Web" },
  llamada: { label: "Llamada" },
  whatsapp: { label: "WhatsApp" },
  referido: { label: "Referido" },
} as const;

export type ContactChannel = keyof typeof CONTACT_CHANNELS;

export const CONTACT_CHANNEL_OPTIONS: Array<{ value: ContactChannel; label: string }> = (
  Object.keys(CONTACT_CHANNELS) as ContactChannel[]
).map((value) => ({ value, label: CONTACT_CHANNELS[value].label }));
```

Se usa para las `options` del `<Select>` del formulario, para validar en la Server Action (`Object.prototype.hasOwnProperty.call`, mismo patrón ya usado y auditado en `addNoteAction`/`NOTE_TYPES` — no `in`, por la lección ya documentada sobre la cadena de prototipos), y más adelante para mostrar la etiqueta en la ficha.

### 3. `convex/contacts.ts`

**`createContact`**: añade `email` y `channel` a los args y al insert.

- `contactChannelValidator` (nuevo, duplicado del schema a propósito — mismo criterio que `contactStatusValidator`): `v.union(v.literal("instagram"), v.literal("web"), v.literal("llamada"), v.literal("whatsapp"), v.literal("referido"))`. Se usa directamente como tipo del argumento `channel` (igual que `status: contactStatusValidator` en `changeContactStatus`) — Convex rechaza cualquier valor fuera de los 5 literales en la capa de validación de argumentos, sin necesitar un workaround tipo `v.string()` + normalización (ese workaround era específico de IDs de formato libre en la URL, no aplica aquí: el canal siempre llega de un `<select>` cerrado).
- `email`: `v.optional(v.string())`. Validación: `trim()` + tope `EMAIL_MAX = 254` (límite convencional de longitud total de una dirección de email). Sin regex de formato server-side — mismo nivel de validación que el resto de campos opcionales de texto (`initialNote`); el formato lo cubre gratis `type="email"` en el cliente (ver más abajo).
- Inserta condicionalmente igual que `initialNote` hoy: `...(emailTrimmed ? { email: emailTrimmed } : {})`, `...(args.channel ? { channel: args.channel } : {})`.
- `returns.field` (unión de error): añade `v.literal("email")`.

**`getContact`**: añade `channel: v.optional(contactChannelValidator)` al `returns` y al objeto devuelto (`channel: contact.channel`). `email` ya estaba.

### 4. `src/lib/contacts/actions.ts` — `createContactAction`

- Lee `email` (trim) y `channel` de `formData`.
- `channel`: si viene no-vacío, valida con `Object.prototype.hasOwnProperty.call(CONTACT_CHANNELS, channelRaw)`; si no es válido, `{ error: "Canal inválido", field: "channel" }` (mismo patrón que la validación de `type` en `addNoteAction`). Cadena vacía → `undefined` (nada seleccionado, campo opcional).
- `email`: cadena vacía tras `trim()` → `undefined`, igual que `initialNote`.
- `CreateContactState.field` amplía la unión a `"name" | "phone" | "initialNote" | "email" | "channel"`.
- Pasa `email` y `channel` a `fetchMutation(api.contacts.createContact, {...})`.

### 5. `NewContactForm.tsx`

Añade, entre Teléfono y Notas (mismo orden que describe el ticket):

- `Input` Email: `type="email"`, `name="email"`, opcional (sin `required`), `maxLength={254}`, `autoComplete="email"`, label `Email (opcional)` (mismo estilo de-enfatizado que ya usa el label de Notas), `error` ligado a `state?.field === "email"`. `type="email"` da validación de formato nativa del navegador gratis, sin añadir regex al cliente ni al servidor.
- `Select` Canal de captación (`@/components/ui/forms/Select`, ya usado igual en `AddNoteForm.tsx` dentro de un `<form action={formAction}>` sin estado de React — uncontrolled, `name="channel"`): `options={CONTACT_CHANNEL_OPTIONS}` con una opción placeholder adicional al principio (`{ value: "", label: "Selecciona un canal (opcional)" }`), `defaultValue=""`, label `Canal de captación (opcional)`.

No se toca `autoFocus` (sigue en Nombre) ni la validación `required` de Nombre/Teléfono — los campos nuevos son puramente aditivos y opcionales, así que el flujo de <30s no cambia.

### 6. `ContactDetailView.tsx` — mostrar el canal (evita campo "huérfano")

El propio repo tiene precedente explícito de NO añadir un campo al contrato de `getContact` si no tiene consumidor (ver comentario sobre `company` en `contacts.ts`, decisión de la auditoría de MIS-10). Para no repetir el problema en sentido inverso (capturar `channel` y no mostrarlo nunca), se añade la línea mínima:

```tsx
<span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
  Responsable: {contact.responsibleName}
  {contact.channel && ` · Canal: ${CONTACT_CHANNELS[contact.channel].label}`}
</span>
```

(mismo `<span>` que ya muestra "Responsable", solo se le añade el canal cuando existe — sin icono nuevo, sin nueva Card). `email` no necesita cambios aquí: ya se renderiza condicionalmente desde MIS-10.

### Fuera de alcance (explícito)

- **MIS-255** (aviso de duplicado al crear) y **MIS-252** (editar datos del contacto) — tickets relacionados pero no planificados, no se tocan.
- `listContacts` / `ContactList.tsx` (MIS-9, ya auditado e instalado) — no se añade email/canal a la lista ni a la búsqueda; el ticket no lo pide.
- Sin nuevo test e2e automatizado dedicado: los tests existentes (`full-flow.spec.ts`, etc.) solo rellenan Nombre/Teléfono vía `getByLabel` y no aseguran número total de campos, así que campos nuevos opcionales no deberían romperlos. Se verifica manualmente + se corre la suite existente para confirmar que no hay regresión.

### Verificación end-to-end (v3)

1. Alta solo con Nombre+Teléfono → sigue guardando en <30s, sin fricción por los campos nuevos.
2. Alta con Email inválido (sin `@`) → el navegador bloquea el submit (validación nativa `type="email"`).
3. Alta con Email y Canal rellenos → `npx convex data contacts` confirma ambos campos guardados.
4. Ficha del contacto recién creado → email visible como enlace `mailto:` (ya existente), canal visible en la línea "Responsable: ... · Canal: ...".
5. Alta sin Email ni Canal → ficha no muestra ni el enlace de email ni "· Canal: ...".
6. POST manipulado con `channel` fuera del enum → Server Action lo rechaza (`"Canal inválido"`) antes de llegar a Convex.
7. `npx playwright test` (suite completa) sigue en verde.
8. `npm run build` y `npm run lint` limpios.

### Archivos afectados (v3, al codificar, tras GO)

```
convex/schema.ts                          EDITAR — + channel
convex/contacts.ts                        EDITAR — createContact (+ email, channel), getContact (+ channel)

src/lib/contacts/channel.ts               NUEVO — CONTACT_CHANNELS, CONTACT_CHANNEL_OPTIONS
src/lib/contacts/actions.ts               EDITAR — createContactAction (+ email, channel)

src/app/(app)/contactos/nuevo/NewContactForm.tsx     EDITAR — + Input Email, + Select Canal
src/app/(app)/contactos/[id]/ContactDetailView.tsx   EDITAR — muestra canal en línea "Responsable"
```

No se toca: `convex/lib/authz.ts`, `src/proxy.ts`, guard de rol de `nuevo/page.tsx` (sigue igual, `rep` únicamente), `ContactList.tsx`/`listContacts` (MIS-9), nada de MIS-252/MIS-255.

---

## Contexto (v2, instalado — histórico)

Siguiente tarea tras **MIS-7** (auth, instalado) y **MIS-18** (navegación, instalado) — ver `PLANS/MIS-7-autenticacion-roles.md` y `PLANS/MIS-18-navegacion-principal.md`. MIS-18 ya dejó el terreno preparado: `AddContactFab` enlaza a `/contactos/nuevo` (placeholder de MIS-18, fuera de `(with-nav)`, sin barra/FAB — este plan lo reemplaza); `proxy.ts` ya cubre `/contactos/:path*`.

Este es el **primer consumidor real de `requireUser`/`requireRole`** (`convex/lib/authz.ts`) y la **primera mutation que escribe datos de negocio** del proyecto.

### Discrepancia ticket vs. mockup (resuelta con el usuario en v1)

El AC de MIS-8 pide "exactamente 2 campos obligatorios y 1 opcional" (Nombre, Teléfono, Notas); el mockup `NewContact.dc.html` pinta 5. El usuario confirmó: **Linear es la fuente de verdad** → solo 3 campos, sin Email ni Dirección. Sin cambios en v2.

## Respuesta a la auditoría (v1 → v2)

v1 recibió **NO-GO** por 4 hallazgos mayores. Resolución:

| # | Hallazgo | Severidad | Resuelto en v2 |
|---|---|---|---|
| 1 | `createContact` usaba `requireUser` (cualquier rol) sin justificar que Marta pueda escribir — el ADR de MIS-18 solo abrió *lectura* de páginas, y el criterio heredado de MIS-7 para Marta es "acceso de lectura", no creación | Mayor | `createContact` pasa a `requireRole(ctx, token, "rep")` — solo Carlos crea contactos. `getContact` se queda en `requireUser` (lectura, ambos roles, consistente con MIS-7/MIS-18). La page `contactos/nuevo` muestra un mensaje en vez del formulario si el usuario conectado no es `rep`, en vez de dejar que Marta rellene un formulario condenado a fallar en el submit |
| 2 | Validación server-side insuficiente: solo `trim()` + no-vacío, sin límites de longitud | Mayor | Límites explícitos en la mutation: nombre 1–120, teléfono 1–40, nota 0–2000 caracteres. `maxLength` en el cliente es solo UX, la mutation es la autoridad |
| 3 | `/contactos/[id]` podía crashear (error 500 sin controlar) con un ID de formato inválido en la URL, porque el cast `as Id<"contacts">` no valida nada en runtime y el validator `v.id("contacts")` de los args rechaza *antes* de que el handler pueda capturarlo | Mayor | `getContact` cambia `args.id` de `v.id("contacts")` a `v.string()` y usa `ctx.db.normalizeId("contacts", args.id)` dentro del handler — API de Convex confirmada (`node_modules/convex/dist/*/server/database.d.ts:53`) que devuelve `null` para IDs con formato inválido o de otra tabla, en vez de lanzar. Un ID malformado ahora cae en la misma rama "no encontrado" que un ID válido pero borrado |
| 4 | Sin trazabilidad de autor: no se guardaba quién creó el contacto ni quién escribió la nota inicial — dato irreversible una vez hay filas reales | Mayor | `contacts.createdBy: v.id("users")` (obligatorio, capturado del usuario que devuelve `requireRole`) |

Menores también resueltos en v2: el botón "Guardar" ya no depende de estado de cliente para habilitarse (afectaba a formularios sin hidratar/sin JS) — se apoya en `required` nativo + validación server; se documenta explícitamente que duplicados por teléfono son aceptados en el MVP (no hay unicidad); `createContactAction` captura el fallo de sesión revocada/expirada y redirige a `/login` en vez de dejar propagar un error no controlado.

## Modelo de datos (`convex/schema.ts`)

```ts
contacts: defineTable({
  name: v.string(),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),          // opcional en la tabla, obligatorio en la mutation — ver nota
  company: v.optional(v.string()),
  initialNote: v.optional(v.string()),    // NUEVO — nota libre del alta rápida (MIS-8)
  createdBy: v.id("users"),               // NUEVO (hallazgo #4) — quién dio de alta el contacto
  status: v.union(
    v.literal("lead"), v.literal("talking"), v.literal("proposal"),
    v.literal("negotiating"), v.literal("won"), v.literal("lost"), v.literal("inactive"),
  ),
}).index("by_status", ["status"]),
```

- **`phone` opcional en la tabla, obligatorio en el argumento de la mutation**: la tabla describe qué es representable, no las reglas de una pantalla; `createContact` es el único punto de escritura y ahí sí es obligatorio de verdad.
- **`createdBy` obligatorio** (`v.id("users")`, sin `v.optional`): dado que `createContact` es *ahora mismo* la única vía de alta y siempre corre autenticada (`requireRole`), no hay ningún caso legítimo de contacto sin creador — hacerlo opcional solo escondería un bug futuro en vez de prevenirlo. Cambio seguro porque la tabla no tiene filas todavía.
- **`initialNote` vive directo en `contacts`**, no se adelanta la tabla `notes` de MIS-11 (autor/fecha/tipo/histórico — diseño propio de esa tarea). Con `createdBy` ya en el propio contacto, la migración futura de `initialNote` a la tabla `notes` de MIS-11 no pierde información de autoría: se puede migrar como `{ contactId, text: initialNote, authorId: contact.createdBy, createdAt: contact._creationTime }`.

## `convex/contacts.ts` (archivo nuevo)

`createContact` usa **`requireRole(ctx, token, "rep")`** (hallazgo #1 — solo Carlos puede crear); `getContact` usa `requireUser` (lectura, ambos roles). Ambas devuelven resultado discriminado en vez de lanzar `ConvexError` para validación normal, por la misma razón que `convex/auth.ts::login`: `redirect()` debe llamarse fuera de cualquier `try/catch` en la Server Action, y un resultado tipado evita el problema por diseño.

```ts
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUser, requireRole } from "./lib/authz";

const contactStatusValidator = v.union(
  v.literal("lead"), v.literal("talking"), v.literal("proposal"),
  v.literal("negotiating"), v.literal("won"), v.literal("lost"), v.literal("inactive"),
);

const NAME_MAX = 120;
const PHONE_MAX = 40;
const NOTE_MAX = 2000;

export const createContact = mutation({
  args: {
    token: v.string(),
    name: v.string(),
    phone: v.string(),
    initialNote: v.optional(v.string()),
  },
  returns: v.union(
    v.object({ success: v.literal(true), id: v.id("contacts") }),
    v.object({
      success: v.literal(false),
      error: v.string(),
      field: v.optional(v.union(v.literal("name"), v.literal("phone"), v.literal("initialNote"))),
    }),
  ),
  handler: async (ctx, args) => {
    // Hallazgo #1: solo "rep" (Carlos) puede crear contactos — Marta tiene
    // acceso de lectura, no de escritura, según el criterio original de MIS-7.
    // No confundir con el ADR de MIS-18: ese abrió acceso de LECTURA a
    // páginas (Pendientes/Panel), nunca tocó operaciones de escritura.
    const user = await requireRole(ctx, args.token, "rep");

    const name = args.name.trim();
    if (!name) return { success: false as const, error: "El nombre es obligatorio", field: "name" as const };
    if (name.length > NAME_MAX) {
      return { success: false as const, error: `El nombre no puede superar ${NAME_MAX} caracteres`, field: "name" as const };
    }

    const phone = args.phone.trim();
    if (!phone) return { success: false as const, error: "El teléfono es obligatorio", field: "phone" as const };
    if (phone.length > PHONE_MAX) {
      return { success: false as const, error: `El teléfono no puede superar ${PHONE_MAX} caracteres`, field: "phone" as const };
    }

    const initialNoteTrimmed = args.initialNote?.trim();
    if (initialNoteTrimmed && initialNoteTrimmed.length > NOTE_MAX) {
      return { success: false as const, error: `La nota no puede superar ${NOTE_MAX} caracteres`, field: "initialNote" as const };
    }

    const id = await ctx.db.insert("contacts", {
      name,
      phone,
      status: "lead", // estado inicial fijo por AC
      createdBy: user.id,
      ...(initialNoteTrimmed ? { initialNote: initialNoteTrimmed } : {}),
    });
    return { success: true as const, id };
  },
});

// Hallazgo #3: args.id es v.string() (no v.id("contacts")) para que un ID con
// formato inválido no sea rechazado por el validator ANTES de llegar aquí —
// eso lanzaría un error no controlado hasta la Server Component. En su lugar,
// ctx.db.normalizeId("contacts", ...) lo resuelve a null de forma segura y
// se trata igual que "fila inexistente".
export const getContact = query({
  args: { token: v.string(), id: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("contacts"),
      name: v.string(),
      phone: v.optional(v.string()),
      status: contactStatusValidator,
      initialNote: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    await requireUser(ctx, args.token); // lectura: ambos roles, ver hallazgo #1
    const contactId = ctx.db.normalizeId("contacts", args.id);
    if (!contactId) return null; // formato inválido o ID de otra tabla
    const contact = await ctx.db.get(contactId);
    if (!contact) return null; // formato válido, fila borrada/inexistente
    return {
      _id: contact._id,
      name: contact.name,
      phone: contact.phone,
      status: contact.status,
      initialNote: contact.initialNote,
    };
  },
});
```

## Server Action + formulario

**`src/lib/contacts/actions.ts`** (nuevo, `"use server"`) — captura fallo de autenticación (sesión revocada entre cargar la página y enviar el formulario, hallazgo menor) sin romper el patrón "`redirect()` fuera de `try/catch`": el `try/catch` envuelve solo la llamada a `fetchMutation`, y `redirect("/login")` se invoca dentro del bloque `catch` (no dentro del `try`), así que su excepción especial de Next se propaga sin que nada la intercepte de más.

```ts
"use server";

import { ConvexError } from "convex/values";
import { redirect } from "next/navigation";
import { fetchMutation } from "convex/nextjs";
import { api } from "../../../convex/_generated/api";
import { readSessionToken } from "@/lib/auth/cookie";

export type CreateContactState = { error: string; field?: "name" | "phone" | "initialNote" } | undefined;

export async function createContactAction(
  _prevState: CreateContactState,
  formData: FormData,
): Promise<CreateContactState> {
  const token = await readSessionToken();
  if (!token) redirect("/login"); // defensa en profundidad; getUser() ya debería haber redirigido antes de renderizar el form

  const name = String(formData.get("name") ?? "");
  const phone = String(formData.get("phone") ?? "");
  const initialNoteRaw = String(formData.get("initialNote") ?? "").trim();

  let result;
  try {
    result = await fetchMutation(api.contacts.createContact, {
      token,
      name,
      phone,
      initialNote: initialNoteRaw || undefined,
    });
  } catch (err) {
    // requireRole lanza ConvexError si la sesión se revocó/expiró entre
    // cargar la página y enviar el formulario, o si un usuario no-"rep"
    // fuerza la request saltándose el guard de la page (ver más abajo).
    if (err instanceof ConvexError) {
      redirect("/login");
    }
    throw err; // cualquier otro error, no lo enmascaramos
  }

  if (!result.success) {
    return { error: result.error, field: result.field };
  }

  redirect(`/contactos/${result.id}`); // fuera de try/catch
}
```

**`src/app/(app)/contactos/nuevo/NewContactForm.tsx`** (nuevo, cliente):

```tsx
"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/core/Button";
import { Input } from "@/components/ui/forms/Input";
import { createContactAction, type CreateContactState } from "@/lib/contacts/actions";

const initialState: CreateContactState = undefined;

export function NewContactForm() {
  const [state, formAction, isPending] = useActionState(createContactAction, initialState);

  // Hallazgo menor: ya NO se deriva "disabled" de estado de cliente (name/
  // phone en useState) — con JS sin hidratar, el botón nacía deshabilitado
  // para siempre y el formulario quedaba inutilizable pese a que las Server
  // Actions soportan envío progresivo sin JS. En su lugar, `required` nativo
  // (bloquea el submit incluso sin JS, con validación del propio navegador)
  // + la validación real del servidor son la única autoridad. "isPending"
  // sigue deshabilitando el botón mientras se envía, para evitar doble click.
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

Nota sobre duplicados (hallazgo menor): no hay restricción de unicidad por teléfono — dos contactos con el mismo número son válidos en el MVP (ej. reintentos legítimos de contacto, o números compartidos). `isPending` deshabilita "Guardar" mientras la request está en curso, cubriendo el caso común de doble-click; no se añade una regla de deduplicación porque el AC no la pide y MIS-9 (búsqueda) es quien tendría que decidir cómo mostrar duplicados si algún día se restringen.

**`src/app/(app)/contactos/nuevo/page.tsx`** — hallazgo #1: comprueba el rol antes de mostrar el formulario, en vez de dejar que Marta rellene algo condenado a fallar en el servidor:

```tsx
import Link from "next/link";
import { getUser } from "@/lib/auth/dal";
import { NewContactForm } from "./NewContactForm";

export default async function NuevoContactoPage() {
  const user = await getUser();

  return (
    <div className="flex flex-1 flex-col" style={{ padding: "16px 20px" }}>
      <Link href="/contactos" style={{ fontSize: 14, fontWeight: 600, color: "var(--color-accent)", textDecoration: "none", alignSelf: "flex-start", marginBottom: 16 }}>
        ‹ Cancelar
      </Link>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)", marginBottom: 20 }}>
        Nuevo contacto
      </h1>
      {user.role === "rep" ? (
        <NewContactForm />
      ) : (
        <p style={{ fontSize: 14, color: "var(--text-secondary)" }}>
          Solo el rol operativo puede añadir contactos. Tu cuenta tiene acceso de lectura.
        </p>
      )}
    </div>
  );
}
```

El FAB (`AddContactFab`, instalado en MIS-18) sigue visible para ambos roles sin cambios — tocarlo para Marta lleva a este mensaje claro en vez de a un 500 o un formulario que siempre falla al guardar. No se reabre el alcance de MIS-18 (visibilidad de la barra/FAB por rol), que ya pasó su propia auditoría.

## Ruta de destino: `src/app/(app)/contactos/[id]/page.tsx` (nuevo, fuera de `(with-nav)`)

Hallazgo #3: ya no hay cast `as Id<"contacts">` — el `id` de la URL se pasa como `string` plano a `getContact`, que internamente usa `normalizeId` para resolverlo de forma segura.

```tsx
import Link from "next/link";
import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../../convex/_generated/api";
import { getUser } from "@/lib/auth/dal";
import { readSessionToken } from "@/lib/auth/cookie";
import { StatusBadge } from "@/components/ui/feedback/StatusBadge";

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await getUser();
  const { id } = await params;
  const token = await readSessionToken(); // getUser() ya garantiza sesión válida aquí

  const contact = await fetchQuery(api.contacts.getContact, { token: token!, id });

  if (!contact) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-16 text-center">
        <p style={{ color: "var(--text-secondary)" }}>Contacto no encontrado.</p>
        <Link href="/contactos" style={{ color: "var(--color-accent)", fontWeight: 600 }}>‹ Volver a Contactos</Link>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col" style={{ padding: "16px 20px", gap: 16 }}>
      <Link href="/contactos" style={{ fontSize: 14, fontWeight: 600, color: "var(--color-accent)", textDecoration: "none", alignSelf: "flex-start" }}>
        ‹ Contactos
      </Link>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)" }}>{contact.name}</h1>
        <StatusBadge state={contact.status} />
      </div>
      {contact.phone && <p style={{ color: "var(--text-secondary)" }}>{contact.phone}</p>}
      {contact.initialNote && (
        <div style={{ padding: 14, borderRadius: "var(--radius-lg)", border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
          {contact.initialNote}
        </div>
      )}
      <p style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
        Aquí se construirá la ficha completa del contacto (MIS-10).
      </p>
    </div>
  );
}
```

`getContact` sigue siendo `requireUser` (no `requireRole("rep")`): ver la ficha es lectura, y tanto Carlos como Marta tienen acceso de lectura completo desde MIS-7/MIS-18 — solo la creación (escritura) queda restringida a `rep`.

## Flujo

1. Carlos (rol `rep`) toca el FAB desde cualquier pantalla → `/contactos/nuevo`. Si es Marta (`supervisor`), ve el mensaje de solo-lectura en vez del formulario.
2. `getUser()` protege la page.
3. `NewContactForm`: Nombre (foco automático) + Teléfono obligatorios (`required` nativo), Notas opcional. "Guardar" solo se deshabilita mientras la request está en curso (`isPending`).
4. Submit → `createContactAction` → `fetchMutation(api.contacts.createContact, {...})`.
5. Convex: `requireRole(ctx, token, "rep")` → trim + límites de longitud (defensa en profundidad) → si falla algo, `{success:false, error, field}` sin insertar → si ok, `ctx.db.insert("contacts", {name, phone, status:"lead", createdBy, initialNote?})`.
6. Éxito → `redirect(\`/contactos/${id}\`)`.
7. Si la sesión se revocó entre pasos 1 y 4, `requireRole` lanza → la action lo captura y redirige a `/login`.
8. `contactos/[id]/page.tsx` → `getUser()` + `getContact` (vía `normalizeId`, tolera IDs malformados) → ficha con nombre, badge "Lead nuevo", teléfono y nota si existe.

## Verificación end-to-end

1. Login como Carlos → FAB → `/contactos/nuevo`, formulario visible, foco automático en Nombre.
2. Login como Marta → FAB → `/contactos/nuevo` muestra el mensaje de solo-lectura, **no** el formulario.
3. Como Carlos, enviar con Nombre o Teléfono vacíos (el navegador debería bloquear por `required`; forzar también un POST directo sin esos campos para probar la defensa server-side) → error específico por campo, **sin insertar** (`npx convex data contacts`).
4. Enviar Nombre de 121 caracteres, Teléfono de 41, Nota de 2001 → cada uno rechazado con su mensaje, sin insertar.
5. Guardar con datos válidos (± Notas) → redirige a `/contactos/<id>`, ficha muestra nombre, badge "Lead nuevo", teléfono y nota si se rellenó.
6. `npx convex data contacts` confirma la fila con `status:"lead"` y `createdBy` apuntando al usuario de Carlos.
7. Intentar invocar `createContact` directamente (ej. `npx convex run contacts:createContact` con el token de Marta) → rechazado por `requireRole` — confirma que el guard es real, no solo de UI.
8. `/contactos/foo` (ID con formato inválido) → "Contacto no encontrado", **sin error 500** ni página de error de Next.
9. `/contactos/<id-formato-válido-pero-inexistente>` → mismo mensaje "Contacto no encontrado".
10. Incógnito sin sesión → `/contactos/nuevo` y `/contactos/<id>` redirigen a `/login`.
11. Revocar la sesión de Carlos (borrar su fila en `sessions` desde el dashboard) justo antes de enviar el formulario ya cargado → `createContactAction` redirige a `/login` en vez de mostrar un error sin controlar.
12. Cronometrar el flujo completo en viewport móvil, confirmar razonablemente < 30s.
13. `grep -rn "requireRole" src/` → sin resultados (el guard de rol vive en Convex, no en páginas de Next — invariante de MIS-18 intacta).
14. `npm run build` y `npm run lint` limpios.

## Archivos afectados

```
convex/schema.ts                                   EDITAR — + initialNote, + createdBy
convex/contacts.ts                                 NUEVO — createContact (requireRole "rep"), getContact (requireUser)

src/lib/contacts/actions.ts                        NUEVO — createContactAction

src/app/(app)/contactos/
  nuevo/page.tsx                                    EDITAR — reemplaza el placeholder de MIS-18, guard de rol para el mensaje
  nuevo/NewContactForm.tsx                          NUEVO
  [id]/page.tsx                                     NUEVO — ficha mínima con datos reales
```

No se toca: `convex/lib/authz.ts` (ya tenía `requireRole`, solo se usa por primera vez), `src/proxy.ts`, `src/lib/auth/dal.ts`, `(with-nav)/contactos/page.tsx` (lista real es scope de MIS-9), `src/components/crm/AddContactFab.tsx` (visibilidad del FAB no cambia).

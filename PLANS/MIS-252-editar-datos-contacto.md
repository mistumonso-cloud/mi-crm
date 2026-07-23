# MIS-252 — Editar datos del contacto (nombre, teléfono, email, canal)

> **Estado**: Plan y código con GO condicionado de auditoría (2026-07-23). Instalado en la rama `feature/mis-252-editar-datos-contacto` (build/lint/tsc/e2e en verde, ver `CODIGO/MIS-252-editar-datos-contacto/NOTES.md`). Pendiente: PR a `main` y, tras fusionar, `npx convex deploy` a producción.

## Contexto

Hoy solo se puede **crear** un contacto (MIS-8) y añadirle actividad (notas, recordatorios, cambios de estado, cierres de venta) — no existe forma de corregir sus datos básicos una vez creado. MIS-7 ya decía que Carlos puede "editar" contactos, pero nunca se construyó la pantalla. Además, desde la reapertura de MIS-8, el modelo tiene `email` y `channel`, pero si Carlos se equivoca al escribirlos (o quiere añadir un canal que no capturó al principio), no hay manera de arreglarlo. Este ticket cierra ambos huecos: editar nombre, teléfono, email y canal desde la propia ficha del contacto, solo para Carlos (rol `rep`).

Sin cambios de schema: los 4 campos (`name`, `phone`, `email`, `channel`) ya existen en `convex/schema.ts` con los tipos que necesitamos.

## Diseño

### 1. `convex/contacts.ts` — nueva mutation `updateContact`

Mismo orden de guardas que `changeContactStatus` (rol → resolución de ID → validación de campos → escritura), reutilizando las constantes ya definidas en este archivo (`NAME_MAX`, `PHONE_MAX`, `EMAIL_MAX`, `contactChannelValidator`):

```ts
export const updateContact = mutation({
  args: {
    token: v.string(),
    contactId: v.string(), // v.string(), no v.id("contacts") — mismo motivo que getContact/changeContactStatus
    name: v.string(),
    phone: v.string(),
    email: v.optional(v.string()),
    channel: v.optional(contactChannelValidator),
  },
  returns: v.union(
    v.object({ success: v.literal(true) }),
    v.object({
      success: v.literal(false),
      error: v.string(),
      field: v.optional(
        v.union(v.literal("contactId"), v.literal("name"), v.literal("phone"), v.literal("email")),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    // MIS-252: solo Carlos ("rep") edita datos del contacto — mismo
    // gating que changeContactStatus/closeSale, mismo ADR de MIS-18.
    await requireRole(ctx, args.token, "rep");

    const contactId = ctx.db.normalizeId("contacts", args.contactId);
    if (!contactId) {
      return { success: false as const, error: "Contacto no encontrado", field: "contactId" as const };
    }
    const contact = await ctx.db.get(contactId);
    if (!contact) {
      return { success: false as const, error: "Contacto no encontrado", field: "contactId" as const };
    }

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

    const emailTrimmed = args.email?.trim();
    if (emailTrimmed && emailTrimmed.length > EMAIL_MAX) {
      return { success: false as const, error: `El email no puede superar ${EMAIL_MAX} caracteres`, field: "email" as const };
    }

    // A diferencia de createContact (insert: omitir la clave = "no
    // guardar este campo"), ctx.db.patch hace merge superficial — omitir
    // una clave significa "no tocar el valor existente", NO "vaciarlo"
    // (confirmado en node_modules/convex/dist/cjs-types/server/
    // database.d.ts: "Fields with value undefined are removed. Fields
    // not specified in the patch are left [unchanged]."). Para que dejar
    // email/canal en blanco en el formulario de edición SÍ los borre,
    // hay que pasar la clave con valor `undefined` explícito — por eso
    // aquí NO se usa el patrón `...(x ? {email: x} : {})` de createContact.
    await ctx.db.patch(contactId, {
      name,
      phone,
      email: emailTrimmed || undefined,
      channel: args.channel,
    });

    return { success: true as const };
  },
});
```

Notas:
- No hay validación runtime extra de `channel` en el handler: el `v.union` de 5 literales del validador de argumentos ya rechaza cualquier valor fuera del enum antes de que el handler se ejecute (mismo criterio que `createContact`).
- Sin registro en `statusChanges` ni tabla de historial nueva: el AC no pide dejar rastro de "quién editó qué campo" (a diferencia de `changeContactStatus`). Exclusión deliberada, no un olvido.

### 2. `src/lib/contacts/actions.ts` — nueva `updateContactAction`

Mirror de `changeStatusAction` (contacto ya existe, en error de autorización se queda en la misma ficha), no de `createContactAction` (que redirige a una ficha nueva):

```ts
export type UpdateContactState =
  | { success: true }
  | { success: false; error: string; field?: "contactId" | "name" | "phone" | "email" | "channel" }
  | undefined;

export async function updateContactAction(
  _prevState: UpdateContactState,
  formData: FormData,
): Promise<UpdateContactState> {
  const token = await readSessionToken();
  if (!token) redirect("/login");

  const contactId = String(formData.get("contactId") ?? "");
  const name = String(formData.get("name") ?? "");
  const phone = String(formData.get("phone") ?? "");
  const emailRaw = String(formData.get("email") ?? "").trim();

  // Mismo patrón que createContactAction: hasOwnProperty, no `in`.
  const channelRaw = String(formData.get("channel") ?? "");
  let channel: ContactChannel | undefined;
  if (channelRaw) {
    if (!Object.prototype.hasOwnProperty.call(CONTACT_CHANNELS, channelRaw)) {
      return { success: false, error: "Canal inválido", field: "channel" };
    }
    channel = channelRaw as ContactChannel;
  }

  let result;
  try {
    result = await fetchMutation(api.contacts.updateContact, {
      token, contactId, name, phone, email: emailRaw || undefined, channel,
    });
  } catch (err) {
    if (err instanceof ConvexError) {
      redirect(err.data === "No autorizado" ? `/contactos/${contactId}` : "/login");
    }
    throw err;
  }

  if (!result.success) return { success: false, error: result.error, field: result.field };

  refresh(); // Next 16: re-renderiza /contactos/[id] en la misma respuesta — mismo patrón que changeStatusAction/closeSaleAction
  return { success: true };
}
```

`CONTACT_CHANNELS`/`ContactChannel` ya están importados en este archivo (desde MIS-8) — no hay que tocar imports.

### 3. `src/app/(app)/contactos/[id]/EditContactForm.tsx` (nuevo)

Mismo esqueleto que `AddNoteForm.tsx` (BottomSheet + `useActionState` + `useEffect(onDone)`), campos calcados de `NewContactForm.tsx` pero con `defaultValue` desde el contacto actual. Props individuales (`initialName`, `initialPhone`, ...), no un objeto `contact` completo — mismo estilo que `ScheduleReminderForm`.

Sobre el canal: la opción vacía del `<Select>` se etiqueta **"Sin canal"** (no "Selecciona un canal (opcional)", que es el copy de creación) — en un formulario de edición no hay ambigüedad "no tocado" vs "borrado": el valor del `<select>` en el submit siempre es el estado final deseado. Si ya tenía canal, `defaultValue={initialChannel ?? ""}` lo preselecciona; si el usuario elige "Sin canal", se borra explícitamente vía el `undefined` de la mutation.

```tsx
"use client";

import { useActionState, useEffect } from "react";
import { Button } from "@/components/ui/core/Button";
import { Input } from "@/components/ui/forms/Input";
import { Select } from "@/components/ui/forms/Select";
import { CONTACT_CHANNEL_OPTIONS, type ContactChannel } from "@/lib/contacts/channel";
import { updateContactAction, type UpdateContactState } from "@/lib/contacts/actions";

const initialState: UpdateContactState = undefined;

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
        label={<>Email <span style={{ color: "var(--text-tertiary)", fontWeight: 400 }}>(opcional)</span></>}
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
          label={<>Canal de captación <span style={{ color: "var(--text-tertiary)", fontWeight: 400 }}>(opcional)</span></>}
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
        <div role="alert" style={{ fontSize: 13, color: "var(--color-danger-fg)" }}>{state.error}</div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <Button type="button" variant="secondary" full onClick={onDone} disabled={isPending}>Cancelar</Button>
        <Button type="submit" full disabled={isPending}>{isPending ? "Guardando…" : "Guardar"}</Button>
      </div>
    </form>
  );
}
```

`Select`/`Input` ya soportan `defaultValue` sin control (spread `{...rest}` sobre el elemento nativo) — confirmado, mismo uso ya en `NewContactForm.tsx`/`AddNoteForm.tsx`.

### 4. `src/app/(app)/contactos/[id]/ContactDetailView.tsx`

Cambios puntuales (archivo ya inspeccionado línea a línea):

1. `import { EditContactForm } from "./EditContactForm";`
2. L26: `type SheetKind = "note" | "status" | "schedule" | "close" | "edit" | null;`
3. L28: `SHEET_TITLES: Record<"note" | "status" | "close" | "edit", string>` + `edit: "Editar datos"`.
4. Nuevo botón **al final** de la fila de acciones (después de "Cerrar venta", L204-208), mismo `flex: "1 1 130px"`, gateado por `canChangeStatus` **sin** `!isClosed` (Carlos puede corregir datos de un contacto ya cerrado — el ticket no lo restringe, y el precedente de "Cambiar estado" ya tratado en este archivo tampoco se restringe por `isClosed`; solo "Cerrar venta" lo hace, por una razón propia — no repetir venta ya cerrada — que no aplica aquí):

```tsx
{canChangeStatus && (
  <Button variant="secondary" size="sm" style={{ flex: "1 1 130px" }} onClick={() => setSheet("edit")}>
    Editar datos
  </Button>
)}
```

5. Rama de render en el `BottomSheet` (junto a `sheet === "close"`):

```tsx
) : sheet === "edit" ? (
  <EditContactForm
    contactId={contact._id}
    initialName={contact.name}
    initialPhone={contact.phone}
    initialEmail={contact.email}
    initialChannel={contact.channel}
    onDone={() => setSheet(null)}
  />
) : (
```

**Orden del botón**: al final (Añadir nota → Cambiar estado → Cerrar venta → Editar datos), siguiendo el mismo patrón de "append" con que se fueron añadiendo los 3 anteriores en MIS-11/14/15 — minimiza el diff sobre una fila ya auditada.

**Layout a 320px con 4 botones (verificado, no solo asumido)**: contenedor con `padding: 16px 20px` → 280px disponibles. Cada botón `flex: 1 1 130px`; 2 por fila = 130+130+8(gap) = 268px ≤ 280px → caben. Con 4 botones se envuelven en 2 filas de 2 — a diferencia del caso de 3 (donde el 3º queda solo y se estira a 100%, ya en producción), con 4 ninguno queda huérfano: cada fila reparte el mismo sobrante por igual. No hace falta tocar el `flex-basis` ni la estructura `flexWrap`. Se añade una frase al comentario existente de MIS-10 sobre este hallazgo, señalando que se re-verificó para 4 botones.

### 5. `listContacts` / `ContactList.tsx` — sin cambios (confirmado)

`/contactos` (`(with-nav)/contactos/page.tsx`) hace `fetchQuery(api.contacts.listContacts, ...)` una vez por request, sin `"use cache"` en ningún sitio del repo y sin `cacheComponents` activado en `next.config.ts` — ruta dinámica (`ƒ` en el build). La misma asunción de "sin caché, una navegación normal ya re-ejecuta el Server Component fresco" ya sostiene a `changeContactStatus`/`closeSale` (que también cambian datos visibles en la lista) sin ningún `revalidatePath` en el repo. `listContacts` ya devuelve `name`/`phone` (los únicos 2 de los 4 campos editables que se muestran en la lista); `email`/`channel` no se muestran ahí y el ticket no lo pide. **No se toca este archivo.**

### Fuera de alcance (explícito)

- **MIS-255** (aviso de duplicados): no se añade ninguna comprobación de duplicados a `updateContact`.
- Sin historial/auditoría de "quién editó qué campo" — el AC no lo pide.
- Sin cambios en `getContact` ni en el schema — los 4 campos y tipos ya existen tal cual se necesitan.
- No se retoca el copy "Selecciona un canal (opcional)" de `NewContactForm.tsx` — el nuevo copy "Sin canal" es exclusivo de `EditContactForm.tsx`.

## Verificación end-to-end

1. Como Carlos: ficha → "Editar datos" → formulario precargado con los valores actuales (incluido canal si lo tiene).
2. Cambiar los 4 campos → Guardar → hoja se cierra, ficha muestra los nuevos valores sin recargar manualmente (`refresh()`).
3. Vaciar el email y guardar → el email desaparece de la ficha (no se queda con el valor viejo) — ejercita la semántica de `patch` con `undefined` explícito.
4. Cambiar canal a "Sin canal" en un contacto que ya tenía uno → guardar → la línea "· Canal: …" desaparece.
5. Nombre o teléfono en blanco → error inline por campo, hoja no se cierra.
6. Navegar a `/contactos` tras el paso 2 → nombre/teléfono actualizados visibles en la lista.
7. Como Marta: la ficha del mismo contacto **no** muestra "Editar datos".
8. Viewport 320px (DevTools): los 4 botones de la fila se envuelven en 2 filas de 2 sin overflow ni texto cortado.
9. `npx convex run contacts:updateContact` con token de Marta (`supervisor`) → `ConvexError("No autorizado")`.
10. `npx convex data contacts` tras el paso 3 → confirma que el documento ya NO tiene el campo `email` (no solo `""`).
11. `npx tsc --noEmit`, `npm run lint`, `npm run build` limpios.
12. `npx playwright test` (suite completa) sigue en verde — sin test nuevo obligatorio en este plan, pero valorar añadir un caso "Carlos edita datos de un contacto existente" + negativo de Marta, mismo estilo que `role-gating.spec.ts`.

## Archivos afectados

```
convex/contacts.ts                                   EDITAR — nueva mutation updateContact
src/lib/contacts/actions.ts                          EDITAR — nueva updateContactAction

src/app/(app)/contactos/[id]/
  EditContactForm.tsx                                NUEVO
  ContactDetailView.tsx                               EDITAR — SheetKind, botón, render, import
```

No se toca: `convex/schema.ts`, `getContact`, `listContacts`, `ContactList.tsx`, `convex/lib/authz.ts`, `src/lib/contacts/channel.ts`, MIS-255.

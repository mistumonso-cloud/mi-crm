# MIS-14 — Gestión de estados del contacto (v2)

## Respuesta a la auditoría de plan v1 → v2

Veredicto recibido: **NO-GO** (v1) — un major real.

| # | Auditoría | Resolución |
|---|---|---|
| Major | `src/lib/contacts/actions.ts` (`changeStatusAction`) usaba `SELECTABLE_STATUSES.includes(statusRaw as ContactStatus)`. `SELECTABLE_STATUSES` está tipado `readonly Exclude<ContactStatus, "inactive">[]` (6 literales); `ContactStatus` tiene 7 (incluye `"inactive"`). Con `strict: true`, `Array.prototype.includes` exige que el argumento case contra el tipo exacto de los elementos del array — `TS2345: Type '"inactive"' is not assignable to type "lead"\|...\|"lost"`. `npx tsc --noEmit` habría fallado en la instalación real. | **Corregido.** Cast cambiado a `statusRaw as (typeof SELECTABLE_STATUSES)[number]` — mismo patrón que ya usaba correctamente `CHANGEABLE_STATUSES.includes(args.status as (typeof CHANGEABLE_STATUSES)[number])` en `convex/contacts.ts` dentro del mismo plan v1: la Server Action simplemente no seguía su propio precedente. Verificado con `tsc --noEmit --strict` en aislado: la versión corregida compila limpio, la original reproduce el error exacto citado por la auditoría. |
| Media | Confirmar con producto el copy "Comprado/Descartado" (ticket) vs. "Ganado/Perdido" (`StatusBadge.jsx`, en producción) — aparecerán en el picker y el historial vía `PIPELINE_STATES`. | Ya documentado como punto abierto en "Puntos abiertos" — se mantiene sin cambio de comportamiento, pendiente de confirmación de producto. |
| Baja | Añadir a la verificación un cambio desde `won`/`lost` hacia un estado no cerrado, porque el AC permite cualquier transición y "Cerrar venta" reaparecería por `isClosed`. | Adoptado. Nuevo paso en "Verificación end-to-end". |

No se reabre ninguna decisión de alcance (tabla `statusChanges`, los 6 estados seleccionables, gating de rol, no-op como error) — el único cambio de código real es el cast señalado.

## Contexto

Se planificó originalmente MIS-17 ("Panel de oportunidades", home de Marta), pero se descubrió que depende por completo de MIS-14 (este ticket) y MIS-15 ("Cierre de venta"), ambas en **Fase 4 — Pipeline y cierre de ventas** y sin construir: hoy ningún contacto puede cambiar de `status` tras crearse (`createContact` siempre fija `"lead"`), así que un panel de conteos por estado mostraría siempre ceros. Se le planteó esto al usuario con la evidencia y eligió explícitamente empezar por MIS-14, el más fundamental de los dos — sin estados que cambien, nada del pipeline avanza. MIS-15 y MIS-17 se planificarán en sesiones futuras.

### Texto literal del ticket (Linear, `MIS-14`)

> Implementar el sistema de estados que refleja en qué punto del proceso de venta está cada contacto, y que Carlos pueda cambiar ese estado en un clic desde la ficha del contacto.
>
> **Los estados del pipeline** — cada contacto tiene siempre uno de: Lead nuevo, En conversación, Propuesta enviada, Negociando, Comprado, Descartado.
>
> **Cómo se cambia el estado:** desde la ficha del contacto, el estado actual aparece visible y destacado. Al pulsarlo (o desde un botón "Cambiar estado"), se despliega una lista con los estados disponibles. Carlos selecciona el nuevo estado y se guarda en un solo paso, sin formularios adicionales.
>
> **Registro del cambio en el historial:** cada cambio de estado queda registrado automáticamente — estado anterior → estado nuevo, fecha y hora del cambio, quién lo cambió.
>
> **Lo que NO entra en el MVP:** no hay flujos de estados bloqueantes (se puede pasar de cualquier estado a cualquier otro); no hay automatizaciones disparadas por cambio de estado.
>
> **Criterio de aceptación:** cada contacto tiene siempre un estado activo de la lista definida. Carlos puede cambiar el estado desde la ficha en un máximo de 2 toques. El cambio queda registrado en el historial con fecha y quién lo hizo. El estado se muestra claramente en la lista de contactos y en los pendientes del día.

### Hallazgo clave: el ticket ya está parcialmente scaffolded

`src/app/(app)/contactos/[id]/ContactDetailView.tsx` (instalado desde MIS-11/12) ya tiene: `type SheetKind = "note" | "status" | "schedule" | "close" | null`; un botón "Cambiar estado" que ya abre la hoja `"status"` con el título correcto (`SHEET_TITLES.status = "Cambiar estado"`); y `const isClosed = contact.status === "won" || contact.status === "lost"`, que oculta el botón "Cerrar venta" (MIS-15, todavía no construido) pero **nunca** oculta "Cambiar estado" — confirmando que "Cambiar estado" es la vía libre cualquier-estado-a-cualquier-estado del AC, mientras "Cerrar venta" es un flujo aparte y más específico (con datos adicionales: producto/importe/fecha o motivo de pérdida), responsabilidad de MIS-15. Hoy la hoja `"status"` cae en el placeholder genérico "Disponible próximamente." — este ticket sustituye **solo esa rama**, sin tocar `"close"`.

La última viñeta del AC ("el estado se muestra claramente en la lista de contactos y en los pendientes del día") ya está satisfecha sin cambios: `ContactList.tsx` (MIS-9) y `pendientes/page.tsx` (MIS-13) ya renderizan `StatusBadge` con el `status`/`contactStatus` en vivo desde sus queries — en cuanto la mutation de este ticket haga `patch` sobre `contacts.status`, ambas pantallas reflejan el cambio en su siguiente carga, sin trabajo adicional.

## Decisiones fijadas

1. **Nueva tabla `statusChanges`** (append-only, como `notes` — nunca se actualiza una fila tras insertarla, a diferencia de `reminders` que sí lo hace al completarse): `contactId`, `fromStatus`, `toStatus`, `changedBy`, `changedAt`, índice `by_contact`. No hace falta un índice cross-contacto: nada en el AC pide una vista global de cambios de estado (si un futuro ticket lo necesitara, se añade entonces — mismo criterio ya aplicado en el repo de no ensanchar un contrato sin consumidor).

2. **Estados seleccionables: los 6 del AC, no los 7 del schema.** `"inactive"` existe en `contacts.status` desde MIS-9, pero el AC de MIS-14 no lo menciona y ningún ticket define cómo se llega a él — se mantiene así, sin abrir una vía nueva de entrada. La restricción se aplica en **tres sitios independientes** a propósito (mutation, Server Action, formulario): defensa en profundidad (la mutation es un endpoint público invocable directamente con un token válido) más la convención ya aceptada del repo de que cada módulo es autocontenido.

3. **Rol: `requireRole(ctx, token, "rep")`.** Esta condición **ya está cerrada**, no es una decisión nueva de este plan — el ADR de `PLANS/MIS-18-navegacion-principal.md` ("Qué NO cambia") dice literalmente: *"Cualquier operación de escritura futura (alta de contacto en MIS-8, cambio de estado en MIS-14, cierre de venta en MIS-15...) sigue debiendo llamarlas [requireRole de Convex] como primera línea, sin excepción."*

4. **El botón "Cambiar estado" se oculta para Marta** (no se deshabilita con mensaje). Mismo criterio que ya usa `ContactList.tsx` con su prop `canCreate` para adaptar la UI según rol. El botón "Cerrar venta" no se toca — sigue sin gating de rol, responsabilidad de MIS-15 cuando se construya.

5. **Pedir el mismo estado que el actual es un error controlado, no un éxito silencioso** — mismo criterio que `completeReminder` ante un recordatorio ya `"done"` ("Este seguimiento ya estaba marcado como hecho"). En la práctica no es alcanzable desde la UI normal: el picker excluye el estado actual de la lista de opciones. Es solo defensa en profundidad ante manipulación directa del `FormData`/la mutation.

6. **Nuevo módulo `src/lib/contacts/status.ts`** (sin `"use client"`): tipo `ContactStatus` + constante `SELECTABLE_STATUSES` (los 6 seleccionables). Existe porque `StatusBadge.jsx` lleva `"use client"` en cabecera — importar sus valores (no solo tipos) desde una Server Action (`"use server"`) sería el tipo de acoplamiento cross-boundary que el repo evita sistemáticamente (ver la duplicación ya existente de `contactStatusValidator`/`isValidEpochMs` entre `convex/contacts.ts` y `convex/reminders.ts`). Mismo patrón que ya usa `src/lib/notes/types.ts` para compartir el enum de tipos de nota entre Server Action y formulario cliente.

7. **No se toca `StatusBadge.jsx`.** El ticket usa las etiquetas "Comprado"/"Descartado"; el componente, en producción desde MIS-9 en tres pantallas (`ContactList`, `pendientes`, ficha), usa "Ganado"/"Perdido". Se deja como está — un rename es un cambio cosmético fuera del alcance de "gestión de estados" — y se documenta como punto abierto para confirmar con quien redactó el ticket si el texto de Linear era solo descriptivo.

## `convex/schema.ts` (EDITAR)

Se añade inmediatamente después de la tabla `reminders`:

```ts
// MIS-14: registro inmutable de cada cambio de estado de pipeline de un
// contacto (AC: "el cambio queda registrado en el historial — estado
// anterior → estado nuevo, fecha y hora, quién lo cambió"). Tabla
// append-only: nunca se actualiza una fila tras insertarla — mismo patrón
// que `notes` (no el de `reminders`, que sí actualiza campos opcionales al
// completarse). fromStatus/toStatus usan la misma unión de 7 literales que
// contacts.status (no solo los 6 seleccionables de MIS-14): esta tabla
// registra el valor real que tuviera el contacto, sea cual sea el dominio
// completo del campo.
statusChanges: defineTable({
  contactId: v.id("contacts"),
  fromStatus: v.union(
    v.literal("lead"),
    v.literal("talking"),
    v.literal("proposal"),
    v.literal("negotiating"),
    v.literal("won"),
    v.literal("lost"),
    v.literal("inactive"),
  ),
  toStatus: v.union(
    v.literal("lead"),
    v.literal("talking"),
    v.literal("proposal"),
    v.literal("negotiating"),
    v.literal("won"),
    v.literal("lost"),
    v.literal("inactive"),
  ),
  changedBy: v.id("users"),
  changedAt: v.number(), // epoch ms, Date.now() del servidor — nunca editable por el cliente, mismo criterio que reminders.completedAt
})
  // Ficha del contacto: recuperar todos los cambios de UN contacto, ordenados.
  .index("by_contact", ["contactId", "changedAt"]),
```

Nota: `contacts` ya tiene `.index("by_status", ["status"])` desde MIS-9 (probablemente instalado en previsión de MIS-17). `changeContactStatus` hace `patch` sobre `contacts.status`, así que ese índice queda automáticamente correcto sin trabajo adicional — es lo que un futuro MIS-17 usará para sus conteos por estado.

## `convex/contacts.ts` (EDITAR)

Nueva constante de módulo, junto a `contactStatusValidator`:

```ts
// Subconjunto de contactStatusValidator seleccionable desde "Cambiar
// estado" (MIS-14) — exactamente los 6 estados del AC del ticket en
// Linear. "inactive" existe en el schema desde MIS-9 pero ningún ticket
// define cómo se llega a él; se mantiene fuera de alcance aquí a
// propósito. Duplicado respecto a SELECTABLE_STATUSES en
// src/lib/contacts/status.ts a propósito: convex/ y src/ son módulos
// independientes, sin validador compartido (mismo criterio que
// contactStatusValidator duplicado en convex/reminders.ts).
const CHANGEABLE_STATUSES = ["lead", "talking", "proposal", "negotiating", "won", "lost"] as const;
```

Nueva mutation:

```ts
export const changeContactStatus = mutation({
  args: {
    token: v.string(),
    contactId: v.string(), // v.string(), no v.id("contacts"): mismo motivo que getContact.args.id
    status: contactStatusValidator,
  },
  returns: v.union(
    v.object({ success: v.literal(true) }),
    v.object({
      success: v.literal(false),
      error: v.string(),
      field: v.optional(v.union(v.literal("contactId"), v.literal("status"))),
    }),
  ),
  handler: async (ctx, args) => {
    // Solo "rep" (Carlos) puede cambiar el estado — condición YA CERRADA
    // por el ADR de MIS-18 (PLANS/MIS-18-navegacion-principal.md, "Qué NO
    // cambia"): "cambio de estado en MIS-14... sigue debiendo llamar
    // [requireRole] como primera línea, sin excepción."
    const user = await requireRole(ctx, args.token, "rep");

    const contactId = ctx.db.normalizeId("contacts", args.contactId);
    if (!contactId) {
      return { success: false as const, error: "Contacto no encontrado", field: "contactId" as const };
    }
    const contact = await ctx.db.get(contactId);
    if (!contact) {
      return { success: false as const, error: "Contacto no encontrado", field: "contactId" as const };
    }

    // Defensa en profundidad: la mutation es un endpoint público invocable
    // directamente con un token válido, sin pasar por changeStatusAction.
    // Un valor fuera de CHANGEABLE_STATUSES (p.ej. "inactive") no debe
    // persistirse aunque pase el v.union de 7 literales del validador de
    // argumentos.
    if (!CHANGEABLE_STATUSES.includes(args.status as (typeof CHANGEABLE_STATUSES)[number])) {
      return { success: false as const, error: "Estado no disponible", field: "status" as const };
    }

    // No-op explícito: pedir el mismo estado que ya tiene no es un cambio
    // real. Se rechaza como error controlado — mismo criterio que
    // completeReminder ante un recordatorio ya "done" — en vez de éxito
    // silencioso, para no ensuciar statusChanges con una fila
    // fromStatus === toStatus sin información real. No alcanzable desde
    // la UI normal (el picker excluye el estado actual).
    if (contact.status === args.status) {
      return { success: false as const, error: "El contacto ya está en ese estado", field: "status" as const };
    }

    await ctx.db.insert("statusChanges", {
      contactId,
      fromStatus: contact.status,
      toStatus: args.status,
      changedBy: user.id,
      changedAt: Date.now(),
    });
    await ctx.db.patch(contactId, { status: args.status });

    return { success: true as const };
  },
});
```

Nueva query:

```ts
export const listStatusChanges = query({
  args: { token: v.string(), contactId: v.string() },
  returns: v.array(
    v.object({
      _id: v.id("statusChanges"),
      fromStatus: contactStatusValidator,
      toStatus: contactStatusValidator,
      changedByName: v.string(),
      changedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireUser(ctx, args.token); // lectura: ambos roles, igual que listNotes/listRemindersForContact
    const contactId = ctx.db.normalizeId("contacts", args.contactId);
    if (!contactId) return []; // ID inválido: page.tsx ya maneja "no encontrado" vía getContact

    const changes = await ctx.db
      .query("statusChanges")
      .withIndex("by_contact", (q) => q.eq("contactId", contactId))
      .order("desc")
      .collect();

    return Promise.all(
      changes.map(async (c) => {
        const changer = await ctx.db.get(c.changedBy);
        return {
          _id: c._id,
          fromStatus: c.fromStatus,
          toStatus: c.toStatus,
          changedByName: changer?.name ?? "—", // defensivo: usuario borrado, caso no esperado hoy — mismo fallback que notes.ts/reminders.ts
          changedAt: c.changedAt,
        };
      }),
    );
  },
});
```

## `src/lib/contacts/status.ts` (NUEVO)

```ts
// Tipo del estado de pipeline de un contacto — mismos 7 literales que
// contacts.status en convex/schema.ts / contactStatusValidator en
// convex/contacts.ts. Tipo puro (sin v.union de Convex), duplicado a
// propósito frente al schema — mismo criterio ya aceptado en el repo (ver
// contactStatusValidator duplicado en convex/reminders.ts). Existe para
// tipar código de src/ (incluido src/lib/notes/history.ts) sin acoplar a
// los tipos generados de Convex.
export type ContactStatus =
  | "lead"
  | "talking"
  | "proposal"
  | "negotiating"
  | "won"
  | "lost"
  | "inactive";

// Subconjunto seleccionable desde "Cambiar estado" (MIS-14): exactamente
// los 6 estados del AC del ticket en Linear, en el orden en que se
// muestran los botones del picker. Excluye "inactive" a propósito (ver
// CHANGEABLE_STATUSES en convex/contacts.ts, comentario gemelo).
//
// Sin labels propios aquí: los textos a mostrar vienen siempre de
// PIPELINE_STATES en StatusBadge.jsx (única fuente de verdad de etiquetas
// de estado ya usada en ContactList/Pendientes/ficha) — no se duplica
// texto en este archivo para no arriesgar una etiqueta inconsistente con
// lo que ya se muestra en el resto de la app.
export const SELECTABLE_STATUSES: readonly Exclude<ContactStatus, "inactive">[] = [
  "lead",
  "talking",
  "proposal",
  "negotiating",
  "won",
  "lost",
];
```

## `src/lib/contacts/actions.ts` (EDITAR)

Se añade `refresh` a los imports (`import { refresh } from "next/cache";`, hoy no está importado en este archivo) y el import de `SELECTABLE_STATUSES`/`ContactStatus`. Nueva Server Action:

```ts
export type ChangeStatusState =
  | { success: true }
  | { success: false; error: string; field?: "contactId" | "status" }
  | undefined;

export async function changeStatusAction(
  _prevState: ChangeStatusState,
  formData: FormData,
): Promise<ChangeStatusState> {
  const token = await readSessionToken();
  if (!token) redirect("/login");

  const contactId = String(formData.get("contactId") ?? "");

  // Validado contra SELECTABLE_STATUSES ANTES de llamar a Convex — mismo
  // motivo que la validación de dueAt/reason en reminders/actions.ts: un
  // POST manipulado con un valor fuera de la lista no debe llegar a la
  // mutation y disparar un error de validación de argumentos de Convex
  // sin manejar.
  const statusRaw = String(formData.get("status") ?? "");
  if (!SELECTABLE_STATUSES.includes(statusRaw as (typeof SELECTABLE_STATUSES)[number])) {
    return { success: false, error: "Estado inválido", field: "status" };
  }
  const status = statusRaw as (typeof SELECTABLE_STATUSES)[number];

  let result;
  try {
    result = await fetchMutation(api.contacts.changeContactStatus, { token, contactId, status });
  } catch (err) {
    // requireRole(ctx, token, "rep") — ConvexError("No autenticado") si la
    // sesión se revocó/expiró entre cargar la ficha y pulsar un estado, o
    // ConvexError("No autorizado") si Marta fuerza la request saltándose
    // el gating de UI (ver ContactDetailView.tsx, prop canChangeStatus).
    // A diferencia de createContactAction (que redirige a "/contactos"
    // porque en ese punto el contacto ni siquiera existe todavía), aquí sí
    // hay un contactId concreto: se redirige de vuelta a esa misma ficha.
    if (err instanceof ConvexError) {
      redirect(err.data === "No autorizado" ? `/contactos/${contactId}` : "/login");
    }
    throw err;
  }

  if (!result.success) {
    return { success: false, error: result.error, field: result.field === "status" ? "status" : undefined };
  }

  refresh(); // Next 16: re-renderiza /contactos/[id] en la MISMA respuesta — mismo patrón que scheduleReminderAction/completeReminderAction
  return { success: true };
}
```

## `src/app/(app)/contactos/[id]/ChangeStatusForm.tsx` (NUEVO)

```tsx
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
  // igualmente como defensa en profundidad si se manipulara el POST).
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
```

Nota sobre `Button`: aunque `Button.jsx` hardcodea `type="button"` en su JSX, el `{...rest}` se spreadea *después* en el mismo elemento y gana — exactamente el mecanismo que ya usa `CompleteReminderButton.tsx` para forzar `type="submit"`. `name`/`value` no son props reconocidas por `Button` (solo destructura `children, variant, size, iconLeft, iconRight, disabled, full, style`), así que se reenvían tal cual al `<button>` nativo vía `{...rest}`.

## `src/lib/notes/history.ts` (EDITAR)

```ts
import type { ContactStatus } from "@/lib/contacts/status";

export type HistoryEntry =
  | { key: string; kind: "created"; timestamp: number }
  | { key: string; kind: "initialNote"; timestamp: number; text: string }
  | { key: string; kind: "note"; timestamp: number; type: NoteType; text: string; authorName: string }
  | { key: string; kind: "reminderDone"; timestamp: number; reason: string; completedByName: string }
  | {
      key: string;
      kind: "statusChanged";
      timestamp: number;
      fromStatus: ContactStatus;
      toStatus: ContactStatus;
      changedByName: string;
    };

export function buildHistory(
  contact: { initialNote?: string; _creationTime: number },
  notes: Array<{ _id: string; type: NoteType; occurredAt: number; text: string; authorName: string }>,
  completedReminders: Array<{ _id: string; completedAt: number; reason: string; completedByName: string }> = [],
  statusChanges: Array<{
    _id: string;
    fromStatus: ContactStatus;
    toStatus: ContactStatus;
    changedByName: string;
    changedAt: number;
  }> = [],
): HistoryEntry[] {
  const entries: HistoryEntry[] = [];

  // ... bloques existentes de initialNote / created / notes / completedReminders, sin cambios ...

  // MIS-14: cada cambio de estado también forma parte del historial (AC
  // explícito). timestamp = changedAt (instante real del cambio,
  // server-authoritative) — mismo criterio que completedAt en reminders.
  for (const s of statusChanges) {
    entries.push({
      key: s._id,
      kind: "statusChanged",
      timestamp: s.changedAt,
      fromStatus: s.fromStatus,
      toStatus: s.toStatus,
      changedByName: s.changedByName,
    });
  }

  return entries.sort((a, b) => b.timestamp - a.timestamp);
}
```

El 4º parámetro tiene default `[]` — compatible hacia atrás con cualquier otro call site (hoy solo existe uno: `ContactDetailView.tsx`).

## `src/app/(app)/contactos/[id]/page.tsx` (EDITAR)

```tsx
export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getUser(); // antes: await getUser(); sin capturar el valor — ahora se necesita user.role
  const { id } = await params;
  const token = await readSessionToken();

  const [contact, notes, reminders, statusChanges] = await Promise.all([
    fetchQuery(api.contacts.getContact, { token: token!, id }),
    fetchQuery(api.notes.listNotes, { token: token!, contactId: id }),
    fetchQuery(api.reminders.listRemindersForContact, { token: token!, contactId: id }),
    fetchQuery(api.contacts.listStatusChanges, { token: token!, contactId: id }),
  ]);

  // ... bloque "no encontrado", sin cambios ...

  return (
    // ...
    <ContactDetailView
      contact={contact}
      now={now}
      notes={notes}
      reminders={reminders}
      statusChanges={statusChanges}
      canChangeStatus={user.role === "rep"}
    />
  );
}
```

## `ContactDetailView.tsx` (EDITAR)

Cambios puntuales, sin tocar nada de la rama `"close"`:

1. **Tipo y props nuevas**: `type StatusChanges = FunctionReturnType<typeof api.contacts.listStatusChanges>;`, nuevas props `statusChanges: StatusChanges` y `canChangeStatus: boolean`.
2. **Import ampliado**: `import { StatusBadge, PIPELINE_STATES } from "@/components/ui/feedback/StatusBadge";` (hace falta `PIPELINE_STATES` para el historial) y `import { ChangeStatusForm } from "./ChangeStatusForm";`.
3. **`buildHistory`**: `const history = buildHistory(contact, notes, reminders.completed, statusChanges);`.
4. **Gating del botón** — mismo mecanismo que ya usa "Cerrar venta" con `{!isClosed && (...)}`:
   ```tsx
   {canChangeStatus && (
     <Button variant="secondary" size="sm" style={{ flex: "1 1 130px" }} onClick={() => setSheet("status")}>
       Cambiar estado
     </Button>
   )}
   ```
5. **Rama de la hoja** — nuevo caso antes del `else` genérico que sigue cubriendo `"close"`:
   ```tsx
   {sheet === "note" ? (
     <AddNoteForm contactId={contact._id} onDone={() => setSheet(null)} />
   ) : sheet === "schedule" ? (
     <ScheduleReminderForm ... />
   ) : sheet === "status" ? (
     <ChangeStatusForm contactId={contact._id} currentStatus={contact.status} onDone={() => setSheet(null)} />
   ) : (
     <>
       <p>Disponible próximamente.</p>
       <Button variant="secondary" full onClick={() => setSheet(null)}>Cancelar</Button>
     </>
   )}
   ```
6. **Historial — ambos ternarios** ganan una rama antes del `else` final:
   - Metadatos: `` `Cambio de estado · ${formatDateTime(entry.timestamp)} · ${entry.changedByName}` ``
   - Texto principal: `` `Estado cambiado: ${PIPELINE_STATES[entry.fromStatus].label} → ${PIPELINE_STATES[entry.toStatus].label}` ``
7. **Condición de "sin actividad"**: añadir `&& statusChanges.length === 0` — sin esto, un contacto con solo cambios de estado (sin notas ni recordatorios completados) mostraría erróneamente "Aún no hay más actividad registrada." pese a tener entradas en el historial.

## Paso de generación de código Convex (obligatorio)

1. Guardar `convex/schema.ts` y `convex/contacts.ts` primero.
2. `npx convex dev --once` — despliega la tabla nueva y las funciones nuevas, regenera `convex/_generated/*`.
3. Solo entonces tocar `src/lib/contacts/status.ts`, `src/lib/contacts/actions.ts`, `ChangeStatusForm.tsx`, `history.ts`, `page.tsx`, `ContactDetailView.tsx`.

## Verificación end-to-end (manual — no hay tests automatizados en el repo)

1. `npx convex dev --once` sin errores.
2. `npx tsc --noEmit`, `npm run lint`, `npm run build` limpios.
3. Login `carlos@test.local`. Abrir un contacto en "Lead nuevo". Tap "Cambiar estado" (**toque 1**) → se abre la hoja con 5 opciones (todas menos "Lead nuevo").
4. Tap "En conversación" (**toque 2**) → la hoja se cierra sola; el badge de cabecera pasa a "En conversación" sin F5.
5. Historial muestra una entrada nueva arriba: "Cambio de estado · \<fecha/hora\> · Carlos" / "Estado cambiado: Lead nuevo → En conversación".
6. `/contactos` y `/pendientes` (si el contacto tiene un seguimiento vencido/hoy) reflejan el nuevo estado.
7. Cambiar a "Comprado": "Cerrar venta" desaparece (`isClosed`), pero "Cambiar estado" sigue disponible y sin bloqueo (AC: "no hay flujos bloqueantes").
8. Reabrir "Cambiar estado" con el contacto ya "Comprado": el botón "Comprado" no aparece en la lista (excluido por ser el actual); los otros 5 sí.
9. **(Añadido en la auditoría de plan v1→v2)** Desde ese mismo contacto "Comprado", usar "Cambiar estado" para volver a un estado no cerrado (p. ej. "Negociando") → confirmar que se guarda sin bloqueo (AC: "cualquier estado a cualquier otro") y que el botón "Cerrar venta" **reaparece** (`isClosed` vuelve a `false`).
10. Login `marta@test.local`: el botón "Cambiar estado" no aparece en la ficha.
11. Caso de borde: invocar `changeContactStatus` directamente con el mismo estado → `{success:false, error:"El contacto ya está en ese estado"}`, sin fila nueva en `statusChanges`, sin `patch`.
12. Caso de borde: `contactId` inexistente/mal formado → `{success:false, error:"Contacto no encontrado", field:"contactId"}`.
13. Revisar en el dashboard de Convex (o `npx convex data statusChanges`) que las filas tienen `contactId/fromStatus/toStatus/changedBy/changedAt` correctos.
14. Viewport estrecho (320-390px): los botones de estado en la hoja no desbordan.

## Archivos afectados

| Archivo | Tipo |
|---|---|
| `convex/schema.ts` | Editar |
| `convex/contacts.ts` | Editar |
| `src/lib/contacts/status.ts` | Nuevo |
| `src/lib/contacts/actions.ts` | Editar |
| `src/app/(app)/contactos/[id]/ChangeStatusForm.tsx` | Nuevo |
| `src/lib/notes/history.ts` | Editar |
| `src/app/(app)/contactos/[id]/page.tsx` | Editar |
| `src/app/(app)/contactos/[id]/ContactDetailView.tsx` | Editar |
| `PLANS/README.md` | Editar (fila MIS-14) |

## Puntos abiertos (no bloqueantes)

- `"inactive"` sigue sin ninguna vía de entrada tras este ticket — ni por UI ni por `changeContactStatus`. Exactamente igual que hoy desde MIS-9; ningún ticket lo necesita todavía.
- Con MIS-14 instalado, Carlos puede marcar `won`/`lost` directamente desde "Cambiar estado", sin pasar por "Cerrar venta" (sin capturar importe/producto/motivo de pérdida). Es intencional según el AC ("de cualquier estado a cualquier otro", sin bloqueos), pero cuando se construya MIS-15 habrá dos caminos hacia `won`/`lost` — el genérico de MIS-14 y el enriquecido de MIS-15. No es un bug, pero MIS-15 no debe asumir que esos estados solo se alcanzan a través de su propio flujo.
- Naming "Comprado"/"Descartado" (texto del ticket) vs. "Ganado"/"Perdido" (`StatusBadge.jsx`, en producción desde MIS-9 en 3 sitios): se decide no tocar `StatusBadge.jsx` en este ticket. Recomendado confirmar con quien redactó el ticket si el texto de Linear era solo descriptivo o pedía un rename real.
- Sin paginación en `listStatusChanges` — mismo criterio ya aceptado para `notes`/`reminders`/`listContacts` (volumen pequeño esperado en un CRM personal).

## Estado

**Auditoría de plan:** NO-GO en v1 (un major: cast de tipos incompatible con `strict: true` en `changeStatusAction`) → corregido en v2, verificado con `tsc --noEmit --strict` en aislado.

**Auditoría de código:** GO condicionado sobre el diff real. Sin blockers ni majors. Sugerencia baja no bloqueante: `PLANS/README.md` también añadió las filas de MIS-15/MIS-16 (completitud del índice, decisión deliberada, no parte del código de MIS-14).

**Instalado** en la rama `feature/mis-14-gestion-estados-contacto`, con las condiciones de la auditoría de código resueltas con evidencia real:

1. **`npx convex dev --once`**: `✔ Added table indexes: statusChanges.by_contact` + `✔ Convex functions ready!`, sin errores. Confirmado que `contacts:changeContactStatus` y `contacts:listStatusChanges` quedan registradas y callables (`npx convex run contacts:listStatusChanges` con token inválido devuelve el `ConvexError("No autenticado")` del propio handler, no "function not found").
2. **`npx tsc --noEmit`**: limpio — confirma en el árbol real que el cast corregido (`statusRaw as (typeof SELECTABLE_STATUSES)[number]`) compila con `strict: true`, resolviendo el major de la auditoría de plan v1.
3. **`npm run lint`**: 0 errores (1 warning preexistente en `Avatar.jsx`, no introducido por este ticket, ya visto en MIS-13).
4. **`npm run build`**: compilación de producción correcta.
5. **Verificación end-to-end real con Playwright** contra el servidor de desarrollo, con un contacto nuevo (`MIS-14 E2E Contact`) y un recordatorio de hoy programado sobre él. **21/21 comprobaciones OK**, 0 errores de consola:
   - Ficha en "Lead nuevo" → "Cambiar estado" (toque 1) → hoja con 5 opciones, excluyendo el estado actual → "En conversación" (toque 2) → hoja se cierra sola, badge de cabecera actualizado sin F5.
   - Historial: "Estado cambiado: Lead nuevo → En conversación" con fecha y autor "Carlos".
   - `/contactos` y `/pendientes` reflejan el nuevo estado en sus filas.
   - Cambiar a "Ganado" (label real de `StatusBadge.jsx` — no "Comprado", ver punto abierto de naming): "Cerrar venta" desaparece; "Cambiar estado" sigue disponible; reabrir el picker no muestra "Ganado" en la lista (excluido por ser el actual).
   - **Transición won → estado no cerrado** (paso añadido por la auditoría de plan v1→v2): cambiar de "Ganado" a "Negociando" confirma que se guarda sin bloqueo y que "Cerrar venta" **reaparece** (`isClosed` vuelve a `false`).
   - Viewport móvil 360px: la hoja con 5 botones + Cancelar no desborda horizontalmente.
   - Login como Marta: el botón "Cambiar estado" no aparece en la ficha (gating de rol confirmado en el cliente, además del `requireRole` del servidor).

Capturas: `01-hoja-cambiar-estado.png`, `02-tras-cambiar-estado.png`, `03-reaparece-cerrar-venta.png`, `04-hoja-mobile-360.png`, `05-marta-sin-boton.png`.

Nota: el contacto de prueba (`MIS-14 E2E Contact`) queda en el deployment de desarrollo — no existe `deleteContact`, mismo criterio ya aceptado para datos de prueba de tickets anteriores.

**Pendiente:** PR a `main` (sin mergear todavía, pendiente de autorización explícita) y, tras el merge, `npx convex deploy` a producción — obligatorio porque este ticket toca `convex/schema.ts`/`convex/contacts.ts`.

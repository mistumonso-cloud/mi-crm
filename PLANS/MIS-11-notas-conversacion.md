# MIS-11 — Notas de conversación en la ficha del contacto (v4)

## Respuesta a la auditoría de plan v3 → v4

Veredicto recibido: **NO-GO** — bloqueante nuevo introducido al pasar a fecha absoluta (v2→v3).

| # | Auditoría | Resolución |
|---|---|---|
| Bloqueante | `occurredAt` solo se validaba como `Number.isFinite(...) && > 0`. Un valor finito pero fuera del rango válido de `Date` (ej. `1e20`) pasa esa validación, se persiste en Convex, y luego `formatDateTime()` ejecuta `Intl.DateTimeFormat(...).format(new Date(ms))` sobre un `Date` inválido → `RangeError: Invalid time value`. Una nota maliciosa o corrupta rompería la ficha del contacto para todo el que la abra. | Adoptado. Se añade `isValidEpochMs()` (finito, entero seguro, positivo, y que `new Date(value).getTime()` no sea `NaN`) en **ambas capas**: `src/lib/notes/actions.ts` (Server Action, error controlado) y `convex/notes.ts` (la mutation es un endpoint público y puede invocarse directamente con un token válido, sin pasar por la Server Action). |
| Aprobado | `Object.prototype.hasOwnProperty.call` para `type`, `occurredAtMs` calculado en cliente, codegen de Convex explícito, `formatDateTime` con `timeZone: "Europe/Madrid"` | Aprobado sin cambios. |

## Contexto

MIS-10 (instalado) dejó en `ContactDetailView.tsx` un botón "Añadir nota" que abre el `BottomSheet` genérico con el contenido placeholder "Disponible próximamente" — el propio componente documenta que MIS-11 debe sustituir ese contenido por el formulario real, sin tocar el shell del `BottomSheet`. El historial de la ficha hoy es sintético: solo "Contacto añadido" + `contact.initialNote` (la nota libre del alta rápida de MIS-8), ambos con el mismo timestamp (`contact._creationTime`), porque no existe ninguna tabla de notas real todavía.

**Dos decisiones de alcance confirmadas antes de escribir este plan:**
1. **Ambos roles** (rep y supervisor) pueden añadir notas — a diferencia de crear contactos (MIS-8), que es solo `rep`. La mutation usa `requireUser`, no `requireRole`.
2. **No se migra** `initialNote` a la tabla nueva. Se deja tal cual funciona hoy (entrada sintética del historial); la tabla `notes` solo guarda notas creadas a partir de ahora.

**Decisión técnica clave — cómo "aparece inmediatamente en el historial":** este repo no tiene ningún precedente de refrescar datos de un Server Component tras una mutation en la misma página. Se leyó la documentación real de esta versión de Next.js empaquetada en `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/refresh.md` y `.../02-guides/server-actions.md`. Next 16 sustituye `router.refresh()` de cliente por `refresh()` de `next/cache`, invocable **solo dentro de una Server Action**: re-renderiza `/contactos/[id]` en el servidor dentro de la misma respuesta HTTP de la propia Server Action. `notes` sigue siendo una prop plana recalculada por el servidor; `ContactDetailView` no necesita `useState` para la lista de notas.

**Validación de `occurredAt` en dos capas (v3→v4):** la Server Action valida `formData` porque es un endpoint público (cualquiera puede hacer POST con datos manipulados); la mutation de Convex valida los mismos argumentos porque también es invocable directamente con un token válido, sin pasar por la Server Action — ninguna de las dos capas puede asumir que la otra ya limpió los datos.

## `convex/schema.ts` — nueva tabla `notes`

```ts
notes: defineTable({
  contactId: v.id("contacts"),
  authorId: v.id("users"),
  type: v.union(
    v.literal("whatsapp"),
    v.literal("call"),
    v.literal("email"),
    v.literal("dm"),
    v.literal("meeting"),
  ),
  occurredAt: v.number(), // epoch ms — momento del contacto en sí (editable, default "ahora" en el cliente)
  text: v.string(),
}).index("by_contact", ["contactId", "occurredAt"]),
```

Se actualiza el comentario de `contacts.initialNote` para reflejar que no se migra.

## Paso de generación de código Convex (obligatorio, antes de tocar cualquier archivo que use `api.notes.*`)

1. Escribir `convex/schema.ts` y `convex/notes.ts` primero.
2. Ejecutar `npx convex dev --once` para regenerar `convex/_generated/*`.
3. Solo entonces tocar `src/lib/notes/actions.ts`, `page.tsx`, `ContactDetailView.tsx`, `AddNoteForm.tsx`.

Afecta (regenerados, no editar a mano): `convex/_generated/api.d.ts`, `api.js`, `dataModel.d.ts`, `server.d.ts`, `server.js`.

## `convex/notes.ts` (NUEVO)

**Corrección de la auditoría de plan v3→v4 (bloqueante):** `occurredAt` pasa de `Number.isFinite(...) && > 0` a `isValidEpochMs()`, que además exige entero seguro y que `Date` pueda representarlo:

```ts
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUser } from "./lib/authz";

const noteTypeValidator = v.union(
  v.literal("whatsapp"),
  v.literal("call"),
  v.literal("email"),
  v.literal("dm"),
  v.literal("meeting"),
);

const TEXT_MAX = 2000;

// La mutation es un endpoint público invocable directamente con un token
// válido, sin pasar por la Server Action — no puede asumir que occurredAt ya
// viene limpio. Un valor finito y positivo pero fuera del rango de Date (ej.
// 1e20) rompería formatDateTime() en el cliente con un RangeError (hallazgo
// bloqueante de la auditoría de plan v3→v4).
function isValidEpochMs(value: number): boolean {
  return (
    Number.isFinite(value) &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    !Number.isNaN(new Date(value).getTime())
  );
}

export const addNote = mutation({
  args: {
    token: v.string(),
    contactId: v.string(),
    type: noteTypeValidator,
    occurredAt: v.number(),
    text: v.string(),
  },
  returns: v.union(
    v.object({ success: v.literal(true), id: v.id("notes") }),
    v.object({
      success: v.literal(false),
      error: v.string(),
      field: v.optional(v.union(v.literal("contactId"), v.literal("occurredAt"), v.literal("text"))),
    }),
  ),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token); // ambos roles

    const contactId = ctx.db.normalizeId("contacts", args.contactId);
    if (!contactId) return { success: false as const, error: "Contacto no encontrado", field: "contactId" as const };
    const contact = await ctx.db.get(contactId);
    if (!contact) return { success: false as const, error: "Contacto no encontrado", field: "contactId" as const };

    if (!isValidEpochMs(args.occurredAt)) {
      return { success: false as const, error: "Fecha/hora inválida", field: "occurredAt" as const };
    }

    const text = args.text.trim();
    if (!text) return { success: false as const, error: "El resumen no puede estar vacío", field: "text" as const };
    if (text.length > TEXT_MAX) {
      return { success: false as const, error: `El resumen no puede superar ${TEXT_MAX} caracteres`, field: "text" as const };
    }

    const id = await ctx.db.insert("notes", { contactId, authorId: user.id, type: args.type, occurredAt: args.occurredAt, text });
    return { success: true as const, id };
  },
});

export const listNotes = query({
  args: { token: v.string(), contactId: v.string() },
  returns: v.array(
    v.object({ _id: v.id("notes"), type: noteTypeValidator, occurredAt: v.number(), text: v.string(), authorName: v.string() }),
  ),
  handler: async (ctx, args) => {
    await requireUser(ctx, args.token);
    const contactId = ctx.db.normalizeId("contacts", args.contactId);
    if (!contactId) return [];

    const notes = await ctx.db
      .query("notes")
      .withIndex("by_contact", (q) => q.eq("contactId", contactId))
      .order("desc")
      .collect();

    return Promise.all(
      notes.map(async (n) => {
        const author = await ctx.db.get(n.authorId);
        return { _id: n._id, type: n.type, occurredAt: n.occurredAt, text: n.text, authorName: author?.name ?? "—" };
      }),
    );
  },
});
```

## `src/lib/notes/types.ts` (NUEVO)

```ts
export const NOTE_TYPES = {
  whatsapp: { label: "WhatsApp" },
  call: { label: "Llamada" },
  email: { label: "Email" },
  dm: { label: "DM Instagram" },
  meeting: { label: "Reunión" },
} as const;

export type NoteType = keyof typeof NOTE_TYPES;

export const NOTE_TYPE_OPTIONS: Array<{ value: NoteType; label: string }> = (
  Object.keys(NOTE_TYPES) as NoteType[]
).map((value) => ({ value, label: NOTE_TYPES[value].label }));
```

## `src/lib/notes/history.ts` (NUEVO) — mezcla y orden cronológico

```ts
import type { NoteType } from "./types";

export type HistoryEntry =
  | { key: string; kind: "created"; timestamp: number }
  | { key: string; kind: "initialNote"; timestamp: number; text: string }
  | { key: string; kind: "note"; timestamp: number; type: NoteType; text: string; authorName: string };

export function buildHistory(
  contact: { initialNote?: string; _creationTime: number },
  notes: Array<{ _id: string; type: NoteType; occurredAt: number; text: string; authorName: string }>,
): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  if (contact.initialNote) {
    entries.push({ key: "initial-note", kind: "initialNote", timestamp: contact._creationTime, text: contact.initialNote });
  }
  entries.push({ key: "created", kind: "created", timestamp: contact._creationTime });
  for (const n of notes) {
    entries.push({ key: n._id, kind: "note", timestamp: n.occurredAt, type: n.type, text: n.text, authorName: n.authorName });
  }
  return entries.sort((a, b) => b.timestamp - a.timestamp);
}
```

## `src/lib/contacts/format.ts` (EDITAR) — `formatDateTime` (NUEVO export)

```ts
// Fecha/hora absoluta para notas reales de MIS-11 (formatRelativeTime sigue
// usándose sin cambios para "Contacto añadido"/initialNote). timeZone fijo a
// "Europe/Madrid" a propósito: ContactDetailView se renderiza tanto en el
// servidor (HTML inicial) como en el cliente (hidratación); sin timeZone
// explícito, Intl.DateTimeFormat usaría la zona ambiente de cada entorno y
// produciría un mismatch de hidratación. Asunción documentada: CRM de un
// solo país (Carlos/Marta operan desde España).
export function formatDateTime(ms: number): string {
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Madrid",
  }).format(new Date(ms));
}
```

## `src/lib/notes/actions.ts` (NUEVO) — Server Action

**Corrección de la auditoría de plan v3→v4 (bloqueante):** misma `isValidEpochMs()` que en la mutation, duplicada a propósito (mismo idiom que `NOTE_TYPES`: sin fuente de verdad compartida entre `convex/` y `src/`, ya aceptado en el repo — Convex no importa código fuera de su propia carpeta):

```ts
"use server";

import { ConvexError } from "convex/values";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { fetchMutation } from "convex/nextjs";
import { api } from "../../../convex/_generated/api";
import { readSessionToken } from "@/lib/auth/cookie";
import { NOTE_TYPES, type NoteType } from "@/lib/notes/types";

export type AddNoteState =
  | { success: true }
  | { error: string; field?: "type" | "occurredAt" | "text" }
  | undefined;

// Duplicada de convex/notes.ts a propósito — ver comentario ahí. Un POST
// manipulado con occurredAtMs=1e20 (finito, positivo, pero fuera del rango
// de Date) rompería formatDateTime() en el cliente con un RangeError si
// llegara a persistirse (hallazgo bloqueante de la auditoría de plan v3→v4).
function isValidEpochMs(value: number): boolean {
  return (
    Number.isFinite(value) &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    !Number.isNaN(new Date(value).getTime())
  );
}

export async function addNoteAction(_prevState: AddNoteState, formData: FormData): Promise<AddNoteState> {
  const token = await readSessionToken();
  if (!token) redirect("/login");

  const contactId = String(formData.get("contactId") ?? "");

  const typeRaw = String(formData.get("type") ?? "");
  if (!Object.prototype.hasOwnProperty.call(NOTE_TYPES, typeRaw)) {
    return { error: "Tipo de nota inválido", field: "type" };
  }
  const type = typeRaw as NoteType;

  const occurredAtRaw = formData.get("occurredAtMs");
  const occurredAt = typeof occurredAtRaw === "string" ? Number(occurredAtRaw) : NaN;
  if (!isValidEpochMs(occurredAt)) return { error: "Fecha/hora inválida", field: "occurredAt" };

  const text = String(formData.get("text") ?? "");

  let result;
  try {
    result = await fetchMutation(api.notes.addNote, { token, contactId, type, occurredAt, text });
  } catch (err) {
    if (err instanceof ConvexError) redirect("/login");
    throw err;
  }

  if (!result.success) {
    return { error: result.error, field: result.field === "text" || result.field === "occurredAt" ? result.field : undefined };
  }

  refresh();
  return { success: true };
}
```

## `src/components/ui/forms/Select.d.ts` (EDITAR)

```ts
export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  label?: React.ReactNode;
  options: Array<SelectOption | string>;
  size?: 'sm' | 'md';
  containerStyle?: React.CSSProperties;
}
```

## `src/app/(app)/contactos/[id]/page.tsx` (EDITAR)

```tsx
const [contact, notes] = await Promise.all([
  fetchQuery(api.contacts.getContact, { token: token!, id }),
  fetchQuery(api.notes.listNotes, { token: token!, contactId: id }),
]);
if (!contact) { /* sin cambios */ }
const now = await getRequestTime();
// ...
<ContactDetailView contact={contact} now={now} notes={notes} />
```

## `src/app/(app)/contactos/[id]/ContactDetailView.tsx` (EDITAR)

- Nueva prop `notes`. `sheet` sigue siendo el único estado de cliente.
- Historial vía `buildHistory(contact, notes).map(...)`. Entradas `kind === "note"` muestran `{tipo} · ${formatDateTime(entry.timestamp)} · {autor}` (fecha/hora absoluta); entradas `created`/`initialNote` siguen usando `formatRelativeTime(entry.timestamp, now)` sin cambios.
- Hoja `sheet === "note"` → `<AddNoteForm contactId={contact._id} onDone={() => setSheet(null)} />`.

## `src/app/(app)/contactos/[id]/AddNoteForm.tsx` (NUEVO, `"use client"`)

```tsx
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
  const [occurredAtLocal, setOccurredAtLocal] = useState(nowForDatetimeLocal);

  useEffect(() => {
    if (state?.success) onDone();
  }, [state, onDone]);

  const occurredAtMs = occurredAtLocal ? new Date(occurredAtLocal).getTime() : NaN;

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <input type="hidden" name="contactId" value={contactId} />
      <input type="hidden" name="occurredAtMs" value={Number.isFinite(occurredAtMs) ? occurredAtMs : ""} />
      <Select label="Tipo de contacto" name="type" options={NOTE_TYPE_OPTIONS} defaultValue={NOTE_TYPE_OPTIONS[0].value} disabled={isPending} />
      {state && "field" in state && state.field === "type" && (
        <span style={{ fontSize: 12, color: "var(--color-danger-fg)" }}>{state.error}</span>
      )}
      <Input
        label="Fecha y hora" type="datetime-local" value={occurredAtLocal}
        onChange={(e) => setOccurredAtLocal(e.target.value)} required disabled={isPending}
        error={state && "field" in state && state.field === "occurredAt" ? state.error : null}
      />
      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>Resumen</span>
        <textarea name="text" required rows={4} maxLength={2000} disabled={isPending} style={{ /* estilo copiado literal de NewContactForm.tsx */ }} />
        {state && "field" in state && state.field === "text" && (
          <span style={{ fontSize: 12, color: "var(--color-danger-fg)" }}>{state.error}</span>
        )}
      </label>
      {state && "error" in state && !state.field && (
        <div role="alert" style={{ fontSize: 13, color: "var(--color-danger-fg)" }}>{state.error}</div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <Button type="button" variant="secondary" full onClick={onDone}>Cancelar</Button>
        <Button type="submit" full disabled={isPending}>{isPending ? "Guardando…" : "Guardar"}</Button>
      </div>
    </form>
  );
}
```

## Puntos abiertos (no bloqueantes)

- `useEffect` + `onDone()` tras éxito: verificar empíricamente con `npm run lint` que no dispara `react-hooks/set-state-in-effect`.
- `occurredAt` no rechaza fechas futuras (el ticket no lo exige) — sí rechaza ahora fechas fuera del rango representable por `Date`.
- Campo `text` (no `summary`) — trivial de renombrar si se prefiere.
- Verificar que `refresh()` conserva el estado `sheet` de `ContactDetailView` — primer punto a comprobar al instalar.

## Verificación end-to-end

1. Login `carlos@test.local` (rep), "Añadir nota": tipo, fecha/hora ("ahora" precargado), resumen.
2. Guardar una nota de cada tipo en <30s — se cierra la hoja sola, aparece arriba del historial con fecha/hora absoluta, tipo y autor.
3. Verificación de zona horaria: introducir una fecha/hora concreta, guardar, confirmar que la fecha/hora absoluta mostrada coincide exactamente con la introducida.
4. Verificación de hidratación: recargar `/contactos/<id>` con notas ya existentes, sin warnings en consola.
5. **Verificación del bloqueante v3→v4**: invocar `addNote` con `occurredAt: 1e20` (vía consola/script, no desde la UI) → debe devolver `{success:false, error:"Fecha/hora inválida", field:"occurredAt"}`, no persistir nada ni lanzar excepción. Repetir contra la Server Action con `occurredAtMs=1e20` manipulado en el `FormData`.
6. Orden cronológico correcto con fechas retroactivas.
7. "Resumen" vacío → error inline, no se guarda.
8. `type` manipulado a un valor inválido → error controlado.
9. Cancelar / backdrop / Escape sin regresión.
10. `marta@test.local` (supervisor) también puede añadir notas.
11. F5 tras guardar: la nota persiste.
12. Historial mezcla correctamente "Contacto añadido" + `initialNote` + notas reales.
13. `grep -rn "useMutation\|useQuery" src/app/(app)/contactos/` sin resultados.
14. `npx convex dev --once` ejecutado, `api.d.ts` expone `notes`, antes de `tsc`.
15. `tsc --noEmit`, `npm run lint`, `npm run build` limpios.

## Archivos afectados

```
convex/schema.ts                                      EDITAR   — + tabla notes, + índice by_contact, actualiza comentario de initialNote
convex/notes.ts                                       NUEVO    — addNote (mutation, valida occurredAt con isValidEpochMs), listNotes (query)
convex/_generated/*                                   GENERADO — vía `npx convex dev --once`; no editar a mano
src/lib/notes/types.ts                                NUEVO    — NOTE_TYPES / NoteType / NOTE_TYPE_OPTIONS
src/lib/notes/history.ts                              NUEVO    — buildHistory(): mezcla + orden cronológico desc
src/lib/notes/actions.ts                              NUEVO    — addNoteAction (valida type y occurredAt en la misma Server Action, refresh() en éxito)
src/lib/contacts/format.ts                            EDITAR   — + formatDateTime() (zona horaria fija Europe/Madrid)
src/components/ui/forms/Select.d.ts                   EDITAR   — extends SelectHTMLAttributes (solo tipos)
src/app/(app)/contactos/[id]/page.tsx                 EDITAR   — Promise.all(getContact, listNotes), pasa notes
src/app/(app)/contactos/[id]/ContactDetailView.tsx    EDITAR   — prop notes, historial vía buildHistory(), notas reales con fecha/hora absoluta, hoja "note" real
src/app/(app)/contactos/[id]/AddNoteForm.tsx          NUEVO    — formulario cliente (fecha/hora controlada)
```

## Estado

**Instalado** — ver PR de la rama `feature/mis-11-notas-conversacion`. Auditoría de plan: NO-GO en v1 (zona horaria + codegen de Convex), NO-GO en v2 (validación de `type` con `in` incompleta), NO-GO en v3 (`occurredAt` sin validar rango), **GO en v4**. Auditoría de código: **GO** sin bloqueantes ni mayores.

Antes de instalar se verificó `tsc --noEmit`/`npm run lint`/`npm run build` sobre el código generado en `CODIGO/MIS-11-notas-conversacion/` copiado temporalmente a rutas reales — se encontró y corrigió un error de tipos propio (`AddNoteState` no estaba realmente discriminado, ver `NOTES.md` del código ya eliminado tras instalar). Tras instalar de verdad y ejecutar `npx convex dev --once`, verificación end-to-end con Playwright contra `carlos@test.local` (rep) y `marta@test.local` (supervisor): **23/23 comprobaciones OK**, incluyendo los casos explícitos de la auditoría — `occurredAt` manipulado a `1e20` y `type` manipulado a `"constructor"` devuelven error controlado sin romper la página, fecha/hora absoluta mostrada coincide exactamente con la introducida, orden cronológico correcto con una nota retroactiva, sin warnings de hydration mismatch al recargar, y ambos roles pueden añadir notas. `tsc --noEmit`, `npm run lint` y `npm run build` limpios sobre el árbol ya instalado.

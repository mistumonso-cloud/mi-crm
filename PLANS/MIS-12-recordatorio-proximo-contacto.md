# MIS-12 — Recordatorio de próximo contacto (v2)

## Respuesta a la auditoría de plan v1 → v2

Veredicto recibido: **GO CONDICIONADO** — sin bloqueantes ni majors.

| # | Auditoría | Resolución |
|---|---|---|
| Condición de instalación | Ejecutar `npx convex dev --once` tras `schema.ts`/`reminders.ts`; verificar que `api.d.ts` expone `api.reminders.*`; `tsc --noEmit`, `npm run lint`, `npm run build` limpios; validar manualmente los flujos 1-17, especialmente el badge tras completar y el corte horario. | Ya cubierto — es el "Paso de generación de código Convex" más los pasos finales de "Verificación end-to-end". Se confirma aquí como condición no opcional antes de instalar. |
| Media | `startOfMadridDay()` solo se ha verificado en Node local (donde `shortOffset` devuelve `GMT+2`), no contra el runtime de Convex ya desplegado. Si ese runtime no expone ICU completo, el fallback a CET podría desplazar mal el corte "vencido/hoy" en horario de verano. | Adoptado. Se eleva de "Punto abierto" a un paso obligatorio de "Verificación end-to-end" (nuevo paso 21) — bloquea el `GO` de instalación si el offset real difiere del esperado. |
| Media | Falta comprobar empíricamente que el badge del `BottomNav` se actualiza tras `refresh()` invocado desde `/pendientes` (layout compartido `(with-nav)`), no solo tras una recarga completa (F5). | Adoptado. Paso 5 de "Verificación end-to-end" ampliado con esta comprobación explícita y el fallback ya documentado (`export const dynamic = "force-dynamic"` en `(with-nav)/layout.tsx`) si se detecta obsoleto. |
| Baja | El comando de verificación 18 (`grep -rn ... src/app/(app)/contactos/ ...`) falla en `bash` porque los paréntesis de la ruta no van entre comillas. | Adoptado. Rutas entre comillas dobles en el paso 18. |

No se reabre ninguna decisión de alcance ya aprobada (modelo de datos, roles, `/pendientes` mínimo, mecanismo de badge, zona horaria) — el diff v1→v2 son solo precisiones de verificación.

## Contexto

MIS-11 (instalado) dejó en `ContactDetailView.tsx` un botón "Programar seguimiento" que abre el `BottomSheet` genérico con el contenido placeholder "Disponible próximamente" (líneas 97-114 del archivo instalado), con un comentario explícito dejado por el equipo de MIS-11 anticipando que MIS-12 sustituiría ese placeholder por una Card "programado" (fecha/motivo, fondo `var(--color-warning-bg)`, botón "Reprogramar"). Este plan implementa exactamente eso, más la pantalla `/pendientes` (hoy un placeholder puro sin datos) y un aviso in-app en la barra inferior.

El ticket es ambiguo en varios puntos de producto. Se fijan aquí las siguientes decisiones, explícitas y no discutibles sin pasar de nuevo por este documento:

**1. Modelo de datos — tabla `reminders` dedicada, con política de "un pendiente por contacto".** El AC exige que "el seguimiento hecho quede en el historial", es decir, hace falta conservar filas pasadas (no solo el próximo pendiente) — esto descarta campos sueltos en `contacts` (que solo podrían guardar el último estado, perdiendo el histórico) y apunta a una tabla tipo historial, igual que `notes`. La Card de la ficha es singular ("Próximo seguimiento"), así que se adopta la política: **como mucho un recordatorio `status:"pending"` por contacto a la vez**. `scheduleReminder` (mutation) actúa como **upsert**: si no hay ninguno pendiente para ese contacto, inserta uno nuevo; si ya hay uno, actualiza esa misma fila (fecha/motivo) en vez de crear un duplicado. Esto resuelve de forma natural el botón "Reprogramar" que ya insinuaba el comentario de MIS-11, sin necesitar una mutation ni un flujo de UI separados, y sin generar entrada de historial al reprogramar (solo lo *completado* entra al historial, por AC explícito). Los recordatorios completados (`status:"done"`) nunca se borran ni se sobrescriben.

**2. `/pendientes` — versión mínima real en este ticket, no placeholder.** La pantalla completa de "Pendientes del día" es MIS-13 (aún no planificado). Pero el AC de MIS-12 exige literalmente que el recordatorio "aparezca en pendientes al llegar la fecha" y que se pueda "marcar como hecho... desde pendientes" — no se puede cumplir sin tocar `/pendientes`. Se implementa aquí una versión mínima funcional: lista de recordatorios vencidos/de hoy (`listDueToday`), con nombre de contacto, fecha, motivo, etiqueta "Vencido"/"Hoy" y botón "Marcar hecho". Sin filtros, sin otros tipos de pendientes (pipeline, tareas, etc.), sin orden configurable — eso es explícitamente MIS-13 (ver "Puntos abiertos").

**3. Notificación in-app — badge contador en la tab "Pendientes" del `BottomNav`.** No existe ningún mecanismo de toast/snackbar/push en el repo (`grep` sin resultados fuera de `Badge`/`StatusBadge`). Se añade un contador (`countDueToday`) mostrado como `Badge` (componente ya existente) superpuesto al icono de la pestaña "Pendientes", visible en las tres pantallas con nav (Pendientes/Contactos/Panel) en cada navegación. Se usa `tone="danger"` para el badge numérico (convención de contador de notificación tipo OS/apps — rojo para máxima visibilidad, independientemente de si el ítem subyacente es "grave"), distinto del `tone`/fondo `var(--color-warning-bg)` usado en la Card de la ficha para resaltar que *ese contacto en concreto* tiene un seguimiento pendiente (semántica distinta: contador global vs. estado de un registro). Esto satisface "notificar in-app" del MVP sin construir infraestructura de push (explícitamente fuera de alcance del ticket).

**4. Rol — `requireUser` (ambos roles), igual que `notes`.** El ticket describe el flujo desde el punto de vista de Carlos, pero no exige exclusividad de rol; Marta (supervisor) ya tiene visibilidad total de Pendientes/Panel desde MIS-18 y ya puede añadir notas (MIS-11) sin restricción de rol. No hay ninguna razón de negocio documentada para bloquear a Marta de programar o completar un seguimiento sobre un contacto que está viendo. Se decide `requireUser` para las 4 operaciones (crear/reprogramar, listar por contacto, completar, listar/contar pendientes de hoy).

**5. Zona horaria — medianoche local del navegador (asumida Europe/Madrid), con corte servidor calculado sin librerías.** El selector es solo fecha, sin hora. En el cliente, `dueAt` se calcula igual que `occurredAt` en MIS-11: `new Date(year, month-1, day, 0,0,0,0).getTime()` en el navegador (constructor **local**, nunca `new Date("YYYY-MM-DD")`, que el spec ECMA-262 interpreta como **UTC** para formas fecha-only — un desfase de zona horaria real para cualquier usuario al oeste de Greenwich). Se asume que el navegador de Carlos/Marta opera en horario de España, mismo supuesto ya documentado en `formatDateTime`. En el servidor (Convex, cuya zona horaria de proceso no está garantizada), el corte "vencido/hoy" se calcula con un helper `startOfMadridDay()` en `convex/reminders.ts` que deriva el offset horario vigente en Madrid vía `Intl.DateTimeFormat({ timeZoneName: "shortOffset" })` (gestiona el cambio de horario de verano automáticamente a través de la base de datos ICU del runtime), evitando así depender de la zona horaria del proceso del backend.

No se toca `convex/contacts.ts:138-139` (el comentario sobre `lastContactAt` pendiente de MIS-11) — fuera de alcance de este ticket, no se añade ningún campo de "último contacto" a `contacts`.

## `convex/schema.ts` — nueva tabla `reminders`

Se añade inmediatamente después de la tabla `notes`:

```ts
reminders: defineTable({
  contactId: v.id("contacts"),
  // Quién programó/reprogramó el recordatorio la última vez — igual que
  // authorId en notes, pero aquí se sobreescribe en cada "Reprogramar" (ver
  // convex/reminders.ts::scheduleReminder: upsert de un único recordatorio
  // pendiente por contacto, política decidida en el plan de MIS-12).
  createdBy: v.id("users"),
  // epoch ms — medianoche del día elegido, en la zona horaria LOCAL del
  // navegador (asumida Europe/Madrid, mismo supuesto que formatDateTime en
  // src/lib/contacts/format.ts). Selector de fecha sin hora: la hora
  // siempre es 00:00:00.000 del día civil elegido.
  dueAt: v.number(),
  // "Motivo o qué hay que hacer" (AC del ticket) — texto corto, máx.
  // REASON_MAX (ver convex/reminders.ts).
  reason: v.string(),
  // Un recordatorio pendiente por contacto como máximo (política de
  // MIS-12) — "pending" hasta que se marca hecho, nunca se borra tras eso.
  status: v.union(v.literal("pending"), v.literal("done")),
  // Presentes solo cuando status === "done": instante REAL en que se marcó
  // hecho (Date.now() del servidor en el momento de la mutation, no
  // editable por el cliente — a diferencia de dueAt, que sí es una fecha
  // elegida por el usuario) y quién lo hizo. Alimentan el historial de la
  // ficha (AC: "el seguimiento hecho queda en el historial").
  completedAt: v.optional(v.number()),
  completedBy: v.optional(v.id("users")),
})
  // Ficha del contacto: recuperar el pendiente actual + los completados
  // para el historial, todos los de un contacto en una sola query.
  .index("by_contact", ["contactId", "dueAt"])
  // Pantalla de Pendientes + badge del BottomNav: todos los "pending" con
  // dueAt <= hoy, en cualquier contacto, sin escanear la tabla entera.
  .index("by_status_dueAt", ["status", "dueAt"]),
```

## Paso de generación de código Convex (obligatorio, antes de tocar cualquier archivo que use `api.reminders.*`)

1. Escribir `convex/schema.ts` y `convex/reminders.ts` primero.
2. Ejecutar `npx convex dev --once` para regenerar `convex/_generated/*`.
3. Solo entonces tocar `src/lib/reminders/actions.ts`, `src/lib/notes/history.ts`, `src/components/crm/*`, `(with-nav)/layout.tsx`, `pendientes/page.tsx`, `contactos/[id]/page.tsx`, `ContactDetailView.tsx`, `ScheduleReminderForm.tsx`.

Afecta (regenerados, no editar a mano): `convex/_generated/api.d.ts`, `api.js`, `dataModel.d.ts`, `server.d.ts`, `server.js`.

## `convex/reminders.ts` (NUEVO)

```ts
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUser } from "./lib/authz";

const REASON_MAX = 200; // "texto corto" (AC del ticket) — más corto que TEXT_MAX (2000) de notes.ts

const MADRID_TZ = "Europe/Madrid";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Duplicada de convex/notes.ts a propósito — mismo motivo que allí: esta
// mutation es un endpoint público invocable directamente con un token
// válido, sin pasar por la Server Action. No hay un módulo compartido entre
// archivos de convex/ para este tipo de validación (contacts.ts tampoco
// importa TEXT_MAX de notes.ts) — cada archivo de Convex es autocontenido,
// convención ya aceptada en el repo.
function isValidEpochMs(value: number): boolean {
  return (
    Number.isFinite(value) &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    !Number.isNaN(new Date(value).getTime())
  );
}

// Epoch ms de las 00:00:00.000 en Europe/Madrid del día civil que contiene
// `ms` en esa zona horaria. Sin librerías de fechas (igual que
// formatDateTime en src/lib/contacts/format.ts): se lee vía
// Intl.DateTimeFormat con timeZoneName:"shortOffset" el offset UTC vigente
// en Madrid en ese instante (gestiona el cambio de horario de verano
// automáticamente, a través de la base de datos ICU embebida en el
// runtime), y se aplica sobre la medianoche UTC del mismo día civil. Los
// ~2 días al año de cambio de horario podrían desplazar el corte
// "hoy/vencido" en como mucho 1 hora — no bloqueante para este MVP (ver
// Puntos abiertos del plan).
function startOfMadridDay(ms: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MADRID_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    timeZoneName: "shortOffset",
  }).formatToParts(new Date(ms));

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));
  // "shortOffset" produce "GMT+1" o "GMT+2" (Madrid es siempre una hora
  // entera de offset, nunca fracciones) — offsetHours es lo que hay que
  // restar a la medianoche UTC del mismo día civil para obtener el
  // instante real de medianoche en Madrid.
  const offsetMatch = get("timeZoneName").match(/GMT([+-]\d+)/);
  const offsetHours = offsetMatch ? Number(offsetMatch[1]) : 1; // fallback CET si el runtime no expone shortOffset

  return Date.UTC(year, month - 1, day, 0, 0, 0, 0) - offsetHours * 60 * 60 * 1000;
}

export const scheduleReminder = mutation({
  args: {
    token: v.string(),
    contactId: v.string(), // v.string(), no v.id("contacts"): mismo motivo que getContact.args.id
    dueAt: v.number(),
    reason: v.string(),
  },
  returns: v.union(
    v.object({ success: v.literal(true), id: v.id("reminders") }),
    v.object({
      success: v.literal(false),
      error: v.string(),
      field: v.optional(v.union(v.literal("contactId"), v.literal("dueAt"), v.literal("reason"))),
    }),
  ),
  handler: async (ctx, args) => {
    // Ambos roles pueden programar/reprogramar seguimientos (decisión
    // confirmada en el plan de MIS-12, punto 4) — igual que notes.addNote.
    const user = await requireUser(ctx, args.token);

    const contactId = ctx.db.normalizeId("contacts", args.contactId);
    if (!contactId) {
      return { success: false as const, error: "Contacto no encontrado", field: "contactId" as const };
    }
    const contact = await ctx.db.get(contactId);
    if (!contact) {
      return { success: false as const, error: "Contacto no encontrado", field: "contactId" as const };
    }

    if (!isValidEpochMs(args.dueAt)) {
      return { success: false as const, error: "Fecha inválida", field: "dueAt" as const };
    }

    const reason = args.reason.trim();
    if (!reason) {
      return { success: false as const, error: "El motivo no puede estar vacío", field: "reason" as const };
    }
    if (reason.length > REASON_MAX) {
      return {
        success: false as const,
        error: `El motivo no puede superar ${REASON_MAX} caracteres`,
        field: "reason" as const,
      };
    }

    // Política de MIS-12: un único recordatorio "pending" por contacto. Si
    // ya existe uno, "Programar seguimiento" actúa como "Reprogramar":
    // actualiza la misma fila (dueAt/reason/createdBy) en vez de insertar
    // un duplicado. No genera entrada de historial — solo lo completado
    // entra al historial (AC explícito); reprogramar antes de completarlo
    // no es un evento a registrar en este MVP.
    const existing = await ctx.db
      .query("reminders")
      .withIndex("by_contact", (q) => q.eq("contactId", contactId))
      .collect();
    const currentPending = existing.find((r) => r.status === "pending");

    if (currentPending) {
      await ctx.db.patch(currentPending._id, { dueAt: args.dueAt, reason, createdBy: user.id });
      return { success: true as const, id: currentPending._id };
    }

    const id = await ctx.db.insert("reminders", {
      contactId,
      createdBy: user.id,
      dueAt: args.dueAt,
      reason,
      status: "pending" as const,
    });
    return { success: true as const, id };
  },
});

export const listRemindersForContact = query({
  args: { token: v.string(), contactId: v.string() },
  returns: v.object({
    current: v.union(v.null(), v.object({ _id: v.id("reminders"), dueAt: v.number(), reason: v.string() })),
    completed: v.array(
      v.object({
        _id: v.id("reminders"),
        dueAt: v.number(),
        reason: v.string(),
        completedAt: v.number(),
        completedByName: v.string(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    await requireUser(ctx, args.token); // lectura: ambos roles, igual que notes.listNotes
    const contactId = ctx.db.normalizeId("contacts", args.contactId);
    if (!contactId) return { current: null, completed: [] }; // ID inválido: page.tsx ya maneja "no encontrado" vía getContact

    const reminders = await ctx.db
      .query("reminders")
      .withIndex("by_contact", (q) => q.eq("contactId", contactId))
      .collect();

    // Invariante esperada: como mucho un "pending" por contacto (ver
    // scheduleReminder). Defensivo ante manipulación directa de datos: si
    // hubiera más de uno, se toma el de dueAt más próximo como "el" actual
    // — no bloqueante para el MVP.
    const pending = reminders.filter((r) => r.status === "pending").sort((a, b) => a.dueAt - b.dueAt);
    const current = pending[0]
      ? { _id: pending[0]._id, dueAt: pending[0].dueAt, reason: pending[0].reason }
      : null;

    const doneRows = reminders.filter((r) => r.status === "done");
    const completed = await Promise.all(
      doneRows.map(async (r) => {
        const completer = r.completedBy ? await ctx.db.get(r.completedBy) : null;
        return {
          _id: r._id,
          dueAt: r.dueAt,
          reason: r.reason,
          completedAt: r.completedAt ?? r.dueAt, // defensivo: completedAt siempre debería existir si status="done"
          completedByName: completer?.name ?? "—",
        };
      }),
    );

    return { current, completed };
  },
});

export const completeReminder = mutation({
  args: { token: v.string(), id: v.string() },
  returns: v.union(
    v.object({ success: v.literal(true) }),
    v.object({ success: v.literal(false), error: v.string() }),
  ),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token); // ambos roles, igual que scheduleReminder

    const id = ctx.db.normalizeId("reminders", args.id);
    if (!id) return { success: false as const, error: "Recordatorio no encontrado" };
    const reminder = await ctx.db.get(id);
    if (!reminder) return { success: false as const, error: "Recordatorio no encontrado" };
    if (reminder.status === "done") {
      return { success: false as const, error: "Este seguimiento ya estaba marcado como hecho" };
    }

    await ctx.db.patch(id, { status: "done" as const, completedAt: Date.now(), completedBy: user.id });
    return { success: true as const };
  },
});

// Recordatorios vencidos o de hoy, de TODOS los contactos — vista
// compartida entre Carlos y Marta, sin filtrar por quién los creó (mismo
// criterio que la ADR de MIS-18: ambos ven las mismas pantallas de
// Pendientes/Panel). Sin paginación a propósito, mismo criterio que
// listContacts en convex/contacts.ts: volumen esperado pequeño en un CRM
// personal.
export const listDueToday = query({
  args: { token: v.string() },
  returns: v.array(
    v.object({
      _id: v.id("reminders"),
      contactId: v.id("contacts"),
      contactName: v.string(),
      dueAt: v.number(),
      reason: v.string(),
      overdue: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireUser(ctx, args.token);

    const now = Date.now();
    const todayStart = startOfMadridDay(now);
    const tomorrowStart = todayStart + ONE_DAY_MS;

    const rows = await ctx.db
      .query("reminders")
      .withIndex("by_status_dueAt", (q) => q.eq("status", "pending").lt("dueAt", tomorrowStart))
      .order("asc") // más vencidos primero
      .collect();

    return Promise.all(
      rows.map(async (r) => {
        const contact = await ctx.db.get(r.contactId);
        return {
          _id: r._id,
          contactId: r.contactId,
          contactName: contact?.name ?? "—", // defensivo: contacto borrado, caso no esperado hoy (no hay deleteContact)
          dueAt: r.dueAt,
          reason: r.reason,
          overdue: r.dueAt < todayStart,
        };
      }),
    );
  },
});

// Solo el número, para el badge del BottomNav — evita cargar/join-ear datos
// de contacto en cada navegación cuando lo único que hace falta es el
// contador (ver (with-nav)/layout.tsx).
export const countDueToday = query({
  args: { token: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    await requireUser(ctx, args.token);
    const tomorrowStart = startOfMadridDay(Date.now()) + ONE_DAY_MS;
    const rows = await ctx.db
      .query("reminders")
      .withIndex("by_status_dueAt", (q) => q.eq("status", "pending").lt("dueAt", tomorrowStart))
      .collect();
    return rows.length;
  },
});
```

## `src/lib/contacts/format.ts` (EDITAR) — `formatDate` (NUEVO export)

Archivo completo tras el cambio (se añade `formatDate` al final, `formatRelativeTime`/`formatDateTime` sin cambios):

```ts
// Fecha relativa en español para la lista de contactos (MIS-9). `now` es
// inyectable (por defecto Date.now()) para que page.tsx pueda capturarlo una
// sola vez y pasarlo a todas las filas — evita que servidor y cliente
// calculen "ahora" en instantes distintos y produzcan un mismatch de
// hidratación cerca de un umbral (ej. "hace 59 minutos" vs "hace 1 hora").
export function formatRelativeTime(ms: number, now: number = Date.now()): string {
  const diffMs = Math.max(0, now - ms);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  const month = 30 * day;

  if (diffMs < minute) return "ahora mismo";
  if (diffMs < hour) {
    const m = Math.floor(diffMs / minute);
    return `hace ${m} minuto${m === 1 ? "" : "s"}`;
  }
  if (diffMs < day) {
    const h = Math.floor(diffMs / hour);
    return `hace ${h} hora${h === 1 ? "" : "s"}`;
  }
  if (diffMs < 2 * day) return "ayer";
  if (diffMs < week) {
    const d = Math.floor(diffMs / day);
    return `hace ${d} días`;
  }
  if (diffMs < month) {
    const w = Math.floor(diffMs / week);
    return `hace ${w} semana${w === 1 ? "" : "s"}`;
  }
  const mo = Math.floor(diffMs / month);
  return `hace ${mo} mes${mo === 1 ? "" : "es"}`;
}

// Fecha/hora absoluta para notas reales de MIS-11 (formatRelativeTime sigue
// usándose sin cambios para "Contacto añadido"/initialNote). timeZone fijo a
// "Europe/Madrid" a propósito: ContactDetailView se renderiza tanto en el
// servidor (HTML inicial) como en el cliente (hidratación); sin timeZone
// explícito, Intl.DateTimeFormat usaría la zona ambiente de cada entorno y
// produciría un mismatch de hidratación. Con una zona fija, ambos entornos
// producen siempre el mismo string. Asunción documentada: CRM de un solo
// país (Carlos/Marta operan desde España).
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

// Fecha (sin hora) para recordatorios de seguimiento de MIS-12 — dueAt
// siempre representa medianoche de un día civil (selector de fecha sin
// hora), así que mostrar hora/minuto no aporta nada y podría sugerir
// falsamente una precisión horaria que no existe. Misma timeZone fija que
// formatDateTime, mismo motivo (evitar mismatch de hidratación).
export function formatDate(ms: number): string {
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Madrid",
  }).format(new Date(ms));
}
```

## `src/lib/notes/history.ts` (EDITAR) — `+ kind "reminderDone"`

```ts
import type { NoteType } from "./types";

export type HistoryEntry =
  | { key: string; kind: "created"; timestamp: number }
  | { key: string; kind: "initialNote"; timestamp: number; text: string }
  | { key: string; kind: "note"; timestamp: number; type: NoteType; text: string; authorName: string }
  | { key: string; kind: "reminderDone"; timestamp: number; reason: string; completedByName: string };

export function buildHistory(
  contact: { initialNote?: string; _creationTime: number },
  notes: Array<{ _id: string; type: NoteType; occurredAt: number; text: string; authorName: string }>,
  completedReminders: Array<{ _id: string; completedAt: number; reason: string; completedByName: string }> = [],
): HistoryEntry[] {
  const entries: HistoryEntry[] = [];

  // Orden de inserción deliberado: initialNote ANTES que "created". Ambas
  // comparten el mismo timestamp (contact._creationTime, sin cambios
  // respecto a hoy) — Array.prototype.sort es estable desde ES2019, así que
  // un empate exacto conserva este orden relativo tras ordenar desc.
  if (contact.initialNote) {
    entries.push({
      key: "initial-note",
      kind: "initialNote",
      timestamp: contact._creationTime,
      text: contact.initialNote,
    });
  }
  entries.push({ key: "created", kind: "created", timestamp: contact._creationTime });

  for (const n of notes) {
    entries.push({
      key: n._id,
      kind: "note",
      timestamp: n.occurredAt,
      type: n.type,
      text: n.text,
      authorName: n.authorName,
    });
  }

  // MIS-12: los seguimientos ya completados también forman parte del
  // historial (AC explícito: "el seguimiento hecho queda en el historial").
  // timestamp = completedAt (el instante REAL de la acción de completar),
  // no dueAt (la fecha que se había programado) — mismo criterio que
  // occurredAt en notes: el momento del evento real, no el de creación del
  // registro ni el de la fecha originalmente programada.
  for (const r of completedReminders) {
    entries.push({
      key: r._id,
      kind: "reminderDone",
      timestamp: r.completedAt,
      reason: r.reason,
      completedByName: r.completedByName,
    });
  }

  return entries.sort((a, b) => b.timestamp - a.timestamp);
}
```

## `src/lib/reminders/actions.ts` (NUEVO) — Server Actions

```ts
"use server";

import { ConvexError } from "convex/values";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { fetchMutation } from "convex/nextjs";
import { api } from "../../../convex/_generated/api";
import { readSessionToken } from "@/lib/auth/cookie";

export type ScheduleReminderState =
  | { success: true }
  | { success: false; error: string; field?: "contactId" | "dueAt" | "reason" }
  | undefined;

export type CompleteReminderState = { success: true } | { success: false; error: string } | undefined;

// Duplicada de convex/reminders.ts a propósito — mismo motivo que
// isValidEpochMs en src/lib/notes/actions.ts: la mutation es un endpoint
// público invocable directamente con un token válido, sin pasar por esta
// Server Action.
function isValidEpochMs(value: number): boolean {
  return (
    Number.isFinite(value) &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    !Number.isNaN(new Date(value).getTime())
  );
}

export async function scheduleReminderAction(
  _prevState: ScheduleReminderState,
  formData: FormData,
): Promise<ScheduleReminderState> {
  const token = await readSessionToken();
  if (!token) redirect("/login");

  const contactId = String(formData.get("contactId") ?? "");

  // dueDateMs llega ya calculado en el navegador (ver
  // ScheduleReminderForm.tsx) — esta Server Action NUNCA reparsea el string
  // "YYYY-MM-DD" del input type="date": new Date("YYYY-MM-DD") lo
  // interpretaría como medianoche UTC (formas fecha-only del spec
  // ECMA-262), no la medianoche local del usuario. Mismo motivo que
  // occurredAtMs en src/lib/notes/actions.ts.
  const dueDateRaw = formData.get("dueDateMs");
  const dueAt = typeof dueDateRaw === "string" ? Number(dueDateRaw) : NaN;
  if (!isValidEpochMs(dueAt)) return { success: false, error: "Fecha inválida", field: "dueAt" };

  const reason = String(formData.get("reason") ?? "");

  let result;
  try {
    result = await fetchMutation(api.reminders.scheduleReminder, { token, contactId, dueAt, reason });
  } catch (err) {
    // requireUser solo puede lanzar ConvexError("No autenticado") aquí —
    // no hay requireRole, así que no existe la rama "No autorizado".
    if (err instanceof ConvexError) redirect("/login");
    throw err;
  }

  if (!result.success) {
    return {
      success: false,
      error: result.error,
      field: result.field === "dueAt" || result.field === "reason" ? result.field : undefined,
    };
  }

  refresh(); // Next 16: re-renderiza la ruta actual (ficha o /pendientes) en la MISMA respuesta
  return { success: true };
}

export async function completeReminderAction(
  _prevState: CompleteReminderState,
  formData: FormData,
): Promise<CompleteReminderState> {
  const token = await readSessionToken();
  if (!token) redirect("/login");

  const id = String(formData.get("reminderId") ?? "");

  let result;
  try {
    result = await fetchMutation(api.reminders.completeReminder, { token, id });
  } catch (err) {
    if (err instanceof ConvexError) redirect("/login");
    throw err;
  }

  if (!result.success) return { success: false, error: result.error };

  refresh();
  return { success: true };
}
```

## `src/components/crm/CompleteReminderButton.tsx` (NUEVO)

```tsx
"use client";

import { useActionState } from "react";
import type { CSSProperties } from "react";
import { Button } from "@/components/ui/core/Button";
import { completeReminderAction, type CompleteReminderState } from "@/lib/reminders/actions";

const initialState: CompleteReminderState = undefined;

// Botón "Marcar hecho" reutilizado tal cual en la ficha del contacto
// (ContactDetailView.tsx) y en la lista de Pendientes (pendientes/page.tsx)
// — misma Server Action, mismo componente, sin duplicar formulario ni
// manejo de estado en dos sitios (AC: "marcar como hecho desde ficha o
// pendientes").
export function CompleteReminderButton({
  reminderId,
  style,
}: {
  reminderId: string;
  style?: CSSProperties;
}) {
  const [state, formAction, isPending] = useActionState(completeReminderAction, initialState);

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 4, ...style }}>
      <input type="hidden" name="reminderId" value={reminderId} />
      <Button type="submit" variant="primary" size="sm" full disabled={isPending}>
        {isPending ? "Guardando…" : "Marcar hecho"}
      </Button>
      {state && !state.success && (
        <span role="alert" style={{ fontSize: 12, color: "var(--color-danger-fg)" }}>
          {state.error}
        </span>
      )}
    </form>
  );
}
```

## `src/components/crm/BottomNav.tsx` (EDITAR)

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge } from "@/components/ui/feedback/Badge";

const TABS = [
  { href: "/pendientes", label: "Pendientes", Icon: ClockIcon },
  { href: "/contactos", label: "Contactos", Icon: ContactsIcon },
  { href: "/panel", label: "Panel", Icon: PanelIcon },
];

// dueTodayCount (MIS-12): recordatorios de seguimiento vencidos o de hoy,
// vía convex/reminders.ts::countDueToday, resuelto por
// (with-nav)/layout.tsx — la "notificación in-app de pendientes de hoy"
// que exige el AC del ticket. No existe ningún otro mecanismo de
// toast/push en el repo (ver PLANS/MIS-12-recordatorio-proximo-contacto.md,
// Contexto, decisión 3): un badge persistente y visible en cada
// navegación cumple el requisito del MVP sin infraestructura de push.
export function BottomNav({ dueTodayCount = 0 }: { dueTodayCount?: number }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navegación principal"
      style={{
        position: "fixed",
        insetInline: 0,
        bottom: 0,
        height: "calc(72px + env(safe-area-inset-bottom))",
        boxSizing: "border-box",
        paddingLeft: 4,
        paddingRight: 4,
        paddingTop: 0,
        paddingBottom: "env(safe-area-inset-bottom)",
        background: "var(--color-surface)",
        borderTop: "1px solid var(--color-border)",
        display: "flex",
        alignItems: "stretch",
        zIndex: 10,
      }}
    >
      {TABS.map(({ href, label, Icon }) => {
        const active = pathname === href;
        const showBadge = href === "/pendientes" && dueTodayCount > 0;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              textDecoration: "none",
            }}
          >
            <span
              style={{
                position: "relative",
                width: 40,
                height: 30,
                borderRadius: "var(--radius-full)",
                background: active ? "var(--color-accent-tint)" : "transparent",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "background-color .18s ease-out",
              }}
            >
              <Icon stroke={active ? "var(--color-accent)" : "var(--text-tertiary)"} />
              {showBadge && (
                <Badge
                  tone="danger"
                  aria-label={`${dueTodayCount} seguimiento${dueTodayCount === 1 ? "" : "s"} pendiente${dueTodayCount === 1 ? "" : "s"} para hoy`}
                  style={{
                    position: "absolute",
                    top: -2,
                    right: -2,
                    minWidth: 16,
                    height: 16,
                    padding: "0 4px",
                    fontSize: 10,
                    justifyContent: "center",
                  }}
                >
                  {dueTodayCount > 9 ? "9+" : dueTodayCount}
                </Badge>
              )}
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: active ? 600 : 500,
                color: active ? "var(--color-accent)" : "var(--text-tertiary)",
              }}
            >
              {label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

function ClockIcon({ stroke }: { stroke: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function ContactsIcon({ stroke }: { stroke: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function PanelIcon({ stroke }: { stroke: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}
```

## `src/app/(app)/(with-nav)/layout.tsx` (EDITAR)

```tsx
import type { ReactNode } from "react";
import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../convex/_generated/api";
import { AddContactFab } from "@/components/crm/AddContactFab";
import { BottomNav } from "@/components/crm/BottomNav";
import { getUser } from "@/lib/auth/dal";
import { readSessionToken } from "@/lib/auth/cookie";

// Envuelve Pendientes/Contactos/Panel con la barra inferior + FAB. MIS-12
// añade aquí la lectura de countDueToday para alimentar el badge de
// "Pendientes" del BottomNav — se hace en el layout (no en cada page) para
// que el badge esté visible y actualizado en las 3 pestañas, no solo en
// /pendientes. Fuera de este route group (contactos/nuevo, contactos/[id])
// no se hereda nada de esto — exclusión estructural por carpeta.
export default async function WithNavLayout({ children }: { children: ReactNode }) {
  await getUser(); // redirige a /login si no hay sesión; cache() de React, barato de repetir aquí (ver (app)/layout.tsx)
  const token = await readSessionToken(); // getUser() ya garantiza sesión válida aquí
  const dueTodayCount = await fetchQuery(api.reminders.countDueToday, { token: token! });

  return (
    <>
      <div
        className="flex flex-1 flex-col"
        style={{ paddingBottom: "calc(72px + env(safe-area-inset-bottom))" }}
      >
        {children}
      </div>
      <AddContactFab />
      <BottomNav dueTodayCount={dueTodayCount} />
    </>
  );
}
```

## `src/app/(app)/(with-nav)/pendientes/page.tsx` (EDITAR) — implementación mínima real

```tsx
import Link from "next/link";
import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../../convex/_generated/api";
import { getUser } from "@/lib/auth/dal";
import { readSessionToken } from "@/lib/auth/cookie";
import { Card } from "@/components/ui/core/Card";
import { Badge } from "@/components/ui/feedback/Badge";
import { formatDate } from "@/lib/contacts/format";
import { CompleteReminderButton } from "@/components/crm/CompleteReminderButton";

// Implementación MÍNIMA para cumplir el AC de MIS-12 ("aparece en
// pendientes al llegar la fecha", "marcar como hecho... desde pendientes"):
// solo lista los recordatorios de seguimiento vencidos o de hoy
// (convex/reminders.ts::listDueToday), con su acción "marcar hecho". MIS-13
// (Pantalla: Pendientes del día) sustituirá esto por el home completo de
// Carlos: otros tipos de pendientes, filtros, orden configurable, diseño
// final.
export default async function PendientesPage() {
  const user = await getUser();
  const token = await readSessionToken(); // getUser() ya garantiza sesión válida aquí

  const reminders = await fetchQuery(api.reminders.listDueToday, { token: token! });

  return (
    <div className="flex flex-1 flex-col" style={{ padding: "16px 20px 24px", gap: 16 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <Badge tone="accent" style={{ alignSelf: "flex-start" }}>
          Operativo
        </Badge>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)" }}>Hola, {user.name}</h1>
        <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>Seguimientos vencidos o de hoy.</p>
      </div>

      {reminders.length === 0 ? (
        <p style={{ fontSize: 14, color: "var(--text-secondary)", textAlign: "center", padding: "32px 0" }}>
          No hay seguimientos pendientes para hoy.
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {reminders.map((r) => (
            <li key={r._id}>
              <Card padding="md" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
                <div style={{ flex: "1 1 200px", minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <Link
                      href={`/contactos/${r.contactId}`}
                      style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", textDecoration: "none" }}
                    >
                      {r.contactName}
                    </Link>
                    <Badge tone={r.overdue ? "danger" : "warning"}>{r.overdue ? "Vencido" : "Hoy"}</Badge>
                  </div>
                  <p style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{formatDate(r.dueAt)}</p>
                  <p style={{ fontSize: 14, color: "var(--text-secondary)" }}>{r.reason}</p>
                </div>
                <CompleteReminderButton reminderId={r._id} style={{ flex: "0 0 auto" }} />
              </Card>
            </li>
          ))}
        </ul>
      )}

      <p style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
        Solo se muestran los seguimientos programados desde la ficha del contacto (MIS-12). MIS-13 ampliará
        esta pantalla con el resto de pendientes del día, filtros y el diseño final del home de Carlos.
      </p>
    </div>
  );
}
```

## `src/app/(app)/contactos/[id]/page.tsx` (EDITAR)

```tsx
import Link from "next/link";
import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../../convex/_generated/api";
import { getUser } from "@/lib/auth/dal";
import { readSessionToken } from "@/lib/auth/cookie";
import { getRequestTime } from "@/lib/request-time";
import { ContactDetailView } from "./ContactDetailView";

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await getUser();
  const { id } = await params;
  const token = await readSessionToken(); // getUser() ya garantiza sesión válida aquí

  const [contact, notes, reminders] = await Promise.all([
    fetchQuery(api.contacts.getContact, { token: token!, id }),
    fetchQuery(api.notes.listNotes, { token: token!, contactId: id }),
    fetchQuery(api.reminders.listRemindersForContact, { token: token!, contactId: id }),
  ]);

  if (!contact) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-16 text-center">
        <p style={{ color: "var(--text-secondary)" }}>Contacto no encontrado.</p>
        <Link href="/contactos" style={{ color: "var(--color-accent)", fontWeight: 600 }}>
          ‹ Volver a Contactos
        </Link>
      </div>
    );
  }

  const now = await getRequestTime();

  return (
    <div className="flex flex-1 flex-col">
      <div style={{ padding: "16px 20px 0" }}>
        <Link
          href="/contactos"
          style={{ fontSize: 14, fontWeight: 600, color: "var(--color-accent)", textDecoration: "none" }}
        >
          ‹ Contactos
        </Link>
      </div>
      <ContactDetailView contact={contact} now={now} notes={notes} reminders={reminders} />
    </div>
  );
}
```

## `src/app/(app)/contactos/[id]/ContactDetailView.tsx` (EDITAR)

```tsx
"use client";

import { useState } from "react";
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../../../convex/_generated/api";
import { Card } from "@/components/ui/core/Card";
import { Button } from "@/components/ui/core/Button";
import { Avatar } from "@/components/ui/core/Avatar";
import { StatusBadge } from "@/components/ui/feedback/StatusBadge";
import { BottomSheet } from "@/components/ui/overlays/BottomSheet";
import { formatRelativeTime, formatDateTime, formatDate } from "@/lib/contacts/format";
import { buildHistory } from "@/lib/notes/history";
import { NOTE_TYPES } from "@/lib/notes/types";
import { AddNoteForm } from "./AddNoteForm";
import { ScheduleReminderForm } from "./ScheduleReminderForm";
import { CompleteReminderButton } from "@/components/crm/CompleteReminderButton";

type Contact = NonNullable<FunctionReturnType<typeof api.contacts.getContact>>;
type Notes = FunctionReturnType<typeof api.notes.listNotes>;
type Reminders = FunctionReturnType<typeof api.reminders.listRemindersForContact>;
type SheetKind = "note" | "status" | "schedule" | "close" | null;

const SHEET_TITLES: Record<"note" | "status" | "close", string> = {
  note: "Nueva nota",
  status: "Cambiar estado",
  close: "Cerrar venta",
};

// "schedule" tiene título dinámico (Programar vs. Reprogramar) según si ya
// existe un recordatorio pendiente — el resto usa el mapa estático de arriba.
function sheetTitleFor(sheet: SheetKind, hasCurrentReminder: boolean): string | undefined {
  if (sheet === null) return undefined;
  if (sheet === "schedule") return hasCurrentReminder ? "Reprogramar seguimiento" : "Programar seguimiento";
  return SHEET_TITLES[sheet];
}

function PhoneIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-10 6L2 7" />
    </svg>
  );
}

export function ContactDetailView({
  contact,
  now,
  notes,
  reminders,
}: {
  contact: Contact;
  now: number;
  notes: Notes;
  reminders: Reminders;
}) {
  const [sheet, setSheet] = useState<SheetKind>(null);
  const isClosed = contact.status === "won" || contact.status === "lost";
  const history = buildHistory(contact, notes, reminders.completed);

  return (
    <div className="flex flex-1 flex-col" style={{ padding: "16px 20px 24px", gap: 16 }}>
      <Card padding="md" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Avatar name={contact.name} size="lg" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>{contact.name}</h1>
            <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
              Responsable: {contact.responsibleName}
            </span>
          </div>
          <StatusBadge state={contact.status} />
        </div>

        {contact.phone && (
          <a
            href={`tel:${contact.phone}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 14,
              color: "var(--text-secondary)",
              textDecoration: "none",
            }}
          >
            <PhoneIcon />
            {contact.phone}
          </a>
        )}
        {contact.email && (
          <a
            href={`mailto:${contact.email}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 14,
              color: "var(--text-secondary)",
              textDecoration: "none",
            }}
          >
            <MailIcon />
            {contact.email}
          </a>
        )}
      </Card>

      {/* MIS-12: Card real de "Próximo seguimiento". Se sigue ocultando por
          completo cuando el contacto está cerrado (won/lost) y NO hay
          ningún recordatorio pendiente ya existente — igual que hacía el
          placeholder de MIS-11. Pero si SÍ hay uno pendiente, se sigue
          mostrando aunque el contacto se cierre después (para no perder de
          vista un seguimiento ya programado ni impedir completarlo); en ese
          caso se oculta solo "Reprogramar" (no tiene sentido programar un
          seguimiento nuevo sobre un contacto cerrado), pero "Marcar hecho"
          sigue disponible. */}
      {reminders.current && (
        <Card
          padding="md"
          style={{ background: "var(--color-warning-bg)", display: "flex", flexDirection: "column", gap: 10 }}
        >
          <div>
            <p style={{ fontSize: 12, fontWeight: 700, color: "var(--color-warning-fg)", marginBottom: 2 }}>
              Próximo seguimiento · {formatDate(reminders.current.dueAt)}
            </p>
            <p style={{ fontSize: 14, color: "var(--text-primary)" }}>{reminders.current.reason}</p>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {!isClosed && (
              <Button variant="secondary" size="sm" style={{ flex: "1 1 130px" }} onClick={() => setSheet("schedule")}>
                Reprogramar
              </Button>
            )}
            <CompleteReminderButton reminderId={reminders.current._id} style={{ flex: "1 1 130px" }} />
          </div>
        </Card>
      )}
      {!reminders.current && !isClosed && (
        <Card
          padding="md"
          style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}
        >
          <p style={{ fontSize: 13, color: "var(--text-secondary)", flex: "1 1 160px" }}>
            Sin seguimiento programado
          </p>
          <Button variant="secondary" size="sm" onClick={() => setSheet("schedule")}>
            Programar seguimiento
          </Button>
        </Card>
      )}

      {/* flexWrap + flex-basis (no solo flex:1): en viewports estrechos
          (320-390px) 3 botones de ancho igual con texto sin salto de línea
          (Button fuerza whiteSpace: nowrap) desbordaban o se comprimían
          ilegibles — hallazgo mayor de la auditoría de código v1 (MIS-10).
          Con flex-basis de 130px, 2 caben por fila y el tercero baja a una
          segunda fila y se estira a todo el ancho, sin overflow horizontal
          en ningún tamaño. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <Button variant="secondary" size="sm" style={{ flex: "1 1 130px" }} onClick={() => setSheet("note")}>
          Añadir nota
        </Button>
        <Button variant="secondary" size="sm" style={{ flex: "1 1 130px" }} onClick={() => setSheet("status")}>
          Cambiar estado
        </Button>
        {!isClosed && (
          <Button variant="primary" size="sm" style={{ flex: "1 1 130px" }} onClick={() => setSheet("close")}>
            Cerrar venta
          </Button>
        )}
      </div>

      <div>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>
          Historial
        </h2>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {history.map((entry) => (
            <li key={entry.key}>
              <Card padding="sm">
                <p style={{ fontSize: 12, color: "var(--text-tertiary)", marginBottom: 4 }}>
                  {entry.kind === "note"
                    ? `${NOTE_TYPES[entry.type].label} · ${formatDateTime(entry.timestamp)} · ${entry.authorName}`
                    : entry.kind === "reminderDone"
                    ? `Seguimiento · ${formatDateTime(entry.timestamp)} · ${entry.completedByName}`
                    : formatRelativeTime(entry.timestamp, now)}
                </p>
                <p style={{ fontSize: 14, color: "var(--text-primary)" }}>
                  {entry.kind === "created"
                    ? "Contacto añadido"
                    : entry.kind === "reminderDone"
                    ? `Seguimiento completado: ${entry.reason}`
                    : entry.text}
                </p>
              </Card>
            </li>
          ))}
        </ul>
        {!contact.initialNote && notes.length === 0 && reminders.completed.length === 0 && (
          <p style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 8 }}>
            Aún no hay más actividad registrada.
          </p>
        )}
      </div>

      <BottomSheet
        open={sheet !== null}
        onClose={() => setSheet(null)}
        title={sheetTitleFor(sheet, reminders.current !== null)}
      >
        {sheet === "note" ? (
          <AddNoteForm contactId={contact._id} onDone={() => setSheet(null)} />
        ) : sheet === "schedule" ? (
          <ScheduleReminderForm
            contactId={contact._id}
            initialDueAt={reminders.current?.dueAt}
            initialReason={reminders.current?.reason}
            onDone={() => setSheet(null)}
          />
        ) : (
          <>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 16 }}>
              Disponible próximamente.
            </p>
            <Button variant="secondary" full onClick={() => setSheet(null)}>
              Cancelar
            </Button>
          </>
        )}
      </BottomSheet>
    </div>
  );
}
```

## `src/app/(app)/contactos/[id]/ScheduleReminderForm.tsx` (NUEVO, `"use client"`)

```tsx
"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/core/Button";
import { Input } from "@/components/ui/forms/Input";
import { scheduleReminderAction, type ScheduleReminderState } from "@/lib/reminders/actions";

const initialState: ScheduleReminderState = undefined;

// "YYYY-MM-DD" en la zona LOCAL del navegador (getFullYear/getMonth/getDate,
// nunca los getUTC*) — mismo cuidado que nowForDatetimeLocal() en
// AddNoteForm.tsx, para reconstruir exactamente el mismo día civil con el
// que se creó/editó el valor.
function msToDateLocal(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// input type="date" produce "YYYY-MM-DD". new Date("YYYY-MM-DD") lo
// interpretaría como MEDIANOCHE UTC (el spec ECMA-262 trata las formas
// fecha-only como UTC, a diferencia de datetime-local) — un desfase de
// zona horaria real para cualquier usuario al oeste de Greenwich.
// Troceamos el string y usamos el constructor new Date(y, m, d) (LOCAL),
// igual que el propio input lo interpreta visualmente. Se calcula en el
// NAVEGADOR: la Server Action nunca reparsea el string.
function dateLocalToMs(dateLocal: string): number {
  const [y, m, d] = dateLocal.split("-").map(Number);
  if (!y || !m || !d) return NaN;
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

export function ScheduleReminderForm({
  contactId,
  initialDueAt,
  initialReason,
  onDone,
}: {
  contactId: string;
  initialDueAt?: number;
  initialReason?: string;
  onDone: () => void;
}) {
  const [state, formAction, isPending] = useActionState(scheduleReminderAction, initialState);
  // Inicializador perezoso: se evalúa una sola vez al montar. Este
  // componente solo se monta cuando se abre la hoja ("schedule") —
  // BottomSheet desmonta los children al cerrar, así que al reabrir (p.ej.
  // para reprogramar otro contacto, o el mismo tras cambiar de fecha) se
  // recalcula con las props actuales.
  const [dueDateLocal, setDueDateLocal] = useState(() => msToDateLocal(initialDueAt ?? Date.now()));

  useEffect(() => {
    if (state?.success) onDone();
  }, [state, onDone]);

  const dueDateMs = dueDateLocal ? dateLocalToMs(dueDateLocal) : NaN;

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <input type="hidden" name="contactId" value={contactId} />
      <input type="hidden" name="dueDateMs" value={Number.isFinite(dueDateMs) ? dueDateMs : ""} />
      <Input
        label="Fecha del próximo contacto"
        type="date"
        value={dueDateLocal}
        onChange={(e) => setDueDateLocal(e.target.value)}
        required
        disabled={isPending}
        error={state && "field" in state && state.field === "dueAt" ? state.error : null}
      />
      {/* Campo de texto corto, no controlado (name="reason" + defaultValue
          para el caso "Reprogramar") — mismo patrón que name/phone en
          NewContactForm.tsx: sin useState salvo que haga falta cómputo
          derivado en el cliente (que sí hace falta para la fecha, no para
          este campo). */}
      <Input
        label="Motivo o qué hay que hacer"
        name="reason"
        placeholder="Ej.: Llamar para cerrar la propuesta"
        defaultValue={initialReason}
        required
        maxLength={200} // mismo límite que REASON_MAX en convex/reminders.ts — solo hint de UI, la mutation es la autoridad real
        disabled={isPending}
        error={state && "field" in state && state.field === "reason" ? state.error : null}
      />
      {state && "error" in state && !state.field && (
        <div role="alert" style={{ fontSize: 13, color: "var(--color-danger-fg)" }}>
          {state.error}
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <Button type="button" variant="secondary" full onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" full disabled={isPending}>
          {isPending ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    </form>
  );
}
```

## `PLANS/README.md` (EDITAR)

Insertar la siguiente fila justo después de la fila `MIS-11` y antes de la fila `MIS-13`:

```
| [MIS-12](https://linear.app/mistu-monso/issue/MIS-12) | Recordatorio de próximo contacto | [MIS-12-recordatorio-proximo-contacto.md](./MIS-12-recordatorio-proximo-contacto.md) | Pendiente |
```

## Puntos abiertos (no bloqueantes)

- Verificar con `npm run lint` que los `useEffect` + `onDone()` en `ScheduleReminderForm.tsx` (y el patrón `useActionState` de `CompleteReminderButton.tsx`) no disparan `react-hooks/set-state-in-effect` — mismo punto ya verificado en MIS-11.
- `dueAt` no rechaza fechas pasadas ni futuras extremas más allá de `isValidEpochMs` — igual que `occurredAt` en MIS-11, el ticket no lo exige.
- No existe una acción "Cancelar seguimiento" (eliminar un recordatorio pendiente sin completarlo) — en este MVP solo se puede completar o reprogramar. Si el negocio lo pide, es una mutation `cancelReminder` sencilla de añadir después (no forma parte del AC de este ticket).
- `startOfMadridDay()` depende de que el runtime de Convex exponga `Intl.DateTimeFormat` con `timeZoneName:"shortOffset"` correctamente (ICU completo) — **elevado a condición de instalación por la auditoría de plan v1→v2, ver paso 21 de "Verificación end-to-end"**, no queda como mero punto abierto. Hay un fallback documentado a CET/+1 si no aparece. Los ~2 días al año de cambio de horario podrían desplazar el corte "hoy/vencido" en como mucho 1 hora — no bloqueante para un MVP de recordatorios comerciales, salvo que el paso 21 revele que el runtime real usa el fallback de forma permanente (no solo en el cambio de hora).
- Badge del `BottomNav`: verificar empíricamente si `refresh()` invalida el layout `(with-nav)` en navegaciones cliente-a-cliente entre Pendientes/Contactos/Panel, o si el contador solo se actualiza en una recarga completa/F5. Si se detecta obsoleto, la solución mínima documentada es añadir `export const dynamic = "force-dynamic"` a `(with-nav)/layout.tsx` (opción estándar de Next.js para excluir un segmento del cacheo de rutas).
- `/pendientes` en este ticket es deliberadamente mínimo: sin filtros, sin más orden que "vencidos primero", sin otros tipos de pendientes (tareas de pipeline, oportunidades, etc.) — todo eso es MIS-13.
- `listDueToday`/`countDueToday` no filtran por usuario/responsable — es una vista compartida entre Carlos y Marta, igual que el criterio de MIS-18. Si en el futuro se quisiera "mis pendientes" vs. "todos", haría falta una columna adicional (p.ej. `assignedTo`), fuera de alcance hoy.
- Campo `reason` (no `motivo`) — nombre en inglés igual que `text` en `notes`, trivial de renombrar si se prefiere.
- No hay ninguna migración de datos: la tabla `reminders` nace vacía; ningún contacto existente tendrá seguimiento programado hasta que alguien use "Programar seguimiento" por primera vez.

## Verificación end-to-end

1. Login `carlos@test.local` (rep). Abrir una ficha sin seguimiento programado → Card "Sin seguimiento programado" + botón "Programar seguimiento".
2. Programar un seguimiento con fecha de HOY y un motivo → se cierra la hoja, la ficha muestra "Próximo seguimiento · <fecha de hoy>" + motivo, fondo warning.
3. Ir a "Pendientes" → el contacto aparece en la lista con etiqueta "Hoy", motivo visible, botón "Marcar hecho".
4. Verificar que la tab "Pendientes" del `BottomNav` muestra un badge numérico (≥1) en cualquier pantalla con nav (Pendientes/Contactos/Panel).
5. Marcar como hecho desde "Pendientes" → desaparece de la lista **y el badge numérico de la tab "Pendientes" del `BottomNav` se actualiza a la cuenta correcta sin necesitar F5** (verificación añadida en la auditoría de plan v1→v2: confirmar que `refresh()` invalida también el layout compartido `(with-nav)` en esta navegación cliente-a-cliente; si el badge queda obsoleto, aplicar el fallback ya documentado: `export const dynamic = "force-dynamic"` en `(with-nav)/layout.tsx`).
6. Volver a la ficha del contacto (recarga o navegación) → la Card vuelve a "Sin seguimiento programado"; en "Historial" aparece una entrada "Seguimiento completado: <motivo>" con fecha/hora y autor.
7. Programar un seguimiento con fecha PASADA (ayer) → debe aparecer en Pendientes marcado "Vencido" (tone danger), no solo "Hoy".
8. Programar un seguimiento con fecha FUTURA (dentro de una semana) → NO debe aparecer en Pendientes ni contar en el badge; sí debe verse en la ficha del contacto.
9. Reprogramar un seguimiento pendiente (cambiar fecha/motivo desde "Reprogramar") → se actualiza la misma tarjeta, no se duplica, no aparece nada nuevo en el historial todavía.
10. Marcar como hecho directamente desde la ficha (no desde Pendientes) → mismo resultado que el paso 6, y desaparece también de Pendientes.
11. Intentar guardar con motivo vacío → error inline, no se guarda.
12. Intentar guardar sin fecha → el `required` nativo del navegador bloquea el envío.
13. Verificación de manipulación: invocar `scheduleReminder` con `dueAt: 1e20` → `{success:false, error:"Fecha inválida", field:"dueAt"}`, no persiste. Repetir con `dueDateMs` manipulado en el `FormData` de la Server Action.
14. Invocar `completeReminder` dos veces sobre el mismo id → la segunda devuelve `{success:false, error:"Este seguimiento ya estaba marcado como hecho"}`, sin duplicar la entrada de historial.
15. `marta@test.local` (supervisor): repetir pasos 1-2-3-5-6 — ambos roles pueden programar y completar, y ambos ven los mismos Pendientes (sin filtrar por quién los creó).
16. Verificación de zona horaria: programar un seguimiento para "hoy" cerca de medianoche (23:50 hora local) y confirmar que la fecha mostrada y su aparición en Pendientes coinciden con el día civil esperado en España, no con UTC.
17. F5 tras cada acción (programar/reprogramar/completar): los datos persisten.
18. `grep -rn "useMutation\|useQuery" "src/app/(app)/contactos/" "src/app/(app)/(with-nav)/pendientes/"` sin resultados (rutas entre comillas dobles — corrección de la auditoría de plan v1→v2, los paréntesis sin comillas rompen la sintaxis de `bash`; mismo patrón arquitectónico: Server Components + Server Actions, sin hooks de cliente de Convex).
19. `npx convex dev --once` ejecutado, `api.d.ts` expone `reminders`, antes de `tsc`.
20. `tsc --noEmit`, `npm run lint`, `npm run build` limpios.
21. **Verificación de zona horaria contra el runtime real (auditoría de plan v1→v2, condición de instalación)**: en el entorno de Convex ya desplegado (no en Node local), invocar `startOfMadridDay()` (o `listDueToday`/`countDueToday`, que lo usan internamente) y confirmar que `Intl.DateTimeFormat` con `timeZoneName:"shortOffset"` devuelve el offset horario correcto para la fecha actual (`GMT+1` en horario de invierno, `GMT+2` en horario de verano). Si el runtime de Convex no expone ICU completo y cae en el fallback documentado (CET/+1 fijo), confirmarlo explícitamente y evaluar si es aceptable para el MVP o si bloquea el `GO` de instalación.

## Archivos afectados

```
convex/schema.ts                                              EDITAR   — + tabla reminders, + índices by_contact / by_status_dueAt
convex/reminders.ts                                           NUEVO    — scheduleReminder (upsert), listRemindersForContact, completeReminder, listDueToday, countDueToday
convex/_generated/*                                           GENERADO — vía `npx convex dev --once`; no editar a mano
src/lib/reminders/actions.ts                                  NUEVO    — scheduleReminderAction, completeReminderAction (Server Actions)
src/lib/notes/history.ts                                      EDITAR   — + kind "reminderDone", + parámetro completedReminders
src/lib/contacts/format.ts                                    EDITAR   — + formatDate() (fecha sin hora, Europe/Madrid)
src/components/crm/CompleteReminderButton.tsx                 NUEVO    — botón "Marcar hecho" reutilizado en ficha y en Pendientes
src/components/crm/BottomNav.tsx                              EDITAR   — prop dueTodayCount, Badge de aviso in-app en la tab Pendientes
src/app/(app)/(with-nav)/layout.tsx                           EDITAR   — fetchQuery(countDueToday), pasa dueTodayCount a BottomNav
src/app/(app)/(with-nav)/pendientes/page.tsx                  EDITAR   — implementación mínima real (listDueToday + marcar hecho), sustituye el placeholder de MIS-13
src/app/(app)/contactos/[id]/page.tsx                         EDITAR   — + fetchQuery(listRemindersForContact) en el Promise.all
src/app/(app)/contactos/[id]/ContactDetailView.tsx            EDITAR   — Card real "Próximo seguimiento"/"Sin seguimiento programado", Reprogramar, Marcar hecho, historial extendido
src/app/(app)/contactos/[id]/ScheduleReminderForm.tsx         NUEVO    — formulario cliente (fecha date-only + motivo; sirve para crear y para reprogramar)
PLANS/README.md                                               EDITAR   — + fila MIS-12
```

## Estado

Auditoría de plan: **GO condicionado en v1** (sin bloqueantes ni majors; 3 sugerencias no bloqueantes adoptadas en v2, ver "Respuesta a la auditoría de plan v1 → v2"). Código generado en `CODIGO/MIS-12-recordatorio-proximo-contacto/` (con `CODIGO-COMPLETO.md`).

Auditoría de código: **GO condicionado**, sin bloqueantes ni majors. Sugerencias no bloqueantes y su resolución:

- **Media — verificar `startOfMadridDay()` contra el runtime real de Convex (paso 21)**: resuelto con evidencia real, no solo lectura. Se desplegó temporalmente una query de diagnóstico al deployment de dev (`dutiful-mole-111`) que invoca la misma función tal cual está en `convex/reminders.ts` y se ejecutó con `npx convex run` el 2026-07-20 (horario de verano en España). Resultado real del runtime: `todayTzName: "GMT+2"`, `todayStartIso: "2026-07-19T22:00:00.000Z"` (medianoche del 20/07 en Madrid) y `tomorrowStartIso: "2026-07-20T22:00:00.000Z"` (medianoche del 21/07, un día completo después, sin colisión) — el runtime de Convex expone ICU completo y `shortOffset` resuelve `GMT+2` correctamente; no cae al fallback `+1` que habría sido bloqueante. Tras la prueba se revirtió el deployment de dev a su estado original (`npx convex dev --once` con el `schema.ts`/funciones anteriores) — confirmado sin la tabla `reminders` en `api.d.ts` y sin datos escritos. Queda pendiente repetir una comprobación equivalente en invierno (GMT+1) en el primer cambio de horario tras instalar, por si acaso, pero no bloquea esta instalación.
- **Media — diff real si se añade `force-dynamic`**: no ha hecho falta añadirlo; ver nota técnica en `CODIGO/MIS-12-recordatorio-proximo-contacto/NOTES.md` sobre por qué `refresh()` ya cubre el refresco del badge (evidencia: documentación de Next 16 + `cache:"no-store"` de `fetchQuery`/`fetchMutation`). Si en la verificación manual end-to-end (paso 5) se observara lo contrario, se añadirá y se traerá como diff a una nueva ronda de auditoría, tal como pide el hallazgo.
- **Baja — `countDueToday` con `collect()`**: aceptado como deuda técnica de bajo volumen (MVP), sin acción ahora.

**Instalado** en la rama `feature/mis-12-recordatorio-proximo-contacto` (ver PR). `npx convex dev --once` ejecutado contra el deployment de dev (`dutiful-mole-111`) — `api.d.ts` expone `reminders`. `tsc --noEmit`, `npm run lint` y `npm run build` limpios sobre el árbol ya instalado.

Verificación end-to-end real con Playwright (`carlos@test.local`, contacto de prueba "Verificación MIS-9 Dev"): **12/12 comprobaciones OK**, incluyendo explícitamente el hallazgo clave de la auditoría de código — el badge de la tab "Pendientes" del `BottomNav` pasa de "1" a sin badge **inmediatamente tras "Marcar hecho", sin recargar la página**, confirmando que `refresh()` sí refresca el layout compartido tal como predecía la nota técnica de `NOTES.md`. También verificado: programar seguimiento desde la ficha, Card "Próximo seguimiento" con motivo y fecha correctos, aparición en `/pendientes` con etiqueta "Hoy", desaparición de la lista al completar, entrada "Seguimiento completado: <motivo>" en el historial, ficha vuelve a "Sin seguimiento programado", cero errores de consola durante todo el flujo. Capturas de pantalla revisadas visualmente, coinciden con las comprobaciones automatizadas.

Pendiente tras mergear el PR a `main`: `npx convex deploy` a producción (paso obligatorio y separado, ver incidente de MIS-11 en la memoria del proyecto) y marcar la tarea "Done" en Linear con el PR enlazado.

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUser } from "./lib/authz";

const REASON_MAX = 200; // "texto corto" (AC del ticket) — más corto que TEXT_MAX (2000) de notes.ts

const MADRID_TZ = "Europe/Madrid";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Duplicada de src/lib/reminders/actions.ts a propósito — mismo motivo que
// isValidEpochMs en convex/notes.ts / src/lib/notes/actions.ts: esta
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
// automáticamente, a través de la base de datos ICU del runtime), y se
// aplica sobre la medianoche UTC del mismo día civil. Los ~2 días al año de
// cambio de horario podrían desplazar el corte "hoy/vencido" en como mucho
// 1 hora — no bloqueante para este MVP (ver PLANS/MIS-12-recordatorio-
// proximo-contacto.md, "Puntos abiertos" y paso 21 de "Verificación
// end-to-end", condición de instalación de la auditoría de plan v1→v2).
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
// contador (ver src/app/(app)/(with-nav)/layout.tsx).
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

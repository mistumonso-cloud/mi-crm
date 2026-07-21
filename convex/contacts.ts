import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireRole, requireUser } from "./lib/authz";

const contactStatusValidator = v.union(
  v.literal("lead"),
  v.literal("talking"),
  v.literal("proposal"),
  v.literal("negotiating"),
  v.literal("won"),
  v.literal("lost"),
  v.literal("inactive"),
);

// Subconjunto de contactStatusValidator seleccionable desde "Cambiar
// estado" (MIS-14) — exactamente los 6 estados del AC del ticket en
// Linear. "inactive" existe en el schema desde MIS-9 pero ningún ticket
// define cómo se llega a él; se mantiene fuera de alcance aquí a
// propósito. Duplicado respecto a SELECTABLE_STATUSES en
// src/lib/contacts/status.ts a propósito: convex/ y src/ son módulos
// independientes, sin validador compartido (mismo criterio que
// contactStatusValidator duplicado en convex/reminders.ts).
const CHANGEABLE_STATUSES = ["lead", "talking", "proposal", "negotiating", "won", "lost"] as const;

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
    // Solo "rep" (Carlos) puede crear contactos — Marta tiene acceso de
    // lectura, no de escritura, según el criterio original de MIS-7. No
    // confundir con el ADR de MIS-18: ese abrió acceso de LECTURA a páginas
    // (Pendientes/Panel), nunca tocó operaciones de escritura.
    const user = await requireRole(ctx, args.token, "rep");

    const name = args.name.trim();
    if (!name) {
      return { success: false as const, error: "El nombre es obligatorio", field: "name" as const };
    }
    if (name.length > NAME_MAX) {
      return {
        success: false as const,
        error: `El nombre no puede superar ${NAME_MAX} caracteres`,
        field: "name" as const,
      };
    }

    const phone = args.phone.trim();
    if (!phone) {
      return { success: false as const, error: "El teléfono es obligatorio", field: "phone" as const };
    }
    if (phone.length > PHONE_MAX) {
      return {
        success: false as const,
        error: `El teléfono no puede superar ${PHONE_MAX} caracteres`,
        field: "phone" as const,
      };
    }

    const initialNoteTrimmed = args.initialNote?.trim();
    if (initialNoteTrimmed && initialNoteTrimmed.length > NOTE_MAX) {
      return {
        success: false as const,
        error: `La nota no puede superar ${NOTE_MAX} caracteres`,
        field: "initialNote" as const,
      };
    }

    const id = await ctx.db.insert("contacts", {
      name,
      phone,
      status: "lead", // estado inicial fijo por AC, no un default arbitrario
      createdBy: user.id,
      ...(initialNoteTrimmed ? { initialNote: initialNoteTrimmed } : {}),
    });
    return { success: true as const, id };
  },
});

// args.id es v.string() (no v.id("contacts")) a propósito: con v.id() el
// validator de argumentos rechaza un ID de formato inválido ANTES de que el
// handler pueda capturarlo, propagando un error no controlado hasta la
// Server Component. ctx.db.normalizeId lo resuelve a null de forma segura,
// tratándolo igual que "fila inexistente".
export const getContact = query({
  args: { token: v.string(), id: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("contacts"),
      name: v.string(),
      phone: v.optional(v.string()),
      email: v.optional(v.string()),
      status: contactStatusValidator,
      initialNote: v.optional(v.string()),
      _creationTime: v.number(),
      responsibleName: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireUser(ctx, args.token); // lectura: ambos roles
    const contactId = ctx.db.normalizeId("contacts", args.id);
    if (!contactId) return null; // formato inválido o ID de otra tabla
    const contact = await ctx.db.get(contactId);
    if (!contact) return null; // formato válido, fila borrada/inexistente

    // "Responsable" = quien dio de alta el contacto (createdBy, obligatorio
    // en el schema). No hay campo de asignación separado — createContact
    // solo permite rol "rep", así que en la práctica es siempre Carlos.
    // No se añade `company` al contrato: existe en el schema pero ninguna
    // mutation lo rellena hoy y la ficha (MIS-10) no lo muestra — devolverlo
    // sin consumidor ensancharía el contrato para nada (hallazgo de la
    // auditoría de plan v1→v2 de MIS-10).
    const creator = await ctx.db.get(contact.createdBy);

    return {
      _id: contact._id,
      name: contact.name,
      phone: contact.phone,
      email: contact.email,
      status: contact.status,
      initialNote: contact.initialNote,
      _creationTime: contact._creationTime,
      responsibleName: creator?.name ?? "—", // defensivo: usuario borrado, caso no esperado hoy
    };
  },
});

// Lista completa de contactos para MIS-9. Sin paginación ni search index a
// propósito (ver PLANS/MIS-9-lista-contactos.md): el volumen esperado de un
// CRM personal en MVP es pequeño y la búsqueda se filtra en memoria en el
// cliente. Ordenado por _creationTime desc como proxy de "último contacto"
// hasta que MIS-11 añada tracking real de interacciones (lastContactAt,
// backfilleado desde _creationTime en ese momento).
export const listContacts = query({
  args: { token: v.string() },
  returns: v.array(
    v.object({
      _id: v.id("contacts"),
      name: v.string(),
      phone: v.optional(v.string()),
      status: contactStatusValidator,
      _creationTime: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireUser(ctx, args.token); // lectura: ambos roles, igual que getContact
    const contacts = await ctx.db.query("contacts").order("desc").collect();
    return contacts.map((c) => ({
      _id: c._id,
      name: c.name,
      phone: c.phone,
      status: c.status,
      _creationTime: c._creationTime,
    }));
  },
});

// MIS-14: cambia el estado de pipeline de un contacto en un solo paso,
// registrando el cambio en statusChanges para el historial de la ficha.
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

// Historial de cambios de estado de un contacto, para la ficha (MIS-14).
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

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

// MIS-8 (reapertura jul 2026) — duplicado de v.union en convex/schema.ts a
// propósito, mismo criterio que contactStatusValidator arriba: sin
// validador compartido entre convex/ y src/. Se usa directamente como tipo
// del argumento `channel` (igual que status: contactStatusValidator en
// changeContactStatus) — Convex rechaza en la capa de validación de
// argumentos cualquier valor fuera de los 5 literales, sin necesitar un
// workaround tipo v.string() + normalizeId (ese workaround es específico de
// IDs de formato libre que llegan por la URL; channel siempre llega de un
// <select> cerrado, ya validado también en createContactAction antes de
// invocar esta mutation).
const contactChannelValidator = v.union(
  v.literal("instagram"),
  v.literal("web"),
  v.literal("llamada"),
  v.literal("whatsapp"),
  v.literal("referido"),
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
// Límite convencional de longitud total de una dirección de email (RFC
// 5321). Sin regex de formato server-side — mismo nivel de validación que
// el resto de campos opcionales de texto (initialNote); el formato lo
// cubre gratis type="email" en el cliente (NewContactForm.tsx).
const EMAIL_MAX = 254;

export const createContact = mutation({
  args: {
    token: v.string(),
    name: v.string(),
    phone: v.string(),
    email: v.optional(v.string()),
    channel: v.optional(contactChannelValidator),
    initialNote: v.optional(v.string()),
  },
  returns: v.union(
    v.object({ success: v.literal(true), id: v.id("contacts") }),
    v.object({
      success: v.literal(false),
      error: v.string(),
      field: v.optional(
        v.union(v.literal("name"), v.literal("phone"), v.literal("email"), v.literal("initialNote")),
      ),
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

    const emailTrimmed = args.email?.trim();
    if (emailTrimmed && emailTrimmed.length > EMAIL_MAX) {
      return {
        success: false as const,
        error: `El email no puede superar ${EMAIL_MAX} caracteres`,
        field: "email" as const,
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
      ...(emailTrimmed ? { email: emailTrimmed } : {}),
      ...(args.channel ? { channel: args.channel } : {}),
      ...(initialNoteTrimmed ? { initialNote: initialNoteTrimmed } : {}),
    });
    return { success: true as const, id };
  },
});

// MIS-252: edita nombre/teléfono/email/canal de un contacto existente
// desde su ficha. Solo "rep" (Carlos) — Marta no tiene esta acción (AC).
export const updateContact = mutation({
  args: {
    token: v.string(),
    contactId: v.string(), // v.string(), no v.id("contacts"): mismo motivo que getContact.args.id
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
        v.union(
          v.literal("contactId"),
          v.literal("name"),
          v.literal("phone"),
          v.literal("email"),
          v.literal("channel"),
        ),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    // Solo "rep" (Carlos) puede editar datos del contacto (AC: "no es
    // visible para Marta") — mismo gating que changeContactStatus/
    // closeSale, mismo ADR de MIS-18. No se usa el usuario devuelto:
    // a diferencia de createContact, esta mutation no registra "quién
    // editó" (el AC no lo pide, y no hay tabla de historial para ello).
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

    const emailTrimmed = args.email?.trim();
    if (emailTrimmed && emailTrimmed.length > EMAIL_MAX) {
      return {
        success: false as const,
        error: `El email no puede superar ${EMAIL_MAX} caracteres`,
        field: "email" as const,
      };
    }

    // A diferencia de createContact (insert: omitir la clave del objeto =
    // "no guardar este campo"), ctx.db.patch hace un merge superficial:
    // omitir una clave dice "no toques el valor existente", NO "vacíalo".
    // Confirmado en node_modules/convex/dist/cjs-types/server/database.d.ts:
    // "Fields with value undefined are removed. Fields not specified in
    // the patch are left [unchanged]." Por eso aquí SIEMPRE se incluyen
    // las claves email/channel (con undefined explícito si el formulario
    // las dejó vacías) — así vaciar el campo en la edición sí lo borra,
    // a diferencia del patrón `...(x ? {email: x} : {})` de createContact,
    // que solo es correcto para un insert nuevo.
    await ctx.db.patch(contactId, {
      name,
      phone,
      email: emailTrimmed || undefined,
      channel: args.channel,
    });

    return { success: true as const };
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
      channel: v.optional(contactChannelValidator),
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
      channel: contact.channel,
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

// MIS-17: resumen del pipeline por estado, para las 6 tarjetas del panel
// de Marta (AC: "Muestra cuántos contactos hay en cada estado activo").
// Mismos 6 estados que CHANGEABLE_STATUSES arriba — "inactive" queda fuera
// a propósito, mismo criterio ya aplicado ahí. Objeto con las 6 claves ya
// contadas (no un array {status,count}[]): panel/page.tsx conoce de
// antemano esas 6 categorías fijas, indexar por clave evita un .find() por
// tarjeta en el cliente.
//
// Full table scan sin índice, deliberado — mismo criterio que listContacts
// arriba: la guía oficial de Convex (node_modules/convex/dist/esm-types/
// server/database.d.ts) acepta un full table scan en tablas "que se
// mantendrán muy pequeñas (unos pocos cientos a unos pocos miles de
// documentos)" — contacts tiene hoy ~15-20 filas. 6 queries indexadas
// (by_status) supondrían 6 escaneos en vez de 1, sin ventaja medible a
// este volumen; el índice queda disponible sin usar, igual que antes de
// MIS-17.
export const getPipelineSummary = query({
  args: { token: v.string() },
  returns: v.object({
    lead: v.number(),
    talking: v.number(),
    proposal: v.number(),
    negotiating: v.number(),
    won: v.number(),
    lost: v.number(),
  }),
  handler: async (ctx, args) => {
    await requireUser(ctx, args.token); // lectura: ambos roles, igual que listContacts
    const contacts = await ctx.db.query("contacts").collect();

    const summary = { lead: 0, talking: 0, proposal: 0, negotiating: 0, won: 0, lost: 0 };
    for (const c of contacts) {
      if (c.status !== "inactive") {
        summary[c.status] += 1;
      }
    }
    return summary;
  },
});

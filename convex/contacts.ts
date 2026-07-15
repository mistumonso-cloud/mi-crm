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

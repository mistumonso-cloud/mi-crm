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

const TEXT_MAX = 2000; // mismo límite que initialNote en el formulario de MIS-8

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
    contactId: v.string(), // v.string(), no v.id("contacts"): mismo motivo que getContact.args.id
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
    // Ambos roles pueden añadir notas (decisión confirmada de MIS-11) — a
    // diferencia de createContact (solo "rep"), aquí requireUser, no requireRole.
    const user = await requireUser(ctx, args.token);

    const contactId = ctx.db.normalizeId("contacts", args.contactId);
    if (!contactId) {
      return { success: false as const, error: "Contacto no encontrado", field: "contactId" as const };
    }
    const contact = await ctx.db.get(contactId);
    if (!contact) {
      return { success: false as const, error: "Contacto no encontrado", field: "contactId" as const };
    }

    if (!isValidEpochMs(args.occurredAt)) {
      return { success: false as const, error: "Fecha/hora inválida", field: "occurredAt" as const };
    }

    const text = args.text.trim();
    if (!text) {
      return { success: false as const, error: "El resumen no puede estar vacío", field: "text" as const };
    }
    if (text.length > TEXT_MAX) {
      return {
        success: false as const,
        error: `El resumen no puede superar ${TEXT_MAX} caracteres`,
        field: "text" as const,
      };
    }

    const id = await ctx.db.insert("notes", {
      contactId,
      authorId: user.id,
      type: args.type,
      occurredAt: args.occurredAt,
      text,
    });
    return { success: true as const, id };
  },
});

export const listNotes = query({
  args: { token: v.string(), contactId: v.string() },
  returns: v.array(
    v.object({
      _id: v.id("notes"),
      type: noteTypeValidator,
      occurredAt: v.number(),
      text: v.string(),
      authorName: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireUser(ctx, args.token); // lectura: ambos roles, igual que getContact/listContacts
    const contactId = ctx.db.normalizeId("contacts", args.contactId);
    if (!contactId) return []; // ID inválido o de otra tabla: page.tsx ya maneja "no encontrado" vía getContact

    const notes = await ctx.db
      .query("notes")
      .withIndex("by_contact", (q) => q.eq("contactId", contactId))
      .order("desc")
      .collect();

    return Promise.all(
      notes.map(async (n) => {
        const author = await ctx.db.get(n.authorId); // resuelto en lectura, nunca denormalizado — mismo idiom que responsibleName en getContact
        return {
          _id: n._id,
          type: n.type,
          occurredAt: n.occurredAt,
          text: n.text,
          authorName: author?.name ?? "—",
        };
      }),
    );
  },
});

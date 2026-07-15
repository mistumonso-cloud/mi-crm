import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  contacts: defineTable({
    name: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    company: v.optional(v.string()),
    // Nota libre capturada en el alta rápida (MIS-8). MIS-11 añadió una tabla
    // `notes` dedicada (autor/fecha/tipo/histórico) para notas nuevas a
    // partir de esa fecha — decisión explícita: este valor NO se migra, se
    // mantiene tal cual y se sigue renderizando como entrada sintética del
    // historial junto a las notas reales de `notes`.
    initialNote: v.optional(v.string()),
    // Quién dio de alta el contacto — obligatorio porque createContact
    // (MIS-8) es la única vía de escritura hoy y siempre corre autenticada
    // vía requireRole. Confirmado seguro de aplicar como obligatorio: la
    // tabla no tenía ninguna fila en dev ni en producción en el momento de
    // este cambio (ver CODIGO/MIS-8-anadir-contacto/NOTES.md).
    createdBy: v.id("users"),
    status: v.union(
      v.literal("lead"),
      v.literal("talking"),
      v.literal("proposal"),
      v.literal("negotiating"),
      v.literal("won"),
      v.literal("lost"),
      v.literal("inactive"),
    ),
  }).index("by_status", ["status"]),

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
    // epoch ms — momento del contacto en sí (editable, default "ahora" en el
    // cliente), no el instante de guardado (_creationTime ya cubre eso).
    occurredAt: v.number(),
    text: v.string(),
  }).index("by_contact", ["contactId", "occurredAt"]),

  users: defineTable({
    name: v.string(),
    email: v.string(),
    // "pbkdf2_sha256$v1$i=600000$<salt_b64url>$<hash_b64url>" — algoritmo, versión,
    // iteraciones y salt embebidos para poder migrar sin romper logins existentes.
    passwordHash: v.string(),
    role: v.union(v.literal("rep"), v.literal("supervisor")),
  }).index("by_email", ["email"]),

  sessions: defineTable({
    userId: v.id("users"),
    // SHA-256 del token opaco (32 bytes de entropía antes de hashear) — nunca el token en claro.
    tokenHash: v.string(),
    expiresAt: v.number(),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_user", ["userId"]),

  loginAttempts: defineTable({
    // Email normalizado, o "ip:<ip>" para la capa secundaria — exista o no la
    // cuenta, para no distinguir "no existe" de "bloqueada" por timing.
    emailKey: v.string(),
    count: v.number(),
    windowStartedAt: v.number(),
    lockedUntil: v.optional(v.number()),
  }).index("by_emailKey", ["emailKey"]),
});

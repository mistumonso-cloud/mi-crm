import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  contacts: defineTable({
    name: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    company: v.optional(v.string()),
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

import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { DUMMY_PASSWORD_HASH, verifyPassword } from "./lib/password";
import { generateOpaqueToken, hashToken } from "./lib/token";
import { lookupSessionUser } from "./lib/authz";
import {
  EMAIL_RATE_LIMIT,
  IP_RATE_LIMIT,
  isLocked,
  normalizeEmailKey,
  normalizeIpHint,
  recordFailedAttempt,
  resetAttempts,
} from "./lib/rateLimit";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 días — sesión persistente
const GENERIC_ERROR = "Email o contraseña incorrectos";
const LOCKED_ERROR = "Demasiados intentos, inténtalo de nuevo en unos minutos";

const roleValidator = v.union(v.literal("rep"), v.literal("supervisor"));

export const login = mutation({
  args: {
    email: v.string(),
    password: v.string(),
    ipHint: v.optional(v.string()),
  },
  returns: v.union(
    v.object({ success: v.literal(true), token: v.string(), role: roleValidator }),
    v.object({ success: v.literal(false), error: v.string() }),
  ),
  handler: async (ctx, args) => {
    const emailKey = normalizeEmailKey(args.email);
    const ipKey = normalizeIpHint(args.ipHint ?? null);

    if (ipKey && (await isLocked(ctx, `ip:${ipKey}`))) {
      return { success: false as const, error: LOCKED_ERROR };
    }
    if (await isLocked(ctx, emailKey)) {
      return { success: false as const, error: LOCKED_ERROR };
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", emailKey))
      .unique();

    // Mitigación de timing: si el usuario no existe, igual se ejecuta
    // verifyPassword contra un hash señuelo real, para que el coste
    // computacional de la petición sea equivalente exista o no la cuenta.
    const passwordOk = await verifyPassword(args.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);

    if (!user || !passwordOk) {
      await recordFailedAttempt(ctx, emailKey, EMAIL_RATE_LIMIT);
      if (ipKey) await recordFailedAttempt(ctx, `ip:${ipKey}`, IP_RATE_LIMIT);
      return { success: false as const, error: GENERIC_ERROR };
    }

    // Solo se resetea el contador por email, NO el de la IP (`ip:${ipKey}`) —
    // intencional: el contador de IP agrega intentos fallidos contra
    // cualquier email probado desde esa IP, como defensa contra un atacante
    // que prueba varias cuentas desde el mismo origen. Si un login correcto
    // reseteara también la IP, bastaría con tener una única credencial válida
    // para "limpiar" el contador y seguir probando otras cuentas desde la
    // misma IP con el límite a cero. Puede dar algún falso positivo en redes
    // compartidas (oficina/NAT), aceptado como coste de esta capa best-effort.
    await resetAttempts(ctx, emailKey);

    const token = generateOpaqueToken();
    const tokenHash = await hashToken(token);
    await ctx.db.insert("sessions", {
      userId: user._id,
      tokenHash,
      expiresAt: Date.now() + SESSION_TTL_MS,
    });

    return { success: true as const, token, role: user.role };
  },
});

export const logout = mutation({
  args: { token: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const tokenHash = await hashToken(args.token);
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (session) {
      await ctx.db.delete(session._id);
    }
    return null;
  },
});

// Query pura de solo lectura — Convex no permite escribir dentro de una query
// (QueryCtx no expone insert/patch/delete en ctx.db), así que no hace ninguna
// limpieza de sesiones expiradas al leer: si expiresAt ya pasó, simplemente
// devuelve null. La limpieza real vive en convex/crons.ts.
//
// El `returns` validator hace estructuralmente imposible filtrar
// passwordHash: si el objeto devuelto no coincide exactamente con esta forma,
// Convex lanza error en vez de dejar pasar el dato de más.
export const getSessionUser = query({
  args: { token: v.string() },
  returns: v.union(
    v.null(),
    v.object({ id: v.id("users"), name: v.string(), role: roleValidator }),
  ),
  handler: async (ctx, args) => {
    return await lookupSessionUser(ctx, args.token);
  },
});

// internalMutation: no forma parte de `api.*`, ningún cliente externo puede
// invocarla — solo con la admin key del deployment (npx convex run o el
// dashboard). Recibe la password YA hasheada (ver scripts/hash-password.mjs),
// nunca en claro.
export const seedUser = internalMutation({
  args: {
    name: v.string(),
    email: v.string(),
    passwordHash: v.string(),
    role: roleValidator,
  },
  returns: v.id("users"),
  handler: async (ctx, args) => {
    const emailKey = normalizeEmailKey(args.email);
    const existing = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", emailKey))
      .unique();
    if (existing) {
      throw new ConvexError(`Ya existe un usuario con el email ${emailKey}`);
    }
    return await ctx.db.insert("users", {
      name: args.name,
      email: emailKey,
      passwordHash: args.passwordHash,
      role: args.role,
    });
  },
});

export const cleanupExpiredSessions = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query("sessions")
      .filter((q) => q.lt(q.field("expiresAt"), now))
      .collect();
    for (const session of expired) {
      await ctx.db.delete(session._id);
    }
    return expired.length;
  },
});

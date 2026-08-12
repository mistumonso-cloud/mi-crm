import { ConvexError, v } from "convex/values";
import { action, internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { DUMMY_PASSWORD_HASH, verifyPassword } from "./lib/password";
import { serverKeyMatches, AUTH_SERVER_KEY_ENV_VAR } from "./lib/serverKey";
import { hashToken } from "./lib/token";
import { lookupSessionUser } from "./lib/authz";
import { createSession } from "./lib/session";
import {
  EMAIL_RATE_LIMIT,
  IP_RATE_LIMIT,
  isLocked,
  normalizeEmailKey,
  normalizeIpHint,
  recordFailedAttempt,
  resetAttempts,
} from "./lib/rateLimit";

const GENERIC_ERROR = "Email o contraseña incorrectos";
const LOCKED_ERROR = "Demasiados intentos, inténtalo de nuevo en unos minutos";

// MIS-260: mensaje único para CUALQUIER fallo del flujo de Google (state
// inválido, error/cancelación de Google, email no verificado, serverKey
// incorrecto o email no provisionado) — mismo criterio anti-enumeración que
// GENERIC_ERROR arriba, que tampoco distingue "email no existe" de
// "password incorrecta".
const GOOGLE_GENERIC_ERROR = "No se pudo iniciar sesión con Google";
// Nombre de la env var de Convex que debe coincidir exactamente con
// GOOGLE_LOGIN_SHARED_SECRET del lado de Next.js (ver src/lib/auth/google.ts
// y el Route Handler de callback) — se configura con
// `npx convex env set GOOGLE_LOGIN_SHARED_SECRET <valor>`.
const GOOGLE_LOGIN_ENV_VAR = "GOOGLE_LOGIN_SHARED_SECRET";

const roleValidator = v.union(v.literal("rep"), v.literal("supervisor"));

const loginResultValidator = v.union(
  v.object({ success: v.literal(true), token: v.string(), role: roleValidator }),
  v.object({ success: v.literal(false), error: v.string() }),
);

// Anotación explícita del resultado — rompe la inferencia circular que provoca
// que loginWithPassword (action) referencie internal.auth._loginCore, del mismo
// módulo: con el tipo de retorno explícito, TS resuelve el tipo de la action
// sin inferir su cuerpo.
type LoginResult =
  | { success: true; token: string; role: "rep" | "supervisor" }
  | { success: false; error: string };

// Lógica de login por password. La usa el núcleo interno `_loginCore`,
// invocado por la action `loginWithPassword` — el único endpoint público de
// login desde 1A-bis/MIS-289, que retiró el antiguo `login` (mutation sin
// serverKey). Es un helper, no una función registrada: corre dentro de una
// única transacción de mutation, con el KDF dentro — igual que hasta ahora. La
// reserva previa al KDF es 1B.
async function performLogin(
  ctx: MutationCtx,
  args: { email: string; password: string; ipHint?: string },
): Promise<LoginResult> {
  const emailKey = normalizeEmailKey(args.email);
  const ipKey = normalizeIpHint(args.ipHint ?? null);

  if (ipKey && (await isLocked(ctx, `ip:${ipKey}`))) {
    return { success: false, error: LOCKED_ERROR };
  }
  if (await isLocked(ctx, emailKey)) {
    return { success: false, error: LOCKED_ERROR };
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
    return { success: false, error: GENERIC_ERROR };
  }

  // Solo se resetea el contador por email, NO el de la IP (`ip:${ipKey}`) —
  // intencional: el contador de IP agrega intentos fallidos contra cualquier
  // email probado desde esa IP, como defensa contra un atacante que prueba
  // varias cuentas desde el mismo origen. Si un login correcto reseteara
  // también la IP, bastaría una credencial válida para "limpiar" el contador y
  // seguir probando otras cuentas desde la misma IP. Falsos positivos en redes
  // compartidas (oficina/NAT) aceptados como coste de esta capa best-effort.
  await resetAttempts(ctx, emailKey);

  const { token } = await createSession(ctx, user._id);

  return { success: true, token, role: user.role };
}

// Núcleo interno: no forma parte de api.*, ningún cliente externo puede
// invocarlo. Solo lo invoca la action loginWithPassword, tras validar serverKey.
// (MIS-289 retiró la mutation pública `login`, que compartía esta lógica sin
// exigir serverKey — esa puerta cerraba I3 para el login por password.)
export const _loginCore = internalMutation({
  args: {
    email: v.string(),
    password: v.string(),
    ipHint: v.optional(v.string()),
  },
  returns: loginResultValidator,
  handler: async (ctx, args) => performLogin(ctx, args),
});

// Endpoint público NUEVO (MIS-288, 1A.5). Es una ACTION, no una mutation, ya
// desde 1A — así 1B podrá cambiar sus tripas (reserva de cuota antes del KDF)
// sin migrar de tipo ni abrir una ventana de incompatibilidad. Exige serverKey:
// cierra I1 para el login por password. Una llamada directa a Convex sin la
// clave recibe el error genérico, indistinguible de un login fallido.
export const loginWithPassword = action({
  args: {
    email: v.string(),
    password: v.string(),
    ipHint: v.optional(v.string()),
    serverKey: v.string(),
  },
  returns: loginResultValidator,
  handler: async (ctx, args): Promise<LoginResult> => {
    if (!serverKeyMatches(args.serverKey, AUTH_SERVER_KEY_ENV_VAR)) {
      return { success: false as const, error: GENERIC_ERROR };
    }
    return await ctx.runMutation(internal.auth._loginCore, {
      email: args.email,
      password: args.password,
      ipHint: args.ipHint,
    });
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

// MIS-260: "Entrar con Google". Recibe el email YA verificado por Google
// (email_verified === true comprobado en el Route Handler de Next.js, antes
// de llegar aquí) y, si coincide con un usuario ya provisionado, autentica
// exactamente igual que `login` — misma tabla `sessions`, misma cookie,
// mismo DAL. Nunca inserta en "users": el alta sigue cerrada, esta mutation
// SOLO autentica a quien ya existe.
//
// Invariante de seguridad (por qué existe `serverKey`): sin este segundo
// argumento, esta sería una mutation pública invocable con cualquier email
// directamente contra el endpoint de Convex (NEXT_PUBLIC_CONVEX_URL es
// público, está en el bundle JS) — un bypass completo del login, sin
// password, sin pasar por Google. `serverKey` es un secreto compartido que
// SOLO conoce el servidor de Next.js (nunca el navegador) y el entorno de
// este deployment de Convex; sin él, la respuesta es indistinguible de
// "email no provisionado".
export const loginWithGoogle = mutation({
  args: { email: v.string(), serverKey: v.string() },
  returns: v.union(
    v.object({ success: v.literal(true), token: v.string(), role: roleValidator }),
    v.object({ success: v.literal(false), error: v.string() }),
  ),
  handler: async (ctx, args) => {
    if (!serverKeyMatches(args.serverKey, GOOGLE_LOGIN_ENV_VAR)) {
      return { success: false as const, error: GOOGLE_GENERIC_ERROR };
    }

    const emailKey = normalizeEmailKey(args.email);
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", emailKey))
      .unique();
    if (!user) return { success: false as const, error: GOOGLE_GENERIC_ERROR };

    const { token } = await createSession(ctx, user._id);
    return { success: true as const, token, role: user.role };
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

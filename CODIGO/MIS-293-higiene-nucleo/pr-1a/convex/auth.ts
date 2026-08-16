import { ConvexError, v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  DUMMY_PASSWORD_HASH,
  fingerprintHash,
  fingerprintsEqual,
  verifyPassword,
} from "./lib/password";
import { serverKeyMatches, AUTH_SERVER_KEY_ENV_VAR } from "./lib/serverKey";
import { hashToken } from "./lib/token";
import { lookupSessionUser } from "./lib/authz";
import { createSession } from "./lib/session";
import {
  LOGIN_EMAIL_COUNTER,
  LOGIN_EMAIL_VETO_LIMIT,
  LOGIN_IP_LIMIT,
  emailVetoActive,
  emailWithinLimits,
  isLocked,
  loginCounterKey,
  normalizeEmailKey,
  normalizeIpHint,
  recordFailedAttempt,
  resetAttempts,
} from "./lib/rateLimit";
import { CURRENT_PASSWORD_POLICY_VERSION } from "./lib/passwordPolicy";
import { RESET_TEST_EMAIL, TEST_SUPPORT_ENV_VAR } from "./lib/testIdentity";

const GENERIC_ERROR = "Email o contraseña incorrectos";
// MIS-296 (B7): `LOCKED_ERROR` retirado. La respuesta del login NO distingue un
// bloqueo (por IP) de unas credenciales incorrectas — ambos devuelven
// GENERIC_ERROR. El motivo real del bloqueo queda solo en el log del servidor.

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
// que loginWithPassword (action) y finalizeLogin (mismo módulo) se referencien:
// con el tipo de retorno explícito, TS resuelve el tipo sin inferir el cuerpo.
type LoginResult =
  | { success: true; token: string; role: "rep" | "supervisor" }
  | { success: false; error: string };

// MIS-290 (1B.2): el login se parte en reserva → KDF → finalización para acotar
// el coste del KDF (I5) y revalidar la contraseña reservada (I7). La firma
// pública de loginWithPassword NO cambia. Detalle en PLANS/MIS-290-plan-1B-i.md §3.

// TRANSACCIÓN 1. Consume la cuota de IP AL INTENTAR (no al fallar) y devuelve el
// hash a comparar. Confirma ANTES del KDF: N peticiones concurrentes serializan
// aquí y solo las primeras `LOGIN_IP_LIMIT.maxAttempts` no quedan bloqueadas.
// Unión discriminada: cuando está bloqueada no fabrica hash ni huella.
const reserveResultValidator = v.union(
  // MIS-296 (B7): `reason` es SOLO para el log del servidor (motivo real del
  // bloqueo). No sale nunca al cliente: loginWithPassword responde genérico.
  v.object({ blocked: v.literal(true), reason: v.union(v.literal("ip"), v.literal("email")) }),
  v.object({ blocked: v.literal(false), hash: v.string(), fingerprint: v.string() }),
);
type ReserveResult =
  | { blocked: true; reason: "ip" | "email" }
  | { blocked: false; hash: string; fingerprint: string };

export const reserveLoginSlot = internalMutation({
  args: { emailKey: v.string(), ipKey: v.union(v.string(), v.null()) },
  returns: reserveResultValidator,
  handler: async (ctx, args): Promise<ReserveResult> => {
    // Capa por IP (I5): si ya está bloqueada, no se consume más.
    if (args.ipKey && (await isLocked(ctx, `ip:${args.ipKey}`))) {
      return { blocked: true, reason: "ip" };
    }
    // Veto por email — SOLO si el interruptor está activo (MIS-291 lo pondrá a
    // "off"). Clave `<email>` con LOGIN_EMAIL_VETO_LIMIT; semántica fija (M1).
    if (emailVetoActive() && (await isLocked(ctx, args.emailKey))) {
      return { blocked: true, reason: "email" };
    }
    // Consume la cuota de IP AL INTENTAR: es lo que acota el KDF. Los logins
    // correctos también consumen; con 10/15 min por IP no molesta a usuarios
    // reales, ni compartiendo NAT.
    if (args.ipKey) {
      await recordFailedAttempt(ctx, `ip:${args.ipKey}`, LOGIN_IP_LIMIT);
    }
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.emailKey))
      .unique();
    // Anti-timing: hash señuelo real si el usuario no existe → coste del KDF
    // idéntico exista o no la cuenta.
    const hash = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
    return { blocked: false, hash, fingerprint: await fingerprintHash(hash) };
  },
});

// Instrumentación de test del KDF (tabla propia). DOBLE CERROJO (M3): solo se
// invoca desde la action cuando la credencial del harness está configurada Y la
// identidad es la dedicada; aquí se re-verifica la credencial por defensa en
// profundidad. En producción TEST_SUPPORT_ENV_VAR no existe → nunca se escribe.
export const KDF_COUNTER_KEY = "login-kdf";
export const bumpKdfCounter = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    if (!process.env[TEST_SUPPORT_ENV_VAR]) return null;
    const row = await ctx.db
      .query("testKdfCounter")
      .withIndex("by_key", (q) => q.eq("key", KDF_COUNTER_KEY))
      .unique();
    if (row) await ctx.db.patch(row._id, { count: row.count + 1 });
    else await ctx.db.insert("testKdfCounter", { key: KDF_COUNTER_KEY, count: 1 });
    return null;
  },
});

// PUNTO ÚNICO de entrada al KDF (I5): primero cuenta (bajo doble cerrojo), luego
// deriva. Imposible añadir un camino al KDF que no quede contado. Corre en la
// action, FUERA de transacción.
async function verifyPasswordInstrumented(
  ctx: ActionCtx,
  password: string,
  hash: string,
  emailKey: string,
): Promise<boolean> {
  if (process.env[TEST_SUPPORT_ENV_VAR] && emailKey === RESET_TEST_EMAIL) {
    await ctx.runMutation(internal.auth.bumpKdfCounter, {});
  }
  return await verifyPassword(password, hash);
}

// TRANSACCIÓN 2. Relee, revalida la huella (I7) y decide la sesión. Contabilidad
// UNIFORME (M2): todo resultado sin sesión registra el contador de email igual,
// exista o no la cuenta. Los dos registros de un fallo (telemetría + veto)
// ocurren en ESTA misma transacción.
export const finalizeLogin = internalMutation({
  args: { emailKey: v.string(), fingerprint: v.string(), ok: v.boolean() },
  returns: loginResultValidator,
  handler: async (ctx, args): Promise<LoginResult> => {
    // Misma consulta indexada exista o no la cuenta (no recibe userId, no hace
    // ctx.db.get(null)): cierra la diferencia de timing posterior al KDF.
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.emailKey))
      .unique();

    // I7: sesión solo si la cuenta existe, la contraseña era correcta Y el hash
    // NO cambió entre la reserva y ahora (huella coincide). Si un
    // resetPasswordWithTicket concurrente sustituyó el hash, la huella difiere y
    // no se crea sesión — sin esto sería una regresión de la invariante de MIS-285.
    const success =
      user !== null &&
      args.ok &&
      fingerprintsEqual(await fingerprintHash(user.passwordHash), args.fingerprint);

    if (success) {
      // Resetea AMBAS claves de email (deja un rollback del veto en estado
      // limpio) y NUNCA la de IP: si un login correcto limpiara la IP, bastaría
      // una cuenta propia para seguir probando otras cuentas desde la misma IP.
      await resetAttempts(ctx, args.emailKey);
      await resetAttempts(ctx, loginCounterKey(args.emailKey));
      const { token } = await createSession(ctx, user._id);
      return { success: true, token, role: user.role };
    }

    // Fallo (fila inexistente, contraseña incorrecta o huella obsoleta): registro
    // IDÉNTICO (M2, no reabre enumeración). Telemetría SIEMPRE (clave propia);
    // veto solo si el interruptor está activo (clave `<email>`). Cada clave con
    // su config fija — nunca se reinterpreta un contador (M1).
    await recordFailedAttempt(ctx, loginCounterKey(args.emailKey), LOGIN_EMAIL_COUNTER);
    if (emailVetoActive()) {
      await recordFailedAttempt(ctx, args.emailKey, LOGIN_EMAIL_VETO_LIMIT);
    }
    return { success: false, error: GENERIC_ERROR };
  },
});

// Endpoint público (MIS-288, action; tripas sustituidas en MIS-290). Firma
// intacta. Exige serverKey (I1). Reserva → KDF → finalización.
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
    const emailKey = normalizeEmailKey(args.email);
    // MIS-292 (M1): un email fuera del contrato (vacío o >254) se rechaza con el
    // error genérico ANTES de reservar slot, construir claves o tocar
    // `loginAttempts` — mismo criterio que passwordReset.ts. Va después del
    // serverKey (I3, siempre primero) y es indistinguible de credenciales
    // incorrectas: no revela nada y no escribe filas indexadas sobredimensionadas.
    if (!emailWithinLimits(emailKey)) {
      return { success: false as const, error: GENERIC_ERROR };
    }
    const ipKey = normalizeIpHint(args.ipHint ?? null);

    const reserve = await ctx.runMutation(internal.auth.reserveLoginSlot, { emailKey, ipKey });
    if (reserve.blocked) {
      // B7 (MIS-296): la RESPUESTA no distingue un bloqueo de unas credenciales
      // incorrectas (anti-enumeración/anti-oráculo). El motivo real queda solo en
      // el log del servidor — solo la capa, sin IP, email, contraseña ni token.
      console.warn(`[login] rechazo por bloqueo de rate limit (capa=${reserve.reason})`);
      return { success: false as const, error: GENERIC_ERROR };
    }

    const ok = await verifyPasswordInstrumented(ctx, args.password, reserve.hash, emailKey);

    return await ctx.runMutation(internal.auth.finalizeLogin, {
      emailKey,
      fingerprint: reserve.fingerprint,
      ok,
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
//
// MIS-290 (I6): el plaintext solo vive en scripts/hash-password.mjs, que valida
// contra la política ANTES de hashear (rechaza contraseñas débiles sin generar
// hash). seedUser no puede revalidar el plaintext, pero LIGA el hash sembrado al
// flujo validado escribiendo `passwordPolicyVersion` y `passwordChangedAt` EN EL
// MISMO insert que `passwordHash` — así una cuenta sembrada no queda pendiente
// de rotación (accountsPendingRotation no la lista).
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
      passwordPolicyVersion: CURRENT_PASSWORD_POLICY_VERSION,
      passwordChangedAt: Date.now(),
    });
  },
});

// MIS-290 (I6): gate de rotación. Devuelve las cuentas cuyo `passwordHash` se
// fijó con una versión de política distinta de la vigente (incluye las que no
// tienen el campo → "no rotada"). Solo id/email, NUNCA hashes: su salida puede
// registrarse como evidencia sin filtrar secretos. Se corre con `npx convex run`
// en producción y debe devolver `[]` antes de autorizar 1B-ii (MIS-291).
export const accountsPendingRotation = internalQuery({
  args: {},
  returns: v.array(v.object({ id: v.id("users"), email: v.string() })),
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    return users
      .filter((u) => u.passwordPolicyVersion !== CURRENT_PASSWORD_POLICY_VERSION)
      .map((u) => ({ id: u._id, email: u.email }));
  },
});

// MIS-293 (A3-i, precursor de compatibilidad NFKC): devuelve las cuentas cuyo
// `email` almacenado NO coincide con su forma canónica COMPLETA prevista
// (`NFKC` + `trim` + `toLowerCase`) — exactamente la que aplicará A3-ii en
// `normalizeEmailKey`. Es el gate fail-closed que autoriza activar NFKC: debe
// devolver `[]` (ninguna cuenta cambia bajo la nueva normalización, así que
// ninguna búsqueda `by_email` se rompe ni colisiona).
//
// Read-only y NO modifica `normalizeEmailKey`: desplegar esta consulta NO cambia
// el comportamiento del login, por eso puede vivir en producción ANTES que NFKC.
// Solo id/email (nunca hashes), igual que accountsPendingRotation: su salida se
// puede registrar como evidencia sin filtrar secretos (aun así, es PII: publicar
// solo `[]`/conteo). Se corre con `npx convex run auth:accountsWithNonCanonicalEmail
// --prod` y debe dar `[]` tanto tras desplegar PR-1a como, de nuevo, just-in-time
// antes de desplegar A3-ii.
export const accountsWithNonCanonicalEmail = internalQuery({
  args: {},
  returns: v.array(v.object({ id: v.id("users"), email: v.string() })),
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    return users
      .filter((u) => u.email.normalize("NFKC").trim().toLowerCase() !== u.email)
      .map((u) => ({ id: u._id, email: u.email }));
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

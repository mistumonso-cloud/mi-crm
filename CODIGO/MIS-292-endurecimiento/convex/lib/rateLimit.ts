import type { MutationCtx } from "../_generated/server";

export function normalizeEmailKey(email: string): string {
  return email.trim().toLowerCase();
}

// MIS-292 (M1): cota de longitud del email, COMPARTIDA por el login (auth.ts) y
// la recuperación (passwordReset.ts). 254 = longitud máxima de una dirección de
// email (RFC 5321). Se aplica SIEMPRE sobre la forma ya normalizada y ANTES de
// construir cualquier clave de rate limit o de tocar `loginAttempts`, para que un
// email arbitrariamente largo no se convierta en una clave indexada
// sobredimensionada. Antes vivía como copia local en passwordReset.ts; auth.ts se
// había quedado fuera de esa disciplina (el hueco que M1 cierra).
export const MAX_EMAIL_LENGTH = 254;

export function emailWithinLimits(normalized: string): boolean {
  return normalized.length > 0 && normalized.length <= MAX_EMAIL_LENGTH;
}

// Cabeceras `x-forwarded-for` sin normalizar son trivialmente falseables por el
// cliente: toma solo la primera IP (la más cercana al cliente real cuando se
// confía en el proxy de la plataforma), recorta longitud y descarta cualquier
// valor que no tenga forma de IPv4/IPv6 (validación simple de formato, no RFC
// completa) — si no es válida, se trata como "sin IP" y no se aplica el límite.
const MAX_IP_LENGTH = 45; // suficiente para IPv6
const IPV4_RE = /^(\d{1,3})(\.\d{1,3}){3}$/;
const IPV6_RE = /^[0-9a-fA-F:]+$/;

export function normalizeIpHint(rawXForwardedFor: string | undefined | null): string | null {
  if (!rawXForwardedFor) return null;
  const first = rawXForwardedFor.split(",")[0]?.trim() ?? "";
  if (!first || first.length > MAX_IP_LENGTH) return null;
  const looksLikeIpv4 = IPV4_RE.test(first);
  const looksLikeIpv6 = first.includes(":") && IPV6_RE.test(first);
  if (!looksLikeIpv4 && !looksLikeIpv6) return null;
  return first;
}

// MIS-290 (1B.1): unión discriminada. `lock:false` es un contador de telemetría
// que NUNCA bloquea; `lock:true` lleva su duración de bloqueo. Se evita el
// `lockDurationMs: 0` ambiguo (¿bloqueo de 0 ms o sin bloqueo?).
export type RateLimitConfig =
  | { maxAttempts: number; windowMs: number; lock: true; lockDurationMs: number }
  | { maxAttempts: number; windowMs: number; lock: false };

const MIN = 60 * 1000;

// --- Login (MIS-290, 1B.1) ---

// Capa por IP: acota el coste del KDF (I5). Se consume AL INTENTAR en
// reserveLoginSlot, no al fallar.
export const LOGIN_IP_LIMIT: RateLimitConfig = {
  maxAttempts: 10,
  windowMs: 15 * MIN,
  lock: true,
  lockDurationMs: 15 * MIN,
};

// Veto por email (clave `<email>`). Comportamiento actual conservado; controlado
// por el interruptor LOGIN_EMAIL_VETO (ver emailVetoActive). Se RETIRA en 1B-ii
// (MIS-291) poniendo el interruptor a "off". Su semántica (5/15 → bloqueo 15) es
// FIJA de por vida sobre esta clave: nunca se reinterpreta.
export const LOGIN_EMAIL_VETO_LIMIT: RateLimitConfig = {
  maxAttempts: 5,
  windowMs: 15 * MIN,
  lock: true,
  lockDurationMs: 15 * MIN,
};

// Telemetría por email (clave `login-counter:<email>`, ver loginCounterKey). NO
// veta y ningún consumidor la lee hoy: es forense, para alimentar una futura
// alerta de "intentos de acceso". NO confundir con una defensa. Semántica FIJA
// de por vida sobre su propia clave: nunca comparte fila con el veto (M1).
export const LOGIN_EMAIL_COUNTER: RateLimitConfig = {
  maxAttempts: 50,
  windowMs: 60 * MIN,
  lock: false,
};

// --- Recuperación de contraseña ---

export const RESET_REQUEST_LIMIT: RateLimitConfig = {
  maxAttempts: 5,
  windowMs: 15 * MIN,
  lock: true,
  lockDurationMs: 15 * MIN,
};

export const RESET_CODE_LIMIT: RateLimitConfig = {
  maxAttempts: 5,
  windowMs: 15 * MIN,
  lock: true,
  lockDurationMs: 15 * MIN,
};

export const RESET_IP_LIMIT: RateLimitConfig = {
  maxAttempts: 10,
  windowMs: 15 * MIN,
  lock: true,
  lockDurationMs: 15 * MIN,
};

// Única fuente de la clave de telemetría por email (M1, sugerencia del auditor):
// login, y el harness de test, la construyen SIEMPRE por aquí para que no puedan
// divergir por un prefijo escrito a mano.
export function loginCounterKey(emailKey: string): string {
  return `login-counter:${emailKey}`;
}

// Interruptor del veto por email (MIS-290 lo introduce activo por defecto; MIS-291
// lo pondrá a "off"). FAIL-SAFE: ausente o cualquier valor distinto de "off" →
// veto ACTIVO. Un despliegue que se olvide la variable mantiene el bloqueo, no lo
// retira (misma dirección segura que el fail-closed de I2).
export function emailVetoActive(): boolean {
  return process.env.LOGIN_EMAIL_VETO !== "off";
}

async function findAttempt(ctx: MutationCtx, emailKey: string) {
  return await ctx.db
    .query("loginAttempts")
    .withIndex("by_emailKey", (q) => q.eq("emailKey", emailKey))
    .unique();
}

export async function isLocked(ctx: MutationCtx, emailKey: string): Promise<boolean> {
  const attempt = await findAttempt(ctx, emailKey);
  if (!attempt?.lockedUntil) return false;
  return attempt.lockedUntil > Date.now();
}

export async function recordFailedAttempt(
  ctx: MutationCtx,
  emailKey: string,
  config: RateLimitConfig,
): Promise<void> {
  const now = Date.now();
  const attempt = await findAttempt(ctx, emailKey);

  if (!attempt) {
    await ctx.db.insert("loginAttempts", {
      emailKey,
      count: 1,
      windowStartedAt: now,
      lockedUntil: undefined,
    });
    return;
  }

  const windowExpired = now - attempt.windowStartedAt > config.windowMs;
  const nextCount = windowExpired ? 1 : attempt.count + 1;
  // `lock:false` (telemetría) nunca fija lockedUntil.
  const shouldLock = config.lock && nextCount >= config.maxAttempts;

  await ctx.db.patch(attempt._id, {
    count: nextCount,
    windowStartedAt: windowExpired ? now : attempt.windowStartedAt,
    lockedUntil: shouldLock ? now + config.lockDurationMs : attempt.lockedUntil,
  });
}

export async function resetAttempts(ctx: MutationCtx, emailKey: string): Promise<void> {
  const attempt = await findAttempt(ctx, emailKey);
  if (attempt) await ctx.db.delete(attempt._id);
}

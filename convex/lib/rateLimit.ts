import type { MutationCtx } from "../_generated/server";

export function normalizeEmailKey(email: string): string {
  return email.trim().toLowerCase();
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

export type RateLimitConfig = {
  maxAttempts: number;
  windowMs: number;
  lockDurationMs: number;
};

// Bloqueo primario y obligatorio: 5 fallos / 15 minutos por email.
export const EMAIL_RATE_LIMIT: RateLimitConfig = {
  maxAttempts: 5,
  windowMs: 15 * 60 * 1000,
  lockDurationMs: 15 * 60 * 1000,
};

// Capa secundaria best-effort: límite más laxo agregando todos los emails
// probados desde una misma IP.
export const IP_RATE_LIMIT: RateLimitConfig = {
  maxAttempts: 20,
  windowMs: 60 * 60 * 1000,
  lockDurationMs: 60 * 60 * 1000,
};

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
  const shouldLock = nextCount >= config.maxAttempts;

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

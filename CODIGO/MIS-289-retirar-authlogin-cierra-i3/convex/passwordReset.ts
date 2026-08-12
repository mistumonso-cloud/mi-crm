// MIS-285: recuperación de contraseña por código (OTP) enviado por email con
// Resend. Depende del harness de MIS-286 (convex/testSupport.ts) para poder
// verificarse en e2e sin abrir un agujero de seguridad, y de las tablas
// `passwordResetCodes` / `testOutbox` que ya define el esquema de MIS-286.
//
// Anti-enumeración por RESPUESTA y por TIEMPO: `requestPasswordResetCode` no
// consulta `users` ni espera a Resend — solo rate-limita y programa el
// trabajo real vía scheduler, así que el tiempo de respuesta es idéntico
// exista o no la cuenta. Ver PLANS/MIS-285-recuperacion-contrasena-plan.md.

import { v } from "convex/values";
import { internalMutation, internalAction, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { constantTimeEqual, hashPassword } from "./lib/password";
import { serverKeyMatches, AUTH_SERVER_KEY_ENV_VAR } from "./lib/serverKey";
import { generateNumericCode, generateOpaqueToken, hashToken } from "./lib/token";
import {
  EMAIL_RATE_LIMIT,
  IP_RATE_LIMIT,
  isLocked,
  normalizeEmailKey,
  normalizeIpHint,
  recordFailedAttempt,
  resetAttempts,
} from "./lib/rateLimit";
import { sendPasswordResetCodeEmail } from "./lib/resend";
import { RESET_TEST_EMAIL } from "./lib/testIdentity";

const CODE_TTL_MS = 15 * 60 * 1000;
const TICKET_TTL_MS = 15 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const MAX_EMAIL_LENGTH = 254;
const CODE_FORMAT = /^\d{6}$/;
const GENERIC_CODE_ERROR = "Código incorrecto o caducado";
const TICKET_EXPIRED_ERROR = "La sesión de recuperación caducó, vuelve a empezar";
const PASSWORD_POLICY_ERROR = "La contraseña debe tener entre 8 y 128 caracteres";

function emailWithinLimits(normalized: string): boolean {
  return normalized.length > 0 && normalized.length <= MAX_EMAIL_LENGTH;
}

// 1. Mutation pública: rate-limita y programa el envío diferido. Nunca toca
// `users` ni espera a Resend — el tiempo de respuesta no debe delatar si el
// email existe.
export const requestPasswordResetCode = mutation({
  args: { email: v.string(), ipHint: v.optional(v.string()), serverKey: v.string() },
  returns: v.object({ ok: v.literal(true) }),
  handler: async (ctx, args) => {
    // I3 (MIS-289): serverKey obligatorio. Toda llamada sin clave válida se
    // rechaza aquí, como PRIMERA sentencia, antes de tocar el rate limit o
    // programar trabajo. serverKey incorrecto responde {ok:true} sin hacer nada:
    // mismo criterio anti-enumeración (no revela nada, no hace trabajo).
    if (!serverKeyMatches(args.serverKey, AUTH_SERVER_KEY_ENV_VAR)) {
      return { ok: true as const };
    }

    const normalizedEmail = normalizeEmailKey(args.email);
    // M13: un email fuera de los límites del contrato (vacío o >254) no llega
    // a construir claves de rate limit ni a programar trabajo — mismo
    // resultado público {ok:true} que cualquier otra solicitud, así que no
    // añade una forma nueva de distinguir entradas.
    if (!emailWithinLimits(normalizedEmail)) return { ok: true as const };

    const emailKey = `reset:${normalizedEmail}`;
    const ipKey = normalizeIpHint(args.ipHint ?? null);

    let allowed = !(await isLocked(ctx, emailKey));
    if (allowed && ipKey) allowed = !(await isLocked(ctx, `resetip:${ipKey}`));

    // Se contabilizan SOLICITUDES (no fallos): siempre se registra, exista o
    // no la cuenta — de lo contrario el contador delataría por sí mismo si
    // el email existe.
    await recordFailedAttempt(ctx, emailKey, EMAIL_RATE_LIMIT);
    if (ipKey) await recordFailedAttempt(ctx, `resetip:${ipKey}`, IP_RATE_LIMIT);

    await ctx.scheduler.runAfter(0, internal.passwordReset.deliverResetCode, {
      email: args.email,
      allowed,
    });
    return { ok: true as const };
  },
});

// 2. internalAction: única función de este módulo con `fetch` (Resend). Los
// errores se registran sin código, destinatario ni cuerpo.
export const deliverResetCode = internalAction({
  args: { email: v.string(), allowed: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!args.allowed) return null;

    const created = await ctx.runMutation(internal.passwordReset.createResetCode, {
      email: args.email,
    });
    if (!created) return null;

    // Solo la identidad dedicada del harness (MIS-286) deposita el código en
    // claro en el outbox de test — cualquier otro destinatario (pruebas
    // manuales con un email real incluidas) omite este paso sin más.
    if (normalizeEmailKey(created.email) === RESET_TEST_EMAIL) {
      await ctx.runMutation(internal.testSupport.recordOutbox, {
        email: created.email,
        code: created.code,
      });
    }

    try {
      await sendPasswordResetCodeEmail(created.email, created.name, created.code);
    } catch (err) {
      console.error("deliverResetCode: fallo al enviar con Resend", err instanceof Error ? err.message : err);
    }
    return null;
  },
});

// 3. internalMutation: busca el usuario, invalida códigos previos no usados
// y crea uno nuevo. Solo el ÚLTIMO código generado sigue siendo válido.
export const createResetCode = internalMutation({
  args: { email: v.string() },
  returns: v.union(
    v.object({ code: v.string(), email: v.string(), name: v.string() }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const emailKey = normalizeEmailKey(args.email);
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", emailKey))
      .unique();
    if (!user) return null;

    for (const row of await ctx.db
      .query("passwordResetCodes")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect()) {
      if (!row.usedAt) await ctx.db.delete(row._id);
    }

    const code = generateNumericCode(6);
    await ctx.db.insert("passwordResetCodes", {
      userId: user._id,
      codeHash: await hashToken(code),
      expiresAt: Date.now() + CODE_TTL_MS,
      attempts: 0,
    });

    // M12: un código nuevo debe poder verificarse aunque el anterior haya
    // agotado sus 5 intentos y bloqueado `resetcode:<email>` — si no se
    // resetea aquí, verifyResetCode rechaza el código nuevo (correcto o no)
    // por el candado del código viejo. Solo la clave por email: el contador
    // de IP (`resetip:<ip>`) es compartido entre cuentas y no se toca, mismo
    // criterio que el resto del rate limiting de este módulo.
    await resetAttempts(ctx, `resetcode:${emailKey}`);

    return { code, email: emailKey, name: user.name };
  },
});

// 4. Mutation pública: verifica el código y, si coincide, emite un ticket
// opaco de un solo uso que autoriza el cambio de contraseña.
export const verifyResetCode = mutation({
  args: { email: v.string(), code: v.string(), ipHint: v.optional(v.string()), serverKey: v.string() },
  returns: v.union(
    v.object({ ok: v.literal(true), ticket: v.string() }),
    v.object({ ok: v.literal(false), error: v.string() }),
  ),
  handler: async (ctx, args) => {
    // I3 (MIS-289): serverKey obligatorio, comprobado como primera sentencia.
    // Clave inválida → error genérico (indistinguible de un código incorrecto).
    if (!serverKeyMatches(args.serverKey, AUTH_SERVER_KEY_ENV_VAR)) {
      return { ok: false as const, error: GENERIC_CODE_ERROR };
    }

    const emailKey = normalizeEmailKey(args.email);

    // M13 (ronda 2): un email fuera del contrato (vacío o >254) se rechaza
    // ANTES de construir `resetcode:<email>` o de tocar el rate limit en
    // cualquier forma — ni lectura (isLocked) ni escritura (fail()). La
    // ronda 1 validaba esto DESPUÉS de ya haber consultado isLocked con la
    // clave sobredimensionada, lo que seguía dejando pasar la amplificación
    // que M13 debía cerrar.
    if (!emailWithinLimits(emailKey)) {
      return { ok: false as const, error: GENERIC_CODE_ERROR };
    }

    const rateLimitKey = `resetcode:${emailKey}`;
    const ipKey = normalizeIpHint(args.ipHint ?? null);

    if (await isLocked(ctx, rateLimitKey)) {
      return { ok: false as const, error: GENERIC_CODE_ERROR };
    }
    if (ipKey && (await isLocked(ctx, `resetip:${ipKey}`))) {
      return { ok: false as const, error: GENERIC_CODE_ERROR };
    }

    const fail = async () => {
      await recordFailedAttempt(ctx, rateLimitKey, EMAIL_RATE_LIMIT);
      if (ipKey) await recordFailedAttempt(ctx, `resetip:${ipKey}`, IP_RATE_LIMIT);
      return { ok: false as const, error: GENERIC_CODE_ERROR };
    };

    // El email ya es válido en este punto — un código con formato incorrecto
    // sí pasa por fail() y cuenta como intento, igual que un código válido
    // pero equivocado.
    if (!CODE_FORMAT.test(args.code)) return await fail();

    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", emailKey))
      .unique();

    if (!user) return await fail();

    const rows = await ctx.db
      .query("passwordResetCodes")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const active = rows.find(
      (row) => !row.usedAt && row.codeHash !== undefined && row.expiresAt > Date.now(),
    );
    if (!active || active.attempts >= MAX_CODE_ATTEMPTS) return await fail();

    const matches = constantTimeEqual(
      new TextEncoder().encode(await hashToken(args.code)),
      new TextEncoder().encode(active.codeHash as string),
    );
    if (!matches) {
      await ctx.db.patch(active._id, { attempts: active.attempts + 1 });
      return await fail();
    }

    const ticket = generateOpaqueToken();
    await ctx.db.patch(active._id, {
      codeHash: undefined, // consume el código: no puede volver a emitir tickets
      ticketHash: await hashToken(ticket),
      ticketExpiresAt: Date.now() + TICKET_TTL_MS,
    });
    await resetAttempts(ctx, rateLimitKey);

    return { ok: true as const, ticket };
  },
});

// 5. Mutation pública: cambia la contraseña e invalida TODAS las sesiones del
// usuario, atómicamente en la misma mutation.
export const resetPasswordWithTicket = mutation({
  args: { ticket: v.string(), newPassword: v.string(), serverKey: v.string() },
  returns: v.union(
    v.object({ ok: v.literal(true) }),
    v.object({ ok: v.literal(false), error: v.string() }),
  ),
  handler: async (ctx, args) => {
    // I3 (MIS-289): serverKey obligatorio, comprobado como primera sentencia.
    // Clave inválida → error genérico del flujo (indistinguible).
    if (!serverKeyMatches(args.serverKey, AUTH_SERVER_KEY_ENV_VAR)) {
      return { ok: false as const, error: TICKET_EXPIRED_ERROR };
    }

    if (args.newPassword.length < 8 || args.newPassword.length > 128) {
      return { ok: false as const, error: PASSWORD_POLICY_ERROR };
    }

    const ticketHash = await hashToken(args.ticket);
    const row = await ctx.db
      .query("passwordResetCodes")
      .withIndex("by_ticketHash", (q) => q.eq("ticketHash", ticketHash))
      .unique();

    if (!row || row.usedAt || !row.ticketExpiresAt || row.ticketExpiresAt < Date.now()) {
      return { ok: false as const, error: TICKET_EXPIRED_ERROR };
    }

    await ctx.db.patch(row.userId, { passwordHash: await hashPassword(args.newPassword) });
    await ctx.db.patch(row._id, { usedAt: Date.now() });

    for (const session of await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", row.userId))
      .collect()) {
      await ctx.db.delete(session._id);
    }

    return { ok: true as const };
  },
});

// 6. Cron diario (convex/crons.ts): purga filas caducadas para no acumular
// basura indefinidamente. No es un requisito de seguridad (los campos ya
// caducados se tratan como inválidos en cualquier lectura), solo higiene.
export const cleanupExpiredResetCodes = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db.query("passwordResetCodes").collect();
    let deleted = 0;
    for (const row of rows) {
      // Ya consumida (cambio de contraseña completado), o ningún camino
      // sigue siendo utilizable: el código expiró sin llegar a emitir
      // ticket, o el ticket emitido también expiró sin usarse.
      const consumed = row.usedAt !== undefined;
      const codeDead = row.codeHash === undefined || row.expiresAt < now;
      const ticketDead = row.ticketHash === undefined || (row.ticketExpiresAt ?? 0) < now;
      if (consumed || (codeDead && ticketDead)) {
        await ctx.db.delete(row._id);
        deleted++;
      }
    }
    return deleted;
  },
});

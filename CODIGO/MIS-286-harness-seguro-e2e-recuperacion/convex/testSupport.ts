// MIS-286: harness seguro de pruebas e2e para el flujo de recuperación de
// contraseña (MIS-285).
//
// POR QUÉ ESTE MÓDULO EXISTE
// El código OTP llega por email y en BD solo se guarda su hash, así que un test
// no puede leerlo por medios normales. Este módulo abre la mínima puerta que lo
// permite — y la cierra con tres cerrojos independientes:
//
//   1. CREDENCIAL de alta entropía (`E2E_TEST_SUPPORT_KEY`) comparada en tiempo
//      constante y FAIL-CLOSED. En producción esa env var no existe, así que
//      todas estas funciones lanzan aunque el código esté desplegado.
//   2. IDENTIDAD DEDICADA: solo operan sobre RESET_TEST_EMAIL. Nunca pueden
//      tocar carlos@test.local, mistumonso@gmail.com ni ninguna cuenta real.
//   3. SECRETOS EFÍMEROS: la contraseña de esa identidad se genera en cada
//      llamada y solo se devuelve al llamante ya autenticado — no existe
//      ninguna contraseña válida en el repositorio.
//
// OJO con el alcance real de una filtración: desde MIS-251 el rol NO autoriza
// nada (ver convex/lib/authz.ts), así que la identidad dedicada tiene acceso
// completo de lectura/escritura al CRM de dev igual que cualquier usuario. Una
// filtración de E2E_TEST_SUPPORT_KEY exige ROTACIÓN INMEDIATA de la credencial
// (en Convex dev y en GitHub Secrets); lo que sí acota el cerrojo 2 es que el
// harness no pueda manipular las cuentas de Carlos y Marta.

import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { constantTimeEqual, hashPassword } from "./lib/password";
import { generateOpaqueToken } from "./lib/token";
import { normalizeEmailKey, resetAttempts } from "./lib/rateLimit";
import { RESET_TEST_EMAIL, TEST_SUPPORT_ENV_VAR } from "./lib/testIdentity";

const UNAUTHORIZED = "No autorizado";
const FORBIDDEN_IDENTITY = "Identidad no permitida";

// Cerrojo 1. Fail-closed: sin env var configurada NO hay valor de serverKey que
// pueda pasar, porque `expected` es undefined y la comparación no llega a
// ejecutarse. Mismo patrón que loginWithGoogle en convex/auth.ts.
function assertTestKey(serverKey: string): void {
  const expected = process.env[TEST_SUPPORT_ENV_VAR];
  const ok =
    !!expected &&
    constantTimeEqual(
      new TextEncoder().encode(serverKey),
      new TextEncoder().encode(expected),
    );
  if (!ok) throw new Error(UNAUTHORIZED);
}

// Cerrojo 2. Devuelve el email ya normalizado para que quien lo llame use
// SIEMPRE la forma canónica en sus consultas.
function assertDedicatedIdentity(email: string): string {
  const key = normalizeEmailKey(email);
  if (key !== RESET_TEST_EMAIL) throw new Error(FORBIDDEN_IDENTITY);
  return key;
}

async function findTestUser(ctx: QueryCtx | MutationCtx) {
  return await ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", RESET_TEST_EMAIL))
    .unique();
}

// Claves de rate limit que pertenecen EXCLUSIVAMENTE a la identidad dedicada.
// Enumeración explícita a propósito: nunca se borra por prefijo, y nunca se
// tocan las claves `ip:` / `resetip:` porque son COMPARTIDAS entre usuarios y
// limpiarlas debilitaría el rate limiting real del deployment.
function rateLimitKeysForTestIdentity(): string[] {
  return [
    RESET_TEST_EMAIL, // login
    `reset:${RESET_TEST_EMAIL}`, // solicitudes de código
    `resetcode:${RESET_TEST_EMAIL}`, // intentos de código
  ];
}

// Reseed IDEMPOTENTE. Se llama al INICIO de cada spec (no en cleanup: un
// cleanup se salta si el test falla, y entonces la ejecución siguiente heredaría
// el bloqueo de rate limit y fallaría durante 15 minutos).
export const resetTestIdentity = mutation({
  args: { serverKey: v.string(), email: v.string() },
  returns: v.object({ password: v.string() }),
  handler: async (ctx, args) => {
    assertTestKey(args.serverKey);
    assertDedicatedIdentity(args.email);

    // Contraseña EFÍMERA: 32 bytes nuevos en cada llamada. Se devuelve en claro
    // solo aquí, al llamante ya autenticado por serverKey; en BD queda hasheada.
    const password = generateOpaqueToken();
    const passwordHash = await hashPassword(password);

    const existing = await findTestUser(ctx);
    const userId = existing
      ? (await ctx.db.patch(existing._id, { passwordHash }), existing._id)
      : await ctx.db.insert("users", {
          name: "Reset E2E",
          email: RESET_TEST_EMAIL,
          passwordHash,
          role: "rep",
        });

    // Estado inicial determinista: sin códigos, sin sesiones, sin outbox y sin
    // bloqueos. Cada spec puede así declarar de qué parte.
    for (const row of await ctx.db
      .query("passwordResetCodes")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect()) {
      await ctx.db.delete(row._id);
    }
    for (const session of await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect()) {
      await ctx.db.delete(session._id);
    }
    for (const entry of await ctx.db
      .query("testOutbox")
      .withIndex("by_email", (q) => q.eq("email", RESET_TEST_EMAIL))
      .collect()) {
      await ctx.db.delete(entry._id);
    }
    for (const key of rateLimitKeysForTestIdentity()) {
      await resetAttempts(ctx, key);
    }

    return { password };
  },
});

// Devuelve null cuando el outbox está vacío (aún no se ha pedido código).
export const getLastResetCode = query({
  args: { serverKey: v.string(), email: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    assertTestKey(args.serverKey);
    assertDedicatedIdentity(args.email);

    const entries = await ctx.db
      .query("testOutbox")
      .withIndex("by_email", (q) => q.eq("email", RESET_TEST_EMAIL))
      .collect();
    if (entries.length === 0) return null;

    let latest = entries[0];
    for (const entry of entries) {
      if (entry.createdAt > latest.createdAt) latest = entry;
    }
    return latest.code;
  },
});

// Permite probar la caducidad en segundos en lugar de esperar 15 minutos, sin
// abstracción de reloj y sin tocar la lógica de producción. Devuelve si había
// una fila que caducar.
export const expireResetCode = mutation({
  args: { serverKey: v.string(), email: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    assertTestKey(args.serverKey);
    assertDedicatedIdentity(args.email);

    const user = await findTestUser(ctx);
    if (!user) return false;

    const rows = await ctx.db
      .query("passwordResetCodes")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const active = rows.filter((row) => !row.usedAt);
    if (active.length === 0) return false;

    const past = Date.now() - 1000;
    for (const row of active) {
      await ctx.db.patch(row._id, {
        expiresAt: past,
        ...(row.ticketExpiresAt === undefined ? {} : { ticketExpiresAt: past }),
      });
    }
    return true;
  },
});

// Verifica la invalidación de sesiones tras un cambio de contraseña.
export const countSessionsFor = query({
  args: { serverKey: v.string(), email: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    assertTestKey(args.serverKey);
    assertDedicatedIdentity(args.email);

    const user = await findTestUser(ctx);
    if (!user) return 0;

    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    return sessions.length;
  },
});

// internalMutation: NO forma parte de `api.*`, ningún cliente externo puede
// invocarla — por eso es la única función del módulo que no recibe serverKey.
// La llama el envío de MIS-285. Dos salvaguardas propias, por si un futuro call
// site se equivoca:
//   - inerte si la credencial del harness no está configurada (producción);
//   - lanza si el destinatario no es la identidad dedicada.
export const recordOutbox = internalMutation({
  args: { email: v.string(), code: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!process.env[TEST_SUPPORT_ENV_VAR]) return null;
    assertDedicatedIdentity(args.email);

    await ctx.db.insert("testOutbox", {
      email: RESET_TEST_EMAIL,
      code: args.code,
      createdAt: Date.now(),
    });
    return null;
  },
});

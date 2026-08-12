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
import { action, internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { KDF_COUNTER_KEY } from "./auth";
import { hashPassword } from "./lib/password";
import { assertServerKey } from "./lib/serverKey";
import { generateOpaqueToken } from "./lib/token";
import { loginCounterKey, normalizeEmailKey, resetAttempts } from "./lib/rateLimit";
import { validatePassword, CURRENT_PASSWORD_POLICY_VERSION } from "./lib/passwordPolicy";
import {
  RESET_TEST_EMAIL,
  SEED_TEST_EMAIL,
  TEST_LOGIN_IP,
  TEST_SUPPORT_ENV_VAR,
} from "./lib/testIdentity";

const FORBIDDEN_IDENTITY = "Identidad no permitida";

// Cerrojo 1. Fail-closed vía assertServerKey (convex/lib/serverKey.ts): sin la
// env var configurada, `expected` es undefined y ningún serverKey puede pasar.
// Lanza "No autorizado", misma implementación en tiempo constante que el resto
// del repo (MIS-288, 1A.5).
function assertTestKey(serverKey: string): void {
  assertServerKey(serverKey, TEST_SUPPORT_ENV_VAR);
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
// Enumeración explícita a propósito: nunca se borra por prefijo. No se tocan las
// claves `ip:`/`resetip:` de IPs REALES (compartidas), pero SÍ la IP sintética
// TEST_LOGIN_IP (de nadie, ver arriba) — sin limpiarla, un bloqueo de IP heredado
// de una ejecución previa daría un falso verde en la prueba 8 (M3).
function rateLimitKeysForTestIdentity(): string[] {
  return [
    RESET_TEST_EMAIL, // login — veto por email (MIS-290)
    loginCounterKey(RESET_TEST_EMAIL), // login — telemetría por email (MIS-290, M1: limpiar AMBAS)
    `reset:${RESET_TEST_EMAIL}`, // solicitudes de código
    `resetcode:${RESET_TEST_EMAIL}`, // intentos de código
    `ip:${TEST_LOGIN_IP}`, // capa por IP de la prueba 8 (IP sintética, segura de limpiar)
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
    // MIS-290 (I6): pasa por la MISMA política que los demás puntos de fijación,
    // aunque 32 bytes aleatorios nunca chocan con el corpus — así no existe un
    // camino que la esquive. Si alguna vez fallara (imposible salvo bug), se corta.
    const policy = validatePassword(password);
    if (!policy.ok) {
      throw new Error("La contraseña de test generada no pasó la política (imposible salvo bug)");
    }
    const passwordHash = await hashPassword(password);
    // El marcador de política se escribe junto al hash (mismo patch/insert).
    const policyFields = {
      passwordPolicyVersion: CURRENT_PASSWORD_POLICY_VERSION,
      passwordChangedAt: Date.now(),
    };

    const existing = await findTestUser(ctx);
    const userId = existing
      ? (await ctx.db.patch(existing._id, { passwordHash, ...policyFields }), existing._id)
      : await ctx.db.insert("users", {
          name: "Reset E2E",
          email: RESET_TEST_EMAIL,
          passwordHash,
          role: "rep",
          ...policyFields,
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
    // MIS-290 (prueba 8): contador de KDF a cero — solo la clave KDF_COUNTER_KEY
    // por su índice (no un scan de toda la tabla).
    const kdfRow = await ctx.db
      .query("testKdfCounter")
      .withIndex("by_key", (q) => q.eq("key", KDF_COUNTER_KEY))
      .unique();
    if (kdfRow) await ctx.db.delete(kdfRow._id);

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

// MIS-290 (prueba 8, I5): lee el contador de derivaciones del KDF. Mismos tres
// cerrojos del harness. La clave es la misma que usa verifyPasswordInstrumented.
export const getKdfCount = query({
  args: { serverKey: v.string(), email: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    assertTestKey(args.serverKey);
    assertDedicatedIdentity(args.email);
    const row = await ctx.db
      .query("testKdfCounter")
      .withIndex("by_key", (q) => q.eq("key", KDF_COUNTER_KEY))
      .unique();
    return row?.count ?? 0;
  },
});

// MIS-290 (I6): versión de política del hash actual de la identidad dedicada —
// para verificar que los puntos de fijación escriben el marcador junto al hash.
export const getPolicyVersion = query({
  args: { serverKey: v.string(), email: v.string() },
  returns: v.union(v.number(), v.null()),
  handler: async (ctx, args) => {
    assertTestKey(args.serverKey);
    assertDedicatedIdentity(args.email);
    const user = await findTestUser(ctx);
    return user?.passwordPolicyVersion ?? null;
  },
});

// MIS-290 (prueba 9, I7): wrappers para provocar la carrera "login en vuelo" de
// forma DETERMINISTA. Inertes sin la credencial del harness (assertTestKey,
// fail-closed) y restringidos a la identidad dedicada. Invocan las funciones
// internas REALES reserveLoginSlot/finalizeLogin (son actions porque una mutation
// no puede runMutation). La prueba: reservar (huella del hash viejo) → cambiar la
// contraseña por recuperación → finalizar con la huella vieja → NO crea sesión.
export const testReserveLoginSlot = action({
  args: { serverKey: v.string(), email: v.string() },
  returns: v.union(
    v.object({ blocked: v.literal(true) }),
    v.object({ blocked: v.literal(false), fingerprint: v.string() }),
  ),
  handler: async (
    ctx,
    args,
  ): Promise<{ blocked: true } | { blocked: false; fingerprint: string }> => {
    assertTestKey(args.serverKey);
    const emailKey = assertDedicatedIdentity(args.email);
    // ipKey null: la prueba de I7 no ejercita la capa por IP.
    const r = await ctx.runMutation(internal.auth.reserveLoginSlot, { emailKey, ipKey: null });
    return r.blocked ? { blocked: true } : { blocked: false, fingerprint: r.fingerprint };
  },
});

export const testFinalizeLogin = action({
  args: { serverKey: v.string(), email: v.string(), fingerprint: v.string(), ok: v.boolean() },
  returns: v.object({ sessionCreated: v.boolean() }),
  handler: async (ctx, args): Promise<{ sessionCreated: boolean }> => {
    assertTestKey(args.serverKey);
    const emailKey = assertDedicatedIdentity(args.email);
    const r = await ctx.runMutation(internal.auth.finalizeLogin, {
      emailKey,
      fingerprint: args.fingerprint,
      ok: args.ok,
    });
    return { sessionCreated: r.success };
  },
});

// Borra la fila de la identidad dedicada — caso "usuario eliminado entre reserva
// y finalización" de la prueba 9. Mutation (borra directamente).
export const testDeleteIdentity = mutation({
  args: { serverKey: v.string(), email: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    assertTestKey(args.serverKey);
    assertDedicatedIdentity(args.email);
    const user = await findTestUser(ctx);
    if (user) await ctx.db.delete(user._id);
    return null;
  },
});

// MIS-290 (M4): limpia la identidad de seed (seedUser lanza si ya existe). Solo
// toca SEED_TEST_EMAIL; la llama testSeedFlow antes y después.
export const deleteSeedUser = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const u = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", SEED_TEST_EMAIL))
      .unique();
    if (u) await ctx.db.delete(u._id);
    return null;
  },
});

// MIS-290 (M4, flujo de alta end-to-end): ejercita los puntos de fijación REALES
// `auth.seedUser` y `auth.accountsPendingRotation`. Siembra la identidad de seed
// con un hash validado y comprueba que la cuenta recién sembrada NO queda
// pendiente de rotación (seedUser escribió `passwordPolicyVersion = CURRENT` en
// el mismo insert que el hash). Inerte sin la credencial del harness; limpia
// antes y después. El rechazo de contraseñas débiles del script se prueba aparte
// (spawn de scripts/hash-password.mjs en el spec).
export const testSeedFlow = action({
  args: { serverKey: v.string() },
  returns: v.object({ inPendingRotation: v.boolean() }),
  handler: async (ctx, args): Promise<{ inPendingRotation: boolean }> => {
    assertTestKey(args.serverKey);
    await ctx.runMutation(internal.testSupport.deleteSeedUser, {});
    const password = generateOpaqueToken();
    const policy = validatePassword(password);
    if (!policy.ok) {
      throw new Error("La password de seed generada no pasó la política (imposible salvo bug)");
    }
    const passwordHash = await hashPassword(password);
    // try/finally: si algo falla tras sembrar, la identidad de seed se borra
    // igualmente y no queda huérfana hasta la siguiente ejecución.
    try {
      await ctx.runMutation(internal.auth.seedUser, {
        name: "Seed E2E",
        email: SEED_TEST_EMAIL,
        passwordHash,
        role: "rep",
      });
      const pending = await ctx.runQuery(internal.auth.accountsPendingRotation, {});
      return { inPendingRotation: pending.some((p) => p.email === SEED_TEST_EMAIL) };
    } finally {
      await ctx.runMutation(internal.testSupport.deleteSeedUser, {});
    }
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

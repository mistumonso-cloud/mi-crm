// MIS-286: pruebas del propio harness, ANTES de que MIS-285 dependa de él.
//
// Corre en el project "chromium-secrets" (sin trace, vídeo ni screenshots):
// aquí circulan contraseñas efímeras válidas y no deben poder quedar en ningún
// artefacto de CI. El gate `npm run test:e2e:secret-gate` demuestra que esa
// política funciona de verdad.

// Todos los specs del project "chromium-secrets" usan este `test` endurecido,
// que limpia los valores del DOM antes de que Playwright genere error-context.md.
// Aquí ningún secreto llega al navegador (todo va por ConvexHttpClient), pero la
// regla se aplica por defecto para que una edición futura no reabra el agujero.
import { makeFunctionReference } from "convex/server";
import { test, expect } from "./helpers/secure-test";
import { convexClient, api } from "./helpers/convex-client";
import {
  RESET_TEST_EMAIL,
  TEST_LOGIN_IP,
  authServerKey,
  countSessionsFor,
  getKdfCount,
  getLastResetCode,
  loginResult,
  loginSucceeds,
  resetTestIdentity,
} from "./helpers/test-support";

test.describe("harness seguro (MIS-286)", () => {
  // Cerrojo 1: sin la credencial correcta no se pasa. Se prueban UNA mutation y
  // UNA query porque todas comparten el mismo guard `assertTestKey`.
  test("rechaza llamadas sin la credencial correcta", async () => {
    const client = convexClient();

    for (const badKey of ["", "clave-incorrecta"]) {
      await expect(
        client.mutation(api.testSupport.resetTestIdentity, {
          serverKey: badKey,
          email: RESET_TEST_EMAIL,
        }),
      ).rejects.toThrow(/No autorizado/);

      await expect(
        client.query(api.testSupport.getLastResetCode, {
          serverKey: badKey,
          email: RESET_TEST_EMAIL,
        }),
      ).rejects.toThrow(/No autorizado/);
    }
  });

  // Cerrojo 2: la credencial correcta NO habilita tocar cuentas reales.
  test("rechaza cualquier identidad que no sea la dedicada", async () => {
    const key = process.env.E2E_TEST_SUPPORT_KEY;
    expect(key, "E2E_TEST_SUPPORT_KEY debe estar configurada").toBeTruthy();

    await expect(
      convexClient().mutation(api.testSupport.resetTestIdentity, {
        serverKey: key!,
        email: "carlos@test.local",
      }),
    ).rejects.toThrow(/Identidad no permitida/);
  });

  // Cerrojo 3 + estado inicial determinista.
  test("el reseed es idempotente y devuelve una contraseña distinta cada vez", async () => {
    const first = await resetTestIdentity();
    const second = await resetTestIdentity();

    expect(second).not.toBe(first);

    // Estado inicial que los specs de MIS-285 pueden dar por supuesto. Se
    // comprueba ANTES de cualquier login: loginWithPassword crea una sesión, así
    // que hacerlo después mediría el efecto del propio test, no el del reseed.
    expect(await countSessionsFor()).toBe(0);
    expect(await getLastResetCode()).toBeNull();

    expect(await loginSucceeds(second)).toBe(true);
    // La anterior deja de valer: el reseed rota la credencial.
    expect(await loginSucceeds(first)).toBe(false);
  });

  // M8: sin esta limpieza, una ejecución que deje el bloqueo puesto haría
  // fallar la siguiente durante 15 minutos. Se omite ipHint a propósito para
  // ejercitar SOLO la clave por usuario, sin tocar el contador de IP compartido.
  test("el reseed limpia el bloqueo de rate limit del login", async () => {
    const password = await resetTestIdentity();

    // loginSucceeds va por loginWithPassword con serverKey (MIS-288): 5 fallos
    // con la contraseña incorrecta agotan el margen por email.
    for (let i = 0; i < 5; i++) {
      await loginSucceeds("contraseña-incorrecta");
    }

    // Bloqueada: ni siquiera la contraseña correcta entra.
    expect(await loginSucceeds(password)).toBe(false);

    const fresh = await resetTestIdentity();
    expect(await loginSucceeds(fresh)).toBe(true);
  });

  // MIS-288 (I3): loginWithPassword rechaza toda llamada sin serverKey válido
  // ANTES de tocar el rate limit. Una llamada directa a Convex sin la clave no
  // puede ni autenticar ni bloquear la cuenta — el rechazo va primero.
  test("loginWithPassword sin serverKey válido se rechaza y no bloquea la cuenta", async () => {
    const password = await resetTestIdentity();
    const client = convexClient();

    // 8 intentos con serverKey incorrecto: si el rechazo NO fuese antes del
    // rate limit, 5+ de estos habrían bloqueado la cuenta.
    for (let i = 0; i < 8; i++) {
      const result = await client.action(api.auth.loginWithPassword, {
        email: RESET_TEST_EMAIL,
        password,
        serverKey: "clave-incorrecta",
      });
      expect(result.success).toBe(false);
    }

    // La cuenta NO quedó bloqueada: el login legítimo sigue entrando.
    expect(await loginSucceeds(password)).toBe(true);
  });

  // MIS-289 (prueba 7b): la mutation pública ANTIGUA `auth.login` está RETIRADA
  // — aquí es donde se cierra I3 para el login por password. Se invoca por
  // referencia dinámica por nombre (NO `api.auth.login`, que ya no existe en la
  // API generada y no compilaría) con argumentos VÁLIDOS: si la función siguiera
  // publicada, unos args válidos NO darían error (devolverían token). El rechazo
  // prueba la retirada, y debe ser por "función inexistente", NO por validación
  // de argumentos (que significaría que la función sigue ahí).
  test("auth.login está retirada: se rechaza por función inexistente, y loginWithPassword sigue viva", async () => {
    const password = await resetTestIdentity();
    const client = convexClient();

    const legacyLogin = makeFunctionReference<"mutation">("auth:login");
    let message = "";
    try {
      await client.mutation(legacyLogin, { email: RESET_TEST_EMAIL, password });
      throw new Error("auth.login RESPONDIÓ — no está retirada");
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    // Semántica "función inexistente", no "argumento inválido": con args válidos,
    // una función aún publicada habría pasado la validación. El patrón se calibró
    // contra el deployment real —`Could not find public function for 'auth:login'.`—
    // y se ancla a "public function" + "auth:login" para que un "not found"
    // genérico de otra causa no satisfaga la prueba. Se afirma sobre el TEXTO, no
    // sobre una clase, porque el cliente puede degradar a Error genérico.
    expect(message, `mensaje inesperado al llamar a auth:login: ${message}`).toMatch(
      /could not find public function[^]*auth:login/i,
    );
    expect(message).not.toMatch(/ArgumentValidationError|required field|Validator error/i);

    // Control positivo: el endpoint NUEVO sigue vivo (no "inexistente").
    const ok = await client.action(api.auth.loginWithPassword, {
      email: RESET_TEST_EMAIL,
      password,
      serverKey: authServerKey(),
    });
    expect(ok.success).toBe(true);
  });

  // MIS-290 (prueba 8, I5): la reserva de cuota por IP acota el KDF. Desde estado
  // limpio (el reseed limpia también la clave ip: sintética y el contador de KDF),
  // 11 logins CONCURRENTES con la contraseña CORRECTA y la misma IP sintética →
  // exactamente 10 crean sesión y 1 se rechaza (cuota de IP 10/15 min), y el KDF
  // corre EXACTAMENTE 10 veces (la 11.ª queda bloqueada en la reserva, ANTES de
  // derivar). Contraseña correcta a propósito: 11 incorrectas "se rechazan" todas
  // y no probarían cuál fue por cuota. La instrumentación del KDF solo existe en
  // dev (doble cerrojo); en producción no cuenta nada.
  test("la cuota por IP acota el KDF: 11 concurrentes correctas → 10 sesiones, 10 derivaciones", async () => {
    const password = await resetTestIdentity();

    const results = await Promise.all(
      Array.from({ length: 11 }, () => loginResult(password, TEST_LOGIN_IP)),
    );
    const ok = results.filter((r) => r.success).length;

    expect(ok).toBe(10);
    expect(results.length - ok).toBe(1);
    // El KDF corrió exactamente 10 veces: es la prueba de I5 (coste acotado).
    expect(await getKdfCount()).toBe(10);
    // Y hay 10 sesiones: los 10 permitidos entraron de verdad.
    expect(await countSessionsFor()).toBe(10);
  });
});

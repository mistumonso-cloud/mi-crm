// MIS-298 (B3): "cerrar sesión en todos los dispositivos" (revocación global bajo
// demanda). Corre en el project "chromium-secrets" (trace/vídeo/screenshot OFF +
// secure-test que limpia inputs del DOM): el caso de UI teclea una contraseña real.
//
// AISLAMIENTO: opera SOLO sobre la identidad dedicada RESET_TEST_EMAIL (el harness
// lo garantiza con assertDedicatedIdentity), así que revocar "todas sus sesiones"
// nunca toca la sesión compartida carlos.json ni las de Marta. Las sesiones se
// minan con testInsertSession (no con loginWithPassword) para controlar el TTL y
// poder crear una sesión EXPIRADA — imposible por la API pública. Toda la
// preparación con estado y la limpieza van en try/finally con resetTestIdentity
// (independiente de los tokens, que en el camino feliz quedan revocados).
import { test, expect } from "./helpers/secure-test";
import { convexClient } from "./helpers/convex-client";
import { api } from "../convex/_generated/api";
import { countSessionsFor, insertSession, resetTestIdentity, RESET_TEST_EMAIL } from "./helpers/test-support";
import { SESSION_COOKIE_NAME } from "../src/lib/auth/constants";

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRED_MS = -60 * 1000; // 1 min en el pasado

function getSessionUser(token: string) {
  return convexClient().query(api.auth.getSessionUser, { token });
}
function logoutAllSessions(token: string) {
  return convexClient().mutation(api.auth.logoutAllSessions, { token });
}

test.describe("logoutAllSessions — revocación global (MIS-298)", () => {
  test("revoca TODAS las sesiones del usuario, no solo la del token", async () => {
    await resetTestIdentity(); // identidad dedicada sembrada, 0 sesiones
    try {
      const a = await insertSession(DAY_MS);
      const b = await insertSession(DAY_MS);
      expect(await countSessionsFor()).toBe(2);
      expect(await getSessionUser(a)).not.toBeNull();
      expect(await getSessionUser(b)).not.toBeNull();

      await logoutAllSessions(a);

      expect(await countSessionsFor()).toBe(0);
      expect(await getSessionUser(a)).toBeNull();
      expect(await getSessionUser(b)).toBeNull(); // revoca MÁS que la "actual"
    } finally {
      await resetTestIdentity();
    }
  });

  test("un token EXPIRADO no revoca ninguna sesión vigente (no-op exacto)", async () => {
    await resetTestIdentity();
    try {
      const expired = await insertSession(EXPIRED_MS);
      const valid = await insertSession(DAY_MS);
      const before = await countSessionsFor(); // 2 (la expirada sigue en BD hasta el cron)
      expect(before).toBe(2);
      expect(await getSessionUser(expired)).toBeNull(); // control: ya no autentica (expirada)

      await logoutAllSessions(expired);

      expect(await countSessionsFor()).toBe(before); // igualdad EXACTA: no-op
      expect(await getSessionUser(valid)).not.toBeNull(); // la vigente sobrevive
    } finally {
      await resetTestIdentity();
    }
  });

  test("un token DESCONOCIDO es no-op", async () => {
    await resetTestIdentity();
    try {
      const valid = await insertSession(DAY_MS);
      const before = await countSessionsFor(); // 1
      await logoutAllSessions("token-inexistente-xyz");
      expect(await countSessionsFor()).toBe(before);
      expect(await getSessionUser(valid)).not.toBeNull();
    } finally {
      await resetTestIdentity();
    }
  });

  test("el botón 'Cerrar en todos los dispositivos' revoca todo y desloguea (UI)", async ({
    page,
    context,
  }) => {
    const password = await resetTestIdentity();
    try {
      // 1. Login por navegador con la identidad dedicada (sesión del jar).
      await page.goto("/login");
      await page.getByLabel("Email").fill(RESET_TEST_EMAIL);
      // Selector por name (mismo motivo que auth.setup.ts / session-cookie.spec.ts).
      await page.locator('input[name="password"]').fill(password);
      await page.getByRole("button", { name: "Entrar" }).click();
      await page.waitForURL("/pendientes");

      // 2. La cookie de sesión ACTUAL está presente antes de nada.
      const beforeCookies = await context.cookies();
      expect(beforeCookies.find((c) => c.name === SESSION_COOKIE_NAME)).toBeTruthy();

      // 3. Crear la OTRA sesión DESPUÉS del login (orden aprobado en el plan).
      const other = await insertSession(DAY_MS);

      // 4. Precondición: `other` está VIGENTE justo antes de pulsar (y hay 2 sesiones);
      //    así, si luego resulta null, la causa es el botón, no un estado previo.
      expect(await getSessionUser(other)).not.toBeNull();
      expect(await countSessionsFor()).toBe(2);

      // 5. Pulsar el botón por su nombre accesible EXACTO (no colisiona con "Cerrar sesión").
      await page.getByRole("button", { name: "Cerrar en todos los dispositivos" }).click();
      await page.waitForURL(/\/login/);

      // 6. La cookie desaparece del jar (por constante) y la OTRA sesión quedó revocada.
      const afterCookies = await context.cookies();
      expect(afterCookies.find((c) => c.name === SESSION_COOKIE_NAME)).toBeUndefined();
      expect(await getSessionUser(other)).toBeNull();
    } finally {
      // Limpieza independiente del token del navegador (ya revocado en el camino feliz).
      await resetTestIdentity();
    }
  });
});

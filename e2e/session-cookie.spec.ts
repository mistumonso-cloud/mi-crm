// MIS-293 (B1/B2): ciclo SET → CLEAR de la cookie de sesión `__Host-session`.
//
// Corre en el project "chromium-secrets" (trace/vídeo/screenshot OFF) porque
// teclea una contraseña real (E2E_CARLOS_PASSWORD) en el formulario de login —
// misma disciplina anti-fuga que password-reset.spec.ts.
//
// Usa una sesión DESECHABLE (login fresco propio) para NO invalidar la sesión
// compartida de e2e/.auth/carlos.json: esa sesión la reutilizan las specs de Marta
// vía carlosTokenFromDisk(), y un logout la borraría en servidor. Por eso este
// ciclo NO vive en full-flow.spec.ts (chromium-carlos, storageState compartido).
//
// Concurrencia: playwright.config.ts fija `fullyParallel: false` y `workers: 1`,
// así que NADA corre en paralelo — este spec no compite con test-support.spec.ts
// ni password-reset*.spec.ts. Además, la identidad de Carlos se usa aquí SOLO para
// un login/logout desechable (no muta datos ni su contraseña), y es DISTINTA de la
// identidad dedicada de reset (RESET_TEST_EMAIL) que usan esos otros specs.
import { test, expect } from "./helpers/secure-test";
import { convexClient } from "./helpers/convex-client";
import { api } from "../convex/_generated/api";
import { SESSION_COOKIE_NAME } from "../src/lib/auth/constants";

test.describe("cookie de sesión __Host-session (MIS-293)", () => {
  test("login fija __Host-session (Secure, host-only) y borra una 'session' legada; logout la retira", async ({
    page,
    context,
    baseURL,
  }) => {
    const email = process.env.E2E_CARLOS_EMAIL;
    const password = process.env.E2E_CARLOS_PASSWORD;
    if (!email || !password) {
      throw new Error("Faltan E2E_CARLOS_EMAIL/E2E_CARLOS_PASSWORD — copia .env.test.local.example a .env.test.local");
    }

    // Cookie de sesión ANTIGUA preexistente: el login debe borrarla (M1, vía login).
    await context.addCookies([{ name: "session", value: "token-legado-de-prueba", url: baseURL! }]);

    try {
      await page.goto("/login");
      await page.getByLabel("Email").fill(email);
      // Selector inequívoco por name (mismo motivo que auth.setup.ts).
      await page.locator('input[name="password"]').fill(password);
      await page.getByRole("button", { name: "Entrar" }).click();
      await page.waitForURL("/pendientes");

      // SET: el login fijó __Host-session con Secure y Path=/ (su presencia bajo el
      // prefijo prueba que Chromium la aceptó como host-only + Secure).
      const afterLogin = await context.cookies();
      const host = afterLogin.find((c) => c.name === "__Host-session");
      expect(host, "el login debe fijar __Host-session").toBeTruthy();
      expect(host!.secure).toBe(true);
      expect(host!.path).toBe("/");
      // La 'session' legada fue borrada por setSessionCookie.
      expect(afterLogin.find((c) => c.name === "session")).toBeUndefined();

      // CLEAR: logout retira __Host-session.
      await page.getByRole("button", { name: "Cerrar sesión" }).click();
      await page.waitForURL(/\/login/);
      const afterLogout = await context.cookies();
      expect(afterLogout.find((c) => c.name === SESSION_COOKIE_NAME)).toBeUndefined();
    } finally {
      // Best-effort: si una aserción falló ANTES del logout, la sesión desechable
      // seguiría viva en servidor. Se cierra por su token (context.cookies() lee
      // cookies httpOnly) para no acumular filas en el deployment compartido. Se
      // ignora cualquier fallo: NO enmascara el error primario del test.
      try {
        const c = (await context.cookies()).find((x) => x.name === SESSION_COOKIE_NAME);
        if (c) await convexClient().mutation(api.auth.logout, { token: c.value });
      } catch {
        /* best-effort */
      }
    }
  });
});

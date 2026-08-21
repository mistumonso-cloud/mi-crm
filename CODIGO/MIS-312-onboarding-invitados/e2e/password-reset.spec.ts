// MIS-285: flujo UI completo de recuperación de contraseña por código.
//
// Corre en el project "chromium-secrets" (MIS-286): aquí circula la
// contraseña efímera de la identidad dedicada y la nueva contraseña que fija
// el propio spec, ninguna de las dos como literal — ambas se generan en
// tiempo de ejecución. "la contraseña nueva funciona" / "la vieja ya no" se
// comprueban con ConvexHttpClient (loginSucceeds), NO rellenando el
// formulario de login: lo único que se teclea en la UI es la contraseña
// nueva del formulario de restablecimiento, que es la funcionalidad bajo
// prueba (ver PLANS/MIS-285-recuperacion-contrasena-plan.md, "Manejo del
// secreto").
import { randomBytes } from "node:crypto";
import { test, expect } from "./helpers/secure-test";
import {
  RESET_TEST_EMAIL,
  OVERSIZED_TEST_EMAIL,
  MAX_EMAIL_LENGTH,
  getLastResetCode,
  loginSucceeds,
  resetTestIdentity,
  oversizedLoginAttempt,
  countOversizedLoginAttempts,
  countCurrentPasswordChangedNotices,
} from "./helpers/test-support";
import { RESET_TICKET_COOKIE_NAME } from "../src/lib/auth/constants";

function freshPassword(): string {
  return randomBytes(24).toString("base64url");
}

async function waitForResetCode(): Promise<string> {
  await expect
    .poll(async () => await getLastResetCode(), {
      message: "esperando a que deliverResetCode escriba el código en el outbox de test",
      timeout: 10_000,
    })
    .not.toBeNull();
  const code = await getLastResetCode();
  if (!code) throw new Error("getLastResetCode() devolvió null tras superar el poll");
  return code;
}

test.describe("recuperación de contraseña por código (MIS-285)", () => {
  test("pedir código → verificarlo → fijar nueva contraseña → /login?reset=ok", async ({ page }) => {
    const oldPassword = await resetTestIdentity();
    const newPassword = freshPassword();

    await page.goto("/recuperar-contrasena");
    await page.getByLabel("Email").fill(RESET_TEST_EMAIL);
    await page.getByRole("button", { name: "Enviar código" }).click();

    await expect(page.getByLabel("Código")).toBeVisible();

    const code = await waitForResetCode();
    await page.getByLabel("Código").fill(code);
    await page.getByRole("button", { name: "Continuar" }).click();

    await expect(page.getByLabel("Nueva contraseña")).toBeVisible();

    // MIS-292 (M3): el ticket vive SOLO en una cookie httpOnly, no en el cliente.
    // Se inspeccionan METADATOS de la cookie (nunca su valor).
    const ticketCookie = (await page.context().cookies()).find(
      (c) => c.name === RESET_TICKET_COOKIE_NAME,
    );
    expect(ticketCookie, "la cookie del ticket debe existir en el paso de contraseña").toBeTruthy();
    expect(ticketCookie!.httpOnly).toBe(true);
    // MIS-293 (B1/B2): Secure siempre + nombre con prefijo `__Secure-`. Se fija el
    // literal exacto (detecta un rename mal hecho en la constante); su aceptación
    // por el navegador prueba que se emitió con `Secure`.
    expect(ticketCookie!.secure).toBe(true);
    // MIS-312: `path:"/"` (para servir también a /configurar-contrasena) → sube a
    // prefijo `__Host-`. Se fija el literal exacto (detecta un rename mal hecho).
    expect(ticketCookie!.name).toBe("__Host-reset_ticket");
    expect(ticketCookie!.sameSite).toBe("Lax");
    expect(ticketCookie!.path).toBe("/");
    // maxAge 15 min → expires ≈ ahora + 900 s (con tolerancia amplia).
    const nowSec = Date.now() / 1000;
    expect(ticketCookie!.expires).toBeGreaterThan(nowSec + 800);
    expect(ticketCookie!.expires).toBeLessThan(nowSec + 1000);
    // Inaccesible a JavaScript y sin hidden input en el DOM.
    const jsCookies = await page.evaluate(() => document.cookie);
    expect(jsCookies).not.toContain(RESET_TICKET_COOKIE_NAME);
    await expect(page.locator('input[name="ticket"]')).toHaveCount(0);

    await page.getByLabel("Nueva contraseña").fill(newPassword);
    await page.getByLabel("Repite la contraseña").fill(newPassword);
    await page.getByRole("button", { name: "Guardar nueva contraseña" }).click();

    await page.waitForURL(/\/login\?reset=ok/);
    await expect(page.getByText("Contraseña guardada")).toBeVisible();

    expect(await loginSucceeds(newPassword)).toBe(true);
    expect(await loginSucceeds(oldPassword)).toBe(false);

    // MIS-292 (M3): tras el reset con éxito, la cookie del ticket se borró.
    const cookieAfter = (await page.context().cookies()).find(
      (c) => c.name === RESET_TICKET_COOKIE_NAME,
    );
    expect(cookieAfter, "la cookie del ticket debe borrarse tras el reset").toBeFalsy();

    // MIS-292 (M4): el cambio consumado programó y ejecutó EXACTAMENTE un aviso,
    // correlacionado con este reset (no un contador global por email). Polling
    // porque deliverPasswordChangedEmail corre en un scheduler asíncrono.
    await expect
      .poll(async () => await countCurrentPasswordChangedNotices(), {
        message: "esperando a que deliverPasswordChangedEmail registre el marcador del aviso",
        timeout: 10_000,
      })
      .toBe(1);
  });

  // MIS-292 (M1): un email >254 en el login se rechaza ANTES de tocar
  // loginAttempts. La prueba es determinista: cuenta filas para las dos claves
  // de la identidad sobredimensionada y exige 0 (con el código vulnerable
  // llegaría a finalizeLogin y dejaría ≥1).
  test("login con email >254 no escribe ninguna fila en loginAttempts (M1)", async () => {
    // Red de seguridad del fixture: que un cambio de sufijo no lo deje válido.
    expect(OVERSIZED_TEST_EMAIL.length).toBeGreaterThan(MAX_EMAIL_LENGTH);

    await resetTestIdentity(); // limpia también las dos claves oversized
    expect(await countOversizedLoginAttempts()).toBe(0);

    const result = await oversizedLoginAttempt();
    expect(result.success).toBe(false);
    // S-292-B1: fija el contrato del copy exacto, no solo el booleano, para
    // atrapar futuras regresiones del mensaje (GENERIC_ERROR en auth.ts).
    expect(result.error).toBe("Email o contraseña incorrectos");

    expect(await countOversizedLoginAttempts()).toBe(0);
  });
});

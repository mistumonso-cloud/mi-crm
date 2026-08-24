// MIS-312: onboarding de primera contraseña para invitados (/configurar-contrasena).
// Reutiliza el motor de código+ticket de MIS-285, así que corre en el project
// "chromium-secrets" (circula la contraseña efímera de la identidad dedicada y la
// nueva que fija el propio spec, ninguna como literal). Cubre: el wizard en la
// ruta nueva, los atributos de la cookie del ticket (`__Host-`, path `/`) y su
// ausencia tras consumir.
// MIS-315: retirada la compatibilidad transitoria de la migración de MIS-312. Se
// sustituyeron los dos tests de migración (lectura dual / transición) por una
// prueba NEGATIVA que fija el contrato nuevo: un ticket que solo vive en el nombre
// antiguo (`__Secure-reset_ticket`) ya NO autoriza el cambio de contraseña.
import { randomBytes } from "node:crypto";
import { test, expect } from "./helpers/secure-test";
import { RESET_TEST_EMAIL, getLastResetCode, loginSucceeds, resetTestIdentity } from "./helpers/test-support";

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

// Avanza el wizard (en la ruta dada) hasta el paso de contraseña, dejando emitido
// el ticket nuevo en `__Host-reset_ticket`. No devuelve nada (Promise<void>): quien
// necesite el valor del ticket lo lee con `context.cookies()` (Playwright lee
// cookies httpOnly). El botón del paso 1 depende del copy de cada ruta.
async function advanceToPasswordStep(
  page: import("@playwright/test").Page,
  route: string,
  sendCodeButton: string,
): Promise<void> {
  await page.goto(route);
  await page.getByLabel("Email").fill(RESET_TEST_EMAIL);
  await page.getByRole("button", { name: sendCodeButton }).click();
  const code = await waitForResetCode();
  await page.getByLabel("Código").fill(code);
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByLabel("Nueva contraseña")).toBeVisible();
}

test.describe("onboarding de primera contraseña (MIS-312)", () => {
  test("bienvenida con email prellenado → código → crear contraseña → /login?reset=ok", async ({ page }) => {
    const oldPassword = await resetTestIdentity();
    const newPassword = freshPassword();

    // Se llega con el email prellenado desde el enlace de la invitación.
    await page.goto(`/configurar-contrasena?email=${encodeURIComponent(RESET_TEST_EMAIL)}`);
    await expect(page.getByRole("heading", { name: "Te damos la bienvenida" })).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveValue(RESET_TEST_EMAIL);

    await page.getByRole("button", { name: "Enviar código" }).click();
    await expect(page.getByLabel("Código")).toBeVisible();

    const code = await waitForResetCode();
    await page.getByLabel("Código").fill(code);
    await page.getByRole("button", { name: "Continuar" }).click();

    await expect(page.getByLabel("Nueva contraseña")).toBeVisible();

    // Atributos de la cookie del ticket (MIS-312: `__Host-`, path `/`).
    const ticketCookie = (await page.context().cookies()).find((c) => c.name === "__Host-reset_ticket");
    expect(ticketCookie, "la cookie del ticket debe existir en el paso de contraseña").toBeTruthy();
    expect(ticketCookie!.httpOnly).toBe(true);
    expect(ticketCookie!.secure).toBe(true);
    expect(ticketCookie!.sameSite).toBe("Lax");
    expect(ticketCookie!.path).toBe("/");
    const nowSec = Date.now() / 1000;
    expect(ticketCookie!.expires).toBeGreaterThan(nowSec + 700); // ~15 min con tolerancia amplia
    expect(ticketCookie!.expires).toBeLessThan(nowSec + 1000);
    // Inaccesible a JavaScript.
    const jsCookies = await page.evaluate(() => document.cookie);
    expect(jsCookies).not.toContain("__Host-reset_ticket");

    await page.getByLabel("Nueva contraseña").fill(newPassword);
    await page.getByLabel("Repite la contraseña").fill(newPassword);
    await page.getByRole("button", { name: "Crear contraseña" }).click();

    await page.waitForURL(/\/login\?reset=ok/);
    await expect(page.getByText("Contraseña guardada")).toBeVisible();

    // La contraseña nueva funciona (y la vieja ya no) — vía ConvexHttpClient, sin teclear en login.
    expect(await loginSucceeds(newPassword)).toBe(true);
    expect(await loginSucceeds(oldPassword)).toBe(false);

    // Tras consumir el ticket, su cookie se borró.
    const cookieAfter = (await page.context().cookies()).find((c) => c.name === "__Host-reset_ticket");
    expect(cookieAfter, "la cookie del ticket debe borrarse tras crear la contraseña").toBeFalsy();
  });

  // MIS-315: prueba NEGATIVA del contrato nuevo. Antes (MIS-312) un ticket que solo
  // vivía en `__Secure-reset_ticket` completaba el cambio por lectura dual; retirada
  // esa compatibilidad, ese mismo estado ya NO debe autorizar nada.
  test("MIS-315: un ticket que solo vive en el nombre antiguo (__Secure-reset_ticket) ya NO autoriza", async ({
    page,
    context,
  }) => {
    const oldPassword = await resetTestIdentity();
    const newPassword = freshPassword();

    // Llega al paso de contraseña por el flujo normal → el ticket VÁLIDO queda en
    // __Host-reset_ticket. Se lee su valor (Playwright lee cookies httpOnly).
    await advanceToPasswordStep(page, "/recuperar-contrasena", "Enviar código");
    const host = (await context.cookies()).find((c) => c.name === "__Host-reset_ticket");
    expect(host, "debería existir __Host-reset_ticket tras verificar").toBeTruthy();
    const ticket = host!.value;

    // Reproduce el estado que MIS-315 deja de soportar: el ticket (válido en el
    // servidor, aún sin consumir) vive SOLO en la cookie ANTIGUA
    // `__Secure-reset_ticket` (path estrecho), sin `__Host-`.
    await context.clearCookies();
    await context.addCookies([
      {
        name: "__Secure-reset_ticket",
        value: ticket,
        domain: "localhost",
        path: "/recuperar-contrasena",
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ]);

    // Al enviar la contraseña, readResetTicketCookie ya NO cae al nombre antiguo →
    // el ticket llega vacío → resetPasswordAction devuelve error y NO redirige.
    await page.getByLabel("Nueva contraseña").fill(newPassword);
    await page.getByLabel("Repite la contraseña").fill(newPassword);
    await page.getByRole("button", { name: "Guardar nueva contraseña" }).click();

    // Señal INEQUÍVOCA de que la Server Action terminó (y falló): el ticket vacío
    // hace que resetPasswordWithTicket devuelva {ok:false} → se pinta el ErrorBox
    // (role="alert"). Esperarlo evita una carrera al comprobar la URL/credenciales.
    await expect(page.getByRole("alert")).toBeVisible();
    // No hubo redirect al éxito: seguimos en el paso de contraseña.
    await expect(page).not.toHaveURL(/\/login\?reset=ok/);

    // Contrato duro (vía ConvexHttpClient, independiente del render): la contraseña
    // NO cambió — la nueva no entra y la anterior sigue valiendo.
    expect(await loginSucceeds(newPassword)).toBe(false);
    expect(await loginSucceeds(oldPassword)).toBe(true);
  });
});

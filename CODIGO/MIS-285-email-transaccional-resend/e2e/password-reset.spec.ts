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
    await page.getByLabel("Nueva contraseña").fill(newPassword);
    await page.getByLabel("Repite la contraseña").fill(newPassword);
    await page.getByRole("button", { name: "Guardar nueva contraseña" }).click();

    await page.waitForURL(/\/login\?reset=ok/);
    await expect(page.getByText("Contraseña actualizada")).toBeVisible();

    expect(await loginSucceeds(newPassword)).toBe(true);
    expect(await loginSucceeds(oldPassword)).toBe(false);
  });
});

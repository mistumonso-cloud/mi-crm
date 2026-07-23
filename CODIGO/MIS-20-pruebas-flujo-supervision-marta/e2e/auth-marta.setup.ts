import { test as setup, expect } from "@playwright/test";

const authFile = "e2e/.auth/marta.json";

setup("log in as Marta", async ({ page }) => {
  const email = process.env.E2E_MARTA_EMAIL;
  const password = process.env.E2E_MARTA_PASSWORD;
  if (!email || !password) {
    throw new Error("Faltan E2E_MARTA_EMAIL/E2E_MARTA_PASSWORD — copia .env.test.local.example a .env.test.local");
  }

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  // Mismo motivo que en auth.setup.ts: getByLabel("Contraseña") es
  // ambiguo (el <label> de Input.jsx envuelve también el botón-sufijo
  // "Mostrar contraseña"). Selector inequívoco por name.
  await page.locator('input[name="password"]').fill(password);

  await page.getByRole("button", { name: "Entrar" }).click();
  // waitForURL, no solo el submit — mismo motivo que auth.setup.ts. El
  // dispatcher (src/app/(app)/page.tsx) manda a "supervisor" a /panel, no
  // a /pendientes como a Carlos.
  await page.waitForURL("/panel");

  await expect(page.getByRole("heading", { name: /Hola, Marta/ })).toBeVisible();
  await expect(page.getByText("Supervisora")).toBeVisible();

  await page.context().storageState({ path: authFile });
});

import { test as setup, expect } from "@playwright/test";

const authFile = "e2e/.auth/carlos.json";

setup("log in as Carlos", async ({ page }) => {
  const email = process.env.E2E_CARLOS_EMAIL;
  const password = process.env.E2E_CARLOS_PASSWORD;
  if (!email || !password) {
    throw new Error("Faltan E2E_CARLOS_EMAIL/E2E_CARLOS_PASSWORD — copia .env.test.local.example a .env.test.local");
  }

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  // OJO: getByLabel("Contraseña") es ambiguo — el <label> de Input.jsx
  // envuelve tanto el <input> como el botón-sufijo "Mostrar contraseña",
  // y ambos matchean por subcadena ("Contraseña" está contenido en el
  // nombre accesible compuesto del input, y el botón tiene su propio
  // aria-label="Mostrar contraseña"). Selector inequívoco por name.
  await page.locator('input[name="password"]').fill(password);

  await page.getByRole("button", { name: "Entrar" }).click();
  // waitForURL, no solo el submit: los Server Actions de Next 16 no
  // resuelven como una navegación cliente normal — hay que esperar
  // explícitamente la URL final en vez de asumir que el click ya navegó.
  await page.waitForURL("/pendientes");

  await expect(page.getByRole("heading", { name: /Hola, Carlos/ })).toBeVisible();

  // MIS-293 (B1/B2): el login fija la cookie de sesión con el prefijo `__Host-`.
  // La MERA PRESENCIA de una cookie con ese prefijo es la acreditación FUERTE de
  // host-only: Chromium rechaza el prefijo `__Host-` por completo si a la cookie le
  // falta `Secure`, lleva `Domain`, o su `path` no es `/` — en ese caso no
  // aparecería aquí (y el resto de la suite autenticada fallaría). Se usa el literal
  // esperado para detectar además un rename mal hecho en la constante.
  const sessionCookie = (await page.context().cookies()).find((c) => c.name === "__Host-session");
  expect(sessionCookie, "el login debe fijar la cookie __Host-session").toBeTruthy();
  expect(sessionCookie!.secure).toBe(true);
  expect(sessionCookie!.path).toBe("/");

  await page.context().storageState({ path: authFile });
});

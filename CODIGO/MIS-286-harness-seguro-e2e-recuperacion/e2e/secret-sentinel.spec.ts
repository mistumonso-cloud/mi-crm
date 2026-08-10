// MIS-286: spec del GATE de fugas. FALLA A PROPÓSITO.
//
// No pertenece a ningún project de playwright.config.ts (que además lo excluye
// con testIgnore): solo lo ejecuta scripts/check-secret-leak.mjs a través de
// playwright.gate.config.ts. Si algún día apareciera en `npm run test:e2e`,
// rompería el e2e normal — por eso el doble aislamiento.
//
// Qué hace: teclea un valor centinela en un campo de contraseña real y luego
// falla, para forzar a Playwright a conservar los artefactos del fallo. El
// script comprueba después si el centinela quedó grabado en ellos.
//   - Fase A (project con trace ON): DEBE aparecer → demuestra que el escáner
//     detecta fugas de verdad.
//   - Fase B (project sin captura): NO debe aparecer → es la garantía de B1.
//
// El centinela es una cadena aleatoria sin valor, no una credencial real.

// Usa el `test` endurecido de los specs con secretos: es EXACTAMENTE la misma
// protección que el gate debe demostrar, no una versión especial para el gate.
import { test, expect } from "./helpers/secure-test";

test("centinela: teclea un secreto y falla a propósito", async ({ page }) => {
  const sentinel = process.env.SECRET_SENTINEL;
  if (!sentinel) throw new Error("Falta SECRET_SENTINEL — este spec solo lo ejecuta el gate");

  await page.goto("/login");
  await page.locator('input[name="password"]').fill(sentinel);

  // Fallo intencional: es la única forma de que Playwright conserve la traza
  // con `retain-on-failure` y de que haya artefactos que escanear.
  expect(true, "fallo intencional del gate de fugas").toBe(false);
});

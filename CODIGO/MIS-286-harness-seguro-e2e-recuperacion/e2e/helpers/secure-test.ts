// MIS-286: `test` endurecido para los specs que manejan secretos.
//
// POR QUÉ HACE FALTA, ADEMÁS DE DESACTIVAR trace/vídeo/screenshot
// Playwright escribe `error-context.md` SIEMPRE que un test falla
// (node_modules/playwright/lib/index.js → didFinishTest), y ese fichero incluye
// un "page snapshot" en ARIA. Ese snapshot contiene el VALOR de los inputs en
// claro — también el de un `input[type=password]`. No lo controla ninguna
// opción de captura y no existe flag para desactivarlo, así que poner
// `trace: "off"` NO basta: una contraseña tecleada acabaría en un artefacto que
// CI publica durante 14 días.
//
// CÓMO SE CIERRA
// Un fixture automático que, al terminar el test, vacía el valor de todos los
// inputs de la página. Playwright toma el page snapshot en el teardown de su
// propio fixture `_setupArtifacts`, que se desmonta DESPUÉS que este (los
// fixtures se desmontan en orden inverso al de montaje, y este depende de
// `page`), de modo que el snapshot se genera ya sin valores.
//
// El fichero `error-context.md` sigue existiendo y conserva su utilidad para
// depurar (estructura de la página, error, código fuente): lo único que
// desaparece son los valores tecleados.
//
// Esto NO se sostiene por convención: `npm run test:e2e:secret-gate` lo
// demuestra en cada ejecución con un centinela real.

import { test as base } from "@playwright/test";

export const test = base.extend<{ scrubSecretsFromDom: void }>({
  scrubSecretsFromDom: [
    async ({ page }, use) => {
      await use();
      try {
        await page.evaluate(() => {
          for (const input of Array.from(document.querySelectorAll("input"))) {
            input.value = "";
          }
        });
      } catch {
        // La página puede estar ya cerrada (o el contexto caído) cuando el test
        // falla de forma abrupta: en ese caso tampoco hay snapshot que limpiar.
      }
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";

// MIS-301: HSTS completo (includeSubDomains). Corre en "chromium-unauth" (sin
// sesión) y usa el fixture `request` (HTTP crudo) para inspeccionar la cabecera de
// respuesta. `next.config.ts` `headers()` emite el HSTS con independencia del
// entorno (los navegadores lo ignoran sobre http/localhost, pero la CABECERA se
// envía y es inspeccionable), así que `npm run dev` ya la sirve.
//
// Fija el contrato exacto con `headersArray()` (no `headers()`, que combinaría
// duplicados en un solo valor): debe existir EXACTAMENTE UNA cabecera HSTS.
import { test, expect } from "@playwright/test";

test.describe("HSTS (MIS-301)", () => {
  test("exactamente UNA cabecera Strict-Transport-Security = max-age=2años + includeSubDomains, sin preload", async ({
    request,
  }) => {
    const res = await request.get("/login");
    const hsts = res
      .headersArray()
      .filter((h) => h.name.toLowerCase() === "strict-transport-security");
    expect(hsts.length, "debe haber EXACTAMENTE una cabecera HSTS").toBe(1);
    expect(hsts[0].value).toBe("max-age=63072000; includeSubDomains");
    // Decisión consciente: preload FUERA (casi irreversible). Redundante con el
    // toBe anterior, pero deja explícita la intención.
    expect(hsts[0].value).not.toContain("preload");
  });
});

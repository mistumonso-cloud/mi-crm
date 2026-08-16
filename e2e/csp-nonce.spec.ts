// MIS-300 (M2): CSP con nonce por petición. Corre en "chromium-unauth" (sin
// sesión) y usa el fixture `request` (HTTP crudo, sin ejecutar JS) para inspeccionar
// la CABECERA CSP y el HTML servido por el servidor.
//
// Verifica que el proxy emite una CSP con nonce fresco cuyo `script-src` no lleva
// 'unsafe-inline', y que Next inyecta ese MISMO nonce en todos sus <script>
// ejecutables — tanto en una ruta dinámica (/login) como en una 404: esto último
// prueba que el render dinámico global (await connection() en el root layout)
// alcanza también la not-found por defecto (si siguiera estática, su HTML no
// tendría el nonce del request y no coincidiría).
//
// LÍMITE (dev): el e2e corre con `npm run dev` (NODE_ENV != production), donde
// `script-src` incluye además 'unsafe-eval'; su AUSENCIA es prod-only y se cubre
// con el build + el smoke de producción, no aquí.
import { test, expect } from "@playwright/test";

// Devuelve el token-list del directivo pedido. Tolerante a espacios repetidos y a
// mayúsculas/minúsculas en el NOMBRE del directivo (parseo por directiva, no regex
// global: así `style-src 'unsafe-inline'` no se confunde con `script-src`).
function directiveTokens(csp: string, directive: string): string[] | null {
  for (const part of csp.split(";")) {
    const trimmed = part.trim().replace(/\s+/g, " ");
    if (!trimmed) continue;
    const [name, ...tokens] = trimmed.split(" ");
    if (name.toLowerCase() === directive.toLowerCase()) return tokens;
  }
  return null;
}

// Nonce del directivo `script-src` (alfabeto base64 completo, incl. + / =).
function nonceFromScriptSrc(csp: string): string {
  const tokens = directiveTokens(csp, "script-src");
  expect(tokens, "la CSP debe tener un directivo script-src").not.toBeNull();
  const tok = tokens!.find((t) => /^'nonce-[A-Za-z0-9+/=]+'$/.test(t));
  expect(tok, "script-src debe llevar un 'nonce-…'").toBeTruthy();
  return tok!.slice("'nonce-".length, -1);
}

// Debe haber EXACTAMENTE una cabecera CSP (detecta que la CSP estática de
// next.config.ts no sobrevivió y que no hay doble política).
function singleCsp(headersArray: { name: string; value: string }[]): string {
  const csps = headersArray.filter((h) => h.name.toLowerCase() === "content-security-policy");
  expect(csps.length, "debe existir EXACTAMENTE una cabecera Content-Security-Policy").toBe(1);
  return csps[0].value;
}

// <script> EJECUTABLES del HTML (excluye los de datos, p.ej. type="application/json").
function executableScriptTags(html: string): string[] {
  return (html.match(/<script\b[^>]*>/gi) ?? []).filter(
    (tag) => !/\btype\s*=\s*"[^"]*json[^"]*"/i.test(tag),
  );
}

// Comprueba: al menos un <script> ejecutable (no vacío), cada uno con EXACTAMENTE
// un nonce, todos iguales al del header, y ninguno con un nonce distinto.
function expectAllScriptsCarryNonce(html: string, headerNonce: string): void {
  const tags = executableScriptTags(html);
  expect(tags.length, "debe haber al menos un <script> ejecutable").toBeGreaterThan(0);
  for (const tag of tags) {
    const matches = [...tag.matchAll(/\bnonce="([^"]*)"/gi)];
    expect(matches.length, `un <script> sin (o con más de un) nonce: ${tag}`).toBe(1);
    expect(matches[0][1]).toBe(headerNonce);
  }
}

test.describe("CSP con nonce por petición (MIS-300)", () => {
  test("/login: script-src con nonce+strict-dynamic sin unsafe-inline; todos los <script> con el nonce", async ({
    request,
  }) => {
    const res = await request.get("/login");
    expect(res.status()).toBe(200);

    const csp = singleCsp(res.headersArray());
    const tokens = directiveTokens(csp, "script-src")!;
    expect(tokens).toContain("'strict-dynamic'");
    expect(tokens).not.toContain("'unsafe-inline'");
    // El nonce va en la CSP y en el HTML, NO como cabecera de respuesta suelta.
    expect(res.headers()["x-nonce"]).toBeUndefined();

    const headerNonce = nonceFromScriptSrc(csp);
    expectAllScriptsCarryNonce(await res.text(), headerNonce);
  });

  test("404 not-found: dinámica y con nonce coherente (M1)", async ({ request }) => {
    const res = await request.get("/__e2e_csp_missing_mis300");
    expect(res.status()).toBe(404);

    const csp = singleCsp(res.headersArray());
    const tokens = directiveTokens(csp, "script-src")!;
    expect(tokens).toContain("'strict-dynamic'");
    expect(tokens).not.toContain("'unsafe-inline'");

    const headerNonce = nonceFromScriptSrc(csp);
    // Si la not-found siguiera prerenderizada estática, su HTML no traería el
    // nonce de ESTE request y esta aserción fallaría.
    expectAllScriptsCarryNonce(await res.text(), headerNonce);
  });

  test("frescura: dos peticiones → nonces distintos, cada header coincide con SU html", async ({
    request,
  }) => {
    const r1 = await request.get("/login");
    const r2 = await request.get("/login");
    const n1 = nonceFromScriptSrc(singleCsp(r1.headersArray()));
    const n2 = nonceFromScriptSrc(singleCsp(r2.headersArray()));
    expect(n1).not.toBe(n2);
    expectAllScriptsCarryNonce(await r1.text(), n1);
    expectAllScriptsCarryNonce(await r2.text(), n2);
  });

  test("/api/health (salida temprana): conserva X-Frame-Options y NO lleva CSP", async ({
    request,
  }) => {
    const res = await request.get("/api/health");
    const headers = res.headers();
    // Las demás cabeceras de next.config.ts siguen presentes…
    expect(headers["x-frame-options"]).toBe("DENY");
    // …y la CSP solo la pone el proxy en la ruta de éxito HTML (health sale antes).
    expect(headers["content-security-policy"]).toBeUndefined();
  });
});

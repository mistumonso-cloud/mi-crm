import { test, expect } from "@playwright/test";
import { SESSION_COOKIE_NAME } from "../src/lib/auth/constants";

// MIS-293 (M1/M2): prueba EJECUTABLE del borrado transitorio de la cookie de
// sesión ANTIGUA ("session"). Corre en el project "chromium-unauth" (sin
// storageState): inyecta una `session` legada, atraviesa el redirect del proxy y
// demuestra que desaparece. No teclea ningún secreto (solo un valor de cookie
// ficticio), así que es seguro con trace/vídeo activados.

test.describe("migración de cookies legadas (MIS-293)", () => {
  test("el proxy borra la cookie 'session' legada al redirigir a /login (sin __Host-session)", async ({
    page,
    context,
    baseURL,
  }) => {
    // 1. Inyecta una cookie de sesión ANTIGUA (nombre legado 'session', path '/').
    await context.addCookies([{ name: "session", value: "token-legado-de-prueba", url: baseURL! }]);

    // 2. Ruta protegida SIN __Host-session → 3. el proxy redirige a /login.
    await page.goto("/pendientes");
    await expect(page).toHaveURL(/\/login/);

    // 4. La 'session' legada ya no existe (el proxy la borró en el redirect).
    const cookies = await context.cookies();
    expect(cookies.find((c) => c.name === "session")).toBeUndefined();

    // 5. Y no apareció __Host-session (no hemos iniciado sesión).
    expect(cookies.find((c) => c.name === SESSION_COOKIE_NAME)).toBeUndefined();
  });

  // Evidencia complementaria (sugerencia Baja): inspecciona el Set-Cookie de la
  // respuesta de redirección — nombre legado, Max-Age=0 y Path=/.
  test("el Set-Cookie del redirect expira 'session' con Max-Age=0 y Path=/", async ({
    context,
    baseURL,
  }) => {
    await context.addCookies([{ name: "session", value: "token-legado-de-prueba", url: baseURL! }]);

    const res = await context.request.get("/pendientes", { maxRedirects: 0 });
    expect(res.status()).toBeGreaterThanOrEqual(300);
    expect(res.status()).toBeLessThan(400);
    const location = new URL(res.headers()["location"]!, baseURL);
    expect(location.pathname).toBe("/login");

    // headersArray() devuelve CADA cabecera Set-Cookie por separado, así se
    // comprueban Max-Age=0 y Path=/ DENTRO del mismo fragmento de 'session=' (y no
    // repartidos entre cookies distintas de una respuesta futura con varias).
    const sessionSetCookie = res
      .headersArray()
      .filter((h) => h.name.toLowerCase() === "set-cookie")
      .map((h) => h.value)
      .find((v) => /^\s*session=/.test(v)); // frontera: no matchea '__Host-session='
    expect(sessionSetCookie, "el redirect debe emitir Set-Cookie que expira 'session'").toBeTruthy();
    expect(sessionSetCookie!).toMatch(/Max-Age=0/i);
    // Path EXACTO "/" (no "/foo"): fin de atributo con ';' o final de cadena.
    expect(sessionSetCookie!).toMatch(/;\s*Path=\/(?:;|$)/i);
  });
});

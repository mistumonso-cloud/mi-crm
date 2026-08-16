import { test, expect } from "@playwright/test";

// MIS-260: sin sesión (sin storageState) — corre en el project
// "chromium-unauth", sin dependencies de setup-carlos/setup-marta. Cubre
// solo lo que controlamos del lado del servidor propio; un intercambio de
// código real contra Google queda fuera de alcance automatizado (requeriría
// una cuenta de Google real, no viable en CI, o mockear los endpoints de
// Google — ver PLANS/MIS-260-login-google.md, "Fuera de alcance").

test.describe("Google OAuth: /start y /callback (sin cuenta real de Google)", () => {
  test("/api/auth/google/start pone la cookie de estado y redirige a Google con el mismo state", async ({
    page,
  }) => {
    const res = await page.request.get("/api/auth/google/start", { maxRedirects: 0 });

    expect(res.status()).toBeGreaterThanOrEqual(300);
    expect(res.status()).toBeLessThan(400);

    const location = res.headers()["location"];
    expect(location).toBeTruthy();
    const authUrl = new URL(location!);
    expect(authUrl.origin + authUrl.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(authUrl.searchParams.get("scope")).toBe("openid email profile");
    expect(authUrl.searchParams.get("response_type")).toBe("code");
    const stateInQuery = authUrl.searchParams.get("state");
    expect(stateInQuery).toBeTruthy();

    // Auditoría (ronda 1, sugerencia menor): comprobar que el state de la
    // URL coincide EXACTAMENTE con el de la cookie, no solo que ambos
    // existan por separado.
    // MIS-293 (B2): se aísla el fragmento Set-Cookie de la cookie de estado (por su
    // nombre con prefijo `__Secure-`, literal para detectar un rename mal hecho) y
    // se comprueban valor, Secure y Path DENTRO de ese mismo fragmento — no sobre la
    // cabecera combinada (que además trae el borrado de la gemela legada).
    const stateSetCookie = res
      .headersArray()
      .filter((h) => h.name.toLowerCase() === "set-cookie")
      .map((h) => h.value)
      .find((v) => /^__Secure-google_oauth_state=/.test(v));
    expect(stateSetCookie, "el Set-Cookie de la cookie de estado debe existir").toBeTruthy();
    const cookieMatch = /^__Secure-google_oauth_state=([^;]+)/.exec(stateSetCookie!);
    expect(cookieMatch?.[1]).toBeTruthy();
    expect(decodeURIComponent(cookieMatch![1])).toBe(stateInQuery);
    // MIS-293 (B1/B2): `Secure` y el `path` EXACTO en ese fragmento.
    expect(stateSetCookie!).toMatch(/;\s*Secure(?:;|$)/i);
    expect(stateSetCookie!).toMatch(/;\s*Path=\/api\/auth\/google(?:;|$)/i);
  });

  // MIS-293 (B2, borrado): el callback borra la cookie de estado SIEMPRE, éxito o
  // no (route.ts: "de un solo uso — se borra siempre"). Aquí se inyecta una cookie
  // de estado presente y se comprueba que el callback la RETIRA del jar. Se usa un
  // `state` de query DISTINTO al de la cookie para que el callback rechace ANTES de
  // llamar a Google (sin red externa) pero igualmente ejecute el borrado.
  test("/api/auth/google/callback borra la cookie de estado presente (se borra siempre)", async ({
    context,
    baseURL,
  }) => {
    const host = new URL(baseURL!).hostname;
    // Fixture con `secure: true` y su `path` original: si no cumpliera el prefijo
    // `__Secure-`, Chromium lo rechazaría y el test solo probaría el camino "sin
    // cookie". Se confirma que SÍ quedó guardada antes de invocar el callback.
    await context.addCookies([
      {
        name: "__Secure-google_oauth_state",
        value: "estado-guardado",
        domain: host,
        path: "/api/auth/google",
        secure: true,
      },
    ]);
    // Precondición: comprueba la cookie EXACTA (no solo que exista alguna con ese
    // nombre) — si Chromium hubiera rechazado el fixture por incumplir el prefijo,
    // el test solo probaría el camino "sin cookie".
    const fixture = (await context.cookies()).find((c) => c.name === "__Secure-google_oauth_state");
    expect(fixture, "el fixture de la cookie de estado debe haberse guardado").toMatchObject({
      value: "estado-guardado",
      secure: true,
      path: "/api/auth/google",
    });

    // context.request comparte el cookie jar del BrowserContext (el Set-Cookie de
    // la respuesta actualiza el jar).
    const res = await context.request.get("/api/auth/google/callback?code=x&state=no-coincide", {
      maxRedirects: 0,
    });
    expect(res.status()).toBeGreaterThanOrEqual(300);
    expect(res.status()).toBeLessThan(400);
    // Semántico, no igualdad literal: la cabecera Location podría ser absoluta o
    // relativa; se normaliza contra baseURL y se comprueba destino + query.
    const location = new URL(res.headers()["location"]!, baseURL);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("error")).toBe("google");

    // Definitivo: el jar ya no contiene la cookie de estado (la borró el callback).
    expect((await context.cookies()).some((c) => c.name === "__Secure-google_oauth_state")).toBe(
      false,
    );
  });

  test("/api/auth/google/callback sin cookie de estado rechaza sin llamar a Google", async ({ page }) => {
    const res = await page.request.get("/api/auth/google/callback?code=x&state=y", {
      maxRedirects: 0,
    });

    expect(res.status()).toBeGreaterThanOrEqual(300);
    expect(res.status()).toBeLessThan(400);
    expect(res.headers()["location"]).toBe("/login?error=google");
  });

  test("/login muestra el mensaje de error genérico cuando llega ?error=google", async ({ page }) => {
    await page.goto("/login?error=google");
    // getByRole("alert") es ambiguo: matchea también el
    // __next-route-announcer__ que Next.js inserta con role="alert" (vacío)
    // para lectores de pantalla — mismo tipo de colisión ya documentado para
    // selectores de botón en este repo. getByText es inequívoco: el
    // announcer está vacío, solo nuestro div de error tiene este texto.
    await expect(page.getByText("No se pudo iniciar sesión con Google")).toBeVisible();
  });
});

import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";

// MIS-260: sin sesión (sin storageState) — corre en el project
// "chromium-unauth", sin dependencies de setup-carlos/setup-marta. Cubre
// solo lo que controlamos del lado del servidor propio; un intercambio de
// código real contra Google queda fuera de alcance automatizado (requeriría
// una cuenta de Google real, no viable en CI, o mockear los endpoints de
// Google — ver PLANS/MIS-260-login-google.md, "Fuera de alcance").
//
// MIS-299 (B6, PKCE): el /start pasa a emitir code_challenge/S256 y a fijar la
// cookie del verifier; el /callback borra AHORA las tres cookies transitorias.

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

    // MIS-299 (B6, PKCE): la URL de autorización lleva el reto con método S256.
    expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
    const codeChallenge = authUrl.searchParams.get("code_challenge");
    expect(codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/); // base64url(SHA-256) sin padding

    // MIS-299: el Set-Cookie del verifier se aísla igual que el del state y se
    // comprueban TODOS sus atributos (Secure, HttpOnly, SameSite, Max-Age, Path).
    const verifierSetCookie = res
      .headersArray()
      .filter((h) => h.name.toLowerCase() === "set-cookie")
      .map((h) => h.value)
      .find((v) => /^__Secure-google_pkce_verifier=/.test(v));
    expect(verifierSetCookie, "el Set-Cookie del verifier debe existir").toBeTruthy();
    expect(verifierSetCookie!).toMatch(/;\s*Secure(?:;|$)/i);
    expect(verifierSetCookie!).toMatch(/;\s*HttpOnly(?:;|$)/i);
    expect(verifierSetCookie!).toMatch(/;\s*SameSite=Lax(?:;|$)/i);
    expect(verifierSetCookie!).toMatch(/;\s*Max-Age=600(?:;|$)/i);
    expect(verifierSetCookie!).toMatch(/;\s*Path=\/api\/auth\/google(?:;|$)/i);

    // MIS-299: invariante FUERTE de PKCE — code_challenge == base64url(SHA-256(verifier)).
    // Se recomputa con node:crypto sobre el valor real de la cookie del verifier.
    const verifierMatch = /^__Secure-google_pkce_verifier=([^;]+)/.exec(verifierSetCookie!);
    const verifierValue = decodeURIComponent(verifierMatch![1]);
    const expectedChallenge = createHash("sha256").update(verifierValue).digest("base64url");
    expect(codeChallenge).toBe(expectedChallenge);
  });

  // MIS-293 (B2, borrado) + MIS-299 (PKCE): el callback borra SIEMPRE, éxito o no
  // (route.ts: "de un solo uso — se borran siempre"), las TRES cookies transitorias
  // del flujo: state nuevo, verifier PKCE y la gemela legada `google_oauth_state`.
  // Se inyectan las tres y se comprueba que el callback las RETIRA del jar. Se usa un
  // `state` de query DISTINTO al de la cookie para que el callback rechace ANTES de
  // llamar a Google (sin red externa) pero igualmente ejecute el borrado.
  test("/api/auth/google/callback borra las tres cookies transitorias (se borran siempre)", async ({
    context,
    baseURL,
  }) => {
    const host = new URL(baseURL!).hostname;
    const validVerifier = "A".repeat(43); // forma RFC 7636 válida
    // Fixtures con `secure: true` en las `__Secure-*`: si no cumplieran el prefijo,
    // Chromium las rechazaría y el test solo probaría el camino "sin cookies". La
    // gemela legada (sin prefijo) no requiere `secure`. Se confirma abajo que las
    // TRES quedaron guardadas antes de invocar el callback.
    await context.addCookies([
      {
        name: "__Secure-google_oauth_state",
        value: "estado-guardado",
        domain: host,
        path: "/api/auth/google",
        secure: true,
      },
      {
        name: "__Secure-google_pkce_verifier",
        value: validVerifier,
        domain: host,
        path: "/api/auth/google",
        secure: true,
      },
      {
        name: "google_oauth_state",
        value: "legado",
        domain: host,
        path: "/api/auth/google",
      },
    ]);
    // Precondición: comprueba las cookies EXACTAS (no solo que exista alguna con ese
    // nombre) — si Chromium hubiera rechazado un fixture __Secure-* por incumplir el
    // prefijo, el test solo probaría el camino "sin cookies" (falso verde).
    const before = await context.cookies();
    expect(before.find((c) => c.name === "__Secure-google_oauth_state")).toMatchObject({
      value: "estado-guardado",
      secure: true,
      path: "/api/auth/google",
    });
    expect(before.find((c) => c.name === "__Secure-google_pkce_verifier")).toMatchObject({
      value: validVerifier,
      secure: true,
      path: "/api/auth/google",
    });
    expect(before.find((c) => c.name === "google_oauth_state")).toMatchObject({
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

    // Definitivo: el jar ya no contiene NINGUNA de las tres (las borró el callback).
    const after = await context.cookies();
    expect(after.some((c) => c.name === "__Secure-google_oauth_state")).toBe(false);
    expect(after.some((c) => c.name === "__Secure-google_pkce_verifier")).toBe(false);
    expect(after.some((c) => c.name === "google_oauth_state")).toBe(false);
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

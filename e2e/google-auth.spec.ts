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
    const setCookieHeader = res.headers()["set-cookie"] ?? "";
    const cookieMatch = /google_oauth_state=([^;]+)/.exec(setCookieHeader);
    expect(cookieMatch?.[1]).toBeTruthy();
    expect(decodeURIComponent(cookieMatch![1])).toBe(stateInQuery);
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

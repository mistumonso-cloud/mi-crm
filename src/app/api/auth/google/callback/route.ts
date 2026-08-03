import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { fetchMutation } from "convex/nextjs";
// 6 niveles: este archivo vive en src/app/api/auth/google/callback/, 6
// directorios bajo la raíz del repo (src, app, api, auth, google, callback)
// — corregido en auditoría (ronda 1, M1): una versión anterior con 5
// niveles resolvía a src/convex/_generated/api, inexistente. Mismo criterio
// de conteo que src/lib/auth/actions.ts (3 niveles, 3 directorios de
// profundidad).
import { api } from "../../../../../../convex/_generated/api";
import { clearOAuthStateCookie, readOAuthStateCookie, setSessionCookie } from "@/lib/auth/cookie";
import { exchangeCodeForAccessToken, fetchVerifiedGoogleEmail } from "@/lib/auth/google";
import { landingPathForRole } from "@/lib/auth/dal";

type Result = { ok: true; token: string; role: "rep" | "supervisor" } | { ok: false; reason: string };

// Aislado en una función que NUNCA redirige: next/navigation's redirect()
// lanza internamente y la doc de Next.js pide no llamarlo dentro de un
// try/catch — todo el trabajo con Google/Convex (que sí necesita try/catch
// para errores de red) vive aquí; los redirect() solo están en el handler
// exterior.
async function handleCallback(request: NextRequest): Promise<Result> {
  const googleError = request.nextUrl.searchParams.get("error");
  if (googleError) return { ok: false, reason: `google error: ${googleError}` };

  const code = request.nextUrl.searchParams.get("code");
  const returnedState = request.nextUrl.searchParams.get("state");
  const savedState = await readOAuthStateCookie();
  if (!code || !returnedState || !savedState || returnedState !== savedState) {
    return { ok: false, reason: "state inválido o ausente" };
  }

  try {
    const accessToken = await exchangeCodeForAccessToken(code);
    const email = await fetchVerifiedGoogleEmail(accessToken);
    const result = await fetchMutation(api.auth.loginWithGoogle, {
      email,
      serverKey: process.env.GOOGLE_LOGIN_SHARED_SECRET!,
    });
    if (!result.success) return { ok: false, reason: result.error };
    return { ok: true, token: result.token, role: result.role };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "error desconocido" };
  }
}

export async function GET(request: NextRequest) {
  const result = await handleCallback(request);
  // De un solo uso — se borra siempre, éxito o no.
  await clearOAuthStateCookie();

  if (!result.ok) {
    // Detalle real del fallo solo en logs de servidor — nunca llega al
    // cliente (anti-enumeración, mismo criterio que GENERIC_ERROR en el
    // login por password).
    console.error("[google-auth] callback falló:", result.reason);
    redirect("/login?error=google");
  }

  await setSessionCookie(result.token);
  redirect(landingPathForRole(result.role));
}

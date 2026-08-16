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
import {
  clearOAuthTransientCookies,
  readOAuthStateCookie,
  readPkceVerifierCookie,
  setSessionCookie,
} from "@/lib/auth/cookie";
import {
  exchangeCodeForAccessToken,
  fetchVerifiedGoogleEmail,
  runGoogleCallback,
  type CallbackInputs,
  type Result,
} from "@/lib/auth/google";
import { landingPathForRole } from "@/lib/auth/dal";

// MIS-299: colaboradora `login` de producción para runGoogleCallback — la única
// pieza que habla con Convex. Se define aquí (no en google.ts) para que google.ts
// no importe Convex y pueda cargarse en el runner de Node del project `unit`.
function login(email: string) {
  return fetchMutation(api.auth.loginWithGoogle, {
    email,
    serverKey: process.env.GOOGLE_LOGIN_SHARED_SECRET!,
  });
}

// Aislado en una función que NUNCA redirige: next/navigation's redirect()
// lanza internamente y la doc de Next.js pide no llamarlo dentro de un
// try/catch — todo el trabajo con Google/Convex vive en runGoogleCallback
// (src/lib/auth/google.ts); los redirect() solo están en el handler exterior.
async function handleCallback(request: NextRequest): Promise<Result> {
  const googleError = request.nextUrl.searchParams.get("error");
  if (googleError) return { ok: false, reason: `google error: ${googleError}` };

  const inputs: CallbackInputs = {
    code: request.nextUrl.searchParams.get("code"),
    returnedState: request.nextUrl.searchParams.get("state"),
    savedState: await readOAuthStateCookie(),
    codeVerifier: await readPkceVerifierCookie(),
  };
  return runGoogleCallback(inputs, {
    exchange: exchangeCodeForAccessToken,
    fetchEmail: fetchVerifiedGoogleEmail,
    login,
  });
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function GET(request: NextRequest) {
  let result: Result | undefined;
  let callbackError: unknown;
  try {
    result = await handleCallback(request);
  } catch (e) {
    // handleCallback está diseñado para NO lanzar (devuelve Result). Se captura
    // por si acaso, para conservar el diagnóstico primario junto al de limpieza.
    callbackError = e;
  } finally {
    // De un solo uso — se borran SIEMPRE (state nuevo, verifier PKCE y gemela
    // legada), pase lo que pase con el intercambio.
    try {
      await clearOAuthTransientCookies();
    } catch (cleanupErr) {
      // Conserva AMBOS diagnósticos sin exponer valores de cookies/secretos.
      if (callbackError) console.error("[google-auth] error del callback:", errMsg(callbackError));
      else if (result && !result.ok) console.error("[google-auth] callback falló:", result.reason);
      console.error("[google-auth] fallo al limpiar cookies transitorias:", errMsg(cleanupErr));
      throw cleanupErr; // fail-closed: sin sesión ni redirect de éxito si no se limpió
    }
  }

  if (callbackError) {
    console.error("[google-auth] error del callback:", errMsg(callbackError));
    redirect("/login?error=google");
  }
  if (!result || !result.ok) {
    // Detalle real del fallo solo en logs de servidor — nunca llega al
    // cliente (anti-enumeración, mismo criterio que GENERIC_ERROR en el
    // login por password).
    console.error("[google-auth] callback falló:", result?.reason);
    redirect("/login?error=google");
  }

  await setSessionCookie(result.token);
  redirect(landingPathForRole(result.role));
}

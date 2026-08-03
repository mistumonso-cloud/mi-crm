// MIS-260: toda la lógica "hablar con Google" vive aquí, fuera de los Route
// Handlers (que quedan finos) — mismo criterio de reparto que actions.ts
// (orquestación) vs. convex/auth.ts (lógica/datos).

function getGoogleClientId(): string {
  const id = process.env.GOOGLE_CLIENT_ID;
  if (!id) throw new Error("Falta GOOGLE_CLIENT_ID en el entorno");
  return id;
}

function getGoogleClientSecret(): string {
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!secret) throw new Error("Falta GOOGLE_CLIENT_SECRET en el entorno");
  return secret;
}

// Valor exacto y fijo, no derivado de headers del request (Railway está
// detrás de su propio proxy) — las dos URIs posibles ya se conocen de
// antemano y están registradas tal cual en Google Cloud Console; derivarla
// dinámicamente solo añadiría riesgo de mismatch sin ninguna ventaja.
export function getGoogleRedirectUri(): string {
  const uri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!uri) throw new Error("Falta GOOGLE_OAUTH_REDIRECT_URI en el entorno");
  return uri;
}

// Nonce anti-CSRF de 32 bytes — mismo tamaño/fuente de entropía que
// generateOpaqueToken (convex/lib/token.ts), pero reimplementado aquí en vez
// de importado: src/ y convex/ corren en runtimes/bundles distintos, y el
// resto del repo ya sigue el criterio de no cruzar imports entre ambos.
export function generateOAuthState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function buildGoogleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: getGoogleClientId(),
    redirect_uri: getGoogleRedirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state,
    // Evita que Google auto-elija una cuenta ya activa en el navegador sin
    // preguntar — relevante porque un mismo navegador puede tener varias
    // cuentas de Google abiertas.
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCodeForAccessToken(code: string): Promise<string> {
  const params = new URLSearchParams({
    client_id: getGoogleClientId(),
    client_secret: getGoogleClientSecret(),
    code,
    // Mismo valor exacto que en buildGoogleAuthUrl — Google exige que el
    // redirect_uri del intercambio coincida byte a byte con el de la
    // petición de autorización original.
    redirect_uri: getGoogleRedirectUri(),
    grant_type: "authorization_code",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
  const data = await res.json();
  if (!data.access_token) throw new Error("token exchange: sin access_token");
  return data.access_token as string;
}

// Verificación del email vía el endpoint `userinfo` de Google con el
// access_token, en vez de decodificar el id_token a mano: evita tener que
// verificar la firma JWT nosotros mismos (JWKS, rotación de claves) para un
// beneficio marginal — el access_token ya viene de una respuesta TLS directa
// de Google a una petición autenticada con client_secret.
export async function fetchVerifiedGoogleEmail(accessToken: string): Promise<string> {
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`userinfo failed: ${res.status}`);
  const profile = await res.json();
  const verified = profile.email_verified === true || profile.email_verified === "true";
  if (!profile.email || !verified) throw new Error("email ausente o no verificado por Google");
  return profile.email as string;
}

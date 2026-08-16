// MIS-260: toda la lógica "hablar con Google" vive aquí, fuera de los Route
// Handlers (que quedan finos) — mismo criterio de reparto que actions.ts
// (orquestación) vs. convex/auth.ts (lógica/datos).
//
// MIS-299 (B6): añade PKCE (RFC 7636). El NÚCLEO del callback (runGoogleCallback)
// vive aquí con sus dependencias INYECTADAS, de modo que este módulo no importa
// Next ni Convex y puede ejercitarse en Node (project `unit` de Playwright).

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

// Codificación base64url (sin padding) de bytes crudos. Fuente ÚNICA compartida
// por el nonce `state` y por PKCE (verifier y challenge), para no duplicar el
// encoder — MIS-299.
function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Nonce anti-CSRF de 32 bytes — mismo tamaño/fuente de entropía que
// generateOpaqueToken (convex/lib/token.ts), pero reimplementado aquí en vez
// de importado: src/ y convex/ corren en runtimes/bundles distintos, y el
// resto del repo ya sigue el criterio de no cruzar imports entre ambos.
export function generateOAuthState(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

// MIS-299 (B6, PKCE): `code_verifier` = 32 bytes aleatorios en base64url (43
// caracteres, dentro del rango 43–128 que exige RFC 7636).
export function generatePkceVerifier(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

// MIS-299 (B6, PKCE): `code_challenge` = BASE64URL(SHA-256(ASCII(verifier)))
// (método S256). El hash es sobre los bytes ASCII del verifier (que ya es
// base64url, es decir ASCII puro), y se codifica el digest CRUDO en base64url
// (no su hexadecimal).
export async function computePkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return bytesToBase64Url(new Uint8Array(digest));
}

// MIS-299 (B6, PKCE): validación defensiva del verifier leído de la cookie —
// longitud 43–128 y solo el juego "unreserved" de RFC 7636. Evita mandar basura
// a Google si la cookie fuese manipulada. Type predicate: estrecha a `string`.
const PKCE_VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;
export function isValidPkceVerifier(v: string | null): v is string {
  return v !== null && PKCE_VERIFIER_RE.test(v);
}

export function buildGoogleAuthUrl(state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    client_id: getGoogleClientId(),
    redirect_uri: getGoogleRedirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state,
    // MIS-299 (B6, PKCE): el reto ligado al verifier de ESTA misma petición.
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    // Evita que Google auto-elija una cuenta ya activa en el navegador sin
    // preguntar — relevante porque un mismo navegador puede tener varias
    // cuentas de Google abiertas.
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCodeForAccessToken(code: string, codeVerifier: string): Promise<string> {
  const params = new URLSearchParams({
    client_id: getGoogleClientId(),
    client_secret: getGoogleClientSecret(),
    code,
    // Mismo valor exacto que en buildGoogleAuthUrl — Google exige que el
    // redirect_uri del intercambio coincida byte a byte con el de la
    // petición de autorización original.
    redirect_uri: getGoogleRedirectUri(),
    grant_type: "authorization_code",
    // MIS-299 (B6, PKCE): prueba de posesión — Google recomputa
    // S256(code_verifier) y lo compara con el code_challenge de /start.
    code_verifier: codeVerifier,
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  // Solo el status en el error — NUNCA el cuerpo de la respuesta de Google.
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

// --- Núcleo del callback (MIS-299) -----------------------------------------
// Extraído del route handler para poder probar EN NODE que el gate de
// precondiciones (state + verifier) se aplica ANTES del intercambio. Las
// colaboradoras (exchange/fetchEmail/login) entran INYECTADAS: en producción son
// las funciones reales de este módulo + fetchMutation(loginWithGoogle); en test
// son spies. runGoogleCallback NUNCA redirige (eso queda en el route handler).

// Copia local del tipo de rol (mismo valor que dal.ts::Role). No se importa de
// dal.ts para no arrastrar sus imports de Next/Convex a este módulo (que debe
// poder cargarse en el runner de Node del project `unit`).
type Role = "rep" | "supervisor";

export type Result =
  | { ok: true; token: string; role: Role }
  | { ok: false; reason: string };

export type CallbackInputs = {
  code: string | null;
  returnedState: string | null;
  savedState: string | null;
  codeVerifier: string | null;
};

type ValidCallbackInputs = {
  code: string;
  returnedState: string;
  savedState: string;
  codeVerifier: string;
};

type LoginResult =
  | { success: true; token: string; role: Role }
  | { success: false; error: string };

export type CallbackDeps = {
  exchange: (code: string, codeVerifier: string) => Promise<string>;
  fetchEmail: (accessToken: string) => Promise<string>;
  login: (email: string) => Promise<LoginResult>;
};

// Type predicate: `true` solo si están los 4 campos, el state devuelto coincide
// con el guardado y el verifier tiene forma RFC 7636. Estrecha CallbackInputs a
// ValidCallbackInputs, de modo que exchange() recibe `string` sin `!` ni casts.
export function callbackPreconditionsOk(a: CallbackInputs): a is ValidCallbackInputs {
  return (
    !!a.code &&
    !!a.returnedState &&
    !!a.savedState &&
    a.returnedState === a.savedState &&
    isValidPkceVerifier(a.codeVerifier)
  );
}

export async function runGoogleCallback(inputs: CallbackInputs, deps: CallbackDeps): Promise<Result> {
  if (!callbackPreconditionsOk(inputs)) {
    return { ok: false, reason: "state/verifier inválido o ausente" };
  }
  try {
    const accessToken = await deps.exchange(inputs.code, inputs.codeVerifier);
    const email = await deps.fetchEmail(accessToken);
    const result = await deps.login(email);
    if (!result.success) return { ok: false, reason: result.error };
    return { ok: true, token: result.token, role: result.role };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "error desconocido" };
  }
}

# MIS-299 · PKCE en el login con Google — Entrega de código para auditoría

> Plan de récord aprobado (GO ronda 4): `PLANS/MIS-299-pkce.md`.
> **Documento autocontenido** (el auditor solo ve este texto). Ronda 2 de auditoría de código: los
> diffs de §4 son ahora la **salida literal completa** de `diff -u` (sin condensar, sin elipsis, sin
> bloques sustituidos por referencias). El §3 reproduce el contenido íntegro de `google.ts` como
> ayuda de lectura; su diff literal correspondiente es §4.2. Effort de generación: **high**.
> **No autoriza instalar/subir/mergear/desplegar.**

## 1. Alcance y contrato

Añade **PKCE (RFC 7636, método S256)** al login con Google:

- `/start` genera un `code_verifier` (32 bytes → base64url, 43 chars), lo guarda en una cookie
  httpOnly nueva `__Secure-google_pkce_verifier` (scope `/api/auth/google`, TTL 600 s), y manda a
  Google el `code_challenge = base64url(SHA-256(verifier))` + `code_challenge_method=S256`.
- `/callback` lee state y verifier, **exige ambos** (guard tipado) antes del intercambio, pasa el
  `code_verifier` al POST de token, y **borra siempre** las tres cookies transitorias (state nuevo,
  verifier, gemela legada `google_oauth_state`) con estructura fail-closed.
- El núcleo `runGoogleCallback` se extrae a `google.ts` con dependencias inyectadas para poder
  probar en Node que el gate se aplica antes del intercambio.

**Sin cambios en `convex/`** → despliegue solo frontend (Railway). **Sin cambios en Google Cloud
Console** (PKCE no se registra; convive con el `client_secret`).

## 2. Manifiesto de archivos (7 modificados de código, 0 nuevos, 0 en `convex/`)

| # | Fichero | Cambio |
|---|---------|--------|
| 1 | `src/lib/auth/constants.ts` | + `PKCE_VERIFIER_COOKIE_NAME` |
| 2 | `src/lib/auth/google.ts` | + `bytesToBase64Url`, `generatePkceVerifier`, `computePkceChallenge`, `isValidPkceVerifier`, guard tipado + núcleo `runGoogleCallback` y tipos; `buildGoogleAuthUrl`/`exchangeCodeForAccessToken` reciben 2º arg |
| 3 | `src/lib/auth/cookie.ts` | + `setPkceVerifierCookie`/`readPkceVerifierCookie`; − `clearOAuthStateCookie`, + `clearOAuthTransientCookies` (3 cookies) |
| 4 | `src/app/api/auth/google/start/route.ts` | genera verifier+challenge, fija ambas cookies |
| 5 | `src/app/api/auth/google/callback/route.ts` | adaptador delgado → `runGoogleCallback`; limpieza fail-closed + doble error |
| 6 | `e2e/lib-unit.spec.ts` | + describe blocks PKCE (gate, frontera, generador, S256, POST con claves exactas) |
| 7 | `e2e/google-auth.spec.ts` | + aserciones PKCE en `/start`; `/callback` borra las 3 cookies |

(El deliverable contiene además `MIS-299-pkce-codigo-completo.md`, este documento — ver §5.3 para el
listado sin filtro.)

## 3. Contenido íntegro (ayuda de lectura) — `src/lib/auth/google.ts`

Su diff literal correspondiente es §4.2. Se incluye entero por ser el corazón de seguridad del cambio.

```ts
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
```

**Nota de tipos (verificada):** `convex/auth.ts:46` define
`roleValidator = v.union(v.literal("rep"), v.literal("supervisor"))`; `loginWithGoogle`
(`convex/auth.ts:287`) devuelve `{success:true, token, role: roleValidator} | {success:false, error}`.
La colaboradora `login` de producción (§4.5) devuelve exactamente ese tipo, asignable a
`CallbackDeps["login"]` sin casts.

## 4. Diffs unificados — salida literal de `diff -u`

Comando por fichero: `diff -u <ruta repo> CODIGO/MIS-299-pkce/<ruta repo>`.

### 4.1 `src/lib/auth/constants.ts`
```diff
--- src/lib/auth/constants.ts
+++ CODIGO/MIS-299-pkce/src/lib/auth/constants.ts
@@ -12,6 +12,12 @@
 // `__Host-`); el navegador refuerza que se emitió con `Secure`.
 export const OAUTH_STATE_COOKIE_NAME = "__Secure-google_oauth_state";
 
+// MIS-299 (B6, PKCE): cookie httpOnly de corta duración (10 min) que transporta
+// el `code_verifier` de PKCE entre /start y /callback — nunca contiene identidad,
+// solo el secreto de un solo uso. Mismo molde y vida que la de OAuth state.
+// MIS-293 (B2): prefijo `__Secure-` (su `path` no es `/`, mismo motivo que state).
+export const PKCE_VERIFIER_COOKIE_NAME = "__Secure-google_pkce_verifier";
+
 // MIS-292 (M3): cookie httpOnly de corta duración (15 min) que transporta el
 // ticket de reseteo entre verificar el código y fijar la nueva contraseña.
 // Antes viajaba en estado React + <input type="hidden">, accesible a JS; ahora
```

### 4.2 `src/lib/auth/google.ts` (salida literal completa)
```diff
--- src/lib/auth/google.ts	2026-08-03 18:46:14.861961542 +0200
+++ CODIGO/MIS-299-pkce/src/lib/auth/google.ts	2026-08-16 15:15:41.816843268 +0200
@@ -1,6 +1,10 @@
 // MIS-260: toda la lógica "hablar con Google" vive aquí, fuera de los Route
 // Handlers (que quedan finos) — mismo criterio de reparto que actions.ts
 // (orquestación) vs. convex/auth.ts (lógica/datos).
+//
+// MIS-299 (B6): añade PKCE (RFC 7636). El NÚCLEO del callback (runGoogleCallback)
+// vive aquí con sus dependencias INYECTADAS, de modo que este módulo no importa
+// Next ni Convex y puede ejercitarse en Node (project `unit` de Playwright).
 
 function getGoogleClientId(): string {
   const id = process.env.GOOGLE_CLIENT_ID;
@@ -24,24 +28,56 @@
   return uri;
 }
 
+// Codificación base64url (sin padding) de bytes crudos. Fuente ÚNICA compartida
+// por el nonce `state` y por PKCE (verifier y challenge), para no duplicar el
+// encoder — MIS-299.
+function bytesToBase64Url(bytes: Uint8Array): string {
+  let binary = "";
+  for (const b of bytes) binary += String.fromCharCode(b);
+  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
+}
+
 // Nonce anti-CSRF de 32 bytes — mismo tamaño/fuente de entropía que
 // generateOpaqueToken (convex/lib/token.ts), pero reimplementado aquí en vez
 // de importado: src/ y convex/ corren en runtimes/bundles distintos, y el
 // resto del repo ya sigue el criterio de no cruzar imports entre ambos.
 export function generateOAuthState(): string {
-  const bytes = crypto.getRandomValues(new Uint8Array(32));
-  let binary = "";
-  for (const b of bytes) binary += String.fromCharCode(b);
-  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
+  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
 }
 
-export function buildGoogleAuthUrl(state: string): string {
+// MIS-299 (B6, PKCE): `code_verifier` = 32 bytes aleatorios en base64url (43
+// caracteres, dentro del rango 43–128 que exige RFC 7636).
+export function generatePkceVerifier(): string {
+  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
+}
+
+// MIS-299 (B6, PKCE): `code_challenge` = BASE64URL(SHA-256(ASCII(verifier)))
+// (método S256). El hash es sobre los bytes ASCII del verifier (que ya es
+// base64url, es decir ASCII puro), y se codifica el digest CRUDO en base64url
+// (no su hexadecimal).
+export async function computePkceChallenge(verifier: string): Promise<string> {
+  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
+  return bytesToBase64Url(new Uint8Array(digest));
+}
+
+// MIS-299 (B6, PKCE): validación defensiva del verifier leído de la cookie —
+// longitud 43–128 y solo el juego "unreserved" de RFC 7636. Evita mandar basura
+// a Google si la cookie fuese manipulada. Type predicate: estrecha a `string`.
+const PKCE_VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;
+export function isValidPkceVerifier(v: string | null): v is string {
+  return v !== null && PKCE_VERIFIER_RE.test(v);
+}
+
+export function buildGoogleAuthUrl(state: string, codeChallenge: string): string {
   const params = new URLSearchParams({
     client_id: getGoogleClientId(),
     redirect_uri: getGoogleRedirectUri(),
     response_type: "code",
     scope: "openid email profile",
     state,
+    // MIS-299 (B6, PKCE): el reto ligado al verifier de ESTA misma petición.
+    code_challenge: codeChallenge,
+    code_challenge_method: "S256",
     // Evita que Google auto-elija una cuenta ya activa en el navegador sin
     // preguntar — relevante porque un mismo navegador puede tener varias
     // cuentas de Google abiertas.
@@ -50,7 +86,7 @@
   return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
 }
 
-export async function exchangeCodeForAccessToken(code: string): Promise<string> {
+export async function exchangeCodeForAccessToken(code: string, codeVerifier: string): Promise<string> {
   const params = new URLSearchParams({
     client_id: getGoogleClientId(),
     client_secret: getGoogleClientSecret(),
@@ -60,12 +96,16 @@
     // petición de autorización original.
     redirect_uri: getGoogleRedirectUri(),
     grant_type: "authorization_code",
+    // MIS-299 (B6, PKCE): prueba de posesión — Google recomputa
+    // S256(code_verifier) y lo compara con el code_challenge de /start.
+    code_verifier: codeVerifier,
   });
   const res = await fetch("https://oauth2.googleapis.com/token", {
     method: "POST",
     headers: { "Content-Type": "application/x-www-form-urlencoded" },
     body: params.toString(),
   });
+  // Solo el status en el error — NUNCA el cuerpo de la respuesta de Google.
   if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
   const data = await res.json();
   if (!data.access_token) throw new Error("token exchange: sin access_token");
@@ -87,3 +127,71 @@
   if (!profile.email || !verified) throw new Error("email ausente o no verificado por Google");
   return profile.email as string;
 }
+
+// --- Núcleo del callback (MIS-299) -----------------------------------------
+// Extraído del route handler para poder probar EN NODE que el gate de
+// precondiciones (state + verifier) se aplica ANTES del intercambio. Las
+// colaboradoras (exchange/fetchEmail/login) entran INYECTADAS: en producción son
+// las funciones reales de este módulo + fetchMutation(loginWithGoogle); en test
+// son spies. runGoogleCallback NUNCA redirige (eso queda en el route handler).
+
+// Copia local del tipo de rol (mismo valor que dal.ts::Role). No se importa de
+// dal.ts para no arrastrar sus imports de Next/Convex a este módulo (que debe
+// poder cargarse en el runner de Node del project `unit`).
+type Role = "rep" | "supervisor";
+
+export type Result =
+  | { ok: true; token: string; role: Role }
+  | { ok: false; reason: string };
+
+export type CallbackInputs = {
+  code: string | null;
+  returnedState: string | null;
+  savedState: string | null;
+  codeVerifier: string | null;
+};
+
+type ValidCallbackInputs = {
+  code: string;
+  returnedState: string;
+  savedState: string;
+  codeVerifier: string;
+};
+
+type LoginResult =
+  | { success: true; token: string; role: Role }
+  | { success: false; error: string };
+
+export type CallbackDeps = {
+  exchange: (code: string, codeVerifier: string) => Promise<string>;
+  fetchEmail: (accessToken: string) => Promise<string>;
+  login: (email: string) => Promise<LoginResult>;
+};
+
+// Type predicate: `true` solo si están los 4 campos, el state devuelto coincide
+// con el guardado y el verifier tiene forma RFC 7636. Estrecha CallbackInputs a
+// ValidCallbackInputs, de modo que exchange() recibe `string` sin `!` ni casts.
+export function callbackPreconditionsOk(a: CallbackInputs): a is ValidCallbackInputs {
+  return (
+    !!a.code &&
+    !!a.returnedState &&
+    !!a.savedState &&
+    a.returnedState === a.savedState &&
+    isValidPkceVerifier(a.codeVerifier)
+  );
+}
+
+export async function runGoogleCallback(inputs: CallbackInputs, deps: CallbackDeps): Promise<Result> {
+  if (!callbackPreconditionsOk(inputs)) {
+    return { ok: false, reason: "state/verifier inválido o ausente" };
+  }
+  try {
+    const accessToken = await deps.exchange(inputs.code, inputs.codeVerifier);
+    const email = await deps.fetchEmail(accessToken);
+    const result = await deps.login(email);
+    if (!result.success) return { ok: false, reason: result.error };
+    return { ok: true, token: result.token, role: result.role };
+  } catch (err) {
+    return { ok: false, reason: err instanceof Error ? err.message : "error desconocido" };
+  }
+}
```

### 4.3 `src/lib/auth/cookie.ts`
```diff
--- src/lib/auth/cookie.ts
+++ CODIGO/MIS-299-pkce/src/lib/auth/cookie.ts
@@ -2,6 +2,7 @@
 import {
   SESSION_COOKIE_NAME,
   OAUTH_STATE_COOKIE_NAME,
+  PKCE_VERIFIER_COOKIE_NAME,
   RESET_TICKET_COOKIE_NAME,
 } from "./constants";
 
@@ -87,16 +88,58 @@
   return cookieStore.get(OAUTH_STATE_COOKIE_NAME)?.value ?? null;
 }
 
-export async function clearOAuthStateCookie(): Promise<void> {
+// MIS-299 (B6, PKCE): cookie efímera que transporta el `code_verifier` entre
+// /start y /callback. Mismo molde, scope y vida (10 min) que la de OAuth state,
+// pero SEPARADA: son secretos distintos y cada función tiene un propósito único.
+// Cookie nueva: NO tiene gemela legada que borrar.
+export async function setPkceVerifierCookie(verifier: string): Promise<void> {
   const cookieStore = await cookies();
-  cookieStore.set(OAUTH_STATE_COOKIE_NAME, "", {
+  cookieStore.set(PKCE_VERIFIER_COOKIE_NAME, verifier, {
     httpOnly: true,
     secure: true,
     sameSite: "lax",
     path: "/api/auth/google",
-    maxAge: 0,
+    maxAge: OAUTH_STATE_TTL_SECONDS,
   });
-  cookieStore.set(LEGACY_OAUTH_STATE_COOKIE_NAME, "", { path: "/api/auth/google", maxAge: 0 });
+}
+
+export async function readPkceVerifierCookie(): Promise<string | null> {
+  const cookieStore = await cookies();
+  return cookieStore.get(PKCE_VERIFIER_COOKIE_NAME)?.value ?? null;
+}
+
+// MIS-299 (B6): limpieza de las cookies TRANSITORIAS del flujo OAuth de Google.
+// Reemplaza a clearOAuthStateCookie (que borraba state nuevo + su gemela legada);
+// ahora expira además el verifier de PKCE. Las TRES en un ÚNICO cookie store:
+//   1) __Secure-google_oauth_state (state nuevo)
+//   2) __Secure-google_pkce_verifier (verifier PKCE)
+//   3) google_oauth_state (gemela LEGADA — se conserva el borrado transitorio de MIS-293)
+// Las tres escrituras se INTENTAN aunque una lance; el primer error se propaga
+// (el callback la invoca en un `finally`: si esto lanzara, aborta fail-closed).
+export async function clearOAuthTransientCookies(): Promise<void> {
+  const cookieStore = await cookies();
+  const oauthClearOptions = {
+    httpOnly: true,
+    secure: true,
+    sameSite: "lax",
+    path: "/api/auth/google",
+    maxAge: 0,
+  } as const;
+  const legacyClearOptions = { path: "/api/auth/google", maxAge: 0 } as const;
+  const writes: Array<() => void> = [
+    () => cookieStore.set(OAUTH_STATE_COOKIE_NAME, "", oauthClearOptions),
+    () => cookieStore.set(PKCE_VERIFIER_COOKIE_NAME, "", oauthClearOptions),
+    () => cookieStore.set(LEGACY_OAUTH_STATE_COOKIE_NAME, "", legacyClearOptions),
+  ];
+  let firstError: unknown;
+  for (const w of writes) {
+    try {
+      w();
+    } catch (e) {
+      firstError ??= e;
+    }
+  }
+  if (firstError) throw firstError;
 }
 
 // MIS-292 (M3): ticket de reseteo. Vivía en estado React + <input type="hidden">
```

### 4.4 `src/app/api/auth/google/start/route.ts`
```diff
--- src/app/api/auth/google/start/route.ts
+++ CODIGO/MIS-299-pkce/src/app/api/auth/google/start/route.ts
@@ -1,11 +1,20 @@
 import { redirect } from "next/navigation";
-import { setOAuthStateCookie } from "@/lib/auth/cookie";
-import { buildGoogleAuthUrl, generateOAuthState } from "@/lib/auth/google";
+import { setOAuthStateCookie, setPkceVerifierCookie } from "@/lib/auth/cookie";
+import {
+  buildGoogleAuthUrl,
+  computePkceChallenge,
+  generateOAuthState,
+  generatePkceVerifier,
+} from "@/lib/auth/google";
 
 // Runtime Node.js por defecto (no se declara `edge`) — mismo criterio que
 // src/proxy.ts, necesario para crypto/fetch sin restricciones.
 export async function GET() {
   const state = generateOAuthState();
+  // MIS-299 (B6, PKCE): verifier secreto (solo cookie) + su reto (viaja a Google).
+  const verifier = generatePkceVerifier();
+  const challenge = await computePkceChallenge(verifier);
   await setOAuthStateCookie(state);
-  redirect(buildGoogleAuthUrl(state));
+  await setPkceVerifierCookie(verifier);
+  redirect(buildGoogleAuthUrl(state, challenge));
 }
```

### 4.5 `src/app/api/auth/google/callback/route.ts`
```diff
--- src/app/api/auth/google/callback/route.ts
+++ CODIGO/MIS-299-pkce/src/app/api/auth/google/callback/route.ts
@@ -8,52 +8,86 @@
 // de conteo que src/lib/auth/actions.ts (3 niveles, 3 directorios de
 // profundidad).
 import { api } from "../../../../../../convex/_generated/api";
-import { clearOAuthStateCookie, readOAuthStateCookie, setSessionCookie } from "@/lib/auth/cookie";
-import { exchangeCodeForAccessToken, fetchVerifiedGoogleEmail } from "@/lib/auth/google";
+import {
+  clearOAuthTransientCookies,
+  readOAuthStateCookie,
+  readPkceVerifierCookie,
+  setSessionCookie,
+} from "@/lib/auth/cookie";
+import {
+  exchangeCodeForAccessToken,
+  fetchVerifiedGoogleEmail,
+  runGoogleCallback,
+  type CallbackInputs,
+  type Result,
+} from "@/lib/auth/google";
 import { landingPathForRole } from "@/lib/auth/dal";
 
-type Result = { ok: true; token: string; role: "rep" | "supervisor" } | { ok: false; reason: string };
+// MIS-299: colaboradora `login` de producción para runGoogleCallback — la única
+// pieza que habla con Convex. Se define aquí (no en google.ts) para que google.ts
+// no importe Convex y pueda cargarse en el runner de Node del project `unit`.
+function login(email: string) {
+  return fetchMutation(api.auth.loginWithGoogle, {
+    email,
+    serverKey: process.env.GOOGLE_LOGIN_SHARED_SECRET!,
+  });
+}
 
 // Aislado en una función que NUNCA redirige: next/navigation's redirect()
 // lanza internamente y la doc de Next.js pide no llamarlo dentro de un
-// try/catch — todo el trabajo con Google/Convex (que sí necesita try/catch
-// para errores de red) vive aquí; los redirect() solo están en el handler
-// exterior.
+// try/catch — todo el trabajo con Google/Convex vive en runGoogleCallback
+// (src/lib/auth/google.ts); los redirect() solo están en el handler exterior.
 async function handleCallback(request: NextRequest): Promise<Result> {
   const googleError = request.nextUrl.searchParams.get("error");
   if (googleError) return { ok: false, reason: `google error: ${googleError}` };
 
-  const code = request.nextUrl.searchParams.get("code");
-  const returnedState = request.nextUrl.searchParams.get("state");
-  const savedState = await readOAuthStateCookie();
-  if (!code || !returnedState || !savedState || returnedState !== savedState) {
-    return { ok: false, reason: "state inválido o ausente" };
-  }
-
-  try {
-    const accessToken = await exchangeCodeForAccessToken(code);
-    const email = await fetchVerifiedGoogleEmail(accessToken);
-    const result = await fetchMutation(api.auth.loginWithGoogle, {
-      email,
-      serverKey: process.env.GOOGLE_LOGIN_SHARED_SECRET!,
-    });
-    if (!result.success) return { ok: false, reason: result.error };
-    return { ok: true, token: result.token, role: result.role };
-  } catch (err) {
-    return { ok: false, reason: err instanceof Error ? err.message : "error desconocido" };
-  }
+  const inputs: CallbackInputs = {
+    code: request.nextUrl.searchParams.get("code"),
+    returnedState: request.nextUrl.searchParams.get("state"),
+    savedState: await readOAuthStateCookie(),
+    codeVerifier: await readPkceVerifierCookie(),
+  };
+  return runGoogleCallback(inputs, {
+    exchange: exchangeCodeForAccessToken,
+    fetchEmail: fetchVerifiedGoogleEmail,
+    login,
+  });
 }
 
+const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
+
 export async function GET(request: NextRequest) {
-  const result = await handleCallback(request);
-  // De un solo uso — se borra siempre, éxito o no.
-  await clearOAuthStateCookie();
+  let result: Result | undefined;
+  let callbackError: unknown;
+  try {
+    result = await handleCallback(request);
+  } catch (e) {
+    // handleCallback está diseñado para NO lanzar (devuelve Result). Se captura
+    // por si acaso, para conservar el diagnóstico primario junto al de limpieza.
+    callbackError = e;
+  } finally {
+    // De un solo uso — se borran SIEMPRE (state nuevo, verifier PKCE y gemela
+    // legada), pase lo que pase con el intercambio.
+    try {
+      await clearOAuthTransientCookies();
+    } catch (cleanupErr) {
+      // Conserva AMBOS diagnósticos sin exponer valores de cookies/secretos.
+      if (callbackError) console.error("[google-auth] error del callback:", errMsg(callbackError));
+      else if (result && !result.ok) console.error("[google-auth] callback falló:", result.reason);
+      console.error("[google-auth] fallo al limpiar cookies transitorias:", errMsg(cleanupErr));
+      throw cleanupErr; // fail-closed: sin sesión ni redirect de éxito si no se limpió
+    }
+  }
 
-  if (!result.ok) {
+  if (callbackError) {
+    console.error("[google-auth] error del callback:", errMsg(callbackError));
+    redirect("/login?error=google");
+  }
+  if (!result || !result.ok) {
     // Detalle real del fallo solo en logs de servidor — nunca llega al
     // cliente (anti-enumeración, mismo criterio que GENERIC_ERROR en el
     // login por password).
-    console.error("[google-auth] callback falló:", result.reason);
+    console.error("[google-auth] callback falló:", result?.reason);
     redirect("/login?error=google");
   }
 
   await setSessionCookie(result.token);
   redirect(landingPathForRole(result.role));
 }
```
> Nota de estrechamiento: `redirect()` de `next/navigation` tiene tipo de retorno `never`, así que
> tras `if (!result || !result.ok) { …; redirect(…); }` TypeScript estrecha `result` a `{ ok: true }`.

### 4.6 `e2e/lib-unit.spec.ts` (salida literal completa)
```diff
--- e2e/lib-unit.spec.ts	2026-08-16 10:44:40.157367086 +0200
+++ CODIGO/MIS-299-pkce/e2e/lib-unit.spec.ts	2026-08-16 15:31:32.153812656 +0200
@@ -1,7 +1,8 @@
 // MIS-293 (PR-1a): pruebas de UNIDAD de librería (sin navegador ni Convex).
 // Corren bajo el project `unit` de playwright.config.ts e importan directamente
-// las funciones de `convex/lib` para ejercitarlas en Node con WebCrypto
-// (Playwright transpila TS; `node --test` no ejecutaría estos módulos TS).
+// las funciones de `convex/lib` (y, desde MIS-299, de `src/lib/auth/google`) para
+// ejercitarlas en Node con WebCrypto (Playwright transpila TS; `node --test` no
+// ejecutaría estos módulos TS).
 //
 // NOTA (redacción honesta): el project `unit` HEREDA el `webServer` global de
 // playwright.config.ts, así que `--project=unit` NO corre aislado del arranque
@@ -9,8 +10,19 @@
 // sola vez y es inofensivo. Estas pruebas no usan `page`, así que no lanzan
 // navegador.
 import { test, expect } from "@playwright/test";
+import { createHash } from "node:crypto";
 import { hashPassword, verifyPassword } from "../convex/lib/password";
 import { normalizeEmailKey } from "../convex/lib/rateLimit";
+import {
+  callbackPreconditionsOk,
+  computePkceChallenge,
+  exchangeCodeForAccessToken,
+  generatePkceVerifier,
+  isValidPkceVerifier,
+  runGoogleCallback,
+  type CallbackDeps,
+  type CallbackInputs,
+} from "../src/lib/auth/google";
 
 // Sustituye el campo `i=<n>` de un hash REAL (con salt y hash base64url VÁLIDOS,
 // generados por hashPassword) por otro valor. Así, cuando verifyPassword rechaza,
@@ -72,3 +84,175 @@
     expect(normalizeEmailKey("marta@test.local")).toBe("marta@test.local");
   });
 });
+
+// ---------------------------------------------------------------------------
+// MIS-299 (B6, PKCE)
+// ---------------------------------------------------------------------------
+
+// Spies de las colaboradoras inyectadas de runGoogleCallback. Registran los
+// argumentos recibidos para poder asertar tanto el número de llamadas como su
+// contenido exacto. `exchange` devuelve un access token fijo, `fetchEmail` un
+// email fijo y `login` un éxito fijo, de modo que el camino feliz sea observable.
+function spyDeps() {
+  const calls = {
+    exchange: [] as Array<[string, string]>,
+    fetchEmail: [] as string[],
+    login: [] as string[],
+  };
+  const deps: CallbackDeps = {
+    exchange: async (code, verifier) => {
+      calls.exchange.push([code, verifier]);
+      return "access-token";
+    },
+    fetchEmail: async (accessToken) => {
+      calls.fetchEmail.push(accessToken);
+      return "user@example.com";
+    },
+    login: async (email) => {
+      calls.login.push(email);
+      return { success: true, token: "session-token", role: "rep" };
+    },
+  };
+  return { deps, calls };
+}
+
+test.describe("runGoogleCallback — gate de precondiciones (MIS-299)", () => {
+  test("verifier AUSENTE con state válido → rechazo SIN intercambio", async () => {
+    const { deps, calls } = spyDeps();
+    const inputs: CallbackInputs = { code: "auth-code", returnedState: "s", savedState: "s", codeVerifier: null };
+    const result = await runGoogleCallback(inputs, deps);
+    expect(result.ok).toBe(false);
+    expect(calls.exchange).toHaveLength(0); // no se llegó al fetch del token
+    expect(calls.fetchEmail).toHaveLength(0);
+    expect(calls.login).toHaveLength(0);
+  });
+
+  test("verifier MALFORMADO con state válido → rechazo SIN intercambio", async () => {
+    const { deps, calls } = spyDeps();
+    const inputs: CallbackInputs = { code: "auth-code", returnedState: "s", savedState: "s", codeVerifier: "too-short" };
+    const result = await runGoogleCallback(inputs, deps);
+    expect(result.ok).toBe(false);
+    expect(calls.exchange).toHaveLength(0);
+  });
+
+  test("state NO coincidente → rechazo SIN intercambio", async () => {
+    const { deps, calls } = spyDeps();
+    const verifier = generatePkceVerifier();
+    const inputs: CallbackInputs = { code: "auth-code", returnedState: "s1", savedState: "s2", codeVerifier: verifier };
+    const result = await runGoogleCallback(inputs, deps);
+    expect(result.ok).toBe(false);
+    expect(calls.exchange).toHaveLength(0);
+  });
+
+  test("control positivo: verifier válido atraviesa exchange→email→login con args EXACTOS", async () => {
+    const { deps, calls } = spyDeps();
+    const verifier = generatePkceVerifier();
+    const inputs: CallbackInputs = { code: "auth-code", returnedState: "s", savedState: "s", codeVerifier: verifier };
+    const result = await runGoogleCallback(inputs, deps);
+    expect(result).toEqual({ ok: true, token: "session-token", role: "rep" });
+    // exchange recibe EXACTAMENTE el code y el verifier validados (una vez).
+    expect(calls.exchange).toEqual([["auth-code", verifier]]);
+    // fetchEmail recibe el access token devuelto por exchange.
+    expect(calls.fetchEmail).toEqual(["access-token"]);
+    // login recibe el email devuelto por fetchEmail.
+    expect(calls.login).toEqual(["user@example.com"]);
+  });
+});
+
+test.describe("callbackPreconditionsOk / isValidPkceVerifier (MIS-299)", () => {
+  test("isValidPkceVerifier — longitudes frontera y juego de caracteres RFC 7636", () => {
+    expect(isValidPkceVerifier("A".repeat(42))).toBe(false); // < 43
+    expect(isValidPkceVerifier("A".repeat(43))).toBe(true); // mínimo
+    expect(isValidPkceVerifier("A".repeat(128))).toBe(true); // máximo
+    expect(isValidPkceVerifier("A".repeat(129))).toBe(false); // > 128
+    expect(isValidPkceVerifier(null)).toBe(false);
+    // 43 chars pero con un carácter FUERA del juego "unreserved":
+    expect(isValidPkceVerifier("+".padEnd(43, "A"))).toBe(false); // '+'
+    expect(isValidPkceVerifier("A".repeat(21) + " " + "A".repeat(21))).toBe(false); // espacio
+    // Los cuatro "unreserved" no alfanuméricos SÍ se aceptan:
+    expect(isValidPkceVerifier("-._~".padEnd(43, "A"))).toBe(true);
+  });
+
+  test("callbackPreconditionsOk — gate completo", () => {
+    const v = "A".repeat(43);
+    expect(callbackPreconditionsOk({ code: "c", returnedState: "s", savedState: "s", codeVerifier: v })).toBe(true);
+    expect(callbackPreconditionsOk({ code: null, returnedState: "s", savedState: "s", codeVerifier: v })).toBe(false);
+    expect(callbackPreconditionsOk({ code: "c", returnedState: null, savedState: "s", codeVerifier: v })).toBe(false);
+    expect(callbackPreconditionsOk({ code: "c", returnedState: "s", savedState: "other", codeVerifier: v })).toBe(false);
+    expect(callbackPreconditionsOk({ code: "c", returnedState: "s", savedState: "s", codeVerifier: null })).toBe(false);
+  });
+});
+
+test.describe("generatePkceVerifier / computePkceChallenge (MIS-299)", () => {
+  test("generatePkceVerifier — válido (43 chars) y distinto entre llamadas", () => {
+    const a = generatePkceVerifier();
+    const b = generatePkceVerifier();
+    expect(isValidPkceVerifier(a)).toBe(true);
+    expect(isValidPkceVerifier(b)).toBe(true);
+    expect(a).toHaveLength(43);
+    expect(a).not.toBe(b);
+  });
+
+  test("computePkceChallenge — S256 = base64url(SHA-256(verifier)) sin padding", async () => {
+    const verifier = "verifier-fijo-de-prueba-MIS299";
+    // Control independiente con node:crypto (base64url de Node ya va sin padding).
+    const expected = createHash("sha256").update(verifier).digest("base64url");
+    expect(await computePkceChallenge(verifier)).toBe(expected);
+    expect(expected).toMatch(/^[A-Za-z0-9_-]{43}$/);
+  });
+});
+
+test.describe("exchangeCodeForAccessToken — POST con code_verifier (MIS-299)", () => {
+  test("el body del intercambio incluye code_verifier y el resto de parámetros", async () => {
+    const ENV_KEYS = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_OAUTH_REDIRECT_URI"] as const;
+    // Guarda el estado PREVIO distinguiendo "ausente" de "definida" (no asignar
+    // nunca el string "undefined" al restaurar).
+    const saved = ENV_KEYS.map((k) => [k, k in process.env, process.env[k]] as const);
+    process.env.GOOGLE_CLIENT_ID = "client-id-dummy";
+    process.env.GOOGLE_CLIENT_SECRET = "client-secret-dummy";
+    process.env.GOOGLE_OAUTH_REDIRECT_URI = "https://example.test/api/auth/google/callback";
+
+    const originalFetch = globalThis.fetch;
+    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
+    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
+      calls.push({ url: String(url), init });
+      return new Response(JSON.stringify({ access_token: "at-123" }), {
+        status: 200,
+        headers: { "Content-Type": "application/json" },
+      });
+    }) as typeof fetch;
+
+    try {
+      const token = await exchangeCodeForAccessToken("auth-code-xyz", "verifier-abc");
+      expect(token).toBe("at-123");
+      // Una SOLA llamada a fetch, al endpoint y con el método/content-type exactos.
+      expect(calls).toHaveLength(1);
+      expect(calls[0].url).toBe("https://oauth2.googleapis.com/token");
+      expect(calls[0].init?.method).toBe("POST");
+      const headers = new Headers(calls[0].init?.headers);
+      expect(headers.get("Content-Type")).toBe("application/x-www-form-urlencoded");
+      const body = new URLSearchParams(String(calls[0].init?.body));
+      expect(body.get("code")).toBe("auth-code-xyz");
+      expect(body.get("code_verifier")).toBe("verifier-abc");
+      expect(body.get("grant_type")).toBe("authorization_code");
+      expect(body.get("redirect_uri")).toBe("https://example.test/api/auth/google/callback");
+      expect(body.get("client_id")).toBe("client-id-dummy");
+      expect(body.get("client_secret")).toBe("client-secret-dummy");
+      // Exactitud: SOLO esos seis parámetros, ninguno de más.
+      expect([...body.keys()].sort()).toEqual([
+        "client_id",
+        "client_secret",
+        "code",
+        "code_verifier",
+        "grant_type",
+        "redirect_uri",
+      ]);
+    } finally {
+      globalThis.fetch = originalFetch;
+      for (const [k, had, val] of saved) {
+        if (!had) delete process.env[k];
+        else process.env[k] = val as string;
+      }
+    }
+  });
+});
```

### 4.7 `e2e/google-auth.spec.ts` (aditivo: preserva todos los comentarios previos)
```diff
--- e2e/google-auth.spec.ts
+++ CODIGO/MIS-299-pkce/e2e/google-auth.spec.ts
@@ -1,4 +1,5 @@
 import { test, expect } from "@playwright/test";
+import { createHash } from "node:crypto";
 
 // MIS-260: sin sesión (sin storageState) — corre en el project
 // "chromium-unauth", sin dependencies de setup-carlos/setup-marta. Cubre
@@ -6,6 +7,9 @@
 // código real contra Google queda fuera de alcance automatizado (requeriría
 // una cuenta de Google real, no viable en CI, o mockear los endpoints de
 // Google — ver PLANS/MIS-260-login-google.md, "Fuera de alcance").
+//
+// MIS-299 (B6, PKCE): el /start pasa a emitir code_challenge/S256 y a fijar la
+// cookie del verifier; el /callback borra AHORA las tres cookies transitorias.
 
 test.describe("Google OAuth: /start y /callback (sin cuenta real de Google)", () => {
   test("/api/auth/google/start pone la cookie de estado y redirige a Google con el mismo state", async ({
@@ -44,21 +48,50 @@
     // MIS-293 (B1/B2): `Secure` y el `path` EXACTO en ese fragmento.
     expect(stateSetCookie!).toMatch(/;\s*Secure(?:;|$)/i);
     expect(stateSetCookie!).toMatch(/;\s*Path=\/api\/auth\/google(?:;|$)/i);
+
+    // MIS-299 (B6, PKCE): la URL de autorización lleva el reto con método S256.
+    expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
+    const codeChallenge = authUrl.searchParams.get("code_challenge");
+    expect(codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/); // base64url(SHA-256) sin padding
+
+    // MIS-299: el Set-Cookie del verifier se aísla igual que el del state y se
+    // comprueban TODOS sus atributos (Secure, HttpOnly, SameSite, Max-Age, Path).
+    const verifierSetCookie = res
+      .headersArray()
+      .filter((h) => h.name.toLowerCase() === "set-cookie")
+      .map((h) => h.value)
+      .find((v) => /^__Secure-google_pkce_verifier=/.test(v));
+    expect(verifierSetCookie, "el Set-Cookie del verifier debe existir").toBeTruthy();
+    expect(verifierSetCookie!).toMatch(/;\s*Secure(?:;|$)/i);
+    expect(verifierSetCookie!).toMatch(/;\s*HttpOnly(?:;|$)/i);
+    expect(verifierSetCookie!).toMatch(/;\s*SameSite=Lax(?:;|$)/i);
+    expect(verifierSetCookie!).toMatch(/;\s*Max-Age=600(?:;|$)/i);
+    expect(verifierSetCookie!).toMatch(/;\s*Path=\/api\/auth\/google(?:;|$)/i);
+
+    // MIS-299: invariante FUERTE de PKCE — code_challenge == base64url(SHA-256(verifier)).
+    // Se recomputa con node:crypto sobre el valor real de la cookie del verifier.
+    const verifierMatch = /^__Secure-google_pkce_verifier=([^;]+)/.exec(verifierSetCookie!);
+    const verifierValue = decodeURIComponent(verifierMatch![1]);
+    const expectedChallenge = createHash("sha256").update(verifierValue).digest("base64url");
+    expect(codeChallenge).toBe(expectedChallenge);
   });
 
-  // MIS-293 (B2, borrado): el callback borra la cookie de estado SIEMPRE, éxito o
-  // no (route.ts: "de un solo uso — se borra siempre"). Aquí se inyecta una cookie
-  // de estado presente y se comprueba que el callback la RETIRA del jar. Se usa un
+  // MIS-293 (B2, borrado) + MIS-299 (PKCE): el callback borra SIEMPRE, éxito o no
+  // (route.ts: "de un solo uso — se borran siempre"), las TRES cookies transitorias
+  // del flujo: state nuevo, verifier PKCE y la gemela legada `google_oauth_state`.
+  // Se inyectan las tres y se comprueba que el callback las RETIRA del jar. Se usa un
   // `state` de query DISTINTO al de la cookie para que el callback rechace ANTES de
   // llamar a Google (sin red externa) pero igualmente ejecute el borrado.
-  test("/api/auth/google/callback borra la cookie de estado presente (se borra siempre)", async ({
+  test("/api/auth/google/callback borra las tres cookies transitorias (se borran siempre)", async ({
     context,
     baseURL,
   }) => {
     const host = new URL(baseURL!).hostname;
-    // Fixture con `secure: true` y su `path` original: si no cumpliera el prefijo
-    // `__Secure-`, Chromium lo rechazaría y el test solo probaría el camino "sin
-    // cookie". Se confirma que SÍ quedó guardada antes de invocar el callback.
+    const validVerifier = "A".repeat(43); // forma RFC 7636 válida
+    // Fixtures con `secure: true` en las `__Secure-*`: si no cumplieran el prefijo,
+    // Chromium las rechazaría y el test solo probaría el camino "sin cookies". La
+    // gemela legada (sin prefijo) no requiere `secure`. Se confirma abajo que las
+    // TRES quedaron guardadas antes de invocar el callback.
     await context.addCookies([
       {
         name: "__Secure-google_oauth_state",
@@ -67,16 +100,37 @@
         path: "/api/auth/google",
         secure: true,
       },
+      {
+        name: "__Secure-google_pkce_verifier",
+        value: validVerifier,
+        domain: host,
+        path: "/api/auth/google",
+        secure: true,
+      },
+      {
+        name: "google_oauth_state",
+        value: "legado",
+        domain: host,
+        path: "/api/auth/google",
+      },
     ]);
-    // Precondición: comprueba la cookie EXACTA (no solo que exista alguna con ese
-    // nombre) — si Chromium hubiera rechazado el fixture por incumplir el prefijo,
-    // el test solo probaría el camino "sin cookie".
-    const fixture = (await context.cookies()).find((c) => c.name === "__Secure-google_oauth_state");
-    expect(fixture, "el fixture de la cookie de estado debe haberse guardado").toMatchObject({
+    // Precondición: comprueba las cookies EXACTAS (no solo que exista alguna con ese
+    // nombre) — si Chromium hubiera rechazado un fixture __Secure-* por incumplir el
+    // prefijo, el test solo probaría el camino "sin cookies" (falso verde).
+    const before = await context.cookies();
+    expect(before.find((c) => c.name === "__Secure-google_oauth_state")).toMatchObject({
       value: "estado-guardado",
       secure: true,
       path: "/api/auth/google",
     });
+    expect(before.find((c) => c.name === "__Secure-google_pkce_verifier")).toMatchObject({
+      value: validVerifier,
+      secure: true,
+      path: "/api/auth/google",
+    });
+    expect(before.find((c) => c.name === "google_oauth_state")).toMatchObject({
+      path: "/api/auth/google",
+    });
 
     // context.request comparte el cookie jar del BrowserContext (el Set-Cookie de
     // la respuesta actualiza el jar).
@@ -91,10 +145,11 @@
     expect(location.pathname).toBe("/login");
     expect(location.searchParams.get("error")).toBe("google");
 
-    // Definitivo: el jar ya no contiene la cookie de estado (la borró el callback).
-    expect((await context.cookies()).some((c) => c.name === "__Secure-google_oauth_state")).toBe(
-      false,
-    );
+    // Definitivo: el jar ya no contiene NINGUNA de las tres (las borró el callback).
+    const after = await context.cookies();
+    expect(after.some((c) => c.name === "__Secure-google_oauth_state")).toBe(false);
+    expect(after.some((c) => c.name === "__Secure-google_pkce_verifier")).toBe(false);
+    expect(after.some((c) => c.name === "google_oauth_state")).toBe(false);
   });
 
   test("/api/auth/google/callback sin cookie de estado rechaza sin llamar a Google", async ({ page }) => {
```
> Los dos últimos tests del fichero (`sin cookie de estado` y `/login ?error=google`) quedan SIN
> cambios (incluido el comentario de `getByRole`/`__next-route-announcer__`).

## 5. Evidencia reproducible

### 5.1 Call sites de las firmas modificadas (repo `main` ANTES de instalar)
`grep -rn "buildGoogleAuthUrl" --include=*.ts src/ e2e/ | LC_ALL=C sort`
```
src/app/api/auth/google/start/route.ts:10:  redirect(buildGoogleAuthUrl(state));
src/app/api/auth/google/start/route.ts:3:import { buildGoogleAuthUrl, generateOAuthState } from "@/lib/auth/google";
src/lib/auth/google.ts:38:export function buildGoogleAuthUrl(state: string): string {
src/lib/auth/google.ts:58:    // Mismo valor exacto que en buildGoogleAuthUrl — Google exige que el
```
`grep -rn "exchangeCodeForAccessToken" --include=*.ts src/ e2e/ | LC_ALL=C sort`
```
src/app/api/auth/google/callback/route.ts:12:import { exchangeCodeForAccessToken, fetchVerifiedGoogleEmail } from "@/lib/auth/google";
src/app/api/auth/google/callback/route.ts:34:    const accessToken = await exchangeCodeForAccessToken(code);
src/lib/auth/google.ts:53:export async function exchangeCodeForAccessToken(code: string): Promise<string> {
```
→ Cada firma tiene **un único call site de producción** (start / callback), ambos actualizados aquí.

### 5.2 Símbolo retirado `clearOAuthStateCookie`
`grep -rn "clearOAuthStateCookie" --include=*.ts src/ e2e/ | LC_ALL=C sort`
```
src/app/api/auth/google/callback/route.ts:11:import { clearOAuthStateCookie, readOAuthStateCookie, setSessionCookie } from "@/lib/auth/cookie";
src/app/api/auth/google/callback/route.ts:50:  await clearOAuthStateCookie();
src/lib/auth/cookie.ts:90:export async function clearOAuthStateCookie(): Promise<void> {
```
→ Único importador/usuario: el callback (pasa a `clearOAuthTransientCookies`). Tras instalar, un
`grep clearOAuthStateCookie` debe devolver **0 líneas**.

### 5.3 Listado COMPLETO del deliverable (sin filtro de extensión)
`find CODIGO/MIS-299-pkce -type f | LC_ALL=C sort`
```
CODIGO/MIS-299-pkce/MIS-299-pkce-codigo-completo.md
CODIGO/MIS-299-pkce/e2e/google-auth.spec.ts
CODIGO/MIS-299-pkce/e2e/lib-unit.spec.ts
CODIGO/MIS-299-pkce/src/app/api/auth/google/callback/route.ts
CODIGO/MIS-299-pkce/src/app/api/auth/google/start/route.ts
CODIGO/MIS-299-pkce/src/lib/auth/constants.ts
CODIGO/MIS-299-pkce/src/lib/auth/cookie.ts
CODIGO/MIS-299-pkce/src/lib/auth/google.ts
```
→ 8 ficheros: 7 de código (solo `src/` y `e2e/`) + este documento `.md`. **Cero ficheros `convex/`**,
cero `.tsx`/`.js`/`.json`/otros → sin despliegue de Convex.

### 5.4 No queda ningún `buildGoogleAuthUrl(state)` de un solo argumento en el deliverable
`grep -rn "buildGoogleAuthUrl(" CODIGO/MIS-299-pkce/ | grep -v "codeChallenge\|challenge"`
→ salida vacía (todos los usos pasan el 2º argumento).

## 6. Checklist de cierre (§8 de la ronda anterior)

1. **Diff literal completo** de `src/lib/auth/google.ts` → §4.2. ✅
2. **Diff literal completo** de `e2e/lib-unit.spec.ts` → §4.6. ✅
3. **Listado sin filtro** de todos los archivos del deliverable → §5.3. ✅
4. **Aserción de claves exactas del POST** (opcional) → adoptada, visible en §4.6 (`[...body.keys()].sort()`). ✅

Resto de diffs literales (constants, cookie, ambos handlers, google-auth) → §4.1, 4.3, 4.4, 4.5, 4.7.

## 7. Notas a las sugerencias no bloqueantes

- **`callbackError` como valor/indicador (Baja):** un `throw` de valor *falsy* (`null`, `false`, `""`)
  no entraría en `if (callbackError)`, pero el flujo **sigue siendo fail-closed**: `result` quedaría
  `undefined` y la rama `if (!result || !result.ok)` redirige a `/login?error=google`. En la práctica
  `handleCallback` solo puede propagar objetos `Error`. Se deja como está para **no reabrir el
  lifecycle** (fuera de alcance por §8 previo); anotado como deuda menor.
- **`googleError` al log (Baja):** valor de query sin sanear en `console.error` — **deuda
  preexistente** (MIS-260), no introducida por PKCE; fuera de alcance de este ticket.

## 8. Verificación pendiente TRAS instalar byte-idéntico (fuera de este documento)

- `npm run lint` (0 errores) · `npm run build` (OK).
- `npm run test:e2e` completo — foco en project `unit` (bloques PKCE) y `chromium-unauth`
  (`google-auth.spec.ts`).
- Igualdad byte-a-byte CODIGO ↔ repo tras copiar.
- Smoke prod (frontend-only): `GET /api/auth/google/start` → `Location` con `code_challenge` +
  `code_challenge_method=S256`. Aceptación: un login real con Google completo.

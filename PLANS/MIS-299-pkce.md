# MIS-299 · PKCE en el login con Google (OAuth, hallazgo B6)

> Dividido de MIS-293 (Fase 3 — Higiene). Plan de récord, **ronda 4** (auditorías previas:
> M1/M2 → M1.1/M2.1 → M1.2/M2.2). **NO autoriza instalar/mergear/desplegar** — ver "Gate".

## Contexto

El login con Google (MIS-260) usa *authorization code* con cookie `state` anti-CSRF pero **sin
PKCE** (RFC 7636). Un `code` interceptado se canjea sin más. PKCE ata autorización e intercambio:
`/start` genera un `code_verifier` secreto (cookie httpOnly), manda a Google su hash
(`code_challenge`, `S256`), y `/callback` prueba posesión del verifier al canjear. Un `code` robado
es inservible sin el verifier.

**Hallazgo Bajo, endurecimiento puro.** No cambia UX ni contrato de login. **No toca `convex/` → sin
despliegue de Convex** (solo frontend, Railway). **Sin cambios en Google Cloud Console** (PKCE no se
registra; convive con el `client_secret`: cliente confidencial + PKCE).

**Secuencia:** parte de `main` con el PR de cookies de MIS-293 (#61, `541bafe`) ya presente.
**Runtime:** ambos handlers Node.js por defecto; Web Crypto global. Call sites: `buildGoogleAuthUrl`
solo en `start/route.ts`; `exchangeCodeForAccessToken` solo dentro del núcleo del callback.

## Diseño

### 1. `src/lib/auth/constants.ts`
```ts
export const PKCE_VERIFIER_COOKIE_NAME = "__Secure-google_pkce_verifier";
```
Cookie **nueva** (`__Secure-`, `path` ≠ `/`): sin gemela legada.

### 2. `src/lib/auth/google.ts` — cripto, guard **tipado** y núcleo del callback
- `bytesToBase64Url(bytes)` privado común (extraído de `generateOAuthState`, salida idéntica).
- `generatePkceVerifier(): string` — 32 bytes → base64url (43 chars).
- `computePkceChallenge(verifier): Promise<string>` — `bytesToBase64Url(SHA-256(TextEncoder(verifier)))`.
- `isValidPkceVerifier(v: string | null): v is string` — 43–128 y `^[A-Za-z0-9\-._~]+$`.
- **Guard tipado (fix de M2.2)** — como *type predicate* que estrecha los 4 campos:
  ```ts
  type CallbackInputs = { code: string | null; returnedState: string | null; savedState: string | null; codeVerifier: string | null };
  type ValidCallbackInputs = { code: string; returnedState: string; savedState: string; codeVerifier: string };
  export function callbackPreconditionsOk(a: CallbackInputs): a is ValidCallbackInputs {
    return !!a.code && !!a.returnedState && !!a.savedState
      && a.returnedState === a.savedState && isValidPkceVerifier(a.codeVerifier);
  }
  ```
  Tras `if (!callbackPreconditionsOk(inputs)) return {ok:false,...}`, TS estrecha `inputs` a
  `ValidCallbackInputs`, así que `deps.exchange(inputs.code, inputs.codeVerifier)` compila con
  `string`/`string` **sin** `!` ni casts.
- **`runGoogleCallback(inputs: CallbackInputs, deps): Promise<Result>`** — núcleo puro con deps
  inyectadas (`exchange`, `fetchEmail`, `login`); en producción `exchange = exchangeCodeForAccessToken`,
  `fetchEmail = fetchVerifiedGoogleEmail`, `login = (email) => fetchMutation(api.auth.loginWithGoogle, { email, serverKey })`.
  Aplica el guard y **solo** en la rama estrechada llama a `deps.exchange(...)` dentro de `try/catch`
  (mismo mapeo de errores de hoy). `Result` se exporta desde aquí. `google.ts` queda sin imports de
  Next/Convex.
- `buildGoogleAuthUrl(state, codeChallenge)` — añade `code_challenge` + `code_challenge_method:"S256"`.
- `exchangeCodeForAccessToken(code, codeVerifier)` — añade `code_verifier` al body; **el error solo
  incluye `res.status`** (nunca el cuerpo de la respuesta de Google — sugerencia Baja).

### 3. `src/lib/auth/cookie.ts` — set/read del verifier + limpieza de **las tres** cookies
- `setPkceVerifierCookie` / `readPkceVerifierCookie`, calcados de los de `state`
  (`httpOnly, secure, sameSite:"lax", path:"/api/auth/google"`, `maxAge` = 600 s). Cookie separada.
- **`clearOAuthTransientCookies()`** — un store, **tres** escrituras, intentando las tres aunque una
  lance, propagando el primer error (fail-closed):
  ```ts
  const cookieStore = await cookies();
  const oauthClearOptions = { httpOnly: true, secure: true, sameSite: "lax", path: "/api/auth/google", maxAge: 0 } as const;
  const legacyClearOptions = { path: "/api/auth/google", maxAge: 0 } as const;
  const writes = [
    () => cookieStore.set(OAUTH_STATE_COOKIE_NAME, "", oauthClearOptions),   // state nuevo
    () => cookieStore.set(PKCE_VERIFIER_COOKIE_NAME, "", oauthClearOptions),  // verifier
    () => cookieStore.set("google_oauth_state", "", legacyClearOptions),      // gemela LEGADA (MIS-293)
  ];
  let firstError: unknown;
  for (const w of writes) { try { w(); } catch (e) { firstError ??= e; } }
  if (firstError) throw firstError;
  ```
  Retira `clearOAuthStateCookie` pero **conserva** el borrado de `google_oauth_state` (escritura 3):
  sin regresión sobre la migración legada.

### 4. `src/app/api/auth/google/start/route.ts`
```ts
const state = generateOAuthState();
const verifier = generatePkceVerifier();
const challenge = await computePkceChallenge(verifier);
await setOAuthStateCookie(state);
await setPkceVerifierCookie(verifier);
redirect(buildGoogleAuthUrl(state, challenge));
```

### 5. `src/app/api/auth/google/callback/route.ts` — adaptador delgado + limpieza y doble error
`handleCallback` lee searchParams/cookies y delega **obligatoriamente** en `runGoogleCallback`:
```ts
const googleError = request.nextUrl.searchParams.get("error");
if (googleError) return { ok: false, reason: `google error: ${googleError}` };
const inputs: CallbackInputs = {
  code: request.nextUrl.searchParams.get("code"),
  returnedState: request.nextUrl.searchParams.get("state"),
  savedState: await readOAuthStateCookie(),
  codeVerifier: await readPkceVerifierCookie(),
};
return runGoogleCallback(inputs, { exchange: exchangeCodeForAccessToken, fetchEmail: fetchVerifiedGoogleEmail, login });
```
El `GET` limpia **siempre** y **conserva ambos diagnósticos** capturando el error primario
(fix real de la sugerencia Media — `handleCallback` no debería lanzar, pero se captura por si acaso):
```ts
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
let result: Result | undefined;
let callbackError: unknown;
try {
  result = await handleCallback(request);
} catch (e) {
  callbackError = e;
} finally {
  try {
    await clearOAuthTransientCookies();
  } catch (cleanupErr) {
    if (callbackError) console.error("[google-auth] error del callback:", errMsg(callbackError));
    else if (result && !result.ok) console.error("[google-auth] callback falló:", result.reason);
    console.error("[google-auth] fallo al limpiar cookies transitorias:", errMsg(cleanupErr));
    throw cleanupErr; // fail-closed: sin éxito si no se limpió
  }
}
if (callbackError) { console.error("[google-auth] error del callback:", errMsg(callbackError)); redirect("/login?error=google"); }
if (!result || !result.ok) { console.error("[google-auth] callback falló:", result?.reason); redirect("/login?error=google"); }
await setSessionCookie(result.token);
redirect(landingPathForRole(result.role));
```
Cliente siempre recibe el genérico `/login?error=google` (sin oráculo). Nunca se loguean `state`,
verifier, `code` ni tokens.

## Verificación

### Unit (`e2e/lib-unit.spec.ts`, project `unit`, Node)
1. **Integración del gate en el núcleo real (M2.1).** `runGoogleCallback({ code:"c", returnedState:"s",
   savedState:"s", codeVerifier:null }, deps-spy)` → `result.ok === false` y `exchange` llamado **0
   veces**. Ídem con verifier malformado. **Control positivo:** con `codeVerifier` válido, `exchange`
   se llama **1 vez y con exactamente ese `code` y ese verifier** (spy captura y compara args —
   sugerencia Baja), y el núcleo atraviesa `fetchEmail`→`login`.
2. **`callbackPreconditionsOk` frontera:** 42→false, 43→true, 128→true, 129→false; `+`/`/`/espacios,
   `null`, state no coincidente, sin code → false.
3. **`generatePkceVerifier`:** satisface `isValidPkceVerifier`; varias llamadas → valores distintos.
4. **`exchangeCodeForAccessToken` (POST con `code_verifier`).** `fetch` mockeado (restaurado en
   `finally`) + env dummy: **una sola** llamada a `fetch` (sugerencia Baja) a
   `https://oauth2.googleapis.com/token`, `Content-Type: application/x-www-form-urlencoded`, body
   (`URLSearchParams`) con exactamente `code`, `code_verifier`, `grant_type=authorization_code`,
   `redirect_uri`, `client_id`, `client_secret`; devuelve el `access_token` del stub. Restauración de
   env distinguiendo ausente (`delete`) vs definida (restaurar valor) — nunca `"undefined"`.
5. **Control S256:** `computePkceChallenge(v)` == `base64url(SHA-256(v))` (recomputado con `node:crypto`).

### E2E (`e2e/google-auth.spec.ts`, project `chromium-unauth`)
- `/start`: `code_challenge_method === "S256"`; `code_challenge` cumple `^[A-Za-z0-9_-]{43}$`; el
  `Set-Cookie` del verifier (fragmento aislado) cumple `Secure`, `HttpOnly`, `SameSite=Lax`,
  `Max-Age=600`, `Path=/api/auth/google`; invariante fuerte:
  `base64url(SHA-256(verifierCookieValue))` `== code_challenge`.
- `/callback` (limpieza de **las tres** cookies, fix de **M1.2**):
  - **Fixtures con `secure:true`** en las dos `__Secure-*` (obligatorio para que Chromium las acepte):
    ```ts
    await context.addCookies([
      { name: "__Secure-google_oauth_state", value: "saved-state", domain: host, path: "/api/auth/google", secure: true },
      { name: "__Secure-google_pkce_verifier", value: validVerifier, domain: host, path: "/api/auth/google", secure: true },
      { name: "google_oauth_state", value: "legacy", domain: host, path: "/api/auth/google" },
    ]);
    ```
  - **Precondición** (demuestra que las tres se almacenaron ANTES del callback):
    ```ts
    const before = await context.cookies();
    expect(before.find((c) => c.name === "__Secure-google_oauth_state")).toMatchObject({ value: "saved-state", secure: true, path: "/api/auth/google" });
    expect(before.find((c) => c.name === "__Secure-google_pkce_verifier")).toMatchObject({ value: validVerifier, secure: true, path: "/api/auth/google" });
    expect(before.find((c) => c.name === "google_oauth_state")).toMatchObject({ path: "/api/auth/google" });
    ```
  - Solo entonces: invocar el callback con `state=no-coincide` (rechazo temprano), asertar redirect a
    `/login?error=google` y que **las tres** cookies desaparecen del jar.

### Resto
- `npm run lint`, `npm run build`, suite e2e completa (`npm run test:e2e`).
- Igualdad byte-a-byte CODIGO ↔ repo tras instalar.
- **Prod (frontend-only):** smoke sin credenciales — `/api/auth/google/start` → `Location` con
  `code_challenge` + `code_challenge_method=S256`. **Aceptación:** un login real con Google completo.

## Cambios respecto a la ronda 3 (para la re-auditoría, §8)
1. **M1.2** — fixtures del e2e de callback con `secure:true` en las dos `__Secure-*`, y **precondición**
   `toMatchObject` que demuestra las tres cookies presentes (valor, `secure`, `path`) antes del
   callback; solo después se comprueba que desaparecen.
2. **M2.2** — `callbackPreconditionsOk` como **type predicate** `a is ValidCallbackInputs`; el núcleo
   llama a `exchange` desde la rama ya estrechada, sin `!`/casts.
3. **Doble error** — el `GET` captura `callbackError` en `catch` y lo conserva junto al `cleanupErr`
   (log seguro, sin valores de cookies); fail-closed. La afirmación "conserva ambos diagnósticos"
   queda respaldada por el `catch` explícito.
4. Bajas: control positivo asevera args exactos de `exchange`; el test del POST asevera **una sola**
   llamada a `fetch`; el error del intercambio nunca incluye el cuerpo de la respuesta de Google.

## Gate (metodología estricta)

Este plan **NO** autoriza instalar/mergear/desplegar. Flujo: código (effort **high**) → entrega
autocontenida en `CODIGO/MIS-299-pkce/` (contenido literal + diffs completos) → **auditoría de código
externa** (GO/NO-GO) → instalar byte-idéntico → lint/build/e2e verdes → PR (permiso antes del push) →
CI verde → merge (asistente, con permiso) → Railway auto-despliega el frontend → smoke en prod →
aceptación de login real → cerrar MIS-299.

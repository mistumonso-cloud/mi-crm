# MIS-293 · 2.º PR — Cookies (B1 + B2) — CÓDIGO COMPLETO

Rama (a crear tras GO): `mistumonso/mis-293-cookies`. Plan: `PLANS/MIS-293-cookies.md` (GO ronda 3).
Segunda y última unidad de MIS-293; con esto se cierra el ticket. **No** hay cambios en `convex/`
→ no hay despliegue de Convex; el frontend lo auto-despliega Railway al mergear.

> **Documento autocontenido:** el auditor solo ve este texto. Ficheros **modificados** → **diff
> unificado completo**. Ficheros **nuevos** → **contenido literal íntegro**. Se incluye además la
> **evidencia grep clasificada** (salida real).
>
> **Ronda 4 (tras NO-GO):** C2 — el comando de (B)/(C) incluye ahora `| LC_ALL=C sort` **visible**
> (orden determinista que coincide con la salida pegada) y se registra el **código de salida** de
> grep. Baja: se retira de la clasificación la mención a una "regex del Set-Cookie" que no casaba con
> el patrón. **(Ronda 3):** C2 — los comandos grep pasan a ser **ejecutables literalmente** (PCRE
> `-P` + clases hex `[\x22\x27\x60]`, sin metacaracteres de shell) y se ejecutan **dentro** del
> directorio del snapshot para que las rutas de la salida coincidan; C3 — `session-cookie.spec.ts`
> importa `api` **directamente** de `../convex/_generated/api` (no del helper). Media/Baja: fragmento
> `__Secure-google_oauth_state` aislado con `headersArray()` en `/start`; `Path=/` exacto
> (`/;\s*Path=\/(?:;|$)/`); nombre literal `__Secure-reset_ticket` en recuperación; comentario de
> `cookie.ts` acotado a Chromium. (Ronda 2: C1 — Location validada semánticamente; evidencia grep
> sobre todo el árbol; precondición exacta del fixture OAuth; `try/finally` best-effort;
> no-concurrencia documentada.)

## 0. Qué hace y decisiones clave

- **B1** — `secure: true` SIEMPRE en las 6 set/clear de `cookie.ts` (antes `NODE_ENV==="production"`,
  frágil). Los prefijos de B2 obligan a `Secure`.
- **B2** — nombres con prefijo reforzado por el navegador: `__Host-session`,
  `__Secure-google_oauth_state`, `__Secure-reset_ticket`.
- **M1 (borrado transitorio activo, sin lectura dual)** — cada set/clear de una cookie nueva **expira
  su gemela antigua** en su path original; y `proxy.ts` borra la `session` antigua en el redirect a
  `/login`. No se revocan sesiones en servidor (documentado; riesgo residual y rollback en el plan).
- **M2 (prueba ejecutable)** — nuevo spec `legacy-cookie-migration.spec.ts` demuestra que la `session`
  antigua desaparece al pasar por el proxy.

### Desviación respecto al manifiesto del plan (justificada) — léase primero

El plan (ítem 8) preveía la aserción de logout en `e2e/full-flow.spec.ts`. **Se cambia** a un spec
nuevo **`e2e/session-cookie.spec.ts`** en el project **`chromium-secrets`**, por dos motivos de
corrección/seguridad detectados al codificar:

1. **No romper la sesión compartida.** `full-flow.spec.ts` corre en `chromium-carlos` con el
   `storageState` de `e2e/.auth/carlos.json`. Un logout ahí llamaría a `api.auth.logout` con **ese
   token compartido** y lo **borraría en servidor**; las specs de Marta lo reutilizan vía
   `carlosTokenFromDisk()` → romperían. El nuevo spec usa una **sesión desechable** (login propio).
2. **No filtrar la contraseña.** El ciclo teclea `E2E_CARLOS_PASSWORD`; `chromium-secrets` tiene
   `trace/video/screenshot: off` (política anti-fuga de MIS-286), a diferencia de `chromium-carlos`.

Misma cobertura (set→clear de `__Host-session`), ubicación segura. Se registra en `playwright.config.ts`.

## Manifiesto

| # | Fichero | Acción |
|---|---|---|
| 1 | `src/lib/auth/constants.ts` | modificado — renombrar los 3 nombres (B2) |
| 2 | `src/lib/auth/cookie.ts` | modificado — `secure:true` (B1) + borrado transitorio de gemelas (M1) |
| 3 | `src/proxy.ts` | modificado — borrar `session` legada en el redirect (M1) |
| 4 | `e2e/helpers/convex-client.ts` | modificado — centralizar en `SESSION_COOKIE_NAME` |
| 5 | `e2e/google-auth.spec.ts` | modificado — nombre nuevo + `Secure`/path (set) + test de clear |
| 6 | `e2e/auth.setup.ts` | modificado — aserción obligatoria de `__Host-session` |
| 7 | `e2e/password-reset.spec.ts` | modificado — `secure` + prefijo `__Secure-` |
| 8 | `playwright.config.ts` | modificado — registrar los 2 specs nuevos |
| 9 | `e2e/legacy-cookie-migration.spec.ts` | **nuevo** — prueba de M2 (proxy borra `session`) |
| 10 | `e2e/session-cookie.spec.ts` | **nuevo** — ciclo set→clear de `__Host-session` (desechable) |

Snapshots byte-idénticos en `CODIGO/MIS-293-cookies/<ruta>`.

---

## 1. `src/lib/auth/constants.ts` (modificado)

```diff
diff --git a/src/lib/auth/constants.ts b/src/lib/auth/constants.ts
index 582e10a..ea398b9 100644
--- a/src/lib/auth/constants.ts
+++ b/src/lib/auth/constants.ts
@@ -1,15 +1,21 @@
 // Sin otras importaciones a propósito: tanto src/proxy.ts (usa request.cookies,
 // API de next/server) como src/lib/auth/cookie.ts (usa next/headers) necesitan
 // este nombre, y cada uno corre en un contexto distinto.
-export const SESSION_COOKIE_NAME = "session";
+//
+// MIS-293 (B2): prefijo `__Host-` — el navegador REFUERZA que la cookie se emitió
+// con `Secure` + `Path=/` + SIN `Domain`. Ver la invariante en cookie.ts.
+export const SESSION_COOKIE_NAME = "__Host-session";
 
 // MIS-260: cookie de corta duración (10 min), solo para el flujo
 // /api/auth/google/* — nunca contiene identidad, solo el nonce anti-CSRF.
-export const OAUTH_STATE_COOKIE_NAME = "google_oauth_state";
+// MIS-293 (B2): prefijo `__Secure-` (su `path` no es `/`, así que no puede ser
+// `__Host-`); el navegador refuerza que se emitió con `Secure`.
+export const OAUTH_STATE_COOKIE_NAME = "__Secure-google_oauth_state";
 
 // MIS-292 (M3): cookie httpOnly de corta duración (15 min) que transporta el
 // ticket de reseteo entre verificar el código y fijar la nueva contraseña.
 // Antes viajaba en estado React + <input type="hidden">, accesible a JS; ahora
 // solo existe aquí, fuera del alcance del navegador. Scope al flujo de
 // recuperación por su `path`.
-export const RESET_TICKET_COOKIE_NAME = "reset_ticket";
+// MIS-293 (B2): prefijo `__Secure-` (mismo motivo que la de OAuth: su `path` ≠ `/`).
+export const RESET_TICKET_COOKIE_NAME = "__Secure-reset_ticket";
```

## 2. `src/lib/auth/cookie.ts` (modificado)

`secure:true` en las 6 set/clear (B1). Nombres legado en const locales **no exportadas**; cada
set/clear **expira** su gemela antigua en su path original (M1, transitorio). Comentario con la
**invariante `__Host-`** (nunca `domain`, `path` siempre `/`).

```diff
diff --git a/src/lib/auth/cookie.ts b/src/lib/auth/cookie.ts
index 284941b..addce71 100644
--- a/src/lib/auth/cookie.ts
+++ b/src/lib/auth/cookie.ts
@@ -5,30 +5,57 @@ import {
   RESET_TICKET_COOKIE_NAME,
 } from "./constants";
 
+// MIS-293 (B1): `secure: true` SIEMPRE, no `process.env.NODE_ENV === "production"`.
+// Fail-safe: si en el runtime de prod `NODE_ENV` no fuese exactamente "production",
+// la variante anterior emitía cookies SIN `Secure`. Además, los prefijos de nombre
+// `__Host-`/`__Secure-` (B2) OBLIGAN a `Secure`, así que no hay alternativa. Sobre
+// http://localhost, los navegadores modernos tratan el host como *secure context* y
+// aceptan estas cookies; en concreto Chromium (el navegador de los e2e/CI), de modo
+// que dev local y la suite de Playwright siguen funcionando.
+//
+// INVARIANTE de `__Host-session` (lo refuerza el navegador): `Secure` + `Path=/` +
+// SIN `Domain`. NUNCA añadir `domain` a la cookie de sesión ni cambiar su `path` de
+// "/": el navegador rechazaría la cookie con prefijo `__Host-` por completo.
+
+// Nombres ANTIGUOS (pre-B2). Existen SOLO para BORRARLOS de forma transitoria
+// (MIS-293, M1) en su path original — nunca se LEEN (no hay lectura dual). Al
+// escribir/limpiar cada cookie nueva se expira su gemela antigua, de modo que la
+// cookie vieja (que pudo emitirse sin `Secure`, y que un rollback re-reconocería)
+// se retira del navegador en login, logout y —para la sesión— en el redirect del
+// proxy. Retirar estas líneas en un follow-up, pasado el TTL máximo (30 d) desde
+// la última versión desplegable que emitía estos nombres. Ver PLANS/MIS-293-cookies.md.
+const LEGACY_SESSION_COOKIE_NAME = "session";
+const LEGACY_OAUTH_STATE_COOKIE_NAME = "google_oauth_state";
+const LEGACY_RESET_TICKET_COOKIE_NAME = "reset_ticket";
+
 const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 días — sesión persistente
 
 // path:"/" explícito en set y clear: sin esto, un cambio futuro de ruta de
 // login/logout podría dejar la cookie inaccesible o sin poder borrarla del todo.
+// (Y es, además, requisito de `__Host-`.)
 export async function setSessionCookie(token: string): Promise<void> {
   const cookieStore = await cookies();
   cookieStore.set(SESSION_COOKIE_NAME, token, {
     httpOnly: true,
-    secure: process.env.NODE_ENV === "production",
+    secure: true,
     sameSite: "lax",
     path: "/",
     maxAge: SESSION_TTL_SECONDS,
   });
+  // M1 (transitorio): borra la cookie de sesión ANTIGUA en su path original.
+  cookieStore.set(LEGACY_SESSION_COOKIE_NAME, "", { path: "/", maxAge: 0 });
 }
 
 export async function clearSessionCookie(): Promise<void> {
   const cookieStore = await cookies();
   cookieStore.set(SESSION_COOKIE_NAME, "", {
     httpOnly: true,
-    secure: process.env.NODE_ENV === "production",
+    secure: true,
     sameSite: "lax",
     path: "/",
     maxAge: 0,
   });
+  cookieStore.set(LEGACY_SESSION_COOKIE_NAME, "", { path: "/", maxAge: 0 });
 }
 
 export async function readSessionToken(): Promise<string | null> {
@@ -44,7 +71,7 @@ export async function setOAuthStateCookie(state: string): Promise<void> {
   const cookieStore = await cookies();
   cookieStore.set(OAUTH_STATE_COOKIE_NAME, state, {
     httpOnly: true,
-    secure: process.env.NODE_ENV === "production",
+    secure: true,
     // "lax", no "strict": debe sobrevivir a la navegación top-level
     // ENTRANTE que hace Google al volver a /api/auth/google/callback —
     // "strict" no garantiza que la cookie viaje en esa navegación.
@@ -52,6 +79,7 @@ export async function setOAuthStateCookie(state: string): Promise<void> {
     path: "/api/auth/google",
     maxAge: OAUTH_STATE_TTL_SECONDS,
   });
+  cookieStore.set(LEGACY_OAUTH_STATE_COOKIE_NAME, "", { path: "/api/auth/google", maxAge: 0 });
 }
 
 export async function readOAuthStateCookie(): Promise<string | null> {
@@ -63,11 +91,12 @@ export async function clearOAuthStateCookie(): Promise<void> {
   const cookieStore = await cookies();
   cookieStore.set(OAUTH_STATE_COOKIE_NAME, "", {
     httpOnly: true,
-    secure: process.env.NODE_ENV === "production",
+    secure: true,
     sameSite: "lax",
     path: "/api/auth/google",
     maxAge: 0,
   });
+  cookieStore.set(LEGACY_OAUTH_STATE_COOKIE_NAME, "", { path: "/api/auth/google", maxAge: 0 });
 }
 
 // MIS-292 (M3): ticket de reseteo. Vivía en estado React + <input type="hidden">
@@ -84,11 +113,12 @@ export async function setResetTicketCookie(ticket: string): Promise<void> {
   const cookieStore = await cookies();
   cookieStore.set(RESET_TICKET_COOKIE_NAME, ticket, {
     httpOnly: true,
-    secure: process.env.NODE_ENV === "production",
+    secure: true,
     sameSite: "lax",
     path: "/recuperar-contrasena",
     maxAge: RESET_TICKET_TTL_SECONDS,
   });
+  cookieStore.set(LEGACY_RESET_TICKET_COOKIE_NAME, "", { path: "/recuperar-contrasena", maxAge: 0 });
 }
 
 export async function readResetTicketCookie(): Promise<string | null> {
@@ -100,9 +130,10 @@ export async function clearResetTicketCookie(): Promise<void> {
   const cookieStore = await cookies();
   cookieStore.set(RESET_TICKET_COOKIE_NAME, "", {
     httpOnly: true,
-    secure: process.env.NODE_ENV === "production",
+    secure: true,
     sameSite: "lax",
     path: "/recuperar-contrasena",
     maxAge: 0,
   });
+  cookieStore.set(LEGACY_RESET_TICKET_COOKIE_NAME, "", { path: "/recuperar-contrasena", maxAge: 0 });
 }
```

## 3. `src/proxy.ts` (modificado)

El redirect a `/login` de rutas *cookie-gated* pasa a construir la respuesta y **borra la `session`
antigua** (path `/`) en ella. `NextResponse.redirect(...)` + `res.cookies.set(...)` + `return res`.

```diff
diff --git a/src/proxy.ts b/src/proxy.ts
index d573e4a..50f12e6 100644
--- a/src/proxy.ts
+++ b/src/proxy.ts
@@ -102,7 +102,14 @@ export function proxy(request: NextRequest) {
 
   // Check optimista de cookie — solo en las rutas de siempre.
   if (isCookieGated(pathname) && !request.cookies.has(SESSION_COOKIE_NAME)) {
-    return NextResponse.redirect(new URL("/login", request.url));
+    const res = NextResponse.redirect(new URL("/login", request.url));
+    // MIS-293 (M1, transitorio): retira la cookie de sesión ANTIGUA ("session")
+    // del navegador en el PRIMER request a una ruta protegida sin __Host-session,
+    // sin leerla. Cierra la ventana de la cookie larga (30 d, que pudo emitirse
+    // sin Secure) y neutraliza su re-lectura si se revirtiera el frontend a código
+    // pre-PR. Retirar en follow-up junto con los borrados de cookie.ts.
+    res.cookies.set("session", "", { path: "/", maxAge: 0 });
+    return res;
   }
 
   return NextResponse.next();
```

## 4. `e2e/helpers/convex-client.ts` (modificado)

Centraliza el nombre en la constante `SESSION_COOKIE_NAME` (import desde `../../src/lib/auth/constants`,
patrón ya usado por `password-reset.spec.ts:25`). Elimina los 3 literales `"session"`.

```diff
diff --git a/e2e/helpers/convex-client.ts b/e2e/helpers/convex-client.ts
index ccced3f..59243d8 100644
--- a/e2e/helpers/convex-client.ts
+++ b/e2e/helpers/convex-client.ts
@@ -3,6 +3,9 @@ import type { BrowserContext } from "@playwright/test";
 import { readFileSync } from "fs";
 import path from "path";
 import { api } from "../../convex/_generated/api";
+// MIS-293 (B2): el nombre de la cookie de sesión se centraliza en la constante de
+// producción (evita literales divergentes tras el rename a `__Host-session`).
+import { SESSION_COOKIE_NAME } from "../../src/lib/auth/constants";
 
 export function convexClient(): ConvexHttpClient {
   const url = process.env.NEXT_PUBLIC_CONVEX_URL;
@@ -10,7 +13,7 @@ export function convexClient(): ConvexHttpClient {
   return new ConvexHttpClient(url);
 }
 
-// Extrae el token de sesión real (cookie HttpOnly "session") del contexto
+// Extrae el token de sesión real (cookie HttpOnly `__Host-session`) del contexto
 // autenticado de Playwright — el mismo valor que Next.js pasa como `token`
 // a fetchQuery/fetchMutation. No es un atajo inseguro: es el token real
 // emitido por el login real hecho en auth.setup.ts (confirmado en
@@ -18,7 +21,7 @@ export function convexClient(): ConvexHttpClient {
 // se calcula server-side para comparar contra sessions.tokenHash).
 export async function sessionTokenFrom(context: BrowserContext): Promise<string> {
   const cookies = await context.cookies();
-  const session = cookies.find((c) => c.name === "session");
+  const session = cookies.find((c) => c.name === SESSION_COOKIE_NAME);
   if (!session) throw new Error("No hay cookie de sesión — ¿corrió auth.setup.ts?");
   return session.value;
 }
@@ -48,9 +51,9 @@ export function carlosTokenFromDisk(): string {
       `No se pudo leer ${authFile} — ¿corrió el project "setup-carlos" antes? (chromium-marta debe listar "setup-carlos" en dependencies)`,
     );
   }
-  const session = state.cookies?.find((c) => c.name === "session");
+  const session = state.cookies?.find((c) => c.name === SESSION_COOKIE_NAME);
   if (!session) {
-    throw new Error(`${authFile} no contiene cookie "session" — storageState corrupto, vacío, o de otra forma inesperada`);
+    throw new Error(`${authFile} no contiene cookie ${SESSION_COOKIE_NAME} — storageState corrupto, vacío, o de otra forma inesperada`);
   }
   return session.value;
 }
```

## 5. `e2e/google-auth.spec.ts` (modificado)

`/start`: regex al nombre nuevo (literal, para detectar un rename mal hecho) + asertar `Secure` y
`Path=/api/auth/google`. **Nuevo** test de *clear*: inyecta `__Secure-google_oauth_state` (con
`secure:true`, confirmando que Chromium lo guarda), invoca el callback con un `state` que NO coincide
(rechazo temprano, sin red a Google) y comprueba que el jar (compartido por `context.request`) ya no
la contiene — el callback la borra siempre (`route.ts:49-50`).

```diff
diff --git a/e2e/google-auth.spec.ts b/e2e/google-auth.spec.ts
index 75feb32..d3984e1 100644
--- a/e2e/google-auth.spec.ts
+++ b/e2e/google-auth.spec.ts
@@ -28,10 +28,73 @@ test.describe("Google OAuth: /start y /callback (sin cuenta real de Google)", ()
     // Auditoría (ronda 1, sugerencia menor): comprobar que el state de la
     // URL coincide EXACTAMENTE con el de la cookie, no solo que ambos
     // existan por separado.
-    const setCookieHeader = res.headers()["set-cookie"] ?? "";
-    const cookieMatch = /google_oauth_state=([^;]+)/.exec(setCookieHeader);
+    // MIS-293 (B2): se aísla el fragmento Set-Cookie de la cookie de estado (por su
+    // nombre con prefijo `__Secure-`, literal para detectar un rename mal hecho) y
+    // se comprueban valor, Secure y Path DENTRO de ese mismo fragmento — no sobre la
+    // cabecera combinada (que además trae el borrado de la gemela legada).
+    const stateSetCookie = res
+      .headersArray()
+      .filter((h) => h.name.toLowerCase() === "set-cookie")
+      .map((h) => h.value)
+      .find((v) => /^__Secure-google_oauth_state=/.test(v));
+    expect(stateSetCookie, "el Set-Cookie de la cookie de estado debe existir").toBeTruthy();
+    const cookieMatch = /^__Secure-google_oauth_state=([^;]+)/.exec(stateSetCookie!);
     expect(cookieMatch?.[1]).toBeTruthy();
     expect(decodeURIComponent(cookieMatch![1])).toBe(stateInQuery);
+    // MIS-293 (B1/B2): `Secure` y el `path` EXACTO en ese fragmento.
+    expect(stateSetCookie!).toMatch(/;\s*Secure(?:;|$)/i);
+    expect(stateSetCookie!).toMatch(/;\s*Path=\/api\/auth\/google(?:;|$)/i);
+  });
+
+  // MIS-293 (B2, borrado): el callback borra la cookie de estado SIEMPRE, éxito o
+  // no (route.ts: "de un solo uso — se borra siempre"). Aquí se inyecta una cookie
+  // de estado presente y se comprueba que el callback la RETIRA del jar. Se usa un
+  // `state` de query DISTINTO al de la cookie para que el callback rechace ANTES de
+  // llamar a Google (sin red externa) pero igualmente ejecute el borrado.
+  test("/api/auth/google/callback borra la cookie de estado presente (se borra siempre)", async ({
+    context,
+    baseURL,
+  }) => {
+    const host = new URL(baseURL!).hostname;
+    // Fixture con `secure: true` y su `path` original: si no cumpliera el prefijo
+    // `__Secure-`, Chromium lo rechazaría y el test solo probaría el camino "sin
+    // cookie". Se confirma que SÍ quedó guardada antes de invocar el callback.
+    await context.addCookies([
+      {
+        name: "__Secure-google_oauth_state",
+        value: "estado-guardado",
+        domain: host,
+        path: "/api/auth/google",
+        secure: true,
+      },
+    ]);
+    // Precondición: comprueba la cookie EXACTA (no solo que exista alguna con ese
+    // nombre) — si Chromium hubiera rechazado el fixture por incumplir el prefijo,
+    // el test solo probaría el camino "sin cookie".
+    const fixture = (await context.cookies()).find((c) => c.name === "__Secure-google_oauth_state");
+    expect(fixture, "el fixture de la cookie de estado debe haberse guardado").toMatchObject({
+      value: "estado-guardado",
+      secure: true,
+      path: "/api/auth/google",
+    });
+
+    // context.request comparte el cookie jar del BrowserContext (el Set-Cookie de
+    // la respuesta actualiza el jar).
+    const res = await context.request.get("/api/auth/google/callback?code=x&state=no-coincide", {
+      maxRedirects: 0,
+    });
+    expect(res.status()).toBeGreaterThanOrEqual(300);
+    expect(res.status()).toBeLessThan(400);
+    // Semántico, no igualdad literal: la cabecera Location podría ser absoluta o
+    // relativa; se normaliza contra baseURL y se comprueba destino + query.
+    const location = new URL(res.headers()["location"]!, baseURL);
+    expect(location.pathname).toBe("/login");
+    expect(location.searchParams.get("error")).toBe("google");
+
+    // Definitivo: el jar ya no contiene la cookie de estado (la borró el callback).
+    expect((await context.cookies()).some((c) => c.name === "__Secure-google_oauth_state")).toBe(
+      false,
+    );
   });
 
   test("/api/auth/google/callback sin cookie de estado rechaza sin llamar a Google", async ({ page }) => {
```

## 6. `e2e/auth.setup.ts` (modificado)

Aserción obligatoria: tras el login (antes de `storageState`), `__Host-session` presente con
`secure===true`, `path==="/"`. La **presencia bajo el prefijo `__Host-`** es la acreditación fuerte
de host-only (Chromium rechaza el prefijo si lleva `Domain`/sin `Secure`/`path`≠`/`); `domain` sin
punto inicial se comprueba solo como dato auxiliar.

```diff
diff --git a/e2e/auth.setup.ts b/e2e/auth.setup.ts
index 2379f3e..902a3d6 100644
--- a/e2e/auth.setup.ts
+++ b/e2e/auth.setup.ts
@@ -26,5 +26,16 @@ setup("log in as Carlos", async ({ page }) => {
 
   await expect(page.getByRole("heading", { name: /Hola, Carlos/ })).toBeVisible();
 
+  // MIS-293 (B1/B2): el login fija la cookie de sesión con el prefijo `__Host-`.
+  // La MERA PRESENCIA de una cookie con ese prefijo es la acreditación FUERTE de
+  // host-only: Chromium rechaza el prefijo `__Host-` por completo si a la cookie le
+  // falta `Secure`, lleva `Domain`, o su `path` no es `/` — en ese caso no
+  // aparecería aquí (y el resto de la suite autenticada fallaría). Se usa el literal
+  // esperado para detectar además un rename mal hecho en la constante.
+  const sessionCookie = (await page.context().cookies()).find((c) => c.name === "__Host-session");
+  expect(sessionCookie, "el login debe fijar la cookie __Host-session").toBeTruthy();
+  expect(sessionCookie!.secure).toBe(true);
+  expect(sessionCookie!.path).toBe("/");
+
   await page.context().storageState({ path: authFile });
 });
```

## 7. `e2e/password-reset.spec.ts` (modificado)

Añade `secure===true` y el prefijo `__Secure-` a la inspección de metadatos ya existente de la cookie
del ticket (que ya comprobaba httpOnly/sameSite/path/expires y el borrado tras el reset).

```diff
diff --git a/e2e/password-reset.spec.ts b/e2e/password-reset.spec.ts
index bcd5bc4..edb6ff1 100644
--- a/e2e/password-reset.spec.ts
+++ b/e2e/password-reset.spec.ts
@@ -64,6 +64,11 @@ test.describe("recuperación de contraseña por código (MIS-285)", () => {
     );
     expect(ticketCookie, "la cookie del ticket debe existir en el paso de contraseña").toBeTruthy();
     expect(ticketCookie!.httpOnly).toBe(true);
+    // MIS-293 (B1/B2): Secure siempre + nombre con prefijo `__Secure-`. Se fija el
+    // literal exacto (detecta un rename mal hecho en la constante); su aceptación
+    // por el navegador prueba que se emitió con `Secure`.
+    expect(ticketCookie!.secure).toBe(true);
+    expect(ticketCookie!.name).toBe("__Secure-reset_ticket");
     expect(ticketCookie!.sameSite).toBe("Lax");
     expect(ticketCookie!.path).toBe("/recuperar-contrasena");
     // maxAge 15 min → expires ≈ ahora + 900 s (con tolerancia amplia).
```

## 8. `playwright.config.ts` (modificado)

Registra `legacy-cookie-migration.spec.ts` en `chromium-unauth` y `session-cookie.spec.ts` en
`chromium-secrets`.

```diff
diff --git a/playwright.config.ts b/playwright.config.ts
index 7774a0b..8f1d52c 100644
--- a/playwright.config.ts
+++ b/playwright.config.ts
@@ -66,9 +66,11 @@ export default defineConfig({
 
     // MIS-260: sin sesión, sin dependencies — google-auth.spec.ts prueba
     // /api/auth/google/start y /callback como visitante anónimo.
+    // MIS-293: legacy-cookie-migration.spec.ts (también sin sesión) prueba que el
+    // proxy retira la cookie `session` ANTIGUA al redirigir a /login.
     {
       name: "chromium-unauth",
-      testMatch: ["google-auth.spec.ts"],
+      testMatch: ["google-auth.spec.ts", "legacy-cookie-migration.spec.ts"],
       use: { ...devices["Desktop Chrome"] },
     },
 
@@ -80,9 +82,17 @@ export default defineConfig({
     // demuestra que esta política funciona de verdad.
     // Si cambias esta política, cambia también "gate-secrets" en
     // playwright.gate.config.ts: el gate replica estos valores a propósito.
+    // MIS-293: session-cookie.spec.ts hace un login/logout DESECHABLE (teclea una
+    // contraseña real) para probar el ciclo set→clear de __Host-session sin tocar
+    // la sesión compartida de carlos.json — por eso va aquí (trace/vídeo OFF).
     {
       name: "chromium-secrets",
-      testMatch: ["test-support.spec.ts", "password-reset.spec.ts", "password-reset-invariants.spec.ts"],
+      testMatch: [
+        "test-support.spec.ts",
+        "password-reset.spec.ts",
+        "password-reset-invariants.spec.ts",
+        "session-cookie.spec.ts",
+      ],
       use: {
         ...devices["Desktop Chrome"],
         trace: "off",
```

---

## 9. `e2e/legacy-cookie-migration.spec.ts` (NUEVO) — contenido íntegro

Project `chromium-unauth` (sin storageState). Prueba de M2 + evidencia complementaria del Set-Cookie.
Ruta protegida confirmada: `/pendientes` (está en `COOKIE_GATED_PREFIXES` de `proxy.ts` y existe).

```ts
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
```

## 10. `e2e/session-cookie.spec.ts` (NUEVO) — contenido íntegro

Project `chromium-secrets` (trace off; teclea una contraseña). Sesión **desechable** (login propio):
NO toca la sesión compartida de `carlos.json`. Cubre set→clear de `__Host-session` y el borrado de
una `session` legada por la vía de login.

```ts
// MIS-293 (B1/B2): ciclo SET → CLEAR de la cookie de sesión `__Host-session`.
//
// Corre en el project "chromium-secrets" (trace/vídeo/screenshot OFF) porque
// teclea una contraseña real (E2E_CARLOS_PASSWORD) en el formulario de login —
// misma disciplina anti-fuga que password-reset.spec.ts.
//
// Usa una sesión DESECHABLE (login fresco propio) para NO invalidar la sesión
// compartida de e2e/.auth/carlos.json: esa sesión la reutilizan las specs de Marta
// vía carlosTokenFromDisk(), y un logout la borraría en servidor. Por eso este
// ciclo NO vive en full-flow.spec.ts (chromium-carlos, storageState compartido).
//
// Concurrencia: playwright.config.ts fija `fullyParallel: false` y `workers: 1`,
// así que NADA corre en paralelo — este spec no compite con test-support.spec.ts
// ni password-reset*.spec.ts. Además, la identidad de Carlos se usa aquí SOLO para
// un login/logout desechable (no muta datos ni su contraseña), y es DISTINTA de la
// identidad dedicada de reset (RESET_TEST_EMAIL) que usan esos otros specs.
import { test, expect } from "./helpers/secure-test";
import { convexClient } from "./helpers/convex-client";
import { api } from "../convex/_generated/api";
import { SESSION_COOKIE_NAME } from "../src/lib/auth/constants";

test.describe("cookie de sesión __Host-session (MIS-293)", () => {
  test("login fija __Host-session (Secure, host-only) y borra una 'session' legada; logout la retira", async ({
    page,
    context,
    baseURL,
  }) => {
    const email = process.env.E2E_CARLOS_EMAIL;
    const password = process.env.E2E_CARLOS_PASSWORD;
    if (!email || !password) {
      throw new Error("Faltan E2E_CARLOS_EMAIL/E2E_CARLOS_PASSWORD — copia .env.test.local.example a .env.test.local");
    }

    // Cookie de sesión ANTIGUA preexistente: el login debe borrarla (M1, vía login).
    await context.addCookies([{ name: "session", value: "token-legado-de-prueba", url: baseURL! }]);

    try {
      await page.goto("/login");
      await page.getByLabel("Email").fill(email);
      // Selector inequívoco por name (mismo motivo que auth.setup.ts).
      await page.locator('input[name="password"]').fill(password);
      await page.getByRole("button", { name: "Entrar" }).click();
      await page.waitForURL("/pendientes");

      // SET: el login fijó __Host-session con Secure y Path=/ (su presencia bajo el
      // prefijo prueba que Chromium la aceptó como host-only + Secure).
      const afterLogin = await context.cookies();
      const host = afterLogin.find((c) => c.name === "__Host-session");
      expect(host, "el login debe fijar __Host-session").toBeTruthy();
      expect(host!.secure).toBe(true);
      expect(host!.path).toBe("/");
      // La 'session' legada fue borrada por setSessionCookie.
      expect(afterLogin.find((c) => c.name === "session")).toBeUndefined();

      // CLEAR: logout retira __Host-session.
      await page.getByRole("button", { name: "Cerrar sesión" }).click();
      await page.waitForURL(/\/login/);
      const afterLogout = await context.cookies();
      expect(afterLogout.find((c) => c.name === SESSION_COOKIE_NAME)).toBeUndefined();
    } finally {
      // Best-effort: si una aserción falló ANTES del logout, la sesión desechable
      // seguiría viva en servidor. Se cierra por su token (context.cookies() lee
      // cookies httpOnly) para no acumular filas en el deployment compartido. Se
      // ignora cualquier fallo: NO enmascara el error primario del test.
      try {
        const c = (await context.cookies()).find((x) => x.name === SESSION_COOKIE_NAME);
        if (c) await convexClient().mutation(api.auth.logout, { token: c.value });
      } catch {
        /* best-effort */
      }
    }
  });
});
```

---

## Matriz de verificación e2e (set → read → clear)

- **`__Host-session`** — *set/attrs*: `auth.setup.ts` (§6). *read*: toda la suite autenticada. *clear*:
  `session-cookie.spec.ts` (§10, logout). *migración del legado*: `legacy-cookie-migration.spec.ts`
  (§9) + borrado por login en `session-cookie.spec.ts`.
- **`__Secure-google_oauth_state`** — *set/attrs*: `google-auth.spec.ts` `/start` (§5). *clear*:
  `google-auth.spec.ts` callback (§5). El mismo `clearOAuthStateCookie` expira además la gemela
  legada `google_oauth_state` (visible en el diff de `cookie.ts`, §2).
- **`__Secure-reset_ticket`** — *set/attrs* + *clear*: `password-reset.spec.ts` (§7, ya existente +
  `secure`). El borrado de la gemela legada `reset_ticket` usa el mismo mecanismo que prueba §9.

## Evidencia grep clasificada (salida real)

Ejecutada sobre el repo actual (pre-instalación, aún con nombres viejos) para acreditar el **conjunto
completo de consumidores**, y sobre los snapshots para acreditar qué literales quedan:

```text
# (A) Consumidores ACTUALES de los nombres viejos en el REPO (pre-instalacion). Acredita el
#     conjunto COMPLETO de consumidores entre ficheros EXISTENTES (las tres comillas):
$ git grep -nP '[\x22\x27\x60](session|google_oauth_state|reset_ticket)[\x22\x27\x60]' -- src e2e
e2e/helpers/convex-client.ts:13:// Extrae el token de sesión real (cookie HttpOnly "session") del contexto
e2e/helpers/convex-client.ts:21:  const session = cookies.find((c) => c.name === "session");
e2e/helpers/convex-client.ts:51:  const session = state.cookies?.find((c) => c.name === "session");
e2e/helpers/convex-client.ts:53:    throw new Error(`${authFile} no contiene cookie "session" — storageState corrupto, vacío, o de otra forma inesperada`);
src/lib/auth/constants.ts:4:export const SESSION_COOKIE_NAME = "session";
src/lib/auth/constants.ts:8:export const OAUTH_STATE_COOKIE_NAME = "google_oauth_state";
src/lib/auth/constants.ts:15:export const RESET_TICKET_COOKIE_NAME = "reset_ticket";
# codigo de salida: 0  (0 = hubo coincidencias)

# Clasificacion (A): los UNICOS consumidores existentes son constants.ts (3 definiciones, que se
# renombran) y convex-client.ts (comentario + 3 usos, que se centralizan en la constante). Ningun
# otro fichero del repo los consume; proxy.ts usaba la constante SESSION_COOKIE_NAME, no el literal.

# (B) TODO el arbol de snapshots que se audita (ficheros MODIFICADOS y NUEVOS), comando EXACTO y
#     salida COMPLETA (se excluye solo el .md de este documento):
$ ( cd CODIGO/MIS-293-cookies && grep -rnP '[\x22\x27\x60](session|google_oauth_state|reset_ticket)[\x22\x27\x60]' src e2e | LC_ALL=C sort )
e2e/legacy-cookie-migration.spec.ts:11:  test("el proxy borra la cookie 'session' legada al redirigir a /login (sin __Host-session)", async ({
e2e/legacy-cookie-migration.spec.ts:16:    // 1. Inyecta una cookie de sesión ANTIGUA (nombre legado 'session', path '/').
e2e/legacy-cookie-migration.spec.ts:17:    await context.addCookies([{ name: "session", value: "token-legado-de-prueba", url: baseURL! }]);
e2e/legacy-cookie-migration.spec.ts:23:    // 4. La 'session' legada ya no existe (el proxy la borró en el redirect).
e2e/legacy-cookie-migration.spec.ts:25:    expect(cookies.find((c) => c.name === "session")).toBeUndefined();
e2e/legacy-cookie-migration.spec.ts:33:  test("el Set-Cookie del redirect expira 'session' con Max-Age=0 y Path=/", async ({
e2e/legacy-cookie-migration.spec.ts:37:    await context.addCookies([{ name: "session", value: "token-legado-de-prueba", url: baseURL! }]);
e2e/legacy-cookie-migration.spec.ts:53:    expect(sessionSetCookie, "el redirect debe emitir Set-Cookie que expira 'session'").toBeTruthy();
e2e/legacy-cookie-migration.spec.ts:5:// sesión ANTIGUA ("session"). Corre en el project "chromium-unauth" (sin
e2e/legacy-cookie-migration.spec.ts:6:// storageState): inyecta una `session` legada, atraviesa el redirect del proxy y
e2e/session-cookie.spec.ts:23:  test("login fija __Host-session (Secure, host-only) y borra una 'session' legada; logout la retira", async ({
e2e/session-cookie.spec.ts:35:    await context.addCookies([{ name: "session", value: "token-legado-de-prueba", url: baseURL! }]);
e2e/session-cookie.spec.ts:52:      // La 'session' legada fue borrada por setSessionCookie.
e2e/session-cookie.spec.ts:53:      expect(afterLogin.find((c) => c.name === "session")).toBeUndefined();
src/lib/auth/cookie.ts:27:const LEGACY_SESSION_COOKIE_NAME = "session";
src/lib/auth/cookie.ts:28:const LEGACY_OAUTH_STATE_COOKIE_NAME = "google_oauth_state";
src/lib/auth/cookie.ts:29:const LEGACY_RESET_TICKET_COOKIE_NAME = "reset_ticket";
src/proxy.ts:106:    // MIS-293 (M1, transitorio): retira la cookie de sesión ANTIGUA ("session")
src/proxy.ts:111:    res.cookies.set("session", "", { path: "/", maxAge: 0 });
# codigo de salida de grep: 0  (0 = hubo coincidencias)

# Clasificacion (B) — TODA coincidencia, incluidos los fixtures de los specs nuevos:
#  - cookie.ts: 3 const LEGACY_* (nombres del borrado transitorio) — intencional.
#  - proxy.ts: comentario + res.cookies.set("session", ...) (borrado transitorio) — intencional.
#  - legacy-cookie-migration.spec.ts: fixtures {name:"session"} inyectados + aserciones
#    c.name==="session" + el mensaje de asercion que cita 'session' + comentarios (prueba del
#    borrado) — intencional.
#  - session-cookie.spec.ts: fixture {name:"session"} + asercion c.name==="session" undefined
#    + comentario (prueba del borrado por login) — intencional.
#  NINGUNA coincidencia es lectura del nombre viejo (no hay lectura dual): son definiciones para
#  BORRARLO, o fixtures/aserciones de test que verifican ese borrado.

# (C) process.env.NODE_ENV en TODO el arbol de snapshots (salida completa):
$ ( cd CODIGO/MIS-293-cookies && grep -rnP 'process[.]env[.]NODE_ENV' src e2e | LC_ALL=C sort )
src/lib/auth/cookie.ts:8:// MIS-293 (B1): `secure: true` SIEMPRE, no `process.env.NODE_ENV === "production"`.
src/proxy.ts:80:  if (process.env.NODE_ENV === "production") {
# codigo de salida de grep: 0  (0 = hubo coincidencias)
# Clasificacion (C): la coincidencia en cookie.ts:8 es un COMENTARIO (//) que CITA el patron antiguo
# como texto explicativo — NO es codigo ejecutable. El unico uso EJECUTABLE de process.env.NODE_ENV
# es proxy.ts:80 (check de origen I1/I2 en produccion, ajeno a las cookies y NO tocado por este PR).
# Es decir: el flag `secure` ya NO depende de NODE_ENV en ninguna cookie (B1 cumplido).
```

## Riesgo, despliegue y verificación

- **localhost/`Secure`**: Chromium (único navegador del CI) trata `localhost` como *secure context* y
  acepta/reenvía `Secure`/`__Host-`/`__Secure-` sobre http → dev local y e2e funcionan. El e2e de CI
  (Chromium) es la evidencia definitiva; si una cookie no se guardara, sus specs (auth.setup,
  password-reset, session-cookie) fallarían de inmediato.
- **Despliegue**: sin Convex; Railway auto-despliega el frontend al mergear. Corte limpio (re-login
  una vez) con borrado activo del legado. Rollback y riesgo residual: ver `PLANS/MIS-293-cookies.md`.
- **Verificación en instalación (tras GO)**: `npm run lint`, `npm run build`, suite e2e completa
  (`npm run test:e2e`) — foco en login/logout, `google-auth` (set+clear), recuperación,
  `legacy-cookie-migration` y `session-cookie`. Igualdad byte-a-byte CODIGO ↔ repo. Grep reproducible
  post-instalación clasificado como arriba.

## No verificable solo con el texto (queda para instalación/CI)

Snapshots byte-idénticos; lint/build/typecheck; comportamiento real de Chromium sobre localhost;
`context.request` compartiendo el jar; resolución de imports e2e→`src`; ausencia de otros
consumidores en tiempo de ejecución; Railway y smoke de prod.

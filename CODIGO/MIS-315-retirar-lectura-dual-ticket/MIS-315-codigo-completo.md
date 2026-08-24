# MIS-315 — Código completo (autocontenido)

> Retirar la lectura dual del ticket de reseteo (`__Secure-` y legado `reset_ticket`) tras la ventana de migración de MIS-312.
> Rama: `mis-315-retirar-lectura-dual-ticket`. Plan aprobado (GO): `PLANS/MIS-315-retirar-lectura-dual-ticket.md`.

Este documento es **autocontenido**: incluye el contexto, el diff completo y el **contenido literal íntegro** de los tres ficheros modificados (no hay ficheros nuevos). No requiere acceso al repo para revisarlo.

---

## 1. Contexto

MIS-312 renombró la cookie del ticket de reseteo a **`__Host-reset_ticket`** (path `/`) y dejó, transitoriamente, tres mecanismos de compatibilidad en `src/lib/auth/cookie.ts` para no romper recuperaciones/onboarding **en vuelo** durante el despliegue:

1. **Lectura dual** en `readResetTicketCookie`: fallback al nombre anterior `__Secure-reset_ticket`.
2. **Expiración activa** de `__Secure-reset_ticket` (MIS-293→MIS-312) en `set`/`clear`.
3. **Expiración activa** del legado pre-B2 `reset_ticket` (sin prefijo) en `set`/`clear`.

El ticket tiene **TTL 15 min** (`RESET_TICKET_TTL_SECONDS`, que duplica a propósito el `TICKET_TTL_MS` de Convex). Los **dos** nombres antiguos eran cookies de 15 min. Superada esa ventana desde el despliegue de MIS-312, ningún navegador conserva un ticket válido con los nombres antiguos → los tres mecanismos son **código muerto**. MIS-315 los retira. Es limpieza: **sin cambio de comportamiento para ningún usuario actual** (los tickets nuevos ya usan solo `__Host-`).

### Gate temporal (confirmado)
Despliegue de MIS-312 a prod: **2026-08-24 ~17:26 (hora local)**. Verificado con reloj del sistema antes de codificar: **2026-08-24 17:48 CEST** → ~22 min transcurridos > 15 min. Condición semántica «más de 15 min desde la finalización efectiva del despliegue» cumplida holgadamente.

### Sugerencias de auditoría incorporadas
**Auditoría del plan (ronda 1):**
- **(Baja) redacción**: el comentario de `readResetTicketCookie` dice «comportamiento posterior a la migración de MIS-312» (no «pre-MIS-312»).
- **(Baja) prueba negativa**: se añade un test e2e que fija el contrato nuevo (una cookie solo con `__Secure-reset_ticket` ya NO autoriza). Implica **conservar** el helper `advanceToPasswordStep` (desviación consciente y declarada respecto al plan, que preveía eliminarlo).
- **(Baja) gate semántico**: confirmado por reloj real (arriba), no por la hora literal.

**Auditoría del código (ronda 2):**
- **(Media) carrera en la prueba negativa**: tras el clic en «Guardar nueva contraseña», se añade una espera de señal **inequívoca** de que la Server Action terminó — el `ErrorBox` (`role="alert"`, se pinta cuando `resetPasswordWithTicket` devuelve `{ok:false}` por ticket vacío) — **antes** de comprobar URL/credenciales.
- **(Baja) comentario de `advanceToPasswordStep`**: decía «Devuelve el valor del ticket» pese a ser `Promise<void>`; corregido.

## 2. Alcance de los cambios

| Fichero | Tipo | Cambio |
|---|---|---|
| `src/lib/auth/cookie.ts` | producción | Retirar lectura dual + las dos expiraciones legadas; borrar 3 constantes sin uso (`LEGACY_SECURE_RESET_TICKET_COOKIE_NAME`, `LEGACY_RESET_TICKET_COOKIE_NAME`, `LEGACY_RESET_TICKET_PATH`). |
| `src/lib/auth/constants.ts` | comentario | Actualizar el comentario de `RESET_TICKET_COOKIE_NAME` (valor `"__Host-reset_ticket"` sin cambio). |
| `e2e/onboarding.spec.ts` | test | Eliminar los 2 tests de migración; añadir 1 prueba negativa del contrato (con espera de `role="alert"`). Header y comentario del helper actualizados. Helpers conservados (todos en uso). |

**No se tocan**: `src/lib/auth/actions.ts` (las firmas de `set/read/clearResetTicketCookie` no cambian), Convex/backend, cookies de sesión/OAuth (constantes independientes, ventana de retiro distinta de 30 d — fuera de alcance), ni `e2e/password-reset*.spec.ts`.

**Grep de verificación** (tras los cambios): no quedan referencias en `src/`|`convex/` a las constantes/nombres retirados salvo en **comentarios** que explican la retirada.

## 3. Verificación

- `npm run lint` → **0 errores** (1 warning preexistente en `src/components/ui/core/Avatar.jsx`, ajeno).
- `npm run build` (incluye type-check de Next) → **verde**, 15 rutas compiladas.
- **e2e**: corre en CI (project `chromium-secrets`, gate del environment `ci`). Regresión esperada verde: `password-reset.spec.ts` (asserta `__Host-reset_ticket`, path `/`), happy-path de `onboarding.spec.ts`, y la nueva prueba negativa.
- **Rollback**: volver al build de MIS-312 (que hace `__Host-` ?? `__Secure-`) es seguro — los nombres antiguos son TTL 15 min y la ventana ya pasó; no hay ninguno válido que resucitar.

## 4. Deploy

`cookie.ts`/`constants.ts` son **solo frontend** (Next.js). **No hay cambio en `convex/`** → **no hace falta deploy de Convex a prod**; Railway auto-despliega el frontend al mergear a `main`. (El e2e en CI requiere aprobar el gate del environment `ci`.)

---

## 5. Diff completo

```diff
diff --git a/e2e/onboarding.spec.ts b/e2e/onboarding.spec.ts
index f570832..68b66e9 100644
--- a/e2e/onboarding.spec.ts
+++ b/e2e/onboarding.spec.ts
@@ -2,13 +2,12 @@
 // Reutiliza el motor de código+ticket de MIS-285, así que corre en el project
 // "chromium-secrets" (circula la contraseña efímera de la identidad dedicada y la
 // nueva que fija el propio spec, ninguna como literal). Cubre: el wizard en la
-// ruta nueva, los atributos de la cookie del ticket (ahora `__Host-`, path `/`),
-// su ausencia tras consumir, y la MIGRACIÓN M1 en dos frentes:
-//   - lectura dual: una recuperación en vuelo completa con la cookie ANTIGUA
-//     `__Secure-reset_ticket`;
-//   - transición + expiración: el flujo nuevo emite `__Host-reset_ticket` y expira
-//     las dos generaciones antiguas (`__Secure-reset_ticket` de MIS-293 y el legado
-//     pre-MIS-293 `reset_ticket`), sin coexistencia.
+// ruta nueva, los atributos de la cookie del ticket (`__Host-`, path `/`) y su
+// ausencia tras consumir.
+// MIS-315: retirada la compatibilidad transitoria de la migración de MIS-312. Se
+// sustituyeron los dos tests de migración (lectura dual / transición) por una
+// prueba NEGATIVA que fija el contrato nuevo: un ticket que solo vive en el nombre
+// antiguo (`__Secure-reset_ticket`) ya NO autoriza el cambio de contraseña.
 import { randomBytes } from "node:crypto";
 import { test, expect } from "./helpers/secure-test";
 import { RESET_TEST_EMAIL, getLastResetCode, loginSucceeds, resetTestIdentity } from "./helpers/test-support";
@@ -30,8 +29,9 @@ async function waitForResetCode(): Promise<string> {
 }
 
 // Avanza el wizard (en la ruta dada) hasta el paso de contraseña, dejando emitido
-// el ticket nuevo en `__Host-reset_ticket`. Devuelve el valor del ticket (Playwright
-// lee cookies httpOnly). El botón del paso 1 depende del copy de cada ruta.
+// el ticket nuevo en `__Host-reset_ticket`. No devuelve nada (Promise<void>): quien
+// necesite el valor del ticket lo lee con `context.cookies()` (Playwright lee
+// cookies httpOnly). El botón del paso 1 depende del copy de cada ruta.
 async function advanceToPasswordStep(
   page: import("@playwright/test").Page,
   route: string,
@@ -95,7 +95,10 @@ test.describe("onboarding de primera contraseña (MIS-312)", () => {
     expect(cookieAfter, "la cookie del ticket debe borrarse tras crear la contraseña").toBeFalsy();
   });
 
-  test("migración (lectura dual): una recuperación en vuelo completa con la cookie __Secure- antigua", async ({
+  // MIS-315: prueba NEGATIVA del contrato nuevo. Antes (MIS-312) un ticket que solo
+  // vivía en `__Secure-reset_ticket` completaba el cambio por lectura dual; retirada
+  // esa compatibilidad, ese mismo estado ya NO debe autorizar nada.
+  test("MIS-315: un ticket que solo vive en el nombre antiguo (__Secure-reset_ticket) ya NO autoriza", async ({
     page,
     context,
   }) => {
@@ -109,8 +112,9 @@ test.describe("onboarding de primera contraseña (MIS-312)", () => {
     expect(host, "debería existir __Host-reset_ticket tras verificar").toBeTruthy();
     const ticket = host!.value;
 
-    // Reproduce el estado "en vuelo antes del despliegue": el ticket válido solo
-    // vive en la cookie ANTIGUA `__Secure-reset_ticket` (path estrecho), sin __Host-.
+    // Reproduce el estado que MIS-315 deja de soportar: el ticket (válido en el
+    // servidor, aún sin consumir) vive SOLO en la cookie ANTIGUA
+    // `__Secure-reset_ticket` (path estrecho), sin `__Host-`.
     await context.clearCookies();
     await context.addCookies([
       {
@@ -124,75 +128,22 @@ test.describe("onboarding de primera contraseña (MIS-312)", () => {
       },
     ]);
 
-    // Al enviar la contraseña, resetPasswordAction no encuentra __Host- y cae al
-    // fallback __Secure- (lectura dual) → completa el cambio.
+    // Al enviar la contraseña, readResetTicketCookie ya NO cae al nombre antiguo →
+    // el ticket llega vacío → resetPasswordAction devuelve error y NO redirige.
     await page.getByLabel("Nueva contraseña").fill(newPassword);
     await page.getByLabel("Repite la contraseña").fill(newPassword);
     await page.getByRole("button", { name: "Guardar nueva contraseña" }).click();
 
-    await page.waitForURL(/\/login\?reset=ok/);
-    expect(await loginSucceeds(newPassword)).toBe(true);
-    expect(await loginSucceeds(oldPassword)).toBe(false);
-  });
-
-  test("migración (transición): el flujo nuevo emite __Host- y expira las dos cookies antiguas", async ({
-    page,
-    context,
-  }) => {
-    // Siembra las DOS generaciones antiguas en su path estrecho (tickets ficticios;
-    // aquí solo se prueba la migración de cookies, no su validez):
-    //  - `__Secure-reset_ticket` (MIS-293 → MIS-312)
-    //  - `reset_ticket` (legado pre-MIS-293)
-    await context.addCookies([
-      {
-        name: "__Secure-reset_ticket",
-        value: "stale-secure-pre-mis312",
-        domain: "localhost",
-        path: "/recuperar-contrasena",
-        httpOnly: true,
-        secure: true,
-        sameSite: "Lax",
-      },
-      {
-        name: "reset_ticket",
-        value: "stale-legacy-pre-mis293",
-        domain: "localhost",
-        path: "/recuperar-contrasena",
-        httpOnly: true,
-        secure: true,
-        sameSite: "Lax",
-      },
-    ]);
-
-    const oldPassword = await resetTestIdentity();
-    const newPassword = freshPassword();
-
-    await advanceToPasswordStep(page, "/recuperar-contrasena", "Enviar código");
-
-    // Tras emitir el ticket nuevo, en la MISMA respuesta: existe __Host-reset_ticket
-    // (path "/", con atributos correctos) y NINGUNA de las dos cookies antiguas
-    // queda (no coexisten cookies del ticket).
-    const cookies = await context.cookies();
-    const host = cookies.find((c) => c.name === "__Host-reset_ticket");
-    expect(host, "debe existir __Host-reset_ticket").toBeTruthy();
-    expect(host!.path).toBe("/");
-    expect(host!.httpOnly).toBe(true);
-    expect(host!.secure).toBe(true);
-    expect(host!.sameSite).toBe("Lax");
-    expect(
-      cookies.find((c) => c.name === "__Secure-reset_ticket"),
-      "la __Secure- antigua no debe quedar tras emitir la __Host-",
-    ).toBeFalsy();
-    expect(
-      cookies.find((c) => c.name === "reset_ticket"),
-      "el legado reset_ticket no debe quedar",
-    ).toBeFalsy();
-
-    // Y el flujo completa con el ticket nuevo.
-    await page.getByLabel("Nueva contraseña").fill(newPassword);
-    await page.getByLabel("Repite la contraseña").fill(newPassword);
-    await page.getByRole("button", { name: "Guardar nueva contraseña" }).click();
-    await page.waitForURL(/\/login\?reset=ok/);
-    expect(await loginSucceeds(newPassword)).toBe(true);
+    // Señal INEQUÍVOCA de que la Server Action terminó (y falló): el ticket vacío
+    // hace que resetPasswordWithTicket devuelva {ok:false} → se pinta el ErrorBox
+    // (role="alert"). Esperarlo evita una carrera al comprobar la URL/credenciales.
+    await expect(page.getByRole("alert")).toBeVisible();
+    // No hubo redirect al éxito: seguimos en el paso de contraseña.
+    await expect(page).not.toHaveURL(/\/login\?reset=ok/);
+
+    // Contrato duro (vía ConvexHttpClient, independiente del render): la contraseña
+    // NO cambió — la nueva no entra y la anterior sigue valiendo.
+    expect(await loginSucceeds(newPassword)).toBe(false);
+    expect(await loginSucceeds(oldPassword)).toBe(true);
   });
 });
diff --git a/src/lib/auth/constants.ts b/src/lib/auth/constants.ts
index cd9b812..48807e4 100644
--- a/src/lib/auth/constants.ts
+++ b/src/lib/auth/constants.ts
@@ -22,13 +22,11 @@ export const PKCE_VERIFIER_COOKIE_NAME = "__Secure-google_pkce_verifier";
 // ticket de reseteo entre verificar el código y fijar la nueva contraseña.
 // Antes viajaba en estado React + <input type="hidden">, accesible a JS; ahora
 // solo existe aquí, fuera del alcance del navegador.
-// MIS-312: el `path` pasa de `/recuperar-contrasena` a `/` para que el mismo
-// ticket sirva también a la pantalla de onboarding `/configurar-contrasena`
-// (server actions compartidas). Con `Secure` + `Path=/` + sin `Domain` ya cumple
-// el prefijo `__Host-` (más fuerte que el `__Secure-` anterior). El rename es a
-// propósito: durante la migración conviven SIN ambigüedad la cookie nueva
-// (`__Host-`, path `/`) y la anterior (`__Secure-reset_ticket`, path estrecho),
-// porque la API de cookies de Next indexa por NOMBRE y no permite emitir dos
-// `Set-Cookie` del mismo nombre en una respuesta. Ver cookie.ts (lectura dual
-// transitoria + expiración de la variante vieja) y PLANS/MIS-312.
+// MIS-312: el `path` es `/` (antes `/recuperar-contrasena`) para que el mismo
+// ticket sirva tanto a `/recuperar-contrasena` como a la pantalla de onboarding
+// `/configurar-contrasena` (server actions compartidas). Con `Secure` + `Path=/`
+// + sin `Domain` cumple el prefijo `__Host-`, que el navegador REFUERZA.
+// MIS-315: retirada la compatibilidad transitoria con el nombre anterior
+// `__Secure-reset_ticket` (lectura dual + expiración), superada la ventana del
+// TTL del ticket (15 min) desde el despliegue de MIS-312. Ver cookie.ts.
 export const RESET_TICKET_COOKIE_NAME = "__Host-reset_ticket";
diff --git a/src/lib/auth/cookie.ts b/src/lib/auth/cookie.ts
index 1778c91..2889025 100644
--- a/src/lib/auth/cookie.ts
+++ b/src/lib/auth/cookie.ts
@@ -27,18 +27,11 @@ import {
 // la última versión desplegable que emitía estos nombres. Ver PLANS/MIS-293-cookies.md.
 const LEGACY_SESSION_COOKIE_NAME = "session";
 const LEGACY_OAUTH_STATE_COOKIE_NAME = "google_oauth_state";
-const LEGACY_RESET_TICKET_COOKIE_NAME = "reset_ticket";
-
-// MIS-312: nombre del ticket de reseteo ANTES de MIS-312 (prefijo `__Secure-`,
-// path estrecho `/recuperar-contrasena`). Se EXPIRA en set/clear y se LEE como
-// fallback transitorio para recuperaciones en vuelo iniciadas antes del
-// despliegue (que verificaron el código con el nombre/ path viejos). Retirar
-// este nombre y su lectura dual en un follow-up pasada la ventana de 15 min
-// (TTL del ticket) desde el despliegue de MIS-312.
-const LEGACY_SECURE_RESET_TICKET_COOKIE_NAME = "__Secure-reset_ticket";
-// Path estrecho del ticket anterior. Constante compartida por set/clear para
-// evitar divergencias tipográficas.
-const LEGACY_RESET_TICKET_PATH = "/recuperar-contrasena";
+// MIS-315: las constantes de los nombres ANTIGUOS del ticket de reseteo
+// (`__Secure-reset_ticket` de MIS-293→MIS-312 y el legado pre-B2 `reset_ticket`)
+// se retiraron aquí: superada la ventana del TTL del ticket (15 min) desde el
+// despliegue de MIS-312, ningún navegador conserva ya uno válido, así que ni se
+// leen ni se expiran. Ver PLANS/MIS-315.
 
 const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 días — sesión persistente
 
@@ -166,7 +159,10 @@ const RESET_TICKET_TTL_SECONDS = 15 * 60;
 export async function setResetTicketCookie(ticket: string): Promise<void> {
   const cookieStore = await cookies();
   // MIS-312: `path:"/"` (antes `/recuperar-contrasena`) para que el ticket sirva
-  // también a `/configurar-contrasena`; con Secure + Path=/ + sin Domain cumple `__Host-`.
+  // tanto a `/recuperar-contrasena` como a `/configurar-contrasena`; con Secure +
+  // Path=/ + sin Domain cumple `__Host-`.
+  // MIS-315: se emite SOLO `__Host-reset_ticket`; ya no se expiran las variantes
+  // antiguas (migración de MIS-312 completada, ver comentario arriba).
   cookieStore.set(RESET_TICKET_COOKIE_NAME, ticket, {
     httpOnly: true,
     secure: true,
@@ -174,39 +170,21 @@ export async function setResetTicketCookie(ticket: string): Promise<void> {
     path: "/",
     maxAge: RESET_TICKET_TTL_SECONDS,
   });
-  // MIS-312 (M1): expira la variante ANTERIOR del ticket (`__Secure-`, path
-  // estrecho) para que no coexistan dos cookies del ticket durante la migración.
-  // Nombre DISTINTO al de arriba ⇒ la API de Next (indexa por nombre) no lo
-  // deduplica y emite ambos `Set-Cookie`.
-  // OBLIGATORIO `secure: true`: el navegador RECHAZA borrar una cookie con prefijo
-  // `__Secure-` si el Set-Cookie de expiración no lleva `Secure` (sin esto, la
-  // cookie vieja NO se retira). Se replican los atributos con que se emitió.
-  cookieStore.set(LEGACY_SECURE_RESET_TICKET_COOKIE_NAME, "", {
-    httpOnly: true,
-    secure: true,
-    sameSite: "lax",
-    path: LEGACY_RESET_TICKET_PATH,
-    maxAge: 0,
-  });
-  // Legacy pre-B2 (nombre sin prefijo), en su path original.
-  cookieStore.set(LEGACY_RESET_TICKET_COOKIE_NAME, "", { path: LEGACY_RESET_TICKET_PATH, maxAge: 0 });
 }
 
 export async function readResetTicketCookie(): Promise<string | null> {
   const cookieStore = await cookies();
-  // MIS-312: lee el ticket nuevo (`__Host-`, path `/`) y, como fallback
-  // TRANSITORIO de migración, cae al anterior (`__Secure-`, path estrecho) para
-  // recuperaciones que verificaron el código ANTES del despliegue. Retirar el
-  // fallback pasada la ventana de 15 min.
-  return (
-    cookieStore.get(RESET_TICKET_COOKIE_NAME)?.value ??
-    cookieStore.get(LEGACY_SECURE_RESET_TICKET_COOKIE_NAME)?.value ??
-    null
-  );
+  // MIS-315: se lee EXCLUSIVAMENTE `__Host-reset_ticket`. La lectura dual al
+  // nombre anterior (`__Secure-reset_ticket`) fue una compatibilidad transitoria
+  // de la migración de MIS-312 (comportamiento posterior a esa migración: solo el
+  // nombre nuevo autoriza) y se retiró pasada la ventana del TTL del ticket (15 min).
+  return cookieStore.get(RESET_TICKET_COOKIE_NAME)?.value ?? null;
 }
 
 export async function clearResetTicketCookie(): Promise<void> {
   const cookieStore = await cookies();
+  // MIS-315: se limpia SOLO `__Host-reset_ticket` (migración de MIS-312 completada;
+  // ya no hay variantes antiguas que expirar).
   cookieStore.set(RESET_TICKET_COOKIE_NAME, "", {
     httpOnly: true,
     secure: true,
@@ -214,17 +192,4 @@ export async function clearResetTicketCookie(): Promise<void> {
     path: "/",
     maxAge: 0,
   });
-  // MIS-312: expira también las variantes de migración en su path estrecho
-  // (borrar una cookie exige repetir su `path` exacto). Nombres distintos ⇒ sin colisión.
-  // OBLIGATORIO `secure: true`: el navegador RECHAZA borrar una cookie con prefijo
-  // `__Secure-` si el Set-Cookie de expiración no lleva `Secure` (sin esto, la
-  // cookie vieja NO se retira). Se replican los atributos con que se emitió.
-  cookieStore.set(LEGACY_SECURE_RESET_TICKET_COOKIE_NAME, "", {
-    httpOnly: true,
-    secure: true,
-    sameSite: "lax",
-    path: LEGACY_RESET_TICKET_PATH,
-    maxAge: 0,
-  });
-  cookieStore.set(LEGACY_RESET_TICKET_COOKIE_NAME, "", { path: LEGACY_RESET_TICKET_PATH, maxAge: 0 });
 }
```

---

## 6. Contenido literal íntegro de los ficheros modificados

### 6.1 `src/lib/auth/cookie.ts`

```ts
import { cookies } from "next/headers";
import {
  SESSION_COOKIE_NAME,
  OAUTH_STATE_COOKIE_NAME,
  PKCE_VERIFIER_COOKIE_NAME,
  RESET_TICKET_COOKIE_NAME,
} from "./constants";

// MIS-293 (B1): `secure: true` SIEMPRE, no `process.env.NODE_ENV === "production"`.
// Fail-safe: si en el runtime de prod `NODE_ENV` no fuese exactamente "production",
// la variante anterior emitía cookies SIN `Secure`. Además, los prefijos de nombre
// `__Host-`/`__Secure-` (B2) OBLIGAN a `Secure`, así que no hay alternativa. Sobre
// http://localhost, los navegadores modernos tratan el host como *secure context* y
// aceptan estas cookies; en concreto Chromium (el navegador de los e2e/CI), de modo
// que dev local y la suite de Playwright siguen funcionando.
//
// INVARIANTE de `__Host-session` (lo refuerza el navegador): `Secure` + `Path=/` +
// SIN `Domain`. NUNCA añadir `domain` a la cookie de sesión ni cambiar su `path` de
// "/": el navegador rechazaría la cookie con prefijo `__Host-` por completo.

// Nombres ANTIGUOS (pre-B2). Existen SOLO para BORRARLOS de forma transitoria
// (MIS-293, M1) en su path original — nunca se LEEN (no hay lectura dual). Al
// escribir/limpiar cada cookie nueva se expira su gemela antigua, de modo que la
// cookie vieja (que pudo emitirse sin `Secure`, y que un rollback re-reconocería)
// se retira del navegador en login, logout y —para la sesión— en el redirect del
// proxy. Retirar estas líneas en un follow-up, pasado el TTL máximo (30 d) desde
// la última versión desplegable que emitía estos nombres. Ver PLANS/MIS-293-cookies.md.
const LEGACY_SESSION_COOKIE_NAME = "session";
const LEGACY_OAUTH_STATE_COOKIE_NAME = "google_oauth_state";
// MIS-315: las constantes de los nombres ANTIGUOS del ticket de reseteo
// (`__Secure-reset_ticket` de MIS-293→MIS-312 y el legado pre-B2 `reset_ticket`)
// se retiraron aquí: superada la ventana del TTL del ticket (15 min) desde el
// despliegue de MIS-312, ningún navegador conserva ya uno válido, así que ni se
// leen ni se expiran. Ver PLANS/MIS-315.

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 días — sesión persistente

// path:"/" explícito en set y clear: sin esto, un cambio futuro de ruta de
// login/logout podría dejar la cookie inaccesible o sin poder borrarla del todo.
// (Y es, además, requisito de `__Host-`.)
export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  // M1 (transitorio): borra la cookie de sesión ANTIGUA en su path original.
  cookieStore.set(LEGACY_SESSION_COOKIE_NAME, "", { path: "/", maxAge: 0 });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  cookieStore.set(LEGACY_SESSION_COOKIE_NAME, "", { path: "/", maxAge: 0 });
}

export async function readSessionToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null;
}

// MIS-260: cookie efímera del flujo OAuth de Google, separada de la de
// sesión — nunca lleva identidad, solo el nonce `state` para CSRF.
const OAUTH_STATE_TTL_SECONDS = 10 * 60; // 10 min — solo dura lo que tarda el consentimiento de Google

export async function setOAuthStateCookie(state: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(OAUTH_STATE_COOKIE_NAME, state, {
    httpOnly: true,
    secure: true,
    // "lax", no "strict": debe sobrevivir a la navegación top-level
    // ENTRANTE que hace Google al volver a /api/auth/google/callback —
    // "strict" no garantiza que la cookie viaje en esa navegación.
    sameSite: "lax",
    path: "/api/auth/google",
    maxAge: OAUTH_STATE_TTL_SECONDS,
  });
  cookieStore.set(LEGACY_OAUTH_STATE_COOKIE_NAME, "", { path: "/api/auth/google", maxAge: 0 });
}

export async function readOAuthStateCookie(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(OAUTH_STATE_COOKIE_NAME)?.value ?? null;
}

// MIS-299 (B6, PKCE): cookie efímera que transporta el `code_verifier` entre
// /start y /callback. Mismo molde, scope y vida (10 min) que la de OAuth state,
// pero SEPARADA: son secretos distintos y cada función tiene un propósito único.
// Cookie nueva: NO tiene gemela legada que borrar.
export async function setPkceVerifierCookie(verifier: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(PKCE_VERIFIER_COOKIE_NAME, verifier, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/auth/google",
    maxAge: OAUTH_STATE_TTL_SECONDS,
  });
}

export async function readPkceVerifierCookie(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(PKCE_VERIFIER_COOKIE_NAME)?.value ?? null;
}

// MIS-299 (B6): limpieza de las cookies TRANSITORIAS del flujo OAuth de Google.
// Reemplaza a clearOAuthStateCookie (que borraba state nuevo + su gemela legada);
// ahora expira además el verifier de PKCE. Las TRES en un ÚNICO cookie store:
//   1) __Secure-google_oauth_state (state nuevo)
//   2) __Secure-google_pkce_verifier (verifier PKCE)
//   3) google_oauth_state (gemela LEGADA — se conserva el borrado transitorio de MIS-293)
// Las tres escrituras se INTENTAN aunque una lance; el primer error se propaga
// (el callback la invoca en un `finally`: si esto lanzara, aborta fail-closed).
export async function clearOAuthTransientCookies(): Promise<void> {
  const cookieStore = await cookies();
  const oauthClearOptions = {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/auth/google",
    maxAge: 0,
  } as const;
  const legacyClearOptions = { path: "/api/auth/google", maxAge: 0 } as const;
  const writes: Array<() => void> = [
    () => cookieStore.set(OAUTH_STATE_COOKIE_NAME, "", oauthClearOptions),
    () => cookieStore.set(PKCE_VERIFIER_COOKIE_NAME, "", oauthClearOptions),
    () => cookieStore.set(LEGACY_OAUTH_STATE_COOKIE_NAME, "", legacyClearOptions),
  ];
  let firstError: unknown;
  for (const w of writes) {
    try {
      w();
    } catch (e) {
      firstError ??= e;
    }
  }
  if (firstError) throw firstError;
}

// MIS-292 (M3): ticket de reseteo. Vivía en estado React + <input type="hidden">
// (accesible a JS); ahora solo en esta cookie httpOnly, con el mismo molde que la
// de OAuth state: efímera y scoped al flujo de recuperación por su `path` (las
// Server Actions del wizard hacen POST a /recuperar-contrasena, así que la cookie
// viaja en verify→reset).
//
// OJO: estos 15 min DUPLICAN a propósito el TTL del ticket en Convex
// (TICKET_TTL_MS en convex/passwordReset.ts). Si allí cambia, cámbialo aquí.
const RESET_TICKET_TTL_SECONDS = 15 * 60;

export async function setResetTicketCookie(ticket: string): Promise<void> {
  const cookieStore = await cookies();
  // MIS-312: `path:"/"` (antes `/recuperar-contrasena`) para que el ticket sirva
  // tanto a `/recuperar-contrasena` como a `/configurar-contrasena`; con Secure +
  // Path=/ + sin Domain cumple `__Host-`.
  // MIS-315: se emite SOLO `__Host-reset_ticket`; ya no se expiran las variantes
  // antiguas (migración de MIS-312 completada, ver comentario arriba).
  cookieStore.set(RESET_TICKET_COOKIE_NAME, ticket, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: RESET_TICKET_TTL_SECONDS,
  });
}

export async function readResetTicketCookie(): Promise<string | null> {
  const cookieStore = await cookies();
  // MIS-315: se lee EXCLUSIVAMENTE `__Host-reset_ticket`. La lectura dual al
  // nombre anterior (`__Secure-reset_ticket`) fue una compatibilidad transitoria
  // de la migración de MIS-312 (comportamiento posterior a esa migración: solo el
  // nombre nuevo autoriza) y se retiró pasada la ventana del TTL del ticket (15 min).
  return cookieStore.get(RESET_TICKET_COOKIE_NAME)?.value ?? null;
}

export async function clearResetTicketCookie(): Promise<void> {
  const cookieStore = await cookies();
  // MIS-315: se limpia SOLO `__Host-reset_ticket` (migración de MIS-312 completada;
  // ya no hay variantes antiguas que expirar).
  cookieStore.set(RESET_TICKET_COOKIE_NAME, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
```

### 6.2 `src/lib/auth/constants.ts`

```ts
// Sin otras importaciones a propósito: tanto src/proxy.ts (usa request.cookies,
// API de next/server) como src/lib/auth/cookie.ts (usa next/headers) necesitan
// este nombre, y cada uno corre en un contexto distinto.
//
// MIS-293 (B2): prefijo `__Host-` — el navegador REFUERZA que la cookie se emitió
// con `Secure` + `Path=/` + SIN `Domain`. Ver la invariante en cookie.ts.
export const SESSION_COOKIE_NAME = "__Host-session";

// MIS-260: cookie de corta duración (10 min), solo para el flujo
// /api/auth/google/* — nunca contiene identidad, solo el nonce anti-CSRF.
// MIS-293 (B2): prefijo `__Secure-` (su `path` no es `/`, así que no puede ser
// `__Host-`); el navegador refuerza que se emitió con `Secure`.
export const OAUTH_STATE_COOKIE_NAME = "__Secure-google_oauth_state";

// MIS-299 (B6, PKCE): cookie httpOnly de corta duración (10 min) que transporta
// el `code_verifier` de PKCE entre /start y /callback — nunca contiene identidad,
// solo el secreto de un solo uso. Mismo molde y vida que la de OAuth state.
// MIS-293 (B2): prefijo `__Secure-` (su `path` no es `/`, mismo motivo que state).
export const PKCE_VERIFIER_COOKIE_NAME = "__Secure-google_pkce_verifier";

// MIS-292 (M3): cookie httpOnly de corta duración (15 min) que transporta el
// ticket de reseteo entre verificar el código y fijar la nueva contraseña.
// Antes viajaba en estado React + <input type="hidden">, accesible a JS; ahora
// solo existe aquí, fuera del alcance del navegador.
// MIS-312: el `path` es `/` (antes `/recuperar-contrasena`) para que el mismo
// ticket sirva tanto a `/recuperar-contrasena` como a la pantalla de onboarding
// `/configurar-contrasena` (server actions compartidas). Con `Secure` + `Path=/`
// + sin `Domain` cumple el prefijo `__Host-`, que el navegador REFUERZA.
// MIS-315: retirada la compatibilidad transitoria con el nombre anterior
// `__Secure-reset_ticket` (lectura dual + expiración), superada la ventana del
// TTL del ticket (15 min) desde el despliegue de MIS-312. Ver cookie.ts.
export const RESET_TICKET_COOKIE_NAME = "__Host-reset_ticket";
```

### 6.3 `e2e/onboarding.spec.ts`

```ts
// MIS-312: onboarding de primera contraseña para invitados (/configurar-contrasena).
// Reutiliza el motor de código+ticket de MIS-285, así que corre en el project
// "chromium-secrets" (circula la contraseña efímera de la identidad dedicada y la
// nueva que fija el propio spec, ninguna como literal). Cubre: el wizard en la
// ruta nueva, los atributos de la cookie del ticket (`__Host-`, path `/`) y su
// ausencia tras consumir.
// MIS-315: retirada la compatibilidad transitoria de la migración de MIS-312. Se
// sustituyeron los dos tests de migración (lectura dual / transición) por una
// prueba NEGATIVA que fija el contrato nuevo: un ticket que solo vive en el nombre
// antiguo (`__Secure-reset_ticket`) ya NO autoriza el cambio de contraseña.
import { randomBytes } from "node:crypto";
import { test, expect } from "./helpers/secure-test";
import { RESET_TEST_EMAIL, getLastResetCode, loginSucceeds, resetTestIdentity } from "./helpers/test-support";

function freshPassword(): string {
  return randomBytes(24).toString("base64url");
}

async function waitForResetCode(): Promise<string> {
  await expect
    .poll(async () => await getLastResetCode(), {
      message: "esperando a que deliverResetCode escriba el código en el outbox de test",
      timeout: 10_000,
    })
    .not.toBeNull();
  const code = await getLastResetCode();
  if (!code) throw new Error("getLastResetCode() devolvió null tras superar el poll");
  return code;
}

// Avanza el wizard (en la ruta dada) hasta el paso de contraseña, dejando emitido
// el ticket nuevo en `__Host-reset_ticket`. No devuelve nada (Promise<void>): quien
// necesite el valor del ticket lo lee con `context.cookies()` (Playwright lee
// cookies httpOnly). El botón del paso 1 depende del copy de cada ruta.
async function advanceToPasswordStep(
  page: import("@playwright/test").Page,
  route: string,
  sendCodeButton: string,
): Promise<void> {
  await page.goto(route);
  await page.getByLabel("Email").fill(RESET_TEST_EMAIL);
  await page.getByRole("button", { name: sendCodeButton }).click();
  const code = await waitForResetCode();
  await page.getByLabel("Código").fill(code);
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByLabel("Nueva contraseña")).toBeVisible();
}

test.describe("onboarding de primera contraseña (MIS-312)", () => {
  test("bienvenida con email prellenado → código → crear contraseña → /login?reset=ok", async ({ page }) => {
    const oldPassword = await resetTestIdentity();
    const newPassword = freshPassword();

    // Se llega con el email prellenado desde el enlace de la invitación.
    await page.goto(`/configurar-contrasena?email=${encodeURIComponent(RESET_TEST_EMAIL)}`);
    await expect(page.getByRole("heading", { name: "Te damos la bienvenida" })).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveValue(RESET_TEST_EMAIL);

    await page.getByRole("button", { name: "Enviar código" }).click();
    await expect(page.getByLabel("Código")).toBeVisible();

    const code = await waitForResetCode();
    await page.getByLabel("Código").fill(code);
    await page.getByRole("button", { name: "Continuar" }).click();

    await expect(page.getByLabel("Nueva contraseña")).toBeVisible();

    // Atributos de la cookie del ticket (MIS-312: `__Host-`, path `/`).
    const ticketCookie = (await page.context().cookies()).find((c) => c.name === "__Host-reset_ticket");
    expect(ticketCookie, "la cookie del ticket debe existir en el paso de contraseña").toBeTruthy();
    expect(ticketCookie!.httpOnly).toBe(true);
    expect(ticketCookie!.secure).toBe(true);
    expect(ticketCookie!.sameSite).toBe("Lax");
    expect(ticketCookie!.path).toBe("/");
    const nowSec = Date.now() / 1000;
    expect(ticketCookie!.expires).toBeGreaterThan(nowSec + 700); // ~15 min con tolerancia amplia
    expect(ticketCookie!.expires).toBeLessThan(nowSec + 1000);
    // Inaccesible a JavaScript.
    const jsCookies = await page.evaluate(() => document.cookie);
    expect(jsCookies).not.toContain("__Host-reset_ticket");

    await page.getByLabel("Nueva contraseña").fill(newPassword);
    await page.getByLabel("Repite la contraseña").fill(newPassword);
    await page.getByRole("button", { name: "Crear contraseña" }).click();

    await page.waitForURL(/\/login\?reset=ok/);
    await expect(page.getByText("Contraseña guardada")).toBeVisible();

    // La contraseña nueva funciona (y la vieja ya no) — vía ConvexHttpClient, sin teclear en login.
    expect(await loginSucceeds(newPassword)).toBe(true);
    expect(await loginSucceeds(oldPassword)).toBe(false);

    // Tras consumir el ticket, su cookie se borró.
    const cookieAfter = (await page.context().cookies()).find((c) => c.name === "__Host-reset_ticket");
    expect(cookieAfter, "la cookie del ticket debe borrarse tras crear la contraseña").toBeFalsy();
  });

  // MIS-315: prueba NEGATIVA del contrato nuevo. Antes (MIS-312) un ticket que solo
  // vivía en `__Secure-reset_ticket` completaba el cambio por lectura dual; retirada
  // esa compatibilidad, ese mismo estado ya NO debe autorizar nada.
  test("MIS-315: un ticket que solo vive en el nombre antiguo (__Secure-reset_ticket) ya NO autoriza", async ({
    page,
    context,
  }) => {
    const oldPassword = await resetTestIdentity();
    const newPassword = freshPassword();

    // Llega al paso de contraseña por el flujo normal → el ticket VÁLIDO queda en
    // __Host-reset_ticket. Se lee su valor (Playwright lee cookies httpOnly).
    await advanceToPasswordStep(page, "/recuperar-contrasena", "Enviar código");
    const host = (await context.cookies()).find((c) => c.name === "__Host-reset_ticket");
    expect(host, "debería existir __Host-reset_ticket tras verificar").toBeTruthy();
    const ticket = host!.value;

    // Reproduce el estado que MIS-315 deja de soportar: el ticket (válido en el
    // servidor, aún sin consumir) vive SOLO en la cookie ANTIGUA
    // `__Secure-reset_ticket` (path estrecho), sin `__Host-`.
    await context.clearCookies();
    await context.addCookies([
      {
        name: "__Secure-reset_ticket",
        value: ticket,
        domain: "localhost",
        path: "/recuperar-contrasena",
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ]);

    // Al enviar la contraseña, readResetTicketCookie ya NO cae al nombre antiguo →
    // el ticket llega vacío → resetPasswordAction devuelve error y NO redirige.
    await page.getByLabel("Nueva contraseña").fill(newPassword);
    await page.getByLabel("Repite la contraseña").fill(newPassword);
    await page.getByRole("button", { name: "Guardar nueva contraseña" }).click();

    // Señal INEQUÍVOCA de que la Server Action terminó (y falló): el ticket vacío
    // hace que resetPasswordWithTicket devuelva {ok:false} → se pinta el ErrorBox
    // (role="alert"). Esperarlo evita una carrera al comprobar la URL/credenciales.
    await expect(page.getByRole("alert")).toBeVisible();
    // No hubo redirect al éxito: seguimos en el paso de contraseña.
    await expect(page).not.toHaveURL(/\/login\?reset=ok/);

    // Contrato duro (vía ConvexHttpClient, independiente del render): la contraseña
    // NO cambió — la nueva no entra y la anterior sigue valiendo.
    expect(await loginSucceeds(newPassword)).toBe(false);
    expect(await loginSucceeds(oldPassword)).toBe(true);
  });
});
```

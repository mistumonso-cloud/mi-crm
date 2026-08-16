# MIS-298 · B3 — "Cerrar sesión en todos los dispositivos" — Entrega de código (ronda 2)

> Plan de récord: `PLANS/MIS-298-sessions.md` (GO CONDICIONADO ronda 2, condiciones bakeadas).
> **Ronda 2 de auditoría de código**: resueltos M1 (import de `api`), M2 (evidencia literal de
> `lookupSessionUser`) y M3 (orden del test UI). **Documento autocontenido**: diffs literales `diff -u`
> + contenido íntegro del spec nuevo + la función que constituye la frontera de autorización. Effort:
> **high**. **No autoriza instalar/subir/mergear/desplegar.**

## 1. Alcance y contrato

Acción bajo demanda "cerrar sesión en todos los dispositivos". Hoy `logout` solo mata la sesión
actual; la revocación global solo ocurría como efecto del cambio de contraseña. Este ticket:

- Extrae el recorrido `by_user` → delete a un helper único `revokeAllUserSessions`, usado por el reset
  (refactor sin cambio de comportamiento) **y** por la nueva mutation.
- Añade la mutation pública `logoutAllSessions({token})`, que revoca **todas** las sesiones del usuario
  portador de un token **vigente** (validación de expiración delegada en `lookupSessionUser`).
- Añade la Server Action `logoutAllAction` y un **segundo botón** en el header.

**Toca `convex/` → REQUIERE deploy de Convex a prod** (aditivo/retrocompatible; Gate: Convex ANTES del
merge para que la mutation exista antes de que Railway publique el frontend que la llama).

## 2. Manifiesto (8 modificados + 1 nuevo)

| # | Fichero | Cambio |
|---|---------|--------|
| 1 | `convex/lib/session.ts` | + helper `revokeAllUserSessions(ctx, userId)` |
| 2 | `convex/auth.ts` | + mutation `logoutAllSessions` (vigencia vía `lookupSessionUser`); import del helper |
| 3 | `convex/passwordReset.ts` | refactor: bucle inline `by_user` → `revokeAllUserSessions` (idéntico) |
| 4 | `convex/testSupport.ts` | + mutation de test `testInsertSession` (gated, `Number.isFinite`); import `hashToken` |
| 5 | `src/lib/auth/actions.ts` | + Server Action `logoutAllAction` |
| 6 | `src/app/(app)/layout.tsx` | + segundo botón "Cerrar en todos los dispositivos" |
| 7 | `e2e/helpers/test-support.ts` | + wrapper `insertSession(ttlMs)` |
| 8 | `playwright.config.ts` | registra `session-revoke-all.spec.ts` en `chromium-secrets` |
| 9 | `e2e/session-revoke-all.spec.ts` | **NUEVO** — 4 tests |

**Generados:** `convex/_generated/` está versionado. `npx convex codegen` (paso de instalación)
**podría** actualizar `api.d.ts`/`api.js` con las referencias a `logoutAllSessions`/`testInsertSession`
(no se afirma de antemano que cambien byte a byte al ser solo exports añadidos a módulos existentes; se
registra el resultado real tras codegen). Salida mecánica, no auditada a mano.

## 3. Diffs unificados — salida literal de `diff -u`

### 3.1 `convex/lib/session.ts`
```diff
--- convex/lib/session.ts
+++ CODIGO/MIS-298-sessions/convex/lib/session.ts
@@ -17,3 +17,16 @@
   await ctx.db.insert("sessions", { userId, tokenHash, expiresAt });
   return { token, expiresAt };
 }
+
+// MIS-298 (B3): revoca TODAS las sesiones de un usuario (índice by_user). Fuente
+// única del recorrido, compartida por resetPasswordWithTicket (revocación al
+// cambiar la contraseña) y por logoutAllSessions ("cerrar sesión en todos los
+// dispositivos"). Devuelve cuántas borró.
+export async function revokeAllUserSessions(ctx: MutationCtx, userId: Id<"users">): Promise<number> {
+  const sessions = await ctx.db
+    .query("sessions")
+    .withIndex("by_user", (q) => q.eq("userId", userId))
+    .collect();
+  for (const s of sessions) await ctx.db.delete(s._id);
+  return sessions.length;
+}
```

### 3.2 `convex/auth.ts`
```diff
--- convex/auth.ts
+++ CODIGO/MIS-298-sessions/convex/auth.ts
@@ -11,7 +11,7 @@
 import { serverKeyMatches, AUTH_SERVER_KEY_ENV_VAR } from "./lib/serverKey";
 import { hashToken } from "./lib/token";
 import { lookupSessionUser } from "./lib/authz";
-import { createSession } from "./lib/session";
+import { createSession, revokeAllUserSessions } from "./lib/session";
 import {
   LOGIN_EMAIL_COUNTER,
   LOGIN_IP_LIMIT,
@@ -246,6 +246,22 @@
     return null;
   },
 });
+
+// MIS-298 (B3): "cerrar sesión en todos los dispositivos". Revoca TODAS las
+// sesiones del usuario portador de este token. Solo una sesión VIGENTE autoriza:
+// lookupSessionUser valida `expiresAt`, así que una fila expirada aún no purgada
+// por el cron NO puede expulsar sesiones nuevas. Mismo modelo de confianza que
+// `logout` (el token es la credencial portadora; sin serverKey). Token
+// desconocido o expirado -> no-op.
+export const logoutAllSessions = mutation({
+  args: { token: v.string() },
+  returns: v.null(),
+  handler: async (ctx, args) => {
+    const user = await lookupSessionUser(ctx, args.token);
+    if (user) await revokeAllUserSessions(ctx, user.id);
+    return null;
+  },
+});
 
 // Query pura de solo lectura — Convex no permite escribir dentro de una query
 // (QueryCtx no expone insert/patch/delete en ctx.db), así que no hace ninguna
```

### 3.3 `convex/passwordReset.ts`
```diff
--- convex/passwordReset.ts
+++ CODIGO/MIS-298-sessions/convex/passwordReset.ts
@@ -15,6 +15,7 @@
 import { validatePassword, CURRENT_PASSWORD_POLICY_VERSION } from "./lib/passwordPolicy";
 import { serverKeyMatches, AUTH_SERVER_KEY_ENV_VAR } from "./lib/serverKey";
 import { generateNumericCode, generateOpaqueToken, hashToken } from "./lib/token";
+import { revokeAllUserSessions } from "./lib/session";
 import {
   RESET_REQUEST_LIMIT,
   RESET_CODE_LIMIT,
@@ -281,12 +282,9 @@
     });
     await ctx.db.patch(row._id, { usedAt: Date.now() });
 
-    for (const session of await ctx.db
-      .query("sessions")
-      .withIndex("by_user", (q) => q.eq("userId", row.userId))
-      .collect()) {
-      await ctx.db.delete(session._id);
-    }
+    // MIS-298 (B3): revocación global al cambiar la contraseña — extraída al
+    // helper compartido con logoutAllSessions (misma semántica que antes).
+    await revokeAllUserSessions(ctx, row.userId);
 
     // MIS-292 (M4): avisar por email de que la contraseña cambió. El envío exige
     // `fetch`, que solo es posible en un action → se programa un internalAction.
```

### 3.4 `convex/testSupport.ts`
```diff
--- convex/testSupport.ts
+++ CODIGO/MIS-298-sessions/convex/testSupport.ts
@@ -29,7 +29,7 @@
 import { KDF_COUNTER_KEY } from "./auth";
 import { hashPassword } from "./lib/password";
 import { assertServerKey } from "./lib/serverKey";
-import { generateOpaqueToken } from "./lib/token";
+import { generateOpaqueToken, hashToken } from "./lib/token";
 import { loginCounterKey, normalizeEmailKey, resetAttempts } from "./lib/rateLimit";
 import { validatePassword, CURRENT_PASSWORD_POLICY_VERSION } from "./lib/passwordPolicy";
 import {
@@ -238,6 +238,34 @@
   },
 });
 
+// MIS-298 (B3): inserta una sesión para la identidad dedicada con un TTL
+// arbitrario, para ejercitar logoutAllSessions con varias sesiones y con una
+// sesión EXPIRADA (imposible por la API pública). Mismos cerrojos que el resto
+// del harness (clave + identidad dedicada). `ttlMs` acotado a un rango finito.
+const INSERT_SESSION_MIN_TTL_MS = -60 * 60 * 1000; // -1 h (sesión ya expirada)
+const INSERT_SESSION_MAX_TTL_MS = 40 * 24 * 60 * 60 * 1000; // 40 días
+export const testInsertSession = mutation({
+  args: { serverKey: v.string(), email: v.string(), ttlMs: v.number() },
+  returns: v.object({ token: v.string() }),
+  handler: async (ctx, args) => {
+    assertTestKey(args.serverKey);
+    assertDedicatedIdentity(args.email);
+    if (!Number.isFinite(args.ttlMs) || args.ttlMs < INSERT_SESSION_MIN_TTL_MS || args.ttlMs > INSERT_SESSION_MAX_TTL_MS) {
+      throw new Error("ttlMs fuera de rango");
+    }
+    const user = await findTestUser(ctx);
+    if (!user) throw new Error("La identidad dedicada no existe — llama antes a resetTestIdentity");
+    const token = generateOpaqueToken();
+    const tokenHash = await hashToken(token);
+    await ctx.db.insert("sessions", {
+      userId: user._id,
+      tokenHash,
+      expiresAt: Date.now() + args.ttlMs,
+    });
+    return { token };
+  },
+});
+
 // MIS-290 (prueba 8, I5): lee el contador de derivaciones del KDF. Mismos tres
 // cerrojos del harness. La clave es la misma que usa verifyPasswordInstrumented.
 export const getKdfCount = query({
```
> **Gate de seguridad de `testInsertSession`:** `assertTestKey(serverKey)` (cerrojo 1, fail-closed vía
> `assertServerKey`: sin `E2E_TEST_SUPPORT_KEY` en el entorno, `expected` es undefined y lanza — en
> prod esa env var NO existe) + `assertDedicatedIdentity(email)` (cerrojo 2: solo `RESET_TEST_EMAIL`).
> `ttlMs` finito y acotado a `[-1h, +40d]` (`Number.isFinite` descarta `NaN`).

### 3.5 `src/lib/auth/actions.ts`
```diff
--- src/lib/auth/actions.ts
+++ CODIGO/MIS-298-sessions/src/lib/auth/actions.ts
@@ -56,6 +56,18 @@
   redirect("/login");
 }
 
+// MIS-298 (B3): "cerrar sesión en todos los dispositivos". Calcada de
+// logoutAction, pero llama a logoutAllSessions, que revoca TODAS las sesiones del
+// usuario (no solo la actual). Borra la cookie local y redirige a /login igual.
+export async function logoutAllAction(): Promise<void> {
+  const token = await readSessionToken();
+  if (token) {
+    await fetchMutation(api.auth.logoutAllSessions, { token });
+  }
+  await clearSessionCookie();
+  redirect("/login");
+}
+
 // MIS-285: recuperación de contraseña por código (OTP). Un único tipo de
 // estado para las 3 actions — cada una avanza `step` según el resultado, y
 // RecoverForm.tsx (Client Component) decide qué paso pintar a partir de él.
```

### 3.6 `src/app/(app)/layout.tsx`
```diff
--- src/app/(app)/layout.tsx
+++ CODIGO/MIS-298-sessions/src/app/(app)/layout.tsx
@@ -1,7 +1,7 @@
 import type { ReactNode } from "react";
 import { Avatar } from "@/components/ui/core/Avatar";
 import { Button } from "@/components/ui/core/Button";
-import { logoutAction } from "@/lib/auth/actions";
+import { logoutAction, logoutAllAction } from "@/lib/auth/actions";
 import { getUser } from "@/lib/auth/dal";
 
 // Header superior (nombre + logout), común a toda la app. La navegación real
@@ -20,6 +20,9 @@
           alignItems: "center",
           justifyContent: "space-between",
           gap: 12,
+          // MIS-298 (B3): permite que el grupo de botones baje de línea en
+          // pantallas estrechas (320px) en vez de desbordar horizontalmente.
+          flexWrap: "wrap",
           padding: "12px 16px",
           borderBottom: "1px solid var(--color-border)",
           background: "var(--color-surface)",
@@ -29,11 +32,21 @@
           <Avatar name={user.name} size="sm" />
           <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{user.name}</span>
         </div>
-        <form action={logoutAction}>
-          <Button type="submit" variant="ghost" size="sm">
-            Cerrar sesión
-          </Button>
-        </form>
+        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
+          {/* MIS-298 (B3): rótulo SIN la subcadena "Cerrar sesión" para que el
+              selector por nombre accesible del botón de logout normal no colisione.
+              flexWrap: los dos botones se apilan a 320px (sin desbordar). */}
+          <form action={logoutAllAction}>
+            <Button type="submit" variant="ghost" size="sm">
+              Cerrar en todos los dispositivos
+            </Button>
+          </form>
+          <form action={logoutAction}>
+            <Button type="submit" variant="ghost" size="sm">
+              Cerrar sesión
+            </Button>
+          </form>
+        </div>
       </header>
       <main className="flex flex-1 flex-col">{children}</main>
     </div>
```
> **Desviación justificada del rótulo (Media):** el plan proponía "Cerrar sesión en todos los
> dispositivos", pero contiene la subcadena "Cerrar sesión", y `getByRole("button", { name: "Cerrar
> sesión" })` (subcadena, usado en `session-cookie.spec.ts:56`) matchearía **dos** botones. Se usa
> **"Cerrar en todos los dispositivos"** → cero colisión, sin tocar specs existentes.
>
> **Fix de regresión cazada por CI (ronda 3):** la primera instalación (dos botones de texto sin
> `flexWrap`) **desbordaba horizontalmente a 320px** — rompía los tests `edge-cases`/`panel-flow`
> "no desborda horizontalmente en 320px" (`document.documentElement.scrollWidth === clientWidth`), que
> aplican a TODA página bajo este layout. Fix: `flexWrap: "wrap"` en el header y en el contenedor de
> botones → en pantallas estrechas los botones bajan/apilan en vez de desbordar (ningún botón individual
> supera 320px). Verificado local: los 3 tests de 320px de `edge-cases` en verde. Sin cambio en desktop
> (el wrap solo actúa cuando el contenido excede el ancho).

### 3.7 `e2e/helpers/test-support.ts`
```diff
--- e2e/helpers/test-support.ts
+++ CODIGO/MIS-298-sessions/e2e/helpers/test-support.ts
@@ -71,6 +71,17 @@
   });
 }
 
+// MIS-298 (B3): inserta una sesión para la identidad dedicada (ttlMs negativo =>
+// ya expirada) y devuelve su token. Para ejercitar logoutAllSessions.
+export async function insertSession(ttlMs: number): Promise<string> {
+  const { token } = await convexClient().mutation(api.testSupport.testInsertSession, {
+    serverKey: testSupportKey(),
+    email: RESET_TEST_EMAIL,
+    ttlMs,
+  });
+  return token;
+}
+
 // Comprueba credenciales SIN pasar por el formulario: así la contraseña efímera
 // no entra en el navegador y no puede quedar registrada en una traza.
 export async function loginSucceeds(password: string): Promise<boolean> {
```
> `convexClient`, `api`, `testSupportKey` y `RESET_TEST_EMAIL` ya están importados/definidos en este
> fichero (líneas 7-8: `import { convexClient, api } from "./convex-client"`).

### 3.8 `playwright.config.ts`
```diff
--- playwright.config.ts
+++ CODIGO/MIS-298-sessions/playwright.config.ts
@@ -92,6 +92,7 @@
         "password-reset.spec.ts",
         "password-reset-invariants.spec.ts",
         "session-cookie.spec.ts",
+        "session-revoke-all.spec.ts",
       ],
       use: {
         ...devices["Desktop Chrome"],
```

### 3.9 Evidencia (M2): `convex/lib/authz.ts::lookupSessionUser` — frontera de autorización (SIN cambios)
`logoutAllSessions` delega toda la autorización aquí. **Este código NO se modifica**; se reproduce
literal para acreditar (a) que compara `expiresAt`, (b) que un token expirado devuelve `null`, y (c)
que el resultado tiene `.id: Id<"users">`:
```ts
type Ctx = QueryCtx | MutationCtx;

export type SessionUser = {
  id: Id<"users">;
  name: string;
  role: "rep" | "supervisor";
};

export async function lookupSessionUser(ctx: Ctx, token: string): Promise<SessionUser | null> {
  const tokenHash = await hashToken(token);
  const session = await ctx.db
    .query("sessions")
    .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
    .unique();
  if (!session) return null;
  if (session.expiresAt < Date.now()) return null;   // <- vigencia: token expirado => null

  const user = await ctx.db.get(session.userId);
  if (!user) return null;

  return { id: user._id, name: user.name, role: user.role };  // <- .id : Id<"users">
}
```
En un handler de mutation, `ctx` es `MutationCtx` (subtipo de `Ctx`), y `user.id` es `Id<"users">`,
justo lo que `revokeAllUserSessions(ctx, userId)` espera. Un token expirado -> `null` -> no-op.

## 4. Fichero NUEVO — `e2e/session-revoke-all.spec.ts` (contenido íntegro, corregido M1+M3)

```ts
// MIS-298 (B3): "cerrar sesión en todos los dispositivos" (revocación global bajo
// demanda). Corre en el project "chromium-secrets" (trace/vídeo/screenshot OFF +
// secure-test que limpia inputs del DOM): el caso de UI teclea una contraseña real.
//
// AISLAMIENTO: opera SOLO sobre la identidad dedicada RESET_TEST_EMAIL (el harness
// lo garantiza con assertDedicatedIdentity), así que revocar "todas sus sesiones"
// nunca toca la sesión compartida carlos.json ni las de Marta. Las sesiones se
// minan con testInsertSession (no con loginWithPassword) para controlar el TTL y
// poder crear una sesión EXPIRADA — imposible por la API pública. Toda la
// preparación con estado y la limpieza van en try/finally con resetTestIdentity
// (independiente de los tokens, que en el camino feliz quedan revocados).
import { test, expect } from "./helpers/secure-test";
import { convexClient } from "./helpers/convex-client";
import { api } from "../convex/_generated/api";
import { countSessionsFor, insertSession, resetTestIdentity, RESET_TEST_EMAIL } from "./helpers/test-support";
import { SESSION_COOKIE_NAME } from "../src/lib/auth/constants";

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRED_MS = -60 * 1000; // 1 min en el pasado

function getSessionUser(token: string) {
  return convexClient().query(api.auth.getSessionUser, { token });
}
function logoutAllSessions(token: string) {
  return convexClient().mutation(api.auth.logoutAllSessions, { token });
}

test.describe("logoutAllSessions — revocación global (MIS-298)", () => {
  test("revoca TODAS las sesiones del usuario, no solo la del token", async () => {
    await resetTestIdentity(); // identidad dedicada sembrada, 0 sesiones
    try {
      const a = await insertSession(DAY_MS);
      const b = await insertSession(DAY_MS);
      expect(await countSessionsFor()).toBe(2);
      expect(await getSessionUser(a)).not.toBeNull();
      expect(await getSessionUser(b)).not.toBeNull();

      await logoutAllSessions(a);

      expect(await countSessionsFor()).toBe(0);
      expect(await getSessionUser(a)).toBeNull();
      expect(await getSessionUser(b)).toBeNull(); // revoca MÁS que la "actual"
    } finally {
      await resetTestIdentity();
    }
  });

  test("un token EXPIRADO no revoca ninguna sesión vigente (no-op exacto)", async () => {
    await resetTestIdentity();
    try {
      const expired = await insertSession(EXPIRED_MS);
      const valid = await insertSession(DAY_MS);
      const before = await countSessionsFor(); // 2 (la expirada sigue en BD hasta el cron)
      expect(before).toBe(2);
      expect(await getSessionUser(expired)).toBeNull(); // control: ya no autentica (expirada)

      await logoutAllSessions(expired);

      expect(await countSessionsFor()).toBe(before); // igualdad EXACTA: no-op
      expect(await getSessionUser(valid)).not.toBeNull(); // la vigente sobrevive
    } finally {
      await resetTestIdentity();
    }
  });

  test("un token DESCONOCIDO es no-op", async () => {
    await resetTestIdentity();
    try {
      const valid = await insertSession(DAY_MS);
      const before = await countSessionsFor(); // 1
      await logoutAllSessions("token-inexistente-xyz");
      expect(await countSessionsFor()).toBe(before);
      expect(await getSessionUser(valid)).not.toBeNull();
    } finally {
      await resetTestIdentity();
    }
  });

  test("el botón 'Cerrar en todos los dispositivos' revoca todo y desloguea (UI)", async ({
    page,
    context,
  }) => {
    const password = await resetTestIdentity();
    try {
      // 1. Login por navegador con la identidad dedicada (sesión del jar).
      await page.goto("/login");
      await page.getByLabel("Email").fill(RESET_TEST_EMAIL);
      // Selector por name (mismo motivo que auth.setup.ts / session-cookie.spec.ts).
      await page.locator('input[name="password"]').fill(password);
      await page.getByRole("button", { name: "Entrar" }).click();
      await page.waitForURL("/pendientes");

      // 2. La cookie de sesión ACTUAL está presente antes de nada.
      const beforeCookies = await context.cookies();
      expect(beforeCookies.find((c) => c.name === SESSION_COOKIE_NAME)).toBeTruthy();

      // 3. Crear la OTRA sesión DESPUÉS del login (orden aprobado en el plan).
      const other = await insertSession(DAY_MS);

      // 4. Precondición: `other` está VIGENTE justo antes de pulsar (y hay 2 sesiones);
      //    así, si luego resulta null, la causa es el botón, no un estado previo.
      expect(await getSessionUser(other)).not.toBeNull();
      expect(await countSessionsFor()).toBe(2);

      // 5. Pulsar el botón por su nombre accesible EXACTO (no colisiona con "Cerrar sesión").
      await page.getByRole("button", { name: "Cerrar en todos los dispositivos" }).click();
      await page.waitForURL(/\/login/);

      // 6. La cookie desaparece del jar (por constante) y la OTRA sesión quedó revocada.
      const afterCookies = await context.cookies();
      expect(afterCookies.find((c) => c.name === SESSION_COOKIE_NAME)).toBeUndefined();
      expect(await getSessionUser(other)).toBeNull();
    } finally {
      // Limpieza independiente del token del navegador (ya revocado en el camino feliz).
      await resetTestIdentity();
    }
  });
});
```

## 5. Evidencia reproducible

### 5.1 Cableado helper/mutation/action (en CODIGO)
`grep -rn "logoutAllSessions\|revokeAllUserSessions" CODIGO/MIS-298-sessions`
- `revokeAllUserSessions`: definido en `session.ts`, usado en `auth.ts` (logoutAllSessions) y
  `passwordReset.ts` (reset). Un único recorrido `by_user`.
- `logoutAllSessions`: mutation en `auth.ts`; la llaman `actions.ts` (Server Action) y el spec.

### 5.2 El rótulo nuevo NO colisiona con el selector de logout
`grep -c "Cerrar sesión en todos" "CODIGO/MIS-298-sessions/src/app/(app)/layout.tsx"` → **0** (ruta
citada por los paréntesis). El botón nuevo es "Cerrar en todos los dispositivos"; `getByRole("button",
{ name: "Cerrar sesión" })` (subcadena) sigue matcheando **solo** el botón de logout.

### 5.3 Manifiesto completo (sin filtro de extensión)
`find CODIGO/MIS-298-sessions -type f | LC_ALL=C sort`
```
CODIGO/MIS-298-sessions/MIS-298-sessions-codigo-completo.md
CODIGO/MIS-298-sessions/convex/auth.ts
CODIGO/MIS-298-sessions/convex/lib/session.ts
CODIGO/MIS-298-sessions/convex/passwordReset.ts
CODIGO/MIS-298-sessions/convex/testSupport.ts
CODIGO/MIS-298-sessions/e2e/helpers/test-support.ts
CODIGO/MIS-298-sessions/e2e/session-revoke-all.spec.ts
CODIGO/MIS-298-sessions/playwright.config.ts
CODIGO/MIS-298-sessions/src/app/(app)/layout.tsx
CODIGO/MIS-298-sessions/src/lib/auth/actions.ts
```
→ 9 ficheros de código + este documento. `convex/_generated/*` se regenera (§2, §6).

## 6. Cambios de esta ronda (§8 de la auditoría de código)
1. **M1** — el spec importa `api` de `../convex/_generated/api` (patrón de `session-cookie.spec.ts`),
   `convexClient` del helper. Diff/contenido literal en §4.
2. **M2** — evidencia literal completa de `lookupSessionUser` (vigencia + `.id`) en §3.9.
3. **M3** — el test UI crea `other` **después** del login y **asevera `getSessionUser(other) !== null`
   + `countSessionsFor() === 2`** justo antes de pulsar el botón → cierra la vía de falso verde.
4. **Media** — toda la preparación con estado (inserciones) va **dentro del `try`**.
5. **Baja** — `!Number.isFinite(args.ttlMs)` en `testInsertSession`; §5.2 con la ruta citada; wording
   de `_generated` como "podría" (se registra el resultado real de codegen).

**Ronda 3 (regresión cazada por CI):** el segundo botón sin `flexWrap` desbordaba a 320px y rompía los
tests de overflow horizontal (`edge-cases`/`panel-flow`). Único fichero tocado: `src/app/(app)/layout.tsx`
(`flexWrap: "wrap"` en header + contenedor de botones). Detalle y verificación en la nota de §3.6. El
resto de la entrega (lint 0 err, build OK, `chromium-secrets` 34/34) no cambia.

## 7. Verificación pendiente TRAS instalar byte-idéntico
1. Copiar los 9 ficheros a su ruta (igualdad byte-a-byte).
2. `npx convex dev --once` — despliega las funciones nuevas al deployment de **dev** (que el e2e usa en
   vivo) **y** regenera `convex/_generated/`; commitear lo que cambie (registrar el diff real).
3. `npm run lint` (0 err) · `npm run build` (TypeScript OK).
4. `npm run test:e2e` — foco `chromium-secrets/session-revoke-all.spec.ts`; `password-reset*.spec.ts`
   sigue verde (refactor sin cambio de comportamiento).
5. Despliegue: **Convex a prod ANTES del merge** (aditivo) + verificar `logoutAllSessions` viva en prod
   → merge → Railway frontend → smoke (login → 2 sesiones → botón → la otra deja de valer).

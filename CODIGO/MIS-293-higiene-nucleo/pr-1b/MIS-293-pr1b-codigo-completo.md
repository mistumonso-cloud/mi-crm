# MIS-293 · PR-1b — Retirar el veto por email (`LOGIN_EMAIL_VETO`) — CÓDIGO COMPLETO

Rama (a crear tras GO): `mistumonso/mis-293-pr1b-retirar-veto`. Plan:
`PLANS/MIS-293-higiene-nucleo.md` (sección "PR-1b", ya GO). **Tercera y última** unidad del
núcleo: `PR-1a → gate [] → PR-1a-bis → **PR-1b**`.

> **Ronda 2 de auditoría.** Cambios respecto a la ronda 1, todos dentro del alcance pedido:
> (1) el bloque B3 pasa a incluir el **diff de borrado COMPLETO** de los cuatro ficheros (todas las
> líneas con «-», sin elipsis ni resúmenes); (2) la §5 sustituye la evidencia por **comandos
> reproducibles** (`git grep`, que solo mira ficheros versionados) con **exclusiones reales** de
> `PLANS/**` y `CODIGO/**` y su **salida completa**; (3) se adopta el `try/finally` de limpieza en
> el test (sugerencia Media); (4) B4 añade chequeo de presencia en dev y verificación de ausencia
> final por nombres; (5) se explican los códigos 0/97/98 del runbook (nota Baja). No se reabren los
> cambios funcionales de la ronda 1.

**Prerrequisitos ya cumplidos:**
- PR-1a mergeado + desplegado a prod (PR #58, `5f91583`, `greedy-tapir-20`).
- PR-1a-bis mergeado + NFKC activo en prod (PR #59, `bcbd30c`); `main` HEAD = `bcbd30c`.
- `LOGIN_EMAIL_VETO` está hoy en **`off`** en prod (el veto ya no bloquea; solo queda el
  interruptor y el código muerto que lo consulta). En dev (`dutiful-mole-111`) idem o ausente.

> **Documento autocontenido:** el auditor solo ve este texto, sin acceso a ficheros ni
> herramientas. Por eso: (a) para los ficheros **modificados** se incluye el **diff unificado
> completo** (todos los hunks); (b) para los ficheros **borrados** se incluye el **diff de borrado
> completo** (todo el contenido, cada línea con «-») y los comandos reproducibles que demuestran que
> ningún otro punto del repo los referencia.

---

## 0. Qué hace PR-1b y por qué es seguro

El veto por email fue una capa de rate-limit que bloqueaba una cuenta tras 5 fallos
(clave `<email>`, 5/15 min → bloqueo 15 min), controlada por el interruptor `LOGIN_EMAIL_VETO`
(fail-safe: ausente/≠"off" ⇒ activo). Ya se **desactivó** en prod poniéndolo a `off`. PR-1b
**elimina el mecanismo entero del código** (no solo lo apaga) y retira el interruptor del entorno.
Motivo (recogido en el plan del núcleo, ya GO): el veto por email es un vector de **DoS dirigido**
(quien conozca un email puede bloquear esa cuenta 15 min con 5 intentos), mientras que la
protección del KDF ya la da la **capa por IP** (`LOGIN_IP_LIMIT`, 10/15 min), que se mantiene
intacta.

Tras PR-1b **la única capa que bloquea el login es la de IP**. La respuesta al cliente no cambia
(sigue `GENERIC_ERROR` para todo, B7 de MIS-296 intacto): un bloqueo es indistinguible de unas
credenciales incorrectas.

| # | Fichero | Acción | Resumen |
|---|---|---|---|
| B1 | `convex/lib/rateLimit.ts` | modificado | Borra `LOGIN_EMAIL_VETO_LIMIT` y `emailVetoActive()`; limpia comentarios del veto. |
| B1 | `convex/auth.ts` | modificado | Quita imports y ramas del veto en `reserveLoginSlot`/`finalizeLogin`; colapsa `reason` (solo IP); log constante. |
| B1 | `convex/testSupport.ts` | modificado | Actualiza el comentario de la clave `<email>` en `rateLimitKeysForTestIdentity`. |
| B2 | `e2e/test-support.spec.ts` | modificado | Reescribe la prueba "el reseed limpia el bloqueo…" a la capa por IP + `try/finally` de limpieza. |
| B3 | `scripts/login-verify/{core.mjs,index.mjs,core.test.mjs,README.md}` | **borrado** | Herramienta que solo servía para voltear/verificar `LOGIN_EMAIL_VETO`. |
| B3 | `package.json` | modificado | Quita el script `test:unit` (apuntaba a los tests de la herramienta borrada). |
| B4 | *(despliegue)* | operación | Tras desplegar: `env remove LOGIN_EMAIL_VETO` en prod y dev, y verificar ausencia. |

Snapshots byte-idénticos de los ficheros modificados en `CODIGO/MIS-293-higiene-nucleo/pr-1b/<ruta>`.

---

## B1 · `convex/lib/rateLimit.ts` — borrar la constante y el interruptor del veto

Se elimina la config `LOGIN_EMAIL_VETO_LIMIT` y el helper `emailVetoActive()`. Se conserva
`LOGIN_EMAIL_COUNTER` (telemetría no bloqueante, clave `login-counter:<email>`) y toda la
maquinaria genérica (`isLocked`/`recordFailedAttempt`/`resetAttempts`), que la capa por IP usa.

```diff
diff --git a/convex/lib/rateLimit.ts b/convex/lib/rateLimit.ts
index 9f23d99..b254c60 100644
--- a/convex/lib/rateLimit.ts
+++ b/convex/lib/rateLimit.ts
@@ -53,7 +53,8 @@ const MIN = 60 * 1000;
 // --- Login (MIS-290, 1B.1) ---
 
 // Capa por IP: acota el coste del KDF (I5). Se consume AL INTENTAR en
-// reserveLoginSlot, no al fallar.
+// reserveLoginSlot, no al fallar. Es la ÚNICA capa que BLOQUEA el login: el veto
+// por email se retiró en MIS-293 (PR-1b).
 export const LOGIN_IP_LIMIT: RateLimitConfig = {
   maxAttempts: 10,
   windowMs: 15 * MIN,
@@ -61,21 +62,11 @@ export const LOGIN_IP_LIMIT: RateLimitConfig = {
   lockDurationMs: 15 * MIN,
 };
 
-// Veto por email (clave `<email>`). Comportamiento actual conservado; controlado
-// por el interruptor LOGIN_EMAIL_VETO (ver emailVetoActive). Se RETIRA en 1B-ii
-// (MIS-291) poniendo el interruptor a "off". Su semántica (5/15 → bloqueo 15) es
-// FIJA de por vida sobre esta clave: nunca se reinterpreta.
-export const LOGIN_EMAIL_VETO_LIMIT: RateLimitConfig = {
-  maxAttempts: 5,
-  windowMs: 15 * MIN,
-  lock: true,
-  lockDurationMs: 15 * MIN,
-};
-
 // Telemetría por email (clave `login-counter:<email>`, ver loginCounterKey). NO
 // veta y ningún consumidor la lee hoy: es forense, para alimentar una futura
 // alerta de "intentos de acceso". NO confundir con una defensa. Semántica FIJA
-// de por vida sobre su propia clave: nunca comparte fila con el veto (M1).
+// de por vida sobre su propia clave (M1: cada clave con su config; un contador
+// nunca se reinterpreta ni comparte fila con otra clave).
 export const LOGIN_EMAIL_COUNTER: RateLimitConfig = {
   maxAttempts: 50,
   windowMs: 60 * MIN,
@@ -112,14 +103,6 @@ export function loginCounterKey(emailKey: string): string {
   return `login-counter:${emailKey}`;
 }
 
-// Interruptor del veto por email (MIS-290 lo introduce activo por defecto; MIS-291
-// lo pondrá a "off"). FAIL-SAFE: ausente o cualquier valor distinto de "off" →
-// veto ACTIVO. Un despliegue que se olvide la variable mantiene el bloqueo, no lo
-// retira (misma dirección segura que el fail-closed de I2).
-export function emailVetoActive(): boolean {
-  return process.env.LOGIN_EMAIL_VETO !== "off";
-}
-
 async function findAttempt(ctx: MutationCtx, emailKey: string) {
   return await ctx.db
     .query("loginAttempts")
```

**Referencias:** `LOGIN_EMAIL_VETO_LIMIT` y `emailVetoActive` solo se importaban en `convex/auth.ts`
(ambos usos se eliminan abajo). Ningún otro consumidor (ver §5).

---

## B1 · `convex/auth.ts` — quitar las ramas del veto y colapsar `reason`

1. **Imports**: fuera `LOGIN_EMAIL_VETO_LIMIT` y `emailVetoActive`.
2. **`reserveResultValidator` / `ReserveResult`**: la rama bloqueada era
   `{ blocked: true, reason: "ip" | "email" }`. Retirado el veto, **solo la IP bloquea**, así que
   `reason` sería una unión de un único miembro (`"ip"`): se **elimina** el campo → `{ blocked: true }`.
3. **`reserveLoginSlot`**: se borra la rama del veto por email.
4. **`finalizeLogin`**: se borra el `recordFailedAttempt(emailKey, LOGIN_EMAIL_VETO_LIMIT)`. Se
   conserva la telemetría `LOGIN_EMAIL_COUNTER` (siempre) y, en el éxito, `resetAttempts` de ambas
   claves (ver nota en §4).
5. **`loginWithPassword`**: el log deja de interpolar `reserve.reason`; ahora es una **constante**
   `"[login] rechazo por bloqueo de rate limit (capa=IP)"`.

```diff
diff --git a/convex/auth.ts b/convex/auth.ts
index 83f1a42..784b2ce 100644
--- a/convex/auth.ts
+++ b/convex/auth.ts
@@ -14,9 +14,7 @@ import { lookupSessionUser } from "./lib/authz";
 import { createSession } from "./lib/session";
 import {
   LOGIN_EMAIL_COUNTER,
-  LOGIN_EMAIL_VETO_LIMIT,
   LOGIN_IP_LIMIT,
-  emailVetoActive,
   emailWithinLimits,
   isLocked,
   loginCounterKey,
@@ -66,29 +64,27 @@ type LoginResult =
 // TRANSACCIÓN 1. Consume la cuota de IP AL INTENTAR (no al fallar) y devuelve el
 // hash a comparar. Confirma ANTES del KDF: N peticiones concurrentes serializan
 // aquí y solo las primeras `LOGIN_IP_LIMIT.maxAttempts` no quedan bloqueadas.
-// Unión discriminada: cuando está bloqueada no fabrica hash ni huella.
+// Unión discriminada: cuando está bloqueada no fabrica hash ni huella. Tras
+// retirar el veto por email (PR-1b, MIS-293) la ÚNICA capa que bloquea es la de
+// IP, así que la rama bloqueada ya no necesita `reason`: el log del servidor la
+// nombra con una constante (ver loginWithPassword). B7 sigue intacto — la
+// RESPUESTA nunca distingue bloqueo de credenciales incorrectas.
 const reserveResultValidator = v.union(
-  // MIS-296 (B7): `reason` es SOLO para el log del servidor (motivo real del
-  // bloqueo). No sale nunca al cliente: loginWithPassword responde genérico.
-  v.object({ blocked: v.literal(true), reason: v.union(v.literal("ip"), v.literal("email")) }),
+  v.object({ blocked: v.literal(true) }),
   v.object({ blocked: v.literal(false), hash: v.string(), fingerprint: v.string() }),
 );
 type ReserveResult =
-  | { blocked: true; reason: "ip" | "email" }
+  | { blocked: true }
   | { blocked: false; hash: string; fingerprint: string };
 
 export const reserveLoginSlot = internalMutation({
   args: { emailKey: v.string(), ipKey: v.union(v.string(), v.null()) },
   returns: reserveResultValidator,
   handler: async (ctx, args): Promise<ReserveResult> => {
-    // Capa por IP (I5): si ya está bloqueada, no se consume más.
+    // Capa por IP (I5): si ya está bloqueada, no se consume más. Es la única capa
+    // que bloquea el login (el veto por email se retiró en PR-1b, MIS-293).
     if (args.ipKey && (await isLocked(ctx, `ip:${args.ipKey}`))) {
-      return { blocked: true, reason: "ip" };
-    }
-    // Veto por email — SOLO si el interruptor está activo (MIS-291 lo pondrá a
-    // "off"). Clave `<email>` con LOGIN_EMAIL_VETO_LIMIT; semántica fija (M1).
-    if (emailVetoActive() && (await isLocked(ctx, args.emailKey))) {
-      return { blocked: true, reason: "email" };
+      return { blocked: true };
     }
     // Consume la cuota de IP AL INTENTAR: es lo que acota el KDF. Los logins
     // correctos también consumen; con 10/15 min por IP no molesta a usuarios
@@ -143,9 +139,8 @@ async function verifyPasswordInstrumented(
 }
 
 // TRANSACCIÓN 2. Relee, revalida la huella (I7) y decide la sesión. Contabilidad
-// UNIFORME (M2): todo resultado sin sesión registra el contador de email igual,
-// exista o no la cuenta. Los dos registros de un fallo (telemetría + veto)
-// ocurren en ESTA misma transacción.
+// UNIFORME (M2): todo resultado sin sesión registra el contador de telemetría de
+// email igual, exista o no la cuenta.
 export const finalizeLogin = internalMutation({
   args: { emailKey: v.string(), fingerprint: v.string(), ok: v.boolean() },
   returns: loginResultValidator,
@@ -167,9 +162,14 @@ export const finalizeLogin = internalMutation({
       fingerprintsEqual(await fingerprintHash(user.passwordHash), args.fingerprint);
 
     if (success) {
-      // Resetea AMBAS claves de email (deja un rollback del veto en estado
-      // limpio) y NUNCA la de IP: si un login correcto limpiara la IP, bastaría
-      // una cuenta propia para seguir probando otras cuentas desde la misma IP.
+      // Limpia las claves de email en el éxito y NUNCA la de IP: si un login
+      // correcto limpiara la IP, bastaría una cuenta propia para seguir probando
+      // otras cuentas desde la misma IP.
+      //   - login-counter:<email> (telemetría): se reinicia tras entrar bien.
+      //   - <email> a secas: era la clave del veto por email retirado en PR-1b
+      //     (MIS-293). Ya nadie la escribe; este resetAttempts solo barre, de
+      //     forma oportunista, filas de bloqueo heredadas de antes de la retirada
+      //     (inertes: reserveLoginSlot ya no las lee) para que no queden colgando.
       await resetAttempts(ctx, args.emailKey);
       await resetAttempts(ctx, loginCounterKey(args.emailKey));
       const { token } = await createSession(ctx, user._id);
@@ -177,13 +177,11 @@ export const finalizeLogin = internalMutation({
     }
 
     // Fallo (fila inexistente, contraseña incorrecta o huella obsoleta): registro
-    // IDÉNTICO (M2, no reabre enumeración). Telemetría SIEMPRE (clave propia);
-    // veto solo si el interruptor está activo (clave `<email>`). Cada clave con
-    // su config fija — nunca se reinterpreta un contador (M1).
+    // IDÉNTICO (M2, no reabre enumeración). Solo telemetría por email (clave
+    // propia, con su config fija — nunca se reinterpreta un contador, M1): el veto
+    // por email se retiró en PR-1b (MIS-293), así que un fallo ya NO bloquea por
+    // email. La ÚNICA capa que bloquea es la de IP (consumida en reserveLoginSlot).
     await recordFailedAttempt(ctx, loginCounterKey(args.emailKey), LOGIN_EMAIL_COUNTER);
-    if (emailVetoActive()) {
-      await recordFailedAttempt(ctx, args.emailKey, LOGIN_EMAIL_VETO_LIMIT);
-    }
     return { success: false, error: GENERIC_ERROR };
   },
 });
@@ -217,8 +215,9 @@ export const loginWithPassword = action({
     if (reserve.blocked) {
       // B7 (MIS-296): la RESPUESTA no distingue un bloqueo de unas credenciales
       // incorrectas (anti-enumeración/anti-oráculo). El motivo real queda solo en
-      // el log del servidor — solo la capa, sin IP, email, contraseña ni token.
-      console.warn(`[login] rechazo por bloqueo de rate limit (capa=${reserve.reason})`);
+      // el log del servidor — solo la capa (hoy siempre IP, el veto por email se
+      // retiró en PR-1b), sin IP, email, contraseña ni token.
+      console.warn("[login] rechazo por bloqueo de rate limit (capa=IP)");
       return { success: false as const, error: GENERIC_ERROR };
     }
 
```

**Consumidor de la forma de `reserveLoginSlot`:** el harness `testSupport.testReserveLoginSlot`
tiene `returns`
`v.union(v.object({ blocked: v.literal(true) }), v.object({ blocked: v.literal(false), fingerprint }))`
y hace `r.blocked ? { blocked: true } : { blocked: false, fingerprint: r.fingerprint }`. **Nunca lee
`r.reason`**, así que el colapso no lo afecta (sigue compilando y comportándose igual).

---

## B1 · `convex/testSupport.ts` — comentario de la clave `<email>`

`rateLimitKeysForTestIdentity()` sigue enumerando `RESET_TEST_EMAIL` para limpiarla en cada reseed;
tras retirar el veto ya nadie escribe esa clave en el login, pero se mantiene su limpieza por
higiene (barre filas heredadas, inofensivas). Solo cambia el comentario:

```diff
diff --git a/convex/testSupport.ts b/convex/testSupport.ts
index a99505b..4500c4e 100644
--- a/convex/testSupport.ts
+++ b/convex/testSupport.ts
@@ -72,7 +72,7 @@ async function findTestUser(ctx: QueryCtx | MutationCtx) {
 // de una ejecución previa daría un falso verde en la prueba 8 (M3).
 function rateLimitKeysForTestIdentity(): string[] {
   return [
-    RESET_TEST_EMAIL, // login — veto por email (MIS-290)
+    RESET_TEST_EMAIL, // login — clave `<email>` del veto retirado en PR-1b (MIS-293); se limpia por higiene de filas heredadas
     loginCounterKey(RESET_TEST_EMAIL), // login — telemetría por email (MIS-290, M1: limpiar AMBAS)
     `reset:${RESET_TEST_EMAIL}`, // solicitudes de código
     `resetcode:${RESET_TEST_EMAIL}`, // intentos de código
```

---

## B2 · `e2e/test-support.spec.ts` — reescribir la prueba del reseed a la capa por IP

La prueba anterior generaba el bloqueo con **5 logins fallidos sin `ipHint`**, contando con el
**veto por email**. Al retirarlo, ese camino ya no bloquea → falso rojo. Se reescribe para la
**única** capa que bloquea, la de IP (`LOGIN_IP_LIMIT`, 10/15 min):

- Reseed → 10 intentos con contraseña incorrecta desde `TEST_LOGIN_IP`. `reserveLoginSlot` consume
  la cuota **al intentar**; el 10.º intento fija `lockedUntil`.
- Aserción: `loginResult(password, TEST_LOGIN_IP).success === false` — bloqueada por IP aunque la
  contraseña sea correcta (la 11.ª llamada entra ya bloqueada en la reserva, antes del KDF).
- Reseed (limpia `ip:TEST_LOGIN_IP`) → `loginResult(fresh, TEST_LOGIN_IP).success === true`.

**Corrección clave (fix M1 del plan):** ambas aserciones **fijan `TEST_LOGIN_IP`** (no
`loginSucceeds()`, que omite `ipHint`): sin IP no se ejercita la capa que bloquea y el "desbloqueo"
sería un falso verde.

**Ronda 2 (sugerencia Media adoptada):** todo el cuerpo va en `try/catch/finally` con un reseed final
de **red de seguridad, sin aserción**. En el deployment de dev COMPARTIDO, si una aserción fallara
con la IP ya bloqueada, sin este `finally` la IP quedaría bloqueada 15 min y arrastraría fallos en
cascada a los specs siguientes. El `finally` la libera pase lo que pase. Para no **enmascarar** el
error primario (sugerencia Media ronda 2: `await` de la limpieza podría rechazar y sustituir la
excepción previa), el `catch` marca `sawPrimaryError` y el reseed del `finally` va en su propio
`try/catch`, de modo que un fallo de la *limpieza* solo se propaga cuando **no** hubo error antes; si
lo hubo, se conserva el primario. `loginResult`/`TEST_LOGIN_IP` ya estaban importados; `loginSucceeds`
sigue usándose en otras pruebas (sin import huérfano).

```diff
diff --git a/e2e/test-support.spec.ts b/e2e/test-support.spec.ts
index 05e194c..e8b9722 100644
--- a/e2e/test-support.spec.ts
+++ b/e2e/test-support.spec.ts
@@ -79,22 +79,46 @@ test.describe("harness seguro (MIS-286)", () => {
   });
 
   // M8: sin esta limpieza, una ejecución que deje el bloqueo puesto haría
-  // fallar la siguiente durante 15 minutos. Se omite ipHint a propósito para
-  // ejercitar SOLO la clave por usuario, sin tocar el contador de IP compartido.
+  // fallar la siguiente durante 15 minutos. Antes esta prueba ejercitaba el veto
+  // por email; ese veto se retiró en MIS-293 (PR-1b), así que ahora comprueba la
+  // ÚNICA capa que bloquea: la de IP (LOGIN_IP_LIMIT, 10/15 min). Usa la IP
+  // sintética TEST_LOGIN_IP (de nadie), que el reseed limpia explícitamente
+  // (ver rateLimitKeysForTestIdentity) — nunca una IP real compartida.
   test("el reseed limpia el bloqueo de rate limit del login", async () => {
     const password = await resetTestIdentity();
-
-    // loginSucceeds va por loginWithPassword con serverKey (MIS-288): 5 fallos
-    // con la contraseña incorrecta agotan el margen por email.
-    for (let i = 0; i < 5; i++) {
-      await loginSucceeds("contraseña-incorrecta");
+    let sawPrimaryError = false;
+    try {
+      // 10 intentos desde la misma IP sintética agotan la cuota por IP y la
+      // bloquean, aunque la contraseña fuese correcta: reserveLoginSlot consume la
+      // cuota AL INTENTAR (antes del KDF), y el 10.º intento fija el bloqueo.
+      for (let i = 0; i < 10; i++) {
+        await loginResult("contraseña-incorrecta", TEST_LOGIN_IP);
+      }
+
+      // Bloqueada por IP: ni siquiera la contraseña correcta desde esa IP entra.
+      // DEBE fijar TEST_LOGIN_IP (no loginSucceeds, que omite ipHint): sin la IP no
+      // se ejercitaría la capa que bloquea y la prueba sería un falso verde.
+      expect((await loginResult(password, TEST_LOGIN_IP)).success).toBe(false);
+
+      // El reseed limpia ip:TEST_LOGIN_IP y rota la credencial: desde la MISMA IP,
+      // el login vuelve a entrar.
+      const fresh = await resetTestIdentity();
+      expect((await loginResult(fresh, TEST_LOGIN_IP)).success).toBe(true);
+    } catch (err) {
+      sawPrimaryError = true;
+      throw err;
+    } finally {
+      // Red de seguridad del deployment COMPARTIDO: si una aserción de arriba falla
+      // con la IP ya bloqueada, este reseed final la libera igualmente y no arrastra
+      // el bloqueo (15 min) a los specs siguientes. En el camino feliz es un reseed
+      // idempotente de más, inofensivo. Si el PROPIO reseed de limpieza fallara, no
+      // debe enmascarar el error primario: solo se propaga cuando no hubo uno antes.
+      try {
+        await resetTestIdentity();
+      } catch (cleanupErr) {
+        if (!sawPrimaryError) throw cleanupErr;
+      }
     }
-
-    // Bloqueada: ni siquiera la contraseña correcta entra.
-    expect(await loginSucceeds(password)).toBe(false);
-
-    const fresh = await resetTestIdentity();
-    expect(await loginSucceeds(fresh)).toBe(true);
   });
 
   // MIS-288 (I3): loginWithPassword rechaza toda llamada sin serverKey válido
```

**Cuenta (10):** `recordFailedAttempt` fija `lockedUntil` cuando `nextCount >= maxAttempts` (10):
intentos 1-9 → count 1..9 (sin bloqueo); intento 10 → count 10 → bloqueo. `reserveLoginSlot`
comprueba `isLocked` **antes** de consumir, así que la 11.ª llamada devuelve `{ blocked: true }` sin
derivar KDF. Los 10 fallidos sí derivan KDF (secuenciales); coste equivalente al de la prueba 8 (11
concurrentes), sin impacto material en el tiempo del e2e.

---

## B3 · Borrar `scripts/login-verify/` y el script `test:unit`

`scripts/login-verify/` (MIS-295) es una herramienta de operaciones cuyo **único** propósito era
correr las "pruebas 11-12" de la retirada del veto: voltear `LOGIN_EMAIL_VETO`
(`env set off`/`activo`/`remove`) contra un deployment y verificar el bloqueo por email
antes/después. Al eliminar el veto: (a) toda su lógica gira alrededor de `LOGIN_EMAIL_VETO`
→ obsoleta; (b) su clasificador `classifyLogin` depende de
`LOCKED_ERROR = "Demasiados intentos…"`, texto **ya retirado del producto** en MIS-296 (B7), así que
la clase `"locked"` es inalcanzable en el sistema real. Se borra el directorio entero (4 ficheros) y
el script `test:unit` que ejecutaba sus tests.

**Sin pérdida de cobertura:** `test:unit` **no se invoca en CI** (ver §5; los workflows corren
`test:e2e` y `test:e2e:secret-gate`). Los tests de `login-verify` prueban **la herramienta**, no el
producto; la cobertura de unidad del CRM (`verifyPassword`, `normalizeEmailKey`) vive en
`e2e/lib-unit.spec.ts` (project `unit` de Playwright), que no se toca.

### B3.1 · `package.json` — quitar `test:unit`

```diff
diff --git a/package.json b/package.json
index d8f84a8..d6e8917 100644
--- a/package.json
+++ b/package.json
@@ -12,8 +12,7 @@
     "lint": "eslint",
     "test:e2e": "playwright test",
     "test:e2e:report": "playwright show-report",
-    "test:e2e:secret-gate": "node scripts/check-secret-leak.mjs",
-    "test:unit": "node --test scripts/login-verify/*.test.mjs"
+    "test:e2e:secret-gate": "node scripts/check-secret-leak.mjs"
   },
   "dependencies": {
     "convex": "^1.42.1",
```

### B3.2 · Ficheros borrados — diff de borrado COMPLETO (cada línea con «-», sin elipsis)

Contenido íntegro de los cuatro ficheros, presentado como diff de borrado
(`git diff --no-index scripts/login-verify/<f> /dev/null`). El auditor puede confirmar de forma
autocontenida qué se elimina exactamente. (Los bloques van en valla de 4 acentos graves porque el
README contiene sus propias vallas de 3.)

#### `scripts/login-verify/README.md` (borrado)

````diff
diff --git a/scripts/login-verify/README.md b/scripts/login-verify/README.md
deleted file mode 100644
index 2c528a8..0000000
--- a/scripts/login-verify/README.md
+++ /dev/null
@@ -1,87 +0,0 @@
-# MIS-295 — Ejecutor seguro de verificación de login
-
-Herramienta de operaciones que corre las **pruebas 11-12** de MIS-291 (retirada del
-veto por email) contra un deployment de Convex, con secretos fuera de `argv`,
-preflight fail-closed, y recuperación verificada ante excepción y señales.
-
-## Ficheros
-
-- `core.mjs` — lógica pura (sin imports de Convex); toda la E/S entra por adaptadores
-  inyectados. Es lo que testean los unitarios.
-- `index.mjs` — entrypoint: cablea Convex por HTTP (`ConvexHttpClient`) y el CLI de
-  Convex por subproceso, gestiona señales y sanea la salida.
-- `core.test.mjs` — tests unitarios (`node:test`) con adaptadores falsos.
-
-Instalación (la hace MIS-295 tras el GO de código): copiar los tres a
-`scripts/login-verify/` **byte a byte**, y añadir a `package.json`:
-`"test:unit": "node --test scripts/login-verify/*.test.mjs"`.
-
-## Uso
-
-Desde la raíz del repo. Los secretos entran por **STDIN, exactamente 2 líneas**:
-línea 1 = contraseña de la cuenta bajo prueba (`carlos@test.local` en prod; la cuenta
-de `--email` en preview); línea 2 = `AUTH_SERVER_KEY` del deployment. Nunca se pasan
-por `argv` ni se escriben a disco.
-
-```sh
-# Producción (MIS-291): exige --confirm prod
-printf '%s\n%s\n' "$PASSWORD" "$AUTH_SERVER_KEY" | \
-  node scripts/login-verify/index.mjs --prod --confirm prod
-
-# Deployment preview desechable (integración), restaura el estado inicial
-printf '%s\n%s\n' "$PASSWORD" "$AUTH_SERVER_KEY" | \
-  node scripts/login-verify/index.mjs --deployment <name> --mode preview --confirm <name>
-```
-
-### Argumentos
-
-- `--prod` | `--deployment <name>` — **destino único**. La URL HTTP se deriva del
-  MISMO selector (`convex env get CONVEX_CLOUD_URL <selector>`): HTTP y CLI no pueden
-  apuntar a deployments distintos.
-- `--confirm <token>` — **obligatorio siempre** (prod y preview). Debe igualar el nombre
-  del selector: `--confirm prod` con `--prod`, o `--confirm <name>` con `--deployment <name>`.
-  (Con `--prod` el token es literalmente `prod`; el selector no contiene el nombre físico
-  del deployment.)
-- `--mode prod|preview` — por defecto `prod`. `prod` deja `LOGIN_EMAIL_VETO=off` (estado
-  deseado de MIS-291). `preview` restaura exactamente el estado inicial. **`--prod` NO admite
-  `--mode preview`**: preview exige un `--deployment <name>` desechable.
-- `--email <email>` — **solo se permite en `--mode preview`**; en prod queda fijado a
-  `carlos@test.local` para no poder dirigir la operación contra una cuenta arbitraria.
-- No se admiten selectores ni opciones **duplicados**.
-
-## Códigos de salida
-
-| Código | Significado |
-|--------|-------------|
-| `0`    | Todas las pruebas OK; estado final correcto. |
-| `1`    | Alguna prueba (11/12) falló; recuperación aplicada. |
-| `2`    | **Aborto de arranque fail-closed, SIN efectos**: argumentos/stdin inválidos, no se pudo resolver el deployment, gate ≠ `[]`, veto ya off, falta confirmación, o login base fallido. |
-| `3`    | Recuperación fallida: **exige intervención manual** (`convex env set LOGIN_EMAIL_VETO off <selector>`). |
-| `130`/`143` | Interrumpido por SIGINT/SIGTERM; recuperación aplicada (veto en off). |
-
-## Propiedades de seguridad
-
-- **Secretos fuera de argv:** contraseña y `AUTH_SERVER_KEY` viajan en el **cuerpo HTTP**
-  (`loginWithPassword`/`logout`); el CLI solo recibe `off`/`activo` (no secretos).
-- **Preflight fail-closed:** aborta sin efectos si el gate `accountsPendingRotation()` ≠ `[]`,
-  si el veto no está activo, si la CLI es indeterminada, si falta la confirmación de prod, o
-  si el login base no tiene éxito.
-- **Lectura focalizada:** `env list --names-only` para presencia y, solo si aparece,
-  `env get LOGIN_EMAIL_VETO`; nunca se captura el valor de otras variables del deployment.
-- **Recuperación única y ordenada:** una `recoveryPromise` memoizada espera a la transición
-  en vuelo antes de escribir `off`, así una señal a mitad de un `env set` no deja el veto activo.
-- **Sin token en la salida:** el resultado se clasifica a `{success, error}`; el token solo
-  circula en memoria para cerrar la sesión (`logout`). La salida se sanea contra los secretos.
-
-## Límites documentados (no recuperables)
-
-- **SIGKILL, corte de energía o pérdida persistente de red** no permiten completar la
-  recuperación: pueden dejar el veto activo. Mitigación manual: `convex env set LOGIN_EMAIL_VETO off <selector>`.
-- **Interrupción durante el preflight**, entre el login base y su `logout`, puede dejar una
-  sesión no cerrada. No afecta a la configuración ni habilita acceso; caducará sola.
-- En **modo preview**, una excepción durante la secuencia deja el veto en `off` (vía
-  `safeRecover`) en lugar de restaurar el estado inicial de `finalState`. Aceptable por ser un
-  deployment desechable.
-- **`logout` es best-effort:** cerrar la sesión creada por un login correcto no invalida la
-  prueba si falla (la sesión caduca sola); nunca se imprime el token. El preflight **no**
-  aborta por un fallo de `logout` del login base (sí por un login base sin éxito).
````

#### `scripts/login-verify/index.mjs` (borrado)

````diff
diff --git a/scripts/login-verify/index.mjs b/scripts/login-verify/index.mjs
deleted file mode 100644
index 3b43534..0000000
--- a/scripts/login-verify/index.mjs
+++ /dev/null
@@ -1,177 +0,0 @@
-#!/usr/bin/env node
-// MIS-295 — Ejecutor seguro de verificación de login: ENTRYPOINT.
-//
-// Cablea los adaptadores reales (Convex por HTTP, CLI de Convex por subproceso),
-// gestiona señales con recuperación única y sanea toda salida para que ningún
-// secreto (contraseña, AUTH_SERVER_KEY, token) aparezca en stdout/stderr/errores.
-//
-// Uso (desde la raíz del repo; secretos por STDIN, 2 líneas EXACTAS: contraseña y
-// AUTH_SERVER_KEY). --prod NO admite --mode preview ni --email; en preview, la línea
-// 1 es la contraseña de la cuenta indicada por --email (por defecto carlos@test.local):
-//   printf '%s\n%s\n' "$PASSWORD" "$AUTH_SERVER_KEY" | \
-//     node index.mjs --prod --confirm prod
-//   printf '%s\n%s\n' "$PASSWORD_DE_LA_CUENTA" "$AUTH_SERVER_KEY" | \
-//     node index.mjs --deployment <name> --mode preview --confirm <name> [--email <cuenta>]
-//
-// Códigos de salida: 0 ok · 2 preflight abortó (sin efecto) · 1 alguna prueba falló ·
-// 130/143 recuperación OK tras SIGINT/SIGTERM · 3 recuperación fallida (intervención).
-
-import { ConvexHttpClient } from "convex/browser";
-import { makeFunctionReference } from "convex/server";
-import { execFile } from "node:child_process";
-import { pathToFileURL } from "node:url";
-
-import {
-  makeRunner,
-  preflight,
-  runVetoSequence,
-  finalState,
-  safeRecover,
-  parseArgs,
-  resolveTarget,
-  AbortError,
-} from "./core.mjs";
-
-// --- Lectura de secretos por STDIN (2 líneas exactas) ------------------------
-async function readSecrets() {
-  const chunks = [];
-  for await (const c of process.stdin) chunks.push(c);
-  const raw = Buffer.concat(chunks).toString("utf8").replace(/\n$/, "");
-  const lines = raw.split("\n");
-  if (lines.length !== 2) {
-    throw new AbortError("STDIN debe tener EXACTAMENTE 2 líneas: contraseña y AUTH_SERVER_KEY");
-  }
-  const [password, serverKey] = lines;
-  if (!password || !serverKey) throw new AbortError("STDIN: la contraseña y AUTH_SERVER_KEY no pueden estar vacías");
-  return { password, serverKey };
-}
-
-// --- Saneo de secretos en toda salida ----------------------------------------
-export function makeSanitizer(secrets) {
-  const values = secrets.filter((s) => typeof s === "string" && s.length > 0);
-  return (str) => {
-    let out = String(str);
-    for (const v of values) out = out.split(v).join("***");
-    return out;
-  };
-}
-
-// --- Adaptador CLI (subproceso; sin secretos en argv) ------------------------
-function makeCli() {
-  return (args) =>
-    new Promise((resolve) => {
-      execFile(
-        "npx",
-        ["convex", ...args],
-        { timeout: 120000, maxBuffer: 16 * 1024 * 1024 },
-        (error, stdout, stderr) => {
-          const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
-          resolve({ code, stdout: stdout || "", stderr: stderr || "" });
-        },
-      );
-    });
-}
-
-// --- Adaptadores Convex por HTTP (secretos en el cuerpo, nunca argv) ----------
-function makeConvexAdapters(url) {
-  const client = new ConvexHttpClient(url, { logger: false }); // logger silenciado
-  const loginRef = makeFunctionReference("auth:loginWithPassword");
-  const logoutRef = makeFunctionReference("auth:logout");
-  return {
-    login: (body) => client.action(loginRef, body),
-    logout: ({ token }) => client.mutation(logoutRef, { token }),
-  };
-}
-
-async function main() {
-  // Cierre único con VACIADO de buffers: process.exit inmediato tras un write puede
-  // truncar la evidencia canalizada, así que salimos en el callback de escritura.
-  let exiting = false;
-  const guard = () => {
-    if (exiting) return false;
-    exiting = true;
-    return true;
-  };
-  const hardExit = (code) => {
-    if (guard()) process.exit(code);
-  };
-  const exitAfter = (stream, str, code) => {
-    if (guard()) stream.write(str, () => process.exit(code));
-  };
-
-  // sanitize arranca como identidad hasta conocer los secretos; se reemplaza en cuanto
-  // se leen. Los errores previos a esa lectura no contienen valores de secretos.
-  let sanitize = (s) => String(s);
-  const errText = (e) => sanitize(e && e.message ? e.message : String(e)) + "\n";
-
-  // --- Arranque FAIL-CLOSED (M8): parseo, secretos, resolución y preflight. Nada
-  // de esto muta el deployment; cualquier fallo aquí es un aborto seguro → código 2.
-  let target, deps, cfg, runner, initial;
-  try {
-    const opts = parseArgs(process.argv.slice(2));
-    const secrets = await readSecrets();
-    sanitize = makeSanitizer([secrets.password, secrets.serverKey]);
-    const cli = makeCli();
-    target = await resolveTarget(cli, opts);
-    const convex = makeConvexAdapters(target.url);
-    cfg = { email: opts.email, password: secrets.password, serverKey: secrets.serverKey, confirm: opts.confirm };
-    const log = (m) => process.stderr.write(sanitize(m) + "\n");
-    deps = { login: convex.login, logout: convex.logout, cli, log };
-    runner = makeRunner();
-    ({ initial } = await preflight(deps, target, cfg));
-  } catch (startErr) {
-    exitAfter(process.stderr, errText(startErr), 2); // sin efectos en el deployment
-    return;
-  }
-
-  // --- Handlers de señal: abortan, recuperan UNA vez y salen 130/143 (o 3 si falla).
-  const onSignal = (code) => async () => {
-    runner.abort();
-    try {
-      await runner.recoverOnce(() => safeRecover(deps, target, cfg));
-      hardExit(code); // 130 (SIGINT) / 143 (SIGTERM): recuperación OK
-    } catch (rerr) {
-      exitAfter(process.stderr, errText(rerr), 3); // recuperación fallida
-    }
-  };
-  const sigint = onSignal(130);
-  const sigterm = onSignal(143);
-  process.on("SIGINT", sigint);
-  process.on("SIGTERM", sigterm);
-  const disarm = () => {
-    process.removeListener("SIGINT", sigint);
-    process.removeListener("SIGTERM", sigterm);
-  };
-
-  try {
-    const report = await runVetoSequence(deps, target, cfg, runner);
-    await finalState(deps, target, target.mode, initial, runner);
-    if (runner.isAborted()) return; // una señal llegó durante finalState: su handler cierra.
-    disarm(); // retira handlers antes de la salida normal (evita recuperación tardía)
-    exitAfter(process.stdout, JSON.stringify({ ok: true, report }, null, 2) + "\n", 0);
-  } catch (err) {
-    if (runner.isAborted()) return; // el handler de señal es dueño del cierre.
-    try {
-      await runner.recoverOnce(() => safeRecover(deps, target, cfg));
-    } catch (rerr) {
-      disarm();
-      exitAfter(process.stderr, errText(rerr), 3);
-      return;
-    }
-    disarm();
-    // Prueba fallida (SequenceError) u otro error, ya con recuperación correcta → 1.
-    exitAfter(process.stderr, errText(err), 1);
-  }
-}
-
-// Solo ejecuta el flujo cuando se invoca directamente (no al importarlo desde los
-// tests, que solo necesitan `makeSanitizer`).
-const invokedDirectly =
-  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
-if (invokedDirectly) {
-  main().catch(() => {
-    // Red de seguridad: nunca dejar escapar un error sin sanear.
-    process.stderr.write("error no controlado\n");
-    process.exit(1);
-  });
-}
````

#### `scripts/login-verify/core.mjs` (borrado)

````diff
diff --git a/scripts/login-verify/core.mjs b/scripts/login-verify/core.mjs
deleted file mode 100644
index c9bdfd0..0000000
--- a/scripts/login-verify/core.mjs
+++ /dev/null
@@ -1,358 +0,0 @@
-// MIS-295 — Ejecutor seguro de verificación de login: NÚCLEO (lógica pura).
-//
-// Sin imports de Convex a propósito: toda la E/S entra por `deps` (adaptadores
-// inyectados), de modo que este módulo se testea al 100% con dobles falsos
-// (`core.test.mjs`) sin tocar red ni CLI. `index.mjs` cablea los adaptadores reales.
-//
-// Contrato de `deps`:
-//   login({ email, password, serverKey, ipHint? }) -> resultado de auth:loginWithPassword
-//   logout({ token })                              -> cierra la sesión (auth:logout)
-//   cli(argv: string[])                            -> { code, stdout, stderr }
-//   log(msg: string)                               -> traza de progreso (ya saneada)
-//
-// Contrato de `target`: { selectorArgs: string[], name: string, url?, mode: 'prod'|'preview' }
-// Contrato de `cfg`:    { email, password, serverKey, confirm }
-
-import { randomBytes } from "node:crypto";
-
-export const DEFAULT_EMAIL = "carlos@test.local";
-
-// Textos EXACTOS que devuelve convex/auth.ts:30-31. Clasificamos contra el valor
-// real (no "LOCKED"): un cambio de copy allí debe reflejarse aquí (test lo fija).
-export const LOCKED_ERROR = "Demasiados intentos, inténtalo de nuevo en unos minutos";
-export const GENERIC_ERROR = "Email o contraseña incorrectos";
-
-export class AbortError extends Error {} // preflight fail-closed: sin efectos
-export class RecoveryError extends Error {} // la recuperación no pudo garantizar off
-export class SequenceError extends Error {} // una aserción de prueba no se cumplió
-
-// Clasifica el retorno del login SIN exponer el token. `extractToken` (privada,
-// no exportada) es la ÚNICA vía que lee el token, y solo para alimentar logout.
-export function classifyLogin(result) {
-  if (result && result.success === true) return "success";
-  if (result && result.success === false) {
-    if (result.error === LOCKED_ERROR) return "locked";
-    if (result.error === GENERIC_ERROR) return "generic";
-  }
-  return "other";
-}
-function extractToken(result) {
-  return result && result.success === true ? result.token : null;
-}
-
-// --- Máquina de ejecución y recuperación (M3) --------------------------------
-// runStep serializa las transiciones ORDINARIAS y las rechaza cuando aborted.
-// recoverOnce es la vía EXCLUSIVA de recuperación: se puede ejecutar tras aborted,
-// memoiza una única recoveryPromise, y espera a la transición en vuelo antes de
-// recuperar (así el `set` en vuelo termina antes del `set off` → off gana).
-export function makeRunner() {
-  const state = { aborted: false, inFlight: null, recoveryPromise: null };
-
-  async function runStep(fn) {
-    if (state.aborted) throw new AbortError("abortado: no se inician nuevas transiciones");
-    // Invariante de serialización (sugerencia Baja): nunca dos transiciones a la vez.
-    if (state.inFlight) throw new Error("invariante: ya hay una transición en vuelo");
-    const p = Promise.resolve().then(fn);
-    state.inFlight = p;
-    try {
-      return await p;
-    } finally {
-      state.inFlight = null;
-    }
-  }
-
-  function abort() {
-    state.aborted = true;
-  }
-
-  // recoverFn NO pasa por runStep (vía privilegiada): puede correr tras aborted.
-  function recoverOnce(recoverFn) {
-    if (!state.recoveryPromise) {
-      state.recoveryPromise = (async () => {
-        if (state.inFlight) {
-          try {
-            await state.inFlight;
-          } catch {
-            // La transición en vuelo pudo fallar; da igual: solo necesitamos que
-            // haya TERMINADO para que la recuperación escriba después.
-          }
-        }
-        return recoverFn();
-      })();
-    }
-    return state.recoveryPromise;
-  }
-
-  return {
-    runStep,
-    abort,
-    recoverOnce,
-    isAborted: () => state.aborted,
-    hasInFlight: () => state.inFlight !== null,
-  };
-}
-
-// --- Adaptadores CLI de alto nivel -------------------------------------------
-function envArgs(target, rest) {
-  return ["env", ...rest, ...target.selectorArgs];
-}
-async function setVeto(deps, target, value) {
-  const r = await deps.cli(envArgs(target, ["set", "LOGIN_EMAIL_VETO", value]));
-  if (r.code !== 0) throw new Error("env set LOGIN_EMAIL_VETO falló");
-  return r;
-}
-async function removeVeto(deps, target) {
-  const r = await deps.cli(envArgs(target, ["remove", "LOGIN_EMAIL_VETO"]));
-  if (r.code !== 0) throw new Error("env remove LOGIN_EMAIL_VETO falló");
-  return r;
-}
-
-// Lectura FOCALIZADA (M5): primero solo NOMBRES (--names-only), y únicamente si
-// LOGIN_EMAIL_VETO está presente pedimos su valor. Jamás capturamos el valor de
-// otras variables del deployment. exit≠0 → indeterminado.
-export async function readVetoState(deps, target) {
-  const names = await deps.cli(envArgs(target, ["list", "--names-only"]));
-  if (names.code !== 0) return { indeterminate: true };
-  const present = names.stdout
-    .split("\n")
-    .map((s) => s.trim())
-    .includes("LOGIN_EMAIL_VETO");
-  if (!present) return { present: false, value: null }; // ausente ⇒ activo por defecto
-  const got = await deps.cli(envArgs(target, ["get", "LOGIN_EMAIL_VETO"]));
-  if (got.code !== 0) return { indeterminate: true };
-  return { present: true, value: got.stdout.trim() };
-}
-
-// El veto está ACTIVO si la variable está ausente, o su valor no es "off".
-export function vetoActive(state) {
-  if (state.indeterminate) return null;
-  if (!state.present) return true;
-  return state.value !== "off";
-}
-
-async function checkGate(deps, target) {
-  const r = await deps.cli(["run", "auth:accountsPendingRotation", ...target.selectorArgs]);
-  if (r.code !== 0) throw new AbortError("gate indeterminado (CLI falló)");
-  let parsed;
-  try {
-    parsed = JSON.parse(r.stdout);
-  } catch {
-    throw new AbortError("gate no es JSON válido");
-  }
-  if (!Array.isArray(parsed) || parsed.length !== 0) {
-    throw new AbortError("gate no vacío: hay cuentas pendientes de rotación");
-  }
-}
-
-async function baselineLogin(deps, cfg) {
-  const r = await deps.login({ email: cfg.email, password: cfg.password, serverKey: cfg.serverKey });
-  const token = extractToken(r);
-  return { klass: classifyLogin(r), token };
-}
-
-// Cierra una sesión creada por un login correcto, sin exponer el token. Best-effort:
-// un fallo de logout no invalida la prueba (la sesión caducará), pero se intenta.
-async function closeSession(deps, token) {
-  if (!token) return;
-  try {
-    await deps.logout({ token });
-  } catch {
-    // no-op: sesión huérfana tolerada; nunca imprimimos el token.
-  }
-}
-
-// --- Preflight fail-closed (B1/M1/M2) ----------------------------------------
-// SIN efectos de configuración. Aborta (AbortError) ante cualquier fallo o estado
-// indeterminado ANTES de que se arme la recuperación o se toque el veto.
-export async function preflight(deps, target, cfg) {
-  // (2) Confirmación de prod ligada al deployment resuelto.
-  if (target.requireConfirm && cfg.confirm !== target.confirmToken) {
-    throw new AbortError(
-      `confirmación requerida: pasa --confirm ${target.confirmToken} para operar sobre este deployment`,
-    );
-  }
-  // (3) Gate.
-  await checkGate(deps, target);
-  // (4) Estado inicial: el veto DEBE estar activo (la prueba "ANTES" lo exige).
-  const initial = await readVetoState(deps, target);
-  const active = vetoActive(initial);
-  if (active === null) throw new AbortError("estado del veto indeterminado");
-  if (!active) throw new AbortError("el veto ya está en off: no se puede ejecutar la prueba ANTES");
-  // (5) Login base correcto: prueba credenciales, canal HTTP y el login de limpieza
-  // que la recuperación necesita. Cierra la sesión que crea.
-  const base = await baselineLogin(deps, cfg);
-  if (base.klass !== "success") {
-    throw new AbortError("el login base no tuvo éxito: credenciales o canal inválidos");
-  }
-  await closeSession(deps, base.token);
-  return { initial };
-}
-
-// Genera una contraseña incorrecta aleatoria, garantizada distinta de la correcta.
-function wrongPassword(correct) {
-  let candidate;
-  do {
-    candidate = "x!" + randomBytes(12).toString("base64url");
-  } while (candidate === correct);
-  return candidate;
-}
-
-async function loginCorrect(deps, cfg) {
-  return await deps.login({ email: cfg.email, password: cfg.password, serverKey: cfg.serverKey });
-}
-async function loginWrong(deps, cfg) {
-  return await deps.login({ email: cfg.email, password: wrongPassword(cfg.password), serverKey: cfg.serverKey });
-}
-
-// Genera el bloqueo por email: 5 fallos consecutivos (sin ipHint → aísla la clave
-// de email de la cuota por IP). Cada intento es una transición ordinaria.
-async function generateLock(deps, cfg, runner) {
-  for (let i = 0; i < 5; i++) {
-    await runner.runStep(() => loginWrong(deps, cfg));
-  }
-}
-
-function expect(cond, msg) {
-  if (!cond) throw new SequenceError(msg);
-}
-
-// --- Secuencia de verificación (pruebas 11-12) -------------------------------
-export async function runVetoSequence(deps, target, cfg, runner) {
-  const report = [];
-  const record = (paso, esperado, obtenido) => {
-    const ok = esperado === obtenido;
-    report.push({ paso, esperado, obtenido, ok });
-    return ok;
-  };
-
-  // Paso 1 — ANTES (veto on): 5 fallos + correcto → locked.
-  await generateLock(deps, cfg, runner);
-  const r1 = await runner.runStep(() => loginCorrect(deps, cfg));
-  expect(record("11-ANTES", "locked", classifyLogin(r1)), "prueba 11 ANTES: se esperaba locked");
-
-  // Paso 2 — retirar el veto.
-  await runner.runStep(() => setVeto(deps, target, "off"));
-  expect(vetoActive(await readVetoState(deps, target)) === false, "paso 2: el veto no quedó off");
-
-  // Paso 3 — DESPUÉS (veto off): correcto → success (y cierra su sesión).
-  const r3 = await runner.runStep(() => loginCorrect(deps, cfg));
-  expect(record("11-DESPUES", "success", classifyLogin(r3)), "prueba 11 DESPUES: se esperaba success");
-  await closeSession(deps, extractToken(r3));
-
-  // Paso 4 — rollback: reactivar + REGENERAR bloqueo + correcto → locked.
-  await runner.runStep(() => setVeto(deps, target, "activo"));
-  expect(vetoActive(await readVetoState(deps, target)) === true, "paso 4: el veto no volvió a activo");
-  await generateLock(deps, cfg, runner);
-  const r4 = await runner.runStep(() => loginCorrect(deps, cfg));
-  expect(record("12-ROLLBACK", "locked", classifyLogin(r4)), "prueba 12 ROLLBACK: se esperaba locked");
-
-  // Paso 5 — estado final off + correcto → success (limpia contadores).
-  await runner.runStep(() => setVeto(deps, target, "off"));
-  expect(vetoActive(await readVetoState(deps, target)) === false, "paso 5: el veto no quedó off");
-  const r5 = await runner.runStep(() => loginCorrect(deps, cfg));
-  expect(record("FINAL", "success", classifyLogin(r5)), "paso 5: login final sin éxito");
-  await closeSession(deps, extractToken(r5));
-
-  return report;
-}
-
-// Estado final por modo (M4). prod/MIS-291: dejar off (la secuencia ya terminó en
-// off). preview desechable: restaurar EXACTAMENTE el estado inicial capturado.
-// La escritura pasa por runner.runStep para quedar registrada en inFlight (M3): así
-// una señal durante la restauración hace que la recuperación la espere y off gane.
-export async function finalState(deps, target, mode, initial, runner) {
-  if (mode !== "preview") return; // prod: off es el estado deseado; no-op.
-  const op = !initial.present
-    ? () => removeVeto(deps, target) // estaba ausente ⇒ quitar la variable
-    : () => setVeto(deps, target, initial.value); // reponer el valor explícito
-  await runner.runStep(op);
-}
-
-// Recuperación segura: deja off, lo VERIFICA, hace un login de limpieza y cierra
-// su sesión. Si algo no cuadra → RecoveryError (no enmascara). Vía privilegiada:
-// se invoca desde recoverOnce, no desde runStep.
-export async function safeRecover(deps, target, cfg) {
-  await setVeto(deps, target, "off");
-  const st = await readVetoState(deps, target);
-  if (vetoActive(st) !== false) throw new RecoveryError("el veto no quedó en off tras recuperar");
-  const base = await baselineLogin(deps, cfg);
-  if (base.klass !== "success") throw new RecoveryError("el login de limpieza falló al recuperar");
-  await closeSession(deps, base.token);
-}
-
-// --- Parseo de argumentos y resolución de destino (autoridad única, B1) ------
-// parseArgs es puro; resolveTarget solo usa el adaptador `cli` inyectado. Ambos
-// viven aquí (no en index) para poder testear B1 sin ejecutar el entrypoint.
-export function parseArgs(argv) {
-  const opts = { selector: null, name: null, confirm: null, mode: null, email: null };
-  const seen = new Set();
-  const once = (flag) => {
-    if (seen.has(flag)) throw new AbortError(`opción duplicada: ${flag}`);
-    seen.add(flag);
-  };
-  for (let i = 0; i < argv.length; i++) {
-    const a = argv[i];
-    if (a === "--prod" || a === "--deployment") {
-      if (opts.selector) throw new AbortError("selector de destino duplicado: usa solo uno de --prod/--deployment");
-    }
-    if (a === "--prod") {
-      opts.selector = ["--prod"];
-      opts.name = "prod";
-    } else if (a === "--deployment") {
-      const name = argv[++i];
-      if (!name) throw new AbortError("--deployment requiere un nombre");
-      opts.selector = ["--deployment", name];
-      opts.name = name;
-    } else if (a === "--confirm") {
-      once("--confirm");
-      opts.confirm = argv[++i] ?? null;
-    } else if (a === "--mode") {
-      once("--mode");
-      opts.mode = argv[++i] ?? null;
-    } else if (a === "--email") {
-      once("--email");
-      opts.email = argv[++i] ?? null;
-    } else {
-      throw new AbortError(`argumento no reconocido: ${a}`);
-    }
-  }
-  if (!opts.selector) throw new AbortError("falta el destino: usa --prod o --deployment <name>");
-  const mode = opts.mode ?? "prod";
-  if (mode !== "prod" && mode !== "preview") throw new AbortError("--mode debe ser 'prod' o 'preview'");
-  // M7: --prod es SIEMPRE producción; preview exige un deployment nombrado y desechable.
-  if (opts.selector[0] === "--prod" && mode === "preview") {
-    throw new AbortError("--prod no admite --mode preview: usa --deployment <name> para preview");
-  }
-  // M7: el override de --email solo se permite en preview desechable; en prod se fija
-  // la cuenta de test para no poder dirigir la operación contra una cuenta arbitraria.
-  if (opts.email !== null && mode !== "preview") {
-    throw new AbortError("--email solo se permite con --mode preview");
-  }
-  return {
-    selector: opts.selector,
-    name: opts.name,
-    confirm: opts.confirm,
-    mode,
-    email: opts.email ?? DEFAULT_EMAIL,
-  };
-}
-
-// La URL HTTP se obtiene con el MISMO selector que usa el CLI (CONVEX_CLOUD_URL del
-// propio deployment): imposible que HTTP y CLI apunten a destinos distintos. El
-// nombre para --confirm sale del selector, nunca de parsear la URL.
-export async function resolveTarget(cli, opts) {
-  const r = await cli(["env", "get", "CONVEX_CLOUD_URL", ...opts.selector]);
-  if (r.code !== 0 || !r.stdout.trim()) {
-    throw new AbortError("no se pudo resolver la URL del deployment (CONVEX_CLOUD_URL)");
-  }
-  return {
-    selectorArgs: opts.selector,
-    name: opts.name,
-    url: r.stdout.trim(),
-    mode: opts.mode,
-    // M7: confirmación SIEMPRE obligatoria (prod y preview), ligada al nombre del
-    // selector. El nombre sale del selector, nunca de parsear la URL.
-    requireConfirm: true,
-    confirmToken: opts.name,
-  };
-}
````

#### `scripts/login-verify/core.test.mjs` (borrado)

````diff
diff --git a/scripts/login-verify/core.test.mjs b/scripts/login-verify/core.test.mjs
deleted file mode 100644
index d79de07..0000000
--- a/scripts/login-verify/core.test.mjs
+++ /dev/null
@@ -1,437 +0,0 @@
-// MIS-295 — Tests unitarios del ejecutor seguro (node:test + node:assert).
-// Ejecutar: node --test  (desde este directorio o vía "npm run test:unit").
-//
-// Todo con adaptadores FALSOS: no toca red ni CLI reales. Cada test fija una de
-// las invariantes exigidas por la auditoría del plan (B1, M1-M6, sin secretos).
-
-import { test } from "node:test";
-import assert from "node:assert/strict";
-import { execFile } from "node:child_process";
-import { fileURLToPath } from "node:url";
-import path from "node:path";
-
-import {
-  LOCKED_ERROR,
-  GENERIC_ERROR,
-  classifyLogin,
-  makeRunner,
-  readVetoState,
-  vetoActive,
-  preflight,
-  runVetoSequence,
-  finalState,
-  safeRecover,
-  parseArgs,
-  resolveTarget,
-  AbortError,
-  RecoveryError,
-  SequenceError,
-} from "./core.mjs";
-import { makeSanitizer } from "./index.mjs";
-
-// --- Deployment falso (modela veto por email + rate-limit de forma suficiente) --
-function makeFake(o = {}) {
-  const correct = o.correct ?? "CORRECT-PW";
-  const serverKey = o.serverKey ?? "SRV-KEY";
-  const token = o.token ?? "TOKEN-SENTINEL-xyz";
-  const url = o.url ?? "https://fake-dep.eu-west-1.convex.cloud";
-  const st = {
-    veto: o.veto, // undefined (ausente) | "off" | "activo" | ...
-    gate: o.gate === undefined ? "[]" : o.gate, // string JSON, o null para forzar fallo de CLI
-    listFails: o.listFails ?? false,
-    emailLocked: false,
-    wrongStreak: 0,
-    otherSecretRequested: false,
-    setCalls: [],
-    removed: false,
-    logins: [],
-    logouts: [],
-    cliCalls: [],
-  };
-  const active = () => st.veto === undefined || st.veto !== "off";
-  const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
-  const fail = () => ({ code: 1, stdout: "", stderr: "boom" });
-
-  const cli = async (args) => {
-    st.cliCalls.push(args.join(" "));
-    const [cmd, sub, name, value] = args;
-    if (cmd === "run") return st.gate === null ? fail() : ok(st.gate);
-    if (cmd === "env" && sub === "get" && name === "CONVEX_CLOUD_URL") return ok(url);
-    if (cmd === "env" && sub === "get" && name === "LOGIN_EMAIL_VETO") {
-      return st.veto === undefined ? fail() : ok(st.veto);
-    }
-    if (cmd === "env" && sub === "get" && name === "OTRA_CLAVE") {
-      st.otherSecretRequested = true; // el ejecutor NUNCA debería llegar aquí
-      return ok("secreto-ajeno-que-no-debe-leerse");
-    }
-    if (cmd === "env" && sub === "list") {
-      if (st.listFails) return fail();
-      const names = ["AUTH_SERVER_KEY", "OTRA_CLAVE"];
-      if (st.veto !== undefined) names.push("LOGIN_EMAIL_VETO");
-      return ok(names.join("\n") + "\n");
-    }
-    if (cmd === "env" && sub === "set" && name === "LOGIN_EMAIL_VETO") {
-      st.veto = value;
-      st.setCalls.push(value);
-      return ok();
-    }
-    if (cmd === "env" && sub === "remove" && name === "LOGIN_EMAIL_VETO") {
-      st.veto = undefined;
-      st.removed = true;
-      return ok();
-    }
-    return ok();
-  };
-
-  const login = async ({ password, serverKey: sk }) => {
-    st.logins.push(password === correct ? "CORRECT" : "WRONG");
-    if (sk !== serverKey) return { success: false, error: GENERIC_ERROR };
-    if (active() && st.emailLocked) return { success: false, error: LOCKED_ERROR };
-    if (password !== correct) {
-      if (active()) {
-        st.wrongStreak++;
-        if (st.wrongStreak >= 5) st.emailLocked = true;
-      }
-      return { success: false, error: GENERIC_ERROR };
-    }
-    st.wrongStreak = 0;
-    st.emailLocked = false;
-    return { success: true, token, role: "rep" };
-  };
-  const logout = async ({ token: t }) => {
-    st.logouts.push(t);
-  };
-
-  const deps = { login, logout, cli, log: () => {} };
-  const cfg = { email: "carlos@test.local", password: correct, serverKey, confirm: "prod" };
-  const target = {
-    selectorArgs: ["--prod"],
-    name: "prod",
-    url,
-    mode: "prod",
-    requireConfirm: true,
-    confirmToken: "prod",
-  };
-  return { st, deps, cfg, target, token };
-}
-
-async function runFullOk(f) {
-  const { initial } = await preflight(f.deps, f.target, f.cfg);
-  const runner = makeRunner();
-  const report = await runVetoSequence(f.deps, f.target, f.cfg, runner);
-  await finalState(f.deps, f.target, "prod", initial, runner);
-  return report;
-}
-
-const INDEX_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "index.mjs");
-function runCli(args, stdin) {
-  return new Promise((resolve) => {
-    const child = execFile(process.execPath, [INDEX_PATH, ...args], () => {});
-    child.on("close", (code) => resolve(code));
-    if (stdin !== undefined) child.stdin.write(stdin);
-    child.stdin.end();
-  });
-}
-
-// --- classifyLogin -----------------------------------------------------------
-test("classifyLogin usa los textos reales y no expone el token", () => {
-  assert.equal(classifyLogin({ success: true, token: "T", role: "rep" }), "success");
-  assert.equal(classifyLogin({ success: false, error: LOCKED_ERROR }), "locked");
-  assert.equal(classifyLogin({ success: false, error: GENERIC_ERROR }), "generic");
-  assert.equal(classifyLogin({ success: false, error: "otra cosa" }), "other");
-  assert.ok(!classifyLogin({ success: true, token: "T" }).includes("T"));
-});
-
-// --- readVetoState (M5: lectura focalizada) ----------------------------------
-test("readVetoState distingue ausente/off/valor/indeterminado", async () => {
-  assert.deepEqual(await readVetoState(makeFake({ veto: undefined }).deps, makeFake().target), {
-    present: false,
-    value: null,
-  });
-  const off = makeFake({ veto: "off" });
-  assert.equal((await readVetoState(off.deps, off.target)).value, "off");
-  const act = makeFake({ veto: "activo" });
-  assert.equal((await readVetoState(act.deps, act.target)).value, "activo");
-  const bad = makeFake({ veto: "activo", listFails: true });
-  assert.equal((await readVetoState(bad.deps, bad.target)).indeterminate, true);
-});
-
-test("M5: usa --names-only y nunca solicita el valor de una variable ajena", async () => {
-  const f = makeFake({ veto: "activo" });
-  await runFullOk(f);
-  assert.equal(f.st.otherSecretRequested, false);
-  assert.ok(!f.st.cliCalls.some((c) => c.includes("get OTRA_CLAVE")));
-  // La presencia se detecta con --names-only, no listando valores.
-  assert.ok(f.st.cliCalls.some((c) => c.includes("env list --names-only")));
-});
-
-// --- preflight fail-closed (B1/M1/M2) ----------------------------------------
-test("preflight OK: sin efectos de config y cierra la sesión base (M6)", async () => {
-  const f = makeFake({ veto: "activo" });
-  const { initial } = await preflight(f.deps, f.target, f.cfg);
-  assert.equal(initial.present, true);
-  assert.equal(initial.value, "activo");
-  assert.deepEqual(f.st.setCalls, []);
-  assert.equal(f.st.logouts.length, 1);
-  assert.equal(f.st.logouts[0], f.token);
-});
-
-test("preflight aborta si el gate no está vacío y NO toca env", async () => {
-  const f = makeFake({ veto: "activo", gate: '[{"id":"u1","email":"a@b.c"}]' });
-  await assert.rejects(() => preflight(f.deps, f.target, f.cfg), AbortError);
-  assert.deepEqual(f.st.setCalls, []);
-});
-
-test("preflight aborta ante gate con JSON malformado o CLI fallida", async () => {
-  const bad = makeFake({ veto: "activo", gate: "no-es-json" });
-  await assert.rejects(() => preflight(bad.deps, bad.target, bad.cfg), AbortError);
-  const err = makeFake({ veto: "activo", gate: null });
-  await assert.rejects(() => preflight(err.deps, err.target, err.cfg), AbortError);
-});
-
-test("M1: preflight aborta si el veto ya está en off", async () => {
-  const f = makeFake({ veto: "off" });
-  await assert.rejects(() => preflight(f.deps, f.target, f.cfg), AbortError);
-  assert.deepEqual(f.st.setCalls, []);
-});
-
-test("M2: login base fallido aborta sin crear bloqueo", async () => {
-  const f = makeFake({ veto: "activo" });
-  f.cfg.serverKey = "SERVERKEY-INCORRECTO";
-  await assert.rejects(() => preflight(f.deps, f.target, f.cfg), AbortError);
-  assert.equal(f.st.emailLocked, false);
-  assert.deepEqual(f.st.setCalls, []);
-});
-
-test("preflight aborta si falta la confirmación de prod", async () => {
-  const f = makeFake({ veto: "activo" });
-  f.cfg.confirm = "otra-cosa";
-  await assert.rejects(() => preflight(f.deps, f.target, f.cfg), AbortError);
-});
-
-// --- Secuencia 11-12 ---------------------------------------------------------
-test("secuencia completa: todas las aserciones OK y veto final off", async () => {
-  const f = makeFake({ veto: "activo" });
-  const { initial } = await preflight(f.deps, f.target, f.cfg);
-  const runner = makeRunner();
-  const report = await runVetoSequence(f.deps, f.target, f.cfg, runner);
-  assert.ok(report.every((r) => r.ok), JSON.stringify(report));
-  assert.equal(vetoActive(await readVetoState(f.deps, f.target)), false);
-  await finalState(f.deps, f.target, "prod", initial, runner);
-  assert.equal(f.st.veto, "off");
-});
-
-test("M6: cierra todas las sesiones y la evidencia no contiene el token", async () => {
-  const f = makeFake({ veto: "activo" });
-  const report = await runFullOk(f);
-  assert.equal(f.st.logouts.length, 3); // base + paso 3 + paso 5
-  for (const t of f.st.logouts) assert.equal(t, f.token);
-  assert.ok(!JSON.stringify(report).includes(f.token));
-});
-
-test("una aserción incumplida lanza SequenceError", async () => {
-  const f = makeFake({ veto: "activo" });
-  const alwaysOk = { ...f.deps, login: async () => ({ success: true, token: "T", role: "rep" }) };
-  await assert.rejects(
-    () => runVetoSequence(alwaysOk, f.target, f.cfg, makeRunner()),
-    SequenceError,
-  );
-});
-
-// --- Máquina de ejecución / recuperación (M3) --------------------------------
-test("runStep rechaza nuevas transiciones tras abort", async () => {
-  const runner = makeRunner();
-  runner.abort();
-  await assert.rejects(() => runner.runStep(async () => {}), AbortError);
-});
-
-test("runStep no permite dos transiciones simultáneas", async () => {
-  const runner = makeRunner();
-  let release;
-  const gate = new Promise((r) => (release = r));
-  const p1 = runner.runStep(async () => {
-    await gate;
-  });
-  await assert.rejects(() => runner.runStep(async () => {}), /transición en vuelo/);
-  release();
-  await p1;
-});
-
-test("M3: recoverOnce espera la transición en vuelo y off gana; recuperación única", async () => {
-  const order = [];
-  let release;
-  const inFlightGate = new Promise((r) => (release = r));
-  const runner = makeRunner();
-
-  // Transición ordinaria en vuelo (p. ej. `env set activo`), aún sin terminar.
-  const p = runner.runStep(async () => {
-    await inFlightGate;
-    order.push("set:activo");
-  });
-
-  // Llega la señal: abort + recuperación.
-  runner.abort();
-  let recoveries = 0;
-  const rec = runner.recoverOnce(async () => {
-    recoveries++;
-    order.push("recover:off");
-  });
-  // Una segunda señal durante la recuperación devuelve la MISMA promesa.
-  const rec2 = runner.recoverOnce(async () => {
-    recoveries++;
-    order.push("NO-DEBE-EJECUTARSE");
-  });
-  assert.equal(rec, rec2);
-
-  // Solo ahora termina la transición en vuelo.
-  release();
-  await p;
-  await rec;
-
-  assert.deepEqual(order, ["set:activo", "recover:off"]); // off DESPUÉS del set en vuelo
-  assert.equal(recoveries, 1);
-});
-
-// --- safeRecover -------------------------------------------------------------
-test("safeRecover deja off, lo verifica y cierra su sesión", async () => {
-  const f = makeFake({ veto: "activo" });
-  await safeRecover(f.deps, f.target, f.cfg);
-  assert.equal(f.st.veto, "off");
-  assert.ok(f.st.logouts.length >= 1);
-});
-
-test("safeRecover lanza RecoveryError si el veto no queda en off", async () => {
-  const f = makeFake({ veto: "activo" });
-  const broken = {
-    ...f.deps,
-    cli: async (args) => {
-      if (args[0] === "env" && args[1] === "set") return { code: 0, stdout: "", stderr: "" }; // finge OK sin cambiar
-      return f.deps.cli(args);
-    },
-  };
-  await assert.rejects(() => safeRecover(broken, f.target, f.cfg), RecoveryError);
-});
-
-// --- finalState por modo (M4) ------------------------------------------------
-test("M4: preview con veto inicialmente ausente → env remove", async () => {
-  const f = makeFake({ veto: "off" }); // la secuencia lo dejó en off
-  await finalState(f.deps, f.target, "preview", { present: false, value: null }, makeRunner());
-  assert.equal(f.st.removed, true);
-  assert.equal(f.st.veto, undefined);
-});
-
-test("M4: preview con valor explícito → lo repone", async () => {
-  const f = makeFake({ veto: "off" });
-  await finalState(f.deps, f.target, "preview", { present: true, value: "activo" }, makeRunner());
-  assert.equal(f.st.veto, "activo");
-});
-
-test("M4: prod → finalState no toca nada (deja off)", async () => {
-  const f = makeFake({ veto: "off" });
-  await finalState(f.deps, f.target, "prod", { present: true, value: "activo" }, makeRunner());
-  assert.equal(f.st.veto, "off");
-  assert.equal(f.st.setCalls.length, 0);
-});
-
-test("M3: finalState pasa por runStep; una señal durante la restauración → off gana", async () => {
-  const f = makeFake({ veto: "off" });
-  const order = [];
-  let release;
-  const gate = new Promise((r) => (release = r));
-  // cli que retrasa la escritura de finalState (set/remove) para forzar la carrera.
-  const slow = {
-    ...f.deps,
-    cli: async (args) => {
-      if (args[0] === "env" && (args[1] === "set" || args[1] === "remove")) {
-        await gate;
-        order.push("finalState-write");
-      }
-      return f.deps.cli(args);
-    },
-  };
-  const runner = makeRunner();
-  const fp = finalState(slow, f.target, "preview", { present: true, value: "activo" }, runner);
-  // Señal a mitad de la escritura de finalState: si NO estuviera en runStep, la
-  // recuperación no la esperaría y el orden se invertiría.
-  runner.abort();
-  const rec = runner.recoverOnce(async () => order.push("recover-off"));
-  release();
-  await fp;
-  await rec;
-  assert.deepEqual(order, ["finalState-write", "recover-off"]);
-});
-
-// --- Autoridad única de deployment (B1) --------------------------------------
-test("parseArgs: --prod y --deployment", () => {
-  const a = parseArgs(["--prod", "--confirm", "prod"]);
-  assert.deepEqual(a.selector, ["--prod"]);
-  assert.equal(a.name, "prod");
-  const b = parseArgs(["--deployment", "greedy-tapir-20", "--mode", "preview"]);
-  assert.deepEqual(b.selector, ["--deployment", "greedy-tapir-20"]);
-  assert.equal(b.name, "greedy-tapir-20");
-  assert.equal(b.mode, "preview");
-  assert.throws(() => parseArgs([]), AbortError);
-});
-
-test("M7: matriz selector/modo/email/duplicados", () => {
-  assert.throws(() => parseArgs(["--prod", "--mode", "preview"]), AbortError); // --prod no admite preview
-  assert.throws(() => parseArgs(["--prod", "--email", "x@y.z"]), AbortError); // --email solo en preview
-  assert.throws(() => parseArgs(["--deployment", "d", "--email", "x@y.z"]), AbortError); // modo prod por defecto
-  const ok = parseArgs(["--deployment", "prev-1", "--mode", "preview", "--email", "x@y.z"]);
-  assert.equal(ok.email, "x@y.z"); // --email permitido en preview con --deployment
-  assert.equal(parseArgs(["--prod"]).email, "carlos@test.local"); // email fijado en prod
-  assert.throws(() => parseArgs(["--prod", "--deployment", "d"]), AbortError); // selector duplicado
-  assert.throws(() => parseArgs(["--prod", "--confirm", "a", "--confirm", "b"]), AbortError); // opción duplicada
-});
-
-test("B1: resolveTarget deriva la URL del MISMO selector, sin URL suelta", async () => {
-  const calls = [];
-  const cli = async (args) => {
-    calls.push(args);
-    return { code: 0, stdout: "https://greedy-tapir-20.eu-west-1.convex.cloud\n", stderr: "" };
-  };
-  const t = await resolveTarget(cli, {
-    selector: ["--deployment", "greedy-tapir-20"],
-    name: "greedy-tapir-20",
-    mode: "prod",
-  });
-  assert.equal(t.url, "https://greedy-tapir-20.eu-west-1.convex.cloud");
-  assert.deepEqual(t.selectorArgs, ["--deployment", "greedy-tapir-20"]);
-  assert.deepEqual(calls[0], ["env", "get", "CONVEX_CLOUD_URL", "--deployment", "greedy-tapir-20"]);
-  // No hay parámetro para inyectar una URL ajena: la firma es (cli, opts).
-  assert.equal(resolveTarget.length, 2);
-  // M7: confirmación SIEMPRE obligatoria, ligada al nombre del selector.
-  assert.equal(t.requireConfirm, true);
-  assert.equal(t.confirmToken, "greedy-tapir-20");
-});
-
-test("resolveTarget aborta (arranque → código 2) si no resuelve la URL", async () => {
-  const cli = async () => ({ code: 1, stdout: "", stderr: "no such deployment" });
-  await assert.rejects(
-    () => resolveTarget(cli, { selector: ["--deployment", "inexistente"], name: "inexistente", mode: "prod" }),
-    AbortError,
-  );
-});
-
-// --- Saneo de secretos -------------------------------------------------------
-test("makeSanitizer redacta contraseña, serverKey y token en cualquier salida", () => {
-  const s = makeSanitizer(["P@ss-w0rd", "SRV-KEY-123", "TOKEN-SENTINEL-xyz"]);
-  const out = s("error: usó P@ss-w0rd con SRV-KEY-123 y TOKEN-SENTINEL-xyz al llamar");
-  assert.ok(!out.includes("P@ss-w0rd"));
-  assert.ok(!out.includes("SRV-KEY-123"));
-  assert.ok(!out.includes("TOKEN-SENTINEL-xyz"));
-  assert.ok(out.includes("***"));
-});
-
-// --- Códigos de salida del arranque fail-closed (M8), vía subproceso real ------
-test("M8: argumentos inválidos → código 2 (sin efectos)", async () => {
-  assert.equal(await runCli(["--bogus"]), 2);
-});
-
-test("M8: --prod --mode preview → código 2", async () => {
-  assert.equal(await runCli(["--prod", "--mode", "preview", "--confirm", "prod"]), 2);
-});
-
-test("M8: stdin inválido (una sola línea) → código 2", async () => {
-  assert.equal(await runCli(["--prod", "--confirm", "prod"], "una-sola-linea\n"), 2);
-});
````

---

## B4 · Secuencia de despliegue y rollback (operación, tras el merge)

**Orden obligatorio (código primero, variable después):** mientras el código viejo siga vivo en el
deployment, `emailVetoActive()` es fail-safe (ausente/≠"off" ⇒ activo). Quitar la variable **antes**
de desplegar el código nuevo **reactivaría el veto**. Por eso:

**La retirada + verificación se ejecuta como bloque FAIL-CLOSED (ronda 2, sugerencia Media):** un
fallo de `env list`, `env remove` o de la verificación final **detiene** la operación y **señala qué
deployment quedó pendiente** (para completarlo/rollbackearlo a mano); no se continúa con el siguiente
deployment ni se da por buena la retirada.

1. **Desplegar el código nuevo** a Convex prod `greedy-tapir-20` con el runbook §1 (deploy-token
   seguro). Confirmación del usuario **antes**. Sin cambios de schema ni índices.
2. **Solo después**, retirar la variable (ya inerte). Para evitar cualquier ambigüedad sobre si
   `env remove` de una variable ausente es un no-op del CLI, **se comprueba presencia primero** por
   nombres y se quita solo si aparece; si `env list` o `env remove` falla → **PARAR** e indicar el
   deployment:
   - prod: si `LOGIN_EMAIL_VETO` está en `npx convex env list --names-only --prod` →
     `npx convex env remove LOGIN_EMAIL_VETO --prod`.
   - dev: idem con `--deployment dutiful-mole-111`.
3. **Verificar ausencia final** (sin leer ningún valor): `npx convex env list --names-only` en prod y
   en dev **no** debe contener `LOGIN_EMAIL_VETO`. Si la verificación falla o la CLI da error → PARAR
   e indicar el deployment pendiente.
4. **Smoke** (runbook §5): login fallido → `GENERIC_ERROR` (prueba que el login sigue sano tras
   retirar el veto). **No** se agota la cuota por IP en prod: no hay harness de test en producción
   (`E2E_TEST_SUPPORT_KEY` ausente por diseño) para limpiar `ip:<sintética>`, así que un bloqueo por
   IP quedaría 15 min; la no-regresión de la capa por IP la cubre el **e2e en CI** contra dev (prueba
   8 + la prueba del reseed reescrita). Sin imprimir secretos; sonda borrada al final. (Si en dev se
   ejercitara deliberadamente la IP sintética, ejecutar después `resetTestIdentity`/limpieza para no
   dejar `ip:TEST_LOGIN_IP` bloqueada.)

**Rollback** (si el deploy nuevo resultara defectuoso): **primero** reponer el interruptor a `off`
**mientras aún está activo el código nuevo, antes de desplegar el viejo** —
`npx convex env set LOGIN_EMAIL_VETO off --prod` — y **luego** revertir el deploy al commit anterior
(`bcbd30c`). Reponer la variable *antes* de revertir evita que el código viejo, al volver, reactive
el veto por fail-safe. (Runbook §4.)

> **Códigos de salida del deploy-token (runbook §1), aclaración (nota Baja):** `0` = deploy OK y token
> de despliegue revocado; `97` = deploy OK pero la **revocación** del token falló (revocarlo a mano);
> `98` = deploy + revocación OK pero el borrado del fichero temporal del token falló (borrarlo a
> mano); en fallo del propio deploy se preserva el `deploy_rc` del CLI. **El runbook `main` ya
> implementa 0/97/98** (`PLANS/RUNBOOK-DESPLIEGUE-CONVEX-PROD.md` §1, líneas de `exit 97`/`exit 98`);
> **PR-1b NO modifica el runbook** (no está en el manifiesto), así que estos códigos son preexistentes,
> no un cambio de este PR.

> El paso 2 (`env remove`) **no se ejecuta en esta fase de código**: queda documentado aquí y se
> hará en el despliegue, tras el GO de auditoría, el merge y la confirmación del usuario.

---

## Verificación (en la instalación, tras GO)

- `npm run lint`, `npm run build` (typecheck de Next), `npx convex codegen` (typecheck de Convex) en
  verde. En particular, el colapso de `reason` debe typechequear en `auth.ts` y en el consumidor
  `testSupport.ts`.
- e2e project `unit` intacto (5 pruebas de `lib-unit.spec.ts`: B5 + NFKC).
- Suite e2e (CI): la prueba reescrita pasa por la capa por IP; la prueba 8 (11 concurrentes → 10
  sesiones) sigue verde.
- Igualdad byte-a-byte CODIGO ↔ repo tras instalar; `scripts/login-verify/` eliminado; los greps de
  §5 sin resultados en código tras PR-1b.

---

## 5. Evidencia reproducible (comandos + salida completa)

Comandos ejecutados en la raíz del repo sobre `main` (`bcbd30c`), **antes** de aplicar PR-1b (por
eso aún aparecen los símbolos y ficheros que PR-1b elimina). `git grep` solo mira ficheros
**versionados**, así que `node_modules/**` queda excluido de raíz; se añaden exclusiones explícitas
de `PLANS/**` y `CODIGO/**`. Salida **completa** (sin recortes):

```text
$ git grep -n "login-verify" -- ":(exclude)PLANS/" ":(exclude)CODIGO/"
package.json:16:    "test:unit": "node --test scripts/login-verify/*.test.mjs"
scripts/login-verify/README.md:16:`scripts/login-verify/` **byte a byte**, y añadir a `package.json`:
scripts/login-verify/README.md:17:`"test:unit": "node --test scripts/login-verify/*.test.mjs"`.
scripts/login-verify/README.md:29:  node scripts/login-verify/index.mjs --prod --confirm prod
scripts/login-verify/README.md:33:  node scripts/login-verify/index.mjs --deployment <name> --mode preview --confirm <name>

$ git grep -n "LOGIN_EMAIL_VETO" -- ":(exclude)PLANS/" ":(exclude)CODIGO/"
convex/auth.ts:17:  LOGIN_EMAIL_VETO_LIMIT,
convex/auth.ts:89:    // "off"). Clave `<email>` con LOGIN_EMAIL_VETO_LIMIT; semántica fija (M1).
convex/auth.ts:185:      await recordFailedAttempt(ctx, args.emailKey, LOGIN_EMAIL_VETO_LIMIT);
convex/lib/rateLimit.ts:65:// por el interruptor LOGIN_EMAIL_VETO (ver emailVetoActive). Se RETIRA en 1B-ii
convex/lib/rateLimit.ts:68:export const LOGIN_EMAIL_VETO_LIMIT: RateLimitConfig = {
convex/lib/rateLimit.ts:120:  return process.env.LOGIN_EMAIL_VETO !== "off";
scripts/login-verify/README.md:45:- `--mode prod|preview` — por defecto `prod`. `prod` deja `LOGIN_EMAIL_VETO=off` (estado
scripts/login-verify/README.md:59:| `3`    | Recuperación fallida: **exige intervención manual** (`convex env set LOGIN_EMAIL_VETO off <selector>`). |
scripts/login-verify/README.md:70:  `env get LOGIN_EMAIL_VETO`; nunca se captura el valor de otras variables del deployment.
scripts/login-verify/README.md:79:  recuperación: pueden dejar el veto activo. Mitigación manual: `convex env set LOGIN_EMAIL_VETO off <selector>`.
scripts/login-verify/core.mjs:100:  const r = await deps.cli(envArgs(target, ["set", "LOGIN_EMAIL_VETO", value]));
scripts/login-verify/core.mjs:101:  if (r.code !== 0) throw new Error("env set LOGIN_EMAIL_VETO falló");
scripts/login-verify/core.mjs:105:  const r = await deps.cli(envArgs(target, ["remove", "LOGIN_EMAIL_VETO"]));
scripts/login-verify/core.mjs:106:  if (r.code !== 0) throw new Error("env remove LOGIN_EMAIL_VETO falló");
scripts/login-verify/core.mjs:111:// LOGIN_EMAIL_VETO está presente pedimos su valor. Jamás capturamos el valor de
scripts/login-verify/core.mjs:119:    .includes("LOGIN_EMAIL_VETO");
scripts/login-verify/core.mjs:121:  const got = await deps.cli(envArgs(target, ["get", "LOGIN_EMAIL_VETO"]));
scripts/login-verify/core.test.mjs:60:    if (cmd === "env" && sub === "get" && name === "LOGIN_EMAIL_VETO") {
scripts/login-verify/core.test.mjs:70:      if (st.veto !== undefined) names.push("LOGIN_EMAIL_VETO");
scripts/login-verify/core.test.mjs:73:    if (cmd === "env" && sub === "set" && name === "LOGIN_EMAIL_VETO") {
scripts/login-verify/core.test.mjs:78:    if (cmd === "env" && sub === "remove" && name === "LOGIN_EMAIL_VETO") {

$ git grep -n "emailVetoActive" -- ":(exclude)PLANS/" ":(exclude)CODIGO/"
convex/auth.ts:19:  emailVetoActive,
convex/auth.ts:90:    if (emailVetoActive() && (await isLocked(ctx, args.emailKey))) {
convex/auth.ts:184:    if (emailVetoActive()) {
convex/lib/rateLimit.ts:65:// por el interruptor LOGIN_EMAIL_VETO (ver emailVetoActive). Se RETIRA en 1B-ii
convex/lib/rateLimit.ts:119:export function emailVetoActive(): boolean {

$ git grep -n "LOGIN_EMAIL_VETO_LIMIT" -- ":(exclude)PLANS/" ":(exclude)CODIGO/"
convex/auth.ts:17:  LOGIN_EMAIL_VETO_LIMIT,
convex/auth.ts:89:    // "off"). Clave `<email>` con LOGIN_EMAIL_VETO_LIMIT; semántica fija (M1).
convex/auth.ts:185:      await recordFailedAttempt(ctx, args.emailKey, LOGIN_EMAIL_VETO_LIMIT);
convex/lib/rateLimit.ts:68:export const LOGIN_EMAIL_VETO_LIMIT: RateLimitConfig = {

$ git grep -n "test:unit" -- ":(exclude)PLANS/" ":(exclude)CODIGO/"
package.json:16:    "test:unit": "node --test scripts/login-verify/*.test.mjs"
scripts/login-verify/README.md:17:`"test:unit": "node --test scripts/login-verify/*.test.mjs"`.
scripts/login-verify/core.test.mjs:2:// Ejecutar: node --test  (desde este directorio o vía "npm run test:unit").

$ git grep -nE "(from|require\()\s*['\"][^'\"]*(core|index)\.mjs" -- ":(exclude)PLANS/" ":(exclude)CODIGO/"
scripts/login-verify/core.test.mjs:29:} from "./core.mjs";
scripts/login-verify/core.test.mjs:30:import { makeSanitizer } from "./index.mjs";
scripts/login-verify/index.mjs:33:} from "./core.mjs";
```

**Lectura de la evidencia:**
- `login-verify`: solo aparece en `package.json:16` (script `test:unit`, que se elimina) y en
  **auto-referencias dentro de `scripts/login-verify/README.md`** (que se borra). Ningún consumidor
  externo.
- `LOGIN_EMAIL_VETO` / `emailVetoActive` / `LOGIN_EMAIL_VETO_LIMIT`: fuera de `scripts/login-verify/`
  (que se borra), solo en `convex/auth.ts` y `convex/lib/rateLimit.ts`, **ambos modificados en PR-1b**
  para eliminarlos (ver diffs B1). No quedan referencias colgantes.
- `test:unit`: en `package.json:16` (eliminado) y en un comentario de `core.test.mjs` (borrado). No
  está en `.github/` (CI no lo invoca).
- **imports de `core.mjs`/`index.mjs`**: las únicas referencias `import`/`require` están **dentro**
  de `scripts/login-verify/` (`core.test.mjs` ← `./core.mjs` + `./index.mjs`; `index.mjs` ←
  `./core.mjs`). Todas desaparecen con el directorio: ningún módulo externo los importa.

---

## 6. No verificable solo con el texto

Auditando exclusivamente este documento no se verifican (se comprobarán en la instalación/despliegue,
tras GO): snapshots byte-idénticos; lint/build/codegen/unit/e2e reales; comportamiento real de la
cuota por IP; el deploy y el orden de retirada de la variable; la ausencia final de la variable en
prod/dev; smoke y rollback. La evidencia de B3 (contenido de los borrados y ausencia de consumidores)
sí queda cubierta por §5 y por los diffs de borrado completos de §B3.2.

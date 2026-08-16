# MIS-302 · B10 — Tope diario de emails de recuperación por cuenta — Entrega de código (ronda 2)

> Plan de récord: `PLANS/MIS-302-tope-diario-emails-recuperacion.md` (**GO** de auditoría de plan).
> **Documento autocontenido**: el auditor solo ve este texto. Incluye diffs literales `diff -u`, el
> contenido íntegro del spec nuevo, y la evidencia literal de las fronteras de seguridad **no
> modificadas** de las que depende la corrección. Effort: **high**.
> **No autoriza instalar/subir/mergear/desplegar.** Alcance elegido: **B (tope 10/día + helper de test
> mínimo)**.
>
> **Correcciones ronda 2 (auditoría de código ronda 1 · NO-GO por M1/M2 semánticos):**
> 1. **M1** — el mecanismo `recordFailedAttempt` es una **ventana ANCLADA** en `windowStartedAt` con
>    candado deslizante al llegar al máximo, **no** una ventana móvil. El término "ventana móvil" que yo
>    introduje en el plan era inexacto. **El usuario eligió mantener el mecanismo anclado** (Opción A:
>    consistente con las otras 3 capas del limitador, cero superficie nueva) y se corrige TODO el
>    wording (contrato, comentarios, tests, doc) a la semántica real. La lógica del gate
>    (`upstreamAllowed`) **no cambia**.
> 2. **M2** — los tests ya no afirman cubrir semántica temporal de ventana móvil; ejercitan el conteo
>    DENTRO de una ventana anclada (lo correcto para este contrato). El comentario de cabecera del spec
>    lo declara explícitamente.
> 3. **Media/Baja** — se embebe `assertServerKey` literal (§5.5); el cleanup registra un mensaje
>    constante sin secretos; se documenta la frontera `>` de `isLocked` (§5.2); se pega la salida
>    literal de los greps (§7).
>
> **Cambios de código vs ronda 1:** solo **wording** — el comentario de `RESET_DAILY_LIMIT` (§3.1) y el
> comentario de cabecera + mensaje de cleanup del spec (§4). Ninguna lógica cambia.

## 1. Alcance y contrato

Añade una **cuarta capa** de rate-limit al flujo de recuperación: un **tope diario por cuenta** de
**10 solicitudes ELEGIBLES para entrega en una ventana de 24 h ANCLADA en la 1ª solicitud**, clave
`resetday:<email>`. Cierra el hueco de que un atacante, esperando a que expire cada bloqueo de 15 min
(`RESET_REQUEST_LIMIT`, 5/15min), disparase cientos de correos/día a un mismo buzón (mail-bombing /
coste de Resend).

**Contrato exacto (ventana ANCLADA, no móvil):** la ventana se abre con la 1ª solicitud elegible
(`windowStartedAt`); admite ≤10 elegibles; la 10ª fija un candado de 24 h que se **desliza** mientras
sigan llegando elegibles. Si la ventana expira sin llegar a 10, el contador se reinicia. Es la
**misma** semántica que las otras tres capas del módulo (`RESET_REQUEST_LIMIT`/`RESET_CODE_LIMIT`/
`RESET_IP_LIMIT`) — ninguna es una ventana móvil. Consecuencia aceptada (elección del usuario, Opción
A): un abusador que cruce la frontera de la ventana puede lograr un pico **transitorio** de hasta ~2×10
dentro de un intervalo de 24 h que cruce el corte; el ritmo **sostenido** queda en ~9/día. Para el
objetivo anti-coste/anti-mailbombing de B10 es irrelevante, y se prefiere por consistencia y cero
superficie nueva frente a un modelo de eventos con timestamps (rechazado como sobredimensionado).

Propiedad clave (corrección **M1** de la auditoría de plan): la cuota diaria **solo** la consume una
solicitud que las capas anteriores (burst por email + IP) habrían dejado entregar (`upstreamAllowed`).
Contar también las suprimidas convertiría "10 emails/día" en "10 peticiones/día" y permitiría estirar
un bloqueo de 15 min a 24 h. Se usa `upstreamAllowed` (no `allowed`) para conservar el candado
deslizante diario cuando el único veto es el propio tope diario.

Anti-enumeración intacta: `resetday:<email>` se deriva **solo** del email normalizado (nunca consulta
`users`); la respuesta pública es **siempre** `{ok:true}`; los `isLocked` se leen sin cortocircuito
(lecturas uniformes). Al toparse, `allowed=false` → `deliverResetCode({allowed:false})` retorna sin
enviar (camino ya existente, evidencia en §5).

**Toca `convex/` → REQUIERE deploy de Convex a prod** (aditivo/retrocompatible: nueva capa + helper de
test inerte en prod; la firma de `requestPasswordResetCode` no cambia → el frontend actual sigue igual).
Orden **expand**: Convex ANTES del merge. Sin cambios en `src/`.

## 2. Manifiesto

Salida literal de `find CODIGO/MIS-302-tope-diario-emails -type f | LC_ALL=C sort` (sin filtro de
extensión):
```
CODIGO/MIS-302-tope-diario-emails/MIS-302-tope-diario-emails-codigo-completo.md
CODIGO/MIS-302-tope-diario-emails/convex/lib/rateLimit.ts
CODIGO/MIS-302-tope-diario-emails/convex/passwordReset.ts
CODIGO/MIS-302-tope-diario-emails/convex/testSupport.ts
CODIGO/MIS-302-tope-diario-emails/e2e/helpers/test-support.ts
CODIGO/MIS-302-tope-diario-emails/e2e/password-reset-daily-cap.spec.ts
CODIGO/MIS-302-tope-diario-emails/playwright.config.ts
```

| # | Fichero | Cambio |
|---|---------|--------|
| 1 | `convex/lib/rateLimit.ts` | + const `RESET_DAILY_LIMIT` (10 / 24 h, lock 24 h) |
| 2 | `convex/passwordReset.ts` | import + reestructura del gate de `requestPasswordResetCode` (M1: `upstreamAllowed`) |
| 3 | `convex/testSupport.ts` | + `resetday:<email>` en `rateLimitKeysForTestIdentity()`; + mutation gated `clearResetRequestWindow` |
| 4 | `e2e/helpers/test-support.ts` | + wrappers `requestResetCode` (directo, sin ipHint) y `clearResetRequestWindow` |
| 5 | `playwright.config.ts` | registra `password-reset-daily-cap.spec.ts` en `chromium-secrets` |
| 6 | `e2e/password-reset-daily-cap.spec.ts` | **NUEVO** — 2 tests de comportamiento + 1 de config |

**Generados:** `convex/_generated/` está versionado. Añadir un export a `rateLimit.ts` y una mutation a
`testSupport.ts` (módulos existentes, ningún fichero nuevo) **no** cambia `api.d.ts`/`api.js`; el paso
de instalación (`npx convex dev --once`) regenera y se verificará que quedan **byte-idénticos** (no se
commitean si no cambian). Salida mecánica, no auditada a mano. **No** toca `playwright.gate.config.ts`
(su gate solo recoge `secret-sentinel.spec.ts`).

## 3. Diffs unificados — salida literal de `diff -u`

### 3.1 `convex/lib/rateLimit.ts`
```diff
--- convex/lib/rateLimit.ts
+++ CODIGO/MIS-302-tope-diario-emails/convex/lib/rateLimit.ts
@@ -96,6 +96,32 @@
   lockDurationMs: 15 * MIN,
 };
 
+// MIS-302 (B10): tope DIARIO de emails de recuperación por cuenta (anti-abuso /
+// anti-coste). Capa DISTINTA del burst de 15 min (RESET_REQUEST_LIMIT): aquella
+// acota ráfagas cortas; ésta pone un techo por cuenta y día. Misma mecánica ya
+// auditada (recordFailedAttempt/isLocked sobre loginAttempts), solo cambian la
+// ventana (24 h) y el máximo (10 solicitudes ELEGIBLES para entrega).
+//
+// SEMÁNTICA EXACTA (idéntica al resto de capas de este módulo, NO una ventana
+// móvil): la ventana está ANCLADA en la 1ª solicitud (windowStartedAt); admite
+// hasta 10 solicitudes elegibles dentro de ella; la 10ª fija lockedUntil = now +
+// 24 h (candado que se DESLIZA mientras sigan llegando solicitudes elegibles).
+// Al expirar la ventana sin haber llegado a 10, el contador se reinicia. Ritmo
+// SOSTENIDO acotado a ~9/día sin bloqueo permanente; un abusador que cruce la
+// frontera de la ventana puede lograr un pico transitorio de hasta ~2×10 dentro
+// de un intervalo de 24 h que cruce el corte — irrelevante para el objetivo
+// anti-coste/anti-mailbombing y aceptado a cambio de consistencia (ver el plan).
+//
+// lock:true para que participe en el gate `allowed` de requestPasswordResetCode
+// vía isLocked (una config lock:false nunca fija lockedUntil, así que isLocked
+// jamás la vería). Clave `resetday:<email>`.
+export const RESET_DAILY_LIMIT: RateLimitConfig = {
+  maxAttempts: 10,
+  windowMs: 24 * 60 * MIN,
+  lock: true,
+  lockDurationMs: 24 * 60 * MIN,
+};
+
 // Única fuente de la clave de telemetría por email (M1, sugerencia del auditor):
 // login, y el harness de test, la construyen SIEMPRE por aquí para que no puedan
 // divergir por un prefijo escrito a mano.
```
`MIN = 60 * 1000` (definido en el módulo, sin cambios) → `24 * 60 * MIN = 86 400 000 ms = 24 h`.

### 3.2 `convex/passwordReset.ts`
```diff
--- convex/passwordReset.ts
+++ CODIGO/MIS-302-tope-diario-emails/convex/passwordReset.ts
@@ -20,6 +20,7 @@
   RESET_REQUEST_LIMIT,
   RESET_CODE_LIMIT,
   RESET_IP_LIMIT,
+  RESET_DAILY_LIMIT,
   emailWithinLimits,
   isLocked,
   normalizeEmailKey,
@@ -62,15 +63,37 @@
     if (!emailWithinLimits(normalizedEmail)) return { ok: true as const };
 
     const emailKey = `reset:${normalizedEmail}`;
+    // MIS-302 (B10): clave del tope diario. Derivada SOLO del email normalizado,
+    // nunca consulta `users` → no rompe la anti-enumeración por respuesta ni por
+    // tiempo (mismo criterio que `reset:<email>`).
+    const dailyKey = `resetday:${normalizedEmail}`;
     const ipKey = normalizeIpHint(args.ipHint ?? null);
 
-    let allowed = !(await isLocked(ctx, emailKey));
-    if (allowed && ipKey) allowed = !(await isLocked(ctx, `resetip:${ipKey}`));
-
-    // Se contabilizan SOLICITUDES (no fallos): siempre se registra, exista o
-    // no la cuenta — de lo contrario el contador delataría por sí mismo si
-    // el email existe.
+    // MIS-302 (B10): las tres capas se leen SIN cortocircuito, para que el número
+    // de lecturas no dependa del estado de los candados.
+    const requestLocked = await isLocked(ctx, emailKey);
+    const dailyLocked = await isLocked(ctx, dailyKey);
+    const ipLocked = ipKey ? await isLocked(ctx, `resetip:${ipKey}`) : false;
+
+    // "upstream" = capas anteriores al tope diario (burst por email + IP). Solo
+    // una solicitud que ellas dejarían entregar puede consumir cuota diaria.
+    const upstreamAllowed = !requestLocked && !ipLocked;
+    const allowed = upstreamAllowed && !dailyLocked;
+
+    // Se contabilizan SOLICITUDES (no fallos): burst e IP se registran SIEMPRE,
+    // exista o no la cuenta — de lo contrario el contador delataría por sí mismo
+    // si el email existe.
     await recordFailedAttempt(ctx, emailKey, RESET_REQUEST_LIMIT);
+    // MIS-302 (B10): la cuota diaria SOLO la consume una solicitud que HABRÍA
+    // podido entregar si el tope diario no existiera (upstreamAllowed). Contar
+    // también las suprimidas por burst/IP convertiría "10 emails/día" en "10
+    // peticiones/día" y permitiría estirar un bloqueo de 15 min a 24 h. Se usa
+    // upstreamAllowed y NO `allowed`: así una solicitud vetada SOLO por el propio
+    // tope diario sigue empujando su candado deslizante (mismo comportamiento que
+    // las demás capas), pero una suprimida por burst/IP no consume cuota.
+    if (upstreamAllowed) {
+      await recordFailedAttempt(ctx, dailyKey, RESET_DAILY_LIMIT);
+    }
     if (ipKey) await recordFailedAttempt(ctx, `resetip:${ipKey}`, RESET_IP_LIMIT);
 
     await ctx.scheduler.runAfter(0, internal.passwordReset.deliverResetCode, {
```
Contexto: tras este bloque, el handler ejecuta **siempre** `ctx.scheduler.runAfter(0,
internal.passwordReset.deliverResetCode, { email: args.email, allowed })` y `return { ok: true as
const }` (sin cambios). El scheduler se programa esté topado o no; solo `allowed` cambia — no
observable por el cliente.

### 3.3 `convex/testSupport.ts`
```diff
--- convex/testSupport.ts
+++ CODIGO/MIS-302-tope-diario-emails/convex/testSupport.ts
@@ -75,6 +75,7 @@
     RESET_TEST_EMAIL, // login — clave `<email>` del veto retirado en PR-1b (MIS-293); se limpia por higiene de filas heredadas
     loginCounterKey(RESET_TEST_EMAIL), // login — telemetría por email (MIS-290, M1: limpiar AMBAS)
     `reset:${RESET_TEST_EMAIL}`, // solicitudes de código
+    `resetday:${RESET_TEST_EMAIL}`, // MIS-302 (B10): tope diario — ventana de 24h; sin limpiar, un bloqueo heredado envenenaría los specs de reset un día entero
     `resetcode:${RESET_TEST_EMAIL}`, // intentos de código
     `ip:${TEST_LOGIN_IP}`, // capa por IP de la prueba 8 (IP sintética, segura de limpiar)
   ];
@@ -219,6 +220,23 @@
   },
 });
 
+// MIS-302 (B10): limpia SOLO la ventana del burst de 15 min (`reset:<email>`) de
+// la identidad dedicada, para que el spec del tope diario pueda acumular las 10
+// solicitudes del día sin toparse antes con el límite de 5/15min ni esperar 15
+// min reales. NO toca `resetday:<email>` (la capa bajo prueba) ni ninguna otra.
+// Mismos cerrojos que el resto del harness (clave + identidad dedicada); no
+// acepta clave arbitraria — no es una introspección genérica.
+export const clearResetRequestWindow = mutation({
+  args: { serverKey: v.string(), email: v.string() },
+  returns: v.null(),
+  handler: async (ctx, args) => {
+    assertTestKey(args.serverKey);
+    const emailKey = assertDedicatedIdentity(args.email); // devuelve la forma normalizada
+    await resetAttempts(ctx, `reset:${emailKey}`);
+    return null;
+  },
+});
+
 // Verifica la invalidación de sesiones tras un cambio de contraseña.
 export const countSessionsFor = query({
   args: { serverKey: v.string(), email: v.string() },
```
`resetAttempts` (import ya existente, sin cambios) borra la fila de `loginAttempts` de esa clave. El
helper construye la clave con `emailKey` (== `RESET_TEST_EMAIL`, forma normalizada devuelta por el
cerrojo 2) → idéntica a la que usa `requestPasswordResetCode` (`reset:${normalizedEmail}`).

### 3.4 `e2e/helpers/test-support.ts`
```diff
--- e2e/helpers/test-support.ts
+++ CODIGO/MIS-302-tope-diario-emails/e2e/helpers/test-support.ts
@@ -64,6 +64,26 @@
   });
 }
 
+// MIS-302 (B10): solicita un código por la vía DIRECTA (sin UI y SIN ipHint, para
+// aislar las capas por email/diaria de la capa por IP). Mismo serverKey que el
+// frontend (AUTH_SERVER_KEY, obligatorio desde MIS-289). Devuelve la respuesta
+// pública para poder asertar que es idéntica esté o no topada.
+export async function requestResetCode(): Promise<{ ok: true }> {
+  return await convexClient().mutation(api.passwordReset.requestPasswordResetCode, {
+    email: RESET_TEST_EMAIL,
+    serverKey: authServerKey(),
+  });
+}
+
+// MIS-302 (B10): limpia solo la ventana del burst de 15 min de la identidad
+// dedicada (ver convex/testSupport.ts::clearResetRequestWindow).
+export async function clearResetRequestWindow(): Promise<void> {
+  await convexClient().mutation(api.testSupport.clearResetRequestWindow, {
+    serverKey: testSupportKey(),
+    email: RESET_TEST_EMAIL,
+  });
+}
+
 export async function countSessionsFor(): Promise<number> {
   return await convexClient().query(api.testSupport.countSessionsFor, {
     serverKey: testSupportKey(),
```
`requestResetCode` usa `authServerKey()` (AUTH_SERVER_KEY, obligatorio desde MIS-289) y **omite
`ipHint`** → en el handler `ipKey` es `null`, `ipLocked` es `false` y la capa `resetip:` no participa:
el experimento mide solo las capas por email y diaria. `clearResetRequestWindow` usa `testSupportKey()`
(E2E_TEST_SUPPORT_KEY).

### 3.5 `playwright.config.ts`
```diff
--- playwright.config.ts
+++ CODIGO/MIS-302-tope-diario-emails/playwright.config.ts
@@ -91,6 +91,7 @@
         "test-support.spec.ts",
         "password-reset.spec.ts",
         "password-reset-invariants.spec.ts",
+        "password-reset-daily-cap.spec.ts",
         "session-cookie.spec.ts",
         "session-revoke-all.spec.ts",
       ],
```

## 4. Fichero NUEVO — contenido íntegro literal

### `e2e/password-reset-daily-cap.spec.ts`
```ts
// MIS-302 (B10): tope DIARIO de emails de recuperación por cuenta. Corre en
// "chromium-secrets" junto al resto del flujo de reset: aunque este spec no teclea
// contraseñas, comparte la identidad dedicada y la política de artefactos
// (trace/vídeo/screenshot OFF).
//
// SEMÁNTICA bajo prueba: ventana ANCLADA de 24 h (no móvil) con hasta 10
// solicitudes elegibles y candado deslizante al llegar a 10 — idéntica al resto
// del limitador. Estos tests ejercitan el conteo DENTRO de una sola ventana (todas
// las solicitudes ocurren en segundos); NO cruzan la frontera de 24 h (no hay
// reloj inyectable, y con ventana anclada el cruce es comportamiento aceptado, no
// un requisito). Ver plan y §5 del codigo-completo.
//
// AÍSLA la capa diaria: pide códigos por la vía directa SIN ipHint (la capa por IP
// no participa) y limpia la ventana del burst de 15 min entre solicitudes cuando
// hace falta, de modo que el limitador bajo prueba sea `resetday:<email>`.
//
// Dos tests de comportamiento (frontera del conteo + interacción burst↔diario) más
// uno de configuración que ancla los valores del contrato (10 elegibles / 24 h /
// bloqueo). El test de interacción está diseñado para FALLAR con la implementación
// de ronda 1 (que contaba también las solicitudes suprimidas).
import { test, expect } from "./helpers/secure-test";
import {
  getLastResetCode,
  resetTestIdentity,
  requestResetCode,
  clearResetRequestWindow,
} from "./helpers/test-support";
import { RESET_DAILY_LIMIT, RESET_REQUEST_LIMIT } from "../convex/lib/rateLimit";

const CAP = RESET_DAILY_LIMIT.maxAttempts;
const BURST = RESET_REQUEST_LIMIT.maxAttempts;

// Espera a que el outbox tenga un código DISTINTO del previo (gotcha: comprobar
// "valor diferente", no solo "no nulo", en entregas asíncronas repetidas).
async function pollForNewCode(prev: string | null): Promise<string> {
  await expect
    .poll(async () => await getLastResetCode(), {
      message: "esperando el nuevo código de recuperación en el outbox de test",
      timeout: 10_000,
    })
    .not.toBe(prev);
  const code = await getLastResetCode();
  if (!code) throw new Error("getLastResetCode() devolvió null tras superar el poll");
  return code;
}

// Espera acotada para asertar el NEGATIVO "no llega código nuevo". Inherentemente
// temporal, pero robusta aquí: las entregas previas ya se confirmaron con polling
// y deliverResetCode({allowed:false}) retorna sin escribir en el outbox.
// (Follow-up Baja: señal determinista del scheduler/outbox si se añadiera.)
async function assertNoNewCode(expected: string): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  expect(await getLastResetCode()).toBe(expected);
}

// Limpieza best-effort: garantiza dejar la identidad limpia (incluido resetday,
// candado de 24 h) sin enmascarar un error primario del test si fallara. Registra
// un mensaje CONSTANTE (sin email, código ni secretos) para no ocultar del todo un
// fallo de cleanup.
async function cleanup(): Promise<void> {
  await resetTestIdentity().catch(() => {
    console.warn("MIS-302 cleanup: resetTestIdentity falló (best-effort, sin datos sensibles)");
  });
}

test.describe("tope diario de emails de recuperación (MIS-302)", () => {
  // Ancla los valores del contrato: 10 solicitudes elegibles / ventana ANCLADA de
  // 24 h / con bloqueo. Un cambio accidental del valor rompe la suite.
  test("la config del tope diario es 10/día con ventana y bloqueo de 24 h", () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    expect(RESET_DAILY_LIMIT.maxAttempts).toBe(10);
    expect(RESET_DAILY_LIMIT.windowMs).toBe(DAY_MS);
    expect(RESET_DAILY_LIMIT.lock).toBe(true);
    if (RESET_DAILY_LIMIT.lock) {
      expect(RESET_DAILY_LIMIT.lockDurationMs).toBe(DAY_MS);
    }
    // Precondición de los tests de interacción: el burst se topa antes que el diario.
    expect(RESET_REQUEST_LIMIT.maxAttempts).toBe(5);
    expect(BURST).toBeLessThan(CAP);
  });

  test(`entrega ${CAP} emails elegibles y suprime el siguiente, sin delatar el tope`, async () => {
    await resetTestIdentity(); // limpia también resetday:<email>
    try {
      let lastCode: string | null = null;
      // Hasta el tope: se limpia el burst antes de cada solicitud, así el ÚNICO
      // limitador vivo es el diario.
      for (let i = 1; i <= CAP; i++) {
        await clearResetRequestWindow();
        const r = await requestResetCode();
        expect(r.ok).toBe(true);
        lastCode = await pollForNewCode(lastCode);
      }

      // Solicitud nº CAP+1: topada por la capa diaria. Se limpia OTRA VEZ el burst
      // para demostrar que el corte NO viene de él (reset:<email> sin candado)
      // sino del tope diario resetday:<email>.
      await clearResetRequestWindow();
      const suppressed = await requestResetCode();
      expect(suppressed.ok).toBe(true); // respuesta IDÉNTICA a las entregadas

      await assertNoNewCode(lastCode!);
    } finally {
      await cleanup();
    }
  });

  test("una solicitud suprimida por el burst NO consume cuota diaria (M1)", async () => {
    await resetTestIdentity();
    try {
      // BURST entregas SIN limpiar → al BURST-ésimo, reset:<email> se bloquea.
      let lastCode: string | null = null;
      for (let i = 1; i <= BURST; i++) {
        const r = await requestResetCode();
        expect(r.ok).toBe(true);
        lastCode = await pollForNewCode(lastCode);
      }
      const burstCode = lastCode!;

      // CAP - BURST solicitudes más con el burst bloqueado: {ok:true} pero sin
      // código nuevo. Emitir exactamente CAP - BURST garantiza que la versión
      // defectuosa (que contaba las suprimidas) llegue justo a CAP y bloquee el
      // envío siguiente; la correcta las ignora y deja cuota.
      for (let i = 0; i < CAP - BURST; i++) {
        const r = await requestResetCode();
        expect(r.ok).toBe(true);
      }
      await assertNoNewCode(burstCode);

      // Limpiar SOLO el burst; la siguiente DEBE entregar: con la corrección M1 es
      // el consumo diario nº BURST+1 (elegible); con el bug, resetday ya valdría
      // CAP y se bloquearía → este test lo caza.
      await clearResetRequestWindow();
      const r = await requestResetCode();
      expect(r.ok).toBe(true);
      const fresh = await pollForNewCode(burstCode);
      expect(fresh).not.toBe(burstCode);
    } finally {
      await cleanup();
    }
  });
});
```

## 5. Evidencia literal de fronteras de seguridad NO modificadas

El auditor de ronda 1 marcó como "no verificable con el plan" la semántica exacta de estas piezas. Se
embeben aquí íntegras (verificables con los greps del §7); **ninguna cambia** en esta entrega.

### 5.1 Unión `RateLimitConfig` (convex/lib/rateLimit.ts, L47–49) — el tipo de `RESET_DAILY_LIMIT`
```ts
export type RateLimitConfig =
  | { maxAttempts: number; windowMs: number; lock: true; lockDurationMs: number }
  | { maxAttempts: number; windowMs: number; lock: false };
```
`RESET_DAILY_LIMIT` usa la variante `lock:true`, por lo que `lockDurationMs` es obligatorio y el gate
del test puede estrecharlo con `if (RESET_DAILY_LIMIT.lock) { ... }`.

### 5.2 `isLocked` y `recordFailedAttempt` (convex/lib/rateLimit.ts, L113–147) — mecánica del candado
```ts
export async function isLocked(ctx: MutationCtx, emailKey: string): Promise<boolean> {
  const attempt = await findAttempt(ctx, emailKey);
  if (!attempt?.lockedUntil) return false;
  return attempt.lockedUntil > Date.now();
}

export async function recordFailedAttempt(
  ctx: MutationCtx,
  emailKey: string,
  config: RateLimitConfig,
): Promise<void> {
  const now = Date.now();
  const attempt = await findAttempt(ctx, emailKey);

  if (!attempt) {
    await ctx.db.insert("loginAttempts", {
      emailKey,
      count: 1,
      windowStartedAt: now,
      lockedUntil: undefined,
    });
    return;
  }

  const windowExpired = now - attempt.windowStartedAt > config.windowMs;
  const nextCount = windowExpired ? 1 : attempt.count + 1;
  // `lock:false` (telemetría) nunca fija lockedUntil.
  const shouldLock = config.lock && nextCount >= config.maxAttempts;

  await ctx.db.patch(attempt._id, {
    count: nextCount,
    windowStartedAt: windowExpired ? now : attempt.windowStartedAt,
    lockedUntil: shouldLock ? now + config.lockDurationMs : attempt.lockedUntil,
  });
}
```
**Semántica: ventana ANCLADA (no móvil).** `windowStartedAt` se fija con la 1ª solicitud y **solo** se
reinicia cuando `now - windowStartedAt > windowMs` (`windowExpired`), momento en que `count` vuelve a 1.
No hay historial por-evento: con `{count, windowStartedAt}` no puede calcularse cuántas solicitudes
siguen dentro de un intervalo móvil tras cruzar la frontera. Es exactamente la semántica de las otras
tres capas del módulo. **Caveat de frontera aceptado (Opción A del usuario):** quedándose <10 en una
ventana y cruzando el corte, se puede lograr un pico transitorio ~2×10 en un intervalo de 24 h que
cruce la frontera; el ritmo sostenido es ~9/día. Los tests **no** cruzan la frontera (no hay reloj
inyectable) y el contrato ya no reclama cobertura temporal móvil (corrección M2).

**Análisis off-by-one (frontera del CONTEO dentro de la ventana, con `maxAttempts=10`):** la 1ª
solicitud elegible inserta `count=1`; cada elegible posterior incrementa. Como `isLocked` se lee
**antes** de `recordFailedAttempt` en el handler, la solicitud elegible nº 10 ve `isLocked=false` (count
previo 9) → se entrega, y su `recordFailedAttempt` lleva `count` a 10 → `shouldLock` (10>=10) → fija
`lockedUntil`. La nº 11 ve `isLocked=true` → `dailyLocked=true` → `allowed=false` → suprimida.
**Exactamente 10 entregas elegibles** dentro de la ventana, la 11ª bloqueada. El test 1 lo verifica.

**Candado deslizante:** con solicitudes elegibles continuas tras el tope, cada `recordFailedAttempt`
mantiene la ventana viva (`windowExpired=false`) y vuelve a fijar `lockedUntil = now + 24 h` (propiedad
heredada, idéntica a `RESET_REQUEST_LIMIT`). Al condicionar el registro diario a `upstreamAllowed`, solo
lo alimentan solicitudes elegibles (no las ya suprimidas por burst/IP).

**Frontera de `isLocked` (Baja, documentada):** `isLocked` usa `attempt.lockedUntil > Date.now()`
(estrictamente mayor) → en igualdad exacta de milisegundo el candado se considera **vencido**
(expiración exclusiva). Coherente con el resto del repo; sin efecto práctico (resolución de ms).

### 5.3 `deliverResetCode` — retorno temprano si `allowed=false` (convex/passwordReset.ts, L90)
```ts
    if (!args.allowed) return null;
```
Primera sentencia del `handler` de `deliverResetCode` (internalAction). Con `allowed=false` retorna
**antes** de `createResetCode`/`recordOutbox`/Resend → no escribe fila de código ni entrada de outbox
ni envía email. Por eso, al toparse el diario, `getLastResetCode()` no cambia (base del negativo de los
tests) y no hay email real.

### 5.4 Cerrojos del harness (convex/testSupport.ts, L49–59) — protegen `clearResetRequestWindow`
```ts
function assertTestKey(serverKey: string): void {
  assertServerKey(serverKey, TEST_SUPPORT_ENV_VAR);
}

// Cerrojo 2. Devuelve el email ya normalizado para que quien lo llame use
// SIEMPRE la forma canónica en sus consultas.
function assertDedicatedIdentity(email: string): string {
  const key = normalizeEmailKey(email);
  if (key !== RESET_TEST_EMAIL) throw new Error(FORBIDDEN_IDENTITY);
  return key;
}
```
`assertTestKey` es **fail-closed** (vía `assertServerKey`: sin `E2E_TEST_SUPPORT_KEY` configurada
—caso de producción— lanza aunque el código esté desplegado). `assertDedicatedIdentity` restringe a
`RESET_TEST_EMAIL` y devuelve la forma normalizada usada para construir `reset:${emailKey}`. El nuevo
`clearResetRequestWindow` invoca **ambos** antes de tocar nada (§3.3), así que es inerte en prod y solo
puede limpiar el burst de la identidad dedicada.

### 5.5 `assertServerKey` / `serverKeyMatches` (convex/lib/serverKey.ts, L20–38) — el fail-closed
Cuerpo literal del que depende `assertTestKey` (§5.4); **no cambia** en esta entrega:
```ts
export function serverKeyMatches(provided: string, envVarName: string): boolean {
  const expected = process.env[envVarName];
  return (
    !!expected &&
    constantTimeEqual(
      new TextEncoder().encode(provided),
      new TextEncoder().encode(expected),
    )
  );
}

export function assertServerKey(provided: string, envVarName: string): void {
  if (!serverKeyMatches(provided, envVarName)) {
    throw new Error("No autorizado");
  }
}
```
**Fail-closed literal:** si la env var no está configurada (`E2E_TEST_SUPPORT_KEY` en prod), `expected`
es `undefined`, el `!!expected` es `false` y **ningún** `serverKey` puede pasar → `assertServerKey`
lanza. Por eso `clearResetRequestWindow` (y todo el harness) es inerte en producción. Comparación en
tiempo constante (`constantTimeEqual`).

## 6. Verificación (tras GO de esta auditoría de código)

1. **Instalar byte-idéntico:** copiar los 6 ficheros de `CODIGO/MIS-302-tope-diario-emails/` a sus
   rutas del repo. Verificar igualdad byte a byte (`diff -r`).
2. **`npx convex dev --once`** (deployment de dev `dutiful-mole-111`): despliega `RESET_DAILY_LIMIT`,
   el gate nuevo y `clearResetRequestWindow`; regenera `_generated` → comprobar byte-idéntico (no
   commitear si no cambia).
3. **`npm run lint`** (0 errores; 1 warning preexistente ajeno en `Avatar.jsx`), **`npm run build`**.
4. **Suite e2e completa** (`npm run test:e2e`), foco `password-reset-daily-cap` (chromium-secrets), sin
   regresiones en `password-reset*`, `session-*`, resto.
5. PR (permiso antes del push) → CI verde.
6. **Deploy Convex a prod** (orden expand, confirmación explícita): Gate B9
   (`npx convex env list --prod --names-only` → `E2E_TEST_SUPPORT_KEY` **ausente**, `AUTH_SERVER_KEY` +
   `GOOGLE_LOGIN_SHARED_SECRET` **presentes**) → deploy-token del runbook. prod = `greedy-tapir-20`.
7. Merge (con permiso) → Railway (sin cambios funcionales) → smoke → cerrar MIS-302.

## 7. Greps reproducibles — con salida literal

Ejecutados sobre `CODIGO/MIS-302-tope-diario-emails/` (tras instalar, sobre el repo dan idéntica salida
salvo el offset de línea de contexto que introduzca el propio parche):
```
$ grep -nE "resetday|upstreamAllowed|RESET_DAILY_LIMIT" convex/passwordReset.ts
23:  RESET_DAILY_LIMIT,
69:    const dailyKey = `resetday:${normalizedEmail}`;
80:    const upstreamAllowed = !requestLocked && !ipLocked;
81:    const allowed = upstreamAllowed && !dailyLocked;
88:    // podido entregar si el tope diario no existiera (upstreamAllowed). Contar
91:    // upstreamAllowed y NO `allowed`: así una solicitud vetada SOLO por el propio
94:    if (upstreamAllowed) {
95:      await recordFailedAttempt(ctx, dailyKey, RESET_DAILY_LIMIT);

$ grep -n "export const RESET_DAILY_LIMIT" convex/lib/rateLimit.ts
118:export const RESET_DAILY_LIMIT: RateLimitConfig = {

$ grep -nE "resetday:|clearResetRequestWindow" convex/testSupport.ts
78:    `resetday:${RESET_TEST_EMAIL}`, // MIS-302 (B10): tope diario — ventana de 24h; sin limpiar, un bloqueo heredado envenenaría los specs de reset un día entero
226:// min reales. NO toca `resetday:<email>` (la capa bajo prueba) ni ninguna otra.
229:export const clearResetRequestWindow = mutation({

$ grep -nE "requestResetCode|clearResetRequestWindow" e2e/helpers/test-support.ts
71:export async function requestResetCode(): Promise<{ ok: true }> {
79:// dedicada (ver convex/testSupport.ts::clearResetRequestWindow).
80:export async function clearResetRequestWindow(): Promise<void> {
81:  await convexClient().mutation(api.testSupport.clearResetRequestWindow, {

$ grep -n "password-reset-daily-cap" playwright.config.ts
94:        "password-reset-daily-cap.spec.ts",
```
Las fronteras NO modificadas (deben coincidir con §5) se comprueban **por símbolo** (los rangos por
línea se desplazan al insertar `RESET_DAILY_LIMIT`, que ocupa ~26 líneas): `grep -n "if (!args.allowed)
return null;" convex/passwordReset.ts`; `grep -n "export async function isLocked\|export async function
recordFailedAttempt" convex/lib/rateLimit.ts` y leer desde ahí (isLocked/recordFailedAttempt, §5.2);
`grep -n "function assertTestKey\|function assertDedicatedIdentity" convex/testSupport.ts` (cerrojos,
§5.4); `grep -n "function serverKeyMatches\|function assertServerKey" convex/lib/serverKey.ts`
(fail-closed, §5.5). Ejecutar dentro del entregable con `( cd CODIGO/MIS-302-tope-diario-emails && grep
… )`, o sobre el repo tras instalar.

## 8. Mapa a las listas de revisión

### 8.a Auditoría de CÓDIGO ronda 1 · §8 (esta ronda)
1. **Decidir explícitamente anclada vs móvil** → **anclada** (Opción A, elegida por el usuario). §1, §3.1
   (comentario), §5.2.
2. **Si cambia el contrato, aprobación de alcance + corregir redacción/tests** → el usuario aprobó
   Opción A; wording corregido en contrato (§1), comentario de `RESET_DAILY_LIMIT` (§3.1), cabecera del
   spec (§4), y este doc. Los tests no afirman cobertura temporal móvil.
3. **Si se mantiene móvil, nuevo modelo de datos/algoritmo + prueba de cruce** → N/A (no se mantiene móvil).
4. **Mantener intacta la corrección `upstreamAllowed` y su test** → sin cambios de lógica (§3.2, §4 test M1).
5. **Aportar `assertServerKey` literal** → §5.5.

### 8.b Auditoría de PLAN §8 (composición, ya resuelta en ronda 1 de plan)

1. **Tres estados de bloqueo antes de registrar** → §3.2: `requestLocked`/`dailyLocked`/`ipLocked` se
   calculan antes de cualquier `recordFailedAttempt`.
2. **`upstreamAllowed = !requestLocked && !ipLocked`** → §3.2, literal.
3. **`allowed = upstreamAllowed && !dailyLocked`** → §3.2, literal.
4. **Burst/IP siempre; `resetday` solo bajo `upstreamAllowed`** → §3.2: `recordFailedAttempt(emailKey…)`
   y `recordFailedAttempt(resetip…)` incondicionales; el de `dailyKey` dentro de `if (upstreamAllowed)`.
5. **Scheduler siempre + respuesta `{ok:true}`** → §3.2 (contexto tras el diff): `runAfter` y `return`
   sin cambios; solo `allowed` varía.
6. **`resetTestIdentity` limpia exactamente la nueva clave** → §3.3: `resetday:${RESET_TEST_EMAIL}`
   añadido a `rateLimitKeysForTestIdentity()`, que la función recorre con `resetAttempts`.
7. **El test de interacción falla con el algoritmo antiguo** → §4 test "M1" + §5.2 off-by-one: con el
   registro incondicional, `resetday` llegaría a `CAP` tras las `CAP-BURST` supresiones y bloquearía la
   entrega final que el test exige.
8. **Gates literales, diffs completos, manifiesto, evidencia** → §2 (manifiesto), §3 (diffs), §4 (spec
   íntegro), §5 (gates/mecánica), §7 (greps).

# MIS-292 — Código completo (Fase 2 — Endurecimiento · M1 · M3 · M4)

Entregable para la **auditoría de código**. El plan (`PLANS/MIS-292-endurecimiento.md`)
obtuvo **GO en la ronda 3** de auditoría de plan; el código obtuvo **GO** en auditoría de
código (ronda 1), con dos sugerencias Baja aplicadas (ver más abajo). Rama:
`mistumonso/mis-292-seguridad-login-fase-2-endurecimiento-m1-m3-m4` (base `main` @ `8daa8df`).

Este directorio contiene **copias byte-idénticas** de los 13 ficheros modificados (mismas rutas
relativas que el repo) y el diff íntegro (`MIS-292.diff`). No se toca la API pública de Convex;
lo único nuevo de servidor no productivo es harness de test (inerte en prod sin
`E2E_TEST_SUPPORT_KEY`).

## Sugerencias Baja de la auditoría de código (aplicadas)
- **S-292-B1** — el e2e de M1 ahora fija el copy exacto: además de `success === false`, afirma
  `error === "Email o contraseña incorrectos"` (`e2e/password-reset.spec.ts`), para atrapar
  regresiones del mensaje. El helper `oversizedLoginAttempt` devuelve `{ success, error? }`.
- **S-292-B2** — corregido el comentario de `convex/testSupport.ts`
  (`countCurrentPasswordChangedNotices`): **sí** existe el cron `cleanup expired reset codes`
  (`convex/crons.ts`, diario 03:05 UTC) que purga filas consumidas; se documenta el falso-rojo
  excepcional si coincidiera con la ventana de polling (probabilidad despreciable, sin falso verde).

## Resumen de cambios

### M1 — Cota de longitud del email en el login
- `convex/lib/rateLimit.ts` — se exportan `MAX_EMAIL_LENGTH = 254` y
  `emailWithinLimits(normalized)` (antes eran copia local en `passwordReset.ts`), compartidos por
  login y recuperación.
- `convex/passwordReset.ts` — importa **solo** `emailWithinLimits` (se eliminan la constante y la
  función locales); mismos dos call sites, sin cambio de comportamiento.
- `convex/auth.ts` — en `loginWithPassword`, tras `normalizeEmailKey` y **antes** de
  `reserveLoginSlot`, guard que devuelve `GENERIC_ERROR` si el email >254; va después del
  `serverKey` (I3). Corta antes de reservar slot, construir claves o tocar `loginAttempts`.

### M3 — Ticket de reseteo en cookie httpOnly
- `src/lib/auth/constants.ts` — `RESET_TICKET_COOKIE_NAME = "reset_ticket"`.
- `src/lib/auth/cookie.ts` — trío `setResetTicketCookie`/`readResetTicketCookie`/
  `clearResetTicketCookie` (molde de `setOAuthStateCookie`): `httpOnly`, `secure` según entorno,
  `sameSite:"lax"`, `path:"/recuperar-contrasena"`, `maxAge` 900 s. Comentario que documenta que
  los 900 s duplican a propósito `TICKET_TTL_MS` y deben cambiarse juntos.
- `src/lib/auth/actions.ts` — `verifyResetCodeAction` escribe la cookie y devuelve
  `{ step:"password" }` (sin `ticket`); `resetPasswordAction` lee el ticket de la cookie y la borra
  tras el éxito, antes del `redirect`; `RecoverActionState` pierde `ticket` (garantía de
  compilación). En errores de validación locales se conserva la cookie (reintento).
- `src/app/(auth)/recuperar-contrasena/RecoverForm.tsx` — se elimina el `<input type="hidden"
  name="ticket">`.

### M4 — Aviso por email de cambio de contraseña
- `convex/lib/resend.ts` — plantilla `passwordChangedHtml(name)` (molde de `passwordResetCodeHtml`,
  con `escapeHtml`) y helper `sendPasswordChangedEmail(to, name)` (errores relanzados solo con el
  estado HTTP).
- `convex/passwordReset.ts` — en `resetPasswordWithTicket`, tras matar sesiones y antes del
  `return`, lee el usuario y programa `deliverPasswordChangedEmail({ email, name, resetId: row._id })`
  con `scheduler.runAfter(0, …)`. `resetId = row._id` correlaciona el aviso con **este** reset. Nuevo
  `internalAction deliverPasswordChangedEmail`: registra el marcador de test (identidad dedicada,
  **antes** del envío) y envía por Resend en `try/catch` con `console.error` sin destinatario ni cuerpo.

### Harness de test (cierra M-A1/M-A2/M-A3 de la auditoría de plan)
- `convex/lib/testIdentity.ts` — `OVERSIZED_TEST_EMAIL`, construido desde `MAX_EMAIL_LENGTH` (>254,
  ya normalizado).
- `convex/schema.ts` — tabla `testPasswordChangedOutbox { email, resetId, createdAt }` con índices
  `by_email` (higiene) y `by_resetId` (identidad de la prueba), separada de `testOutbox`.
- `convex/testSupport.ts`:
  - `countOversizedLoginAttempts(serverKey)` — cuenta filas de `loginAttempts` para las dos claves
    fijas de la identidad sobredimensionada (`<email>` y `loginCounterKey(<email>)`).
  - `recordPasswordChangedNotice({ email, resetId })` — `internalMutation`, inerte sin credencial,
    identidad dedicada, inserta el marcador.
  - `countCurrentPasswordChangedNotices(serverKey, email)` — resuelve el reset actual (fila de
    `passwordResetCodes` con `usedAt` más reciente), cuenta marcadores por `by_resetId`; devuelve 0
    (no lanza) si aún no hay usuario/fila/marcador. Un action diferido de un test anterior lleva un
    `_id` ya borrado (distinto) → no cuenta.
  - `resetTestIdentity` — limpieza añadida: marcadores `by_email` (higiene) + las dos claves oversized.

### E2E
- `e2e/helpers/test-support.ts` — helpers `oversizedLoginAttempt` (devuelve `{ success, error? }`),
  `countOversizedLoginAttempts`, `countCurrentPasswordChangedNotices`; exporta
  `OVERSIZED_TEST_EMAIL`/`MAX_EMAIL_LENGTH`.
- `e2e/password-reset.spec.ts`:
  - **M3**: en el paso de contraseña inspecciona metadatos de la cookie (`httpOnly`, `sameSite`,
    `path`, `expires` ≈ +900 s), ausencia en `document.cookie` y del `input[name="ticket"]`, y que se
    borra tras el reset — sin leer nunca el valor.
  - **M4**: tras el reset, *polling* de `countCurrentPasswordChangedNotices() === 1`.
  - **M1**: test nuevo — `resetTestIdentity` → `oversizedLoginAttempt` → `countOversizedLoginAttempts()
    === 0`, con red de seguridad `OVERSIZED_TEST_EMAIL.length > MAX_EMAIL_LENGTH` y aserción del copy
    exacto `error === "Email o contraseña incorrectos"` (S-292-B1).

## Verificación ejecutada (local, rama de la tarea)

| Gate | Resultado |
| --- | --- |
| `npx tsc --noEmit` (typecheck) | **exit 0** (re-verificado tras S-292-B1/B2) |
| `npm run lint` (ESLint) | **0 errores** (1 warning preexistente en `Avatar.jsx`, ajeno) |
| `npx convex codegen` + `npx convex dev --once` (dev `dutiful-mole-111`) | **OK**, funciones desplegadas a dev |
| `npm run build` (`next build`) | **exit 0** |
| `npx playwright test --project=chromium-secrets` | **29/29 passed** (M1, M3, M4, invariantes, harness) |
| `password-reset.spec.ts` re-run tras S-292-B1/B2 | **2/2 passed** |
| `npm run test:e2e:secret-gate` | **superado** (política de no-captura demostrada) |

Pendiente tras el merge (criterio de cierre del ticket): **deploy a Convex prod** (`greedy-tapir-20`)
para M1+M4 (M3 lo despliega Railway al mergear) y **aceptación manual en prod** del email de aviso.

## Igualdad CODIGO ↔ repo

Los 13 ficheros de este directorio son **byte-idénticos** a los instalados en la rama (verificado con
`diff -q`). `convex/_generated` se excluye a propósito (lo regenera Convex).

## Diff completo (byte-idéntico a lo instalado en la rama)

Íntegro también en `MIS-292.diff`. Excluye `convex/_generated`.

```diff
diff --git a/convex/auth.ts b/convex/auth.ts
index 8914b65..385e1a8 100644
--- a/convex/auth.ts
+++ b/convex/auth.ts
@@ -17,6 +17,7 @@ import {
   LOGIN_EMAIL_VETO_LIMIT,
   LOGIN_IP_LIMIT,
   emailVetoActive,
+  emailWithinLimits,
   isLocked,
   loginCounterKey,
   normalizeEmailKey,
@@ -198,6 +199,14 @@ export const loginWithPassword = action({
       return { success: false as const, error: GENERIC_ERROR };
     }
     const emailKey = normalizeEmailKey(args.email);
+    // MIS-292 (M1): un email fuera del contrato (vacío o >254) se rechaza con el
+    // error genérico ANTES de reservar slot, construir claves o tocar
+    // `loginAttempts` — mismo criterio que passwordReset.ts. Va después del
+    // serverKey (I3, siempre primero) y es indistinguible de credenciales
+    // incorrectas: no revela nada y no escribe filas indexadas sobredimensionadas.
+    if (!emailWithinLimits(emailKey)) {
+      return { success: false as const, error: GENERIC_ERROR };
+    }
     const ipKey = normalizeIpHint(args.ipHint ?? null);
 
     const reserve = await ctx.runMutation(internal.auth.reserveLoginSlot, { emailKey, ipKey });
diff --git a/convex/lib/rateLimit.ts b/convex/lib/rateLimit.ts
index d1015a3..18ec728 100644
--- a/convex/lib/rateLimit.ts
+++ b/convex/lib/rateLimit.ts
@@ -4,6 +4,19 @@ export function normalizeEmailKey(email: string): string {
   return email.trim().toLowerCase();
 }
 
+// MIS-292 (M1): cota de longitud del email, COMPARTIDA por el login (auth.ts) y
+// la recuperación (passwordReset.ts). 254 = longitud máxima de una dirección de
+// email (RFC 5321). Se aplica SIEMPRE sobre la forma ya normalizada y ANTES de
+// construir cualquier clave de rate limit o de tocar `loginAttempts`, para que un
+// email arbitrariamente largo no se convierta en una clave indexada
+// sobredimensionada. Antes vivía como copia local en passwordReset.ts; auth.ts se
+// había quedado fuera de esa disciplina (el hueco que M1 cierra).
+export const MAX_EMAIL_LENGTH = 254;
+
+export function emailWithinLimits(normalized: string): boolean {
+  return normalized.length > 0 && normalized.length <= MAX_EMAIL_LENGTH;
+}
+
 // Cabeceras `x-forwarded-for` sin normalizar son trivialmente falseables por el
 // cliente: toma solo la primera IP (la más cercana al cliente real cuando se
 // confía en el proxy de la plataforma), recorta longitud y descarta cualquier
diff --git a/convex/lib/resend.ts b/convex/lib/resend.ts
index f36e3bc..1be5142 100644
--- a/convex/lib/resend.ts
+++ b/convex/lib/resend.ts
@@ -96,3 +96,63 @@ export async function sendPasswordResetCodeEmail(
     throw new Error(`Resend respondió ${res.status}`);
   }
 }
+
+// MIS-292 (M4): aviso de que la contraseña de la cuenta acaba de cambiar. No
+// lleva ningún secreto ni enlace de acción — solo informa, para que un cambio no
+// consentido (si un atacante llegara a completar el flujo de recuperación) deje
+// una señal al usuario legítimo. Mismo estilo que passwordResetCodeHtml.
+function passwordChangedHtml(name: string): string {
+  const safeName = escapeHtml(name);
+  return `<!doctype html>
+<html lang="es">
+  <body style="margin:0;padding:0;background-color:#FAFAFA;font-family:'Inter',system-ui,Arial,sans-serif;">
+    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FAFAFA;padding:32px 16px;">
+      <tr>
+        <td align="center">
+          <table role="presentation" width="100%" style="max-width:420px;background-color:#FFFFFF;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;">
+            <tr>
+              <td style="background-color:#3B5266;padding:20px 24px;">
+                <span style="color:#FFFFFF;font-size:16px;font-weight:700;">Vibe Coder CRM</span>
+              </td>
+            </tr>
+            <tr>
+              <td style="padding:28px 24px;">
+                <p style="margin:0 0 8px;color:#1A1D24;font-size:15px;">Hola${safeName ? ` ${safeName}` : ""},</p>
+                <p style="margin:0 0 20px;color:#1A1D24;font-size:15px;">
+                  Te confirmamos que la contraseña de tu cuenta se acaba de cambiar. Por
+                  seguridad, se han cerrado todas las sesiones abiertas.
+                </p>
+                <p style="margin:0;color:#6B7280;font-size:13px;">
+                  Si no has sido tú, restablece la contraseña de inmediato desde
+                  «Recuperar contraseña» y contacta con el administrador.
+                </p>
+              </td>
+            </tr>
+          </table>
+        </td>
+      </tr>
+    </table>
+  </body>
+</html>`;
+}
+
+// Como sendPasswordResetCodeEmail: los errores de Resend se relanzan SIN código,
+// destinatario ni cuerpo — solo el estado HTTP.
+export async function sendPasswordChangedEmail(to: string, name: string): Promise<void> {
+  const res = await fetch(RESEND_API_URL, {
+    method: "POST",
+    headers: {
+      Authorization: `Bearer ${getResendApiKey()}`,
+      "Content-Type": "application/json",
+    },
+    body: JSON.stringify({
+      from: getResendFrom(),
+      to,
+      subject: "Tu contraseña ha cambiado",
+      html: passwordChangedHtml(name),
+    }),
+  });
+  if (!res.ok) {
+    throw new Error(`Resend respondió ${res.status}`);
+  }
+}
diff --git a/convex/lib/testIdentity.ts b/convex/lib/testIdentity.ts
index 5a2e2b6..db5e6a9 100644
--- a/convex/lib/testIdentity.ts
+++ b/convex/lib/testIdentity.ts
@@ -1,3 +1,5 @@
+import { MAX_EMAIL_LENGTH } from "./rateLimit";
+
 // MIS-286: identidad dedicada para las pruebas e2e de recuperación de contraseña.
 //
 // Vive en un único sitio porque la comparten dos módulos que deben coincidir
@@ -25,3 +27,10 @@ export const TEST_SUPPORT_ENV_VAR = "E2E_TEST_SUPPORT_KEY";
 // (módulo ligero, sin dependencias de servidor) para que el spec e2e la importe
 // sin arrastrar el grafo de convex/testSupport.
 export const TEST_LOGIN_IP = "203.0.113.42";
+
+// MIS-292 (M1): identidad sintética FIJA para la prueba determinista de la cota de
+// email en el login. Se construye a partir de MAX_EMAIL_LENGTH (no un literal
+// suelto) para que no pueda quedar por debajo del límite si alguien cambia el
+// sufijo. Ya normalizada (minúsculas, sin espacios): normalizeEmailKey la deja
+// igual y emailWithinLimits da `false`.
+export const OVERSIZED_TEST_EMAIL = `${"a".repeat(MAX_EMAIL_LENGTH + 1)}@oversized.test.local`;
diff --git a/convex/passwordReset.ts b/convex/passwordReset.ts
index 19a94a3..e90ae08 100644
--- a/convex/passwordReset.ts
+++ b/convex/passwordReset.ts
@@ -19,26 +19,24 @@ import {
   RESET_REQUEST_LIMIT,
   RESET_CODE_LIMIT,
   RESET_IP_LIMIT,
+  emailWithinLimits,
   isLocked,
   normalizeEmailKey,
   normalizeIpHint,
   recordFailedAttempt,
   resetAttempts,
 } from "./lib/rateLimit";
-import { sendPasswordResetCodeEmail } from "./lib/resend";
+import { sendPasswordResetCodeEmail, sendPasswordChangedEmail } from "./lib/resend";
 import { RESET_TEST_EMAIL } from "./lib/testIdentity";
 
 const CODE_TTL_MS = 15 * 60 * 1000;
 const TICKET_TTL_MS = 15 * 60 * 1000;
 const MAX_CODE_ATTEMPTS = 5;
-const MAX_EMAIL_LENGTH = 254;
 const CODE_FORMAT = /^\d{6}$/;
 const GENERIC_CODE_ERROR = "Código incorrecto o caducado";
 const TICKET_EXPIRED_ERROR = "La sesión de recuperación caducó, vuelve a empezar";
-
-function emailWithinLimits(normalized: string): boolean {
-  return normalized.length > 0 && normalized.length <= MAX_EMAIL_LENGTH;
-}
+// MIS-292 (M1): `emailWithinLimits`/`MAX_EMAIL_LENGTH` se movieron a
+// ./lib/rateLimit para compartirlos con el login. Se importa solo la función.
 
 // 1. Mutation pública: rate-limita y programa el envío diferido. Nunca toca
 // `users` ni espera a Resend — el tiempo de respuesta no debe delatar si el
@@ -290,10 +288,59 @@ export const resetPasswordWithTicket = mutation({
       await ctx.db.delete(session._id);
     }
 
+    // MIS-292 (M4): avisar por email de que la contraseña cambió. El envío exige
+    // `fetch`, que solo es posible en un action → se programa un internalAction.
+    // `resetId: row._id` correlaciona el aviso con ESTE reset concreto (da
+    // causalidad al marcador de test). Se programa DESPUÉS del cambio ya
+    // aplicado, en la MISMA transacción: la entrega es best-effort (el action
+    // captura sus errores), pero un fallo al PROGRAMAR aborta el cambio
+    // (fail-closed deseado). Solo se llega aquí tras consumir un ticket válido.
+    const user = await ctx.db.get(row.userId);
+    if (user) {
+      await ctx.scheduler.runAfter(0, internal.passwordReset.deliverPasswordChangedEmail, {
+        email: user.email,
+        name: user.name,
+        resetId: row._id,
+      });
+    }
+
     return { ok: true as const };
   },
 });
 
+// 6. internalAction (M4): envía el aviso de cambio de contraseña. Además de la
+// entrega por Resend, deja un marcador determinista AISLADO para la identidad
+// dedicada (solo con la credencial del harness; en prod esa env var no existe).
+// El marcador se registra ANTES del intento de Resend, para que un fallo externo
+// del proveedor no haga indeterminista la prueba de "se programó y ejecutó el
+// aviso". La entrega real solo se valida con la aceptación manual en producción.
+export const deliverPasswordChangedEmail = internalAction({
+  args: {
+    email: v.string(),
+    name: v.string(),
+    resetId: v.id("passwordResetCodes"),
+  },
+  returns: v.null(),
+  handler: async (ctx, args) => {
+    if (normalizeEmailKey(args.email) === RESET_TEST_EMAIL) {
+      await ctx.runMutation(internal.testSupport.recordPasswordChangedNotice, {
+        email: args.email,
+        resetId: args.resetId,
+      });
+    }
+
+    try {
+      await sendPasswordChangedEmail(args.email, args.name);
+    } catch (err) {
+      console.error(
+        "deliverPasswordChangedEmail: fallo al enviar con Resend",
+        err instanceof Error ? err.message : err,
+      );
+    }
+    return null;
+  },
+});
+
 // 6. Cron diario (convex/crons.ts): purga filas caducadas para no acumular
 // basura indefinidamente. No es un requisito de seguridad (los campos ya
 // caducados se tratan como inválidos en cualquier lectura), solo higiene.
diff --git a/convex/schema.ts b/convex/schema.ts
index d7550f5..5e8d628 100644
--- a/convex/schema.ts
+++ b/convex/schema.ts
@@ -281,4 +281,20 @@ export default defineSchema({
     key: v.string(),
     count: v.number(),
   }).index("by_key", ["key"]),
+
+  // MIS-292 (M4): marcador EXCLUSIVO de pruebas del aviso "contraseña cambiada".
+  // Separado de testOutbox a propósito (no contamina getLastResetCode). Solo lo
+  // llena la identidad dedicada y solo con la credencial del harness configurada
+  // (en prod esa env var no existe → tabla vacía por construcción). `resetId`
+  // correlaciona cada marcador con la fila de reset consumida que lo originó
+  // (id que Convex nunca reutiliza), para que un action diferido de un test
+  // anterior no pueda atribuirse al reset actual: la prueba cuenta por
+  // `by_resetId`, no por email. `by_email` es solo para la limpieza de higiene.
+  testPasswordChangedOutbox: defineTable({
+    email: v.string(),
+    resetId: v.id("passwordResetCodes"),
+    createdAt: v.number(),
+  })
+    .index("by_email", ["email"])
+    .index("by_resetId", ["resetId"]),
 });
diff --git a/convex/testSupport.ts b/convex/testSupport.ts
index 3c7584d..a99505b 100644
--- a/convex/testSupport.ts
+++ b/convex/testSupport.ts
@@ -33,6 +33,7 @@ import { generateOpaqueToken } from "./lib/token";
 import { loginCounterKey, normalizeEmailKey, resetAttempts } from "./lib/rateLimit";
 import { validatePassword, CURRENT_PASSWORD_POLICY_VERSION } from "./lib/passwordPolicy";
 import {
+  OVERSIZED_TEST_EMAIL,
   RESET_TEST_EMAIL,
   SEED_TEST_EMAIL,
   TEST_LOGIN_IP,
@@ -137,9 +138,22 @@ export const resetTestIdentity = mutation({
       .collect()) {
       await ctx.db.delete(entry._id);
     }
+    // MIS-292 (M4): higiene del marcador de aviso — NO es la fuente de identidad
+    // de la prueba (esa es `resetId`), solo evita acumular filas huérfanas.
+    for (const entry of await ctx.db
+      .query("testPasswordChangedOutbox")
+      .withIndex("by_email", (q) => q.eq("email", RESET_TEST_EMAIL))
+      .collect()) {
+      await ctx.db.delete(entry._id);
+    }
     for (const key of rateLimitKeysForTestIdentity()) {
       await resetAttempts(ctx, key);
     }
+    // MIS-292 (M1): limpia las dos claves de la identidad sintética sobredimensionada,
+    // para que la prueba de "cero filas" sea determinista aunque una corrida previa
+    // (código vulnerable) hubiera dejado filas.
+    await resetAttempts(ctx, OVERSIZED_TEST_EMAIL);
+    await resetAttempts(ctx, loginCounterKey(OVERSIZED_TEST_EMAIL));
     // MIS-290 (prueba 8): contador de KDF a cero — solo la clave KDF_COUNTER_KEY
     // por su índice (no un scan de toda la tabla).
     const kdfRow = await ctx.db
@@ -378,3 +392,96 @@ export const recordOutbox = internalMutation({
     return null;
   },
 });
+
+// MIS-292 (M1): prueba determinista de "cero filas". Cuenta las filas de
+// `loginAttempts` para EXACTAMENTE las dos claves derivadas de la identidad
+// sintética sobredimensionada — la propia (`<email>`, capa de veto) y la de
+// telemetría (`login-counter:<email>`, vía el helper real, no un prefijo a mano).
+// No acepta clave arbitraria: no es una introspección genérica. Tras el guard M1
+// el intento de login con ese email debe dejar esto en 0 (con el código
+// vulnerable sería ≥1, porque llegaría a finalizeLogin).
+export const countOversizedLoginAttempts = query({
+  args: { serverKey: v.string() },
+  returns: v.number(),
+  handler: async (ctx, args) => {
+    assertTestKey(args.serverKey);
+    const keys = [OVERSIZED_TEST_EMAIL, loginCounterKey(OVERSIZED_TEST_EMAIL)];
+    let total = 0;
+    for (const key of keys) {
+      const rows = await ctx.db
+        .query("loginAttempts")
+        .withIndex("by_emailKey", (q) => q.eq("emailKey", key))
+        .collect();
+      total += rows.length;
+    }
+    return total;
+  },
+});
+
+// MIS-292 (M4): registra el marcador del aviso de cambio de contraseña. Inerte
+// sin la credencial del harness (en prod la env var no existe). Restringido a la
+// identidad dedicada. `resetId` correlaciona el marcador con la fila de reset
+// consumida que lo originó (la lo pasa deliverPasswordChangedEmail).
+export const recordPasswordChangedNotice = internalMutation({
+  args: { email: v.string(), resetId: v.id("passwordResetCodes") },
+  returns: v.null(),
+  handler: async (ctx, args) => {
+    if (!process.env[TEST_SUPPORT_ENV_VAR]) return null;
+    assertDedicatedIdentity(args.email);
+
+    await ctx.db.insert("testPasswordChangedOutbox", {
+      email: RESET_TEST_EMAIL,
+      resetId: args.resetId,
+      createdAt: Date.now(),
+    });
+    return null;
+  },
+});
+
+// MIS-292 (M4): nº de marcadores del aviso correlacionados con EL reset actual —
+// no un contador global por email (eso permitía que un action diferido de un test
+// anterior se atribuyera al reset actual). Resuelve el reset actual dentro del
+// harness: la fila de `passwordResetCodes` de la identidad con `usedAt` más
+// reciente (tras solicitar y consumir el código, hay exactamente una consumida);
+// cuenta los marcadores con ese `resetId` por el índice `by_resetId`. Un action
+// diferido de un test anterior lleva el `_id` de una fila ya borrada (id distinto,
+// Convex no reutiliza ids) → no cuenta. Devuelve 0 (no lanza) cuando aún no hay
+// usuario, fila consumida ni marcador, para que el polling represente
+// naturalmente "aún no ejecutado".
+//
+// NOTA de diagnóstico: el cron `cleanup expired reset codes` (convex/crons.ts,
+// diario a las 03:05 UTC) borra las filas de reset ya consumidas. Si ESA ejecución
+// diaria coincidiera con la ventana de polling (10 s) de un test, la resolución
+// del reset actual fallaría y el test daría un falso rojo excepcional. La
+// probabilidad es despreciable (un instante fijo al día) y no permite un falso
+// verde; queda documentado aquí para facilitar el diagnóstico si ocurriera.
+export const countCurrentPasswordChangedNotices = query({
+  args: { serverKey: v.string(), email: v.string() },
+  returns: v.number(),
+  handler: async (ctx, args) => {
+    assertTestKey(args.serverKey);
+    assertDedicatedIdentity(args.email);
+
+    const user = await findTestUser(ctx);
+    if (!user) return 0;
+
+    const consumed = (
+      await ctx.db
+        .query("passwordResetCodes")
+        .withIndex("by_user", (q) => q.eq("userId", user._id))
+        .collect()
+    ).filter((row) => row.usedAt !== undefined);
+    if (consumed.length === 0) return 0;
+
+    let current = consumed[0];
+    for (const row of consumed) {
+      if ((row.usedAt as number) > (current.usedAt as number)) current = row;
+    }
+
+    const markers = await ctx.db
+      .query("testPasswordChangedOutbox")
+      .withIndex("by_resetId", (q) => q.eq("resetId", current._id))
+      .collect();
+    return markers.length;
+  },
+});
diff --git a/e2e/helpers/test-support.ts b/e2e/helpers/test-support.ts
index c782ae1..6cee50d 100644
--- a/e2e/helpers/test-support.ts
+++ b/e2e/helpers/test-support.ts
@@ -5,7 +5,8 @@
 // aparecer en una traza ni en un screenshot.
 
 import { convexClient, api } from "./convex-client";
-import { RESET_TEST_EMAIL, TEST_LOGIN_IP } from "../../convex/lib/testIdentity";
+import { RESET_TEST_EMAIL, TEST_LOGIN_IP, OVERSIZED_TEST_EMAIL } from "../../convex/lib/testIdentity";
+import { MAX_EMAIL_LENGTH } from "../../convex/lib/rateLimit";
 
 function testSupportKey(): string {
   const key = process.env.E2E_TEST_SUPPORT_KEY;
@@ -147,4 +148,33 @@ export async function getPolicyVersion(): Promise<number | null> {
   });
 }
 
-export { RESET_TEST_EMAIL, TEST_LOGIN_IP };
+// MIS-292 (M1): intento de login con la identidad sintética sobredimensionada
+// (>254). El guard debe cortarlo con el error genérico ANTES de tocar
+// loginAttempts. serverKey correcto a propósito: así la ejecución LLEGA al guard
+// (con un serverKey inválido se cortaría antes y no probaría M1).
+export async function oversizedLoginAttempt(): Promise<{ success: boolean; error?: string }> {
+  return await convexClient().action(api.auth.loginWithPassword, {
+    email: OVERSIZED_TEST_EMAIL,
+    password: "irrelevante-por-el-guard",
+    serverKey: authServerKey(),
+  });
+}
+
+// MIS-292 (M1): nº de filas de loginAttempts para las dos claves de la identidad
+// sobredimensionada (`<email>` y `login-counter:<email>`). Debe ser 0 tras el guard.
+export async function countOversizedLoginAttempts(): Promise<number> {
+  return await convexClient().query(api.testSupport.countOversizedLoginAttempts, {
+    serverKey: testSupportKey(),
+  });
+}
+
+// MIS-292 (M4): nº de avisos de cambio de contraseña correlacionados con EL reset
+// actual (no un contador global por email).
+export async function countCurrentPasswordChangedNotices(): Promise<number> {
+  return await convexClient().query(api.testSupport.countCurrentPasswordChangedNotices, {
+    serverKey: testSupportKey(),
+    email: RESET_TEST_EMAIL,
+  });
+}
+
+export { RESET_TEST_EMAIL, TEST_LOGIN_IP, OVERSIZED_TEST_EMAIL, MAX_EMAIL_LENGTH };
diff --git a/e2e/password-reset.spec.ts b/e2e/password-reset.spec.ts
index e5179fc..bcd5bc4 100644
--- a/e2e/password-reset.spec.ts
+++ b/e2e/password-reset.spec.ts
@@ -11,7 +11,18 @@
 // secreto").
 import { randomBytes } from "node:crypto";
 import { test, expect } from "./helpers/secure-test";
-import { RESET_TEST_EMAIL, getLastResetCode, loginSucceeds, resetTestIdentity } from "./helpers/test-support";
+import {
+  RESET_TEST_EMAIL,
+  OVERSIZED_TEST_EMAIL,
+  MAX_EMAIL_LENGTH,
+  getLastResetCode,
+  loginSucceeds,
+  resetTestIdentity,
+  oversizedLoginAttempt,
+  countOversizedLoginAttempts,
+  countCurrentPasswordChangedNotices,
+} from "./helpers/test-support";
+import { RESET_TICKET_COOKIE_NAME } from "../src/lib/auth/constants";
 
 function freshPassword(): string {
   return randomBytes(24).toString("base64url");
@@ -45,6 +56,25 @@ test.describe("recuperación de contraseña por código (MIS-285)", () => {
     await page.getByRole("button", { name: "Continuar" }).click();
 
     await expect(page.getByLabel("Nueva contraseña")).toBeVisible();
+
+    // MIS-292 (M3): el ticket vive SOLO en una cookie httpOnly, no en el cliente.
+    // Se inspeccionan METADATOS de la cookie (nunca su valor).
+    const ticketCookie = (await page.context().cookies()).find(
+      (c) => c.name === RESET_TICKET_COOKIE_NAME,
+    );
+    expect(ticketCookie, "la cookie del ticket debe existir en el paso de contraseña").toBeTruthy();
+    expect(ticketCookie!.httpOnly).toBe(true);
+    expect(ticketCookie!.sameSite).toBe("Lax");
+    expect(ticketCookie!.path).toBe("/recuperar-contrasena");
+    // maxAge 15 min → expires ≈ ahora + 900 s (con tolerancia amplia).
+    const nowSec = Date.now() / 1000;
+    expect(ticketCookie!.expires).toBeGreaterThan(nowSec + 800);
+    expect(ticketCookie!.expires).toBeLessThan(nowSec + 1000);
+    // Inaccesible a JavaScript y sin hidden input en el DOM.
+    const jsCookies = await page.evaluate(() => document.cookie);
+    expect(jsCookies).not.toContain(RESET_TICKET_COOKIE_NAME);
+    await expect(page.locator('input[name="ticket"]')).toHaveCount(0);
+
     await page.getByLabel("Nueva contraseña").fill(newPassword);
     await page.getByLabel("Repite la contraseña").fill(newPassword);
     await page.getByRole("button", { name: "Guardar nueva contraseña" }).click();
@@ -54,5 +84,41 @@ test.describe("recuperación de contraseña por código (MIS-285)", () => {
 
     expect(await loginSucceeds(newPassword)).toBe(true);
     expect(await loginSucceeds(oldPassword)).toBe(false);
+
+    // MIS-292 (M3): tras el reset con éxito, la cookie del ticket se borró.
+    const cookieAfter = (await page.context().cookies()).find(
+      (c) => c.name === RESET_TICKET_COOKIE_NAME,
+    );
+    expect(cookieAfter, "la cookie del ticket debe borrarse tras el reset").toBeFalsy();
+
+    // MIS-292 (M4): el cambio consumado programó y ejecutó EXACTAMENTE un aviso,
+    // correlacionado con este reset (no un contador global por email). Polling
+    // porque deliverPasswordChangedEmail corre en un scheduler asíncrono.
+    await expect
+      .poll(async () => await countCurrentPasswordChangedNotices(), {
+        message: "esperando a que deliverPasswordChangedEmail registre el marcador del aviso",
+        timeout: 10_000,
+      })
+      .toBe(1);
+  });
+
+  // MIS-292 (M1): un email >254 en el login se rechaza ANTES de tocar
+  // loginAttempts. La prueba es determinista: cuenta filas para las dos claves
+  // de la identidad sobredimensionada y exige 0 (con el código vulnerable
+  // llegaría a finalizeLogin y dejaría ≥1).
+  test("login con email >254 no escribe ninguna fila en loginAttempts (M1)", async () => {
+    // Red de seguridad del fixture: que un cambio de sufijo no lo deje válido.
+    expect(OVERSIZED_TEST_EMAIL.length).toBeGreaterThan(MAX_EMAIL_LENGTH);
+
+    await resetTestIdentity(); // limpia también las dos claves oversized
+    expect(await countOversizedLoginAttempts()).toBe(0);
+
+    const result = await oversizedLoginAttempt();
+    expect(result.success).toBe(false);
+    // S-292-B1: fija el contrato del copy exacto, no solo el booleano, para
+    // atrapar futuras regresiones del mensaje (GENERIC_ERROR en auth.ts).
+    expect(result.error).toBe("Email o contraseña incorrectos");
+
+    expect(await countOversizedLoginAttempts()).toBe(0);
   });
 });
diff --git a/src/app/(auth)/recuperar-contrasena/RecoverForm.tsx b/src/app/(auth)/recuperar-contrasena/RecoverForm.tsx
index 17f3ab7..8f0d613 100644
--- a/src/app/(auth)/recuperar-contrasena/RecoverForm.tsx
+++ b/src/app/(auth)/recuperar-contrasena/RecoverForm.tsx
@@ -125,7 +125,8 @@ export function RecoverForm() {
 
       {state.step === "password" && (
         <form action={handlePasswordSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
-          <input type="hidden" name="ticket" value={state.ticket} />
+          {/* MIS-292 (M3): el ticket ya no viaja en un hidden input; va en una
+              cookie httpOnly que la Server Action lee server-side. */}
           <Input
             label="Nueva contraseña"
             name="newPassword"
diff --git a/src/lib/auth/actions.ts b/src/lib/auth/actions.ts
index 875f7ba..3430300 100644
--- a/src/lib/auth/actions.ts
+++ b/src/lib/auth/actions.ts
@@ -3,7 +3,14 @@
 import { redirect } from "next/navigation";
 import { fetchAction, fetchMutation } from "convex/nextjs";
 import { api } from "../../../convex/_generated/api";
-import { clearSessionCookie, readSessionToken, setSessionCookie } from "./cookie";
+import {
+  clearSessionCookie,
+  readSessionToken,
+  setSessionCookie,
+  setResetTicketCookie,
+  readResetTicketCookie,
+  clearResetTicketCookie,
+} from "./cookie";
 import { getClientIp } from "./clientIp";
 import { landingPathForRole } from "./dal";
 
@@ -52,10 +59,14 @@ export async function logoutAction(): Promise<void> {
 // MIS-285: recuperación de contraseña por código (OTP). Un único tipo de
 // estado para las 3 actions — cada una avanza `step` según el resultado, y
 // RecoverForm.tsx (Client Component) decide qué paso pintar a partir de él.
+// MIS-292 (M3): el variante "password" ya NO lleva `ticket`. El ticket viaja por
+// una cookie httpOnly (ver cookie.ts), fuera del alcance de JS; este cambio de
+// tipo es la garantía a nivel de compilación de que no vuelve al cliente en el
+// estado serializado.
 export type RecoverActionState =
   | { step: "email" }
   | { step: "code"; email: string; error?: string }
-  | { step: "password"; ticket: string; error?: string };
+  | { step: "password"; error?: string };
 
 // Anti-enumeración: SIEMPRE avanza a "code", exista o no la cuenta — el
 // backend (requestPasswordResetCode) ya responde con el mismo timing en
@@ -95,7 +106,9 @@ export async function verifyResetCodeAction(
   if (!result.ok) {
     return { step: "code", email, error: result.error };
   }
-  return { step: "password", ticket: result.ticket };
+  // MIS-292 (M3): el ticket va a una cookie httpOnly, no al estado del cliente.
+  await setResetTicketCookie(result.ticket);
+  return { step: "password" };
 }
 
 const PASSWORD_MISMATCH_ERROR = "Las contraseñas no coinciden";
@@ -105,15 +118,18 @@ export async function resetPasswordAction(
   _prevState: RecoverActionState,
   formData: FormData,
 ): Promise<RecoverActionState> {
-  const ticket = String(formData.get("ticket") ?? "");
+  // MIS-292 (M3): el ticket se lee de la cookie httpOnly, no del FormData.
+  const ticket = (await readResetTicketCookie()) ?? "";
   const newPassword = String(formData.get("newPassword") ?? "");
   const confirmPassword = String(formData.get("confirmPassword") ?? "");
 
+  // Errores de validación LOCALES (previos a Convex): se conserva la cookie para
+  // permitir reintentar dentro de los 15 min; solo se borra tras el éxito.
   if (newPassword !== confirmPassword) {
-    return { step: "password", ticket, error: PASSWORD_MISMATCH_ERROR };
+    return { step: "password", error: PASSWORD_MISMATCH_ERROR };
   }
   if (newPassword.length < 8 || newPassword.length > 128) {
-    return { step: "password", ticket, error: PASSWORD_POLICY_ERROR };
+    return { step: "password", error: PASSWORD_POLICY_ERROR };
   }
 
   const result = await fetchMutation(api.passwordReset.resetPasswordWithTicket, {
@@ -123,8 +139,10 @@ export async function resetPasswordAction(
   });
 
   if (!result.ok) {
-    return { step: "password", ticket, error: result.error };
+    return { step: "password", error: result.error };
   }
 
+  // MIS-292 (M3): ticket consumido → borra la cookie ANTES del redirect.
+  await clearResetTicketCookie();
   redirect("/login?reset=ok");
 }
diff --git a/src/lib/auth/constants.ts b/src/lib/auth/constants.ts
index a2ca7d4..582e10a 100644
--- a/src/lib/auth/constants.ts
+++ b/src/lib/auth/constants.ts
@@ -6,3 +6,10 @@ export const SESSION_COOKIE_NAME = "session";
 // MIS-260: cookie de corta duración (10 min), solo para el flujo
 // /api/auth/google/* — nunca contiene identidad, solo el nonce anti-CSRF.
 export const OAUTH_STATE_COOKIE_NAME = "google_oauth_state";
+
+// MIS-292 (M3): cookie httpOnly de corta duración (15 min) que transporta el
+// ticket de reseteo entre verificar el código y fijar la nueva contraseña.
+// Antes viajaba en estado React + <input type="hidden">, accesible a JS; ahora
+// solo existe aquí, fuera del alcance del navegador. Scope al flujo de
+// recuperación por su `path`.
+export const RESET_TICKET_COOKIE_NAME = "reset_ticket";
diff --git a/src/lib/auth/cookie.ts b/src/lib/auth/cookie.ts
index 1b816b3..284941b 100644
--- a/src/lib/auth/cookie.ts
+++ b/src/lib/auth/cookie.ts
@@ -1,5 +1,9 @@
 import { cookies } from "next/headers";
-import { SESSION_COOKIE_NAME, OAUTH_STATE_COOKIE_NAME } from "./constants";
+import {
+  SESSION_COOKIE_NAME,
+  OAUTH_STATE_COOKIE_NAME,
+  RESET_TICKET_COOKIE_NAME,
+} from "./constants";
 
 const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 días — sesión persistente
 
@@ -65,3 +69,40 @@ export async function clearOAuthStateCookie(): Promise<void> {
     maxAge: 0,
   });
 }
+
+// MIS-292 (M3): ticket de reseteo. Vivía en estado React + <input type="hidden">
+// (accesible a JS); ahora solo en esta cookie httpOnly, con el mismo molde que la
+// de OAuth state: efímera y scoped al flujo de recuperación por su `path` (las
+// Server Actions del wizard hacen POST a /recuperar-contrasena, así que la cookie
+// viaja en verify→reset).
+//
+// OJO: estos 15 min DUPLICAN a propósito el TTL del ticket en Convex
+// (TICKET_TTL_MS en convex/passwordReset.ts). Si allí cambia, cámbialo aquí.
+const RESET_TICKET_TTL_SECONDS = 15 * 60;
+
+export async function setResetTicketCookie(ticket: string): Promise<void> {
+  const cookieStore = await cookies();
+  cookieStore.set(RESET_TICKET_COOKIE_NAME, ticket, {
+    httpOnly: true,
+    secure: process.env.NODE_ENV === "production",
+    sameSite: "lax",
+    path: "/recuperar-contrasena",
+    maxAge: RESET_TICKET_TTL_SECONDS,
+  });
+}
+
+export async function readResetTicketCookie(): Promise<string | null> {
+  const cookieStore = await cookies();
+  return cookieStore.get(RESET_TICKET_COOKIE_NAME)?.value ?? null;
+}
+
+export async function clearResetTicketCookie(): Promise<void> {
+  const cookieStore = await cookies();
+  cookieStore.set(RESET_TICKET_COOKIE_NAME, "", {
+    httpOnly: true,
+    secure: process.env.NODE_ENV === "production",
+    sameSite: "lax",
+    path: "/recuperar-contrasena",
+    maxAge: 0,
+  });
+}
```

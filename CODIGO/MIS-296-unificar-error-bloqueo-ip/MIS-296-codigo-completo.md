# MIS-296 — Código completo (B7 · unificar el error de bloqueo por IP con el genérico)

Entregable para la **auditoría de código**. Plan `PLANS/MIS-296-unificar-error-bloqueo-ip.md`
(**GO** de auditoría de plan, ronda 1). Rama:
`mistumonso/mis-296-login-unificar-el-error-de-bloqueo-por-ip-con-el-generico-b7` (base `main` @ `fa5cb28`).

Copias **byte-idénticas** de los 3 ficheros modificados (mismas rutas) + diff íntegro
(`MIS-296.diff`). Sin cambio de schema, sin cambio de la firma pública de `loginWithPassword`,
sin frontend. Código de producto → **deploy a Convex prod** tras merge.

## Sugerencias Baja de la auditoría de plan (aplicadas)
- **S-296-B1** — `loginResult` (`e2e/helpers/test-support.ts`) se tipa como **unión discriminada**
  `{ success: true } | { success: false; error: string }`, para que TS obligue a comprobar `error`
  solo en los fallos.
- **S-296-B2** — en el e2e de cuota por IP (`e2e/test-support.spec.ts`) se **materializa el rechazo
  único**: `const rejected = results.filter((r): r is {success:false;error:string} => !r.success)`,
  se exige `length === 1` y el texto exacto de `GENERIC_ERROR` sobre ese elemento, y se comprueba
  que **ningún** resultado lleva el copy antiguo `"Demasiados intentos…"`.

## Cambios

### `convex/auth.ts`
1. **`reserveResultValidator` / `ReserveResult`** — la rama bloqueada lleva ahora
   `reason: "ip" | "email"` (solo para el log del servidor; nunca sale al cliente).
2. **`reserveLoginSlot`** — `return { blocked: true, reason: "ip" }` (bloqueo por IP) y
   `return { blocked: true, reason: "email" }` (veto de email, si el interruptor está activo).
3. **`loginWithPassword`** — el camino de bloqueo hace `console.warn` con la **capa** (`ip`/`email`,
   sin IP, email, contraseña ni token) y devuelve **`GENERIC_ERROR`** (antes `LOCKED_ERROR`).
4. **`LOCKED_ERROR` retirado** del módulo (ya sin usos).

Resultado: la respuesta del login **no distingue** un bloqueo de unas credenciales incorrectas;
el motivo real queda solo en los logs. `LOCKED_ERROR` desaparece por completo de la respuesta.

### E2E
- `e2e/helpers/test-support.ts` — tipo de retorno de `loginResult` como unión discriminada (S-296-B1).
- `e2e/test-support.spec.ts` — aserciones del mensaje en el test de cuota por IP (S-296-B2).

## Fuera de alcance
- `scripts/login-verify/*` mantiene su **propia** copia de `LOCKED_ERROR` (clasificador de la
  secuencia de veto del ejecutor de MIS-295); no importa de `auth.ts` ni afecta a la respuesta de
  producto. Su limpieza va con la retirada del interruptor de veto en Fase 3 (MIS-293).
- No se toca el interruptor `LOGIN_EMAIL_VETO`, el schema ni el copy de `GENERIC_ERROR`.

## Verificación ejecutada (local, rama de la tarea)

| Gate | Resultado |
| --- | --- |
| `npx tsc --noEmit` | **exit 0** |
| `npm run lint` | **0 errores** (1 warning preexistente en `Avatar.jsx`, ajeno) |
| `npx convex dev --once` (dev `dutiful-mole-111`) | **OK** |
| `npx playwright test test-support.spec.ts --project=chromium-secrets` | **7/7 passed** |
| `npm run build` | **exit 0** |

Evidencia del comportamiento en los logs del e2e (sin PII):
`[login] rechazo por bloqueo de rate limit (capa=ip)` y `(capa=email)`.

Pendiente tras el merge: **deploy a Convex prod** (`greedy-tapir-20`) + smoke de que un login fallido
normal sigue devolviendo el genérico (no se provoca un bloqueo real en prod).

## Igualdad CODIGO ↔ repo
Los 3 ficheros de este directorio son **byte-idénticos** a los instalados en la rama (`diff -q`).
`convex/_generated` se excluye (lo regenera Convex; sin cambios textuales).

## Diff completo (byte-idéntico a lo instalado)

Íntegro también en `MIS-296.diff`.

```diff
diff --git a/convex/auth.ts b/convex/auth.ts
index 385e1a8..ac07283 100644
--- a/convex/auth.ts
+++ b/convex/auth.ts
@@ -29,7 +29,9 @@ import { CURRENT_PASSWORD_POLICY_VERSION } from "./lib/passwordPolicy";
 import { RESET_TEST_EMAIL, TEST_SUPPORT_ENV_VAR } from "./lib/testIdentity";
 
 const GENERIC_ERROR = "Email o contraseña incorrectos";
-const LOCKED_ERROR = "Demasiados intentos, inténtalo de nuevo en unos minutos";
+// MIS-296 (B7): `LOCKED_ERROR` retirado. La respuesta del login NO distingue un
+// bloqueo (por IP) de unas credenciales incorrectas — ambos devuelven
+// GENERIC_ERROR. El motivo real del bloqueo queda solo en el log del servidor.
 
 // MIS-260: mensaje único para CUALQUIER fallo del flujo de Google (state
 // inválido, error/cancelación de Google, email no verificado, serverKey
@@ -66,11 +68,13 @@ type LoginResult =
 // aquí y solo las primeras `LOGIN_IP_LIMIT.maxAttempts` no quedan bloqueadas.
 // Unión discriminada: cuando está bloqueada no fabrica hash ni huella.
 const reserveResultValidator = v.union(
-  v.object({ blocked: v.literal(true) }),
+  // MIS-296 (B7): `reason` es SOLO para el log del servidor (motivo real del
+  // bloqueo). No sale nunca al cliente: loginWithPassword responde genérico.
+  v.object({ blocked: v.literal(true), reason: v.union(v.literal("ip"), v.literal("email")) }),
   v.object({ blocked: v.literal(false), hash: v.string(), fingerprint: v.string() }),
 );
 type ReserveResult =
-  | { blocked: true }
+  | { blocked: true; reason: "ip" | "email" }
   | { blocked: false; hash: string; fingerprint: string };
 
 export const reserveLoginSlot = internalMutation({
@@ -79,12 +83,12 @@ export const reserveLoginSlot = internalMutation({
   handler: async (ctx, args): Promise<ReserveResult> => {
     // Capa por IP (I5): si ya está bloqueada, no se consume más.
     if (args.ipKey && (await isLocked(ctx, `ip:${args.ipKey}`))) {
-      return { blocked: true };
+      return { blocked: true, reason: "ip" };
     }
     // Veto por email — SOLO si el interruptor está activo (MIS-291 lo pondrá a
     // "off"). Clave `<email>` con LOGIN_EMAIL_VETO_LIMIT; semántica fija (M1).
     if (emailVetoActive() && (await isLocked(ctx, args.emailKey))) {
-      return { blocked: true };
+      return { blocked: true, reason: "email" };
     }
     // Consume la cuota de IP AL INTENTAR: es lo que acota el KDF. Los logins
     // correctos también consumen; con 10/15 min por IP no molesta a usuarios
@@ -211,7 +215,11 @@ export const loginWithPassword = action({
 
     const reserve = await ctx.runMutation(internal.auth.reserveLoginSlot, { emailKey, ipKey });
     if (reserve.blocked) {
-      return { success: false as const, error: LOCKED_ERROR };
+      // B7 (MIS-296): la RESPUESTA no distingue un bloqueo de unas credenciales
+      // incorrectas (anti-enumeración/anti-oráculo). El motivo real queda solo en
+      // el log del servidor — solo la capa, sin IP, email, contraseña ni token.
+      console.warn(`[login] rechazo por bloqueo de rate limit (capa=${reserve.reason})`);
+      return { success: false as const, error: GENERIC_ERROR };
     }
 
     const ok = await verifyPasswordInstrumented(ctx, args.password, reserve.hash, emailKey);
diff --git a/e2e/helpers/test-support.ts b/e2e/helpers/test-support.ts
index 6cee50d..964b79e 100644
--- a/e2e/helpers/test-support.ts
+++ b/e2e/helpers/test-support.ts
@@ -87,7 +87,7 @@ export async function loginSucceeds(password: string): Promise<boolean> {
 export async function loginResult(
   password: string,
   ipHint?: string,
-): Promise<{ success: boolean }> {
+): Promise<{ success: true } | { success: false; error: string }> {
   return await convexClient().action(api.auth.loginWithPassword, {
     email: RESET_TEST_EMAIL,
     password,
diff --git a/e2e/test-support.spec.ts b/e2e/test-support.spec.ts
index 58deae4..05e194c 100644
--- a/e2e/test-support.spec.ts
+++ b/e2e/test-support.spec.ts
@@ -176,6 +176,19 @@ test.describe("harness seguro (MIS-286)", () => {
 
     expect(ok).toBe(10);
     expect(results.length - ok).toBe(1);
+    // MIS-296 (B7): el ÚNICO rechazo (bloqueo por IP) responde con el error
+    // GENÉRICO, indistinguible de credenciales incorrectas — nunca el antiguo
+    // LOCKED_ERROR ("Demasiados intentos…").
+    const rejected = results.filter(
+      (r): r is { success: false; error: string } => !r.success,
+    );
+    expect(rejected).toHaveLength(1);
+    expect(rejected[0].error).toBe("Email o contraseña incorrectos");
+    expect(
+      results.some(
+        (r) => !r.success && r.error === "Demasiados intentos, inténtalo de nuevo en unos minutos",
+      ),
+    ).toBe(false);
     // El KDF corrió exactamente 10 veces: es la prueba de I5 (coste acotado).
     expect(await getKdfCount()).toBe(10);
     // Y hay 10 sesiones: los 10 permitidos entraron de verdad.
```

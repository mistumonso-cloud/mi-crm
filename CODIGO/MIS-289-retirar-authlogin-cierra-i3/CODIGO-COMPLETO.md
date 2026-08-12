# MIS-289 — Código completo (Fase 1A-bis: retirar `auth.login`, cerrar I3)

> **Ticket:** MIS-289 (Urgent) — "Seguridad login · Fase 1A-bis — Retirar auth.login (cierra I3)"
> **Plan (GO ronda 1 de auditoría, 2026-08-12):** `PLANS/MIS-289-plan-1A-bis-retirar-authlogin.md`
> **Plan maestro:** `PLANS/PLAN-CORRECCION-SEGURIDAD-LOGIN-2026-08-10.md` (sección 1A.5)
> **Depende de:** MIS-288 (desplegado y verificado en prod el 2026-08-12) — este es su **contract**.
> **Rama:** `mistumonso/mis-289-seguridad-login-fase-1a-bis-retirar-authlogin-cierra-i3` · sin commit ni push todavía (a la espera de esta auditoría).

Diff completo en `MIS-289.diff` (adjunto). Ficheros completos copiados en `convex/` y `e2e/`. `convex/lib/serverKey.ts` se incluye sin cambios, solo como contexto de `serverKeyMatches`.

## 1. Qué cierra este ticket

MIS-288 cerró I1/I2 y migró el frontend a `auth.loginWithPassword`, pero dejó **dos puertas legacy abiertas a propósito** (expand/contract, opción A) para no tirar el flujo durante el despliegue. **I3 no estaba cerrada** mientras siguieran abiertas:

1. `auth.login` (mutation pública, sin `serverKey`) — invocable directo contra Convex, con `ipHint` falseable y PBKDF2 a demanda. **A1/A3 seguían abiertos por esa puerta.**
2. Las tres funciones de recuperación aceptaban `serverKey` **opcional** (validado-si-viene) — omitirlo recorría el camino legacy sin comprobar origen.

MIS-289 hace el **contract**: cierra ambas. Tras desplegar, **I3 queda cumplida**.

## 2. Precondición que hace el cambio seguro (sin downtime)

Verificado antes de tocar nada: el frontend en producción **ya envía `serverKey` en las cuatro llamadas** (`src/lib/auth/actions.ts`: `loginWithPassword` :32, `requestPasswordResetCode` :74, `verifyResetCode` :92, `resetPasswordWithTicket` :122) y **`src/` no referencia `auth.login`** en ningún punto. El *expand* está 100% vivo en prod, así que endurecer el contrato no puede romper el flujo real. No hay orden de despliegue crítico frente al frontend; el único despliegue funcionalmente necesario es Convex prod.

## 3. Cambios

### 3.1 `convex/auth.ts` — retirada de la mutation pública `login`

- Eliminado **solo** `export const login = mutation({...})`.
- **Conservados** `performLogin` (helper) y `_loginCore` (internalMutation): los usa la action `loginWithPassword`. `performLogin` deja de tener a `login` como llamante pero sigue vivo vía `_loginCore` — **sin código muerto**. Su comentario se actualizó para no mencionar el endpoint retirado.
- El comentario de `_loginCore` deja constancia de que MIS-289 retiró `login` y por qué (cerraba I3 para login por password).
- `mutation` sigue importándose y usándose (`logout`, `loginWithGoogle`).

### 3.2 `convex/passwordReset.ts` — `serverKey` obligatorio (contract)

En las tres funciones (`requestPasswordResetCode`, `verifyResetCode`, `resetPasswordWithTicket`):

- `serverKey: v.optional(v.string())` → **`serverKey: v.string()`**.
- Guard legacy `if (args.serverKey !== undefined && !serverKeyMatches(...))` → **`if (!serverKeyMatches(args.serverKey, AUTH_SERVER_KEY_ENV_VAR))`**, **primera sentencia** del handler, antes de tocar rate limit, construir claves o consultar estado.
- La respuesta a clave inválida **no cambia**: mismo genérico que ya devolvían (`{ok:true}` en request; genérico en verify/reset), indistinguible de un fallo normal — se preserva el anti-enumeración.
- Comentarios "expand/contract: opcional en 1A" reemplazados por "I3 (MIS-289): serverKey obligatorio".

### 3.3 `e2e/` — migración de call sites, prueba 7b y comentarios

- **15 call sites legacy** en `e2e/password-reset-invariants.spec.ts` migrados a incluir `serverKey: authServerKey()`. Verificado por conteo: **22 llamadas a las tres funciones ⇒ 22 con `serverKey`**, ninguna sin él. Cambio mecánico; no altera la lógica de ningún test.
- **Prueba 7b nueva** en `e2e/test-support.spec.ts` (`auth.login está retirada…`): invoca `auth:login` por **referencia dinámica por nombre** (`makeFunctionReference<"mutation">("auth:login")`, **no** `api.auth.login`, que ya no existe en la API generada y no compilaría) con **argumentos válidos** — si la función siguiera publicada, args válidos no darían error. Afirma que el rechazo es por **"función inexistente"** y **no** por validación de argumentos (que significaría que sigue ahí), y comprueba como control positivo que `loginWithPassword` sigue viva.
- **Calibración del discriminador (sugerencia Media del auditor):** no se asume ninguna clase pública de error. Se calibró contra el deployment dev real: el mensaje es `Could not find public function for 'auth:login'.`. La aserción es sobre **texto** (`/could not find|no such|not found|no existe|CouldNotFindFunction/i`) y descarta explícitamente los patrones de argumento (`/ArgumentValidationError|required field|Validator error/i`), robusta a que el cliente degrade a `Error` genérico.
- Comentarios obsoletos actualizados: `e2e/helpers/test-support.ts` (ya no describe el contrato "opcional en 1A") y el bloque I3 del spec (ya no habla en futuro de 1A-bis).

## 4. Verificación (toda verde en local, contra dev ya desplegado)

- `npm run lint` → 0 errores (1 warning preexistente ajeno, `Avatar.jsx`).
- `npm run build` → typecheck OK; **cazaría** cualquier referencia rota a `api.auth.login` (no hay).
- `npx playwright test --project=chromium-secrets` → **20/20 verde** (2.9m), incluida la prueba 7b (4.2s) y los tres tests I3 de recuperación con `serverKey` ahora obligatorio.
- `npm run test:e2e:secret-gate` → superado.

## 5. Despliegue previsto (tras GO de esta auditoría)

Sin downtime; el *expand* ya vive en prod. Orden:

1. Deploy Convex **dev** (ya hecho para verificar; CI lo verá verde).
2. Merge del PR (CI verde).
3. Deploy Convex **prod** (`greedy-tapir-20`, deploy-token) — **registrar hora exacta, commit fuente e ID de despliegue** (criterio de cierre; sugerencia Baja del auditor incorporada). Rebuild de Railway al mergear es inocuo (frontend sin cambios).

**I3 se cierra** en el instante en que el deploy de Convex prod se promociona.

## 6. Sugerencias del auditor del plan — estado

- **Media (no asumir clases de error):** incorporada — discriminador calibrado contra dev, aserción sobre texto. Ver §3.3.
- **Baja (línea 37 del plan):** el plan decía "en e2e/ sí existen refs a `api.auth.login`" — incorrecto; son las 15 llamadas de recuperación sin `serverKey`. Corregido en la implementación (ninguna ref a `api.auth.login`; se usa referencia dinámica).
- **Baja (comentario `test-support.ts:23`):** actualizado.
- **Baja (deploy desde árbol limpio, registrar commit):** se hará; el criterio de cierre lo recoge.

## 7. Fuera de alcance (confirmado)

Perímetro, cabeceras, rate limits, `emailWithinLimits`, I4–I7 — todo permanece para 1B / fases posteriores. No se introduce deuda nueva.

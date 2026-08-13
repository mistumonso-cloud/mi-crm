# MIS-296 — Unificar el error de bloqueo por IP con el genérico (B7)

## Context

Con el veto por email retirado (MIS-291, I4/A2 cerrado), un **bloqueo por IP** en el login
sigue devolviendo `LOCKED_ERROR` (`"Demasiados intentos, inténtalo de nuevo en unos minutos"`)
en `convex/auth.ts`, en vez del `GENERIC_ERROR` (`"Email o contraseña incorrectos"`). Esto
**contradice** el plan maestro (`PLANS/PLAN-CORRECCION-SEGURIDAD-LOGIN-2026-08-10.md`, §1B), que
dice unificar ese error con el genérico y dejar **el motivo real solo en los logs**. Es deuda
preexistente por **IP** (no por email), así que no reabre enumeración de cuentas; por eso se
separó como follow-up B7 de MIS-291.

Resultado buscado: que la respuesta del login **no distinga** un bloqueo (por IP) de unas
credenciales incorrectas — ambos devuelven `GENERIC_ERROR` — y que el motivo real quede en los
logs del servidor. `LOCKED_ERROR` desaparece por completo de la respuesta del login.

## Estado hoy (anclas de código)

- `reserveResultValidator` / `ReserveResult` (`convex/auth.ts:68-74`): unión
  `{blocked:true} | {blocked:false, hash, fingerprint}` — el bloqueo **no lleva motivo**.
- `reserveLoginSlot` (`auth.ts:76-104`): devuelve `{blocked:true}` para bloqueo por IP (L82) y
  para veto de email si el interruptor está activo (L87; hoy `off` en prod).
- `loginWithPassword` (`auth.ts`, camino de bloqueo): `if (reserve.blocked) return { success:false,
  error: LOCKED_ERROR }` (L213-214, tras el guard de M1).
- `LOCKED_ERROR` (`auth.ts:32`): solo se usa en ese único `return`.
- Otros `LOCKED_ERROR` del repo (`scripts/login-verify/core.mjs`/`core.test.mjs`): copia **propia**
  del ejecutor de MIS-295 (clasificador de la secuencia de veto), no importa de `auth.ts`. **Fuera
  de alcance** — vestigial con el veto `off`; su limpieza va con la retirada del interruptor en
  Fase 3 (MIS-293).

## Cambios

Todo en `convex/auth.ts` (código de producto → **deploy a Convex prod** tras merge). Sin cambio de
schema, sin cambio de la firma pública de `loginWithPassword`, sin frontend.

1. **Motivo del bloqueo para los logs** — ampliar la rama bloqueada de la unión con un `reason`:
   - `reserveResultValidator`: `v.object({ blocked: v.literal(true), reason: v.union(v.literal("ip"),
     v.literal("email")) })`.
   - `ReserveResult`: `{ blocked: true; reason: "ip" | "email" }`.
   - `reserveLoginSlot`: `return { blocked: true, reason: "ip" }` (L82) y
     `return { blocked: true, reason: "email" }` (L87).
2. **Respuesta genérica + log** — en `loginWithPassword`, el camino de bloqueo:
   ```ts
   if (reserve.blocked) {
     // B7 (MIS-296): la RESPUESTA no distingue bloqueo de credenciales incorrectas
     // (anti-enumeración/anti-oráculo). El motivo real queda solo en el log del
     // servidor (sin IP ni email — solo la capa).
     console.warn(`[login] rechazo por bloqueo de rate limit (capa=${reserve.reason})`);
     return { success: false as const, error: GENERIC_ERROR };
   }
   ```
3. **Retirar `LOCKED_ERROR`** (`auth.ts:32`), ya sin usos en el módulo (evita lint por const sin usar).

### Consecuencia asumida (documentada para la auditoría)
Un usuario legítimo limitado por su IP (10 intentos/15 min) verá ahora *"Email o contraseña
incorrectos"* en vez de *"Demasiados intentos…"*. Es un intercambio **deliberado**
seguridad-sobre-ayuda que el plan maestro endosa: para este MVP (pocos usuarios, pocas IPs) el
valor anti-enumeración/anti-oráculo pesa más que la pista de UX. El log del servidor conserva el
motivo para operaciones.

## Verificación

- **Build/typecheck/lint:** `npx tsc --noEmit` y `npm run build` verdes; `eslint` limpio (la
  retirada de `LOCKED_ERROR` no deja imports/consts sin usar).
- **E2E (dev, determinista)** — ampliar el test existente de cuota por IP
  (`e2e/test-support.spec.ts:169`, "11 concurrentes → 10 sesiones"): además de los conteos, afirmar
  que **el rechazo (la 11.ª) devuelve `GENERIC_ERROR`** (`"Email o contraseña incorrectos"`) y que
  **ningún** resultado lleva ya `"Demasiados intentos…"`. Requiere ampliar el tipo de retorno del
  helper `loginResult` a `{ success: boolean; error?: string }` (`e2e/helpers/test-support.ts`) para
  poder leer `error` (hoy lo tipa como `{ success: boolean }`).
- **Deploy Convex prod** (`greedy-tapir-20`) vía técnica de deploy-token.
- **Prod (smoke, sin provocar un bloqueo real):** confirmar que un login fallido normal sigue
  devolviendo `GENERIC_ERROR` (regresión). **No** se provoca un bloqueo por IP en prod (exigiría
  ~11 peticiones y ensuciaría claves de rate limit); la prueba de comportamiento bloqueo→genérico
  queda cubierta por el e2e de dev. (Si la auditoría lo exige, se puede provocar con la IP sintética
  `TEST_LOGIN_IP`, no rutable y de expiración 15 min.)

## No-objetivos
- No se toca `scripts/login-verify/*` (copia vestigial de `LOCKED_ERROR`, limpieza de Fase 3).
- No se retira el interruptor `LOGIN_EMAIL_VETO` ni el veto (Fase 3, MIS-293).
- No cambia la firma pública de `loginWithPassword` ni el schema.
- No se cambia el copy del `GENERIC_ERROR`.

## Ficheros
- `convex/auth.ts` — `reason` en la reserva, respuesta genérica + log, retirar `LOCKED_ERROR`.
- `e2e/helpers/test-support.ts` — tipo de retorno de `loginResult` con `error?`.
- `e2e/test-support.spec.ts` — aserciones del mensaje en el test de cuota por IP.
- Entrega en `CODIGO/MIS-296-unificar-error-bloqueo-ip/` + documento de código completo.

## Metodología / Gate
Este plan **no es GO**. Va a auditoría externa; solo tras veredicto **GO** explícito se crea rama y
se escribe el código en `CODIGO/MIS-296-...`. Después: auditoría de código → instalar → PR (pedir
permiso antes de cada push) → CI verde → **merge lo hace el asistente** con permiso → **deploy
Convex prod** → verificar → cerrar MIS-296 en Linear con el PR enlazado.

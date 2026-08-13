# MIS-291 — Runbook Fase 1B-ii: retirar el veto por email (cierra I4 / A2)

> **⏸ APARCADO — bloqueado por MIS-295.** La verificación de las pruebas 11-12 se
> delega a un **ejecutor seguro** (MIS-295: sin secretos en argv, llamadas por
> HTTP con cuerpo, Convex simulable, tests). Este runbook se **finalizará** cuando
> MIS-295 esté aprobado; entonces MIS-291 se limita a: consumir ese ejecutor,
> aplicar `env set LOGIN_EMAIL_VETO off` y registrar evidencia. No ejecutar nada
> de aquí contra producción hasta entonces.
>
> **Ticket operativo, sin despliegue de código de producto.** El único cambio en
> prod es `LOGIN_EMAIL_VETO=off`. Diseño aprobado en el plan maestro
> `PLANS/PLAN-CORRECCION-SEGURIDAD-LOGIN-2026-08-10.md` §1B.4.
>
> **Historial de auditoría:**
> - Ronda 1 → NO-GO (M1: la prueba 12 reutilizaba una fila de bloqueo que el login
>   de éxito del paso 3 ya había borrado). Resuelto en el diseño de la secuencia.
> - Ronda 2 → NO-GO (M2: un aborto entre el paso 1 y el 2 dejaba la cuenta
>   bloqueada). Resuelto conceptualmente moviendo la recuperación al mecanismo de
>   salida.
> - Ronda 3 → NO-GO. El orquestador bash introducía B1 (gate no fail-closed antes
>   del trap), **B2 (secretos en argv, sin arreglo con `convex run`)**, M3
>   (cleanup sin verificar), M4 (aserción de bloqueo con texto irreal), M5 (dep
>   `jq`). Decisión (recomendación §8 del auditor): **dividir** — el ejecutor
>   seguro pasa a **MIS-295**, y MIS-291 queda a la espera de consumirlo.

## Contexto

Con I1/I2 (MIS-288), I3 (MIS-289) e I5/I6/I7 (MIS-290) ya vivos en producción,
queda **retirar el veto por email** del login. Ese veto (5 fallos por `<email>` →
bloqueo de 15 min) es la invariante **I4/A2**: hoy es un vector de **DoS
dirigido** — un atacante puede dejar fuera a un usuario legítimo fallando 5 veces
contra su email. Con la cuota por IP (I5) ya acotando el coste del KDF, el veto
por email no aporta defensa y sí un riesgo, así que se retira.

El interruptor es **fail-safe**: `LOGIN_EMAIL_VETO` ausente o con cualquier valor
distinto de `off` → veto **ACTIVO**. Misma dirección segura que el fail-closed de
I2. Retirarlo = ponerlo a `off`.

## Gate de entrada (en orden, definido en el ticket)

1. MIS-290 desplegado y verificado en prod — ✅ (`greedy-tapir-20`, PR #53, 2026-08-12).
2. Todas las cuentas con contraseña rotadas — ✅.
3. `accountsPendingRotation()` en **prod** = `[]` — ✅ verificado
   (`npx convex run auth:accountsPendingRotation --prod` → `[]`).
4. Sólo entonces: `LOGIN_EMAIL_VETO=off`.

## Cómo funciona el interruptor (para leer la evidencia)

`convex/lib/rateLimit.ts:101` — `emailVetoActive()` = `process.env.LOGIN_EMAIL_VETO !== "off"`.
Se consulta en dos puntos de `convex/auth.ts`:

- `reserveLoginSlot:85` — con veto **on**, si la clave `<email>` está bloqueada,
  corta ANTES del KDF y devuelve `LOCKED_ERROR`.
- `finalizeLogin:179` — con veto **on**, un fallo registra la clave `<email>`
  (5/15 → bloqueo). Con veto **off**, ninguno de los dos actúa: sólo quedan la
  cuota por IP (I5) y el contador de telemetría `login-counter:<email>`, que
  nunca bloquea.

Constantes de error (`convex/auth.ts:30-31`): bloqueo = `"Demasiados intentos,
inténtalo de nuevo en unos minutos"` (`LOCKED_ERROR`); genérico = `"Email o
contraseña incorrectos"` (`GENERIC_ERROR`).

**Efecto colateral clave:** un login **correcto** ejecuta `resetAttempts` sobre
**ambas** claves de email (`finalizeLogin:164-169`) → **borra la fila de
bloqueo**. Por eso cada estado bloqueado se (re)genera con 5 fallos justo antes de
comprobarlo, y nunca se reutiliza al otro lado de un login correcto.

Detalle de las pruebas: **omitir `ipHint`** hace `ipKey=null` (`auth.ts:201`), así
`reserveLoginSlot` no consume ni consulta la cuota por IP → se aísla la clave de
email.

### Sustitución deliberada de la prueba 11 del plan maestro

El plan maestro §1B.4 describe la prueba 11 como "agotar una IP y entrar desde
otra IP". Aquí se sustituye por la variante **sin `ipHint`**: aísla exactamente la
clave de email, que es la palanca que MIS-291 retira. Equivalente para I4; la
cuota por IP (I5) ya se verificó en MIS-290.

## Secuencia (a ejecutar con el ejecutor de MIS-295)

Descripción conceptual, agnóstica de implementación; la ejecuta el ejecutor
aprobado de MIS-295 con preflight fail-closed, recuperación verificada y sin
secretos en argv.

**0. Estado inicial** — `env get` → ausente ⇒ veto **ACTIVO** (si fuese `off`,
abortar). Login correcto de línea base ⇒ `success:true`.

**1. Prueba 11 · ANTES** — sin `ipHint`, veto on: 5 fallos bloquean `<email>`; el
6.º con la contraseña correcta → `error: LOCKED_ERROR` ⇒ I4/A2 vivo hoy.

**2. Aplicar el cambio** — `env set LOGIN_EMAIL_VETO off` + `env get` → `off`.

**3. Prueba 11 · DESPUÉS** — login correcto → `success:true` (la fila de bloqueo
sigue viva pero ya no se consulta ⇒ veto retirado; este éxito borra las claves).

**4. Prueba 12 · rollback** — `env set` veto activo + `env get`; **regenerar** el
bloqueo con 5 fallos; login correcto → `error: LOCKED_ERROR` ⇒ reactivar restaura
el bloqueo sin redeploy.

**5. Estado final** — `env set off` + `env get` → `off`; login correcto →
`success:true` (claves limpias). El estado final correcto de MIS-291 es siempre
`LOGIN_EMAIL_VETO=off`; el ejecutor lo garantiza ante aborto.

## Criterio de cierre

- MIS-295 aprobado y disponible.
- Gate antes: `accountsPendingRotation()` prod = `[]` ✅.
- `env get LOGIN_EMAIL_VETO` = `off` al final.
- Pruebas 11 (antes: LOCKED / después: éxito) y 12 (rollback regenerado: LOCKED)
  pasadas por el ejecutor.
- Evidencia sin valores de secretos.
- Ticket de follow-up B7 creado y enlazado.

## Rollback definitivo

Volver a poner el veto: `env set LOGIN_EMAIL_VETO <≠off>` (o `env remove`).
Inmediato, sin revert de código ni redeploy.

## Deuda enviada a follow-up (B7)

Retirado el veto por email, un **bloqueo por IP** sigue devolviendo `LOCKED_ERROR`
(`convex/auth.ts:203`), lo que contradice la afirmación del plan maestro de
unificar ese error con el genérico. Es **deuda preexistente, no agravada por
MIS-291**, y **no impide cerrar I4/A2** (el oráculo por cuenta desaparece con el
veto; el residuo es por IP). Queda **fuera del alcance de MIS-291** → **ticket de
código propio** (unificar `LOCKED_ERROR` de IP con `GENERIC_ERROR`), a crear y
enlazar antes de cerrar MIS-291.

## Evidencia

_(Se rellena cuando MIS-295 esté listo y se ejecute — sólo estados de env var y
`success`/`error`.)_

| Paso | Acción | Esperado | Resultado |
|------|--------|----------|-----------|
| Gate | `accountsPendingRotation()` prod | `[]` | ✅ `[]` |
| 0 | `env get` inicial | ausente (activo) | _pendiente_ |
| 0 | login correcto (línea base) | `success:true` | _pendiente_ |
| 1 | 5× pw incorrecta + 1× correcta (veto on) | `LOCKED_ERROR` | _pendiente_ |
| 2 | `env set off` + `env get` | `off` | _pendiente_ |
| 3 | login correcto (veto off) | `success:true` | _pendiente_ |
| 4 | `env set` activo + `env get` + 5× incorrecta + 1× correcta | `LOCKED_ERROR` | _pendiente_ |
| 5 | `env set off` + `env get` + login correcto | `off` / `success:true` | _pendiente_ |

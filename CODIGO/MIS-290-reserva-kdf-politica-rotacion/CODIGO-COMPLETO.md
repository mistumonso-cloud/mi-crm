# MIS-290 — Código completo (Fase 1B-i: reserva antes del KDF, política y rotación)

> **Ticket:** MIS-290 (High). **Plan (GO ronda 3):** `PLANS/MIS-290-plan-1B-i.md`. **Plan maestro:** §1B.1–1B.3.
> **Depende de:** MIS-288 (I1/I2) y MIS-289 (I3), en prod desde 2026-08-12.
> **Rama:** `mistumonso/mis-290-...` · sin commit ni push todavía (a la espera de esta auditoría).

Diff completo en `MIS-290.diff`. Ficheros completos en `convex/`, `e2e/`, `scripts/`.

## Ronda 2 (código) — correcciones a M4 y M6

- **M6 (8 espacios pasaban la política):** `validatePassword` y el script miden ahora la longitud **mínima sobre el contenido efectivo (`trim`)** — rechazan solo-espacios y relleno de espacios que dejaría <8 caracteres reales. El máximo sigue sobre la longitud cruda. Tests de espacios en la unidad y en el spawn del script.
- **M4 (el test de alta no ejercitaba el flujo real):** dos pruebas nuevas: (a) **spawn real de `scripts/hash-password.mjs`** — rechaza `password`/espacios (exit 1) y acepta una fuerte (exit 0 + hash); (b) **`seedUser` + `accountsPendingRotation` reales** vía wrapper `testSeedFlow` (identidad de seed dedicada `seed@test.local`, sembrada y borrada en la prueba): una cuenta sembrada NO queda pendiente de rotación.
- **Baja:** `resetTestIdentity` borra solo `KDF_COUNTER_KEY` por `by_key` (no un scan de la tabla).
- **Verificación (contra dev):** `tsc --noEmit` limpio, lint 0 errores, **`chromium-secrets` 28/28** (26 previos + los 2 de M4), secret-gate superado. (`next build` local falla SOLO por bloqueo de Google Fonts en el entorno — ajeno al código, ver §6.) Cierra **I5** (coste del KDF acotado), **I6** (credenciales no triviales) e **I7** (contraseña sustituida no crea sesión). **El veto por email SIGUE PUESTO**; MIS-290 solo introduce el interruptor `LOGIN_EMAIL_VETO` (activo por defecto). Su retirada es MIS-291.

## 1. 1B.1 — Seis configuraciones de rate limit (`convex/lib/rateLimit.ts`)
- `RateLimitConfig` pasa a **unión discriminada** `{lock:true, lockDurationMs}` | `{lock:false}` (evita el `lockDurationMs:0` ambiguo).
- Seis constantes con clave propia: `LOGIN_IP_LIMIT` (`ip:<ip>`, 10/15→bloqueo), **`LOGIN_EMAIL_VETO_LIMIT`** (`<email>`, 5/15→bloqueo), **`LOGIN_EMAIL_COUNTER`** (`login-counter:<email>`, 50/60 **sin bloqueo**), `RESET_REQUEST_LIMIT`, `RESET_CODE_LIMIT`, `RESET_IP_LIMIT`.
- **M1 (rondas 2-3):** el veto y la telemetría viven en **claves distintas**, cada una con semántica FIJA de por vida. El interruptor `LOGIN_EMAIL_VETO` nunca reinterpreta un contador. Helper `loginCounterKey()` como única fuente de la clave de telemetría; `emailVetoActive()` (fail-safe: ausente o ≠"off" → activo).

## 2. 1B.2 — Reserva → KDF → finalización (`convex/auth.ts`)
Firma de `loginWithPassword` **intacta** (sin cambios de frontend). Se retiran `performLogin`/`_loginCore`.
- **`reserveLoginSlot`** (internalMutation, unión discriminada `{blocked:true}`|`{blocked:false,hash,fingerprint}`): comprueba `isLocked(ip)` y, si el veto está activo, `isLocked(<email>)`; **consume la cuota de IP AL INTENTAR** (acota el KDF, I5); devuelve el hash (o `DUMMY` si no existe, anti-timing) y `fingerprintHash(hash)`.
- **`verifyPasswordInstrumented`** (punto ÚNICO al KDF): cuenta bajo **doble cerrojo** (env del harness Y `emailKey===RESET_TEST_EMAIL`) y luego deriva. En prod no cuenta nada.
- **`finalizeLogin`** (internalMutation): relee por `by_email` (misma consulta exista o no la cuenta); **I7** → sesión solo si existe ∧ ok ∧ huella coincide (`constantTimeEqual`). **M2:** todo fallo (inexistente / contraseña mala / huella obsoleta) registra el contador de email de forma **idéntica**; el éxito resetea **ambas** claves de email (y nunca la de IP). Los dos registros de un fallo (telemetría + veto) ocurren en la **misma transacción**.
- **`fingerprintHash`/`fingerprintsEqual`** en `convex/lib/password.ts`.
- **B7 entero para MIS-291:** se conserva `LOCKED_ERROR` para cualquier bloqueo en 1B-i.

## 3. 1B.3 — Política de contraseñas y rotación (I6)
- **`convex/lib/passwordPolicy.ts`** (nuevo): `validatePassword` (longitud 8–128 + corpus), `normalizePassword` documentada con ejemplos, `CURRENT_PASSWORD_POLICY_VERSION`.
- **`convex/lib/passwordCorpus.json`** (nuevo, 9.205 entradas normalizadas + términos del proyecto). Procedencia/licencia/integridad en `passwordCorpus.README.md` (SecLists MIT; sha256 de fuente y de artefacto).
- **Esquema** (`convex/schema.ts`): `users.passwordPolicyVersion`/`passwordChangedAt` (opcionales; ausencia = "no rotada"), escritos en el MISMO patch/insert que `passwordHash`.
- **Puntos de fijación (TODOS):** `resetPasswordWithTicket` (valida antes de hashear + escribe versión), `resetTestIdentity` (pasa por la política), y **`scripts/hash-password.mjs` → `seedUser`** (M4): el script rechaza débiles **antes de hashear** (mismo corpus JSON + normalización duplicada documentada); `seedUser` escribe versión+fecha atómicos al insertar.
- **`accountsPendingRotation`** (internalQuery): cuentas con versión ≠ CURRENT; solo id/email (sin hashes). Gate de cierre: en prod → `[]`.

## 4. Instrumentación y wrappers de test (`convex/testSupport.ts`, `convex/schema.ts`)
- Tabla **`testKdfCounter`** (índice `by_key`), reiniciada en `resetTestIdentity`.
- `rateLimitKeysForTestIdentity()` limpia **ambas** claves de email + `ip:203.0.113.42` (`TEST_LOGIN_IP` en `testIdentity.ts`, TEST-NET-3).
- Queries `getKdfCount`, `getPolicyVersion`; wrappers `testReserveLoginSlot`/`testFinalizeLogin`/`testDeleteIdentity` (fail-closed, identidad dedicada) para la prueba determinista de I7 (M5).

## 5. Verificación (contra dev desplegado)
- `npm run lint` 0 errores · `npm run build`/typecheck OK · `test:e2e:secret-gate` superado.
- **`chromium-secrets` 28/28 verde** (26 iniciales + 2 de M4: spawn del script y `seedUser`) — cubre TODO lo de MIS-290:
  - **Prueba 8 (I5):** 11 logins concurrentes correctos desde la IP sintética → **10 sesiones, 1 rechazado, `getKdfCount == 10`** (determinista, 6.2s).
  - **Prueba 9 (I7):** login en vuelo con huella vieja → **no crea sesión**; y cuenta borrada entre reserva y finalización → **no crea sesión**.
  - **Política:** `resetPasswordWithTicket` rechaza `password` (corpus) y acepta una fuerte con marcador; unidad de `validatePassword`; flujo de alta escribe el marcador.
- **Suite completa (todos los projects):** ver nota de e2e abajo.

## 6. Nota sobre la suite e2e completa (local)
La corrida local de la suite COMPLETA mostró 7 fallos en flujos de UI de Carlos/Marta (`full-flow`, `edge-cases`, `role-gating`) con el síntoma "diálogo de guardado no se cierra" (botón **"Guardando…" colgado** > 5s). El diagnóstico es una **latencia del Server Action de Next en modo dev** (la primera invocación de una ruta/acción compila on-demand y puede exceder el timeout de 5s del cierre de diálogo); una re-corrida aislada reprodujo el patrón (2/5 fallos, el resto ya "calientes"), y una de las que falla es la flakiness ya conocida **MIS-287**.

**No es una regresión de MIS-290**, con alta confianza: (1) el diff **no toca `src/` ni las funciones de contactos/notas/ventas** — solo auth/rate-limit/password; (2) el **setup (login) pasa**, así que el login funciona; (3) la BD de dev tiene solo 8 contactos (sin bloat, verificado); (4) `chromium-secrets` (que ejercita TODO MIS-290) está 26/26; (5) estos mismos flujos pasaron en **CI** (infra limpia) para MIS-289 sobre el mismo frontend, que aquí es idéntico. **CI es el gate de la suite completa** — mismo criterio que en MIS-289, donde la evidencia local fue `chromium-secrets` y CI validó la suite entera.

## 7. Despliegue previsto (tras GO)
dev → merge (CI verde, suite completa) → deploy Convex prod (hora+commit+ID) → **rotar** cuentas por recuperación → `accountsPendingRotation()` en prod = `[]` (prueba 10). El veto queda puesto (lo retira MIS-291).

## 8. Decisiones de auditoría incorporadas (rondas 1-3)
M1 (claves separadas), M2 (contabilidad uniforme), M3 (I5 determinista: IP exacta + doble cerrojo + contraseña correcta), M4 (`seedUser`+script), M5 (wrappers I7). Bajas: unión discriminada, `fingerprintHash` propio, corpus con procedencia, índice `by_key`, reset de ambas claves, evidencia de I7 en prod = efecto observable.

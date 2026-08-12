# MIS-290 — Plan Fase 1B-i: reserva antes del KDF, política de contraseñas y rotación

> **Ticket:** MIS-290 (High, In Progress). **Plan maestro:** `PLANS/PLAN-CORRECCION-SEGURIDAD-LOGIN-2026-08-10.md` §1B.1–1B.3.
> **Depende de:** MIS-288 (I1/I2) y MIS-289 (I3), en prod desde 2026-08-12.
> **Solo PLAN.** Nada de código/rama/deploy hasta GO de auditoría.

## Ronda 3 — corrección de M1 (claves separadas)

M2–M5 quedaron resueltos en la ronda 2. **M1 seguía abierto**: una única fila `<email>` no almacena qué configuración la escribió, así que un cambio o rollback de `LOGIN_EMAIL_VETO` **reinterpreta** contadores viejos con la ventana/umbral del otro modo (p. ej. 20 intentos de telemetría 50/60 se leen como veto 5/15 tras el rollback → bloqueo prematuro). **Corrección:** **dos claves con identidad e identidad de semántica independientes y fijas**:

- **`<email>`** = veto, **siempre** `LOGIN_EMAIL_VETO_LIMIT` (5/15→bloqueo). Solo se consulta/escribe cuando el veto está activo.
- **`login-counter:<email>`** = telemetría, **siempre** `LOGIN_EMAIL_COUNTER` (50/60, sin bloqueo). Se incrementa en cada fallo en ambos modos.

Ninguna clave se reinterpreta jamás: cada una tiene una sola config para toda su vida. El interruptor solo decide **si** se consulta/escribe la del veto, nunca cambia el significado de un contador existente. Un **login correcto resetea AMBAS claves** (deja un eventual rollback en estado limpio, sugerencia Baja); el **harness limpia ambas**. Bajas incorporadas: el título dice "seis"; `testKdfCounter` gana índice `by_key`; evidencia de I7 en prod = efecto observable (las sesiones mueren), la prueba determinista va contra dev sobre el commit desplegado.

## Ronda 2 — correcciones a los 5 Majors de la ronda 1

- **M1 (veto/telemetría en la misma fila):** la clave `<email>` tiene **un solo estado**. `LOGIN_EMAIL_VETO` **selecciona la config** aplicada a esa clave — no hay dos configs sobre la misma fila. Con el veto activo: config de veto (bloquea). Con el veto `off` (MIS-291): `LOGIN_EMAIL_COUNTER` (sin bloqueo). Ver §3.
- **M2 (enumeración en `finalizeLogin`):** **todo** intento que llega al KDF y termina sin sesión registra el contador de email **de forma idéntica** — usuario inexistente, contraseña incorrecta y huella obsoleta. Solo el camino con sesión resetea. Ver §3.3.
- **M3 (falso verde en I5):** IP exacta `203.0.113.42` añadida al reinicio del harness; doble cerrojo del contador KDF; burst con **contraseña correcta** desde estado limpio → exactamente 10 KDF + 10 sesiones / 1 rechazo. Ver §5, §6.
- **M4 (`seedUser` fuera del contrato):** flujo completo `hash-password.mjs → seedUser`: el script **rechaza contraseña débil antes de hashear**; `seedUser` escribe `passwordHash`+`passwordPolicyVersion`+`passwordChangedAt` **atómicamente**. Ver §4.4.
- **M5 (prueba I7 sin vía ejecutable):** wrappers de harness `testReserveLoginSlot`/`testFinalizeLogin`/`testDeleteIdentity` (inertes sin `E2E_TEST_SUPPORT_KEY`, restringidos a `RESET_TEST_EMAIL`) que permiten intercalar el cambio real de contraseña. Ver §6.
- **Sugerencias:** B7 se deja **entero para MIS-291** (se conserva `LOCKED_ERROR` para cualquier bloqueo en 1B-i); prueba manual de I5 en prod con contraseña **correcta**; `lockDurationMs` como unión discriminada; `fingerprintHash` propio; corpus con origen/licencia/integridad documentados; `passwordChangedAt` es telemetría (M4 del plan maestro es una notificación, no consumidor de este campo).

---

## 1. Alcance y frontera

Cierra **I5** (coste del KDF acotado), **I6** (credenciales no triviales, incluidas las existentes) e **I7** (una contraseña sustituida no crea sesión). **El veto por email SIGUE PUESTO**; MIS-290 solo introduce el interruptor `LOGIN_EMAIL_VETO` **activo por defecto**. Retirarlo es MIS-291.

**Fuera de alcance:** retirar el veto (MIS-291), retirar el interruptor (fase 3), M1/M3/M4 del plan (fase 2).

---

## 2. 1B.1 — Seis configuraciones de rate limit

**Fichero:** `convex/lib/rateLimit.ts`. Seis constantes con nombre inequívoco, **cada una sobre una clave distinta**:

| Constante | Clave | Consumidor | Valor | Cambio |
|---|---|---|---|---|
| `LOGIN_IP_LIMIT` | `ip:<ip>` | login | 10 / 15 min → bloqueo 15 min | de 20/60 |
| `LOGIN_EMAIL_VETO_LIMIT` | `<email>` | login — veto | 5 / 15 min → bloqueo 15 min | = comportamiento actual |
| `LOGIN_EMAIL_COUNTER` | `login-counter:<email>` | login — telemetría | 50 / 60 min, **sin bloqueo** | nuevo |
| `RESET_REQUEST_LIMIT` | `reset:<email>` | `requestPasswordResetCode` | 5 / 15 min | sin cambios |
| `RESET_CODE_LIMIT` | `resetcode:<email>` | `verifyResetCode` | 5 / 15 min | sin cambios |
| `RESET_IP_LIMIT` | `resetip:<ip>` | recuperación | 10 / 15 min | de 20/60 |

**Dos claves de email con semántica fija e independiente (corrección de M1).** El veto vive en `<email>` con `LOGIN_EMAIL_VETO_LIMIT` (5/15→bloqueo) **para siempre**; la telemetría vive en `login-counter:<email>` con `LOGIN_EMAIL_COUNTER` (50/60, sin bloqueo) **para siempre**. **Ninguna fila se reinterpreta jamás** al cambiar `LOGIN_EMAIL_VETO`: el interruptor solo decide si se consulta/escribe la clave del veto (§3.4), no cambia el significado de ningún contador existente. El contrato de `loginAttempts` (un `count`/`windowStartedAt`/`lockedUntil` por clave) se respeta y no hay doble conteo ni rollback ambiguo.

**"Sin bloqueo"** (Baja): `RateLimitConfig` pasa a **unión discriminada** — `{ lock: true, lockDurationMs: number }` | `{ lock: false }`. `recordFailedAttempt` nunca fija `lockedUntil` para `{lock:false}`.

**`LOGIN_EMAIL_COUNTER` es telemetría, no defensa.** Ningún consumidor lo lee hoy. Documentado en el código.

**Call sites:** `convex/auth.ts` (login) y `convex/passwordReset.ts` (3 flujos) pasan a las constantes nuevas.

---

## 3. 1B.2 — Reserva antes del KDF (I5) + revalidación (I7)

**Fichero:** `convex/auth.ts`. Se sustituyen las tripas de `auth.loginWithPassword` (action desde MIS-288). **Nombre, firma y tipo NO cambian** → sin ventana de incompatibilidad y **sin cambios en el frontend** (`src/lib/auth/actions.ts` ya usa `fetchAction`). Se retiran `performLogin` y `_loginCore` (hoy solo los usa `loginWithPassword`).

```
action loginWithPassword(email, password, ipHint, serverKey):
  0. serverKeyMatches → si no: {success:false, GENERIC}                 [sin TX]
  1. r = runMutation(reserveLoginSlot, {emailKey, ipKey})               [TX 1 — confirma]
  2. if r.blocked  → {success:false, LOCKED}                            [sin KDF]
     if !r.allowed → {success:false, GENERIC}   (nunca ocurre hoy; reservado)
  3. ok = verifyPasswordInstrumented(password, r.hash)                  [KDF, fuera de TX]
  4. return runMutation(finalizeLogin, {emailKey, ipKey, fingerprint:r.fingerprint, ok})  [TX 2]
```

### 3.1 `reserveLoginSlot` (internalMutation)
Devuelve `{ blocked: boolean, hash, fingerprint }`.
- `isLocked(ip:<ip>)` con `LOGIN_IP_LIMIT` → si bloqueado: `blocked:true`.
- **Si `emailVetoActive()`:** `isLocked(<email>)` con `LOGIN_EMAIL_VETO_LIMIT` → si bloqueado: `blocked:true`. (Preserva el comportamiento de hoy: cuenta bloqueada ni llega al KDF.) Con el veto `off` (MIS-291) este check se omite.
- **Consume cuota de IP AL INTENTAR:** `recordFailedAttempt(ip:<ip>, LOGIN_IP_LIMIT)`. Acota el coste — N concurrentes serializan aquí; solo los 10 primeros no quedan bloqueados en el 11.º.
- Busca el usuario por `by_email`. Devuelve `hash` = el real o `DUMMY_PASSWORD_HASH` si no existe (anti-timing), y `fingerprint = fingerprintHash(hash)`.

### 3.2 `verifyPasswordInstrumented` — punto único de entrada al KDF
Un **único** helper envuelve `verifyPassword`: **primero** incrementa `testKdfCounter` (solo con doble cerrojo, §5), **luego** deriva. Imposible añadir un camino al KDF sin contarlo. `verifyPassword` no se llama directamente desde la action.

### 3.3 `finalizeLogin` (internalMutation) — contabilidad uniforme (M2) + revalidación (I7)
Relee **siempre** por `withIndex("by_email", emailKey)` (misma consulta exista o no la cuenta; no recibe `userId`, no hace `ctx.db.get(null)` — cierra el timing posterior al KDF).

Condición única de éxito: `sesión ⇔ (fila existe) ∧ ok ∧ (fingerprintHash(hash_actual) == fingerprint)`. Comparación de la huella con `constantTimeEqual`.

- **Éxito** → crea sesión; **resetea AMBAS claves de email**: `resetAttempts(<email>)` (veto) y `resetAttempts(login-counter:<email>)` (telemetría) — deja un eventual rollback del veto en estado limpio (Baja). **Nunca resetea el de IP** (una credencial válida no debe limpiar la capa por IP).
- **Cualquier otro caso** (fila inexistente, `ok:false`, o huella no coincidente) → registro **IDÉNTICO**, sin excepción por usuario inexistente (M2, no reabre enumeración):
  - **siempre** `recordFailedAttempt(login-counter:<email>, LOGIN_EMAIL_COUNTER)` (telemetría, ambos modos);
  - **si `emailVetoActive()`**, además `recordFailedAttempt(<email>, LOGIN_EMAIL_VETO_LIMIT)`;
  - devuelve `{success:false, GENERIC}`. Con el veto activo, una cuenta inexistente también se bloquea a los 5 en `<email>` y responde `LOCKED_ERROR` en el siguiente intento, igual que una real.

Cada clave conserva su config fija; el interruptor nunca reinterpreta un contador existente (M1).

### 3.4 Interruptor `LOGIN_EMAIL_VETO`
- `emailVetoActive(): boolean` — lee el entorno de Convex. **Ausente o ≠ `"off"` → activo** (fail-safe). Usado en `reserveLoginSlot` (§3.1) y `finalizeLogin` (§3.3).
- MIS-290 lo deja **activo por defecto**: el login sigue vetando por email igual que hoy. MIS-291 hará `env set LOGIN_EMAIL_VETO off`.
- **B7 entero para MIS-291:** en 1B-i se conserva `LOCKED_ERROR` para **cualquier** bloqueo (IP o email). No se introduce semántica mixta ni se unifica a genérico aquí.

### 3.5 Invariantes a preservar (para el auditor)
- Anti-timing: `DUMMY_PASSWORD_HASH` cuando no existe → coste del KDF idéntico; y `finalizeLogin` hace el mismo trabajo de BD y el mismo registro exista o no la cuenta (M2).
- El hash sale de la TX a la memoria de la action (concesión consciente; ambos son servidor de Convex; `reserveLoginSlot` es `internalMutation`).
- La action es `at-most-once` (irrelevante para login).
- Solo afecta a `login`: `resetPasswordWithTicket` hashea **tras** validar el ticket (no amplificable sin ticket); `verifyResetCode` solo hace SHA-256.

---

## 4. 1B.3 — Política de contraseñas y rotación (I6)

### 4.1 `convex/lib/passwordPolicy.ts` (nuevo) + corpus
- Longitud 8–128.
- **Corpus versionado ~10.000** en `convex/lib/passwordCorpus.json` (**data compartida**, importable por Convex y por el script — evita duplicar 10k entradas) + términos del proyecto (`mistumonso`, `vibecoder`, `crm`, dominio). **Origen/licencia/integridad documentados** en una cabecera/`README` junto al fichero (recorte de una lista pública tipo *top-10k*, licencia de la fuente, y un hash del fichero para detectar cambios accidentales). Sin descargas en runtime. Coste de bundle ~80 KB.
- **Normalización antes de comparar**, documentada con ejemplos verificables: `trim`, minúsculas, colapso de dígitos finales (`Password123`, `password1` → `password`).
- `validatePassword(password): { ok:true } | { ok:false, error }`.
- `normalizePassword(password): string` exportada, para que el script la reutilice (o la duplique documentada como los params del KDF, ver §4.4).
- `CURRENT_PASSWORD_POLICY_VERSION` (constante numérica). Subirla = re-exigir rotación a todos (por eso versión, no booleano).

### 4.2 Esquema (`convex/schema.ts`, `users`)
```ts
passwordPolicyVersion: v.optional(v.number()),  // versión con la que se fijó el hash actual; ausencia = "no rotada"
passwordChangedAt:     v.optional(v.number()),  // epoch ms; telemetría (no lo consume M4, que es una notificación)
```
Se escriben **en el mismo `ctx.db.patch`/`insert` que `passwordHash`**, nunca por separado, solo tras `validatePassword`. Atomicidad por la transacción; invariante documentada en `passwordPolicy.ts`.

### 4.3 Puntos de fijación de contraseña (TODOS)
1. `convex/passwordReset.ts::resetPasswordWithTicket` — `validatePassword` (rechaza débil con error de política) **antes** de `hashPassword`; escribe `passwordHash`+versión+`passwordChangedAt` en el mismo patch.
2. `convex/testSupport.ts::resetTestIdentity` — genera 32 bytes aleatorios (nunca choca) pero **pasa por `validatePassword`** para que no exista un camino que la esquive; escribe versión+fecha atómicos.
3. **`scripts/hash-password.mjs` + `auth.seedUser`** — ver §4.4.

### 4.4 Flujo de alta `hash-password.mjs → seedUser` (M4)
- **El script tiene el plaintext**; `seedUser` solo recibe el hash. Por tanto:
  - `scripts/hash-password.mjs` **valida el plaintext contra la política ANTES de hashear**: importa `convex/lib/passwordCorpus.json` (data) y aplica la normalización (reutilizada o duplicada y documentada como ya hace con los params del KDF). Contraseña débil → **aborta sin generar hash**.
  - `auth.seedUser` gana el contrato: al insertar, escribe `passwordPolicyVersion = CURRENT_PASSWORD_POLICY_VERSION` y `passwordChangedAt` **en el mismo `insert` que `passwordHash`**. No puede revalidar el plaintext (no lo tiene), pero **liga el hash sembrado al flujo validado** escribiendo la versión vigente. Es admin-only (`internalMutation`), y el script es la única vía canónica de producir su `passwordHash`.
- **Prueba del flujo de alta:** test que el script rechaza una contraseña del corpus (no genera hash); y que una cuenta recién sembrada **no** aparece en `accountsPendingRotation()` (la versión quedó escrita).

### 4.5 `accountsPendingRotation` (internalQuery)
Devuelve las cuentas con `passwordHash` cuya `passwordPolicyVersion !== CURRENT` (incluye las sin campo). **Solo id/email**, nunca hashes — su salida puede registrarse como evidencia sin filtrar secretos. Se corre con `npx convex run`; gate = `[]`.

### 4.6 Rotación (orden estricto)
1. Deploy de política + campos + escritura atómica en los 3 puntos de fijación.
2. Cada cuenta con contraseña **rota** por recuperación (que ya valida contra el corpus). Prod: `accountsPendingRotation()` las inventaría; se rotan una a una.
3. `accountsPendingRotation()` en **prod** → `[]` (prueba 10).
4. (MIS-291) solo entonces `LOGIN_EMAIL_VETO=off`.

---

## 5. Instrumentación de test — `testKdfCounter` (tabla propia) + doble cerrojo (M3)

- **Tabla nueva** en `convex/schema.ts` (NO en `testOutbox`): `testKdfCounter { key: v.string(), count: v.number() }` con índice **`by_key`** (`["key"]`); la unicidad lógica por clave la garantiza la mutation de incremento (lee por `by_key`, inserta o hace `patch`).
- `verifyPasswordInstrumented` (§3.2) la incrementa **solo si `process.env[TEST_SUPPORT_ENV_VAR]` existe** (cerrojo 1, prod sin instrumentación) **Y** el `emailKey` bajo prueba es `RESET_TEST_EMAIL` (cerrojo 2 — evita que otro tráfico de dev contamine el contador). En prod la env no existe → cero instrumentación.
- `resetTestIdentity` la reinicia a 0.
- **Claves que limpia el harness** — `rateLimitKeysForTestIdentity()` pasa a incluir **ambas** claves de email y la IP sintética exacta:
  - `RESET_TEST_EMAIL` (veto), **`login-counter:${RESET_TEST_EMAIL}`** (telemetría — M1: hay que limpiar las dos), `reset:${RESET_TEST_EMAIL}`, `resetcode:${RESET_TEST_EMAIL}`, y **`ip:203.0.113.42`** (TEST-NET-3, no rutable, de nadie — mismo criterio de seguridad que el resto de claves dedicadas; sin esto un bloqueo de IP heredado daría falso verde, M3).
- Nueva query `getKdfCount` en `testSupport` (mismos tres cerrojos del harness) para leer el contador.

---

## 6. Frontend y e2e

- **Frontend: sin cambios** (firma intacta; ya usa `fetchAction`).
- **Wrappers de harness (M5)** en `convex/testSupport.ts`, inertes sin `E2E_TEST_SUPPORT_KEY` y restringidos a `RESET_TEST_EMAIL`:
  - `testReserveLoginSlot(serverKey, email)` → invoca `reserveLoginSlot` y devuelve `{blocked, fingerprint}` (no el hash).
  - `testFinalizeLogin(serverKey, email, fingerprint, ok)` → invoca `finalizeLogin`, devuelve `{sessionCreated}`.
  - `testDeleteIdentity(serverKey, email)` → borra la fila de la identidad dedicada (para el caso "usuario borrado entre reserva y finalización").
- **Tests nuevos** (`chromium-secrets`):
  - **Prueba 8 (I5), determinista:** estado limpio (incl. `ip:203.0.113.42`) → **11 llamadas concurrentes con la contraseña CORRECTA** y `ipHint=203.0.113.42` → **exactamente 10 con sesión, 1 rechazada** (`LOCKED`), y **`getKdfCount == 10`**. Demuestra que el límite por IP acotó el KDF a 10.
  - **Prueba 9 (I7), determinista, vía wrappers:** `testReserveLoginSlot` (huella del hash viejo) → cambiar la contraseña por el flujo real de recuperación → `testFinalizeLogin(fingerprint_viejo, ok:true)` → **`sessionCreated == false`**. Segundo caso: reserva → `testDeleteIdentity` → finalize → `sessionCreated == false`. Y la sesión previa muere tras el cambio (ya cubierto por MIS-285, se reafirma).
  - **Política:** `resetPasswordWithTicket` con `password` (del corpus) → rechazada con error de política; con una fuerte → aceptada y `passwordPolicyVersion == CURRENT`.
  - **Alta (M4):** el script rechaza una contraseña del corpus; cuenta sembrada no aparece en `accountsPendingRotation()`.

---

## 7. Despliegue (orden obligatorio)

Sin cambios de firma → sin ventana de incompatibilidad. Rotación con orden:
1. Deploy Convex **dev** (tablas nuevas, corpus empaquetado, tests).
2. Merge PR (CI verde, suite completa).
3. Deploy Convex **prod** (deploy-token) desde `main` limpio — hora + commit + ID.
4. **Rotar** cada cuenta con contraseña en prod por recuperación.
5. `accountsPendingRotation()` en prod → `[]` (prueba 10) — evidencia de cierre.
6. `LOGIN_EMAIL_VETO` se deja **activo**. Su retirada es MIS-291.

Railway rebuild al mergear: inocuo (sin cambios de frontend).

---

## 8. Verificación

**Automática (CI, dev):** `npm run lint`, `npm run build`, `npm run test:e2e` (pruebas 8, 9, política, alta), `npm run test:e2e:secret-gate`.

**Manual en prod:**
- **Prueba 8 (I5), con contraseña CORRECTA** (sugerencia del auditor): 10 accesos permitidos desde una IP + el 11.º **rechazado** desde esa misma IP; **control:** acceso con éxito desde una IP limpia. Once contraseñas incorrectas no probarían el motivo.
- **Prueba 9 (I7):** la carrera "login en vuelo" **no es reproducible en prod** sin el harness (que allí está inerte, por diseño). La **prueba de I7 es la determinista contra dev** (§6, vía wrappers) ejecutada **sobre el mismo commit desplegado**; en **prod** se comprueba el efecto observable reproducible: **cambiar la contraseña por recuperación elimina las sesiones anteriores** (invariante de MIS-285, se reafirma con una sesión abierta que deja de valer tras el cambio).
- **Prueba 10 (I6):** `accountsPendingRotation()` → `[]`.
- Flujo real intacto: login (cuenta rotada) + recuperación completa.

---

## 9. Criterio de cierre

PR mergeado · **Convex desplegado a prod** (hora + commit + ID) · pruebas 8-9 pasadas · **`accountsPendingRotation()` en prod = `[]`** (prueba 10). El veto queda puesto; lo retira MIS-291.

---

## 10. Alcance de la ronda 3 (lo que el auditor revisará)

1. Resolución de M1 mediante **claves separadas** — `<email>` (veto, `LOGIN_EMAIL_VETO_LIMIT`) y `login-counter:<email>` (telemetría, `LOGIN_EMAIL_COUNTER`), cada una con config fija para siempre; el interruptor nunca reinterpreta un contador (§2, §3.3, §3.4).
2. Semántica de reset: el login correcto resetea **ambas** claves de email y **nunca** la de IP; el harness limpia ambas + `ip:203.0.113.42` (§3.3, §5).
3. Cualquier cambio nuevo introducido para corregir M1.

---

**Resumen para auditoría (ronda 3):** el patrón reserva→KDF→finalización se mantiene. M1 se cierra con **dos claves de email de semántica fija** (`<email>` veto / `login-counter:<email>` telemetría), que el interruptor nunca reinterpreta; el login correcto resetea ambas y el harness las limpia. M2–M5 (ronda 2) siguen resueltos: contabilidad uniforme en `finalizeLogin`, prueba de I5 determinista con IP exacta y doble cerrojo, contrato atómico de `seedUser` con validación en el script, y wrappers de harness para I7 reproducible. El veto no se retira aquí (MIS-291).

# MIS-292 — Seguridad login · Fase 2 — Endurecimiento (M1 · M3 · M4)

## Context

El perímetro de seguridad del login (I1–I7) quedó cerrado en producción con
MIS-288/289/290/291. Fase 2 del plan maestro (`PLANS/PLAN-CORRECCION-SEGURIDAD-LOGIN-2026-08-10.md`,
sección "Fase 2", líneas 441–463) recoge tres endurecimientos de riesgo **medio** que no
son invariantes de seguridad pero cierran huecos concretos del flujo de login/recuperación:

- **M1** — el login escribe en la tabla indexada `loginAttempts` un `emailKey` **sin cota
  de longitud**. `passwordReset.ts` ya se protege (≤254) antes de tocar el rate limit;
  `auth.ts` se quedó fuera de esa disciplina. Un email arbitrariamente largo se convierte en
  clave de rate limit → filas grandes en una tabla indexada.
- **M3** — el "ticket de reseteo" (token opaco que autoriza fijar la nueva contraseña)
  viaja hoy por estado React + `<input type="hidden">`. Debe pasar a **cookie `httpOnly`**
  con `maxAge` = TTL del ticket (15 min), fuera del alcance de JS del cliente.
- **M4** — al cambiar la contraseña se actualiza el hash y se matan todas las sesiones
  **sin avisar a nadie**. Debe enviarse un email de aviso "tu contraseña ha cambiado".

Resultado buscado: cerrar M1/M3/M4 siguiendo los moldes ya existentes en el código, sin
cambiar la API pública de Convex (los specs de recuperación siguen valiendo) y con
despliegue a Convex prod para M1+M4.

## Decisión de empaquetado: un solo PR

Los tres sub-items son pequeños, cohesionados (mismo flujo login/recuperación), y **M1+M4
comparten el mismo deploy a Convex prod**; el criterio de cierre del ticket es único
("PR mergeado · ticket enlazado · Convex desplegado a producción"). Van en **un único PR /
una única rama** `mistumonso/mis-292-...`. M3 es frontend (Railway auto-despliega al
mergear); M1+M4 son Convex (deploy manual tras merge).

## Historial de auditoría

- **Ronda 1 → NO-GO** (diseño validado; 2 Majors sobre rigor de pruebas, ningún Blocker):
  - **M-A1** — la prueba de M1 (solo error genérico visible) **también pasaría con el código
    vulnerable actual**, porque hoy el email largo llega a `finalizeLogin`, que escribe
    `login-counter:<email>` (y el veto `<email>`) antes de devolver el error. → Falso verde.
  - **M-A2** — el e2e de M3 no comprueba que la cookie sea realmente `httpOnly`, con `path`/TTL
    correctos, inaccesible a JS y **borrada** tras el reset; una implementación con
    `httpOnly:false`/TTL mal/sin `clear` seguiría en verde.
  - Corregidos en este plan (§Verificación + §Harness de pruebas). También aplicadas las
    sugerencias Media (marcador determinista de M4; precisión del contrato de `runAfter`;
    aserción de ausencia de `ticket` en el estado) y Baja (import solo de `emailWithinLimits`;
    nota de sincronía de la constante de 900 s; política de la cookie ante error).
  - Decisiones ya validadas y **no reabribles** sin evidencia nueva: emplazamiento del guard
    M1 en `loginWithPassword`, API Convex intacta en M3, patrón mutation→scheduler→action de
    M4, empaquetado en un solo PR.
- **Ronda 2 → NO-GO** (M-A1 y M-A2 resueltos; 1 Major nuevo, ningún Blocker):
  - **M-A3** — el marcador de M4 usaba un **contador global por email**, que no identifica el
    reset concreto: un `action` diferido de un test anterior puede insertar su marcador
    **después** de la limpieza del test actual → falso verde (el contador llega a 1 por el
    reset anterior) o falso rojo (llega a 2 si ambos insertan). La causalidad "este cambio
    programó exactamente un aviso" no quedaba demostrada.
  - Corregido: el marcador se **correlaciona con el reset concreto** por el id de la fila de
    reset consumida (`row._id` de `passwordResetCodes`); la consulta del harness resuelve la
    **fila de reset actual** (única para la identidad tras `resetTestIdentity`) y cuenta solo
    los marcadores de **ese** `resetId`. La limpieza por email se conserva como higiene, no
    como fuente de identidad. También aplicadas las Media (el marcador prueba
    programación+ejecución del `internalAction`, no la entrega de Resend; se registra **antes**
    del intento de Resend) y Baja (unificar `resetTestIdentity`; afirmar en test
    `OVERSIZED_TEST_EMAIL.length > MAX_EMAIL_LENGTH`; el e2e de M3 solo inspecciona metadatos).

---

## M1 — Acotar la longitud del email en `login`

**Estado hoy:** `loginWithPassword` (`convex/auth.ts:188-214`) normaliza el email en la
línea 200 (`const emailKey = normalizeEmailKey(args.email)` — solo `trim`+`toLowerCase`, sin
cota) y lo pasa a `reserveLoginSlot` (línea 203), que a su vez lo usa como clave de rate
limit; la fila entra en `loginAttempts` vía `recordFailedAttempt` (`convex/lib/rateLimit.ts`).
El cap ≤254 solo existe como constante **module-local** en `passwordReset.ts:34,39-41`
(`MAX_EMAIL_LENGTH` + `emailWithinLimits`); no está compartido.

**Cambios:**
1. **Compartir el helper** — mover `MAX_EMAIL_LENGTH = 254` y `emailWithinLimits(normalized)`
   a `convex/lib/rateLimit.ts` (junto a `normalizeEmailKey`) y **exportarlos**.
2. `convex/passwordReset.ts` — eliminar sus copias locales (líneas 34, 39-41) e **importar
   solo `emailWithinLimits`** desde `./lib/rateLimit` (NO `MAX_EMAIL_LENGTH`: ya no lo
   referencia directamente y un import sin usar dispara lint — Baja de ronda 1). Sin cambio de
   comportamiento (mismos dos call sites: 63 y el del path de código).
3. `convex/auth.ts` — en `loginWithPassword`, **inmediatamente después** de la línea 200
   (`normalizeEmailKey`) y **antes** de la 203 (`reserveLoginSlot`), añadir el guard:
   ```ts
   if (!emailWithinLimits(emailKey)) {
     return { success: false as const, error: GENERIC_ERROR };
   }
   ```
   Rechaza con el **error genérico** (indistinguible de credenciales incorrectas) **antes**
   de construir claves o tocar `loginAttempts`. Va **después** de la comprobación de
   `serverKey` (que por I3 es siempre la primera sentencia, líneas 196-198). `GENERIC_ERROR`
   ya está en `auth.ts:30`.

**Nota de diseño (diverge del literal del plan maestro):** el plan maestro decía "el sitio
es `reserveLoginSlot`". La exploración confirma que la normalización y la construcción de la
clave ocurren en la **action** `loginWithPassword`, no dentro de `reserveLoginSlot` (que
recibe `emailKey` ya normalizado como argumento). El punto de choque único y correcto —
"rechazar antes de construir claves o consultar `isLocked`" — es por tanto la action. Se
razona así para el auditor.

---

## M3 — El ticket de reseteo pasa a cookie `httpOnly`

**Estado hoy:** `verifyResetCodeAction` (`src/lib/auth/actions.ts:80-99`) devuelve
`{ step: "password", ticket: result.ticket }`; el ticket entra en el estado React de
`RecoverForm.tsx:23` y se pinta como `<input type="hidden" name="ticket">`
(`RecoverForm.tsx:128`); `resetPasswordAction` lo lee con `formData.get("ticket")`
(`actions.ts:108`). TTL del ticket = `TICKET_TTL_MS = 15*60*1000` (`passwordReset.ts:32`).
**La API de Convex no cambia** (`verifyResetCode`/`resetPasswordWithTicket` idénticas).

**Cambios (siguiendo el molde `setOAuthStateCookie`/`clearOAuthStateCookie` de
`src/lib/auth/cookie.ts:39-67`):**
1. `src/lib/auth/constants.ts` — añadir `RESET_TICKET_COOKIE_NAME = "reset_ticket"`.
2. `src/lib/auth/cookie.ts` — trío nuevo `setResetTicketCookie` / `readResetTicketCookie` /
   `clearResetTicketCookie` con:
   ```ts
   httpOnly: true,
   secure: process.env.NODE_ENV === "production",
   sameSite: "lax",
   path: "/recuperar-contrasena",   // scoped a la ruta del wizard
   maxAge: 15 * 60,                  // 900 s = TICKET_TTL_MS/1000 (clear usa maxAge:0)
   ```
   `path: "/recuperar-contrasena"` = ruta del `page.tsx` del wizard; las Server Actions
   hacen POST a esa misma URL, así que la cookie viaja en `verify`→`reset`. Constante local
   `RESET_TICKET_TTL_SECONDS = 15 * 60` en `cookie.ts`, espejo de `OAUTH_STATE_TTL_SECONDS`,
   **con comentario que documente que duplica a propósito `TICKET_TTL_MS` (`passwordReset.ts:32`)
   y debe cambiarse a la vez** (Baja de ronda 1).
3. `src/lib/auth/actions.ts`:
   - `verifyResetCodeAction` — en éxito: `await setResetTicketCookie(result.ticket)` y
     devolver `{ step: "password" }` (**sin** `ticket`).
   - `resetPasswordAction` — leer `const ticket = (await readResetTicketCookie()) ?? ""`
     (en vez de `formData.get("ticket")`); tras éxito, `await clearResetTicketCookie()`
     **antes** del `redirect("/login?reset=ok")`.
   - `RecoverActionState` — el variante `password` pierde `ticket`:
     `| { step: "password"; error?: string }`. **Este cambio de tipo es la garantía a nivel
     de compilación de que el `ticket` ya no vuelve al cliente en el estado serializado**
     (Media de ronda 1); el e2e lo corrobora por ausencia del hidden input y de la cookie en
     `document.cookie`.
4. `RecoverForm.tsx` — eliminar `<input type="hidden" name="ticket" value={state.ticket} />`
   (línea 128). El resto del componente no cambia (ya no referencia `state.ticket`).

**Política de la cookie ante error (Baja de ronda 1):** la cookie se borra **solo tras el
reset con éxito**. En los errores de validación locales de `resetPasswordAction`
(`PASSWORD_MISMATCH_ERROR`, `PASSWORD_POLICY_ERROR`, previos a llamar a Convex) la cookie se
**conserva** a propósito para permitir reintentar dentro de los 15 min; un ticket ya caducado
es inofensivo (es `httpOnly` y expira solo por `maxAge`). No se limpia antes de forma
anticipada (el auditor lo marcó como no necesario).

**Regresión a vigilar:** el ticket ya no vuelve al cliente; el spec de recuperación debe
seguir verde extremo-a-extremo (la cookie hace el trayecto que hacía el hidden input).

---

## M4 — Avisar por email de un cambio de contraseña

**Estado hoy:** `resetPasswordWithTicket` (`convex/passwordReset.ts:247-295`, `mutation`)
parchea `passwordHash`+`passwordChangedAt` (279-283), marca el ticket usado (284) y borra
todas las sesiones (286-291), y **no envía nada**. Enviar email necesita `fetch` → solo
posible en un `action`, no en un `mutation`. Patrón establecido: la mutation programa un
`internalAction` con `ctx.scheduler.runAfter(0, …)` (igual que `requestPasswordResetCode`
→ `deliverResetCode`, `passwordReset.ts:77-115`).

**Cambios (siguiendo el molde `passwordResetCodeHtml` + `sendPasswordResetCodeEmail` +
`deliverResetCode`):**
1. `convex/lib/resend.ts` — nueva plantilla `passwordChangedHtml(name)` (mismo estilo:
   barra `#3B5266`, card 420px, `escapeHtml` sobre `name`) con aviso "si no has sido tú,
   contacta / restablece de nuevo"; y helper exportado `sendPasswordChangedEmail(to, name)`
   (POST a Resend, subject p.ej. `"Tu contraseña ha cambiado"`, errores relanzados **solo**
   con el estado HTTP, sin destinatario/cuerpo — igual que `sendPasswordResetCodeEmail`).
2. `convex/passwordReset.ts`:
   - En `resetPasswordWithTicket`, tras el bucle de borrado de sesiones (línea 291) y
     **antes** del `return { ok: true }`: leer el usuario para el destinatario
     (`const user = await ctx.db.get(row.userId)`) y, si existe,
     `await ctx.scheduler.runAfter(0, internal.passwordReset.deliverPasswordChangedEmail,
     { email: user.email, name: user.name, resetId: row._id })`. **`resetId = row._id`** (id de
     la fila de `passwordResetCodes` consumida) es el correlador que da causalidad al marcador
     de test (cierra M-A3).
   - Nuevo `internalAction` `deliverPasswordChangedEmail({ email, name, resetId })`: (a) si el
     destinatario es la identidad dedicada y la credencial del harness está configurada,
     `ctx.runMutation(internal.testSupport.recordPasswordChangedNotice, { email, resetId })`
     **antes** del intento de Resend (marcador aislado y correlacionado — ver §Harness); (b)
     `sendPasswordChangedEmail(email, name)` en `try/catch` con `console.error` **sin**
     destinatario ni contenido (espejo de `deliverResetCode`, `passwordReset.ts:101-111`).
   - Sin rate limit propio: solo se dispara tras un cambio consumado (exige ticket válido).

**Nota de disparo y contrato de programación (corrige Media de ronda 1):** a diferencia de
`deliverResetCode`, aquí **no** hay preocupación de enumeración (el llamante ya demostró
control vía ticket); el `scheduler`/`action` es únicamente por el requisito de `fetch`. La
**entrega asíncrona** no condiciona el éxito del reseteo porque el `internalAction` captura
sus propios errores (`try/catch`); pero la **programación** (`ctx.scheduler.runAfter`) forma
parte de la transacción de la mutation, así que un fallo al programar sí abortaría el cambio
de contraseña. Es el comportamiento deseado (fail-closed) y por eso el `runAfter` va al final,
tras el cambio ya aplicado en la misma transacción.

---

## Harness de pruebas (nuevo — cierra M-A1, M-A2, M-A3)

Todo lo del harness es **fail-closed en prod**: inerte si `E2E_TEST_SUPPORT_KEY`
(`TEST_SUPPORT_ENV_VAR`) no está, que en prod no existe. Sigue el molde de `recordOutbox`/
`getLastResetCode`/`resetTestIdentity` de `convex/testSupport.ts`.

**M1 — prueba determinista de "cero filas" (M-A1):**
- `convex/lib/testIdentity.ts` — nueva constante `OVERSIZED_TEST_EMAIL`, ya normalizada
  (minúsculas, sin espacios) y de **longitud >254**, construida a partir del cap para que no
  pueda quedar inválida por un cambio de sufijo: p.ej.
  `"a".repeat(MAX_EMAIL_LENGTH + 1) + "@oversized.test.local"`. `normalizeEmailKey` la deja
  igual y `emailWithinLimits` da `false`. (El e2e afirma `OVERSIZED_TEST_EMAIL.length >
  MAX_EMAIL_LENGTH` como red de seguridad del fixture — Baja de ronda 2.)
- `convex/testSupport.ts` — nueva `query` `countOversizedLoginAttempts(serverKey)`:
  `assertTestKey`, y cuenta filas en `loginAttempts` para **exactamente** dos claves derivadas
  de esa identidad fija — `OVERSIZED_TEST_EMAIL` y `loginCounterKey(OVERSIZED_TEST_EMAIL)`
  (usa el helper de `rateLimit.ts`, no un prefijo escrito a mano) — y devuelve el total. No
  acepta clave arbitraria: no es una introspección genérica.
- `resetTestIdentity` — limpieza previa: `resetAttempts` sobre esas dos claves, para que la
  prueba sea determinista aunque una corrida previa (código vulnerable) hubiera dejado filas.

**M4 — marcador determinista, correlacionado por reset (M-A3):**
- `convex/schema.ts` — nueva tabla `testPasswordChangedOutbox: { email, resetId, createdAt }`
  con `resetId: v.id("passwordResetCodes")`, índices `by_email` (higiene) y `by_resetId`
  (identidad de la prueba). **Separada** de `testOutbox` (no contamina `getLastResetCode`).
- `convex/testSupport.ts`:
  - `internalMutation` `recordPasswordChangedNotice({ email, resetId })` — inerte sin la
    credencial; `assertDedicatedIdentity`; inserta `{ email: RESET_TEST_EMAIL, resetId,
    createdAt }`.
  - `query` `countPasswordChangedNotices(serverKey, email)` — `assertTestKey` + identidad
    dedicada. **Resuelve el reset actual** dentro del harness: localiza el usuario dedicado y
    su fila de `passwordResetCodes` (tras `resetTestIdentity` hay exactamente una; defensivo:
    la de `usedAt` más reciente), toma su `_id`, y devuelve el nº de marcadores con
    `resetId === ese _id` (índice `by_resetId`). Un `action` diferido de un test anterior
    llevaría el `_id` de una fila **ya borrada** (id distinto, nunca reutilizado por Convex) →
    no cuenta; el aviso de este reset lleva el `_id` de la fila actual → cuenta exactamente 1.
  - `resetTestIdentity` — borra además, como **higiene** (no como fuente de identidad), los
    marcadores `by_email` de `RESET_TEST_EMAIL`.

## Ficheros

**Convex (deploy a prod tras merge):**
- `convex/lib/rateLimit.ts` — exportar `MAX_EMAIL_LENGTH` + `emailWithinLimits` (M1).
- `convex/auth.ts` — guard de longitud en `loginWithPassword` (M1).
- `convex/passwordReset.ts` — importar `emailWithinLimits` (M1); `scheduler` +
  `deliverPasswordChangedEmail` con marcador de harness (M4).
- `convex/lib/resend.ts` — `passwordChangedHtml` + `sendPasswordChangedEmail` (M4).
- `convex/lib/testIdentity.ts` — `OVERSIZED_TEST_EMAIL` (harness M1).
- `convex/schema.ts` — tabla `testPasswordChangedOutbox` con `resetId` + índices
  `by_email`/`by_resetId` (harness M4).
- `convex/testSupport.ts` — `countOversizedLoginAttempts` (M1); `recordPasswordChangedNotice`
  + `countPasswordChangedNotices` (M4); y limpieza añadida en `resetTestIdentity` (claves
  oversized de M1 + marcadores de M4).

**Frontend (Railway auto-deploy al mergear):**
- `src/lib/auth/constants.ts` — `RESET_TICKET_COOKIE_NAME` (M3).
- `src/lib/auth/cookie.ts` — trío set/read/clear del ticket (M3).
- `src/lib/auth/actions.ts` — cookie en verify/reset, `RecoverActionState` sin `ticket` (M3).
- `src/app/(auth)/recuperar-contrasena/RecoverForm.tsx` — quitar el hidden input (M3).

**E2E:**
- `e2e/password-reset.spec.ts` — aserciones de cookie de M3 + marcador de M4.
- `e2e/edge-cases.spec.ts` — caso de email >254 de M1.

**Entrega/auditoría:** todo el código en `CODIGO/MIS-292-endurecimiento/` (+ un único
`MIS-292-codigo-completo.md`), instalado en el repo tras GO de la auditoría de código.

## No-objetivos

- No se toca el `secure` dependiente de `NODE_ENV` (es Fase 3 B1/B2).
- No se retira el interruptor `LOGIN_EMAIL_VETO` (Fase 3).
- No cambia ninguna firma/retorno de la **API pública** de Convex (los call sites de los specs
  de recuperación siguen valiendo). Lo único nuevo es harness de test (tabla + funciones
  `testSupport`), inerte en prod por `TEST_SUPPORT_ENV_VAR`.
- No se añade rate limit al aviso de M4.

## Verificación

- **Build + typecheck:** `npm run build` (Next) y typecheck de Convex verdes; `eslint` limpio.

- **M1 (e2e determinista — cierra M-A1):** caso nuevo en `e2e/edge-cases.spec.ts`:
  1. Red de seguridad del fixture: afirmar `OVERSIZED_TEST_EMAIL.length > MAX_EMAIL_LENGTH`.
  2. `resetTestIdentity` (limpia las dos claves de `OVERSIZED_TEST_EMAIL`).
  3. Intento de login con `OVERSIZED_TEST_EMAIL` (>254) vía la action pública
     `loginWithPassword` (o la UI de login).
  4. **Aserción principal:** `countOversizedLoginAttempts(serverKey) === 0` — prueba que **no
     se escribió ninguna fila** ni para `<email>` ni para `login-counter:<email>` (con el
     código vulnerable actual sería ≥1, así que el test **falla** sin el guard).
  5. Control adicional: el login devuelve el error genérico visible.

- **M3 (e2e determinista — cierra M-A2):** en `e2e/password-reset.spec.ts`, tras `verify` y en
  el paso de contraseña, usando `context.cookies()` de Playwright — **solo metadatos, sin leer
  ni registrar el valor** de la cookie:
  - la cookie `reset_ticket` existe con `httpOnly === true`, `sameSite === "Lax"`,
    `path === "/recuperar-contrasena"` y `expires` ≈ ahora + 900 s (con tolerancia).
  - `page.evaluate(() => document.cookie)` **no** contiene `reset_ticket` (inaccesible a JS).
  - **ya no existe** `input[name="ticket"]` en el DOM del paso de contraseña.
  - tras el reset con éxito y el `redirect`, `context.cookies()` **ya no** contiene
    `reset_ticket` (se borró). El flujo extremo a extremo sigue verde con el harness de MIS-286.
  - (`password-reset-invariants.spec.ts` debe seguir verde sin cambios.)

- **M4 (e2e determinista + prod-manual):**
  - **Determinista (causalidad, cierra M-A3):** el spec de recuperación, tras completar el
    cambio de la identidad dedicada, hace *polling* hasta que
    `countPasswordChangedNotices(serverKey, RESET_TEST_EMAIL) === 1`. La consulta cuenta solo
    los marcadores del **reset concreto** que este test consumió (correlación por `resetId` =
    id de la fila de reset actual, resuelta dentro del harness), así que un `action` diferido
    de un test anterior no puede producir falso verde ni falso rojo. Prueba que el cambio
    **programó y ejecutó exactamente un aviso** (`internalAction`), **no** que Resend lo
    entregara.
  - **Aceptación en prod (modelo MIS-285):** cambiar la propia contraseña por el flujo de
    recuperación y confirmar que llega el email "tu contraseña ha cambiado" — este es el gate
    de la **entrega real**.

- **Igualdad CODIGO ↔ repo** byte-a-byte tras instalar.
- **Sentinel de secretos:** `e2e/secret-sentinel.spec.ts` / `test:e2e:secret-gate` siguen verdes
  (el valor del ticket nunca se imprime en las nuevas aserciones).
- **Deploy Convex prod** (M1+M4) vía técnica de deploy-token; verificar login normal + un
  cambio de contraseña real en prod.

## Metodología / Gate

Este plan **no es GO** (rondas 1 y 2 = NO-GO; correcciones aplicadas). Vuelve a **auditoría
externa ronda 3**, cuyo alcance declarado es: (1) correlación inequívoca entre un reset y su
marcador M4; (2) consulta del harness que afirme exactamente un marcador para ese reset; (3)
limpieza/aislamiento frente a `action`s retrasados de pruebas anteriores; (4) unificación del
nombre `resetTestIdentity`; (5) cambios nuevos introducidos para cerrar M-A3. M-A1, M-A2, el
diseño de la cookie, el emplazamiento del guard M1 y el patrón scheduler/action **no se
reabren**. Solo tras veredicto **GO** explícito se crea rama y se escribe el código en
`CODIGO/MIS-292-endurecimiento/`. Después: auditoría de código
→ instalar → PR (pedir permiso antes de cada push) → CI verde → **merge lo hace el
asistente** con permiso → **deploy Convex prod (M1+M4)** → verificar → cerrar MIS-292 en
Linear con el PR enlazado.

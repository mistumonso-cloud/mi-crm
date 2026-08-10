# MIS-285 · Fase 2 — Recuperación de contraseña por CÓDIGO (OTP) por email (Resend)

> **Plan v3.2 — GO CONDICIONADO (3ª y 4ª ronda).** Su arquitectura no se reabre. El GO se activa cuando **MIS-286 obtenga GO y quede mergeado**.
>
> Cambios acumulados, solo de encaje con MIS-286: la tabla `passwordResetCodes` pasa a definirla MIS-286 (M10); contrato exacto de `recordOutbox` (M11); y **sus dos specs pasan al project `chromium-secrets`** (sin trace/vídeo/captura), con las comprobaciones de contraseña hechas por cliente y no por formulario (B1).
>
> Ticket: [MIS-285](https://linear.app/mistu-monso/issue/MIS-285/email-transaccional-con-resend-recuperacion-de-contrasena)
> **Depende de: [MIS-286](https://linear.app/mistu-monso/issue/MIS-286/harness-seguro-de-pruebas-e2e-para-recuperacion-de-contrasena)** (harness seguro de pruebas) — **debe estar mergeado antes de implementar este ticket**.
> Prerrequisito de config: Fase 1 (DNS + dominio **verificado** en Resend) ✅ hecha — `PLANS/MIS-285-resend-dns-setup.md`.

---

## Contexto

El CRM tiene login por contraseña (MIS-24) y por Google (MIS-260), pero **no hay forma de recuperar la contraseña** si se olvida. Este plan añade ese flujo por **código numérico (OTP)** enviado por email con Resend.

Flujo: en el login, enlace **"¿Olvidaste tu contraseña?"** → pedir email → enviar un **código de 6 dígitos** → el usuario lo introduce → si coincide (con caducidad y límite de intentos) → fija la nueva contraseña → vuelve al login.

## Decisiones (confirmadas con el usuario)

- **Código:** 6 dígitos. **Caducidad:** 15 min. **Intentos máx.:** 5.
- **UI:** una pantalla `/recuperar-contrasena` con 3 pasos (email → código → nueva contraseña).
- **Tras cambiar:** ir a `/login`, **re-login obligatorio** (se invalidan todas las sesiones). Sin auto-login.
- **Email inexistente:** respuesta **genérica** siempre (anti-enumeración).

---

## Cambios de v2 → v3 (respuesta a la 2ª ronda)

| # | Corrección |
|---|---|
| **B1** | **Toda la infraestructura de pruebas sale de este ticket** → [MIS-286](https://linear.app/mistu-monso/issue/MIS-286). Aquí ya no se define `testSupport`, ni `testOutbox`, ni `ALLOW_TEST_ENDPOINTS`, ni cableado de CI. MIS-285 **consume** el harness (credencial de alta entropía fail-closed + identidad dedicada). |
| **M7** | El límite por IP **solo se consulta y contabiliza si `normalizeIpHint` devuelve un valor no nulo**, replicando el guard del login (`convex/auth.ts:46`). Se elimina la concatenación que producía `"resetip:null"`. |
| **M8** | Resuelto en MIS-286 (`resetTestIdentity` limpia las claves de `loginAttempts` de la identidad dedicada). Aquí solo se declara el estado inicial que asume cada spec. |
| **M9** | Resuelto en MIS-286 (`expireResetCode`). Este plan lo **usa** para la prueba de caducidad. |
| Sugerencias | «solo el último código **generado** es válido»; aserciones **deterministas** para `generateNumericCode` (sin estadística intermitente). |

**No se reabre** lo aprobado en la ronda 1 (M1–M6): mutation pública que solo rate-limita y programa trabajo diferido, esquema y ticket opaco, hashing, invalidación transaccional de sesiones, rutas Next y plantilla del email.

---

## Modelo de datos — definido por MIS-286 (M10)

**Este ticket ya NO crea la tabla**: el esquema de `passwordResetCodes` lo aporta **MIS-286**, que se mergea antes y necesita compilar contra ella. MIS-285 solo la **usa**. Se reproduce aquí como referencia del contrato:

```ts
passwordResetCodes: defineTable({
  userId: v.id("users"),
  codeHash: v.optional(v.string()),        // hashToken(code); se BORRA al verificar (código consumido)
  expiresAt: v.number(),                   // Date.now() + 15 min
  attempts: v.number(),                    // intentos fallidos de verificación
  ticketHash: v.optional(v.string()),      // hashToken(ticket), fijado al verificar OK
  ticketExpiresAt: v.optional(v.number()),
  usedAt: v.optional(v.number()),          // cambio consumado (un solo uso)
})
  .index("by_user", ["userId"])
  .index("by_ticketHash", ["ticketHash"]),
```

> Tanto `passwordResetCodes` como `testOutbox` las define **MIS-286**. `convex/schema.ts` **no se toca en este ticket**.

## Backend — `convex/passwordReset.ts` (crear)

Reutiliza `hashToken`/`generateOpaqueToken` (`convex/lib/token.ts:19-27`), `constantTimeEqual`/`hashPassword` (`convex/lib/password.ts:48,57`), `convex/lib/rateLimit.ts`, e índice `sessions.by_user` (`schema.ts:223`). **Todas las funciones declaran `args` y `returns`.**

### 1. `requestPasswordResetCode` — *mutation* pública `{email, ipHint}` → `{ok: true}`

Anti-enumeración por respuesta **y por tiempo**: no consulta `users` y no espera a Resend.

```ts
const emailKey = `reset:${normalizeEmailKey(args.email)}`;
const ipKey = normalizeIpHint(args.ipHint ?? null);   // string | null

// M7: la clave de IP solo existe si la IP es válida — nunca "resetip:null".
let allowed = !(await isLocked(ctx, emailKey));
if (allowed && ipKey) allowed = !(await isLocked(ctx, `resetip:${ipKey}`));

// Aquí se contabilizan SOLICITUDES (no fallos): siempre se registra.
await recordFailedAttempt(ctx, emailKey, EMAIL_RATE_LIMIT);          // 5 / 15 min
if (ipKey) await recordFailedAttempt(ctx, `resetip:${ipKey}`, IP_RATE_LIMIT);  // 20 / 60 min

await ctx.scheduler.runAfter(0, internal.passwordReset.deliverResetCode, {
  email: args.email, allowed,
});
return { ok: true };
```

### 2. `deliverResetCode` — *internalAction* `{email, allowed}`

Si `!allowed` → return. Si no: `code = await ctx.runMutation(internal.passwordReset.createResetCode, {email})`; si `null` → return; enviar con `sendPasswordResetCodeEmail`. Errores de Resend: `console.error` **sin código, destinatario ni cuerpo**.

**Contrato de `recordOutbox` (M11)** — idéntico al declarado en MIS-286:

- Es **`internalMutation`** (definida en MIS-286): no forma parte de `api.*`, ningún cliente externo puede invocarla, por lo que **no recibe `serverKey`**.
- **Valida estrictamente la identidad dedicada**: lanza si el email normalizado no es `RESET_TEST_EMAIL`.
- `deliverResetCode` **solo la invoca cuando el email normalizado es exactamente `RESET_TEST_EMAIL`**:

```ts
if (normalizeEmailKey(args.email) === RESET_TEST_EMAIL) {
  await ctx.runMutation(internal.testSupport.recordOutbox, { email: args.email, code });
}
// Cualquier otro destinatario omite el outbox y continúa hacia Resend con normalidad.
await sendPasswordResetCodeEmail(email, name, code);
```

Así la **prueba manual en dev con un email real** funciona sin tropezar con el harness.

### 3. `createResetCode` — *internalMutation* `{email}` → `{code, email, name} | null`

Normaliza email, busca por `by_email`; si no existe → `null`. Si existe → borra filas previas no usadas del user (`by_user`) e inserta `{codeHash: await hashToken(code), expiresAt: +15 min, attempts: 0}` con `generateNumericCode(6)`.

### 4. `verifyResetCode` — *mutation* pública `{email, code, ipHint}`

- Rate-limit `resetcode:<email>` con `EMAIL_RATE_LIMIT`; el guard de IP sigue la **misma regla de M7** (solo si `ipKey` no es nulo).
- Fila activa del user (`by_user`, sin `usedAt`, `expiresAt > now`, **con `codeHash` presente**). Si no hay, o `attempts >= 5` → error **genérico** ("Código incorrecto o caducado").
- `constantTimeEqual(await hashToken(code), codeHash)`. Fallo → `attempts++` + `recordFailedAttempt` → error genérico.
- OK → `ticket = generateOpaqueToken()`; `patch { ticketHash: await hashToken(ticket), ticketExpiresAt: +15 min, codeHash: undefined }` (**consume el código**: no puede volver a emitir tickets); `resetAttempts`. Devuelve `{ok:true, ticket}`.

### 5. `resetPasswordWithTicket` — *mutation* pública `{ticket, newPassword}`

- Revalida política (8–128 caracteres).
- Fila por `by_ticketHash`. Si no existe / `usedAt` / `ticketExpiresAt < now` → error ("La sesión de recuperación caducó, vuelve a empezar").
- `patch(user, {passwordHash: await hashPassword(newPassword)})`; `patch(fila, {usedAt: now})`; **borra todas las sesiones** (`sessions.by_user` + loop `ctx.db.delete`, patrón `auth.ts:195-209`). Todo en la misma mutation (atómico).

### 6. `cleanupExpiredResetCodes` — *internalMutation* para el cron.

## Cliente Resend — `convex/lib/resend.ts` (crear)

`fetch` a `POST https://api.resend.com/emails` con `Authorization: Bearer ${process.env.RESEND_API_KEY}` y `{from: process.env.RESEND_FROM, to, subject, html}`. `sendPasswordResetCodeEmail(to, name, code)` con HTML de marca inlineado (hex de `DESIGN/design-system/tokens/colors.css`: `#3B5266`, `#1A1D24`, `#6B7280`, `#FAFAFA`, `#FFFFFF`, `#E5E7EB`; `font-family:'Inter',system-ui,Arial,sans-serif`). **`name` se escapa antes de interpolar** (`&<>"'`). Copy español, sentence case; aviso "válido 15 minutos, un solo uso; si no fuiste tú, ignora este correo". Non-2xx → `throw` sin datos sensibles.

## Generación de código — `convex/lib/token.ts` (editar)

`generateNumericCode(digits = 6): string` con **rejection sampling** sobre `crypto.getRandomValues(new Uint32Array(1))` (descartar valores ≥ `floor(2**32 / 10**digits) * 10**digits`, luego `% 10**digits`, `padStart`). Misma primitiva que `generateOpaqueToken` (`token.ts:20`).

## Server actions — `src/lib/auth/actions.ts` (editar)

Tres actions con la forma de `useActionState` (patrón `loginAction:12-28`; `redirect()` al final, fuera del trabajo de red; `ipHint` desde `headers()`):
- `requestResetCodeAction` → `{step:"code", email}` (siempre avanza).
- `verifyResetCodeAction` → OK `{step:"password", ticket}` / fallo `{step:"code", error}`.
- `resetPasswordAction` → valida coincidencia + política (8–128) → OK `redirect("/login?reset=ok")` / fallo `{step:"password", error}`.

## Pantallas

- **`src/app/(auth)/recuperar-contrasena/page.tsx`** (crear) — Server Component; si hay sesión redirige (como `login/page.tsx:22-25`).
- **`RecoverForm.tsx`** (crear) — Client Component, 3 pasos (`step`, `email`, `ticket`; email/ticket en `<input hidden>`). Incluye **"Reenviar código"** y **"Usar otro email"** (transiciones tras caducidad o 5 intentos). Reutiliza `Input` (`inputMode="numeric"`, `maxLength={6}`) y `Button`; errores en `<div role="alert">` como `LoginForm.tsx:90-107`; enlace "Volver al login".
- **`src/app/(auth)/login/LoginForm.tsx`** (editar) — `<a href="/recuperar-contrasena">¿Olvidaste tu contraseña?</a>` tras el `Input` de contraseña (`:88`).
- **`src/app/(auth)/login/page.tsx`** (editar) — leer `?reset=ok` (`searchParams` es Promise → `await`) y mostrar aviso de éxito.

## Cron — `convex/crons.ts` (editar)

`crons.daily("cleanup expired reset codes", { hourUTC: 3, minuteUTC: 5 }, internal.passwordReset.cleanupExpiredResetCodes)`.

## Variables de entorno (solo Convex, NO Railway)

| Variable | Convex dev | Convex prod |
|---|---|---|
| `RESEND_API_KEY` | ✅ ya puesta | ⛔ **gate de predeploy** |
| `RESEND_FROM` = `no-reply@mistu-monso.com` | pendiente | ⛔ **gate de predeploy** |

Documentar en `.env.local.example` y `README.md`. No hace falta `SITE_URL` (el email no lleva enlace). La credencial del harness la gestiona MIS-286.

## Seguridad (checklist)

- Solo hashes en BD (`hashToken`); comparación con `constantTimeEqual`.
- Código: 6 dígitos, 15 min, 5 intentos, **consumido al verificar**, uno activo por usuario.
- Ticket: 32 bytes opacos, 15 min, un solo uso; cambio + borrado de sesiones en la **misma mutation**.
- Anti-enumeración **por respuesta y por tiempo**.
- Rate limiting: `reset:<email>`, `resetcode:<email>` (obligatorios) y `resetip:<ip>` **solo con IP válida** (M7).
- Límites de entrada: email ≤ 254, contraseña 8–128.
- Nunca se loguea código, ticket, destinatario ni cuerpo del email.

## Gotchas (Next 16 + Convex)

- `params`/`searchParams` son **Promises** → `await`.
- **NO añadir** `/recuperar-contrasena` al `matcher` de `src/proxy.ts:44` (debe ser accesible sin sesión).
- `redirect()` lanza internamente → al final de la action.
- Las mutations no hacen `fetch` → el envío va en la *internalAction* programada.

## Comportamiento ante fallos / concurrencia

Cada solicitud **invalida el código anterior**: solo el **último código generado** sigue siendo válido. Si dos emails se cruzan, el que llegue primero puede llevar un código ya invalidado — de ahí el botón "Reenviar código" y el aviso en pantalla.

## Ficheros a crear/tocar

> `convex/schema.ts` **no se toca**: ambas tablas las define MIS-286 (M10).

1. `convex/passwordReset.ts` (crear).
3. `convex/lib/resend.ts` (crear).
4. `convex/lib/token.ts` — `generateNumericCode`.
5. `convex/crons.ts` — cron de limpieza.
6. `src/lib/auth/actions.ts` — 3 server actions.
7. `src/app/(auth)/recuperar-contrasena/page.tsx` + `RecoverForm.tsx` (crear).
8. `src/app/(auth)/login/LoginForm.tsx` — enlace.
9. `src/app/(auth)/login/page.tsx` — aviso `?reset=ok`.
10. `playwright.config.ts` — añadir los dos specs de este ticket al `testMatch` del project **`chromium-secrets`** (definido por MIS-286, sin trace/vídeo/captura), **no** a `chromium-unauth`.
11. `e2e/password-reset.spec.ts` (crear) — flujo UI completo.
12. `e2e/password-reset-invariants.spec.ts` (crear) — invariantes.
13. `.env.local.example`, `README.md`.
14. `PLANS/README.md` — registrar MIS-285.

## Pruebas / verificación (gate ejecutable)

**Comando:** `npm run test:e2e` → job **`e2e`** de `.github/workflows/ci.yml` (ya cableado). Specs en **`chromium-secrets`** (sin sesión y **sin trace/vídeo/captura**, project de MIS-286), `workers: 1`.

> **Manejo del secreto (B1):** las comprobaciones de "la contraseña nueva funciona" y "la vieja ya no" se hacen con `api.auth.login` vía `ConvexHttpClient` desde Node, **no** rellenando el formulario. Lo único que se teclea en la UI es la contraseña nueva del formulario de restablecimiento, que es la funcionalidad bajo prueba. Ambos usan el envoltorio `e2e/helpers/test-support.ts` de **MIS-286** y arrancan con `resetTestIdentity()`, que **devuelve una contraseña recién generada** (nunca almacenada en el repositorio). Estado inicial declarado: identidad `reset@test.local` existente con esa contraseña efímera, sin códigos, sin outbox, sin sesiones y **sin bloqueos de rate limit**. La contraseña nueva que fija el spec durante el flujo también se genera en tiempo de ejecución en Node, no como literal.

- **`password-reset.spec.ts`** — pedir código en la UI → leerlo con `getLastResetCode()` → introducirlo → fijar nueva contraseña (generada en runtime, nunca literal) → `/login?reset=ok` → verificar por `ConvexHttpClient` que **la nueva funciona** y **la vieja ya no**.
- **`password-reset-invariants.spec.ts`**:
  - `generateNumericCode` (importado de `convex/lib/token`): **aserciones deterministas** — longitud exacta 6, solo dígitos (`/^\d{6}$/`), valor numérico en 0–999999, y en N=200 muestras no todas idénticas. Sin aserciones estadísticas de colisión.
  - Vía `ConvexHttpClient`: código incorrecto → error genérico; **6.º intento bloqueado**; **código caducado** (usando `expireResetCode()` de MIS-286, sin esperar 15 min); **ticket reutilizado falla**; **`countSessionsFor` = 0 tras el cambio**.
- **Repetibilidad:** `npm run test:e2e` **dos veces seguidas** en verde (M8).
- **Manual en dev** (previo al PR): pedir recuperación con un email real propio, recibir el código, completar el flujo.
- **Predeploy a prod (gates):** `RESEND_API_KEY` y `RESEND_FROM` presentes en Convex prod; credencial del harness **ausente**; `npx convex deploy` ejecutado (paso manual históricamente olvidado).

## Orden de implementación

1. **MIS-286** (harness) — plan, GO, código, PR, merge.
2. **MIS-285** (este) — solo después.

## Fuera de alcance

DMARC `p=none` se mantiene. MIS-264 (OAuth → mistu-monso.com) es independiente. Deployment Convex exclusivo para CI, limpieza de `loginAttempts` y centralizar la política de contraseña → follow-up.

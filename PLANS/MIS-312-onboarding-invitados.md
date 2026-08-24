# Plan — MIS-312: Onboarding de primera contraseña para invitados (página de bienvenida)

> **Revisión 2 (2026-08-21)** — cierra M1 de la auditoría de plan (migración de la cookie `reset_ticket` del path antiguo) e incorpora las sugerencias media/baja. Cambios concentrados en §1, §3, §5, "Destino…" y Verificación.

## Context

MIS-309 dejó viva la invitación de usuarios, pero el email de invitación dirige al invitado a **"Recuperar contraseña"** (`/recuperar-contrasena`), lo cual es una chapuza: esa persona **nunca tuvo contraseña que recuperar**. La usuaria lo vio como poco profesional.

**Decisión ya tomada (con el usuario, 2026-08-20):** Camino A — **onboarding con página de bienvenida propia, SIN identifier-first** (el login sigue email+contraseña juntos, para no romper la anti-enumeración que el proyecto endureció a propósito). Mecánica: **código de un solo uso tecleado** (nada de magic-link). Objetivo: que crear la primera contraseña se sienta profesional, sin tocar la postura de seguridad ni el backend.

**Hallazgo clave de la exploración:** el backend NO necesita cambios. `convex/passwordReset.ts::resetPasswordWithTicket` ya limpia `invitePendingSince` (es decir, **ya es la vía de aceptación de la invitación por contraseña**), y `requestPasswordResetCode` **siempre** responde `{ok:true}` sin consultar `users` (anti-enumeración intacta). Por tanto MIS-312 es esencialmente **frontend + copy + repunte del email**, reutilizando el motor de código/ticket existente.

Restricción del repo: Next.js 16 modificado (leer `node_modules/next/dist/docs/` antes de tocar routing/actions); `searchParams` es `Promise` y se `await`ea (patrón ya usado en `login/page.tsx`).

## Cambios

### 1. Cookie del ticket a path `/` + migración segura — `src/lib/auth/cookie.ts` (cierra M1)
La cookie del ticket (`reset_ticket`, MIS-292) está hoy **scoped a `path:"/recuperar-contrasena"`** (`setResetTicketCookie` L155-165 y `clearResetTicketCookie` L172-182; ambas ya expiran además una `LEGACY_RESET_TICKET_COOKIE_NAME`). Las server actions se comparten entre ambas rutas y hacen POST a la URL de la página actual; una cookie scoped a `/recuperar-contrasena` **no se enviaría** desde `/configurar-contrasena`, y `resetPasswordAction` perdería el ticket entre "código" y "contraseña". Por eso hay que **ampliar el `path` a `/`**.

> **Revisión 3 — ajuste de implementación (desviación declarada).** Al implementar se comprobó que la API de cookies de Next.js (`ResponseCookies`) **indexa por NOMBRE** (`_parsed.set(name,…)`): **no se pueden emitir dos `Set-Cookie` con el mismo nombre y distinto path en una misma respuesta** (la segunda sobrescribe a la primera). Por eso el enfoque "mismo nombre, expira el path viejo en el mismo set" **no es realizable**. Se adopta la alternativa que la propia auditoría listó como válida: **renombrar** el ticket a un nombre nuevo en path `/` + **lectura dual transitoria** al nombre anterior (nombres distintos ⇒ sin colisión). Además, el nombre real actual es **`__Secure-reset_ticket`** (prefijo de MIS-293), no `reset_ticket` a secas. Detalle abajo.

**M1 (migración) — evitar dos cookies del ticket a la vez durante el despliegue (enfoque final).**
- El ticket pasa a **`__Host-reset_ticket`** con `path:"/"` (al ser path `/` + Secure + sin Domain, ya cabe el prefijo `__Host-`, más fuerte que el `__Secure-` anterior). Constante `RESET_TICKET_COOKIE_NAME` en `src/lib/auth/constants.ts`.
- `setResetTicketCookie`: emite `__Host-reset_ticket` (path `/`) **y** expira el ticket anterior `__Secure-reset_ticket` en su path estrecho `/recuperar-contrasena` (nombre distinto ⇒ ambos `Set-Cookie` se emiten). Mantiene el borrado del legacy pre-B2 (`reset_ticket`).
- `readResetTicketCookie`: lee `__Host-reset_ticket` y, **como fallback TRANSITORIO de migración**, cae a `__Secure-reset_ticket` (para recuperaciones que verificaron el código ANTES del despliegue). Retirar el fallback en un follow-up pasada la ventana de 15 min.
- `clearResetTicketCookie`: expira `__Host-reset_ticket` (path `/`) **y** `__Secure-reset_ticket` (path `/recuperar-contrasena`) **y** el legacy `reset_ticket` — todos nombres/paths distintos, sin colisión.
- Esto **cierra M1** (nunca coexisten dos cookies del MISMO nombre) y respeta la compatibilidad con recuperaciones en vuelo (lectura dual). Constante compartida `LEGACY_RESET_TICKET_PATH = "/recuperar-contrasena"` para set/clear.

**Contrato de la migración (redacción precisa):** tras emitir la `__Host-reset_ticket` nueva, **no debe quedar** la `__Secure-reset_ticket` anterior (ni el legado `reset_ticket`) — se expiran en la misma respuesta (nombres distintos ⇒ sin colisión con la API de Next). Tres generaciones distintas: `reset_ticket` (pre-MIS-293), `__Secure-reset_ticket` (MIS-293→MIS-312) y `__Host-reset_ticket` (MIS-312).

La cookie sigue `httpOnly`, `secure`, `sameSite:"lax"`, single-use, TTL 15 min; con `path:"/"` **cumple `__Host-`** (refuerzo del navegador: Secure + Path=/ + sin Domain). Ampliar el scope a `/` es una relajación mínima y consciente del path estrecho de MIS-292; se documenta.

> **Follow-up registrado (deuda):** retirar el fallback de lectura dual a `__Secure-reset_ticket` **y** el soporte del legado `reset_ticket` solo DESPUÉS de superar el TTL máximo (15 min) desde el despliegue de MIS-312 y confirmar que no quedan recuperaciones en vuelo. (Ticket de seguimiento aparte.)

### 2. Wizard reutilizable — `src/app/(auth)/recuperar-contrasena/RecoverForm.tsx`
Parametrizar el copy (hoy hardcodeado) sin cambiar la lógica de los 3 pasos ni las 3 server actions:
- Añadir props **opcionales** con valores por defecto = copy actual de recuperación → **el flujo de recuperación no cambia de comportamiento**:
  - `copy`: `{ title, subtitleEmail, subtitleCode, subtitlePassword, submitEmail, submitPassword, footerHref?, footerLabel? }`.
  - `initialEmail?: string` → `defaultValue` del `<Input name="email">` del paso 1 (se sigue arrancando en `step:"email"` para que el código se ENVÍE de verdad; solo se prellena el campo).
- Las 3 acciones (`requestResetCodeAction`/`verifyResetCodeAction`/`resetPasswordAction`, en `src/lib/auth/actions.ts`) se reutilizan **tal cual** (no llevan copy dentro).

### 3. Página de onboarding — `src/app/(auth)/configurar-contrasena/page.tsx` (NUEVA)
Clon del patrón de `recuperar-contrasena/page.tsx`:
- `const user = await getSession(); if (user) redirect(landingPathForRole(user.role));` (defensa: un logueado no hace onboarding — mismo comportamiento que las otras auth pages; el proxy no toca estas rutas, ver exploración).
- `const { email } = await searchParams;` — **normalizar** antes de pasarlo como `initialEmail`: `searchParams` puede dar `string | string[] | undefined`; tomar el primer valor si es array, recortar espacios y **DESCARTAR (dejar el campo vacío)** si está vacío, si supera 254 o si no parece un email — **NO truncar** (truncar podría convertir una entrada manipulada en otra dirección aparentemente válida y disparar un envío innecesario de código). Es solo un prellenado del campo (no autoriza nada; el servidor revalida en el flujo de código).
- Renderiza el mismo `RecoverForm` con **copy de bienvenida**: título "Te damos la bienvenida", subtítulos ("Te enviaremos un código para crear tu contraseña" / "Introduce el código de 6 dígitos que te hemos enviado" / "Crea tu contraseña"), botones ("Enviar código" / "Crear contraseña"), footer "Volver al inicio de sesión" → `/login`.
- Mismo wrapper centrado (`flex flex-1 items-center justify-center ... px-4 py-16`).

### 4. Repunte del email de invitación — `convex/lib/resend.ts`
- `sendInviteEmail(to, name)`: cambiar `recoverUrl` a `` `${getAppBaseUrl()}/configurar-contrasena?email=${encodeURIComponent(to)}` ``.
- `inviteHtml`: reescribir el copy que menciona **«Recuperar contraseña»** por onboarding ("Pulsa el botón para crear tu contraseña"; "Si el código no funciona, pide otro en esa misma pantalla"). Mantener la mención a "entrar con Google con este mismo correo". Sin cambios en los callers (`convex/team.ts`).

### 5. Pista en login — `src/app/(auth)/login/LoginForm.tsx` (DECISIÓN CERRADA: se incluye)
Añadir, junto a "¿Olvidaste tu contraseña?" (L110-115), una línea sutil **"¿Primera vez? Revisa tu email de invitación."** Puramente presentacional (ayuda a la descubribilidad del onboarding). Decisión cerrada: **se incluye** (sin ramas indeterminadas en el entregable).

## Destino tras crear la contraseña (decisión)
`resetPasswordAction` revoca todas las sesiones y redirige a `/login?reset=ok` (no auto-login: es la semántica del flujo de ticket). Para onboarding se **reutiliza tal cual**: el invitado crea su contraseña → aterriza en `/login` para entrar.

**Fragmento a ajustar (identificado):** el mensaje de éxito lo renderiza `src/app/(auth)/login/page.tsx:34` — `initialSuccess={reset === "ok" ? "Contraseña actualizada. Ya puedes iniciar sesión." : undefined}` (que `LoginForm` pinta como `initialSuccess`). "actualizada" chirría para quien la crea por primera vez → cambiar a un texto **neutro** válido para ambos flujos, p. ej. **"Contraseña guardada. Ya puedes iniciar sesión."** Es el único cambio en ese fichero.

**Auto-login tras onboarding queda FUERA de alcance** (añadiría creación de sesión desde un ticket, superficie de seguridad nueva; se puede valorar aparte).

## Seguridad / invariantes
- **Anti-enumeración intacta**: `requestPasswordResetCode` sigue respondiendo `{ok:true}` siempre; la página de onboarding no revela si un email existe. El login no cambia (sigue email+contraseña, sin identifier-first).
- **Sin cambios de backend de auth**: se reutiliza el flujo código→ticket→contraseña; `resetPasswordWithTicket` ya limpia `invitePendingSince` (aceptación) y revoca sesiones.
- Cookie del ticket: se amplía su `path` a `/` **y** se limpia la variante del path antiguo en set/clear (M1); sigue httpOnly/secure/sameSite/single-use/15 min.

## Deuda consciente aceptada (sugerencias baja de auditoría)
- **Email en `?email=`**: el correo del invitado viaja en la URL del enlace → queda en historial/logs/referrers. **No concede acceso** (el código sigue llegando al buzón y el servidor revalida), pero es un dato personal en la URL. Se acepta conscientemente a cambio de la UX de prellenado; documentado.
- **Copy de "bienvenida" si alguien abre `/configurar-contrasena` manualmente con una cuenta ya activa**: la página también permite pedir un código para cualquier cuenta (es el mismo motor). El copy de alta podría resultar raro para una cuenta ya activa, pero **no revela la existencia de la cuenta** (respuesta genérica). Es deuda de UX menor, no de seguridad; se acepta (diferenciar visualmente sin filtrar existencia queda como follow-up).

## Fuera de alcance
- Login identifier-first (descartado por anti-enumeración).
- Auto-login tras crear la contraseña.
- Cambios en la aceptación por Google (ya vive en MIS-309).
- Visibilidad de las acciones por fila (eso es MIS-314).

## Verificación (end-to-end)
1. **e2e Playwright** (reutiliza el harness de recuperación con la identidad dedicada `reset@test.local`, cuyo código se lee por `getLastResetCode`):
   - Nueva spec: ir a `/configurar-contrasena?email=reset@test.local` → "Enviar código" → leer el código del outbox de test → introducirlo → crear contraseña → aterriza en `/login?reset=ok`. Cubre el wizard en la ruta nueva + la cookie del ticket a path `/`.
   - **Prueba de migración M1**: sembrar manualmente en el contexto del navegador una cookie `reset_ticket` con `path:"/recuperar-contrasena"` (simulando una recuperación iniciada antes del despliegue), luego ejecutar el flujo nuevo y comprobar que (a) no queda ambigüedad (tras `set`/`clear` no coexisten dos `reset_ticket`), (b) **ambas rutas** (`/recuperar-contrasena` y `/configurar-contrasena`) completan el cambio de contraseña sin fallar. **Nota:** cada recorrido necesita su **propio ticket** (el ticket es single-use) → usar códigos/tickets distintos por ruta para que el segundo recorrido no falle por diseño.
   - **Estado de cookies justo tras el `set`** (no solo al final del flujo): inspeccionar los headers/estado inmediatamente después de emitir el ticket para demostrar que la MISMA respuesta lleva a la vez el alta en `path:"/"` y la expiración de la variante del path antiguo.
   - **Atributos de la cookie raíz**: afirmar explícitamente `httpOnly`, `secure`, `sameSite:"lax"`, `path:"/"`, TTL ~15 min (**con tolerancia razonable**, no exacta, por el tiempo entre emisión e inspección), y **ausencia** de la cookie tras consumir/invalidar el ticket (en ambos paths).
   - Regresión: `e2e/password-reset*.spec.ts` sigue verde (cookie ampliada a `/`).
2. **Convex/manual**: invitar a un email (MIS-309) → el email ahora enlaza a `/configurar-contrasena?email=…` con copy de bienvenida (sin "recuperar") → completar el flujo → el usuario pasa de "Invitación pendiente" a "Activo" (invitePendingSince limpiado) y puede entrar.
3. **Anti-enumeración**: pedir código para un email inexistente en `/configurar-contrasena` responde igual ("te hemos enviado un código").
4. `npm run lint` / `tsc` / `build` en verde antes de PR.

## Metodología / Gate
**Este plan NO es GO.** Está pendiente de **auditoría de plan externa**. Solo un veredicto **GO** explícito autoriza escribir código. Entregables: rama única `mis-312-onboarding-invitados`, código en `CODIGO/MIS-312-onboarding-invitados/` con `codigo-completo.md` autocontenido, PR enlazado a MIS-312.

# Plan — MIS-309: Pantalla de gestión de usuarios (Equipos y roles)

> **Revisión 2 (2026-08-20)** — cierra los Majors M1 (invitación no recuperable) y M2 (contrato de errores) de la primera ronda de auditoría. Cambios concentrados en §1, §2, §4, §9 y Verificación.
>
> **Revisión 3 (2026-08-20)** — cierra M3 (login con Google eludía "Invitación pendiente") de forma quirúrgica: §3 (transición de aceptación por Google), más ajustes menores en Estados, §4 (concurrencia de reenvío), §9 (persistencia del aviso) y §Seguridad. Sin ampliar arquitectura ni alcance.

## Context

Hoy las cuentas del CRM se crean **a mano** (`seedUser` internalMutation + hash por CLI) y solo existen 2 (Carlos = `rep`, Marta = `supervisor`). No hay ninguna pantalla ni API para administrar el equipo. Marta es la dueña y necesita poder, por sí misma y sin ayuda técnica: **ver el equipo, invitar a alguien, cambiarle el rol y quitarle el acceso** cuando alguien entra o se va.

La Fase 0 de diseño ya está hecha y mergeada (MIS-311 → `DESIGN/design-system/templates/users-admin/UsersAdmin.dc.html`, azul pizarra `#3B5266`). Este plan es la **construcción** (MIS-309).

**Decisiones de producto tomadas (2026-08-20):**
1. **Rol admin = `supervisor`** (Marta). No se añade un rol nuevo; se reintroduce un guard "solo supervisor" para las mutaciones de administración. "No dejar el CRM sin admin" = no quitar/desactivar el último supervisor **activo**.
2. **Primera contraseña = invitación por email**, reutilizando el mecanismo de ticket de un solo uso de MIS-285 (`convex/passwordReset.ts` + `convex/lib/resend.ts`). **Google es una segunda vía de aceptación** que no requiere crear contraseña (§3): un invitado puede aceptar entrando con Google sin pasar por el ticket.
3. **Alcance de este ticket**: listar, invitar/alta (con reenvío recuperable), cambiar rol, desactivar/reactivar (baja lógica reversible). **Fuera de alcance**: reset de contraseña disparado por la admin.
4. **Entrada**: sección "Usuarios y equipo" dentro del **Panel** de Marta (solo visible para `supervisor`) que enlaza a una pantalla propia `/equipo`.

**Restricción del repo**: Next.js **16.2.10** modificado (ver `AGENTS.md`) — leer `node_modules/next/dist/docs/` antes de tocar routing/server actions. React 19 (`useActionState`), Convex 1.42. Server actions usan `refresh()` de `next/cache` (no `revalidatePath`).

---

## Estados de un usuario (modelo derivado)
Tres estados mutuamente excluyentes, reflejados en el badge de la lista:
- **Invitación pendiente**: `invitePendingSince` presente y `deactivatedAt` ausente. Creado por invitación, aún **sin** primera contraseña. **No cuenta** como supervisor activo para el guard "último admin". Ofrece acción "Reenviar invitación".
- **Activo**: sin `invitePendingSince` ni `deactivatedAt`.
- **Inactivo**: `deactivatedAt` presente.

`invitePendingSince` se **limpia** por **cualquiera** de las dos vías de aceptación de la invitación: (a) el usuario establece su contraseña por ticket (hook en `resetPasswordWithTicket`, §6), o (b) inicia sesión con Google con ese email (§3). **Invariante clave**: una sesión solo puede existir tras la aceptación → **toda sesión válida ⇒ la cuenta ya no está pendiente**. Por eso el badge, el cómputo de supervisores activos y los permisos (`requireOwner`) nunca ven una cuenta pendiente con sesión.

---

## Backend (Convex)

### 1. Schema — `convex/schema.ts` (tabla `users`, ~L207)
Añadir campos **opcionales** (usuarios existentes sin ellos = activos, sin backfill):
- `deactivatedAt: v.optional(v.number())` — epoch ms; presencia = inactivo (también auditoría).
- `deactivatedBy: v.optional(v.id("users"))`
- `invitedBy: v.optional(v.id("users"))`
- `invitePendingSince: v.optional(v.number())` — epoch ms; presencia = invitación pendiente (ver estados). Se limpia al establecer la primera contraseña.

`_creationTime` cubre "fecha de alta". No se añade índice nuevo (la lista hace `.collect()`).

### 2. Autorización y contrato de errores — `convex/lib/authz.ts`
- `requireUser(ctx, token)`: si no hay sesión válida (incluye usuario **desactivado**, ver §3), lanza `new ConvexError({ code: "UNAUTHENTICATED", message })`.
- `requireOwner(ctx, token)` = `requireUser` + si `role !== "supervisor"` lanza `new ConvexError({ code: "FORBIDDEN", message })`.
- En `lookupSessionUser`: si el usuario tiene `deactivatedAt`, devolver `null` (sesión inválida → logout efectivo).
- **Invariante del contrato**: estos son los **únicos dos códigos que se lanzan**. Cualquier otro rechazo (validación, duplicado, "último admin", "usuario no encontrado", "no está pendiente") se **devuelve** como valor discriminado `{ success: false, error, field? }` desde la función; **jamás se lanza**. Esto es lo que permite a las server actions (§9) distinguir sesión-inválida de error-de-negocio sin ambigüedad.

### 3. Enforcement de la baja y aceptación por login — `convex/auth.ts`
- **Baja**: en `loginWithPassword` (tras resolver por `by_email`) y en `loginWithGoogle`: si `deactivatedAt` está puesto → `{ success: false, error }` genérico (no revelar el motivo). Al desactivar se revocan sesiones (ver §4, `revokeAllUserSessions`, ya existe).
- **Aceptación por Google (cierra M3) — decisión: un login con Google correctamente autenticado ES la aceptación de la invitación.** En `loginWithGoogle`, tras autenticar el email ya provisionado y **antes** de crear la sesión: si el usuario tiene `invitePendingSince`, en el mismo `internalMutation` que crea la sesión (`finalizeLogin`/equivalente Google) hacer `patch` limpiando `invitePendingSince` (y su `deactivatedBy` no aplica) e invalidar cualquier código/ticket de invitación pendiente (reutiliza la invalidación de `createResetCode`). Resultado: la cuenta pasa a **Activo** de forma persistida y atómica con la creación de sesión → estado, badge, cómputo de supervisores y permisos coinciden desde el primer request autenticado.
- **Password login no necesita transición**: una cuenta pendiente tiene un `passwordHash` inservible y **no puede** hacer password-login hasta consumir el ticket (`resetPasswordWithTicket`, §6), que ya limpia `invitePendingSince`. Por tanto no existe camino de password-login mientras está pendiente.
- Justificación de seguridad: el signup está cerrado; `loginWithGoogle` solo autentica un email **ya provisionado** (por la invitación de Marta). Controlar ese email Google = ser el invitado previsto. No se concede acceso a nadie no invitado.

### 4. Nuevo módulo `convex/team.ts`
Validar `name`/`email`/`role` contra whitelist antes de escribir. Normalizar email igual que `seedUser` (lower + trim). Los rechazos de negocio se **devuelven**, no se lanzan (§2).

**Invitación (cierra M1) — `inviteUser` es una ACTION pública**, porque el envío de email es un action y así la acción **conoce el resultado de la entrega** (una mutation no puede `await` el envío):
- `action inviteUser({ token, name, email, role })`:
  1. `res = await ctx.runMutation(internal.team.createPendingUser, { token, name, email, role })`. Ese internalMutation: `requireOwner` (lanza UNAUTHENTICATED/FORBIDDEN), normaliza y valida email, **dedupe** por `by_email` `.unique()`:
     - email de una cuenta **activa/inactiva** → `{ success:false, field:"email", error:"Ya existe un usuario con ese email" }`.
     - email de una cuenta **pendiente** → `{ success:false, code:"already_invited", error:"Ya invitado; usa Reenviar invitación" }`.
     - si no existe → inserta usuario con `passwordHash` aleatorio inservible (`hashPassword(generateOpaqueToken())`), `invitedBy: owner.id`, `invitePendingSince: Date.now()`; genera el ticket/código de primera contraseña reutilizando la lógica de `createResetCode`; devuelve `{ success:true, userId, name, email, code }`.
  2. Si `!res.success` → la action devuelve ese mismo resultado (error de negocio visible).
  3. Envío: `try { await sendInviteEmail(res.email, res.name, res.code); return { success:true, delivered:true } } catch { return { success:true, delivered:false } }`.
  - **Semántica de éxito (M1)**: `delivered:false` significa "cuenta creada como *Invitación pendiente*, pero el email no salió". La UI **no** presenta acceso garantizado: muestra la fila como *Invitación pendiente* con "Reenviar invitación". La action nunca comunica éxito definitivo por el mero hecho de crear la cuenta.
- **`action resendInvite({ token, userId })` — idempotente, ruta de recuperación (M1)**:
  1. `res = await ctx.runMutation(internal.team.regenerateInvite, { token, userId })`: `requireOwner`; exige que el usuario exista y esté **en Invitación pendiente** (si no → `{success:false, error}`); **invalida los códigos previos** y crea uno nuevo (misma lógica que `createResetCode`); devuelve `{ success:true, email, name, code }`. **No crea ningún usuario** → repetir tras un fallo nunca choca con "email ya existe".
  2. Envío igual que arriba → `{ success:true, delivered:bool }`.
  - **Concurrencia del reenvío** (sugerencia media de auditoría): `regenerateInvite` invalida y reescribe las filas de código del mismo usuario, así que dos reenvíos concurrentes comparten read-set y Convex los **serializa por OCC** (uno se reejecuta). Aun así, para evitar que lleguen dos correos con códigos distintos y confundan, (a) el botón "Reenviar invitación" se **deshabilita mientras `isPending`** (evita doble disparo desde la UI) y (b) al haber un único código válido a la vez, **solo el último regenerado funciona**. Como el orden de entrega de los correos no está garantizado (podría llegar antes uno con un código ya invalidado), el copy del email de invitación indica: "si el código no funciona, pide otro reenvío". No se persigue ordenar la entrega, solo garantizar que hay un único código válido y una vía clara si el recibido no sirve.

**Resto de operaciones (mutations con `requireOwner`)**:
- `listTeam({ token })` → `requireOwner`. Devuelve `[{ id, name, email, role, deactivatedAt, invitePendingSince }]` (nunca `passwordHash`; `returns` validator explícito como en `getSessionUser`). El cliente deriva el badge y marca "Tú".
- `changeUserRole({ token, userId, role })` → `requireOwner`. **Guard "último admin"**: si `userId` es el único `supervisor` **activo** (los pendientes no cuentan) y se le baja a `rep` → `{ success:false, error:"No puedes dejar el CRM sin ninguna administradora" }`.
- `setUserActive({ token, userId, active })` → `requireOwner`.
  - `active === false`: **guards** (devueltos): no desactivar el último supervisor activo, ni a una misma si es el último. Si pasa: `deactivatedAt: Date.now()`, `deactivatedBy: owner.id`, y `revokeAllUserSessions(userId)`.
  - `active === true`: limpiar `deactivatedAt`/`deactivatedBy`. **Conserva la contraseña anterior** (no toca `passwordHash`) — decisión consciente: reactivar = volver a poder entrar con su clave previa, sin re-invitar.

**Concurrencia del "último admin"**: `changeUserRole` y `setUserActive` **leen el conjunto completo de supervisores** (`.collect()` filtrado por rol/estado) dentro del guard. Convex serializa por OCC sobre el read-set: dos operaciones concurrentes que ambas dependen de ese conjunto entran en conflicto y la segunda se reejecuta contra el estado ya actualizado, donde su guard la rechaza. Así la invariante se mantiene sin ventana TOCTOU.

### 5. Email de invitación — `convex/lib/resend.ts`
- `sendInviteEmail(to, name, code): Promise<void>` clonando la plantilla branded existente (`passwordResetCodeHtml`) con copy de bienvenida ("Te han dado acceso al CRM… establece tu contraseña"), apuntando al flujo existente `/recuperar-contrasena`.
- El internalAction de entrega vive dentro de las actions `inviteUser`/`resendInvite` (que ya son actions), reutilizando `sendInviteEmail`.

### 6. Hook de primera contraseña — `convex/passwordReset.ts`
- En `resetPasswordWithTicket`, al hacer `patch` del `passwordHash`, **limpiar `invitePendingSince`** del usuario. Así, al establecer su primera contraseña, la cuenta pasa de *Invitación pendiente* a *Activo*.

---

## Frontend (Next.js)

### 7. Entrada en el Panel — `src/app/(app)/(with-nav)/panel/page.tsx`
Tarjeta/enlace "Usuarios y equipo" visible solo si `user.role === "supervisor"` (render condicional server-side como en `pendientes/page.tsx:32`), enlaza a `/equipo`.

### 8. Pantalla propia — `src/app/(app)/equipo/page.tsx` (fuera de `(with-nav)`, full-screen, como `contactos/nuevo`)
- Server component: `const user = await getUser()`; si `user.role !== "supervisor"` → `redirect("/")` (defensa en profundidad; el guard real está en Convex).
- `const team = await fetchQuery(api.team.listTeam, { token })`.
- Renderiza `TeamView` (client) con `team` y `currentUserId`.

### 9. Componentes cliente — `src/app/(app)/equipo/`
- `TeamView.tsx` (`"use client"`): header + botón primario "Invitar usuario"; lista con `Avatar` + nombre/email + `Badge` de rol (Propietaria/Comercial) + `Badge` de estado (**Activo / Inactivo / Invitación pendiente**) + menú de acciones. `BottomSheet` para el modal de invitar y el diálogo de confirmación destructivo. Las filas *pendientes* muestran "Reenviar invitación".
- `InviteUserForm.tsx`: `useActionState(inviteUserAction, initial)` con `Input` nombre/email + `Select` rol (Comercial por defecto) + nota "Recibirá un email para establecer su contraseña". Cierra el sheet en `state.success` (patrón `EditContactForm`). **Persistencia del aviso `delivered:false`** (sugerencia baja de auditoría): el aviso "Cuenta creada, pero el email no salió" **no** vive dentro del sheet efímero; se eleva así: `inviteUserAction` devuelve `{ success:true, delivered:false }` en el `state` de `useActionState`; `InviteUserForm` lo lee **antes** de pedir el cierre del sheet y lo levanta al contenedor (`TeamView`) vía callback `onResult(state)`, que renderiza el banner/toast a nivel de página; el sheet se desmonta después. Es decir, el aviso vive en `/equipo` (no en el sheet efímero), y **la ruta de recuperación permanente es la propia fila** — toda fila *Invitación pendiente* ofrece siempre "Reenviar invitación", de modo que aunque el usuario pierda el aviso, la recuperación nunca queda oculta al cerrarse el sheet.
- Cambiar rol / desactivar-reactivar / reenviar: patrón "varios submit en un `<form>`" de `ChangeStatusForm.tsx`.
- **Protección "último admin" en UI**: sobre la fila del único supervisor activo / la propia, las acciones destructivas van deshabilitadas. Fuente de verdad = guard de Convex; esto es solo reflejo visual.

### 10. Server actions y contrato de errores — `src/lib/team/actions.ts` (`"use server"`)
Estado discriminado:
```ts
type State =
  | { success: true; delivered?: boolean }
  | { success: false; error: string; field?: string }
  | undefined;
```
Contrato (cierra M2), espejo endurecido de `src/lib/contacts/actions.ts`:
1. `const token = await readSessionToken(); if (!token) redirect("/login");`
2. Validar enums (rol) con whitelist (`hasOwnProperty`).
3. `try { result = await fetchAction/fetchMutation(api.team.*, {...}) } catch (err) { if (err instanceof ConvexError) { const code = err.data?.code; if (code === "UNAUTHENTICATED") redirect("/login"); if (code === "FORBIDDEN") redirect("/"); } throw err; }`
4. `if (!result.success) return { success:false, error: result.error, field: result.field };` → **permanece en /equipo, muestra el mensaje, sin logout**.
5. Éxito: `refresh(); return { success:true, delivered: result.delivered };`.

**Regla clave (M2)**: *solo* `UNAUTHENTICATED` (sesión ausente/inválida/usuario desactivado) redirige a `/login`; `FORBIDDEN` redirige a `/`; **duplicado, último supervisor, "ya invitado" y validaciones vuelven como estado de error visible**, nunca como redirect. Los errores inesperados (no `ConvexError`) se relanzan al error boundary.

### 11. Tokens/estilos
Consumir tokens CSS (`var(--color-accent)`, `var(--color-danger-fg)`, …) y primitivas de `src/components/ui/**` (NO copiar hex del `.dc.html`). Copy en español, sentence case, modo claro, una sola acción primaria. Iconos SVG inline como en `BottomNav.tsx`.

---

## Seguridad / invariantes
- **Contrato de guard real**: las **mutations** de `team.ts` llaman `requireOwner` como primera línea; las **actions públicas** (`inviteUser`, `resendInvite`) no tienen `ctx.db`, así que **delegan primero en su `internalMutation`** (`createPendingUser`/`regenerateInvite`), que ejecuta `requireOwner` **antes de producir cualquier efecto** (inserción, código, envío). `/equipo` y la sección del Panel se gatean además server-side, pero **la autorización real vive en Convex**.
- Guard "último admin" validado en servidor, serializado por OCC (ver §4).
- `listTeam` nunca devuelve `passwordHash` (`returns` validator).
- Desactivar revoca sesiones y bloquea login del desactivado; reactivar conserva la clave previa.
- Contrato de errores por código (§2, §10): negocio ≠ sesión.

## Fuera de alcance (este ticket)
- Reset de contraseña disparado por la admin.
- Rol `owner` distinto de `supervisor`.
- Auditoría ampliada de cambios de rol más allá de `invitedBy`/`deactivatedAt/By`/`invitePendingSince`.

---

## Verificación (end-to-end)
1. **Convex dev** (usuarios `carlos@test.local` / `marta@test.local`):
   - `listTeam` con token de Marta → lista; con token de Carlos → `ConvexError` `FORBIDDEN`.
   - **M1 — fallo de entrega y reintento**: forzar que `sendInviteEmail` falle → la cuenta queda *Invitación pendiente*, la action devuelve `delivered:false`; `resendInvite` (idempotente) regenera e invalida el código previo y entrega **sin crear otro usuario**; reintentar `inviteUser` con el mismo email no crea duplicado (`already_invited`).
   - Invitación feliz → email en `testOutbox`; tras establecer contraseña por `/recuperar-contrasena`, la cuenta pasa a *Activo* (`invitePendingSince` limpiado).
   - **M3 — aceptación por Google**: invitar a un email; **antes** de establecer contraseña, hacer `loginWithGoogle` con ese email → la sesión se concede y, en el mismo paso, `invitePendingSince` queda limpiado (cuenta *Activo*), el badge deja de ser "Invitación pendiente", el ticket de invitación queda invalidado, y si el rol era `supervisor` ya cuenta como supervisor activo. Verificar que **no** existe ningún estado en que haya sesión válida con `invitePendingSince` presente.
   - `changeUserRole` bajando a Marta (único supervisor activo) → **falla** (guard, valor de error, no throw).
   - `setUserActive(false)` sobre Carlos → sesiones revocadas y login bloqueado; `setUserActive(true)` → vuelve a entrar con su clave previa.
   - **Concurrencia**: dos ops simultáneas que afectan al último supervisor activo (p.ej. desactivar A y bajar rol de B, siendo A y B los únicos supervisores) → como mucho una tiene éxito; la otra recibe error de invariante.
   - Normalización de email: alta/duplicado con mayúsculas/espacios distintos se tratan como el mismo email.
2. **E2E Playwright** (gotchas de `PLANS/`/memoria: selectores de submit acotados por formulario; `waitForURL` tras redirects; para entregas async, poll a un valor *distinto* del previo):
   - Login Marta → Panel muestra "Usuarios y equipo" → `/equipo`: invitar, cambiar rol, desactivar/reactivar, reenviar.
   - **M2**: rechazos de negocio (email duplicado, último supervisor) → **permanecen en /equipo**, muestran mensaje, **sin** redirect a `/login`.
   - **M3 en E2E**: invitar → aceptar por Google con ese email → la sesión se concede y el badge del usuario pasa de "Invitación pendiente" a "Activo" (confirma la transición visible, además del contrato persistente del test Convex).
   - Login Carlos → no ve la sección en Panel y `/equipo` redirige a `/`.
   - Usuario desactivado no puede iniciar sesión.
3. `npm run build` / lint (ESLint no-explicit-any) en verde antes de PR.

## Entregables / flujo
- Rama única `mis-309-gestion-usuarios`, código en `CODIGO/MIS-309/` según metodología, PR enlazado a MIS-309. Antes de codificar: doc de auditoría autocontenido (contenido literal de archivos nuevos + diffs completos) para el gate de auditoría.

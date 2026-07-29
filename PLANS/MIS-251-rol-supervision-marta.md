# MIS-251 — Rol supervisión (Marta): ocultar las acciones de escritura en la interfaz

> **Estado**: Plan reabierto y redefinido — decisión de negocio confirmada por el usuario invierte el alcance original del ticket (ver "Decisión fijada"). Pendiente de auditoría.

## Contexto

### Texto literal del ticket (Linear, `MIS-251`)

> **Qué hay que hacer**
>
> Ocultar en la interfaz todas las acciones de escritura al rol **supervisión** (Marta). Hoy el backend ya bloquea las escrituras de Marta (guards de rol en `convex/lib/authz.ts`), pero la UI le muestra botones que, si los pulsa, el sistema rechaza → callejones sin salida. Esta tarea alinea la interfaz con su rol de solo lectura.
>
> **Contexto**
>
> Marta es propietaria y usa el CRM solo para consultar (ver MIS-7). Carlos es quien opera. La navegación de 3 pestañas (Pendientes / Contactos / Panel) es común a ambos y NO cambia — es navegación de lectura. Lo que hay que ocultarle a Marta son las acciones que **crean o modifican** datos.
>
> **Qué ocultar cuando el usuario es Marta (rol supervisión)**
> - Botón flotante «+» (añadir contacto) — no visible para Marta (afecta a MIS-18).
> - Acciones de la Ficha del contacto — ocultar «Añadir nota», «Cambiar estado», «Programar seguimiento», «Cerrar venta» y «Editar datos del contacto», y sus overlays (afecta a MIS-10).
> - Pendientes del día — ocultar «marcar seguimiento como hecho» y el «+» (afecta a MIS-13).
> - Lista de contactos — ocultar el «+» / «añadir uno nuevo» (afecta a MIS-9).
>
> **Criterio de aceptación**
> - Marta no ve ningún botón ni acción que cree o modifique datos en ninguna pantalla.
> - Carlos ve y puede usar todas las acciones como hasta ahora.
> - El bloqueo de backend (authz de Convex) se mantiene como red de seguridad; esta tarea es la capa de UI que evita callejones sin salida.

### Punto de partida: qué ya existe y qué falta

Verificado leyendo el código y el estado real del repo, no asumido:

- **Ya oculto para Marta** (instalado en tickets anteriores, sin tocar en este plan):
  - FAB "+" — `src/app/(app)/(with-nav)/layout.tsx:48`, `{user.role === "rep" && <AddContactFab />}` (MIS-20).
  - Empty-state "Añadir primer contacto" de la lista — `ContactList.tsx`, prop `canCreate` (MIS-9/MIS-20).
  - Formulario de alta — `src/app/(app)/contactos/nuevo/page.tsx`, ternario por rol (MIS-20).
  - "Cambiar estado" / "Cerrar venta" / "Editar datos" en la ficha — `ContactDetailView.tsx`, prop `canChangeStatus` (MIS-14/MIS-15/MIS-252).
  - Sección "Requieren atención" en Pendientes — `pendientes/page.tsx`, `isRep` (MIS-253; es de solo lectura, no una acción de escritura).
- **Nunca se ocultaron**, porque el backend ya las permite explícitamente a ambos roles por decisión previa documentada en el propio código:
  - "Añadir nota" — `convex/notes.ts:46-48`: *"Ambos roles pueden añadir notas (decisión confirmada de MIS-11)"*, usa `requireUser`, no `requireRole`.
  - "Programar/Reprogramar seguimiento" — `convex/reminders.ts:94-96`: *"Ambos roles pueden programar/reprogramar seguimientos (decisión confirmada en el plan de MIS-12)"*, `requireUser`.
  - "Marcar hecho" (`CompleteReminderButton`, usado en Pendientes y en la ficha) — `convex/reminders.ts:209`: `requireUser` ("ambos roles, igual que scheduleReminder").
  - Es decir, la premisa del ticket ("el backend ya bloquea las escrituras de Marta") es cierta para 4 mutations, pero **no** para estas 3.

## Decisión fijada

Al preparar la implementación, surgió un caso de uso real del negocio (aportado por el usuario, dueño del producto): Carlos a veces le pide a Marta que marque un seguimiento como hecho cuando él no tiene acceso a la plataforma. Se preguntó explícitamente, con las implicaciones técnicas completas en cada paso, qué alcance debía tener el ocultamiento — y la decisión final, confirmada tres veces por el usuario con el detalle técnico completo delante en cada una, es:

**Marta conserva acceso de escritura completo, igual que Carlos, en toda la aplicación — tanto en la interfaz como en el backend.**

Esto es la inversa exacta de la redacción actual del ticket, y revierte explícitamente el ADR de `PLANS/MIS-18-navegacion-principal.md` ("Qué NO cambia"):

> *"Cualquier operación de escritura futura (alta de contacto en MIS-8, cambio de estado en MIS-14, cierre de venta en MIS-15...) sigue debiendo llamar[las] como primera línea, **sin excepción**. Este ADR es exclusivamente sobre qué **páginas** puede visitar cada rol, no sobre qué **operaciones de datos** puede ejecutar."*

Se revierte esa cláusula por una razón de negocio explícita (Marta es la propietaria y necesita poder intervenir en cualquier acción cuando Carlos no tiene acceso), no por descuido — queda documentado aquí para que la auditoría lo evalúe como una decisión deliberada, no como una regresión no señalada.

Se implementa quitando la distinción por rol en las 4 mutations que sí la tenían (`createContact`, `updateContact`, `changeContactStatus`, `closeSale`: `requireRole(ctx, token, "rep")` → `requireUser(ctx, token)`, mismo patrón que ya usan `addNote`/`scheduleReminder`/`completeReminder`) y quitando el gating correspondiente en la interfaz. Se hace en ambas capas a la vez porque devolver los botones solo en la interfaz sin tocar el backend recrearía exactamente el problema que el ticket original quería evitar (botones que fallan al pulsarlos), solo que al revés.

## Fuera de alcance (explícito)

- **El modelo de roles en sí** (`role: "rep" | "supervisor"` en `convex/schema.ts`) — se mantiene sin cambios. Sigue determinando la pantalla de aterrizaje por defecto (Carlos → Pendientes, Marta → Panel) y el badge "Operativo".
- **La sección "Requieren atención" de Pendientes** (MIS-253) — es de solo lectura, no una acción de escritura; se queda gateada a `isRep` como hoy, no forma parte de esta decisión.
- **`BottomNav` y la navegación de 3 pestañas** — ya es común a ambos roles (ADR de MIS-18), no se toca.
- **El check de sesión/autenticación** (`requireUser`, cookie, DAL) — sigue igual; lo que se retira es la distinción *por rol* dentro de 4 mutations concretas, no la autenticación en sí.

## Cambios — Backend (`convex/`)

En las 4 mutations que hoy exigen `requireRole(ctx, token, "rep")`, cambiar a `requireUser(ctx, token)`, y reescribir el comentario que documentaba el gating anterior citando esta reapertura:

| Archivo:línea | Mutation | Cambio |
|---|---|---|
| `convex/contacts.ts:82` | `createContact` | `requireRole → requireUser` |
| `convex/contacts.ts:172` | `updateContact` | `requireRole → requireUser` |
| `convex/contacts.ts:339` | `changeContactStatus` | `requireRole → requireUser`; el comentario actual cita literalmente el ADR de MIS-18 de arriba |
| `convex/sales.ts:74` | `closeSale` | `requireRole → requireUser`; mismo caso |

Quitar el import de `requireRole` en `contacts.ts` y `sales.ts` (queda sin uso). En `convex/lib/authz.ts`, eliminar la función `requireRole` (sin llamadores tras el cambio) y ajustar el comentario de cabecera que la menciona junto a `requireUser`.

## Cambios — Frontend (`src/`)

Quitar los 5 puntos donde se calcula `user.role === "rep"` para ocultar UI de escritura, dejando el elemento siempre visible. `getUser()` se sigue llamando en cada sitio (barato, cacheado, sirve de chequeo de sesión) pero sin capturar `.role` para gating:

| Archivo | Cambio |
|---|---|
| `src/app/(app)/(with-nav)/layout.tsx:48` | `{user.role === "rep" && <AddContactFab />}` → `<AddContactFab />` incondicional; `getUser()` sin capturar |
| `src/app/(app)/(with-nav)/contactos/page.tsx:60` | Quitar prop `canCreate={user.role === "rep"}` |
| `src/app/(app)/(with-nav)/contactos/ContactList.tsx` | Quitar `canCreate` del tipo/props; empty-state siempre muestra "Añadir primer contacto" |
| `src/app/(app)/contactos/nuevo/page.tsx` | Quitar el ternario por rol; renderizar `<NewContactForm>` siempre |
| `src/app/(app)/contactos/[id]/page.tsx:48` | Quitar prop `canChangeStatus={user.role === "rep"}` |
| `src/app/(app)/contactos/[id]/ContactDetailView.tsx` | Quitar `canChangeStatus` del tipo/props; "Cambiar estado" y "Editar datos" quedan incondicionales; "Cerrar venta" pasa de `canChangeStatus && !isClosed` a solo `!isClosed` (se conserva por ser lógica de negocio, no de rol) |

**Sin cambios**: "Añadir nota", "Programar/Reprogramar seguimiento" y "Marcar hecho" — nunca estuvieron ocultos, ya funcionan igual para ambos roles.

## Después de instalar (seguimiento, no parte de este plan de código)

Como este plan hace lo contrario de la redacción actual de MIS-251 en Linear, hay que actualizar la descripción/checklist del ticket (o cerrarlo con un comentario explicando la reapertura) para que Linear no quede desalineado con el código — mismo criterio que el ADR de MIS-18 ("Acción de seguimiento: actualizar la descripción/criterio de aceptación... en Linear"). No se toca Linear hasta que este plan reciba GO.

## Archivos afectados

| Archivo | Tipo |
|---|---|
| `convex/contacts.ts` | Editar |
| `convex/sales.ts` | Editar |
| `convex/lib/authz.ts` | Editar |
| `convex/schema.ts` | Editar (solo comentario) |
| `src/app/(app)/(with-nav)/layout.tsx` | Editar |
| `src/app/(app)/(with-nav)/contactos/page.tsx` | Editar |
| `src/app/(app)/(with-nav)/contactos/ContactList.tsx` | Editar |
| `src/app/(app)/contactos/nuevo/page.tsx` | Editar |
| `src/app/(app)/contactos/[id]/page.tsx` | Editar |
| `src/app/(app)/contactos/[id]/ContactDetailView.tsx` | Editar |
| `src/lib/auth/dal.ts` | Editar (solo comentario) |
| `src/lib/contacts/actions.ts` | Editar (comentarios + simplificar 4 ramas `"No autorizado"` ahora inalcanzables) |
| `e2e/role-gating.spec.ts` | Editar (reescrito: pasa de probar "Marta bloqueada" a "Marta funcional") |

Los 4 últimos se añadieron durante el código, siguiendo las condiciones puestas por la auditoría del plan (comentarios obsoletos + spec e2e que codificaba el contrato anterior).

## Verificación

1. `npx convex codegen` / `tsc --noEmit` / `eslint` sobre los archivos tocados — confirmar que no quedan imports/props/variables sin usar (`requireRole`, `canCreate`, `canChangeStatus`, `user` no leído).
2. `npm run build`.
3. Manual, como Marta (`marta@test.local`): ver y poder usar "+", "Cambiar estado", "Cerrar venta" y "Editar datos" en un contacto de prueba, sin error "No autorizado".
4. Manual, como Carlos: sin cambios respecto a hoy.
5. `npm run test:e2e` — revisar si algún spec de Marta (MIS-19/MIS-20) asume estos botones ocultos y actualizarlo si hace falta.

## Estado

**Plan: GO condicionado** (auditoría, ver condiciones más abajo — todas incorporadas al código generado).

**Código generado en `CODIGO/MIS-251-rol-supervision-marta/`, verificado localmente, pendiente de auditoría GO/NO-GO de código:**
- `tsc --noEmit`, `eslint`, `npx convex codegen --typecheck disable` y `npm run build`: sin errores, con el código superpuesto temporalmente sobre `src/`/`convex/` reales (revertido después con `git checkout`).
- `npm run test:e2e` (14 tests, incluida la reescritura completa de `e2e/role-gating.spec.ts`): **14/14 pasan** — se detectó y corrigió en el camino que `npx convex codegen` NO empuja el código de las funciones al deployment de dev pese a su log ("Uploading functions..."), solo `npx convex dev --once` lo hace de verdad (confirmado empíricamente: un `createContact` como Marta seguía rechazándose con "No autorizado" tras `codegen`, y pasó a aceptarse tras `convex dev --once`). Deployment de dev revertido de vuelta al código de `main` tras verificar.
- Condiciones de la auditoría del plan, todas atendidas: `e2e/role-gating.spec.ts` reescrito; `rg requireRole src convex e2e` confirma cero call sites activos (solo menciones en comentarios explicando la reapertura); comentarios obsoletos actualizados en `src/lib/contacts/actions.ts`, `src/lib/auth/dal.ts`, `convex/schema.ts` y `convex/contacts.ts`.
- No se ha creado rama ni tocado Linear todavía — a la espera del veredicto de auditoría de código antes de instalar.

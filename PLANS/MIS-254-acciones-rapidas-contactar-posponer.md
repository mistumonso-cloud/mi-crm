# MIS-254 — Acciones rápidas: contactar (WhatsApp/llamar) y posponer seguimiento

> **Estado**: Plan listo, pendiente de auditoría.

## Contexto

### Texto literal del ticket (Linear, `MIS-254`)

> **Qué hay que hacer**
>
> Dos acciones rápidas que aceleran el día a día de Carlos. Son pequeñas; pueden hacerse juntas o separarse en el re-plan.
>
> **1. Contacto directo desde la ficha (WhatsApp / llamar)**
> - Junto al teléfono del contacto, dos accesos: WhatsApp (abre `wa.me/<número>`) y Llamar (`tel:<número>`).
> - No envía nada desde el CRM: solo abre la app nativa del móvil con la conversación/llamada lista.
> - Solo visible para Carlos. *(ver "Alcance por rol" más abajo — descartado)*
>
> **2. Posponer seguimiento desde Pendientes**
> - En la lista de Pendientes del día, junto a «marcar hecho», un botón «Posponer» con opciones rápidas: mañana / +3 días.
> - Reprograma el próximo contacto sin abrir la ficha.
> - Solo para Carlos. *(ver "Alcance por rol" más abajo — descartado)*
>
> **Criterio de aceptación**
> - Desde la ficha se puede abrir WhatsApp y la llamada del contacto con un toque.
> - Desde Pendientes se puede posponer un seguimiento (mañana / +3 días) sin abrir la ficha.
> - ~~Ninguna de las dos acciones es visible para Marta.~~ *(descartado, ver abajo)*

### Alcance por rol (decisión confirmada por el usuario, 2026-07-29)

El ticket, escrito antes de la reapertura de MIS-251, decía dos veces "solo Carlos"/"no visible para Marta". Se descarta esa restricción por coherencia con la decisión de MIS-251 (Marta tiene acceso de escritura completo): "Posponer" es funcionalmente lo mismo que "Reprogramar" en la ficha, que Marta ya puede usar; "WhatsApp/llamar" ni siquiera escribe nada en el CRM. **Ambas acciones quedan disponibles para Carlos y Marta por igual, sin gating de rol.**

## Decisiones de diseño

- **"Posponer" se calcula desde HOY (`Date.now()`), no desde el `dueAt` actual del recordatorio.** "Mañana"/"+3 días" es una expectativa relativa al momento en que se pulsa el botón, no al vencimiento original — relevante para recordatorios ya atrasados.
- **Cálculo de fecha en el cliente, zona horaria local del navegador** — mismo patrón ya establecido en `ScheduleReminderForm.tsx` (`dateLocalToMs`/`msToDateLocal`): la Server Action nunca reparsea. No se reutiliza `startOfMadridDay` de `convex/reminders.ts` (privada del módulo, pensada para el corte "hoy" de `listDueToday`, no para sumar días a una fecha dada).
- **Mutation nueva `postponeReminder`, no reutilizar `scheduleReminder`.** `scheduleReminder` exige un `reason` no vacío; "Posponer" es un botón de un solo toque sin formulario. Se sigue el molde exacto de `completeReminder` (mutation mínima `{ token, id }`, aquí más `dueAt`).
- **WhatsApp necesita normalizar el teléfono; `tel:` no.** `tel:` ya funciona tal cual con el valor guardado, sin normalizar (confirmado en el código actual). `wa.me/<número>` exige dígitos puros con prefijo de país, sin "+". Se reutiliza `phoneKey()` de `src/lib/contacts/phone.ts` (normaliza a los 9 dígitos nacionales, tolerando espacios/guiones/prefijos) en una función nueva `whatsappDigits()` que antepone `"34"` — mismo criterio de "un solo país" ya aceptado en ese archivo. Si no hay un número nacional válido, el link de WhatsApp no se renderiza (el de `tel:` sigue igual).
- **El link de WhatsApp lleva `target="_blank" rel="noopener noreferrer"`** — a diferencia de `tel:`/`mailto:` (que abren un diálogo del sistema sin navegar), `wa.me` es una URL http(s) real; sin `target="_blank"` navegaría fuera del CRM.

## Fuera de alcance (explícito)

- **"Posponer" en la ficha del contacto** — el ticket lo pide solo en Pendientes ("sin abrir la ficha" es el punto). En la ficha ya existe "Reprogramar" (formulario completo), que cubre la misma necesidad.
- **Cualquier cambio a `isRep`/gating de rol en `pendientes/page.tsx`** — la sección "Requieren atención" (MIS-253) no forma parte de este ticket.
- **Envío real de mensajes desde el CRM** — el link de WhatsApp solo abre la app nativa con la conversación lista, no manda nada (ya excluido explícitamente en el PRD, sección "Lo que no haremos ahora").

## Cambios

### Backend (`convex/reminders.ts`)

Nueva mutation `postponeReminder`, junto a `completeReminder` (mismo estilo):

```ts
export const postponeReminder = mutation({
  args: { token: v.string(), id: v.string(), dueAt: v.number() },
  returns: v.union(
    v.object({ success: v.literal(true) }),
    v.object({ success: v.literal(false), error: v.string() }),
  ),
  handler: async (ctx, args) => {
    await requireUser(ctx, args.token); // ambos roles, igual que completeReminder/scheduleReminder
    if (!isValidEpochMs(args.dueAt)) return { success: false as const, error: "Fecha inválida" };
    const id = ctx.db.normalizeId("reminders", args.id);
    if (!id) return { success: false as const, error: "Recordatorio no encontrado" };
    const reminder = await ctx.db.get(id);
    if (!reminder) return { success: false as const, error: "Recordatorio no encontrado" };
    if (reminder.status === "done") {
      return { success: false as const, error: "Este seguimiento ya estaba marcado como hecho" };
    }
    await ctx.db.patch(id, { dueAt: args.dueAt });
    return { success: true as const };
  },
});
```

No genera entrada de historial (mismo criterio que reprogramar vía `scheduleReminder`, que tampoco lo hace).

### Server Action (`src/lib/reminders/actions.ts`)

Nuevo tipo `PostponeReminderState` y función `postponeReminderAction` — mismo molde que `completeReminderAction`, leyendo además `dueAt` de un `<input type="hidden">` (ya calculado en el cliente, nunca reparseado — mismo criterio que `dueDateMs` en `scheduleReminderAction`).

### Componente nuevo (`src/components/crm/PostponeReminderButtons.tsx`)

Dos mini-forms de un toque (mismo patrón que `CompleteReminderButton.tsx`: `useActionState` + `<input type="hidden">` + botón de submit), "+1 día" y "+3 días", cada uno calculando su propio `dueAt` a partir de `Date.now()` con `new Date(y, m, d)` local. Recibe `reminderId` como prop, igual que `CompleteReminderButton`.

### Ficha del contacto (`src/app/(app)/contactos/[id]/ContactDetailView.tsx`)

- Nueva función `whatsappDigits()` en `src/lib/contacts/phone.ts` (junto a `phoneKey`, reutilizándola).
- Junto al bloque `{contact.phone && (<a href={\`tel:${contact.phone}\`}>...)}` (líneas 93-108 actuales), un segundo enlace a `https://wa.me/${whatsappDigits(contact.phone)}` (solo si `whatsappDigits` devuelve valor). Nuevo icono `WhatsAppIcon()` junto a `PhoneIcon`/`MailIcon` ya existentes.

### Pendientes del día (`src/app/(app)/(with-nav)/pendientes/page.tsx`)

Junto a `<CompleteReminderButton reminderId={r._id} .../>` (línea 73 actual), `<PostponeReminderButtons reminderId={r._id} .../>`. Agrupados en un contenedor flex con `flexWrap`, mismo criterio de `flex-basis` que ya usa `ContactDetailView.tsx` (130px para 2 por fila en 320px sin overflow) — re-verificar en 320px al implementar.

## Archivos afectados

| Archivo | Tipo |
|---|---|
| `convex/reminders.ts` | Editar |
| `src/lib/reminders/actions.ts` | Editar |
| `src/components/crm/PostponeReminderButtons.tsx` | Nuevo |
| `src/lib/contacts/phone.ts` | Editar |
| `src/app/(app)/contactos/[id]/ContactDetailView.tsx` | Editar |
| `src/app/(app)/(with-nav)/pendientes/page.tsx` | Editar |

## Verificación

1. `tsc --noEmit` / `eslint` / `npm run build`.
2. Manual, como Carlos y como Marta: en Pendientes, pulsar "+1 día" y "+3 días" — confirmar que `dueAt` cambia y la fila se reordena/desaparece de "Para hoy" si corresponde, sin recargar ni abrir la ficha.
3. Manual: en la ficha de un contacto con teléfono, `tel:` sigue igual; el link de WhatsApp abre `wa.me/34<9 dígitos>` en pestaña nueva, probado con varios formatos de teléfono guardados.
4. Extender cobertura e2e (`e2e/full-flow.spec.ts` o spec nuevo) con el caso de posponer; verificar viewport 320px que los 3 botones no desbordan la tarjeta.
5. `npm run test:e2e` completo antes de cerrar.

## Estado

**Plan: GO condicionado** de auditoría. Condiciones incorporadas al código generado:
- `postponeReminder` también actualiza `createdBy` (paridad con `scheduleReminder`).
- El `dueAt` de "Mañana"/"+3 días" se calcula en el `onClick` del botón (vía `ref` sobre el hidden input), no al montar el componente — evita que quede obsoleto si Pendientes se deja abierto de un día para otro.
- Labels ajustados a "Mañana" / "+3 días" (antes "+1 día"/"+3 días").
- Soporte de teléfonos extranjeros para WhatsApp: registrado como deuda de follow-up, no en este ticket.

**Código: primera ronda — NO-GO** (Major M1: `pendientes/page.tsx` envolvía "Marcar hecho" + "Posponer" en un `<div style={{flex:"0 0 auto"}}>` — un flex container ANIDADO con `flex-shrink:0` dentro del `flexWrap` de la Card, cuyo ancho "auto" puede calcularse sin contar su propio wrap interno, arriesgando overflow horizontal en 320px).

**Corrección aplicada:** se quita el `<div>` envolvente por completo. `PostponeReminderButtons` devuelve sus dos `<form>` como hermanos PLANOS (Fragment, sin contenedor propio); `pendientes/page.tsx` los coloca junto a `CompleteReminderButton` como hijos directos del ÚNICO `flexWrap` de la Card — mismo patrón ya probado en `ContactDetailView.tsx` (varios botones planos, cada uno con su propio flex-basis, sin niveles de flex anidados). Elimina el riesgo por construcción, no solo por verificación puntual.

**Además, sugerencia media de la auditoría incorporada:** el test e2e de posponer ahora cubre las DOS opciones ("Mañana" y "+3 días"), con dos recordatorios sembrados por separado y una comprobación cruzada de que "+3 días" queda más lejos en el tiempo que "Mañana".

**Código: segunda ronda — GO condicionado.** Condiciones: convex codegen, tsc, lint, build, test:e2e, y verificación real de 320px sin overflow — todas cumplidas, más las 2 sugerencias no bloqueantes incorporadas:
- Nuevo test e2e permanente que comprueba `document.documentElement.scrollWidth === clientWidth` en `/pendientes` a 320px con los 3 botones visibles (antes solo estaba cubierto por diseño/comentario).
- Nuevo test e2e para un teléfono demasiado corto (menos de 9 dígitos): confirma que no aparece el link de WhatsApp pero `tel:` se sigue mostrando.

**Incidente durante la re-verificación (no relacionado con el código de MIS-254):** `full-flow.spec.ts` (test previamente estable) empezó a fallar por timeout. Diagnóstico: 522 contactos acumulados en el deployment de dev (debería haber ~15-20, el volumen para el que están dimensionadas las queries de full table scan como `listNeedsAttention`) — deuda de las muchas rondas de verificación e2e corridas en esta misma sesión (MIS-251 + MIS-254), no un bug de esta tarea. Se limpió con una mutation temporal (`convex/_devCleanup.ts`, borra `contacts`/`notes`/`reminders`/`statusChanges`/`saleClosures`, nunca `users`/`sessions`; desplegada, ejecutada una vez, eliminada del repo) tras confirmación explícita del usuario. Tras la limpieza, la suite completa vuelve a pasar en tiempos normales.

**Código generado en `CODIGO/MIS-254-acciones-rapidas-contactar-posponer/`, verificado localmente, listo para instalar:**
- `tsc --noEmit`, `eslint`, `npx convex dev --once` y `npm run build`: sin errores, con el código superpuesto temporalmente sobre `src/`/`convex/` reales (revertido después con `git checkout`).
- `npm run test:e2e`, con el deployment de dev ya limpio: **18/18 pasan** (16 propios + los 2 nuevos de esta ronda), incluido `full-flow.spec.ts` en tiempos normales (~19s).
- Comprobación exacta pedida por la auditoría: `scrollWidth === clientWidth` a 320px → **320 === 320**, ahora como test permanente, no solo verificación puntual.
- Deployment de dev revertido de vuelta al código de `main` tras verificar.
- No se ha creado rama ni tocado Linear todavía.

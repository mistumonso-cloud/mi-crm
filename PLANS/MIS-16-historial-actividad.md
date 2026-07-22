# MIS-16 — Historial de actividad por cliente (v2)

## Respuesta a la auditoría de plan v1 → v2

**Veredicto v1: NO-GO** (1 major, 2 sugerencias no bloqueantes).

| # | Auditoría | Resolución |
|---|---|---|
| Major 1 | `ContactDetailView.tsx:228/241` — `created`/`initialNote` caían en una rama fallback sin etiqueta de tipo (decisión 3 v1: "el cuerpo ya indica el tipo, no hace falta etiqueta"). Cierto para `created` (cuerpo = "Contacto añadido", autoexplicativo), **falso para `initialNote`**: su cuerpo es el texto libre que escribió Carlos al alta (p. ej. "Viene de Instagram"), que no indica por sí solo que el evento es una nota inicial — incumple el AC "cada evento muestra tipo... " para ese kind. | **Corregido**: se homogeneizan ambos kinds con etiqueta explícita en la línea de metadatos, igual que el resto de tipos de evento — `Nota inicial · ${fecha} · ${autor}` para `initialNote`, `Alta de contacto · ${fecha} · ${autor}` para `created`. El cuerpo de cada uno no cambia (sigue siendo el texto libre / "Contacto añadido" respectivamente) — la etiqueta y el cuerpo no quedan duplicados. Se sustituye la rama `else` genérica por dos ramas explícitas `entry.kind === "initialNote"` / `entry.kind === "created"`. |
| Baja | El comentario de `src/lib/contacts/format.ts:36` sobre `formatDateTime` afirma que `formatRelativeTime` "sigue usándose sin cambios para 'Contacto añadido'/initialNote" — deja de ser cierto tras este plan. | **Adoptado**: se añade `src/lib/contacts/format.ts` como cuarto archivo tocado, solo para corregir ese comentario. |
| Baja | Confirmar que no hace falta `convex deploy`. | Ya lo decía el plan v1 (decisión 6) — sin cambios, no se reabre. |

No se reabre ninguna otra decisión de v1 (naming `createdByName`, parámetro `responsibleName` no opcional, no añadir iconos, mantener `saleClosed` sin mención en el AC, interpretación de "tiempo real", no tocar `convex/`) — no fueron objetadas por esta auditoría.

## Contexto

### Texto literal del ticket (Linear, `MIS-16`)

> Implementar el historial completo de actividad dentro de la ficha de cada contacto: una línea de tiempo cronológica que recoge todo lo que ha pasado con ese cliente desde que entró al CRM.
>
> **Qué aparece en el historial** — el historial muestra todos los eventos del contacto en orden cronológico inverso (lo más reciente primero): Notas de conversación (tipo, fecha y hora, resumen, quién lo registró); Cambios de estado (estado anterior → estado nuevo, fecha y hora, quién lo cambió); Seguimientos completados (fecha en que se marcó como hecho, motivo que tenía asignado); Creación del contacto (fecha en que entró al CRM y quién lo registró).
>
> **Diseño del historial:** Lista vertical, estilo línea de tiempo. Cada evento tiene icono o etiqueta que indica su tipo. Fecha y hora visible en cada evento. El autor de cada acción aparece indicado (Carlos o Marta). El historial es de solo lectura — no se pueden editar ni borrar eventos pasados.
>
> **Criterio de aceptación:** La ficha del contacto muestra el historial completo con todos los tipos de evento descritos. Los eventos están en orden cronológico inverso (más reciente primero). Cada evento muestra tipo, fecha, detalle y autor. El historial no es editable. El historial se actualiza en tiempo real cuando se añade una nota, se cambia un estado o se completa un seguimiento.

### Confirmación de que es la tarea correcta

Verificado con evidencia cruzada (Linear MCP + `PLANS/README.md` + `git log`): MIS-7 a MIS-15 están instalados, mergeados y desplegados; no existe ningún commit, rama ni archivo de plan/código para MIS-16/17. MIS-16 pertenece a "Fase 5 — Panel y visibilidad" (la fase que sigue a "Fase 4 — Pipeline y cierre de ventas", ya 100% cerrada con MIS-14/15). Sin relaciones de bloqueo formal en Linear, pero el orden de `PLANS/README.md` (MIS-16 antes que MIS-17) y la dependencia funcional real (MIS-17, el panel de Marta, previsiblemente reutilizará las mismas fuentes de datos que este ticket ya agrega) confirman que MIS-16 es el siguiente pendiente correcto.

### Punto de partida: qué ya existe y qué falta (hallazgo clave de este plan)

A diferencia de tickets anteriores, **MIS-16 no parte de cero — está construido en un ~90%**, de forma incremental y silenciosa, sin que ningún ticket anterior reclamara su nombre:

- `PLANS/MIS-10-ficha-contacto.md` (líneas 282-285) ya preveía explícitamente, al construir el placeholder de "Historial": *"construido en memoria, sin tabla nueva [...] eso es MIS-11/MIS-14/MIS-16 [...] **MIS-16 sustituirá esto por el timeline real agregado (notas + cambios de estado + seguimientos completados).**"*
- MIS-11 (notas), MIS-12 (seguimientos completados), MIS-14 (cambios de estado) y MIS-15 (cierres de venta — un tipo extra no pedido por el AC literal de MIS-16, pero coherente como superset, ver decisión 4) fueron cada uno añadiendo su fuente a `src/lib/notes/history.ts` (tipo `HistoryEntry` + función `buildHistory`) y a la sección "Historial" ya visible en `ContactDetailView.tsx` (líneas 210-256), sin que ninguno de esos planes volviera a mencionar "MIS-16" ni reabriera la pregunta de qué le tocaba a este ticket.
- Hoy, `buildHistory` ya agrega 4 fuentes (`notes`, `reminders` completados, `statusChanges`, `saleClosures`) más el propio contacto, las ordena por `timestamp` descendente (`entries.sort((a, b) => b.timestamp - a.timestamp)`, estable desde ES2019), y `ContactDetailView.tsx` ya las renderiza en una lista de solo lectura (ninguna entrada tiene controles de editar/borrar), sin paginar (se muestran todas siempre), con una condición de estado vacío ya resuelta.
- Todos los kinds salvo `created`/`initialNote` ya muestran metadatos completos: `"<etiqueta de tipo> · <fecha y hora exacta> · <autor>"` (p. ej. `"WhatsApp · 21/07/2026, 10:32 · Carlos"`). La etiqueta de tipo que pide el AC ("icono o etiqueta") ya está cubierta por este texto — no se añaden iconos, es una decisión ya vigente desde MIS-10/11/14/15 que este plan no reabre (ver decisión 3).

**Lo que falta — dos gaps concretos, verificados línea a línea contra el código real, no hipotéticos:**

1. **Los eventos `created`/`initialNote` no muestran autor.** El AC del ticket exige explícitamente, para "Creación del contacto": *"fecha en que entró al CRM **y quién lo registró**"*. Hoy, el tipo `HistoryEntry` para esos dos kinds (`src/lib/notes/history.ts:5-6`) no lleva ningún campo de autor, y su render (`ContactDetailView.tsx:228`) solo muestra la fecha. El dato SÍ existe y ya se resuelve en el servidor: `getContact` (`convex/contacts.ts:100-140`) ya calcula y devuelve `responsibleName` — el nombre de quien dio de alta el contacto (`contact.createdBy` resuelto vía `ctx.db.get`) — simplemente nunca se hizo llegar a `buildHistory`.
2. **Esos mismos dos kinds muestran fecha relativa, no fecha y hora exacta.** Hoy usan `formatRelativeTime(entry.timestamp, now)` (p. ej. "hace 3 días"), mientras los otros 4 kinds usan `formatDateTime(entry.timestamp)` (fecha+hora exacta, `dd/mm/aaaa, hh:mm`). El AC es explícito y sin excepción de tipo: *"Fecha y hora visible en cada evento."* Una fecha relativa no muestra la hora, y es inconsistente con el resto del propio historial que este mismo ticket describe como una única línea de tiempo homogénea.

### Verificación técnica previa (hecha antes de aprobar este plan)

- `src/lib/notes/history.ts` leído íntegro (142 líneas): confirmado el shape exacto de `HistoryEntry` y de `buildHistory`, incluyendo el comentario ya existente (líneas 67-71) que documenta el orden `initialNote` antes de `created` a propósito, apoyado en la estabilidad de `Array.sort` desde ES2019 — este plan no lo toca.
- `convex/contacts.ts:100-140` (`getContact`): confirmado que `responsibleName` ya forma parte del contrato público de la query (`v.object({ ..., responsibleName: v.string() })`), con un comentario que ya documenta la asunción ("Responsable" = quien dio de alta el contacto). El tipo `Contact` en `ContactDetailView.tsx` (`NonNullable<FunctionReturnType<typeof api.contacts.getContact>>`) ya incluye este campo automáticamente — no hace falta tocar `convex/contacts.ts` ni el contrato de la query.
- Confirmado (`grep -n "refresh()"`) que las 4 acciones mutantes relevantes para el AC de "tiempo real" ya llaman `refresh()` tras éxito: `addNoteAction` (`src/lib/notes/actions.ts:77`), `changeStatusAction` (`src/lib/contacts/actions.ts:99`), `scheduleReminderAction`/`completeReminderAction` (`src/lib/reminders/actions.ts:69,92`) y, de paso, `closeSaleAction` (`src/lib/contacts/actions.ts:223`, MIS-15). Ninguna requiere cambios para este ticket.
- Confirmado (`grep -rn "getRequestTime"`) que la prop `now` de `ContactDetailView.tsx` (pasada desde `page.tsx:33,47`) no tiene ningún otro consumidor en ese componente — es el único call-site de `formatRelativeTime` en todo el archivo (`grep -n "formatRelativeTime\|formatDateTime"`). Al eliminar ese único uso, tanto la prop como el import de `formatRelativeTime` quedan huérfanos y deben retirarse. `getRequestTime` (definida en `src/lib/request-time.ts`) sigue viva y sin cambios: la usa también `src/app/(app)/(with-nav)/contactos/page.tsx:18` para las fechas relativas de la lista de contactos (MIS-9) — no se toca ese archivo ni esa función.

## Decisiones fijadas

1. **`createdByName: string` como nombre del nuevo campo**, en vez de reutilizar literalmente `responsibleName`. Justificación: las 4 variantes de `HistoryEntry` que ya llevan autor usan el patrón `<verbo>ByName` (`authorName` es la única excepción, heredada de `notes`; `changedByName`, `closedByName`, `completedByName` siguen el patrón) — `createdByName` es coherente con `changedByName`/`closedByName`/`completedByName` y dice explícitamente "quién creó esto", más preciso en el contexto del historial que "responsable" (que en `getContact` se refiere al contacto en su conjunto, no al evento de creación en concreto). El mapeo `createdByName: contact.responsibleName` ocurre una sola vez, dentro de `buildHistory`.

2. **El parámetro `contact` de `buildHistory` se amplía con `responsibleName: string` (no opcional).** Es obligatorio en el schema (`contacts.createdBy: v.id("users")`) y en el contrato de `getContact` (`responsibleName: v.string()`, sin `v.optional`) — no hay ningún caso real en que falte, así que el parámetro tampoco debe serlo (evita un `?? "—"` sin caso de uso real, mismo criterio que ya aplica el resto de la función).

3. **No se añaden iconos — pero `created`/`initialNote` sí llevan etiqueta de tipo explícita en la metadata (corregido en v2).** El AC dice "icono **o** etiqueta" (disyunción, no ambas): la etiqueta textual ya presente en `note`/`reminderDone`/`statusChanged`/`saleClosed` (`"WhatsApp · ..."`, `"Cambio de estado · ..."`, `"Cierre de venta · ..."`) satisface este punto del AC para esos 4 kinds, así que no se añaden iconos — ampliaría el alcance sin necesidad, tocando 4 ramas que ya funcionan. La v1 de este plan asumía que lo mismo aplicaba a `created`/`initialNote` porque su *cuerpo* ya indica el tipo ("Contacto añadido" / el texto libre) — la auditoría señaló correctamente que esto es cierto para `created` (cuerpo autoexplicativo) pero **no para `initialNote`** (su cuerpo es texto libre del usuario, no autoidentifica el evento). Corrección: ambos kinds pasan a llevar también una etiqueta explícita en la línea de metadatos — `Alta de contacto` para `created`, `Nota inicial` para `initialNote` — homogeneizando el patrón `<etiqueta> · <fecha> · <autor>` para los 6 kinds sin excepción. El cuerpo de cada uno no cambia (evita duplicar el mismo texto en metadata y cuerpo).

4. **La entrada extra `saleClosed` (MIS-15) se mantiene sin cambios y sin mención en el AC de MIS-16.** El ticket fue redactado el 22/06/2026, antes de que existiera el concepto de cierre de venta como entidad — es un superset compatible, no un conflicto: el AC pide "todos los tipos de evento descritos" como mínimo, no como lista cerrada exclusiva. No se retira ni se oculta.

5. **"Se actualiza en tiempo real" se interpreta como reflejo inmediato tras la propia acción del usuario (vía Server Action + `refresh()`), no como sincronización push entre sesiones concurrentes.** Mismo criterio que ya estableció MIS-9 con "búsqueda en tiempo real" (filtrado inmediato en cliente sobre datos ya cargados, no un feed multi-usuario en vivo). Razones: (a) ya está satisfecho hoy sin cambios de código — las 3 acciones que el AC nombra explícitamente (añadir nota, cambiar estado, completar seguimiento) llaman `refresh()`, que re-renderiza `/contactos/[id]` en la misma respuesta; (b) el AC no dice "sin recargar en otro dispositivo/sesión"; (c) introducir sincronización multi-sesión (que la ficha abierta por Marta se actualice sola mientras Carlos trabaja en la suya) exigiría migrar esta pantalla del patrón `fetchQuery` en Server Component (usado en todo el repo, sin excepción) a queries reactivas de Convex (`useQuery` en cliente) — una arquitectura nueva, no usada hoy en ningún punto del código, que ningún ticket ha pedido y que ampliaría enormemente el alcance de este ticket sin que el AC lo exija literalmente. Se deja documentado aquí como decisión explícita para que la auditoría no lo reabra sin verlo — no como deuda oculta.

6. **No se toca `convex/schema.ts` ni ninguna función de `convex/`.** Todos los datos necesarios ya están modelados y expuestos (`getContact.responsibleName`); el cambio es puramente de tipos/render en `src/`. No hace falta `npx convex deploy` para este ticket.

## `src/lib/notes/history.ts` (EDITAR)

Diff sobre el archivo completo (142 líneas → se tocan las líneas 5-6, 42, 72-75):

```ts
export type HistoryEntry =
  | { key: string; kind: "created"; timestamp: number; createdByName: string }
  | { key: string; kind: "initialNote"; timestamp: number; text: string; createdByName: string }
  | { key: string; kind: "note"; timestamp: number; type: NoteType; text: string; authorName: string }
  // ... (resto de variantes sin cambios: reminderDone, statusChanged, saleClosed)
```

```ts
export function buildHistory(
  // MIS-16: responsibleName ya lo devuelve getContact (convex/contacts.ts) —
  // obligatorio en el schema (contacts.createdBy no es opcional), así que
  // tampoco lo es aquí. Se usa para poblar createdByName en las entradas
  // "created"/"initialNote" (AC: "Creación del contacto... y quién lo
  // registró", hoy ausente).
  contact: { initialNote?: string; _creationTime: number; responsibleName: string },
  notes: Array<{ _id: string; type: NoteType; occurredAt: number; text: string; authorName: string }>,
  completedReminders: Array<{ _id: string; completedAt: number; reason: string; completedByName: string }> = [],
  statusChanges: Array<{
    _id: string;
    fromStatus: ContactStatus;
    toStatus: ContactStatus;
    changedByName: string;
    changedAt: number;
  }> = [],
  saleClosures: Array<
    | {
        _id: string;
        outcome: "won";
        product: string;
        amountCents: number;
        purchaseDate: number;
        closedByName: string;
        closedAt: number;
      }
    | { _id: string; outcome: "lost"; lossReason: string; closedByName: string; closedAt: number }
  > = [],
): HistoryEntry[] {
  const entries: HistoryEntry[] = [];

  // Orden de inserción deliberado: initialNote ANTES que "created" — sin
  // cambios respecto a hoy (ver comentario original más abajo en el propio
  // archivo instalado).
  if (contact.initialNote) {
    entries.push({
      key: "initial-note",
      kind: "initialNote",
      timestamp: contact._creationTime,
      text: contact.initialNote,
      createdByName: contact.responsibleName, // MIS-16
    });
  }
  entries.push({
    key: "created",
    kind: "created",
    timestamp: contact._creationTime,
    createdByName: contact.responsibleName, // MIS-16
  });

  // ... resto de la función SIN CAMBIOS (notes, completedReminders, statusChanges, saleClosures, sort final)
```

El resto del archivo (líneas 77-141: bucles de `notes`/`completedReminders`/`statusChanges`/`saleClosures` y el `sort` final) se mantiene byte a byte igual — solo se amplía el tipo y las dos entradas `created`/`initialNote`.

## `src/app/(app)/contactos/[id]/ContactDetailView.tsx` (EDITAR)

**Import** (línea 11) — se retira `formatRelativeTime`, que queda sin uso tras el cambio de abajo:

```diff
-import { formatRelativeTime, formatDateTime, formatDate, formatCurrencyCents } from "@/lib/contacts/format";
+import { formatDateTime, formatDate, formatCurrencyCents } from "@/lib/contacts/format";
```

**Firma del componente** (líneas 58-74) — se retira la prop `now`, que queda sin consumidores:

```diff
 export function ContactDetailView({
   contact,
-  now,
   notes,
   reminders,
   statusChanges,
   saleClosures,
   canChangeStatus,
 }: {
   contact: Contact;
-  now: number;
   notes: Notes;
   reminders: Reminders;
   statusChanges: StatusChanges;
   saleClosures: SaleClosures;
   canChangeStatus: boolean;
 }) {
```

**Render de la línea de metadatos** (dentro del bloque "Historial") — v2, corregido tras auditoría: en vez de un único `else` genérico para `created`/`initialNote`, dos ramas explícitas con etiqueta propia cada una (mismo patrón `<etiqueta> · <fecha> · <autor>` que el resto de kinds):

```diff
                     : entry.kind === "saleClosed"
                     ? `Cierre de venta · ${formatDateTime(entry.timestamp)} · ${entry.closedByName}`
-                    : formatRelativeTime(entry.timestamp, now)}
+                    : entry.kind === "initialNote"
+                    ? `Nota inicial · ${formatDateTime(entry.timestamp)} · ${entry.createdByName}`
+                    : `Alta de contacto · ${formatDateTime(entry.timestamp)} · ${entry.createdByName}`}
```

La última rama (`else` final, sin condición explícita) queda reservada para `created` — es el único kind restante de la unión tras excluir los otros 5 en la cadena de ternarios, así que TypeScript lo estrecha correctamente sin necesitar un `entry.kind === "created"` explícito (mismo patrón ya usado hoy para llegar a esa rama).

El resto del archivo (llamada a `buildHistory(contact, notes, reminders.completed, statusChanges, saleClosures)`, cuerpo del mensaje por kind, estado vacío, resto de la ficha) no cambia — `contact` ya incluye `responsibleName` en su tipo (`Contact = NonNullable<FunctionReturnType<typeof api.contacts.getContact>>`), así que la llamada a `buildHistory` sigue compilando sin tocarla.

## `src/app/(app)/contactos/[id]/page.tsx` (EDITAR)

```diff
-import { getRequestTime } from "@/lib/request-time";
 import { ContactDetailView } from "./ContactDetailView";
```

```diff
-  const now = await getRequestTime();
-
   return (
```

```diff
       <ContactDetailView
         contact={contact}
-        now={now}
         notes={notes}
```

No se toca nada más de este archivo — `getRequestTime` sigue existiendo en `src/lib/request-time.ts` sin cambios, solo deja de importarse/llamarse aquí.

## `src/lib/contacts/format.ts` (EDITAR)

Añadido en v2, en respuesta a la sugerencia baja de la auditoría: el comentario de `formatDateTime` queda obsoleto tras este plan, porque afirma que `formatRelativeTime` sigue usándose sin cambios para "Contacto añadido"/`initialNote` — deja de ser cierto (ver diff de `ContactDetailView.tsx` arriba). Solo se corrige el comentario, la función `formatDateTime` no cambia:

```diff
-// Fecha/hora absoluta para notas reales de MIS-11 (formatRelativeTime sigue
-// usándose sin cambios para "Contacto añadido"/initialNote). timeZone fijo a
-// "Europe/Madrid" a propósito: ContactDetailView se renderiza tanto en el
+// Fecha/hora absoluta para notas reales de MIS-11. timeZone fijo a
+// "Europe/Madrid" a propósito: ContactDetailView se renderiza tanto en el
 // servidor (HTML inicial) como en el cliente (hidratación); sin timeZone
 // explícito, Intl.DateTimeFormat usaría la zona ambiente de cada entorno y
 // produciría un mismatch de hidratación. Con una zona fija, ambos entornos
 // producen siempre el mismo string. Asunción documentada: CRM de un solo
 // país (Carlos/Marta operan desde España).
 export function formatDateTime(ms: number): string {
```

`formatRelativeTime` en sí no se toca ni se retira del archivo — sigue viva y en uso por `src/app/(app)/(with-nav)/contactos/page.tsx` (MIS-9).

## Verificación

1. **Tipos y build**: `npx tsc --noEmit` (o `npx convex codegen` como typecheck real completo, según el truco ya documentado para este repo) y `npm run lint` sin errores tras el cambio — en particular, confirmar que no queda ningún import o variable sin usar (`formatRelativeTime`, `now`, `getRequestTime` en los archivos tocados).
2. **Manual, contacto con nota inicial**: abrir la ficha de un contacto creado con `initialNote` (p. ej. vía "Añadir contacto" con el campo de nota rellenado). Confirmar que las dos primeras entradas del historial muestran, en la línea de metadatos, `Nota inicial · <fecha y hora exacta> · <autor>` y `Alta de contacto · <fecha y hora exacta> · <autor>` respectivamente (no una fecha relativa, no "—", y con etiqueta de tipo visible en ambas — este último punto es el que corrigió la ronda de auditoría v1→v2).
3. **Manual, contacto sin nota inicial**: confirmar que solo aparece la entrada `Alta de contacto · <fecha> · <autor>` / "Contacto añadido" como cuerpo.
4. **Regresión de "tiempo real"**: añadir una nota, cambiar el estado del contacto y completar un seguimiento pendiente, uno por uno — confirmar que cada acción sigue reflejándose de inmediato en el historial sin recargar manualmente la página (comportamiento ya existente vía `refresh()`; este ticket no lo toca, solo se re-verifica que no se rompió).
5. **Regresión visual del resto del historial**: confirmar que las entradas de tipo `note`/`reminderDone`/`statusChanged`/`saleClosed` siguen mostrándose exactamente igual que antes (sin cambios en su rama del código).
6. Fuera de alcance de esta verificación manual: pruebas E2E automatizadas de todo el flujo — corresponden a MIS-19/MIS-20 (Fase 6).

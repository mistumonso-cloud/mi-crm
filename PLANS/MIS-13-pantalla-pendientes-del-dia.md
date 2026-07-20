# MIS-13 — Pantalla: Pendientes del día (v2)

## Respuesta a la auditoría de plan v1 → v2

Veredicto recibido: **GO CONDICIONADO** — sin bloqueantes ni majors.

| # | Auditoría | Resolución |
|---|---|---|
| Condición de instalación | Ejecutar la regeneración Convex (`npx convex dev --once`) y la verificación funcional/visual indicada antes de instalar. | Ya cubierto — es el "Paso de generación de código Convex" más "Verificación end-to-end". Se confirma aquí como condición no opcional antes de instalar. |
| Media | Validar en el código generado (no solo por diseño) que `contactStatus?: ...` aparece correctamente en el tipo inferido de `api.reminders.listDueToday` tras `npx convex dev --once`, antes de tocar la UI. | Adoptado. Se añade un paso explícito de verificación en "Paso de generación de código Convex": inspeccionar `convex/_generated/api.d.ts` (o el explorador de funciones del dashboard de Convex) y confirmar el union type real de `contactStatus` con evidencia, no solo asumir que el diseño encaja. |
| Baja | Mantener la prueba de viewport móvil estrecho como obligatoria, no opcional — el riesgo de `Avatar` + `StatusBadge` añadidos es visual, no de tipos. | Ya cubierto (paso 10 de "Verificación end-to-end"). Se confirma aquí explícitamente como no salteable, al mismo nivel que `tsc`/`lint`/`build`. |
| Baja | Correcto no reabrir el modelo `dueAt` date-only de MIS-12 aunque el AC diga "hora". Si producto pide hora real dentro del día, debe ir a un ticket de follow-up con cambio de modelo, no colarse en MIS-13. | Ya cubierto (sección "Puntos abiertos"). Confirmado explícitamente: no se reabre en este ticket. |

No se reabre ninguna decisión de alcance ya aprobada (estado opcional vs. obligatorio, Avatar añadido, sin cambios de schema, límites del AC citado) — el diff v1→v2 es solo la elevación de una verificación a paso explícito con evidencia.

## Contexto

MIS-12 (recordatorios de próximo contacto, instalado y en producción) dejó implementada una versión **mínima** de `/pendientes`, documentada explícitamente en el propio código como pendiente de ampliación por este ticket. Verificado archivo por archivo contra el AC real de MIS-13 en Linear, esa versión mínima ya cubre casi todo el criterio de aceptación:

- **Filtrado vencido+hoy, orden por `dueAt` ascendente** (vencidos primero) → `convex/reminders.ts::listDueToday`, ya instalado, sin cambios.
- **Marcar hecho sin abrir la ficha** → `CompleteReminderButton`, ya reutilizado en `/pendientes`.
- **Pulsar el nombre abre la ficha** → `Link` a `/contactos/[id]`, ya instalado.
- **"Pendientes" es la primera pestaña del `BottomNav`** y **el FAB de añadir contacto está visible en `/pendientes`** → ya así en `(with-nav)/layout.tsx`, sin cambios.
- **Mensaje de vacío** ya existe, pero con una redacción ligeramente distinta a la cita literal del AC ("No hay..." en vez de "No tienes...").

El único hueco funcional real es que **no se muestra el estado actual del contacto** (pipeline: lead/talking/proposal/negotiating/won/lost/inactive) en cada fila, que el AC exige explícitamente ("De cada contacto en la lista se muestra: Nombre, Estado actual del contacto, Motivo anotado del seguimiento").

Además, dos comentarios dejados por MIS-12 en `pendientes/page.tsx` (cabecera y pie de página) afirman literalmente "MIS-13 sustituirá esto" / "MIS-13 ampliará esta pantalla" — quedan **falsos** en cuanto este ticket se instale, y hay que corregirlos en vez de dejarlos describiendo un estado que ya no es cierto.

**Nota de alcance importante:** el AC real de MIS-13 en Linear (texto citado íntegro más abajo) **no** pide filtros "mis pendientes vs. todos", ni una acción "Cancelar seguimiento" (descartar sin completar), ni otros tipos de pendientes más allá de recordatorios de seguimiento. El plan de MIS-12 especulaba en sus "Puntos abiertos" que "todo eso es MIS-13" — pero eso no está en el ticket real de Linear, así que no se añade por iniciativa propia. Este plan se ciñe estrictamente al AC citado.

### Texto literal del ticket (Linear, `MIS-13`)

> Crear la pantalla de inicio de Carlos: la lista de clientes que necesitan contacto hoy, ordenada para que sepa exactamente por dónde empezar cada mañana sin tener que revisar nada más.
>
> **Lista de pendientes:** Solo aparecen los contactos que tienen un recordatorio de seguimiento programado para hoy o antes (pendientes atrasados también aparecen). Ordenados por hora del recordatorio (más temprano primero). De cada contacto en la lista se muestra: Nombre, Estado actual del contacto, Motivo anotado del seguimiento.
>
> **Acciones directas desde la lista (sin entrar en la ficha):** Marcar el seguimiento como hecho — con un solo toque, sin abrir la ficha del contacto. Pulsar el nombre del contacto abre su ficha completa.
>
> **Cuando no hay pendientes:** Mostrar un mensaje claro: "No tienes seguimientos pendientes para hoy."
>
> **Navegación:** Es la primera pestaña de la barra inferior de navegación (etiqueta: "Pendientes"). El botón flotante para añadir contacto nuevo está visible también desde aquí.
>
> **Criterio de aceptación:** La pantalla muestra solo los contactos con seguimiento para hoy o atrasados. Cada elemento muestra nombre, estado y motivo del seguimiento. Carlos puede marcar un seguimiento como hecho directamente desde la lista. Pulsar el nombre de un contacto abre su ficha. Si no hay pendientes, se muestra un mensaje claro.

## Decisiones fijadas

**1. `contactStatus` como campo opcional (`v.optional`) en `listDueToday`, no obligatorio.** Cuando `ctx.db.get(r.contactId)` devuelve `null` (contacto borrado — caso ya marcado como "no esperado hoy" en el código de MIS-12, no existe `deleteContact`), no hay un octavo literal "desconocido" en la unión cerrada de 7 estados de pipeline con el que rellenar un valor válido — a diferencia de `contactName`, que sí admite el centinela `"—"` porque es un `v.string()` libre. En la UI, si `contactStatus` es `undefined` simplemente no se renderiza `StatusBadge` para esa fila, en vez de caer en el valor por defecto del componente (`state="lead"`), que mostraría "Lead nuevo" para un contacto que ya no existe — eso sí sería activamente engañoso, no solo incompleto.

**2. Validador `contactStatusValidator` duplicado localmente en `reminders.ts`, no compartido con `contacts.ts`.** Sigue la convención ya establecida y explícita en el repo: cada archivo de `convex/` es autocontenido (ver el comentario de `isValidEpochMs` en el propio `reminders.ts`, y el hecho de que `contacts.ts` ya define su propio `contactStatusValidator` sin exportarlo). No se crea un módulo compartido de validadores solo para este caso.

**3. Se añade `Avatar` junto al nombre en cada fila de Pendientes**, replicando exactamente el patrón ya usado en `ContactList.tsx` (Avatar + nombre + `StatusBadge dot={false}` en la misma línea). No lo exige el AC de forma literal, pero es una reutilización de coste y riesgo mínimos de un componente y patrón ya existentes en el propio repo, y da consistencia visual directa con la pantalla de Contactos — el mismo "home" de Carlos usa el mismo lenguaje visual en sus dos pestañas principales. El avatar queda **fuera** del área de `tap`: el AC dice explícitamente "pulsar el **nombre**", así que no se amplía el área táctil a toda la fila por iniciativa propia.

**4. Sin cambios en `convex/schema.ts`.** `contacts.status` ya existe con los 7 literales necesarios (`convex/schema.ts:22-30`); no hace falta ninguna migración, campo ni índice nuevo. `listDueToday` ya carga el documento completo del contacto vía `ctx.db.get(r.contactId)` (para resolver `contactName`) — exponer también `status` es leer un campo ya presente en memoria, sin ninguna query adicional ni coste extra.

**5. El subtítulo "Seguimientos vencidos o de hoy." y el `Badge tone="accent"` "Operativo" de cabecera se mantienen sin cambios.** El subtítulo sigue describiendo con precisión el filtro real de `listDueToday`. El badge "Operativo" es el mismo patrón de etiqueta de rol/contexto que usa `panel/page.tsx` ("Supervisora") para el home de Marta — no es un vestigio de MIS-12 ni un aviso de estado provisional, así que no hay motivo para tocarlo.

**6. El párrafo de pie de página se elimina, sin sustituto.** Era un aviso transitorio explícito ("MIS-13 ampliará esta pantalla..."). Con MIS-13 instalado no queda nada pendiente que anunciar sobre esta pantalla, y el AC no pide ningún texto de pie — se elimina en vez de reemplazarse por otro contenido.

## `convex/reminders.ts` (EDITAR)

Tres cambios puntuales sobre el archivo ya instalado en producción. No se toca ningún otro export (`scheduleReminder`, `listRemindersForContact`, `completeReminder`, `countDueToday`, `startOfMadridDay`, `isValidEpochMs`).

**1. Nuevo validador de módulo**, junto a `REASON_MAX`:

```ts
const REASON_MAX = 200; // "texto corto" (AC del ticket) — más corto que TEXT_MAX (2000) de notes.ts

// Duplicado de contacts.ts (contactStatusValidator) a propósito — mismo
// criterio que isValidEpochMs más abajo: cada archivo de convex/ es
// autocontenido, no se crea un módulo compartido de validadores solo para
// esto. Usado en listDueToday para exponer el estado de pipeline del
// contacto en cada fila de Pendientes (AC de MIS-13: "estado actual del
// contacto").
const contactStatusValidator = v.union(
  v.literal("lead"),
  v.literal("talking"),
  v.literal("proposal"),
  v.literal("negotiating"),
  v.literal("won"),
  v.literal("lost"),
  v.literal("inactive"),
);
```

**2. `returns` de `listDueToday`** — insertar `contactStatus` justo después de `contactName`:

```ts
export const listDueToday = query({
  args: { token: v.string() },
  returns: v.array(
    v.object({
      _id: v.id("reminders"),
      contactId: v.id("contacts"),
      contactName: v.string(),
      contactStatus: v.optional(contactStatusValidator),
      dueAt: v.number(),
      reason: v.string(),
      overdue: v.boolean(),
    }),
  ),
  // handler: ver punto 3
});
```

**3. Handler de `listDueToday`** — insertar `contactStatus` en el `.map`, sin tocar el resto:

```ts
    return Promise.all(
      rows.map(async (r) => {
        const contact = await ctx.db.get(r.contactId);
        return {
          _id: r._id,
          contactId: r.contactId,
          contactName: contact?.name ?? "—", // defensivo: contacto borrado, caso no esperado hoy (no hay deleteContact)
          contactStatus: contact?.status, // undefined si el contacto no existe — mismo caso de borde que contactName
          dueAt: r.dueAt,
          reason: r.reason,
          overdue: r.dueAt < todayStart,
        };
      }),
    );
```

`contact` es `Doc<"contacts"> | null`; `contact?.status` produce en TypeScript `("lead"|"talking"|"proposal"|"negotiating"|"won"|"lost"|"inactive") | undefined`, que encaja exactamente con `v.optional(contactStatusValidator)` — sin casts ni comprobaciones adicionales.

## `src/app/(app)/(with-nav)/pendientes/page.tsx` (EDITAR)

Archivo completo tras el cambio:

```tsx
import Link from "next/link";
import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../../convex/_generated/api";
import { getUser } from "@/lib/auth/dal";
import { readSessionToken } from "@/lib/auth/cookie";
import { Card } from "@/components/ui/core/Card";
import { Avatar } from "@/components/ui/core/Avatar";
import { Badge } from "@/components/ui/feedback/Badge";
import { StatusBadge } from "@/components/ui/feedback/StatusBadge";
import { formatDate } from "@/lib/contacts/format";
import { CompleteReminderButton } from "@/components/crm/CompleteReminderButton";

// Home de Carlos (MIS-13): únicamente recordatorios de seguimiento vencidos
// o de hoy (convex/reminders.ts::listDueToday), ordenados por dueAt asc
// (vencidos primero — dueAt es fecha sin hora, medianoche Europe/Madrid,
// decisión ya cerrada en MIS-12, no reabierta aquí). Cada fila muestra
// nombre, estado de pipeline (StatusBadge) y motivo; "marcar hecho" y el
// tap en el nombre son acciones directas sin entrar en la ficha (AC del
// ticket). No hay otros tipos de pendientes ni filtros "míos vs. todos":
// no forman parte del AC de MIS-13 en Linear.
export default async function PendientesPage() {
  const user = await getUser();
  const token = await readSessionToken(); // getUser() ya garantiza sesión válida aquí

  const reminders = await fetchQuery(api.reminders.listDueToday, { token: token! });

  return (
    <div className="flex flex-1 flex-col" style={{ padding: "16px 20px 24px", gap: 16 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <Badge tone="accent" style={{ alignSelf: "flex-start" }}>
          Operativo
        </Badge>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)" }}>Hola, {user.name}</h1>
        <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>Seguimientos vencidos o de hoy.</p>
      </div>

      {reminders.length === 0 ? (
        <p style={{ fontSize: 14, color: "var(--text-secondary)", textAlign: "center", padding: "32px 0" }}>
          No tienes seguimientos pendientes para hoy.
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {reminders.map((r) => (
            <li key={r._id}>
              <Card padding="md" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
                <Avatar name={r.contactName} size="md" />
                <div style={{ flex: "1 1 200px", minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <Link
                      href={`/contactos/${r.contactId}`}
                      style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", textDecoration: "none" }}
                    >
                      {r.contactName}
                    </Link>
                    {r.contactStatus && <StatusBadge state={r.contactStatus} dot={false} />}
                    <Badge tone={r.overdue ? "danger" : "warning"}>{r.overdue ? "Vencido" : "Hoy"}</Badge>
                  </div>
                  <p style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{formatDate(r.dueAt)}</p>
                  <p style={{ fontSize: 14, color: "var(--text-secondary)" }}>{r.reason}</p>
                </div>
                <CompleteReminderButton reminderId={r._id} style={{ flex: "0 0 auto" }} />
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

Cambios respecto a la versión instalada por MIS-12: import de `Avatar` y `StatusBadge`; comentario de cabecera reescrito (ya no describe una implementación "mínima" pendiente de sustitución); `<Avatar>` añadido al inicio de cada `<Card>`; `<StatusBadge>` condicional insertado entre el nombre y el badge "Vencido"/"Hoy"; texto del estado vacío corregido a la cita literal del AC; párrafo de pie de página eliminado.

## Paso de generación de código Convex (obligatorio)

1. Guardar `convex/reminders.ts` con los 3 cambios de arriba.
2. Ejecutar `npx convex dev --once` — confirma que el nuevo `v.union(...)` del `returns` de `listDueToday` es válido y se despliega sin error.
3. **Verificación con evidencia (añadida en la auditoría de plan v1→v2, condición no opcional):** abrir `convex/_generated/api.d.ts` (o el explorador de funciones del dashboard de Convex) tras el paso 2 y confirmar literalmente que el tipo inferido de `api.reminders.listDueToday` incluye `contactStatus?: "lead" | "talking" | "proposal" | "negotiating" | "won" | "lost" | "inactive"` — no basta con que el diseño encaje sobre el papel, hay que citar el fragmento real del archivo generado antes de dar este paso por cerrado.
4. Solo entonces editar `src/app/(app)/(with-nav)/pendientes/page.tsx`.

## Puntos abiertos (no bloqueantes)

- El AC dice "ordenados por hora del recordatorio (más temprano primero)", pero `dueAt` es una fecha sin componente de hora (decisión cerrada en el plan de MIS-12: selector de fecha, siempre medianoche Europe/Madrid). El orden `asc` por `dueAt` cumple el efecto práctico que pide el AC (vencidos antes que los de hoy); no existe una "hora del día" real que ordenar dentro del mismo día civil. Se documenta aquí para que conste explícitamente en la auditoría — no se reabre ni se propone cambio de modelo de datos.
- Caso de borde "recordatorio con contacto borrado" (no hay `deleteContact` hoy, así que no debería poder ocurrir en la práctica): `contactStatus` queda `undefined` y no se renderiza `StatusBadge` para esa fila. No hay datos reales en el entorno de desarrollo para ejercitar este caso sin manipular directamente el dashboard de Convex; queda como riesgo residual de bajo impacto (omite un badge, no rompe la pantalla).
- Sugerencia no vinculante para una futura iteración: ampliar el área táctil de toda la fila (como ya hace `ContactList.tsx`, donde el `<Link>` envuelve toda la fila) en vez de solo el nombre — no se hace aquí porque el AC especifica literalmente "pulsar el nombre del contacto".

## Verificación end-to-end (manual — no hay tests automatizados en el repo)

1. `npx convex dev --once` sin errores tras el cambio de `convex/reminders.ts`.
2. Preparar 3 contactos con `status` distinto entre sí (p. ej. `lead`, `negotiating`, `won`) y un recordatorio `pending` cada uno: uno con `dueAt` de ayer, uno de hoy, uno de mañana.
3. Login `carlos@test.local`, ir a `/pendientes`: solo aparecen los recordatorios de ayer y de hoy (no el de mañana); el de ayer aparece antes que el de hoy en la lista.
4. Cada fila muestra: avatar, nombre, `StatusBadge` con el estado real y el color/etiqueta correctos de cada contacto (comparar contra `PIPELINE_STATES` en `StatusBadge.jsx`), motivo (`reason`), badge "Vencido"/"Hoy" correcto.
5. Pulsar "Marcar hecho" desde la lista, sin abrir la ficha → la fila desaparece de `/pendientes` tras el `refresh()` de la Server Action, sin recargar manualmente (F5); el badge numérico de la pestaña "Pendientes" del `BottomNav` baja en consecuencia (comportamiento ya verificado end-to-end en MIS-12 — aquí solo confirmar que sigue funcionando igual con el campo nuevo).
6. Pulsar el nombre de un contacto → navega correctamente a `/contactos/[id]` y la ficha abre.
7. Vaciar la lista (completar o reprogramar a una fecha futura los recordatorios restantes) → aparece exactamente el texto "No tienes seguimientos pendientes para hoy."
8. Confirmar que el botón flotante de añadir contacto sigue visible en `/pendientes` y que "Pendientes" sigue siendo la primera pestaña del `BottomNav` (sin regresión, no se toca nada de `layout.tsx`/`BottomNav.tsx` en este ticket).
9. Repetir el login con `marta@test.local` (supervisor): misma pantalla, mismos datos — visibilidad compartida, decisión ya cerrada en MIS-12/MIS-18, no se toca en este ticket.
10. Viewport móvil estrecho: confirmar que la fila (ahora con `Avatar` + `StatusBadge` añadidos) sigue envolviendo bien con `flexWrap: "wrap"`, sin solapar el botón "Marcar hecho" ni desbordar horizontalmente.
11. `npx tsc --noEmit`, `npm run lint`, `npm run build` limpios.

## Archivos afectados

| Archivo | Tipo |
|---|---|
| `convex/reminders.ts` | Editar |
| `src/app/(app)/(with-nav)/pendientes/page.tsx` | Editar |
| `PLANS/README.md` | Editar (fila MIS-13) |

## Estado

**Auditoría de plan:** GO condicionado en v1 → ajuste aplicado en v2 (verificación de `contactStatus` con evidencia real, elevada a paso obligatorio).

**Auditoría de código:** GO condicionado sobre el diff real (`convex/reminders.ts`, `pendientes/page.tsx`). Sin blockers ni majors. Condiciones: ejecutar codegen/checks/E2E sobre la instalación real, conservar la evidencia literal del fragmento generado, y probar el viewport móvil con un contacto en estado `proposal` ("Propuesta enviada", el de más presión visual junto a Avatar + badge + botón).

**Instalado** en la rama `feature/mis-13-pantalla-pendientes-del-dia`, con las 3 condiciones de la auditoría de código resueltas con evidencia real:

1. **`npx convex dev --once`**: `✔ Convex functions ready! (1.42s)`, sin errores.
2. **Evidencia literal del tipo generado de `contactStatus`** (condición explícita de ambas auditorías): `convex/_generated/api.d.ts` no expone tipos campo a campo (es estructural, vía `ApiFromModules<typeof reminders>`), así que la evidencia se obtuvo forzando a `tsc` a imprimir el tipo real resuelto de `FunctionReturnType<typeof api.reminders.listDueToday>[number]["contactStatus"]` mediante una asignación deliberadamente inválida en un archivo de prueba temporal (`convex/_probe_mis13.ts`, compilado con el `tsconfig.json` real del proyecto — `strict: true` — y eliminado inmediatamente después). Resultado literal:
   ```
   convex/_probe_mis13.ts(8,7): error TS2322: Type '"NOT_A_REAL_STATE_deliberate_type_error"' is not assignable to type '"lead" | "talking" | "proposal" | "negotiating" | "won" | "lost" | "inactive" | undefined'.
   ```
   Confirma que el tipo real generado tras `npx convex dev --once` es exactamente el diseñado: la unión de 7 literales más `undefined` (campo opcional).
3. **`npx tsc --noEmit`**: limpio (0 errores) tras retirar el archivo de prueba.
4. **`npm run lint`**: 0 errores (1 warning preexistente en `Avatar.jsx` sobre `<img>` vs. `next/image`, no introducido por este ticket — `Avatar` ya se usaba en `ContactList.tsx` desde MIS-9).
5. **`npm run build`**: compilación de producción correcta, incluida `/pendientes`.
6. **Verificación end-to-end real con Playwright** contra el servidor de desarrollo, con datos reales del deployment dev (3 contactos nuevos: uno con recordatorio vencido y estado `negotiating`, uno con recordatorio de hoy y estado `proposal` — el caso pedido explícitamente por la auditoría —, uno con recordatorio de mañana que no debe aparecer). **21/21 comprobaciones OK**, 0 errores de consola:
   - Filtrado correcto (vencido + hoy aparecen, mañana no) y orden (vencido antes que hoy).
   - Cada fila muestra Avatar, nombre, `StatusBadge` correcto ("Negociando", "Propuesta enviada"), badge "Vencido"/"Hoy", motivo.
   - Viewport móvil 360px: sin overflow horizontal, botón "Marcar hecho" dentro de los límites de la Card incluso con el `StatusBadge` más largo ("Propuesta enviada").
   - Tap en el nombre abre la ficha correcta.
   - "Marcar hecho" desde la lista: la fila desaparece y el badge numérico del `BottomNav` baja, ambos sin recarga completa de página (confirmado con un marcador JS que sobrevive al cambio).
   - Mensaje vacío exacto: "No tienes seguimientos pendientes para hoy." tras completar todos los pendientes de hoy.
   - Historial de la ficha muestra "Seguimiento completado" + motivo (regresión de MIS-12, sigue intacta).

Capturas: `01-pendientes-desktop.png`, `02-pendientes-mobile-360.png`, `03-pendientes-tras-completar-1.png`, `04-pendientes-vacio.png`.

Nota: los 3 contactos de prueba (`MIS-13 E2E Vencido`, `MIS-13 E2E Hoy Proposal`, `MIS-13 E2E Manana`) quedan en el deployment de desarrollo — no existe `deleteContact` en el repo, mismo criterio ya aceptado para datos de prueba de tickets anteriores (p. ej. "Verificación MIS-9 Dev").

**Pendiente:** PR a `main` (sin mergear todavía, pendiente de autorización explícita) y, tras el merge, `npx convex deploy` a producción — obligatorio porque este ticket toca `convex/reminders.ts`.

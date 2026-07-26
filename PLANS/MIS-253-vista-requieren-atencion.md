# MIS-253 — Vista: Leads sin próximo paso («Requieren atención»)

> **Estado**: **Implementado, pendiente de auditoría de código.** Rama `feature/mis-253-vista-requieren-atencion`.

## Contexto

Fase 3 — Seguimiento y pendientes. Mejora sobre el PRD original (igual que MIS-255): `/pendientes` (MIS-13) solo muestra contactos con un recordatorio de seguimiento **ya programado** para hoy o antes. Un lead activo al que Carlos nunca le puso fecha de próximo contacto es invisible en esa pantalla y se enfría en silencio — el punto ciego que el CRM debía evitar. Es distinto de "clientes fríos" (que ya llevan tiempo sin actividad): esta vista los caza *antes* de que se enfríen.

### Texto literal del ticket (Linear, `MIS-253`)

> **Qué hay que hacer:** Crear una vista **"Requieren atención"**: los contactos en estado activo (lead nuevo, en conversación, propuesta enviada, negociando) que **no tienen ningún seguimiento programado**.
>
> **Diseño:**
> * Se muestra como una **segunda sección dentro de Pendientes del día** («Para hoy» arriba, «Requieren atención» debajo).
> * Lista los contactos en estado activo sin próximo seguimiento programado, ordenados por antigüedad del último contacto (los más olvidados primero).
> * De cada uno: nombre, estado y fecha del último contacto.
> * Al pulsar, abre la ficha; en cuanto Carlos le programa un seguimiento, sale de la lista.
> * Solo para Carlos (rol operativo).
>
> **Criterio de aceptación:**
> * La vista muestra todos los contactos activos sin seguimiento programado.
> * Un contacto desaparece de la lista en cuanto se le programa un próximo contacto (o pasa a un estado no activo: perdido / ganado / inactivo).
> * Accesible desde la pantalla de inicio de Carlos.

### Punto de partida: qué ya existe (verificado leyendo el código real)

- `src/app/(app)/(with-nav)/pendientes/page.tsx` — Server Component, sin guard de rol propio (`getUser()` cubre solo autenticación). Llama una única query, `api.reminders.listDueToday`, y renderiza `<ul>` de `<Card>` (Avatar + nombre-Link + StatusBadge + badge Vencido/Hoy + motivo + `CompleteReminderButton`). No hay hoy ninguna sección con `<h2>` — es una lista plana bajo la cabecera.
- `convex/reminders.ts::listDueToday` — filtra `reminders` con `status:"pending"` y `dueAt < mañana` (índice `by_status_dueAt`), sin filtrar por rol (`requireUser`, ambos roles) — mismo criterio del ADR de MIS-18 (Marta tiene lectura completa de Pendientes/Panel).
- `convex/schema.ts` — tabla `contacts` **no tiene** ningún campo `lastContactDate`/`nextContactDate`. El "próximo seguimiento" vive en la tabla `reminders` (`dueAt`, `status: "pending"|"done"`, índice `by_status_dueAt: ["status","dueAt"]` y `by_contact: ["contactId","dueAt"]`). El "último contacto real" no existe como campo — la fuente más fiable es la tabla `notes` (MIS-11: `contactId`, `occurredAt`, índice `by_contact: ["contactId","occurredAt"]`).
- `convex/contacts.ts::listContacts` usa `_creationTime` como proxy de "último contacto" con un comentario ya obsoleto ("hasta que MIS-11 añada tracking real... lastContactAt") — MIS-11 ya existe (tabla `notes`) pero ese campo nunca se creó; ese comentario no se toca en este ticket (fuera de alcance, no forma parte del AC de MIS-253).
- `src/lib/contacts/status.ts` — `SELECTABLE_STATUSES` y `PIPELINE_SUMMARY_STATUSES` excluyen solo `"won"` (6 valores, incluyen `inactive` y `lost`). **Ninguna sirve para "estado activo"**: el AC de MIS-253 pide exactamente 4 (`lead`, `talking`, `proposal`, `negotiating`), excluyendo también `inactive` y `lost`. No existe hoy ninguna constante con ese subconjunto, en ningún archivo.
- `convex/contacts.ts::getPipelineSummary` confirma el patrón local ya aceptado: full table scan sin índice (`ctx.db.query("contacts").collect()`) — "contacts tiene hoy ~15-20 filas", 6 queries indexadas no compensarían el volumen. Mismo criterio se aplica aquí.
- `panel/page.tsx` (MIS-17) es el precedente real de "página con dos `<section>`": cada una con `<h2 style={{fontSize:14, fontWeight:700}}>` + su contenido, envueltas en `<Link href=... style={{textDecoration:"none", color:"inherit", display:"block"}}>` + `<Card interactive>` cuando toda la tarjeta es pulsable (a diferencia de las filas de `pendientes/page.tsx`, donde el `Link` solo envuelve el nombre porque hay un botón de acción aparte).

### Restricción arquitectónica confirmada (no se reabre)

Mismo ADR ya citado en MIS-17/MIS-255: nunca `useQuery` de Convex desde un Client Component (el token de sesión solo vive en cookie `HttpOnly`). Esta vista se resuelve igual que el resto de `/pendientes`: `fetchQuery` en el Server Component, sin nada en vivo en el cliente.

### Tensión real con el ADR de MIS-18 (documentada, no una pregunta abierta)

El ADR de MIS-18 dice que Marta (supervisor) tiene lectura completa de Pendientes/Panel, igual que Carlos — hoy `/pendientes` no filtra por rol. El AC de MIS-253 pide explícitamente lo contrario para esta sección concreta: **"Solo para Carlos (rol operativo)"**. No es una contradicción con MIS-18: ese ADR nunca dijo "toda sección futura de estas pantallas es compartida por diseño", solo describió el estado de esa fecha. Se trata como una decisión de producto nueva y explícita de este ticket, limitada a la sección "Requieren atención" — el resto de `/pendientes` (la sección "Para hoy") sigue sin cambios, visible para ambos roles.

## Decisiones fijadas

1. **Nueva constante local `NEEDS_ATTENTION_STATUSES` en `convex/contacts.ts`** (no en `src/lib/contacts/status.ts`): `["lead", "talking", "proposal", "negotiating"] as const`. No se mirror-ea en `src/` porque ningún código de `src/` la necesita — la UI recibe ya los datos filtrados desde la query, a diferencia de `CHANGEABLE_STATUSES`/`SELECTABLE_STATUSES`, que sí se usan en ambos lados (un `<select>` en el cliente necesita las opciones; aquí no hay ningún `<select>`). Evita un export sin consumidor.

2. **Nueva query `listNeedsAttention` en `convex/contacts.ts`** (no en `reminders.ts`): el resultado tiene forma de "contacto" (`name`/`status`/`lastContactAt`), mismo criterio ya usado para `getPipelineSummary` (vive junto a `contacts`, aunque cruce con otra tabla). Lógica:
   - `requireUser` (ambos roles) — el gating a "solo Carlos" es una decisión de **UI**, no de la API; mismo criterio ya usado en `listContacts`/`getPipelineSummary` (lectura abierta a ambos roles, la restricción real vive en qué pantalla la llama y qué rol puede *escribir*).
   - Full table scan de `contacts` sin índice, filtrado por `NEEDS_ATTENTION_STATUSES` — mismo criterio ya documentado en `getPipelineSummary` (volumen pequeño, "no compensa 4 queries indexadas por 1 escaneo").
   - Trae todos los `reminders` con `status:"pending"` (vía `by_status_dueAt`, sin acotar `dueAt` — a diferencia de `listDueToday`, aquí interesa **cualquier** seguimiento futuro, no solo el de hoy/vencido) y construye un `Set<contactId>` para excluir a quien ya tiene uno. No hay forma de indexar "ausencia de fila relacionada" en Convex — se resuelve en memoria, mismo patrón ya usado para cruces contacto↔tabla-relacionada en este repo.
   - Para "fecha del último contacto" (AC), se usa el `occurredAt` de la nota más reciente en `notes` (índice `by_contact`, `.order("desc").first()`), no `_creationTime`: un contacto con conversación real reciente no debería parecer "olvidado" solo por su fecha de alta. Fallback a `_creationTime` si el contacto no tiene ninguna nota — mismo criterio de respaldo que ya usa `listContacts`.
   - Orden ascendente por `lastContactAt` (los más antiguos/olvidados primero, tal cual pide el AC).

3. **La query se llama solo si `user.role === "rep"`**, no incondicionalmente. Es una desviación deliberada del patrón que usó MIS-255 (`existingContacts` se pedía siempre, rama solo en el render): allí se reutilizaba una query ya barata y ya usada en otra pantalla (`listContacts`, un `.collect()` simple). Aquí `listNeedsAttention` es una query nueva y más cara (scan de `contacts` + scan de `reminders` + una consulta a `notes` por cada contacto candidato) que nunca se renderiza para Marta — pedirla igualmente sería trabajo tirado en cada carga de su Pendientes. No es una barrera de seguridad (la query en sí acepta ambos roles, igual que el resto de lecturas del repo), es una decisión de coste.

4. **UI de `pendientes/page.tsx`:**
   - La lista de recordatorios actual se envuelve en `<section>` con `<h2>Para hoy</h2>` (sin más cambios: mismo `<ul>`/`<Card>`/`CompleteReminderButton` de siempre) — necesario para que el AC ("«Para hoy» arriba, «Requieren atención» debajo") tenga sentido visual; hoy no existe ningún encabezado de sección.
   - Debajo, solo si `user.role === "rep"`, una segunda `<section>` con `<h2>Requieren atención</h2>`: cada fila es un `<Link href="/contactos/{id}">` completo envolviendo un `<Card interactive>` (mismo patrón que `panel/page.tsx`, no el de las filas de recordatorios — aquí no hay botón de acción aparte, toda la tarjeta navega a la ficha). Contenido: `Avatar` + nombre + `StatusBadge` (sin `dot`) + `"Último contacto: " + formatDate(lastContactAt)`. Vacío: "Ningún contacto activo sin seguimiento programado." (mismo estilo que el vacío de "Para hoy").
   - Gap del contenedor raíz pasa de 16 a 20 (mismo valor que `panel/page.tsx`, que también tiene 2 secciones) — puramente visual, para separar bien las dos secciones.
   - El subtítulo de cabecera ("Seguimientos vencidos o de hoy.") no cambia — sigue describiendo correctamente lo que hay justo debajo; tocar su redacción no forma parte del AC.

5. **Reutilizar la ficha existente para "programar seguimiento"** — el AC dice "al pulsar, abre la ficha; en cuanto Carlos le programa un seguimiento, sale de la lista." No hace falta ninguna acción inline nueva en `/pendientes`: `scheduleReminder` (MIS-12) ya existe en la ficha del contacto (`ContactDetailView.tsx`); al volver a `/pendientes` el Server Component vuelve a ejecutar `listNeedsAttention` y el contacto ya no aparece (tiene un `reminder` "pending"). Ídem si cambia a un estado no activo (`changeContactStatus`, MIS-14): deja de cumplir `NEEDS_ATTENTION_STATUSES` en el siguiente fetch.

## `convex/contacts.ts` (EDITAR) — nueva query, añadida tras `getPipelineSummary`

```ts
// MIS-253: contactos activos (lead/talking/proposal/negotiating) SIN
// ningún recordatorio de seguimiento pendiente — el "punto ciego" del AC:
// un lead activo sin próximo contacto programado se enfría en silencio,
// invisible en /pendientes (que hoy solo muestra recordatorios YA
// programados, ver listDueToday). Vive en contacts.ts, no en reminders.ts:
// el resultado tiene forma de "contacto" (name/status/lastContactAt),
// mismo criterio que getPipelineSummary (agregación sobre contacts aunque
// cruce con otras tablas).
const NEEDS_ATTENTION_STATUSES = ["lead", "talking", "proposal", "negotiating"] as const;

export const listNeedsAttention = query({
  args: { token: v.string() },
  returns: v.array(
    v.object({
      _id: v.id("contacts"),
      name: v.string(),
      status: contactStatusValidator,
      lastContactAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    // Lectura: ambos roles, igual que listContacts/getPipelineSummary. El
    // gating a "solo Carlos" del AC es de UI (pendientes/page.tsx no llama
    // esta query si user.role !== "rep"), no de esta API.
    await requireUser(ctx, args.token);

    // Full table scan sin índice — mismo criterio ya documentado en
    // getPipelineSummary (contacts ~15-20 filas hoy).
    const contacts = await ctx.db.query("contacts").collect();
    const active = contacts.filter((c) =>
      NEEDS_ATTENTION_STATUSES.includes(c.status as (typeof NEEDS_ATTENTION_STATUSES)[number]),
    );

    // Contactos que YA tienen un seguimiento programado (cualquier
    // "pending", no solo hoy/vencido — a diferencia de listDueToday). No
    // hay forma de indexar "ausencia de fila relacionada" en Convex: se
    // resuelve con un Set en memoria.
    const pending = await ctx.db
      .query("reminders")
      .withIndex("by_status_dueAt", (q) => q.eq("status", "pending"))
      .collect();
    const withReminder = new Set(pending.map((r) => r.contactId));
    const withoutFollowUp = active.filter((c) => !withReminder.has(c._id));

    // "Fecha del último contacto" (AC) = occurredAt de la nota más
    // reciente, no _creationTime: un contacto con conversación real
    // reciente no debe parecer "olvidado" solo por su fecha de alta.
    // Fallback a _creationTime si no tiene ninguna nota todavía (mismo
    // respaldo que ya usa listContacts).
    const withLastContact = await Promise.all(
      withoutFollowUp.map(async (c) => {
        const lastNote = await ctx.db
          .query("notes")
          .withIndex("by_contact", (q) => q.eq("contactId", c._id))
          .order("desc")
          .first();
        return {
          _id: c._id,
          name: c.name,
          status: c.status,
          lastContactAt: lastNote?.occurredAt ?? c._creationTime,
        };
      }),
    );

    // Más antiguos primero (AC: "los más olvidados primero").
    return withLastContact.sort((a, b) => a.lastContactAt - b.lastContactAt);
  },
});
```

## `src/app/(app)/(with-nav)/pendientes/page.tsx` (EDITAR)

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

export default async function PendientesPage() {
  const user = await getUser();
  const token = await readSessionToken();
  const isRep = user.role === "rep";

  const reminders = await fetchQuery(api.reminders.listDueToday, { token: token! });
  // MIS-253: solo se pide para Carlos — es una query nueva y más cara que
  // listDueToday (scan de contacts + reminders + una consulta a notes por
  // contacto candidato) que nunca se renderiza para Marta.
  const needsAttention = isRep
    ? await fetchQuery(api.contacts.listNeedsAttention, { token: token! })
    : [];

  return (
    <div className="flex flex-1 flex-col" style={{ padding: "16px 20px 24px", gap: 20 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <Badge tone="accent" style={{ alignSelf: "flex-start" }}>Operativo</Badge>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)" }}>Hola, {user.name}</h1>
        <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>Seguimientos vencidos o de hoy.</p>
      </div>

      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>Para hoy</h2>
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
      </section>

      {isRep && (
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>Requieren atención</h2>
          {needsAttention.length === 0 ? (
            <p style={{ fontSize: 14, color: "var(--text-secondary)", textAlign: "center", padding: "32px 0" }}>
              Ningún contacto activo sin seguimiento programado.
            </p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              {needsAttention.map((c) => (
                <li key={c._id}>
                  <Link
                    href={`/contactos/${c._id}`}
                    style={{ textDecoration: "none", color: "inherit", display: "block" }}
                  >
                    <Card interactive padding="md" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
                      <Avatar name={c.name} size="md" />
                      <div style={{ flex: "1 1 200px", minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>{c.name}</span>
                          <StatusBadge state={c.status} dot={false} />
                        </div>
                        <p style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
                          Último contacto: {formatDate(c.lastContactAt)}
                        </p>
                      </div>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
```

## Fuera de alcance (explícito)

- **Cambiar el comentario obsoleto de `listContacts`** sobre `lastContactAt`/MIS-11 — no forma parte del AC de MIS-253, y no se toca `listContacts` en este ticket.
- **Acción inline de "programar seguimiento" desde `/pendientes`** — el AC dice "al pulsar, abre la ficha"; programar sigue siendo una acción de la ficha (MIS-12), no de esta lista.
- **Filtrar `listNeedsAttention` por rol a nivel de Convex (`requireRole`)** — el AC lo enmarca como una decisión de qué pantalla la muestra, no una restricción de datos (mismo criterio que el resto de queries de lectura del repo, abiertas a ambos roles).
- **Paginación / índice nuevo en `contacts`** — mismo criterio ya aceptado en `getPipelineSummary`/`listContacts` para el volumen actual (~15-20 filas).
- **Test e2e dedicado** — se verifica manualmente con un test Playwright temporal (añadido, ejecutado, revertido antes de commitear), mismo criterio que MIS-255. Recomendado como mejora futura no bloqueante.

## Verificación end-to-end prevista

1. `npx convex dev --once` tras añadir la query — confirmar el tipo generado real antes de tocar la UI.
2. `npx tsc --noEmit`, `npm run lint`, `npm run build` limpios.
3. Login como Carlos: crear/usar un contacto en estado "Lead nuevo" sin ningún seguimiento programado y sin ninguna nota → aparece en "Requieren atención", fecha de último contacto = fecha de alta.
4. Añadir una nota de conversación a ese contacto con una fecha concreta → la fecha mostrada en "Requieren atención" pasa a ser la de la nota (no la de alta).
5. Programarle un seguimiento (desde la ficha) → vuelve a `/pendientes` → el contacto ya no aparece en "Requieren atención" (aparece en "Para hoy" si la fecha es hoy/vencida, si no, en ninguna de las dos).
6. Cambiar el estado de un contacto activo sin seguimiento a "Perdido"/"Inactivo" → desaparece de "Requieren atención".
7. Cerrar una venta (estado "Ganado") de un contacto sin seguimiento → desaparece de "Requieren atención".
8. Varios contactos sin seguimiento con distintas fechas de último contacto → orden ascendente correcto (el más antiguo primero).
9. Login como Marta → `/pendientes` muestra "Para hoy" igual que siempre, **sin** la sección "Requieren atención".
10. Sin contactos activos sin seguimiento → mensaje de vacío "Ningún contacto activo sin seguimiento programado."
11. Reejecutar la suite Playwright completa — debe seguir en verde sin modificarla; añadir y revertir un test temporal en `edge-cases.spec.ts` para verificar 3-6 manualmente con evidencia real.
12. Viewport móvil 320-375px: la nueva sección no desborda (mismo `Card`/`Avatar`/`StatusBadge` ya verificados a este ancho en `panel/page.tsx`/`pendientes/page.tsx`).

## Archivos afectados

| Archivo | Tipo |
|---|---|
| `convex/contacts.ts` | Editar (nueva query `listNeedsAttention` + constante `NEEDS_ATTENTION_STATUSES`) |
| `src/app/(app)/(with-nav)/pendientes/page.tsx` | Editar |

No se toca: `convex/schema.ts` (no hace falta ningún campo/índice nuevo), `convex/reminders.ts`, `src/lib/contacts/status.ts`, `ContactDetailView.tsx`, ningún test e2e permanente.

## Puntos abiertos (no bloqueantes)

- Si el AC evolucionara para pedir también un tipo distinto de "última interacción" (p. ej. cambios de estado o cierres de venta contando como contacto), habría que ampliar `listNeedsAttention` más allá de `notes` — fuera de alcance hoy, el AC solo habla de "último contacto".
- Mismo límite de volumen que `listContacts`/`getPipelineSummary`: si la tabla `contacts` creciera mucho, el full table scan (más ahora una consulta a `notes` por candidato) sería el cuello de botella antes que ningún otro ticket — no es una regresión introducida aquí.
- La sección "Para hoy" (sin tocar en este ticket) no lleva el override `whiteSpace: "normal"` del `StatusBadge` que sí lleva "Requieren atención" desde el hallazgo 1 de verificación — no confirmado si comparte el mismo riesgo de overflow a 320px con "Propuesta enviada"/"Negociando". Follow-up sugerido, no bloqueante.
- Mismo gap de `overflowWrap` (hallazgo 2 de verificación) sin corregir en `ContactList.tsx`, en la sección "Para hoy" de esta misma página y en la ficha del contacto — un nombre real de una sola palabra muy larga podría desbordar ahí también. Preexistente en todo el repo, no introducido por MIS-253; follow-up sugerido, no bloqueante.

## Estado

**Auditoría de plan:** GO sin blockers ni majors (veredicto del usuario). Sugerencias no bloqueantes adoptadas como follow-up (no en este ticket): e2e permanente para la desaparición de la lista al programar seguimiento/lost/inactive/won (el temporal de la verificación cubre el comportamiento, no protege regresiones futuras); si "último contacto" debiera incluir recordatorios completados/cierres/cambios de estado además de notas, ampliar `listNeedsAttention`; optimizar/denormalizar si el volumen crece.

**Implementado** en la rama `feature/mis-253-vista-requieren-atencion`. Cambios reales: `convex/contacts.ts` (nueva query `listNeedsAttention` + constante `NEEDS_ATTENTION_STATUSES`), `src/app/(app)/(with-nav)/pendientes/page.tsx`, y un ajuste permanente en `e2e/full-flow.spec.ts` (ver "Hallazgos reales durante la verificación", punto 3).

### Hallazgos reales durante la verificación (no estaban en el plan original)

1. **Overflow horizontal a 320px con el estado "Propuesta enviada"** en la nueva sección — el `StatusBadge` es `whiteSpace: nowrap` por defecto (`StatusBadge.jsx`) y esta sección no tenía el mismo override que ya lleva `panel/page.tsx` desde MIS-17. Corregido añadiendo `whiteSpace: "normal", maxWidth: "100%", boxSizing: "border-box"` al `StatusBadge` de "Requieren atención" — mismo fix que MIS-17, esta vez en `pendientes/page.tsx`. La sección "Para hoy" (sin tocar en este ticket) no lleva este mismo override; no se ha comprobado si comparte el mismo riesgo — ver punto 2 de "Puntos abiertos" más abajo.
2. **Overflow horizontal a 320px con un nombre de una sola palabra muy larga** — un contacto de pruebas ya existente en el deployment de dev (nombre de ~130 caracteres sin espacios, de una verificación manual anterior no limpiada) desbordaba la tarjeta: un `<span>` normal no tiene puntos de corte dentro de una "palabra" sin espacios. Corregido con `overflowWrap: "anywhere"` en el `<span>` del nombre, solo en la sección nueva. Mismo gap preexistente y sin corregir en `ContactList.tsx`, en la sección "Para hoy" de esta misma página y en la ficha del contacto — no se toca ahí, fuera de alcance de MIS-253 (ver "Puntos abiertos").
3. **`e2e/full-flow.spec.ts` (test permanente MIS-19) rompía en el paso 8** ("Marca el seguimiento como hecho desde Pendientes"): al completarse el recordatorio, ese contacto (estado activo, ya sin seguimiento pendiente) empieza a aparecer en la nueva sección "Requieren atención" — comportamiento correcto y esperado del AC, pero el `page.getByRole("listitem").filter({hasText: contactName})` del test no estaba escopado a la sección "Para hoy", así que encontraba la fila nueva (visible) en vez de comprobar que la vieja había desaparecido. Corregido escopando ambos pasos (7 y 8) a la sección "Para hoy" vía su `<h2>`. Cambio permanente, no revertido (a diferencia de los tests temporales de verificación).

Evidencia real de verificación:

1. **`npx convex dev --once`**: funciones desplegadas sin error al deployment de dev (`dutiful-mole-111`).
2. **`npx tsc --noEmit`**: limpio.
3. **`npm run lint`**: 0 errores (1 warning preexistente en `Avatar.jsx`, no introducido por este cambio).
4. **`npm run build`**: compilación de producción correcta, las 7 rutas generadas sin error (incluida `/pendientes`).
5. **Suite Playwright completa** (`npx playwright test`), corrida dos veces:
   - Primera corrida: **14/15 en verde**, 1 fallo real en `full-flow.spec.ts` paso 8 (hallazgo 3 de arriba).
   - Tras corregir el escopado: **15/15 en verde**.
6. **Verificación manual real de los comportamientos nuevos**, con tests Playwright temporales añadidos a `edge-cases.spec.ts` y `role-gating.spec.ts`, ejecutados y luego **revertidos** (`git checkout`) antes de commitear:
   - Contacto activo sin notas ni seguimiento → aparece en "Requieren atención".
   - Dos contactos con notas en fechas contradictorias respecto a su orden de creación (para descartar que se estuviera ordenando por `_creationTime` en vez de `notes.occurredAt`) → el de la nota más antigua aparece primero — confirma que la fecha usada es la de la nota real, no la de alta.
   - Contacto con seguimiento ya programado de entrada → nunca aparece.
   - Contacto sin seguimiento al que se le programa uno → desaparece de la lista (AC).
   - Contacto al que se le cambia el estado a "Perdido" → desaparece.
   - Contacto al que se le cierra la venta como "Ganada" → desaparece.
   - Viewport 320px con la sección poblada (incluida la etiqueta "Propuesta enviada") → sin overflow horizontal, tras los dos fixes de los hallazgos 1 y 2.
   - Login como Marta → `/pendientes` muestra "Para hoy" sin la sección "Requieren atención".
   - Re-suite completa tras los fixes: 17/17 (15 permanentes + 2 temporales) en verde antes de revertir los temporales.
7. **No verificado con evidencia real**: el mensaje de vacío "Ningún contacto activo sin seguimiento programado." — el deployment de dev compartido ya tiene contactos activos sin seguimiento de corridas anteriores de la suite (acumulados, sin `deleteContact` disponible), así que forzar un estado realmente vacío no es práctico sin alterar datos de otras specs. El código es el mismo patrón ternario ya verificado para el vacío de "Para hoy" (`length === 0`), riesgo bajo.

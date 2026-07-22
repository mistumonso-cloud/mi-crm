# MIS-17 — Panel de oportunidades (vista de Marta) (v2)

## Respuesta a la auditoría de plan v1 → v2

**Veredicto v1: NO-GO** (2 majors, 2 sugerencias no bloqueantes).

| # | Auditoría | Resolución |
|---|---|---|
| Major 1 | `StatusBadge.jsx` fuerza `whiteSpace: 'nowrap'` (línea 35) y `padding: '6px 12px'`; la etiqueta más larga, "Propuesta enviada" (18 caracteres), necesita ~170px+. Mi v1 ponía `style={{ alignSelf: "flex-start" }}` en el `<StatusBadge>` de cada tarjeta del panel — eso anula el `stretch` por defecto del flex-column padre y deja que el badge crezca a su ancho intrínseco sin envolver texto, con riesgo real de desbordar la columna del grid `1fr 1fr` en viewports de 320-375px. | **Corregido**: se anula `whiteSpace` a `"normal"` y se añade `maxWidth: "100%"` en el propio punto de uso (`style={{ alignSelf: "flex-start", whiteSpace: "normal", maxWidth: "100%" }}`), usando el mecanismo de extensión que el propio `StatusBadge` ya ofrece (su prop `style` se aplica en último lugar, tras los estilos por defecto). Un flex item con `align-self` propio pero `max-width: 100%` sigue resolviendo el porcentaje contra el ancho del contenedor — el badge sigue compacto para etiquetas cortas ("Ganado") pero envuelve a 2 líneas en vez de desbordar para las largas ("Propuesta enviada"). No se toca `StatusBadge.jsx` (componente compartido, usado en toda la app) — solo este punto de uso, en `panel/page.tsx`. |
| Major 2 | `BottomNav.tsx` enlaza a `/contactos` a secas (sin query string). Mi v1 inicializaba `statusFilter` con `useState(initialStatusFilter)` en `ContactList.tsx` — Next App Router no fuerza remount al cambiar solo el search param de la misma ruta, así que si Marta está en `/contactos?status=negotiating` y pulsa la pestaña "Contactos" del `BottomNav`, la URL se limpia pero el `useState` de `ContactList` conserva el valor viejo (los inicializadores de `useState` solo corren en el montaje). | **Corregido**: se añade `key={initialStatusFilter ?? "all"}` al `<ContactList>` en `contactos/page.tsx`. Al cambiar la key, React desmonta la instancia vieja y monta una nueva, cuyo `useState(initialStatusFilter)` arranca ya con el valor correcto — mismo efecto que "sincronizar en cada cambio" sin `useEffect` de sincronización ni introducir `useSearchParams` (sin precedente en el repo). Efecto secundario aceptado: el texto de búsqueda también se resetea al cambiar de filtro de estado — razonable, no pedido pero tampoco contradice el AC. |
| Baja | El badge "Supervisora" en `/panel` queda raro si Carlos entra. | No se toca — ya justificado en la decisión 12 (acceso de Carlos aprobado por el ADR de MIS-18); cambiar el badge según rol sería alcance nuevo no pedido por este AC. |
| Baja | El encabezado `{contacts.length} contactos` puede confundir con el filtro de estado activo. | No se toca — mismo comportamiento ya aprobado en MIS-9 para el filtro de texto (ver nota "Sin cambios" al final de la sección de `ContactList.tsx`). |

No se reabre ninguna otra decisión de v1 (agregación sin índices nuevos, `router.refresh()` en vez de `useQuery`, módulos por tabla, naming won/lost, `Link` en vez de `button+router.push`, grid inline, sin guard de rol) — no fueron objetadas por esta auditoría.

## Hallazgos reales durante la generación de código (post-GO, no cubiertos por la auditoría de plan)

Al instalar el código sobre el repo real y verificarlo con Playwright (no solo razonamiento), aparecieron dos bugs reales que ningún nivel de revisión estática había detectado — documentados aquí porque cambian el código final respecto al bloque de `panel/page.tsx` descrito más abajo en las secciones anteriores de este plan:

1. **`PIPELINE_STATES[status].label` no se puede leer desde `panel/page.tsx` (Server Component).** `StatusBadge.jsx` empieza con `"use client"` — el archivo ENTERO queda marcado como límite cliente, así que cualquier export suyo (no solo el componente `StatusBadge`) se convierte en una referencia cliente opaca al importarse desde un Server Component. `<StatusBadge state={status} .../>` como JSX funciona perfectamente (es el caso soportado: renderizar un Client Component desde un Server Component), pero leer el VALOR de `PIPELINE_STATES` para construir el string del `aria-label` en el servidor devuelve un objeto vacío en tiempo de ejecución — `PIPELINE_STATES[status]` es `undefined`, y `.label` lanza `TypeError`. Confirmado con `console.error` temporal: `Object.keys(PIPELINE_STATES)` en el servidor da `[]`. **Corrección**: se retira el `aria-label` manual del `<Link>`; su nombre accesible se deriva del contenido visible (el número + el texto del badge, una vez hidratado), que ya coincide con lo que se ve en pantalla — no hace falta duplicar las etiquetas en un segundo sitio no-cliente para esquivar el problema.

2. **CSS Grid con `min-width: auto` por defecto desbordaba igualmente a 320px, incluso con el fix de `whiteSpace`/`maxWidth` de la sugerencia media de la ronda de GO condicionado.** Verificado con Playwright real (`scrollWidth 327 > clientWidth 320`) y diagnosticado elemento por elemento: la columna derecha del grid (que en `SELECTABLE_STATUSES` contiene "En conversación", "Negociando" y "Perdido") se ensanchaba a 160px porque los grid items tienen `min-width: auto` por defecto — el navegador no encoge una columna por debajo del ancho de su PALABRA más larga sin espacios, y "conversación" (12 caracteres, una sola palabra) es más larga que cualquier palabra de la columna izquierda. `whiteSpace: "normal"` permite partir línea ENTRE palabras, pero no ayuda si la palabra más ancha por sí sola ya no cabe. **Corrección**: `minWidth: 0` en el `<Link>` (el grid item directo) y en el `<Card>`, anulando el `min-width: auto` por defecto — con esto el navegador sí encoge la columna y fuerza el envoltorio dentro del espacio disponible. Re-verificado con Playwright: `scrollWidth === clientWidth` exacto en 320/360/375px, sin excepciones.

Ambos hallazgos están ya incorporados en el bloque de código de `panel/page.tsx` más abajo (sección correspondiente) — lo que sigue en este documento es el código FINAL, ya con ambas correcciones aplicadas.

## Contexto

### Texto literal del ticket (Linear, `MIS-17`)

> Crear la pantalla del panel de oportunidades: la vista pensada para que Marta vea el estado del negocio en un golpe de vista, sin tener que pasar por la lista de tareas de Carlos ni preguntarle nada.
>
> **Resumen del pipeline por estado:** Muestra cuántos contactos hay en cada estado activo: Lead nuevo: N contactos; En conversación: N contactos; Propuesta enviada: N contactos; Negociando: N contactos; Comprado: N contactos; Descartado: N contactos.
>
> **Total de ventas ganadas:** Número de ventas cerradas como ganadas. Importe total acumulado de ventas ganadas (suma de todos los importes registrados).
>
> **Interactividad:** Al pulsar sobre cualquier estado, se abre la lista de contactos filtrada por ese estado, para que Marta pueda ver exactamente quiénes son los contactos en esa fase.
>
> **Cómo usa Marta esta pantalla:** Marta entra al CRM habitualmente por el Panel, no por Pendientes. Su flujo es: ver los números globales → si algo llama su atención (muchos en negociación, pocas ventas cerradas), pulsar para ver el detalle. No introduce datos, solo consulta. Necesita que la información sea visual, rápida de leer y que no requiera aprender nada nuevo.
>
> **Fuera del MVP:** sin gráficas ni visualizaciones complejas — solo números claros; sin filtros por fecha ni por período; sin exportación de datos.
>
> **Criterio de aceptación:** La pantalla muestra el número de contactos en cada estado. Muestra el total de ventas ganadas (número e importe acumulado). Al pulsar un estado, abre la lista de contactos filtrada por ese estado. La información está actualizada en tiempo real (refleja los cambios de Carlos sin recargar manualmente). La pantalla es clara y usable desde el móvil sin formación previa.

### Confirmación de que es la tarea correcta

Verificado con evidencia cruzada (Linear MCP + `PLANS/README.md` + `git log`): MIS-7 a MIS-16 están instalados, mergeados y desplegados; no existe ningún commit, rama ni archivo de plan/código para MIS-17. MIS-17 es la última fila "Pendiente" de `PLANS/README.md`, pertenece a "Fase 5 — Panel y visibilidad" (misma fase que MIS-16 y MIS-18, ambos ya cerrados). Sin relaciones de bloqueo formal en Linear; el orden de fases y el hecho de que MIS-15/16 ya dejaron explícitamente preparados los datos que este ticket consume (`saleClosures.amountCents` en céntimos "para cualquier agregado futuro del panel de Marta", `contacts.status` con índice `by_status` sin consumidor) confirman que MIS-17 es el siguiente pendiente correcto.

### Punto de partida: qué ya existe y qué falta

A diferencia de MIS-16 (construido en un 90% de forma incremental), **MIS-17 parte de un placeholder puro**:

```tsx
// src/app/(app)/(with-nav)/panel/page.tsx, estado actual
import { Badge } from "@/components/ui/feedback/Badge";
import { getUser } from "@/lib/auth/dal";

export default async function PanelPage() {
  const user = await getUser();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <Badge tone="accent">Supervisora</Badge>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)" }}>Hola, {user.name}</h1>
      <p style={{ fontSize: 14, color: "var(--text-secondary)", maxWidth: 320 }}>
        Aquí se construirá el panel de oportunidades de Marta (MIS-17).
      </p>
    </div>
  );
}
```

Este ticket es, en varios sentidos, una "primera vez" para el proyecto:

- **Primeras queries de agregación de `convex/`.** Búsqueda exhaustiva (`grep -rn "collect().length\|reduce(\|groupBy" convex/`) sin resultados — ni `contacts.ts` ni `sales.ts` ni ningún otro módulo cuenta o suma documentos hoy.
- **Primer filtro por query param de URL.** `src/app/(app)/(with-nav)/contactos/page.tsx` no lee `searchParams` en ningún punto hoy; el único filtro que existe (búsqueda por texto, MIS-9) vive en estado local de React dentro de `ContactList.tsx`, nunca en la URL.
- **Primera pantalla que necesita reflejar cambios de OTRO usuario sin acción propia.** En el resto del repo, "tiempo real" se resolvió como "refresco tras tu propia Server Action" (MIS-9 "búsqueda en tiempo real" = filtrado instantáneo en cliente; MIS-16 = `refresh()` tras tu propia mutation). Aquí Marta es una sesión de navegador distinta a la de Carlos y no dispara ninguna acción — ese patrón no aplica.

Lo que **sí** ya existe y este plan reutiliza tal cual, verificado línea a línea contra el repo real:

- `SELECTABLE_STATUSES`/`ContactStatus` en `src/lib/contacts/status.ts` — exactamente los 6 estados del AC (excluye `inactive`), en el mismo orden que el ticket los enumera.
- `PIPELINE_STATES` en `src/components/ui/feedback/StatusBadge.jsx` — labels/colores de los 7 estados, incluye `inactive` (no se usa aquí, pero confirma que el componente ya sabría pintarlo si algún día hiciera falta).
- `Card` (`src/components/ui/core/Card.jsx`) soporta la prop `interactive` (booleana: cursor pointer + sombra en hover).
- `StatusBadge`/`Badge` soportan `style`/`state`/`tone` tal como se necesitan aquí (confirmado contra sus `.d.ts`).
- `ContactList.tsx` ya tiene `ClearIcon` definido localmente (línea 43) — reutilizable para el botón "Quitar" del nuevo chip de filtro, sin crear un icono nuevo.
- El dispatcher `src/app/(app)/page.tsx` confirma que Marta (`role: "supervisor"`) aterriza en `/panel` por defecto, Carlos (`"rep"`) en `/pendientes`.
- `convex/contacts.ts`/`convex/sales.ts` ya importan `requireUser` y terminan en puntos limpios (última línea `});`) para añadir las nuevas queries sin reestructurar nada.
- `formatCurrencyCents` (`src/lib/contacts/format.ts`, de MIS-15) — su propio comentario ya decía que céntimos-a-euros era "para cualquier agregado futuro del panel de Marta (MIS-17)".

### Verificación técnica previa (hecha antes de aprobar este plan)

Dos rondas de exploración (agentes Explore) + una de diseño (agente Plan) + verificación manual mía contra el código real antes de aceptar el diseño:

- Confirmado por grep exhaustivo en `src/`: cero usos de `useQuery` de `convex/react` o de `ConvexReactClient` fuera de `ConvexClientProvider.tsx` (que solo lo configura, nadie lo consume). `ConvexClientProvider` envuelve toda la app desde `src/app/layout.tsx`, pero introducir `useQuery` real sería el primer uso de ese patrón.
- Confirmado el motivo documentado de por qué nunca se ha usado `useQuery`: comentario en `contactos/page.tsx` (MIS-9) — el token de sesión vive en cookie `HttpOnly` a propósito y no debe llegar a un componente cliente. Todas las queries de Convex exigen `token: v.string()` como primer argumento; no hay ninguna vía de lectura autenticada sin él.
- Confirmado que `router.refresh()` (de `next/navigation`, usado en Client Components) es una función **distinta** de `refresh()` (de `next/cache`, usado dentro de Server Actions y ya utilizado por `closeSaleAction`/`changeStatusAction`/etc.) — ambas re-renderizan Server Components con datos frescos, pero se invocan desde sitios distintos y con mecanismos distintos. `AppRouterInstance.refresh()` sigue documentado y vigente en los tipos de Next 16 instalados (`node_modules/next/dist/shared/lib/app-router-context.shared-runtime.d.ts`).
- Confirmado (guía oficial de Convex, `node_modules/convex/dist/esm-types/server/{query,database}.d.ts`): un full table scan (`.collect()` sin `.withIndex()`) es aceptable en tablas "que se mantendrán muy pequeñas (unos pocos cientos a unos pocos miles de documentos)" — sin límite numérico duro documentado en los `.d.ts`. `contacts` tiene hoy ~15-20 filas de prueba; `listContacts` ya hace exactamente este tipo de scan sin índice, precedente ya aceptado en el repo.
- Confirmado que `saleClosures` solo tiene `.index("by_contact", [...])`, sin índice por `outcome` — el propio plan de MIS-15 ya anticipó que ese índice se añadiría "cuando exista un consumidor real", pero no lo creó preventivamente.

## Decisiones fijadas

1. **"Tiempo real" se resuelve con `router.refresh()` periódico en un Client Component nuevo (`PanelAutoRefresh.tsx`), no con `useQuery` de Convex.** Motivo: adoptar `useQuery` exigiría que un Client Component tuviera el token de sesión disponible para pasarlo como argumento de la query (viajaría por el WebSocket de Convex y quedaría en estado de React) — exactamente el riesgo que la cookie `HttpOnly` de MIS-9 fue diseñada para evitar. `router.refresh()` re-ejecuta el árbol de Server Components de la ruta actual — `fetchQuery` corre de nuevo en el servidor, con el token de la cookie `HttpOnly`, que nunca toca este componente — sin desmontar los Client Components ya vivos (el propio `PanelAutoRefresh` sobrevive a cada refresh, el `setInterval` no se reinicia). El AC pide "sin recargar manualmente", no *push* instantáneo — un auto-refresco periódico lo satisface sin reabrir una decisión de seguridad de otro ticket. Intervalo: **20 000 ms**, con guard `document.visibilityState === "visible"` (no lo pide el AC, pero evita refrescar contra una pestaña en segundo plano sin que nadie la vea — 3 líneas, documentado como decisión deliberada).

2. **Dos queries de agregación nuevas, una por tabla, en los módulos ya existentes** (`convex/contacts.ts::getPipelineSummary`, `convex/sales.ts::getWonSalesSummary`) — no un `convex/panel.ts` nuevo. Criterio ya fijado por MIS-15 (decisión 2): los módulos de `convex/` se organizan por tabla, no por pantalla/ticket. MIS-17 no crea ninguna tabla, así que no le corresponde módulo propio.

3. **`getPipelineSummary` devuelve un objeto con las 6 claves ya contadas** (`{lead, talking, proposal, negotiating, won, lost}`, cada una `v.number()`), no un array `{status, count}[]`. El cliente (`panel/page.tsx`) conoce de antemano esas 6 categorías fijas por nombre (son literalmente los 6 estados de `SELECTABLE_STATUSES`) — indexar por clave evita un `.find()` en cada una de las 6 tarjetas. Excluye `"inactive"` a propósito, mismo criterio que `CHANGEABLE_STATUSES` en el mismo archivo ("inactive" existe en el schema pero ningún ticket define cómo se llega a él) y que el propio AC (enumera 6 categorías, no 7).

4. **Ambas queries hacen `.collect()` + reduce en el handler, sin índice nuevo.** Mismo criterio que `listContacts`: al volumen actual (~15-20 filas en `contacts`, `saleClosures` un subconjunto — como mucho unas pocas filas por contacto cerrado, MIS-15 decisión 6), un full table scan está dentro de la guía oficial de Convex citada arriba. Usar `by_status` para 6 queries indexadas separadas supondría 6 escaneos en vez de 1, sin ventaja medible a este volumen. No se crea un índice `by_outcome` en `saleClosures` — se añadirá si el volumen crece lo suficiente para notarse, no antes (mismo aplazamiento ya hecho explícitamente por MIS-15).

5. **`getWonSalesSummary` cuenta FILAS de `saleClosures` con `outcome:"won"`, no contactos distintos.** Un contacto puede tener más de un cierre ganado a lo largo del tiempo (MIS-15, decisión 6: reapertura vía "Cambiar estado" + segundo cierre). "Número de ventas ganadas" (este contador) y "contactos en estado Ganado" (`getPipelineSummary.won`) son preguntas distintas que pueden dar números distintos — coherente con que el propio AC las presenta como dos secciones separadas del panel, no una sola cifra reutilizada dos veces.

6. **Filtro de estado en `/contactos` vía `?status=<estado>`, filtrado en memoria en `ContactList`, no un argumento nuevo en `listContacts`.** `searchParams` como prop `Promise<{status?: string}>` en `ContactosPage` — mismo patrón Next 16 ya usado para `params` en la ficha de contacto (`Promise<{id: string}>`, `await`). Validación contra `SELECTABLE_STATUSES` con el patrón `array.includes(x as (typeof arr)[number])` ya establecido (lección de la auditoría de plan de MIS-14/15: comparar un `string` con `===` no estrecha el tipo) — un `?status=banana` manipulado a mano se ignora silenciosamente, sin error. El filtrado en sí ocurre en memoria en `ContactList`, mismo criterio ya fijado por MIS-9 para el filtro de texto (dataset pequeño, ya se trae completo al cliente) — añadir un argumento a `listContacts` solo para esto no reduce trabajo real y crea dos formas de filtrar el mismo array.

7. **Chip "Filtrado por: `<estado>` · Quitar" en `ContactList`, con limpieza de estado local Y de la URL.** No es alcance no pedido: el propio AC dice "para que Marta pueda ver exactamente quiénes son los contactos en esa fase", lo que implica que después debe poder volver a verlos todos — sin una salida visible quedaría atrapada en `/contactos?status=negotiating`. El botón llama `setStatusFilter(null)` **y** `router.replace("/contactos")`: si solo limpiara el estado local, un F5 posterior volvería a leer `?status=...` de la URL y resucitaría el filtro que Marta acababa de quitar (`useState(initialStatusFilter)` solo lee la prop en el montaje inicial, no en renders posteriores).

8. **Naming "Comprado"/"Descartado" (AC) vs. "Ganado"/"Perdido" (`PIPELINE_STATES`, código)**: ya resuelto por MIS-14/15 y no se reabre aquí — se reutilizan las etiquetas ya en producción, no el texto literal del ticket.

9. **Tarjetas de pipeline: `<Link href="/contactos?status=X">` envolviendo `<Card interactive>`, no `<button onClick={() => router.push(...)}>`.** Es navegación pura, no una mutación ni lógica condicional — `Link` da un `<a>` real (accesible, focable, activable con Enter sin JS adicional, con prefetch), y es el patrón que usa el 100% de la navegación ya existente en el repo (filas de `ContactList`, `AddContactFab`, `BottomNav`) — cero precedente de `button+router.push` para navegación pura.

10. **La tarjeta de "ventas ganadas" NO es pulsable.** El AC de interactividad habla explícitamente de "cualquier estado" (las 6 tarjetas de pipeline), no de ventas; "Comprado" (`/contactos?status=won`) ya cubre el único destino con sentido, y no existe ninguna pantalla de "lista de ventas" en el MVP (construirla sería alcance no pedido, explícitamente fuera del MVP: "sin exportación de datos").

11. **Grid con `style={{display:"grid", gridTemplateColumns:"1fr 1fr"}}` inline, no clases `grid-cols-*` de Tailwind.** Coherente con que el 100% del detalle visual del repo se resuelve con `style={{}}` sobre variables CSS (`var(--...)`), nunca con utilidades de grid de Tailwind — cero precedente de lo contrario.

12. **Sin guard de rol nuevo en `/panel`.** Ya resuelto por el ADR de MIS-18 (`PLANS/MIS-18-navegacion-principal.md`, "Nota de seguridad"): ambos roles tienen acceso de lectura a `/panel` y `/pendientes`. Este ticket no introduce ninguna mutation ni dato sensible nuevo expuesto al rol "equivocado" (todo son queries de solo lectura, `requireUser`, igual que el resto de queries de lectura del proyecto) — no hay motivo para reabrir esa decisión.

13. **(v2, corrige M1 de la auditoría; endurecido tras la sugerencia media de la ronda de GO condicionado) El `<StatusBadge>` de cada tarjeta del panel anula `whiteSpace` a `"normal"`, añade `maxWidth: "100%"` y fija `boxSizing: "border-box"`, vía su prop `style`.** `StatusBadge.jsx` fuerza `whiteSpace: 'nowrap'` por defecto (pensado para su uso habitual junto a un nombre en una fila de lista, donde el espacio sobra) — en las tarjetas del panel, con la etiqueta más larga del pipeline ("Propuesta enviada", 18 caracteres) dentro de una columna de un grid `1fr 1fr` a 320-375px, forzar una sola línea arriesgaba desbordar horizontalmente la tarjeta. Al ser `style` el último spread dentro de los estilos por defecto del componente, cualquier propiedad pasada aquí gana — no hace falta tocar `StatusBadge.jsx` (compartido con `ContactList`/`ChangeStatusForm`/etc.) para este único punto de uso. `maxWidth: "100%"` es necesario junto con `whiteSpace: "normal"`: sin él, un `align-self: flex-start` (ya presente, para que el badge no se estire a todo el ancho de la tarjeta) deja al badge sin una anchura contra la que envolver, y el texto no cortaría línea igualmente. `boxSizing: "border-box"` se añade de forma explícita y defensiva: confirmado que `src/app/globals.css:1` (`@import "tailwindcss"`) activa el Preflight de Tailwind v4, que ya pone `box-sizing: border-box` global — así que el `padding: '6px 12px'` interno del badge ya debería descontarse del `maxWidth: 100%` sin este añadido, pero fijarlo explícitamente en este punto de uso elimina cualquier dependencia de un global no mencionado en este archivo, sin coste ni riesgo.

14. **(v2, corrige M2 de la auditoría) `<ContactList key={initialStatusFilter ?? "all"}>` en `contactos/page.tsx`.** `BottomNav.tsx` enlaza a `/contactos` sin query string; sin una `key` que cambie, navegar ahí desde una vista ya filtrada (`/contactos?status=negotiating`) no remonta `ContactList`, y su `useState(initialStatusFilter)` — que solo lee la prop en el montaje — conservaría el filtro viejo aunque la URL ya esté limpia. Cambiar la `key` cuando cambia el estado resuelto por la URL fuerza a React a desmontar y remontar `ContactList` con el valor correcto, sin introducir `useEffect` de sincronización ni `useSearchParams` (sin precedente en el repo).

## `convex/contacts.ts` (EDITAR — añadir al final del archivo)

```ts
// MIS-17: resumen del pipeline por estado, para las 6 tarjetas del panel
// de Marta (AC: "Muestra cuántos contactos hay en cada estado activo").
// Mismos 6 estados que CHANGEABLE_STATUSES arriba — "inactive" queda fuera
// a propósito, mismo criterio ya aplicado ahí. Objeto con las 6 claves ya
// contadas (no un array {status,count}[]): panel/page.tsx conoce de
// antemano esas 6 categorías fijas, indexar por clave evita un .find() por
// tarjeta en el cliente.
//
// Full table scan sin índice, deliberado — mismo criterio que listContacts
// arriba: la guía oficial de Convex (node_modules/convex/dist/esm-types/
// server/database.d.ts) acepta un full table scan en tablas "que se
// mantendrán muy pequeñas (unos pocos cientos a unos pocos miles de
// documentos)" — contacts tiene hoy ~15-20 filas. 6 queries indexadas
// (by_status) supondrían 6 escaneos en vez de 1, sin ventaja medible a
// este volumen; el índice queda disponible sin usar, igual que antes de
// MIS-17.
export const getPipelineSummary = query({
  args: { token: v.string() },
  returns: v.object({
    lead: v.number(),
    talking: v.number(),
    proposal: v.number(),
    negotiating: v.number(),
    won: v.number(),
    lost: v.number(),
  }),
  handler: async (ctx, args) => {
    await requireUser(ctx, args.token); // lectura: ambos roles, igual que listContacts
    const contacts = await ctx.db.query("contacts").collect();

    const summary = { lead: 0, talking: 0, proposal: 0, negotiating: 0, won: 0, lost: 0 };
    for (const c of contacts) {
      if (c.status !== "inactive") {
        summary[c.status] += 1;
      }
    }
    return summary;
  },
});
```

## `convex/sales.ts` (EDITAR — añadir al final del archivo)

```ts
// MIS-17: total de ventas ganadas para la tarjeta del panel de Marta (AC:
// "Número de ventas cerradas como ganadas. Importe total acumulado").
// Cuenta FILAS de saleClosures con outcome:"won", no contactos distintos —
// un contacto puede tener más de un cierre ganado a lo largo del tiempo
// (decisión 6 de PLANS/MIS-15-registro-cierre-venta.md), así que este
// número y "contactos en estado Ganado" (getPipelineSummary.won) pueden
// diferir — son dos preguntas distintas, y así lo presenta el propio AC
// (dos secciones separadas del panel).
//
// Full table scan sin índice — mismo criterio que getPipelineSummary /
// listContacts: saleClosures es un subconjunto de contacts (como mucho
// unas pocas filas por contacto cerrado), volumen igual o menor. El propio
// plan de MIS-15 anticipaba un índice por outcome "cuando exista un
// consumidor real" — este lo es, pero al volumen actual un .collect()
// íntegro sigue dentro de la guía oficial de Convex citada arriba; se
// añadirá el índice si el volumen crece lo suficiente para notarse, no
// antes.
export const getWonSalesSummary = query({
  args: { token: v.string() },
  returns: v.object({ count: v.number(), totalAmountCents: v.number() }),
  handler: async (ctx, args) => {
    await requireUser(ctx, args.token); // lectura: ambos roles, igual que listSaleClosures
    const closures = await ctx.db.query("saleClosures").collect();

    let count = 0;
    let totalAmountCents = 0;
    for (const c of closures) {
      if (c.outcome === "won") {
        count += 1;
        totalAmountCents += c.amountCents;
      }
    }
    return { count, totalAmountCents };
  },
});
```

## `src/app/(app)/(with-nav)/panel/PanelAutoRefresh.tsx` (NUEVO)

```tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Intervalo de refresco automático, en ms. Marta es una sesión de
// navegador DISTINTA a la de Carlos y no dispara ninguna mutation propia —
// a diferencia del resto del repo, donde "tiempo real" se resuelve con
// refresh() (next/cache) tras la propia Server Action del usuario (ver
// PLANS/MIS-16-historial-actividad.md, decisión 5), aquí no hay ninguna
// acción propia que reaccionar. router.refresh() (next/navigation,
// cliente) re-renderiza el árbol de Server Components de la ruta actual
// con datos frescos (fetchQuery se re-ejecuta en el servidor con el token
// de la cookie HttpOnly, que nunca pasa por este componente) sin desmontar
// los Client Components ya vivos — ver decisión 1 de este plan para el ADR
// completo frente a useQuery.
const REFRESH_INTERVAL_MS = 20_000;

// Sin render propio (retorna null): su única función es mantener vivo el
// intervalo mientras /panel esté montado. Se desmonta solo al navegar
// fuera de /panel, limpiando el intervalo vía el cleanup de useEffect.
export function PanelAutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => {
      // Evita refrescar mientras la pestaña/app está en segundo plano
      // (pantalla bloqueada, otra pestaña activa) — no lo pide el AC, pero
      // evita gastar lecturas de Convex sin que nadie las vea.
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [router]);

  return null;
}
```

## `src/app/(app)/(with-nav)/panel/page.tsx` (REESCRIBIR el placeholder)

```tsx
import Link from "next/link";
import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../../convex/_generated/api";
import { getUser } from "@/lib/auth/dal";
import { readSessionToken } from "@/lib/auth/cookie";
import { Badge } from "@/components/ui/feedback/Badge";
import { Card } from "@/components/ui/core/Card";
import { StatusBadge } from "@/components/ui/feedback/StatusBadge";
import { SELECTABLE_STATUSES } from "@/lib/contacts/status";
import { formatCurrencyCents } from "@/lib/contacts/format";
import { PanelAutoRefresh } from "./PanelAutoRefresh";

// Sustituye el placeholder de MIS-9/MIS-18 con el panel real de Marta
// (MIS-17): resumen del pipeline por estado + total de ventas ganadas,
// cada estado pulsable hacia /contactos?status=<estado>. Accesible también
// a Carlos desde el ADR de MIS-18 (ambos roles, solo lectura). Ver
// PLANS/MIS-17-panel-oportunidades.md para el ADR de "tiempo real"
// (PanelAutoRefresh) y el resto de decisiones.
export default async function PanelPage() {
  const user = await getUser();
  const token = await readSessionToken(); // getUser() ya garantiza sesión válida aquí

  const [pipeline, wonSales] = await Promise.all([
    fetchQuery(api.contacts.getPipelineSummary, { token: token! }),
    fetchQuery(api.sales.getWonSalesSummary, { token: token! }),
  ]);

  return (
    <div className="flex flex-1 flex-col" style={{ padding: "16px 20px 24px", gap: 20 }}>
      <PanelAutoRefresh />

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <Badge tone="accent" style={{ alignSelf: "flex-start" }}>
          Supervisora
        </Badge>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)" }}>Hola, {user.name}</h1>
        <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>Estado del negocio de un vistazo.</p>
      </div>

      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>Pipeline por estado</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {SELECTABLE_STATUSES.map((status) => (
            // Sin aria-label manual a propósito (hallazgo real durante la
            // verificación, no cubierto por la auditoría de plan):
            // StatusBadge.jsx es "use client", así que
            // PIPELINE_STATES[status].label no se puede leer desde este
            // Server Component — solo se puede renderizar <StatusBadge>
            // como referencia cliente, no leer sus datos en el servidor
            // (confirmado: Object.keys(PIPELINE_STATES) da [] en el
            // servidor). El nombre accesible del Link se deriva de su
            // contenido visible (el número + el texto del badge ya
            // hidratado), que ya coincide con lo que se ve en pantalla.
            <Link
              key={status}
              href={`/contactos?status=${status}`}
              // minWidth: 0 anula el min-width:auto por defecto de los grid
              // items — hallazgo real con Playwright a 320px (no solo
              // razonado): sin esto, CSS Grid ensancha la columna entera
              // hasta caber la palabra más larga sin partir (p. ej.
              // "conversación", 12 caracteres, en la columna de "En
              // conversación"/"Negociando"/"Perdido"), desbordando el grid
              // completo aunque whiteSpace:"normal" ya permita envolver
              // dentro de cada badge individual. Ver decisión 13 del plan y
              // "Hallazgos reales durante la generación de código".
              style={{ textDecoration: "none", color: "inherit", display: "block", minWidth: 0 }}
            >
              <Card
                interactive
                padding="md"
                style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}
              >
                <span style={{ fontSize: 28, fontWeight: 800, lineHeight: 1, color: "var(--text-primary)" }}>
                  {pipeline[status]}
                </span>
                {/* MIS-17 v2 (corrige M1 de la auditoría de plan): whiteSpace
                    "normal" + maxWidth 100% anulan el nowrap por defecto de
                    StatusBadge — "Propuesta enviada" (la etiqueta más larga)
                    envuelve a 2 líneas en vez de desbordar la tarjeta en
                    320-375px. boxSizing "border-box" explícito y defensivo:
                    Tailwind Preflight (src/app/globals.css) ya lo pone
                    global, pero se fija aquí para no depender de eso. Ver
                    decisión 13 del plan. */}
                <StatusBadge
                  state={status}
                  style={{
                    alignSelf: "flex-start",
                    whiteSpace: "normal",
                    maxWidth: "100%",
                    boxSizing: "border-box",
                  }}
                />
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>Ventas ganadas</h2>
        <Card padding="md" style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 28, fontWeight: 800, lineHeight: 1, color: "var(--text-primary)" }}>
              {wonSales.count}
            </span>
            <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
              {wonSales.count === 1 ? "venta cerrada" : "ventas cerradas"}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 28, fontWeight: 800, lineHeight: 1, color: "var(--status-won-fg)" }}>
              {formatCurrencyCents(wonSales.totalAmountCents)}
            </span>
            <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>importe total</span>
          </div>
        </Card>
      </section>
    </div>
  );
}
```

Nota de tipos: `pipeline[status]` compila sin cast — `status` es `Exclude<ContactStatus, "inactive">` (tipo de `SELECTABLE_STATUSES`), subconjunto exacto de las claves de `pipeline` (`v.object({lead,...,lost})`, 6 claves idénticas); `<StatusBadge state={status} />` acepta el mismo subconjunto como `PipelineState` (7 literales, del cual estos 6 son subconjunto estructural). Un estado con 0 contactos sigue siendo pulsable a propósito: el AC no distingue "estado sin contactos" como no-interactivo, y lleva a un estado vacío ya diseñado en `ContactList` (ver más abajo), no a un error.

## `src/app/(app)/(with-nav)/contactos/page.tsx` (EDITAR)

```diff
 import { fetchQuery } from "convex/nextjs";
 import { api } from "../../../../../convex/_generated/api";
 import { getUser } from "@/lib/auth/dal";
 import { readSessionToken } from "@/lib/auth/cookie";
 import { getRequestTime } from "@/lib/request-time";
+import { SELECTABLE_STATUSES } from "@/lib/contacts/status";
+import type { ContactStatus } from "@/lib/contacts/status";
 import { ContactList } from "./ContactList";

-export default async function ContactosPage() {
+// MIS-17: además del filtro de texto ya existente (MIS-9), la lista acepta
+// un filtro de estado inicial vía ?status=<estado> — la forma en que el
+// panel de Marta enlaza a "los contactos en esta fase" (AC: "al pulsar un
+// estado, abre la lista de contactos filtrada por ese estado"). Se valida
+// aquí, en el Server Component, contra SELECTABLE_STATUSES (los mismos 6
+// estados pulsables del panel — "inactive" nunca es destino de enlace
+// válido) y se entrega a ContactList ya tipado; un ?status= manipulado a
+// mano se ignora silenciosamente, sin error.
+export default async function ContactosPage({
+  searchParams,
+}: {
+  searchParams: Promise<{ status?: string }>;
+}) {
   const user = await getUser();
   const token = await readSessionToken();
   const contacts = await fetchQuery(api.contacts.listContacts, { token: token! });
   const now = await getRequestTime(); // capturado una vez, pasado como prop — evita mismatch de hidratación

-  return <ContactList contacts={contacts} now={now} canCreate={user.role === "rep"} />;
+  const { status } = await searchParams;
+  const statusRaw = status ?? "";
+  const initialStatusFilter: ContactStatus | null = SELECTABLE_STATUSES.includes(
+    statusRaw as (typeof SELECTABLE_STATUSES)[number],
+  )
+    ? (statusRaw as (typeof SELECTABLE_STATUSES)[number])
+    : null;
+
+  return (
+    <ContactList
+      // MIS-17 v2 (corrige M2 de la auditoría de plan): key fuerza remount
+      // cuando cambia el filtro resuelto por la URL — necesario porque
+      // BottomNav enlaza a "/contactos" sin query string, y sin esta key
+      // el useState(initialStatusFilter) de ContactList conservaría el
+      // filtro viejo tras ese salto. Ver decisión 14 del plan.
+      key={initialStatusFilter ?? "all"}
+      contacts={contacts}
+      now={now}
+      canCreate={user.role === "rep"}
+      initialStatusFilter={initialStatusFilter}
+    />
+  );
 }
```

## `src/app/(app)/(with-nav)/contactos/ContactList.tsx` (EDITAR)

**Imports** (añadir `useRouter`, `PIPELINE_STATES`, `ContactStatus`):

```diff
 "use client";

 import { useMemo, useState } from "react";
 import Link from "next/link";
+import { useRouter } from "next/navigation";
 import type { FunctionReturnType } from "convex/server";
 import type { api } from "../../../../../convex/_generated/api";
 import { Input } from "@/components/ui/forms/Input";
 import { Avatar } from "@/components/ui/core/Avatar";
-import { StatusBadge } from "@/components/ui/feedback/StatusBadge";
+import { StatusBadge, PIPELINE_STATES } from "@/components/ui/feedback/StatusBadge";
 import { formatRelativeTime } from "@/lib/contacts/format";
+import type { ContactStatus } from "@/lib/contacts/status";
```

**Firma, estado y lógica de filtrado** (combina estado + texto con AND):

```diff
 export function ContactList({
   contacts,
   now,
   canCreate,
+  initialStatusFilter,
 }: {
   contacts: Contact[];
   now: number;
   canCreate: boolean;
+  initialStatusFilter: ContactStatus | null;
 }) {
   const [query, setQuery] = useState("");
+  const [statusFilter, setStatusFilter] = useState<ContactStatus | null>(initialStatusFilter);
+  const router = useRouter();

-  const filtered = useMemo(() => {
-    const q = query.trim();
-    if (!q) return contacts;
-    return contacts.filter((c) => matches(c, q));
-  }, [contacts, query]);
+  const filtered = useMemo(() => {
+    const q = query.trim();
+    return contacts.filter((c) => {
+      if (statusFilter && c.status !== statusFilter) return false;
+      if (q && !matches(c, q)) return false;
+      return true;
+    });
+  }, [contacts, query, statusFilter]);

   const noContactsAtAll = contacts.length === 0;
-  const emptySearch = !noContactsAtAll && query.trim() !== "" && filtered.length === 0;
+  const hasActiveFilters = query.trim() !== "" || statusFilter !== null;
+  const noResults = !noContactsAtAll && hasActiveFilters && filtered.length === 0;
+
+  // Limpia el filtro localmente Y en la URL: si solo se limpiara el estado
+  // local, un F5 posterior volvería a leer ?status=... de la URL y
+  // "resucitaría" el filtro que Marta acababa de quitar — useState solo lee
+  // initialStatusFilter en el montaje inicial, no en renders posteriores.
+  function clearStatusFilter() {
+    setStatusFilter(null);
+    router.replace("/contactos");
+  }
```

**Chip de filtro activo**, insertado justo después del bloque de búsqueda existente (mismo `<div>` sticky del header):

```diff
         <div style={{ position: "relative" }}>
           <Input
             prefix={<SearchIcon />}
             size="sm"
             placeholder="Buscar por nombre o teléfono"
             value={query}
             onChange={(e) => setQuery(e.target.value)}
             aria-label="Buscar contactos"
             style={{ paddingRight: query ? 28 : undefined }}
           />
           {query && (
             <button type="button" onClick={() => setQuery("")} aria-label="Limpiar búsqueda" style={{ ... }}>
               <ClearIcon />
             </button>
           )}
         </div>
+        {statusFilter && (
+          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
+            <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>Filtrado por:</span>
+            <StatusBadge state={statusFilter} />
+            <button
+              type="button"
+              onClick={clearStatusFilter}
+              aria-label="Quitar filtro de estado"
+              style={{
+                display: "flex",
+                alignItems: "center",
+                gap: 4,
+                background: "none",
+                border: "none",
+                cursor: "pointer",
+                padding: 2,
+                color: "var(--text-tertiary)",
+                fontSize: 12,
+              }}
+            >
+              <ClearIcon />
+              Quitar
+            </button>
+          </div>
+        )}
       </div>
```

**Estado vacío** — reemplaza `emptySearch` por `noResults`, mensaje consciente de qué filtro está activo:

```diff
-        {emptySearch && (
+        {noResults && (
           <div
             className="flex flex-col items-center justify-center text-center"
             style={{ height: "100%", padding: "40px 32px", gap: 8 }}
           >
             <p style={{ fontSize: 17, fontWeight: 600, color: "var(--text-primary)" }}>
-              Sin resultados para &quot;{query}&quot;
+              {query.trim()
+                ? `Sin resultados para "${query}"`
+                : statusFilter
+                ? `Sin contactos en "${PIPELINE_STATES[statusFilter].label}"`
+                : "Sin resultados"}
             </p>
-            <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>Prueba con otro nombre o número</p>
+            <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
+              {query.trim() ? "Prueba con otro nombre o número" : "Prueba quitando el filtro de estado"}
+            </p>
           </div>
         )}

-        {!noContactsAtAll && !emptySearch && (
+        {!noContactsAtAll && !noResults && (
           <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
```

(La rama final `"Sin resultados"` es inalcanzable en la práctica — `hasActiveFilters` garantiza que si `query` está vacío, `statusFilter` no lo está — pero se deja por seguridad de tipos, sin aserción `!`, mismo criterio defensivo que el resto del archivo.)

**Sin cambios**: el encabezado `{contacts.length} contactos` (total, no filtrado) se deja intacto a propósito — mismo comportamiento ya aprobado en MIS-9 para el filtro de texto (nunca mostró el conteo filtrado ahí tampoco); cambiarlo solo para el filtro de estado introduciría una inconsistencia nueva entre los dos tipos de filtro, no pedida por el AC.

## Verificación

Ejecutada de verdad, no solo descrita: código instalado como overlay temporal sobre `src/`/`convex/` reales (revertido después, `git checkout`), servidor de dev arrancado, y automatizado con Playwright (Chromium, ya cacheado en el entorno) contra el deployment de dev de Convex — no solo curl/inspección estática.

1. **Tipos y build**: `npx convex dev --once` (sincroniza `getPipelineSummary`/`getWonSalesSummary` a `convex/_generated/api.d.ts`), luego `npx tsc --noEmit`, `npm run lint`, `npm run build` — los tres sin errores (lint: 1 warning preexistente no relacionado).
2. **Manual — números correctos**: login como Marta vía formulario real, `/panel` renderiza `lead:10, talking:0, proposal:1, negotiating:3, won:0, lost:1` y ventas ganadas `count:1, total:1500,50€` — verificado carácter a carácter contra `npx convex data contacts`/`saleClosures` (10 lead + 1 lost + 3 negotiating + 1 proposal = 15 contactos, 1 fila `saleClosures` con `outcome:"won"` y `amountCents:150050`). Coincide exacto.
3. **Interactividad + (v2, corrige M2) filtro "fantasma" del `BottomNav`**: Playwright — clic en tarjeta "Negociando" → `/contactos?status=negotiating`, chip "Filtrado por: Negociando" visible, lista muestra 3 contactos. Clic en la pestaña "Contactos" del `BottomNav` (href sin query string) → URL vuelve a `/contactos` limpia, chip desaparece, lista vuelve a 15 contactos. La `key={initialStatusFilter ?? "all"}` fuerza el remount correctamente.
4. **Combinación de filtros**: cubierto por el diseño (AND en `useMemo`); no reprobado por la auditoría de código, no reverificado aparte en esta ronda.
5. **Tiempo real**: verificado con dos sesiones reales — Marta logueada en Playwright, en `/panel`, sin tocar la pestaña en ningún momento (sin reload ni navegación); "Carlos" ejecuta `npx convex run contacts:changeContactStatus` directamente (mismo efecto que la Server Action, distinta sesión) cambiando un contacto de `lead` a `talking`. Antes: `lead:10, talking:0`. Tras esperar 22s sin interacción: `lead:9, talking:1` — el `PanelAutoRefresh` actualizó los datos por sí solo. Contacto revertido a `lead` después para dejar los datos de prueba como estaban.
6. **Móvil — (v2, corrige M1) overflow a 320/360/375px**: Playwright, `document.documentElement.scrollWidth` vs `clientWidth` en los 3 anchos. Primera pasada (solo `whiteSpace`/`maxWidth`/`boxSizing` de la ronda de GO condicionado): overflow real de 7px a 320px (`scrollWidth 327 > clientWidth 320`), sin overflow a 360/375. Diagnosticado con Playwright elemento a elemento: la columna derecha del grid (En conversación/Negociando/Perdido) se ensanchaba por el `min-width:auto` por defecto de los grid items ante la palabra "conversación" (12 caracteres). **Corregido** añadiendo `minWidth: 0` al `<Link>` y al `<Card>` (ver "Hallazgos reales durante la generación de código" arriba) — reverificado: `scrollWidth === clientWidth` exacto en los 3 anchos, capturas de pantalla confirman el badge envolviendo a 2 líneas sin romper el layout.
7. **Acceso por rol**: login como Carlos (`rep`) → `/panel` sigue siendo accesible (ADR de MIS-18) — verificado por inspección de código (sin guard nuevo añadido), no re-ejecutado en esta ronda.
8. **No regresión de seguridad**: `grep -rn "useQuery" src/` devuelve 0 resultados tras el cambio; ningún Client Component nuevo recibe ni maneja el token de sesión (confirmado además, indirectamente, por el propio hallazgo del punto de "Hallazgos reales" — el problema fue justo lo opuesto, un Server Component intentando leer de un módulo cliente, no al revés).
9. **Caso borde de 0 contactos en un estado**: cubierto en la propia captura de 320px (talking:0, won:0 antes de la mutación de prueba) — tarjetas con 0 se renderizan y son pulsables sin error.

# MIS-256 — Pantalla de Ventas (listado + resumen por periodo)

## Contexto

MIS-256 es la construcción real de la pantalla "Ventas" (proyecto **CRM MEJORAS**), cuyo diseño (MIS-257) ya está auditado con GO condicionado. Hoy las ventas cerradas solo aparecen como un total agregado sin filtrar por periodo en el Panel de Marta (MIS-17); no hay dónde ver el listado individual ni filtrar por mes/trimestre/año.

**Gate de proceso:** la auditoría de MIS-257 dejó abierto si CRM MEJORAS debía mantener el mismo gate estricto que el MVP (plan → auditoría → código → auditoría → instalación) o uno separado. Se decide aquí mantener el mismo gate — este documento es el plan y se queda esperando veredicto de auditoría antes de generar ningún código real.

Investigación previa (2 exploraciones en paralelo del backend y del frontend existentes) confirmó:
- **Sin gap de datos**: `saleClosures` (variante `won` en `convex/schema.ts`) ya guarda `contactId`, `product`, `amountCents`, `purchaseDate`, `closedBy`, `closedAt`. No hace falta migración de esquema.
- **Gap real 1**: no existe ningún helper de límites de mes/trimestre/año — solo `startOfMadridDay` (privado, en `convex/reminders.ts`), a nivel de día.
- **Gap real 2**: no existe ninguna query que filtre `saleClosures` por rango de fechas. `getWonSalesSummary` (`convex/sales.ts`) es global histórico (todo el tiempo, sin filtro), y es lo que hoy alimenta el Panel — se queda como está, sin tocar.
- Frontend: nav inferior (`BottomNav.tsx`), FAB (`AddContactFab.tsx`) y layout (`(with-nav)/layout.tsx`) ya están listos para una 4ª pestaña sin cambios estructurales — cualquier ruta dentro de `(with-nav)` hereda FAB + nav automáticamente, sin gating de rol (confirmado, consistente con MIS-251).

## Decisiones de diseño

- **`purchaseDate` (no `closedAt`) es el campo que determina el periodo.** Es la fecha de venta elegida por el usuario al cerrar, no el timestamp de auditoría de cuándo se pulsó "cerrar". Es también el campo que se muestra como "fecha" en cada fila del listado, y el que ordena la lista (más reciente primero).
- **Nuevos helpers de límite de periodo, en `convex/sales.ts`, no compartidos con `reminders.ts`.** Seguimos la convención ya establecida en el repo (cada archivo de `convex/` es autocontenido; `isValidEpochMs` ya está deliberadamente duplicado en vez de compartido) y replicamos exactamente la técnica de `startOfMadridDay` (`Intl.DateTimeFormat` + `timeZoneName: "shortOffset"`, sin librería de fechas): `startOfMadridMonth`, `startOfMadridQuarter`, `startOfMadridYear`. Mismo criterio de edge-case aceptado que `startOfMadridDay` (~2 días/año de posible desfase de 1h en el cambio de hora, no bloqueante para el MVP).
- **Query nueva `listWonSalesForPeriod`, no se toca `getWonSalesSummary`.** El Panel sigue mostrando su total histórico tal cual (comportamiento sin cambios); la nueva query devuelve `{ count, totalAmountCents, sales: [...] }` para un periodo dado (`"month" | "quarter" | "year"`), reutilizando el mismo patrón de iteración de `getWonSalesSummary` (filtra `outcome === "won"`) pero añadiendo el filtro `purchaseDate >= inicioDelPeriodo`.
- **Sin índice nuevo, scan-and-filter.** Mismo criterio ya aceptado en el repo para `getWonSalesSummary`/`getPipelineSummary` ("añadir índice cuando el volumen lo justifique, no antes"). Para el volumen de este CRM (un solo comercial) no es un problema; se deja anotado como trade-off consciente, no como descuido.
- **Los 3 periodos se piden en paralelo desde el Server Component, no hay refetch al cambiar de pestaña.** `ventas/page.tsx` hace `Promise.all` de `listWonSalesForPeriod` para `"month"`, `"quarter"` y `"year"` en la misma carga, y pasa los 3 datasets a un componente cliente que solo cambia cuál mostrar (estado local, sin red). Sigue el mismo patrón servidor-fetch/cliente-render ya usado en `contactos/page.tsx` + `ContactList.tsx`; evita introducir `useQuery`/`ConvexClientProvider` (no usados hoy en ninguna pantalla de listado) solo para esto.
- **Selector de periodo: control pill nuevo, no el componente `Tabs` existente.** `src/components/ui/navigation/Tabs.jsx` es un estilo de subrayado, visualmente distinto del segmented-control en pastilla ya aprobado en el diseño de MIS-257. Como el diseño de esa pantalla ya pasó auditoría con ese look concreto, se replica tal cual (3 botones dentro de un contenedor con fondo `--color-muted` y una pastilla blanca que se desplaza al botón activo) en vez de forzar el componente `Tabs` existente a un estilo que no tiene.
- **Filas de venta reutilizan `Card interactive` + `Avatar` + `Link`**, exactamente el patrón ya usado en `pendientes/page.tsx` (Card completa envuelta en Link, no solo el nombre) — cliente, producto, importe (con `formatCurrencyCents`) y fecha (con el formateador ya existente en `src/lib/contacts/format.ts`). El `Avatar` reutiliza el componente ya existente (`src/components/ui/core/Avatar.jsx`) en vez de los círculos de color ad hoc que traía la maqueta estática.
- **El total del Panel se vuelve clickable hacia `/ventas`**, sin cambiar la cifra que muestra (sigue siendo el histórico completo vía `getWonSalesSummary`, sin tocar). Se envuelve en `<Link href="/ventas">` + prop `interactive` en el `Card`, mismo patrón ya usado ahí mismo para las tarjetas de estado del pipeline.

## Cambios

### Backend (`convex/sales.ts`)

- Nuevos helpers privados (no exportados): `madridDateParts(ms)` (refactor interno reutilizable), `startOfMadridMonth`, `startOfMadridQuarter`, `startOfMadridYear`.
- Nueva query `listWonSalesForPeriod`:

```ts
export const listWonSalesForPeriod = query({
  args: { token: v.string(), period: v.union(v.literal("month"), v.literal("quarter"), v.literal("year")) },
  returns: v.object({
    count: v.number(),
    totalAmountCents: v.number(),
    sales: v.array(v.object({
      id: v.id("saleClosures"),
      contactId: v.id("contacts"),
      contactName: v.string(),
      product: v.string(),
      amountCents: v.number(),
      purchaseDate: v.number(),
    })),
  }),
  handler: async (ctx, args) => {
    await requireUser(ctx, args.token); // ambos roles, igual que getWonSalesSummary
    const start = periodStart(args.period, Date.now());
    const closures = await ctx.db.query("saleClosures").collect();
    const won = closures.filter(c => c.outcome === "won" && c.purchaseDate >= start);
    won.sort((a, b) => b.purchaseDate - a.purchaseDate);
    const sales = await Promise.all(won.map(async c => {
      const contact = await ctx.db.get(c.contactId);
      return { id: c._id, contactId: c.contactId, contactName: contact?.name ?? "Contacto eliminado", product: c.product, amountCents: c.amountCents, purchaseDate: c.purchaseDate };
    }));
    return { count: won.length, totalAmountCents: won.reduce((s, c) => s + c.amountCents, 0), sales };
  },
});
```

- `getWonSalesSummary`, `closeSale`, `listSaleClosures`: sin cambios.

### Nav y FAB

- `src/components/crm/BottomNav.tsx`: nuevo `VentasIcon` (trending-up, mismo trazo/estilo que los iconos existentes; reutiliza el path ya validado en el diseño de MIS-257) y nueva entrada en `TABS`: `{ href: "/ventas", label: "Ventas", Icon: VentasIcon }`.
- `(with-nav)/layout.tsx`: sin cambios — la nueva ruta hereda FAB y nav por estar dentro del grupo.

### Pantalla nueva

- `src/app/(app)/(with-nav)/ventas/page.tsx` (Server Component): `getUser()` + `readSessionToken()` + `Promise.all` de `listWonSalesForPeriod` para los 3 periodos; pasa los 3 resultados a `SalesList`.
- `src/app/(app)/(with-nav)/ventas/SalesList.tsx` (Client Component): estado local `period`, selector pill (Mes/Trimestre/Año) con subtítulo del rango, cifra protagonista (`formatCurrencyCents`), contador de ventas, listado de `Card interactive` envueltas en `Link href={/contactos/${sale.contactId}}` (avatar, nombre, producto, importe, fecha), estado vacío ("Aún no hay ventas en este periodo").

### Panel (`src/app/(app)/(with-nav)/panel/page.tsx`)

Se envuelve la `Card` de "Ventas ganadas" en `<Link href="/ventas">` + `interactive`, mismo patrón que las tarjetas de pipeline ya presentes en el archivo. Sin cambios en los datos que muestra.

## Archivos afectados

| Archivo | Tipo |
|---|---|
| `convex/sales.ts` | Editar (helpers de periodo + `listWonSalesForPeriod`) |
| `src/components/crm/BottomNav.tsx` | Editar (pestaña Ventas + icono) |
| `src/app/(app)/(with-nav)/ventas/page.tsx` | Nuevo |
| `src/app/(app)/(with-nav)/ventas/SalesList.tsx` | Nuevo |
| `src/app/(app)/(with-nav)/panel/page.tsx` | Editar (Card clicable hacia /ventas) |

## Verificación

1. `tsc --noEmit` / `eslint` / `npm run build`.
2. Manual, como Carlos y como Marta (mismo acceso): entrar a Ventas desde la pestaña y desde el total del Panel; cambiar Mes/Trimestre/Año y comprobar que cifra, contador y listado cambian sin recargar; tocar una venta y confirmar que abre la ficha del contacto correcto.
3. e2e: extender la suite existente (seed de una venta cerrada vía `api.sales.closeSale` con `ConvexHttpClient`, igual que el resto de specs siembran datos saltándose la UI) con un caso que cubra navegación Panel→Ventas, cambio de periodo y navegación Ventas→ficha de contacto. Añadir viewport 320px para confirmar que el selector pill + las 4 pestañas de nav no desbordan (mismo tipo de comprobación ya exigido en auditorías anteriores de tarjetas con varios elementos).
4. `npm run test:e2e` completo antes de cerrar.

**Resultado real (código generado en `CODIGO/MIS-256-pantalla-de-ventas/`, verificado por overlay temporal sobre el repo real y revertido después):**
- `tsc --noEmit`, `eslint`, `npm run build`: sin errores.
- Manual con Playwright (Carlos): Panel→Ventas y nav→Ventas OK, selector Mes/Trimestre/Año recalcula cifra/contador/listado sin recargar, tocar una venta abre la ficha correcta, sin overflow horizontal en 320px.
- e2e: 3 tests nuevos añadidos a `e2e/edge-cases.spec.ts` (filtro de periodo + navegación a ficha; acceso desde el total del Panel; no-overflow en 320px con nav de 4 pestañas + selector).
- Suite completa: **21/21 tests pasan** (ambos roles, sin regresiones).
- Convex dev (`dutiful-mole-111`) resincronizado con el código de `main` tras la verificación — el deployment de dev NO tiene `listWonSalesForPeriod` instalado ahora mismo, solo el repo en `CODIGO/`.

No se actualiza `PLANS/README.md` ni `CODIGO/README.md` (scopeados a "proyecto CRM - MVP"; MIS-256 es de CRM MEJORAS, mismo criterio ya aplicado en MIS-257).

## Estado

**GO CONDICIONADO** (auditoría, primera ronda). Sin blockers ni majors. Condiciones antes de instalar: validar tipos/build/e2e y comprobar móvil 320px (nav de 4 pestañas + selector de periodo).

Sugerencias no bloqueantes aplicadas al generar el código:
- **Límite superior del periodo:** `listWonSalesForPeriod` filtra también `purchaseDate <= Date.now()` (además de `>= inicio del periodo`), para no arrastrar ventas con fecha futura si llegaran a existir por datos corruptos. Decisión fijada: el periodo es "desde el inicio del periodo actual hasta ahora", no un rango calendario completo con límite superior implícito en el futuro.
- **Fallback `contact?.name`:** se mantiene tal cual (aceptado por la auditoría); no hay `deleteContact` hoy, así que el caso "contacto eliminado" es solo defensivo, no alcanzable por UI normal.
- **Formato de importes largos en móvil:** se verifica explícitamente en el paso de verificación 320px que `formatCurrencyCents` no desborda con importes de varias cifras.

Deuda enviada a follow-up (no se aborda en esta tarea): índice `by_outcome_purchaseDate` si el volumen de ventas crece; estado de periodo compartible por URL (`/ventas?period=quarter`) si el producto lo pide más adelante.

**Auditoría de código, ronda 1: NO-GO.** Major (M1) en `e2e/edge-cases.spec.ts`: el test de filtro por periodo usaba `new Date(year, 1, 15)` (15 de febrero fijo) como fecha "de un periodo anterior" — inestable si el test se ejecuta en enero/febrero (esa fecha podía caer en el mes actual, o incluso ser futura, dado que la query filtra `purchaseDate <= ahora`). Corregido: la fecha anterior se calcula ahora como `monthStart - 1` (1ms antes del inicio del mes en curso), matemáticamente anterior al mes en curso en cualquier fecha de ejecución; la aserción de "Año" comprueba en tiempo real si esa fecha sigue cayendo en el mismo año en vez de asumirlo (solo enero es la excepción posible, por aritmética de calendario, no por implementación). Re-verificado con overlay completo + suite e2e (21/21 pasan) tras el fix.

Sugerencias no bloqueantes de la ronda 1 (aceptadas, sin acción): `await ctx.db.get` dentro del bucle de `listWonSalesForPeriod` — follow-up si el volumen crece; `fontSize:40` en el importe grande de `SalesList` — verificado visualmente con importes normales (3.017,20 €), sin desbordar.

**Auditoría de código, ronda 2: NO-GO.** Major nuevo (M2, marcado como "hallazgo omitido por la auditoría anterior"): `startOfMadridMonth`/`Quarter`/`Year` calculaban el offset horario de Madrid a partir de "ahora" (el instante de la consulta) y lo reutilizaban para construir la frontera del periodo, que puede caer semanas o meses antes, al otro lado de un cambio de hora — ejemplo concreto de la auditoría: consultado en noviembre/diciembre (CET, GMT+1), el inicio de Q4 (1 de octubre, todavía CEST, GMT+2) se calculaba con el offset equivocado, desplazando la frontera 1 hora y excluyendo ventas legítimas del primer día del trimestre. Bug real, no solo un caso de borde: para el año en curso, esto afecta a la mayoría de abril-octubre (offset CEST reutilizado para calcular la frontera de 1 de enero, que es CET); para el trimestre, afecta a la mayoría de Q1 y Q4.

**Corregido:** los helpers ahora resuelven el offset de Madrid en el instante de la propia frontera (candidato ingenuo year/month/día-a-medianoche-como-UTC → offset real de Madrid en ESE candidato → aplicar), no en el instante de la consulta. Verificado con un script Node aparte reproduciendo exactamente el ejemplo de la auditoría: con el fix, el inicio de Q4 consultado en noviembre da `2026-09-30T22:00:00Z` (correcto), antes daba `2026-09-30T23:00:00Z` (incorrecto, coincide con el diagnóstico de la auditoría).

También se cerraron las dos sugerencias no bloqueantes baratas de esa misma ronda: cobertura e2e real de Trimestre (antes solo Mes/Año tenían una venta que cambiara de visibilidad al cambiar de pestaña) y selector más robusto en el test del Panel (`hasText:"importe total"` en vez de `"ventas cerradas"`, inmune a la variación singular/plural).

Deuda aceptada (no cerrada en esta tarea, explicada en `CODIGO-COMPLETO.md`): no hay infraestructura de mock de reloj para el `Date.now()` del lado servidor en la suite e2e actual, así que el escenario exacto de "cambio de hora" no tiene una prueba de regresión automatizada en CI — solo el script Node de verificación manual descrito arriba.

Re-verificado con overlay completo (ronda 3): tsc/eslint/build limpios, suite e2e completa 21/21, sin regresiones.

**Auditoría de código, ronda 3: GO CONDICIONADO.** Sin Blockers ni Majors abiertos. M1 y M2 confirmados resueltos por la auditoría. Condición: mantener los gates (tsc/eslint/build/e2e) en verde sobre el estado final real al instalar — se cumple en la instalación (ver más abajo).

Sugerencias no bloqueantes (aceptadas como deuda, sin acción en esta tarea): extraer `periodStart`/helpers a una unidad testeable con test unitario permanente (hoy solo verificado con script Node externo, no integrado en CI); fijar `TZ=Europe/Madrid` en CI si algún día corriera en otro huso horario (hoy el entorno declarado ya es Madrid, no bloquea).

**Instalado en la rama `feature/mis-256-pantalla-de-ventas`, PR #38.**

**Ronda 4 — fallo real en CI, no detectado en verificación local.** El job `e2e` de GitHub Actions falló tras el push del PR: el test de filtro por periodo calculaba `monthStart`/`quarterStart` con `new Date(year, month, 1)`, que usa el huso horario LOCAL del proceso que ejecuta el test. La verificación local de esta tarea se hizo en un entorno Europe/Madrid (mismo huso que asume el backend), por eso pasó siempre en local — pero los runners de GitHub Actions corren en UTC por defecto, con hasta 2h de diferencia en verano respecto a Madrid, suficiente para que la venta "de periodo anterior" cayera del lado equivocado de la frontera real y el test fallara. Es exactamente el tipo de fragilidad que la sugerencia "Baja" de la ronda 3 ya advertía, solo que su premisa ("el entorno declarado es Madrid") no se cumplía en CI.

Corregido de raíz: el test ya no construye fechas de calendario locales — usa desplazamientos absolutos en días desde `Date.now()` (32 días para garantizar mes civil anterior, 95 días para trimestre civil anterior, ambos mayores que la duración máxima posible de esos periodos), válidos en cualquier huso horario del runner. Verificado forzando `TZ=UTC` localmente (reproduce las condiciones exactas de CI): el test aislado pasa 2/2, y la suite completa pasa 20/21 — el único fallo (`full-flow.spec.ts`, test preexistente sin relación con esta tarea) se diagnosticó como ruido por acumulación de datos de prueba en el deployment de dev compartido (157+ contactos), el mismo patrón ya visto y limpiado una vez antes en esta sesión (MIS-254) — no un bug de código, y ese mismo test SÍ pasó en el CI real del PR.

Ver `CODIGO/MIS-256-pantalla-de-ventas/CODIGO-COMPLETO.md` para el histórico completo de las 4 rondas.

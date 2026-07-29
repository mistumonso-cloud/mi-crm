# CODIGO-COMPLETO — MIS-256: Pantalla de Ventas (listado + resumen por periodo)

Código consolidado para copiar/pegar en auditoría. Plan: `PLANS/MIS-256-pantalla-de-ventas.md`.

Resumen de cambios:
- `convex/sales.ts` — nuevos helpers de límite de periodo + nueva query `listWonSalesForPeriod`. `getWonSalesSummary`/`closeSale`/`listSaleClosures` sin cambios de comportamiento (solo se repite el archivo completo por contexto).
- `src/components/crm/BottomNav.tsx` — 4ª pestaña "Ventas" + icono nuevo.
- `src/app/(app)/(with-nav)/ventas/page.tsx` — nuevo, Server Component.
- `src/app/(app)/(with-nav)/ventas/SalesList.tsx` — nuevo, Client Component.
- `src/app/(app)/(with-nav)/panel/page.tsx` — la tarjeta "Ventas ganadas" se vuelve clicable hacia `/ventas` (sin cambiar los datos que muestra).
- `e2e/edge-cases.spec.ts` — 3 tests nuevos al final del archivo; el resto del archivo se repite tal cual, sin cambios, por contexto.

**Ronda 2 (corrige NO-GO — test inestable):** el test de filtro por periodo usaba `new Date(year, 1, 15)` (15 de febrero fijo) como fecha "de un periodo anterior" — inestable en ejecuciones de enero/febrero. Corregido: la fecha anterior ahora se calcula como `monthStart - 1` (1ms antes del inicio del mes en curso), matemáticamente anterior al mes en curso SIEMPRE; la aserción de "Año" comprueba en tiempo real si esa fecha sigue en el mismo año (única excepción posible: enero, por aritmética de calendario) en vez de asumirlo.

**Ronda 3 (corrige NO-GO — Major M2, offset de Madrid incorrecto en fronteras de periodo):** `startOfMadridMonth`/`Quarter`/`Year` calculaban el offset horario de Madrid a partir de "ahora" (el instante de la consulta) y lo reutilizaban para construir la frontera del periodo (que puede caer semanas o meses antes, al otro lado de un cambio de hora) — ej. consultado en noviembre/diciembre (CET, GMT+1), el inicio de Q4 (1 de octubre, todavía CEST, GMT+2) se calculaba con el offset equivocado, desplazando la frontera 1 hora y excluyendo ventas legítimas del primer día del trimestre. **Corregido:** los helpers ahora resuelven el offset de Madrid EN EL INSTANTE DE LA PROPIA FRONTERA (construyen un candidato ingenuo year/month/day-a-medianoche-como-UTC, buscan el offset real de Madrid en ese candidato, y lo aplican), no en el instante de la consulta. Verificado con un script aparte reproduciendo exactamente el ejemplo de la auditoría (consulta en noviembre, frontera de Q4): con el fix, `startOfMadridQuarter` da `2026-09-30T22:00:00Z` (correcto, antes daba `2026-09-30T23:00:00Z`, incorrecto). También se añadió cobertura e2e real de Trimestre (antes solo Mes/Año tenían una venta que cambiara de visibilidad al cambiar de pestaña) y se cambió el selector frágil del test de Panel (`hasText:"ventas cerradas"` → `hasText:"importe total"`, inmune a la variación singular/plural del contador).

Deuda aceptada, no cerrada en esta tarea: no hay infraestructura de mock de reloj para el `Date.now()` del lado servidor de Convex en la suite e2e actual (solo Playwright contra el deployment real), así que no se puede simular en un test end-to-end el escenario exacto de "consulta justo después de un cambio de hora, frontera justo antes" — la corrección se verificó con un script Node aparte reproduciendo la aritmética exacta del caso de la auditoría (ver arriba), no con una prueba de regresión automatizada en CI. Añadir esa infraestructura de mock de tiempo, si se necesita, es trabajo de follow-up fuera del alcance de este ticket.

**Verificación ya realizada** (overlay real sobre el repo, revertido tras verificar, tres rondas):
- `tsc --noEmit`, `eslint`, `npm run build`: sin errores.
- `npx convex dev --once` + servidor real + Playwright: navegación Panel→Ventas→ficha OK, selector Mes/Trimestre/Año recalcula bien (las tres pestañas, cada una con una venta que cambia de visibilidad), sin overflow horizontal en 320px (`scrollWidth === clientWidth`).
- Suite e2e completa (21 tests, ambos roles): **21 passed** en las tres rondas, sin regresiones en el resto.
- Convex dev resincronizado con el código de `main` tras cada verificación.

---

## `convex/sales.ts`

```ts
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUser } from "./lib/authz";

// "Producto o servicio vendido" y "motivo de pérdida" son ambos texto libre
// corto — mismo orden de magnitud que REASON_MAX en convex/reminders.ts (no
// TEXT_MAX de notes.ts, 2000, pensado para resúmenes largos).
const PRODUCT_MAX = 200;
const LOSS_REASON_MAX = 200;

// Duplicada de src/lib/contacts/actions.ts (closeSaleAction) a propósito —
// mismo motivo que isValidEpochMs en convex/reminders.ts: esta mutation es
// un endpoint público invocable directamente con un token válido, sin pasar
// por la Server Action.
function isValidEpochMs(value: number): boolean {
  return (
    Number.isFinite(value) &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    !Number.isNaN(new Date(value).getTime())
  );
}

// Importe en céntimos de euro — entero positivo. No se reutiliza
// isValidEpochMs: un importe no es una fecha, no tiene sentido comprobarlo
// contra `new Date(...)`.
function isValidAmountCents(value: number): boolean {
  return Number.isFinite(value) && Number.isSafeInteger(value) && value > 0;
}

const MADRID_TZ = "Europe/Madrid";

// Offset UTC (en ms) vigente en Madrid en el instante `ms` — vía
// Intl.DateTimeFormat con timeZoneName:"shortOffset", igual que
// startOfMadridDay en convex/reminders.ts.
function madridOffsetMsAt(ms: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MADRID_TZ,
    hour: "2-digit",
    hourCycle: "h23",
    timeZoneName: "shortOffset",
  }).formatToParts(new Date(ms));
  // "shortOffset" produce "GMT+1" o "GMT+2" (Madrid es siempre una hora
  // entera de offset, nunca fracciones).
  const offsetMatch = parts.find((p) => p.type === "timeZoneName")?.value.match(/GMT([+-]\d+)/);
  const offsetHours = offsetMatch ? Number(offsetMatch[1]) : 1; // fallback CET si el runtime no expone shortOffset
  return offsetHours * 60 * 60 * 1000;
}

// Año/mes/día civiles en Europe/Madrid del instante `ms`.
function madridCivilDate(ms: number): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MADRID_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { year: get("year"), month: get("month"), day: get("day") };
}

// MIS-256 (corrige Major de la auditoría de código, ronda 2): epoch ms de
// la medianoche Europe/Madrid del día civil (year, month, day) dado —
// resuelve el offset vigente EN ESE INSTANTE, no en el instante desde el
// que se llama. La versión anterior (madridDateParts) calculaba el offset
// a partir de `ms` (normalmente "ahora") y lo reutilizaba para construir
// la frontera de mes/trimestre/año, que puede caer semanas o meses antes,
// al otro lado de un cambio de hora — ej. consultado en noviembre/
// diciembre (CET, GMT+1), el inicio de Q4 (1 de octubre, todavía CEST,
// GMT+2) se calculaba con el offset equivocado, desplazando la frontera
// 1 hora y excluyendo ventas legítimas del primer día del trimestre.
//
// Aquí se construye primero un candidato ingenuo (year/month/day a
// medianoche, tratado como UTC) y se busca el offset real de Madrid EN ESE
// candidato — los cambios de hora ocurren de a las 2-3 de la madrugada
// hora local, nunca en el instante de medianoche resultante de una sola
// pasada, así que esto basta (mismo tipo de margen ya aceptado en
// startOfMadridDay para los ~2 días/año de cambio de hora, no bloqueante
// para este MVP).
function madridMidnightUtc(year: number, month: number, day: number): number {
  const naiveUtcGuess = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  return naiveUtcGuess - madridOffsetMsAt(naiveUtcGuess);
}

// Medianoche del día 1 del mes civil (Europe/Madrid) que contiene `ms`.
function startOfMadridMonth(ms: number): number {
  const { year, month } = madridCivilDate(ms);
  return madridMidnightUtc(year, month, 1);
}

// Medianoche del día 1 del primer mes del trimestre civil (Europe/Madrid)
// que contiene `ms` — trimestres naturales (ene-mar, abr-jun, jul-sep,
// oct-dic), no "últimos 3 meses".
function startOfMadridQuarter(ms: number): number {
  const { year, month } = madridCivilDate(ms);
  const quarterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
  return madridMidnightUtc(year, quarterStartMonth, 1);
}

// Medianoche del 1 de enero del año civil (Europe/Madrid) que contiene `ms`.
function startOfMadridYear(ms: number): number {
  const { year } = madridCivilDate(ms);
  return madridMidnightUtc(year, 1, 1);
}

function periodStart(period: "month" | "quarter" | "year", ms: number): number {
  if (period === "month") return startOfMadridMonth(ms);
  if (period === "quarter") return startOfMadridQuarter(ms);
  return startOfMadridYear(ms);
}

// MIS-15: cierra una oportunidad de venta (ganada o perdida) en un solo
// paso — inserta el registro de cierre, registra el cambio de estado (ver
// nota más abajo) y actualiza contacts.status, idéntico en estructura a
// changeContactStatus (convex/contacts.ts), pero con validación de campos
// adicional según outcome.
export const closeSale = mutation({
  args: {
    token: v.string(),
    contactId: v.string(), // v.string(), no v.id("contacts"): mismo motivo que getContact.args.id
    outcome: v.union(v.literal("won"), v.literal("lost")),
    // Presentes solo si outcome === "won" (ver validación cruzada en el
    // handler). A nivel de args se dejan opcionales porque Convex valida
    // los argumentos de una function como un objeto plano, no como una
    // unión discriminada de firmas — la tabla saleClosures sí modela el
    // documento persistido como unión discriminada real (ver
    // convex/schema.ts); aquí solo el shape de ENTRADA es más laxo.
    product: v.optional(v.string()),
    amountCents: v.optional(v.number()),
    purchaseDate: v.optional(v.number()),
    // Presente solo si outcome === "lost"
    lossReason: v.optional(v.string()),
  },
  returns: v.union(
    v.object({ success: v.literal(true) }),
    v.object({
      success: v.literal(false),
      error: v.string(),
      field: v.optional(
        v.union(
          v.literal("contactId"),
          v.literal("product"),
          v.literal("amountCents"),
          v.literal("purchaseDate"),
          v.literal("lossReason"),
        ),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    // MIS-251 (reapertura): revierte explícitamente el ADR de MIS-18 (PLANS/
    // MIS-18-navegacion-principal.md, "Qué NO cambia" — "cierre de venta en
    // MIS-15... sigue debiendo llamar [requireRole] como primera línea, sin
    // excepción"). Decisión de negocio confirmada por el usuario: Marta
    // conserva acceso de escritura completo, igual que Carlos. Ver PLANS/
    // MIS-251-rol-supervision-marta.md, sección "Decisión fijada".
    const user = await requireUser(ctx, args.token);

    const contactId = ctx.db.normalizeId("contacts", args.contactId);
    if (!contactId) {
      return { success: false as const, error: "Contacto no encontrado", field: "contactId" as const };
    }
    const contact = await ctx.db.get(contactId);
    if (!contact) {
      return { success: false as const, error: "Contacto no encontrado", field: "contactId" as const };
    }

    // Un contacto ya cerrado (won/lost) no puede volver a cerrarse por esta
    // vía — error controlado, mismo criterio que el no-op de
    // changeContactStatus. Nota: SÍ es posible reabrir un contacto cerrado
    // vía "Cambiar estado" (MIS-14) y cerrarlo de nuevo aquí después — eso
    // generaría una segunda fila en saleClosures para el mismo contacto,
    // intencionalmente (ver PLANS/MIS-15-registro-cierre-venta.md, decisión
    // 6 y "Puntos abiertos").
    if (contact.status === "won" || contact.status === "lost") {
      return {
        success: false as const,
        error: "Este contacto ya tiene una venta cerrada",
        field: "contactId" as const,
      };
    }

    const closedAt = Date.now();

    if (args.outcome === "won") {
      const product = (args.product ?? "").trim();
      if (!product) {
        return { success: false as const, error: "El producto o servicio es obligatorio", field: "product" as const };
      }
      if (product.length > PRODUCT_MAX) {
        return {
          success: false as const,
          error: `El producto no puede superar ${PRODUCT_MAX} caracteres`,
          field: "product" as const,
        };
      }

      const amountCents = args.amountCents ?? NaN;
      if (!isValidAmountCents(amountCents)) {
        return {
          success: false as const,
          error: "El importe debe ser un número positivo",
          field: "amountCents" as const,
        };
      }

      const purchaseDate = args.purchaseDate ?? NaN;
      if (!isValidEpochMs(purchaseDate)) {
        return { success: false as const, error: "Fecha de compra inválida", field: "purchaseDate" as const };
      }

      await ctx.db.insert("saleClosures", {
        contactId,
        outcome: "won" as const,
        product,
        amountCents,
        purchaseDate,
        closedBy: user.id,
        closedAt,
      });
    } else {
      const lossReason = (args.lossReason ?? "").trim();
      if (!lossReason) {
        return { success: false as const, error: "El motivo de pérdida es obligatorio", field: "lossReason" as const };
      }
      if (lossReason.length > LOSS_REASON_MAX) {
        return {
          success: false as const,
          error: `El motivo no puede superar ${LOSS_REASON_MAX} caracteres`,
          field: "lossReason" as const,
        };
      }

      await ctx.db.insert("saleClosures", {
        contactId,
        outcome: "lost" as const,
        lossReason,
        closedBy: user.id,
        closedAt,
      });
    }

    // MIS-15 v2 (respuesta a auditoría, major 2): todo cambio de
    // contacts.status debe quedar registrado en statusChanges — invariante
    // establecido por MIS-14 (ver changeContactStatus en
    // convex/contacts.ts). closeSale también cambia el estado (a "won" o
    // "lost"), así que también debe insertar aquí, con el mismo closedAt
    // que la fila de saleClosures de arriba — ambas filas del mismo cierre
    // quedan correlacionadas por timestamp. Efecto: cerrar una venta
    // produce DOS entradas de historial (Cambio de estado + Venta
    // ganada/perdida), información distinta y complementaria.
    await ctx.db.insert("statusChanges", {
      contactId,
      fromStatus: contact.status,
      toStatus: args.outcome,
      changedBy: user.id,
      changedAt: closedAt,
    });

    // args.outcome ya es exactamente "won" | "lost" — subconjunto directo
    // del v.union de 7 literales de contacts.status, así que esta
    // asignación compila bajo strict:true SIN cast (a diferencia del cast
    // necesario en changeContactStatus para CHANGEABLE_STATUSES, que era
    // subconjunto de una unión más ancha con valores ilegítimos como
    // "inactive" — aquí no existe ese problema porque el validador de
    // argumentos ya son exactamente los dos valores legítimos).
    await ctx.db.patch(contactId, { status: args.outcome });

    return { success: true as const };
  },
});

// Historial de cierres de venta de un contacto, para la ficha (MIS-15) — un
// contacto puede tener más de una fila (ver decisión 6 del plan). Mismo
// patrón que listStatusChanges en convex/contacts.ts.
export const listSaleClosures = query({
  args: { token: v.string(), contactId: v.string() },
  returns: v.array(
    v.union(
      v.object({
        _id: v.id("saleClosures"),
        outcome: v.literal("won"),
        product: v.string(),
        amountCents: v.number(),
        purchaseDate: v.number(),
        closedByName: v.string(),
        closedAt: v.number(),
      }),
      v.object({
        _id: v.id("saleClosures"),
        outcome: v.literal("lost"),
        lossReason: v.string(),
        closedByName: v.string(),
        closedAt: v.number(),
      }),
    ),
  ),
  handler: async (ctx, args) => {
    await requireUser(ctx, args.token); // lectura: ambos roles, igual que listStatusChanges/listNotes
    const contactId = ctx.db.normalizeId("contacts", args.contactId);
    if (!contactId) return []; // ID inválido: page.tsx ya maneja "no encontrado" vía getContact

    const closures = await ctx.db
      .query("saleClosures")
      .withIndex("by_contact", (q) => q.eq("contactId", contactId))
      .order("desc")
      .collect();

    return Promise.all(
      closures.map(async (c) => {
        const closer = await ctx.db.get(c.closedBy);
        const closedByName = closer?.name ?? "—"; // defensivo: usuario borrado, caso no esperado hoy — mismo fallback que notes.ts/reminders.ts

        if (c.outcome === "won") {
          return {
            _id: c._id,
            outcome: "won" as const,
            product: c.product,
            amountCents: c.amountCents,
            purchaseDate: c.purchaseDate,
            closedByName,
            closedAt: c.closedAt,
          };
        }
        return {
          _id: c._id,
          outcome: "lost" as const,
          lossReason: c.lossReason,
          closedByName,
          closedAt: c.closedAt,
        };
      }),
    );
  },
});

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
//
// MIS-256: histórico completo, SIN filtro de periodo a propósito — sigue
// alimentando el total del Panel tal cual (comportamiento sin cambios). La
// pantalla Ventas usa una query nueva (listWonSalesForPeriod, abajo) porque
// ninguna query existente admitía rango de fechas.
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

// MIS-256: listado + resumen de ventas ganadas de un periodo (mes/trimestre/
// año en curso, Europe/Madrid), para la pantalla Ventas. purchaseDate (no
// closedAt) es el campo que determina el periodo: es la fecha de venta
// elegida por el usuario al cerrar, no el timestamp de auditoría de cuándo
// se pulsó "cerrar" — es también el campo que se muestra como "fecha" en
// cada fila y el que ordena la lista (más reciente primero).
//
// Filtra también purchaseDate <= ahora (sugerencia no bloqueante de la
// auditoría de plan): el periodo es "desde el inicio del periodo actual
// hasta ahora", no un rango calendario completo con límite superior
// implícito en el futuro — evita arrastrar ventas con fecha futura si
// llegaran a existir por datos corruptos (closeSale no las produce por UI
// normal).
//
// Full table scan sin índice — mismo criterio ya aceptado en
// getWonSalesSummary/getPipelineSummary (añadir índice cuando el volumen lo
// justifique, no antes; deuda de follow-up si el volumen de ventas crece:
// índice por outcome/purchaseDate).
export const listWonSalesForPeriod = query({
  args: {
    token: v.string(),
    period: v.union(v.literal("month"), v.literal("quarter"), v.literal("year")),
  },
  returns: v.object({
    count: v.number(),
    totalAmountCents: v.number(),
    sales: v.array(
      v.object({
        id: v.id("saleClosures"),
        contactId: v.id("contacts"),
        contactName: v.string(),
        product: v.string(),
        amountCents: v.number(),
        purchaseDate: v.number(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    await requireUser(ctx, args.token); // lectura: ambos roles, igual que getWonSalesSummary

    const now = Date.now();
    const start = periodStart(args.period, now);

    const closures = await ctx.db.query("saleClosures").collect();

    let count = 0;
    let totalAmountCents = 0;
    const sales: Array<{
      id: (typeof closures)[number]["_id"];
      contactId: (typeof closures)[number]["contactId"];
      contactName: string;
      product: string;
      amountCents: number;
      purchaseDate: number;
    }> = [];

    for (const c of closures) {
      if (c.outcome !== "won" || c.purchaseDate < start || c.purchaseDate > now) continue;
      count += 1;
      totalAmountCents += c.amountCents;
      const contact = await ctx.db.get(c.contactId);
      sales.push({
        id: c._id,
        contactId: c.contactId,
        contactName: contact?.name ?? "Contacto eliminado", // defensivo: no hay deleteContact hoy, caso no alcanzable por UI normal
        product: c.product,
        amountCents: c.amountCents,
        purchaseDate: c.purchaseDate,
      });
    }

    sales.sort((a, b) => b.purchaseDate - a.purchaseDate); // más reciente primero

    return { count, totalAmountCents, sales };
  },
});

```

---

## `src/components/crm/BottomNav.tsx`

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge } from "@/components/ui/feedback/Badge";

// MIS-256: 4ª pestaña "Ventas", añadida al final del array — sin gating de
// rol (consistente con MIS-251, disponible para Carlos y Marta por igual).
const TABS = [
  { href: "/pendientes", label: "Pendientes", Icon: ClockIcon },
  { href: "/contactos", label: "Contactos", Icon: ContactsIcon },
  { href: "/panel", label: "Panel", Icon: PanelIcon },
  { href: "/ventas", label: "Ventas", Icon: VentasIcon },
];

// dueTodayCount (MIS-12): recordatorios de seguimiento vencidos o de hoy,
// vía convex/reminders.ts::countDueToday, resuelto por
// (with-nav)/layout.tsx — la "notificación in-app de pendientes de hoy"
// que exige el AC del ticket. No existe ningún otro mecanismo de
// toast/push en el repo (ver PLANS/MIS-12-recordatorio-proximo-contacto.md,
// Contexto, decisión 3): un badge persistente y visible en cada
// navegación cumple el requisito del MVP sin infraestructura de push.
export function BottomNav({ dueTodayCount = 0 }: { dueTodayCount?: number }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navegación principal"
      style={{
        position: "fixed",
        insetInline: 0,
        bottom: 0,
        height: "calc(72px + env(safe-area-inset-bottom))",
        // boxSizing + paddingBottom (en vez de sumar el safe-area solo a la
        // altura) deja exactamente 72px de caja de contenido arriba del
        // padding, para que el centrado no desplace iconos/labels hacia la
        // zona insegura del home indicator en iPhones con notch.
        boxSizing: "border-box",
        paddingLeft: 4,
        paddingRight: 4,
        paddingTop: 0,
        paddingBottom: "env(safe-area-inset-bottom)",
        background: "var(--color-surface)",
        borderTop: "1px solid var(--color-border)",
        display: "flex",
        alignItems: "stretch",
        zIndex: 10,
      }}
    >
      {TABS.map(({ href, label, Icon }) => {
        const active = pathname === href;
        const showBadge = href === "/pendientes" && dueTodayCount > 0;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              textDecoration: "none",
            }}
          >
            <span
              style={{
                position: "relative",
                width: 40,
                height: 30,
                borderRadius: "var(--radius-full)",
                background: active ? "var(--color-accent-tint)" : "transparent",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "background-color .18s ease-out",
              }}
            >
              <Icon stroke={active ? "var(--color-accent)" : "var(--text-tertiary)"} />
              {showBadge && (
                <Badge
                  tone="danger"
                  aria-label={`${dueTodayCount} seguimiento${dueTodayCount === 1 ? "" : "s"} pendiente${dueTodayCount === 1 ? "" : "s"} para hoy`}
                  style={{
                    position: "absolute",
                    top: -2,
                    right: -2,
                    minWidth: 16,
                    height: 16,
                    padding: "0 4px",
                    fontSize: 10,
                    justifyContent: "center",
                  }}
                >
                  {dueTodayCount > 9 ? "9+" : dueTodayCount}
                </Badge>
              )}
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: active ? 600 : 500,
                color: active ? "var(--color-accent)" : "var(--text-tertiary)",
              }}
            >
              {label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

function ClockIcon({ stroke }: { stroke: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function ContactsIcon({ stroke }: { stroke: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function PanelIcon({ stroke }: { stroke: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}

// MIS-256: trending-up — mismo path ya usado (y auditado) en el diseño de
// MIS-257 (DESIGN/design-system/templates/sales/Sales.dc.html), por
// consistencia visual entre el diseño aprobado y la implementación real.
function VentasIcon({ stroke }: { stroke: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  );
}

```

---

## `src/app/(app)/(with-nav)/ventas/page.tsx`

```tsx
import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../../convex/_generated/api";
import { getUser } from "@/lib/auth/dal";
import { readSessionToken } from "@/lib/auth/cookie";
import { SalesList } from "./SalesList";

// MIS-256: pantalla Ventas — listado de ventas ganadas + resumen por
// periodo (mes/trimestre/año en curso). Se piden los 3 periodos en
// paralelo en el servidor (convex/sales.ts::listWonSalesForPeriod) para
// que cambiar de pestaña en SalesList sea instantáneo, sin refetch — mismo
// patrón servidor-fetch / cliente-render que contactos/page.tsx +
// ContactList.tsx. Disponible para Carlos y Marta por igual (sin gating de
// rol, consistente con MIS-251); hereda FAB + BottomNav de
// (with-nav)/layout.tsx sin cambios ahí (la ruta vive dentro del mismo
// grupo).
export default async function VentasPage() {
  await getUser();
  const token = await readSessionToken(); // getUser() ya garantiza sesión válida aquí

  const [month, quarter, year] = await Promise.all([
    fetchQuery(api.sales.listWonSalesForPeriod, { token: token!, period: "month" }),
    fetchQuery(api.sales.listWonSalesForPeriod, { token: token!, period: "quarter" }),
    fetchQuery(api.sales.listWonSalesForPeriod, { token: token!, period: "year" }),
  ]);

  return (
    <div className="flex flex-1 flex-col" style={{ padding: "16px 20px 24px", gap: 20 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)" }}>Ventas</h1>
        <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>Ventas cerradas y facturación por periodo.</p>
      </div>
      <SalesList month={month} quarter={quarter} year={year} />
    </div>
  );
}

```

---

## `src/app/(app)/(with-nav)/ventas/SalesList.tsx`

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/core/Card";
import { Avatar } from "@/components/ui/core/Avatar";
import { formatCurrencyCents, formatDate } from "@/lib/contacts/format";

type Period = "month" | "quarter" | "year";

type Sale = {
  id: string;
  contactId: string;
  contactName: string;
  product: string;
  amountCents: number;
  purchaseDate: number;
};

type SalesForPeriod = { count: number; totalAmountCents: number; sales: Sale[] };

const PERIOD_LABELS: Record<Period, string> = {
  month: "Mes",
  quarter: "Trimestre",
  year: "Año",
};

// MIS-256: los 3 periodos llegan ya calculados desde el servidor
// (ventas/page.tsx, Promise.all de listWonSalesForPeriod) — cambiar de
// pestaña aquí es solo estado local, sin refetch ni recarga. Selector pill
// nuevo (no el componente Tabs existente, de estilo subrayado): replica el
// segmented-control ya aprobado en el diseño de MIS-257
// (DESIGN/design-system/templates/sales/Sales.dc.html).
export function SalesList({
  month,
  quarter,
  year,
}: {
  month: SalesForPeriod;
  quarter: SalesForPeriod;
  year: SalesForPeriod;
}) {
  const [period, setPeriod] = useState<Period>("month");
  const dataByPeriod: Record<Period, SalesForPeriod> = { month, quarter, year };
  const data = dataByPeriod[period];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div
        role="tablist"
        aria-label="Periodo"
        style={{
          display: "flex",
          gap: 0,
          background: "var(--color-muted)",
          borderRadius: "var(--radius-lg)",
          padding: 4,
        }}
      >
        {(["month", "quarter", "year"] as Period[]).map((p) => {
          const active = p === period;
          return (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setPeriod(p)}
              style={{
                flex: 1,
                height: 38,
                border: "none",
                borderRadius: "calc(var(--radius-lg) - 4px)",
                background: active ? "var(--color-surface)" : "transparent",
                boxShadow: active ? "var(--shadow-sm)" : "none",
                fontSize: 13,
                fontWeight: 600,
                color: active ? "var(--text-primary)" : "var(--text-tertiary)",
                cursor: "pointer",
              }}
            >
              {PERIOD_LABELS[p]}
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-tertiary)" }}>Facturado</span>
        <span style={{ fontSize: 40, fontWeight: 700, lineHeight: 1.15, color: "var(--status-won-fg)" }}>
          {formatCurrencyCents(data.totalAmountCents)}
        </span>
        <span style={{ fontSize: 14, color: "var(--text-secondary)", marginTop: 4 }}>
          {data.count === 1 ? "1 venta cerrada" : `${data.count} ventas cerradas`}
        </span>
      </div>

      {data.sales.length === 0 ? (
        <p style={{ fontSize: 14, color: "var(--text-secondary)", textAlign: "center", padding: "48px 0" }}>
          Aún no hay ventas en este periodo
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {data.sales.map((sale) => (
            <li key={sale.id}>
              <Link
                href={`/contactos/${sale.contactId}`}
                style={{ textDecoration: "none", color: "inherit", display: "block" }}
              >
                <Card
                  interactive
                  padding="md"
                  style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}
                >
                  <Avatar name={sale.contactName} size="md" />
                  <div style={{ flex: "1 1 160px", minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>
                      {sale.contactName}
                    </span>
                    <span
                      style={{
                        fontSize: 13,
                        color: "var(--text-secondary)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {sale.product}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-end",
                      gap: 4,
                      flexShrink: 0,
                    }}
                  >
                    <span style={{ fontSize: 15, fontWeight: 700, color: "var(--status-won-fg)" }}>
                      {formatCurrencyCents(sale.amountCents)}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{formatDate(sale.purchaseDate)}</span>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

```

---

## `src/app/(app)/(with-nav)/panel/page.tsx`

```tsx
import Link from "next/link";
import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../../convex/_generated/api";
import { getUser } from "@/lib/auth/dal";
import { readSessionToken } from "@/lib/auth/cookie";
import { Badge } from "@/components/ui/feedback/Badge";
import { Card } from "@/components/ui/core/Card";
import { StatusBadge } from "@/components/ui/feedback/StatusBadge";
import { PIPELINE_SUMMARY_STATUSES } from "@/lib/contacts/status";
import { formatCurrencyCents } from "@/lib/contacts/format";
import { PanelAutoRefresh } from "./PanelAutoRefresh";

// Sustituye el placeholder de MIS-9/MIS-18 con el panel real de Marta
// (MIS-17): resumen del pipeline por estado + total de ventas ganadas,
// cada estado pulsable hacia /contactos?status=<estado>. Accesible también
// a Carlos desde el ADR de MIS-18 (ambos roles, solo lectura). Ver
// PLANS/MIS-17-panel-oportunidades.md para el ADR de "tiempo real"
// (PanelAutoRefresh) y el resto de decisiones.
//
// A partir de MIS-14 (reapertura jul 2026), este archivo usa
// PIPELINE_SUMMARY_STATUSES en vez de SELECTABLE_STATUSES — antes ambas
// constantes coincidían por casualidad; MIS-14 las diverge (ver
// src/lib/contacts/status.ts).
//
// MIS-17 (reapertura jul 2026): el desglose pasa a mostrar Lead nuevo / En
// conversación / Propuesta enviada / Negociando / Inactivo / Perdido — sin
// "Ganado" (se sigue mostrando aparte, en la sección "Ventas ganadas" más
// abajo). Sin cambios de JSX ni de lógica en este archivo: el `.map()`
// sobre PIPELINE_SUMMARY_STATUSES y el índice `pipeline[status]` ya eran
// genéricos; el cambio real vive en la constante y en getPipelineSummary.
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
          {PIPELINE_SUMMARY_STATUSES.map((status) => (
            // Sin aria-label manual a propósito (hallazgo real durante la
            // verificación de MIS-17): StatusBadge.jsx es "use client", así
            // que PIPELINE_STATES[status].label no se puede leer desde este
            // Server Component — solo se puede renderizar el componente
            // <StatusBadge> como referencia cliente, no leer sus datos en el
            // servidor. El nombre accesible del Link se deriva de su
            // contenido visible (el número + el texto del badge ya
            // hidratado), que ya coincide exactamente con lo que se ve en
            // pantalla — evita además duplicar las etiquetas en un segundo
            // sitio (PIPELINE_STATES sigue siendo la única fuente).
            <Link
              key={status}
              href={`/contactos?status=${status}`}
              // minWidth: 0 anula el min-width:auto por defecto de los
              // grid items — sin esto, CSS Grid ensancha la columna entera
              // hasta caber la palabra más larga sin partir (p. ej.
              // "conversación", 12 caracteres, en la columna de "En
              // conversación"/"Negociando"/"Perdido"), desbordando el grid
              // completo a 320px aunque whiteSpace:"normal" ya permita
              // envolver dentro de cada badge individual. Hallazgo real
              // durante la verificación (Playwright a 320px), no solo
              // razonado — ver decisión 13 del plan.
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
        {/* MIS-256: la tarjeta se vuelve clicable hacia /ventas, sin cambiar
            la cifra que muestra (sigue siendo el histórico completo vía
            getWonSalesSummary, sin tocar) — mismo patrón Link+Card
            interactive ya usado arriba para las tarjetas de pipeline. */}
        <Link href="/ventas" style={{ textDecoration: "none", color: "inherit", display: "block" }}>
          <Card interactive padding="md" style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
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
        </Link>
      </section>
    </div>
  );
}

```

---

## `e2e/edge-cases.spec.ts`

```ts
import { test, expect } from "@playwright/test";
import { convexClient, sessionTokenFrom, api } from "./helpers/convex-client";
import { uniqueContactName, uniquePhone } from "./helpers/test-data";

test("cerrar la app a mitad del formulario no crea ni conserva un borrador", async ({ page }) => {
  const abandonedName = uniqueContactName("Abandonado");
  await page.goto("/contactos/nuevo");
  await page.getByLabel("Nombre completo").fill(abandonedName);
  // "Cierra la app" simulado como navegar fuera sin enviar el formulario —
  // el formulario no tiene autosave ni borrador local (Server Action pura),
  // así que esto es equivalente en efecto a cerrar/matar la app.
  await page.goto("/pendientes");
  await page.goto("/contactos");
  await expect(page.getByText(abandonedName)).toHaveCount(0);

  await page.goto("/contactos/nuevo");
  await expect(page.getByLabel("Nombre completo")).toHaveValue("");
});

test("el historial se actualiza tras varias acciones seguidas", async ({ page, context }) => {
  const client = convexClient();
  const token = await sessionTokenFrom(context);
  const name = uniqueContactName("Historial");
  const created = await client.mutation(api.contacts.createContact, { token, name, phone: uniquePhone() });
  if (!created.success) throw new Error("setup failed");

  await page.goto(`/contactos/${created.id}`);

  await page.getByRole("button", { name: "Añadir nota" }).click();
  let dialog = page.getByRole("dialog", { name: "Nueva nota" });
  await dialog.getByLabel("Resumen").fill("Nota 1");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { name: "Cambiar estado" }).click();
  dialog = page.getByRole("dialog", { name: "Cambiar estado" });
  await dialog.getByRole("button", { name: "En conversación" }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { name: "Añadir nota" }).click();
  dialog = page.getByRole("dialog", { name: "Nueva nota" });
  await dialog.getByLabel("Resumen").fill("Nota 2");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByText("Nota 1")).toBeVisible();
  await expect(page.getByText("Nota 2")).toBeVisible();
  await expect(page.getByText(/Estado cambiado: Lead nuevo → En conversación/)).toBeVisible();
});

test("la búsqueda encuentra por nombre y por teléfono", async ({ page, context }) => {
  const client = convexClient();
  const token = await sessionTokenFrom(context);
  const name = uniqueContactName("Busqueda");
  const phone = uniquePhone();
  const created = await client.mutation(api.contacts.createContact, { token, name, phone });
  if (!created.success) throw new Error("setup failed");

  await page.goto("/contactos");
  const search = page.getByLabel("Buscar contactos");

  await search.fill(name.split(" ").slice(0, 2).join(" ")); // fragmento del nombre
  await expect(page.getByText(name)).toBeVisible();

  await search.fill("");
  await search.fill(phone.replace(/\D/g, "").slice(-6)); // fragmento del teléfono
  await expect(page.getByText(name)).toBeVisible();
});

test("pendientes atrasados de días anteriores aparecen hoy, marcados como Vencido", async ({ page, context }) => {
  const client = convexClient();
  const token = await sessionTokenFrom(context);
  const name = uniqueContactName("Atrasado");
  const created = await client.mutation(api.contacts.createContact, { token, name, phone: uniquePhone() });
  if (!created.success) throw new Error("setup failed");

  // dueAt real, 3 días en el pasado — no es un mock de reloj, es un
  // timestamp real anterior a hoy, sembrado directamente vía la mutation
  // pública (mismo token real de Carlos), sin pasar por el date-picker de
  // la UI (que no permite fechas pasadas por semántica de "próximo
  // contacto"). Comprueba el mismo overdue = dueAt < todayStart de
  // convex/reminders.ts::listDueToday sin ninguna manipulación de reloj.
  const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
  const reminderResult = await client.mutation(api.reminders.scheduleReminder, {
    token,
    contactId: created.id,
    dueAt: threeDaysAgo,
    reason: "Seguimiento atrasado de prueba",
  });
  if (!reminderResult.success) throw new Error("no se pudo sembrar el recordatorio atrasado");

  await page.goto("/pendientes");
  const row = page.getByRole("listitem").filter({ hasText: name });
  await expect(row).toBeVisible();
  await expect(row.getByText("Vencido")).toBeVisible();

  // Limpieza (sugerencia de auditoría): se completa el recordatorio recién
  // verificado para que no quede como pendiente permanente en el deployment
  // de dev compartido tras cada corrida de la suite. Se hace vía mutation
  // directa (no clic en "Marcar hecho") porque ya se tiene el id a mano y
  // evita depender de que la fila siga siendo la primera en la lista tras
  // repintados.
  await client.mutation(api.reminders.completeReminder, { token, id: reminderResult.id });
});

test("no se puede guardar un contacto sin nombre", async ({ page }) => {
  await page.goto("/contactos/nuevo");
  // Un name totalmente vacío queda bloqueado por el `required` nativo del
  // <input> antes de llegar al servidor — para probar la validación REAL
  // del servidor (createContact: name.trim() vacío -> error), se usa un
  // nombre de solo espacios: pasa el `required` del navegador (no está
  // vacío) pero falla el trim() del lado servidor.
  await page.getByLabel("Nombre completo").fill("   ");
  await page.getByLabel("Teléfono / WhatsApp").fill(uniquePhone());
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("El nombre es obligatorio")).toBeVisible();
  await expect(page).toHaveURL(/\/contactos\/nuevo$/); // no navegó, no se creó nada
});

// MIS-252: Carlos edita nombre/teléfono/email/canal de un contacto ya
// creado, y confirma que dejar email/canal en blanco los borra de verdad
// (no solo los deja con el valor viejo) — el caso concreto que ejercita
// la semántica de ctx.db.patch + undefined explícito documentada en
// convex/contacts.ts::updateContact.
test("Carlos edita datos de un contacto existente", async ({ page, context }) => {
  const client = convexClient();
  const token = await sessionTokenFrom(context);
  const originalName = uniqueContactName("EditarOriginal");
  const created = await client.mutation(api.contacts.createContact, {
    token,
    name: originalName,
    phone: uniquePhone(),
    email: "original@example.com",
    channel: "web",
  });
  if (!created.success) throw new Error("setup failed");

  await page.goto(`/contactos/${created.id}`);
  await page.getByRole("button", { name: "Editar datos" }).click();
  const dialog = page.getByRole("dialog", { name: "Editar datos" });

  const newName = uniqueContactName("EditarNuevo");
  const newPhone = uniquePhone();
  await dialog.getByLabel("Nombre completo").fill(newName);
  await dialog.getByLabel("Teléfono / WhatsApp").fill(newPhone);
  // Vaciar email y volver el canal a "Sin canal" — ambos tenían valor al
  // crear el contacto, así que esto ejercita el borrado explícito, no
  // solo dejar campos vacíos que nunca tuvieron valor.
  await dialog.getByLabel("Email (opcional)").fill("");
  await dialog.getByLabel("Canal de captación (opcional)").selectOption("");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByRole("heading", { name: newName })).toBeVisible();
  await expect(page.getByText(newPhone)).toBeVisible();
  await expect(page.getByText("original@example.com")).toHaveCount(0);
  await expect(page.getByText(/Canal:/)).toHaveCount(0);

  // Confirma en la lista también (AC: "se reflejan... en la lista de
  // contactos"), sin ningún cambio en listContacts/ContactList.
  await page.goto("/contactos");
  await expect(page.getByText(newName)).toBeVisible();
  await expect(page.getByText(originalName)).toHaveCount(0);
});

// MIS-254: "Posponer" reprograma un recordatorio en un toque desde
// Pendientes, sin abrir la ficha. Se siembra un recordatorio con dueAt
// "ahora" (cae dentro de "Para hoy", igual que cualquier dueAt de hoy o
// anterior — ver listDueToday) y se comprueba que, tras pulsar "Mañana",
// la fila desaparece de "Para hoy" (dueAt ya no cumple
// `dueAt < tomorrowStart`) y que el dueAt real en Convex avanzó de verdad
// (no solo un efecto visual).
// Sugerencia media de la auditoría de código: cubrir las DOS opciones
// ("Mañana" y "+3 días"), no solo la primera — dos contactos/recordatorios
// distintos, uno por opción, para no depender de que la reprogramación de
// uno afecte al orden/visibilidad del otro en la misma lista.
test("posponer un seguimiento desde Pendientes lo reprograma sin abrir la ficha (Mañana y +3 días)", async ({
  page,
  context,
}) => {
  const client = convexClient();
  const token = await sessionTokenFrom(context);

  async function seedDueToday(label: string) {
    const name = uniqueContactName(label);
    const created = await client.mutation(api.contacts.createContact, { token, name, phone: uniquePhone() });
    if (!created.success) throw new Error("setup failed");
    const originalDueAt = Date.now();
    const reminderResult = await client.mutation(api.reminders.scheduleReminder, {
      token,
      contactId: created.id,
      dueAt: originalDueAt,
      reason: `Seguimiento de prueba para posponer (${label})`,
    });
    if (!reminderResult.success) throw new Error("no se pudo sembrar el recordatorio");
    return { contactId: created.id, name, originalDueAt };
  }

  async function postponeAndVerify(seed: { contactId: string; name: string; originalDueAt: number }, buttonLabel: string) {
    await page.goto("/pendientes");
    const todaySection = page.locator("section").filter({ has: page.getByRole("heading", { name: "Para hoy" }) });
    const row = todaySection.getByRole("listitem").filter({ hasText: seed.name });
    await expect(row).toBeVisible();

    await row.getByRole("button", { name: buttonLabel }).click();
    await expect(row).toBeHidden();

    const remindersForContact = await client.query(api.reminders.listRemindersForContact, {
      token,
      contactId: seed.contactId,
    });
    expect(remindersForContact.current?.dueAt).toBeGreaterThan(seed.originalDueAt);

    // Limpieza (mismo criterio que el test de "atrasado" de arriba): se
    // completa el recordatorio para no dejarlo pendiente indefinidamente en
    // el deployment de dev compartido.
    if (remindersForContact.current) {
      await client.mutation(api.reminders.completeReminder, { token, id: remindersForContact.current._id });
    }
    return remindersForContact.current?.dueAt;
  }

  const seedManana = await seedDueToday("PosponerManana");
  const dueAtManana = await postponeAndVerify(seedManana, "Mañana");

  const seedTresDias = await seedDueToday("PosponerTresDias");
  const dueAtTresDias = await postponeAndVerify(seedTresDias, "+3 días");

  // "+3 días" debe quedar más lejos en el tiempo que "Mañana" — confirma
  // que los dos botones no están enviando el mismo offset por error.
  expect(dueAtTresDias!).toBeGreaterThan(dueAtManana!);
});

// MIS-254: la ficha muestra, junto al teléfono, un link de llamar (ya
// existente, sin cambios) y uno nuevo de WhatsApp. Teléfono con espacios y
// prefijo +34 a propósito — ejercita la normalización de whatsappDigits()
// (dígitos puros + prefijo de país), no solo el caso ya-limpio.
test("la ficha del contacto muestra los links de llamar y WhatsApp junto al teléfono", async ({
  page,
  context,
}) => {
  const client = convexClient();
  const token = await sessionTokenFrom(context);
  const name = uniqueContactName("Whatsapp");
  const created = await client.mutation(api.contacts.createContact, {
    token,
    name,
    phone: "+34 612 345 678",
  });
  if (!created.success) throw new Error("setup failed");

  await page.goto(`/contactos/${created.id}`);

  // tel: sin normalizar, tal cual se guardó — comportamiento ya existente,
  // sin cambios de MIS-254.
  await expect(page.getByRole("link", { name: /\+34 612 345 678/ })).toHaveAttribute(
    "href",
    "tel:+34 612 345 678",
  );

  // wa.me con dígitos puros + prefijo de país, sin espacios ni "+", en
  // pestaña nueva (no navega fuera del CRM).
  const waLink = page.getByRole("link", { name: "WhatsApp" });
  await expect(waLink).toHaveAttribute("href", "https://wa.me/34612345678");
  await expect(waLink).toHaveAttribute("target", "_blank");
});

// MIS-254 (sugerencia baja de la auditoría de código, ronda 2): un teléfono
// sin número nacional de España válido (menos de 9 dígitos, ver
// whatsappDigits()/phoneKey() en src/lib/contacts/phone.ts) no debe mostrar
// el link de WhatsApp — pero tel: sigue siendo tolerante a cualquier
// formato y debe seguir mostrándose igual que hoy.
test("un teléfono demasiado corto no muestra el link de WhatsApp, pero sí el de llamar", async ({
  page,
  context,
}) => {
  const client = convexClient();
  const token = await sessionTokenFrom(context);
  const name = uniqueContactName("TelefonoCorto");
  const created = await client.mutation(api.contacts.createContact, {
    token,
    name,
    phone: "12345",
  });
  if (!created.success) throw new Error("setup failed");

  await page.goto(`/contactos/${created.id}`);

  await expect(page.getByRole("link", { name: /12345/ })).toHaveAttribute("href", "tel:12345");
  await expect(page.getByRole("link", { name: "WhatsApp" })).toHaveCount(0);
});

// MIS-254 (sugerencia media de la auditoría de código, ronda 2): el NO-GO
// de la primera ronda fue exactamente un overflow horizontal en Pendientes
// a 320px con los 3 botones de acción (Marcar hecho / Mañana / +3 días).
// Tras la corrección (PostponeReminderButtons como forms planos, sin
// contenedor propio), esto queda cubierto por diseño/comentario — esta
// prueba lo comprueba de verdad, en un navegador real, no solo por
// inspección manual puntual: mismo criterio exacto que pidió la auditoría
// (document.documentElement.scrollWidth === clientWidth), ahora como
// regresión permanente en la suite.
test("Pendientes no desborda horizontalmente en 320px con los 3 botones de acción visibles", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });

  const client = convexClient();
  const token = await sessionTokenFrom(context);
  const name = uniqueContactName("Viewport320");
  const created = await client.mutation(api.contacts.createContact, { token, name, phone: uniquePhone() });
  if (!created.success) throw new Error("setup failed");
  const reminderResult = await client.mutation(api.reminders.scheduleReminder, {
    token,
    contactId: created.id,
    dueAt: Date.now(),
    reason: "Verificación de ancho a 320px",
  });
  if (!reminderResult.success) throw new Error("no se pudo sembrar el recordatorio");

  await page.goto("/pendientes");
  const row = page.getByRole("listitem").filter({ hasText: name });
  await expect(row).toBeVisible();
  await expect(row.getByRole("button", { name: "Marcar hecho" })).toBeVisible();
  await expect(row.getByRole("button", { name: "Mañana" })).toBeVisible();
  await expect(row.getByRole("button", { name: "+3 días" })).toBeVisible();

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBe(overflow.clientWidth);

  // Limpieza, mismo criterio que el resto de tests de este archivo.
  await client.mutation(api.reminders.completeReminder, { token, id: reminderResult.id });
});

// MIS-256: la pantalla Ventas lista las ventas ganadas del periodo
// seleccionado y filtra por purchaseDate — se siembra una venta con fecha
// de hoy (visible en Mes/Año) y otra 1ms antes del inicio del mes en
// curso (SIEMPRE excluida de "Mes", en cualquier fecha de ejecución, sin
// excepción de calendario), para comprobar que el filtro de periodo
// funciona de verdad, no solo que la pantalla carga. Además confirma que
// pulsar una venta abre la ficha del contacto correcto (AC: "al pulsar
// una venta, abre la ficha del contacto").
//
// Corrige un Major de la auditoría de código (ronda 1): la versión
// anterior usaba un "15 de febrero" fijo como fecha "de un periodo
// anterior", que en ejecuciones de enero/febrero podía caer en el mes
// actual o incluso en el futuro (la query filtra purchaseDate <= ahora),
// dejando la aserción de "excluida de Mes" inestable según la fecha real
// de ejecución. La fecha de aquí (monthStart - 1) es matemáticamente
// anterior al mes en curso SIEMPRE — no depende de qué mes sea "ahora".
//
// Lo que SÍ depende de la fecha de ejecución es si esa fecha cae también
// en el año en curso: solo deja de ser así cuando el test corre en enero
// (monthStart - 1 cruza a diciembre del año anterior) — la única
// excepción posible por pura aritmética de calendario (no existe ningún
// instante "antes del mes en curso" que siga en el mismo año si el mes en
// curso es enero). La aserción de "Año" comprueba esa condición real en
// vez de asumirla, así que el test es correcto en cualquier fecha de
// ejecución, incluida esa.
test("Ventas filtra por periodo y navega a la ficha del contacto al pulsar una venta", async ({ page, context }) => {
  const client = convexClient();
  const token = await sessionTokenFrom(context);

  const thisMonthName = uniqueContactName("VentaEsteMes");
  const thisMonthContact = await client.mutation(api.contacts.createContact, {
    token,
    name: thisMonthName,
    phone: uniquePhone(),
  });
  if (!thisMonthContact.success) throw new Error("setup failed");
  const thisMonthClose = await client.mutation(api.sales.closeSale, {
    token,
    contactId: thisMonthContact.id,
    outcome: "won",
    product: "Producto de este mes",
    amountCents: 12345,
    purchaseDate: Date.now(),
  });
  if (!thisMonthClose.success) throw new Error("no se pudo cerrar la venta de este mes");

  const earlierName = uniqueContactName("VentaPeriodoAnterior");
  const earlierContact = await client.mutation(api.contacts.createContact, {
    token,
    name: earlierName,
    phone: uniquePhone(),
  });
  if (!earlierContact.success) throw new Error("setup failed");

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const earlierPurchaseDate = monthStart - 1; // 1ms antes del mes en curso, siempre

  const earlierClose = await client.mutation(api.sales.closeSale, {
    token,
    contactId: earlierContact.id,
    outcome: "won",
    product: "Producto de periodo anterior",
    amountCents: 6000,
    purchaseDate: earlierPurchaseDate,
  });
  if (!earlierClose.success) throw new Error("no se pudo cerrar la venta de periodo anterior");

  // Sugerencia no bloqueante de la auditoría (ronda 2): el filtro de
  // Trimestre no tenía ninguna venta que cambiara de visibilidad al
  // cambiar de pestaña. Misma técnica que earlierPurchaseDate arriba, pero
  // anclada al inicio del TRIMESTRE en curso, no del mes — earlierName
  // (monthStart - 1) no sirve aquí: si el mes en curso no es el primero
  // del trimestre, monthStart - 1 sigue cayendo dentro del mismo
  // trimestre. quarterStart - 1 es SIEMPRE anterior al trimestre en
  // curso, sin excepción de calendario, igual que monthStart - 1 lo es
  // para el mes.
  const earlierQuarterName = uniqueContactName("VentaTrimestreAnterior");
  const earlierQuarterContact = await client.mutation(api.contacts.createContact, {
    token,
    name: earlierQuarterName,
    phone: uniquePhone(),
  });
  if (!earlierQuarterContact.success) throw new Error("setup failed");

  const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
  const quarterStart = new Date(now.getFullYear(), quarterStartMonth, 1).getTime();
  const earlierQuarterPurchaseDate = quarterStart - 1; // 1ms antes del trimestre en curso, siempre

  const earlierQuarterClose = await client.mutation(api.sales.closeSale, {
    token,
    contactId: earlierQuarterContact.id,
    outcome: "won",
    product: "Producto de trimestre anterior",
    amountCents: 3000,
    purchaseDate: earlierQuarterPurchaseDate,
  });
  if (!earlierQuarterClose.success) throw new Error("no se pudo cerrar la venta de trimestre anterior");

  await page.goto("/ventas");

  // Mes (por defecto): solo la venta de este mes — earlierPurchaseDate es
  // SIEMPRE anterior al inicio del mes en curso, sin excepción posible.
  await expect(page.getByText(thisMonthName)).toBeVisible();
  await expect(page.getByText(earlierName)).toHaveCount(0);

  // Trimestre: la venta "de este mes" sigue visible (el mes en curso
  // siempre cae dentro del trimestre en curso); la de trimestre anterior
  // queda excluida — quarterStart - 1 es SIEMPRE anterior al trimestre en
  // curso, sin excepción de calendario, así que esta aserción no depende
  // de la fecha de ejecución.
  await page.getByRole("tab", { name: "Trimestre", exact: true }).click();
  await expect(page.getByText(thisMonthName)).toBeVisible();
  await expect(page.getByText(earlierQuarterName)).toHaveCount(0);

  // "Año" solo debe incluir la venta "de periodo anterior" si cae en el
  // mismo año que "ahora" — deja de ser cierto únicamente si el test corre
  // en enero. Se comprueba la condición real, no se asume, para que la
  // aserción sea correcta en cualquier fecha de ejecución.
  const earlierIsSameYear = new Date(earlierPurchaseDate).getFullYear() === now.getFullYear();
  await page.getByRole("tab", { name: "Año", exact: true }).click();
  await expect(page.getByText(thisMonthName)).toBeVisible();
  if (earlierIsSameYear) {
    await expect(page.getByText(earlierName)).toBeVisible();
  } else {
    await expect(page.getByText(earlierName)).toHaveCount(0);
  }

  // Pulsar la venta de este mes abre la ficha del contacto correcto.
  await page.getByText(thisMonthName).click();
  await page.waitForURL(`**/contactos/${thisMonthContact.id}`);
  await expect(page.getByRole("heading", { name: thisMonthName })).toBeVisible();
});

// MIS-256: acceso también desde el total del Panel (AC: "también se entra
// tocando el total de ventas del Panel"), sin recargar a mano la URL.
// hasText: "importe total" (no "ventas cerradas") — sugerencia no
// bloqueante de la auditoría (ronda 2): "ventas cerradas" es frágil si el
// deployment queda con exactamente 1 venta cerrada (singular "venta
// cerrada"); "importe total" siempre se muestra igual, sin variación de
// singular/plural.
test("el total de Ventas ganadas del Panel navega a la pantalla Ventas", async ({ page }) => {
  await page.goto("/panel");
  await page.locator('a[href="/ventas"]').filter({ hasText: "importe total" }).click();
  await page.waitForURL("**/ventas");
  await expect(page.getByRole("heading", { name: "Ventas" })).toBeVisible();
});

// MIS-256 (condición de la auditoría de plan): comprobación real en
// navegador de que la nav de 4 pestañas + el selector de periodo no
// desbordan en 320px — mismo criterio ya establecido en este archivo para
// Pendientes (scrollWidth === clientWidth).
test("Ventas no desborda horizontalmente en 320px con la nav de 4 pestañas y el selector de periodo", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/ventas");

  await expect(page.getByRole("link", { name: "Ventas", exact: true })).toBeVisible();
  // exact: true en las 3 — "Mes" es substring de "Trimestre" ("triMEStre"),
  // el matcher por defecto de getByRole es no-exacto y las confundía.
  await expect(page.getByRole("tab", { name: "Mes", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Trimestre", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Año", exact: true })).toBeVisible();

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBe(overflow.clientWidth);
});

```

---


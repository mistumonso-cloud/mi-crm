# CODIGO-COMPLETO — MIS-259: Registrar venta directa (ventas repetidas por cliente)

Código consolidado para copiar/pegar en auditoría. Plan: `PLANS/MIS-259-registrar-venta-directa.md`.

Resumen de cambios:
- `convex/sales.ts` — nueva mutation `registerDirectSale` (junto a `closeSale`, sin tocarla). Reutiliza `PRODUCT_MAX`/`isValidAmountCents`/`isValidEpochMs` ya existentes en el archivo (solo se repite el archivo completo por contexto).
- `src/lib/contacts/actions.ts` — nueva Server Action `registerDirectSaleAction` + tipo `RegisterDirectSaleState`, calco de `closeSaleAction` sin la rama outcome/lossReason (solo se repite el archivo completo por contexto).
- `src/components/crm/PageFab.tsx` — nuevo. Suprime el FAB genérico "Añadir contacto" en `/ventas` (esa pantalla pinta el suyo propio).
- `src/app/(app)/(with-nav)/layout.tsx` — usa `PageFab` en vez de `AddContactFab` directamente. `AddContactFab.tsx` no se toca.
- `src/app/(app)/(with-nav)/ventas/page.tsx` — añade `listContacts` al `Promise.all` existente, pasa `contacts` a `SalesList`.
- `src/app/(app)/(with-nav)/ventas/SalesList.tsx` — nuevo FAB local ("Registrar venta") + `BottomSheet` + `RegisterSaleForm`.
- `src/app/(app)/(with-nav)/ventas/RegisterSaleForm.tsx` — nuevo, formulario de 2 pasos (elegir contacto → producto/importe/fecha).
- `e2e/edge-cases.spec.ts` — 3 tests nuevos al final del archivo; el resto del archivo se repite tal cual, sin cambios, por contexto.

**Verificación realizada** (overlay temporal sobre el repo real, revertido tras la verificación — ver `PLANS/MIS-259-registrar-venta-directa.md`, sección Estado, para el detalle completo):
- `npx tsc --noEmit`, `npm run lint`, `npm run build`: sin errores (1 warning preexistente en `Avatar.jsx`, no relacionado).
- `npx convex dev --once` contra el deployment de dev compartido (`dutiful-mole-111`) para desplegar `registerDirectSale` temporalmente, `npm run test:e2e` completo: **24/24 tests pasan** (Carlos y Marta), incluidos los 3 tests nuevos de MIS-259 — dos de ellos ejercitan el flujo real desde `/ventas` (FAB → hoja → buscar/elegir contacto → rellenar → Confirmar), no solo la mutation directa, cumpliendo la condición de la auditoría de plan. Un test preexistente (`posponer un seguimiento...`) falló una vez en la ejecución completa por acumulación de datos de pruebas en el deployment compartido (mismo patrón ya diagnosticado en MIS-256) y pasó limpio al re-ejecutarlo aislado — no relacionado con este diff, no toca ningún archivo de recordatorios/pendientes.
- Deployment de dev resincronizado con el código real de la rama tras la verificación (ver Estado).

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

// MIS-259: registra una venta directamente desde la pantalla de Ventas,
// sin pasar por el cierre de pipeline — a diferencia de closeSale, NO
// exige que el contacto siga abierto (permite ventas repetidas de un
// contacto ya "won", y reabre como "won" un contacto "lost"/pipeline).
// outcome siempre "won": esta vía no registra pérdidas.
export const registerDirectSale = mutation({
  args: {
    token: v.string(),
    contactId: v.string(), // v.string(), no v.id("contacts"): mismo motivo que en closeSale/getContact
    product: v.string(),
    amountCents: v.number(),
    purchaseDate: v.number(),
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
        ),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);

    const contactId = ctx.db.normalizeId("contacts", args.contactId);
    if (!contactId) {
      return { success: false as const, error: "Contacto no encontrado", field: "contactId" as const };
    }
    const contact = await ctx.db.get(contactId);
    if (!contact) {
      return { success: false as const, error: "Contacto no encontrado", field: "contactId" as const };
    }

    const product = args.product.trim();
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
    if (!isValidAmountCents(args.amountCents)) {
      return { success: false as const, error: "El importe debe ser un número positivo", field: "amountCents" as const };
    }
    // Decisión deliberada (sugerencia de la auditoría de plan de MIS-259):
    // se permite una purchaseDate futura, igual que ya permite closeSale
    // (isValidEpochMs no impone límite superior) — no es un caso bloqueante,
    // solo se deja constancia de que es intencional, no un descuido.
    if (!isValidEpochMs(args.purchaseDate)) {
      return { success: false as const, error: "Fecha de compra inválida", field: "purchaseDate" as const };
    }

    const closedAt = Date.now();

    await ctx.db.insert("saleClosures", {
      contactId,
      outcome: "won" as const,
      product,
      amountCents: args.amountCents,
      purchaseDate: args.purchaseDate,
      closedBy: user.id,
      closedAt,
    });

    // Solo se toca el pipeline si el contacto no estaba ya "won" — una
    // venta repetida de un contacto ya ganado no genera un cambio de
    // estado "won" -> "won" sin información real (mismo criterio de
    // no-op que changeContactStatus).
    if (contact.status !== "won") {
      await ctx.db.insert("statusChanges", {
        contactId,
        fromStatus: contact.status,
        toStatus: "won",
        changedBy: user.id,
        changedAt: closedAt,
      });
      await ctx.db.patch(contactId, { status: "won" });
    }

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

## `src/lib/contacts/actions.ts`

```ts
"use server";

import { ConvexError } from "convex/values";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { fetchMutation } from "convex/nextjs";
import { api } from "../../../convex/_generated/api";
import { readSessionToken } from "@/lib/auth/cookie";
import { SELECTABLE_STATUSES } from "@/lib/contacts/status";
import { CONTACT_CHANNELS, type ContactChannel } from "@/lib/contacts/channel";

export type CreateContactState =
  | { error: string; field?: "name" | "phone" | "email" | "channel" | "initialNote" }
  | undefined;

export async function createContactAction(
  _prevState: CreateContactState,
  formData: FormData,
): Promise<CreateContactState> {
  const token = await readSessionToken();
  if (!token) redirect("/login"); // defensa en profundidad; getUser() ya debería haber redirigido antes de renderizar el form

  const name = String(formData.get("name") ?? "");
  const phone = String(formData.get("phone") ?? "");
  const emailRaw = String(formData.get("email") ?? "").trim();

  // Validado contra el enum antes de llamar a Convex (mismo motivo y mismo
  // patrón que la validación de "type" en addNoteAction): un POST manipulado
  // con un channel fuera del enum no debe llegar a la mutation y disparar un
  // error de validación de argumentos de Convex sin manejar.
  // Object.prototype.hasOwnProperty.call, no el operador `in` — `in` acepta
  // también claves heredadas de la cadena de prototipos (p.ej. "toString").
  const channelRaw = String(formData.get("channel") ?? "");
  let channel: ContactChannel | undefined;
  if (channelRaw) {
    if (!Object.prototype.hasOwnProperty.call(CONTACT_CHANNELS, channelRaw)) {
      return { error: "Canal inválido", field: "channel" };
    }
    channel = channelRaw as ContactChannel;
  }

  const initialNoteRaw = String(formData.get("initialNote") ?? "").trim();

  let result;
  try {
    result = await fetchMutation(api.contacts.createContact, {
      token,
      name,
      phone,
      email: emailRaw || undefined,
      channel,
      initialNote: initialNoteRaw || undefined,
    });
  } catch (err) {
    // MIS-251 (reapertura): createContact ya no exige rol "rep" — la única
    // ConvexError posible aquí es "No autenticado" (sesión revocada/expirada
    // entre cargar la página y enviar el formulario). Ya no hace falta
    // distinguir un caso "No autorizado" (dejó de poder ocurrir).
    if (err instanceof ConvexError) {
      redirect("/login");
    }
    throw err; // cualquier otro error, no lo enmascaramos
  }

  if (!result.success) {
    return { error: result.error, field: result.field };
  }

  redirect(`/contactos/${result.id}`); // fuera de try/catch
}

export type UpdateContactState =
  | { success: true }
  | { success: false; error: string; field?: "contactId" | "name" | "phone" | "email" | "channel" }
  | undefined;

// MIS-252: edita nombre/teléfono/email/canal de un contacto existente
// desde su ficha, en un solo paso (EditContactForm.tsx). A diferencia de
// createContactAction (redirige a la ficha del contacto NUEVO), esta se
// queda en la misma ficha — mismo patrón que changeStatusAction/
// closeSaleAction: ya hay un contactId concreto.
export async function updateContactAction(
  _prevState: UpdateContactState,
  formData: FormData,
): Promise<UpdateContactState> {
  const token = await readSessionToken();
  if (!token) redirect("/login");

  const contactId = String(formData.get("contactId") ?? "");
  const name = String(formData.get("name") ?? "");
  const phone = String(formData.get("phone") ?? "");
  const emailRaw = String(formData.get("email") ?? "").trim();

  // Mismo patrón que createContactAction: hasOwnProperty, no `in`.
  const channelRaw = String(formData.get("channel") ?? "");
  let channel: ContactChannel | undefined;
  if (channelRaw) {
    if (!Object.prototype.hasOwnProperty.call(CONTACT_CHANNELS, channelRaw)) {
      return { success: false, error: "Canal inválido", field: "channel" };
    }
    channel = channelRaw as ContactChannel;
  }

  let result;
  try {
    result = await fetchMutation(api.contacts.updateContact, {
      token,
      contactId,
      name,
      phone,
      email: emailRaw || undefined,
      channel,
    });
  } catch (err) {
    // MIS-251 (reapertura): updateContact ya no exige rol "rep" — mismo
    // motivo que createContactAction, la única ConvexError posible es "No
    // autenticado".
    if (err instanceof ConvexError) {
      redirect("/login");
    }
    throw err;
  }

  if (!result.success) {
    return { success: false, error: result.error, field: result.field };
  }

  refresh(); // Next 16: re-renderiza /contactos/[id] en la misma respuesta — mismo patrón que changeStatusAction/closeSaleAction
  return { success: true };
}

export type ChangeStatusState =
  | { success: true }
  | { success: false; error: string; field?: "contactId" | "status" }
  | undefined;

// MIS-14: cambia el estado de pipeline de un contacto desde la ficha, en
// un solo paso (un botón por estado destino en ChangeStatusForm.tsx).
export async function changeStatusAction(
  _prevState: ChangeStatusState,
  formData: FormData,
): Promise<ChangeStatusState> {
  const token = await readSessionToken();
  if (!token) redirect("/login");

  const contactId = String(formData.get("contactId") ?? "");

  // Validado contra SELECTABLE_STATUSES ANTES de llamar a Convex — mismo
  // motivo que la validación de dueAt/reason en reminders/actions.ts: un
  // POST manipulado con un valor fuera de la lista no debe llegar a la
  // mutation y disparar un error de validación de argumentos de Convex
  // sin manejar.
  const statusRaw = String(formData.get("status") ?? "");
  if (!SELECTABLE_STATUSES.includes(statusRaw as (typeof SELECTABLE_STATUSES)[number])) {
    return { success: false, error: "Estado inválido", field: "status" };
  }
  const status = statusRaw as (typeof SELECTABLE_STATUSES)[number];

  let result;
  try {
    result = await fetchMutation(api.contacts.changeContactStatus, { token, contactId, status });
  } catch (err) {
    // MIS-251 (reapertura): changeContactStatus ya no exige rol "rep" —
    // revierte el ADR de MIS-18. La única ConvexError posible aquí ya es
    // "No autenticado" (sesión revocada/expirada entre cargar la ficha y
    // pulsar un estado); ya no hace falta distinguir un caso "No
    // autorizado" (dejó de poder ocurrir).
    if (err instanceof ConvexError) {
      redirect("/login");
    }
    throw err;
  }

  if (!result.success) {
    return { success: false, error: result.error, field: result.field === "status" ? "status" : undefined };
  }

  refresh(); // Next 16: re-renderiza /contactos/[id] en la MISMA respuesta — mismo patrón que scheduleReminderAction/completeReminderAction
  return { success: true };
}

export type CloseSaleState =
  | { success: true }
  | {
      success: false;
      error: string;
      field?: "contactId" | "outcome" | "product" | "amountCents" | "purchaseDate" | "lossReason";
    }
  | undefined;

// outcome llega como texto libre desde el <input type="hidden"> de
// CloseSaleForm.tsx — se valida contra esta lista ANTES de construir el
// objeto de argumentos de fetchMutation. Nota importante (lección de la
// auditoría de plan v1→v2 de MIS-14): comparar un `string` con !==/===
// contra literales NO estrecha su tipo a una unión finita en TypeScript —
// mismo error de fondo (TS2345/TS2322) que causó el NO-GO de esa auditoría.
// Se usa el patrón ya corregido y validado en ese plan: array.includes(v as
// Literal) + cast explícito tras la comprobación, no una comparación de
// igualdad directa.
const SALE_OUTCOMES = ["won", "lost"] as const;

// Duplicadas de convex/sales.ts a propósito — mismo motivo que
// isValidEpochMs duplicada entre convex/reminders.ts y
// src/lib/reminders/actions.ts: esta Server Action es la primera línea de
// defensa contra un POST manipulado, pero la mutation es el endpoint
// público real y revalida todo de forma independiente.
function isValidEpochMs(value: number): boolean {
  return (
    Number.isFinite(value) &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    !Number.isNaN(new Date(value).getTime())
  );
}

function isValidAmountCents(value: number): boolean {
  return Number.isFinite(value) && Number.isSafeInteger(value) && value > 0;
}

// MIS-15: cierra una oportunidad de venta (ganada o perdida) desde la
// ficha, en un solo paso (CloseSaleForm.tsx). A diferencia de
// changeStatusAction (un único <form> con varios <button type="submit">
// homogéneos), aquí "ganada" y "perdida" tienen campos completamente
// distintos — la distinción llega como un único campo oculto "outcome" que
// el propio formulario ya fijó mediante estado local de React antes de
// montar el <form> (ver decisión 10 del plan), no mediante múltiples
// submit-buttons.
export async function closeSaleAction(
  _prevState: CloseSaleState,
  formData: FormData,
): Promise<CloseSaleState> {
  const token = await readSessionToken();
  if (!token) redirect("/login");

  const contactId = String(formData.get("contactId") ?? "");

  const outcomeRaw = String(formData.get("outcome") ?? "");
  if (!SALE_OUTCOMES.includes(outcomeRaw as (typeof SALE_OUTCOMES)[number])) {
    return { success: false, error: "Resultado de venta inválido", field: "outcome" };
  }
  const outcome = outcomeRaw as (typeof SALE_OUTCOMES)[number];

  let product: string | undefined;
  let amountCents: number | undefined;
  let purchaseDate: number | undefined;
  let lossReason: string | undefined;

  if (outcome === "won") {
    product = String(formData.get("product") ?? "");

    // amountCents llega ya calculado en el navegador (euros -> céntimos,
    // ver CloseSaleForm.tsx) — mismo criterio que dueDateMs en
    // ScheduleReminderForm.tsx: esta Server Action nunca reparsea el string
    // de euros original.
    const amountRaw = formData.get("amountCents");
    amountCents = typeof amountRaw === "string" ? Number(amountRaw) : NaN;
    if (!isValidAmountCents(amountCents)) {
      return { success: false, error: "El importe debe ser un número positivo", field: "amountCents" };
    }

    // purchaseDateMs llega ya calculado en el navegador — mismo criterio
    // exacto que dueDateMs: new Date("YYYY-MM-DD") se interpretaría como
    // medianoche UTC en el servidor, no la medianoche local del usuario.
    const purchaseDateRaw = formData.get("purchaseDateMs");
    purchaseDate = typeof purchaseDateRaw === "string" ? Number(purchaseDateRaw) : NaN;
    if (!isValidEpochMs(purchaseDate)) {
      return { success: false, error: "Fecha de compra inválida", field: "purchaseDate" };
    }
  } else {
    lossReason = String(formData.get("lossReason") ?? "");
  }

  let result;
  try {
    result = await fetchMutation(api.sales.closeSale, {
      token,
      contactId,
      outcome,
      product,
      amountCents,
      purchaseDate,
      lossReason,
    });
  } catch (err) {
    // MIS-251 (reapertura): closeSale ya no exige rol "rep" — revierte el
    // ADR de MIS-18. La única ConvexError posible aquí ya es "No
    // autenticado" (sesión revocada/expirada entre cargar la ficha y
    // confirmar); ya no hace falta distinguir un caso "No autorizado"
    // (dejó de poder ocurrir).
    if (err instanceof ConvexError) {
      redirect("/login");
    }
    throw err;
  }

  if (!result.success) {
    return { success: false, error: result.error, field: result.field };
  }

  refresh(); // Next 16: re-renderiza /contactos/[id] en la MISMA respuesta — mismo patrón que changeStatusAction
  return { success: true };
}

export type RegisterDirectSaleState =
  | { success: true }
  | {
      success: false;
      error: string;
      field?: "contactId" | "product" | "amountCents" | "purchaseDate";
    }
  | undefined;

// MIS-259: registra una venta directamente desde la pantalla de Ventas
// (RegisterSaleForm.tsx) — a diferencia de closeSaleAction, no hay rama
// "outcome"/"lossReason": esta vía solo registra ventas ganadas, nunca
// pérdidas, y el contacto puede estar en cualquier estado (incluido
// "won", para ventas repetidas).
export async function registerDirectSaleAction(
  _prevState: RegisterDirectSaleState,
  formData: FormData,
): Promise<RegisterDirectSaleState> {
  const token = await readSessionToken();
  if (!token) redirect("/login");

  const contactId = String(formData.get("contactId") ?? "");
  const product = String(formData.get("product") ?? "");

  // amountCents/purchaseDateMs llegan ya calculados en el navegador — mismo
  // criterio que closeSaleAction: esta Server Action nunca reparsea el
  // string de euros o de fecha originales.
  const amountRaw = formData.get("amountCents");
  const amountCents = typeof amountRaw === "string" ? Number(amountRaw) : NaN;
  if (!isValidAmountCents(amountCents)) {
    return { success: false, error: "El importe debe ser un número positivo", field: "amountCents" };
  }

  const purchaseDateRaw = formData.get("purchaseDateMs");
  const purchaseDate = typeof purchaseDateRaw === "string" ? Number(purchaseDateRaw) : NaN;
  if (!isValidEpochMs(purchaseDate)) {
    return { success: false, error: "Fecha de compra inválida", field: "purchaseDate" };
  }

  let result;
  try {
    result = await fetchMutation(api.sales.registerDirectSale, {
      token,
      contactId,
      product,
      amountCents,
      purchaseDate,
    });
  } catch (err) {
    if (err instanceof ConvexError) {
      redirect("/login");
    }
    throw err;
  }

  if (!result.success) {
    return { success: false, error: result.error, field: result.field };
  }

  refresh(); // Next 16: re-renderiza /ventas en la misma respuesta — mismo patrón que closeSaleAction
  return { success: true };
}
```

## `src/components/crm/PageFab.tsx`

```tsx
"use client";

import { usePathname } from "next/navigation";
import { AddContactFab } from "./AddContactFab";

// MIS-259: Ventas pinta su propio FAB ("Registrar venta", ver SalesList.tsx)
// desde dentro de la propia pantalla, porque necesita abrir un BottomSheet
// con estado local — el FAB genérico de aquí no puede hacer eso, solo
// navegar. Se suprime aquí, en la capa compartida del layout, para no
// superponer dos botones flotantes en la misma esquina.
export function PageFab() {
  const pathname = usePathname();
  if (pathname === "/ventas") return null;
  return <AddContactFab />;
}
```

## `src/app/(app)/(with-nav)/layout.tsx`

```tsx
import type { ReactNode } from "react";
import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../convex/_generated/api";
import { PageFab } from "@/components/crm/PageFab";
import { BottomNav } from "@/components/crm/BottomNav";
import { getUser } from "@/lib/auth/dal";
import { readSessionToken } from "@/lib/auth/cookie";

// Envuelve Pendientes/Contactos/Panel con la barra inferior + FAB. MIS-12
// añade aquí la lectura de countDueToday para alimentar el badge de
// "Pendientes" del BottomNav — se hace en el layout (no en cada page) para
// que el badge esté visible y actualizado en las 3 pestañas, no solo en
// /pendientes. Fuera de este route group (contactos/nuevo, contactos/[id])
// no se hereda nada de esto — exclusión estructural por carpeta.
//
// await getUser() aquí es redundante con (app)/layout.tsx (que ya redirige
// a /login si no hay sesión) pero barato de repetir: getUser() está
// envuelto en cache() de React, así que dentro de la misma petición no
// vuelve a golpear Convex. Se mantiene por el mismo motivo documentado en
// src/lib/auth/dal.ts — un layout no se re-ejecuta en cada navegación
// entre hermanos (Pendientes↔Contactos↔Panel), así que este badge NO se
// refresca solo con la navegación normal entre tabs; se refresca cuando
// una Server Action (programar/completar un recordatorio) llama a
// refresh(), que sí re-renderiza el árbol completo incluida esta capa
// compartida (ver "Refresh data" / ejemplo del contador de notificaciones
// del header en node_modules/next/dist/docs/01-app/01-getting-started/
// 07-mutating-data.md).
export default async function WithNavLayout({ children }: { children: ReactNode }) {
  await getUser(); // solo chequeo de sesión — MIS-251 retira el gating por rol del FAB (ver abajo)
  const token = await readSessionToken(); // getUser() ya garantiza sesión válida aquí
  const dueTodayCount = await fetchQuery(api.reminders.countDueToday, { token: token! });

  return (
    <>
      <div
        className="flex flex-1 flex-col"
        style={{ paddingBottom: "calc(72px + env(safe-area-inset-bottom))" }}
      >
        {children}
      </div>
      {/* MIS-251 (reapertura): antes solo visible para "rep" (MIS-20) —
          revertido por decisión de negocio (Marta conserva acceso de
          escritura completo, igual que Carlos; ver PLANS/MIS-251-rol-
          supervision-marta.md). createContact ya no exige rol "rep" en el
          servidor, así que mostrarlo a Marta ya no lleva a un callejón sin
          salida. */}
      {/* MIS-259: PageFab suprime este FAB en /ventas — esa pantalla pinta
          el suyo propio ("Registrar venta", ver ventas/SalesList.tsx). */}
      <PageFab />
      <BottomNav dueTodayCount={dueTodayCount} />
    </>
  );
}
```

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

  // MIS-259: listContacts se pide aquí en paralelo (no en SalesList/cliente)
  // para alimentar el selector de contacto de "Registrar venta" sin un
  // round-trip extra — mismo patrón servidor-fetch que los 3 periodos.
  const [month, quarter, year, contacts] = await Promise.all([
    fetchQuery(api.sales.listWonSalesForPeriod, { token: token!, period: "month" }),
    fetchQuery(api.sales.listWonSalesForPeriod, { token: token!, period: "quarter" }),
    fetchQuery(api.sales.listWonSalesForPeriod, { token: token!, period: "year" }),
    fetchQuery(api.contacts.listContacts, { token: token! }),
  ]);

  return (
    <div className="flex flex-1 flex-col" style={{ padding: "16px 20px 24px", gap: 20 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)" }}>Ventas</h1>
        <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>Ventas cerradas y facturación por periodo.</p>
      </div>
      <SalesList month={month} quarter={quarter} year={year} contacts={contacts} />
    </div>
  );
}
```

## `src/app/(app)/(with-nav)/ventas/SalesList.tsx`

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../../../convex/_generated/api";
import { Card } from "@/components/ui/core/Card";
import { Avatar } from "@/components/ui/core/Avatar";
import { BottomSheet } from "@/components/ui/overlays/BottomSheet";
import { formatCurrencyCents, formatDate } from "@/lib/contacts/format";
import { RegisterSaleForm } from "./RegisterSaleForm";

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
type Contact = FunctionReturnType<typeof api.contacts.listContacts>[number];

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
  contacts,
}: {
  month: SalesForPeriod;
  quarter: SalesForPeriod;
  year: SalesForPeriod;
  contacts: Contact[];
}) {
  const [period, setPeriod] = useState<Period>("month");
  // MIS-259: FAB local + hoja propia, mismo mecanismo que
  // ContactDetailView.tsx usa para CloseSaleForm — PageFab.tsx suprime el
  // FAB genérico "Añadir contacto" en esta ruta para no superponerlos.
  const [sheetOpen, setSheetOpen] = useState(false);
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

      {/* MIS-259: FAB propio de Ventas — mismo estilo/posición fijos que
          AddContactFab.tsx, duplicado a propósito (criterio de "cada pieza
          autocontenida" ya establecido en el repo) porque este abre una
          hoja con estado local en vez de navegar. aria-label distinto de
          "Añadir contacto" (sugerencia de la auditoría de plan) para que
          ambos FABs tengan nombres accesibles inequívocos. */}
      <button
        type="button"
        aria-label="Registrar venta"
        onClick={() => setSheetOpen(true)}
        style={{
          position: "fixed",
          right: 16,
          bottom: "calc(88px + env(safe-area-inset-bottom))",
          width: 52,
          height: 52,
          borderRadius: "var(--radius-full)",
          background: "var(--color-accent)",
          color: "var(--color-accent-contrast)",
          border: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 26,
          fontWeight: 300,
          lineHeight: 1,
          cursor: "pointer",
          boxShadow: "0 4px 14px rgba(59,82,102,.4)",
          zIndex: 20,
        }}
      >
        <span aria-hidden="true">+</span>
      </button>

      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Registrar venta">
        <RegisterSaleForm contacts={contacts} onDone={() => setSheetOpen(false)} />
      </BottomSheet>
    </div>
  );
}
```

## `src/app/(app)/(with-nav)/ventas/RegisterSaleForm.tsx`

```tsx
"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../../../convex/_generated/api";
import { Button } from "@/components/ui/core/Button";
import { Input } from "@/components/ui/forms/Input";
import { Avatar } from "@/components/ui/core/Avatar";
import { StatusBadge } from "@/components/ui/feedback/StatusBadge";
import { registerDirectSaleAction, type RegisterDirectSaleState } from "@/lib/contacts/actions";

type Contact = FunctionReturnType<typeof api.contacts.listContacts>[number];

const initialState: RegisterDirectSaleState = undefined;

// Duplicadas de ContactList.tsx a propósito — mismo criterio de
// autocontención ya establecido en el repo (cada formulario/lista trae su
// propio helper de búsqueda en vez de importar uno compartido).
function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

function matches(contact: Contact, query: string): boolean {
  const nameMatch = normalizeText(contact.name).includes(normalizeText(query));
  if (nameMatch) return true;

  const queryDigits = digitsOnly(query);
  if (queryDigits.length === 0) return false;
  return digitsOnly(contact.phone ?? "").includes(queryDigits);
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

// "YYYY-MM-DD" en la zona LOCAL del navegador — duplicado a propósito de
// CloseSaleForm.tsx (cada formulario de este directorio es autocontenido).
function msToDateLocal(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dateLocalToMs(dateLocal: string): number {
  const [y, m, d] = dateLocal.split("-").map(Number);
  if (!y || !m || !d) return NaN;
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

function eurosToCents(eurosLocal: string): number {
  if (!eurosLocal) return NaN;
  const euros = Number(eurosLocal);
  if (!Number.isFinite(euros)) return NaN;
  return Math.round(euros * 100);
}

// MIS-259: formulario de 2 pasos dentro de la misma hoja — paso 1 elige un
// contacto en CUALQUIER estado (incluidos los ya "Ganado", el caso de venta
// repetida que motiva esta tarea), paso 2 son los mismos 3 campos que la
// rama "won" de CloseSaleForm.tsx. Máximo 4 toques: abrir la hoja (fuera de
// este componente) -> buscar/tocar un contacto -> rellenar -> Confirmar.
export function RegisterSaleForm({ contacts, onDone }: { contacts: Contact[]; onDone: () => void }) {
  const [state, formAction, isPending] = useActionState(registerDirectSaleAction, initialState);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [query, setQuery] = useState("");
  const [amountLocal, setAmountLocal] = useState("");
  const [purchaseDateLocal, setPurchaseDateLocal] = useState(() => msToDateLocal(Date.now()));

  useEffect(() => {
    if (state?.success) onDone();
  }, [state, onDone]);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return contacts;
    return contacts.filter((c) => matches(c, q));
  }, [contacts, query]);

  if (selectedContact === null) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Input
          prefix={<SearchIcon />}
          size="sm"
          placeholder="Buscar por nombre o teléfono"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Buscar contacto"
          autoFocus
        />
        {filtered.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--text-secondary)", textAlign: "center", padding: "24px 0" }}>
            Sin resultados
          </p>
        ) : (
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: 2,
              maxHeight: 320,
              overflowY: "auto",
            }}
          >
            {filtered.map((c) => (
              <li key={c._id}>
                <button
                  type="button"
                  onClick={() => setSelectedContact(c)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    width: "100%",
                    padding: "10px 4px",
                    background: "none",
                    border: "none",
                    borderBottom: "1px solid var(--color-border)",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <Avatar name={c.name} size="sm" />
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{c.name}</span>
                    {c.phone && (
                      <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{c.phone}</span>
                    )}
                  </div>
                  <StatusBadge state={c.status} dot={false} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <Button type="button" variant="ghost" full onClick={onDone}>
          Cancelar
        </Button>
      </div>
    );
  }

  const amountCents = eurosToCents(amountLocal);
  const purchaseDateMs = purchaseDateLocal ? dateLocalToMs(purchaseDateLocal) : NaN;

  // Errores generales (p. ej. "Contacto no encontrado", field: "contactId")
  // — se excluyen los 3 fields que ya tienen su propio mensaje inline abajo.
  const generalError =
    state && "error" in state && state.field !== "product" && state.field !== "amountCents" && state.field !== "purchaseDate"
      ? state.error
      : null;

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <input type="hidden" name="contactId" value={selectedContact._id} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 14, color: "var(--text-secondary)" }}>
          Cliente: <strong style={{ color: "var(--text-primary)" }}>{selectedContact.name}</strong>
        </span>
        <button
          type="button"
          onClick={() => setSelectedContact(null)}
          disabled={isPending}
          style={{ background: "none", border: "none", color: "var(--color-accent)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
        >
          Cambiar
        </button>
      </div>
      <Input
        label="Producto o servicio vendido"
        name="product"
        placeholder="Ej.: Plan anual Premium"
        required
        maxLength={200} // mismo límite que PRODUCT_MAX en convex/sales.ts — solo hint de UI
        disabled={isPending}
        error={state && "field" in state && state.field === "product" ? state.error : null}
      />
      <input type="hidden" name="amountCents" value={Number.isFinite(amountCents) ? amountCents : ""} />
      <Input
        label="Importe de la venta"
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0.01"
        suffix="€"
        value={amountLocal}
        onChange={(e) => setAmountLocal(e.target.value)}
        required
        disabled={isPending}
        error={state && "field" in state && state.field === "amountCents" ? state.error : null}
      />
      <input type="hidden" name="purchaseDateMs" value={Number.isFinite(purchaseDateMs) ? purchaseDateMs : ""} />
      <Input
        label="Fecha de la compra"
        type="date"
        value={purchaseDateLocal}
        onChange={(e) => setPurchaseDateLocal(e.target.value)}
        required
        disabled={isPending}
        error={state && "field" in state && state.field === "purchaseDate" ? state.error : null}
      />
      {generalError && (
        <div role="alert" style={{ fontSize: 13, color: "var(--color-danger-fg)" }}>
          {generalError}
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <Button type="button" variant="secondary" full onClick={() => setSelectedContact(null)} disabled={isPending}>
          Atrás
        </Button>
        <Button type="submit" variant="primary" full disabled={isPending}>
          {isPending ? "Guardando…" : "Confirmar"}
        </Button>
      </div>
    </form>
  );
}
```

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
// de hoy (visible en Mes/Trimestre/Año) y otras con fechas claramente
// anteriores al mes/trimestre en curso, para comprobar que el filtro de
// periodo funciona de verdad, no solo que la pantalla carga. Además
// confirma que pulsar una venta abre la ficha del contacto correcto (AC:
// "al pulsar una venta, abre la ficha del contacto").
//
// Ronda 1 (Major de auditoría): la versión original usaba un "15 de
// febrero" fijo como fecha "de un periodo anterior", inestable en
// ejecuciones de enero/febrero.
//
// Ronda 3 (fallo real en CI, no detectado en verificación local): las
// versiones siguientes calculaban monthStart/quarterStart con
// `new Date(year, month, 1)` — construcción que usa el huso horario LOCAL
// del proceso que ejecuta el test. En verificación local (entorno Europe/
// Madrid) coincidía con la frontera que calcula el backend (Madrid-aware,
// ver convex/sales.ts), pero los runners de GitHub Actions corren en UTC
// por defecto — hasta 2h de diferencia en verano, suficiente para que la
// venta "anterior" cayera del lado equivocado de la frontera real y el
// test fallara en CI aunque pasara siempre en local.
//
// Corregido de raíz: en vez de construir fechas de calendario locales
// (ambiguas por huso horario), se usan desplazamientos ABSOLUTOS en días
// desde Date.now() — 32 días (mayor que cualquier mes posible, 28-31
// días) garantiza caer en un mes civil anterior, y 95 días (mayor que
// cualquier trimestre posible, máx. 92 días) garantiza caer en un
// trimestre anterior, en CUALQUIER huso horario del entorno donde corra
// el test, sin necesidad de replicar la lógica Madrid-aware del backend
// aquí.
test("Ventas filtra por periodo y navega a la ficha del contacto al pulsar una venta", async ({ page, context }) => {
  const client = convexClient();
  const token = await sessionTokenFrom(context);
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();

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
    purchaseDate: now,
  });
  if (!thisMonthClose.success) throw new Error("no se pudo cerrar la venta de este mes");

  const earlierName = uniqueContactName("VentaPeriodoAnterior");
  const earlierContact = await client.mutation(api.contacts.createContact, {
    token,
    name: earlierName,
    phone: uniquePhone(),
  });
  if (!earlierContact.success) throw new Error("setup failed");

  const earlierPurchaseDate = now - 32 * ONE_DAY_MS; // mes civil anterior, en cualquier huso horario

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
  // cambiar de pestaña. earlierName (32 días atrás) no sirve aquí: podría
  // seguir cayendo dentro del mismo trimestre. 95 días atrás sí garantiza
  // trimestre civil anterior, en cualquier huso horario.
  const earlierQuarterName = uniqueContactName("VentaTrimestreAnterior");
  const earlierQuarterContact = await client.mutation(api.contacts.createContact, {
    token,
    name: earlierQuarterName,
    phone: uniquePhone(),
  });
  if (!earlierQuarterContact.success) throw new Error("setup failed");

  const earlierQuarterPurchaseDate = now - 95 * ONE_DAY_MS; // trimestre civil anterior, en cualquier huso horario

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

  // Mes (por defecto): solo la venta de este mes.
  await expect(page.getByText(thisMonthName)).toBeVisible();
  await expect(page.getByText(earlierName)).toHaveCount(0);

  // Trimestre: la venta "de este mes" sigue visible (el mes en curso
  // siempre cae dentro del trimestre en curso); la de trimestre anterior
  // queda excluida.
  await page.getByRole("tab", { name: "Trimestre", exact: true }).click();
  await expect(page.getByText(thisMonthName)).toBeVisible();
  await expect(page.getByText(earlierQuarterName)).toHaveCount(0);

  // Año: la venta "de periodo anterior" (32 días atrás) cae dentro del
  // mismo año civil salvo que el test corra en los primeros ~32 días de
  // enero — caso de borde real pero minúsculo, se comprueba la condición,
  // no se asume, para que la aserción sea correcta en cualquier fecha de
  // ejecución.
  const earlierIsSameYear = new Date(earlierPurchaseDate).getUTCFullYear() === new Date(now).getUTCFullYear();
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

// MIS-259: "Registrar venta" (FAB propio de /ventas) permite anotar una
// venta repetida de un contacto que YA está "Ganado" — el gap que motiva la
// tarea (closeSale rechaza cerrar dos veces el mismo contacto). Se conduce
// el flujo real por la UI (FAB -> hoja -> buscar/elegir contacto -> rellenar
// -> Confirmar), condición explícita de la auditoría de plan, no solo se
// invoca la mutation directamente. La primera venta sí se siembra vía
// closeSale (mismo criterio de seeding ya usado en el resto de este
// archivo); es la SEGUNDA la que se registra por la UI nueva.
test("Registrar venta directa permite una segunda venta a un contacto ya Ganado, sin duplicar el cambio de estado", async ({
  page,
  context,
}) => {
  const client = convexClient();
  const token = await sessionTokenFrom(context);

  const name = uniqueContactName("VentaRepetida");
  const created = await client.mutation(api.contacts.createContact, { token, name, phone: uniquePhone() });
  if (!created.success) throw new Error("setup failed");

  const firstClose = await client.mutation(api.sales.closeSale, {
    token,
    contactId: created.id,
    outcome: "won",
    product: "Primera venta",
    amountCents: 10000,
    purchaseDate: Date.now(),
  });
  if (!firstClose.success) throw new Error("no se pudo cerrar la primera venta");

  await page.goto("/ventas");
  await page.getByRole("button", { name: "Registrar venta" }).click();

  const dialog = page.getByRole("dialog", { name: "Registrar venta" });
  await dialog.getByRole("textbox", { name: "Buscar contacto" }).fill(name);
  const row = dialog.locator("button").filter({ hasText: name });
  await expect(row).toBeVisible();
  // El picker muestra el estado de cada contacto (StatusBadge) — confirma
  // que se ve a simple vista que este contacto ya está "Ganado", el caso de
  // venta repetida que motiva la tarea.
  await expect(row.getByText("Ganado")).toBeVisible();
  await row.click();

  await dialog.getByLabel("Producto o servicio vendido").fill("Segunda venta");
  await dialog.getByLabel("Importe de la venta").fill("50");
  // "Fecha de la compra" ya viene precargada a hoy por defecto.
  await dialog.getByRole("button", { name: "Confirmar" }).click();
  await expect(dialog).toBeHidden();

  // Ambas ventas visibles en el listado (filas independientes, mismo
  // contacto) y el resumen las cuenta a las dos. Se escopa por el nombre
  // (único por ejecución) en vez de por el texto del producto a secas: el
  // deployment de dev compartido acumula ventas de ejecuciones anteriores de
  // este mismo test, y "Primera venta"/"Segunda venta" no son textos únicos
  // por sí solos (a diferencia del nombre del contacto).
  const contactSaleRows = page.getByRole("link").filter({ hasText: name });
  await expect(contactSaleRows.filter({ hasText: "Primera venta" })).toBeVisible();
  await expect(contactSaleRows.filter({ hasText: "Segunda venta" })).toBeVisible();

  const closures = await client.query(api.sales.listSaleClosures, { token, contactId: created.id });
  expect(closures).toHaveLength(2);

  // No se duplica el cambio de estado: solo la fila "won" original de
  // closeSale, ninguna nueva "won" -> "won" generada por la venta repetida
  // (decisión de diseño de registerDirectSale, ver convex/sales.ts).
  const statusChanges = await client.query(api.contacts.listStatusChanges, { token, contactId: created.id });
  expect(statusChanges).toHaveLength(1);
});

// MIS-259: sobre un contacto todavía en pipeline (nunca cerrado), Registrar
// venta directa también funciona y lo pasa a "Ganado" — mismo efecto que
// "Cerrar venta" tendría, pero disparado desde /ventas en vez de la ficha.
test("Registrar venta directa sobre un contacto en pipeline abierto lo marca como Ganado", async ({ page, context }) => {
  const client = convexClient();
  const token = await sessionTokenFrom(context);

  const name = uniqueContactName("VentaDirectaPipeline");
  const created = await client.mutation(api.contacts.createContact, { token, name, phone: uniquePhone() });
  if (!created.success) throw new Error("setup failed");

  await page.goto("/ventas");
  await page.getByRole("button", { name: "Registrar venta" }).click();

  const dialog = page.getByRole("dialog", { name: "Registrar venta" });
  await dialog.getByRole("textbox", { name: "Buscar contacto" }).fill(name);
  const row = dialog.locator("button").filter({ hasText: name });
  await expect(row).toBeVisible();
  // Contacto recién creado: estado inicial "Lead nuevo", no "Ganado" — a
  // diferencia del test anterior.
  await expect(row.getByText("Lead nuevo")).toBeVisible();
  await row.click();

  await dialog.getByLabel("Producto o servicio vendido").fill("Venta directa sin pasar por pipeline");
  await dialog.getByLabel("Importe de la venta").fill("75");
  await dialog.getByRole("button", { name: "Confirmar" }).click();
  await expect(dialog).toBeHidden();

  await page.goto(`/contactos/${created.id}`);
  await expect(page.getByText("Ganado", { exact: true })).toBeVisible();
  await expect(page.getByText(/Venta ganada: Venta directa sin pasar por pipeline/)).toBeVisible();
});

// MIS-259 (condición de la auditoría de plan): comprobación real en
// navegador de que el paso 1 (buscador + lista de contactos) del formulario
// "Registrar venta" no desborda en 320px — mismo criterio ya establecido en
// este archivo para Pendientes y Ventas.
test("El paso de elegir contacto de Registrar venta no desborda horizontalmente en 320px", async ({ page, context }) => {
  const client = convexClient();
  const token = await sessionTokenFrom(context);

  const name = uniqueContactName("Viewport320RegistrarVenta");
  const created = await client.mutation(api.contacts.createContact, { token, name, phone: uniquePhone() });
  if (!created.success) throw new Error("setup failed");

  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/ventas");
  await page.getByRole("button", { name: "Registrar venta" }).click();

  const dialog = page.getByRole("dialog", { name: "Registrar venta" });
  await dialog.getByRole("textbox", { name: "Buscar contacto" }).fill(name);
  await expect(dialog.locator("button").filter({ hasText: name })).toBeVisible();

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBe(overflow.clientWidth);
});
```


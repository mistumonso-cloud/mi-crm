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

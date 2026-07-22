import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireRole, requireUser } from "./lib/authz";

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
    // Solo "rep" (Carlos) puede cerrar una venta — condición YA CERRADA por
    // el ADR de MIS-18 (PLANS/MIS-18-navegacion-principal.md, "Qué NO
    // cambia"): "cierre de venta en MIS-15... sigue debiendo llamar
    // [requireRole] como primera línea, sin excepción."
    const user = await requireRole(ctx, args.token, "rep");

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

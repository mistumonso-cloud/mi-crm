# MIS-15 — Registro de cierre de venta (ganada o perdida) (v2)

## Respuesta a la auditoría de plan v1 → v2

**Veredicto v1: NO-GO** (2 majors, 2 sugerencias no bloqueantes).

| # | Auditoría | Resolución |
|---|---|---|
| Major 1 | El AC dice literalmente "El panel de oportunidades de Marta refleja correctamente el cierre", pero el plan no toca `panel/page.tsx` y la verificación solo comprobaba el modelo de datos "indirectamente". | **Decisión de alcance explícita** (nueva decisión 13): `src/app/(app)/(with-nav)/panel/page.tsx` (líneas 4-6) ya contiene, desde antes de este ticket, el comentario `// Placeholder — lo sustituye MIS-17 (Pantalla: Panel de oportunidades)` — la pantalla `/panel` está asignada explícitamente a MIS-17, no a MIS-15. MIS-15 satisface la mitad de esa frase del AC que le corresponde: deja la venta registrada "en el modelo de ventas cerradas / oportunidades perdidas, **para que Marta pueda verlo en el panel**" (cita literal) — construye el dato del que MIS-17 depende funcionalmente. Construir aquí una "integración mínima del panel" duplicaría/prejuzgaría decisiones de diseño que son el objeto completo de MIS-17. Verificación corregida para no afirmar que se probó el panel, sino que el modelo queda listo para que MIS-17 lo consuma sin trabajo adicional. |
| Major 2 | `closeSale` cambia `contacts.status` (`ctx.db.patch`) sin insertar en `statusChanges`, rompiendo el invariante establecido por MIS-14 (todo cambio de estado queda registrado en `statusChanges`, ver `convex/contacts.ts:225`). | **Corregido**: `closeSale` inserta ahora también en `statusChanges` (`fromStatus` = estado del contacto antes del cierre, `toStatus: args.outcome`, `changedBy: user.id`, `changedAt: closedAt` — mismo timestamp que la fila de `saleClosures`) inmediatamente antes del `ctx.db.patch`. Efecto intencional: cerrar una venta ahora produce dos entradas de historial correlacionadas — "Cambio de estado: X → Ganado/Perdido" (ya renderizado por código existente sin cambios) y "Venta ganada/perdida: ..." — información distinta y complementaria, no redundante. |
| Media | La verificación (paso 4 de v1) afirmaba que "Cerrar venta" **y** "Cambiar estado" desaparecen tras cerrar — contradice la propia decisión 4 (el botón "Cambiar estado" no lleva `!isClosed`, permanece visible para reabrir el contacto, tal como estableció MIS-14). | **Adoptado** — corregido en la sección de verificación: solo "Cerrar venta" desaparece; "Cambiar estado" sigue disponible. |
| Baja | Los pasos de "producto vacío"/"motivo vacío" no distinguían que el atributo `required` del navegador bloquea el envío antes de llegar al servidor. | **Adoptado** — la verificación aclara que ese paso comprueba el bloqueo nativo del navegador, y se añaden pasos explícitos de validación de servidor invocando `sales:closeSale` directamente con `product: ""` / `lossReason: ""`. |

No se reabre ninguna otra decisión de alcance (catálogo de productos, divisa EUR, contactos `won`/`lost` sin fila de venta, etc.) — no fueron objetadas por esta auditoría.

## Contexto

### Texto literal del ticket (Linear, `MIS-15`)

> Implementar la acción de cerrar una oportunidad de venta: marcarla como ganada o como perdida, registrando la información necesaria en cada caso.
>
> **Flujo para cerrar una venta:** Desde la ficha del contacto, Carlos pulsa "Cerrar venta". Se le presentan dos opciones:
>
> **Opción A — Venta ganada:** Producto o servicio vendido (selector del catálogo de productos, o campo de texto libre si no está en el catálogo); Importe de la venta; Fecha de la compra (por defecto: hoy). Al confirmar: el estado del contacto pasa a `Comprado` y la venta queda registrada.
>
> **Opción B — Venta perdida:** Motivo de pérdida (campo de texto libre): "Precio demasiado alto", "Eligió a la competencia", "Perdió el interés", etc. Al confirmar: el estado del contacto pasa a `Descartado` y el motivo queda registrado.
>
> **Qué queda registrado:** En ambos casos, el cierre queda en el historial de actividad del contacto y en el modelo de ventas cerradas / oportunidades perdidas, para que Marta pueda verlo en el panel.
>
> **Fuera del MVP:** sin facturación/pagos, sin seguimiento post-compra automático, sin informes de ventas por período.
>
> **Criterio de aceptación:** Carlos puede cerrar una venta (ganada o perdida) desde la ficha del contacto. Al cerrar como ganada: se registra producto, importe y fecha; el estado pasa a `Comprado`. Al cerrar como perdida: se registra el motivo; el estado pasa a `Descartado`. El cierre aparece en el historial de actividad del contacto. El panel de oportunidades de Marta refleja correctamente el cierre.

### Confirmación de que es la tarea correcta

Verificado con evidencia cruzada (Linear MCP + `PLANS/README.md` + `CODIGO/README.md` + `git log`): MIS-7 a MIS-14 están instalados, mergeados y desplegados; no existe ningún commit, rama ni archivo de plan/código para MIS-15/16/17. MIS-15 pertenece a "Fase 4 — Pipeline y cierre de ventas" (misma fase que MIS-14, ya 100% cerrada); MIS-16/17 pertenecen a "Fase 5". Sin relaciones de bloqueo formal en Linear, pero el orden por fases y la dependencia funcional real (MIS-17 necesita los datos de venta que crea este ticket) confirman que MIS-15 es el siguiente pendiente correcto.

### Naming: `Comprado`/`Descartado` (ticket) vs. `won`/`lost` (código) vs. "Ganado"/"Perdido" (`StatusBadge.jsx`)

Ya resuelto por MIS-14 y sin reabrir aquí: `contacts.status` usa los literales `won`/`lost`; `StatusBadge.jsx` (`PIPELINE_STATES`) muestra "Ganado"/"Perdido" en producción desde MIS-9. Este plan sigue el mismo criterio — se reutilizan `won`/`lost` y no se toca `StatusBadge.jsx`.

### Punto de partida: qué ya existe y qué falta

`ContactDetailView.tsx` ya tiene desde MIS-11/12/14 todo el andamiaje de la hoja "Cerrar venta" salvo su contenido real: `type SheetKind` ya incluye `"close"`, `SHEET_TITLES.close = "Cerrar venta"`, el botón que abre la hoja ya existe, y `isClosed` ya oculta ese botón cuando el contacto está `won`/`lost`. Hoy la rama `sheet === "close"` cae en el `else` genérico ("Disponible próximamente") que comparte con `sheet === null`. Este plan sustituye **solo esa rama**, sin tocar `"note"`/`"schedule"`/`"status"`.

No existe ninguna tabla de ventas, cierres u oportunidades en `convex/schema.ts`, ni catálogo de productos en ningún punto del repo (confirmado por búsqueda exhaustiva). Este ticket crea la tabla desde cero.

### Verificación técnica previa (hecha antes de aprobar este plan)

Antes de dar este diseño por bueno se comprobó directamente contra el repo y `node_modules`:

- `defineTable(v.union(v.object(...), v.object(...)))` es una capacidad **oficialmente documentada** de Convex — `node_modules/convex/dist/cjs-types/server/schema.d.ts` incluye el ejemplo literal "Discriminated union table" con exactamente este patrón. `TableDefinition.index()` restringe sus argumentos a `ExtractFieldPaths<DocumentType>`, que para un `VUnion` es la unión de los `fieldPaths` de todos sus miembros — `contactId`/`closedAt`, presentes en ambos miembros, son índices válidos.
- `Button.jsx`/`.d.ts` soporta `variant="danger"`; `Input.jsx`/`.d.ts` soporta `error`/`suffix`/`label` y pasa el resto de props (`type="number"`, `type="date"`, `min`, `step`, `inputMode`) vía spread.
- El diff propuesto se confirmó línea a línea contra los archivos reales instalados (`src/lib/contacts/actions.ts`, `ContactDetailView.tsx`, `src/lib/contacts/format.ts`, `page.tsx`) — nombres de props, patrón `err.data === "No autorizado"`, `FunctionReturnType`, orden de campos en `Promise.all`, todo coincide.
- No existe componente `Textarea` reutilizable — `AddNoteForm.tsx` resuelve su campo largo con un `<textarea>` manual con estilos inline; este plan replica ese mismo bloque para "Motivo de pérdida".

## Decisiones fijadas

1. **Nueva tabla `saleClosures` modelada como unión discriminada real a nivel de schema** (`v.union(v.object(...), v.object(...))` dentro de `defineTable`), no como una fila con campos opcionales sueltos al estilo `statusChanges`. Justificación: en `statusChanges` los dos campos (`fromStatus`/`toStatus`) tienen **siempre** el mismo shape sea cual sea su valor — encajaba bien como campos simples. Aquí, en cambio, "ganada" necesita producto+importe+fecha y "perdida" necesita un motivo — no hay ningún campo de negocio compartido entre ambos casos salvo `contactId`/`closedBy`/`closedAt`. Modelarlo con todos los campos opcionales permitiría **estados imposibles** en la propia base de datos (una fila `won` con `lossReason` relleno, o una fila `lost` sin `lossReason`) que solo la validación de aplicación evitaría. Convex soporta de forma nativa `defineTable(v.union(v.object(...), v.object(...)))` — es el ejemplo oficial documentado en la propia librería — así que se usa esa capacidad: el propio schema de Convex rechaza en el momento de la escritura cualquier combinación de campos que no encaje en una de las dos formas válidas, no solo la mutation que la inserta. Índice `by_contact` sigue funcionando: `contactId`/`closedAt` están presentes en ambos miembros de la unión.

2. **Módulo nuevo `convex/sales.ts`, no se amplía `convex/contacts.ts`.** MIS-15 crea una tabla nueva de cero — mismo criterio que ya separó `notes.ts` y `reminders.ts` de `contacts.ts` cuando cada uno introdujo su propia tabla, en vez de seguir haciendo crecer un único archivo (`contacts.ts` ya tiene 274 líneas). Que `closeSale` necesite hacer `ctx.db.patch` sobre la tabla `contacts` no es un problema de "propiedad" de módulo: `ctx.db` es un objeto compartido entre todas las funciones del deployment, sin ACL por archivo — es exactamente el mismo mecanismo que ya usa `changeContactStatus` (en `contacts.ts`) para escribir en `statusChanges`.

3. **Rol: `requireRole(ctx, token, "rep")`, primera línea del handler, sin excepción.** Condición **ya cerrada**, no es una decisión nueva de este plan: el ADR de `PLANS/MIS-18-navegacion-principal.md` ("Qué NO cambia") nombra explícitamente "cierre de venta en MIS-15" junto a "cambio de estado en MIS-14" como operaciones que siguen debiendo llamar `requireRole` como primera línea.

4. **El botón "Cerrar venta" pasa a gatearse por el mismo `canChangeStatus` que ya gatea "Cambiar estado"** (se corrige la inconsistencia detectada), en vez de introducir una prop nueva. Razonamiento: hoy "Cerrar venta" es visible para Marta (supervisor) sin ningún gating — con `closeSale` exigiendo `requireRole(ctx, token, "rep")`, si Marta lo pulsara llegaría a rellenar todo el formulario y solo al confirmar recibiría un error `"No autorizado"` (redirección de vuelta a la ficha) — exactamente el tipo de callejón sin salida que MIS-14 evitó gateando "Cambiar estado" con la misma lógica. `canChangeStatus` ya significa, en la práctica, "este usuario puede ejecutar acciones de pipeline reservadas a rep" (`user.role === "rep"`) — es semánticamente correcto reutilizarlo para una segunda acción rep-only, y evita ensanchar la superficie de cambio sobre código ya instalado y auditado (no se renombra la prop; se documenta con un comentario en el punto de uso). Se consideró renombrarla a algo más genérico (p. ej. `canManagePipeline`) y se descartó: el rename no lo pide el AC y amplía el diff sobre código ya en producción sin beneficio funcional.

5. **Caso de borde heredado de MIS-14 — contactos `won`/`lost` sin fila de venta** (alcanzados vía "Cambiar estado", que permite cualquier-estado-a-cualquier-estado sin datos adicionales): se **acepta como deuda documentada, sin cambiar el comportamiento de `isClosed`**. Un contacto así seguirá sin poder "completar los datos de venta" a posteriori desde la UI — "Cerrar venta" permanece oculto mientras `isClosed` sea verdadero, exactamente igual que hoy. Justificación: el AC de MIS-15 no pide manejar este caso (solo describe el flujo desde un contacto no cerrado); introducir una vía para "completar retroactivamente" un cierre sin datos sería una funcionalidad nueva no pedida por ningún ticket (scope creep), y contradice el criterio ya aplicado en el propio plan de MIS-14 ante un problema estructuralmente idéntico (`"inactive"` sin vía de entrada: "se mantiene así, sin abrir una vía nueva").

6. **Un contacto puede tener más de una fila en `saleClosures` a lo largo del tiempo.** No hay ninguna restricción que lo impida: tras cerrarse (`won`/`lost`), "Cambiar estado" (MIS-14) permite volver a un estado no cerrado, y desde ahí "Cerrar venta" vuelve a estar disponible y puede insertar una segunda fila. Es coherente con el modelo append-only ya aceptado para `statusChanges`. `listSaleClosures` devuelve **todas** las filas de un contacto, no solo la última — el historial de la ficha las mostrará todas, en orden cronológico inverso.

7. **Catálogo de productos: fuera de alcance, campo de texto libre único.** Confirmado que no existe tabla ni campo de catálogo en ningún punto del repo. El AC contempla el texto libre como *fallback* cuando el producto "no está en el catálogo" — al no existir catálogo, el texto libre es hoy la única vía posible, no una alternativa a un selector.

8. **Importe almacenado en céntimos de euro (entero), no en euros (float).** Evita el problema clásico de precisión de coma flotante (`0.1 + 0.2 !== 0.3`) en cualquier suma futura (p. ej. un total agregado en el panel de MIS-17). El formulario captura euros (`<input type="number" step="0.01">`) y convierte a céntimos **en el cliente** antes de enviar — mismo criterio exacto que `dueDateMs` en `ScheduleReminderForm.tsx`: el servidor nunca reparsea el string original, solo valida el número entero ya calculado.

9. **Fecha de compra: mismo patrón que `dueAt` de recordatorios** (`<input type="date">`, conversión local→epoch ms en el cliente vía `new Date(y, m-1, d, ...)`, nunca `new Date("YYYY-MM-DD")`). Por defecto, hoy. **Sin restricción de "no futuro" ni "no pasado"**: el AC solo pide un default, no una validación de rango.

10. **Distinción "ganada" vs. "perdida" en el formulario: estado local de React de dos pasos, no dos submit-buttons homogéneos.** El patrón multi-submit-button de `ChangeStatusForm.tsx`/`CompleteReminderButton.tsx` funciona porque todas las opciones comparten el mismo shape de campo. Aquí las dos opciones tienen conjuntos de campos completamente distintos. Se usa `useState<"won" | "lost" | null>(null)`: paso 1 (`outcome === null`) muestra dos botones grandes que solo cambian el estado local (no son `submit`); paso 2 muestra los campos de la opción elegida dentro de un único `<form>` con `<input type="hidden" name="outcome" value={outcome}>` y un solo botón `type="submit"` ("Confirmar"), más un botón "Atrás" que vuelve al paso 1. Flujo de máximo 3 toques.

11. **Validación de `outcome` en la Server Action: `array.includes(value as Literal)`, no comparación de igualdad directa contra un `string`.** Se aplica explícitamente la lección de la auditoría de plan v1→v2 de MIS-14: comparar un valor `string` con `!==`/`===` contra literales no estrecha su tipo a una unión finita en TypeScript. Se usa el patrón ya corregido y validado: `SALE_OUTCOMES.includes(outcomeRaw as (typeof SALE_OUTCOMES)[number])` seguido de `const outcome = outcomeRaw as (typeof SALE_OUTCOMES)[number];`.

12. **`CloseSaleState.field` es superset exacto de `closeSale`'s `result.field`.** El `field` de retorno de `closeSale` (`"contactId" | "product" | "amountCents" | "purchaseDate" | "lossReason" | undefined`) es subconjunto directo del `field` de `CloseSaleState` (que además admite `"outcome"`, solo alcanzable en la validación local de la Server Action) — la asignación `field: result.field` en el `return` final es directa bajo `strict: true`, sin necesitar cast ni ternario de estrechamiento.

13. **El panel de oportunidades de Marta (`/panel`) es responsabilidad de MIS-17, no de MIS-15** (añadida en v2, en respuesta a la auditoría). `src/app/(app)/(with-nav)/panel/page.tsx` ya contiene, desde antes de este ticket, el comentario `// Placeholder — lo sustituye MIS-17 (Pantalla: Panel de oportunidades)` — el propio código ya asigna esa pantalla a MIS-17 (Fase 5), independientemente de este plan. El AC de MIS-15 ("el panel... refleja correctamente el cierre") se satisface en la parte que le corresponde a este ticket: dejar la venta "registrada... en el modelo de ventas cerradas / oportunidades perdidas, para que Marta pueda verlo en el panel" (cita literal del ticket) — es decir, `saleClosures` + `listSaleClosures` + `contacts.status` correctamente actualizado dejan el dato persistido y consultable para MIS-17, sin cambiar el shape base de datos que ese ticket necesitará (MIS-17 probablemente añadirá su propio índice/query de agregación sobre `saleClosures`, ver "Puntos abiertos" — eso es trabajo de MIS-17, no ausencia de trabajo). Construir aquí cualquier fragmento de UI del panel duplicaría/prejuzgaría decisiones de diseño (qué agregados mostrar, cómo navegar por estado) que son el objeto íntegro de MIS-17, no una integración "mínima".

## `convex/schema.ts` (EDITAR)

Se añade inmediatamente después de la tabla `statusChanges`:

```ts
// MIS-15: registro inmutable de cada cierre de venta (ganada o perdida) de
// un contacto — AC: "el cierre queda en el historial de actividad del
// contacto y en el modelo de ventas cerradas / oportunidades perdidas".
// Tabla append-only, mismo patrón que statusChanges/notes: nunca se
// actualiza una fila tras insertarla.
//
// A diferencia de statusChanges (fromStatus/toStatus SIEMPRE presentes, el
// mismo shape exista o no el valor), aquí "ganada" y "perdida" no comparten
// ningún campo de negocio: modelar esto con campos opcionales sueltos
// permitiría estados imposibles (una fila "won" con lossReason, o una fila
// "lost" sin él) que solo la validación de aplicación evitaría. En su lugar
// se usa el documento de la tabla como UNIÓN DISCRIMINADA real
// (v.union de dos v.object) — Convex lo soporta de forma nativa en
// defineTable (ver node_modules/convex/dist/cjs-types/server/schema.d.ts,
// ejemplo oficial de la propia librería): el propio esquema de Convex
// rechaza en el momento de la escritura cualquier documento que no encaje
// exactamente en una de las dos formas válidas.
//
// Un contacto puede tener MÁS DE UNA fila aquí a lo largo del tiempo: tras
// cerrarse, "Cambiar estado" (MIS-14) permite volver a un estado no cerrado
// y "Cerrar venta" vuelve a estar disponible — es intencional, mismo
// criterio que permite múltiples filas por contacto en statusChanges.
saleClosures: defineTable(
  v.union(
    v.object({
      contactId: v.id("contacts"),
      outcome: v.literal("won"),
      // Producto o servicio vendido — texto libre siempre: no existe
      // catálogo de productos en el repo (confirmado, ver PLANS/
      // MIS-15-registro-cierre-venta.md, "Puntos abiertos"), así que el
      // fallback de texto libre que contempla el AC ("o campo de texto
      // libre si no está en el catálogo") es hoy la ÚNICA vía.
      product: v.string(),
      // Importe en CÉNTIMOS de euro (entero) — nunca un float de euros:
      // evita el problema de precisión de coma flotante al sumar importes
      // (0.1 + 0.2 !== 0.3), relevante para cualquier agregado futuro del
      // panel de Marta (MIS-17). El formulario captura euros y convierte a
      // céntimos en el CLIENTE — el servidor nunca reparsea un string de
      // importe, solo valida el entero ya calculado (mismo criterio que
      // dueAt/dueDateMs en reminders).
      amountCents: v.number(),
      // epoch ms — medianoche LOCAL del día civil elegido (mismo criterio
      // que dueAt en reminders), default "hoy" en el formulario. Puede
      // diferir de closedAt si se registra una venta con fecha de compra
      // pasada.
      purchaseDate: v.number(),
      closedBy: v.id("users"),
      closedAt: v.number(), // epoch ms, Date.now() del servidor — nunca editable por el cliente
    }),
    v.object({
      contactId: v.id("contacts"),
      outcome: v.literal("lost"),
      // Motivo de pérdida — texto libre (AC: "Precio demasiado alto",
      // "Eligió a la competencia", "Perdió el interés" son solo ejemplos,
      // no un enum cerrado).
      lossReason: v.string(),
      closedBy: v.id("users"),
      closedAt: v.number(),
    }),
  ),
)
  // Ficha del contacto: recuperar todos los cierres de UN contacto,
  // ordenados. contactId/closedAt están presentes en ambos miembros de la
  // unión, así que el índice es válido sobre el conjunto completo.
  .index("by_contact", ["contactId", "closedAt"]),
```

Nota: no se añade ningún índice adicional (p. ej. por `outcome` o cross-contacto) todavía — mismo criterio que MIS-14 aplicó a `statusChanges`. El panel de Marta (MIS-17, sin construir) probablemente necesitará un índice por `outcome`/`closedAt` — se añadirá entonces, con un consumidor real.

## `convex/sales.ts` (NUEVO)

```ts
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
// paso — inserta el registro de cierre y actualiza contacts.status,
// idéntico en estructura a changeContactStatus (convex/contacts.ts), pero
// con validación de campos adicional según outcome.
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
    // intencionalmente (ver decisión 6 y "Puntos abiertos").
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
    // convex/contacts.ts:225). closeSale también cambia el estado (a "won"
    // o "lost"), así que también debe insertar aquí, con el mismo
    // closedAt que la fila de saleClosures de arriba — ambas filas del
    // mismo cierre quedan correlacionadas por timestamp. Efecto: cerrar
    // una venta produce DOS entradas de historial (Cambio de estado +
    // Venta ganada/perdida), información distinta y complementaria.
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
```

## `src/lib/contacts/format.ts` (EDITAR)

Nueva función, añadida al final del archivo:

```ts
// Importe en euros a partir de céntimos (ver amountCents en
// convex/schema.ts, tabla saleClosures — MIS-15). Nunca se formatea un
// float de euros directamente: los céntimos son la fuente de verdad exacta,
// se dividen entre 100 solo en el momento de mostrar. Mismo locale "es-ES"
// que el resto de formatters de este archivo, por consistencia visual;
// currency "EUR" fijo — asunción de un solo país, igual que timeZone
// "Europe/Madrid" en formatDateTime/formatDate.
export function formatCurrencyCents(amountCents: number): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(amountCents / 100);
}
```

## `src/lib/contacts/actions.ts` (EDITAR)

Nuevo tipo y nueva Server Action, añadidos al final del archivo (el import de `api` ya cubre `api.sales.closeSale`, expone todos los módulos de `convex/`):

```ts
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
    // requireRole(ctx, token, "rep") — ConvexError("No autenticado") si la
    // sesión se revocó/expiró entre cargar la ficha y confirmar, o
    // ConvexError("No autorizado") si Marta fuerza la request saltándose el
    // gating de UI (ver ContactDetailView.tsx, canChangeStatus reutilizada
    // también para "Cerrar venta" — decisión 4 del plan). Mismo patrón que
    // changeStatusAction: hay un contactId concreto, se redirige de vuelta
    // a esa misma ficha en vez de a "/contactos".
    if (err instanceof ConvexError) {
      redirect(err.data === "No autorizado" ? `/contactos/${contactId}` : "/login");
    }
    throw err;
  }

  if (!result.success) {
    return { success: false, error: result.error, field: result.field };
  }

  refresh(); // Next 16: re-renderiza /contactos/[id] en la MISMA respuesta — mismo patrón que changeStatusAction
  return { success: true };
}
```

Nota sobre `field: result.field` (última rama de error): a diferencia de `changeStatusAction`, que estrecha el campo devuelto con un ternario, aquí se asigna directamente. Es seguro porque el tipo de `result.field` ya es subconjunto exacto del tipo `field` de `CloseSaleState` (ver decisión 12) — no hace falta estrechar nada.

## `src/app/(app)/contactos/[id]/CloseSaleForm.tsx` (NUEVO)

```tsx
"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/core/Button";
import { Input } from "@/components/ui/forms/Input";
import { closeSaleAction, type CloseSaleState } from "@/lib/contacts/actions";

const initialState: CloseSaleState = undefined;

// "YYYY-MM-DD" en la zona LOCAL del navegador — duplicado a propósito de
// ScheduleReminderForm.tsx (cada formulario de este directorio es
// autocontenido, mismo criterio que la duplicación de isValidEpochMs entre
// convex/ y src/lib/).
function msToDateLocal(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Mismo motivo que dateLocalToMs en ScheduleReminderForm.tsx: new
// Date("YYYY-MM-DD") se interpretaría como medianoche UTC. Se calcula en el
// NAVEGADOR — la Server Action nunca reparsea el string.
function dateLocalToMs(dateLocal: string): number {
  const [y, m, d] = dateLocal.split("-").map(Number);
  if (!y || !m || !d) return NaN;
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

// input type="number" expone siempre su .value con "." como separador
// decimal en el DOM (HTML Standard, independiente del locale de
// visualización del navegador) — Number(...) directo es seguro, sin
// normalizar comas. Math.round evita que un resultado con error de coma
// flotante (p. ej. 15.005 * 100 = 1500.4999999999998) produzca céntimos no
// enteros.
function eurosToCents(eurosLocal: string): number {
  if (!eurosLocal) return NaN;
  const euros = Number(eurosLocal);
  if (!Number.isFinite(euros)) return NaN;
  return Math.round(euros * 100);
}

type Outcome = "won" | "lost";

// Flujo de 2 pasos dentro de la misma hoja (AC: "se le presentan dos
// opciones"). Paso 1 (outcome === null): dos botones grandes que solo
// cambian estado local, no son submit. Paso 2 (outcome elegido): un único
// <form> con los campos de esa opción + "Confirmar", más "Atrás" para
// volver al paso 1 sin cerrar la hoja. Máximo 3 toques: abrir la hoja
// (fuera de este componente) -> elegir Ganada/Perdida -> Confirmar.
export function CloseSaleForm({ contactId, onDone }: { contactId: string; onDone: () => void }) {
  const [state, formAction, isPending] = useActionState(closeSaleAction, initialState);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // Controlados SOLO donde hace falta cómputo derivado (importe -> céntimos,
  // fecha -> epoch ms) — mismo criterio que dueDateLocal en
  // ScheduleReminderForm.tsx. product/lossReason son campos no controlados
  // (name + validación en el servidor), mismo criterio que reason en ese
  // mismo formulario.
  const [amountLocal, setAmountLocal] = useState("");
  const [purchaseDateLocal, setPurchaseDateLocal] = useState(() => msToDateLocal(Date.now()));

  useEffect(() => {
    if (state?.success) onDone();
  }, [state, onDone]);

  if (outcome === null) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Button variant="primary" full onClick={() => setOutcome("won")}>
          Venta ganada
        </Button>
        <Button variant="danger" full onClick={() => setOutcome("lost")}>
          Venta perdida
        </Button>
        <Button type="button" variant="ghost" full onClick={onDone}>
          Cancelar
        </Button>
      </div>
    );
  }

  const amountCents = eurosToCents(amountLocal);
  const purchaseDateMs = purchaseDateLocal ? dateLocalToMs(purchaseDateLocal) : NaN;

  // Errores de campo específico ya se muestran junto a su Input/textarea;
  // este bloque cubre solo errores generales (p. ej. "Este contacto ya
  // tiene una venta cerrada", field: "contactId") — se excluyen aquí los
  // 4 fields que YA tienen su propio mensaje inline más abajo.
  const generalError =
    state && "error" in state &&
    state.field !== "product" &&
    state.field !== "amountCents" &&
    state.field !== "purchaseDate" &&
    state.field !== "lossReason"
      ? state.error
      : null;

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <input type="hidden" name="contactId" value={contactId} />
      <input type="hidden" name="outcome" value={outcome} />
      {outcome === "won" ? (
        <>
          <Input
            label="Producto o servicio vendido"
            name="product"
            placeholder="Ej.: Plan anual Premium"
            required
            maxLength={200} // mismo límite que PRODUCT_MAX en convex/sales.ts — solo hint de UI, la mutation es la autoridad real
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
          <input
            type="hidden"
            name="purchaseDateMs"
            value={Number.isFinite(purchaseDateMs) ? purchaseDateMs : ""}
          />
          <Input
            label="Fecha de la compra"
            type="date"
            value={purchaseDateLocal}
            onChange={(e) => setPurchaseDateLocal(e.target.value)}
            required
            disabled={isPending}
            error={state && "field" in state && state.field === "purchaseDate" ? state.error : null}
          />
        </>
      ) : (
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>Motivo de pérdida</span>
          <textarea
            name="lossReason"
            placeholder='Ej.: "Precio demasiado alto", "Eligió a la competencia"...'
            required
            rows={3}
            maxLength={200} // mismo límite que LOSS_REASON_MAX en convex/sales.ts
            disabled={isPending}
            style={{
              width: "100%",
              padding: "10px 12px",
              fontFamily: "var(--font-sans)",
              fontSize: 14,
              color: "var(--text-primary)",
              background: isPending ? "var(--color-muted)" : "var(--color-surface)",
              border: "1px solid var(--color-border-strong)",
              borderRadius: "var(--radius-md)",
              outline: "none",
              resize: "vertical",
            }}
          />
          {state && "field" in state && state.field === "lossReason" && (
            <span style={{ fontSize: 12, color: "var(--color-danger-fg)" }}>{state.error}</span>
          )}
        </label>
      )}
      {generalError && (
        <div role="alert" style={{ fontSize: 13, color: "var(--color-danger-fg)" }}>
          {generalError}
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <Button type="button" variant="secondary" full onClick={() => setOutcome(null)} disabled={isPending}>
          Atrás
        </Button>
        <Button type="submit" variant={outcome === "won" ? "primary" : "danger"} full disabled={isPending}>
          {isPending ? "Guardando…" : "Confirmar"}
        </Button>
      </div>
    </form>
  );
}
```

**Nota de comportamiento documentada (no un bug):** si Carlos pulsa "Atrás" y vuelve a elegir la misma opción, el importe y la fecha se conservan (viven en `useState` del componente), pero el producto/motivo de pérdida se resetean — son campos no controlados y su rama del JSX se desmonta/remonta al cambiar `outcome`. Aceptado como comportamiento menor no bloqueante.

## `src/lib/notes/history.ts` (EDITAR)

```ts
import type { NoteType } from "./types";
import type { ContactStatus } from "@/lib/contacts/status";

export type HistoryEntry =
  | { key: string; kind: "created"; timestamp: number }
  | { key: string; kind: "initialNote"; timestamp: number; text: string }
  | { key: string; kind: "note"; timestamp: number; type: NoteType; text: string; authorName: string }
  | { key: string; kind: "reminderDone"; timestamp: number; reason: string; completedByName: string }
  | {
      key: string;
      kind: "statusChanged";
      timestamp: number;
      fromStatus: ContactStatus;
      toStatus: ContactStatus;
      changedByName: string;
    }
  // MIS-15: unión discriminada anidada (kind + outcome) — evita que este
  // tipo permita estados imposibles (una entrada "saleClosed" con
  // product/amountCents pero sin ellos siendo realmente aplicables, o con
  // lossReason y product a la vez). Mismo razonamiento que el documento de
  // saleClosures en convex/schema.ts, trasladado a este tipo puro de src/.
  | {
      key: string;
      kind: "saleClosed";
      timestamp: number;
      outcome: "won";
      product: string;
      amountCents: number;
      purchaseDate: number;
      closedByName: string;
    }
  | {
      key: string;
      kind: "saleClosed";
      timestamp: number;
      outcome: "lost";
      lossReason: string;
      closedByName: string;
    };

export function buildHistory(
  contact: { initialNote?: string; _creationTime: number },
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

  // ... bloques existentes de initialNote / created / notes / completedReminders / statusChanges, sin cambios ...

  // MIS-15: cada cierre de venta también forma parte del historial (AC
  // explícito: "el cierre queda en el historial de actividad del
  // contacto"). timestamp = closedAt (instante REAL en que se registró el
  // cierre, server-authoritative) — NO purchaseDate, que puede ser una
  // fecha pasada elegida por el usuario. Mismo criterio que completedAt en
  // reminders/changedAt en statusChanges: el momento del evento real, no
  // una fecha de negocio elegida.
  for (const s of saleClosures) {
    if (s.outcome === "won") {
      entries.push({
        key: s._id,
        kind: "saleClosed",
        timestamp: s.closedAt,
        outcome: "won",
        product: s.product,
        amountCents: s.amountCents,
        purchaseDate: s.purchaseDate,
        closedByName: s.closedByName,
      });
    } else {
      entries.push({
        key: s._id,
        kind: "saleClosed",
        timestamp: s.closedAt,
        outcome: "lost",
        lossReason: s.lossReason,
        closedByName: s.closedByName,
      });
    }
  }

  return entries.sort((a, b) => b.timestamp - a.timestamp);
}
```

El 5º parámetro tiene default `[]` — compatible hacia atrás con el único call site existente (`ContactDetailView.tsx`).

## `src/app/(app)/contactos/[id]/page.tsx` (EDITAR)

```tsx
export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  const { id } = await params;
  const token = await readSessionToken();

  const [contact, notes, reminders, statusChanges, saleClosures] = await Promise.all([
    fetchQuery(api.contacts.getContact, { token: token!, id }),
    fetchQuery(api.notes.listNotes, { token: token!, contactId: id }),
    fetchQuery(api.reminders.listRemindersForContact, { token: token!, contactId: id }),
    fetchQuery(api.contacts.listStatusChanges, { token: token!, contactId: id }),
    fetchQuery(api.sales.listSaleClosures, { token: token!, contactId: id }),
  ]);

  // ... bloque "no encontrado", sin cambios ...

  return (
    // ...
    <ContactDetailView
      contact={contact}
      now={now}
      notes={notes}
      reminders={reminders}
      statusChanges={statusChanges}
      saleClosures={saleClosures}
      canChangeStatus={user.role === "rep"}
    />
  );
}
```

## `src/app/(app)/contactos/[id]/ContactDetailView.tsx` (EDITAR)

Cambios puntuales sobre el archivo instalado hoy (262 líneas):

1. **Imports**: `import { formatRelativeTime, formatDateTime, formatDate, formatCurrencyCents } from "@/lib/contacts/format";` y `import { CloseSaleForm } from "./CloseSaleForm";`.
2. **Tipo y prop nuevos**: `type SaleClosures = FunctionReturnType<typeof api.sales.listSaleClosures>;` y nueva prop `saleClosures: SaleClosures` en la firma del componente.
3. **`buildHistory`**: `const history = buildHistory(contact, notes, reminders.completed, statusChanges, saleClosures);`.
4. **Gating del botón "Cerrar venta"** (sustituye el bloque actual `{!isClosed && (...)}`, líneas 189-193):
   ```tsx
   {/* MIS-15: "Cerrar venta" ejecuta closeSale, que exige requireRole("rep")
       igual que changeContactStatus — se reutiliza canChangeStatus (ya
       significa "puede ejecutar acciones de pipeline reservadas a rep")
       para no dejar a Marta abrir un formulario que solo puede fallar al
       confirmar (mismo criterio que ya se aplica a "Cambiar estado"). */}
   {canChangeStatus && !isClosed && (
     <Button variant="primary" size="sm" style={{ flex: "1 1 130px" }} onClick={() => setSheet("close")}>
       Cerrar venta
     </Button>
   )}
   ```
5. **Rama de la hoja** (líneas 233-259) — nuevo caso antes del `else` genérico:
   ```tsx
   {sheet === "note" ? (
     <AddNoteForm contactId={contact._id} onDone={() => setSheet(null)} />
   ) : sheet === "schedule" ? (
     <ScheduleReminderForm ... />
   ) : sheet === "status" ? (
     <ChangeStatusForm contactId={contact._id} currentStatus={contact.status} onDone={() => setSheet(null)} />
   ) : sheet === "close" ? (
     <CloseSaleForm contactId={contact._id} onDone={() => setSheet(null)} />
   ) : (
     <>
       <p style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 16 }}>
         Disponible próximamente.
       </p>
       <Button variant="secondary" full onClick={() => setSheet(null)}>
         Cancelar
       </Button>
     </>
   )}
   ```
   (El `else` genérico ahora solo cubre `sheet === null` — nunca se renderiza, porque `BottomSheet` solo monta children con `open={sheet !== null}` — se deja igual que hoy, fuera de alcance de este ticket.)
6. **Historial — metadatos** (nueva rama antes del `else` final, líneas ~205-211):
   ```tsx
   entry.kind === "note"
     ? `${NOTE_TYPES[entry.type].label} · ${formatDateTime(entry.timestamp)} · ${entry.authorName}`
     : entry.kind === "reminderDone"
     ? `Seguimiento · ${formatDateTime(entry.timestamp)} · ${entry.completedByName}`
     : entry.kind === "statusChanged"
     ? `Cambio de estado · ${formatDateTime(entry.timestamp)} · ${entry.changedByName}`
     : entry.kind === "saleClosed"
     ? `Cierre de venta · ${formatDateTime(entry.timestamp)} · ${entry.closedByName}`
     : formatRelativeTime(entry.timestamp, now)
   ```
7. **Historial — texto principal** (líneas ~214-220):
   ```tsx
   entry.kind === "created"
     ? "Contacto añadido"
     : entry.kind === "reminderDone"
     ? `Seguimiento completado: ${entry.reason}`
     : entry.kind === "statusChanged"
     ? `Estado cambiado: ${PIPELINE_STATES[entry.fromStatus].label} → ${PIPELINE_STATES[entry.toStatus].label}`
     : entry.kind === "saleClosed"
     ? entry.outcome === "won"
       ? `Venta ganada: ${entry.product} · ${formatCurrencyCents(entry.amountCents)} · ${formatDate(entry.purchaseDate)}`
       : `Venta perdida: ${entry.lossReason}`
     : entry.text
   ```
   (TypeScript estrecha correctamente `entry` en cada rama gracias a la unión discriminada anidada `kind`+`outcome` de `HistoryEntry` — sin `!`/casts.)
8. **Condición de "sin actividad"** (línea 226): añadir `&& saleClosures.length === 0`:
   ```tsx
   {!contact.initialNote && notes.length === 0 && reminders.completed.length === 0 && statusChanges.length === 0 && saleClosures.length === 0 && (
     <p style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 8 }}>
       Aún no hay más actividad registrada.
     </p>
   )}
   ```

## `PLANS/README.md` (EDITAR)

```diff
-| MIS-15 | Registro de cierre de venta (ganada o perdida) | — | Pendiente |
+| [MIS-15](https://linear.app/mistu-monso/issue/MIS-15) | Registro de cierre de venta (ganada o perdida) | [MIS-15-registro-cierre-venta.md](./MIS-15-registro-cierre-venta.md) | Pendiente |
```

Se mantiene el estado **"Pendiente"** hasta que el código real se despliegue y pase auditoría — mismo criterio ya usado al escribir los planes de MIS-12/MIS-13.

## Paso de generación de código Convex (obligatorio)

1. Guardar `convex/schema.ts` y `convex/sales.ts` primero.
2. `npx convex dev --once` — despliega la tabla `saleClosures` (con su documento de tipo unión discriminada) y las funciones `sales:closeSale`/`sales:listSaleClosures`, regenera `convex/_generated/*` (incluido `dataModel.d.ts`, de donde `Doc<"saleClosures">` sale ya tipado como unión).
3. Solo entonces tocar `src/lib/contacts/format.ts`, `src/lib/contacts/actions.ts`, `CloseSaleForm.tsx`, `src/lib/notes/history.ts`, `page.tsx`, `ContactDetailView.tsx` — todos dependen de tipos generados en el paso 2 (`api.sales.*`, `FunctionReturnType<typeof api.sales.listSaleClosures>`).

## Verificación end-to-end (manual — no hay tests automatizados en el repo)

1. `npx convex dev --once` sin errores; confirmar en el log `✔ Added table indexes: saleClosures.by_contact` y que `sales:closeSale`/`sales:listSaleClosures` quedan registradas.
2. `npx tsc --noEmit`, `npm run lint`, `npm run build` limpios.
3. Login `carlos@test.local`. Abrir un contacto en "Lead nuevo" (o cualquier estado no cerrado). Tap "Cerrar venta" → se abre la hoja con dos botones: "Venta ganada" / "Venta perdida".
4. **Venta ganada — validación de cliente**: tap "Venta ganada" → aparecen los 3 campos (Producto, Importe, Fecha con "hoy" precargado). Dejar producto vacío y pulsar "Confirmar" → el navegador bloquea el envío por el atributo `required` (comportamiento nativo esperado, la Server Action ni se invoca todavía). Rellenar producto ("Plan anual Premium"), importe "1500.50", fecha por defecto → Confirmar → la hoja se cierra sola; el badge de cabecera pasa a "Ganado" sin F5; **"Cerrar venta" desaparece** del bloque de acciones rápidas (`isClosed`) — **"Cambiar estado" sigue disponible** (permite reabrir el contacto, mismo criterio que MIS-14: no se oculta con `isClosed`, solo con `canChangeStatus`).
5. Historial muestra **dos** entradas nuevas con el mismo instante (añadido en v2, tras corregir el major 2 de la auditoría): "Cambio de estado · <fecha/hora> · Carlos" / "Estado cambiado: Lead nuevo → Ganado" (vía `statusChanges`), y "Cierre de venta · <fecha/hora> · Carlos" / "Venta ganada: Plan anual Premium · 1.500,50 € · <fecha de compra>" (vía `saleClosures`).
6. **Venta perdida** (con un segundo contacto, o el mismo tras reabrirlo vía "Cambiar estado" → un estado no cerrado): tap "Cerrar venta" → "Venta perdida" → dejar el motivo vacío y Confirmar → bloqueo nativo del navegador (`required`, igual que en el paso 4). Rellenar "Precio demasiado alto" → Confirmar → badge pasa a "Perdido"; historial muestra igualmente las dos entradas: "Estado cambiado: ... → Perdido" y "Venta perdida: Precio demasiado alto".
7. **Validación de servidor — producto vacío** (bypaseando el `required` del navegador): invocar `sales:closeSale` directamente con `outcome:"won"`, `product:""`, `amountCents`/`purchaseDate` válidos → `{success:false, error:"El producto o servicio es obligatorio", field:"product"}`; confirmar que NO se inserta fila en `saleClosures` ni en `statusChanges`, ni se toca `contacts.status`.
8. **Validación de servidor — motivo vacío**: invocar `sales:closeSale` directamente con `outcome:"lost"`, `lossReason:""` → `{success:false, error:"El motivo de pérdida es obligatorio", field:"lossReason"}`; mismas comprobaciones de no-escritura que el paso 7.
9. **Importe inválido**: invocar `sales:closeSale` directamente con `amountCents: -5` o `amountCents: 0` → `{success:false, error:"El importe debe ser un número positivo", field:"amountCents"}`. En la UI, escribir "0" o negativo (si el navegador lo permite pese a `min="0.01"`) debe producir el mismo error de servidor.
10. **Fecha inválida**: invocar `sales:closeSale` directamente con `purchaseDate: NaN` o `purchaseDate: -1` → `{success:false, error:"Fecha de compra inválida", field:"purchaseDate"}`.
11. **Contacto ya cerrado**: sobre un contacto ya `won`/`lost`, invocar `sales:closeSale` directamente (saltándose el gating de UI) → `{success:false, error:"Este contacto ya tiene una venta cerrada", field:"contactId"}`; confirmar que NO se inserta fila nueva en `saleClosures` ni en `statusChanges`, ni se toca `contacts.status`.
12. **Botón "Atrás"**: en el paso 2 (cualquiera de las dos opciones), pulsar "Atrás" → vuelve a los dos botones grandes sin cerrar la hoja ni perder el contactId; elegir la otra opción → los campos correctos para esa opción, sin residuos de la opción anterior.
13. **Gating de Marta**: login `marta@test.local`, abrir un contacto no cerrado → el botón "Cerrar venta" **no aparece** (mismo criterio ya confirmado para "Cambiar estado"). Confirmar además, invocando `sales:closeSale` directamente con el token de Marta, que la mutation devuelve `ConvexError("No autorizado")` (defensa de servidor, no solo de UI).
14. **Modelo de datos para MIS-17** (alcance del panel — ver decisión 13, no se prueba `/panel` en este ticket): confirmar en el dashboard de Convex (o `npx convex data saleClosures` y `npx convex data statusChanges`) que las filas de los pasos 4 y 6 tienen exactamente los campos esperados según su `outcome`, que hay una fila correlacionada en `statusChanges` con el mismo `changedAt`/`closedAt`, y que `contacts.status` de esos contactos quedó en `won`/`lost` respectivamente — es el dato con el que MIS-17 podrá construir su query/índice de agregación.
15. Revisar en el dashboard de Convex que una fila `won` de `saleClosures` NUNCA tiene `lossReason` y una fila `lost` NUNCA tiene `product`/`amountCents`/`purchaseDate` (lo garantiza el propio schema, se confirma con datos reales).
16. **Legibilidad del historial con timestamps idénticos** (sugerencia baja de la auditoría de plan v2): dado que `statusChanges.changedAt === saleClosures.closedAt` para el mismo cierre (mismo `Date.now()` capturado una vez en `closeSale`), confirmar visualmente en la ficha que las dos entradas ("Cambio de estado: ... → Ganado/Perdido" y "Venta ganada/perdida: ...") aparecen juntas, ambas legibles, sin que el `sort` de `buildHistory` (`b.timestamp - a.timestamp`, estable por spec ES2019 a igualdad) las intercale con otras entradas de otro momento ni las solape visualmente.
17. Viewport estrecho (320–390px): los dos botones grandes del paso 1, los campos del paso 2 y los botones "Atrás"/"Confirmar" no desbordan horizontalmente.

## Archivos afectados

| Archivo | Tipo |
|---|---|
| `convex/schema.ts` | Editar |
| `convex/sales.ts` | Nuevo |
| `src/lib/contacts/format.ts` | Editar |
| `src/lib/contacts/actions.ts` | Editar |
| `src/app/(app)/contactos/[id]/CloseSaleForm.tsx` | Nuevo |
| `src/lib/notes/history.ts` | Editar |
| `src/app/(app)/contactos/[id]/page.tsx` | Editar |
| `src/app/(app)/contactos/[id]/ContactDetailView.tsx` | Editar |
| `PLANS/README.md` | Editar (fila MIS-15) |

## Puntos abiertos (no bloqueantes)

- **Ausencia de catálogo de productos**: fuera de alcance de este ticket (confirmado, no existe en ningún punto del repo). "Producto o servicio vendido" es campo de texto libre único — no hay selector, no hay validación contra un catálogo. Si un futuro ticket introduce un catálogo real, `saleClosures.product` seguiría siendo válido como texto (podría opcionalmente enlazarse a un `productId` en una migración posterior, fuera de este plan).
- **Contactos `won`/`lost` sin fila de venta** (alcanzables hoy vía "Cambiar estado" de MIS-14, sin pasar por "Cerrar venta"): se acepta como deuda documentada, sin vía de "completar los datos a posteriori" — ver decisión 5. `isClosed` sigue ocultando "Cerrar venta" en ese caso, igual que hoy.
- **Múltiples cierres por contacto**: un contacto reabierto (vía "Cambiar estado") y vuelto a cerrar acumula varias filas en `saleClosures` y varias entradas "Cierre de venta" en el historial — intencional, coherente con el modelo append-only de `statusChanges` (ver decisión 6).
- **Divisa fija EUR**: no hay selector de divisa, asunción de un solo país — mismo criterio que `timeZone: "Europe/Madrid"` ya fijo en `formatDateTime`/`formatDate`.
- **Sin paginación en `listSaleClosures`**: mismo criterio ya aceptado para `notes`/`reminders`/`statusChanges`/`listContacts` (volumen pequeño esperado en un CRM personal).
- **Sin edición/corrección de un cierre ya registrado**: `saleClosures` es append-only, sin mutation de edición ni borrado — igual que `notes`/`statusChanges`. Si Carlos se equivoca al cerrar una venta, no hay forma de corregirlo desde la UI hoy. Fuera de alcance del AC.
- **Redondeo de importe**: `Math.round(euros * 100)` puede introducir una pérdida de precisión de ±1 céntimo en casos extremos de error de coma flotante del propio input — aceptado, no bloqueante.
- **Reutilización de `canChangeStatus` para gatear también "Cerrar venta"** (decisión 4): documentado explícitamente aquí, aunque ya está resuelto en el propio plan — no se renombra la prop, se documenta con comentario en el punto de uso.
- **Sin restricción de fecha futura/pasada en "Fecha de la compra"**: decisión consciente (ver decisión 9), no un olvido.
- **`convex/sales.ts` como módulo nuevo vs. ampliar `convex/contacts.ts`**: decisión documentada (decisión 2); si en el futuro se considera que la separación por archivo no aporta valor, es una refactorización de organización de código, no de comportamiento.

## Estado

Auditoría de plan: **NO-GO en v1** (2 majors: AC del panel sin cumplir, `closeSale` sin registrar `statusChanges`) → **ambos resueltos en v2** → **GO CONDICIONADO en v2**, condicionado a aceptar la decisión 13 (alcance del panel es de MIS-17) como decisión de producto — aceptada. Dos sugerencias no bloqueantes adicionales (suavizar "sin trabajo adicional en el modelo"; verificar legibilidad del historial con timestamps idénticos) incorporadas directamente sin necesidad de v3.

Auditoría de código: **GO CONDICIONADO** — sin blockers ni majors, ambos hallazgos de la auditoría de plan v2 confirmados resueltos en el código real (`statusChanges` insertado en `closeSale`; gating `canChangeStatus && !isClosed` en "Cerrar venta" sin afectar a "Cambiar estado").

**Instalado y verificado** (rama `feature/mis-15-registro-cierre-venta`):
- `npx convex dev --once`: `✔ Added table indexes: saleClosures.by_contact`, sin errores.
- `npx tsc --noEmit`, `npm run lint` (0 errores, 1 warning preexistente ajeno a MIS-15), `npm run build`: limpios.
- Verificación end-to-end con Playwright real (Chromium) contra el dev server, cuentas `carlos@test.local`/`marta@test.local`: 33/33 comprobaciones OK, incluyendo:
  - Flujo completo "Venta ganada" (producto+importe+fecha, bloqueo nativo `required` en cliente, badge a "Ganado" sin F5, "Cerrar venta" desaparece, "Cambiar estado" permanece, dos entradas de historial correlacionadas — "Cambio de estado" y "Cierre de venta").
  - Flujo completo "Venta perdida" (motivo, mismas comprobaciones).
  - Botón "Atrás" vuelve al paso 1 sin perder `contactId`.
  - Reapertura vía "Cambiar estado" tras un cierre → "Cerrar venta" reaparece.
  - **Validación de servidor real** (llamadas directas a `sales:closeSale` vía `npx convex run` con el token de sesión real extraído de la cookie httpOnly de Carlos): producto vacío, importe ≤ 0, fecha inválida, motivo vacío, contacto ya cerrado — los 5 casos rechazados con el `field`/`error` exactos del plan, sin insertar filas de más (`saleClosures` de un contacto con intentos fallidos conserva exactamente 1 fila real).
  - **Gating de Marta confirmado en servidor, no solo en UI**: llamada directa con el token real de Marta → `ConvexError("No autorizado")` real, capturada.
  - 0 errores de consola; sin overflow horizontal en ficha ni formulario a 360px.
  - Dos fallos iniciales del script (no del producto) diagnosticados y corregidos: selector de formulario sin ámbito que colisionaba con el `<form>` de "Cerrar sesión" (mismo gotcha ya conocido de otras rondas), y una aserción de formato de moneda que asumía separador de miles que este Chromium no añade por debajo de cierto umbral — verificado con capturas y HTML real que el producto se comporta exactamente como especifica el plan.
- Datos de prueba dejados en el deployment de dev (sin mutation de borrado, mismo criterio que tickets anteriores): contactos "MIS-15 E2E Ganada" y "MIS-15 E2E Perdida" (este último en estado `lost`), más 2-3 contactos auxiliares creados durante el debugging de la validación `required`.

**Mergeado**: PR #10 (rama `feature/mis-15-registro-cierre-venta`) mergeado a `main` con squash. **Desplegado a producción**: `npx convex deploy` sobre `greedy-tapir-20` confirmó `✔ Added table indexes: saleClosures.by_contact` y `✔ Deployed Convex functions`. Ticket cerrado en Linear con el PR vinculado.

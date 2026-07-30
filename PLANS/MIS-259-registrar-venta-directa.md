# MIS-259 — Registrar venta directa (ventas repetidas por cliente)

> **Estado**: Código generado, pendiente de auditoría de código.

## Contexto

Hoy la única vía para registrar una venta es **Cerrar venta** (`convex/sales.ts`, mutation `closeSale`, MIS-15) desde la ficha del contacto — y esa mutation rechaza explícitamente cerrar una venta si `contact.status` ya es `"won"` o `"lost"` (líneas 175-181: *"Este contacto ya tiene una venta cerrada"*). Un cliente que ya compró una vez (contacto `"won"`) y vuelve a comprar no tiene hoy ninguna vía para que esa segunda venta quede registrada — no aparece en `saleClosures` y por tanto no sale en la pantalla Ventas (MIS-256) ni en las estadísticas del Panel. Esto es exactamente el gap descrito en MIS-259 (Linear, proyecto **CRM MEJORAS**) y ya reflejado en el PRD de Notion (sección "Mejoras del CRM → Ventas → Registrar venta directa").

**Gate de proceso:** CRM MEJORAS mantiene el mismo gate que el MVP y que MIS-256/257 (plan → auditoría → código → auditoría → instalación). Este documento es el plan y se queda esperando veredicto de auditoría antes de generar ningún código real. Igual que MIS-256/257, **este plan no se añade a `PLANS/README.md`** (ese índice está scopeado explícitamente a "proyecto CRM - MVP").

**Investigación previa** (lectura directa de `convex/schema.ts`, `convex/sales.ts`, `convex/contacts.ts`, y de los componentes de Ventas/Cerrar venta) confirma dos cosas que corrigen la redacción original de la issue de Linear:

- **No hace falta ningún cambio de esquema.** `saleClosures` (`convex/schema.ts`, líneas 163-205) **ya** admite varias filas por `contactId` sin restricción de unicidad — el propio comentario del schema lo dice explícitamente ("permite múltiples filas por contacto... mismo criterio que... statusChanges"). El bloqueo de hoy es puramente de comportamiento: el guard de `closeSale`, no el modelo de datos. La issue de Linear especulaba "cambios de modelo"; no los hay.
- **No existe catálogo de productos en el repo** (confirmado también en el propio schema, línea 169, y en el plan de MIS-15). `CloseSaleForm.tsx` usa un `<Input>` de texto libre para "Producto o servicio", sin selector. El nuevo formulario reutiliza exactamente ese mismo patrón — sin inventar un selector de catálogo que no existe en ningún otro sitio de la app.

## Decisiones de diseño

- **Mutation nueva `registerDirectSale` en `convex/sales.ts`, no se toca `closeSale`.** Mismo criterio que pidió la propia issue ("Fuera de alcance: no se modifica el flujo existente Cerrar venta"). Reutiliza los helpers ya existentes en el archivo (`PRODUCT_MAX`, `isValidAmountCents`, `isValidEpochMs`) — misma validación, sin duplicarla dentro del mismo archivo.
- **Sin guard de estado**: a diferencia de `closeSale`, `registerDirectSale` acepta cualquier `contact.status` (incluido `"won"` y `"lost"`) — es la vía explícita para ventas repetidas.
- **outcome siempre `"won"`**: esta vía solo registra ventas, no pérdidas (igual que dice la issue). `product`, `amountCents` y `purchaseDate` son **obligatorios** los tres (a diferencia de `closeSale`, donde son opcionales a nivel de args) — así toda venta registrada por esta vía cuenta en las estadísticas, que es el problema original.
- **Pipeline del contacto**: si `contact.status !== "won"`, la mutation lo pasa a `"won"` y registra una fila en `statusChanges` (mismo patrón exacto que la rama `"won"` de `closeSale`) — cubre tanto "cerrar por primera vez sin pasar por la ficha" como "reabrir automáticamente un contacto `lost` que vuelve a comprar". Si `contact.status === "won"` ya, se inserta solo la fila de `saleClosures` — sin tocar `contacts.status` ni `statusChanges` (mismo criterio de no-op que `changeContactStatus`: no generar un cambio `"won"` → `"won"` sin información real).
- **Server Action nueva `registerDirectSaleAction` en `src/lib/contacts/actions.ts`** (no un módulo `lib/sales/` nuevo): `closeSaleAction` ya vive ahí pese a ser conceptualmente "de ventas", porque gira alrededor de un `contactId` — mismo criterio se aplica aquí. Reutiliza las copias ya presentes en ese archivo de `isValidAmountCents`/`isValidEpochMs` (duplicadas a propósito respecto a `convex/sales.ts`, mismo patrón ya documentado en el propio archivo).
- **Entrada: FAB propio de la pantalla Ventas, no el FAB genérico.** El FAB "Añadir contacto" (`AddContactFab.tsx`) se pinta hoy sin condición en todas las rutas de `(with-nav)/layout.tsx`. En vez de generalizar ese componente, se introduce `src/components/crm/PageFab.tsx` — un client component mínimo que lee `usePathname()` y no pinta nada en `/ventas` (layout.tsx pasa a usar `<PageFab />` en vez de `<AddContactFab />` directamente). La pantalla Ventas pinta su propio botón flotante "+" (misma posición/estilo, duplicado a propósito — mismo criterio de "cada pieza autocontenida" que el resto del repo, p. ej. `isValidEpochMs` duplicada entre `convex/` y `src/lib/`) que abre un `BottomSheet` con el nuevo formulario, exactamente el mismo mecanismo que `ContactDetailView.tsx` ya usa para `CloseSaleForm`.
- **Selector de contacto**: no existe hoy ningún componente de búsqueda de contactos reutilizable de forma aislada — `ContactList.tsx` tiene el patrón (helpers `normalizeText`/`digitsOnly`/`matches` + `Input` con icono de búsqueda) pero mezclado con la navegación de la lista completa. Se replica ese mismo patrón (duplicado, mismo criterio de autocontención) dentro del nuevo formulario, alimentado por `listContacts` (ya existe, sin cambios) pedido en paralelo desde `ventas/page.tsx`. Cada fila muestra `Avatar` + nombre + `StatusBadge` (para que se vea a simple vista qué contactos ya están "Ganado" — el caso de venta repetida que motiva esta tarea).
- **Formulario de 2 pasos dentro de la misma hoja** (elegir contacto → rellenar producto/importe/fecha), mismo patrón de "pasos dentro de un único `BottomSheet`" que `CloseSaleForm.tsx`. Los 3 campos del paso 2 son una copia literal de la rama `"won"` de `CloseSaleForm` (mismos componentes `Input`, mismas conversiones euros→céntimos y fecha local→epoch ms ya existentes ahí).
- **Refresco**: `registerDirectSaleAction` llama a `refresh()` (mismo helper "Next 16" ya usado por `closeSaleAction`/`changeStatusAction`) para que la lista y el resumen de `/ventas` se actualicen en la misma respuesta, sin recarga completa.

## Fuera de alcance (explícito)

- No se modifica `closeSale`, `CloseSaleForm.tsx` ni `closeSaleAction` — el flujo "Cerrar venta" de la ficha sigue exactamente igual.
- Sin selector de catálogo de productos (no existe en el repo).
- Sin edición ni borrado de ventas ya registradas (ni por esta vía ni por la existente).
- Sin cambios de esquema — `saleClosures` ya admite lo necesario.
- Sin cambios en `getWonSalesSummary` / `listWonSalesForPeriod` — una venta registrada por esta vía es indistinguible de una cerrada por pipeline (misma tabla, mismo `outcome: "won"`), así que ambas queries ya la recogen sin tocarlas.

## Cambios

### Backend (`convex/sales.ts`)

Nueva mutation, añadida junto a `closeSale`:

```ts
// MIS-259: registra una venta directamente desde la pantalla de Ventas,
// sin pasar por el cierre de pipeline — a diferencia de closeSale, NO
// exige que el contacto siga abierto (permite ventas repetidas de un
// contacto ya "won", y reabre como "won" un contacto "lost"/pipeline).
// outcome siempre "won": esta vía no registra pérdidas.
export const registerDirectSale = mutation({
  args: {
    token: v.string(),
    contactId: v.string(),
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
```

### Server Action (`src/lib/contacts/actions.ts`)

Nueva `registerDirectSaleAction`, calco de `closeSaleAction` (mismo manejo de sesión/`ConvexError`/`redirect("/login")`) pero sin la rama `outcome`/`lossReason`: valida `amountCents`/`purchaseDate` con las copias locales ya existentes de `isValidAmountCents`/`isValidEpochMs`, llama a `fetchMutation(api.sales.registerDirectSale, {...})`, y termina con `refresh()`.

### Nav y FAB

- `src/components/crm/PageFab.tsx` (**nuevo**, client component): `usePathname()` — si es `"/ventas"` no pinta nada, en cualquier otra ruta pinta `<AddContactFab />` tal cual.
- `src/app/(app)/(with-nav)/layout.tsx`: cambia `<AddContactFab />` por `<PageFab />`. Sin más cambios — `AddContactFab.tsx` no se toca.

### Pantalla Ventas

- `src/app/(app)/(with-nav)/ventas/page.tsx`: añade `fetchQuery(api.contacts.listContacts, { token })` al `Promise.all` ya existente (junto a los 3 periodos) y lo pasa como prop nueva `contacts` a `SalesList`.
- `src/app/(app)/(with-nav)/ventas/SalesList.tsx`: nuevo estado local `sheetOpen`, botón flotante "+" (posición/estilo fijo igual que `AddContactFab`, duplicado a propósito) que abre `<BottomSheet title="Registrar venta">` con `<RegisterSaleForm contacts={contacts} onDone={() => setSheetOpen(false)} />` — mismo mecanismo que `ContactDetailView.tsx` usa para `CloseSaleForm`.
- `src/app/(app)/(with-nav)/ventas/RegisterSaleForm.tsx` (**nuevo**): formulario de 2 pasos.
  - **Paso 1 — elegir contacto**: `Input` de búsqueda (icono, mismo patrón que `ContactList.tsx`) + lista filtrada (`Avatar` + nombre + `StatusBadge` + teléfono). Tocar una fila pasa al paso 2 con ese contacto fijado.
  - **Paso 2 — datos de la venta**: "Cliente: {nombre}" con enlace "Cambiar" (vuelve al paso 1) + los 3 campos de `CloseSaleForm` (Producto, Importe, Fecha de compra — mismas conversiones euros→céntimos / fecha local→epoch ms) + "Atrás"/"Confirmar", usando `useActionState(registerDirectSaleAction, ...)`.

## Archivos afectados

| Archivo | Tipo |
|---|---|
| `convex/sales.ts` | Editar (nueva mutation `registerDirectSale`) |
| `src/lib/contacts/actions.ts` | Editar (nueva Server Action `registerDirectSaleAction`) |
| `src/components/crm/PageFab.tsx` | Nuevo |
| `src/app/(app)/(with-nav)/layout.tsx` | Editar (usa `PageFab` en vez de `AddContactFab` directo) |
| `src/app/(app)/(with-nav)/ventas/page.tsx` | Editar (añade `listContacts` al `Promise.all`) |
| `src/app/(app)/(with-nav)/ventas/SalesList.tsx` | Editar (FAB local + `BottomSheet` + estado) |
| `src/app/(app)/(with-nav)/ventas/RegisterSaleForm.tsx` | Nuevo |

## Verificación

1. `tsc --noEmit` / `eslint` / `npm run build`.
2. Manual, como Carlos y como Marta (mismo acceso):
   - En `/ventas`, confirmar que ya NO aparece el FAB "Añadir contacto" y sí el nuevo "+". Confirmar que en Pendientes/Contactos/Panel el FAB genérico sigue igual que siempre.
   - Registrar una venta para un contacto que **ya está "Ganado"** → aparece de inmediato en el listado/resumen de Ventas; en la ficha del contacto, el historial muestra 2 filas de venta y el estado sigue "Ganado" (sin fila nueva de cambio de estado).
   - Registrar una venta para un contacto **todavía en pipeline** (p. ej. "Negociando") → su estado pasa a "Ganado" (visible en la ficha y en el Panel de oportunidades), con una única fila de venta.
   - Comprobar que el buscador del paso 1 filtra igual que en Contactos (por nombre y por teléfono).
3. e2e: extender `e2e/edge-cases.spec.ts` con al menos dos casos — (a) venta repetida sobre un contacto sembrado como "won" vía `api.sales.closeSale`, comprobando 2 filas en `listSaleClosures` y que el segundo importe suma al resumen de Ventas; (b) venta directa sobre un contacto en pipeline abierto, comprobando que pasa a "won". Añadir comprobación en viewport 320px del paso 1 (buscador + lista dentro de la hoja) sin overflow horizontal.
4. `npm run test:e2e` completo en verde antes de dar por cerrada la tarea.

## Estado

**Auditoría de plan: GO CONDICIONADO.** Sin Blockers ni Majors. Condición: la implementación debe pasar `tsc`/`eslint`/`npm run build`/e2e, y al menos un e2e debe ejercitar el flujo real desde `/ventas` (FAB → hoja → selección de contacto → submit), no solo la mutation directa. Sugerencia media: la segunda venta del caso de venta repetida debe registrarse por la UI nueva, no sembrarse. Sugerencias bajas: `aria-label` específico en el FAB nuevo (distinto de "Añadir contacto"); decidir explícitamente si se permite `purchaseDate` futura. Deuda enviada a follow-up: índices de `saleClosures` por outcome/purchaseDate si crece el volumen (no aplica al volumen actual). Alcance de revisión acotado por la propia auditoría: solo el diff de MIS-259 — no reabrir `closeSale`, el esquema ni las queries de resumen salvo que el diff las toque.

**Resultado real (código generado en `CODIGO/MIS-259-registrar-venta-directa/`, verificado por overlay temporal sobre el repo real y revertido después):**

- Las dos condiciones/sugerencias de diseño de la auditoría se aplicaron tal cual: `registerDirectSale` (`convex/sales.ts`) deja constancia explícita en comentario de que permite `purchaseDate` futura a propósito (mismo criterio que `closeSale`, sin nueva validación de límite superior); el FAB nuevo de `/ventas` (`SalesList.tsx`) lleva `aria-label="Registrar venta"`, distinto del `aria-label="Añadir contacto"` del FAB genérico.
- `npx tsc --noEmit`, `npm run lint` (`eslint`), `npm run build`: sin errores (1 warning preexistente en `Avatar.jsx`, `no-img-element`, no relacionado con este diff).
- `npx convex dev --once` contra el deployment de dev compartido (`dutiful-mole-111`) para desplegar `registerDirectSale` temporalmente, seguido de `npm run test:e2e` completo (24 tests, Carlos y Marta): **24/24 pasan**, incluidos los 3 tests nuevos de MIS-259:
  - "Registrar venta directa permite una segunda venta a un contacto ya Ganado, sin duplicar el cambio de estado" — conduce el flujo real completo (FAB → hoja → buscar/elegir un contacto ya "Ganado", visible por su `StatusBadge` en el picker → rellenar producto/importe → Confirmar), no solo invoca la mutation. La primera venta se siembra vía `closeSale` (mismo criterio de seeding del resto del archivo); la segunda es la que pasa por la UI nueva (sugerencia media de la auditoría, aplicada). Verifica además que `listSaleClosures` tiene 2 filas y que `listStatusChanges` sigue teniendo solo 1 (no se duplica el cambio de estado "won" → "won").
  - "Registrar venta directa sobre un contacto en pipeline abierto lo marca como Ganado" — mismo flujo real de UI sobre un contacto recién creado (estado "Lead nuevo"), confirma que pasa a "Ganado" en la ficha tras registrar la venta.
  - "El paso de elegir contacto de Registrar venta no desborda horizontalmente en 320px" — comprobación real en navegador (`scrollWidth === clientWidth`) del buscador + lista dentro de la hoja, condición explícita de la auditoría de plan.
  - Ambas condiciones explícitas de la auditoría ("al menos un e2e con el flujo real" y "la segunda venta por la UI nueva") quedan cubiertas por el primer test.
- **Un fallo detectado y corregido durante la propia verificación** (no llegó a auditoría): la primera versión del test de venta repetida buscaba el texto "Primera venta"/"Segunda venta" sin escopar por contacto — con el deployment de dev compartido acumulando ventas de ejecuciones anteriores de este mismo test, el texto dejaba de ser único y el test fallaba en `strict mode` de Playwright (2 elementos coincidentes). Corregido escopando la aserción al contacto de esa ejecución (nombre único, ver `uniqueContactName`) antes de comprobar el texto del producto.
- **Un fallo intermitente no relacionado con este diff**, mismo patrón ya documentado en `PLANS/MIS-256-pantalla-de-ventas.md`: en una ejecución de la suite completa, `"posponer un seguimiento desde Pendientes..."` (test preexistente, área de Pendientes/recordatorios, ningún archivo de este diff la toca) falló por timeout; re-ejecutado en aislamiento, pasa limpio. Diagnóstico: acumulación de datos de prueba en el deployment de dev compartido (`dutiful-mole-111`), degradando queries de scan completo — no una regresión de MIS-259.
- Deployment de dev (`dutiful-mole-111`) resincronizado con el código real de la rama (que en `convex/` es idéntico a `main`, ya que `registerDirectSale` vive solo en `CODIGO/` hasta la instalación real) inmediatamente después de la verificación — el deployment de dev NO tiene `registerDirectSale` instalado ahora mismo, solo el repo en `CODIGO/`.
- Manual: no se hizo verificación manual adicional en navegador más allá de lo cubierto por Playwright (mismos flujos, ambos roles cubiertos por la suite: Carlos en los tests nuevos, Marta ya cubierta por la suite existente sin cambios de acceso — `registerDirectSale`/`registerDirectSaleAction` no añaden gating de rol, mismo criterio que el resto del repo desde MIS-251).

Pendiente: auditoría de código sobre `CODIGO/MIS-259-registrar-venta-directa/` (rama `feature/mis-259-registrar-venta-directa`, sin push todavía). Tras un veredicto GO/GO condicionado, queda la instalación real (aplicar los archivos a `convex/`/`src/`/`e2e/`, commit, push, PR) — no se ha hecho todavía.

import { test, expect } from "@playwright/test";
import { convexClient, carlosTokenFromDisk, api } from "./helpers/convex-client";
import { uniqueContactName, uniquePhone } from "./helpers/test-data";
import { formatCurrencyCents } from "../src/lib/contacts/format";

// MIS-20: flujo de supervisión de Marta, de Panel a ficha y vuelta. Un
// único test con test.step() por cada uno de los 7 pasos del ticket —
// mismo criterio que full-flow.spec.ts (MIS-19): dependencia lineal fuerte
// entre pasos (mismo contacto/filtro en todos), un solo pass/fail
// agregado con reporting claro de en qué paso falla.
test("flujo de supervisión de Marta: panel -> filtro -> ficha -> vuelta", async ({ page }) => {
  // Marcado slow() (triplica el timeout por defecto, de 30s a 90s): la
  // corrección de auditoría de código añadió 2 contactos de sembrado extra
  // (control de filtro + venta) más el bucle de verificación móvil a 3
  // URLs distintas — la duración real ronda los 35-40s, por encima del
  // timeout por defecto de 30s.
  test.slow();

  const client = convexClient();
  const carlosToken = carlosTokenFromDisk();

  // --- Seed determinista, fuera de los 7 pasos numerados (igual que el
  // contacto de control de full-flow.spec.ts) — todo como Carlos, vía su
  // token leído del disco. ---
  const contactName = uniqueContactName("MartaFicha");
  const created = await client.mutation(api.contacts.createContact, {
    token: carlosToken,
    name: contactName,
    phone: uniquePhone(),
    initialNote: "Alta inicial de control",
  });
  if (!created.success) throw new Error("Seed falló: createContact");
  const contactId = created.id;

  await client.mutation(api.notes.addNote, {
    token: carlosToken,
    contactId,
    type: "call",
    occurredAt: Date.now(),
    text: "Llamada de seguimiento inicial",
  });

  // Contacto de control con estado DISTINTO (default "lead" tras
  // createContact, sin cambio de estado) — M2 de la auditoría de código:
  // el filtro por estado debe EXCLUIRLO de /contactos?status=talking, no
  // solo incluir al contacto sembrado en "talking". Sin este control, una
  // regresión que dejara de filtrar (mostrando todos los contactos) pasaría
  // el test igual, ya que solo se comprobaba la presencia del esperado.
  const controlContactName = uniqueContactName("MartaControlLead");
  const controlCreated = await client.mutation(api.contacts.createContact, {
    token: carlosToken,
    name: controlContactName,
    phone: uniquePhone(),
  });
  if (!controlCreated.success) throw new Error("Seed falló: createContact (control)");

  // Baseline ANTES de cambiar el estado / cerrar la venta — decisión 4 del
  // plan: delta conocido, no absoluto, porque el deployment de dev es
  // compartido. M1 de la auditoría de código: también se toma baseline de
  // getWonSalesSummary, no solo de getPipelineSummary — el panel muestra
  // ambos y ninguno se verificaba antes.
  const beforePipeline = await client.query(api.contacts.getPipelineSummary, { token: carlosToken });
  const beforeWonSales = await client.query(api.sales.getWonSalesSummary, { token: carlosToken });

  await client.mutation(api.contacts.changeContactStatus, {
    token: carlosToken,
    contactId,
    status: "talking",
  });

  // Venta ganada de importe conocido, en un contacto propio (no el
  // principal, para no interferir con los pasos 3-6 que asumen "talking"
  // sin cerrar) — M1: importe y contador de ventas ganadas verificados en
  // el panel, no solo el pipeline.
  const KNOWN_AMOUNT_CENTS = 12345; // 123,45 €
  const saleContactName = uniqueContactName("MartaVenta");
  const saleContact = await client.mutation(api.contacts.createContact, {
    token: carlosToken,
    name: saleContactName,
    phone: uniquePhone(),
  });
  if (!saleContact.success) throw new Error("Seed falló: createContact (venta)");
  await client.mutation(api.sales.closeSale, {
    token: carlosToken,
    contactId: saleContact.id,
    outcome: "won",
    product: "Producto E2E Marta",
    amountCents: KNOWN_AMOUNT_CENTS,
    purchaseDate: Date.now(),
  });

  const reminder = await client.mutation(api.reminders.scheduleReminder, {
    token: carlosToken,
    contactId,
    dueAt: Date.now(),
    reason: "Llamar de nuevo",
  });
  if (reminder.success) {
    await client.mutation(api.reminders.completeReminder, { token: carlosToken, id: reminder.id });
  }

  await test.step("1. Marta abre la app -> aterriza en Panel", async () => {
    await page.goto("/panel");
    await expect(page.getByRole("heading", { name: /Hola, Marta/ })).toBeVisible();
    await expect(page.getByText("Supervisora")).toBeVisible();
  });

  await test.step("2. El panel muestra números correctos (delta conocido: pipeline y ventas ganadas)", async () => {
    const talkingTile = page.getByRole("link").filter({ hasText: "En conversación" });
    await expect(talkingTile).toContainText(String(beforePipeline.talking + 1));

    // M1 de la auditoría de código: "Ventas ganadas" (count + importe
    // acumulado) también se verifica por delta, no solo el pipeline.
    const expectedCount = beforeWonSales.count + 1;
    const expectedTotalCents = beforeWonSales.totalAmountCents + KNOWN_AMOUNT_CENTS;
    const countLabel = expectedCount === 1 ? "venta cerrada" : "ventas cerradas";
    await expect(page.getByText(countLabel, { exact: true }).locator("..")).toContainText(String(expectedCount));
    // El importe visible es el TOTAL acumulado (baseline + los 123,45 €
    // sembrados aquí), no la venta individual — el deployment de dev es
    // compartido y ya tenía ventas ganadas previas. Se compara el texto
    // exacto que produciría formatCurrencyCents (misma función que usa la
    // UI), normalizando NBSP vs. espacio normal, más la comprobación
    // numérica exacta vía Convex — mismo patrón dual ya usado en la
    // corrección de auditoría de MIS-19 para el importe de venta.
    const importeValue = page.getByText("importe total", { exact: true }).locator("..").locator("span").first();
    const actualImporteText = (await importeValue.textContent())?.replace(/ /g, " ").trim();
    expect(actualImporteText).toBe(formatCurrencyCents(expectedTotalCents).replace(/ /g, " "));

    const afterWonSales = await client.query(api.sales.getWonSalesSummary, { token: carlosToken });
    expect(afterWonSales.totalAmountCents).toBe(expectedTotalCents);
    expect(afterWonSales.count).toBe(expectedCount);
  });

  await test.step("3. Pulsa 'En conversación' -> lista filtrada, exactamente los contactos correctos", async () => {
    await page.getByRole("link").filter({ hasText: "En conversación" }).click();
    await page.waitForURL("/contactos?status=talking");
    await expect(page.getByText("Filtrado por:")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: contactName })).toBeVisible();

    // M2 de la auditoría de código: el contacto de control, en estado
    // "lead" (no "talking"), NO debe aparecer en la lista filtrada — sin
    // esto, una regresión que dejara de filtrar (mostrando todos los
    // contactos) habría pasado el test igual, ya que antes solo se
    // comprobaba la presencia del contacto esperado, nunca la ausencia de
    // uno de otro estado.
    await expect(page.getByRole("listitem").filter({ hasText: controlContactName })).toHaveCount(0);
  });

  await test.step("4. Abre la ficha del contacto desde la lista filtrada", async () => {
    await page.getByRole("listitem").filter({ hasText: contactName }).click();
    await page.waitForURL(new RegExp(`/contactos/${contactId}$`));
  });

  await test.step("5. La ficha muestra el historial completo de lo que Carlos ha hecho", async () => {
    await expect(page.getByRole("heading", { name: contactName })).toBeVisible();
    await expect(page.getByText("Alta inicial de control")).toBeVisible();
    const noteEntry = page.getByRole("listitem").filter({ hasText: "Llamada de seguimiento inicial" });
    await expect(noteEntry).toBeVisible();
    await expect(noteEntry.getByText(/^Llamada ·/)).toBeVisible();
    await expect(page.getByText(/Estado cambiado: Lead nuevo → En conversación/)).toBeVisible();
    await expect(page.getByText(/Seguimiento completado: Llamar de nuevo/)).toBeVisible();
  });

  await test.step("6. Vuelve a la lista filtrada sin perder el filtro activo", async () => {
    // El Panel en sí no tiene estado de filtro propio (vive en la URL de
    // /contactos) — la comprobación con sentido real es que el paso
    // intermedio (la lista filtrada) no se resetea al volver atrás.
    await page.goBack();
    await expect(page).toHaveURL("/contactos?status=talking");
    await expect(page.getByText("Filtrado por:")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: contactName })).toBeVisible();
  });

  await test.step("Extra: sin overflow horizontal a 320px (Panel/lista filtrada/ficha)", async () => {
    // Reutiliza tal cual la técnica ya validada en la auditoría de código
    // de MIS-17 — no es el "paso 7" literal del ticket (ese es el
    // role-gating, cubierto en role-gating.spec.ts).
    await page.setViewportSize({ width: 320, height: 720 });
    for (const url of ["/panel", "/contactos?status=talking", `/contactos/${contactId}`]) {
      await page.goto(url);
      const noOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth === document.documentElement.clientWidth,
      );
      expect(noOverflow, `overflow horizontal en ${url}`).toBe(true);
    }
  });
});

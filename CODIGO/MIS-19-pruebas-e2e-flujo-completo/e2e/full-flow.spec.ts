import { test, expect } from "@playwright/test";
import { convexClient, sessionTokenFrom, api } from "./helpers/convex-client";
import { uniqueContactName, uniquePhone } from "./helpers/test-data";

// MIS-19: flujo completo de Carlos, de alta de contacto a venta ganada.
// Un único test con 12 test.step (uno por paso del ticket) en vez de 12
// tests separados: cada paso depende del contacto/recordatorio/venta creado
// por el paso anterior — la propia guía de Playwright recomienda test.step
// para esta forma de dependencia lineal fuerte, con reporting claro de en
// qué paso falla exactamente.
test("flujo completo de Carlos: alta -> seguimiento -> venta", async ({ page, context }) => {
  const contactName = uniqueContactName("Principal");
  const phone = uniquePhone();
  let contactId = "";

  // Contacto de control para el paso 12 ("otro contacto, confirma que los
  // datos no se mezclan") — sembrado directamente contra Convex (no es uno
  // de los 12 pasos numerados del ticket), con datos claramente distintos.
  const client = convexClient();
  const token = await sessionTokenFrom(context);
  const otherName = uniqueContactName("Secundario");
  const otherResult = await client.mutation(api.contacts.createContact, {
    token,
    name: otherName,
    phone: uniquePhone(),
    initialNote: "Contacto de control, no tocar en este flujo",
  });
  if (!otherResult.success) throw new Error("No se pudo crear el contacto de control");
  const otherContactId = otherResult.id;

  await test.step("1. Carlos abre la app -> Pendientes del día", async () => {
    await page.goto("/pendientes");
    await expect(page.getByRole("heading", { name: /Hola, Carlos/ })).toBeVisible();
  });

  await test.step("2. Registra un contacto nuevo desde el FAB (< 30s)", async () => {
    const start = Date.now();
    await page.getByRole("link", { name: "Añadir contacto" }).click();
    await page.waitForURL("/contactos/nuevo");
    await page.getByLabel("Nombre completo").fill(contactName);
    await page.getByLabel("Teléfono / WhatsApp").fill(phone);
    await page.getByRole("button", { name: "Guardar" }).click();
    // OJO: /\/contactos\/[^/]+$/ también matchea "/contactos/nuevo" (la
    // propia URL de partida, ya que "nuevo" cumple [^/]+) — con ese regex,
    // waitForURL se resolvía de inmediato (sin esperar la redirección real
    // de createContactAction) y contactId quedaba capturado como "nuevo".
    // Se excluye explícitamente ese segmento.
    await page.waitForURL((url) => /^\/contactos\/(?!nuevo$)[^/]+$/.test(url.pathname));
    expect(Date.now() - start).toBeLessThan(30_000);
    contactId = new URL(page.url()).pathname.split("/").pop()!;
  });

  await test.step("3. Ficha del nuevo contacto, estado Lead nuevo", async () => {
    await expect(page.getByRole("heading", { name: contactName })).toBeVisible();
    await expect(page.getByText("Lead nuevo", { exact: true })).toBeVisible();
  });

  await test.step("4. Añade una nota de conversación (llamada)", async () => {
    await page.getByRole("button", { name: "Añadir nota" }).click();
    const dialog = page.getByRole("dialog", { name: "Nueva nota" });
    await dialog.getByLabel("Tipo de contacto").selectOption("call");
    await dialog.getByLabel("Resumen").fill("Llamada inicial, interesado en el plan anual.");
    await dialog.getByRole("button", { name: "Guardar" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Llamada inicial, interesado en el plan anual.")).toBeVisible();
  });

  await test.step("5. Programa un seguimiento para HOY, motivo 'Enviarle propuesta'", async () => {
    // Nota de diseño de test (ver PLANS/MIS-19-pruebas-e2e-flujo-completo.md,
    // "problema del día siguiente"): se programa para HOY, no literalmente
    // mañana. convex/reminders.ts::listDueToday filtra por
    // `dueAt < tomorrowStart` — un recordatorio de hoy cumple exactamente la
        // misma condición que uno de ayer para "mañana" una vez que ese mañana
    // ya llegó. El caso realmente distinto (atrasado de días anteriores) se
    // cubre aparte en edge-cases.spec.ts con un dueAt real en el pasado.
    await page.getByRole("button", { name: "Programar seguimiento" }).click();
    const dialog = page.getByRole("dialog", { name: "Programar seguimiento" });
    // Fecha local calculada EN EL NAVEGADOR (no con toISOString().slice(0,10)
    // en Node, que convierte a UTC) — evita un desfase de día cerca de
    // medianoche o si la máquina que ejecuta el runner tiene un huso horario
    // distinto de Europe/Madrid, que es lo que de verdad importa para el
    // límite de día de listDueToday.
    const todayLocal = await page.evaluate(() => new Date().toLocaleDateString("en-CA"));
    await dialog.getByLabel("Fecha del próximo contacto").fill(todayLocal);
    await dialog.getByLabel("Motivo o qué hay que hacer").fill("Enviarle propuesta");
    await dialog.getByRole("button", { name: "Guardar" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Enviarle propuesta")).toBeVisible();
  });

  await test.step("6. Cambia el estado a En conversación", async () => {
    await page.getByRole("button", { name: "Cambiar estado" }).click();
    const dialog = page.getByRole("dialog", { name: "Cambiar estado" });
    await dialog.getByRole("button", { name: "En conversación" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("En conversación", { exact: true })).toBeVisible();
  });

  await test.step("7. Aparece en Pendientes del día", async () => {
    await page.goto("/pendientes");
    const row = page.getByRole("listitem").filter({ hasText: contactName });
    await expect(row).toBeVisible();
    await expect(row.getByText("Hoy", { exact: true })).toBeVisible();
    await expect(row.getByText("Enviarle propuesta")).toBeVisible();
  });

  await test.step("8. Marca el seguimiento como hecho desde Pendientes", async () => {
    const row = page.getByRole("listitem").filter({ hasText: contactName });
    await row.getByRole("button", { name: "Marcar hecho" }).click();
    await expect(row).toBeHidden();
  });

  await test.step("9. El historial refleja nota + cambio de estado + seguimiento completado", async () => {
    await page.goto(`/contactos/${contactId}`);
    // Entrada de historial completa: cada nota vive en su propio <li>/<Card>
    // (ver ContactDetailView.tsx) con una cabecera "Llamada · fecha · autor"
    // seguida del resumen — se escopa al <li> para comprobar ambas cosas
    // juntas, no solo que "Llamada" aparezca en algún sitio de la página.
    const noteEntry = page.getByRole("listitem").filter({ hasText: "Llamada inicial, interesado en el plan anual." });
    await expect(noteEntry).toBeVisible();
    // La cabecera es un único nodo de texto "Llamada · fecha · autor" — se
    // matchea por prefijo, no por igualdad exacta de todo el nodo.
    await expect(noteEntry.getByText(/^Llamada ·/)).toBeVisible();
    await expect(page.getByText(/Estado cambiado: Lead nuevo → En conversación/)).toBeVisible();
    await expect(page.getByText(/Seguimiento completado: Enviarle propuesta/)).toBeVisible();
  });

  await test.step("10. Cierra la venta como ganada", async () => {
    await page.getByRole("button", { name: "Cerrar venta" }).click();
    const dialog = page.getByRole("dialog", { name: "Cerrar venta" });
    await dialog.getByRole("button", { name: "Venta ganada" }).click();
    await dialog.getByLabel("Producto o servicio vendido").fill("Plan anual Premium");
    await dialog.getByLabel("Importe de la venta").fill("199.99");
    // "Fecha de la compra" ya viene precargada a hoy por defecto (ver
    // CloseSaleForm.tsx, msToDateLocal(Date.now())) — no hace falta tocarla.
    await dialog.getByRole("button", { name: "Confirmar" }).click();
    await expect(dialog).toBeHidden();
  });

  await test.step("11. El estado pasa a Ganado automáticamente, con producto e importe", async () => {
    // El ticket dice "Comprado"; el producto ya usa el estado interno `won`
    // con label visible "Ganado" (PIPELINE_STATES.won.label) — brecha de
    // nombres ya aceptada en los planes de MIS-14/MIS-15, no se reabre aquí.
    await expect(page.getByText("Ganado", { exact: true })).toBeVisible();

    // Comprobación exacta e independiente del locale contra Convex: el AC
    // dice "registra producto e importe" — una regresión que persistiera un
    // importe incorrecto pero mantuviera producto/estado correctos pasaría
    // desapercibida si solo se comprueba el texto visible formateado.
    const closures = await client.query(api.sales.listSaleClosures, { token, contactId });
    const closure = closures.find((c) => c.outcome === "won");
    expect(closure?.outcome).toBe("won");
    if (closure?.outcome === "won") {
      expect(closure.product).toBe("Plan anual Premium");
      expect(closure.amountCents).toBe(19999);
    }

    // Comprobación visible: formatCurrencyCents usa Intl es-ES, "199,99 €"
    // (el espacio antes de € puede ser NBSP) — regex tolerante al whitespace.
    await expect(page.getByText(/Venta ganada: Plan anual Premium · 199,99\s*€/)).toBeVisible();
  });

  await test.step("12. Otro contacto no mezcla datos", async () => {
    await page.goto(`/contactos/${otherContactId}`);
    await expect(page.getByRole("heading", { name: otherName })).toBeVisible();
    await expect(page.getByText("Lead nuevo", { exact: true })).toBeVisible();
    await expect(page.getByText("Llamada inicial, interesado en el plan anual.")).toHaveCount(0);
    await expect(page.getByText("Enviarle propuesta")).toHaveCount(0);
    await expect(page.getByText(/Venta ganada/)).toHaveCount(0);
  });
});

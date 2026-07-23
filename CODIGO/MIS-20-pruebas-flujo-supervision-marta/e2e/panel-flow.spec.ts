import { test, expect } from "@playwright/test";
import { convexClient, carlosTokenFromDisk, api } from "./helpers/convex-client";
import { uniqueContactName, uniquePhone } from "./helpers/test-data";

// MIS-20: flujo de supervisión de Marta, de Panel a ficha y vuelta. Un
// único test con test.step() por cada uno de los 7 pasos del ticket —
// mismo criterio que full-flow.spec.ts (MIS-19): dependencia lineal fuerte
// entre pasos (mismo contacto/filtro en todos), un solo pass/fail
// agregado con reporting claro de en qué paso falla.
test("flujo de supervisión de Marta: panel -> filtro -> ficha -> vuelta", async ({ page }) => {
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

  // Baseline ANTES de cambiar el estado — decisión 4 del plan: delta
  // conocido, no absoluto, porque el deployment de dev es compartido.
  const beforePipeline = await client.query(api.contacts.getPipelineSummary, { token: carlosToken });

  await client.mutation(api.contacts.changeContactStatus, {
    token: carlosToken,
    contactId,
    status: "talking",
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

  await test.step("2. El panel muestra números correctos (delta conocido)", async () => {
    const talkingTile = page.getByRole("link").filter({ hasText: "En conversación" });
    await expect(talkingTile).toContainText(String(beforePipeline.talking + 1));
  });

  await test.step("3. Pulsa 'En conversación' -> lista filtrada", async () => {
    await page.getByRole("link").filter({ hasText: "En conversación" }).click();
    await page.waitForURL("/contactos?status=talking");
    await expect(page.getByText("Filtrado por:")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: contactName })).toBeVisible();
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

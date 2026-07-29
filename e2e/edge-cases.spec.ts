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

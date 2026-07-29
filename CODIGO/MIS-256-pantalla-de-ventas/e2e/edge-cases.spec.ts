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

import { test, expect } from "@playwright/test";
import { convexClient, sessionTokenFrom, carlosTokenFromDisk, api } from "./helpers/convex-client";
import { uniqueContactName, uniquePhone } from "./helpers/test-data";

// MIS-251 (reapertura): decisión de negocio confirmada por el usuario
// invierte el contrato original de este archivo — Marta pasa a tener acceso
// de escritura completo, igual que Carlos, tanto en la UI como en el
// backend (requireRole se retira de las 4 mutations que lo exigían: ver
// convex/lib/authz.ts). Este archivo pasa de probar "Marta bloqueada" a
// probar "Marta funcional" — ver PLANS/MIS-251-rol-supervision-marta.md,
// sección "Decisión fijada".
test.describe("Marta: acceso de escritura completo (MIS-251)", () => {
  test("el FAB 'Añadir contacto' está presente para Marta y lleva al formulario real", async ({ page }) => {
    await page.goto("/panel");
    const fab = page.getByRole("link", { name: "Añadir contacto" });
    await expect(fab).toBeVisible();
    await fab.click();
    await expect(page).toHaveURL(/\/contactos\/nuevo$/);
    await expect(page.getByLabel("Nombre completo")).toBeVisible();
  });

  test("ficha de un contacto no cerrado: todas las acciones de escritura están visibles, y 'Añadir nota' funciona de verdad para Marta", async ({
    page,
  }) => {
    const client = convexClient();
    const carlosToken = carlosTokenFromDisk();
    const created = await client.mutation(api.contacts.createContact, {
      token: carlosToken,
      name: uniqueContactName("GatingUI"),
      phone: uniquePhone(),
    });
    if (!created.success) throw new Error("Seed falló: createContact");

    await page.goto(`/contactos/${created.id}`);

    await expect(page.getByRole("button", { name: "Cambiar estado" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cerrar venta" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Editar datos" })).toBeVisible(); // MIS-252
    await expect(page.getByRole("button", { name: "Añadir nota" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Programar seguimiento" })).toBeVisible();

    // No basta con que estén visibles — se ejercita "Añadir nota" de verdad
    // para probar que también funciona en el backend para Marta (no solo un
    // botón renderizado que luego falla al confirmarlo).
    await page.getByRole("button", { name: "Añadir nota" }).click();
    const dialog = page.getByRole("dialog", { name: "Nueva nota" });
    await dialog.getByLabel("Tipo de contacto").selectOption("call");
    await dialog.getByLabel("Resumen").fill("Nota añadida por Marta en verificación de rol");
    await dialog.getByRole("button", { name: "Guardar" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Nota añadida por Marta en verificación de rol")).toBeVisible();
  });

  test("las mutations createContact/changeContactStatus/updateContact/closeSale aceptan a Marta", async ({
    context,
  }) => {
    const client = convexClient();
    const martaToken = await sessionTokenFrom(context); // esta spec corre autenticada como Marta

    const created = await client.mutation(api.contacts.createContact, {
      token: martaToken,
      name: uniqueContactName("GatingServer"),
      phone: uniquePhone(),
    });
    if (!created.success) throw new Error("createContact debía aceptar a Marta: " + created.error);

    const statusResult = await client.mutation(api.contacts.changeContactStatus, {
      token: martaToken,
      contactId: created.id,
      status: "talking",
    });
    if (!statusResult.success) {
      throw new Error("changeContactStatus debía aceptar a Marta: " + statusResult.error);
    }

    const updateResult = await client.mutation(api.contacts.updateContact, {
      token: martaToken,
      contactId: created.id,
      name: "Nombre editado por Marta",
      phone: uniquePhone(),
    });
    if (!updateResult.success) throw new Error("updateContact debía aceptar a Marta: " + updateResult.error);

    const closeResult = await client.mutation(api.sales.closeSale, {
      token: martaToken,
      contactId: created.id,
      outcome: "won",
      product: "Producto de prueba",
      amountCents: 10000,
      purchaseDate: Date.now(),
    });
    if (!closeResult.success) throw new Error("closeSale debía aceptar a Marta: " + closeResult.error);
  });
});

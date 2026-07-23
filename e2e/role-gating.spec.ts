import { test, expect } from "@playwright/test";
import { ConvexError } from "convex/values";
import { convexClient, sessionTokenFrom, carlosTokenFromDisk, api } from "./helpers/convex-client";
import { uniqueContactName, uniquePhone } from "./helpers/test-data";

// MIS-20: Marta no puede crear ni editar contactos accidentalmente, salvo
// las acciones SÍ habilitadas para su rol (AC del ticket, paso 7). Marta
// NO tiene "solo lectura absoluta" — ver decisión 10 del plan: addNote,
// scheduleReminder y completeReminder usan requireUser (ambos roles), no
// requireRole. Este archivo distingue explícitamente ambos casos.
test.describe("Marta: gating de rol", () => {
  test("el FAB 'Añadir contacto' no está presente para Marta", async ({ page }) => {
    // MIS-20 corrige el Major de la auditoría de plan: (with-nav)/layout.tsx
    // ahora oculta <AddContactFab /> para user.role !== "rep".
    await page.goto("/panel");
    await expect(page.getByRole("link", { name: "Añadir contacto" })).toHaveCount(0);
  });

  test("navegación directa a /contactos/nuevo sigue mostrando el mensaje de solo lectura (defensa en profundidad)", async ({
    page,
  }) => {
    // Sin pasar por el FAB (que ya no existe para Marta) — simula un
    // bookmark o URL escrita a mano. El guard de servidor de
    // contactos/nuevo/page.tsx debe seguir bloqueando el formulario.
    await page.goto("/contactos/nuevo");
    await expect(
      page.getByText("Solo el rol operativo puede añadir contactos. Tu cuenta tiene acceso de lectura."),
    ).toBeVisible();
    await expect(page.getByLabel("Nombre completo")).toHaveCount(0);
  });

  test("ficha de un contacto no cerrado: 'Cambiar estado'/'Cerrar venta' ausentes, pero acciones habilitadas para Marta siguen disponibles", async ({
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

    // Bloqueadas para Marta (requireRole "rep" en el servidor).
    await expect(page.getByRole("button", { name: "Cambiar estado" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Cerrar venta" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Editar datos" })).toHaveCount(0); // MIS-252

    // Acciones HABILITADAS para Marta (requireUser, ambos roles) — se
    // nombran así explícitamente, no "edición", para no dar a entender un
    // bloqueo total que no corresponde al AC ni al comportamiento real.
    await expect(page.getByRole("button", { name: "Añadir nota" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Programar seguimiento" })).toBeVisible();

    // Sugerencia media de la auditoría de código: no basta con que el botón
    // esté visible — se ejercita de verdad como Marta, para probar que es
    // realmente funcional para su rol, no solo un botón renderizado y roto.
    await page.getByRole("button", { name: "Añadir nota" }).click();
    const dialog = page.getByRole("dialog", { name: "Nueva nota" });
    await dialog.getByLabel("Tipo de contacto").selectOption("call");
    await dialog.getByLabel("Resumen").fill("Nota añadida por Marta en verificación de rol");
    await dialog.getByRole("button", { name: "Guardar" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Nota añadida por Marta en verificación de rol")).toBeVisible();
  });

  test("defensa de servidor: createContact/changeContactStatus/closeSale rechazan a Marta con ConvexError(No autorizado)", async ({
    context,
  }) => {
    const client = convexClient();
    const martaToken = await sessionTokenFrom(context); // esta spec corre autenticada como Marta

    // createContact
    let threw = false;
    try {
      await client.mutation(api.contacts.createContact, {
        token: martaToken,
        name: "No debería crearse",
        phone: uniquePhone(),
      });
    } catch (err) {
      threw = true;
      expect(err).toBeInstanceOf(ConvexError);
      expect((err as ConvexError<string>).data).toBe("No autorizado");
    }
    expect(threw, "createContact debía rechazar a Marta").toBe(true);

    // Contacto real sembrado como Carlos, para que el rechazo de
    // changeContactStatus/closeSale sea por ROL, no un falso positivo por
    // "contacto no encontrado" con un ID inventado.
    const carlosToken = carlosTokenFromDisk();
    const created = await client.mutation(api.contacts.createContact, {
      token: carlosToken,
      name: uniqueContactName("GatingServer"),
      phone: uniquePhone(),
    });
    if (!created.success) throw new Error("Seed falló: createContact");

    threw = false;
    try {
      await client.mutation(api.contacts.changeContactStatus, {
        token: martaToken,
        contactId: created.id,
        status: "talking",
      });
    } catch (err) {
      threw = true;
      expect(err).toBeInstanceOf(ConvexError);
      expect((err as ConvexError<string>).data).toBe("No autorizado");
    }
    expect(threw, "changeContactStatus debía rechazar a Marta").toBe(true);

    threw = false;
    try {
      await client.mutation(api.sales.closeSale, {
        token: martaToken,
        contactId: created.id,
        outcome: "won",
        product: "x",
        amountCents: 100,
        purchaseDate: Date.now(),
      });
    } catch (err) {
      threw = true;
      expect(err).toBeInstanceOf(ConvexError);
      expect((err as ConvexError<string>).data).toBe("No autorizado");
    }
    expect(threw, "closeSale debía rechazar a Marta").toBe(true);

    // MIS-252
    threw = false;
    try {
      await client.mutation(api.contacts.updateContact, {
        token: martaToken,
        contactId: created.id,
        name: "No debería editarse",
        phone: uniquePhone(),
      });
    } catch (err) {
      threw = true;
      expect(err).toBeInstanceOf(ConvexError);
      expect((err as ConvexError<string>).data).toBe("No autorizado");
    }
    expect(threw, "updateContact debía rechazar a Marta").toBe(true);
  });
});

import { test, expect } from "@playwright/test";
import { convexClient, carlosTokenFromDisk, api } from "./helpers/convex-client";
import { uniqueContactName, uniquePhone } from "./helpers/test-data";

// MIS-20: aislado en su propio archivo y marcado test.slow() (triplica el
// timeout por defecto) precisamente porque incluye una espera real de
// pared de ~24s para el setInterval de 20s de PanelAutoRefresh.tsx — no se
// mockea el timer ni se usa page.clock: el AC pide confirmar el
// comportamiento REAL de auto-refresco sin recarga manual, igual que ya se
// verificó manualmente en PLANS/MIS-17-panel-oportunidades.md. Aquí se
// automatiza esa misma comprobación manual, no se inventa una nueva.
test.describe("Panel: refresco automático en tiempo real", () => {
  test.slow();

  test("un cambio de estado hecho por Carlos aparece en el panel de Marta sin recarga manual", async ({ page }) => {
    const client = convexClient();
    const carlosToken = carlosTokenFromDisk();

    const created = await client.mutation(api.contacts.createContact, {
      token: carlosToken,
      name: uniqueContactName("Realtime"),
      phone: uniquePhone(),
    });
    if (!created.success) throw new Error("Seed falló: createContact");

    const before = await client.query(api.contacts.getPipelineSummary, { token: carlosToken });

    await page.goto("/panel");
    const talkingTile = page.getByRole("link").filter({ hasText: "En conversación" });
    await expect(talkingTile).toContainText(String(before.talking));

    // Cambio concurrente, hecho como Carlos, DESPUÉS de que Marta ya está
    // viendo el panel — simula la situación real del AC ("refleja cambios
    // de Carlos en tiempo real").
    await client.mutation(api.contacts.changeContactStatus, {
      token: carlosToken,
      contactId: created.id,
      status: "talking",
    });

    // Espera real de pared, deliberada — NO page.reload(). Margen de 24s
    // sobre el intervalo real de 20s, sin acercarse al siguiente ciclo de
    // 40s.
    await page.waitForTimeout(24_000);

    await expect(talkingTile).toContainText(String(before.talking + 1));
  });
});

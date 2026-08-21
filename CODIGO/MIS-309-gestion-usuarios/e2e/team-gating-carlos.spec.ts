import { test, expect } from "@playwright/test";
import { ConvexError } from "convex/values";
import { convexClient, sessionTokenFrom, api } from "./helpers/convex-client";

// MIS-309: Carlos (rol `rep`) NO administra usuarios. Corre bajo chromium-carlos
// (storageState de Carlos). Comprueba el gate de navegación (UI) y, sobre todo,
// que la autorización REAL vive en Convex: aunque alguien saltara la UI,
// requireOwner rechaza a Carlos con FORBIDDEN (M2).
test.describe("MIS-309 · Carlos no administra usuarios", () => {
  test("/equipo no es accesible para Carlos y el Panel no ofrece administración (UI)", async ({
    page,
  }) => {
    // El server component de /equipo hace redirect("/") si no es supervisor. No
    // se fija el destino EXACTO del dispatcher (evita acoplarse a /pendientes vs
    // /panel): lo que importa es que Carlos NO ve la pantalla de administración.
    await page.goto("/equipo");
    await expect(page).not.toHaveURL(/\/equipo$/);
    await expect(page.getByRole("heading", { name: "Usuarios y equipo" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Invitar usuario/ })).toHaveCount(0);

    await page.goto("/panel");
    await expect(page.getByRole("link", { name: /Usuarios y equipo/ })).toHaveCount(0);
  });

  test("las funciones de team rechazan a Carlos con FORBIDDEN (backend, M2)", async ({ context }) => {
    const client = convexClient();
    const carlosToken = await sessionTokenFrom(context);

    const err = await client.query(api.team.listTeam, { token: carlosToken }).catch((e) => e);
    expect(err).toBeInstanceOf(ConvexError);
    expect((err as ConvexError<{ code?: string }>).data?.code).toBe("FORBIDDEN");

    // Una mutation de admin también: inviteUser es action → igualmente pasa por
    // requireOwner en su internalMutation y lanza FORBIDDEN antes de cualquier efecto.
    const err2 = await client
      .action(api.team.inviteUser, {
        token: carlosToken,
        name: "X",
        email: "x@team-e2e.test.local",
        role: "rep",
      })
      .catch((e) => e);
    expect(err2).toBeInstanceOf(ConvexError);
    expect((err2 as ConvexError<{ code?: string }>).data?.code).toBe("FORBIDDEN");
  });
});

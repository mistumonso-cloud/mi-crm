import { test, expect } from "@playwright/test";
import { ConvexError } from "convex/values";
import { convexClient, sessionTokenFrom, api } from "./helpers/convex-client";
import { teamTestEmail, deleteTeamTestUser } from "./helpers/test-support";

// MIS-309: gestión de usuarios ("Usuarios y equipo"). Corre bajo el project
// chromium-marta (storageState de Marta = supervisor). Las aserciones de backend
// van por el cliente Convex directo con el token REAL de Marta (mismo patrón que
// role-gating.spec.ts); las de UI, por la página.
//
// Cobertura DETERMINISTA (ver PLANS/MIS-309-gestion-usuarios.md y el
// codigo-completo.md): contrato de errores M2, guard "último admin",
// normalización de email, recuperación de invitación (M1, backend) y gates de
// navegación. M3 (aceptación por Google), el aviso de reenvío fallido en UI (M4)
// y "reactivar conserva contraseña" se verifican por lectura + manual (limitación
// del harness: outbox de la identidad dedicada, sin secreto de Google en test).
//
// Un supervisor "activo" = supervisor sin baja y sin invitación pendiente.
function activeSupervisors<T extends { role: "rep" | "supervisor"; deactivatedAt?: number; invitePendingSince?: number }>(
  team: T[],
): T[] {
  return team.filter((u) => u.role === "supervisor" && u.deactivatedAt == null && u.invitePendingSince == null);
}

test.describe("MIS-309 · gestión de usuarios (backend, como Marta)", () => {
  test("listTeam: Marta autorizada; token inválido → UNAUTHENTICATED; sin passwordHash", async ({
    context,
  }) => {
    const client = convexClient();
    const martaToken = await sessionTokenFrom(context);

    const team = await client.query(api.team.listTeam, { token: martaToken });
    expect(Array.isArray(team)).toBe(true);
    expect(team.length).toBeGreaterThanOrEqual(1);
    for (const u of team) {
      expect(u).not.toHaveProperty("passwordHash");
      expect(typeof u.email).toBe("string");
    }

    // Token inválido → requireOwner lanza ConvexError con code UNAUTHENTICATED (M2).
    const err = await client.query(api.team.listTeam, { token: "token-invalido" }).catch((e) => e);
    expect(err).toBeInstanceOf(ConvexError);
    expect((err as ConvexError<{ code?: string }>).data?.code).toBe("UNAUTHENTICATED");
  });

  test("inviteUser: los errores de negocio se DEVUELVEN, no se lanzan (M2 + normalización)", async ({
    context,
  }) => {
    const client = convexClient();
    const martaToken = await sessionTokenFrom(context);

    // Email inválido → { success:false, field:"email" } (devuelto, no lanzado).
    const bad = await client.action(api.team.inviteUser, {
      token: martaToken,
      name: "Nombre",
      email: "no-es-un-email",
      role: "rep",
    });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.field).toBe("email");

    // Email ya existente (Carlos), en MAYÚSCULAS → normaliza y detecta duplicado.
    const carlosEmail = process.env.E2E_CARLOS_EMAIL;
    if (carlosEmail) {
      const dup = await client.action(api.team.inviteUser, {
        token: martaToken,
        name: "Nombre",
        email: carlosEmail.toUpperCase(),
        role: "rep",
      });
      expect(dup.success).toBe(false);
    }
  });

  test("guard 'último admin': no se puede bajar de rol ni desactivar a la única supervisora", async ({
    context,
  }) => {
    const client = convexClient();
    const martaToken = await sessionTokenFrom(context);

    const team = await client.query(api.team.listTeam, { token: martaToken });
    const supers = activeSupervisors(team);
    // El entorno de test tiene exactamente una supervisora activa (Marta).
    expect(supers.length).toBe(1);
    const marta = supers[0];

    const demote = await client.mutation(api.team.changeUserRole, {
      token: martaToken,
      userId: marta.id,
      role: "rep",
    });
    expect(demote.success).toBe(false);

    const deactivate = await client.mutation(api.team.setUserActive, {
      token: martaToken,
      userId: marta.id,
      active: false,
    });
    expect(deactivate.success).toBe(false);

    // Sigue intacta: supervisora y activa.
    const after = await client.query(api.team.listTeam, { token: martaToken });
    const martaAfter = after.find((u) => u.id === marta.id);
    expect(martaAfter?.role).toBe("supervisor");
    expect(martaAfter?.deactivatedAt == null).toBe(true);
  });

  test("invitación recuperable: invitar → pendiente → reenviar sin duplicar (M1)", async ({
    context,
  }) => {
    const client = convexClient();
    const martaToken = await sessionTokenFrom(context);
    const email = teamTestEmail("m1");
    try {
      const inv = await client.action(api.team.inviteUser, {
        token: martaToken,
        name: "Laura E2E",
        email,
        role: "rep",
      });
      expect(inv.success).toBe(true); // `delivered` puede ser true/false según Resend; no se asume

      // Aparece como invitación pendiente.
      let team = await client.query(api.team.listTeam, { token: martaToken });
      const row = team.find((u) => u.email === email);
      expect(row).toBeTruthy();
      expect(row!.invitePendingSince != null).toBe(true);
      expect(row!.deactivatedAt == null).toBe(true);

      // Reinvitar el mismo email → already_invited (NO crea otro usuario).
      const dup = await client.action(api.team.inviteUser, {
        token: martaToken,
        name: "Otra vez",
        email,
        role: "rep",
      });
      expect(dup.success).toBe(false);
      if (!dup.success) expect(dup.code).toBe("already_invited");

      // Reenviar → ok, sin crear otro usuario.
      const re = await client.action(api.team.resendInvite, { token: martaToken, userId: row!.id });
      expect(re.success).toBe(true);
      team = await client.query(api.team.listTeam, { token: martaToken });
      expect(team.filter((u) => u.email === email).length).toBe(1);

      // Reenviar a un id inexistente → rechazado (devuelto).
      const reBad = await client.action(api.team.resendInvite, {
        token: martaToken,
        userId: "id-que-no-existe",
      });
      expect(reBad.success).toBe(false);
    } finally {
      await deleteTeamTestUser(email);
    }
  });

  test("cambiar rol y baja lógica reversible sobre un usuario normal (estado)", async ({ context }) => {
    const client = convexClient();
    const martaToken = await sessionTokenFrom(context);
    const email = teamTestEmail("state");
    try {
      await client.action(api.team.inviteUser, {
        token: martaToken,
        name: "Temporal E2E",
        email,
        role: "rep",
      });
      let team = await client.query(api.team.listTeam, { token: martaToken });
      const id = team.find((u) => u.email === email)!.id;

      // Cambiar rol rep → supervisor (permitido; sigue pendiente, no cuenta como admin activo).
      const rc = await client.mutation(api.team.changeUserRole, {
        token: martaToken,
        userId: id,
        role: "supervisor",
      });
      expect(rc.success).toBe(true);
      team = await client.query(api.team.listTeam, { token: martaToken });
      expect(team.find((u) => u.id === id)!.role).toBe("supervisor");

      // Desactivar (no es supervisora activa: está pendiente) → permitido.
      const d = await client.mutation(api.team.setUserActive, {
        token: martaToken,
        userId: id,
        active: false,
      });
      expect(d.success).toBe(true);
      team = await client.query(api.team.listTeam, { token: martaToken });
      expect(team.find((u) => u.id === id)!.deactivatedAt != null).toBe(true);

      // Reactivar → se limpia la baja.
      const r = await client.mutation(api.team.setUserActive, {
        token: martaToken,
        userId: id,
        active: true,
      });
      expect(r.success).toBe(true);
      team = await client.query(api.team.listTeam, { token: martaToken });
      expect(team.find((u) => u.id === id)!.deactivatedAt == null).toBe(true);
    } finally {
      await deleteTeamTestUser(email);
    }
  });
  test("concurrencia (OCC): dos invitaciones simultáneas del mismo email no duplican", async ({
    context,
  }) => {
    const client = convexClient();
    const martaToken = await sessionTokenFrom(context);
    const email = teamTestEmail("race");
    try {
      // Dos createPendingUser en paralelo: ambas leen el índice by_email (vacío) e
      // intentan insertar. Convex serializa por OCC — la segunda se reejecuta,
      // encuentra la fila ya creada y devuelve already_invited. Exactamente una gana.
      const [a, b] = await Promise.all([
        client.action(api.team.inviteUser, { token: martaToken, name: "A", email, role: "rep" }),
        client.action(api.team.inviteUser, { token: martaToken, name: "B", email, role: "rep" }),
      ]);
      const successes = [a, b].filter((r) => r.success).length;
      expect(successes).toBe(1);
      const team = await client.query(api.team.listTeam, { token: martaToken });
      expect(team.filter((u) => u.email === email).length).toBe(1);
    } finally {
      await deleteTeamTestUser(email);
    }
  });

  // Concurrencia del "último supervisor" (desactivar A y degradar B a la vez): NO
  // se automatiza aquí porque la driver de estas pruebas (Marta) es SIEMPRE una
  // supervisora activa, así que el invariante "≥1 admin activo" no puede romperse
  // en este entorno y no habría nada que observar. Queda REGISTRADA como gate
  // pre-PR razonado: el guard lee el conjunto completo de supervisores
  // (convex/team.ts::changeUserRole/setUserActive) y Convex serializa por OCC dos
  // mutaciones que comparten ese read-set (la segunda se reejecuta contra el
  // estado ya actualizado y su guard la rechaza). La carrera de dedupe de arriba
  // ejercita esa MISMA serialización OCC sobre el módulo team.
  test.skip("concurrencia último supervisor: gate pre-PR razonado (ver comentario)", () => {});
});

test.describe("MIS-309 · navegación y contrato UI (como Marta)", () => {
  test("Panel muestra 'Usuarios y equipo' y lleva a /equipo", async ({ page }) => {
    await page.goto("/panel");
    const card = page.getByRole("link", { name: /Usuarios y equipo/ });
    await expect(card).toBeVisible();
    await card.click();
    await expect(page).toHaveURL(/\/equipo$/);
    await expect(page.getByRole("heading", { name: "Usuarios y equipo" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Invitar usuario/ })).toBeVisible();
  });

  test("un error de negocio (email duplicado) permanece en /equipo, sin logout (M2, UI)", async ({
    page,
  }) => {
    const carlosEmail = process.env.E2E_CARLOS_EMAIL;
    test.skip(!carlosEmail, "Falta E2E_CARLOS_EMAIL para el caso de email duplicado");

    await page.goto("/equipo");
    await page.getByRole("button", { name: /Invitar usuario/ }).click();
    const dialog = page.getByRole("dialog", { name: "Invitar usuario" });
    await dialog.locator('input[name="name"]').fill("Duplicado E2E");
    await dialog.locator('input[name="email"]').fill(carlosEmail!);
    await dialog.getByRole("button", { name: /Enviar invitación/ }).click();

    // El error de negocio vuelve como estado visible: permanece en /equipo (no
    // redirige a /login ni a /) y muestra el mensaje. Contrato M2 end-to-end.
    await expect(dialog.getByText(/Ya existe un usuario/i)).toBeVisible();
    await expect(page).toHaveURL(/\/equipo$/);
  });
});

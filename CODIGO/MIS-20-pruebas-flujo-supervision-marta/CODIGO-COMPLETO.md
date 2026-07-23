# MIS-20 — Código completo (Pruebas E2E del flujo de supervisión de Marta)

Todos los archivos de esta tarea, concatenados en un único documento para copiar a auditoría. Cada sección indica la ruta real de destino y si es NUEVO o EDITAR.

---

## `playwright.config.ts` (EDITAR)

```ts
import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";
import path from "path";

// Orden importa: .env.local primero (NEXT_PUBLIC_CONVEX_URL, ya usado por
// `npm run dev`), .env.test.local después para que las credenciales de test
// puedan solaparse sin pisar nada de .env.local.
dotenv.config({ path: path.resolve(__dirname, ".env.local") });
dotenv.config({ path: path.resolve(__dirname, ".env.test.local") });

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  // Todos los tests comparten el mismo deployment de Convex de dev
  // (dutiful-mole-111, el mismo que usa `npm run dev` en local) — un solo
  // worker evita carreras de datos entre specs que leen/escriben las mismas
  // pantallas (Pendientes, lista de contactos, Panel).
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    // MIS-20: dos usuarios autenticados (Carlos, Marta) — cada uno con su
    // propio setup project y su propio project de test, con testMatch
    // explícito y disjunto en ambos niveles. Antes (MIS-19, un solo
    // usuario) un único "setup" con regex genérico /.*\.setup\.ts/ y un
    // "chromium" sin testMatch (todo *.spec.ts por defecto) no importaban
    // porque solo existía un usuario — con dos, el testMatch por defecto
    // haría que cada project de test corriera TAMBIÉN los specs del otro
    // usuario bajo el storageState equivocado, fallando por el motivo
    // equivocado (rol, no el bug real que ese spec prueba).
    { name: "setup-carlos", testMatch: "auth.setup.ts" },
    { name: "setup-marta", testMatch: "auth-marta.setup.ts" },

    {
      name: "chromium-carlos",
      testMatch: ["full-flow.spec.ts", "edge-cases.spec.ts"],
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/carlos.json" },
      dependencies: ["setup-carlos"],
    },
    {
      name: "chromium-marta",
      testMatch: ["panel-flow.spec.ts", "role-gating.spec.ts", "realtime-panel.spec.ts"],
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/marta.json" },
      // Depende de AMBOS setups: los specs de Marta siembran datos como
      // Carlos vía carlosTokenFromDisk() (lee e2e/.auth/carlos.json del
      // disco) — ese archivo debe existir ya antes de que arranque
      // cualquier test de Marta. Playwright ejecuta las dependencies
      // listadas en orden y espera a que cada una termine.
      dependencies: ["setup-carlos", "setup-marta"],
    },
  ],
  webServer: {
    command: "npm run dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

---

## `.env.test.local.example` (EDITAR)

```
# Copia a .env.test.local (gitignored) y rellena con las credenciales reales
# de Carlos y Marta en el deployment de dev de Convex (dutiful-mole-111).
E2E_CARLOS_EMAIL=carlos@test.local
E2E_CARLOS_PASSWORD=
E2E_MARTA_EMAIL=marta@test.local
E2E_MARTA_PASSWORD=
E2E_BASE_URL=http://localhost:3000
```

---

## `.github/workflows/ci.yml` (EDITAR)

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - run: npm ci
      - run: npm run lint
      - run: npm run build

  e2e:
    runs-on: ubuntu-latest
    needs: build
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
        env:
          NEXT_PUBLIC_CONVEX_URL: ${{ secrets.NEXT_PUBLIC_CONVEX_URL }}
          E2E_CARLOS_EMAIL: ${{ secrets.E2E_CARLOS_EMAIL }}
          E2E_CARLOS_PASSWORD: ${{ secrets.E2E_CARLOS_PASSWORD }}
          E2E_MARTA_EMAIL: ${{ secrets.E2E_MARTA_EMAIL }}
          E2E_MARTA_PASSWORD: ${{ secrets.E2E_MARTA_PASSWORD }}

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 14
```

---

## `src/app/(app)/(with-nav)/layout.tsx` (EDITAR)

```tsx
import type { ReactNode } from "react";
import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../convex/_generated/api";
import { AddContactFab } from "@/components/crm/AddContactFab";
import { BottomNav } from "@/components/crm/BottomNav";
import { getUser } from "@/lib/auth/dal";
import { readSessionToken } from "@/lib/auth/cookie";

// Envuelve Pendientes/Contactos/Panel con la barra inferior + FAB. MIS-12
// añade aquí la lectura de countDueToday para alimentar el badge de
// "Pendientes" del BottomNav — se hace en el layout (no en cada page) para
// que el badge esté visible y actualizado en las 3 pestañas, no solo en
// /pendientes. Fuera de este route group (contactos/nuevo, contactos/[id])
// no se hereda nada de esto — exclusión estructural por carpeta.
//
// await getUser() aquí es redundante con (app)/layout.tsx (que ya redirige
// a /login si no hay sesión) pero barato de repetir: getUser() está
// envuelto en cache() de React, así que dentro de la misma petición no
// vuelve a golpear Convex. Se mantiene por el mismo motivo documentado en
// src/lib/auth/dal.ts — un layout no se re-ejecuta en cada navegación
// entre hermanos (Pendientes↔Contactos↔Panel), así que este badge NO se
// refresca solo con la navegación normal entre tabs; se refresca cuando
// una Server Action (programar/completar un recordatorio) llama a
// refresh(), que sí re-renderiza el árbol completo incluida esta capa
// compartida (ver "Refresh data" / ejemplo del contador de notificaciones
// del header en node_modules/next/dist/docs/01-app/01-getting-started/
// 07-mutating-data.md).
export default async function WithNavLayout({ children }: { children: ReactNode }) {
  const user = await getUser();
  const token = await readSessionToken(); // getUser() ya garantiza sesión válida aquí
  const dueTodayCount = await fetchQuery(api.reminders.countDueToday, { token: token! });

  return (
    <>
      <div
        className="flex flex-1 flex-col"
        style={{ paddingBottom: "calc(72px + env(safe-area-inset-bottom))" }}
      >
        {children}
      </div>
      {/* MIS-20 (corrige Major de la auditoría de plan): el FAB solo tiene
          sentido para quien puede crear contactos (requireRole "rep" en
          createContact) — mostrarlo a Marta la llevaba a un callejón sin
          salida en /contactos/nuevo (formulario reemplazado por un mensaje
          de solo lectura). Se oculta por completo para supervisor; el
          guard de servidor en contactos/nuevo/page.tsx se mantiene como
          defensa en profundidad ante navegación directa a la URL. */}
      {user.role === "rep" && <AddContactFab />}
      <BottomNav dueTodayCount={dueTodayCount} />
    </>
  );
}
```

---

## `src/app/(app)/contactos/nuevo/page.tsx` (EDITAR)

```tsx
import Link from "next/link";
import { getUser } from "@/lib/auth/dal";
import { NewContactForm } from "./NewContactForm";

// Placeholder de MIS-18 sustituido por el formulario real (MIS-8). Solo
// "rep" (Carlos) puede crear contactos — ver requireRole en
// convex/contacts.ts::createContact. Se comprueba el rol aquí para mostrar
// un mensaje claro a Marta en vez de dejarle rellenar un formulario
// condenado a fallar en el servidor. Desde MIS-20, el FAB de
// (with-nav)/layout.tsx ya no trae hasta aquí para Marta (se oculta si
// user.role !== "rep") — este guard pasa a ser defensa en profundidad para
// quien llegue por navegación directa a la URL (bookmark, escritura
// manual), no la única barrera como antes.
export default async function NuevoContactoPage() {
  const user = await getUser();

  return (
    <div className="flex flex-1 flex-col" style={{ padding: "16px 20px" }}>
      <Link
        href="/contactos"
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: "var(--color-accent)",
          textDecoration: "none",
          alignSelf: "flex-start",
          marginBottom: 16,
        }}
      >
        ‹ Cancelar
      </Link>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)", marginBottom: 20 }}>
        Nuevo contacto
      </h1>
      {user.role === "rep" ? (
        <NewContactForm />
      ) : (
        <p style={{ fontSize: 14, color: "var(--text-secondary)" }}>
          Solo el rol operativo puede añadir contactos. Tu cuenta tiene acceso de lectura.
        </p>
      )}
    </div>
  );
}
```

---

## `e2e/helpers/convex-client.ts` (EDITAR)

```ts
import { ConvexHttpClient } from "convex/browser";
import type { BrowserContext } from "@playwright/test";
import { readFileSync } from "fs";
import path from "path";
import { api } from "../../convex/_generated/api";

export function convexClient(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("Falta NEXT_PUBLIC_CONVEX_URL (léelo de .env.local)");
  return new ConvexHttpClient(url);
}

// Extrae el token de sesión real (cookie HttpOnly "session") del contexto
// autenticado de Playwright — el mismo valor que Next.js pasa como `token`
// a fetchQuery/fetchMutation. No es un atajo inseguro: es el token real
// emitido por el login real hecho en auth.setup.ts (confirmado en
// src/lib/auth/cookie.ts: la cookie guarda el token en claro, el hash solo
// se calcula server-side para comparar contra sessions.tokenHash).
export async function sessionTokenFrom(context: BrowserContext): Promise<string> {
  const cookies = await context.cookies();
  const session = cookies.find((c) => c.name === "session");
  if (!session) throw new Error("No hay cookie de sesión — ¿corrió auth.setup.ts?");
  return session.value;
}

// Forma mínima del storageState que Playwright escribe con
// context.storageState() — solo lo que necesitamos leer aquí.
type StorageState = { cookies: Array<{ name: string; value: string }> };

// MIS-20: extrae el token de sesión de Carlos DIRECTAMENTE del archivo en
// disco (e2e/.auth/carlos.json), sin necesitar ningún BrowserContext de
// Carlos vivo — necesario para specs de Marta (panel-flow, role-gating,
// realtime-panel) que siembran datos como Carlos (crear contacto, cambiar
// estado, cerrar venta — todo lo que requireRole(ctx, token, "rep") exige)
// mientras el navegador bajo test sigue autenticado como Marta.
// sessionTokenFrom(context) no sirve aquí: solo lee las cookies del
// contexto ACTUAL, que en estas specs es el de Marta, no el de Carlos.
// Mismo principio de "token real, sin atajos inseguros" que
// sessionTokenFrom, solo que leído de un archivo en vez de una cookie de
// un contexto activo.
export function carlosTokenFromDisk(): string {
  const authFile = path.resolve(__dirname, "../.auth/carlos.json");
  let state: StorageState;
  try {
    state = JSON.parse(readFileSync(authFile, "utf-8"));
  } catch {
    throw new Error(
      `No se pudo leer ${authFile} — ¿corrió el project "setup-carlos" antes? (chromium-marta debe listar "setup-carlos" en dependencies)`,
    );
  }
  const session = state.cookies?.find((c) => c.name === "session");
  if (!session) {
    throw new Error(`${authFile} no contiene cookie "session" — storageState corrupto, vacío, o de otra forma inesperada`);
  }
  return session.value;
}

export { api };
```

---

## `e2e/auth-marta.setup.ts` (NUEVO)

```ts
import { test as setup, expect } from "@playwright/test";

const authFile = "e2e/.auth/marta.json";

setup("log in as Marta", async ({ page }) => {
  const email = process.env.E2E_MARTA_EMAIL;
  const password = process.env.E2E_MARTA_PASSWORD;
  if (!email || !password) {
    throw new Error("Faltan E2E_MARTA_EMAIL/E2E_MARTA_PASSWORD — copia .env.test.local.example a .env.test.local");
  }

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  // Mismo motivo que en auth.setup.ts: getByLabel("Contraseña") es
  // ambiguo (el <label> de Input.jsx envuelve también el botón-sufijo
  // "Mostrar contraseña"). Selector inequívoco por name.
  await page.locator('input[name="password"]').fill(password);

  await page.getByRole("button", { name: "Entrar" }).click();
  // waitForURL, no solo el submit — mismo motivo que auth.setup.ts. El
  // dispatcher (src/app/(app)/page.tsx) manda a "supervisor" a /panel, no
  // a /pendientes como a Carlos.
  await page.waitForURL("/panel");

  await expect(page.getByRole("heading", { name: /Hola, Marta/ })).toBeVisible();
  await expect(page.getByText("Supervisora")).toBeVisible();

  await page.context().storageState({ path: authFile });
});
```

---

## `e2e/panel-flow.spec.ts` (NUEVO)

```ts
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
```

---

## `e2e/role-gating.spec.ts` (NUEVO)

```ts
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
  });
});
```

---

## `e2e/realtime-panel.spec.ts` (NUEVO)

```ts
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

    // Espera real de pared, deliberada — NO page.reload(). expect.poll en
    // vez de un waitForTimeout fijo (sugerencia baja de la auditoría de
    // código): reintenta leyendo el texto del tile cada 2s hasta 30s de
    // margen sobre el intervalo real de 20s — más robusto ante lentitud
    // ocasional del runner sin alargar el caso normal (se resuelve en
    // cuanto el próximo router.refresh() automático aplica el cambio,
    // típicamente ~20-22s, en vez de esperar siempre el máximo).
    await expect
      .poll(async () => (await talkingTile.textContent()) ?? "", { timeout: 30_000, intervals: [2_000] })
      .toContain(String(before.talking + 1));
  });
});
```

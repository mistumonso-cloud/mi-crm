# MIS-19 — Código completo (Pruebas E2E del flujo completo de Carlos)

Todos los archivos de esta tarea, concatenados en un único documento para copiar a auditoría. Cada sección indica la ruta real de destino y si es NUEVO o EDITAR.

---

## `playwright.config.ts` (NUEVO)

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
  // pantallas (Pendientes, lista de contactos).
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
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/carlos.json" },
      dependencies: ["setup"],
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

## `.env.test.local.example` (NUEVO, committed)

```
# Copia a .env.test.local (gitignored) y rellena con las credenciales reales
# de Carlos en el deployment de dev de Convex (dutiful-mole-111).
E2E_CARLOS_EMAIL=carlos@test.local
E2E_CARLOS_PASSWORD=
E2E_BASE_URL=http://localhost:3000
```

---

## `.gitignore` (EDITAR)

Diff aplicado:

```diff
 # env files (can opt-in for committing if needed)
 .env*
 !.env.local.example
+!.env.test.local.example
 
 # vercel
 .vercel
 
 # typescript
 *.tsbuildinfo
 next-env.d.ts
+
+# playwright (MIS-19)
+/test-results/
+/playwright-report/
+/playwright/.cache/
+/e2e/.auth/
```

---

## `package.json` (EDITAR)

Diff aplicado:

```diff
     "dev": "next dev",
     "build": "next build",
     "start": "next start",
-    "lint": "eslint"
+    "lint": "eslint",
+    "test:e2e": "playwright test",
+    "test:e2e:report": "playwright show-report"
   },
   "dependencies": {
     "convex": "^1.42.1",
@@
   "devDependencies": {
+    "@playwright/test": "^1.49.0",
     "@tailwindcss/postcss": "^4",
     "@types/node": "^20",
     "@types/react": "^19",
     "@types/react-dom": "^19",
+    "dotenv": "^16.4.5",
     "eslint": "^9",
```

(`package-lock.json` regenerado por `npm install`; no se reproduce aquí por tamaño — instalado resuelve `@playwright/test@1.61.1`.)

---

## `.github/workflows/ci.yml` (EDITAR)

Contenido final completo:

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

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 14
```

---

## `e2e/auth.setup.ts` (NUEVO)

```ts
import { test as setup, expect } from "@playwright/test";

const authFile = "e2e/.auth/carlos.json";

setup("log in as Carlos", async ({ page }) => {
  const email = process.env.E2E_CARLOS_EMAIL;
  const password = process.env.E2E_CARLOS_PASSWORD;
  if (!email || !password) {
    throw new Error("Faltan E2E_CARLOS_EMAIL/E2E_CARLOS_PASSWORD — copia .env.test.local.example a .env.test.local");
  }

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  // OJO: getByLabel("Contraseña") es ambiguo — el <label> de Input.jsx
  // envuelve tanto el <input> como el botón-sufijo "Mostrar contraseña",
  // y ambos matchean por subcadena ("Contraseña" está contenido en el
  // nombre accesible compuesto del input, y el botón tiene su propio
  // aria-label="Mostrar contraseña"). Selector inequívoco por name.
  await page.locator('input[name="password"]').fill(password);

  await page.getByRole("button", { name: "Entrar" }).click();
  // waitForURL, no solo el submit: los Server Actions de Next 16 no
  // resuelven como una navegación cliente normal — hay que esperar
  // explícitamente la URL final en vez de asumir que el click ya navegó.
  await page.waitForURL("/pendientes");

  await expect(page.getByRole("heading", { name: /Hola, Carlos/ })).toBeVisible();

  await page.context().storageState({ path: authFile });
});
```

---

## `e2e/helpers/convex-client.ts` (NUEVO)

```ts
import { ConvexHttpClient } from "convex/browser";
import type { BrowserContext } from "@playwright/test";
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

export { api };
```

---

## `e2e/helpers/test-data.ts` (NUEVO)

```ts
// Sufijo único por ejecución — evita colisionar con datos de ejecuciones
// anteriores del propio suite, o con datos manuales de desarrollo, en el
// mismo deployment de Convex compartido (dutiful-mole-111).
export function uniqueContactName(label: string): string {
  return `E2E ${label} ${Date.now()}`;
}

// Contador de módulo — uniquePhone() se llama más de una vez por test
// (contacto principal + contacto de control), y derivar solo de Date.now()
// podría colisionar si dos llamadas caen en el mismo milisegundo.
let phoneCounter = 0;

export function uniquePhone(): string {
  // +34 6XX XXX XXX: 5 dígitos del timestamp + 1 dígito de contador
  // incremental, para que dos llamadas en el mismo milisegundo sigan
  // produciendo números distintos.
  phoneCounter = (phoneCounter + 1) % 10;
  const suffix = String(Date.now()).slice(-5) + String(phoneCounter);
  return `+34 600 ${suffix.slice(0, 3)} ${suffix.slice(3)}`;
}
```

---

## `e2e/full-flow.spec.ts` (NUEVO)

```ts
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
```

---

## `e2e/edge-cases.spec.ts` (NUEVO)

```ts
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
```

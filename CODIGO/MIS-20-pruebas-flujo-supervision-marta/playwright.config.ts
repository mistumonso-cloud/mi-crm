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

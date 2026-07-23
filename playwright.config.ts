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

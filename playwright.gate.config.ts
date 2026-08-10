// MIS-286: configuración EXCLUSIVA del gate de fugas de secretos.
//
// Vive separada de playwright.config.ts a propósito. El spec que recoge
// (secret-sentinel.spec.ts) falla intencionadamente, así que no puede convivir
// con los projects normales: `npm run test:e2e` usa la configuración principal,
// que además lo excluye con testIgnore. Doble aislamiento.
//
// Los dos projects recogen EXACTAMENTE el mismo spec y difieren solo en la
// política de captura — que es justo la variable bajo prueba:
//   - gate-trace   → captura ACTIVADA: el centinela DEBE aparecer (control positivo)
//   - gate-secrets → captura DESACTIVADA, igual que "chromium-secrets": NO debe aparecer
//
// Lo ejecuta scripts/check-secret-leak.mjs; no se invoca a mano.

import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, ".env.local") });
dotenv.config({ path: path.resolve(__dirname, ".env.test.local") });

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  // Sin reintentos: el spec falla a propósito y reintentarlo solo duplicaría
  // artefactos y tiempo.
  retries: 0,
  // Reporter JSON: el script lo lee para exigir que la fase ejecutó
  // EXACTAMENTE 1 test (cero tests recogidos debe ser un fallo, no un falso
  // verde por un testMatch mal escrito).
  reporter: [["json", { outputFile: process.env.GATE_REPORT ?? "gate-report.json" }]],
  use: {
    baseURL,
  },
  projects: [
    {
      name: "gate-trace",
      testMatch: ["secret-sentinel.spec.ts"],
      use: {
        ...devices["Desktop Chrome"],
        trace: "on",
        video: "on",
        screenshot: "on",
      },
    },
    {
      name: "gate-secrets",
      testMatch: ["secret-sentinel.spec.ts"],
      // Debe replicar EXACTAMENTE la política de "chromium-secrets" en
      // playwright.config.ts: si una cambia y la otra no, el gate deja de
      // demostrar lo que dice demostrar.
      use: {
        ...devices["Desktop Chrome"],
        trace: "off",
        video: "off",
        screenshot: "off",
      },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});

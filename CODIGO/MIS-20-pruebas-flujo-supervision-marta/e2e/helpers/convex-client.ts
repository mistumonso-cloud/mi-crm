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

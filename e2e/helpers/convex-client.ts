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

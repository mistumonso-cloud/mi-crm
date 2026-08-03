import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, OAUTH_STATE_COOKIE_NAME } from "./constants";

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 días — sesión persistente

// path:"/" explícito en set y clear: sin esto, un cambio futuro de ruta de
// login/logout podría dejar la cookie inaccesible o sin poder borrarla del todo.
export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export async function readSessionToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null;
}

// MIS-260: cookie efímera del flujo OAuth de Google, separada de la de
// sesión — nunca lleva identidad, solo el nonce `state` para CSRF.
const OAUTH_STATE_TTL_SECONDS = 10 * 60; // 10 min — solo dura lo que tarda el consentimiento de Google

export async function setOAuthStateCookie(state: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(OAUTH_STATE_COOKIE_NAME, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // "lax", no "strict": debe sobrevivir a la navegación top-level
    // ENTRANTE que hace Google al volver a /api/auth/google/callback —
    // "strict" no garantiza que la cookie viaje en esa navegación.
    sameSite: "lax",
    path: "/api/auth/google",
    maxAge: OAUTH_STATE_TTL_SECONDS,
  });
}

export async function readOAuthStateCookie(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(OAUTH_STATE_COOKIE_NAME)?.value ?? null;
}

export async function clearOAuthStateCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(OAUTH_STATE_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/google",
    maxAge: 0,
  });
}

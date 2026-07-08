import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME } from "./constants";

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

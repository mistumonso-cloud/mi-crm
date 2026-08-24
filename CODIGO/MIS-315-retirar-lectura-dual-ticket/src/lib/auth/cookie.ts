import { cookies } from "next/headers";
import {
  SESSION_COOKIE_NAME,
  OAUTH_STATE_COOKIE_NAME,
  PKCE_VERIFIER_COOKIE_NAME,
  RESET_TICKET_COOKIE_NAME,
} from "./constants";

// MIS-293 (B1): `secure: true` SIEMPRE, no `process.env.NODE_ENV === "production"`.
// Fail-safe: si en el runtime de prod `NODE_ENV` no fuese exactamente "production",
// la variante anterior emitía cookies SIN `Secure`. Además, los prefijos de nombre
// `__Host-`/`__Secure-` (B2) OBLIGAN a `Secure`, así que no hay alternativa. Sobre
// http://localhost, los navegadores modernos tratan el host como *secure context* y
// aceptan estas cookies; en concreto Chromium (el navegador de los e2e/CI), de modo
// que dev local y la suite de Playwright siguen funcionando.
//
// INVARIANTE de `__Host-session` (lo refuerza el navegador): `Secure` + `Path=/` +
// SIN `Domain`. NUNCA añadir `domain` a la cookie de sesión ni cambiar su `path` de
// "/": el navegador rechazaría la cookie con prefijo `__Host-` por completo.

// Nombres ANTIGUOS (pre-B2). Existen SOLO para BORRARLOS de forma transitoria
// (MIS-293, M1) en su path original — nunca se LEEN (no hay lectura dual). Al
// escribir/limpiar cada cookie nueva se expira su gemela antigua, de modo que la
// cookie vieja (que pudo emitirse sin `Secure`, y que un rollback re-reconocería)
// se retira del navegador en login, logout y —para la sesión— en el redirect del
// proxy. Retirar estas líneas en un follow-up, pasado el TTL máximo (30 d) desde
// la última versión desplegable que emitía estos nombres. Ver PLANS/MIS-293-cookies.md.
const LEGACY_SESSION_COOKIE_NAME = "session";
const LEGACY_OAUTH_STATE_COOKIE_NAME = "google_oauth_state";
// MIS-315: las constantes de los nombres ANTIGUOS del ticket de reseteo
// (`__Secure-reset_ticket` de MIS-293→MIS-312 y el legado pre-B2 `reset_ticket`)
// se retiraron aquí: superada la ventana del TTL del ticket (15 min) desde el
// despliegue de MIS-312, ningún navegador conserva ya uno válido, así que ni se
// leen ni se expiran. Ver PLANS/MIS-315.

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 días — sesión persistente

// path:"/" explícito en set y clear: sin esto, un cambio futuro de ruta de
// login/logout podría dejar la cookie inaccesible o sin poder borrarla del todo.
// (Y es, además, requisito de `__Host-`.)
export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  // M1 (transitorio): borra la cookie de sesión ANTIGUA en su path original.
  cookieStore.set(LEGACY_SESSION_COOKIE_NAME, "", { path: "/", maxAge: 0 });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  cookieStore.set(LEGACY_SESSION_COOKIE_NAME, "", { path: "/", maxAge: 0 });
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
    secure: true,
    // "lax", no "strict": debe sobrevivir a la navegación top-level
    // ENTRANTE que hace Google al volver a /api/auth/google/callback —
    // "strict" no garantiza que la cookie viaje en esa navegación.
    sameSite: "lax",
    path: "/api/auth/google",
    maxAge: OAUTH_STATE_TTL_SECONDS,
  });
  cookieStore.set(LEGACY_OAUTH_STATE_COOKIE_NAME, "", { path: "/api/auth/google", maxAge: 0 });
}

export async function readOAuthStateCookie(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(OAUTH_STATE_COOKIE_NAME)?.value ?? null;
}

// MIS-299 (B6, PKCE): cookie efímera que transporta el `code_verifier` entre
// /start y /callback. Mismo molde, scope y vida (10 min) que la de OAuth state,
// pero SEPARADA: son secretos distintos y cada función tiene un propósito único.
// Cookie nueva: NO tiene gemela legada que borrar.
export async function setPkceVerifierCookie(verifier: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(PKCE_VERIFIER_COOKIE_NAME, verifier, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/auth/google",
    maxAge: OAUTH_STATE_TTL_SECONDS,
  });
}

export async function readPkceVerifierCookie(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(PKCE_VERIFIER_COOKIE_NAME)?.value ?? null;
}

// MIS-299 (B6): limpieza de las cookies TRANSITORIAS del flujo OAuth de Google.
// Reemplaza a clearOAuthStateCookie (que borraba state nuevo + su gemela legada);
// ahora expira además el verifier de PKCE. Las TRES en un ÚNICO cookie store:
//   1) __Secure-google_oauth_state (state nuevo)
//   2) __Secure-google_pkce_verifier (verifier PKCE)
//   3) google_oauth_state (gemela LEGADA — se conserva el borrado transitorio de MIS-293)
// Las tres escrituras se INTENTAN aunque una lance; el primer error se propaga
// (el callback la invoca en un `finally`: si esto lanzara, aborta fail-closed).
export async function clearOAuthTransientCookies(): Promise<void> {
  const cookieStore = await cookies();
  const oauthClearOptions = {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/auth/google",
    maxAge: 0,
  } as const;
  const legacyClearOptions = { path: "/api/auth/google", maxAge: 0 } as const;
  const writes: Array<() => void> = [
    () => cookieStore.set(OAUTH_STATE_COOKIE_NAME, "", oauthClearOptions),
    () => cookieStore.set(PKCE_VERIFIER_COOKIE_NAME, "", oauthClearOptions),
    () => cookieStore.set(LEGACY_OAUTH_STATE_COOKIE_NAME, "", legacyClearOptions),
  ];
  let firstError: unknown;
  for (const w of writes) {
    try {
      w();
    } catch (e) {
      firstError ??= e;
    }
  }
  if (firstError) throw firstError;
}

// MIS-292 (M3): ticket de reseteo. Vivía en estado React + <input type="hidden">
// (accesible a JS); ahora solo en esta cookie httpOnly, con el mismo molde que la
// de OAuth state: efímera y scoped al flujo de recuperación por su `path` (las
// Server Actions del wizard hacen POST a /recuperar-contrasena, así que la cookie
// viaja en verify→reset).
//
// OJO: estos 15 min DUPLICAN a propósito el TTL del ticket en Convex
// (TICKET_TTL_MS en convex/passwordReset.ts). Si allí cambia, cámbialo aquí.
const RESET_TICKET_TTL_SECONDS = 15 * 60;

export async function setResetTicketCookie(ticket: string): Promise<void> {
  const cookieStore = await cookies();
  // MIS-312: `path:"/"` (antes `/recuperar-contrasena`) para que el ticket sirva
  // tanto a `/recuperar-contrasena` como a `/configurar-contrasena`; con Secure +
  // Path=/ + sin Domain cumple `__Host-`.
  // MIS-315: se emite SOLO `__Host-reset_ticket`; ya no se expiran las variantes
  // antiguas (migración de MIS-312 completada, ver comentario arriba).
  cookieStore.set(RESET_TICKET_COOKIE_NAME, ticket, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: RESET_TICKET_TTL_SECONDS,
  });
}

export async function readResetTicketCookie(): Promise<string | null> {
  const cookieStore = await cookies();
  // MIS-315: se lee EXCLUSIVAMENTE `__Host-reset_ticket`. La lectura dual al
  // nombre anterior (`__Secure-reset_ticket`) fue una compatibilidad transitoria
  // de la migración de MIS-312 (comportamiento posterior a esa migración: solo el
  // nombre nuevo autoriza) y se retiró pasada la ventana del TTL del ticket (15 min).
  return cookieStore.get(RESET_TICKET_COOKIE_NAME)?.value ?? null;
}

export async function clearResetTicketCookie(): Promise<void> {
  const cookieStore = await cookies();
  // MIS-315: se limpia SOLO `__Host-reset_ticket` (migración de MIS-312 completada;
  // ya no hay variantes antiguas que expirar).
  cookieStore.set(RESET_TICKET_COOKIE_NAME, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

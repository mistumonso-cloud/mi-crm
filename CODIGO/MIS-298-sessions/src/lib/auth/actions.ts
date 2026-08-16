"use server";

import { redirect } from "next/navigation";
import { fetchAction, fetchMutation } from "convex/nextjs";
import { api } from "../../../convex/_generated/api";
import {
  clearSessionCookie,
  readSessionToken,
  setSessionCookie,
  setResetTicketCookie,
  readResetTicketCookie,
  clearResetTicketCookie,
} from "./cookie";
import { getClientIp } from "./clientIp";
import { landingPathForRole } from "./dal";

export type LoginActionState = { error: string } | undefined;

// MIS-288 (1A.5): secreto de servidor que autentica estas Server Actions ante
// Convex. En producción el proxy ya devuelve 503 si falta (fail-closed), así
// que aquí basta leerlo; un valor vacío hace que Convex responda con el error
// genérico (nunca revela el motivo real).
function authServerKey(): string {
  return process.env.AUTH_SERVER_KEY ?? "";
}

export async function loginAction(
  _prevState: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const ipHint = (await getClientIp()) ?? undefined;

  const result = await fetchAction(api.auth.loginWithPassword, {
    email,
    password,
    ipHint,
    serverKey: authServerKey(),
  });

  if (!result.success) {
    return { error: result.error };
  }

  await setSessionCookie(result.token);
  redirect(landingPathForRole(result.role));
}

export async function logoutAction(): Promise<void> {
  const token = await readSessionToken();
  if (token) {
    await fetchMutation(api.auth.logout, { token });
  }
  await clearSessionCookie();
  redirect("/login");
}

// MIS-298 (B3): "cerrar sesión en todos los dispositivos". Calcada de
// logoutAction, pero llama a logoutAllSessions, que revoca TODAS las sesiones del
// usuario (no solo la actual). Borra la cookie local y redirige a /login igual.
export async function logoutAllAction(): Promise<void> {
  const token = await readSessionToken();
  if (token) {
    await fetchMutation(api.auth.logoutAllSessions, { token });
  }
  await clearSessionCookie();
  redirect("/login");
}

// MIS-285: recuperación de contraseña por código (OTP). Un único tipo de
// estado para las 3 actions — cada una avanza `step` según el resultado, y
// RecoverForm.tsx (Client Component) decide qué paso pintar a partir de él.
// MIS-292 (M3): el variante "password" ya NO lleva `ticket`. El ticket viaja por
// una cookie httpOnly (ver cookie.ts), fuera del alcance de JS; este cambio de
// tipo es la garantía a nivel de compilación de que no vuelve al cliente en el
// estado serializado.
export type RecoverActionState =
  | { step: "email" }
  | { step: "code"; email: string; error?: string }
  | { step: "password"; error?: string };

// Anti-enumeración: SIEMPRE avanza a "code", exista o no la cuenta — el
// backend (requestPasswordResetCode) ya responde con el mismo timing en
// ambos casos, así que esta action no puede añadir una distinción que el
// backend evitó a propósito.
export async function requestResetCodeAction(
  _prevState: RecoverActionState,
  formData: FormData,
): Promise<RecoverActionState> {
  const email = String(formData.get("email") ?? "");
  const ipHint = (await getClientIp()) ?? undefined;

  await fetchMutation(api.passwordReset.requestPasswordResetCode, {
    email,
    ipHint,
    serverKey: authServerKey(),
  });

  return { step: "code", email };
}

export async function verifyResetCodeAction(
  _prevState: RecoverActionState,
  formData: FormData,
): Promise<RecoverActionState> {
  const email = String(formData.get("email") ?? "");
  const code = String(formData.get("code") ?? "");
  const ipHint = (await getClientIp()) ?? undefined;

  const result = await fetchMutation(api.passwordReset.verifyResetCode, {
    email,
    code,
    ipHint,
    serverKey: authServerKey(),
  });

  if (!result.ok) {
    return { step: "code", email, error: result.error };
  }
  // MIS-292 (M3): el ticket va a una cookie httpOnly, no al estado del cliente.
  await setResetTicketCookie(result.ticket);
  return { step: "password" };
}

const PASSWORD_MISMATCH_ERROR = "Las contraseñas no coinciden";
const PASSWORD_POLICY_ERROR = "La contraseña debe tener entre 8 y 128 caracteres";

export async function resetPasswordAction(
  _prevState: RecoverActionState,
  formData: FormData,
): Promise<RecoverActionState> {
  // MIS-292 (M3): el ticket se lee de la cookie httpOnly, no del FormData.
  const ticket = (await readResetTicketCookie()) ?? "";
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  // Errores de validación LOCALES (previos a Convex): se conserva la cookie para
  // permitir reintentar dentro de los 15 min; solo se borra tras el éxito.
  if (newPassword !== confirmPassword) {
    return { step: "password", error: PASSWORD_MISMATCH_ERROR };
  }
  if (newPassword.length < 8 || newPassword.length > 128) {
    return { step: "password", error: PASSWORD_POLICY_ERROR };
  }

  const result = await fetchMutation(api.passwordReset.resetPasswordWithTicket, {
    ticket,
    newPassword,
    serverKey: authServerKey(),
  });

  if (!result.ok) {
    return { step: "password", error: result.error };
  }

  // MIS-292 (M3): ticket consumido → borra la cookie ANTES del redirect.
  await clearResetTicketCookie();
  redirect("/login?reset=ok");
}

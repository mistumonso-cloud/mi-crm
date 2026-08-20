"use server";

import { ConvexError } from "convex/values";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { fetchAction, fetchMutation } from "convex/nextjs";
import { api } from "../../../convex/_generated/api";
import { readSessionToken } from "@/lib/auth/cookie";

// MIS-309: server actions de "Usuarios y equipo". Espejo endurecido del patrón
// de src/lib/contacts/actions.ts, con el CONTRATO DE ERRORES del plan (M2):
//
//   - requireOwner (en convex/team.ts) LANZA ConvexError con data.code:
//       · FORBIDDEN → autenticada pero sin permiso de admin → redirect("/").
//       · UNAUTHENTICATED (o cualquier otra ConvexError de sesión) → /login.
//   - Los errores de NEGOCIO (duplicado, "ya invitado", último admin, usuario
//     inexistente, validación) NO se lanzan: vuelven como { success:false,... }
//     y se devuelven al formulario → permanece en /equipo y muestra el mensaje.
//
// Solo una sesión ausente/ inválida saca de la pantalla; ningún error de negocio
// provoca logout.

const TEAM_ROLES = ["rep", "supervisor"] as const;
type TeamRole = (typeof TEAM_ROLES)[number];
type TeamField = "name" | "email" | "role";

// Traducción centralizada de una ConvexError lanzada por requireOwner a un
// redirect. No retorna: siempre redirige. Los errores no-ConvexError se
// relanzan al error boundary desde el call site.
function redirectForAuthError(err: unknown): never {
  if (err instanceof ConvexError) {
    const data = err.data as { code?: string } | string | undefined;
    const code = typeof data === "object" && data ? data.code : undefined;
    if (code === "FORBIDDEN") redirect("/");
    if (code === "UNAUTHENTICATED") redirect("/login");
    // ConvexError inesperada: team.* solo lanza esos dos códigos (vía
    // requireOwner), así que cualquier otra ConvexError NO es pérdida de sesión
    // y no debe enmascararse como logout — se relanza al error boundary (M2 estricto).
  }
  throw err;
}

export type InviteUserState =
  | { success: true; delivered: boolean }
  | { success: false; error: string; field?: TeamField }
  | undefined;

export async function inviteUserAction(
  _prevState: InviteUserState,
  formData: FormData,
): Promise<InviteUserState> {
  const token = await readSessionToken();
  if (!token) redirect("/login");

  const name = String(formData.get("name") ?? "");
  const email = String(formData.get("email") ?? "");

  // Validado contra el enum ANTES de llamar a Convex — mismo patrón que el
  // "channel"/"status" de contacts/actions.ts (hasOwnProperty/includes, no `in`).
  const roleRaw = String(formData.get("role") ?? "");
  if (!TEAM_ROLES.includes(roleRaw as TeamRole)) {
    return { success: false, error: "Rol inválido", field: "role" };
  }
  const role = roleRaw as TeamRole;

  let result;
  try {
    result = await fetchAction(api.team.inviteUser, { token, name, email, role });
  } catch (err) {
    redirectForAuthError(err);
  }

  if (!result.success) {
    return { success: false, error: result.error, field: result.field as TeamField | undefined };
  }

  refresh(); // Next 16: re-renderiza /equipo (lista actualizada) en la misma respuesta
  return { success: true, delivered: result.delivered };
}

export type ChangeRoleState =
  | { success: true }
  | { success: false; error: string }
  | undefined;

export async function changeRoleAction(
  _prevState: ChangeRoleState,
  formData: FormData,
): Promise<ChangeRoleState> {
  const token = await readSessionToken();
  if (!token) redirect("/login");

  const userId = String(formData.get("userId") ?? "");
  const roleRaw = String(formData.get("role") ?? "");
  if (!TEAM_ROLES.includes(roleRaw as TeamRole)) {
    return { success: false, error: "Rol inválido" };
  }
  const role = roleRaw as TeamRole;

  let result;
  try {
    result = await fetchMutation(api.team.changeUserRole, { token, userId, role });
  } catch (err) {
    redirectForAuthError(err);
  }

  if (!result.success) {
    return { success: false, error: result.error };
  }

  refresh();
  return { success: true };
}

export type SetUserActiveState =
  | { success: true }
  | { success: false; error: string }
  | undefined;

export async function setUserActiveAction(
  _prevState: SetUserActiveState,
  formData: FormData,
): Promise<SetUserActiveState> {
  const token = await readSessionToken();
  if (!token) redirect("/login");

  const userId = String(formData.get("userId") ?? "");
  // Llega como "true"/"false" desde un <button type="submit" name="active" value=…>.
  // Se valida EXACTAMENTE: un valor ausente o manipulado NO debe interpretarse
  // como "false" (la operación destructiva) por defecto.
  const activeRaw = String(formData.get("active") ?? "");
  if (activeRaw !== "true" && activeRaw !== "false") {
    return { success: false, error: "Acción inválida" };
  }
  const active = activeRaw === "true";

  let result;
  try {
    result = await fetchMutation(api.team.setUserActive, { token, userId, active });
  } catch (err) {
    redirectForAuthError(err);
  }

  if (!result.success) {
    return { success: false, error: result.error };
  }

  refresh();
  return { success: true };
}

export type ResendInviteState =
  | { success: true; delivered: boolean }
  | { success: false; error: string }
  | undefined;

export async function resendInviteAction(
  _prevState: ResendInviteState,
  formData: FormData,
): Promise<ResendInviteState> {
  const token = await readSessionToken();
  if (!token) redirect("/login");

  const userId = String(formData.get("userId") ?? "");

  let result;
  try {
    result = await fetchAction(api.team.resendInvite, { token, userId });
  } catch (err) {
    redirectForAuthError(err);
  }

  if (!result.success) {
    return { success: false, error: result.error };
  }

  refresh();
  return { success: true, delivered: result.delivered };
}

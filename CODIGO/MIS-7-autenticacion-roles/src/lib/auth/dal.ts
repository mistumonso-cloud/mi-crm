import { cache } from "react";
import { redirect } from "next/navigation";
import { fetchQuery } from "convex/nextjs";
import { api } from "../../../convex/_generated/api";
import { readSessionToken } from "./cookie";

export type Role = "rep" | "supervisor";

export type SessionUser = {
  id: string;
  name: string;
  role: Role;
};

// Fuente de verdad real de autenticación — a diferencia de src/proxy.ts (que
// solo mira si existe la cookie), esto sí consulta Convex. Cada page protegida
// debe llamar a getUser()/requireRole(), no basta con comprobarlo en el layout
// (no se re-ejecuta en cada navegación entre hermanos).
export const getSession = cache(async (): Promise<SessionUser | null> => {
  const token = await readSessionToken();
  if (!token) return null;
  return await fetchQuery(api.auth.getSessionUser, { token });
});

export const getUser = cache(async (): Promise<SessionUser> => {
  const user = await getSession();
  if (!user) redirect("/login");
  return user;
});

export async function requireRole(role: Role): Promise<SessionUser> {
  const user = await getUser();
  if (user.role !== role) {
    redirect(user.role === "rep" ? "/pendientes" : "/panel");
  }
  return user;
}

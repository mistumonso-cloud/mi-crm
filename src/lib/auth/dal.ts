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
// debe llamar a getUser(), no basta con comprobarlo en el layout (no se
// re-ejecuta en cada navegación entre hermanos).
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

// MIS-18 (ADR): pendientes/panel dejaron de exigir un rol exacto — Carlos y
// Marta tienen ambos acceso de lectura a los dos, según el criterio original
// de MIS-7 para Marta ("puede ver todo lo que Carlos hace"). requireRole()
// vivía aquí para ese bloqueo mutuo y se retira al quedar sin ningún call
// site; no confundir con convex/lib/authz.ts::requireRole, que protege las
// mutations/queries de Convex y no se toca — ver PLANS/MIS-18-navegacion-
// principal.md, sección "Nota de seguridad (ADR)".

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
// vivía aquí para ese bloqueo mutuo y se retiró al quedar sin ningún call
// site. MIS-251 (reapertura) fue más allá: retiró también
// convex/lib/authz.ts::requireRole (el guard de mutations/queries) — Marta
// pasa a tener acceso de escritura completo, no solo de lectura, por
// decisión de negocio confirmada por el usuario (ver PLANS/MIS-251-rol-
// supervision-marta.md). No queda ningún requireRole en el repo a partir de
// este ticket; `role` se conserva en SessionUser solo para la experiencia
// de navegación (pantalla de aterrizaje por defecto), no para autorización.

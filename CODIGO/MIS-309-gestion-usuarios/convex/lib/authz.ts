import { ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { hashToken } from "./token";

// Invariante de seguridad: el DAL de Next.js protege páginas, no protege las
// funciones de Convex en sí — cualquier query/mutation expuesta es invocable
// directamente por cualquier cliente con un token válido, sin pasar por
// Next.js. Toda función futura (MIS-9/13/17/18...) que lea o escriba datos
// dependientes del usuario conectado debe llamar a requireUser como primera
// línea, no confiar en que ya se validó en el DAL de Next.

type Ctx = QueryCtx | MutationCtx;

export type SessionUser = {
  id: Id<"users">;
  name: string;
  role: "rep" | "supervisor";
};

// Única fuente de verdad de qué campos son seguros para exponer fuera de
// Convex — nunca passwordHash, nunca email salvo que una función lo necesite
// explícitamente.
export async function lookupSessionUser(ctx: Ctx, token: string): Promise<SessionUser | null> {
  const tokenHash = await hashToken(token);
  const session = await ctx.db
    .query("sessions")
    .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
    .unique();
  if (!session) return null;
  if (session.expiresAt < Date.now()) return null;

  const user = await ctx.db.get(session.userId);
  if (!user) return null;

  // MIS-309: una cuenta desactivada (baja lógica) pierde el acceso al instante.
  // Este es el punto ÚNICO por el que pasan todas las funciones autenticadas
  // (requireUser/requireOwner), así que negar aquí expulsa al desactivado de
  // cualquier request en curso sin tener que comprobarlo en cada call site.
  if (user.deactivatedAt != null) return null;

  return { id: user._id, name: user.name, role: user.role };
}

export async function requireUser(ctx: Ctx, token: string): Promise<SessionUser> {
  const user = await lookupSessionUser(ctx, token);
  if (!user) throw new ConvexError("No autenticado");
  return user;
}

// MIS-309: guard de la capa de ADMINISTRACIÓN DE USUARIOS (convex/team.ts).
// Reintroduce una comprobación de rol —el requireRole general se retiró en
// MIS-251— pero ACOTADA a esta capa: no gobierna la escritura de datos del CRM
// (contactos/notas/ventas), que sigue siendo igual para todos los roles. Marta
// (`supervisor`) es la administradora; Carlos (`rep`) no.
//
// Lanza ConvexError con `data.code` ESTRUCTURADO para que las server actions
// distingan sin ambigüedad (contrato M2 del plan):
//   - UNAUTHENTICATED → no hay sesión válida (o cuenta desactivada) → /login.
//   - FORBIDDEN       → autenticado pero sin permiso de admin → /.
// No se delega en requireUser a propósito: requireUser lanza el string
// "No autenticado" que otras funciones ya consumen tal cual; aquí se necesita
// el objeto con `code`, así que se resuelve la sesión directamente.
export async function requireOwner(ctx: Ctx, token: string): Promise<SessionUser> {
  const user = await lookupSessionUser(ctx, token);
  if (!user) throw new ConvexError({ code: "UNAUTHENTICATED", message: "No autenticado" });
  if (user.role !== "supervisor") {
    throw new ConvexError({ code: "FORBIDDEN", message: "No autorizado" });
  }
  return user;
}

// MIS-251 (reapertura): se retira requireRole — llegó a exigir role==="rep"
// en createContact/updateContact/changeContactStatus/closeSale, pero esa
// distinción por rol se revierte por decisión de negocio (Marta conserva
// acceso de escritura completo, igual que Carlos; ver PLANS/MIS-251-rol-
// supervision-marta.md). Sin ningún call site restante en el repo tras ese
// cambio. `role` se mantiene en SessionUser/el schema solo para la
// experiencia de navegación (pantalla de aterrizaje por defecto), no para
// autorización de escrituras.

// MIS-309: administración de usuarios ("Usuarios y equipo"). Superficie SOLO
// para la propietaria (rol `supervisor`) — cada función pública empieza (o
// delega en una internal que empieza) por `requireOwner`. No toca la escritura
// de datos del CRM: es una capa de administración de USUARIOS aparte (ver
// MIS-251 y PLANS/MIS-309-gestion-usuarios.md).
//
// Contrato de errores (M2 del plan): los fallos de AUTORIZACIÓN/SESIÓN se
// LANZAN vía requireOwner (ConvexError con data.code UNAUTHENTICATED/FORBIDDEN);
// los fallos de NEGOCIO (email duplicado, invitación ya pendiente, "último
// admin", usuario inexistente) se DEVUELVEN como valor discriminado
// { success:false, error, field?, code? } y NUNCA se lanzan. Así la server
// action distingue "redirige a /login" de "muestra el error en /equipo".

import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireOwner } from "./lib/authz";
import { hashPassword } from "./lib/password";
import { generateOpaqueToken } from "./lib/token";
import { normalizeEmailKey, emailWithinLimits } from "./lib/rateLimit";
import { CURRENT_PASSWORD_POLICY_VERSION } from "./lib/passwordPolicy";
import { revokeAllUserSessions } from "./lib/session";
import { sendInviteEmail } from "./lib/resend";

const roleValidator = v.union(v.literal("rep"), v.literal("supervisor"));

// Validador y tipo del fallo de negocio, compartidos por todas las funciones.
const failValidator = v.object({
  success: v.literal(false),
  error: v.string(),
  field: v.optional(v.string()),
  code: v.optional(v.string()),
});
type BusinessFail = { success: false; error: string; field?: string; code?: string };

// Tipos de retorno explícitos: rompen la inferencia circular entre las actions
// (inviteUser/resendInvite) y las internal del MISMO módulo a las que llaman —
// mismo motivo que LoginResult en convex/auth.ts.
type CreateResult = { success: true; name: string; email: string } | BusinessFail;
type ResendLookup = { success: true; name: string; email: string } | BusinessFail;
type DeliverResult = { success: true; delivered: boolean } | BusinessFail;
type SimpleResult = { success: true } | BusinessFail;

const EMAIL_FORMAT = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_NAME_LENGTH = 120;

// "Supervisor activo" = administradora que cuenta para el guard "último admin":
// rol supervisor, sin baja lógica y sin invitación pendiente (una invitación sin
// aceptar todavía no gobierna nada). Lee la tabla `users` completa a propósito:
// ese read-set hace que dos operaciones concurrentes que puedan romper la
// invariante entren en conflicto por OCC (la segunda se reejecuta y se rechaza).
function isActiveSupervisor(u: {
  role: "rep" | "supervisor";
  deactivatedAt?: number;
  invitePendingSince?: number;
}): boolean {
  return u.role === "supervisor" && u.deactivatedAt == null && u.invitePendingSince == null;
}

// ── Lista del equipo ────────────────────────────────────────────────────────
// Nunca devuelve passwordHash (returns validator explícito, mismo criterio que
// getSessionUser). El cliente deriva el badge de estado y marca "Tú".
export const listTeam = query({
  args: { token: v.string() },
  returns: v.array(
    v.object({
      id: v.id("users"),
      name: v.string(),
      email: v.string(),
      role: roleValidator,
      deactivatedAt: v.optional(v.number()),
      invitePendingSince: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    await requireOwner(ctx, args.token);
    const users = await ctx.db.query("users").collect();
    return users
      .slice()
      .sort((a, b) => a._creationTime - b._creationTime)
      .map((u) => ({
        id: u._id,
        name: u.name,
        email: u.email,
        role: u.role,
        deactivatedAt: u.deactivatedAt,
        invitePendingSince: u.invitePendingSince,
      }));
  },
});

// ── Invitar / dar de alta ───────────────────────────────────────────────────
// internalMutation: hace el guard y la escritura ANTES de cualquier efecto
// externo. La action (inviteUser) la llama primero y solo entonces envía el
// email — así conoce el resultado de la entrega.
export const createPendingUser = internalMutation({
  args: { token: v.string(), name: v.string(), email: v.string(), role: roleValidator },
  returns: v.union(
    v.object({ success: v.literal(true), name: v.string(), email: v.string() }),
    failValidator,
  ),
  handler: async (ctx, args): Promise<CreateResult> => {
    const owner = await requireOwner(ctx, args.token);

    const name = args.name.trim();
    if (!name) return { success: false, error: "El nombre es obligatorio", field: "name" };
    if (name.length > MAX_NAME_LENGTH) {
      return { success: false, error: "El nombre es demasiado largo", field: "name" };
    }

    const emailKey = normalizeEmailKey(args.email);
    if (!emailWithinLimits(emailKey) || !EMAIL_FORMAT.test(emailKey)) {
      return { success: false, error: "Email no válido", field: "email" };
    }

    const existing = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", emailKey))
      .unique();
    if (existing) {
      if (existing.invitePendingSince != null) {
        return {
          success: false,
          code: "already_invited",
          error: "Ya hay una invitación pendiente para ese email. Usa «Reenviar invitación».",
          field: "email",
        };
      }
      return { success: false, error: "Ya existe un usuario con ese email", field: "email" };
    }

    // Contraseña aleatoria INSERVIBLE: el invitado nunca la conoce; solo entra
    // tras crear la suya (por "Recuperar contraseña") o por Google. passwordPolicy
    // + passwordChangedAt se fijan como en seedUser para no quedar marcada como
    // "pendiente de rotación".
    await ctx.db.insert("users", {
      name,
      email: emailKey,
      passwordHash: await hashPassword(generateOpaqueToken()),
      role: args.role,
      passwordPolicyVersion: CURRENT_PASSWORD_POLICY_VERSION,
      passwordChangedAt: Date.now(),
      invitedBy: owner.id,
      invitePendingSince: Date.now(),
    });

    return { success: true, name, email: emailKey };
  },
});

// Action pública: crea el usuario (guard dentro de la internal) y envía la
// invitación. `delivered:false` = cuenta creada como "Invitación pendiente"
// pero el email no salió → la UI ofrece "Reenviar invitación" (nunca promete
// acceso garantizado por el mero hecho de crear la cuenta).
export const inviteUser = action({
  args: { token: v.string(), name: v.string(), email: v.string(), role: roleValidator },
  returns: v.union(
    v.object({ success: v.literal(true), delivered: v.boolean() }),
    failValidator,
  ),
  handler: async (ctx, args): Promise<DeliverResult> => {
    const res = await ctx.runMutation(internal.team.createPendingUser, {
      token: args.token,
      name: args.name,
      email: args.email,
      role: args.role,
    });
    if (!res.success) return res;

    let delivered = true;
    try {
      await sendInviteEmail(res.email, res.name);
    } catch (err) {
      delivered = false;
      console.error(
        "inviteUser: fallo al enviar la invitación con Resend",
        err instanceof Error ? err.message : err,
      );
    }
    return { success: true, delivered };
  },
});

// ── Reenviar invitación ─────────────────────────────────────────────────────
// internalQuery: guard + comprobación de que la cuenta sigue invitable (pendiente
// y no desactivada). "Idempotente" aquí se refiere al ESTADO PERSISTIDO —no se
// crea otro usuario ni se muta nada—, no al efecto externo: cada reenvío manda
// un email nuevo (dos reenvíos ⇒ dos correos). La invitación no transporta
// secreto (el código lo emite el flujo de contraseña), así que no hay nada que
// regenerar/serializar.
export const pendingInviteeForResend = internalQuery({
  args: { token: v.string(), userId: v.string() },
  returns: v.union(
    v.object({ success: v.literal(true), name: v.string(), email: v.string() }),
    failValidator,
  ),
  handler: async (ctx, args): Promise<ResendLookup> => {
    await requireOwner(ctx, args.token);
    // v.string() + normalizeId: un id manipulado se resuelve a null de forma
    // segura (mismo patrón que convex/contacts.ts) en vez de reventar el get.
    const userId = ctx.db.normalizeId("users", args.userId);
    if (!userId) return { success: false, error: "Usuario no encontrado" };
    const target = await ctx.db.get(userId);
    if (!target) return { success: false, error: "Usuario no encontrado" };
    if (target.deactivatedAt != null) {
      return { success: false, error: "Esa cuenta está desactivada" };
    }
    if (target.invitePendingSince == null) {
      return { success: false, error: "Esa invitación ya no está pendiente" };
    }
    return { success: true, name: target.name, email: target.email };
  },
});

export const resendInvite = action({
  args: { token: v.string(), userId: v.string() },
  returns: v.union(
    v.object({ success: v.literal(true), delivered: v.boolean() }),
    failValidator,
  ),
  handler: async (ctx, args): Promise<DeliverResult> => {
    const res = await ctx.runQuery(internal.team.pendingInviteeForResend, {
      token: args.token,
      userId: args.userId,
    });
    if (!res.success) return res;

    let delivered = true;
    try {
      await sendInviteEmail(res.email, res.name);
    } catch (err) {
      delivered = false;
      console.error(
        "resendInvite: fallo al reenviar la invitación con Resend",
        err instanceof Error ? err.message : err,
      );
    }
    return { success: true, delivered };
  },
});

// ── Cambiar rol ─────────────────────────────────────────────────────────────
export const changeUserRole = mutation({
  args: { token: v.string(), userId: v.string(), role: roleValidator },
  returns: v.union(v.object({ success: v.literal(true) }), failValidator),
  handler: async (ctx, args): Promise<SimpleResult> => {
    await requireOwner(ctx, args.token);

    const userId = ctx.db.normalizeId("users", args.userId);
    if (!userId) return { success: false, error: "Usuario no encontrado" };
    const target = await ctx.db.get(userId);
    if (!target) return { success: false, error: "Usuario no encontrado" };

    // Guard "último admin": no dejar el CRM sin ninguna administradora activa.
    // Se lee la tabla completa (read-set → serialización OCC frente a
    // operaciones concurrentes que también afecten al conjunto de supervisores).
    if (args.role === "rep" && isActiveSupervisor(target)) {
      const users = await ctx.db.query("users").collect();
      const otherActiveSupervisors = users.filter(
        (u) => u._id !== target._id && isActiveSupervisor(u),
      );
      if (otherActiveSupervisors.length === 0) {
        return {
          success: false,
          error: "No puedes dejar el CRM sin ninguna administradora",
          field: "role",
        };
      }
    }

    if (target.role !== args.role) {
      await ctx.db.patch(target._id, { role: args.role });
    }
    return { success: true };
  },
});

// ── Desactivar / reactivar (baja lógica reversible) ─────────────────────────
export const setUserActive = mutation({
  args: { token: v.string(), userId: v.string(), active: v.boolean() },
  returns: v.union(v.object({ success: v.literal(true) }), failValidator),
  handler: async (ctx, args): Promise<SimpleResult> => {
    const owner = await requireOwner(ctx, args.token);

    const userId = ctx.db.normalizeId("users", args.userId);
    if (!userId) return { success: false, error: "Usuario no encontrado" };
    const target = await ctx.db.get(userId);
    if (!target) return { success: false, error: "Usuario no encontrado" };

    if (args.active === false) {
      // Guard "último admin": no desactivar a la última administradora activa
      // (cubre también "no puedes quitarte a ti misma el último rol admin").
      if (isActiveSupervisor(target)) {
        const users = await ctx.db.query("users").collect();
        const otherActiveSupervisors = users.filter(
          (u) => u._id !== target._id && isActiveSupervisor(u),
        );
        if (otherActiveSupervisors.length === 0) {
          return {
            success: false,
            error: "No puedes desactivar a la última administradora",
          };
        }
      }
      if (target.deactivatedAt == null) {
        await ctx.db.patch(target._id, {
          deactivatedAt: Date.now(),
          deactivatedBy: owner.id,
        });
        // Corta el acceso al instante: revoca todas sus sesiones abiertas.
        await revokeAllUserSessions(ctx, target._id);
      }
      return { success: true };
    }

    // Reactivar: se limpia la baja. NO se toca passwordHash — el usuario vuelve
    // a entrar con la contraseña que ya tenía (decisión consciente del plan).
    if (target.deactivatedAt != null) {
      await ctx.db.patch(target._id, {
        deactivatedAt: undefined,
        deactivatedBy: undefined,
      });
    }
    return { success: true };
  },
});

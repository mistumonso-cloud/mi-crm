import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { generateOpaqueToken, hashToken } from "./token";

// Extraído de convex/auth.ts::login (MIS-7) — MIS-260 lo reusa para
// loginWithGoogle, para no duplicar el bloque "generar token, hashear,
// insertar en sessions" entre los dos flujos de login.
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 días — sesión persistente

export async function createSession(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<{ token: string; expiresAt: number }> {
  const token = generateOpaqueToken();
  const tokenHash = await hashToken(token);
  const expiresAt = Date.now() + SESSION_TTL_MS;
  await ctx.db.insert("sessions", { userId, tokenHash, expiresAt });
  return { token, expiresAt };
}

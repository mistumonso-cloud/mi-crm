import { redirect } from "next/navigation";
import { setOAuthStateCookie } from "@/lib/auth/cookie";
import { buildGoogleAuthUrl, generateOAuthState } from "@/lib/auth/google";

// Runtime Node.js por defecto (no se declara `edge`) — mismo criterio que
// src/proxy.ts, necesario para crypto/fetch sin restricciones.
export async function GET() {
  const state = generateOAuthState();
  await setOAuthStateCookie(state);
  redirect(buildGoogleAuthUrl(state));
}

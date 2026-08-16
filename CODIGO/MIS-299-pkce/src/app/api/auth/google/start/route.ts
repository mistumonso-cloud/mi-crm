import { redirect } from "next/navigation";
import { setOAuthStateCookie, setPkceVerifierCookie } from "@/lib/auth/cookie";
import {
  buildGoogleAuthUrl,
  computePkceChallenge,
  generateOAuthState,
  generatePkceVerifier,
} from "@/lib/auth/google";

// Runtime Node.js por defecto (no se declara `edge`) — mismo criterio que
// src/proxy.ts, necesario para crypto/fetch sin restricciones.
export async function GET() {
  const state = generateOAuthState();
  // MIS-299 (B6, PKCE): verifier secreto (solo cookie) + su reto (viaja a Google).
  const verifier = generatePkceVerifier();
  const challenge = await computePkceChallenge(verifier);
  await setOAuthStateCookie(state);
  await setPkceVerifierCookie(verifier);
  redirect(buildGoogleAuthUrl(state, challenge));
}

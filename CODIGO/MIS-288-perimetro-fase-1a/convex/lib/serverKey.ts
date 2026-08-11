// MIS-288 (1A.5): "esta llamada viene de nuestro servidor de Next.js".
//
// Única implementación en el repo del patrón que hasta ahora repetían
// loginWithGoogle (convex/auth.ts) y assertTestKey (convex/testSupport.ts):
// comparar un secreto compartido en tiempo constante contra una env var que
// solo conoce el servidor y este deployment de Convex. NEXT_PUBLIC_CONVEX_URL
// es público (está en el bundle JS), así que sin esto cualquier navegador
// podría invocar las mutations de autenticación directamente.

import { constantTimeEqual } from "./password";

// Devuelve booleano (no lanza) para que cada función pública produzca SU PROPIO
// error genérico — mismo criterio anti-enumeración que el resto del módulo: un
// serverKey incorrecto es indistinguible de "email no existe".
//
// FAIL-CLOSED: sin la env var configurada, `expected` es undefined y la
// comparación devuelve false — ningún valor de serverKey puede pasar. En
// producción la ausencia de AUTH_SERVER_KEY deja las funciones cerradas, no
// abiertas.
export function serverKeyMatches(provided: string, envVarName: string): boolean {
  const expected = process.env[envVarName];
  return (
    !!expected &&
    constantTimeEqual(
      new TextEncoder().encode(provided),
      new TextEncoder().encode(expected),
    )
  );
}

// Variante que lanza, para los call sites que no devuelven un error de dominio
// (el harness de test). Se construye sobre serverKeyMatches para que haya una
// sola comparación en tiempo constante en todo el repo.
export function assertServerKey(provided: string, envVarName: string): void {
  if (!serverKeyMatches(provided, envVarName)) {
    throw new Error("No autorizado");
  }
}

// Nombre de la env var del secreto de servidor de autenticación. Distinta de
// GOOGLE_LOGIN_SHARED_SECRET: mismo nivel de confianza, propósitos separados,
// rotables por separado. Se configura con:
//   npx convex env set AUTH_SERVER_KEY <valor>
export const AUTH_SERVER_KEY_ENV_VAR = "AUTH_SERVER_KEY";

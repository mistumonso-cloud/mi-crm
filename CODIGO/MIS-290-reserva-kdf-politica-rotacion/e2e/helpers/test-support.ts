// MIS-286: envoltorio de las funciones del harness seguro (convex/testSupport.ts).
//
// La credencial se lee de process.env EN EL PROCESO DE NODE de Playwright y
// nunca se pasa a la página — el navegador jamás la ve, así que no puede
// aparecer en una traza ni en un screenshot.

import { convexClient, api } from "./convex-client";
import { RESET_TEST_EMAIL, TEST_LOGIN_IP } from "../../convex/lib/testIdentity";

function testSupportKey(): string {
  const key = process.env.E2E_TEST_SUPPORT_KEY;
  if (!key) {
    throw new Error(
      "Falta E2E_TEST_SUPPORT_KEY — configúrala en .env.test.local (local) o en los secrets del repo (CI). " +
        "Debe coincidir con la variable del mismo nombre en el deployment de Convex de dev " +
        "(`npx convex env set E2E_TEST_SUPPORT_KEY <valor>`).",
    );
  }
  return key;
}

// MIS-288: secreto de servidor de autenticación, para las llamadas directas a
// las funciones de auth desde los e2e (loginWithPassword y el flujo de
// recuperación). Mismo patrón que testSupportKey(): se lee en el proceso de
// Node de Playwright, nunca llega al navegador. Desde 1A-bis (MIS-289) el
// serverKey es OBLIGATORIO en las funciones de recuperación (I3 cerrada), así
// que enviarlo aquí no es solo fiel al frontend: es la única forma de que las
// llamadas directas pasen la validación.
export function authServerKey(): string {
  const key = process.env.AUTH_SERVER_KEY;
  if (!key) {
    throw new Error(
      "Falta AUTH_SERVER_KEY — configúrala en .env.test.local (local) o en los secrets del repo (CI). " +
        "Debe coincidir con la variable del mismo nombre en el deployment de Convex de dev " +
        "(`npx convex env set AUTH_SERVER_KEY <valor>`).",
    );
  }
  return key;
}

// Reseed idempotente al INICIO de cada spec. Devuelve la contraseña efímera
// recién generada: vive solo en memoria del proceso de test.
export async function resetTestIdentity(): Promise<string> {
  const { password } = await convexClient().mutation(api.testSupport.resetTestIdentity, {
    serverKey: testSupportKey(),
    email: RESET_TEST_EMAIL,
  });
  return password;
}

// null si aún no se ha pedido ningún código.
export async function getLastResetCode(): Promise<string | null> {
  return await convexClient().query(api.testSupport.getLastResetCode, {
    serverKey: testSupportKey(),
    email: RESET_TEST_EMAIL,
  });
}

export async function expireResetCode(): Promise<boolean> {
  return await convexClient().mutation(api.testSupport.expireResetCode, {
    serverKey: testSupportKey(),
    email: RESET_TEST_EMAIL,
  });
}

export async function countSessionsFor(): Promise<number> {
  return await convexClient().query(api.testSupport.countSessionsFor, {
    serverKey: testSupportKey(),
    email: RESET_TEST_EMAIL,
  });
}

// Comprueba credenciales SIN pasar por el formulario: así la contraseña efímera
// no entra en el navegador y no puede quedar registrada en una traza.
export async function loginSucceeds(password: string): Promise<boolean> {
  const result = await convexClient().action(api.auth.loginWithPassword, {
    email: RESET_TEST_EMAIL,
    password,
    serverKey: authServerKey(),
  });
  return result.success;
}

// MIS-290 (prueba 8, I5): login que devuelve el resultado completo y permite fijar
// la IP — para ejercitar la capa por IP con la IP sintética TEST_LOGIN_IP.
export async function loginResult(
  password: string,
  ipHint?: string,
): Promise<{ success: boolean }> {
  return await convexClient().action(api.auth.loginWithPassword, {
    email: RESET_TEST_EMAIL,
    password,
    serverKey: authServerKey(),
    ...(ipHint ? { ipHint } : {}),
  });
}

// MIS-290 (prueba 8): nº de derivaciones del KDF desde el último reseed.
export async function getKdfCount(): Promise<number> {
  return await convexClient().query(api.testSupport.getKdfCount, {
    serverKey: testSupportKey(),
    email: RESET_TEST_EMAIL,
  });
}

// MIS-290 (prueba 9, I7): wrappers de reserva/finalización de login.
export async function reserveLoginSlot(): Promise<
  { blocked: true } | { blocked: false; fingerprint: string }
> {
  return await convexClient().action(api.testSupport.testReserveLoginSlot, {
    serverKey: testSupportKey(),
    email: RESET_TEST_EMAIL,
  });
}

export async function finalizeLogin(fingerprint: string, ok: boolean): Promise<boolean> {
  const r = await convexClient().action(api.testSupport.testFinalizeLogin, {
    serverKey: testSupportKey(),
    email: RESET_TEST_EMAIL,
    fingerprint,
    ok,
  });
  return r.sessionCreated;
}

export async function deleteTestIdentity(): Promise<void> {
  await convexClient().mutation(api.testSupport.testDeleteIdentity, {
    serverKey: testSupportKey(),
    email: RESET_TEST_EMAIL,
  });
}

// MIS-290 (M4): ejercita el flujo de alta real (seedUser + accountsPendingRotation).
// Devuelve si la cuenta recién sembrada quedó pendiente de rotación (debe ser false).
export async function seedFlowInPendingRotation(): Promise<boolean> {
  const r = await convexClient().action(api.testSupport.testSeedFlow, {
    serverKey: testSupportKey(),
  });
  return r.inPendingRotation;
}

// MIS-290 (I6): versión de política del hash actual (null si no hay identidad).
export async function getPolicyVersion(): Promise<number | null> {
  return await convexClient().query(api.testSupport.getPolicyVersion, {
    serverKey: testSupportKey(),
    email: RESET_TEST_EMAIL,
  });
}

export { RESET_TEST_EMAIL, TEST_LOGIN_IP };

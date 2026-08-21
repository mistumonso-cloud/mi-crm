// MIS-286: envoltorio de las funciones del harness seguro (convex/testSupport.ts).
//
// La credencial se lee de process.env EN EL PROCESO DE NODE de Playwright y
// nunca se pasa a la página — el navegador jamás la ve, así que no puede
// aparecer en una traza ni en un screenshot.

import { convexClient, api } from "./convex-client";
import { RESET_TEST_EMAIL, TEST_LOGIN_IP, OVERSIZED_TEST_EMAIL } from "../../convex/lib/testIdentity";
import { MAX_EMAIL_LENGTH } from "../../convex/lib/rateLimit";

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

// MIS-302 (B10): solicita un código por la vía DIRECTA (sin UI y SIN ipHint, para
// aislar las capas por email/diaria de la capa por IP). Mismo serverKey que el
// frontend (AUTH_SERVER_KEY, obligatorio desde MIS-289). Devuelve la respuesta
// pública para poder asertar que es idéntica esté o no topada.
export async function requestResetCode(): Promise<{ ok: true }> {
  return await convexClient().mutation(api.passwordReset.requestPasswordResetCode, {
    email: RESET_TEST_EMAIL,
    serverKey: authServerKey(),
  });
}

// MIS-302 (B10): limpia solo la ventana del burst de 15 min de la identidad
// dedicada (ver convex/testSupport.ts::clearResetRequestWindow).
export async function clearResetRequestWindow(): Promise<void> {
  await convexClient().mutation(api.testSupport.clearResetRequestWindow, {
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

// MIS-298 (B3): inserta una sesión para la identidad dedicada (ttlMs negativo =>
// ya expirada) y devuelve su token. Para ejercitar logoutAllSessions.
export async function insertSession(ttlMs: number): Promise<string> {
  const { token } = await convexClient().mutation(api.testSupport.testInsertSession, {
    serverKey: testSupportKey(),
    email: RESET_TEST_EMAIL,
    ttlMs,
  });
  return token;
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
): Promise<{ success: true } | { success: false; error: string }> {
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

// MIS-292 (M1): intento de login con la identidad sintética sobredimensionada
// (>254). El guard debe cortarlo con el error genérico ANTES de tocar
// loginAttempts. serverKey correcto a propósito: así la ejecución LLEGA al guard
// (con un serverKey inválido se cortaría antes y no probaría M1).
export async function oversizedLoginAttempt(): Promise<{ success: boolean; error?: string }> {
  return await convexClient().action(api.auth.loginWithPassword, {
    email: OVERSIZED_TEST_EMAIL,
    password: "irrelevante-por-el-guard",
    serverKey: authServerKey(),
  });
}

// MIS-292 (M1): nº de filas de loginAttempts para las dos claves de la identidad
// sobredimensionada (`<email>` y `login-counter:<email>`). Debe ser 0 tras el guard.
export async function countOversizedLoginAttempts(): Promise<number> {
  return await convexClient().query(api.testSupport.countOversizedLoginAttempts, {
    serverKey: testSupportKey(),
  });
}

// MIS-292 (M4): nº de avisos de cambio de contraseña correlacionados con EL reset
// actual (no un contador global por email).
export async function countCurrentPasswordChangedNotices(): Promise<number> {
  return await convexClient().query(api.testSupport.countCurrentPasswordChangedNotices, {
    serverKey: testSupportKey(),
    email: RESET_TEST_EMAIL,
  });
}

// MIS-309: helpers de las pruebas e2e de gestión de usuarios. teamTestEmail
// genera un email único de la familia RESERVADA (dominio team-e2e.test.local, no
// enrutable). deleteTeamTestUser limpia ese usuario tras el test — el harness
// solo puede borrar emails de esa familia (convex/testSupport.ts::deleteTeamTestUser).
export function teamTestEmail(label: string): string {
  const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  return `e2e-${label}-${suffix}@team-e2e.test.local`;
}

export async function deleteTeamTestUser(email: string): Promise<void> {
  await convexClient().mutation(api.testSupport.deleteTeamTestUser, {
    serverKey: testSupportKey(),
    email,
  });
}

export { RESET_TEST_EMAIL, TEST_LOGIN_IP, OVERSIZED_TEST_EMAIL, MAX_EMAIL_LENGTH };

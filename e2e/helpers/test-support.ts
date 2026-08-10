// MIS-286: envoltorio de las funciones del harness seguro (convex/testSupport.ts).
//
// La credencial se lee de process.env EN EL PROCESO DE NODE de Playwright y
// nunca se pasa a la página — el navegador jamás la ve, así que no puede
// aparecer en una traza ni en un screenshot.

import { convexClient, api } from "./convex-client";
import { RESET_TEST_EMAIL } from "../../convex/lib/testIdentity";

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
  const result = await convexClient().mutation(api.auth.login, {
    email: RESET_TEST_EMAIL,
    password,
  });
  return result.success;
}

export { RESET_TEST_EMAIL };

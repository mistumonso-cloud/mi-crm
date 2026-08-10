// MIS-285: invariantes de seguridad del flujo de recuperación de contraseña,
// verificadas por API (ConvexHttpClient) — no por formulario, mismo criterio
// que password-reset.spec.ts. Corre en "chromium-secrets" (MIS-286): la
// contraseña efímera de la identidad dedicada circula por aquí.
import { randomBytes } from "node:crypto";
import { test, expect } from "./helpers/secure-test";
import { convexClient, api } from "./helpers/convex-client";
import {
  RESET_TEST_EMAIL,
  countSessionsFor,
  expireResetCode,
  getLastResetCode,
  loginSucceeds,
  resetTestIdentity,
} from "./helpers/test-support";
import { generateNumericCode } from "../convex/lib/token";

function freshPassword(): string {
  return randomBytes(24).toString("base64url");
}

// Cambia un dígito, garantizando un código distinto del real sin asumir
// nada sobre su valor concreto.
function wrongCode(realCode: string): string {
  const firstDigit = Number(realCode[0]);
  const flipped = (firstDigit + 1) % 10;
  return `${flipped}${realCode.slice(1)}`;
}

// M14 (auditoría, ronda 2): `testOutbox` nunca borra entregas anteriores
// (solo resetTestIdentity() lo hace) y getLastResetCode() devuelve la de
// mayor createdAt entre TODAS — así que pedir un segundo código dentro del
// mismo test, con una entrega previa aún en el outbox, hace que
// `.not.toBeNull()` se satisfaga con el código VIEJO antes de que la nueva
// entrega (programada, no esperada por la mutation) haya terminado. El poll
// debe exigir un valor distinto del anterior, no solo "no nulo".
async function requestAndGetCode(previousCode: string | null = null): Promise<string> {
  const client = convexClient();
  await client.mutation(api.passwordReset.requestPasswordResetCode, { email: RESET_TEST_EMAIL });

  await expect
    .poll(
      async () => {
        const current = await getLastResetCode();
        return current !== null && current !== previousCode;
      },
      { message: "esperando una entrega nueva y distinta en el outbox de test", timeout: 10_000 },
    )
    .toBe(true);
  const code = await getLastResetCode();
  if (!code) throw new Error("getLastResetCode() devolvió null tras confirmar una entrega nueva");
  return code;
}

test.describe("generateNumericCode — invariantes deterministas", () => {
  test("longitud exacta 6, solo dígitos, y no siempre el mismo valor", () => {
    const samples = Array.from({ length: 200 }, () => generateNumericCode(6));

    for (const code of samples) {
      expect(code).toMatch(/^\d{6}$/);
      const asNumber = Number(code);
      expect(asNumber).toBeGreaterThanOrEqual(0);
      expect(asNumber).toBeLessThanOrEqual(999999);
    }

    expect(new Set(samples).size).toBeGreaterThan(1);
  });
});

test.describe("recuperación de contraseña — invariantes de seguridad (MIS-285)", () => {
  test("código incorrecto devuelve un error genérico", async () => {
    await resetTestIdentity();
    const realCode = await requestAndGetCode();
    const client = convexClient();

    const result = await client.mutation(api.passwordReset.verifyResetCode, {
      email: RESET_TEST_EMAIL,
      code: wrongCode(realCode),
    });

    expect(result.ok).toBe(false);
  });

  test("el 6.º intento queda bloqueado incluso con el código correcto", async () => {
    await resetTestIdentity();
    const realCode = await requestAndGetCode();
    const client = convexClient();

    for (let i = 0; i < 5; i++) {
      const result = await client.mutation(api.passwordReset.verifyResetCode, {
        email: RESET_TEST_EMAIL,
        code: wrongCode(realCode),
      });
      expect(result.ok).toBe(false);
    }

    // El código real ya no sirve: 5 intentos fallidos consumen el margen,
    // sea por `attempts >= 5` en la fila o por el rate limit de
    // `resetcode:<email>` — ambos caminos deben rechazar por igual.
    const finalAttempt = await client.mutation(api.passwordReset.verifyResetCode, {
      email: RESET_TEST_EMAIL,
      code: realCode,
    });
    expect(finalAttempt.ok).toBe(false);
  });

  test("un código caducado se rechaza sin esperar 15 minutos", async () => {
    await resetTestIdentity();
    const realCode = await requestAndGetCode();

    const hadActiveCode = await expireResetCode();
    expect(hadActiveCode).toBe(true);

    const client = convexClient();
    const result = await client.mutation(api.passwordReset.verifyResetCode, {
      email: RESET_TEST_EMAIL,
      code: realCode,
    });
    expect(result.ok).toBe(false);
  });

  test("un ticket ya usado no puede reutilizarse para un segundo cambio", async () => {
    await resetTestIdentity();
    const realCode = await requestAndGetCode();
    const client = convexClient();

    const verified = await client.mutation(api.passwordReset.verifyResetCode, {
      email: RESET_TEST_EMAIL,
      code: realCode,
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) throw new Error("unreachable");

    const firstChange = await client.mutation(api.passwordReset.resetPasswordWithTicket, {
      ticket: verified.ticket,
      newPassword: freshPassword(),
    });
    expect(firstChange.ok).toBe(true);

    const secondChange = await client.mutation(api.passwordReset.resetPasswordWithTicket, {
      ticket: verified.ticket,
      newPassword: freshPassword(),
    });
    expect(secondChange.ok).toBe(false);
  });

  // M12 (auditoría, ronda 2): tras agotar los 5 intentos de un código,
  // solicitar uno nuevo debe desbloquear la verificación — el rate limit de
  // `resetcode:<email>` no puede quedar atado al código anterior.
  test("tras 5 intentos fallidos, pedir un código nuevo desbloquea la verificación", async () => {
    await resetTestIdentity();
    const staleCode = await requestAndGetCode();
    const client = convexClient();

    for (let i = 0; i < 5; i++) {
      const result = await client.mutation(api.passwordReset.verifyResetCode, {
        email: RESET_TEST_EMAIL,
        code: wrongCode(staleCode),
      });
      expect(result.ok).toBe(false);
    }

    const freshCode = await requestAndGetCode(staleCode);
    const result = await client.mutation(api.passwordReset.verifyResetCode, {
      email: RESET_TEST_EMAIL,
      code: freshCode,
    });
    expect(result.ok).toBe(true);
  });

  // M13 (auditoría, ronda 2): la frontera pública debe rechazar entradas que
  // no cumplen el contrato (código que no son 6 dígitos) sin lanzar excepción
  // ni tratarlas de forma distinta a un código simplemente incorrecto.
  test("verifyResetCode rechaza códigos que no son 6 dígitos, con el mismo error genérico", async () => {
    await resetTestIdentity();
    await requestAndGetCode();
    const client = convexClient();

    for (const malformed of ["", "12345", "1234567", "abcdef", "12345a", "1 2345"]) {
      const result = await client.mutation(api.passwordReset.verifyResetCode, {
        email: RESET_TEST_EMAIL,
        code: malformed,
      });
      expect(result.ok).toBe(false);
    }
  });

  // M13: un email fuera del límite del contrato (>254) no debe lanzar ni
  // recibir trato distinto — mismo {ok:true} genérico que cualquier email
  // bien formado, exista o no la cuenta.
  test("requestPasswordResetCode con un email excesivamente largo responde {ok:true} sin lanzar", async () => {
    const client = convexClient();
    const oversizedEmail = `${"a".repeat(250)}@test.local`;
    const result = await client.mutation(api.passwordReset.requestPasswordResetCode, {
      email: oversizedEmail,
    });
    expect(result).toEqual({ ok: true });
  });

  // M13 (auditoría, ronda 2): la misma validación, pero contra
  // verifyResetCode directamente — la ronda 1 solo la probó en
  // requestPasswordResetCode. Email vacío y de 255 caracteres, respuesta
  // genérica sin excepción, invocada directamente por ConvexHttpClient (sin
  // pasar por el formulario, que ya recorta con maxLength/required).
  test("verifyResetCode con email vacío o excesivamente largo responde genérico sin lanzar", async () => {
    const client = convexClient();
    for (const badEmail of ["", `${"a".repeat(250)}@test.local`]) {
      const result = await client.mutation(api.passwordReset.verifyResetCode, {
        email: badEmail,
        code: "123456",
      });
      expect(result.ok).toBe(false);
    }
  });

  test("cambiar la contraseña invalida todas las sesiones existentes", async () => {
    const oldPassword = await resetTestIdentity();
    expect(await loginSucceeds(oldPassword)).toBe(true); // crea una sesión
    expect(await countSessionsFor()).toBeGreaterThan(0);

    const realCode = await requestAndGetCode();
    const client = convexClient();
    const verified = await client.mutation(api.passwordReset.verifyResetCode, {
      email: RESET_TEST_EMAIL,
      code: realCode,
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) throw new Error("unreachable");

    const changed = await client.mutation(api.passwordReset.resetPasswordWithTicket, {
      ticket: verified.ticket,
      newPassword: freshPassword(),
    });
    expect(changed.ok).toBe(true);

    expect(await countSessionsFor()).toBe(0);
  });
});

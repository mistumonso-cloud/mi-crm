// MIS-285: invariantes de seguridad del flujo de recuperación de contraseña,
// verificadas por API (ConvexHttpClient) — no por formulario, mismo criterio
// que password-reset.spec.ts. Corre en "chromium-secrets" (MIS-286): la
// contraseña efímera de la identidad dedicada circula por aquí.
import { randomBytes } from "node:crypto";
import { test, expect } from "./helpers/secure-test";
import { convexClient, api } from "./helpers/convex-client";
import {
  RESET_TEST_EMAIL,
  authServerKey,
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
  await client.mutation(api.passwordReset.requestPasswordResetCode, {
    email: RESET_TEST_EMAIL,
    serverKey: authServerKey(),
  });

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
      serverKey: authServerKey(),
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
        serverKey: authServerKey(),
      });
      expect(result.ok).toBe(false);
    }

    // El código real ya no sirve: 5 intentos fallidos consumen el margen,
    // sea por `attempts >= 5` en la fila o por el rate limit de
    // `resetcode:<email>` — ambos caminos deben rechazar por igual.
    const finalAttempt = await client.mutation(api.passwordReset.verifyResetCode, {
      email: RESET_TEST_EMAIL,
      code: realCode,
      serverKey: authServerKey(),
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
      serverKey: authServerKey(),
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
      serverKey: authServerKey(),
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) throw new Error("unreachable");

    const firstChange = await client.mutation(api.passwordReset.resetPasswordWithTicket, {
      ticket: verified.ticket,
      newPassword: freshPassword(),
      serverKey: authServerKey(),
    });
    expect(firstChange.ok).toBe(true);

    const secondChange = await client.mutation(api.passwordReset.resetPasswordWithTicket, {
      ticket: verified.ticket,
      newPassword: freshPassword(),
      serverKey: authServerKey(),
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
        serverKey: authServerKey(),
      });
      expect(result.ok).toBe(false);
    }

    const freshCode = await requestAndGetCode(staleCode);
    const result = await client.mutation(api.passwordReset.verifyResetCode, {
      email: RESET_TEST_EMAIL,
      code: freshCode,
      serverKey: authServerKey(),
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
        serverKey: authServerKey(),
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
      serverKey: authServerKey(),
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
        serverKey: authServerKey(),
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
      serverKey: authServerKey(),
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) throw new Error("unreachable");

    const changed = await client.mutation(api.passwordReset.resetPasswordWithTicket, {
      ticket: verified.ticket,
      newPassword: freshPassword(),
      serverKey: authServerKey(),
    });
    expect(changed.ok).toBe(true);

    expect(await countSessionsFor()).toBe(0);
  });

  // I3 (MIS-288/289): las funciones de recuperación rechazan un serverKey
  // inválido SIN efecto lateral. Una llamada directa a Convex con la clave mala
  // no entrega código, ni consume un código válido, ni consume un ticket válido.
  // Desde 1A-bis (MIS-289) el serverKey es obligatorio: `BAD_KEY` es un string
  // válido para el validador, así que sigue ejercitando el rechazo por clave
  // (no por argumento ausente); los controles positivos usan la clave BUENA.
  const BAD_KEY = "clave-incorrecta";

  test("requestPasswordResetCode con serverKey inválido no entrega código", async () => {
    await resetTestIdentity();
    const client = convexClient();

    // Clave mala: respuesta genérica {ok:true}, pero NO programa entrega.
    const res = await client.mutation(api.passwordReset.requestPasswordResetCode, {
      email: RESET_TEST_EMAIL,
      serverKey: BAD_KEY,
    });
    expect(res).toEqual({ ok: true });

    // Ventana negativa REAL: se sondea durante TODA la ventana y se falla en
    // cuanto aparezca un código. Un `expect.poll(...).toBeNull()` se satisface
    // con el primer null (antes de que el scheduler corra) y no espera nada —
    // falso verde (M-MIS288-1). Aquí se exige que se mantenga null toda la
    // ventana; una entrega programada por error (runAfter(0) entrega en ~1s)
    // caería dentro y rompería el test.
    const NEGATIVE_WINDOW_MS = 4000;
    const deadline = Date.now() + NEGATIVE_WINDOW_MS;
    while (Date.now() < deadline) {
      expect(
        await getLastResetCode(),
        "con clave mala no debe aparecer ningún código en toda la ventana",
      ).toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    // Última lectura tras el bucle: cierra la cola ciega de ≤200ms entre la
    // última iteración y el fin de la ventana, para que sea literal "toda la
    // ventana". La ventana negativa (4s) basta porque deliverResetCode se
    // programa con runAfter(0) y entrega en ~1s; el control positivo se deja en
    // 10s solo por holgura ante latencias del scheduler en CI.
    expect(
      await getLastResetCode(),
      "el outbox sigue vacío al cerrar la ventana",
    ).toBeNull();

    // Control positivo (clave BUENA): el camino real sí entrega un código.
    await client.mutation(api.passwordReset.requestPasswordResetCode, {
      email: RESET_TEST_EMAIL,
      serverKey: authServerKey(),
    });
    await expect
      .poll(async () => (await getLastResetCode()) !== null, {
        message: "con clave válida el código sí debe llegar",
        timeout: 10_000,
      })
      .toBe(true);
  });

  test("verifyResetCode con serverKey inválido no consume el código válido", async () => {
    await resetTestIdentity();
    const realCode = await requestAndGetCode();
    const client = convexClient();

    // Más de 5 llamadas con clave mala: si el rechazo NO fuese antes del rate
    // limit de `resetcode:<email>`, 5+ de estas lo agotarían y el control
    // positivo fallaría. Prueba que la clave se comprueba PRIMERO, sin tocar ni
    // el código ni el contador.
    for (let i = 0; i < 6; i++) {
      const bad = await client.mutation(api.passwordReset.verifyResetCode, {
        email: RESET_TEST_EMAIL,
        code: realCode,
        serverKey: BAD_KEY,
      });
      expect(bad.ok).toBe(false);
    }

    // El código NO se consumió ni se bloqueó: con clave buena, verifica y emite ticket.
    const good = await client.mutation(api.passwordReset.verifyResetCode, {
      email: RESET_TEST_EMAIL,
      code: realCode,
      serverKey: authServerKey(),
    });
    expect(good.ok).toBe(true);
  });

  test("resetPasswordWithTicket con serverKey inválido no consume el ticket válido", async () => {
    await resetTestIdentity();
    const realCode = await requestAndGetCode();
    const client = convexClient();

    const verified = await client.mutation(api.passwordReset.verifyResetCode, {
      email: RESET_TEST_EMAIL,
      code: realCode,
      serverKey: authServerKey(),
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) throw new Error("unreachable");

    const bad = await client.mutation(api.passwordReset.resetPasswordWithTicket, {
      ticket: verified.ticket,
      newPassword: freshPassword(),
      serverKey: BAD_KEY,
    });
    expect(bad.ok).toBe(false);

    // El ticket NO se consumió: con clave buena, cambia la contraseña.
    const good = await client.mutation(api.passwordReset.resetPasswordWithTicket, {
      ticket: verified.ticket,
      newPassword: freshPassword(),
      serverKey: authServerKey(),
    });
    expect(good.ok).toBe(true);
  });
});

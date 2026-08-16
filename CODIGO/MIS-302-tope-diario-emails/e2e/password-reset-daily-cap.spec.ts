// MIS-302 (B10): tope DIARIO de emails de recuperación por cuenta. Corre en
// "chromium-secrets" junto al resto del flujo de reset: aunque este spec no teclea
// contraseñas, comparte la identidad dedicada y la política de artefactos
// (trace/vídeo/screenshot OFF).
//
// SEMÁNTICA bajo prueba: ventana ANCLADA de 24 h (no móvil) con hasta 10
// solicitudes elegibles y candado deslizante al llegar a 10 — idéntica al resto
// del limitador. Estos tests ejercitan el conteo DENTRO de una sola ventana (todas
// las solicitudes ocurren en segundos); NO cruzan la frontera de 24 h (no hay
// reloj inyectable, y con ventana anclada el cruce es comportamiento aceptado, no
// un requisito). Ver plan y §5 del codigo-completo.
//
// AÍSLA la capa diaria: pide códigos por la vía directa SIN ipHint (la capa por IP
// no participa) y limpia la ventana del burst de 15 min entre solicitudes cuando
// hace falta, de modo que el limitador bajo prueba sea `resetday:<email>`.
//
// Dos tests de comportamiento (frontera del conteo + interacción burst↔diario) más
// uno de configuración que ancla los valores del contrato (10 elegibles / 24 h /
// bloqueo). El test de interacción está diseñado para FALLAR con la implementación
// de ronda 1 (que contaba también las solicitudes suprimidas).
import { test, expect } from "./helpers/secure-test";
import {
  getLastResetCode,
  resetTestIdentity,
  requestResetCode,
  clearResetRequestWindow,
} from "./helpers/test-support";
import { RESET_DAILY_LIMIT, RESET_REQUEST_LIMIT } from "../convex/lib/rateLimit";

const CAP = RESET_DAILY_LIMIT.maxAttempts;
const BURST = RESET_REQUEST_LIMIT.maxAttempts;

// Espera a que el outbox tenga un código DISTINTO del previo (gotcha: comprobar
// "valor diferente", no solo "no nulo", en entregas asíncronas repetidas).
async function pollForNewCode(prev: string | null): Promise<string> {
  await expect
    .poll(async () => await getLastResetCode(), {
      message: "esperando el nuevo código de recuperación en el outbox de test",
      timeout: 10_000,
    })
    .not.toBe(prev);
  const code = await getLastResetCode();
  if (!code) throw new Error("getLastResetCode() devolvió null tras superar el poll");
  return code;
}

// Espera acotada para asertar el NEGATIVO "no llega código nuevo". Inherentemente
// temporal, pero robusta aquí: las entregas previas ya se confirmaron con polling
// y deliverResetCode({allowed:false}) retorna sin escribir en el outbox.
// (Follow-up Baja: señal determinista del scheduler/outbox si se añadiera.)
async function assertNoNewCode(expected: string): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  expect(await getLastResetCode()).toBe(expected);
}

// Limpieza best-effort: garantiza dejar la identidad limpia (incluido resetday,
// candado de 24 h) sin enmascarar un error primario del test si fallara. Registra
// un mensaje CONSTANTE (sin email, código ni secretos) para no ocultar del todo un
// fallo de cleanup.
async function cleanup(): Promise<void> {
  await resetTestIdentity().catch(() => {
    console.warn("MIS-302 cleanup: resetTestIdentity falló (best-effort, sin datos sensibles)");
  });
}

test.describe("tope diario de emails de recuperación (MIS-302)", () => {
  // Ancla los valores del contrato: 10 solicitudes elegibles / ventana ANCLADA de
  // 24 h / con bloqueo. Un cambio accidental del valor rompe la suite.
  test("la config del tope diario es 10/día con ventana y bloqueo de 24 h", () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    expect(RESET_DAILY_LIMIT.maxAttempts).toBe(10);
    expect(RESET_DAILY_LIMIT.windowMs).toBe(DAY_MS);
    expect(RESET_DAILY_LIMIT.lock).toBe(true);
    if (RESET_DAILY_LIMIT.lock) {
      expect(RESET_DAILY_LIMIT.lockDurationMs).toBe(DAY_MS);
    }
    // Precondición de los tests de interacción: el burst se topa antes que el diario.
    expect(RESET_REQUEST_LIMIT.maxAttempts).toBe(5);
    expect(BURST).toBeLessThan(CAP);
  });

  test(`entrega ${CAP} emails elegibles y suprime el siguiente, sin delatar el tope`, async () => {
    await resetTestIdentity(); // limpia también resetday:<email>
    try {
      let lastCode: string | null = null;
      // Hasta el tope: se limpia el burst antes de cada solicitud, así el ÚNICO
      // limitador vivo es el diario.
      for (let i = 1; i <= CAP; i++) {
        await clearResetRequestWindow();
        const r = await requestResetCode();
        expect(r.ok).toBe(true);
        lastCode = await pollForNewCode(lastCode);
      }

      // Solicitud nº CAP+1: topada por la capa diaria. Se limpia OTRA VEZ el burst
      // para demostrar que el corte NO viene de él (reset:<email> sin candado)
      // sino del tope diario resetday:<email>.
      await clearResetRequestWindow();
      const suppressed = await requestResetCode();
      expect(suppressed.ok).toBe(true); // respuesta IDÉNTICA a las entregadas

      await assertNoNewCode(lastCode!);
    } finally {
      await cleanup();
    }
  });

  test("una solicitud suprimida por el burst NO consume cuota diaria (M1)", async () => {
    await resetTestIdentity();
    try {
      // BURST entregas SIN limpiar → al BURST-ésimo, reset:<email> se bloquea.
      let lastCode: string | null = null;
      for (let i = 1; i <= BURST; i++) {
        const r = await requestResetCode();
        expect(r.ok).toBe(true);
        lastCode = await pollForNewCode(lastCode);
      }
      const burstCode = lastCode!;

      // CAP - BURST solicitudes más con el burst bloqueado: {ok:true} pero sin
      // código nuevo. Emitir exactamente CAP - BURST garantiza que la versión
      // defectuosa (que contaba las suprimidas) llegue justo a CAP y bloquee el
      // envío siguiente; la correcta las ignora y deja cuota.
      for (let i = 0; i < CAP - BURST; i++) {
        const r = await requestResetCode();
        expect(r.ok).toBe(true);
      }
      await assertNoNewCode(burstCode);

      // Limpiar SOLO el burst; la siguiente DEBE entregar: con la corrección M1 es
      // el consumo diario nº BURST+1 (elegible); con el bug, resetday ya valdría
      // CAP y se bloquearía → este test lo caza.
      await clearResetRequestWindow();
      const r = await requestResetCode();
      expect(r.ok).toBe(true);
      const fresh = await pollForNewCode(burstCode);
      expect(fresh).not.toBe(burstCode);
    } finally {
      await cleanup();
    }
  });
});

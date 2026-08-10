# MIS-286 — Código completo

> Harness seguro de pruebas e2e para recuperación de contraseña.
> Plan: [PLANS/MIS-286-harness-seguro-e2e-recuperacion.md](../../PLANS/MIS-286-harness-seguro-e2e-recuperacion.md)
> Rama: `mistumonso/mis-286-harness-seguro-e2e-recuperacion` · Commit: `fa51afc`
>
> **Alcance declarado por auditoría para esta revisión: B1** — política de artefactos y evidencia ejecutable.
> M10 y M11 quedaron resueltos en la ronda anterior y no se reabren.

## Qué se está auditando

Infraestructura que permitirá verificar en CI el flujo de recuperación de contraseña (MIS-285) **sin abrir un agujero de seguridad** en el deployment de Convex de dev, que es compartido y accesible desde internet sin credencial administrativa.

**Tres cerrojos** sobre `convex/testSupport.ts`: credencial de alta entropía comparada en tiempo constante y *fail-closed* (ausente en producción ⇒ funciones inertes), identidad dedicada (`reset@test.local`, rechaza cualquier otro email) y contraseñas efímeras (se generan en cada reseed, solo se devuelven al llamante autenticado; **ninguna contraseña válida vive en el repositorio**).

**Política de artefactos**: las trazas de Playwright serializan los parámetros de las acciones y CI las publica 14 días. Los specs con secretos corren sin trace/vídeo/captura **y** con un `test` endurecido que limpia el DOM — porque `error-context.md` se escribe siempre que un test falla, incluye el valor de los inputs en claro y **no se puede desactivar**. El gate `npm run test:e2e:secret-gate` lo demuestra en cada ejecución.

> **El gate encontró una fuga real en su primera ejecución** (justo ese `error-context.md`), que es lo que motivó `secure-test.ts`. El control positivo no es teórico.

---

# Ficheros nuevos

## `convex/lib/testIdentity.ts`

Constante compartida: identidad dedicada + nombre de la env var del harness. Única fuente de verdad, la importan testSupport.ts (MIS-286) y passwordReset.ts (MIS-285).

```ts
// MIS-286: identidad dedicada para las pruebas e2e de recuperación de contraseña.
//
// Vive en un único sitio porque la comparten dos módulos que deben coincidir
// EXACTAMENTE: convex/testSupport.ts (el harness, que solo opera sobre esta
// identidad) y convex/passwordReset.ts (MIS-285, que solo escribe en el outbox
// de test cuando el destinatario es esta identidad). Una divergencia entre
// ambos silenciaría el outbox o abriría el harness a otras cuentas.
//
// Ya normalizado (minúsculas), tal y como lo devolvería normalizeEmailKey.
export const RESET_TEST_EMAIL = "reset@test.local";

// Nombre de la env var de Convex con la credencial de alta entropía que protege
// el harness. En producción NO debe existir: su ausencia deja inertes todas las
// funciones de testSupport (fail-closed).
export const TEST_SUPPORT_ENV_VAR = "E2E_TEST_SUPPORT_KEY";
```

---

## `convex/testSupport.ts`

El harness. Cinco funciones, protegidas por credencial fail-closed + identidad dedicada. La contraseña se genera en cada reseed.

```ts
// MIS-286: harness seguro de pruebas e2e para el flujo de recuperación de
// contraseña (MIS-285).
//
// POR QUÉ ESTE MÓDULO EXISTE
// El código OTP llega por email y en BD solo se guarda su hash, así que un test
// no puede leerlo por medios normales. Este módulo abre la mínima puerta que lo
// permite — y la cierra con tres cerrojos independientes:
//
//   1. CREDENCIAL de alta entropía (`E2E_TEST_SUPPORT_KEY`) comparada en tiempo
//      constante y FAIL-CLOSED. En producción esa env var no existe, así que
//      todas estas funciones lanzan aunque el código esté desplegado.
//   2. IDENTIDAD DEDICADA: solo operan sobre RESET_TEST_EMAIL. Nunca pueden
//      tocar carlos@test.local, mistumonso@gmail.com ni ninguna cuenta real.
//   3. SECRETOS EFÍMEROS: la contraseña de esa identidad se genera en cada
//      llamada y solo se devuelve al llamante ya autenticado — no existe
//      ninguna contraseña válida en el repositorio.
//
// OJO con el alcance real de una filtración: desde MIS-251 el rol NO autoriza
// nada (ver convex/lib/authz.ts), así que la identidad dedicada tiene acceso
// completo de lectura/escritura al CRM de dev igual que cualquier usuario. Una
// filtración de E2E_TEST_SUPPORT_KEY exige ROTACIÓN INMEDIATA de la credencial
// (en Convex dev y en GitHub Secrets); lo que sí acota el cerrojo 2 es que el
// harness no pueda manipular las cuentas de Carlos y Marta.

import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { constantTimeEqual, hashPassword } from "./lib/password";
import { generateOpaqueToken } from "./lib/token";
import { normalizeEmailKey, resetAttempts } from "./lib/rateLimit";
import { RESET_TEST_EMAIL, TEST_SUPPORT_ENV_VAR } from "./lib/testIdentity";

const UNAUTHORIZED = "No autorizado";
const FORBIDDEN_IDENTITY = "Identidad no permitida";

// Cerrojo 1. Fail-closed: sin env var configurada NO hay valor de serverKey que
// pueda pasar, porque `expected` es undefined y la comparación no llega a
// ejecutarse. Mismo patrón que loginWithGoogle en convex/auth.ts.
function assertTestKey(serverKey: string): void {
  const expected = process.env[TEST_SUPPORT_ENV_VAR];
  const ok =
    !!expected &&
    constantTimeEqual(
      new TextEncoder().encode(serverKey),
      new TextEncoder().encode(expected),
    );
  if (!ok) throw new Error(UNAUTHORIZED);
}

// Cerrojo 2. Devuelve el email ya normalizado para que quien lo llame use
// SIEMPRE la forma canónica en sus consultas.
function assertDedicatedIdentity(email: string): string {
  const key = normalizeEmailKey(email);
  if (key !== RESET_TEST_EMAIL) throw new Error(FORBIDDEN_IDENTITY);
  return key;
}

async function findTestUser(ctx: QueryCtx | MutationCtx) {
  return await ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", RESET_TEST_EMAIL))
    .unique();
}

// Claves de rate limit que pertenecen EXCLUSIVAMENTE a la identidad dedicada.
// Enumeración explícita a propósito: nunca se borra por prefijo, y nunca se
// tocan las claves `ip:` / `resetip:` porque son COMPARTIDAS entre usuarios y
// limpiarlas debilitaría el rate limiting real del deployment.
function rateLimitKeysForTestIdentity(): string[] {
  return [
    RESET_TEST_EMAIL, // login
    `reset:${RESET_TEST_EMAIL}`, // solicitudes de código
    `resetcode:${RESET_TEST_EMAIL}`, // intentos de código
  ];
}

// Reseed IDEMPOTENTE. Se llama al INICIO de cada spec (no en cleanup: un
// cleanup se salta si el test falla, y entonces la ejecución siguiente heredaría
// el bloqueo de rate limit y fallaría durante 15 minutos).
export const resetTestIdentity = mutation({
  args: { serverKey: v.string(), email: v.string() },
  returns: v.object({ password: v.string() }),
  handler: async (ctx, args) => {
    assertTestKey(args.serverKey);
    assertDedicatedIdentity(args.email);

    // Contraseña EFÍMERA: 32 bytes nuevos en cada llamada. Se devuelve en claro
    // solo aquí, al llamante ya autenticado por serverKey; en BD queda hasheada.
    const password = generateOpaqueToken();
    const passwordHash = await hashPassword(password);

    const existing = await findTestUser(ctx);
    const userId = existing
      ? (await ctx.db.patch(existing._id, { passwordHash }), existing._id)
      : await ctx.db.insert("users", {
          name: "Reset E2E",
          email: RESET_TEST_EMAIL,
          passwordHash,
          role: "rep",
        });

    // Estado inicial determinista: sin códigos, sin sesiones, sin outbox y sin
    // bloqueos. Cada spec puede así declarar de qué parte.
    for (const row of await ctx.db
      .query("passwordResetCodes")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect()) {
      await ctx.db.delete(row._id);
    }
    for (const session of await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect()) {
      await ctx.db.delete(session._id);
    }
    for (const entry of await ctx.db
      .query("testOutbox")
      .withIndex("by_email", (q) => q.eq("email", RESET_TEST_EMAIL))
      .collect()) {
      await ctx.db.delete(entry._id);
    }
    for (const key of rateLimitKeysForTestIdentity()) {
      await resetAttempts(ctx, key);
    }

    return { password };
  },
});

// Devuelve null cuando el outbox está vacío (aún no se ha pedido código).
export const getLastResetCode = query({
  args: { serverKey: v.string(), email: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    assertTestKey(args.serverKey);
    assertDedicatedIdentity(args.email);

    const entries = await ctx.db
      .query("testOutbox")
      .withIndex("by_email", (q) => q.eq("email", RESET_TEST_EMAIL))
      .collect();
    if (entries.length === 0) return null;

    let latest = entries[0];
    for (const entry of entries) {
      if (entry.createdAt > latest.createdAt) latest = entry;
    }
    return latest.code;
  },
});

// Permite probar la caducidad en segundos en lugar de esperar 15 minutos, sin
// abstracción de reloj y sin tocar la lógica de producción. Devuelve si había
// una fila que caducar.
export const expireResetCode = mutation({
  args: { serverKey: v.string(), email: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    assertTestKey(args.serverKey);
    assertDedicatedIdentity(args.email);

    const user = await findTestUser(ctx);
    if (!user) return false;

    const rows = await ctx.db
      .query("passwordResetCodes")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const active = rows.filter((row) => !row.usedAt);
    if (active.length === 0) return false;

    const past = Date.now() - 1000;
    for (const row of active) {
      await ctx.db.patch(row._id, {
        expiresAt: past,
        ...(row.ticketExpiresAt === undefined ? {} : { ticketExpiresAt: past }),
      });
    }
    return true;
  },
});

// Verifica la invalidación de sesiones tras un cambio de contraseña.
export const countSessionsFor = query({
  args: { serverKey: v.string(), email: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    assertTestKey(args.serverKey);
    assertDedicatedIdentity(args.email);

    const user = await findTestUser(ctx);
    if (!user) return 0;

    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    return sessions.length;
  },
});

// internalMutation: NO forma parte de `api.*`, ningún cliente externo puede
// invocarla — por eso es la única función del módulo que no recibe serverKey.
// La llama el envío de MIS-285. Dos salvaguardas propias, por si un futuro call
// site se equivoca:
//   - inerte si la credencial del harness no está configurada (producción);
//   - lanza si el destinatario no es la identidad dedicada.
export const recordOutbox = internalMutation({
  args: { email: v.string(), code: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!process.env[TEST_SUPPORT_ENV_VAR]) return null;
    assertDedicatedIdentity(args.email);

    await ctx.db.insert("testOutbox", {
      email: RESET_TEST_EMAIL,
      code: args.code,
      createdAt: Date.now(),
    });
    return null;
  },
});
```

---

## `e2e/helpers/test-support.ts`

Envoltorio de las funciones anteriores. Lee la credencial de process.env en Node: NUNCA se pasa al navegador.

```ts
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
```

---

## `e2e/helpers/secure-test.ts`

`test` endurecido: limpia los valores del DOM antes de que Playwright genere error-context.md (que incluye un page snapshot con los inputs en claro y no se puede desactivar).

```ts
// MIS-286: `test` endurecido para los specs que manejan secretos.
//
// POR QUÉ HACE FALTA, ADEMÁS DE DESACTIVAR trace/vídeo/screenshot
// Playwright escribe `error-context.md` SIEMPRE que un test falla
// (node_modules/playwright/lib/index.js → didFinishTest), y ese fichero incluye
// un "page snapshot" en ARIA. Ese snapshot contiene el VALOR de los inputs en
// claro — también el de un `input[type=password]`. No lo controla ninguna
// opción de captura y no existe flag para desactivarlo, así que poner
// `trace: "off"` NO basta: una contraseña tecleada acabaría en un artefacto que
// CI publica durante 14 días.
//
// CÓMO SE CIERRA
// Un fixture automático que, al terminar el test, vacía el valor de todos los
// inputs de la página. Playwright toma el page snapshot en el teardown de su
// propio fixture `_setupArtifacts`, que se desmonta DESPUÉS que este (los
// fixtures se desmontan en orden inverso al de montaje, y este depende de
// `page`), de modo que el snapshot se genera ya sin valores.
//
// El fichero `error-context.md` sigue existiendo y conserva su utilidad para
// depurar (estructura de la página, error, código fuente): lo único que
// desaparece son los valores tecleados.
//
// Esto NO se sostiene por convención: `npm run test:e2e:secret-gate` lo
// demuestra en cada ejecución con un centinela real.

import { test as base } from "@playwright/test";

export const test = base.extend<{ scrubSecretsFromDom: void }>({
  scrubSecretsFromDom: [
    async ({ page }, use) => {
      await use();
      try {
        await page.evaluate(() => {
          for (const input of Array.from(document.querySelectorAll("input"))) {
            input.value = "";
          }
        });
      } catch {
        // La página puede estar ya cerrada (o el contexto caído) cuando el test
        // falla de forma abrupta: en ese caso tampoco hay snapshot que limpiar.
      }
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";
```

---

## `e2e/test-support.spec.ts`

Pruebas del propio harness: los tres cerrojos y la limpieza de rate limits (M8).

```ts
// MIS-286: pruebas del propio harness, ANTES de que MIS-285 dependa de él.
//
// Corre en el project "chromium-secrets" (sin trace, vídeo ni screenshots):
// aquí circulan contraseñas efímeras válidas y no deben poder quedar en ningún
// artefacto de CI. El gate `npm run test:e2e:secret-gate` demuestra que esa
// política funciona de verdad.

// Todos los specs del project "chromium-secrets" usan este `test` endurecido,
// que limpia los valores del DOM antes de que Playwright genere error-context.md.
// Aquí ningún secreto llega al navegador (todo va por ConvexHttpClient), pero la
// regla se aplica por defecto para que una edición futura no reabra el agujero.
import { test, expect } from "./helpers/secure-test";
import { convexClient, api } from "./helpers/convex-client";
import {
  RESET_TEST_EMAIL,
  countSessionsFor,
  getLastResetCode,
  loginSucceeds,
  resetTestIdentity,
} from "./helpers/test-support";

test.describe("harness seguro (MIS-286)", () => {
  // Cerrojo 1: sin la credencial correcta no se pasa. Se prueban UNA mutation y
  // UNA query porque todas comparten el mismo guard `assertTestKey`.
  test("rechaza llamadas sin la credencial correcta", async () => {
    const client = convexClient();

    for (const badKey of ["", "clave-incorrecta"]) {
      await expect(
        client.mutation(api.testSupport.resetTestIdentity, {
          serverKey: badKey,
          email: RESET_TEST_EMAIL,
        }),
      ).rejects.toThrow(/No autorizado/);

      await expect(
        client.query(api.testSupport.getLastResetCode, {
          serverKey: badKey,
          email: RESET_TEST_EMAIL,
        }),
      ).rejects.toThrow(/No autorizado/);
    }
  });

  // Cerrojo 2: la credencial correcta NO habilita tocar cuentas reales.
  test("rechaza cualquier identidad que no sea la dedicada", async () => {
    const key = process.env.E2E_TEST_SUPPORT_KEY;
    expect(key, "E2E_TEST_SUPPORT_KEY debe estar configurada").toBeTruthy();

    await expect(
      convexClient().mutation(api.testSupport.resetTestIdentity, {
        serverKey: key!,
        email: "carlos@test.local",
      }),
    ).rejects.toThrow(/Identidad no permitida/);
  });

  // Cerrojo 3 + estado inicial determinista.
  test("el reseed es idempotente y devuelve una contraseña distinta cada vez", async () => {
    const first = await resetTestIdentity();
    const second = await resetTestIdentity();

    expect(second).not.toBe(first);

    // Estado inicial que los specs de MIS-285 pueden dar por supuesto. Se
    // comprueba ANTES de cualquier login: `api.auth.login` crea una sesión, así
    // que hacerlo después mediría el efecto del propio test, no el del reseed.
    expect(await countSessionsFor()).toBe(0);
    expect(await getLastResetCode()).toBeNull();

    expect(await loginSucceeds(second)).toBe(true);
    // La anterior deja de valer: el reseed rota la credencial.
    expect(await loginSucceeds(first)).toBe(false);
  });

  // M8: sin esta limpieza, una ejecución que deje el bloqueo puesto haría
  // fallar la siguiente durante 15 minutos. Se omite ipHint a propósito para
  // ejercitar SOLO la clave por usuario, sin tocar el contador de IP compartido.
  test("el reseed limpia el bloqueo de rate limit del login", async () => {
    const password = await resetTestIdentity();
    const client = convexClient();

    for (let i = 0; i < 5; i++) {
      await client.mutation(api.auth.login, {
        email: RESET_TEST_EMAIL,
        password: "contraseña-incorrecta",
      });
    }

    // Bloqueada: ni siquiera la contraseña correcta entra.
    expect(await loginSucceeds(password)).toBe(false);

    const fresh = await resetTestIdentity();
    expect(await loginSucceeds(fresh)).toBe(true);
  });
});
```

---

## `e2e/secret-sentinel.spec.ts`

Spec del gate. FALLA A PROPÓSITO; solo lo ejecuta el script del gate.

```ts
// MIS-286: spec del GATE de fugas. FALLA A PROPÓSITO.
//
// No pertenece a ningún project de playwright.config.ts (que además lo excluye
// con testIgnore): solo lo ejecuta scripts/check-secret-leak.mjs a través de
// playwright.gate.config.ts. Si algún día apareciera en `npm run test:e2e`,
// rompería el e2e normal — por eso el doble aislamiento.
//
// Qué hace: teclea un valor centinela en un campo de contraseña real y luego
// falla, para forzar a Playwright a conservar los artefactos del fallo. El
// script comprueba después si el centinela quedó grabado en ellos.
//   - Fase A (project con trace ON): DEBE aparecer → demuestra que el escáner
//     detecta fugas de verdad.
//   - Fase B (project sin captura): NO debe aparecer → es la garantía de B1.
//
// El centinela es una cadena aleatoria sin valor, no una credencial real.

// Usa el `test` endurecido de los specs con secretos: es EXACTAMENTE la misma
// protección que el gate debe demostrar, no una versión especial para el gate.
import { test, expect } from "./helpers/secure-test";

test("centinela: teclea un secreto y falla a propósito", async ({ page }) => {
  const sentinel = process.env.SECRET_SENTINEL;
  if (!sentinel) throw new Error("Falta SECRET_SENTINEL — este spec solo lo ejecuta el gate");

  await page.goto("/login");
  await page.locator('input[name="password"]').fill(sentinel);

  // Fallo intencional: es la única forma de que Playwright conserve la traza
  // con `retain-on-failure` y de que haya artefactos que escanear.
  expect(true, "fallo intencional del gate de fugas").toBe(false);
});
```

---

## `playwright.gate.config.ts`

Configuración EXCLUSIVA del gate, aislada de la principal para que el fallo intencional nunca entre en `npm run test:e2e`.

```ts
// MIS-286: configuración EXCLUSIVA del gate de fugas de secretos.
//
// Vive separada de playwright.config.ts a propósito. El spec que recoge
// (secret-sentinel.spec.ts) falla intencionadamente, así que no puede convivir
// con los projects normales: `npm run test:e2e` usa la configuración principal,
// que además lo excluye con testIgnore. Doble aislamiento.
//
// Los dos projects recogen EXACTAMENTE el mismo spec y difieren solo en la
// política de captura — que es justo la variable bajo prueba:
//   - gate-trace   → captura ACTIVADA: el centinela DEBE aparecer (control positivo)
//   - gate-secrets → captura DESACTIVADA, igual que "chromium-secrets": NO debe aparecer
//
// Lo ejecuta scripts/check-secret-leak.mjs; no se invoca a mano.

import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, ".env.local") });
dotenv.config({ path: path.resolve(__dirname, ".env.test.local") });

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  // Sin reintentos: el spec falla a propósito y reintentarlo solo duplicaría
  // artefactos y tiempo.
  retries: 0,
  // Reporter JSON: el script lo lee para exigir que la fase ejecutó
  // EXACTAMENTE 1 test (cero tests recogidos debe ser un fallo, no un falso
  // verde por un testMatch mal escrito).
  reporter: [["json", { outputFile: process.env.GATE_REPORT ?? "gate-report.json" }]],
  use: {
    baseURL,
  },
  projects: [
    {
      name: "gate-trace",
      testMatch: ["secret-sentinel.spec.ts"],
      use: {
        ...devices["Desktop Chrome"],
        trace: "on",
        video: "on",
        screenshot: "on",
      },
    },
    {
      name: "gate-secrets",
      testMatch: ["secret-sentinel.spec.ts"],
      // Debe replicar EXACTAMENTE la política de "chromium-secrets" en
      // playwright.config.ts: si una cambia y la otra no, el gate deja de
      // demostrar lo que dice demostrar.
      use: {
        ...devices["Desktop Chrome"],
        trace: "off",
        video: "off",
        screenshot: "off",
      },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
```

---

## `scripts/check-secret-leak.mjs`

El gate: fase de control positivo + fase de garantía, con lectura del interior de los .zip de trace y de stdout/stderr.

```js
#!/usr/bin/env node
// MIS-286 · Gate de fugas de secretos en artefactos de Playwright.
//
// EL PROBLEMA QUE VIGILA
// playwright.config.ts usa `trace: "retain-on-failure"` y CI publica
// playwright-report/ durante 14 días. Las trazas SERIALIZAN los parámetros de
// las acciones, así que un `fill()` con una contraseña la deja como texto
// dentro del trace. Si un spec fallara antes de rotarla, el artefacto
// contendría una credencial todavía válida.
//
// CÓMO LO DEMUESTRA (dos fases, con control positivo)
//   Fase A — control: ejecuta el centinela con la captura ACTIVADA. El valor
//     DEBE aparecer. Sin esta fase, un gate que no encuentra nada podría estar
//     simplemente mirando mal (ruta equivocada, zip sin descomprimir...).
//   Fase B — garantía: ejecuta el MISMO spec con la política de
//     "chromium-secrets". El valor NO debe aparecer en ficheros, dentro de los
//     .zip de trace, ni en stdout/stderr del proceso.
//
// Cada fase exige haber ejecutado EXACTAMENTE 1 test: cero tests recogidos es
// un fallo, no un falso verde.
//
// El centinela nunca se imprime: los diagnósticos citan fase y fichero.

import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, readFileSync, readdirSync, statSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = "playwright.gate.config.ts";

// Prefijo reconocible + entropía: si algún día aparece en un artefacto, se
// identifica de inmediato como fuga del gate y no como dato real.
const SENTINEL = `SENTINEL-${randomBytes(24).toString("hex")}`;

function fresh(dir) {
  const abs = path.join(ROOT, dir);
  rmSync(abs, { recursive: true, force: true });
  mkdirSync(abs, { recursive: true });
  return abs;
}

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

// Los traces son .zip: un grep sobre el fichero comprimido NO encuentra el
// contenido. Hay que descomprimir y mirar dentro.
function zipContains(file, needle) {
  const res = spawnSync("unzip", ["-p", file], { maxBuffer: 512 * 1024 * 1024 });
  if (res.status !== 0 || !res.stdout) return false;
  return res.stdout.includes(needle);
}

function findSentinelIn(dirs, needle) {
  const hits = [];
  for (const dir of dirs) {
    for (const file of walk(dir)) {
      const isZip = file.endsWith(".zip");
      const found = isZip
        ? zipContains(file, needle)
        : readFileSync(file).includes(needle);
      if (found) hits.push(path.relative(ROOT, file));
    }
  }
  return hits;
}

function runPhase({ project, outputDir, reportFile }) {
  const outAbs = fresh(outputDir);
  rmSync(path.join(ROOT, reportFile), { force: true });

  const res = spawnSync(
    "npx",
    ["playwright", "test", "--config", CONFIG, "--project", project, "--output", outAbs],
    {
      cwd: ROOT,
      encoding: "utf-8",
      env: { ...process.env, SECRET_SENTINEL: SENTINEL, GATE_REPORT: reportFile },
      maxBuffer: 64 * 1024 * 1024,
    },
  );

  let executed = 0;
  let failedAsExpected = false;
  try {
    const report = JSON.parse(readFileSync(path.join(ROOT, reportFile), "utf-8"));
    for (const suite of report.suites ?? []) {
      for (const spec of collectSpecs(suite)) {
        executed++;
        // El fallo debe venir del expect intencional, no de un error de
        // configuración, de arranque del navegador o de un spec que ni corrió.
        for (const t of spec.tests ?? []) {
          for (const r of t.results ?? []) {
            if (r.status === "failed" && (r.error?.message ?? "").includes("fallo intencional")) {
              failedAsExpected = true;
            }
          }
        }
      }
    }
  } catch {
    /* sin reporte legible: executed queda a 0 y la fase falla abajo */
  }

  return {
    executed,
    failedAsExpected,
    output: `${res.stdout ?? ""}${res.stderr ?? ""}`,
    outputDir: outAbs,
  };
}

function collectSpecs(suite) {
  const specs = [...(suite.specs ?? [])];
  for (const child of suite.suites ?? []) specs.push(...collectSpecs(child));
  return specs;
}

const problems = [];

// ---------- Fase A: control positivo ----------
console.log("Fase A (control): captura ACTIVADA — el centinela DEBE aparecer.");
const a = runPhase({
  project: "gate-trace",
  outputDir: "test-results-gate-a",
  reportFile: "gate-report-a.json",
});

if (a.executed !== 1) {
  problems.push(`Fase A ejecutó ${a.executed} tests, se esperaba exactamente 1 (¿testMatch roto?).`);
} else if (!a.failedAsExpected) {
  problems.push("Fase A no terminó por el fallo intencional (¿error de configuración, arranque o navegador?).");
} else {
  const hits = findSentinelIn([a.outputDir], SENTINEL);
  if (hits.length === 0) {
    problems.push(
      "Fase A NO encontró el centinela con la captura activada: el escáner no detecta fugas, " +
        "así que un resultado limpio en la fase B no probaría nada.",
    );
  } else {
    console.log(`  OK — detectado en ${hits.length} artefacto(s); el escáner funciona.`);
  }
}
// Los artefactos de control contienen el centinela: se borran siempre.
rmSync(a.outputDir, { recursive: true, force: true });

// ---------- Fase B: la garantía ----------
console.log('Fase B (garantía): política de "chromium-secrets" — el centinela NO debe aparecer.');
const b = runPhase({
  project: "gate-secrets",
  outputDir: "test-results-gate-b",
  reportFile: "gate-report-b.json",
});

if (b.executed !== 1) {
  problems.push(`Fase B ejecutó ${b.executed} tests, se esperaba exactamente 1 (¿testMatch roto?).`);
} else {
  const dirs = [b.outputDir, path.join(ROOT, "playwright-report")];
  const hits = findSentinelIn(dirs, SENTINEL);
  for (const hit of hits) {
    problems.push(`Fase B: el secreto quedó registrado en ${hit}`);
  }
  // "ni logs ni artefactos": también la salida del proceso.
  if (b.output.includes(SENTINEL)) {
    problems.push("Fase B: el secreto apareció en stdout/stderr del proceso de Playwright.");
  }
  if (hits.length === 0 && !b.output.includes(SENTINEL)) {
    console.log("  OK — sin rastro en artefactos, traces ni salida del proceso.");
  }
}

rmSync(b.outputDir, { recursive: true, force: true });
for (const f of ["gate-report-a.json", "gate-report-b.json"]) {
  rmSync(path.join(ROOT, f), { force: true });
}

if (problems.length > 0) {
  console.error("\n❌ Gate de fugas FALLIDO:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log("\n✅ Gate de fugas superado: la política de no captura funciona y está demostrada.");
```

---

# Ficheros modificados

Diff contra `main`.

## `convex/schema.ts`

Añade las tablas `passwordResetCodes` (esquema; su lógica es de MIS-285) y `testOutbox`.

```diff
diff --git a/convex/schema.ts b/convex/schema.ts
index 6d7699d..1b891b8 100644
--- a/convex/schema.ts
+++ b/convex/schema.ts
@@ -230,4 +230,34 @@ export default defineSchema({
     windowStartedAt: v.number(),
     lockedUntil: v.optional(v.number()),
   }).index("by_emailKey", ["emailKey"]),
+
+  // MIS-286: el ESQUEMA lo aporta este ticket aunque la LÓGICA que la llena sea
+  // de MIS-285. Motivo: convex/testSupport.ts consulta esta tabla (limpieza en
+  // resetTestIdentity, expireResetCode) y MIS-286 se mergea antes — sin el
+  // esquema aquí, el harness no compilaría. Hasta MIS-285 la tabla queda vacía.
+  passwordResetCodes: defineTable({
+    userId: v.id("users"),
+    // SHA-256 del código de 6 dígitos — nunca el código en claro. Opcional
+    // porque se BORRA al verificar: un código consumido no puede volver a
+    // emitir tickets.
+    codeHash: v.optional(v.string()),
+    expiresAt: v.number(),
+    attempts: v.number(),
+    // SHA-256 del ticket opaco que autoriza el cambio, fijado al verificar.
+    ticketHash: v.optional(v.string()),
+    ticketExpiresAt: v.optional(v.number()),
+    usedAt: v.optional(v.number()),
+  })
+    .index("by_user", ["userId"])
+    .index("by_ticketHash", ["ticketHash"]),
+
+  // MIS-286: buzón EXCLUSIVO de pruebas. Solo recibe filas de la identidad
+  // dedicada (RESET_TEST_EMAIL) y solo cuando la credencial del harness está
+  // configurada — en producción esa env var no existe, así que queda vacía por
+  // construcción. Es el único sitio donde un código vive en claro.
+  testOutbox: defineTable({
+    email: v.string(),
+    code: v.string(),
+    createdAt: v.number(),
+  }).index("by_email", ["email"]),
 });
```

---

## `playwright.config.ts`

Añade el project `chromium-secrets` (sin captura) y `testIgnore` del spec centinela.

```diff
diff --git a/playwright.config.ts b/playwright.config.ts
index f9c5d37..18d196d 100644
--- a/playwright.config.ts
+++ b/playwright.config.ts
@@ -12,6 +12,12 @@ const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
 
 export default defineConfig({
   testDir: "./e2e",
+  // MIS-286: secret-sentinel.spec.ts FALLA A PROPÓSITO — es el spec del gate de
+  // fugas y solo debe ejecutarlo scripts/check-secret-leak.mjs vía
+  // playwright.gate.config.ts. Ningún project de aquí lo matchea, pero se
+  // excluye además explícitamente: si alguien añadiera un project con testMatch
+  // amplio, un fallo intencional rompería el e2e normal.
+  testIgnore: ["secret-sentinel.spec.ts"],
   // Todos los tests comparten el mismo deployment de Convex de dev
   // (dutiful-mole-111, el mismo que usa `npm run dev` en local) — un solo
   // worker evita carreras de datos entre specs que leen/escriben las mismas
@@ -65,6 +71,25 @@ export default defineConfig({
       testMatch: ["google-auth.spec.ts"],
       use: { ...devices["Desktop Chrome"] },
     },
+
+    // MIS-286: specs que manejan CONTRASEÑAS EFÍMERAS VÁLIDAS de la identidad
+    // dedicada. Sin trace, vídeo ni screenshots: las trazas serializan los
+    // parámetros de las acciones (un fill() dejaría la contraseña como texto)
+    // y CI publica los artefactos durante 14 días. Sin captura no hay artefacto
+    // donde el secreto pueda quedar. El gate `npm run test:e2e:secret-gate`
+    // demuestra que esta política funciona de verdad.
+    // Si cambias esta política, cambia también "gate-secrets" en
+    // playwright.gate.config.ts: el gate replica estos valores a propósito.
+    {
+      name: "chromium-secrets",
+      testMatch: ["test-support.spec.ts"],
+      use: {
+        ...devices["Desktop Chrome"],
+        trace: "off",
+        video: "off",
+        screenshot: "off",
+      },
+    },
   ],
   webServer: {
     command: "npm run dev",
```

---

## `package.json`

Nuevo script `test:e2e:secret-gate`.

```diff
diff --git a/package.json b/package.json
index 43495d6..d6e8917 100644
--- a/package.json
+++ b/package.json
@@ -11,7 +11,8 @@
     "start": "next start",
     "lint": "eslint",
     "test:e2e": "playwright test",
-    "test:e2e:report": "playwright show-report"
+    "test:e2e:report": "playwright show-report",
+    "test:e2e:secret-gate": "node scripts/check-secret-leak.mjs"
   },
   "dependencies": {
     "convex": "^1.42.1",
```

---

## `.github/workflows/ci.yml`

Inyecta la credencial al job e2e y añade el paso del gate.

```diff
diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
index 7931371..98a0adc 100644
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -45,6 +45,17 @@ jobs:
           GOOGLE_CLIENT_SECRET: ${{ secrets.GOOGLE_CLIENT_SECRET }}
           GOOGLE_OAUTH_REDIRECT_URI: ${{ secrets.GOOGLE_OAUTH_REDIRECT_URI }}
           GOOGLE_LOGIN_SHARED_SECRET: ${{ secrets.GOOGLE_LOGIN_SHARED_SECRET }}
+          E2E_TEST_SUPPORT_KEY: ${{ secrets.E2E_TEST_SUPPORT_KEY }}
+
+      # MIS-286: demuestra que los specs con contraseñas efímeras no dejan el
+      # secreto en trazas, artefactos ni logs. `if: always()` a propósito — si
+      # el e2e falla, es justo cuando Playwright conserva artefactos, así que es
+      # cuando MÁS importa comprobar que no contienen secretos.
+      - name: Gate de fugas de secretos en artefactos
+        if: always()
+        run: npm run test:e2e:secret-gate
+        env:
+          NEXT_PUBLIC_CONVEX_URL: ${{ secrets.NEXT_PUBLIC_CONVEX_URL }}
 
       - uses: actions/upload-artifact@v4
         if: always()
```

---

## `.env.test.local.example`

Documenta la credencial (vacía).

```diff
diff --git a/.env.test.local.example b/.env.test.local.example
index 4a80388..0cbdbb0 100644
--- a/.env.test.local.example
+++ b/.env.test.local.example
@@ -7,3 +7,14 @@ E2E_CARLOS_PASSWORD=
 E2E_MARTA_EMAIL=mistumonso@gmail.com
 E2E_MARTA_PASSWORD=
 E2E_BASE_URL=http://localhost:3000
+
+# MIS-286: credencial del harness seguro de pruebas de recuperación de
+# contraseña. Debe COINCIDIR con la variable del mismo nombre en el deployment
+# de Convex de dev: `npx convex env set E2E_TEST_SUPPORT_KEY <valor>`.
+# Genera un valor de alta entropía, p. ej.:
+#   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
+# En PRODUCCIÓN esta variable NO debe existir: su ausencia deja inertes todas
+# las funciones de convex/testSupport.ts (fail-closed).
+# NOTA: la identidad de pruebas (reset@test.local) NO tiene contraseña fija —
+# se genera una nueva en cada ejecución y nunca se guarda aquí ni en el repo.
+E2E_TEST_SUPPORT_KEY=
```

---

## `.gitignore`

Ignora las salidas efímeras del gate.

```diff
diff --git a/.gitignore b/.gitignore
index 38cd63c..4eb7ea7 100644
--- a/.gitignore
+++ b/.gitignore
@@ -46,6 +46,12 @@ next-env.d.ts
 /test-results/
 /playwright-report/
 /playwright/.cache/
+
+# MIS-286: salidas efímeras del gate de fugas. El script las borra siempre,
+# pero si se interrumpe a mitad NO deben poder commitearse: los de la fase A
+# contienen el centinela a propósito.
+/test-results-gate-*/
+/gate-report*.json
 /e2e/.auth/
```

---

## `README.md`

Sección "Harness seguro de pruebas e2e (MIS-286)".

```diff
diff --git a/README.md b/README.md
index 6a26fb7..f00be65 100644
--- a/README.md
+++ b/README.md
@@ -83,6 +83,22 @@ Redirect URIs a registrar en Google Cloud Console (Authorized redirect URIs) —
 
 **Producción queda fuera de alcance de MIS-260**: el deployment de Convex de producción está pendiente de un fix aparte ya conocido (deploy manual olvidado varias veces) — la redirect URI de prod puede registrarse ya en Google Console (config estática, no cuesta nada tenerla lista), pero el código y los datos de producción no se tocan en este ticket.
 
+### Harness seguro de pruebas e2e (MIS-286)
+
+El flujo de recuperación de contraseña (MIS-285) manda un **código por email** y en BD solo guarda su hash, así que un test no puede leerlo por medios normales. `convex/testSupport.ts` abre la mínima puerta que lo permite, cerrada con **tres cerrojos independientes**:
+
+1. **Credencial de alta entropía** `E2E_TEST_SUPPORT_KEY`, comparada en tiempo constante y **fail-closed**. En producción esa variable **no existe**, así que todas esas funciones lanzan aunque el código esté desplegado.
+2. **Identidad dedicada** `reset@test.local`: las funciones rechazan cualquier otro email, así que el harness no puede tocar las cuentas de Carlos ni de Marta.
+3. **Secretos efímeros**: la contraseña de esa identidad **se genera en cada llamada** a `resetTestIdentity` y solo se devuelve al llamante ya autenticado. **No hay ninguna contraseña válida en el repositorio.**
+
+| Variable | Dónde |
+|---|---|
+| `E2E_TEST_SUPPORT_KEY` | Convex **dev** (`npx convex env set E2E_TEST_SUPPORT_KEY <valor>`), `.env.test.local` y GitHub Secrets. **Ausente en producción** (verificar con `npx convex env list --prod`) |
+
+**Gate de fugas** — `npm run test:e2e:secret-gate`. Las trazas de Playwright serializan los parámetros de las acciones y CI publica los artefactos 14 días, así que un `fill()` con una contraseña la dejaría como texto descargable. Los specs con secretos corren en el project `chromium-secrets` **sin trace, vídeo ni screenshots**, y el gate lo demuestra en dos fases: con la captura activada el centinela **debe** aparecer (control positivo: prueba que el escáner funciona), y con la política real **no debe** aparecer en ficheros, dentro de los `.zip` de trace ni en la salida del proceso. Corre en CI y también en local.
+
+> Una filtración de `E2E_TEST_SUPPORT_KEY` **exige rotarla de inmediato**: como el rol no autoriza nada (ver `convex/lib/authz.ts`), la identidad dedicada tiene acceso completo al CRM de dev igual que cualquier usuario.
+
 ## Despliegue (Railway)
 
 El repo incluye `railway.json` (build con Nixpacks, `npm run build` / `npm run start`). Railway detecta Node.js automáticamente a partir de `package.json`.
```

---

# Evidencia de ejecución (2026-08-10)

| Condición de la 5ª ronda | Resultado |
|---|---|
| Enrutado aislado de los dos projects del gate | ✅ `playwright.gate.config.ts`, `gate-trace` / `gate-secrets`, ambos con `testMatch: ["secret-sentinel.spec.ts"]` |
| Cada fase ejecuta el centinela; **0 tests ⇒ fallo** | ✅ el script exige `executed === 1` leyendo el reporte JSON de cada fase |
| Control positivo y negativo sobre artefactos reales, incl. ZIP | ✅ fase A: *"detectado en 1 artefacto(s); el escáner funciona"* · fase B: *"sin rastro en artefactos, traces ni salida del proceso"* |
| `npm run test:e2e` **no** ejecuta el fallo intencional | ✅ `npx playwright test --list` → **0** ocurrencias de `secret-sentinel` (31 tests en 9 ficheros) |
| `npm run test:e2e:secret-gate` en verde | ✅ *"Gate de fugas superado"* |
| TypeScript / ESLint | ✅ `tsc --noEmit` limpio; ESLint sin errores (1 warning preexistente en `Avatar.jsx`) |
| Tests del harness | ✅ 4/4 en verde, en dos ejecuciones consecutivas |

## Estado de la suite completa — declarado sin edulcorar

`npm run test:e2e` **NO** está en verde, ni antes ni después de este ticket:

- Los **4 tests de MIS-286 pasan** en ambas ejecuciones.
- La suite arroja **8 fallos preexistentes** en specs de Carlos y Marta (`full-flow`, `edge-cases`, `role-gating`), **ajenos a este ticket**.
- Verificado contra `main` limpio (`git stash`): main da **7-8 fallos** con los **mismos** specs — ya estaban rotos y además son flaky entre ejecuciones.
- Cuentas: 27 tests preexistentes (8 fallan, 19 pasan) + 4 nuevos = **23 passed / 8 failed**, exactamente lo observado.
- **MIS-286 no introduce ninguna regresión.** La suite global seguirá roja hasta que se traten esos fallos, que son deuda preexistente y merecen ticket propio.

## Pendiente de cableado (no es código)

- `E2E_TEST_SUPPORT_KEY` ya configurada en Convex **dev** y en `.env.test.local` (gitignored).
- Falta crearla como **GitHub Secret** para que el job `e2e` la reciba.
- **Debe permanecer AUSENTE en Convex producción** (gate de predeploy: `npx convex env list --prod`).

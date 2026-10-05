// MIS-319 — verificación funcional en DEV de cleanupExpiredSessions por lotes.
// Uso (desde la raíz del repo, con el código ya desplegado en dev):
//   node CODIGO/MIS-319-indice-expiresat-sessions/verify-session-cleanup.mjs
//
// Condiciones de ejecución (S5): cleanupExpiredSessions opera sobre TODA la
// tabla `sessions`, no solo sobre la identidad de prueba. Durante la prueba no
// debe correr la suite e2e, ni otra limpieza (el cron diario es a las 03:00
// UTC), ni nadie más debe usar la identidad reset@test.local.
//
// Conjunto controlado: SOLO las sesiones de la identidad dedicada del harness
// (reset@test.local), a través de las funciones de test ya existentes en
// convex/testSupport.ts (cerrojos: E2E_TEST_SUPPORT_KEY + identidad dedicada).
// La clave se lee de .env.test.local y nunca se imprime.
//
// Guard de entorno (M1), FAIL-CLOSED: antes de crear el cliente o mutar nada,
// exige evidencia POSITIVA de que el destino es el deployment de dev personal:
//   a) ninguna variable CONVEX_* en el entorno del proceso (p. ej. un
//      CONVEX_DEPLOY_KEY de prod olvidado redirigiría el CLI);
//   b) CONVEX_DEPLOYMENT de .env.local con la forma exacta `dev:<nombre>`;
//   c) NEXT_PUBLIC_CONVEX_URL con la forma https://<nombre>.<…>.convex.cloud;
//   d) el propio Convex, preguntado con `--deployment dev` (su dev personal),
//      devuelve como CONVEX_CLOUD_URL exactamente esa misma URL.
// Todas las llamadas al CLI usan `--deployment dev` explícito.
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const BATCH = 1000; // = SESSION_CLEANUP_BATCH en convex/auth.ts
const EXPIRED = BATCH + 1;
const EMAIL = "reset@test.local";
const POLL_MS = 2000;
const TIMEOUT_MS = 120000;
const CONCURRENCY = 20;

function readEnv(file) {
  const env = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    // Quita el comentario final que escribe el CLI de Convex (`# team: …`).
    env[m[1]] = m[2].replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

function convexCli(args) {
  const res = spawnSync("npx", ["convex", ...args, "--deployment", "dev"], { encoding: "utf8" });
  if (res.status !== 0) throw new Error(`convex ${args[0]} terminó con código ${res.status}: ${res.stderr.trim()}`);
  return res.stdout.trim().split("\n").pop();
}

// ---- Guard de entorno (M1): todo debe probarse; cualquier duda aborta. ----
function assertDevTarget() {
  const inherited = Object.keys(process.env).filter((k) => k.startsWith("CONVEX_"));
  if (inherited.length > 0) throw new Error(`hay variables ${inherited.join(", ")} en el entorno; ejecútalo sin ellas`);

  const local = readEnv(".env.local");
  const dep = /^dev:([a-z0-9]+(?:-[a-z0-9]+)+)$/.exec(local.CONVEX_DEPLOYMENT ?? "");
  if (!dep) throw new Error("CONVEX_DEPLOYMENT de .env.local no tiene la forma `dev:<nombre>`");
  const name = dep[1];

  const url = local.NEXT_PUBLIC_CONVEX_URL ?? "";
  let host;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") throw new Error();
    host = parsed.hostname;
  } catch {
    throw new Error("NEXT_PUBLIC_CONVEX_URL falta o no es una URL https válida");
  }
  if (host.split(".")[0] !== name || !host.endsWith(".convex.cloud")) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL no corresponde al deployment de dev de CONVEX_DEPLOYMENT");
  }

  const raw = convexCli(["run", "--inline-query", "return process.env.CONVEX_CLOUD_URL"]);
  let devUrl;
  try {
    devUrl = JSON.parse(raw);
  } catch {
    devUrl = raw;
  }
  if (devUrl !== url) throw new Error("Convex no confirma que NEXT_PUBLIC_CONVEX_URL sea el deployment de dev personal");

  return url;
}

async function main() {
  const url = assertDevTarget();
  console.log("0. destino confirmado: deployment de dev personal ✓");

  const serverKey = readEnv(".env.test.local").E2E_TEST_SUPPORT_KEY;
  if (!serverKey) throw new Error("falta E2E_TEST_SUPPORT_KEY en .env.test.local");

  const client = new ConvexHttpClient(url);
  const api = anyApi;
  const count = () => client.query(api.testSupport.countSessionsFor, { serverKey, email: EMAIL });
  const insert = (ttlMs) => client.mutation(api.testSupport.testInsertSession, { serverKey, email: EMAIL, ttlMs });
  const reset = () => client.mutation(api.testSupport.resetTestIdentity, { serverKey, email: EMAIL });

  async function pool(n, worker) {
    let next = 0;
    const run = async () => {
      while (next < n) {
        next++;
        await worker();
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, run));
  }

  // S4: a partir de aquí se muta; la limpieza final va en `finally` para que
  // ningún fallo deje sesiones de prueba. Si la limpieza también falla, se
  // informa, pero se conserva y propaga el error ORIGINAL.
  let original;
  try {
    // 1. Estado inicial controlado.
    await reset();
    const initial = await count();
    if (initial !== 0) throw new Error(`estado inicial no es 0 (es ${initial})`);
    console.log("1. estado inicial: 0 sesiones de la identidad dedicada ✓");

    // 2. Siembra: BATCH + 1 caducadas + 1 vigente.
    await pool(EXPIRED, () => insert(-60000));
    const { token: liveToken } = await insert(3600000);
    const seeded = await count();
    if (seeded !== EXPIRED + 1) throw new Error(`tras la siembra se esperaban ${EXPIRED + 1}, hay ${seeded}`);
    console.log(`2. sembradas ${EXPIRED} caducadas + 1 vigente = ${seeded} ✓`);

    // 3. Una única limpieza inicial (función interna → CLI contra dev).
    const firstBatch = Number(convexCli(["run", "auth:cleanupExpiredSessions"]));
    if (firstBatch !== BATCH) throw new Error(`el primer lote debía devolver ${BATCH} (lote lleno), devolvió ${firstBatch}`);
    console.log(`3. primera llamada devolvió ${firstBatch} (borradas en ESTE lote, no el total) ✓`);

    // 4. Espera acotada a que la continuación re-programada drene el resto.
    const deadline = Date.now() + TIMEOUT_MS;
    let remaining = await count();
    while (remaining !== 1 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      remaining = await count();
    }
    if (remaining !== 1) {
      throw new Error(`tras ${TIMEOUT_MS / 1000}s quedan ${remaining} sesiones (se esperaba 1): la continuación no drenó`);
    }
    console.log("4. la continuación se ejecutó: queda 1 sesión ✓");

    // 5. La superviviente es exactamente la vigente.
    const user = await client.query(api.auth.getSessionUser, { token: liveToken });
    if (!user) throw new Error("la sesión vigente ya no resuelve: se borró algo que no estaba caducado");
    console.log("5. la superviviente es la vigente (getSessionUser ≠ null) ✓");
  } catch (err) {
    original = err;
  } finally {
    // 6. Limpieza (siempre).
    try {
      await reset();
      const final = await count();
      if (final !== 0) throw new Error(`la limpieza final dejó ${final} sesiones`);
      console.log("6. limpieza final: 0 sesiones ✓");
    } catch (cleanupErr) {
      console.error(`AVISO: la limpieza final falló: ${cleanupErr.message}`);
      if (!original) original = cleanupErr;
    }
  }
  if (original) throw original;
  console.log("OK — MIS-319 verificado en dev");
}

main().catch((err) => {
  console.error(`FALLO: ${err.message}`);
  process.exit(1);
});

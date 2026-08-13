#!/usr/bin/env node
// MIS-295 — Ejecutor seguro de verificación de login: ENTRYPOINT.
//
// Cablea los adaptadores reales (Convex por HTTP, CLI de Convex por subproceso),
// gestiona señales con recuperación única y sanea toda salida para que ningún
// secreto (contraseña, AUTH_SERVER_KEY, token) aparezca en stdout/stderr/errores.
//
// Uso (desde la raíz del repo; secretos por STDIN, 2 líneas EXACTAS):
//   printf '%s\n%s\n' "$PASSWORD" "$AUTH_SERVER_KEY" | \
//     node index.mjs --prod --confirm prod [--mode prod|preview] [--email carlos@test.local]
//   printf '%s\n%s\n' "$PASSWORD" "$AUTH_SERVER_KEY" | \
//     node index.mjs --deployment <name> --confirm <name> --mode preview
//
// Códigos de salida: 0 ok · 2 preflight abortó (sin efecto) · 1 alguna prueba falló ·
// 130/143 recuperación OK tras SIGINT/SIGTERM · 3 recuperación fallida (intervención).

import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";

import {
  makeRunner,
  preflight,
  runVetoSequence,
  finalState,
  safeRecover,
  parseArgs,
  resolveTarget,
  AbortError,
  SequenceError,
} from "./core.mjs";

// --- Lectura de secretos por STDIN (2 líneas exactas) ------------------------
async function readSecrets() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8").replace(/\n$/, "");
  const lines = raw.split("\n");
  if (lines.length !== 2) {
    throw new AbortError("STDIN debe tener EXACTAMENTE 2 líneas: contraseña y AUTH_SERVER_KEY");
  }
  const [password, serverKey] = lines;
  if (!password || !serverKey) throw new AbortError("STDIN: la contraseña y AUTH_SERVER_KEY no pueden estar vacías");
  return { password, serverKey };
}

// --- Saneo de secretos en toda salida ----------------------------------------
export function makeSanitizer(secrets) {
  const values = secrets.filter((s) => typeof s === "string" && s.length > 0);
  return (str) => {
    let out = String(str);
    for (const v of values) out = out.split(v).join("***");
    return out;
  };
}

// --- Adaptador CLI (subproceso; sin secretos en argv) ------------------------
function makeCli() {
  return (args) =>
    new Promise((resolve) => {
      execFile(
        "npx",
        ["convex", ...args],
        { timeout: 120000, maxBuffer: 16 * 1024 * 1024 },
        (error, stdout, stderr) => {
          const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
          resolve({ code, stdout: stdout || "", stderr: stderr || "" });
        },
      );
    });
}

// --- Adaptadores Convex por HTTP (secretos en el cuerpo, nunca argv) ----------
function makeConvexAdapters(url) {
  const client = new ConvexHttpClient(url, { logger: false }); // logger silenciado
  const loginRef = makeFunctionReference("auth:loginWithPassword");
  const logoutRef = makeFunctionReference("auth:logout");
  return {
    login: (body) => client.action(loginRef, body),
    logout: ({ token }) => client.mutation(logoutRef, { token }),
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const secrets = await readSecrets();
  const sanitize = makeSanitizer([secrets.password, secrets.serverKey]);

  const cli = makeCli();
  const target = await resolveTarget(cli, opts);
  const convex = makeConvexAdapters(target.url);

  const cfg = {
    email: opts.email,
    password: secrets.password,
    serverKey: secrets.serverKey,
    confirm: opts.confirm,
  };
  const log = (m) => process.stderr.write(sanitize(m) + "\n");
  const deps = { login: convex.login, logout: convex.logout, cli, log };
  const runner = makeRunner();

  // Cierre único (evita que señal y flujo normal salgan dos veces).
  let exiting = false;
  const finish = (code) => {
    if (exiting) return;
    exiting = true;
    process.exit(code);
  };
  const printErr = (e) => process.stderr.write(sanitize(e && e.message ? e.message : String(e)) + "\n");

  // Handlers de señal: abortan, recuperan UNA vez y salen con semántica de interrupción.
  const onSignal = (code) => async () => {
    runner.abort();
    try {
      await runner.recoverOnce(() => safeRecover(deps, target, cfg));
      finish(code); // 130 (SIGINT) / 143 (SIGTERM): recuperación OK
    } catch (rerr) {
      printErr(rerr);
      finish(3); // recuperación fallida: exige intervención
    }
  };
  const sigint = onSignal(130);
  const sigterm = onSignal(143);
  const arm = () => {
    process.on("SIGINT", sigint);
    process.on("SIGTERM", sigterm);
  };
  const disarm = () => {
    process.removeListener("SIGINT", sigint);
    process.removeListener("SIGTERM", sigterm);
  };

  // Preflight: sin efectos. Un abort aquí no ha tocado nada → código 2.
  let initial;
  try {
    ({ initial } = await preflight(deps, target, cfg));
  } catch (pre) {
    printErr(pre);
    finish(2);
    return;
  }

  // A partir de aquí puede haber bloqueos: armamos recuperación ANTES del 1er fallo.
  arm();
  try {
    const report = await runVetoSequence(deps, target, cfg, runner);
    await finalState(deps, target, target.mode, initial);
    disarm(); // retira handlers antes de la salida normal (evita recuperación tardía)
    process.stdout.write(JSON.stringify({ ok: true, report }, null, 2) + "\n");
    finish(0);
  } catch (err) {
    // Si el aborto vino de una señal, el handler es dueño del cierre.
    if (runner.isAborted()) return;
    try {
      await runner.recoverOnce(() => safeRecover(deps, target, cfg));
    } catch (rerr) {
      printErr(rerr);
      disarm();
      finish(3);
      return;
    }
    disarm();
    printErr(err);
    // Prueba fallida u otro error tras recuperación correcta → 1.
    finish(err instanceof SequenceError ? 1 : 1);
  }
}

// Solo ejecuta el flujo cuando se invoca directamente (no al importarlo desde los
// tests, que solo necesitan `makeSanitizer`).
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch(() => {
    // Red de seguridad: nunca dejar escapar un error sin sanear.
    process.stderr.write("error no controlado\n");
    process.exit(1);
  });
}

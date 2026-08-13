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
  // Cierre único con VACIADO de buffers: process.exit inmediato tras un write puede
  // truncar la evidencia canalizada, así que salimos en el callback de escritura.
  let exiting = false;
  const guard = () => {
    if (exiting) return false;
    exiting = true;
    return true;
  };
  const hardExit = (code) => {
    if (guard()) process.exit(code);
  };
  const exitAfter = (stream, str, code) => {
    if (guard()) stream.write(str, () => process.exit(code));
  };

  // sanitize arranca como identidad hasta conocer los secretos; se reemplaza en cuanto
  // se leen. Los errores previos a esa lectura no contienen valores de secretos.
  let sanitize = (s) => String(s);
  const errText = (e) => sanitize(e && e.message ? e.message : String(e)) + "\n";

  // --- Arranque FAIL-CLOSED (M8): parseo, secretos, resolución y preflight. Nada
  // de esto muta el deployment; cualquier fallo aquí es un aborto seguro → código 2.
  let target, deps, cfg, runner, initial;
  try {
    const opts = parseArgs(process.argv.slice(2));
    const secrets = await readSecrets();
    sanitize = makeSanitizer([secrets.password, secrets.serverKey]);
    const cli = makeCli();
    target = await resolveTarget(cli, opts);
    const convex = makeConvexAdapters(target.url);
    cfg = { email: opts.email, password: secrets.password, serverKey: secrets.serverKey, confirm: opts.confirm };
    const log = (m) => process.stderr.write(sanitize(m) + "\n");
    deps = { login: convex.login, logout: convex.logout, cli, log };
    runner = makeRunner();
    ({ initial } = await preflight(deps, target, cfg));
  } catch (startErr) {
    exitAfter(process.stderr, errText(startErr), 2); // sin efectos en el deployment
    return;
  }

  // --- Handlers de señal: abortan, recuperan UNA vez y salen 130/143 (o 3 si falla).
  const onSignal = (code) => async () => {
    runner.abort();
    try {
      await runner.recoverOnce(() => safeRecover(deps, target, cfg));
      hardExit(code); // 130 (SIGINT) / 143 (SIGTERM): recuperación OK
    } catch (rerr) {
      exitAfter(process.stderr, errText(rerr), 3); // recuperación fallida
    }
  };
  const sigint = onSignal(130);
  const sigterm = onSignal(143);
  process.on("SIGINT", sigint);
  process.on("SIGTERM", sigterm);
  const disarm = () => {
    process.removeListener("SIGINT", sigint);
    process.removeListener("SIGTERM", sigterm);
  };

  try {
    const report = await runVetoSequence(deps, target, cfg, runner);
    await finalState(deps, target, target.mode, initial, runner);
    if (runner.isAborted()) return; // una señal llegó durante finalState: su handler cierra.
    disarm(); // retira handlers antes de la salida normal (evita recuperación tardía)
    exitAfter(process.stdout, JSON.stringify({ ok: true, report }, null, 2) + "\n", 0);
  } catch (err) {
    if (runner.isAborted()) return; // el handler de señal es dueño del cierre.
    try {
      await runner.recoverOnce(() => safeRecover(deps, target, cfg));
    } catch (rerr) {
      disarm();
      exitAfter(process.stderr, errText(rerr), 3);
      return;
    }
    disarm();
    // Prueba fallida (SequenceError) u otro error, ya con recuperación correcta → 1.
    exitAfter(process.stderr, errText(err), 1);
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

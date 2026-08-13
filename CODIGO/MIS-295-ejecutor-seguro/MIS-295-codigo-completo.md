# MIS-295 — Código completo del ejecutor seguro de verificación de login

> Documento único para auditoría de código. Contiene el contenido ÍNTEGRO de los
> ficheros de la entrega `CODIGO/MIS-295-ejecutor-seguro/`. Plan aprobado (GO): `PLANS/MIS-295-plan-ejecutor-seguro.md`.
>
> Verificado localmente: `node --test` → 23/23 pass · `eslint --no-ignore` → 0 problemas · `node --check` OK.
>
> Instalación tras el GO de código: copiar `core.mjs`, `index.mjs`, `core.test.mjs` a
> `scripts/login-verify/` (byte a byte) y añadir a package.json `"test:unit": "node --test scripts/login-verify/"`.

## Índice

1. `core.mjs` — lógica pura (DI): runner/recuperación (M3), preflight fail-closed (B1/M1/M2), secuencia 11-12, finalState (M4), safeRecover, readVetoState focalizada (M5), parseArgs/resolveTarget (B1).
2. `index.mjs` — entrypoint: adaptadores Convex HTTP + CLI, señales (130/143 vs 3), saneo de secretos, logout (M6).
3. `core.test.mjs` — 23 tests con adaptadores falsos.
4. `README.md` — uso, códigos de salida, propiedades de seguridad y límites.

---

## `CODIGO/MIS-295-ejecutor-seguro/core.mjs`

````js
// MIS-295 — Ejecutor seguro de verificación de login: NÚCLEO (lógica pura).
//
// Sin imports de Convex a propósito: toda la E/S entra por `deps` (adaptadores
// inyectados), de modo que este módulo se testea al 100% con dobles falsos
// (`core.test.mjs`) sin tocar red ni CLI. `index.mjs` cablea los adaptadores reales.
//
// Contrato de `deps`:
//   login({ email, password, serverKey, ipHint? }) -> resultado de auth:loginWithPassword
//   logout({ token })                              -> cierra la sesión (auth:logout)
//   cli(argv: string[])                            -> { code, stdout, stderr }
//   log(msg: string)                               -> traza de progreso (ya saneada)
//
// Contrato de `target`: { selectorArgs: string[], name: string, url?, mode: 'prod'|'preview' }
// Contrato de `cfg`:    { email, password, serverKey, confirm }

import { randomBytes } from "node:crypto";

export const DEFAULT_EMAIL = "carlos@test.local";

// Textos EXACTOS que devuelve convex/auth.ts:30-31. Clasificamos contra el valor
// real (no "LOCKED"): un cambio de copy allí debe reflejarse aquí (test lo fija).
export const LOCKED_ERROR = "Demasiados intentos, inténtalo de nuevo en unos minutos";
export const GENERIC_ERROR = "Email o contraseña incorrectos";

export class AbortError extends Error {} // preflight fail-closed: sin efectos
export class RecoveryError extends Error {} // la recuperación no pudo garantizar off
export class SequenceError extends Error {} // una aserción de prueba no se cumplió

// Clasifica el retorno del login SIN exponer el token. `extractToken` (privada,
// no exportada) es la ÚNICA vía que lee el token, y solo para alimentar logout.
export function classifyLogin(result) {
  if (result && result.success === true) return "success";
  if (result && result.success === false) {
    if (result.error === LOCKED_ERROR) return "locked";
    if (result.error === GENERIC_ERROR) return "generic";
  }
  return "other";
}
function extractToken(result) {
  return result && result.success === true ? result.token : null;
}

// --- Máquina de ejecución y recuperación (M3) --------------------------------
// runStep serializa las transiciones ORDINARIAS y las rechaza cuando aborted.
// recoverOnce es la vía EXCLUSIVA de recuperación: se puede ejecutar tras aborted,
// memoiza una única recoveryPromise, y espera a la transición en vuelo antes de
// recuperar (así el `set` en vuelo termina antes del `set off` → off gana).
export function makeRunner() {
  const state = { aborted: false, inFlight: null, recoveryPromise: null };

  async function runStep(fn) {
    if (state.aborted) throw new AbortError("abortado: no se inician nuevas transiciones");
    // Invariante de serialización (sugerencia Baja): nunca dos transiciones a la vez.
    if (state.inFlight) throw new Error("invariante: ya hay una transición en vuelo");
    const p = Promise.resolve().then(fn);
    state.inFlight = p;
    try {
      return await p;
    } finally {
      state.inFlight = null;
    }
  }

  function abort() {
    state.aborted = true;
  }

  // recoverFn NO pasa por runStep (vía privilegiada): puede correr tras aborted.
  function recoverOnce(recoverFn) {
    if (!state.recoveryPromise) {
      state.recoveryPromise = (async () => {
        if (state.inFlight) {
          try {
            await state.inFlight;
          } catch {
            // La transición en vuelo pudo fallar; da igual: solo necesitamos que
            // haya TERMINADO para que la recuperación escriba después.
          }
        }
        return recoverFn();
      })();
    }
    return state.recoveryPromise;
  }

  return {
    runStep,
    abort,
    recoverOnce,
    isAborted: () => state.aborted,
    hasInFlight: () => state.inFlight !== null,
  };
}

// --- Adaptadores CLI de alto nivel -------------------------------------------
function envArgs(target, rest) {
  return ["env", ...rest, ...target.selectorArgs];
}
async function setVeto(deps, target, value) {
  const r = await deps.cli(envArgs(target, ["set", "LOGIN_EMAIL_VETO", value]));
  if (r.code !== 0) throw new Error("env set LOGIN_EMAIL_VETO falló");
  return r;
}
async function removeVeto(deps, target) {
  const r = await deps.cli(envArgs(target, ["remove", "LOGIN_EMAIL_VETO"]));
  if (r.code !== 0) throw new Error("env remove LOGIN_EMAIL_VETO falló");
  return r;
}

// Lectura FOCALIZADA (M5): primero solo NOMBRES (--names-only), y únicamente si
// LOGIN_EMAIL_VETO está presente pedimos su valor. Jamás capturamos el valor de
// otras variables del deployment. exit≠0 → indeterminado.
export async function readVetoState(deps, target) {
  const names = await deps.cli(envArgs(target, ["list", "--names-only"]));
  if (names.code !== 0) return { indeterminate: true };
  const present = names.stdout
    .split("\n")
    .map((s) => s.trim())
    .includes("LOGIN_EMAIL_VETO");
  if (!present) return { present: false, value: null }; // ausente ⇒ activo por defecto
  const got = await deps.cli(envArgs(target, ["get", "LOGIN_EMAIL_VETO"]));
  if (got.code !== 0) return { indeterminate: true };
  return { present: true, value: got.stdout.trim() };
}

// El veto está ACTIVO si la variable está ausente, o su valor no es "off".
export function vetoActive(state) {
  if (state.indeterminate) return null;
  if (!state.present) return true;
  return state.value !== "off";
}

async function checkGate(deps, target) {
  const r = await deps.cli(["run", "auth:accountsPendingRotation", ...target.selectorArgs]);
  if (r.code !== 0) throw new AbortError("gate indeterminado (CLI falló)");
  let parsed;
  try {
    parsed = JSON.parse(r.stdout);
  } catch {
    throw new AbortError("gate no es JSON válido");
  }
  if (!Array.isArray(parsed) || parsed.length !== 0) {
    throw new AbortError("gate no vacío: hay cuentas pendientes de rotación");
  }
}

async function baselineLogin(deps, cfg) {
  const r = await deps.login({ email: cfg.email, password: cfg.password, serverKey: cfg.serverKey });
  const token = extractToken(r);
  return { klass: classifyLogin(r), token };
}

// Cierra una sesión creada por un login correcto, sin exponer el token. Best-effort:
// un fallo de logout no invalida la prueba (la sesión caducará), pero se intenta.
async function closeSession(deps, token) {
  if (!token) return;
  try {
    await deps.logout({ token });
  } catch {
    // no-op: sesión huérfana tolerada; nunca imprimimos el token.
  }
}

// --- Preflight fail-closed (B1/M1/M2) ----------------------------------------
// SIN efectos de configuración. Aborta (AbortError) ante cualquier fallo o estado
// indeterminado ANTES de que se arme la recuperación o se toque el veto.
export async function preflight(deps, target, cfg) {
  // (2) Confirmación de prod ligada al deployment resuelto.
  if (target.requireConfirm && cfg.confirm !== target.confirmToken) {
    throw new AbortError(
      `confirmación requerida: pasa --confirm ${target.confirmToken} para operar sobre este deployment`,
    );
  }
  // (3) Gate.
  await checkGate(deps, target);
  // (4) Estado inicial: el veto DEBE estar activo (la prueba "ANTES" lo exige).
  const initial = await readVetoState(deps, target);
  const active = vetoActive(initial);
  if (active === null) throw new AbortError("estado del veto indeterminado");
  if (!active) throw new AbortError("el veto ya está en off: no se puede ejecutar la prueba ANTES");
  // (5) Login base correcto: prueba credenciales, canal HTTP y el login de limpieza
  // que la recuperación necesita. Cierra la sesión que crea.
  const base = await baselineLogin(deps, cfg);
  if (base.klass !== "success") {
    throw new AbortError("el login base no tuvo éxito: credenciales o canal inválidos");
  }
  await closeSession(deps, base.token);
  return { initial };
}

// Genera una contraseña incorrecta aleatoria, garantizada distinta de la correcta.
function wrongPassword(correct) {
  let candidate;
  do {
    candidate = "x!" + randomBytes(12).toString("base64url");
  } while (candidate === correct);
  return candidate;
}

async function loginCorrect(deps, cfg) {
  return await deps.login({ email: cfg.email, password: cfg.password, serverKey: cfg.serverKey });
}
async function loginWrong(deps, cfg) {
  return await deps.login({ email: cfg.email, password: wrongPassword(cfg.password), serverKey: cfg.serverKey });
}

// Genera el bloqueo por email: 5 fallos consecutivos (sin ipHint → aísla la clave
// de email de la cuota por IP). Cada intento es una transición ordinaria.
async function generateLock(deps, cfg, runner) {
  for (let i = 0; i < 5; i++) {
    await runner.runStep(() => loginWrong(deps, cfg));
  }
}

function expect(cond, msg) {
  if (!cond) throw new SequenceError(msg);
}

// --- Secuencia de verificación (pruebas 11-12) -------------------------------
export async function runVetoSequence(deps, target, cfg, runner) {
  const report = [];
  const record = (paso, esperado, obtenido) => {
    const ok = esperado === obtenido;
    report.push({ paso, esperado, obtenido, ok });
    return ok;
  };

  // Paso 1 — ANTES (veto on): 5 fallos + correcto → locked.
  await generateLock(deps, cfg, runner);
  const r1 = await runner.runStep(() => loginCorrect(deps, cfg));
  expect(record("11-ANTES", "locked", classifyLogin(r1)), "prueba 11 ANTES: se esperaba locked");

  // Paso 2 — retirar el veto.
  await runner.runStep(() => setVeto(deps, target, "off"));
  expect(vetoActive(await readVetoState(deps, target)) === false, "paso 2: el veto no quedó off");

  // Paso 3 — DESPUÉS (veto off): correcto → success (y cierra su sesión).
  const r3 = await runner.runStep(() => loginCorrect(deps, cfg));
  expect(record("11-DESPUES", "success", classifyLogin(r3)), "prueba 11 DESPUES: se esperaba success");
  await closeSession(deps, extractToken(r3));

  // Paso 4 — rollback: reactivar + REGENERAR bloqueo + correcto → locked.
  await runner.runStep(() => setVeto(deps, target, "activo"));
  expect(vetoActive(await readVetoState(deps, target)) === true, "paso 4: el veto no volvió a activo");
  await generateLock(deps, cfg, runner);
  const r4 = await runner.runStep(() => loginCorrect(deps, cfg));
  expect(record("12-ROLLBACK", "locked", classifyLogin(r4)), "prueba 12 ROLLBACK: se esperaba locked");

  // Paso 5 — estado final off + correcto → success (limpia contadores).
  await runner.runStep(() => setVeto(deps, target, "off"));
  expect(vetoActive(await readVetoState(deps, target)) === false, "paso 5: el veto no quedó off");
  const r5 = await runner.runStep(() => loginCorrect(deps, cfg));
  expect(record("FINAL", "success", classifyLogin(r5)), "paso 5: login final sin éxito");
  await closeSession(deps, extractToken(r5));

  return report;
}

// Estado final por modo (M4). prod/MIS-291: dejar off (la secuencia ya terminó en
// off). preview desechable: restaurar EXACTAMENTE el estado inicial capturado.
export async function finalState(deps, target, mode, initial) {
  if (mode !== "preview") return; // prod: off es el estado deseado; no-op.
  if (!initial.present) {
    await removeVeto(deps, target); // estaba ausente ⇒ quitar la variable
  } else {
    await setVeto(deps, target, initial.value); // reponer el valor explícito
  }
}

// Recuperación segura: deja off, lo VERIFICA, hace un login de limpieza y cierra
// su sesión. Si algo no cuadra → RecoveryError (no enmascara). Vía privilegiada:
// se invoca desde recoverOnce, no desde runStep.
export async function safeRecover(deps, target, cfg) {
  await setVeto(deps, target, "off");
  const st = await readVetoState(deps, target);
  if (vetoActive(st) !== false) throw new RecoveryError("el veto no quedó en off tras recuperar");
  const base = await baselineLogin(deps, cfg);
  if (base.klass !== "success") throw new RecoveryError("el login de limpieza falló al recuperar");
  await closeSession(deps, base.token);
}

// --- Parseo de argumentos y resolución de destino (autoridad única, B1) ------
// parseArgs es puro; resolveTarget solo usa el adaptador `cli` inyectado. Ambos
// viven aquí (no en index) para poder testear B1 sin ejecutar el entrypoint.
export function parseArgs(argv) {
  const opts = { selector: null, name: null, confirm: null, mode: "prod", email: DEFAULT_EMAIL };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--prod") {
      opts.selector = ["--prod"];
      opts.name = "prod";
    } else if (a === "--deployment") {
      const name = argv[++i];
      if (!name) throw new AbortError("--deployment requiere un nombre");
      opts.selector = ["--deployment", name];
      opts.name = name;
    } else if (a === "--confirm") {
      opts.confirm = argv[++i] ?? null;
    } else if (a === "--mode") {
      opts.mode = argv[++i] ?? "prod";
    } else if (a === "--email") {
      opts.email = argv[++i] ?? DEFAULT_EMAIL;
    } else {
      throw new AbortError(`argumento no reconocido: ${a}`);
    }
  }
  if (!opts.selector) throw new AbortError("falta el destino: usa --prod o --deployment <name>");
  if (opts.mode !== "prod" && opts.mode !== "preview") {
    throw new AbortError("--mode debe ser 'prod' o 'preview'");
  }
  return opts;
}

// La URL HTTP se obtiene con el MISMO selector que usa el CLI (CONVEX_CLOUD_URL del
// propio deployment): imposible que HTTP y CLI apunten a destinos distintos. El
// nombre para --confirm sale del selector, nunca de parsear la URL.
export async function resolveTarget(cli, opts) {
  const r = await cli(["env", "get", "CONVEX_CLOUD_URL", ...opts.selector]);
  if (r.code !== 0 || !r.stdout.trim()) {
    throw new AbortError("no se pudo resolver la URL del deployment (CONVEX_CLOUD_URL)");
  }
  return {
    selectorArgs: opts.selector,
    name: opts.name,
    url: r.stdout.trim(),
    mode: opts.mode,
    requireConfirm: opts.mode === "prod",
    confirmToken: opts.name,
  };
}
````

---

## `CODIGO/MIS-295-ejecutor-seguro/index.mjs`

````js
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
    // Prueba fallida (SequenceError) u otro error, ya con recuperación correcta → 1.
    finish(1);
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
````

---

## `CODIGO/MIS-295-ejecutor-seguro/core.test.mjs`

````js
// MIS-295 — Tests unitarios del ejecutor seguro (node:test + node:assert).
// Ejecutar: node --test  (desde este directorio o vía "npm run test:unit").
//
// Todo con adaptadores FALSOS: no toca red ni CLI reales. Cada test fija una de
// las invariantes exigidas por la auditoría del plan (B1, M1-M6, sin secretos).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  LOCKED_ERROR,
  GENERIC_ERROR,
  classifyLogin,
  makeRunner,
  readVetoState,
  vetoActive,
  preflight,
  runVetoSequence,
  finalState,
  safeRecover,
  parseArgs,
  resolveTarget,
  AbortError,
  RecoveryError,
  SequenceError,
} from "./core.mjs";
import { makeSanitizer } from "./index.mjs";

// --- Deployment falso (modela veto por email + rate-limit de forma suficiente) --
function makeFake(o = {}) {
  const correct = o.correct ?? "CORRECT-PW";
  const serverKey = o.serverKey ?? "SRV-KEY";
  const token = o.token ?? "TOKEN-SENTINEL-xyz";
  const url = o.url ?? "https://fake-dep.eu-west-1.convex.cloud";
  const st = {
    veto: o.veto, // undefined (ausente) | "off" | "activo" | ...
    gate: o.gate === undefined ? "[]" : o.gate, // string JSON, o null para forzar fallo de CLI
    listFails: o.listFails ?? false,
    emailLocked: false,
    wrongStreak: 0,
    otherSecretRequested: false,
    setCalls: [],
    removed: false,
    logins: [],
    logouts: [],
    cliCalls: [],
  };
  const active = () => st.veto === undefined || st.veto !== "off";
  const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
  const fail = () => ({ code: 1, stdout: "", stderr: "boom" });

  const cli = async (args) => {
    st.cliCalls.push(args.join(" "));
    const [cmd, sub, name, value] = args;
    if (cmd === "run") return st.gate === null ? fail() : ok(st.gate);
    if (cmd === "env" && sub === "get" && name === "CONVEX_CLOUD_URL") return ok(url);
    if (cmd === "env" && sub === "get" && name === "LOGIN_EMAIL_VETO") {
      return st.veto === undefined ? fail() : ok(st.veto);
    }
    if (cmd === "env" && sub === "get" && name === "OTRA_CLAVE") {
      st.otherSecretRequested = true; // el ejecutor NUNCA debería llegar aquí
      return ok("secreto-ajeno-que-no-debe-leerse");
    }
    if (cmd === "env" && sub === "list") {
      if (st.listFails) return fail();
      const names = ["AUTH_SERVER_KEY", "OTRA_CLAVE"];
      if (st.veto !== undefined) names.push("LOGIN_EMAIL_VETO");
      return ok(names.join("\n") + "\n");
    }
    if (cmd === "env" && sub === "set" && name === "LOGIN_EMAIL_VETO") {
      st.veto = value;
      st.setCalls.push(value);
      return ok();
    }
    if (cmd === "env" && sub === "remove" && name === "LOGIN_EMAIL_VETO") {
      st.veto = undefined;
      st.removed = true;
      return ok();
    }
    return ok();
  };

  const login = async ({ password, serverKey: sk }) => {
    st.logins.push(password === correct ? "CORRECT" : "WRONG");
    if (sk !== serverKey) return { success: false, error: GENERIC_ERROR };
    if (active() && st.emailLocked) return { success: false, error: LOCKED_ERROR };
    if (password !== correct) {
      if (active()) {
        st.wrongStreak++;
        if (st.wrongStreak >= 5) st.emailLocked = true;
      }
      return { success: false, error: GENERIC_ERROR };
    }
    st.wrongStreak = 0;
    st.emailLocked = false;
    return { success: true, token, role: "rep" };
  };
  const logout = async ({ token: t }) => {
    st.logouts.push(t);
  };

  const deps = { login, logout, cli, log: () => {} };
  const cfg = { email: "carlos@test.local", password: correct, serverKey, confirm: "prod" };
  const target = {
    selectorArgs: ["--prod"],
    name: "prod",
    url,
    mode: "prod",
    requireConfirm: true,
    confirmToken: "prod",
  };
  return { st, deps, cfg, target, token };
}

async function runFullOk(f) {
  const { initial } = await preflight(f.deps, f.target, f.cfg);
  const runner = makeRunner();
  const report = await runVetoSequence(f.deps, f.target, f.cfg, runner);
  await finalState(f.deps, f.target, "prod", initial);
  return report;
}

// --- classifyLogin -----------------------------------------------------------
test("classifyLogin usa los textos reales y no expone el token", () => {
  assert.equal(classifyLogin({ success: true, token: "T", role: "rep" }), "success");
  assert.equal(classifyLogin({ success: false, error: LOCKED_ERROR }), "locked");
  assert.equal(classifyLogin({ success: false, error: GENERIC_ERROR }), "generic");
  assert.equal(classifyLogin({ success: false, error: "otra cosa" }), "other");
  assert.ok(!classifyLogin({ success: true, token: "T" }).includes("T"));
});

// --- readVetoState (M5: lectura focalizada) ----------------------------------
test("readVetoState distingue ausente/off/valor/indeterminado", async () => {
  assert.deepEqual(await readVetoState(makeFake({ veto: undefined }).deps, makeFake().target), {
    present: false,
    value: null,
  });
  const off = makeFake({ veto: "off" });
  assert.equal((await readVetoState(off.deps, off.target)).value, "off");
  const act = makeFake({ veto: "activo" });
  assert.equal((await readVetoState(act.deps, act.target)).value, "activo");
  const bad = makeFake({ veto: "activo", listFails: true });
  assert.equal((await readVetoState(bad.deps, bad.target)).indeterminate, true);
});

test("M5: nunca solicita el valor de una variable ajena", async () => {
  const f = makeFake({ veto: "activo" });
  await runFullOk(f);
  assert.equal(f.st.otherSecretRequested, false);
  assert.ok(!f.st.cliCalls.some((c) => c.includes("get OTRA_CLAVE")));
});

// --- preflight fail-closed (B1/M1/M2) ----------------------------------------
test("preflight OK: sin efectos de config y cierra la sesión base (M6)", async () => {
  const f = makeFake({ veto: "activo" });
  const { initial } = await preflight(f.deps, f.target, f.cfg);
  assert.equal(initial.present, true);
  assert.equal(initial.value, "activo");
  assert.deepEqual(f.st.setCalls, []);
  assert.equal(f.st.logouts.length, 1);
  assert.equal(f.st.logouts[0], f.token);
});

test("preflight aborta si el gate no está vacío y NO toca env", async () => {
  const f = makeFake({ veto: "activo", gate: '[{"id":"u1","email":"a@b.c"}]' });
  await assert.rejects(() => preflight(f.deps, f.target, f.cfg), AbortError);
  assert.deepEqual(f.st.setCalls, []);
});

test("preflight aborta ante gate con JSON malformado o CLI fallida", async () => {
  const bad = makeFake({ veto: "activo", gate: "no-es-json" });
  await assert.rejects(() => preflight(bad.deps, bad.target, bad.cfg), AbortError);
  const err = makeFake({ veto: "activo", gate: null });
  await assert.rejects(() => preflight(err.deps, err.target, err.cfg), AbortError);
});

test("M1: preflight aborta si el veto ya está en off", async () => {
  const f = makeFake({ veto: "off" });
  await assert.rejects(() => preflight(f.deps, f.target, f.cfg), AbortError);
  assert.deepEqual(f.st.setCalls, []);
});

test("M2: login base fallido aborta sin crear bloqueo", async () => {
  const f = makeFake({ veto: "activo" });
  f.cfg.serverKey = "SERVERKEY-INCORRECTO";
  await assert.rejects(() => preflight(f.deps, f.target, f.cfg), AbortError);
  assert.equal(f.st.emailLocked, false);
  assert.deepEqual(f.st.setCalls, []);
});

test("preflight aborta si falta la confirmación de prod", async () => {
  const f = makeFake({ veto: "activo" });
  f.cfg.confirm = "otra-cosa";
  await assert.rejects(() => preflight(f.deps, f.target, f.cfg), AbortError);
});

// --- Secuencia 11-12 ---------------------------------------------------------
test("secuencia completa: todas las aserciones OK y veto final off", async () => {
  const f = makeFake({ veto: "activo" });
  const { initial } = await preflight(f.deps, f.target, f.cfg);
  const runner = makeRunner();
  const report = await runVetoSequence(f.deps, f.target, f.cfg, runner);
  assert.ok(report.every((r) => r.ok), JSON.stringify(report));
  assert.equal(vetoActive(await readVetoState(f.deps, f.target)), false);
  await finalState(f.deps, f.target, "prod", initial);
  assert.equal(f.st.veto, "off");
});

test("M6: cierra todas las sesiones y la evidencia no contiene el token", async () => {
  const f = makeFake({ veto: "activo" });
  const report = await runFullOk(f);
  assert.equal(f.st.logouts.length, 3); // base + paso 3 + paso 5
  for (const t of f.st.logouts) assert.equal(t, f.token);
  assert.ok(!JSON.stringify(report).includes(f.token));
});

test("una aserción incumplida lanza SequenceError", async () => {
  const f = makeFake({ veto: "activo" });
  const alwaysOk = { ...f.deps, login: async () => ({ success: true, token: "T", role: "rep" }) };
  await assert.rejects(
    () => runVetoSequence(alwaysOk, f.target, f.cfg, makeRunner()),
    SequenceError,
  );
});

// --- Máquina de ejecución / recuperación (M3) --------------------------------
test("runStep rechaza nuevas transiciones tras abort", async () => {
  const runner = makeRunner();
  runner.abort();
  await assert.rejects(() => runner.runStep(async () => {}), AbortError);
});

test("runStep no permite dos transiciones simultáneas", async () => {
  const runner = makeRunner();
  let release;
  const gate = new Promise((r) => (release = r));
  const p1 = runner.runStep(async () => {
    await gate;
  });
  await assert.rejects(() => runner.runStep(async () => {}), /transición en vuelo/);
  release();
  await p1;
});

test("M3: recoverOnce espera la transición en vuelo y off gana; recuperación única", async () => {
  const order = [];
  let release;
  const inFlightGate = new Promise((r) => (release = r));
  const runner = makeRunner();

  // Transición ordinaria en vuelo (p. ej. `env set activo`), aún sin terminar.
  const p = runner.runStep(async () => {
    await inFlightGate;
    order.push("set:activo");
  });

  // Llega la señal: abort + recuperación.
  runner.abort();
  let recoveries = 0;
  const rec = runner.recoverOnce(async () => {
    recoveries++;
    order.push("recover:off");
  });
  // Una segunda señal durante la recuperación devuelve la MISMA promesa.
  const rec2 = runner.recoverOnce(async () => {
    recoveries++;
    order.push("NO-DEBE-EJECUTARSE");
  });
  assert.equal(rec, rec2);

  // Solo ahora termina la transición en vuelo.
  release();
  await p;
  await rec;

  assert.deepEqual(order, ["set:activo", "recover:off"]); // off DESPUÉS del set en vuelo
  assert.equal(recoveries, 1);
});

// --- safeRecover -------------------------------------------------------------
test("safeRecover deja off, lo verifica y cierra su sesión", async () => {
  const f = makeFake({ veto: "activo" });
  await safeRecover(f.deps, f.target, f.cfg);
  assert.equal(f.st.veto, "off");
  assert.ok(f.st.logouts.length >= 1);
});

test("safeRecover lanza RecoveryError si el veto no queda en off", async () => {
  const f = makeFake({ veto: "activo" });
  const broken = {
    ...f.deps,
    cli: async (args) => {
      if (args[0] === "env" && args[1] === "set") return { code: 0, stdout: "", stderr: "" }; // finge OK sin cambiar
      return f.deps.cli(args);
    },
  };
  await assert.rejects(() => safeRecover(broken, f.target, f.cfg), RecoveryError);
});

// --- finalState por modo (M4) ------------------------------------------------
test("M4: preview con veto inicialmente ausente → env remove", async () => {
  const f = makeFake({ veto: "off" }); // la secuencia lo dejó en off
  await finalState(f.deps, f.target, "preview", { present: false, value: null });
  assert.equal(f.st.removed, true);
  assert.equal(f.st.veto, undefined);
});

test("M4: preview con valor explícito → lo repone", async () => {
  const f = makeFake({ veto: "off" });
  await finalState(f.deps, f.target, "preview", { present: true, value: "activo" });
  assert.equal(f.st.veto, "activo");
});

test("M4: prod → finalState no toca nada (deja off)", async () => {
  const f = makeFake({ veto: "off" });
  await finalState(f.deps, f.target, "prod", { present: true, value: "activo" });
  assert.equal(f.st.veto, "off");
  assert.equal(f.st.setCalls.length, 0);
});

// --- Autoridad única de deployment (B1) --------------------------------------
test("parseArgs: --prod y --deployment", () => {
  const a = parseArgs(["--prod", "--confirm", "prod"]);
  assert.deepEqual(a.selector, ["--prod"]);
  assert.equal(a.name, "prod");
  const b = parseArgs(["--deployment", "greedy-tapir-20", "--mode", "preview"]);
  assert.deepEqual(b.selector, ["--deployment", "greedy-tapir-20"]);
  assert.equal(b.name, "greedy-tapir-20");
  assert.equal(b.mode, "preview");
  assert.throws(() => parseArgs([]), AbortError);
});

test("B1: resolveTarget deriva la URL del MISMO selector, sin URL suelta", async () => {
  const calls = [];
  const cli = async (args) => {
    calls.push(args);
    return { code: 0, stdout: "https://greedy-tapir-20.eu-west-1.convex.cloud\n", stderr: "" };
  };
  const t = await resolveTarget(cli, {
    selector: ["--deployment", "greedy-tapir-20"],
    name: "greedy-tapir-20",
    mode: "prod",
  });
  assert.equal(t.url, "https://greedy-tapir-20.eu-west-1.convex.cloud");
  assert.deepEqual(t.selectorArgs, ["--deployment", "greedy-tapir-20"]);
  assert.deepEqual(calls[0], ["env", "get", "CONVEX_CLOUD_URL", "--deployment", "greedy-tapir-20"]);
  // No hay parámetro para inyectar una URL ajena: la firma es (cli, opts).
  assert.equal(resolveTarget.length, 2);
});

// --- Saneo de secretos -------------------------------------------------------
test("makeSanitizer redacta contraseña y serverKey en cualquier salida", () => {
  const s = makeSanitizer(["P@ss-w0rd", "SRV-KEY-123"]);
  const out = s("error: usó P@ss-w0rd con SRV-KEY-123 al llamar");
  assert.ok(!out.includes("P@ss-w0rd"));
  assert.ok(!out.includes("SRV-KEY-123"));
  assert.ok(out.includes("***"));
});
````

---

## `CODIGO/MIS-295-ejecutor-seguro/README.md`

````markdown
# MIS-295 — Ejecutor seguro de verificación de login

Herramienta de operaciones que corre las **pruebas 11-12** de MIS-291 (retirada del
veto por email) contra un deployment de Convex, con secretos fuera de `argv`,
preflight fail-closed, y recuperación verificada ante excepción y señales.

## Ficheros

- `core.mjs` — lógica pura (sin imports de Convex); toda la E/S entra por adaptadores
  inyectados. Es lo que testean los unitarios.
- `index.mjs` — entrypoint: cablea Convex por HTTP (`ConvexHttpClient`) y el CLI de
  Convex por subproceso, gestiona señales y sanea la salida.
- `core.test.mjs` — tests unitarios (`node:test`) con adaptadores falsos.

Instalación (la hace MIS-295 tras el GO de código): copiar los tres a
`scripts/login-verify/` **byte a byte**, y añadir a `package.json`:
`"test:unit": "node --test scripts/login-verify/"`.

## Uso

Desde la raíz del repo. Los secretos entran por **STDIN, exactamente 2 líneas**:
línea 1 = contraseña de `carlos@test.local`; línea 2 = `AUTH_SERVER_KEY` del
deployment. Nunca se pasan por `argv` ni se escriben a disco.

```sh
# Producción (MIS-291): exige --confirm prod
printf '%s\n%s\n' "$PASSWORD" "$AUTH_SERVER_KEY" | \
  node scripts/login-verify/index.mjs --prod --confirm prod

# Deployment preview desechable (integración), restaura el estado inicial
printf '%s\n%s\n' "$PASSWORD" "$AUTH_SERVER_KEY" | \
  node scripts/login-verify/index.mjs --deployment <name> --mode preview
```

### Argumentos

- `--prod` | `--deployment <name>` — **destino único**. La URL HTTP se deriva del
  MISMO selector (`convex env get CONVEX_CLOUD_URL <selector>`): HTTP y CLI no pueden
  apuntar a deployments distintos.
- `--confirm <token>` — obligatorio en modo prod. Debe igualar el nombre del selector:
  `--confirm prod` con `--prod`, o `--confirm <name>` con `--deployment <name>`.
  (Con `--prod` el token es literalmente `prod`; el selector no contiene el nombre
  físico del deployment.)
- `--mode prod|preview` — por defecto `prod`. `prod` deja `LOGIN_EMAIL_VETO=off` (estado
  deseado de MIS-291). `preview` restaura exactamente el estado inicial.
- `--email <email>` — por defecto `carlos@test.local`.

## Códigos de salida

| Código | Significado |
|--------|-------------|
| `0`    | Todas las pruebas OK; estado final correcto. |
| `1`    | Alguna prueba (11/12) falló; recuperación aplicada. |
| `2`    | Preflight abortó (gate, veto ya off, login base, confirmación…): **sin efecto**. |
| `3`    | Recuperación fallida: **exige intervención manual** (`convex env set LOGIN_EMAIL_VETO off`). |
| `130`/`143` | Interrumpido por SIGINT/SIGTERM; recuperación aplicada (veto en off). |

## Propiedades de seguridad

- **Secretos fuera de argv:** contraseña y `AUTH_SERVER_KEY` viajan en el **cuerpo HTTP**
  (`loginWithPassword`/`logout`); el CLI solo recibe `off`/`activo` (no secretos).
- **Preflight fail-closed:** aborta sin efectos si el gate `accountsPendingRotation()` ≠ `[]`,
  si el veto no está activo, si la CLI es indeterminada, si falta la confirmación de prod, o
  si el login base no tiene éxito.
- **Lectura focalizada:** `env list --names-only` para presencia y, solo si aparece,
  `env get LOGIN_EMAIL_VETO`; nunca se captura el valor de otras variables del deployment.
- **Recuperación única y ordenada:** una `recoveryPromise` memoizada espera a la transición
  en vuelo antes de escribir `off`, así una señal a mitad de un `env set` no deja el veto activo.
- **Sin token en la salida:** el resultado se clasifica a `{success, error}`; el token solo
  circula en memoria para cerrar la sesión (`logout`). La salida se sanea contra los secretos.

## Límites documentados (no recuperables)

- **SIGKILL, corte de energía o pérdida persistente de red** no permiten completar la
  recuperación: pueden dejar el veto activo. Mitigación manual: `convex env set LOGIN_EMAIL_VETO off <selector>`.
- **Interrupción durante el preflight**, entre el login base y su `logout`, puede dejar una
  sesión no cerrada. No afecta a la configuración ni habilita acceso; caducará sola.
- En **modo preview**, una excepción durante la secuencia deja el veto en `off` (vía
  `safeRecover`) en lugar de restaurar el estado inicial de `finalState`. Aceptable por ser un
  deployment desechable.
````

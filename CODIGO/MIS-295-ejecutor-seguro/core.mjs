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
// La escritura pasa por runner.runStep para quedar registrada en inFlight (M3): así
// una señal durante la restauración hace que la recuperación la espere y off gane.
export async function finalState(deps, target, mode, initial, runner) {
  if (mode !== "preview") return; // prod: off es el estado deseado; no-op.
  const op = !initial.present
    ? () => removeVeto(deps, target) // estaba ausente ⇒ quitar la variable
    : () => setVeto(deps, target, initial.value); // reponer el valor explícito
  await runner.runStep(op);
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
  const opts = { selector: null, name: null, confirm: null, mode: null, email: null };
  const seen = new Set();
  const once = (flag) => {
    if (seen.has(flag)) throw new AbortError(`opción duplicada: ${flag}`);
    seen.add(flag);
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--prod" || a === "--deployment") {
      if (opts.selector) throw new AbortError("selector de destino duplicado: usa solo uno de --prod/--deployment");
    }
    if (a === "--prod") {
      opts.selector = ["--prod"];
      opts.name = "prod";
    } else if (a === "--deployment") {
      const name = argv[++i];
      if (!name) throw new AbortError("--deployment requiere un nombre");
      opts.selector = ["--deployment", name];
      opts.name = name;
    } else if (a === "--confirm") {
      once("--confirm");
      opts.confirm = argv[++i] ?? null;
    } else if (a === "--mode") {
      once("--mode");
      opts.mode = argv[++i] ?? null;
    } else if (a === "--email") {
      once("--email");
      opts.email = argv[++i] ?? null;
    } else {
      throw new AbortError(`argumento no reconocido: ${a}`);
    }
  }
  if (!opts.selector) throw new AbortError("falta el destino: usa --prod o --deployment <name>");
  const mode = opts.mode ?? "prod";
  if (mode !== "prod" && mode !== "preview") throw new AbortError("--mode debe ser 'prod' o 'preview'");
  // M7: --prod es SIEMPRE producción; preview exige un deployment nombrado y desechable.
  if (opts.selector[0] === "--prod" && mode === "preview") {
    throw new AbortError("--prod no admite --mode preview: usa --deployment <name> para preview");
  }
  // M7: el override de --email solo se permite en preview desechable; en prod se fija
  // la cuenta de test para no poder dirigir la operación contra una cuenta arbitraria.
  if (opts.email !== null && mode !== "preview") {
    throw new AbortError("--email solo se permite con --mode preview");
  }
  return {
    selector: opts.selector,
    name: opts.name,
    confirm: opts.confirm,
    mode,
    email: opts.email ?? DEFAULT_EMAIL,
  };
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
    // M7: confirmación SIEMPRE obligatoria (prod y preview), ligada al nombre del
    // selector. El nombre sale del selector, nunca de parsear la URL.
    requireConfirm: true,
    confirmToken: opts.name,
  };
}

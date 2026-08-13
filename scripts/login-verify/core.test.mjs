// MIS-295 — Tests unitarios del ejecutor seguro (node:test + node:assert).
// Ejecutar: node --test  (desde este directorio o vía "npm run test:unit").
//
// Todo con adaptadores FALSOS: no toca red ni CLI reales. Cada test fija una de
// las invariantes exigidas por la auditoría del plan (B1, M1-M6, sin secretos).

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

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
  await finalState(f.deps, f.target, "prod", initial, runner);
  return report;
}

const INDEX_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "index.mjs");
function runCli(args, stdin) {
  return new Promise((resolve) => {
    const child = execFile(process.execPath, [INDEX_PATH, ...args], () => {});
    child.on("close", (code) => resolve(code));
    if (stdin !== undefined) child.stdin.write(stdin);
    child.stdin.end();
  });
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

test("M5: usa --names-only y nunca solicita el valor de una variable ajena", async () => {
  const f = makeFake({ veto: "activo" });
  await runFullOk(f);
  assert.equal(f.st.otherSecretRequested, false);
  assert.ok(!f.st.cliCalls.some((c) => c.includes("get OTRA_CLAVE")));
  // La presencia se detecta con --names-only, no listando valores.
  assert.ok(f.st.cliCalls.some((c) => c.includes("env list --names-only")));
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
  await finalState(f.deps, f.target, "prod", initial, runner);
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
  await finalState(f.deps, f.target, "preview", { present: false, value: null }, makeRunner());
  assert.equal(f.st.removed, true);
  assert.equal(f.st.veto, undefined);
});

test("M4: preview con valor explícito → lo repone", async () => {
  const f = makeFake({ veto: "off" });
  await finalState(f.deps, f.target, "preview", { present: true, value: "activo" }, makeRunner());
  assert.equal(f.st.veto, "activo");
});

test("M4: prod → finalState no toca nada (deja off)", async () => {
  const f = makeFake({ veto: "off" });
  await finalState(f.deps, f.target, "prod", { present: true, value: "activo" }, makeRunner());
  assert.equal(f.st.veto, "off");
  assert.equal(f.st.setCalls.length, 0);
});

test("M3: finalState pasa por runStep; una señal durante la restauración → off gana", async () => {
  const f = makeFake({ veto: "off" });
  const order = [];
  let release;
  const gate = new Promise((r) => (release = r));
  // cli que retrasa la escritura de finalState (set/remove) para forzar la carrera.
  const slow = {
    ...f.deps,
    cli: async (args) => {
      if (args[0] === "env" && (args[1] === "set" || args[1] === "remove")) {
        await gate;
        order.push("finalState-write");
      }
      return f.deps.cli(args);
    },
  };
  const runner = makeRunner();
  const fp = finalState(slow, f.target, "preview", { present: true, value: "activo" }, runner);
  // Señal a mitad de la escritura de finalState: si NO estuviera en runStep, la
  // recuperación no la esperaría y el orden se invertiría.
  runner.abort();
  const rec = runner.recoverOnce(async () => order.push("recover-off"));
  release();
  await fp;
  await rec;
  assert.deepEqual(order, ["finalState-write", "recover-off"]);
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

test("M7: matriz selector/modo/email/duplicados", () => {
  assert.throws(() => parseArgs(["--prod", "--mode", "preview"]), AbortError); // --prod no admite preview
  assert.throws(() => parseArgs(["--prod", "--email", "x@y.z"]), AbortError); // --email solo en preview
  assert.throws(() => parseArgs(["--deployment", "d", "--email", "x@y.z"]), AbortError); // modo prod por defecto
  const ok = parseArgs(["--deployment", "prev-1", "--mode", "preview", "--email", "x@y.z"]);
  assert.equal(ok.email, "x@y.z"); // --email permitido en preview con --deployment
  assert.equal(parseArgs(["--prod"]).email, "carlos@test.local"); // email fijado en prod
  assert.throws(() => parseArgs(["--prod", "--deployment", "d"]), AbortError); // selector duplicado
  assert.throws(() => parseArgs(["--prod", "--confirm", "a", "--confirm", "b"]), AbortError); // opción duplicada
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
  // M7: confirmación SIEMPRE obligatoria, ligada al nombre del selector.
  assert.equal(t.requireConfirm, true);
  assert.equal(t.confirmToken, "greedy-tapir-20");
});

test("resolveTarget aborta (arranque → código 2) si no resuelve la URL", async () => {
  const cli = async () => ({ code: 1, stdout: "", stderr: "no such deployment" });
  await assert.rejects(
    () => resolveTarget(cli, { selector: ["--deployment", "inexistente"], name: "inexistente", mode: "prod" }),
    AbortError,
  );
});

// --- Saneo de secretos -------------------------------------------------------
test("makeSanitizer redacta contraseña, serverKey y token en cualquier salida", () => {
  const s = makeSanitizer(["P@ss-w0rd", "SRV-KEY-123", "TOKEN-SENTINEL-xyz"]);
  const out = s("error: usó P@ss-w0rd con SRV-KEY-123 y TOKEN-SENTINEL-xyz al llamar");
  assert.ok(!out.includes("P@ss-w0rd"));
  assert.ok(!out.includes("SRV-KEY-123"));
  assert.ok(!out.includes("TOKEN-SENTINEL-xyz"));
  assert.ok(out.includes("***"));
});

// --- Códigos de salida del arranque fail-closed (M8), vía subproceso real ------
test("M8: argumentos inválidos → código 2 (sin efectos)", async () => {
  assert.equal(await runCli(["--bogus"]), 2);
});

test("M8: --prod --mode preview → código 2", async () => {
  assert.equal(await runCli(["--prod", "--mode", "preview", "--confirm", "prod"]), 2);
});

test("M8: stdin inválido (una sola línea) → código 2", async () => {
  assert.equal(await runCli(["--prod", "--confirm", "prod"], "una-sola-linea\n"), 2);
});

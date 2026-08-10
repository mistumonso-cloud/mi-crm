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

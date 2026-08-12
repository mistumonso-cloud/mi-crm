#!/usr/bin/env node
// Calcula localmente el hash de una password para sembrar usuarios (MIS-7),
// sin que la password en claro pase nunca como argumento de CLI ni quede en
// el historial de shell — se lee por stdin, con entrada oculta (sin eco en
// pantalla). Mismo algoritmo/parámetros que convex/lib/password.ts, para que
// el resultado sea intercambiable con lo que produciría el propio Convex.
//
// Uso: node scripts/hash-password.mjs
// El string impreso se pega como "passwordHash" al invocar:
//   npx convex run auth:seedUser '{"name":"...","email":"...","passwordHash":"...","role":"rep"}'

import { createInterface } from "node:readline";
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ALGORITHM = "pbkdf2_sha256";
const VERSION = "v1";
const ITERATIONS = 600_000;
const SALT_LENGTH_BYTES = 16;
const KEY_LENGTH_BYTES = 32;

// MIS-290 (I6): política de contraseñas en el punto de fijación de alta. DEBE
// coincidir con convex/lib/passwordPolicy.ts. El corpus se lee del MISMO JSON
// versionado que usa Convex (data compartida). `normalizePassword` se DUPLICA
// aquí a propósito (este script es .mjs y no puede importar el .ts), documentada
// para mantenerse en sync — mismo criterio que los parámetros del KDF de arriba.
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;
const __dir = dirname(fileURLToPath(import.meta.url));
const CORPUS = new Set(
  JSON.parse(readFileSync(join(__dir, "../convex/lib/passwordCorpus.json"), "utf8")),
);
function normalizePassword(p) {
  const base = p.trim().toLowerCase();
  const stripped = base.replace(/[0-9]+$/, "");
  return stripped === "" ? base : stripped;
}
function isWeakPassword(p) {
  // Longitud mínima sobre el contenido efectivo (tras trim): rechaza solo-espacios
  // y relleno de espacios (M6). Debe coincidir con validatePassword en el .ts.
  if (p.trim().length < MIN_PASSWORD_LENGTH || p.length > MAX_PASSWORD_LENGTH) return true;
  return CORPUS.has(normalizePassword(p));
}

function readHiddenInput(promptText) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;

    // Patrón estándar de Node para prompts de contraseña (el mismo que usan
    // npm/otras CLIs): silenciar la salida mientras se escribe la respuesta.
    const originalWriteToOutput = rl._writeToOutput?.bind(rl);
    rl._writeToOutput = function (stringToWrite) {
      if (!muted && originalWriteToOutput) originalWriteToOutput(stringToWrite);
    };

    process.stdout.write(promptText);
    muted = true;
    rl.question("", (answer) => {
      muted = false;
      process.stdout.write("\n");
      rl.close();
      resolve(answer);
    });
  });
}

const password = await readHiddenInput("Password a hashear (no se mostrará en pantalla): ");

if (!password) {
  console.error("No se ha introducido ninguna password.");
  process.exit(1);
}

// MIS-290 (I6): rechazar contraseñas débiles ANTES de generar el hash, para que
// seedUser (que solo recibe el hash) no siembre nunca una cuenta con una
// contraseña que no cumple la política.
if (isWeakPassword(password)) {
  console.error(
    "\nLa contraseña no cumple la política: mínimo 8 caracteres y no puede ser una " +
      "contraseña común. No se ha generado ningún hash.",
  );
  process.exit(1);
}

const salt = randomBytes(SALT_LENGTH_BYTES);
const hash = pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH_BYTES, "sha256");
const encoded = `${ALGORITHM}$${VERSION}$i=${ITERATIONS}$${salt.toString("base64url")}$${hash.toString("base64url")}`;

console.log("\nHash generado (copia esto, no la password, como \"passwordHash\" de seedUser):\n");
console.log(encoded);

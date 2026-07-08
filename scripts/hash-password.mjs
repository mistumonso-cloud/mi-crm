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

const ALGORITHM = "pbkdf2_sha256";
const VERSION = "v1";
const ITERATIONS = 600_000;
const SALT_LENGTH_BYTES = 16;
const KEY_LENGTH_BYTES = 32;

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

const salt = randomBytes(SALT_LENGTH_BYTES);
const hash = pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH_BYTES, "sha256");
const encoded = `${ALGORITHM}$${VERSION}$i=${ITERATIONS}$${salt.toString("base64url")}$${hash.toString("base64url")}`;

console.log("\nHash generado (copia esto, no la password, como \"passwordHash\" de seedUser):\n");
console.log(encoded);

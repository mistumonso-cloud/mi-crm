// MIS-290 (1B.3, I6): política de contraseñas. Se aplica en TODOS los puntos que
// fijan una contraseña (resetPasswordWithTicket, scripts/hash-password.mjs vía
// seedUser, y testSupport.resetTestIdentity) — ninguno debe poder esquivarla.
//
// La lista de bloqueo (corpus) vive en passwordCorpus.json; procedencia,
// licencia e integridad en passwordCorpus.README.md. Se importa como módulo:
// esbuild lo empaqueta en el bundle de funciones de Convex (~85 KB), sin
// descargas en runtime.
import corpus from "./passwordCorpus.json";

const CORPUS: ReadonlySet<string> = new Set(corpus as string[]);

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

// Versión de la política con la que se fijó el hash actual. Se escribe en
// `users.passwordPolicyVersion` EN EL MISMO patch que `passwordHash`, nunca por
// separado y solo tras un {ok:true} de validatePassword (invariante de
// atomicidad). Subir esta constante vuelve a exigir rotación a todas las cuentas
// (ver accountsPendingRotation en convex/auth.ts). Por eso es una versión y no
// un booleano.
export const CURRENT_PASSWORD_POLICY_VERSION = 1;

// Normalización canónica antes de comparar contra el corpus. DEBE coincidir byte
// a byte con la usada al generar passwordCorpus.json (ver el README) y con la
// copia duplicada en scripts/hash-password.mjs (mismo criterio que los
// parámetros del KDF: se duplica a propósito porque el script es .mjs y no puede
// importar este .ts). Ejemplos:
//   "Password123" -> "password"    (minúsculas + quita dígitos finales)
//   "password1"   -> "password"
//   "PASSWORD"    -> "password"
//   "123456"      -> "123456"      (toda numérica: literal, no "")
//   "abc123def"   -> "abc123def"   (no termina en dígito)
export function normalizePassword(password: string): string {
  const base = password.trim().toLowerCase();
  const stripped = base.replace(/[0-9]+$/, "");
  return stripped === "" ? base : stripped;
}

export type PolicyResult = { ok: true } | { ok: false; error: string };

// Error único de política. Enumera los dos requisitos (longitud y no-común) sin
// revelar cuál falló: la política no es información sensible (es la contraseña
// del propio usuario), pero un mensaje único evita depender de detalles internos.
export const PASSWORD_POLICY_ERROR =
  "La contraseña debe tener al menos 8 caracteres y no puede ser una contraseña común.";

// Valida longitud y ausencia del corpus. Devuelve un resultado, no lanza — cada
// punto de fijación decide cómo propagar el error.
//
// La longitud MÍNIMA se mide sobre el contenido EFECTIVO (tras `trim`): así se
// rechazan las contraseñas de solo espacios ("        ") y las que, con relleno
// de espacios, dejarían menos de 8 caracteres reales (M6). Sin esto, 8 espacios
// pasarían: normalizePassword las convierte en "", que no está en el corpus. El
// MÁXIMO se mide sobre la longitud cruda, para acotar entradas enormes.
export function validatePassword(password: string): PolicyResult {
  if (password.trim().length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return { ok: false, error: PASSWORD_POLICY_ERROR };
  }
  if (CORPUS.has(normalizePassword(password))) {
    return { ok: false, error: PASSWORD_POLICY_ERROR };
  }
  return { ok: true };
}

// PBKDF2-HMAC-SHA256, 600.000 iteraciones (recomendación OWASP vigente para este
// digest), salida derivada de 256 bits. Formato de almacenamiento versionado:
// "pbkdf2_sha256$v1$i=600000$<salt_b64url>$<hash_b64url>" — permite subir
// iteraciones o cambiar de algoritmo en el futuro sin romper hashes existentes,
// ya que cada fila lleva sus propios parámetros embebidos.

const ALGORITHM = "pbkdf2_sha256";
const VERSION = "v1";
const ITERATIONS = 600_000;
// MIS-293 (B5): cota superior defensiva del campo `i=` que verifyPassword lee del
// hash almacenado. Hoy todos los hashes usan ITERATIONS (600.000), pero un valor
// manipulado como i=100000000 colgaría el KDF (DoS por CPU). El techo deja holgura
// para subir el coste en el futuro sin tocar esta cota.
const MAX_ITERATIONS = 1_000_000;
const SALT_LENGTH_BYTES = 16;
const KEY_LENGTH_BITS = 256;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(base64Url: string): Uint8Array {
  const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveBits(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    keyMaterial,
    KEY_LENGTH_BITS,
  );
  return new Uint8Array(derived);
}

// Comparación en tiempo constante — nunca "===" ni comparación con cortocircuito.
// Exportada (MIS-260): reusada para comparar el `serverKey` de
// loginWithGoogle contra GOOGLE_LOGIN_SHARED_SECRET, mismo motivo que aquí
// (no filtrar por timing si el secreto es correcto o no).
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES));
  const derived = await deriveBits(password, salt, ITERATIONS);
  return `${ALGORITHM}$${VERSION}$i=${ITERATIONS}$${bytesToBase64Url(salt)}$${bytesToBase64Url(derived)}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split("$");
  if (parts.length !== 5 || parts[0] !== ALGORITHM || parts[1] !== VERSION) {
    return false;
  }
  const iterations = Number(parts[2].replace(/^i=/, ""));
  // MIS-293 (B5): cota defensiva. Un `i=` fuera de rango (manipulado) colgaría
  // deriveBits; se trata como hash inválido (misma salida que un formato
  // malformado). Va tras parsear `i=` y ANTES de decodificar salt/hash, para que
  // el rechazo sea imputable a la cota y no a un decode base64. `Number.isInteger`
  // cubre de paso NaN (i= no numérico), el string vacío (Number("")===0) y los
  // decimales.
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) {
    return false;
  }
  const salt = base64UrlToBytes(parts[3]);
  const expected = base64UrlToBytes(parts[4]);
  const actual = await deriveBits(password, salt, iterations);
  return constantTimeEqual(actual, expected);
}

// MIS-290 (I7): huella del hash almacenado. `finalizeLogin` revalida que el hash
// no cambió entre la reserva y la finalización comparando SHA-256(hash) en vez de
// retransmitir el hash por los argumentos de otra función (donde acabaría en
// trazas de funciones y logs de error). Helper propio, no reutiliza hashToken
// (que es para tokens de sesión): así el fingerprint no se acopla a ese uso.
export async function fingerprintHash(storedHash: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(storedHash));
  return bytesToBase64Url(new Uint8Array(digest));
}

// Compara dos huellas en tiempo constante (por consistencia con el resto del
// módulo, aunque aquí no haya un secreto que proteger por timing). Ambas son
// base64url de un SHA-256 (longitud fija).
export function fingerprintsEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  return constantTimeEqual(enc.encode(a), enc.encode(b));
}

// Hash señuelo real (no un placeholder inventado a mano): generado una única vez con
// hashPassword(crypto.randomUUID()) usando los mismos parámetros de producción.
// Se usa para que el tiempo de respuesta de `login` no distinga "el email no
// existe" de "la contraseña es incorrecta" (ver convex/auth.ts).
export const DUMMY_PASSWORD_HASH =
  "pbkdf2_sha256$v1$i=600000$HkG6inHyNyqmRp4rzGk3LQ$8NwiW0PaMTVA8K0tdk9eGVc86DCHq5v_Im8JkNpbaao";

// PBKDF2-HMAC-SHA256, 600.000 iteraciones (recomendación OWASP vigente para este
// digest), salida derivada de 256 bits. Formato de almacenamiento versionado:
// "pbkdf2_sha256$v1$i=600000$<salt_b64url>$<hash_b64url>" — permite subir
// iteraciones o cambiar de algoritmo en el futuro sin romper hashes existentes,
// ya que cada fila lleva sus propios parámetros embebidos.

const ALGORITHM = "pbkdf2_sha256";
const VERSION = "v1";
const ITERATIONS = 600_000;
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
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
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
  const salt = base64UrlToBytes(parts[3]);
  const expected = base64UrlToBytes(parts[4]);
  const actual = await deriveBits(password, salt, iterations);
  return constantTimeEqual(actual, expected);
}

// Hash señuelo real (no un placeholder inventado): generado una única vez con
// hashPassword(crypto.randomUUID()) usando los mismos parámetros de producción.
// Se usa para que el tiempo de respuesta de `login` no distinga "el email no
// existe" de "la contraseña es incorrecta" (ver convex/auth.ts).
export const DUMMY_PASSWORD_HASH =
  "pbkdf2_sha256$v1$i=600000$HkG6inHyNyqmRp4rzGk3LQ$8NwiW0PaMTVA8K0tdk9eGVc86DCHq5v_Im8JkNpbaao";

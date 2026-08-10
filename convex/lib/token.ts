// Token opaco de sesión: 32 bytes (256 bits) de entropía es un requisito duro,
// no un detalle de implementación — un token corto anula la ventaja de guardar
// solo el hash en `sessions.tokenHash`.

const TOKEN_LENGTH_BYTES = 32;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function generateOpaqueToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_LENGTH_BYTES));
  return bytesToBase64Url(bytes);
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return bytesToHex(new Uint8Array(digest));
}

// MIS-285: código numérico del flujo de recuperación de contraseña (OTP por
// email). Rejection sampling sobre la misma fuente de entropía que
// generateOpaqueToken — un simple `% 10**digits` sesgaría ligeramente los
// dígitos bajos, porque 2**32 no es múltiplo exacto de 10**digits.
export function generateNumericCode(digits = 6): string {
  const max = 10 ** digits;
  const limit = Math.floor(0x100000000 / max) * max;
  let value: number;
  do {
    value = crypto.getRandomValues(new Uint32Array(1))[0];
  } while (value >= limit);
  return String(value % max).padStart(digits, "0");
}

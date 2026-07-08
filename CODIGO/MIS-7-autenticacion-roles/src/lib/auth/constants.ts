// Sin otras importaciones a propósito: tanto src/proxy.ts (usa request.cookies,
// API de next/server) como src/lib/auth/cookie.ts (usa next/headers) necesitan
// este nombre, y cada uno corre en un contexto distinto.
export const SESSION_COOKIE_NAME = "session";

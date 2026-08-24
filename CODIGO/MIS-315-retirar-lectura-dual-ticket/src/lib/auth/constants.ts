// Sin otras importaciones a propósito: tanto src/proxy.ts (usa request.cookies,
// API de next/server) como src/lib/auth/cookie.ts (usa next/headers) necesitan
// este nombre, y cada uno corre en un contexto distinto.
//
// MIS-293 (B2): prefijo `__Host-` — el navegador REFUERZA que la cookie se emitió
// con `Secure` + `Path=/` + SIN `Domain`. Ver la invariante en cookie.ts.
export const SESSION_COOKIE_NAME = "__Host-session";

// MIS-260: cookie de corta duración (10 min), solo para el flujo
// /api/auth/google/* — nunca contiene identidad, solo el nonce anti-CSRF.
// MIS-293 (B2): prefijo `__Secure-` (su `path` no es `/`, así que no puede ser
// `__Host-`); el navegador refuerza que se emitió con `Secure`.
export const OAUTH_STATE_COOKIE_NAME = "__Secure-google_oauth_state";

// MIS-299 (B6, PKCE): cookie httpOnly de corta duración (10 min) que transporta
// el `code_verifier` de PKCE entre /start y /callback — nunca contiene identidad,
// solo el secreto de un solo uso. Mismo molde y vida que la de OAuth state.
// MIS-293 (B2): prefijo `__Secure-` (su `path` no es `/`, mismo motivo que state).
export const PKCE_VERIFIER_COOKIE_NAME = "__Secure-google_pkce_verifier";

// MIS-292 (M3): cookie httpOnly de corta duración (15 min) que transporta el
// ticket de reseteo entre verificar el código y fijar la nueva contraseña.
// Antes viajaba en estado React + <input type="hidden">, accesible a JS; ahora
// solo existe aquí, fuera del alcance del navegador.
// MIS-312: el `path` es `/` (antes `/recuperar-contrasena`) para que el mismo
// ticket sirva tanto a `/recuperar-contrasena` como a la pantalla de onboarding
// `/configurar-contrasena` (server actions compartidas). Con `Secure` + `Path=/`
// + sin `Domain` cumple el prefijo `__Host-`, que el navegador REFUERZA.
// MIS-315: retirada la compatibilidad transitoria con el nombre anterior
// `__Secure-reset_ticket` (lectura dual + expiración), superada la ventana del
// TTL del ticket (15 min) desde el despliegue de MIS-312. Ver cookie.ts.
export const RESET_TICKET_COOKIE_NAME = "__Host-reset_ticket";

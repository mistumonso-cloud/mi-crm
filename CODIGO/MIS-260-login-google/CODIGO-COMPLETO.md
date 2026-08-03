# CODIGO-COMPLETO — MIS-260: Login con Google (OAuth), conviviendo con el login por contraseña

Plan de referencia: [`PLANS/MIS-260-login-google.md`](../../PLANS/MIS-260-login-google.md) (v2, auditado GO).

Orden: igual que la tabla "Archivos afectados" del plan.

---

## `convex/lib/session.ts` (NUEVO)

```ts
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { generateOpaqueToken, hashToken } from "./token";

// Extraído de convex/auth.ts::login (MIS-7) — MIS-260 lo reusa para
// loginWithGoogle, para no duplicar el bloque "generar token, hashear,
// insertar en sessions" entre los dos flujos de login.
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 días — sesión persistente

export async function createSession(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<{ token: string; expiresAt: number }> {
  const token = generateOpaqueToken();
  const tokenHash = await hashToken(token);
  const expiresAt = Date.now() + SESSION_TTL_MS;
  await ctx.db.insert("sessions", { userId, tokenHash, expiresAt });
  return { token, expiresAt };
}
```

---

## `convex/lib/password.ts` (EDITAR)

```ts
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
  const salt = base64UrlToBytes(parts[3]);
  const expected = base64UrlToBytes(parts[4]);
  const actual = await deriveBits(password, salt, iterations);
  return constantTimeEqual(actual, expected);
}

// Hash señuelo real (no un placeholder inventado a mano): generado una única vez con
// hashPassword(crypto.randomUUID()) usando los mismos parámetros de producción.
// Se usa para que el tiempo de respuesta de `login` no distinga "el email no
// existe" de "la contraseña es incorrecta" (ver convex/auth.ts).
export const DUMMY_PASSWORD_HASH =
  "pbkdf2_sha256$v1$i=600000$HkG6inHyNyqmRp4rzGk3LQ$8NwiW0PaMTVA8K0tdk9eGVc86DCHq5v_Im8JkNpbaao";
```

---

## `convex/auth.ts` (EDITAR)

```ts
import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { DUMMY_PASSWORD_HASH, verifyPassword, constantTimeEqual } from "./lib/password";
import { hashToken } from "./lib/token";
import { lookupSessionUser } from "./lib/authz";
import { createSession } from "./lib/session";
import {
  EMAIL_RATE_LIMIT,
  IP_RATE_LIMIT,
  isLocked,
  normalizeEmailKey,
  normalizeIpHint,
  recordFailedAttempt,
  resetAttempts,
} from "./lib/rateLimit";

const GENERIC_ERROR = "Email o contraseña incorrectos";
const LOCKED_ERROR = "Demasiados intentos, inténtalo de nuevo en unos minutos";

// MIS-260: mensaje único para CUALQUIER fallo del flujo de Google (state
// inválido, error/cancelación de Google, email no verificado, serverKey
// incorrecto o email no provisionado) — mismo criterio anti-enumeración que
// GENERIC_ERROR arriba, que tampoco distingue "email no existe" de
// "password incorrecta".
const GOOGLE_GENERIC_ERROR = "No se pudo iniciar sesión con Google";
// Nombre de la env var de Convex que debe coincidir exactamente con
// GOOGLE_LOGIN_SHARED_SECRET del lado de Next.js (ver src/lib/auth/google.ts
// y el Route Handler de callback) — se configura con
// `npx convex env set GOOGLE_LOGIN_SHARED_SECRET <valor>`.
const GOOGLE_LOGIN_ENV_VAR = "GOOGLE_LOGIN_SHARED_SECRET";

const roleValidator = v.union(v.literal("rep"), v.literal("supervisor"));

export const login = mutation({
  args: {
    email: v.string(),
    password: v.string(),
    ipHint: v.optional(v.string()),
  },
  returns: v.union(
    v.object({ success: v.literal(true), token: v.string(), role: roleValidator }),
    v.object({ success: v.literal(false), error: v.string() }),
  ),
  handler: async (ctx, args) => {
    const emailKey = normalizeEmailKey(args.email);
    const ipKey = normalizeIpHint(args.ipHint ?? null);

    if (ipKey && (await isLocked(ctx, `ip:${ipKey}`))) {
      return { success: false as const, error: LOCKED_ERROR };
    }
    if (await isLocked(ctx, emailKey)) {
      return { success: false as const, error: LOCKED_ERROR };
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", emailKey))
      .unique();

    // Mitigación de timing: si el usuario no existe, igual se ejecuta
    // verifyPassword contra un hash señuelo real, para que el coste
    // computacional de la petición sea equivalente exista o no la cuenta.
    const passwordOk = await verifyPassword(args.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);

    if (!user || !passwordOk) {
      await recordFailedAttempt(ctx, emailKey, EMAIL_RATE_LIMIT);
      if (ipKey) await recordFailedAttempt(ctx, `ip:${ipKey}`, IP_RATE_LIMIT);
      return { success: false as const, error: GENERIC_ERROR };
    }

    // Solo se resetea el contador por email, NO el de la IP (`ip:${ipKey}`) —
    // intencional: el contador de IP agrega intentos fallidos contra
    // cualquier email probado desde esa IP, como defensa contra un atacante
    // que prueba varias cuentas desde el mismo origen. Si un login correcto
    // reseteara también la IP, bastaría con tener una única credencial válida
    // para "limpiar" el contador y seguir probando otras cuentas desde la
    // misma IP con el límite a cero. Puede dar algún falso positivo en redes
    // compartidas (oficina/NAT), aceptado como coste de esta capa best-effort.
    await resetAttempts(ctx, emailKey);

    const { token } = await createSession(ctx, user._id);

    return { success: true as const, token, role: user.role };
  },
});

export const logout = mutation({
  args: { token: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const tokenHash = await hashToken(args.token);
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (session) {
      await ctx.db.delete(session._id);
    }
    return null;
  },
});

// Query pura de solo lectura — Convex no permite escribir dentro de una query
// (QueryCtx no expone insert/patch/delete en ctx.db), así que no hace ninguna
// limpieza de sesiones expiradas al leer: si expiresAt ya pasó, simplemente
// devuelve null. La limpieza real vive en convex/crons.ts.
//
// El `returns` validator hace estructuralmente imposible filtrar
// passwordHash: si el objeto devuelto no coincide exactamente con esta forma,
// Convex lanza error en vez de dejar pasar el dato de más.
export const getSessionUser = query({
  args: { token: v.string() },
  returns: v.union(
    v.null(),
    v.object({ id: v.id("users"), name: v.string(), role: roleValidator }),
  ),
  handler: async (ctx, args) => {
    return await lookupSessionUser(ctx, args.token);
  },
});

// MIS-260: "Entrar con Google". Recibe el email YA verificado por Google
// (email_verified === true comprobado en el Route Handler de Next.js, antes
// de llegar aquí) y, si coincide con un usuario ya provisionado, autentica
// exactamente igual que `login` — misma tabla `sessions`, misma cookie,
// mismo DAL. Nunca inserta en "users": el alta sigue cerrada, esta mutation
// SOLO autentica a quien ya existe.
//
// Invariante de seguridad (por qué existe `serverKey`): sin este segundo
// argumento, esta sería una mutation pública invocable con cualquier email
// directamente contra el endpoint de Convex (NEXT_PUBLIC_CONVEX_URL es
// público, está en el bundle JS) — un bypass completo del login, sin
// password, sin pasar por Google. `serverKey` es un secreto compartido que
// SOLO conoce el servidor de Next.js (nunca el navegador) y el entorno de
// este deployment de Convex; sin él, la respuesta es indistinguible de
// "email no provisionado".
export const loginWithGoogle = mutation({
  args: { email: v.string(), serverKey: v.string() },
  returns: v.union(
    v.object({ success: v.literal(true), token: v.string(), role: roleValidator }),
    v.object({ success: v.literal(false), error: v.string() }),
  ),
  handler: async (ctx, args) => {
    const expectedKey = process.env[GOOGLE_LOGIN_ENV_VAR];
    const keyOk =
      !!expectedKey &&
      constantTimeEqual(
        new TextEncoder().encode(args.serverKey),
        new TextEncoder().encode(expectedKey),
      );
    if (!keyOk) return { success: false as const, error: GOOGLE_GENERIC_ERROR };

    const emailKey = normalizeEmailKey(args.email);
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", emailKey))
      .unique();
    if (!user) return { success: false as const, error: GOOGLE_GENERIC_ERROR };

    const { token } = await createSession(ctx, user._id);
    return { success: true as const, token, role: user.role };
  },
});

// internalMutation: no forma parte de `api.*`, ningún cliente externo puede
// invocarla — solo con la admin key del deployment (npx convex run o el
// dashboard). Recibe la password YA hasheada (ver scripts/hash-password.mjs),
// nunca en claro.
export const seedUser = internalMutation({
  args: {
    name: v.string(),
    email: v.string(),
    passwordHash: v.string(),
    role: roleValidator,
  },
  returns: v.id("users"),
  handler: async (ctx, args) => {
    const emailKey = normalizeEmailKey(args.email);
    const existing = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", emailKey))
      .unique();
    if (existing) {
      throw new ConvexError(`Ya existe un usuario con el email ${emailKey}`);
    }
    return await ctx.db.insert("users", {
      name: args.name,
      email: emailKey,
      passwordHash: args.passwordHash,
      role: args.role,
    });
  },
});

export const cleanupExpiredSessions = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query("sessions")
      .filter((q) => q.lt(q.field("expiresAt"), now))
      .collect();
    for (const session of expired) {
      await ctx.db.delete(session._id);
    }
    return expired.length;
  },
});
```

---

## `src/lib/auth/constants.ts` (EDITAR)

```ts
// Sin otras importaciones a propósito: tanto src/proxy.ts (usa request.cookies,
// API de next/server) como src/lib/auth/cookie.ts (usa next/headers) necesitan
// este nombre, y cada uno corre en un contexto distinto.
export const SESSION_COOKIE_NAME = "session";

// MIS-260: cookie de corta duración (10 min), solo para el flujo
// /api/auth/google/* — nunca contiene identidad, solo el nonce anti-CSRF.
export const OAUTH_STATE_COOKIE_NAME = "google_oauth_state";
```

---

## `src/lib/auth/cookie.ts` (EDITAR)

```ts
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, OAUTH_STATE_COOKIE_NAME } from "./constants";

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 días — sesión persistente

// path:"/" explícito en set y clear: sin esto, un cambio futuro de ruta de
// login/logout podría dejar la cookie inaccesible o sin poder borrarla del todo.
export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export async function readSessionToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null;
}

// MIS-260: cookie efímera del flujo OAuth de Google, separada de la de
// sesión — nunca lleva identidad, solo el nonce `state` para CSRF.
const OAUTH_STATE_TTL_SECONDS = 10 * 60; // 10 min — solo dura lo que tarda el consentimiento de Google

export async function setOAuthStateCookie(state: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(OAUTH_STATE_COOKIE_NAME, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // "lax", no "strict": debe sobrevivir a la navegación top-level
    // ENTRANTE que hace Google al volver a /api/auth/google/callback —
    // "strict" no garantiza que la cookie viaje en esa navegación.
    sameSite: "lax",
    path: "/api/auth/google",
    maxAge: OAUTH_STATE_TTL_SECONDS,
  });
}

export async function readOAuthStateCookie(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(OAUTH_STATE_COOKIE_NAME)?.value ?? null;
}

export async function clearOAuthStateCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(OAUTH_STATE_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/google",
    maxAge: 0,
  });
}
```

---

## `src/lib/auth/dal.ts` (EDITAR)

```ts
import { cache } from "react";
import { redirect } from "next/navigation";
import { fetchQuery } from "convex/nextjs";
import { api } from "../../../convex/_generated/api";
import { readSessionToken } from "./cookie";

export type Role = "rep" | "supervisor";

export type SessionUser = {
  id: string;
  name: string;
  role: Role;
};

// Fuente de verdad real de autenticación — a diferencia de src/proxy.ts (que
// solo mira si existe la cookie), esto sí consulta Convex. Cada page protegida
// debe llamar a getUser(), no basta con comprobarlo en el layout (no se
// re-ejecuta en cada navegación entre hermanos).
export const getSession = cache(async (): Promise<SessionUser | null> => {
  const token = await readSessionToken();
  if (!token) return null;
  return await fetchQuery(api.auth.getSessionUser, { token });
});

export const getUser = cache(async (): Promise<SessionUser> => {
  const user = await getSession();
  if (!user) redirect("/login");
  return user;
});

// MIS-260: extraído del ternario que antes vivía inline en
// loginAction (src/lib/auth/actions.ts) — el callback de Google
// (src/app/api/auth/google/callback/route.ts) aterriza al mismo sitio según
// el mismo criterio, así que se comparte en vez de duplicarse.
export function landingPathForRole(role: Role): string {
  return role === "rep" ? "/pendientes" : "/panel";
}

// MIS-18 (ADR): pendientes/panel dejaron de exigir un rol exacto — Carlos y
// Marta tienen ambos acceso de lectura a los dos, según el criterio original
// de MIS-7 para Marta ("puede ver todo lo que Carlos hace"). requireRole()
// vivía aquí para ese bloqueo mutuo y se retiró al quedar sin ningún call
// site. MIS-251 (reapertura) fue más allá: retiró también
// convex/lib/authz.ts::requireRole (el guard de mutations/queries) — Marta
// pasa a tener acceso de escritura completo, no solo de lectura, por
// decisión de negocio confirmada por el usuario (ver PLANS/MIS-251-rol-
// supervision-marta.md). No queda ningún requireRole en el repo a partir de
// este ticket; `role` se conserva en SessionUser solo para la experiencia
// de navegación (pantalla de aterrizaje por defecto), no para autorización.
```

---

## `src/lib/auth/actions.ts` (EDITAR)

```ts
"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { fetchMutation } from "convex/nextjs";
import { api } from "../../../convex/_generated/api";
import { clearSessionCookie, readSessionToken, setSessionCookie } from "./cookie";
import { landingPathForRole } from "./dal";

export type LoginActionState = { error: string } | undefined;

export async function loginAction(
  _prevState: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const ipHint = (await headers()).get("x-forwarded-for") ?? undefined;

  const result = await fetchMutation(api.auth.login, { email, password, ipHint });

  if (!result.success) {
    return { error: result.error };
  }

  await setSessionCookie(result.token);
  redirect(landingPathForRole(result.role));
}

export async function logoutAction(): Promise<void> {
  const token = await readSessionToken();
  if (token) {
    await fetchMutation(api.auth.logout, { token });
  }
  await clearSessionCookie();
  redirect("/login");
}
```

---

## `src/lib/auth/google.ts` (NUEVO)

```ts
// MIS-260: toda la lógica "hablar con Google" vive aquí, fuera de los Route
// Handlers (que quedan finos) — mismo criterio de reparto que actions.ts
// (orquestación) vs. convex/auth.ts (lógica/datos).

function getGoogleClientId(): string {
  const id = process.env.GOOGLE_CLIENT_ID;
  if (!id) throw new Error("Falta GOOGLE_CLIENT_ID en el entorno");
  return id;
}

function getGoogleClientSecret(): string {
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!secret) throw new Error("Falta GOOGLE_CLIENT_SECRET en el entorno");
  return secret;
}

// Valor exacto y fijo, no derivado de headers del request (Railway está
// detrás de su propio proxy) — las dos URIs posibles ya se conocen de
// antemano y están registradas tal cual en Google Cloud Console; derivarla
// dinámicamente solo añadiría riesgo de mismatch sin ninguna ventaja.
export function getGoogleRedirectUri(): string {
  const uri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!uri) throw new Error("Falta GOOGLE_OAUTH_REDIRECT_URI en el entorno");
  return uri;
}

// Nonce anti-CSRF de 32 bytes — mismo tamaño/fuente de entropía que
// generateOpaqueToken (convex/lib/token.ts), pero reimplementado aquí en vez
// de importado: src/ y convex/ corren en runtimes/bundles distintos, y el
// resto del repo ya sigue el criterio de no cruzar imports entre ambos.
export function generateOAuthState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function buildGoogleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: getGoogleClientId(),
    redirect_uri: getGoogleRedirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state,
    // Evita que Google auto-elija una cuenta ya activa en el navegador sin
    // preguntar — relevante porque un mismo navegador puede tener varias
    // cuentas de Google abiertas.
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCodeForAccessToken(code: string): Promise<string> {
  const params = new URLSearchParams({
    client_id: getGoogleClientId(),
    client_secret: getGoogleClientSecret(),
    code,
    // Mismo valor exacto que en buildGoogleAuthUrl — Google exige que el
    // redirect_uri del intercambio coincida byte a byte con el de la
    // petición de autorización original.
    redirect_uri: getGoogleRedirectUri(),
    grant_type: "authorization_code",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
  const data = await res.json();
  if (!data.access_token) throw new Error("token exchange: sin access_token");
  return data.access_token as string;
}

// Verificación del email vía el endpoint `userinfo` de Google con el
// access_token, en vez de decodificar el id_token a mano: evita tener que
// verificar la firma JWT nosotros mismos (JWKS, rotación de claves) para un
// beneficio marginal — el access_token ya viene de una respuesta TLS directa
// de Google a una petición autenticada con client_secret.
export async function fetchVerifiedGoogleEmail(accessToken: string): Promise<string> {
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`userinfo failed: ${res.status}`);
  const profile = await res.json();
  const verified = profile.email_verified === true || profile.email_verified === "true";
  if (!profile.email || !verified) throw new Error("email ausente o no verificado por Google");
  return profile.email as string;
}
```

---

## `src/app/api/auth/google/start/route.ts` (NUEVO)

```ts
import { redirect } from "next/navigation";
import { setOAuthStateCookie } from "@/lib/auth/cookie";
import { buildGoogleAuthUrl, generateOAuthState } from "@/lib/auth/google";

// Runtime Node.js por defecto (no se declara `edge`) — mismo criterio que
// src/proxy.ts, necesario para crypto/fetch sin restricciones.
export async function GET() {
  const state = generateOAuthState();
  await setOAuthStateCookie(state);
  redirect(buildGoogleAuthUrl(state));
}
```

---

## `src/app/api/auth/google/callback/route.ts` (NUEVO)

```ts
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { fetchMutation } from "convex/nextjs";
// 6 niveles: este archivo vive en src/app/api/auth/google/callback/, 6
// directorios bajo la raíz del repo (src, app, api, auth, google, callback)
// — corregido en auditoría (ronda 1, M1): una versión anterior con 5
// niveles resolvía a src/convex/_generated/api, inexistente. Mismo criterio
// de conteo que src/lib/auth/actions.ts (3 niveles, 3 directorios de
// profundidad).
import { api } from "../../../../../../convex/_generated/api";
import { clearOAuthStateCookie, readOAuthStateCookie, setSessionCookie } from "@/lib/auth/cookie";
import { exchangeCodeForAccessToken, fetchVerifiedGoogleEmail } from "@/lib/auth/google";
import { landingPathForRole } from "@/lib/auth/dal";

type Result = { ok: true; token: string; role: "rep" | "supervisor" } | { ok: false; reason: string };

// Aislado en una función que NUNCA redirige: next/navigation's redirect()
// lanza internamente y la doc de Next.js pide no llamarlo dentro de un
// try/catch — todo el trabajo con Google/Convex (que sí necesita try/catch
// para errores de red) vive aquí; los redirect() solo están en el handler
// exterior.
async function handleCallback(request: NextRequest): Promise<Result> {
  const googleError = request.nextUrl.searchParams.get("error");
  if (googleError) return { ok: false, reason: `google error: ${googleError}` };

  const code = request.nextUrl.searchParams.get("code");
  const returnedState = request.nextUrl.searchParams.get("state");
  const savedState = await readOAuthStateCookie();
  if (!code || !returnedState || !savedState || returnedState !== savedState) {
    return { ok: false, reason: "state inválido o ausente" };
  }

  try {
    const accessToken = await exchangeCodeForAccessToken(code);
    const email = await fetchVerifiedGoogleEmail(accessToken);
    const result = await fetchMutation(api.auth.loginWithGoogle, {
      email,
      serverKey: process.env.GOOGLE_LOGIN_SHARED_SECRET!,
    });
    if (!result.success) return { ok: false, reason: result.error };
    return { ok: true, token: result.token, role: result.role };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "error desconocido" };
  }
}

export async function GET(request: NextRequest) {
  const result = await handleCallback(request);
  // De un solo uso — se borra siempre, éxito o no.
  await clearOAuthStateCookie();

  if (!result.ok) {
    // Detalle real del fallo solo en logs de servidor — nunca llega al
    // cliente (anti-enumeración, mismo criterio que GENERIC_ERROR en el
    // login por password).
    console.error("[google-auth] callback falló:", result.reason);
    redirect("/login?error=google");
  }

  await setSessionCookie(result.token);
  redirect(landingPathForRole(result.role));
}
```

---

## `src/app/(auth)/login/page.tsx` (EDITAR)

```tsx
import { redirect } from "next/navigation";
import { getSession, landingPathForRole } from "@/lib/auth/dal";
import { LoginForm } from "./LoginForm";

// MIS-260: mensaje único para cualquier fallo del flujo de Google — mismo
// criterio anti-enumeración que el error genérico del login por password,
// nunca distingue el motivo real (eso solo se loguea server-side en el
// Route Handler de callback).
const GOOGLE_LOGIN_ERROR_MESSAGE =
  "No se pudo iniciar sesión con Google. Si tu cuenta no está registrada en el CRM, contacta con un administrador.";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // Comprobación real (no la optimista de src/proxy.ts): si ya hay una sesión
  // válida, saltar directamente al home por rol. Si la cookie existe pero la
  // sesión ya no es válida, getSession() devuelve null y esta página se
  // renderiza con normalidad — no hay redirect en bucle porque esto usa el
  // DAL real, no la mera presencia de la cookie.
  const user = await getSession();
  if (user) {
    redirect(landingPathForRole(user.role));
  }

  const { error } = await searchParams;
  const googleError = error === "google";

  return (
    <div className="flex flex-1 items-center justify-center bg-[var(--color-bg)] px-4 py-16">
      <LoginForm initialError={googleError ? GOOGLE_LOGIN_ERROR_MESSAGE : undefined} />
    </div>
  );
}
```

---

## `src/app/(auth)/login/LoginForm.tsx` (EDITAR)

```tsx
"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/core/Button";
import { Input } from "@/components/ui/forms/Input";
import { loginAction, type LoginActionState } from "@/lib/auth/actions";

const initialState: LoginActionState = undefined;

// MIS-260: initialError llega de page.tsx (Server Component) cuando el
// redirect completo de página tras el callback de Google trae
// ?error=google — un caso que useActionState no cubre, porque ese hook solo
// conoce el resultado de un submit del propio formulario de password.
type LoginFormProps = {
  initialError?: string;
};

export function LoginForm({ initialError }: LoginFormProps) {
  const [state, formAction, isPending] = useActionState(loginAction, initialState);
  const [showPassword, setShowPassword] = useState(false);

  // Prioridad al error del propio submit de password sobre el que venga de
  // Google: si el usuario ya está reintentando con password tras un fallo
  // de Google, el error relevante es el nuevo.
  const displayError = state?.error ?? initialError;

  return (
    <div style={{ width: "100%", maxWidth: 375, display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center" }}>
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: "var(--radius-lg)",
            background: "var(--color-accent)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <MenuIcon />
        </div>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
            Vibe Coder CRM
          </h1>
          <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: "4px 0 0" }}>
            Gestiona tus contactos y nunca pierdas una venta
          </p>
        </div>
      </div>

      <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Input
          label="Email"
          name="email"
          type="email"
          placeholder="tucorreo@email.com"
          autoComplete="email"
          required
          disabled={isPending}
        />
        <Input
          label="Contraseña"
          name="password"
          type={showPassword ? "text" : "password"}
          placeholder="••••••••"
          autoComplete="current-password"
          required
          disabled={isPending}
          suffix={
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                display: "inline-flex",
                color: "inherit",
              }}
            >
              {showPassword ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          }
        />

        {displayError && (
          <div
            role="alert"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 12px",
              borderRadius: "var(--radius-md)",
              background: "var(--color-danger-bg)",
              color: "var(--color-danger-fg)",
              fontSize: 13,
            }}
          >
            <AlertIcon />
            {displayError}
          </div>
        )}

        <Button type="submit" full size="lg" disabled={isPending}>
          {isPending ? (
            <>
              <SpinnerIcon />
              Verificando…
            </>
          ) : (
            "Entrar"
          )}
        </Button>
      </form>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1, height: 1, background: "var(--color-border)" }} />
        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>o</span>
        <div style={{ flex: 1, height: 1, background: "var(--color-border)" }} />
      </div>

      {/* Enlace real, sin onClick/JS: navega a /api/auth/google/start, que
          redirige a Google. Funciona igual con o sin JS hidratado, mismo
          criterio de progressive enhancement que el resto del formulario. */}
      <a
        href="/api/auth/google/start"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          height: 44,
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--color-border)",
          background: "var(--color-surface)",
          color: "var(--text-primary)",
          fontSize: 14,
          fontWeight: 600,
          textDecoration: "none",
        }}
      >
        <GoogleIcon />
        Entrar con Google
      </a>
    </div>
  );
}

function MenuIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-contrast)" strokeWidth="2" strokeLinecap="round">
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a21.4 21.4 0 0 1 5.06-5.94M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 7 11 7a21.4 21.4 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" strokeOpacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.13-.84 2.09-1.8 2.73v2.27h2.91c1.7-1.57 2.69-3.88 2.69-6.64z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.17l-2.91-2.27c-.81.54-1.84.86-3.05.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.33C2.44 15.98 5.48 18 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.71c-.18-.54-.28-1.11-.28-1.71s.1-1.17.28-1.71V4.96H.96A8.996 8.996 0 0 0 0 9c0 1.45.35 2.83.96 4.04l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.96 4.96l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}
```

---

## `README.md` (EDITAR)

Añadida la subsección "Login con Google (MIS-260)" bajo "Autenticación y roles", con la tabla de env vars nuevas y las dos redirect URIs. Ver el archivo completo en [`README.md`](./README.md) de esta misma carpeta (reproduce la raíz del repo).

---

## `.env.local.example` (EDITAR)

```
# Generadas por `npx convex dev` / `npx convex deploy`
NEXT_PUBLIC_CONVEX_URL=
NEXT_PUBLIC_CONVEX_SITE_URL=
CONVEX_DEPLOYMENT=

# Google OAuth ("Entrar con Google", MIS-260) — credenciales ya creadas en Google Cloud Console
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
# Debe coincidir EXACTAMENTE con el mismo valor puesto en Convex vía:
#   npx convex env set GOOGLE_LOGIN_SHARED_SECRET <valor>
GOOGLE_LOGIN_SHARED_SECRET=
```

---

## `.env.test.local.example` (EDITAR)

```
# Copia a .env.test.local (gitignored) y rellena con las credenciales reales
# de Carlos y Marta en el deployment de dev de Convex (dutiful-mole-111).
E2E_CARLOS_EMAIL=carlos@test.local
E2E_CARLOS_PASSWORD=
# MIS-260: Marta pasa a usar su email real (mistumonso@gmail.com) en dev —
# era marta@test.local hasta este ticket. Solo cambia el email, no el name.
E2E_MARTA_EMAIL=mistumonso@gmail.com
E2E_MARTA_PASSWORD=
E2E_BASE_URL=http://localhost:3000
```

---

## `e2e/google-auth.spec.ts` (NUEVO)

```ts
import { test, expect } from "@playwright/test";

// MIS-260: sin sesión (sin storageState) — corre en el project
// "chromium-unauth", sin dependencies de setup-carlos/setup-marta. Cubre
// solo lo que controlamos del lado del servidor propio; un intercambio de
// código real contra Google queda fuera de alcance automatizado (requeriría
// una cuenta de Google real, no viable en CI, o mockear los endpoints de
// Google — ver PLANS/MIS-260-login-google.md, "Fuera de alcance").

test.describe("Google OAuth: /start y /callback (sin cuenta real de Google)", () => {
  test("/api/auth/google/start pone la cookie de estado y redirige a Google con el mismo state", async ({
    page,
  }) => {
    const res = await page.request.get("/api/auth/google/start", { maxRedirects: 0 });

    expect(res.status()).toBeGreaterThanOrEqual(300);
    expect(res.status()).toBeLessThan(400);

    const location = res.headers()["location"];
    expect(location).toBeTruthy();
    const authUrl = new URL(location!);
    expect(authUrl.origin + authUrl.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(authUrl.searchParams.get("scope")).toBe("openid email profile");
    expect(authUrl.searchParams.get("response_type")).toBe("code");
    const stateInQuery = authUrl.searchParams.get("state");
    expect(stateInQuery).toBeTruthy();

    // Auditoría (ronda 1, sugerencia menor): comprobar que el state de la
    // URL coincide EXACTAMENTE con el de la cookie, no solo que ambos
    // existan por separado.
    const setCookieHeader = res.headers()["set-cookie"] ?? "";
    const cookieMatch = /google_oauth_state=([^;]+)/.exec(setCookieHeader);
    expect(cookieMatch?.[1]).toBeTruthy();
    expect(decodeURIComponent(cookieMatch![1])).toBe(stateInQuery);
  });

  test("/api/auth/google/callback sin cookie de estado rechaza sin llamar a Google", async ({ page }) => {
    const res = await page.request.get("/api/auth/google/callback?code=x&state=y", {
      maxRedirects: 0,
    });

    expect(res.status()).toBeGreaterThanOrEqual(300);
    expect(res.status()).toBeLessThan(400);
    expect(res.headers()["location"]).toBe("/login?error=google");
  });

  test("/login muestra el mensaje de error genérico cuando llega ?error=google", async ({ page }) => {
    await page.goto("/login?error=google");
    // getByRole("alert") es ambiguo: matchea también el
    // __next-route-announcer__ que Next.js inserta con role="alert" (vacío)
    // para lectores de pantalla — mismo tipo de colisión ya documentado para
    // selectores de botón en este repo. getByText es inequívoco: el
    // announcer está vacío, solo nuestro div de error tiene este texto.
    await expect(page.getByText("No se pudo iniciar sesión con Google")).toBeVisible();
  });
});
```

---

## `playwright.config.ts` (EDITAR)

```ts
import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";
import path from "path";

// Orden importa: .env.local primero (NEXT_PUBLIC_CONVEX_URL, ya usado por
// `npm run dev`), .env.test.local después para que las credenciales de test
// puedan solaparse sin pisar nada de .env.local.
dotenv.config({ path: path.resolve(__dirname, ".env.local") });
dotenv.config({ path: path.resolve(__dirname, ".env.test.local") });

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  // Todos los tests comparten el mismo deployment de Convex de dev
  // (dutiful-mole-111, el mismo que usa `npm run dev` en local) — un solo
  // worker evita carreras de datos entre specs que leen/escriben las mismas
  // pantallas (Pendientes, lista de contactos, Panel).
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    // MIS-20: dos usuarios autenticados (Carlos, Marta) — cada uno con su
    // propio setup project y su propio project de test, con testMatch
    // explícito y disjunto en ambos niveles. Antes (MIS-19, un solo
    // usuario) un único "setup" con regex genérico /.*\.setup\.ts/ y un
    // "chromium" sin testMatch (todo *.spec.ts por defecto) no importaban
    // porque solo existía un usuario — con dos, el testMatch por defecto
    // haría que cada project de test corriera TAMBIÉN los specs del otro
    // usuario bajo el storageState equivocado, fallando por el motivo
    // equivocado (rol, no el bug real que ese spec prueba).
    { name: "setup-carlos", testMatch: "auth.setup.ts" },
    { name: "setup-marta", testMatch: "auth-marta.setup.ts" },

    {
      name: "chromium-carlos",
      testMatch: ["full-flow.spec.ts", "edge-cases.spec.ts"],
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/carlos.json" },
      dependencies: ["setup-carlos"],
    },
    {
      name: "chromium-marta",
      testMatch: ["panel-flow.spec.ts", "role-gating.spec.ts", "realtime-panel.spec.ts"],
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/marta.json" },
      // Depende de AMBOS setups: los specs de Marta siembran datos como
      // Carlos vía carlosTokenFromDisk() (lee e2e/.auth/carlos.json del
      // disco) — ese archivo debe existir ya antes de que arranque
      // cualquier test de Marta. Playwright ejecuta las dependencies
      // listadas en orden y espera a que cada una termine.
      dependencies: ["setup-carlos", "setup-marta"],
    },

    // MIS-260: sin sesión, sin dependencies — google-auth.spec.ts prueba
    // /api/auth/google/start y /callback como visitante anónimo.
    {
      name: "chromium-unauth",
      testMatch: ["google-auth.spec.ts"],
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

---

## Operación de datos fuera de `CODIGO/` (no es código)

Patch puntual del `email` de Marta en el deployment de dev (`dutiful-mole-111`), a ejecutar en el momento de instalar, no antes de un GO en este código: `email` → `mistumonso@gmail.com`, `name` sin cambios ("Marta"). Vía `npx convex run` o el dashboard de Convex — no existe (ni se añade) una mutation pública de "editar mi email".

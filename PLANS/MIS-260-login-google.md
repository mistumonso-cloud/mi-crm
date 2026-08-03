# MIS-260 — Login con Google (OAuth), conviviendo con el login por contraseña

> **Estado**: Plan auditado — **GO** (ronda 2, tras corregir M1 de ronda 1 — ver "Auditoría"). Código generado en `CODIGO/MIS-260-login-google/`, pendiente de auditoría de código antes de instalar.

## Contexto

El registro de este CRM está cerrado por diseño: no hay pantalla de alta, los usuarios se siembran a mano (`convex/auth.ts::seedUser`, `internalMutation` invocable solo con la admin key del deployment). Se añade "Entrar con Google", **conviviendo** con el login por contraseña actual (no lo sustituye): si el email verificado de la cuenta de Google coincide con un usuario ya existente en `users`, se autentica; si no coincide, se rechaza sin crear nada — el alta sigue cerrada.

Paso previo necesario para que esto sirva de verdad a la usuaria propietaria del CRM: la única cuenta `supervisor` que existe hoy en dev (Marta) pasa a usar su email real, `mistumonso@gmail.com`. El `name` se queda igual, `"Marta"` — decisión explícita, revertida tras una primera versión de este plan que sí contemplaba renombrar. Solo se toca el deployment de **dev** (`dutiful-mole-111`); producción está rota/pendiente de un fix aparte ya conocido ([[project-crm-deploy-workflow-change-pending]]) y queda fuera de esta tarea.

### Decisión arquitectónica ya tomada en MIS-7 (no se reabre)

`PLANS/MIS-7-autenticacion-roles.md`, sección "Decisión arquitectónica": sesión en base de datos con token opaco en cookie `HttpOnly` (no JWT), justificada por revocación instantánea en logout y cero dependencias nuevas. Esa misma sección documenta explícitamente la alternativa de adoptar `@convex-dev/auth`/`ctx.auth` nativo si algún día hace falta reactividad en tiempo real para datos protegidos — decisión que **no se toma aquí**: este ticket extiende el sistema custom existente, no lo sustituye por Convex Auth. Motivo: adoptar Convex Auth solo para el botón de Google metería un segundo sistema de sesiones en paralelo al ya existente, y las redirect URIs de Convex Auth viven en el dominio `*.convex.site` (dominio distinto al de la app), lo que obligaría a pasar el token de sesión por la URL para cruzar de dominio — justo lo que la cookie `HttpOnly` actual evita a propósito.

### Punto de partida: qué ya existe

Verificado leyendo el código real:
- `convex/schema.ts`: tabla `users` (name, email indexado `by_email`, passwordHash, role), `sessions` (userId, tokenHash SHA-256, expiresAt, índices `by_tokenHash`/`by_user`), `loginAttempts` (rate limiting).
- `convex/auth.ts::login`: normaliza email → comprueba rate limit (`convex/lib/rateLimit.ts`) → busca por `by_email` → `verifyPassword` (`convex/lib/password.ts`, PBKDF2 600k iteraciones, tiempo constante, mitigación de timing con `DUMMY_PASSWORD_HASH`) → genera token opaco (`convex/lib/token.ts`) → inserta en `sessions` → devuelve `{success, token, role}` o `{success:false, error}` genérico.
- `src/lib/auth/actions.ts::loginAction`: shuttle fino — coge form data, llama a `fetchMutation(api.auth.login, ...)`, si OK llama `setSessionCookie` + `redirect()` según rol.
- `src/lib/auth/cookie.ts`, `dal.ts`, `constants.ts`: cookie `httpOnly`/`secure` en prod/`sameSite:lax`/30 días; `getSession()`/`getUser()` como fuente de verdad real (Convex), `src/proxy.ts` como check optimista de solo existencia de cookie.
- `src/app/(auth)/login/page.tsx` + `LoginForm.tsx`: Server Component + formulario cliente vía Server Action (`useActionState`).
- Nada de esto usa librerías de auth externas — todo el crypto es manual con Web Crypto API. Sin dependencias `next-auth`/`@convex-dev/auth`/`better-auth` en `package.json`.

## Decisiones fijadas

1. **Next.js habla con Google por HTTP; Convex solo recibe el resultado ya verificado.** Convex `mutation` no puede hacer `fetch` (solo `action` con `"use node"` puede, y eso añade complejidad de runtime que no hace falta aquí). El Route Handler de Next.js hace el intercambio OAuth completo y llama a una mutation nueva de Convex solo con el email ya verificado — mismo reparto de responsabilidades que ya existe hoy entre `actions.ts` (orquestación HTTP) y `auth.ts` (lógica de negocio/datos).

2. **Hallazgo de seguridad y su corrección: `loginWithGoogle` no puede ser una mutation pública que solo reciba `email`.** Sin más protección, sería un bypass total de login: cualquiera con el `NEXT_PUBLIC_CONVEX_URL` (público, está en el bundle JS) podría invocarla directamente contra el endpoint de Convex, sin pasar nunca por Google, y llevarse una sesión válida de 30 días de cualquier email ya provisionado — sin password, sin rate limit. Corrección: segundo argumento `serverKey`, secreto compartido conocido solo por el servidor Next.js (`.env.local`, nunca en el bundle cliente) y por el entorno de Convex (`npx convex env set`), comparado en **tiempo constante** antes de mirar `users`. Sin el secreto correcto, la mutation devuelve el mismo error genérico que "email no provisionado" — indistinguible.

   Alternativa considerada y descartada: `internalMutation` + `ConvexHttpClient.setAdminAuth(deployKey)` (así invoca `npx convex run` a `seedUser` hoy). Descartada porque `setAdminAuth` está marcado `@internal` en el SDK de Convex (no es API pública estable) y `convex/nextjs`'s `fetchMutation` — lo que ya usa `loginAction` — está tipado solo para `FunctionReference<"mutation","public">`, no compila contra `internal.*`. El secreto compartido por argumento reusa el helper ya existente (`fetchMutation`/`api.*`) sin cliente HTTP alternativo, y es un secreto de alcance mucho más estrecho que el deploy key (que da acceso admin a todo el deployment).

3. **Verificación del email: endpoint `userinfo` de Google con el `access_token`, no decodificar el `id_token` a mano.** `GET https://openidconnect.googleapis.com/v1/userinfo` con `Authorization: Bearer <access_token>` devuelve `{email, email_verified, ...}` ya validado del lado de Google. Verificar la firma de un JWT a mano (JWKS, rotación de claves) es complejidad real sin beneficio proporcional para un login interno de 2 usuarios — una llamada HTTP más es coste despreciable.

4. **Protección CSRF con `state`**: nonce de 32 bytes (`crypto.getRandomValues`, mismo patrón que `generateOpaqueToken` en `convex/lib/token.ts`, pero implementado en `src/` sin importar de `convex/lib/*` — runtimes distintos, mismo criterio de no cruzar imports entre `convex/` y `src/` que ya sigue el resto del repo), guardado en cookie `google_oauth_state` (`httpOnly`, `sameSite:"lax"` — no `"strict"`, porque la cookie debe sobrevivir a la navegación top-level entrante que hace Google al volver a `/api/auth/google/callback`, y `strict` no lo garantiza —, `path:"/api/auth/google"`, 10 minutos), comparado por igualdad de string (`!==`) contra el `state` que devuelve Google, y borrado tras un solo uso. No hace falta comparación en tiempo constante aquí (a diferencia de `serverKey`/password): `state` no es un secreto que un atacante intente adivinar por timing, es un nonce anti-CSRF verificado contra su propia cookie `httpOnly` — un atacante que ya pudiera leer/fijar esa cookie tendría un problema mayor que timing.

5. **Sin PKCE.** Cliente confidencial (el `client_secret` vive solo en el servidor, nunca en el navegador) — PKCE está pensado para clientes públicos que no pueden proteger un secreto. Complejidad sin beneficio proporcional aquí.

6. **Sin rate limiting adicional en `loginWithGoogle`, ni reutilización de `loginAttempts`.** Con el `serverKey` correcto no hay vector de fuerza bruta por email (no hay password que adivinar; cada intento exige haber completado antes un login real en Google). Bloquear también el login por Google porque alguien esté fallando la password sería una regresión de disponibilidad sin beneficio de seguridad real.

7. **`GOOGLE_OAUTH_REDIRECT_URI` es una env var explícita y fija, no derivada de `request`/headers.** Las dos URIs exactas ya se conocen de antemano (dev y prod), así que no hay ninguna ventaja en derivarlas dinámicamente — solo riesgo: Railway está detrás de su propio proxy, y construir la URI desde `host`/`x-forwarded-proto` introduce justo la clase de bug que Google rechaza sin piedad (mismatch exacto = error). Un único valor, leído por el mismo helper en los dos pasos del intercambio (construir la URL de autorización y canjear el código), elimina la ambigüedad.

8. **Solo cambia el `email` de Marta, nunca el `name`.** Sigue siendo `"Marta"` en toda la UI — evita romper los dos asserts E2E que comprueban el saludo literal `"Hola, Marta"` (`e2e/auth-marta.setup.ts:25`, `e2e/panel-flow.spec.ts:104`).

9. **Todo fallo del flujo de Google colapsa en el mismo mensaje genérico**, igual que ya hace `GENERIC_ERROR` en el login por password (que tampoco distingue "email no existe" de "password incorrecta"): `state` inválido, error/cancelación de Google, email no verificado, email no provisionado o fallo de red → mismo redirect `/login?error=google` y mismo texto en pantalla. El motivo real del fallo solo se loguea server-side (`console.error`), nunca llega al cliente — sin oráculo de enumeración.

10. **Sin cambios en `convex/schema.ts`.** El matching es solo por email verificado contra `users.by_email`, sin campo `googleSub`/`provider` nuevo — no hace falta paso de "vincular cuenta" (confirmado por la usuaria: la vinculación es automática por email).

## `convex/lib/session.ts` (NUEVO)

Extrae el bloque "generar token, hashear, insertar en `sessions`", hoy inline en `login` y necesario también en `loginWithGoogle`.

```ts
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { generateOpaqueToken, hashToken } from "./token";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 días — sesión persistente, mismo criterio que hoy

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

## `convex/lib/password.ts` (EDITAR)

Único cambio: `constantTimeEqual` pasa de función privada a `export function constantTimeEqual(...)`. Se reutiliza para comparar `serverKey`. Sin más cambios — el resto del archivo (PBKDF2, `DUMMY_PASSWORD_HASH`) queda intacto.

## `convex/auth.ts` (EDITAR)

- `login`: sustituir el bloque manual de token/hash/insert por `const { token } = await createSession(ctx, user._id);`. Se retira el import/constante `SESSION_TTL_MS` local (vive ahora en `convex/lib/session.ts`). Sin cambio de comportamiento observable.
- Nueva mutation:

```ts
import { createSession } from "./lib/session";
import { constantTimeEqual } from "./lib/password";

const GOOGLE_LOGIN_ENV_VAR = "GOOGLE_LOGIN_SHARED_SECRET";
const GOOGLE_GENERIC_ERROR = "No se pudo iniciar sesión con Google";

export const loginWithGoogle = mutation({
  args: { email: v.string(), serverKey: v.string() },
  returns: v.union(
    v.object({ success: v.literal(true), token: v.string(), role: roleValidator }),
    v.object({ success: v.literal(false), error: v.string() }),
  ),
  handler: async (ctx, args) => {
    // Invariante de seguridad: esta mutation CONFÍA en que `email` ya viene
    // verificado por Google (email_verified === true) — esa verificación
    // ocurre en el Route Handler de Next.js, antes de llamar aquí. Nunca
    // hace ctx.db.insert sobre "users" bajo ninguna circunstancia: el alta
    // sigue cerrada, esta mutation solo autentica a quien ya existe.
    const expectedKey = process.env[GOOGLE_LOGIN_ENV_VAR];
    const keyOk =
      !!expectedKey &&
      constantTimeEqual(
        new TextEncoder().encode(args.serverKey),
        new TextEncoder().encode(expectedKey),
      );
    // Sin distinguir "serverKey inválido" de "email no provisionado": solo
    // nuestro propio Route Handler conoce serverKey (nunca el navegador),
    // así que un mismatch aquí solo puede venir de un caller que se está
    // saltando el flujo de Google por completo.
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
```

Sin rate limiting propio (decisión 6) — no toca `loginAttempts`.

## `src/lib/auth/constants.ts` (EDITAR)

```ts
export const SESSION_COOKIE_NAME = "session";
// Cookie de corta duración, solo para el flujo /api/auth/google/* — nunca
// contiene identidad, solo el nonce anti-CSRF.
export const OAUTH_STATE_COOKIE_NAME = "google_oauth_state";
```

## `src/lib/auth/cookie.ts` (EDITAR)

Añade, junto a las funciones existentes (mismo estilo: `httpOnly`, `secure` en producción):

```ts
const OAUTH_STATE_TTL_SECONDS = 10 * 60; // 10 min — solo dura lo que tarda el consentimiento de Google

export async function setOAuthStateCookie(state: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(OAUTH_STATE_COOKIE_NAME, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax", // no "strict": debe sobrevivir a la navegación entrante desde accounts.google.com
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

## `src/lib/auth/dal.ts` (EDITAR)

Añade helper compartido para no duplicar el ternario rol→ruta entre `loginAction` y el callback de Google:

```ts
export function landingPathForRole(role: Role): string {
  return role === "rep" ? "/pendientes" : "/panel";
}
```

## `src/lib/auth/actions.ts` (EDITAR)

`loginAction` usa `redirect(landingPathForRole(result.role))` en vez del ternario inline. Sin más cambios — `logoutAction` queda igual.

## `src/lib/auth/google.ts` (NUEVO)

Toda la lógica "hablar con Google", fuera de los route handlers (que quedan finos, mismo criterio que `actions.ts`):

```ts
export function getGoogleRedirectUri(): string {
  const uri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!uri) throw new Error("Falta GOOGLE_OAUTH_REDIRECT_URI en el entorno");
  return uri;
}

export function generateOAuthState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

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

export function buildGoogleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: getGoogleClientId(),
    redirect_uri: getGoogleRedirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCodeForAccessToken(code: string): Promise<string> {
  const params = new URLSearchParams({
    client_id: getGoogleClientId(),
    client_secret: getGoogleClientSecret(),
    code,
    redirect_uri: getGoogleRedirectUri(), // mismo valor exacto que en buildGoogleAuthUrl
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

## `src/app/api/auth/google/start/route.ts` (NUEVO)

```ts
import { redirect } from "next/navigation";
import { setOAuthStateCookie } from "@/lib/auth/cookie";
import { buildGoogleAuthUrl, generateOAuthState } from "@/lib/auth/google";

export async function GET() {
  const state = generateOAuthState();
  await setOAuthStateCookie(state);
  redirect(buildGoogleAuthUrl(state));
}
```

Runtime Node.js por defecto (no declarar `edge`, mismo criterio que `src/proxy.ts`).

## `src/app/api/auth/google/callback/route.ts` (NUEVO)

Punto de cuidado: `redirect()` de `next/navigation` lanza internamente, y la doc de Next.js pide no llamarlo dentro de un `try`/`catch`. Todo el trabajo con Google/Convex se aísla en una función interna que nunca redirige; los `redirect()` solo viven en el handler exterior.

```ts
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { fetchMutation } from "convex/nextjs";
import { api } from "../../../../../../convex/_generated/api";
import { clearOAuthStateCookie, readOAuthStateCookie, setSessionCookie } from "@/lib/auth/cookie";
import { exchangeCodeForAccessToken, fetchVerifiedGoogleEmail } from "@/lib/auth/google";
import { landingPathForRole } from "@/lib/auth/dal";

type Result = { ok: true; token: string; role: "rep" | "supervisor" } | { ok: false; reason: string };

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
  await clearOAuthStateCookie(); // de un solo uso, se borra siempre, éxito o no

  if (!result.ok) {
    console.error("[google-auth] callback falló:", result.reason);
    redirect("/login?error=google");
  }

  await setSessionCookie(result.token);
  redirect(landingPathForRole(result.role));
}
```

## `src/app/(auth)/login/page.tsx` (EDITAR)

```tsx
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getSession();
  if (user) redirect(landingPathForRole(user.role));

  const { error } = await searchParams;
  const googleError = error === "google";

  return (
    // ... resto igual, pasando el nuevo prop:
    <LoginForm initialError={googleError ? "No se pudo iniciar sesión con Google. Si tu cuenta no está registrada en el CRM, contacta con un administrador." : undefined} />
  );
}
```

Usa `searchParams` como prop server-side (mismo patrón ya usado con `params` en `contactos/[id]/page.tsx`), no `useSearchParams()` cliente — evita el requisito de `<Suspense>` y mantiene `page.tsx` como única fuente de la lógica de "¿hay error?".

## `src/app/(auth)/login/LoginForm.tsx` (EDITAR)

- Nuevo prop `initialError?: string`.
- `const displayError = state?.error ?? initialError;` reemplaza `state?.error` en la condición del bloque de alerta existente — misma estructura, mismo `role="alert"`.
- Bajo el botón "Entrar": separador visual ("o") + `<a href="/api/auth/google/start">` con estilo calcado del `Button` variant secundario (fondo `var(--color-surface)`, borde `var(--color-border)`, radio `var(--radius-md)`, 44px alto) + icono "G" (nuevo `GoogleIcon()` inline SVG, mismo patrón que `EyeIcon`/`AlertIcon`/`SpinnerIcon` ya en el archivo) + texto "Entrar con Google". `<a>` real, sin `onClick`, sin JS.

## `README.md` (EDITAR)

Nueva subsección bajo "Autenticación y roles": flujo (convive con password, alta sigue cerrada, matching por email verificado), tabla de env vars nuevas, las dos redirect URIs exactas, y nota explícita de que producción queda fuera de alcance en este ticket.

## `.env.local.example` (EDITAR)

```
# Google OAuth ("Entrar con Google") — credenciales ya creadas en Google Cloud Console
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
# Debe coincidir EXACTAMENTE con el mismo valor puesto en Convex vía:
#   npx convex env set GOOGLE_LOGIN_SHARED_SECRET <valor>
GOOGLE_LOGIN_SHARED_SECRET=
```

## `.env.test.local.example` y `.env.test.local` (EDITAR)

`E2E_MARTA_EMAIL=marta@test.local` → `E2E_MARTA_EMAIL=mistumonso@gmail.com` en ambos (el segundo es local/gitignored, se actualiza a mano al instalar). Sin más cambios en `e2e/` — al no tocar `name`, ningún assert existente se rompe (ver decisión 8).

## `e2e/google-auth.spec.ts` (NUEVO)

Dos casos que no requieren cuenta real de Google, corriendo sin sesión (sin `storageState`):
- `GET /api/auth/google/start` (`page.request.get(url, { maxRedirects: 0 })`) → `Set-Cookie` de `google_oauth_state` presente; header `Location` apunta a `https://accounts.google.com/o/oauth2/v2/auth` con `client_id`/`redirect_uri`/`scope=openid email profile`/`state` en la query; y el valor de `state` en la query **coincide exactamente** con el valor puesto en `Set-Cookie` (no solo que ambos existan por separado).
- `GET /api/auth/google/callback` sin cookie de estado, o con `state` que no matchea → redirect a `/login?error=google`.

## `playwright.config.ts` (EDITAR)

Nuevo project sin `dependencies` ni `storageState` (no toca los projects de Carlos/Marta):
```ts
{
  name: "chromium-unauth",
  testMatch: ["google-auth.spec.ts"],
  use: { ...devices["Desktop Chrome"] },
},
```

## Fuera de alcance (explícito)

- Producción: ni el deployment de Convex de prod ni el `email` de Marta ahí se tocan en este ticket — depende de un fix aparte ya conocido ([[project-crm-deploy-workflow-change-pending]]).
- Migración a `@convex-dev/auth`/Convex Auth nativo — decisión ya descartada en MIS-7 y reconfirmada aquí (ver "Decisión arquitectónica").
- Vinculación explícita de cuenta ("¿quieres asociar esta cuenta de Google a tu usuario?") — el matching es automático por email verificado, sin paso intermedio, por decisión de la usuaria.
- Cobertura E2E de un intercambio de código real contra Google — requeriría una cuenta de Google real (no viable en CI) o mockear los endpoints de Google; se documenta como mejora futura posible, no se implementa aquí.

## Verificación end-to-end (manual, tras instalar)

1. Pegar la redirect URI de dev en Google Cloud Console (ya conocida), rellenar `.env.local` y `npx convex env set GOOGLE_LOGIN_SHARED_SECRET ...`.
2. Caso feliz: entrar con Google usando `mistumonso@gmail.com` (tras el cambio de email de Marta) → aterriza en `/panel` como Marta/supervisor, sesión indistinguible de un login por password.
3. Caso rechazo: entrar con una cuenta de Google cuyo email NO está en `users` → vuelve a `/login?error=google`, mensaje genérico, cero filas nuevas en `users` (comprobar en dashboard de Convex).
4. Cancelar en la pantalla de consentimiento de Google → mismo `/login?error=google`, sin excepción sin controlar.
5. Visitar `/api/auth/google/callback?code=x&state=y` directamente, sin pasar por `/start` → rechazo inmediato (state inválido), sin llamar a Google.
6. Confirmar que el login por contraseña de Carlos sigue funcionando exactamente igual (regresión cero en el refactor de `createSession`).
7. `npm run test:e2e` completo en verde, incluyendo `google-auth.spec.ts` y las specs existentes de Carlos/Marta sin cambios.

## Archivos afectados

| Archivo | Tipo |
|---|---|
| `convex/lib/session.ts` | NUEVO |
| `convex/lib/password.ts` | EDITAR (export `constantTimeEqual`) |
| `convex/auth.ts` | EDITAR (`login` reusa `createSession`; nueva mutation `loginWithGoogle`) |
| `src/lib/auth/constants.ts` | EDITAR |
| `src/lib/auth/cookie.ts` | EDITAR |
| `src/lib/auth/dal.ts` | EDITAR |
| `src/lib/auth/actions.ts` | EDITAR |
| `src/lib/auth/google.ts` | NUEVO |
| `src/app/api/auth/google/start/route.ts` | NUEVO |
| `src/app/api/auth/google/callback/route.ts` | NUEVO |
| `src/app/(auth)/login/page.tsx` | EDITAR |
| `src/app/(auth)/login/LoginForm.tsx` | EDITAR |
| `README.md` | EDITAR |
| `.env.local.example` | EDITAR |
| `.env.test.local.example` | EDITAR |
| `e2e/google-auth.spec.ts` | NUEVO |
| `playwright.config.ts` | EDITAR |

Fuera de `CODIGO/`, operación de datos aparte (no es código): patch del `email` de Marta en dev vía `npx convex run` o dashboard de Convex.

## Auditoría (ronda 1) — NO-GO, corregido en esta versión (v2)

| # | Hallazgo | Severidad | Resolución |
|---|---|---|---|
| 1 | Import de `api` en `src/app/api/auth/google/callback/route.ts` mal calculado: ese archivo está 6 directorios bajo la raíz (`src/app/api/auth/google/callback/`), el plan tenía `../../../../../convex/_generated/api` (5 niveles, resuelve a `src/convex/_generated/api`, inexistente) | Major (bloqueante) | Corregido a `../../../../../../convex/_generated/api` (6 niveles) — mismo criterio de conteo que `src/lib/auth/actions.ts:6` (3 niveles, 3 directorios de profundidad) |
| 2 | `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` usados con `process.env.X!` (non-null assertion) en `src/lib/auth/google.ts`, sin validar como sí hace `getGoogleRedirectUri()` | Menor | Añadidos `getGoogleClientId()`/`getGoogleClientSecret()`, mismo patrón que `getGoogleRedirectUri()` — lanzan error local claro si falta la variable |
| 3 | Texto de "Seguridad" decía "`state` comparado byte a byte", pero el código usa `!==` (comparación de string normal) | Menor | Texto corregido para coincidir con el código; justificado por qué no hace falta tiempo constante aquí (`state` no es un secreto adivinable por timing, va protegido por cookie `httpOnly`) |
| 4 | Test de `/api/auth/google/start` solo comprobaba que `state` de la URL y la cookie existieran, no que coincidieran entre sí | Menor | Ampliado el caso de test para comparar ambos valores explícitamente |

Deuda enviada a follow-up por el propio auditor (no se hace en este ticket): PKCE como capa adicional, persistir `googleSub`/`provider` para vinculación fuerte, E2E de un intercambio de código real o mockeado contra Google.

## Puntos abiertos (no bloqueantes)

- Requiere que la usuaria tenga (o cree) las credenciales OAuth de Google Cloud Console con las dos redirect URIs ya registradas (dev + prod) — confirmado que ya están dadas de alta.
- `GOOGLE_LOGIN_SHARED_SECRET` debe generarse (p. ej. `openssl rand -base64 32`) y ponerse igual en `.env.local` y en Convex — paso manual de instalación, no de código.

## Verificación — resultados reales (instalado en `feature/mis-260-login-google`)

- `npx tsc --noEmit`: limpio.
- `npm run lint`: limpio (1 warning preexistente en `Avatar.jsx`, ajeno a este ticket).
- `npm run build`: correcto — `/api/auth/google/start` y `/api/auth/google/callback` aparecen como rutas dinámicas reales.
- Email de Marta parcheado en dev (`dutiful-mole-111`): `mistumonso@gmail.com`, `name` intacto ("Marta"). Verificado con `npx convex data users`.
- `GOOGLE_LOGIN_SHARED_SECRET` generado y confirmado idéntico en `.env.local` y en Convex dev (`npx convex env get`).
- E2E `e2e/google-auth.spec.ts` (3/3 OK) — incluye el fix de un bug real encontrado en el propio test (no en la app): `getByRole("alert")` matcheaba también el `__next-route-announcer__` de Next.js; corregido a `getByText(...)`.
- E2E `auth.setup.ts` + `auth-marta.setup.ts` (2/2 OK) — login por contraseña de Carlos y Marta (con su email nuevo) funciona exactamente igual tras el refactor de `createSession`.
- **Hallazgo no relacionado con MIS-260**: la suite completa tiene 6 fallos preexistentes (`edge-cases.spec.ts`, `full-flow.spec.ts`, `role-gating.spec.ts` — todos con el mismo patrón: un diálogo de "Guardar" se queda abierto con los campos deshabilitados). Confirmado con `git stash` que reproduce igual en `main`, sin ningún cambio de este ticket — no es una regresión de MIS-260. Reportado a la usuaria, no investigado más a fondo aquí (fuera de alcance).

Pendiente, requiere acción manual de la usuaria (no automatizable por el agente): `GOOGLE_CLIENT_SECRET` en `.env.local`, y la prueba manual del "caso feliz" completo con una cuenta de Google real.

## Estado

**Plan auditado — GO (ronda 2).** Ronda 1 fue NO-GO por el import mal calculado (M1), corregido y confirmado en ronda 2 junto con las 3 sugerencias menores, sin nuevos hallazgos. Código generado en `CODIGO/MIS-260-login-google/` (con `CODIGO-COMPLETO.md`), pendiente de su propia auditoría de código antes de instalar. Sigue sin tocarse el email de Marta en dev, sin rama creada — eso ocurre al instalar, tras el GO de código.

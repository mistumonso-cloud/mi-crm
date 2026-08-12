# MIS-288 — Código completo (Fase 1A: perímetro, fail-closed y migración de endpoint)

> Seguridad del login — Fase 1A del plan de corrección de la auditoría.
> **Plan:** [PLANS/PLAN-CORRECCION-SEGURIDAD-LOGIN-2026-08-10.md](../../PLANS/PLAN-CORRECCION-SEGURIDAD-LOGIN-2026-08-10.md) (GO en ronda 6)
> **Informe:** [PLANS/AUDITORIA-SEGURIDAD-LOGIN-2026-08-10.md](../../PLANS/AUDITORIA-SEGURIDAD-LOGIN-2026-08-10.md)
> **Spike de infra:** [PLANS/MIS-288-spike-1A0.md](../../PLANS/MIS-288-spike-1A0.md)
> **Rama:** `mistumonso/mis-288-perimetro-fase-1a` · **sin commit ni push todavía** (a la espera de esta auditoría).
> **Tickets:** MIS-288 (esta fase) → MIS-289 (1A-bis) → MIS-290/291 (1B) → MIS-292/293 (fases 2/3) · MIS-294 (Tunnel, defensa en profundidad).

## Ronda 2 — corrección de M-MIS288-1

**Hallazgo (Major, correcto):** en el test `requestPasswordResetCode con serverKey inválido no entrega código`, la "ventana de observación" usaba `expect.poll(...).toBeNull()`, que se satisface con el **primer** `null` (antes de que corra el scheduler) y **no espera nada** — falso verde: una entrega programada por error no se habría detectado.

**Corrección:** ventana negativa REAL — se sondea el outbox durante toda la ventana (4s, cada 200ms) y se falla en cuanto aparezca un código; solo pasa si se mantiene `null` toda la ventana. Se conserva el control positivo posterior (con clave buena sí llega). **Evidencia:** el test pasa ahora de 657ms a **4.9s** (espera la ventana entera). `chromium-secrets`: **19/19 verde**.

También, dos sugerencias Media aplicadas:
- `verifyResetCode` con clave inválida se llama **6 veces** antes del control positivo — prueba que la clave se comprueba ANTES del rate limit `resetcode:<email>` (si no, 5+ lo agotarían y el control positivo fallaría).
- La exención de `/api/health` en `src/proxy.ts` se restringe a **GET/HEAD**; cualquier otro método pasa por el perímetro normal (el route handler solo expone GET → 405).

## Qué cierra esta fase

La raíz de los tres hallazgos altos (A1/A2/A3) es que el rate limiting depende de un `ipHint` que el llamante elige: las mutations de auth son públicas y se puede llamar a Convex directamente falseando la IP, o incluso pegar al origen de Railway sin pasar por Cloudflare (probado en el spike: la IP cruda responde con el host canónico). Esta fase ataca el perímetro y la puerta de entrada a Convex.

**Invariantes** (contrato del plan):

- **I1 — Origen autenticado.** Ninguna petición que no venga de Cloudflare alcanza ninguna ruta dinámica. `src/proxy.ts` exige `X-Origin-Auth` (secreto que Cloudflare inyecta) en producción. Cierra en **esta fase**.
- **I2 — Fail-closed.** En producción, si falta una variable de defensa, la app deja de servir (503); `/api/health` es guardián de deploy. Cierra en **esta fase**.
- **I3 — Convex cerrado.** Las funciones de auth rechazan toda llamada sin `serverKey` válido, antes de cualquier efecto lateral. `loginWithPassword` (nuevo) lo exige ya; las de recuperación en modo **expand** (opcional-validado-si-viene). **I3 se cierra en 1A-bis (MIS-289)**, cuando se retire el viejo `auth.login` y el `serverKey` pase a obligatorio.

## Decisiones clave para el auditor

1. **Migración de endpoint sin caída (M-R4-1 del plan).** `auth.login` (mutation, sin serverKey) se mantiene intacto durante la ventana de convivencia; se publica `auth.loginWithPassword` **como action desde 1A** (para que 1B cambie sus tripas sin migrar de tipo). El frontend pasa a usar el nuevo. El viejo se retira en 1A-bis. Cero downtime en los dos sentidos del despliegue.
2. **Expand/contract para las funciones de recuperación (opción A, aprobada por el usuario).** `serverKey` entra **opcional** en `requestPasswordResetCode`/`verifyResetCode`/`resetPasswordWithTicket`, validado solo si viene; el frontend ya lo envía. 1A-bis lo hará obligatorio y cerrará el camino legacy. Así el flujo de recuperación no cae durante el despliegue.
3. **`serverKeyMatches` devuelve booleano, no lanza** — cada función produce su propio error genérico (anti-enumeración). `assertServerKey` (que lanza) es un envoltorio para el harness de test. Fail-closed: sin la env var, nada coincide.
4. **CSP: `frame-ancestors 'none'` arregla el clickjacking (el hallazgo M2).** `script-src`/`style-src` conservan `'unsafe-inline'` (sin nonce Next no arranca, y el nonce no cubre atributos `style={{}}`). `'unsafe-eval'` **solo en desarrollo** (React lo necesita en dev; en producción no se incluye). El endurecimiento con nonce es fase 3.
5. **`/api/health` como guardián de deploy** (refinamiento del spike, aprobado): exenta del secreto de origen (la sonda interna de Railway no lo lleva) en GET/HEAD, pero comprueba la **presencia** de las variables obligatorias y devuelve 503 si falta alguna → un deploy mal configurado no se promociona. Nunca lee el valor de un secreto ni toca ningún servicio.
6. **IP fiable** desde `cf-connecting-ip` (`src/lib/auth/clientIp.ts`), sin fallback a `x-forwarded-for`. Su fiabilidad se apoya en el secreto de origen: nada que no venga de Cloudflare llega hasta ahí.

## Qué se difiere a 1A-bis (MIS-289)

- Retirar `auth.login` y hacer el `serverKey` **obligatorio** en las 3 funciones de recuperación (cierra I3).
- Migrar las **15 llamadas existentes** a las funciones de recuperación en `e2e/password-reset-invariants.spec.ts` a enviar `serverKey` (funcionan en modo expand ahora; se migran junto al contract para no tocarlas dos veces).

## Notas de despliegue (del lado de infra, no del código)

- **Provisionar en producción antes de desplegar**: `AUTH_SERVER_KEY` y `ORIGIN_SHARED_SECRET` en Convex prod **Y** en Railway (deben coincidir), `APP_CANONICAL_HOST` en Railway, y la Transform Rule de Cloudflare que inyecta `X-Origin-Auth` con `Set` (no `Add`). Orden completo en el plan (1A.9).
- **`AUTH_SERVER_KEY` en Convex prod se comprueba por separado**: `/api/health` solo conoce la copia de Railway; el predeploy debe verificar además que la variable existe y coincide en el deployment de Convex de producción.

## Validación

- `npm run build` ✅ (incluye typecheck de `convex/` y `e2e/`) · `npm run lint` ✅
- **e2e project `chromium-secrets`: 19/19 verde**, incluidos los 4 tests de rechazo I3 (login + las 3 funciones de recuperación). El de la ventana negativa tarda ~4.9s (espera la ventana entera).
- e2e suite completa: verde (los fallos vistos fueron flakes transitorios de red a Convex que pasaron al reintentar; CI tiene `retries:1`).
- Provisionado: `AUTH_SERVER_KEY` en Convex dev + `.env.local`/`.env.test.local` + **secret de GitHub** (CI desbloqueado).

## Índice de ficheros

**Nuevos**
- `convex/lib/serverKey.ts` — `serverKeyMatches`/`assertServerKey`, única implementación del secreto de servidor.
- `src/lib/auth/clientIp.ts` — IP fiable desde `cf-connecting-ip`.
- `src/app/api/health/route.ts` — health + guardián de deploy.

**Perímetro y config**
- `src/proxy.ts` — secreto de origen (clave doble para rotar), host canónico, fail-closed, matcher ampliado, exención de health en GET/HEAD.
- `next.config.ts` — cabeceras de seguridad, CSP, `serverActions.allowedOrigins`, `images.unoptimized`.
- `railway.json` — `healthcheckPath: /api/health`.
- `.env.local.example` / `.env.test.local.example` / `.github/workflows/ci.yml` — documentar/propagar `AUTH_SERVER_KEY`.

**Convex (auth)**
- `convex/auth.ts` — `performLogin` (helper compartido) · `login` (viejo, intacto) · `_loginCore` (internal) · `loginWithPassword` (action con serverKey) · `loginWithGoogle` al helper común.
- `convex/passwordReset.ts` — `serverKey` opcional (expand) en las 3 funciones.
- `convex/testSupport.ts` — `assertTestKey` → `assertServerKey` (una sola implementación).

**Activación y e2e**
- `src/lib/auth/actions.ts` — `loginAction` usa `loginWithPassword` + `getClientIp`; las actions de recuperación envían `serverKey`.
- `e2e/helpers/test-support.ts` — `authServerKey()` + `loginSucceeds` por el endpoint nuevo.
- `e2e/test-support.spec.ts` — test I3 de login + bucle de bloqueo migrado.
- `e2e/password-reset-invariants.spec.ts` — 3 tests I3 de recuperación (con la ventana negativa real).

---

# Código completo

## `convex/lib/serverKey.ts`

```ts
// MIS-288 (1A.5): "esta llamada viene de nuestro servidor de Next.js".
//
// Única implementación en el repo del patrón que hasta ahora repetían
// loginWithGoogle (convex/auth.ts) y assertTestKey (convex/testSupport.ts):
// comparar un secreto compartido en tiempo constante contra una env var que
// solo conoce el servidor y este deployment de Convex. NEXT_PUBLIC_CONVEX_URL
// es público (está en el bundle JS), así que sin esto cualquier navegador
// podría invocar las mutations de autenticación directamente.

import { constantTimeEqual } from "./password";

// Devuelve booleano (no lanza) para que cada función pública produzca SU PROPIO
// error genérico — mismo criterio anti-enumeración que el resto del módulo: un
// serverKey incorrecto es indistinguible de "email no existe".
//
// FAIL-CLOSED: sin la env var configurada, `expected` es undefined y la
// comparación devuelve false — ningún valor de serverKey puede pasar. En
// producción la ausencia de AUTH_SERVER_KEY deja las funciones cerradas, no
// abiertas.
export function serverKeyMatches(provided: string, envVarName: string): boolean {
  const expected = process.env[envVarName];
  return (
    !!expected &&
    constantTimeEqual(
      new TextEncoder().encode(provided),
      new TextEncoder().encode(expected),
    )
  );
}

// Variante que lanza, para los call sites que no devuelven un error de dominio
// (el harness de test). Se construye sobre serverKeyMatches para que haya una
// sola comparación en tiempo constante en todo el repo.
export function assertServerKey(provided: string, envVarName: string): void {
  if (!serverKeyMatches(provided, envVarName)) {
    throw new Error("No autorizado");
  }
}

// Nombre de la env var del secreto de servidor de autenticación. Distinta de
// GOOGLE_LOGIN_SHARED_SECRET: mismo nivel de confianza, propósitos separados,
// rotables por separado. Se configura con:
//   npx convex env set AUTH_SERVER_KEY <valor>
export const AUTH_SERVER_KEY_ENV_VAR = "AUTH_SERVER_KEY";

```

## `convex/auth.ts`

```ts
import { ConvexError, v } from "convex/values";
import { action, internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { DUMMY_PASSWORD_HASH, verifyPassword } from "./lib/password";
import { serverKeyMatches, AUTH_SERVER_KEY_ENV_VAR } from "./lib/serverKey";
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

const loginResultValidator = v.union(
  v.object({ success: v.literal(true), token: v.string(), role: roleValidator }),
  v.object({ success: v.literal(false), error: v.string() }),
);

// Anotación explícita del resultado — rompe la inferencia circular que provoca
// que loginWithPassword (action) referencie internal.auth._loginCore, del mismo
// módulo: con el tipo de retorno explícito, TS resuelve el tipo de la action
// sin inferir su cuerpo.
type LoginResult =
  | { success: true; token: string; role: "rep" | "supervisor" }
  | { success: false; error: string };

// Lógica de login por password, compartida por el endpoint público ANTIGUO
// (`login`, en retirada en 1A-bis/MIS-289) y el núcleo interno nuevo
// (`_loginCore`, invocado por la action `loginWithPassword`). Es un helper, no
// una función registrada: corre dentro de una única transacción de mutation,
// con el KDF dentro — igual que hasta ahora. La reserva previa al KDF es 1B.
async function performLogin(
  ctx: MutationCtx,
  args: { email: string; password: string; ipHint?: string },
): Promise<LoginResult> {
  const emailKey = normalizeEmailKey(args.email);
  const ipKey = normalizeIpHint(args.ipHint ?? null);

  if (ipKey && (await isLocked(ctx, `ip:${ipKey}`))) {
    return { success: false, error: LOCKED_ERROR };
  }
  if (await isLocked(ctx, emailKey)) {
    return { success: false, error: LOCKED_ERROR };
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
    return { success: false, error: GENERIC_ERROR };
  }

  // Solo se resetea el contador por email, NO el de la IP (`ip:${ipKey}`) —
  // intencional: el contador de IP agrega intentos fallidos contra cualquier
  // email probado desde esa IP, como defensa contra un atacante que prueba
  // varias cuentas desde el mismo origen. Si un login correcto reseteara
  // también la IP, bastaría una credencial válida para "limpiar" el contador y
  // seguir probando otras cuentas desde la misma IP. Falsos positivos en redes
  // compartidas (oficina/NAT) aceptados como coste de esta capa best-effort.
  await resetAttempts(ctx, emailKey);

  const { token } = await createSession(ctx, user._id);

  return { success: true, token, role: user.role };
}

// Endpoint público ANTIGUO. Intacto (sin serverKey) durante la ventana de
// convivencia para no romper al frontend viejo. Lo retira 1A-bis (MIS-289),
// que es donde se cierra I3 para el login por password.
export const login = mutation({
  args: {
    email: v.string(),
    password: v.string(),
    ipHint: v.optional(v.string()),
  },
  returns: loginResultValidator,
  handler: async (ctx, args) => performLogin(ctx, args),
});

// Núcleo interno: no forma parte de api.*, ningún cliente externo puede
// invocarlo. Solo lo invoca la action loginWithPassword, tras validar serverKey.
export const _loginCore = internalMutation({
  args: {
    email: v.string(),
    password: v.string(),
    ipHint: v.optional(v.string()),
  },
  returns: loginResultValidator,
  handler: async (ctx, args) => performLogin(ctx, args),
});

// Endpoint público NUEVO (MIS-288, 1A.5). Es una ACTION, no una mutation, ya
// desde 1A — así 1B podrá cambiar sus tripas (reserva de cuota antes del KDF)
// sin migrar de tipo ni abrir una ventana de incompatibilidad. Exige serverKey:
// cierra I1 para el login por password. Una llamada directa a Convex sin la
// clave recibe el error genérico, indistinguible de un login fallido.
export const loginWithPassword = action({
  args: {
    email: v.string(),
    password: v.string(),
    ipHint: v.optional(v.string()),
    serverKey: v.string(),
  },
  returns: loginResultValidator,
  handler: async (ctx, args): Promise<LoginResult> => {
    if (!serverKeyMatches(args.serverKey, AUTH_SERVER_KEY_ENV_VAR)) {
      return { success: false as const, error: GENERIC_ERROR };
    }
    return await ctx.runMutation(internal.auth._loginCore, {
      email: args.email,
      password: args.password,
      ipHint: args.ipHint,
    });
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
    if (!serverKeyMatches(args.serverKey, GOOGLE_LOGIN_ENV_VAR)) {
      return { success: false as const, error: GOOGLE_GENERIC_ERROR };
    }

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

## `convex/passwordReset.ts`

```ts
// MIS-285: recuperación de contraseña por código (OTP) enviado por email con
// Resend. Depende del harness de MIS-286 (convex/testSupport.ts) para poder
// verificarse en e2e sin abrir un agujero de seguridad, y de las tablas
// `passwordResetCodes` / `testOutbox` que ya define el esquema de MIS-286.
//
// Anti-enumeración por RESPUESTA y por TIEMPO: `requestPasswordResetCode` no
// consulta `users` ni espera a Resend — solo rate-limita y programa el
// trabajo real vía scheduler, así que el tiempo de respuesta es idéntico
// exista o no la cuenta. Ver PLANS/MIS-285-recuperacion-contrasena-plan.md.

import { v } from "convex/values";
import { internalMutation, internalAction, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { constantTimeEqual, hashPassword } from "./lib/password";
import { serverKeyMatches, AUTH_SERVER_KEY_ENV_VAR } from "./lib/serverKey";
import { generateNumericCode, generateOpaqueToken, hashToken } from "./lib/token";
import {
  EMAIL_RATE_LIMIT,
  IP_RATE_LIMIT,
  isLocked,
  normalizeEmailKey,
  normalizeIpHint,
  recordFailedAttempt,
  resetAttempts,
} from "./lib/rateLimit";
import { sendPasswordResetCodeEmail } from "./lib/resend";
import { RESET_TEST_EMAIL } from "./lib/testIdentity";

const CODE_TTL_MS = 15 * 60 * 1000;
const TICKET_TTL_MS = 15 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const MAX_EMAIL_LENGTH = 254;
const CODE_FORMAT = /^\d{6}$/;
const GENERIC_CODE_ERROR = "Código incorrecto o caducado";
const TICKET_EXPIRED_ERROR = "La sesión de recuperación caducó, vuelve a empezar";
const PASSWORD_POLICY_ERROR = "La contraseña debe tener entre 8 y 128 caracteres";

function emailWithinLimits(normalized: string): boolean {
  return normalized.length > 0 && normalized.length <= MAX_EMAIL_LENGTH;
}

// 1. Mutation pública: rate-limita y programa el envío diferido. Nunca toca
// `users` ni espera a Resend — el tiempo de respuesta no debe delatar si el
// email existe.
export const requestPasswordResetCode = mutation({
  args: { email: v.string(), ipHint: v.optional(v.string()), serverKey: v.optional(v.string()) },
  returns: v.object({ ok: v.literal(true) }),
  handler: async (ctx, args) => {
    // MIS-288 (1A.5) — expand/contract: en 1A el serverKey es OPCIONAL y solo
    // se valida si viene (el frontend ya lo envía); si no viene, se acepta el
    // camino legacy para no romper al frontend viejo durante la ventana de
    // despliegue. 1A-bis (MIS-289) lo hará obligatorio y cerrará el hueco. Un
    // serverKey PRESENTE pero incorrecto responde {ok:true} sin programar nada:
    // mismo criterio anti-enumeración (no revela nada, no hace trabajo).
    if (args.serverKey !== undefined && !serverKeyMatches(args.serverKey, AUTH_SERVER_KEY_ENV_VAR)) {
      return { ok: true as const };
    }

    const normalizedEmail = normalizeEmailKey(args.email);
    // M13: un email fuera de los límites del contrato (vacío o >254) no llega
    // a construir claves de rate limit ni a programar trabajo — mismo
    // resultado público {ok:true} que cualquier otra solicitud, así que no
    // añade una forma nueva de distinguir entradas.
    if (!emailWithinLimits(normalizedEmail)) return { ok: true as const };

    const emailKey = `reset:${normalizedEmail}`;
    const ipKey = normalizeIpHint(args.ipHint ?? null);

    let allowed = !(await isLocked(ctx, emailKey));
    if (allowed && ipKey) allowed = !(await isLocked(ctx, `resetip:${ipKey}`));

    // Se contabilizan SOLICITUDES (no fallos): siempre se registra, exista o
    // no la cuenta — de lo contrario el contador delataría por sí mismo si
    // el email existe.
    await recordFailedAttempt(ctx, emailKey, EMAIL_RATE_LIMIT);
    if (ipKey) await recordFailedAttempt(ctx, `resetip:${ipKey}`, IP_RATE_LIMIT);

    await ctx.scheduler.runAfter(0, internal.passwordReset.deliverResetCode, {
      email: args.email,
      allowed,
    });
    return { ok: true as const };
  },
});

// 2. internalAction: única función de este módulo con `fetch` (Resend). Los
// errores se registran sin código, destinatario ni cuerpo.
export const deliverResetCode = internalAction({
  args: { email: v.string(), allowed: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!args.allowed) return null;

    const created = await ctx.runMutation(internal.passwordReset.createResetCode, {
      email: args.email,
    });
    if (!created) return null;

    // Solo la identidad dedicada del harness (MIS-286) deposita el código en
    // claro en el outbox de test — cualquier otro destinatario (pruebas
    // manuales con un email real incluidas) omite este paso sin más.
    if (normalizeEmailKey(created.email) === RESET_TEST_EMAIL) {
      await ctx.runMutation(internal.testSupport.recordOutbox, {
        email: created.email,
        code: created.code,
      });
    }

    try {
      await sendPasswordResetCodeEmail(created.email, created.name, created.code);
    } catch (err) {
      console.error("deliverResetCode: fallo al enviar con Resend", err instanceof Error ? err.message : err);
    }
    return null;
  },
});

// 3. internalMutation: busca el usuario, invalida códigos previos no usados
// y crea uno nuevo. Solo el ÚLTIMO código generado sigue siendo válido.
export const createResetCode = internalMutation({
  args: { email: v.string() },
  returns: v.union(
    v.object({ code: v.string(), email: v.string(), name: v.string() }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const emailKey = normalizeEmailKey(args.email);
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", emailKey))
      .unique();
    if (!user) return null;

    for (const row of await ctx.db
      .query("passwordResetCodes")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect()) {
      if (!row.usedAt) await ctx.db.delete(row._id);
    }

    const code = generateNumericCode(6);
    await ctx.db.insert("passwordResetCodes", {
      userId: user._id,
      codeHash: await hashToken(code),
      expiresAt: Date.now() + CODE_TTL_MS,
      attempts: 0,
    });

    // M12: un código nuevo debe poder verificarse aunque el anterior haya
    // agotado sus 5 intentos y bloqueado `resetcode:<email>` — si no se
    // resetea aquí, verifyResetCode rechaza el código nuevo (correcto o no)
    // por el candado del código viejo. Solo la clave por email: el contador
    // de IP (`resetip:<ip>`) es compartido entre cuentas y no se toca, mismo
    // criterio que el resto del rate limiting de este módulo.
    await resetAttempts(ctx, `resetcode:${emailKey}`);

    return { code, email: emailKey, name: user.name };
  },
});

// 4. Mutation pública: verifica el código y, si coincide, emite un ticket
// opaco de un solo uso que autoriza el cambio de contraseña.
export const verifyResetCode = mutation({
  args: { email: v.string(), code: v.string(), ipHint: v.optional(v.string()), serverKey: v.optional(v.string()) },
  returns: v.union(
    v.object({ ok: v.literal(true), ticket: v.string() }),
    v.object({ ok: v.literal(false), error: v.string() }),
  ),
  handler: async (ctx, args) => {
    // MIS-288 (1A.5) — expand/contract: serverKey opcional en 1A, obligatorio
    // en 1A-bis. Presente-pero-incorrecto → error genérico (indistinguible).
    if (args.serverKey !== undefined && !serverKeyMatches(args.serverKey, AUTH_SERVER_KEY_ENV_VAR)) {
      return { ok: false as const, error: GENERIC_CODE_ERROR };
    }

    const emailKey = normalizeEmailKey(args.email);

    // M13 (ronda 2): un email fuera del contrato (vacío o >254) se rechaza
    // ANTES de construir `resetcode:<email>` o de tocar el rate limit en
    // cualquier forma — ni lectura (isLocked) ni escritura (fail()). La
    // ronda 1 validaba esto DESPUÉS de ya haber consultado isLocked con la
    // clave sobredimensionada, lo que seguía dejando pasar la amplificación
    // que M13 debía cerrar.
    if (!emailWithinLimits(emailKey)) {
      return { ok: false as const, error: GENERIC_CODE_ERROR };
    }

    const rateLimitKey = `resetcode:${emailKey}`;
    const ipKey = normalizeIpHint(args.ipHint ?? null);

    if (await isLocked(ctx, rateLimitKey)) {
      return { ok: false as const, error: GENERIC_CODE_ERROR };
    }
    if (ipKey && (await isLocked(ctx, `resetip:${ipKey}`))) {
      return { ok: false as const, error: GENERIC_CODE_ERROR };
    }

    const fail = async () => {
      await recordFailedAttempt(ctx, rateLimitKey, EMAIL_RATE_LIMIT);
      if (ipKey) await recordFailedAttempt(ctx, `resetip:${ipKey}`, IP_RATE_LIMIT);
      return { ok: false as const, error: GENERIC_CODE_ERROR };
    };

    // El email ya es válido en este punto — un código con formato incorrecto
    // sí pasa por fail() y cuenta como intento, igual que un código válido
    // pero equivocado.
    if (!CODE_FORMAT.test(args.code)) return await fail();

    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", emailKey))
      .unique();

    if (!user) return await fail();

    const rows = await ctx.db
      .query("passwordResetCodes")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const active = rows.find(
      (row) => !row.usedAt && row.codeHash !== undefined && row.expiresAt > Date.now(),
    );
    if (!active || active.attempts >= MAX_CODE_ATTEMPTS) return await fail();

    const matches = constantTimeEqual(
      new TextEncoder().encode(await hashToken(args.code)),
      new TextEncoder().encode(active.codeHash as string),
    );
    if (!matches) {
      await ctx.db.patch(active._id, { attempts: active.attempts + 1 });
      return await fail();
    }

    const ticket = generateOpaqueToken();
    await ctx.db.patch(active._id, {
      codeHash: undefined, // consume el código: no puede volver a emitir tickets
      ticketHash: await hashToken(ticket),
      ticketExpiresAt: Date.now() + TICKET_TTL_MS,
    });
    await resetAttempts(ctx, rateLimitKey);

    return { ok: true as const, ticket };
  },
});

// 5. Mutation pública: cambia la contraseña e invalida TODAS las sesiones del
// usuario, atómicamente en la misma mutation.
export const resetPasswordWithTicket = mutation({
  args: { ticket: v.string(), newPassword: v.string(), serverKey: v.optional(v.string()) },
  returns: v.union(
    v.object({ ok: v.literal(true) }),
    v.object({ ok: v.literal(false), error: v.string() }),
  ),
  handler: async (ctx, args) => {
    // MIS-288 (1A.5) — expand/contract: serverKey opcional en 1A, obligatorio
    // en 1A-bis. Presente-pero-incorrecto → error genérico del flujo.
    if (args.serverKey !== undefined && !serverKeyMatches(args.serverKey, AUTH_SERVER_KEY_ENV_VAR)) {
      return { ok: false as const, error: TICKET_EXPIRED_ERROR };
    }

    if (args.newPassword.length < 8 || args.newPassword.length > 128) {
      return { ok: false as const, error: PASSWORD_POLICY_ERROR };
    }

    const ticketHash = await hashToken(args.ticket);
    const row = await ctx.db
      .query("passwordResetCodes")
      .withIndex("by_ticketHash", (q) => q.eq("ticketHash", ticketHash))
      .unique();

    if (!row || row.usedAt || !row.ticketExpiresAt || row.ticketExpiresAt < Date.now()) {
      return { ok: false as const, error: TICKET_EXPIRED_ERROR };
    }

    await ctx.db.patch(row.userId, { passwordHash: await hashPassword(args.newPassword) });
    await ctx.db.patch(row._id, { usedAt: Date.now() });

    for (const session of await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", row.userId))
      .collect()) {
      await ctx.db.delete(session._id);
    }

    return { ok: true as const };
  },
});

// 6. Cron diario (convex/crons.ts): purga filas caducadas para no acumular
// basura indefinidamente. No es un requisito de seguridad (los campos ya
// caducados se tratan como inválidos en cualquier lectura), solo higiene.
export const cleanupExpiredResetCodes = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db.query("passwordResetCodes").collect();
    let deleted = 0;
    for (const row of rows) {
      // Ya consumida (cambio de contraseña completado), o ningún camino
      // sigue siendo utilizable: el código expiró sin llegar a emitir
      // ticket, o el ticket emitido también expiró sin usarse.
      const consumed = row.usedAt !== undefined;
      const codeDead = row.codeHash === undefined || row.expiresAt < now;
      const ticketDead = row.ticketHash === undefined || (row.ticketExpiresAt ?? 0) < now;
      if (consumed || (codeDead && ticketDead)) {
        await ctx.db.delete(row._id);
        deleted++;
      }
    }
    return deleted;
  },
});

```

## `convex/testSupport.ts`

```ts
// MIS-286: harness seguro de pruebas e2e para el flujo de recuperación de
// contraseña (MIS-285).
//
// POR QUÉ ESTE MÓDULO EXISTE
// El código OTP llega por email y en BD solo se guarda su hash, así que un test
// no puede leerlo por medios normales. Este módulo abre la mínima puerta que lo
// permite — y la cierra con tres cerrojos independientes:
//
//   1. CREDENCIAL de alta entropía (`E2E_TEST_SUPPORT_KEY`) comparada en tiempo
//      constante y FAIL-CLOSED. En producción esa env var no existe, así que
//      todas estas funciones lanzan aunque el código esté desplegado.
//   2. IDENTIDAD DEDICADA: solo operan sobre RESET_TEST_EMAIL. Nunca pueden
//      tocar carlos@test.local, mistumonso@gmail.com ni ninguna cuenta real.
//   3. SECRETOS EFÍMEROS: la contraseña de esa identidad se genera en cada
//      llamada y solo se devuelve al llamante ya autenticado — no existe
//      ninguna contraseña válida en el repositorio.
//
// OJO con el alcance real de una filtración: desde MIS-251 el rol NO autoriza
// nada (ver convex/lib/authz.ts), así que la identidad dedicada tiene acceso
// completo de lectura/escritura al CRM de dev igual que cualquier usuario. Una
// filtración de E2E_TEST_SUPPORT_KEY exige ROTACIÓN INMEDIATA de la credencial
// (en Convex dev y en GitHub Secrets); lo que sí acota el cerrojo 2 es que el
// harness no pueda manipular las cuentas de Carlos y Marta.

import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { hashPassword } from "./lib/password";
import { assertServerKey } from "./lib/serverKey";
import { generateOpaqueToken } from "./lib/token";
import { normalizeEmailKey, resetAttempts } from "./lib/rateLimit";
import { RESET_TEST_EMAIL, TEST_SUPPORT_ENV_VAR } from "./lib/testIdentity";

const FORBIDDEN_IDENTITY = "Identidad no permitida";

// Cerrojo 1. Fail-closed vía assertServerKey (convex/lib/serverKey.ts): sin la
// env var configurada, `expected` es undefined y ningún serverKey puede pasar.
// Lanza "No autorizado", misma implementación en tiempo constante que el resto
// del repo (MIS-288, 1A.5).
function assertTestKey(serverKey: string): void {
  assertServerKey(serverKey, TEST_SUPPORT_ENV_VAR);
}

// Cerrojo 2. Devuelve el email ya normalizado para que quien lo llame use
// SIEMPRE la forma canónica en sus consultas.
function assertDedicatedIdentity(email: string): string {
  const key = normalizeEmailKey(email);
  if (key !== RESET_TEST_EMAIL) throw new Error(FORBIDDEN_IDENTITY);
  return key;
}

async function findTestUser(ctx: QueryCtx | MutationCtx) {
  return await ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", RESET_TEST_EMAIL))
    .unique();
}

// Claves de rate limit que pertenecen EXCLUSIVAMENTE a la identidad dedicada.
// Enumeración explícita a propósito: nunca se borra por prefijo, y nunca se
// tocan las claves `ip:` / `resetip:` porque son COMPARTIDAS entre usuarios y
// limpiarlas debilitaría el rate limiting real del deployment.
function rateLimitKeysForTestIdentity(): string[] {
  return [
    RESET_TEST_EMAIL, // login
    `reset:${RESET_TEST_EMAIL}`, // solicitudes de código
    `resetcode:${RESET_TEST_EMAIL}`, // intentos de código
  ];
}

// Reseed IDEMPOTENTE. Se llama al INICIO de cada spec (no en cleanup: un
// cleanup se salta si el test falla, y entonces la ejecución siguiente heredaría
// el bloqueo de rate limit y fallaría durante 15 minutos).
export const resetTestIdentity = mutation({
  args: { serverKey: v.string(), email: v.string() },
  returns: v.object({ password: v.string() }),
  handler: async (ctx, args) => {
    assertTestKey(args.serverKey);
    assertDedicatedIdentity(args.email);

    // Contraseña EFÍMERA: 32 bytes nuevos en cada llamada. Se devuelve en claro
    // solo aquí, al llamante ya autenticado por serverKey; en BD queda hasheada.
    const password = generateOpaqueToken();
    const passwordHash = await hashPassword(password);

    const existing = await findTestUser(ctx);
    const userId = existing
      ? (await ctx.db.patch(existing._id, { passwordHash }), existing._id)
      : await ctx.db.insert("users", {
          name: "Reset E2E",
          email: RESET_TEST_EMAIL,
          passwordHash,
          role: "rep",
        });

    // Estado inicial determinista: sin códigos, sin sesiones, sin outbox y sin
    // bloqueos. Cada spec puede así declarar de qué parte.
    for (const row of await ctx.db
      .query("passwordResetCodes")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect()) {
      await ctx.db.delete(row._id);
    }
    for (const session of await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect()) {
      await ctx.db.delete(session._id);
    }
    for (const entry of await ctx.db
      .query("testOutbox")
      .withIndex("by_email", (q) => q.eq("email", RESET_TEST_EMAIL))
      .collect()) {
      await ctx.db.delete(entry._id);
    }
    for (const key of rateLimitKeysForTestIdentity()) {
      await resetAttempts(ctx, key);
    }

    return { password };
  },
});

// Devuelve null cuando el outbox está vacío (aún no se ha pedido código).
export const getLastResetCode = query({
  args: { serverKey: v.string(), email: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    assertTestKey(args.serverKey);
    assertDedicatedIdentity(args.email);

    const entries = await ctx.db
      .query("testOutbox")
      .withIndex("by_email", (q) => q.eq("email", RESET_TEST_EMAIL))
      .collect();
    if (entries.length === 0) return null;

    let latest = entries[0];
    for (const entry of entries) {
      if (entry.createdAt > latest.createdAt) latest = entry;
    }
    return latest.code;
  },
});

// Permite probar la caducidad en segundos en lugar de esperar 15 minutos, sin
// abstracción de reloj y sin tocar la lógica de producción. Devuelve si había
// una fila que caducar.
export const expireResetCode = mutation({
  args: { serverKey: v.string(), email: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    assertTestKey(args.serverKey);
    assertDedicatedIdentity(args.email);

    const user = await findTestUser(ctx);
    if (!user) return false;

    const rows = await ctx.db
      .query("passwordResetCodes")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const active = rows.filter((row) => !row.usedAt);
    if (active.length === 0) return false;

    const past = Date.now() - 1000;
    for (const row of active) {
      await ctx.db.patch(row._id, {
        expiresAt: past,
        ...(row.ticketExpiresAt === undefined ? {} : { ticketExpiresAt: past }),
      });
    }
    return true;
  },
});

// Verifica la invalidación de sesiones tras un cambio de contraseña.
export const countSessionsFor = query({
  args: { serverKey: v.string(), email: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    assertTestKey(args.serverKey);
    assertDedicatedIdentity(args.email);

    const user = await findTestUser(ctx);
    if (!user) return 0;

    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    return sessions.length;
  },
});

// internalMutation: NO forma parte de `api.*`, ningún cliente externo puede
// invocarla — por eso es la única función del módulo que no recibe serverKey.
// La llama el envío de MIS-285. Dos salvaguardas propias, por si un futuro call
// site se equivoca:
//   - inerte si la credencial del harness no está configurada (producción);
//   - lanza si el destinatario no es la identidad dedicada.
export const recordOutbox = internalMutation({
  args: { email: v.string(), code: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!process.env[TEST_SUPPORT_ENV_VAR]) return null;
    assertDedicatedIdentity(args.email);

    await ctx.db.insert("testOutbox", {
      email: RESET_TEST_EMAIL,
      code: args.code,
      createdAt: Date.now(),
    });
    return null;
  },
});

```

## `src/proxy.ts`

```ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { SESSION_COOKIE_NAME } from "./lib/auth/constants";

// MIS-288 (1A.1–1A.3): el proxy tiene ahora TRES preocupaciones independientes,
// aplicadas en este orden:
//
//   1. Secreto de origen (I1) — solo pasa lo que venga de Cloudflare, que
//      inyecta X-Origin-Auth vía Transform Rule. El spike 1A.0 probó que al
//      origen se llega directo (dominio de Railway e incluso IP cruda con el
//      host canónico), así que este check es la línea de defensa real; sin él,
//      cualquiera falsea `cf-connecting-ip` y con ello el rate limiting.
//   2. Host canónico — higiene contra cache poisoning / hosts raros.
//   3. Check optimista de cookie — el de siempre, SOLO en las rutas de
//      siempre. La fuente de verdad real sigue siendo el DAL
//      (src/lib/auth/dal.ts), llamado desde cada page protegida.
//
// Los checks 1 y 2 solo aplican en producción (NODE_ENV === "production"): en
// dev/test (npm run dev, que es lo que arranca Playwright) no se exige nada de
// Cloudflare, así que no hay bypass silencioso en producción pero local y CI
// funcionan sin configuración extra.
//
// A propósito NO redirige "/login" -> "/" solo porque exista la cookie: una
// cookie presente no significa sesión válida. Si el proxy asumiera "hay cookie
// = autenticado" y bounceara /login -> /, y el DAL detecta la sesión inválida y
// manda / -> /login, se entra en un bucle infinito. Dejar "/login" accesible lo
// rompe. En Next 16 `proxy.ts` usa Node.js siempre; el config `runtime` no está
// disponible aquí (exportarlo lanza error de build), así que no se declara.

// Prefijos con check optimista de cookie — la MISMA lista que antes vivía en el
// matcher (MIS-18), ahora explícita aquí porque el matcher se amplió para que
// los checks de origen cubran TODAS las rutas dinámicas (incluidas
// /api/auth/google/* y las Server Actions, que un matcher-allowlist dejaba
// fuera). "/login" queda deliberadamente fuera de esta lista (ver arriba).
const COOKIE_GATED_PREFIXES = ["/pendientes", "/panel", "/contactos"];

function isCookieGated(pathname: string): boolean {
  if (pathname === "/") return true;
  return COOKIE_GATED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

// Comparación en tiempo constante y de longitud fija: hasheamos ambos lados con
// SHA-256 antes de timingSafeEqual, así no se filtra la longitud del secreto ni
// puede lanzar por longitudes distintas. Node runtime está garantizado en
// proxy.ts (Next 16), así que node:crypto está disponible.
function secretMatches(provided: string, expected: string | undefined): boolean {
  if (!expected) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

// Acepta ORIGIN_SHARED_SECRET y, si está definida, ORIGIN_SHARED_SECRET_NEXT —
// la clave doble permite rotar el secreto sin ventana de 403: se pone el nuevo
// en _NEXT, se cambia la Transform Rule, se verifica, y se promueve _NEXT a la
// principal.
function originAuthenticated(request: NextRequest): boolean {
  const provided = request.headers.get("x-origin-auth") ?? "";
  return (
    secretMatches(provided, process.env.ORIGIN_SHARED_SECRET) ||
    secretMatches(provided, process.env.ORIGIN_SHARED_SECRET_NEXT)
  );
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // /api/health: exenta del secreto de origen, del host y del fail-closed —
  // pero SOLO en GET/HEAD, que es lo que usa la sonda interna de Railway (no
  // pasa por Cloudflare y no lleva el secreto). Cualquier otro método pasa por
  // el perímetro normal; el route handler solo expone GET, así que responde
  // 405. El route handler decide 200/503 según la presencia de variables (1A.4).
  if (pathname === "/api/health" && (request.method === "GET" || request.method === "HEAD")) {
    return NextResponse.next();
  }

  if (process.env.NODE_ENV === "production") {
    const originSecret = process.env.ORIGIN_SHARED_SECRET;
    const canonicalHost = process.env.APP_CANONICAL_HOST;
    const authServerKey = process.env.AUTH_SERVER_KEY;

    // Fail-closed (I2): sin las variables obligatorias no servimos nada
    // dinámico. Devolver 503 aquí es lo que hace que un deploy mal configurado
    // no llegue a promocionarse (junto al guardián de /api/health).
    if (!originSecret || !canonicalHost || !authServerKey) {
      return new NextResponse("Service Unavailable", { status: 503 });
    }

    // I1: solo lo que venga de Cloudflare (lleva el secreto de origen).
    if (!originAuthenticated(request)) {
      return new NextResponse("Forbidden", { status: 403 });
    }

    // Host canónico.
    if (request.headers.get("host") !== canonicalHost) {
      return new NextResponse("Forbidden", { status: 403 });
    }
  }

  // Check optimista de cookie — solo en las rutas de siempre.
  if (isCookieGated(pathname) && !request.cookies.has(SESSION_COOKIE_NAME)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

// Matcher ampliado: el secreto de origen debe cubrir TODA ruta dinámica, no
// solo las protegidas por cookie. Se excluyen únicamente los ficheros servidos
// de disco (/_next/static y /favicon.ico), que no ejecutan lógica. /_next/image
// NO se excluye a propósito (queda cubierto), aunque además se desactivó el
// optimizador en next.config.ts.
export const config = {
  matcher: ["/((?!_next/static|favicon.ico).*)"],
};

```

## `src/lib/auth/clientIp.ts`

```ts
import { headers } from "next/headers";

// MIS-288 (1A.6): única fuente de verdad de "de dónde viene esta petición".
//
// Lee SOLO `cf-connecting-ip`, la cabecera que escribe Cloudflare y que el
// cliente no puede sobreescribir cuando la petición pasa por Cloudflare. Su
// fiabilidad se apoya en el secreto de origen de src/proxy.ts: nada que no
// venga de Cloudflare llega hasta aquí (403 antes), así que la
// `cf-connecting-ip` que vemos siempre la puso Cloudflare.
//
// NUNCA cae de vuelta a `x-forwarded-for`: el spike 1A.0 probó que el origen
// acepta un `x-forwarded-for`/`cf-connecting-ip` falso del cliente, así que un
// fallback derrotaría todo el ejercicio.
//
// La validación de formato está DUPLICADA de convex/lib/rateLimit.ts a
// propósito: src/ y convex/ corren en runtimes/bundles distintos y el repo no
// cruza imports entre ambos (mismo criterio que src/lib/auth/google.ts).
const MAX_IP_LENGTH = 45; // suficiente para IPv6
const IPV4_RE = /^(\d{1,3})(\.\d{1,3}){3}$/;
const IPV6_RE = /^[0-9a-fA-F:]+$/;

function normalizeIp(raw: string | null): string | null {
  if (!raw) return null;
  const first = raw.split(",")[0]?.trim() ?? "";
  if (!first || first.length > MAX_IP_LENGTH) return null;
  const looksLikeIpv4 = IPV4_RE.test(first);
  const looksLikeIpv6 = first.includes(":") && IPV6_RE.test(first);
  if (!looksLikeIpv4 && !looksLikeIpv6) return null;
  return first;
}

// Devuelve la IP tras una validación SIMPLE de formato (forma IPv4/IPv6, no RFC
// completa — no comprueba que cada octeto sea ≤255), o null si no hay cabecera
// resoluble. Mismo criterio que normalizeIpHint en convex/lib/rateLimit.ts, con
// el que debe mantenerse alineado. En desarrollo (sin Cloudflare delante)
// devolverá null y no se aplicará límite por IP — igual que hoy cuando falta.
export async function getClientIp(): Promise<string | null> {
  const store = await headers();
  return normalizeIp(store.get("cf-connecting-ip"));
}

```

## `src/lib/auth/actions.ts`

```ts
"use server";

import { redirect } from "next/navigation";
import { fetchAction, fetchMutation } from "convex/nextjs";
import { api } from "../../../convex/_generated/api";
import { clearSessionCookie, readSessionToken, setSessionCookie } from "./cookie";
import { getClientIp } from "./clientIp";
import { landingPathForRole } from "./dal";

export type LoginActionState = { error: string } | undefined;

// MIS-288 (1A.5): secreto de servidor que autentica estas Server Actions ante
// Convex. En producción el proxy ya devuelve 503 si falta (fail-closed), así
// que aquí basta leerlo; un valor vacío hace que Convex responda con el error
// genérico (nunca revela el motivo real).
function authServerKey(): string {
  return process.env.AUTH_SERVER_KEY ?? "";
}

export async function loginAction(
  _prevState: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const ipHint = (await getClientIp()) ?? undefined;

  const result = await fetchAction(api.auth.loginWithPassword, {
    email,
    password,
    ipHint,
    serverKey: authServerKey(),
  });

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

// MIS-285: recuperación de contraseña por código (OTP). Un único tipo de
// estado para las 3 actions — cada una avanza `step` según el resultado, y
// RecoverForm.tsx (Client Component) decide qué paso pintar a partir de él.
export type RecoverActionState =
  | { step: "email" }
  | { step: "code"; email: string; error?: string }
  | { step: "password"; ticket: string; error?: string };

// Anti-enumeración: SIEMPRE avanza a "code", exista o no la cuenta — el
// backend (requestPasswordResetCode) ya responde con el mismo timing en
// ambos casos, así que esta action no puede añadir una distinción que el
// backend evitó a propósito.
export async function requestResetCodeAction(
  _prevState: RecoverActionState,
  formData: FormData,
): Promise<RecoverActionState> {
  const email = String(formData.get("email") ?? "");
  const ipHint = (await getClientIp()) ?? undefined;

  await fetchMutation(api.passwordReset.requestPasswordResetCode, {
    email,
    ipHint,
    serverKey: authServerKey(),
  });

  return { step: "code", email };
}

export async function verifyResetCodeAction(
  _prevState: RecoverActionState,
  formData: FormData,
): Promise<RecoverActionState> {
  const email = String(formData.get("email") ?? "");
  const code = String(formData.get("code") ?? "");
  const ipHint = (await getClientIp()) ?? undefined;

  const result = await fetchMutation(api.passwordReset.verifyResetCode, {
    email,
    code,
    ipHint,
    serverKey: authServerKey(),
  });

  if (!result.ok) {
    return { step: "code", email, error: result.error };
  }
  return { step: "password", ticket: result.ticket };
}

const PASSWORD_MISMATCH_ERROR = "Las contraseñas no coinciden";
const PASSWORD_POLICY_ERROR = "La contraseña debe tener entre 8 y 128 caracteres";

export async function resetPasswordAction(
  _prevState: RecoverActionState,
  formData: FormData,
): Promise<RecoverActionState> {
  const ticket = String(formData.get("ticket") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (newPassword !== confirmPassword) {
    return { step: "password", ticket, error: PASSWORD_MISMATCH_ERROR };
  }
  if (newPassword.length < 8 || newPassword.length > 128) {
    return { step: "password", ticket, error: PASSWORD_POLICY_ERROR };
  }

  const result = await fetchMutation(api.passwordReset.resetPasswordWithTicket, {
    ticket,
    newPassword,
    serverKey: authServerKey(),
  });

  if (!result.ok) {
    return { step: "password", ticket, error: result.error };
  }

  redirect("/login?reset=ok");
}

```

## `src/app/api/health/route.ts`

```ts
import { NextResponse } from "next/server";

// MIS-288 (1A.4): endpoint de health y guardián de despliegue.
//
// Railway llama a esta ruta ANTES de dar un deploy por bueno, por su red
// interna (no pasa por Cloudflare), así que no lleva el secreto de origen —
// por eso src/proxy.ts la exime del secreto y del check de host. Y como una
// sonda fallida hace que Railway NO promocione el deploy (mantiene el viejo
// sano en pie), esta ruta comprueba además que las variables obligatorias
// ESTÁN presentes y devuelve 503 si falta alguna: un deploy mal configurado
// no llega a producción.
//
// INVARIANTE (no crecer): comprobar la PRESENCIA de env vars es barato y no
// toca nada externo. Esta ruta nunca debe consultar Convex, Resend ni base de
// datos, ni leer el VALOR de un secreto — es la única ruta dinámica sin
// autenticar, y en cuanto tocara un servicio dejaría de ser segura como tal.

export const dynamic = "force-dynamic";

// Los dos secretos siguen el contrato de 32 bytes; se exige un mínimo holgado
// (16) que ataja un valor en blanco o claramente truncado sin acoplar el health
// a un formato exacto. APP_CANONICAL_HOST es un hostname, no un secreto: solo se
// exige que no esté en blanco.
const REQUIRED_ENV_VARS: ReadonlyArray<{ name: string; minLength: number }> = [
  { name: "ORIGIN_SHARED_SECRET", minLength: 16 },
  { name: "APP_CANONICAL_HOST", minLength: 1 },
  { name: "AUTH_SERVER_KEY", minLength: 16 },
];

function isPresent({ name, minLength }: { name: string; minLength: number }): boolean {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length >= minLength;
}

export async function GET() {
  // El perímetro (y por tanto el guardián de variables) solo aplica en
  // producción — en dev/test las defensas de origen están desactivadas
  // (src/proxy.ts), así que no exigimos nada aquí.
  if (process.env.NODE_ENV !== "production") {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const allPresent = REQUIRED_ENV_VARS.every(isPresent);
  // Respuesta deliberadamente opaca: no se dice qué variable falta (la
  // respuesta es pública, exenta del secreto de origen).
  return NextResponse.json({ ok: allPresent }, { status: allPresent ? 200 : 503 });
}

```

## `next.config.ts`

```ts
import type { NextConfig } from "next";

// MIS-288 (1A.7 + 1A.2): cabeceras de seguridad, CSP y desactivación del
// optimizador de imágenes.

// CSP de fase 1. Lo que arregla de verdad es el CLICKJACKING (frame-ancestors
// 'none'): /login y el paso del código OTP dejan de ser embebibles.
//
// `script-src` conserva 'unsafe-inline' porque sin nonce Next no arranca sus
// scripts de bootstrap; `style-src` también, porque la app usa atributos
// style={{…}} por todas partes y el nonce no cubre atributos de estilo. El
// endurecimiento real de script-src (CSP con nonce en proxy.ts) es fase 3 —
// desactiva la optimización estática y es incompatible con PPR.
//
// `connect-src` incluye Convex porque ConvexClientProvider sigue montado en
// esta fase (aunque nada del navegador lo use); la fase 3 lo retira y entonces
// connect-src puede estrecharse a 'self'.
// `next dev` sirve con NODE_ENV="development"; `next start` (Railway) con
// "production". React y el runtime de dev de Next usan eval (HMR, overlay de
// errores), así que en desarrollo hace falta 'unsafe-eval' o se rompe la
// interactividad de cliente. En PRODUCCIÓN no se incluye — CSP más estricta,
// tal como documenta la guía de CSP de Next.
const IS_PRODUCTION = process.env.NODE_ENV === "production";

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${IS_PRODUCTION ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.convex.cloud wss://*.convex.cloud",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
  // Redundante con frame-ancestors, cubre navegadores viejos.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  // Sin includeSubDomains ni preload hasta inventariar subdominios (fase 3);
  // también aquí, no solo en Cloudflare, para sobrevivir a un cambio de CDN.
  { key: "Strict-Transport-Security", value: "max-age=63072000" },
];

const nextConfig: NextConfig = {
  // 1A.2: el handler /_next/image es una ruta dinámica y el proyecto no usa
  // next/image en ningún sitio, así que se desactiva en vez de dejarlo como
  // superficie sin cubrir por el secreto de origen.
  images: { unoptimized: true },

  // B8: fuera de este origen, la comprobación Origin/Host de las Server
  // Actions falla cerrado. Detrás de Cloudflare el Host efectivo es el
  // dominio canónico.
  experimental: {
    serverActions: { allowedOrigins: ["mistu-monso.com"] },
  },

  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;

```

## `railway.json`

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "npm run build"
  },
  "deploy": {
    "startCommand": "npm run start",
    "healthcheckPath": "/api/health",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}

```

## `.env.local.example`

```bash
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

# MIS-288: secreto compartido servidor Next <-> Convex para autenticación
# (login por password y recuperación). DEBE coincidir EXACTO con el valor
# puesto en el deployment de Convex:
#   npx convex env set AUTH_SERVER_KEY <valor>
# Genera un valor de alta entropía, p. ej.: openssl rand -hex 32
AUTH_SERVER_KEY=

# Recuperación de contraseña por código (MIS-285) — SOLO en Convex, NUNCA aquí
# ni en Railway: convex/lib/resend.ts las lee de process.env del deployment.
#   npx convex env set RESEND_API_KEY <valor>
#   npx convex env set RESEND_FROM no-reply@mistu-monso.com

```

## `.env.test.local.example`

```bash
# Copia a .env.test.local (gitignored) y rellena con las credenciales reales
# de Carlos y Marta en el deployment de dev de Convex (dutiful-mole-111).
E2E_CARLOS_EMAIL=carlos@test.local
E2E_CARLOS_PASSWORD=
# MIS-260: Marta pasa a usar su email real (mistumonso@gmail.com) en dev —
# era marta@test.local hasta este ticket. Solo cambia el email, no el name.
E2E_MARTA_EMAIL=mistumonso@gmail.com
E2E_MARTA_PASSWORD=
E2E_BASE_URL=http://localhost:3000

# MIS-286: credencial del harness seguro de pruebas de recuperación de
# contraseña. Debe COINCIDIR con la variable del mismo nombre en el deployment
# de Convex de dev: `npx convex env set E2E_TEST_SUPPORT_KEY <valor>`.
# Genera un valor de alta entropía, p. ej.:
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
# En PRODUCCIÓN esta variable NO debe existir: su ausencia deja inertes todas
# las funciones de convex/testSupport.ts (fail-closed).
# NOTA: la identidad de pruebas (reset@test.local) NO tiene contraseña fija —
# se genera una nueva en cada ejecución y nunca se guarda aquí ni en el repo.
E2E_TEST_SUPPORT_KEY=

# MIS-288: secreto de servidor de autenticación. MISMO valor que en .env.local
# y que el deployment de Convex de dev. En CI es un secret de GitHub del mismo
# nombre. El servidor de dev que arranca Playwright lo lee de aquí para poder
# autenticar el login por password (loginWithPassword) durante los e2e.
AUTH_SERVER_KEY=

```

## `.github/workflows/ci.yml`

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - run: npm ci
      - run: npm run lint
      - run: npm run build

  e2e:
    runs-on: ubuntu-latest
    needs: build
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
        env:
          NEXT_PUBLIC_CONVEX_URL: ${{ secrets.NEXT_PUBLIC_CONVEX_URL }}
          E2E_CARLOS_EMAIL: ${{ secrets.E2E_CARLOS_EMAIL }}
          E2E_CARLOS_PASSWORD: ${{ secrets.E2E_CARLOS_PASSWORD }}
          E2E_MARTA_EMAIL: ${{ secrets.E2E_MARTA_EMAIL }}
          E2E_MARTA_PASSWORD: ${{ secrets.E2E_MARTA_PASSWORD }}
          GOOGLE_CLIENT_ID: ${{ secrets.GOOGLE_CLIENT_ID }}
          GOOGLE_CLIENT_SECRET: ${{ secrets.GOOGLE_CLIENT_SECRET }}
          GOOGLE_OAUTH_REDIRECT_URI: ${{ secrets.GOOGLE_OAUTH_REDIRECT_URI }}
          GOOGLE_LOGIN_SHARED_SECRET: ${{ secrets.GOOGLE_LOGIN_SHARED_SECRET }}
          E2E_TEST_SUPPORT_KEY: ${{ secrets.E2E_TEST_SUPPORT_KEY }}
          # MIS-288: mismo valor que AUTH_SERVER_KEY en el deployment de Convex de
          # dev (contra el que corren los e2e). Sin este secret, el login por
          # password falla en CI tras la activación de loginWithPassword.
          AUTH_SERVER_KEY: ${{ secrets.AUTH_SERVER_KEY }}

      # MIS-286: demuestra que los specs con contraseñas efímeras no dejan el
      # secreto en trazas, artefactos ni logs. `if: always()` a propósito — si
      # el e2e falla, es justo cuando Playwright conserva artefactos, así que es
      # cuando MÁS importa comprobar que no contienen secretos.
      - name: Gate de fugas de secretos en artefactos
        if: always()
        run: npm run test:e2e:secret-gate
        env:
          NEXT_PUBLIC_CONVEX_URL: ${{ secrets.NEXT_PUBLIC_CONVEX_URL }}

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 14

```

## `e2e/helpers/test-support.ts`

```ts
// MIS-286: envoltorio de las funciones del harness seguro (convex/testSupport.ts).
//
// La credencial se lee de process.env EN EL PROCESO DE NODE de Playwright y
// nunca se pasa a la página — el navegador jamás la ve, así que no puede
// aparecer en una traza ni en un screenshot.

import { convexClient, api } from "./convex-client";
import { RESET_TEST_EMAIL } from "../../convex/lib/testIdentity";

function testSupportKey(): string {
  const key = process.env.E2E_TEST_SUPPORT_KEY;
  if (!key) {
    throw new Error(
      "Falta E2E_TEST_SUPPORT_KEY — configúrala en .env.test.local (local) o en los secrets del repo (CI). " +
        "Debe coincidir con la variable del mismo nombre en el deployment de Convex de dev " +
        "(`npx convex env set E2E_TEST_SUPPORT_KEY <valor>`).",
    );
  }
  return key;
}

// MIS-288: secreto de servidor de autenticación, para las llamadas directas a
// las funciones de auth desde los e2e (loginWithPassword y el flujo de
// recuperación). Mismo patrón que testSupportKey(): se lee en el proceso de
// Node de Playwright, nunca llega al navegador. En 1A el serverKey es opcional
// en las funciones de recuperación (expand); enviarlo aquí ejercita el mismo
// camino que usa el frontend en producción.
export function authServerKey(): string {
  const key = process.env.AUTH_SERVER_KEY;
  if (!key) {
    throw new Error(
      "Falta AUTH_SERVER_KEY — configúrala en .env.test.local (local) o en los secrets del repo (CI). " +
        "Debe coincidir con la variable del mismo nombre en el deployment de Convex de dev " +
        "(`npx convex env set AUTH_SERVER_KEY <valor>`).",
    );
  }
  return key;
}

// Reseed idempotente al INICIO de cada spec. Devuelve la contraseña efímera
// recién generada: vive solo en memoria del proceso de test.
export async function resetTestIdentity(): Promise<string> {
  const { password } = await convexClient().mutation(api.testSupport.resetTestIdentity, {
    serverKey: testSupportKey(),
    email: RESET_TEST_EMAIL,
  });
  return password;
}

// null si aún no se ha pedido ningún código.
export async function getLastResetCode(): Promise<string | null> {
  return await convexClient().query(api.testSupport.getLastResetCode, {
    serverKey: testSupportKey(),
    email: RESET_TEST_EMAIL,
  });
}

export async function expireResetCode(): Promise<boolean> {
  return await convexClient().mutation(api.testSupport.expireResetCode, {
    serverKey: testSupportKey(),
    email: RESET_TEST_EMAIL,
  });
}

export async function countSessionsFor(): Promise<number> {
  return await convexClient().query(api.testSupport.countSessionsFor, {
    serverKey: testSupportKey(),
    email: RESET_TEST_EMAIL,
  });
}

// Comprueba credenciales SIN pasar por el formulario: así la contraseña efímera
// no entra en el navegador y no puede quedar registrada en una traza.
export async function loginSucceeds(password: string): Promise<boolean> {
  const result = await convexClient().action(api.auth.loginWithPassword, {
    email: RESET_TEST_EMAIL,
    password,
    serverKey: authServerKey(),
  });
  return result.success;
}

export { RESET_TEST_EMAIL };

```

## `e2e/test-support.spec.ts`

```ts
// MIS-286: pruebas del propio harness, ANTES de que MIS-285 dependa de él.
//
// Corre en el project "chromium-secrets" (sin trace, vídeo ni screenshots):
// aquí circulan contraseñas efímeras válidas y no deben poder quedar en ningún
// artefacto de CI. El gate `npm run test:e2e:secret-gate` demuestra que esa
// política funciona de verdad.

// Todos los specs del project "chromium-secrets" usan este `test` endurecido,
// que limpia los valores del DOM antes de que Playwright genere error-context.md.
// Aquí ningún secreto llega al navegador (todo va por ConvexHttpClient), pero la
// regla se aplica por defecto para que una edición futura no reabra el agujero.
import { test, expect } from "./helpers/secure-test";
import { convexClient, api } from "./helpers/convex-client";
import {
  RESET_TEST_EMAIL,
  countSessionsFor,
  getLastResetCode,
  loginSucceeds,
  resetTestIdentity,
} from "./helpers/test-support";

test.describe("harness seguro (MIS-286)", () => {
  // Cerrojo 1: sin la credencial correcta no se pasa. Se prueban UNA mutation y
  // UNA query porque todas comparten el mismo guard `assertTestKey`.
  test("rechaza llamadas sin la credencial correcta", async () => {
    const client = convexClient();

    for (const badKey of ["", "clave-incorrecta"]) {
      await expect(
        client.mutation(api.testSupport.resetTestIdentity, {
          serverKey: badKey,
          email: RESET_TEST_EMAIL,
        }),
      ).rejects.toThrow(/No autorizado/);

      await expect(
        client.query(api.testSupport.getLastResetCode, {
          serverKey: badKey,
          email: RESET_TEST_EMAIL,
        }),
      ).rejects.toThrow(/No autorizado/);
    }
  });

  // Cerrojo 2: la credencial correcta NO habilita tocar cuentas reales.
  test("rechaza cualquier identidad que no sea la dedicada", async () => {
    const key = process.env.E2E_TEST_SUPPORT_KEY;
    expect(key, "E2E_TEST_SUPPORT_KEY debe estar configurada").toBeTruthy();

    await expect(
      convexClient().mutation(api.testSupport.resetTestIdentity, {
        serverKey: key!,
        email: "carlos@test.local",
      }),
    ).rejects.toThrow(/Identidad no permitida/);
  });

  // Cerrojo 3 + estado inicial determinista.
  test("el reseed es idempotente y devuelve una contraseña distinta cada vez", async () => {
    const first = await resetTestIdentity();
    const second = await resetTestIdentity();

    expect(second).not.toBe(first);

    // Estado inicial que los specs de MIS-285 pueden dar por supuesto. Se
    // comprueba ANTES de cualquier login: loginWithPassword crea una sesión, así
    // que hacerlo después mediría el efecto del propio test, no el del reseed.
    expect(await countSessionsFor()).toBe(0);
    expect(await getLastResetCode()).toBeNull();

    expect(await loginSucceeds(second)).toBe(true);
    // La anterior deja de valer: el reseed rota la credencial.
    expect(await loginSucceeds(first)).toBe(false);
  });

  // M8: sin esta limpieza, una ejecución que deje el bloqueo puesto haría
  // fallar la siguiente durante 15 minutos. Se omite ipHint a propósito para
  // ejercitar SOLO la clave por usuario, sin tocar el contador de IP compartido.
  test("el reseed limpia el bloqueo de rate limit del login", async () => {
    const password = await resetTestIdentity();

    // loginSucceeds va por loginWithPassword con serverKey (MIS-288): 5 fallos
    // con la contraseña incorrecta agotan el margen por email.
    for (let i = 0; i < 5; i++) {
      await loginSucceeds("contraseña-incorrecta");
    }

    // Bloqueada: ni siquiera la contraseña correcta entra.
    expect(await loginSucceeds(password)).toBe(false);

    const fresh = await resetTestIdentity();
    expect(await loginSucceeds(fresh)).toBe(true);
  });

  // MIS-288 (I3): loginWithPassword rechaza toda llamada sin serverKey válido
  // ANTES de tocar el rate limit. Una llamada directa a Convex sin la clave no
  // puede ni autenticar ni bloquear la cuenta — el rechazo va primero.
  test("loginWithPassword sin serverKey válido se rechaza y no bloquea la cuenta", async () => {
    const password = await resetTestIdentity();
    const client = convexClient();

    // 8 intentos con serverKey incorrecto: si el rechazo NO fuese antes del
    // rate limit, 5+ de estos habrían bloqueado la cuenta.
    for (let i = 0; i < 8; i++) {
      const result = await client.action(api.auth.loginWithPassword, {
        email: RESET_TEST_EMAIL,
        password,
        serverKey: "clave-incorrecta",
      });
      expect(result.success).toBe(false);
    }

    // La cuenta NO quedó bloqueada: el login legítimo sigue entrando.
    expect(await loginSucceeds(password)).toBe(true);
  });
});

```

## `e2e/password-reset-invariants.spec.ts`

```ts
// MIS-285: invariantes de seguridad del flujo de recuperación de contraseña,
// verificadas por API (ConvexHttpClient) — no por formulario, mismo criterio
// que password-reset.spec.ts. Corre en "chromium-secrets" (MIS-286): la
// contraseña efímera de la identidad dedicada circula por aquí.
import { randomBytes } from "node:crypto";
import { test, expect } from "./helpers/secure-test";
import { convexClient, api } from "./helpers/convex-client";
import {
  RESET_TEST_EMAIL,
  authServerKey,
  countSessionsFor,
  expireResetCode,
  getLastResetCode,
  loginSucceeds,
  resetTestIdentity,
} from "./helpers/test-support";
import { generateNumericCode } from "../convex/lib/token";

function freshPassword(): string {
  return randomBytes(24).toString("base64url");
}

// Cambia un dígito, garantizando un código distinto del real sin asumir
// nada sobre su valor concreto.
function wrongCode(realCode: string): string {
  const firstDigit = Number(realCode[0]);
  const flipped = (firstDigit + 1) % 10;
  return `${flipped}${realCode.slice(1)}`;
}

// M14 (auditoría, ronda 2): `testOutbox` nunca borra entregas anteriores
// (solo resetTestIdentity() lo hace) y getLastResetCode() devuelve la de
// mayor createdAt entre TODAS — así que pedir un segundo código dentro del
// mismo test, con una entrega previa aún en el outbox, hace que
// `.not.toBeNull()` se satisfaga con el código VIEJO antes de que la nueva
// entrega (programada, no esperada por la mutation) haya terminado. El poll
// debe exigir un valor distinto del anterior, no solo "no nulo".
async function requestAndGetCode(previousCode: string | null = null): Promise<string> {
  const client = convexClient();
  await client.mutation(api.passwordReset.requestPasswordResetCode, { email: RESET_TEST_EMAIL });

  await expect
    .poll(
      async () => {
        const current = await getLastResetCode();
        return current !== null && current !== previousCode;
      },
      { message: "esperando una entrega nueva y distinta en el outbox de test", timeout: 10_000 },
    )
    .toBe(true);
  const code = await getLastResetCode();
  if (!code) throw new Error("getLastResetCode() devolvió null tras confirmar una entrega nueva");
  return code;
}

test.describe("generateNumericCode — invariantes deterministas", () => {
  test("longitud exacta 6, solo dígitos, y no siempre el mismo valor", () => {
    const samples = Array.from({ length: 200 }, () => generateNumericCode(6));

    for (const code of samples) {
      expect(code).toMatch(/^\d{6}$/);
      const asNumber = Number(code);
      expect(asNumber).toBeGreaterThanOrEqual(0);
      expect(asNumber).toBeLessThanOrEqual(999999);
    }

    expect(new Set(samples).size).toBeGreaterThan(1);
  });
});

test.describe("recuperación de contraseña — invariantes de seguridad (MIS-285)", () => {
  test("código incorrecto devuelve un error genérico", async () => {
    await resetTestIdentity();
    const realCode = await requestAndGetCode();
    const client = convexClient();

    const result = await client.mutation(api.passwordReset.verifyResetCode, {
      email: RESET_TEST_EMAIL,
      code: wrongCode(realCode),
    });

    expect(result.ok).toBe(false);
  });

  test("el 6.º intento queda bloqueado incluso con el código correcto", async () => {
    await resetTestIdentity();
    const realCode = await requestAndGetCode();
    const client = convexClient();

    for (let i = 0; i < 5; i++) {
      const result = await client.mutation(api.passwordReset.verifyResetCode, {
        email: RESET_TEST_EMAIL,
        code: wrongCode(realCode),
      });
      expect(result.ok).toBe(false);
    }

    // El código real ya no sirve: 5 intentos fallidos consumen el margen,
    // sea por `attempts >= 5` en la fila o por el rate limit de
    // `resetcode:<email>` — ambos caminos deben rechazar por igual.
    const finalAttempt = await client.mutation(api.passwordReset.verifyResetCode, {
      email: RESET_TEST_EMAIL,
      code: realCode,
    });
    expect(finalAttempt.ok).toBe(false);
  });

  test("un código caducado se rechaza sin esperar 15 minutos", async () => {
    await resetTestIdentity();
    const realCode = await requestAndGetCode();

    const hadActiveCode = await expireResetCode();
    expect(hadActiveCode).toBe(true);

    const client = convexClient();
    const result = await client.mutation(api.passwordReset.verifyResetCode, {
      email: RESET_TEST_EMAIL,
      code: realCode,
    });
    expect(result.ok).toBe(false);
  });

  test("un ticket ya usado no puede reutilizarse para un segundo cambio", async () => {
    await resetTestIdentity();
    const realCode = await requestAndGetCode();
    const client = convexClient();

    const verified = await client.mutation(api.passwordReset.verifyResetCode, {
      email: RESET_TEST_EMAIL,
      code: realCode,
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) throw new Error("unreachable");

    const firstChange = await client.mutation(api.passwordReset.resetPasswordWithTicket, {
      ticket: verified.ticket,
      newPassword: freshPassword(),
    });
    expect(firstChange.ok).toBe(true);

    const secondChange = await client.mutation(api.passwordReset.resetPasswordWithTicket, {
      ticket: verified.ticket,
      newPassword: freshPassword(),
    });
    expect(secondChange.ok).toBe(false);
  });

  // M12 (auditoría, ronda 2): tras agotar los 5 intentos de un código,
  // solicitar uno nuevo debe desbloquear la verificación — el rate limit de
  // `resetcode:<email>` no puede quedar atado al código anterior.
  test("tras 5 intentos fallidos, pedir un código nuevo desbloquea la verificación", async () => {
    await resetTestIdentity();
    const staleCode = await requestAndGetCode();
    const client = convexClient();

    for (let i = 0; i < 5; i++) {
      const result = await client.mutation(api.passwordReset.verifyResetCode, {
        email: RESET_TEST_EMAIL,
        code: wrongCode(staleCode),
      });
      expect(result.ok).toBe(false);
    }

    const freshCode = await requestAndGetCode(staleCode);
    const result = await client.mutation(api.passwordReset.verifyResetCode, {
      email: RESET_TEST_EMAIL,
      code: freshCode,
    });
    expect(result.ok).toBe(true);
  });

  // M13 (auditoría, ronda 2): la frontera pública debe rechazar entradas que
  // no cumplen el contrato (código que no son 6 dígitos) sin lanzar excepción
  // ni tratarlas de forma distinta a un código simplemente incorrecto.
  test("verifyResetCode rechaza códigos que no son 6 dígitos, con el mismo error genérico", async () => {
    await resetTestIdentity();
    await requestAndGetCode();
    const client = convexClient();

    for (const malformed of ["", "12345", "1234567", "abcdef", "12345a", "1 2345"]) {
      const result = await client.mutation(api.passwordReset.verifyResetCode, {
        email: RESET_TEST_EMAIL,
        code: malformed,
      });
      expect(result.ok).toBe(false);
    }
  });

  // M13: un email fuera del límite del contrato (>254) no debe lanzar ni
  // recibir trato distinto — mismo {ok:true} genérico que cualquier email
  // bien formado, exista o no la cuenta.
  test("requestPasswordResetCode con un email excesivamente largo responde {ok:true} sin lanzar", async () => {
    const client = convexClient();
    const oversizedEmail = `${"a".repeat(250)}@test.local`;
    const result = await client.mutation(api.passwordReset.requestPasswordResetCode, {
      email: oversizedEmail,
    });
    expect(result).toEqual({ ok: true });
  });

  // M13 (auditoría, ronda 2): la misma validación, pero contra
  // verifyResetCode directamente — la ronda 1 solo la probó en
  // requestPasswordResetCode. Email vacío y de 255 caracteres, respuesta
  // genérica sin excepción, invocada directamente por ConvexHttpClient (sin
  // pasar por el formulario, que ya recorta con maxLength/required).
  test("verifyResetCode con email vacío o excesivamente largo responde genérico sin lanzar", async () => {
    const client = convexClient();
    for (const badEmail of ["", `${"a".repeat(250)}@test.local`]) {
      const result = await client.mutation(api.passwordReset.verifyResetCode, {
        email: badEmail,
        code: "123456",
      });
      expect(result.ok).toBe(false);
    }
  });

  test("cambiar la contraseña invalida todas las sesiones existentes", async () => {
    const oldPassword = await resetTestIdentity();
    expect(await loginSucceeds(oldPassword)).toBe(true); // crea una sesión
    expect(await countSessionsFor()).toBeGreaterThan(0);

    const realCode = await requestAndGetCode();
    const client = convexClient();
    const verified = await client.mutation(api.passwordReset.verifyResetCode, {
      email: RESET_TEST_EMAIL,
      code: realCode,
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) throw new Error("unreachable");

    const changed = await client.mutation(api.passwordReset.resetPasswordWithTicket, {
      ticket: verified.ticket,
      newPassword: freshPassword(),
    });
    expect(changed.ok).toBe(true);

    expect(await countSessionsFor()).toBe(0);
  });

  // MIS-288 (I3): las funciones de recuperación rechazan un serverKey inválido
  // SIN efecto lateral. Una llamada directa a Convex con la clave mala no
  // entrega código, ni consume un código válido, ni consume un ticket válido.
  // Los controles positivos usan la clave BUENA (authServerKey), así que estos
  // tests siguen valiendo cuando 1A-bis haga el serverKey obligatorio.
  const BAD_KEY = "clave-incorrecta";

  test("requestPasswordResetCode con serverKey inválido no entrega código", async () => {
    await resetTestIdentity();
    const client = convexClient();

    // Clave mala: respuesta genérica {ok:true}, pero NO programa entrega.
    const res = await client.mutation(api.passwordReset.requestPasswordResetCode, {
      email: RESET_TEST_EMAIL,
      serverKey: BAD_KEY,
    });
    expect(res).toEqual({ ok: true });

    // Ventana negativa REAL: se sondea durante TODA la ventana y se falla en
    // cuanto aparezca un código. Un `expect.poll(...).toBeNull()` se satisface
    // con el primer null (antes de que el scheduler corra) y no espera nada —
    // falso verde (M-MIS288-1). Aquí se exige que se mantenga null toda la
    // ventana; una entrega programada por error (runAfter(0) entrega en ~1s)
    // caería dentro y rompería el test.
    const NEGATIVE_WINDOW_MS = 4000;
    const deadline = Date.now() + NEGATIVE_WINDOW_MS;
    while (Date.now() < deadline) {
      expect(
        await getLastResetCode(),
        "con clave mala no debe aparecer ningún código en toda la ventana",
      ).toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    // Última lectura tras el bucle: cierra la cola ciega de ≤200ms entre la
    // última iteración y el fin de la ventana, para que sea literal "toda la
    // ventana". La ventana negativa (4s) basta porque deliverResetCode se
    // programa con runAfter(0) y entrega en ~1s; el control positivo se deja en
    // 10s solo por holgura ante latencias del scheduler en CI.
    expect(
      await getLastResetCode(),
      "el outbox sigue vacío al cerrar la ventana",
    ).toBeNull();

    // Control positivo (clave BUENA): el camino real sí entrega un código.
    await client.mutation(api.passwordReset.requestPasswordResetCode, {
      email: RESET_TEST_EMAIL,
      serverKey: authServerKey(),
    });
    await expect
      .poll(async () => (await getLastResetCode()) !== null, {
        message: "con clave válida el código sí debe llegar",
        timeout: 10_000,
      })
      .toBe(true);
  });

  test("verifyResetCode con serverKey inválido no consume el código válido", async () => {
    await resetTestIdentity();
    const realCode = await requestAndGetCode();
    const client = convexClient();

    // Más de 5 llamadas con clave mala: si el rechazo NO fuese antes del rate
    // limit de `resetcode:<email>`, 5+ de estas lo agotarían y el control
    // positivo fallaría. Prueba que la clave se comprueba PRIMERO, sin tocar ni
    // el código ni el contador.
    for (let i = 0; i < 6; i++) {
      const bad = await client.mutation(api.passwordReset.verifyResetCode, {
        email: RESET_TEST_EMAIL,
        code: realCode,
        serverKey: BAD_KEY,
      });
      expect(bad.ok).toBe(false);
    }

    // El código NO se consumió ni se bloqueó: con clave buena, verifica y emite ticket.
    const good = await client.mutation(api.passwordReset.verifyResetCode, {
      email: RESET_TEST_EMAIL,
      code: realCode,
      serverKey: authServerKey(),
    });
    expect(good.ok).toBe(true);
  });

  test("resetPasswordWithTicket con serverKey inválido no consume el ticket válido", async () => {
    await resetTestIdentity();
    const realCode = await requestAndGetCode();
    const client = convexClient();

    const verified = await client.mutation(api.passwordReset.verifyResetCode, {
      email: RESET_TEST_EMAIL,
      code: realCode,
      serverKey: authServerKey(),
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) throw new Error("unreachable");

    const bad = await client.mutation(api.passwordReset.resetPasswordWithTicket, {
      ticket: verified.ticket,
      newPassword: freshPassword(),
      serverKey: BAD_KEY,
    });
    expect(bad.ok).toBe(false);

    // El ticket NO se consumió: con clave buena, cambia la contraseña.
    const good = await client.mutation(api.passwordReset.resetPasswordWithTicket, {
      ticket: verified.ticket,
      newPassword: freshPassword(),
      serverKey: authServerKey(),
    });
    expect(good.ok).toBe(true);
  });
});

```

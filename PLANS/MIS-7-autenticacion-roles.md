# MIS-7 — Autenticación y roles de usuario (Carlos y Marta)

> **Estado**: **Código aprobado para instalar** (v6). El equipo de revisión confirmó corregidos los 3 hallazgos de la ronda anterior (bucle de redirect, matcher, rate-limit por IP) sobre `CODIGO/MIS-7-autenticacion-roles/`. Nota del revisor: no se ejecutó typecheck/lint/deploy en esta ronda (revisión estática); tras instalar, mantener como verificación obligatoria el caso de cookie inválida/revocada (punto 12 de "Verificación end-to-end").

## Contexto

El proyecto CRM en Linear tiene la pantalla principal (login + primera pantalla tras entrar) repartida en varias tareas, no una sola: **MIS-7** (login/roles), **MIS-18** (barra de navegación/botonera), **MIS-13** (home de Carlos) y **MIS-17** (home de Marta). Se ha acordado con el usuario implementarlas en ese orden, empezando por MIS-7 porque todas las demás dependen de saber quién está conectado y con qué rol.

Investigación previa confirmó que se parte de cero: no hay ninguna dependencia de autenticación instalada, `convex/schema.ts` solo define la tabla `contacts`, y `src/app/` solo tiene el layout raíz y una page de bienvenida sin lógica de auth. Esta instalación de Next.js (16.2.10) renombró `middleware.ts` → `proxy.ts` (función exportada `proxy`, no `middleware`) — confirmado en `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`.

Recursos de diseño reutilizables ya verificados: mockup `DESIGN/design-system/templates/login/Login.dc.html`, y componentes `src/components/ui/core/Button.jsx` / `forms/Input.jsx` (Button permite `type="submit"` explícito; Input ya soporta `suffix`/`error`).

## Respuesta a la revisión (NO-GO → v2)

| # | Hallazgo | Severidad | Resuelto en v2 |
|---|---|---|---|
| 1 | Sin guard de rol por ruta (`/panel` accesible por Carlos y viceversa) | Bloqueante | `requireRole()` en cada page — sección "Guards de rol" |
| 2 | `getSessionUser` podía filtrar `passwordHash`/`passwordSalt` | Bloqueante | DTO forzado con `returns` validator de Convex — sección "DTO seguro" |
| 3 | Sin rate limiting en `login` (fuerza bruta) | Bloqueante | Tabla `loginAttempts` + bloqueo temporal — sección "Rate limiting" |
| 4 | Parámetros de PBKDF2 sin especificar / sin versionado | Mayor | Formato versionado explícito — sección "Hashing" |
| 5 | Entropía del token opaco sin especificar | Mayor | 32 bytes fijados — sección "Token opaco" |
| 6 | Cookie sin `path: "/"` explícito | Mayor | Fijado en set y clear — sección "Cookie" |
| 7 | `by_email` no es único en Convex, riesgo de duplicados | Mayor | `.unique()` + chequeo en `seedUser` — sección "Modelo de datos" |
| 8 | Password en claro en `npx convex run` (shell history/`ps`) | Mayor | Script de seed vía env gitignored — sección "Seed manual" |
| 9 | DAL de Next no protege funciones Convex expuestas a futuro | Mayor | Invariante `requireUser`/`requireRole` en Convex — sección "Invariante de seguridad" |
| 10 | Sin limpieza de sesiones expiradas | Menor | Cleanup oportunista + cron diario — sección "Limpieza de sesiones" |
| 11 | Sin pruebas de aislamiento de rol | Menor | Añadido a verificación E2E |
| 12 | Verificar `crypto.subtle`/determinismo en mutations | Menor | Mantenido como punto a verificar en primera pasada |

## Respuesta a la segunda revisión (v2 → v3)

| # | Hallazgo | Severidad | Resuelto en v3 |
|---|---|---|---|
| 13 | `seedUser` como mutation pública = API de registro encubierta | Bloqueante | Pasa a `internalMutation`, invocable solo con admin key — sección "Seed manual" |
| 14 | `getSessionUser` no puede borrar sesiones siendo `query` | Bloqueante | Se quita la escritura de la query; limpieza solo vía cron (y opcionalmente `login`/`logout`, que sí son mutations) — sección "Limpieza de sesiones" |
| 15 | Cookie `HttpOnly` inaccesible desde cliente para futuras queries reactivas | Mayor | Regla explícita: datos protegidos solo vía Server Components/Actions mientras dure este esquema — sección "Regla: sin queries reactivas de cliente" |
| 16 | Timing distingue "email no existe" de "password incorrecta" | Mayor | Verificación PBKDF2 señuelo cuando el usuario no existe — sección "Hashing" |
| 17 | `src/proxy.ts` no debe exportar `runtime` | Mayor | Corregido: exportar `runtime` en `proxy.ts` lanza error de build; Node.js es el único runtime y no es configurable — confirmado en `node_modules/next/dist/docs/.../file-conventions/proxy.md` |
| 18 | Riesgo abierto Web Crypto en mutations | Menor | Se mantiene como nota abierta, sin cambios |

## Respuesta a la tercera revisión (v3 → v4, "GO condicionado")

| # | Hallazgo | Severidad | Resuelto en v4 |
|---|---|---|---|
| 19 | Web Crypto en mutations no puede quedar como nota "menor" al final — todo el diseño depende de ello | Bloqueante (reclasificado) | Pasa a **Pre-check 1**, primer paso obligatorio antes de cualquier otro código — sección "Pre-checks obligatorios" |
| 20 | Debe verificarse explícitamente que `npx convex run` invoca `internalMutation` en esta versión exacta de Convex, no asumirlo solo por lectura de código fuente | Bloqueante (reclasificado) | Pasa a **Pre-check 2**, con plan de fallback explícito — sección "Pre-checks obligatorios" |
| 21 | Rate limit por IP (`x-forwarded-for`) sin normalizar es fácil de falsear | Menor | Especificado: primera IP de la cabecera, recorte de longitud, descarte de valores no-IP — sección "Rate limiting" |
| 22 | No se declara la política de sesiones múltiples por usuario | Menor | Declarado explícitamente — sección "Política de sesiones múltiples" |
| 23 | `DUMMY_PASSWORD_HASH` debe ser un hash real generado con el mismo formato, no un placeholder inventado | Menor | Especificado el procedimiento de generación — sección "Hashing" |

## Respuesta a la revisión de código (v5 → v6)

Revisión estática (sin instalar ni ejecutar) sobre el código ya escrito en `CODIGO/MIS-7-autenticacion-roles/`:

| # | Hallazgo | Severidad | Resuelto en v6 |
|---|---|---|---|
| 24 | `src/proxy.ts` podía entrar en **bucle infinito de redirects** con una cookie presente pero inválida (expirada/revocada): el proxy trataba "existe cookie" como "autenticado" y rebotaba `/login` → `/`; el DAL, al detectar la sesión realmente inválida, rebotaba de vuelta a `/login`; bucle sin fin | Bloqueante | Se quita del proxy la rama `hasSession && isPublicPath → redirect a "/"`. `/login` queda siempre accesible independientemente de la cookie. El "saltarse el login si ya hay sesión válida" se mueve a `src/app/(auth)/login/page.tsx`, que usa `getSession()` del DAL (chequeo **real** contra Convex, no la mera presencia de cookie) — ver "Decisión arquitectónica" |
| 25 | Matcher de `proxy.ts` con lista negativa (`todo excepto _next/static\|_next/image\|favicon.ico`) bloqueaba de más: assets públicos (`/next.svg`, `/robots.txt`) o futuros `/api/*` quedarían atrapados sin necesidad | Menor | Matcher explícito (allowlist): `["/", "/login", "/pendientes/:path*", "/panel/:path*"]` — cubre exactamente las rutas que existen hoy |
| 26 | No estaba declarado si el reset de `loginAttempts` tras login correcto también debía limpiar el contador por IP | Menor | Comportamiento confirmado como intencional: solo se resetea el contador por **email**, no el de IP — si un login válido reseteara también la IP, una única credencial conocida bastaría para "limpiar" el contador de IP y seguir probando otras cuentas desde el mismo origen. Documentado como comentario en `convex/auth.ts::login` |

## Pre-checks obligatorios (hacer esto ANTES de escribir cualquier otro archivo del plan)

Estos dos puntos eran notas "a verificar más adelante" en v3; el equipo de revisión los reclasifica como bloqueantes porque buena parte del diseño (hashing, tokens, sesiones, seed) depende de que ambos se cumplan en esta instalación concreta. Se resuelven con una prueba real, no se asumen.

**Pre-check 1 — Web Crypto dentro de `query`/`mutation` normales de Convex:**
Antes de escribir `convex/lib/password.ts`/`token.ts` definitivos, desplegar dos funciones mínimas desechables y probar ambas con `npx convex run` (no basta con probar solo una):
  - Una `mutation` de prueba que haga `crypto.getRandomValues(new Uint8Array(8))` y `await crypto.subtle.digest("SHA-256", ...)` (cubre `hashPassword`/`generateOpaqueToken`, usados por `login`/`seedUser`, que sí son mutations).
  - Una **`query`** de prueba que haga `await crypto.subtle.digest("SHA-256", ...)` (sin `getRandomValues`, una query no genera nada aleatorio) — esto es imprescindible probarlo por separado, porque `getSessionUser` es una `query` (no una `mutation`, ver sección "Limpieza de sesiones") y depende de `hashToken` para poder buscar por `by_tokenHash`. Que Web Crypto funcione en `mutation` no garantiza que funcione igual en `query`: son contextos de ejecución distintos en Convex.

Si ambas funcionan sin error → seguir con el diseño tal cual (Web Crypto en `mutation`/`query` normales). **Si falla alguna** (p. ej. `crypto is not defined` o restricción de determinismo): mover `hashPassword`, `verifyPassword`, `generateOpaqueToken` y `hashToken` a una Convex `action` con `"use node"` — la `action` no puede escribir en la base de datos directamente, así que `login`/`seedUser` pasarían a ser `action`s que internamente llaman a una `mutation` interna solo para el `insert`/`patch` final; el formato de almacenamiento (`pbkdf2_sha256$v1$i=600000$...`) no cambia. Si específicamente falla solo en `query` (no en `mutation`), habría que reconsiderar cómo `getSessionUser` verifica el token sin poder hashear en el propio contexto de lectura — evaluarlo en el momento si ocurre, no se puede resolver de antemano sin el resultado de la prueba.

**✅ Resultado (ejecutado)**: se desplegó `convex/_precheck.ts` (desechable, ya eliminado) con `cryptoMutationCheck` (mutation) y `cryptoQueryCheck` (query), ambas llamando a `crypto.getRandomValues`/`crypto.subtle.digest`. Las dos se ejecutaron con `npx convex run` sin error, devolviendo `{ ok: true, digestLength: 32 }` en ambos casos (32 bytes = SHA-256 correcto). **Web Crypto funciona igual en `mutation` y en `query`** en esta instalación — no hace falta el plan B de `"use node"`.

**Pre-check 2 — `npx convex run` invocando `internalMutation` con esta versión de Convex:**
Desplegar una `internalMutation` de prueba trivial (ej. `internal.ping` que devuelve `"ok"`) e invocarla con `npx convex run <archivo>:<función> '{}'` usando las credenciales de este proyecto. La lectura del código fuente del CLI (`node_modules/convex/src/cli/run.ts`, que usa `deployment.adminKey`) sugiere que debería funcionar, pero no se da por buena sin probarla. Si funciona → `seedUser` se implementa como `internalMutation` tal como describe este plan. **Si falla**: dos alternativas, en este orden de preferencia:
  a) Sembrar los usuarios desde el **Function Runner del dashboard de Convex** (tiene acceso a funciones internas igualmente, sin depender del CLI) — no requiere cambiar el código, solo el método de invocación.
  b) Si tampoco es viable, degradar `seedUser` a `mutation` pública **temporal**, protegida por comparar un `SEED_ADMIN_SECRET` (variable de entorno local, nunca commiteada) recibido como argumento contra el valor esperado, y **eliminarla del código** (o comentarla) en cuanto Carlos y Marta estén sembrados — documentar esto como deuda técnica explícita a resolver antes de desplegar a producción (MIS-21), no dejarla vigente indefinidamente.

**✅ Resultado (ejecutado)**: se desplegó `pingInternal`, una `internalMutation` trivial, dentro del mismo `convex/_precheck.ts` desechable. `npx convex run _precheck:pingInternal '{}'` la invocó sin error, devolviendo `"ok"`. **Confirmado: en esta instalación (Convex 1.42.1, deployment `dutiful-mole-111`), `npx convex run` invoca `internalMutation` correctamente** vía la admin key del deployment — `seedUser` se implementa como `internalMutation` según el diseño original, sin necesitar ninguno de los dos fallbacks.

## Decisión arquitectónica

Sesión en base de datos (Convex) con token opaco en cookie `HttpOnly`, no JWT — revocación instantánea en logout, sin `SESSION_SECRET`. Hashing con PBKDF2 vía Web Crypto en `mutation` normal de Convex (sin `"use node"`, sin dependencias nuevas). Protección de rutas: `src/proxy.ts` como check optimista (¿existe cookie?) + DAL (`src/lib/auth/dal.ts`) como fuente de verdad real en cada page.

**Importante (v6)**: el proxy solo redirige en una dirección — sin cookie + ruta protegida → `/login`. **No** redirige `/login` → `/` solo por existir la cookie, porque una cookie presente no implica sesión válida (puede haber expirado o haberse revocado), y esa suposición causaba un bucle infinito de redirects contra el DAL (hallazgo #24). Si se quiere saltar el formulario de login cuando ya hay sesión válida, esa comprobación vive en `src/app/(auth)/login/page.tsx` usando `getSession()` (chequeo real contra Convex), no en el proxy.

### Invariante de seguridad (nuevo, aplica también a MIS-9/13/17/18 futuras)

El DAL de Next.js protege **páginas**, no protege las funciones de Convex en sí — cualquier `query`/`mutation` expuesta es invocable directamente por cualquier cliente que tenga un token válido, sin pasar por Next.js. Por eso `convex/lib/authz.ts` expone:

```ts
export async function requireUser(ctx, token: string) // -> DTO seguro o throw ConvexError("No autenticado")
export async function requireRole(ctx, token: string, role: "rep" | "supervisor") // -> DTO o throw ConvexError("No autorizado")
```

**Regla para toda tarea futura**: cualquier `query`/`mutation` de Convex que lea o escriba datos que dependan del usuario conectado debe llamar a `requireUser`/`requireRole` como primera línea, no confiar en que ya se validó en el DAL de Next. Esto queda documentado aquí para que MIS-13/MIS-17/MIS-18 lo hereden.

### Regla: sin queries reactivas de cliente para datos protegidos (mientras dure este esquema)

El token de sesión vive en una cookie `HttpOnly` **a propósito** (para que no sea legible por JS y así no pueda robarse vía XSS) — pero eso significa que un componente cliente (`"use client"`) no puede leer el token para pasarlo como argumento a un `useQuery` de `convex/react`. Consecuencia arquitectónica explícita para este MVP: **todo acceso a datos protegidos por sesión se hace vía Server Components o Server Actions (`fetchQuery`/`fetchMutation`), nunca vía `useQuery` reactivo desde un componente cliente**, mientras el esquema de sesión sea el token opaco en cookie. Esto es una limitación real y consciente: se pierde la reactividad en tiempo real de Convex para datos protegidos (ej. el panel de Marta no se actualizará solo, habrá que refrescar o hacer polling).

Si una tarea futura (probablemente MIS-17, el panel en vivo de Marta, o MIS-9 en adelante) necesita reactividad real para datos protegidos, la vía es migrar el mecanismo de identidad a algo verificable por el cliente de Convex (JWT propio expuesto vía header `Authorization` en vez de cookie `HttpOnly`, o adoptar `@convex-dev/auth`/`ctx.auth` nativo de Convex), sustituyendo el token opaco actual — esa migración queda fuera del alcance de MIS-7 y debe decidirse explícitamente cuando la tarea que la necesite se planifique, no antes.

## Modelo de datos (`convex/schema.ts`)

```ts
users: defineTable({
  name: v.string(),
  email: v.string(),                // normalizado a lowercase antes de guardar
  passwordHash: v.string(),         // "pbkdf2_sha256$v1$i=600000$<salt_b64url>$<hash_b64url>" — algoritmo, versión, iteraciones y salt embebidos para poder migrar sin romper logins existentes
  role: v.union(v.literal("rep"), v.literal("supervisor")),
}).index("by_email", ["email"]),

sessions: defineTable({
  userId: v.id("users"),
  tokenHash: v.string(),             // SHA-256 del token opaco (32 bytes de entropía antes de hashear) — nunca el token en claro
  expiresAt: v.number(),
}).index("by_tokenHash", ["tokenHash"])
  .index("by_user", ["userId"]),

loginAttempts: defineTable({
  emailKey: v.string(),              // email normalizado, exista o no el usuario — evita distinguir "cuenta no existe" de "cuenta bloqueada"
  count: v.number(),
  windowStartedAt: v.number(),
  lockedUntil: v.optional(v.number()),
}).index("by_emailKey", ["emailKey"]),
```

**Unicidad de email**: Convex no tiene constraint `UNIQUE` nativo. Mitigación en dos capas:
- Lectura: usar `.unique()` del query builder (`ctx.db.query("users").withIndex("by_email", q => q.eq("email", email)).unique()`) en `login` y `getSessionUser` — este método de Convex **lanza error si hay más de una fila**, convirtiendo un duplicado silencioso en un fallo ruidoso e inmediato en vez de un login ambiguo.
- Escritura: `seedUser` consulta primero por `by_email` y **rechaza explícitamente** si ya existe una fila con ese email, antes de insertar (único punto de inserción de usuarios en el MVP, no hay más admin/registro).

## Hashing de contraseña (`convex/lib/password.ts`)

- Algoritmo: **PBKDF2-HMAC-SHA256**, **600.000 iteraciones** (recomendación OWASP vigente para este digest), salida derivada de **256 bits (32 bytes)**.
- Salt: `crypto.getRandomValues(new Uint8Array(16))`, único por usuario.
- Formato de almacenamiento versionado en un único string: `pbkdf2_sha256$v1$i=600000$<salt_b64url>$<hash_b64url>`. El versionado (`v1`) permite subir iteraciones o cambiar de algoritmo en el futuro sin romper los hashes ya guardados (se compara según el algoritmo/versión embebidos en cada fila, no uno global).
- Verificación: recalcular con el `salt`/`iterations` leídos del propio string, y comparar en **tiempo constante** (acumulador XOR byte a byte sobre longitudes iguales — nunca `===`/comparación con cortocircuito).
- Mensaje de error siempre genérico ("Email o contraseña incorrectos"), nunca distingue cuál campo falló.
- **Mitigación de timing (email inexistente vs. password incorrecta)**: si `.unique()` no encuentra ningún usuario con ese email, `login` **igualmente ejecuta `verifyPassword`** contra un hash señuelo fijo (`DUMMY_PASSWORD_HASH`) antes de devolver el error genérico. Así el coste computacional de la petición es equivalente exista o no la cuenta, y el tiempo de respuesta no sirve para enumerar emails válidos. **`DUMMY_PASSWORD_HASH` no es un placeholder inventado a mano** (nunca bytes a cero ni un string con la forma correcta pero relleno arbitrario) — se genera **una única vez**, ejecutando el propio `hashPassword()` de producción sobre un valor cualquiera (p. ej. `hashPassword(crypto.randomUUID())`, ejecutado una vez de forma manual), con los mismos parámetros reales (v1, 600.000 iteraciones). El string completo resultante (`pbkdf2_sha256$v1$i=600000$...`) se pega como constante literal en `convex/lib/password.ts`. Así pasa exactamente por el mismo parser/formato que un hash real al verificarlo — no hay rama de código especial para el caso "usuario no existe", solo una constante distinta.

## Token opaco de sesión (`convex/lib/token.ts`)

- `generateOpaqueToken()`: **32 bytes (256 bits)** de `crypto.getRandomValues`, codificados en base64url. Esta longitud es un requisito duro, no un detalle de implementación — un token corto anula la ventaja de guardar solo el hash.
- `hashToken(token)`: `crypto.subtle.digest("SHA-256", ...)` del token, es lo único que se guarda en `sessions.tokenHash`.

## Rate limiting y bloqueo de cuenta (`convex/lib/rateLimit.ts`, usado por `auth.ts::login`)

Orden de operaciones dentro de la mutation `login`, para que el timing no revele si el email existe:
1. Normalizar email → `emailKey`.
2. Leer/crear fila en `loginAttempts` por `emailKey`. Si `lockedUntil` está en el futuro → devolver error genérico ("Demasiados intentos, inténtalo de nuevo en unos minutos") **sin** consultar `users` ni verificar password.
3. Si no está bloqueado: buscar usuario por `.unique()` en `by_email`. Si no existe, o si existe pero la password no verifica → incrementar `count`; si `count` alcanza **5** dentro de una ventana de **15 minutos**, fijar `lockedUntil = now + 15min`; devolver siempre el mismo error genérico.
4. Si la password verifica → resetear `loginAttempts` (borrar fila o poner `count: 0`), crear sesión, devolver éxito.

Capa secundaria (best-effort, defensa en profundidad): `loginAction` (Server Action en Next) lee la IP del request (`x-forwarded-for` vía `headers()`) y la pasa como metadato a la mutation, que aplica un límite más laxo por IP (ej. 20 fallos/hora agregando todos los emails probados desde esa IP) usando la misma tabla con una `emailKey` prefijada `ip:`. Normalización obligatoria antes de usar el valor (una cabecera `x-forwarded-for` sin normalizar es trivialmente falseable por el cliente): tomar **solo la primera IP** de la lista separada por comas (la más cercana al cliente real cuando se confía en el proxy de la plataforma), recortar a una longitud máxima razonable (p. ej. 45 caracteres, suficiente para IPv6) y **descartar/ignorar** (tratar como "sin IP", no aplicar límite por IP esa vez) cualquier valor que no pase una validación simple de formato IPv4/IPv6. Se documenta como best-effort porque la fiabilidad de `x-forwarded-for` depende además de la plataforma de despliegue (a verificar en MIS-21 Deploy) — el control primario y obligatorio sigue siendo el bloqueo por email del paso 2–3.

## DTO seguro (`convex/auth.ts::getSessionUser`)

La query se declara con un `returns` validator explícito de Convex:
```ts
returns: v.union(
  v.null(),
  v.object({ id: v.id("users"), name: v.string(), role: v.union(v.literal("rep"), v.literal("supervisor")) }),
)
```
Convex **lanza error si el valor devuelto no coincide exactamente con el validator** — no es solo una anotación de tipos de TypeScript, es una validación en runtime. Esto hace estructuralmente imposible devolver `passwordHash`/`passwordSalt`/`email` por accidente: si alguien añade un campo al objeto retornado sin actualizar el validator, la función falla en vez de filtrar el dato. `email` se omite deliberadamente del DTO de sesión (no lo necesita ninguna página; solo se usa internamente en `login` para la búsqueda).

## Guards de rol por página

`src/lib/auth/dal.ts` añade, junto a `getUser()`:
```ts
export async function requireRole(role: "rep" | "supervisor") {
  const user = await getUser(); // ya redirige a /login si no hay sesión
  if (user.role !== role) redirect(user.role === "rep" ? "/pendientes" : "/panel");
  return user;
}
```
- `src/app/(app)/pendientes/page.tsx` llama `requireRole("rep")`.
- `src/app/(app)/panel/page.tsx` llama `requireRole("supervisor")`.
- El dispatcher `(app)/page.tsx` sigue usando `getUser()` a secas (no un rol fijo) para decidir a dónde redirigir.

## Limpieza de sesiones expiradas

`getSessionUser` es una **`query` pura de solo lectura** — Convex no permite escribir dentro de una `query` (el contexto `QueryCtx` ni siquiera expone `insert`/`patch`/`delete` en `ctx.db`), así que **no** hace ninguna limpieza al leer: si `expiresAt` ya pasó, simplemente devuelve `null` (equivalente a "no autenticado"), sin borrar la fila.

La limpieza real ocurre en dos sitios, ambos ya `mutation`:
- `convex/crons.ts` — cron diario que llama a una `internalMutation cleanupExpiredSessions` (borra en lote todas las filas de `sessions` con `expiresAt < now`). Es el mecanismo principal y suficiente por sí solo.
- Opcional/barato: `login` y `logout`, que ya son mutations, pueden aprovechar para borrar de paso cualquier sesión expirada del mismo `userId` (vía el índice `by_user`) que encuentren al pasar — no es necesario para la correctitud, solo reduce la ventana hasta el siguiente cron.

## Estructura de archivos (actualizada)

```
convex/
  schema.ts                        EDITAR — users, sessions, loginAttempts
  auth.ts                          NUEVO — login, logout, getSessionUser (query), seedUser (internalMutation, recibe passwordHash ya calculado, no la password en claro)
  crons.ts                         NUEVO — cron diario: cleanupExpiredSessions
  lib/
    password.ts                    NUEVO — hashPassword/verifyPassword (PBKDF2 versionado)
    token.ts                       NUEVO — generateOpaqueToken (32 bytes)/hashToken
    authz.ts                       NUEVO — requireUser/requireRole (invariante de seguridad)
    rateLimit.ts                   NUEVO — checkAndRecordAttempt/resetAttempts

src/
  proxy.ts                         NUEVO — check optimista de cookie, solo en una dirección (sin cookie → /login; nunca /login → / solo por cookie, ver v6). NO exporta `runtime` (en Next 16, `proxy.ts` usa Node.js siempre; exportar `runtime` lanza error de build). Matcher explícito: ["/", "/login", "/pendientes/:path*", "/panel/:path*"]
  lib/auth/
    dal.ts                         NUEVO — getSession()/getUser()/requireRole(role)
    actions.ts                     NUEVO — "use server": loginAction, logoutAction
    cookie.ts                      NUEVO — set/clear con httpOnly, secure, sameSite=lax, maxAge, path:"/" en ambos
  app/
    page.tsx                       ELIMINAR (ruta "/" pasa a (app)/page.tsx)
    (auth)/login/
      page.tsx, LoginForm.tsx      NUEVO
    (app)/
      layout.tsx                   NUEVO — getUser() + barra mínima (nombre, Avatar, logout)
      page.tsx                     NUEVO — dispatcher según rol
      pendientes/page.tsx          NUEVO — requireRole("rep"), placeholder (lo sustituye MIS-13)
      panel/page.tsx               NUEVO — requireRole("supervisor"), placeholder (lo sustituye MIS-17)

scripts/
  hash-password.mjs                NUEVO — calcula localmente el string `pbkdf2_sha256$v1$i=600000$...` a partir de una password leída por stdin (ver "Seed manual")
```

## Flujo

1. **Login**: `LoginForm.tsx` (`useActionState`) → `loginAction` → `fetchMutation(api.auth.login, {email, password, ipHint})`. En Convex: rate limit (ver arriba) → `.unique()` por `by_email` → verificación de hash → sesión nueva (`expiresAt = now + 30d`) → `{token, role}`.
2. `loginAction` fija la cookie (`httpOnly`, `secure` en producción, `sameSite: lax`, `path: "/"`, `maxAge` explícito de 30 días — sin esto la cookie se borra al cerrar el navegador) y redirige a `/pendientes` (rep) o `/panel` (supervisor).
3. **Verificación**: cada page protegida llama `getUser()` (o `requireRole()` si la página es específica de un rol) del DAL. `src/app/(auth)/login/page.tsx` llama `getSession()` (chequeo real) para saltar el formulario si ya hay sesión válida.
4. **`src/proxy.ts`**: check optimista de existencia de cookie, sin tocar Convex, y solo en una dirección (sin cookie + ruta protegida → `/login`) — ver nota v6 en "Decisión arquitectónica" sobre por qué no rebota en la dirección contraria.
5. **Logout**: `logoutAction` borra la fila de `sessions` (revocación real) y la cookie (mismos atributos `path`/`sameSite` que al fijarla), redirige a `/login`.

### Política de sesiones múltiples (declarada explícitamente)

Se permiten **múltiples sesiones simultáneas por usuario** — cada `login` crea una fila nueva en `sessions` sin tocar las anteriores, así que el mismo usuario puede estar conectado a la vez desde el móvil y el portátil, por ejemplo. `logout` revoca **únicamente la sesión actual** (la identificada por el token de la cookie que se está cerrando), no todas las sesiones del usuario. La limpieza de expiradas (cron) es independiente de esto y no distingue sesiones "activas" de "abandonadas" salvo por `expiresAt`. Si en el futuro se quisiera una política de "sesión única por usuario/dispositivo", habría que borrar explícitamente las sesiones previas del mismo `userId` dentro de `login` — no lo pide el criterio de aceptación de MIS-7 y queda fuera de alcance.

## Seed manual de Carlos y Marta

`seedUser` es una **`internalMutation`** (no `mutation` pública) — no forma parte de `api.*`, así que ningún cliente externo (navegador, `ConvexHttpClient` anónimo, etc.) puede invocarla jamás. Solo es invocable con la admin key del deployment, es decir, desde `npx convex run` (confirmado en `node_modules/convex/src/cli/run.ts`: el comando `run` se autentica con `deployment.adminKey`) o desde el dashboard de Convex.

Esto reabre el problema original (pasar la password en claro como argumento de `npx convex run` queda en el historial de shell y es visible en `ps aux`), así que se resuelve por otro lado: **`seedUser` no recibe la password en claro, recibe el hash ya calculado**.

1. `scripts/hash-password.mjs` — script local, sin dependencia de Convex, que pide la password de forma interactiva **por stdin, no como argumento de CLI** (así no queda nunca en el historial de shell). Preferible con entrada oculta (sin eco en pantalla): usar `readline` con el stream de salida silenciado mientras se escribe (patrón estándar de Node para prompts de contraseña), similar a como lo hace `npm login` u otras CLIs. Si por alguna razón esa entrada oculta no fuera viable de implementar de forma sencilla, el mínimo aceptable es que el script deje explícito en su propio texto de ayuda/comentario que la entrada es por stdin y no por argumento — nunca aceptar la password como parámetro posicional del script. Calcula `pbkdf2_sha256$v1$i=600000$<salt_b64url>$<hash_b64url>` con el módulo `crypto` nativo de Node (mismo algoritmo/parámetros que `convex/lib/password.ts`) y **imprime el string resultante** por stdout.
2. El desarrollador copia ese string (un hash, no una contraseña — filtrarlo exige romper 600.000 iteraciones de PBKDF2, no es un secreto en claro) y lo pega como argumento de:
   ```
   npx convex run auth:seedUser '{"name":"Carlos","email":"...","passwordHash":"pbkdf2_sha256$v1$i=600000$...","role":"rep"}'
   ```
3. Repetir para Marta. `seedUser` sigue siendo idempotente (rechaza si el email ya existe, ver "Modelo de datos").

Verificar el resultado con `npx convex data users` (solo se ve el hash codificado, nunca la password).

## Verificación end-to-end

1. Sembrar los 2 usuarios: `node scripts/hash-password.mjs` (uno por usuario) + `npx convex run auth:seedUser '{...}'` con el hash resultante, y confirmar en `npx convex data users`.
2. En incógnito, visitar `/pendientes` sin login → redirige a `/login`.
3. Login como Carlos → aterriza en `/pendientes`.
4. **Carlos intenta acceder manualmente a `/panel`** → debe redirigir a `/pendientes` (guard de rol), no mostrar el panel de Marta.
5. Cerrar el navegador entero y reabrir en `/` → sigue logueado, vuelve a `/pendientes` (cookie con `Expires` ~30 días, no "Session").
6. Logout → vuelve a `/login`; `npx convex data sessions` confirma que la fila desapareció; volver atrás con el navegador a `/pendientes` → vuelve a redirigir a `/login`.
7. Repetir 3–6 con Marta → aterriza en `/panel`; **Marta intenta acceder a `/pendientes`** → redirige a `/panel`.
8. Provocar 5 logins fallidos seguidos con el email de Carlos → el 6º intento (aunque la password sea correcta) debe devolver el error genérico de bloqueo; esperar la ventana o inspeccionar `loginAttempts` en el dashboard de Convex.
9. Probar credenciales incorrectas (dentro del límite) → mensaje genérico, sin crear sesión.
10. Confirmar que no existe ninguna ruta/formulario de registro público.
11. Intentar sembrar dos veces el mismo email con `seedUser` → la segunda debe rechazarse explícitamente, no duplicar la fila.
12. **Cookie inválida/revocada** (hallazgo #24): loguearse, luego borrar manualmente la sesión en `npx convex data sessions` / dashboard (o esperar a que expire) sin borrar la cookie del navegador, y volver a visitar `/pendientes` o `/` → debe llegar a `/login` y **quedarse ahí** (mostrar el formulario), sin entrar en bucle de redirects entre `/` y `/login`.

### Nota
Los dos riesgos técnicos que antes aparecían aquí como "a verificar más adelante" (Web Crypto en `mutation`/`query`, e invocación de `internalMutation` vía `npx convex run`) ya no son una nota al final — son los **Pre-checks obligatorios** al principio del plan (ver esa sección), a resolver antes de escribir el resto del código.

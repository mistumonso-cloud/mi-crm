# MIS-293 · 2.º PR — Cookies (B1 + B2)

## Contexto

Segunda (y última) unidad de MIS-293 (Fase 3 — Higiene), aparte del núcleo ya cerrado
(PR-1a/#58, PR-1a-bis/#59, PR-1b/#60). Dos hallazgos bajos sobre las cookies de autenticación,
centralizadas en `src/lib/auth/cookie.ts` (3 cookies: sesión, OAuth state, ticket de reseteo):

- **B1** — `secure` deja de depender de `NODE_ENV` (frágil: si en prod `NODE_ENV` ≠ `"production"`,
  las cookies viajarían **sin `Secure`**). Fail-safe: `secure: true`.
- **B2** — prefijos reforzados por el navegador: `__Host-` para la sesión (exige `Secure` + `Path=/`
  + **sin** `Domain`) y `__Secure-` para las de `path` ≠ `/`. B1 y B2 van juntos.

Decisiones del usuario: (1) incluir `__Secure-reset_ticket`; (2) corte limpio, sin lectura dual.

> **Historial de auditoría.** R1 NO-GO (M1): renombrar no invalida ni retira la `session` antigua →
> se adoptó **borrado transitorio activo** (opción (a)). R2 NO-GO (M2): ese borrado **no tenía prueba
> ejecutable**. **R3 (este):** se añade el **e2e de migración** que crea la `session` legada, la
> hace pasar por el redirect del proxy y demuestra su desaparición; se añade cobertura del borrado
> de `__Secure-google_oauth_state`; se corrige la búsqueda reproducible; y se ajusta cómo se acredita
> que `__Host-session` es host-only. No se reabren mecanismo de borrado, nombres, `secure:true`,
> paths, riesgo residual ni rollback (según §8 del auditor).

## M1 — Tratamiento de las cookies antiguas (sin cambios respecto a R2)

**Qué SÍ:** en cada `set`/`clear` de una cookie nueva se **borra su gemela antigua** en su path
original (`Max-Age=0`), sin leerla nunca (`session`→`/`, `google_oauth_state`→`/api/auth/google`,
`reset_ticket`→`/recuperar-contrasena`). Además, en **`src/proxy.ts`**, el redirect a `/login` de una
ruta *cookie-gated* sin `__Host-session` **borra la `session` antigua** (path `/`), retirándola en el
**primer** request sin esperar al login.

**Qué NO:** no se revocan sesiones **en servidor** (los tokens Convex siguen válidos hasta 30 d). El
efecto es: (1) el código nuevo deja de reconocer el nombre viejo y (2) la cookie vieja se borra del
navegador en login, logout y redirect del proxy. **Riesgo residual** (navegador que no vuelve a
interactuar conserva su cookie hasta expirar; un rollback la reconocería) y **rollback** (solo
frontend/Railway; el código viejo vuelve a leer `session`, y los `__Host-session` no serían
reconocidos → re-login): documentados y aceptados. Borrados **transitorios**; retirada en follow-up.

## Manifiesto de cambios

**Producción**
1. **`src/lib/auth/constants.ts`** — renombrar (y comentarios): `SESSION_COOKIE_NAME` →
   `"__Host-session"`, `OAUTH_STATE_COOKIE_NAME` → `"__Secure-google_oauth_state"`,
   `RESET_TICKET_COOKIE_NAME` → `"__Secure-reset_ticket"`.
2. **`src/lib/auth/cookie.ts`** — (a) `secure: true` en las 6 set/clear (B1); (b) borrado transitorio
   de la gemela antigua en cada set/clear (M1), con const locales de nombres legado no exportadas;
   (c) comentario que ancle `secure:true` y **advierta de no añadir nunca `domain` a la de sesión**
   ni cambiar su `path` de `/`.
3. **`src/proxy.ts`** — en el redirect a `/login` de rutas *cookie-gated*, borrar `session` legado
   (path `/`) en la respuesta (transitorio). El gating usa `__Host-session` por la constante.

**Tests**
4. **`e2e/helpers/convex-client.ts`** — importar `SESSION_COOKIE_NAME` desde
   `../../src/lib/auth/constants` en vez de los 3 literales `"session"`.
5. **`e2e/google-auth.spec.ts`** — usar `OAUTH_STATE_COOKIE_NAME` en el regex del `/start`, y asertar
   `Secure` + `Path=/api/auth/google` (set); **nuevo** caso de *clear* (ver matriz).
6. **`e2e/auth.setup.ts`** — aserción **obligatoria** de `__Host-session` (ver matriz).
7. **`e2e/password-reset.spec.ts`** — asertar `__Secure-reset_ticket` (set + clear) en el flujo real.
8. **`e2e/full-flow.spec.ts`** — aserción de logout: tras "Cerrar sesión", `__Host-session` ausente.
9. **`e2e/legacy-cookie-migration.spec.ts`** (**NUEVO**) — prueba de migración de M2 (ver abajo).
10. **`playwright.config.ts`** — añadir `legacy-cookie-migration.spec.ts` al `testMatch` del project
    `chromium-unauth` (sin storageState, sin dependencies).

## M2 — Prueba ejecutable del borrado transitorio (obligatoria)

Nuevo spec en el project **`chromium-unauth`** (sin sesión). Diseño literal:

```ts
// e2e/legacy-cookie-migration.spec.ts
import { test, expect } from "@playwright/test";
import { SESSION_COOKIE_NAME } from "../src/lib/auth/constants";

test("el proxy borra la cookie 'session' legada al redirigir a /login (sin __Host-session)", async ({
  page,
  context,
  baseURL,
}) => {
  // 1. Inyecta una cookie de sesión ANTIGUA (nombre legado 'session', path '/').
  await context.addCookies([{ name: "session", value: "token-legado-de-prueba", url: baseURL! }]);

  // 2. Ruta protegida SIN __Host-session → 3. el proxy redirige a /login.
  await page.goto("/panel");
  await expect(page).toHaveURL(/\/login/);

  // 4. La 'session' legada ya no existe (el proxy la borró en el redirect).
  const cookies = await context.cookies();
  expect(cookies.find((c) => c.name === "session")).toBeUndefined();

  // 5. Y no apareció __Host-session (no hemos iniciado sesión).
  expect(cookies.find((c) => c.name === SESSION_COOKIE_NAME)).toBeUndefined();
});
```

`addCookies({ url: baseURL })` fija `domain` del host y `path:"/"`. En dev/test el proxy salta los
checks de origen/host (NODE_ENV≠production) pero **mantiene** el gating de cookie, así que `/panel`
sin `__Host-session` redirige a `/login` y la respuesta borra `session`.

**Recomendado (segundo caso, no imprescindible):** en el mismo spec, inyectar `session` legada,
hacer login por el formulario (con `E2E_CARLOS_*`) y asertar que tras el login `session` ya no existe
y sí `__Host-session` (`secure===true`). Cubre el borrado por la vía de login además de la del proxy.

## Matriz de verificación e2e (set → read → clear), definitiva

Los nombres se comprueban con el **literal esperado** (un rename mal hecho en la constante se
detecta); los atributos vía `context.cookies()` / cabecera `Set-Cookie`:

- **`__Host-session`** — *set*: en `e2e/auth.setup.ts`, tras `waitForURL("/pendientes")` y antes de
  `storageState`, `context.cookies()` contiene `__Host-session` con `secure===true` y `path==="/"`.
  **Acreditación de host-only:** la prueba fuerte es que **Chromium haya aceptado** una cookie con
  prefijo `__Host-` (el navegador **rechaza** el prefijo si lleva `Domain`, o sin `Secure`/`Path=/`);
  por tanto su **mera presencia tras el login** demuestra host-only + Secure + Path=/. La inspección
  de `domain` se deja como dato auxiliar, no como prueba formal. *read*: los specs autenticados. *clear*:
  en `full-flow`, tras logout, `__Host-session` ausente.
- **`__Secure-google_oauth_state`** — *set*: en `google-auth.spec.ts` (`/start`), el `Set-Cookie`
  trae el nombre nuevo + `Secure` + `Path=/api/auth/google`, y su `state` coincide con la URL. *clear*
  (**nuevo**, testeable porque el callback la borra SIEMPRE, éxito o no — `route.ts:49-50`): inyectar
  `__Secure-google_oauth_state=<state>` (path `/api/auth/google`), hacer `GET
  /api/auth/google/callback?code=x&state=<state>` con `maxRedirects:0`, y asertar que el `Set-Cookie`
  de la respuesta **expira** `__Secure-google_oauth_state` (`Max-Age=0`/fecha pasada) en
  `Path=/api/auth/google`. Como `clearOAuthStateCookie` también emite el borrado de la gemela legada,
  el mismo `Set-Cookie` expira además `google_oauth_state` (aserción incluida) → cubre el borrado
  legado de OAuth.
- **`__Secure-reset_ticket`** — *set*: en `password-reset.spec.ts`, tras verificar el código,
  `context.cookies()` contiene `__Secure-reset_ticket` con `secure===true` y
  `path==="/recuperar-contrasena"`. *read*: el paso de fijar la nueva contraseña la lee. *clear*: tras
  completar el reseteo, ausente. (El borrado de la gemela legada `reset_ticket` usa el mismo
  mecanismo que ya prueba el spec de migración de M2; TTL 15 min.)

## Búsqueda reproducible post-cambio (obligatoria, corregida)

Cubre **todas las comillas** (dobles, simples, backticks) del literal `session` y los nombres
distintivos, y clasifica la salida (no se usan excludes: se **clasifica** que los únicos literales
de nombre viejo que quedan son los borrados transitorios en `cookie.ts`/`proxy.ts`):

```
git grep -nE "['\"\`]session['\"\`]" -- 'src/**' 'e2e/**'
git grep -nE "google_oauth_state|reset_ticket" -- 'src/**' 'e2e/**'
git grep -n 'NODE_ENV' -- 'src/lib/auth/cookie.ts'   # esperado: vacío
```

Criterio: las dos primeras solo deben devolver, como literales de **nombre de cookie**, los borrados
transitorios en `cookie.ts` y `proxy.ts` (más usos legítimos no-nombre como la tabla `sessions`, que
se clasifican explícitamente en el doc de auditoría); la tercera, vacía.

## Riesgo principal y mitigación

Cookies `Secure`/`__Host-`/`__Secure-` sobre **`http://localhost`**: **Chromium** (único navegador
del CI, `ci.yml` → `playwright install chromium`) trata `localhost` como *secure context* y las
acepta/reenvía sobre http, así que dev local y los e2e funcionan. **El e2e de CI (Chromium) es la
evidencia definitiva.** Invariante: **nunca** `domain` en la de sesión ni cambiar su `path` de `/`.

## Despliegue

**No** hay despliegue de Convex (sin cambios en `convex/`). Railway auto-despliega el frontend al
mergear a `main`. Efecto: corte limpio (re-login una vez) con borrado activo del legado. Smoke prod:
login (Carlos) → panel; logout borra `__Host-session`; y **comprobar que no queda una `session`
antigua tras el primer acceso protegido**; (si se toca) OAuth y recuperación.

## Verificación local

- `npm run lint`, `npm run build`.
- Suite e2e completa (`npm run test:e2e`): login/logout, `google-auth` (set+clear), recuperación,
  y **`legacy-cookie-migration`**. Verde = cookies `Secure` OK sobre localhost + renames + borrados
  consistentes.
- Búsqueda reproducible (arriba) clasificada sin literales de nombre viejo fuera de `cookie.ts`/`proxy.ts`.
- Igualdad byte-a-byte CODIGO ↔ repo; manifiesto completo en el doc de auditoría.

## Follow-up (deuda)

- Retirar los borrados transitorios **después** de superar el TTL máximo (30 d) desde la última
  versión desplegable que emitía nombres antiguos; conservar evidencia de que ninguna versión
  soportada los emite ya.
- Valorar test unitario de las opciones de las 3 cookies.
- Definir política de revocación de sesiones Convex para futuros renames.

## Gate

Este plan **NO** autoriza instalar/mergear/desplegar. Flujo: código (effort **high**) → entrega
autocontenida en `CODIGO/MIS-293-cookies/` → **auditoría de código externa** (GO/NO-GO) → instalar →
PR (permiso antes del push) → CI verde → merge (asistente, con permiso) → Railway auto-despliega →
smoke en prod → cerrar el PR de cookies. Con esto queda cerrado MIS-293.

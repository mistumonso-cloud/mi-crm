# MIS-295 — Ejecutor seguro de verificación de login (habilita MIS-291)

## Contexto

MIS-291 (retirar el veto por email) necesita ejecutar las pruebas 11-12 (logins de
verificación) contra prod. Automatizarlas con bash + `npx convex run` fue NO-GO (B2:
secretos en argv). Decisión: **dividir**. MIS-295 construye un **ejecutor seguro,
testeado**, que MIS-291 se limitará a consumir.

Resultado: una herramienta en Node con **una única autoridad de deployment**, **secretos
fuera de argv**, **preflight fail-closed** (gate + estado inicial + login base), una
**máquina de ejecución** que serializa señales/transición-en-vuelo/recuperación mediante
una **única `recoveryPromise`**, y **tests unitarios**.

## Historial de auditoría

- Ronda 1 → NO-GO: B1, M1, M2, M3 (sin señales). Corregidos.
- Ronda 2 → NO-GO: M3 (carrera señal/transición), M4 (dry-run dev no restaura). Corregidos.
- Ronda 3 → NO-GO: **M3** (la recuperación no puede pasar por el `runStep` con `aborted`),
  **M5** (`env list` mete todos los secretos en el proceso), **M6** (falta adaptador de
  `logout`). Corregidos abajo. El diseño **no se amplía** con arquitectura nueva.

## Hallazgos de exploración que fijan el diseño

- `loginWithPassword` `action` pública (`convex/auth.ts:188-217`): HTTP con
  `action(makeFunctionReference("auth:loginWithPassword"), {email,password,serverKey,ipHint?})`
  en el cuerpo (patrón `e2e/helpers/test-support.ts:75-96`). Retorno unión discriminada
  `{success:true,token,role}` | `{success:false,error}`.
- `logout` `mutation` pública (`auth.ts:218`, `{token}`) → cierra sesiones base.
- `accountsPendingRotation` `internalQuery` (`auth.ts:335-347`): gate por
  `convex run auth:accountsPendingRotation <selector>` (sin args → sin secretos).
- **Autoridad única (B1):** `convex env get CONVEX_CLOUD_URL <selector>` da la URL del propio
  deployment. HTTP y CLI derivan del mismo `selector`; **el nombre del deployment es el del
  selector, nunca parseado de la URL** (puede ser dominio personalizado). `env`/`run` aceptan
  `--prod` y `--deployment <name>`.
- Constantes (`auth.ts:30-31`): `LOCKED_ERROR`=`"Demasiados intentos, inténtalo de nuevo en unos
  minutos"`; `GENERIC_ERROR`=`"Email o contraseña incorrectos"`.
- `node:test`+`node:assert`. Scripts `.mjs` ESM solo `node:*`; secretos por stdin oculto, nunca argv.

## Diseño

Entrega en `CODIGO/MIS-295-ejecutor-seguro/` → instalada en `scripts/login-verify/`. Inyección de
dependencias para testear la lógica pura con adaptadores falsos.

### Autoridad única de deployment (B1)

`resolveTarget(selector, cli)` → `{selector, name, url}`; `name` sale del selector, `url` de
`cli(["env","get","CONVEX_CLOUD_URL",...selector])`. HTTP y CLI derivan del mismo selector.

### Máquina de ejecución y recuperación (M3)

Estado `{ aborted, inFlight, recoveryPromise }`.
- `runStep(fn)` (transiciones **ordinarias**): si `aborted` → lanza `AbortError`; si no,
  `inFlight = fn()`, `await`, limpia `inFlight`. Serializa las transiciones normales.
- **`recoverOnce()` — vía EXCLUSIVA de recuperación, ejecutable tras `aborted`:**
  memoiza una única `recoveryPromise`; a la primera llamada la crea como
  `(async () => { if (inFlight) await inFlight.catch(()=>{}); return safeRecover(); })()`.
  `safeRecover` usa un ejecutor **privilegiado** (NO pasa por el `aborted` de `runStep`), pero
  solo tras esperar la transición ordinaria en vuelo → **off gana**. Cualquier segunda llamada
  (2.ª señal o `finally`) devuelve **la misma** promesa; nadie sale antes de que resuelva.
- **Señales `SIGINT`/`SIGTERM`:** `aborted=true`; `await recoverOnce()`; salir con **130/143** si
  la recuperación tuvo éxito (semántica de interrupción), **3** si `RecoveryError`. Una 2.ª señal
  durante la recuperación **no** termina el proceso: espera la misma `recoveryPromise`.
- **`finally`** del flujo normal: si hubo excepción, `await recoverOnce()` (misma promesa/guard).

### `core.mjs` — lógica pura, `deps = { action, mutation, cli, secrets, log, runner }`

- `classifyLogin(result)` → `'success'|'locked'|'generic'|'other'` por `LOCKED_ERROR`/`GENERIC_ERROR`;
  **no** expone `token`. Capa **privada** `extractToken(result)` (solo para alimentar `logout`),
  nunca en salida serializada.
- `closeSession(deps, token)` → `deps.mutation(makeFunctionReference<"mutation">("auth:logout"), {token})`
  (M6). Token solo en memoria/cuerpo; excluido de logs y errores.
- `readVetoState(deps, target)` (M5): `env list --names-only <selector>` para **presencia**; solo si
  aparece `LOGIN_EMAIL_VETO`, `env get LOGIN_EMAIL_VETO <selector>` para su valor. Nunca se captura
  el valor de otras variables. Distingue **ausente** (activo) de **valor**; exit≠0 → indeterminado → abortar.
- `preflight(deps, target)` — fail-closed, sin efectos de config; aborta antes de armar recuperación:
  1. `resolveTarget`.
  2. **Confirmación de prod:** flag `--confirm <name>` que debe igualar `target.name` (del selector).
  3. **Gate:** `accountsPendingRotation()`==`[]` exacto (error/vacío/malformado/≠`[]` → abortar).
  4. **Estado inicial (M1):** `readVetoState` debe ser **activo**; `off`/indeterminado → abortar.
     Captura el estado inicial exacto (ausente vs valor) para el modo restauración.
  5. **Login base (M2):** login correcto → `success:true`; `extractToken` + `closeSession` (no deja
     sesión huérfana). Demuestra credenciales, canal HTTP y el login de limpieza que necesita la recuperación.
- `runVetoSequence(deps, target)` vía `runStep`: 5 fallos+correcto (LOCKED), `set off`+`names/get`==off,
  correcto (success), `set activo`+comprobar+regenerar bloqueo+correcto (LOCKED), `set off`+comprobar==off+correcto.
  Los logins correctos de los pasos 3 y 5 **también cierran su sesión** con `closeSession` tras haber
  reseteado los contadores. 5 contraseñas incorrectas aleatorias y distintas de la correcta.
- `finalState(mode, initial)` (M4): **prod/MIS-291** → deja `off`; **preview desechable** → restaura el
  estado inicial exacto (`env remove` si ausente; repone si explícito).
- `safeRecover(deps, target)` → `set off`, verifica `names/get`==off y login correcto `success` (y cierra
  su sesión); si no → `RecoveryError`. Idempotente vía `recoveryPromise`.

### `index.mjs` — entrypoint

- Orden: `preflight` → armar runner + handlers de señal → `runVetoSequence` → `finalState`.
- `action`/`mutation`: `new ConvexHttpClient(target.url)` con **logger silenciado**;
  `.action(...)` / `.mutation(...)`; errores del cliente **sanitizados** antes de imprimir.
- `cli`: `execFile("npx",["convex",...args,...selector])` (`off`/`activo` no son secretos).
- `secrets`: **stdin de 2 líneas exacto** — L1 contraseña de `carlos@test.local`, L2 `AUTH_SERVER_KEY`;
  rechaza líneas ausentes/de más. En memoria; nunca disco/argv.
- Salida `{success, clasificación}`; centinelas de pw/serverKey/**token** ausentes de stdout/stderr/errores.
- **Códigos:** `0` ok · `2` preflight abortó (sin efecto) · `1` prueba fallida · `130`/`143` recuperación
  OK tras SIGINT/SIGTERM · `3` recuperación fallida. La recuperación no enmascara el código real.

### `core.test.mjs` — `node:test` + `node:assert`, adaptadores FALSOS

- **M3:** adaptador `cli` retardado; SIGINT mientras `set activo` está en vuelo → recuperación **espera**
  y el estado final es `off`, **una sola** recuperación. **2.ª señal durante la recuperación** → espera la
  misma `recoveryPromise`, no sale antes. Señales también durante `set off`/login de recuperación/verificación.
- **M5:** secreto ajeno centinela (`OTRA_CLAVE`) presente en el deployment → el ejecutor usa `--names-only`
  y **nunca** solicita ni recibe su valor; no aparece en memoria/salida.
- **M6:** `closeSession` invoca el adaptador `mutation` con `auth:logout` y `{token}`; el token no aparece
  en salida ni errores.
- **B1** (destinos no mezclables), **preflight fail-closed** (gate≠[]/error/vacío/malformado; veto inicial
  off; login base fallido), `classifyLogin`, `readVetoState` (ausente vs error), **M4** (restauración vs off),
  fallo por transición, y **sin secretos** (centinelas pw/serverKey/token).

## Ficheros

- `CODIGO/MIS-295-ejecutor-seguro/{core.mjs,index.mjs,core.test.mjs,README.md}`.
- Instalación → `scripts/login-verify/{...}` **copiando** desde la entrega; check de igualdad byte-a-byte.
- `package.json`: `"test:unit": "node --test scripts/login-verify/"`.
- Reutiliza `convex/browser` (`ConvexHttpClient`) y `convex/server` (`makeFunctionReference`).

## No-objetivos

- No recuperación ante SIGKILL / corte de energía / pérdida persistente de red (documentado).
- No framework general; alcance = verificación de auth del login.
- **No toca `convex/` ni `src/`**; es tooling de operaciones.
- **No se ejecuta contra prod en MIS-295** (eso es MIS-291).

## Verificación

- `node --test scripts/login-verify/` en verde (fakes: B1, preflight, **M3 carrera + 2.ª señal**,
  **M5 secreto ajeno**, **M6 logout**, M4, sin secretos).
- `eslint scripts/login-verify` limpio; check de igualdad CODIGO ↔ scripts.
- **Sin dry-run sobre dev compartido.** Integración end-to-end **opcional** solo contra un **preview
  desechable** (`convex deploy --preview-create`); nota documentada: ante excepción, el camino de
  recuperación deja `off` (aceptable por desechable) en vez de restaurar el inicial de `finalState`.

## Gate

Este plan **no es GO**. Va a auditoría externa; solo tras el veredicto explícito se crea rama y se
escribe el código en `CODIGO/MIS-295-ejecutor-seguro/`.

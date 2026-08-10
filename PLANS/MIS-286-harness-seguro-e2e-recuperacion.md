# MIS-286 — Harness seguro de pruebas e2e para recuperación de contraseña

> **Plan v3 — tras 4ª ronda (NO-GO: B1 por persistencia en artefactos de Playwright). M10 y M11 quedaron resueltos y no se reabren. Requiere GO antes de escribir código.**
>
> Ticket: [MIS-286](https://linear.app/mistu-monso/issue/MIS-286/harness-seguro-de-pruebas-e2e-para-recuperacion-de-contrasena) · **Bloquea a** [MIS-285](https://linear.app/mistu-monso/issue/MIS-285/email-transaccional-con-resend-recuperacion-de-contrasena)

---

## Contexto

MIS-285 añade recuperación de contraseña por código (OTP) enviado por email. Sus garantías de seguridad (caducidad, 5 intentos, ticket de un solo uso, invalidación de sesiones) **no son verificables** sin un harness: el código real llega por correo y en la BD solo se guarda su hash.

El deployment Convex de **dev es compartido y accesible desde internet** sin credencial administrativa. Cualquier función pública es invocable por cualquiera con `ConvexHttpClient`. Este ticket construye el harness de forma que eso no abra ninguna vía de ataque.

## Principio de diseño

**Ninguna función de test se protege con un booleano, y ninguna credencial válida vive en el repositorio.** Tres capas independientes:

1. **Credencial de alta entropía** (quién llama), comparada *fail-closed*.
2. **Identidad dedicada** (sobre quién se opera).
3. **Secretos efímeros**: las contraseñas de la identidad dedicada se **generan en cada ejecución** y solo se devuelven al llamante ya autenticado.

---

## Cambios de v1 → v2 (respuesta a la 3ª ronda)

| # | Corrección |
|---|---|
| **B1 (v2)** | La identidad dedicada **ya no tiene contraseña "conocida"**: `resetTestIdentity` genera una aleatoria en cada llamada y la devuelve **solo** al llamante autenticado. Resuelto. |
| **B1 (v3)** | **Nueva vía cerrada:** la contraseña efímera podía persistir en **trazas y artefactos de Playwright** publicados 14 días por CI. Se añade **política de no captura** (project dedicado), se **minimiza el paso del secreto por el navegador**, y se añade un **gate ejecutable con centinela y control positivo** que lo demuestra (§10). |
| **M10** | **MIS-286 pasa a definir el esquema de `passwordResetCodes`** (además de `testOutbox`). MIS-285 deja de crearla y solo la usa. Se rompe así la dependencia circular: al mergear MIS-286 todo compila. |
| **M11** | Contrato de `recordOutbox` fijado: **internal, sin `serverKey`**, valida estrictamente la identidad dedicada; `deliverResetCode` **solo la invoca** para `RESET_TEST_EMAIL`, y **cualquier otro destinatario omite el outbox y sigue hacia Resend con normalidad**. |
| Menores | 9 secrets en CI (no 8); la prueba de 5 fallos de login **omite `ipHint`**; `getLastResetCode` devuelve `null` con outbox vacío; basta probar una mutation y una query con credencial incorrecta (guard compartido). |

---

## 1. Autenticación de las funciones de test (capa 1)

Reutiliza el patrón que **ya existe** para `loginWithGoogle` (`convex/auth.ts:137-163`): argumento `serverKey` comparado con `constantTimeEqual` (`convex/lib/password.ts:48`) contra una variable de entorno de Convex.

```ts
// RESET_TEST_EMAIL vive en un único sitio compartido, convex/lib/testIdentity.ts,
// y lo importan tanto testSupport.ts (MIS-286) como passwordReset.ts (MIS-285).
import { RESET_TEST_EMAIL } from "./lib/testIdentity";

const TEST_SUPPORT_ENV_VAR = "E2E_TEST_SUPPORT_KEY";

function assertTestKey(serverKey: string): void {
  const expected = process.env[TEST_SUPPORT_ENV_VAR];
  const ok = !!expected && constantTimeEqual(
    new TextEncoder().encode(serverKey),
    new TextEncoder().encode(expected),
  );
  if (!ok) throw new Error("No autorizado");   // fail-closed
}

function assertDedicatedIdentity(email: string): string {
  const key = normalizeEmailKey(email);
  if (key !== RESET_TEST_EMAIL) throw new Error("Identidad no permitida");
  return key;
}
```

- **En producción la variable no existe** → `expected` es `undefined` → **toda** función de test lanza, aunque el código esté desplegado.
- Vive en **Convex env (dev)** y **GitHub Secrets** (inyectada al job `e2e`, como los **9** secrets que ya hay). **Nunca** en el navegador ni en el repositorio: los specs la leen de `process.env` en el proceso Node de Playwright y no la pasan a la página.
- Generación: 32 bytes aleatorios en base64url.

## 2. Identidad dedicada (capa 2)

Toda función pública del módulo llama a `assertDedicatedIdentity(args.email)` como segunda línea. Lo que aporta esta capa, con precisión: **el harness no puede tocar `carlos@test.local`, `mistumonso@gmail.com` ni ninguna cuenta real** — ni sembrarlas, ni leer sus OTP, ni inspeccionar sus sesiones.

> **No es una garantía de daño acotado.** Ver §Riesgos: como el rol no autoriza nada, la identidad dedicada tiene acceso completo al CRM de dev, así que una filtración de la credencial **exige rotación inmediata**.

> Esta capa es indispensable porque **el rol no autoriza nada**: `requireRole` se retiró en MIS-251 (ver comentario en `convex/lib/authz.ts:45`), así que cualquier usuario autenticado tiene escritura completa sobre el CRM.

## 3. Secretos efímeros (capa 3 — resuelve B1)

**Invariante: no existe en el repositorio ninguna contraseña válida de la identidad dedicada.**

- `resetTestIdentity` genera la contraseña con `generateOpaqueToken()` (32 bytes, `convex/lib/token.ts:19`), la guarda con `hashPassword` y **devuelve el valor en claro únicamente al llamante ya autenticado**. Cada ejecución produce una contraseña distinta.
- Los specs la reciben en memoria; no se escribe a disco, ni a `.env*`, ni se hardcodea, ni se registra en logs.
- La contraseña *nueva* que MIS-285 fija durante el flujo también se genera en tiempo de ejecución en Node, nunca como literal.
- **Y no se captura en artefactos** — ver §10, que es la parte que faltaba en la v2.
- Resultado: leer el repositorio no da acceso a nada. Sin `E2E_TEST_SUPPORT_KEY` no se puede obtener ninguna contraseña válida, y por tanto tampoco entrar por el login normal.

## 4. Esquema — `convex/schema.ts` (editar) · resuelve M10

MIS-286 define **ambas** tablas para que el harness compile en su propio merge:

```ts
// Tabla de producción — su LÓGICA la aporta MIS-285; aquí solo el esquema,
// para que testSupport.ts compile al mergear este ticket. Queda vacía hasta MIS-285.
passwordResetCodes: defineTable({
  userId: v.id("users"),
  codeHash: v.optional(v.string()),
  expiresAt: v.number(),
  attempts: v.number(),
  ticketHash: v.optional(v.string()),
  ticketExpiresAt: v.optional(v.number()),
  usedAt: v.optional(v.number()),
})
  .index("by_user", ["userId"])
  .index("by_ticketHash", ["ticketHash"]),

// Tabla exclusiva de test: solo recibe filas de la identidad dedicada.
testOutbox: defineTable({
  email: v.string(),
  code: v.string(),
  createdAt: v.number(),
}).index("by_email", ["email"]),
```

`expireResetCode` y la limpieza de códigos de `resetTestIdentity` compilan y son **no-ops** hasta que MIS-285 aporte el flujo; su verificación funcional ocurre en MIS-285, como estaba previsto.

## 5. Módulo `convex/testSupport.ts` (crear)

Todas las funciones declaran `args`/`returns`. Las **públicas** empiezan con `assertTestKey(args.serverKey)` + `assertDedicatedIdentity(args.email)`.

| Función | Tipo | `serverKey` | Qué hace |
|---|---|---|---|
| `resetTestIdentity` | mutation | ✅ | **Reseed idempotente**: upsert de `reset@test.local` (rol `rep`) con **contraseña recién generada**; borra sus `passwordResetCodes`, su `testOutbox`, **sus sesiones** y **sus claves de rate limit** (§6). **Devuelve `{password}`** al llamante autenticado. |
| `getLastResetCode` | query | ✅ | Último código en claro del outbox de la identidad. **Devuelve `null` si está vacío.** |
| `expireResetCode` | mutation | ✅ | Lleva `expiresAt` (y `ticketExpiresAt` si existe) al pasado (§7). |
| `countSessionsFor` | query | ✅ | Nº de sesiones activas de la identidad (verifica la invalidación). |
| `recordOutbox` | **internalMutation** | ❌ (§8) | Deposita el código en `testOutbox`. La invoca el envío de MIS-285. |

## 6. Limpieza determinista de rate limits (M8, ya aprobado)

Los contadores viven en `loginAttempts` (`convex/schema.ts:225`), **separados** de códigos y outbox: un reseed que no los toque deja el bloqueo puesto y la siguiente ejecución falla ≥15 min.

`resetTestIdentity` borra por `by_emailKey` **exactamente** estas tres claves derivadas de la identidad dedicada:

- `reset@test.local` (login)
- `reset:reset@test.local` (solicitudes de código)
- `resetcode:reset@test.local` (intentos de código)

**Nunca** borra claves `ip:*` / `resetip:*`: son **compartidas** entre usuarios y limpiarlas debilitaría el rate limiting real. Enumeración explícita, sin borrados por prefijo.

## 7. Control de caducidad (M9, ya aprobado)

`expireResetCode({serverKey, email})` busca la fila activa de la identidad dedicada y hace `patch` de `expiresAt` (y `ticketExpiresAt` si está) a `now - 1000`. Permite probar la expiración en segundos en vez de esperar 15 minutos, **sin** abstracción de reloj y sin tocar la lógica de producción.

## 8. Contrato de `recordOutbox` (resuelve M11)

Redactado de forma **idéntica** en el plan de MIS-285:

- Es **`internalMutation`**: no forma parte de `api.*`, ningún cliente externo puede invocarla. Por eso **no recibe `serverKey`** — excepción explícita y justificada a la regla general del harness.
- **Valida estrictamente la identidad dedicada**: lanza si el email normalizado no es `RESET_TEST_EMAIL` (defensa en profundidad, por si un futuro call site se equivoca).
- **Inerte sin credencial configurada**: si `process.env.E2E_TEST_SUPPORT_KEY` no está definida, no escribe nada y retorna. En producción la variable no existe → aunque algo la invocara, jamás escribiría un OTP en claro.
- `deliverResetCode` (MIS-285) **solo la invoca** cuando el email normalizado es exactamente `RESET_TEST_EMAIL`.
- **Cualquier otro destinatario omite el outbox y continúa con normalidad hacia Resend**, de modo que la prueba manual en dev con un email real funciona sin tropezar con el harness.

## 9. Cableado con CI y entornos

| Variable | Convex dev | Convex prod | GitHub Secrets |
|---|---|---|---|
| `E2E_TEST_SUPPORT_KEY` | ✅ `npx convex env set` | ⛔ **debe estar AUSENTE** (gate de predeploy) | ✅ inyectada al job `e2e` |

- `.github/workflows/ci.yml` (editar): añadir `E2E_TEST_SUPPORT_KEY: ${{ secrets.E2E_TEST_SUPPORT_KEY }}` al bloque `env` del paso `npm run test:e2e` (ya existen **9** secrets ahí).
- `.env.test.local.example` (editar): documentar la variable (vacía, como las demás). **No** se añade contraseña alguna de la identidad dedicada: ya no existe una fija.
- `README.md` (editar): sección de testing — qué es el harness, las tres capas, y el gate de "ausente en prod".
- Comprobación en prod: `npx convex env list --prod` no debe listarla (checklist de despliegue).

## 10. Política de artefactos: el secreto no puede persistir en trazas (cierra B1)

**El problema:** `playwright.config.ts:26` fija `trace: "retain-on-failure"` y `video: "retain-on-failure"`, y `.github/workflows/ci.yml` publica `playwright-report/` con **14 días de retención**. Las trazas **serializan los parámetros de las acciones**, así que un `fill()` con la contraseña efímera queda como texto dentro del trace. Si un spec falla antes de rotarla, el artefacto contiene una **credencial válida** de una cuenta con acceso completo al CRM de dev.

### 10.1 Project dedicado sin captura

Se añade a `playwright.config.ts` un project para **todos** los specs que manejan contraseñas efímeras:

```ts
{
  name: "chromium-secrets",
  testMatch: ["test-support.spec.ts"],        // MIS-285 añade aquí sus dos specs
  use: {
    ...devices["Desktop Chrome"],
    trace: "off", video: "off", screenshot: "off",
  },
}
```

Los demás projects conservan su configuración actual.

**Pero desactivar la captura NO basta — lo demostró el propio gate.** Playwright (1.61) escribe `error-context.md` **siempre** que un test falla (`node_modules/playwright/lib/index.js`, `didFinishTest`), y ese fichero incluye un *page snapshot* en ARIA con el **valor de los inputs en claro**, también el de un `input[type=password]`. No lo controlan `trace`/`video`/`screenshot` y **no existe opción para desactivarlo**. En la primera ejecución del gate, la fase B falló señalando exactamente ese fichero.

Solución: **`e2e/helpers/secure-test.ts`**, un `test` endurecido con un fixture automático que **vacía el valor de todos los inputs al terminar el test**. El snapshot lo toma Playwright en el teardown de su fixture `_setupArtifacts`, que se desmonta *después* de este (los fixtures se desmontan en orden inverso y este depende de `page`), así que el snapshot se genera ya sin valores. `error-context.md` sigue existiendo y sigue siendo útil para depurar (estructura, error, código fuente); solo desaparecen los valores tecleados.

**Todos** los specs de `chromium-secrets` importan `test` de ahí, no de `@playwright/test`. Con las dos piezas juntas (no captura + scrub del DOM), la fase B del gate pasa.

### 10.2 Minimizar el paso del secreto por el navegador

Las comprobaciones de credenciales se hacen desde **Node** con `ConvexHttpClient` (`api.auth.login`), no rellenando formularios:

- "la contraseña efímera es válida" y "la antigua ya no sirve" → vía `api.auth.login`, fuera del navegador.
- Lo único que se teclea en la UI es la **contraseña nueva** del formulario de restablecimiento (la funcionalidad bajo prueba), y ocurre dentro de `chromium-secrets`, sin captura.

### 10.3 Gate ejecutable: centinela con control positivo

`scripts/check-secret-leak.mjs`, invocado por `npm run test:e2e:secret-gate` y por un **paso propio en CI**.

**Aislamiento del enrutado (condición obligatoria).** El gate usa una **configuración Playwright separada**, `playwright.gate.config.ts`, con **dos projects exclusivos** que recogen únicamente `secret-sentinel.spec.ts`:

```ts
// playwright.gate.config.ts — SOLO lo usa el gate, nunca `npm run test:e2e`
projects: [
  { name: "gate-trace",   testMatch: ["secret-sentinel.spec.ts"],
    use: { ...devices["Desktop Chrome"], trace: "on", video: "on", screenshot: "on" } },
  { name: "gate-secrets", testMatch: ["secret-sentinel.spec.ts"],
    use: { ...devices["Desktop Chrome"], trace: "off", video: "off", screenshot: "off" } },
]
```

Y la configuración principal **excluye explícitamente** ese spec (`testIgnore: ["secret-sentinel.spec.ts"]`), además de que ningún project suyo lo matchea. Así **`npm run test:e2e` nunca ejecuta el fallo intencional**.

- **Fase A — control positivo.** Ejecuta el centinela bajo `gate-trace`; el spec teclea un valor aleatorio en un campo de contraseña y **falla a propósito**. El script exige que el centinela **SÍ aparezca** en los artefactos (incluido el trace descomprimido). Sin esta fase, un gate que no encuentra nada podría simplemente estar mirando mal. Además comprueba que el proceso terminó **por ese fallo intencional** y no por un error de configuración, arranque o falta de navegador. Después borra esos artefactos.
- **Fase B — la garantía.** Ejecuta el mismo spec bajo `gate-secrets` y exige que el centinela **NO aparezca** en los ficheros de salida, **dentro de los `.zip` de trace** (descomprimir y buscar; un `grep` sobre el zip comprimido no sirve) **ni en el stdout/stderr del proceso**, cubriendo literalmente "ni logs ni artefactos".
- **Cero tests = fallo.** Cada fase verifica en el reporte JSON que se ejecutó **exactamente 1 test**; si una fase recoge 0 tests (por un `testMatch` mal escrito, p. ej.), el gate **falla** en vez de dar un falso verde.
- **Directorios de salida propios y recién creados** por fase (`--output` distinto para A y B, borrados y recreados antes de cada una), para que resultados antiguos no contaminen el escaneo.
- **Diagnóstico sin filtrar**: al informar de una infracción se imprime **la fase y la ruta del fichero**, nunca el valor del centinela.
- Sale con código ≠ 0 si la fase A no lo encuentra, si la fase B sí, o si alguna fase no ejecutó su test.

El centinela es una cadena aleatoria sin valor, no una credencial real.

### 10.4 No se depende del cleanup

El control primario es **no capturar**, demostrado por el gate. La rotación al inicio de cada ejecución (`resetTestIdentity`) es **complementaria**: cubre que una contraseña no siga viva entre ejecuciones, pero **no se le confía la garantía**, porque una interrupción del proceso se la saltaría.

## Ficheros a crear/tocar

1. `convex/lib/testIdentity.ts` (crear) — exporta `RESET_TEST_EMAIL`, única fuente de la constante.
2. `convex/schema.ts` (editar) — `passwordResetCodes` + `testOutbox`.
3. `convex/testSupport.ts` (crear) — las 5 funciones y los dos guards.
4. `.github/workflows/ci.yml` (editar) — nuevo secret en el job `e2e` **y paso propio para el gate de fugas**.
5. `.env.test.local.example` (editar).
6. `README.md` (editar).
7. `e2e/helpers/test-support.ts` (crear) — envoltorio fino que lee `E2E_TEST_SUPPORT_KEY` de `process.env` y expone `resetTestIdentity()`, `getLastResetCode()`, `expireResetCode()`, `countSessionsFor()` y `loginSucceeds()` sobre `convexClient()` (`e2e/helpers/convex-client.ts:7`). Lanza con mensaje claro si falta la variable.
7b. `e2e/helpers/secure-test.ts` (crear) — `test` endurecido que limpia los valores del DOM antes de que Playwright genere `error-context.md` (§10.1).
8. `e2e/test-support.spec.ts` (crear) — pruebas del propio harness.
9. `e2e/secret-sentinel.spec.ts` (crear) — spec del gate; **excluido de los projects normales**, solo lo ejecuta el script.
10. `scripts/check-secret-leak.mjs` (crear) — gate de fugas con control positivo (§10.3).
11. `package.json` (editar) — script `test:e2e:secret-gate`.
12. `playwright.config.ts` (editar) — project **`chromium-secrets`** (sin trace/vídeo/captura) con `test-support.spec.ts`, **y `testIgnore: ["secret-sentinel.spec.ts"]`** para que el fallo intencional nunca entre en el e2e normal.
13. `playwright.gate.config.ts` (crear) — configuración **exclusiva del gate**, con los projects `gate-trace` y `gate-secrets` (§10.3).
14. `PLANS/README.md` (editar) — registrar MIS-286.

## Evidencia de la implementación (ejecutada el 2026-08-10)

| Condición | Resultado |
|---|---|
| Enrutado aislado de los dos projects del gate | ✅ `playwright.gate.config.ts`, projects `gate-trace` / `gate-secrets`, ambos con `testMatch: ["secret-sentinel.spec.ts"]` |
| Cada fase ejecuta el centinela; **0 tests ⇒ fallo** | ✅ el script exige `executed === 1` leyendo el reporte JSON de cada fase |
| Control positivo y negativo sobre artefactos reales, incl. ZIP | ✅ fase A: *"detectado en 1 artefacto(s); el escáner funciona"* · fase B: *"sin rastro en artefactos, traces ni salida del proceso"* |
| `npm run test:e2e` **no** ejecuta el fallo intencional | ✅ `npx playwright test --list` → **0** ocurrencias de `secret-sentinel` (31 tests en 9 ficheros) |
| `npm run test:e2e:secret-gate` en verde | ✅ *"Gate de fugas superado: la política de no captura funciona y está demostrada"* |
| TypeScript / ESLint | ✅ `tsc --noEmit` limpio; ESLint sin errores (1 warning preexistente en `Avatar.jsx`) |

**El gate encontró una fuga real en su primera ejecución** (`error-context.md`, §10.1) y volvió a pasar tras añadir `secure-test.ts`. Es decir: el control positivo no es teórico, ya ha detectado un fallo de verdad en este mismo ticket.

### Estado de la suite completa — declarado sin edulcorar

`npm run test:e2e` **NO** está en verde, ni antes ni después de este ticket:

- **Los 4 tests de MIS-286 pasan** en las dos ejecuciones consecutivas.
- La suite arroja **8 fallos preexistentes** en specs de Carlos y Marta (`full-flow`, `edge-cases`, `role-gating`), **ajenos a este ticket**.
- Verificado contra `main` limpio (`git stash`): main solo da **7-8 fallos** con los **mismos** specs — es decir, ya estaban rotos y además son flaky entre ejecuciones. Cuentas: 27 tests preexistentes (8 fallan, 19 pasan) + 4 nuevos = 23 passed / 8 failed, exactamente lo observado.
- **Conclusión:** MIS-286 no introduce ninguna regresión. La repetibilidad que exige M8 se cumple en su alcance (mismo resultado en ambas ejecuciones, sin contaminación de estado), pero la suite global seguirá roja hasta que se traten esos fallos, que son **deuda preexistente** y merecen ticket propio.

## Condiciones de implementación (GO CONDICIONADO de la 5ª ronda)

Deben quedar demostradas antes de dar MIS-286 por hecho:

1. **Enrutado aislado**: los dos projects del gate viven en `playwright.gate.config.ts` y solo recogen `secret-sentinel.spec.ts`.
2. **Cada fase ejecuta el centinela**, y **cero tests recogidos ⇒ el gate falla**.
3. **Control positivo y negativo sobre artefactos reales**, incluidos los `.zip`.
4. **`npm run test:e2e` no ejecuta el fallo intencional** (verificable: su salida no menciona `secret-sentinel`).
5. **`npm run test:e2e:secret-gate` en verde.**

## Seguridad (checklist)

- Tres capas: credencial fail-closed **+** identidad dedicada **+** contraseñas efímeras.
- **Ninguna contraseña válida en el repositorio, `.env*`, disco, logs ni artefactos de CI** (§10, demostrado por el gate).
- Los specs con secretos corren en `chromium-secrets`, **sin trace, vídeo ni captura**.
- No se depende del cleanup para invalidar el secreto; el control primario es no capturarlo.
- Una filtración de `E2E_TEST_SUPPORT_KEY` **no queda acotada** a una cuenta irrelevante (el rol no autoriza) → **rotación inmediata**.
- La credencial no entra nunca en el navegador; en prod no existe → funciones inertes.
- El código en claro **solo** vive en `testOutbox`, y solo para la identidad dedicada.
- Limpieza de rate limits por enumeración explícita; jamás claves de IP.
- Sin borrados por prefijo ni funciones "borra todo".
- `recordOutbox` es interna y valida identidad aunque nadie externo pueda llamarla.

## Pruebas / verificación (gate ejecutable)

**Comandos:** `npm run test:e2e` **y** `npm run test:e2e:secret-gate` → job **`e2e`** de `.github/workflows/ci.yml`, en dos pasos. Spec del harness en **`chromium-secrets`** (sin captura), `workers: 1`.

`e2e/test-support.spec.ts` verifica el harness **antes** de que MIS-285 dependa de él:

1. **Credencial obligatoria** — con `ConvexHttpClient` directo (sin envoltorio), llamar a **una mutation** (`resetTestIdentity`) y **una query** (`getLastResetCode`) con clave vacía e incorrecta → **rechazadas**. Basta con esas dos: todas comparten el mismo guard.
2. **Identidad acotada** — credencial correcta pero `email: "carlos@test.local"` → **rechazado**.
3. **Reseed idempotente y secreto efímero** — ejecutarlo dos veces seguidas funciona; **devuelve contraseñas distintas** en cada llamada; tras el reseed `countSessionsFor` = 0 y `getLastResetCode` devuelve `null`.
4. **Limpieza de rate limit (M8)** — provocar 5 fallos de login contra la identidad dedicada **sin enviar `ipHint`** (así se ejercita solo la clave por usuario, sin contaminar el contador de IP compartido) → queda bloqueada → `resetTestIdentity` → **login correcto inmediato** con la contraseña recién devuelta.
5. **`expireResetCode`** — se valida funcionalmente en MIS-285, donde existe el flujo que crea códigos.
6. **Login por cliente, no por formulario** — la validación de la contraseña efímera se hace con `api.auth.login` vía `ConvexHttpClient`, de modo que el secreto no entra en el navegador (§10.2).

**Gate de fugas (B1):** `npm run test:e2e:secret-gate` debe salir en verde, lo que exige que la **fase A encuentre** el centinela (el escáner funciona) y la **fase B no lo encuentre** (la política de no captura funciona), incluyendo el interior de los `.zip` de trace.

**Repetibilidad (M8):** `npm run test:e2e` **dos veces seguidas** debe quedar verde ambas, incluida la ejecución que dejó el bloqueo.

## Riesgos y decisiones

- **¿Por qué no una admin key de Convex?** Sería válida, pero da poderes totales sobre el deployment (incluido el esquema y todas las tablas). La credencial dedicada acota la superficie a las cinco funciones del harness y a una sola identidad, y el patrón `serverKey` ya existe en el repo.
- **Alcance real de una filtración de `E2E_TEST_SUPPORT_KEY` — sin edulcorar.** Decir que el daño queda "acotado a una cuenta desechable" sería **inexacto**: desde MIS-251 el rol **no autoriza nada** (`convex/lib/authz.ts:45`), así que `reset@test.local` tiene **acceso completo de lectura y escritura** al CRM de dev, igual que cualquier otro usuario. Una filtración de esta credencial **exige rotación inmediata** (regenerarla en Convex dev y en GitHub Secrets). Lo que sí acota la identidad dedicada es que no se puedan manipular las cuentas de Carlos y Marta a través del harness.
- **¿Por qué MIS-286 define una tabla de producción?** Para romper la circularidad de M10 con el mínimo cambio y mantener **todo el código sensible del harness auditado en un solo ticket**. La alternativa (MIS-285 amplía `testSupport.ts` después) reabriría superficie de harness en un ticket ya cerrado arquitectónicamente.
- **Deployment Convex exclusivo para CI** — solución de fondo; queda como **follow-up** (deuda preexistente, no bloquea).

## Fuera de alcance

Flujo de recuperación en sí (MIS-285), limpieza general de `loginAttempts`, centralizar la política de contraseña, DMARC.

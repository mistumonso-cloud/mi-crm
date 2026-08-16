# MIS-293 — Seguridad login · Fase 3 — Higiene (núcleo)

## Contexto

MIS-293 recoge 12 hallazgos **bajos** de la auditoría (`PLANS/PLAN-CORRECCION-SEGURIDAD-LOGIN-2026-08-10.md`,
sección "Fase 3 — Higiene"). Es un grab-bag heterogéneo con riesgos muy distintos. Ya se
**dividieron** los ítems grandes / con decisión de producto / de infra en tickets propios:

- **MIS-298** — B3, modelo de ticket de sesión (el mayor de los bajos).
- **MIS-299** — B6, PKCE en el login con Google.
- **MIS-300** — CSP con nonce (decisión consciente: rompe optimización estática / PPR).
- **MIS-301** — HSTS completo (`includeSubDomains`/`preload`, tras inventariar subdominios).
- **MIS-302** — B10, tope diario de emails de recuperación.
- **MIS-303** — B11 + deployment de Convex exclusivo para CI.

Lo que **queda en MIS-293** es el "núcleo de higiene": limpieza de bajo riesgo + la retirada
del interruptor temporal del veto. Las **cookies (B1/B2)** — `secure` sin `NODE_ENV`,
prefijos `__Host-`/`__Secure-` — se dejan para un **segundo PR de MIS-293** (más riesgo:
una cookie mal marcada tumba sesiones/login) y **no** entran en este plan.

Este plan cubre el núcleo, que se entrega en **tres unidades desplegables secuenciadas** (la
secuencia importa: el gate de compatibilidad NFKC debe completarse **antes** de que ninguna
versión con NFKC atienda tráfico — ver ronda 3 / M5):

- **PR-1a — Higiene trivial + precursor de compatibilidad**: retirar `ConvexClientProvider`, B5
  (cota `i=`), B9 (doc), y **A3-i** = la `internalQuery` read-only `accountsWithNonCanonicalEmail`
  (NO activa NFKC). Tras desplegar, el **gate** `npx convex run auth:accountsWithNonCanonicalEmail
  --prod` debe dar `[]` (fail-closed).
- **PR-1a-bis — Activar NFKC** (solo tras gate `[]`): **A3-ii** = el cambio real de
  `normalizeEmailKey` a NFKC (B12).
- **PR-1b — Retirar el veto por email**: el ítem pesado (toca el camino de login, reescribe un
  test e2e, **borra la herramienta `scripts/login-verify/`** y retira una env var de prod).

> **Motivo del reparto:** durante la exploración se confirmó que "retirar el veto" **no es
> una línea**. Obsoleta por completo `scripts/login-verify/` (que existe únicamente para
> voltear y verificar `LOGIN_EMAIL_VETO`) y rompe el test e2e `test-support.spec.ts:84`
> ("el reseed limpia el bloqueo") — que hace 5 fallos y **espera bloqueo por email**. Aislarlo
> en su propio PR mantiene la trivial limpia y la retirada del veto auditable por separado.

---

## Cambios de la ronda 2 (tras auditoría NO-GO)

Correcciones aplicadas a los 4 Majors + sugerencias (referencias a las secciones):
- **M1** → B2: la aserción final de limpieza usa `loginResult(fresh, TEST_LOGIN_IP)`, no
  `loginSucceeds()` (que no consulta la IP). Sin esto era falso verde.
- **M2** → A2 + Verificación: la prueba de B5 se **fija ahora** (no "se valorará") en
  `e2e/lib-unit.spec.ts` bajo un project `unit` de Playwright (runner estable `npm run
  test:e2e`); entra en PR-1a, así B5 tiene cobertura antes de que PR-1b retire `test:unit`.
- **M3** → B4: rollback seguro documentado (restaurar `LOGIN_EMAIL_VETO=off` antes de revertir
  código viejo; y recuperación si el rollback ya ocurrió). Va en el runbook nuevo.
- **M4** → A4: se separa "E2E_TEST_SUPPORT_KEY ausente" (verificable con `--names-only`) de la
  **presencia** de `AUTH_SERVER_KEY`; el **valor** de un secreto no se comprueba con
  `--names-only` ni se imprime, y verificarlo queda fuera de A4. Fichero elegido:
  `PLANS/RUNBOOK-DESPLIEGUE-CONVEX-PROD.md`.
- **S293-1** → A3: gate de compatibilidad NFKC basado en datos reales de prod (nueva
  `internalQuery accountsWithNonCanonicalEmail`, debe dar `[]`) + unidad con variante Unicode.
- **S293-2** → B4: `--deployment dutiful-mole-111` explícito al retirar la variable en dev.
- **S293-3** → A1: se corrige `README.md:23` y se documenta que `NEXT_PUBLIC_CONVEX_URL` **sigue
  siendo necesaria en el servidor** (`convex/nextjs`) y en e2e — **no** se retira de Railway/CI.
- **S293-4** → B1: se limpian también los comentarios históricos del veto en `auth.ts`.

Fuera de alcance de la ronda 2 (no reabiertos): A1 funcional, ubicación del guard PBKDF2,
operación NFKC, eliminación funcional del veto, colapso de `reason`, retirada de login-verify.

---

## Cambios de la ronda 3 (tras auditoría NO-GO)

Un único Major nuevo (**M5**) + sugerencias, todo de **secuencia**, sin ampliar alcance:
- **M5** → empaquetado + A3: el gate NFKC no puede ejecutarse antes del deploy que lo introduce.
  Se separa A3 en **A3-i** (precursor read-only `accountsWithNonCanonicalEmail`, en **PR-1a**,
  con gate **fail-closed** tras deploy) y **A3-ii** (el cambio real de `normalizeEmailKey` a
  NFKC, en **PR-1a-bis**, solo tras gate `[]`). El precursor no toca el login, así que
  desplegarlo **no** activa NFKC. El núcleo pasa de dos a **tres** unidades.
- **Media (project `unit`)** → A2/Verificación: se corrige la redacción — `--project=unit`
  hereda el `webServer` global de Playwright; **no** es independiente del arranque de Next.
- **Baja (fixture B5)** → A2: el hash con `i=100000000` lleva salt/hash **base64url válidos** (de
  un `hashPassword` real) para probar que el `false` rápido viene de la cota, no de un decode.
- **Baja (PII)** → A3: la evidencia del gate conserva solo `[]`/conteo; detalle fuera de logs.
- **Baja (runbook fail-closed)** → A4: un fallo técnico del gate (función ausente, CLI fallida,
  salida no válida) detiene el despliegue igual que una lista no vacía.

Fuera de alcance de la ronda 3 (no reabiertos): M1–M4, A1, ubicación del guard PBKDF2, la
transformación NFKC en sí, el colapso de `reason` y la retirada funcional de `login-verify`.

**Veredicto ronda 3: GO CONDICIONADO.** Condición única + sugerencias, ya incorporadas:
- **Condición (gate NFKC doble):** el gate se ejecuta tras PR-1a **y de nuevo just-in-time antes**
  de desplegar A3-ii; solo con JSON `[]` y exit 0 se despliega NFKC (los datos son mutables entre
  ambos momentos). Escrito en A3-ii y en el runbook (A4). Secuencia obligatoria: PR-1a desplegado →
  gate inicial `[]` → preparar/auditar/mergear PR-1a-bis → **repetir gate** → desplegar A3-ii.
- **Media** → A3-i: la consulta compara la **forma canónica completa** (`NFKC.trim().toLowerCase()`),
  no solo NFKC. Runbook (A4): evidencia del gate final vinculada a commit + `greedy-tapir-20` +
  timestamp.
- **Baja** → A2: fixtures base64url válidos en **todos** los casos; A4: salida del gate validada
  como **JSON estructurado**; PII: si hay cuentas, solo conteo, nunca la salida completa en el PR;
  Metodología: "al terminar **las tres unidades**".

---

## PR-1a — Higiene trivial + precursor de compatibilidad

### A1 · Retirar `ConvexClientProvider` (código muerto)

**Estado hoy:** `src/components/ConvexClientProvider.tsx` instancia un `ConvexReactClient` en
el **navegador** a partir de `NEXT_PUBLIC_CONVEX_URL` y envuelve toda la app en
`src/app/layout.tsx:34`. **Nada lo usa**: la app no hace ninguna llamada Convex desde el
cliente (todo va por Server Actions / `ConvexHttpClient` en el servidor con `serverKey`). El
grep confirma que las **únicas** referencias a `convex/react`, `ConvexProvider`,
`ConvexReactClient` y `NEXT_PUBLIC_CONVEX_URL` en `src/` están dentro de este componente y de
su montaje en el layout.

**Cambios:**
1. `src/app/layout.tsx` — quitar el import (línea 4) y desenvolver el `children`: el `<body>`
   pasa a `<body className="min-h-full flex flex-col">{children}</body>`.
2. Borrar `src/components/ConvexClientProvider.tsx`.
3. `README.md:23` — corregir la frase "el provider avisa por consola" (ya no hay provider):
   reformular a que, sin Convex configurado, la app arranca pero sin datos (sin mención al
   provider).

**Riesgo:** nulo (código sin consumidores). **Deploy:** frontend → Railway auto-despliega al
mergear. No toca Convex.

> **Cuidado (S293-3):** `NEXT_PUBLIC_CONVEX_URL` **sigue siendo necesaria en el servidor** —
> `convex/nextjs` (`fetchQuery`/`fetchMutation`/`fetchAction`, usados en todo `src/app` y
> `src/lib/*/actions.ts`) la lee del entorno del servidor, y los e2e la cargan desde
> `.env.local`. Retirar el provider **solo** quita el cliente Convex del **navegador**. **NO**
> se retira `NEXT_PUBLIC_CONVEX_URL` de Railway/CI ni de `README.md:125` (sigue en la lista de
> variables requeridas). Este PR no toca ninguna configuración de despliegue.

### A2 · B5 — Cota superior a las iteraciones del hash (`verifyPassword`)

**Estado hoy:** `convex/lib/password.ts:63-73`. `verifyPassword` parsea el hash almacenado
`pbkdf2_sha256$v1$i=<n>$<salt>$<hash>` y lee `iterations = Number(parts[2].replace(/^i=/, ""))`
(línea 68) **sin cota**. Todos los hashes reales llevan `i=600000` (`ITERATIONS`), pero un
valor manipulado como `i=100000000` colgaría el KDF (DoS por CPU). Hoy inalcanzable —el hash
solo lo escribe nuestro propio código— pero es una defensa en profundidad barata.

**Cambios (en `convex/lib/password.ts`):**
1. Tras parsear `iterations` (línea 68), validar que es un entero dentro de un rango sensato y,
   si no, tratar el hash como inválido (misma salida que un formato malformado: `return false`):
   ```ts
   const iterations = Number(parts[2].replace(/^i=/, ""));
   if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) {
     return false;
   }
   ```
   con `const MAX_ITERATIONS = 1_000_000;` junto a las demás constantes del módulo (holgura
   sobre los 600 000 de producción para poder subir el coste en el futuro sin tocar esta cota;
   el auditor puede ajustar el techo). `Number.isInteger` cubre de paso `NaN`/decimales.

**Consecuencia asumida:** un hash con `i=` fuera de rango se comporta como "credenciales
incorrectas" (no lanza, no cuelga). Ningún hash legítimo se ve afectado (600 000 < 1 000 000).

**Prueba ejecutable y permanente (M2):** se fija AHORA, no "se valorará". `verifyPassword` es
TypeScript y usa WebCrypto; el runner estable es **Playwright** (transpila TS y corre en Node
con `crypto.subtle`), no `node --test` (que no ejecuta TS).
- Nuevo spec `e2e/lib-unit.spec.ts` (pruebas de unidad de librería, sin navegador ni Convex),
  bajo un **project nuevo `unit`** en `playwright.config.ts` (sin `dependencies`, sin
  `storageState`, `testMatch: ["lib-unit.spec.ts"]`). Importa `verifyPassword`/`hashPassword`
  de `../convex/lib/password`.
  > **Redacción (Media, ronda 3):** el project `unit` **hereda el `webServer` global** de
  > `playwright.config.ts`, así que `--project=unit` **no** corre aislado del arranque de Next
  > (Playwright levanta el server igualmente). En una corrida completa `npm run test:e2e` el
  > server arranca una sola vez y es inofensivo; no se afirma independencia del server.
- Casos mínimos:
  - `verifyPassword("x", "<hash real i=600000 con i= sustituido por 100000000>")` → `false`
    **y** en < 2 s (medido con `Date.now()`): demuestra que se corta ANTES de `deriveBits`.
    **Fixture con base64url VÁLIDO (Baja, ronda 3):** el salt y el hash del fixture salen de un
    `hashPassword` real (solo se le reemplaza `i=600000` por `i=100000000`), de modo que el
    `false` rápido proviene demostrablemente de la **cota de iteraciones** —la guarda va tras
    parsear `i=` y **antes** de `base64UrlToBytes`— y no de un decode base64 fallido. (100 M
    iteraciones tardarían decenas de segundos; el timeout de Playwright es red de seguridad si
    alguien derivase por error.)
  - `i=abc` → `false` (cubre `NaN`); `i=` vacío y `i=1.5` → `false`. **Todos** estos fixtures
    llevan salt/hash base64url **válidos** (Baja, ronda 3), para aislar el resultado al parser de
    iteraciones y no a un decode fallido.
  - Hash real de `hashPassword(<contraseña válida>)` (i=600000): contraseña correcta → `true`,
    incorrecta → `false` (control positivo: la cota no rompe lo legítimo).
- Comando estable: **`npm run test:e2e`** (ya en CI). Este spec entra en **PR-1a** (donde va
  B5), de modo que la cobertura de B5 existe **antes** de que PR-1b retire `test:unit`.

**Deploy:** Convex → **deploy a prod** tras merge. Sin cambio de firma ni de schema.

### A3 · B12 — Normalización NFKC en `normalizeEmailKey` (secuenciada: A3-i → gate → A3-ii)

**Estado hoy:** `convex/lib/rateLimit.ts:3-5` — `normalizeEmailKey(email) = email.trim().toLowerCase()`.
Se usa como (a) clave de rate limit **y** (b) forma canónica para **buscar el usuario por
`by_email`** (login, Google, seedUser, recuperación) y para `assertDedicatedIdentity` del
harness. Sin normalización Unicode, dos formas visualmente equivalentes (p.ej. caracteres de
compatibilidad) producirían claves distintas.

**Objetivo:** aplicar `normalizeEmailKey(email) = email.normalize("NFKC").trim().toLowerCase();`.
El corpus actual es ASCII (donde NFKC es no-op), pero es un cambio en el camino de autenticación,
así que se **secuencia con un gate fail-closed basado en datos reales** (M5, ronda 3): la consulta
que mide compatibilidad se despliega **antes**, como precursor read-only, y NFKC solo se activa si
el gate confirma que ninguna cuenta cambia.

#### A3-i · Precursor de compatibilidad (va en PR-1a, NO activa NFKC)
- Nueva `internalQuery` `accountsWithNonCanonicalEmail` en `convex/auth.ts` (espejo de
  `accountsPendingRotation`: solo `id`/`email`, nunca hashes), que devuelve las cuentas donde
  `email.normalize("NFKC").trim().toLowerCase() !== email` — la **forma canónica completa** que se
  desplegará (no solo NFKC), para que el gate pruebe exactamente el comportamiento de A3-ii (Media,
  ronda 3). **Es read-only y NO modifica `normalizeEmailKey`**, así que desplegarla **no** cambia
  el comportamiento del login: es seguro tenerla viva antes que NFKC.
- **Por qué precursor (M5):** `npx convex run … --prod` invoca funciones **ya desplegadas**; el
  gate solo puede correr si la consulta ya está en prod. Por eso va en PR-1a y NFKC (A3-ii) queda
  en un despliegue posterior.
- **Gate tras desplegar PR-1a:** `npx convex run auth:accountsWithNonCanonicalEmail --prod` debe
  devolver **`[]`**. Si ninguna email almacenada cambia bajo NFKC, la búsqueda `by_email` sigue
  encontrando las mismas cuentas (ninguna inaccesible) **y** no puede haber colisión (ninguna clave
  cambia). **Fail-closed (Baja, ronda 3):** además de una lista no vacía, **cualquier fallo
  técnico** del gate (función ausente, CLI fallida, salida no válida/no-JSON) **detiene** el avance
  a A3-ii. La lista ASCII de cuentas es orientativa (de hecho omitía al usuario histórico "Revisor"
  de MIS-261): la garantía se basa en los datos **actuales**, no en enumerar a mano.
- **PII (Baja, ronda 3):** la salida contiene emails. La evidencia que se publique conserva solo
  `[]` o un conteo; si apareciera alguna cuenta, su detalle se trata **fuera** de logs y artefactos
  compartidos.

#### A3-ii · Activar NFKC (va en PR-1a-bis, solo si el gate dio `[]`)
- `convex/lib/rateLimit.ts`: `normalizeEmailKey(email) = email.normalize("NFKC").trim().toLowerCase();`.
- **Unidad:** en `e2e/lib-unit.spec.ts`, un caso con una **variante de compatibilidad Unicode**
  (p.ej. carácter de ligadura/anchura completa) que confirme que `normalizeEmailKey` **sí** aplica
  NFKC (los e2e ASCII solo prueban no-regresión).
- **Precondición dura (CONDICIÓN del GO, ronda 3): gate DOBLE.** El gate se ejecuta **dos veces**:
  (1) tras desplegar PR-1a, y (2) **just-in-time, inmediatamente antes** de desplegar A3-ii —
  porque entre ambos momentos los datos siguen siendo **mutables** (`seedUser`, administración
  directa). **Solo con salida JSON exactamente `[]` y código de salida 0** se despliega NFKC;
  cualquier fallo técnico o resultado no vacío **detiene** el despliegue. La secuencia obligatoria
  (PR-1a desplegado → gate inicial `[]` → preparar/auditar/mergear PR-1a-bis → **repetir el gate**
  → solo entonces desplegar A3-ii) queda **escrita en el runbook antes de la auditoría de código**.

**Deploy:** dos despliegues a Convex prod — A3-i con PR-1a, A3-ii con PR-1a-bis (tras el gate
**repetido just-in-time**).

### A4 · B9 — Verificar que `E2E_TEST_SUPPORT_KEY` no existe en prod (documentación)

**Estado hoy:** el harness de test (`convex/testSupport.ts`) es inerte si
`E2E_TEST_SUPPORT_KEY` (=`TEST_SUPPORT_ENV_VAR`) no está en el entorno del deployment. Que no
exista en prod es una **invariante de seguridad** (si existiera, las funciones de test serían
invocables contra prod). Se verificó ad-hoc en despliegues anteriores; falta **formalizarlo**
en el procedimiento.

**Cambios (M4 — se elige el fichero exacto y se separan las comprobaciones):**
1. **Fichero elegido:** se crea `PLANS/RUNBOOK-DESPLIEGUE-CONVEX-PROD.md` como runbook canónico
   de despliegue a Convex prod (consolida la técnica de deploy-token, el gate B9, el **gate de
   compatibilidad NFKC de A3-i** y el rollback seguro del veto de B4). Deja de haber "se
   localizará". El runbook documenta que **todos** estos gates son **fail-closed**: un fallo
   técnico (función ausente, CLI fallida, salida no válida) detiene el despliegue igual que un
   resultado negativo. Para el gate NFKC, el runbook especifica además: (a) que se ejecuta **dos
   veces** (inicial tras PR-1a y **just-in-time** antes de A3-ii); (b) que la salida se valida como
   **JSON estructurado** (`=== []` y exit 0), no por comparación visual de stdout; (c) que la
   evidencia del gate final se vincula a **commit + deployment (`greedy-tapir-20`) + timestamp**; y
   (d) que si devolviera cuentas, **no** se publica ni se incorpora al PR la salida completa —solo
   el conteo—, tratando el detalle como PII operativa.
2. **Comprobaciones SEPARADAS** (una es verificable con `--names-only`, la otra no):
   - **`E2E_TEST_SUPPORT_KEY` debe estar AUSENTE** en prod → `npx convex env list --prod
     --names-only` **no** debe listarla. Verificable y suficiente (si no existe, el harness de
     test es inerte en prod). Documentar además su **rotación en dev**.
   - **`AUTH_SERVER_KEY` (y `GOOGLE_LOGIN_SHARED_SECRET`) deben estar PRESENTES** — su ausencia
     rompería el login. La **presencia** se verifica con `--names-only`; su **valor NO** se
     comprueba aquí: `--names-only` no lo devuelve y el secreto **nunca** se imprime. Verificar
     que el valor es el de prod (y no uno de test) queda **fuera de A4** (era ampliación indebida
     del B9 original); si alguna vez se quiere, es un procedimiento seguro aparte, documentado,
     sin volcar el secreto.
3. Sin código de producto y sin deploy en A4 (doc-only). *(La `internalQuery` de A3 sí va con
   PR-1a y sí se despliega.)*

---

## PR-1b — Retirar el interruptor `LOGIN_EMAIL_VETO` y el veto

**Por qué ahora:** el veto por email fue **temporal por diseño** (1B.4 del plan maestro). Se
puso a `off` en prod en MIS-291 (I4/A2 cerrado) y lleva estable desde 2026-08-13. El plan
maestro pide retirarlo del código para que no quede "como configuración permanente que nadie
recuerda". El interruptor es **fail-safe** (ausente ⇒ activo), así que borrar la variable sin
borrar el código lo **reactivaría** — hay que retirar el código primero.

### B1 · Código de producto (`convex/`)

**`convex/lib/rateLimit.ts`:**
- Borrar `LOGIN_EMAIL_VETO_LIMIT` (líneas 59-68) y `emailVetoActive()` (110-116).
- Mantener `LOGIN_EMAIL_COUNTER` (telemetría por `login-counter:<email>`, **no** es el veto) y
  `isLocked`/`recordFailedAttempt`/`resetAttempts` (los usa la capa por IP).

**`convex/auth.ts`:**
- Import (líneas 15-27): quitar `LOGIN_EMAIL_VETO_LIMIT` y `emailVetoActive`.
- `reserveLoginSlot` (80-108): borrar la rama del veto por email (líneas 88-92). Queda solo el
  bloqueo por IP (85-87).
- **Colapso de `reason`** (decisión para el auditor, recomendada): con el veto fuera, el **único**
  motivo de bloqueo es la IP. La unión `reason: "ip"|"email"` de MIS-296 (B7) pasa a tener un
  solo valor. Recomiendo **eliminar `reason`**:
  - `reserveResultValidator` (70-75): rama bloqueada → `v.object({ blocked: v.literal(true) })`.
  - `ReserveResult` (76-78): `{ blocked: true } | { blocked: false; hash; fingerprint }`.
  - `reserveLoginSlot`: `return { blocked: true }` (IP).
  - `loginWithPassword` (217-223): el log deja de interpolar la capa →
    `console.warn("[login] rechazo por bloqueo de rate limit (capa=IP)")`. La **respuesta sigue
    siendo genérica** (B7 intacto: no se distingue bloqueo de credenciales).
  - *(Alternativa conservadora, si el auditor prefiere forward-compat: mantener
    `reason: v.literal("ip")`. Más barato de revertir el día que vuelva otra capa, a cambio de
    una unión de un solo miembro. Recomiendo eliminarlo; MIS-296 solo introdujo `reason` para
    distinguir capas y ya no hay más de una.)*
- `finalizeLogin` (179-188): borrar `if (emailVetoActive()) { recordFailedAttempt(..., LOGIN_EMAIL_VETO_LIMIT); }`
  (184-186). **Mantener** la telemetría `recordFailedAttempt(loginCounterKey(...), LOGIN_EMAIL_COUNTER)`
  (183) y el `resetAttempts` de ambas claves en el éxito (173-174) — es inofensivo seguir
  limpiando la clave `<email>` aunque ya nadie la escriba, y deja el estado limpio.
- **Comentarios históricos (S293-4):** actualizar los comentarios de `auth.ts` que hablan de
  "ambas claves" / "rollback del veto" (líneas ~145-148, ~170-172, ~179-182) para que no
  describan un veto que ya no existe. Limpieza de comentarios, sin cambio de comportamiento.

**`convex/testSupport.ts`:** `rateLimitKeysForTestIdentity()` (73-81) sigue enumerando
`RESET_TEST_EMAIL` (línea 75, comentario "veto por email"). Tras la retirada, ninguna ruta
escribe ya esa clave. **Mantenerla en la lista** (belt-and-suspenders, borrado idempotente) y
**actualizar el comentario** para no dar a entender que el veto sigue vivo. (Se puede eliminar,
pero mantenerla no cuesta nada y evita un falso verde si algo la escribiera.)

### B2 · Test e2e que hay que reescribir

`e2e/test-support.spec.ts:84-98` — **"el reseed limpia el bloqueo de rate limit del login"**.
Hoy hace 5 logins fallidos **sin `ipHint`** (aísla la clave por email) y espera que la cuenta
quede **bloqueada por el veto**. Con el veto retirado, 5 fallos ya **no** bloquean → el test
fallaría (`expect(loginSucceeds(password)).toBe(false)` sería `true`).

**Reescritura (mantiene la invariante "el reseed limpia el bloqueo", ahora vía IP; corrige M1):**
- reseed → **10** logins fallidos con `loginResult(<contraseña incorrecta>, TEST_LOGIN_IP)`
  (cada intento consume la cuota por IP; el 10.º deja `ip:TEST_LOGIN_IP` bloqueada, 10/15 min).
  Contraseña incorrecta a propósito, para no crear sesiones.
- **Bloqueo:** `loginResult(password, TEST_LOGIN_IP).success === false` — ni siquiera la
  contraseña **correcta** entra desde esa IP.
- reseed (limpia `ip:TEST_LOGIN_IP`, ver `rateLimitKeysForTestIdentity`).
- **Limpieza verificada CONTRA LA IP (corrige M1):**
  `loginResult(fresh, TEST_LOGIN_IP).success === true`. Es la aserción clave: **debe** llevar
  `TEST_LOGIN_IP`, porque `loginSucceeds()` omite `ipHint` y daría verde aunque el reseed **no**
  hubiera borrado `ip:203.0.113.42` (el falso verde que señaló la auditoría). Opcionalmente se
  añade un control sin IP, pero **no** sustituye a esta.

Esto sigue probando que `resetTestIdentity()` limpia el bloqueo, que es el objetivo real del
test; solo cambia la **capa** ejercitada (IP en vez de email), que es la única que queda.
Actualizar el comentario (líneas 81-90) en consecuencia. El resto de la suite
(`password-reset*.spec.ts`, y la prueba de cuota por IP `test-support.spec.ts:169`) **no
depende del veto** y sigue verde sin cambios. La aserción "ningún resultado lleva
'Demasiados intentos…'" (181-191) sigue siendo válida (y trivialmente cierta).

### B3 · Borrar la herramienta `scripts/login-verify/`

La herramienta de MIS-295 existe **exclusivamente** para voltear y verificar
`LOGIN_EMAIL_VETO`: `setVeto`/`removeVeto`/`readVetoState`/`vetoActive`, `runVetoSequence`
(pruebas 11-12), `generateLock` (5 fallos → espera *locked*), y el clasificador `LOCKED_ERROR`
(que el producto **ya no devuelve** desde MIS-296). Su misión (poner el veto a `off` en prod)
**ya se ejecutó** (MIS-291). Sin veto, la herramienta no verifica nada real.

**Cambios:**
- Borrar el directorio completo `scripts/login-verify/` (`core.mjs`, `index.mjs`,
  `core.test.mjs`, `README.md`).
- `package.json`: quitar el script `test:unit` (`node --test scripts/login-verify/*.test.mjs`),
  que **solo** ejecuta los tests de esta herramienta. **Verificado:** `test:unit` **no** se usa
  en `.github/` (CI no lo llama), así que borrarlo no afecta al CI; solo desaparece el comando
  local.
  > **Relación con M2:** B5/NFKC **no** dependen de `test:unit`; su cobertura vive en el project
  > `unit` de Playwright (`e2e/lib-unit.spec.ts`, añadido en PR-1a). Por eso aquí se puede retirar
  > `test:unit` **entero** junto con `scripts/login-verify/` sin dejar B5 sin runner.
- Retirar de la memoria/README cualquier referencia operativa a `scripts/login-verify` como
  procedimiento vigente (se hará al cerrar, no es código).

> Esta es la única **eliminación grande** del núcleo y la razón de aislar PR-1b. Se marca en
> rojo para la auditoría: es intencionada, no un descuido.

### B4 · Retirar la env var en los deployments (paso de despliegue, no de código)

Tras mergear PR-1b y **desplegar el código nuevo** (que ya ignora la variable):
- **Prod** (`greedy-tapir-20`): `npx convex env remove LOGIN_EMAIL_VETO --prod`.
- **Dev**: `npx convex env remove LOGIN_EMAIL_VETO --deployment dutiful-mole-111` (si estuviera
  puesta). **Selector explícito (S293-2):** sin `--deployment`, el CLI actuaría sobre el
  deployment configurado localmente, que podría no ser dev.

**Orden obligatorio:** desplegar el código **primero**, retirar la variable **después**. Al
revés, el código viejo (fail-safe) reactivaría el veto entre ambos pasos. Como el código nuevo no
lee la variable, retirarla es un no-op funcional y solo cumple la higiene ("no dejar config que
nadie recuerda").

**Rollback seguro (M3) — obligatorio, va en `RUNBOOK-DESPLIEGUE-CONVEX-PROD.md`:** la variable
ausente significa, **para el código anterior a PR-1b**, "veto ACTIVO". Por tanto, revertir Convex
al commit previo **reabriría I4/A2** (vuelve el bloqueo por email) si la variable sigue ausente.
Procedimiento:
- **Rollback planificado** (volver a código viejo): **antes** de desplegar el código anterior,
  `npx convex env set LOGIN_EMAIL_VETO off --prod` y **verificar** (`env get`); solo entonces
  desplegar el código viejo. Así el fail-safe encuentra `off` y no reactiva el veto.
- **Recuperación si el rollback de código ya ocurrió primero** (incidencia): inmediatamente
  `npx convex env set LOGIN_EMAIL_VETO off --prod` y verificar — neutraliza el veto reactivado
  sin esperar a re-desplegar.
- El día que se decida que el veto no vuelve **nunca**, este runbook se retira junto con la última
  versión de código que leía la variable.

---

## Ficheros

**PR-1a — Higiene trivial + precursor (frontend Railway + Convex prod):**
- `src/app/layout.tsx` — quitar `ConvexClientProvider` (A1).
- `src/components/ConvexClientProvider.tsx` — **borrar** (A1).
- `README.md` — corregir la frase del provider (A1, S293-3); **conservar** `NEXT_PUBLIC_CONVEX_URL`.
- `convex/lib/password.ts` — cota `MAX_ITERATIONS` en `verifyPassword` (A2).
- `convex/auth.ts` — nueva `internalQuery` `accountsWithNonCanonicalEmail` (**precursor** A3-i;
  read-only, **no** toca `normalizeEmailKey`).
- `e2e/lib-unit.spec.ts` — **nuevo**: casos de **B5** (cota `i=`, fixture base64url válido) (A2).
- `playwright.config.ts` — **nuevo project `unit`** (sin deps) para `lib-unit.spec.ts` (A2).
- `PLANS/RUNBOOK-DESPLIEGUE-CONVEX-PROD.md` — **nuevo**: runbook canónico (deploy-token + gates
  fail-closed B9 y NFKC + rollback seguro del veto) (A4/B4).
- *Tras desplegar: correr el gate `accountsWithNonCanonicalEmail --prod` → `[]` antes de PR-1a-bis.*

**PR-1a-bis — Activar NFKC (Convex prod), solo tras gate `[]`:**
- `convex/lib/rateLimit.ts` — NFKC en `normalizeEmailKey` (A3-ii).
- `e2e/lib-unit.spec.ts` — añadir el caso de **compatibilidad Unicode** de NFKC (A3-ii).

**PR-1b (Convex prod + frontend de test + tooling):**
- `convex/lib/rateLimit.ts` — borrar `LOGIN_EMAIL_VETO_LIMIT` y `emailVetoActive` (B1).
- `convex/auth.ts` — quitar veto de `reserveLoginSlot`/`finalizeLogin`, colapsar `reason`, y
  limpiar comentarios históricos del veto (B1, S293-4).
- `convex/testSupport.ts` — actualizar comentario de `rateLimitKeysForTestIdentity` (B1).
- `e2e/test-support.spec.ts` — reescribir el test del reseed a la capa por IP (B2).
- `scripts/login-verify/**` — **borrar** el directorio (B3).
- `package.json` — quitar `test:unit` (B3).

**Entrega/auditoría:** el código de cada PR en `CODIGO/MIS-293-higiene-nucleo/` (subcarpetas
`pr-1a/`, `pr-1a-bis/` y `pr-1b/`) + un `codigo-completo.md` por PR con diff embebido y snapshot
byte-idéntico, instalado tras GO de la auditoría de código.

## No-objetivos

- **No** se tocan las cookies (B1/B2: `secure`/`__Host-`/`__Secure-`) — segundo PR de MIS-293.
- **No** entran B3/B6/CSP/HSTS/B10/B11 — ya divididos a MIS-298..303.
- **No** se cambia el copy de `GENERIC_ERROR` ni la firma pública de `loginWithPassword`.
- **No** se añade la alerta sobre `LOGIN_EMAIL_COUNTER` ni se toca la telemetría `ip` de
  `getRequestMetadata` (observabilidad; se anotan como pendientes, sin código, salvo que la
  auditoría lo pida).

## Verificación

**PR-1a (higiene trivial + precursor A3-i):**
- `npm run lint` + `npm run build` verdes; typecheck de Convex verde.
- `npm run test:e2e` (incluye el nuevo project `unit`, el por defecto y `chromium-secrets`) verde:
  login y recuperación siguen funcionando (no-regresión de A1 al desmontar el provider). *Nota
  (Media, ronda 3): el project `unit` hereda el `webServer` global; en la corrida completa el
  server arranca una vez — no se corre `--project=unit` como unidad aislada del server.*
- **A2 (B5), ejecutable y permanente:** `e2e/lib-unit.spec.ts` prueba `i=100000000` → `false` en
  < 2 s (fixture con salt/hash base64url **válidos**), `i=abc`/`i=`/`i=1.5` → `false`, y un hash
  real i=600000 (correcta→true, incorrecta→false). Comando estable `npm run test:e2e`.
- Deploy Convex prod (A1 frontend por Railway; A2 cota + A3-i precursor por Convex) vía deploy-token.
- **Gate A3-i tras el deploy (fail-closed):** `npx convex run auth:accountsWithNonCanonicalEmail
  --prod` debe devolver `[]`. Cualquier fallo técnico también detiene. Evidencia: solo `[]`/conteo
  (sin PII). Solo con `[]` se procede a PR-1a-bis.
- Smoke: login normal correcto/incorrecto → comportamiento intacto (NFKC **aún no** activo).

**PR-1a-bis (activar NFKC, solo tras gate `[]`):**
- `npm run lint` + `npm run build` + typecheck verdes.
- `npm run test:e2e` verde, incluido el caso de compatibilidad **Unicode** en `lib-unit.spec.ts`
  (prueba que NFKC se aplica) y no-regresión ASCII de login/recuperación.
- Deploy Convex prod (A3-ii) vía deploy-token; smoke: login normal correcto/incorrecto intacto.

**PR-1b:**
- `npm run lint` + `npm run build` + typecheck verdes (sin imports/consts sin usar tras las
  eliminaciones).
- `npm run test:e2e` verde con el test del reseed **reescrito**: bloqueo y **limpieza
  verificados CONTRA `TEST_LOGIN_IP`** (`loginResult(fresh, TEST_LOGIN_IP).success === true`,
  corrige M1), y la prueba de cuota por IP intacta.
- Deploy Convex prod; **luego** `env remove LOGIN_EMAIL_VETO --prod` y, en dev,
  `--deployment dutiful-mole-111` (S293-2). El **rollback seguro (M3)** queda en el runbook. Smoke
  en prod: login normal correcto/incorrecto → genérico; bloqueo por IP intacto.
- Confirmar que `test:unit` ya no existe y que el CI (build + e2e) sigue verde sin él.
- Igualdad CODIGO ↔ repo byte-a-byte tras instalar, en cada PR.

## Metodología / Gate

Este plan **NO es GO**. Va a **auditoría externa (ronda 3)**. Solo tras veredicto **GO** (o **GO
CONDICIONADO**) explícito se crea rama (desde `main`) y se escribe el código en
`CODIGO/MIS-293-higiene-nucleo/`. Después, **en secuencia** por cada unidad
(**PR-1a → gate `[]` → PR-1a-bis → PR-1b**): auditoría de código → instalar → PR (**pedir permiso
antes de cada push**) → CI verde (lo lleva el asistente, sin preguntar) → **merge lo hace el
asistente** con permiso → **deploy Convex prod** donde haya código de producto → verificar → y, al terminar **las
tres unidades**, cerrar MIS-293 en Linear con los PRs enlazados. Cualquier hallazgo de auditoría
que no entre → follow-up Backlog/Low.

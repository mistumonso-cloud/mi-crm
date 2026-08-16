# MIS-303 · B11 — GitHub Environment con revisor para los secretos de CI · CÓDIGO COMPLETO

> Entrega autocontenida para **auditoría de código**. El auditor ve SOLO este texto.
> Plan de récord: `PLANS/MIS-303-b11-github-environment.md` (auditado, **GO CONDICIONADO** ronda 2; las dos
> condiciones —gate M3 de los 4 valores no ejercitados, y corrida NUEVA post-borrado M4— están integradas en el
> orden canónico §3.4 del plan y en el runbook §B de aquí).
> **Alcance:** SOLO B11. El *deployment de Convex dedicado a CI* se separó a **MIS-305**.
> **Infra de CI:** no toca `convex/` ni el frontend → **sin deploy de Convex ni de Railway, sin smokes de prod.**

---

## 0. Resumen del cambio

Único fichero del repo modificado: **`.github/workflows/ci.yml`** (13 inserciones, 0 borrados):
1. Añadido el trigger **`workflow_dispatch:`** en `on:` — mecanismo para lanzar la **corrida NUEVA post-borrado**
   (M4) sin re-ejecutar un run previo.
2. Añadido **`environment: ci`** al job **`e2e`** — hace que ese job quede en `Waiting` hasta la aprobación del
   revisor requerido del Environment `ci` antes de ejecutarse y recibir los secretos. El job `build` NO cambia.

El resto de B11 es **operación sobre GitHub** (crear el Environment con revisor, migrar los 11 secretos de nivel-repo
a nivel-Environment, y —tras el merge— borrar los de repo). Va como **runbook literal** en §B (no es código versionado;
se ejecuta una vez, con permiso, en el orden canónico del plan).

---

## 1. Manifiesto del entregable

```
$ find CODIGO/MIS-303-b11-environment -type f | LC_ALL=C sort
CODIGO/MIS-303-b11-environment/.github/workflows/ci.yml
CODIGO/MIS-303-b11-environment/codigo-completo.md
```

`ci.yml` es una **copia byte-idéntica** del fichero instalado (verificado: `diff -q` → sin diferencias).

---

## 2. Diff literal (`git diff`) de `.github/workflows/ci.yml`

```diff
diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
index 382d32b..78127a2 100644
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -5,6 +5,12 @@ on:
     branches: [main]
   pull_request:
     branches: [main]
+  # MIS-303 (B11): permite disparar una corrida NUEVA a mano
+  # (`gh workflow run ci.yml --ref main`). Se usa para la verificación de
+  # aislamiento tras retirar los secretos a nivel repo: una corrida nueva —no un
+  # re-run del run anterior— demuestra que el `e2e` funciona SOLO con los
+  # secretos del Environment `ci`.
+  workflow_dispatch:
 
 jobs:
   build:
@@ -24,6 +30,13 @@ jobs:
   e2e:
     runs-on: ubuntu-latest
     needs: build
+    # MIS-303 (B11): los secretos que consume este job viven en el GitHub
+    # Environment `ci`, protegido con revisor requerido. Referenciarlo aquí hace
+    # que el job quede en "Waiting" hasta la aprobación del revisor antes de
+    # ejecutarse y de recibir los secretos — un PR no confiable no puede
+    # exfiltrarlos sin aprobación. El job `build` NO lo referencia (no usa
+    # secretos), así que no se gatea.
+    environment: ci
     steps:
       - uses: actions/checkout@v4
 
```

---

## 3. Contenido íntegro del `.github/workflows/ci.yml` resultante

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  # MIS-303 (B11): permite disparar una corrida NUEVA a mano
  # (`gh workflow run ci.yml --ref main`). Se usa para la verificación de
  # aislamiento tras retirar los secretos a nivel repo: una corrida nueva —no un
  # re-run del run anterior— demuestra que el `e2e` funciona SOLO con los
  # secretos del Environment `ci`.
  workflow_dispatch:

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
    # MIS-303 (B11): los secretos que consume este job viven en el GitHub
    # Environment `ci`, protegido con revisor requerido. Referenciarlo aquí hace
    # que el job quede en "Waiting" hasta la aprobación del revisor antes de
    # ejecutarse y de recibir los secretos — un PR no confiable no puede
    # exfiltrarlos sin aprobación. El job `build` NO lo referencia (no usa
    # secretos), así que no se gatea.
    environment: ci
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

---

## 4. Verificación estructural del `ci.yml` (greps reproducibles, con salida literal)

```
$ grep -nE '^  (push|pull_request|workflow_dispatch):' .github/workflows/ci.yml
4:  push:
6:  pull_request:
13:  workflow_dispatch:

$ grep -nE '^  [a-z0-9_-]+:$|environment: ci' .github/workflows/ci.yml
4:  push:
6:  pull_request:
13:  workflow_dispatch:
16:  build:
30:  e2e:
39:    environment: ci

# El job `build` NO tiene `environment` (bloque de `build:` hasta `e2e:`):
$ awk '/^  build:/{f=1} /^  e2e:/{f=0} f&&/environment/{print NR": "$0}' .github/workflows/ci.yml
   (sin salida → build no referencia ningún Environment)
```

Lectura: `environment: ci` aparece **una sola vez** y bajo `e2e:` (línea 39, dentro del bloque de `e2e`), nunca bajo
`build:`. Los tres triggers están en `on:`.

**Validación del parseo YAML** (los bloques `env:` de secretos siguen intactos):
```
$ python3 -c "import yaml; d=yaml.safe_load(open('.github/workflows/ci.yml')); \
  on=d.get(True) or d.get('on'); print('on:', list(on.keys())); \
  print('e2e.environment:', d['jobs']['e2e'].get('environment')); \
  print('build.environment:', d['jobs']['build'].get('environment','(none)'))"
on: ['push', 'pull_request', 'workflow_dispatch']
e2e.environment: ci
build.environment: (none)
```

---

## 5. Nota sobre `lint`/`build`/`e2e`/`convex`

El cambio es **solo `ci.yml`** — no toca código de la app, `convex/`, ni el frontend. No hay `npm run lint/build`
nuevo que ejercite nada distinto, ni `npx convex dev`. La suite e2e corre en CI como siempre (mismo deployment de
dev; los datos de test NO cambian — eso es MIS-305). La verificación real de B11 es **operacional** (§B) + estructural
(§4): la configuración del Environment y el borrado de secretos no son testeables por un spec.

---

# §B. Runbook de operaciones sobre GitHub (se ejecuta UNA vez, con permiso, en el orden canónico del plan §3.4)

> **Ningún valor de secreto se imprime en terminal, argv, logs ni `echo`.** Solo se registran **nombres + timestamps
> + run_ids**. Todos los bloques mutantes abren con `set -euo pipefail` y cada operación **aborta explícitamente**
> ante fallo (fail-closed). Comprobado que `jq` **NO** está disponible → el JSON del PUT se construye con `printf`.
> Las constantes (`OWNER/REPO/ENV`, el array `SECRETS` de los 11 nombres y `EXPECTED_NAMES`) se definen en **B.0** y
> se reutilizan en los bloques siguientes de la misma sesión de shell.

### B.0 — Precondición: identidad y repo objetivo (aserción, no solo `gh auth status`)
```
set -euo pipefail
OWNER=mistumonso-cloud; REPO=mi-crm; ENV=ci
SECRETS=(NEXT_PUBLIC_CONVEX_URL GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GOOGLE_OAUTH_REDIRECT_URI \
         GOOGLE_LOGIN_SHARED_SECRET AUTH_SERVER_KEY E2E_CARLOS_EMAIL E2E_CARLOS_PASSWORD \
         E2E_MARTA_EMAIL E2E_MARTA_PASSWORD E2E_TEST_SUPPORT_KEY)
EXPECTED_NAMES="$(printf '%s\n' "${SECRETS[@]}" | LC_ALL=C sort)"
gh auth status
login="$(gh api user -q .login)"
[ "$login" = "$OWNER" ] || { echo "login inesperado: '$login' (esperado $OWNER) -> PARAR"; exit 1; }
gh api "repos/$OWNER/$REPO" -q .full_name | grep -qx "$OWNER/$REPO" \
  || { echo "repo objetivo inesperado -> PARAR"; exit 1; }
# Los comandos gh secret/workflow/run infieren el repo desde el CWD (no todos aceptan --repo):
# asegurar que el repo inferido es EXACTAMENTE el esperado antes de cualquier mutación.
inferred="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
[ "$inferred" = "$OWNER/$REPO" ] || { echo "repo inferido '$inferred' != $OWNER/$REPO -> PARAR"; exit 1; }
```

### B.1 — (paso 3, M1) Crear el Environment `ci` con UN solo body JSON + ASERCIÓN del reviewer efectivo
```
REVIEWER_ID="$(gh api "users/$OWNER" -q .id)"
[[ "$REVIEWER_ID" =~ ^[0-9]+$ ]] || { echo "id de reviewer no numérico -> PARAR"; exit 1; }

# UN ÚNICO body JSON, enviado EXCLUSIVAMENTE por --input - (sin mezclar -F/-f):
BODY="$(printf '{"wait_timer":0,"prevent_self_review":false,"reviewers":[{"type":"User","id":%s}],"deployment_branch_policy":null}' "$REVIEWER_ID")"
printf '%s' "$BODY" | gh api -X PUT "repos/$OWNER/$REPO/environments/$ENV" --input - \
  || { echo "PUT del Environment falló -> PARAR"; exit 1; }

# ASERCIÓN (no solo imprimir): required_reviewers debe existir y contener EXACTAMENTE el login $OWNER.
effective="$(gh api "repos/$OWNER/$REPO/environments/$ENV" \
  -q '[.protection_rules[]? | select(.type=="required_reviewers") | .reviewers[].reviewer.login] | join(",")')"
[ "$effective" = "$OWNER" ] \
  || { echo "reviewer efectivo != '$OWNER' (fue: '$effective') -> PARAR, no publicar el workflow"; exit 1; }
# ASERCIÓN del valor efectivo de prevent_self_review == false (si GitHub lo ignorara, el owner no podría
# autoaprobar sus propias corridas -> fail-closed antes de publicar el workflow).
psr="$(gh api "repos/$OWNER/$REPO/environments/$ENV" \
  -q '[.protection_rules[]? | select(.type=="required_reviewers") | .prevent_self_review][0]')"
[ "$psr" = "false" ] \
  || { echo "prevent_self_review efectivo != false (fue: '$psr') -> el owner no podría autoaprobar -> PARAR"; exit 1; }
# Registrar can_admins_bypass efectivo (informativo, no bloquea):
gh api "repos/$OWNER/$REPO/environments/$ENV" -q '"can_admins_bypass="+(.can_admins_bypass|tostring)'
```
> Si el plan/visibilidad del repo no permite `required_reviewers`, el `effective` no será `$OWNER` y el bloque
> **aborta antes** de cualquier push (garantía M1).

### B.2 — (paso 4, GATE M3) Validar los 4 valores NO cubiertos funcionalmente ANTES de cargar
Los 7 funcionales (Convex URL, AUTH_SERVER_KEY, carlos/marta email+password, TEST_SUPPORT_KEY) se validan solos: un
valor erróneo pone la suite en rojo. Los **4 restantes NO** (2 solo-presencia + 2 no-ejercitados):
`GOOGLE_CLIENT_ID`, `GOOGLE_OAUTH_REDIRECT_URI`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_LOGIN_SHARED_SECRET`.

**Checkpoint obligatorio (humano):** el usuario **confirma explícitamente** que `.env.local` contiene sus valores
vigentes de esos 4 (es el fichero que alimenta su `npm run dev` diario) **o** se contrastan sin mostrarlos contra su
fuente autoritativa (Google Cloud Console / env de Convex dev). **Sin esta confirmación NO se ejecuta B.3.**

### B.3 — (paso 5, M2) Cargar los 11 secretos a nivel Environment (fail-closed + aserción de nombres)
```
set -euo pipefail
EX='const fs=require("fs");const p=require("dotenv").parse(fs.readFileSync(process.argv[1]));const k=process.argv[2];if(!Object.hasOwn(p,k)||p[k].length===0){console.error("FALTA/VACIO: "+k);process.exit(1)}process.stdout.write(p[k])'

# Pre-check AUTH_SERVER_KEY en UN ÚNICO proceso: existencia + no-vacío EN AMBOS ficheros + igualdad, sin imprimir.
node -e '
const fs=require("fs"),dp=require("dotenv");
const a=dp.parse(fs.readFileSync(".env.local")), b=dp.parse(fs.readFileSync(".env.test.local")), k="AUTH_SERVER_KEY";
for (const [n,o] of [[".env.local",a],[".env.test.local",b]])
  if(!Object.hasOwn(o,k)||o[k].length===0){console.error("FALTA/VACIO "+k+" en "+n);process.exit(1)}
if(a[k]!==b[k]){console.error("AUTH_SERVER_KEY DIFIERE entre ficheros");process.exit(1)}
' || { echo "pre-check AUTH_SERVER_KEY FALLÓ -> PARAR"; exit 1; }

# Carga fail-closed: primero VALIDA la extracción (stdout descartado, valor no mostrado); solo si pasa, PIPEA a gh.
# Así un extractor que aborte NUNCA deja a gh fijar un secreto vacío.
set_secret () {  # $1=NAME  $2=fichero
  node -e "$EX" "$2" "$1" >/dev/null || { echo "FALLO extraer $1 de $2 -> PARAR"; exit 1; }
  node -e "$EX" "$2" "$1" | gh secret set "$1" --env "$ENV" || { echo "FALLO set $1 -> PARAR"; exit 1; }
  echo "[$(date -u +%FT%TZ)] set env secret: $1 (fuente: $2)"
}
for N in NEXT_PUBLIC_CONVEX_URL GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GOOGLE_OAUTH_REDIRECT_URI \
         GOOGLE_LOGIN_SHARED_SECRET AUTH_SERVER_KEY; do set_secret "$N" .env.local; done
for N in E2E_CARLOS_EMAIL E2E_CARLOS_PASSWORD E2E_MARTA_EMAIL E2E_MARTA_PASSWORD E2E_TEST_SUPPORT_KEY; do
  set_secret "$N" .env.test.local; done

# ASERCIÓN por máquina: el Environment contiene EXACTAMENTE los 11 nombres (no inspección visual).
got="$(gh secret list --env "$ENV" --json name -q '.[].name' | LC_ALL=C sort)"
[ "$got" = "$EXPECTED_NAMES" ] \
  || { echo "nombres en Environment != 11 esperados -> PARAR"; diff <(echo "$EXPECTED_NAMES") <(echo "$got") || true; exit 1; }
echo "[$(date -u +%FT%TZ)] Environment $ENV con los 11 nombres. Secretos de repo SIGUEN presentes (red de seguridad)."
```

### B.4 — (pasos 6-7) PR con el `ci.yml` + primera corrida gateada
```
set -euo pipefail
BRANCH=mistumonso/mis-303-seguridad-login-b11-github-environment-con-revisor
# push de la rama (PERMISO ANTES DEL PUSH) y PR:
git push -u origin "$BRANCH"
gh pr create --fill --base main
# Localizar el run del PR por rama+SHA, con polling acotado (GitHub puede tardar en indexar el run):
HEAD_SHA="$(git rev-parse HEAD)"
PR_RUN=""
for i in $(seq 1 20); do
  PR_RUN="$(gh run list --workflow=ci.yml --event=pull_request --branch "$BRANCH" -L 10 \
    --json databaseId,headSha -q '[.[] | select(.headSha=="'"$HEAD_SHA"'")][0].databaseId // empty')"
  [ -n "$PR_RUN" ] && break; sleep 3
done
[ -n "$PR_RUN" ] || { echo "no localizado el run del PR para $HEAD_SHA -> revisar"; exit 1; }
echo "[$(date -u +%FT%TZ)] PR run_id=$PR_RUN (sha $HEAD_SHA)"
# e2e entra en "Waiting": aprobar (owner, UI) y esperar el VERDE de forma verificable (no por comentario):
gh run watch "$PR_RUN" --exit-status || { echo "PR run $PR_RUN no verde -> revisar"; exit 1; }
```

### B.5 — (pasos 8-9) Merge (con permiso) + verde post-merge, con secretos de repo AÚN presentes
```
set -euo pipefail
gh pr merge --squash   # asistente, con permiso. NO se han borrado secretos de repo todavía.
# SHA del merge EXACTO del PR (mergeCommit.oid; más preciso que origin/main, que podría avanzar con otro push):
MERGE_SHA="$(gh pr view "$BRANCH" --json mergeCommit -q '.mergeCommit.oid')"
[ -n "$MERGE_SHA" ] || { echo "no obtenido mergeCommit.oid del PR -> revisar"; exit 1; }
# Corrida push:main tras el merge, localizada por ese SHA, con polling acotado (indexado eventual):
POSTMERGE_RUN=""
for i in $(seq 1 20); do
  POSTMERGE_RUN="$(gh run list --workflow=ci.yml --event=push --branch main -L 10 \
    --json databaseId,headSha -q '[.[] | select(.headSha=="'"$MERGE_SHA"'")][0].databaseId // empty')"
  [ -n "$POSTMERGE_RUN" ] && break; sleep 3
done
[ -n "$POSTMERGE_RUN" ] || { echo "no localizado el run post-merge para $MERGE_SHA -> revisar"; exit 1; }
echo "[$(date -u +%FT%TZ)] post-merge run_id=$POSTMERGE_RUN (sha $MERGE_SHA)"
# e2e "Waiting" -> aprobar (owner, UI) -> VERDE verificable (workflow nuevo ya en main):
gh run watch "$POSTMERGE_RUN" --exit-status || { echo "post-merge run $POSTMERGE_RUN no verde -> revisar"; exit 1; }
```

### B.6 — (paso 10, M3) Borrar los 11 secretos de repo (abort inmediato) + ASERCIÓN de ausencia
```
set -euo pipefail
# Re-aserción JIT: el Environment debe seguir con los 11 nombres ANTES de retirar la red de seguridad
# (protege frente a una alteración accidental del Environment entre B.3 y el merge).
got="$(gh secret list --env "$ENV" --json name -q '.[].name' | LC_ALL=C sort)"
[ "$got" = "$EXPECTED_NAMES" ] || { echo "el Environment ya no tiene los 11 nombres -> PARAR, NO borrar repo"; exit 1; }
for N in "${SECRETS[@]}"; do
  gh secret delete "$N" || { echo "FALLO borrar repo secret $N -> PARAR"; exit 1; }
  echo "[$(date -u +%FT%TZ)] deleted REPO secret: $N"
done
# ASERCIÓN por máquina: NINGUNO de los 11 puede seguir a nivel repo (no depende de vista).
repo_now="$(gh secret list --json name -q '.[].name' | LC_ALL=C sort)"
still="$(comm -12 <(echo "$repo_now") <(echo "$EXPECTED_NAMES") || true)"
[ -z "$still" ] || { echo "AÚN presentes en repo: $still -> PARAR, NO lanzar B.7"; exit 1; }
echo "[$(date -u +%FT%TZ)] los 11 secretos AUSENTES a nivel repo (verificado por máquina)."
```

### B.7 — (paso 11, M4) Corrida NUEVA post-borrado (no un re-run), aprobada SOLO tras existir el pending deployment
```
set -euo pipefail
ENV_ID="$(gh api "repos/$OWNER/$REPO/environments/$ENV" -q .id)"
[[ "$ENV_ID" =~ ^[0-9]+$ ]] || { echo "id de Environment no numérico -> PARAR"; exit 1; }

# (1) Disparar un run NUEVO. Se registran por separado el instante del dispatch y el createdAt del run.
DISPATCH_TS="$(date -u +%FT%TZ)"; sleep 1     # +1s: createdAt del run > DISPATCH_TS a resolución de segundo
gh workflow run ci.yml --ref main             # workflow_dispatch => run NUEVO (no un re-run del anterior)
echo "[$(date -u +%FT%TZ)] dispatch lanzado (DISPATCH_TS=$DISPATCH_TS)"

# (2) Localizar el run workflow_dispatch creado DESPUÉS del dispatch; capturar su databaseId.
NEW_RUN=""
for i in $(seq 1 40); do
  NEW_RUN="$(gh run list --workflow=ci.yml --event=workflow_dispatch \
    --json databaseId,createdAt -q "[.[] | select(.createdAt > \"$DISPATCH_TS\")] | sort_by(.createdAt) | last | .databaseId // empty")"
  [ -n "$NEW_RUN" ] && break
  sleep 3
done
[ -n "$NEW_RUN" ] || { echo "no apareció un run workflow_dispatch posterior a $DISPATCH_TS -> revisar"; exit 1; }
NEW_RUN_CREATED="$(gh run view "$NEW_RUN" --json createdAt -q .createdAt)"
echo "[$(date -u +%FT%TZ)] corrida NUEVA post-borrado run_id=$NEW_RUN createdAt=$NEW_RUN_CREATED"

# (3) GATE M4: esperar a que `e2e` ALCANCE un pending deployment del Environment `ci`. build corre PRIMERO;
#     el pending deployment no existe hasta que build termina y GitHub prepara e2e. Aprobar antes daría 4xx.
#     Se maneja explícitamente el fallo de build y el timeout, y se verifica id+nombre+capacidad de aprobar.
#     GitHub crea EXACTAMENTE un pending deployment por Environment => se exige == 1 (alinea código y comentario).
approvable=0
for i in $(seq 1 120); do   # al menos ~10 min (más el tiempo de las llamadas gh): build debe terminar antes del pending deployment
  st="$(gh run view "$NEW_RUN" --json status,conclusion -q '.status+"/"+(.conclusion//"")')"
  case "$st" in
    completed/failure|completed/cancelled|completed/timed_out|completed/startup_failure)
      echo "run $NEW_RUN terminó en '$st' sin pending deployment (¿build rojo?) -> PARAR, aislamiento NO verificado"; exit 1;;
  esac
  approvable="$(gh api "repos/$OWNER/$REPO/actions/runs/$NEW_RUN/pending_deployments" \
    -q "[.[] | select(.environment.id==$ENV_ID and .environment.name==\"$ENV\" and .current_user_can_approve==true)] | length")"
  [ "${approvable:-0}" = "1" ] && break
  sleep 5
done
[ "${approvable:-0}" = "1" ] || { echo "e2e no alcanzó EXACTAMENTE un pending_deployment de '$ENV' dentro del timeout (approvable=$approvable) -> PARAR"; exit 1; }

# (4) SOLO AHORA aprobar: existe exactamente el pending deployment del Environment esperado.
printf '{"environment_ids":[%s],"state":"approved","comment":"MIS-303 B11 verificación aislamiento"}' "$ENV_ID" \
  | gh api -X POST "repos/$OWNER/$REPO/actions/runs/$NEW_RUN/pending_deployments" --input - \
  || { echo "aprobación falló -> revisar"; exit 1; }

# (5) Esperar el VERDE del MISMO run -> prueba de que e2e funciona SOLO con los secretos del Environment.
gh run watch "$NEW_RUN" --exit-status \
  && echo "[$(date -u +%FT%TZ)] run $NEW_RUN VERDE con solo Environment secrets" \
  || { echo "run $NEW_RUN no verde -> revisar"; exit 1; }
```
> Alternativa manual equivalente: en vez de (4), esperar a que el run entre en `Waiting` y **aprobar por la UI**;
> (3) y (5) siguen aplicando (no aprobar antes de que exista el pending deployment; verificar el verde con `gh run
> watch --exit-status`).

### B.8 — (paso 12) Evidencia de aislamiento (ESTRUCTURAL, no "quedó verde por sí solo")
- (a) `build` **no** referencia `environment: ci` (§4) → por el modelo de GitHub, el Environment **no** le entrega
  secretos; (b) los 11 secretos de repo están **ausentes** (aserción de B.6); (c) el `e2e` quedó en `Waiting` hasta la
  aprobación en B.4/B.5/B.7 (no arrancó ni recibió secretos antes). El verde de `build` es consistente pero la prueba
  es (a)+(b)+(c).
- **Registro final** (nunca valores): `PR_RUN`, `POSTMERGE_RUN`, `NEW_RUN` + sus timestamps; nombres de los 11 en el
  Environment y ausencia en repo; `can_admins_bypass` efectivo.

---

# §C. Evidencia del extractor fail-closed (prueba con valores FICTICIOS, sin tocar secretos reales)

```
# fichero temporal:  GOOD=hola   EMPTY=(vacío)   QUOTED="con espacios y = signo"
GOOD   (presente)                 -> exit 0  (OK)
QUOTED (comillas+espacios+'='):   -> valor extraído = `con espacios y =[signo]`  (dotenv respeta comillas/espacios/=,
                                     donde `grep|cut` rompería)
EMPTY  (vacío)                    -> exit != 0  (fail-closed: NO fija un secreto vacío)
MISSING(clave ausente)            -> exit != 0  (fail-closed)
```
Esto acredita las condiciones del GO CONDICIONADO: el extractor **falla** ante clave ausente/vacía (`Object.hasOwn`
+ `length>0`, `pipefail`), y parsea con `dotenv.parse` en vez de `grep|cut`.

---

# §D. Qué queda sujeto a evidencia operacional (no verificable desde este texto)
Coincide con el §7 "No verificable" de la auditoría: que el plan del repo permita `required_reviewers`; que la regla
aparezca efectiva en la API; la vigencia real de `.env.local`; la precedencia Environment>repo en la corrida real; los
estados `Waiting`/aprobación/verde; el borrado real; y el `createdAt` del run nuevo posterior al borrado. Todo ello se
captura en §B como salida de las operaciones (nombres/timestamps, nunca valores).

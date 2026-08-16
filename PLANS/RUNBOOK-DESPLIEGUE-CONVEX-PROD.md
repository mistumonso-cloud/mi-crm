# Runbook — Despliegue a Convex producción

Runbook canónico para desplegar funciones de Convex a **producción** (`greedy-tapir-20`) en el
CRM, con sus **gates fail-closed** y procedimientos de rollback. Creado en MIS-293 (Fase 3 —
Higiene, A4/B9). Los deployments: **prod = `greedy-tapir-20`**, **dev = `dutiful-mole-111`**.

> **Principio transversal — todos los gates son FAIL-CLOSED.** Un gate detiene el despliegue no
> solo cuando su resultado es negativo, sino también ante **cualquier fallo técnico**: función
> ausente, CLI que devuelve código ≠ 0, salida vacía o no parseable como JSON. Ante la duda, se
> **para**; nunca se continúa con un gate indeterminado.

---

## 1. Técnica de despliegue seguro (deploy-token)

El deploy-token es una credencial con capacidad de desplegar sobre **producción**; si un deploy
falla, **no** debe quedar viva ni dejar el secreto en disco.

> **Modelo de autenticación.** Crear y **borrar** deploy keys exige un **personal access token**
> (usuario logueado con `npx convex login`); el CLI **rechaza** hacerlo si la autenticación activa
> es una deploy key. Por eso `token create` y `token delete` se ejecutan con `CONVEX_DEPLOY_KEY` y
> `CONVEX_DEPLOYMENT_TOKEN` **desactivadas**. El `deploy` intermedio sí usa la deploy key creada.

Propiedades del procedimiento (una **única** subshell; el diagnóstico y el `exit` viven **dentro**):

- `umask 077` + `mktemp` comprobado → el fichero del token nace `0600`.
- `trap EXIT` armado **antes** de crear el token; `creation_attempted=1` **antes** de `token create`
  (así la revocación se intenta **siempre** desde ese punto — cubre "creado en el servidor,
  respuesta/escritura local perdida"; el nombre único hace inocuo intentar borrar aunque no exista).
- **NO se hace `source`/`.` del env-file** (C1.2): un dotenv **no** es código Bash y una deploy key
  con metacaracteres (`|`, …) rompería el `source`. Se **parsea**: se extrae SOLO `CONVEX_DEPLOY_KEY`,
  se valida que hay **exactamente una** entrada no vacía y se exporta su valor **sin imprimirlo**,
  sin `eval` ni `source`.
- **Diagnóstico y código de salida DENTRO de la subshell** (C1.1), donde `deploy_rc`, `revoke_rc` y
  `rm_rc` existen por separado: así un `exit 3` real del deploy **no** se atribuye a la revocación.
  Prioridad: **deploy fallido → se preserva `deploy_rc`**; **deploy OK + revocación fallida → `97`**;
  **deploy y revocación OK pero no se borró el env-file → `98`**. `97`/`98` son **códigos reservados
  por este runbook** (un deploy que devolviera esos números se diagnostica igualmente bien dentro de
  `cleanup`). La subshell **propaga** el código tras imprimir el diagnóstico.
- `unset` de **ambas** variables y borrado del fichero **siempre**; si el borrado falla se avisa (el
  fichero lleva la deploy key) y el resultado es no cero (`98`); aviso + acción manual si la
  revocación falla.

```bash
TICKET="MIS-293"          # ajústalo por despliegue
# Prerrequisito: npx convex login (create/delete de deploy keys exigen auth personal).
(
  set -u
  umask 077
  envfile="$(mktemp)" || { echo "mktemp falló — no se despliega." >&2; exit 1; }
  token_name="deploy-${TICKET}-$(date +%Y%m%d-%H%M%S)-${BASHPID:-$$}-${RANDOM}"
  creation_attempted=0
  deploy_rc=0

  cleanup() {
    local revoke_rc=0
    if [ "$creation_attempted" -eq 1 ]; then
      env -u CONVEX_DEPLOY_KEY -u CONVEX_DEPLOYMENT_TOKEN \
        npx convex deployment token delete "$token_name" --prod || revoke_rc=$?
      if [ "$revoke_rc" -ne 0 ]; then
        echo "AVISO: no se pudo revocar '$token_name' (rc=$revoke_rc)." >&2
        echo "  → Si llegó a crearse, revócalo A MANO: Convex → prod → Settings → Deploy Keys." >&2
      fi
    fi
    local rm_rc=0
    rm -f "$envfile" || { rm_rc=$?; echo "AVISO: no se pudo borrar el env-file (contiene la deploy key)." >&2; }
    unset CONVEX_DEPLOY_KEY CONVEX_DEPLOYMENT_TOKEN
    # Diagnóstico + código final AQUÍ (deploy_rc, revoke_rc y rm_rc separados).
    # Códigos reservados por ESTE runbook: 97 = deploy OK, revocación fallida;
    # 98 = deploy y revocación OK pero no se borró el env-file.
    if [ "$deploy_rc" -ne 0 ]; then
      echo "Resultado: Deploy FALLÓ (rc=$deploy_rc)." >&2
      exit "$deploy_rc"
    elif [ "$revoke_rc" -ne 0 ]; then
      echo "Resultado: Deploy CORRECTO pero la REVOCACIÓN falló (revoke_rc=$revoke_rc)." >&2
      exit 97
    elif [ "$rm_rc" -ne 0 ]; then
      echo "Resultado: Deploy y revocación OK, pero no se borró el env-file (rm_rc=$rm_rc)." >&2
      exit 98
    fi
    echo "Resultado: Deploy correcto y token revocado."
    exit 0
  }
  trap cleanup EXIT

  creation_attempted=1
  env -u CONVEX_DEPLOY_KEY -u CONVEX_DEPLOYMENT_TOKEN \
    npx convex deployment token create "$token_name" --prod --save-env "$envfile" \
    || { deploy_rc=$?; exit "$deploy_rc"; }

  # Parseo dotenv (NO source): extraer SOLO CONVEX_DEPLOY_KEY, validar única y no vacía.
  key_line="$(grep -E '^CONVEX_DEPLOY_KEY=' "$envfile")" \
    || { echo "No hay CONVEX_DEPLOY_KEY en el env-file." >&2; deploy_rc=1; exit 1; }
  if [ "$(printf '%s\n' "$key_line" | grep -c .)" -ne 1 ]; then
    echo "El env-file tiene más de una CONVEX_DEPLOY_KEY." >&2; deploy_rc=1; exit 1
  fi
  key_value="${key_line#CONVEX_DEPLOY_KEY=}"
  # Quitar comillas envolventes SOLO si son simétricas (ambas dobles o ambas
  # simples), nunca una suelta. No afecta al contenido interno (p.ej. '|').
  case "$key_value" in
    \"*\") key_value="${key_value#\"}"; key_value="${key_value%\"}" ;;
    \'*\') key_value="${key_value#\'}"; key_value="${key_value%\'}" ;;
  esac
  [ -n "$key_value" ] || { echo "CONVEX_DEPLOY_KEY vacío." >&2; deploy_rc=1; exit 1; }
  export CONVEX_DEPLOY_KEY="$key_value"   # asignación literal: no interpreta metacaracteres

  env -u CONVEX_DEPLOYMENT npx convex deploy -y
  deploy_rc=$?
  exit "$deploy_rc"
)
# La subshell ya imprimió el diagnóstico y propaga el código: $? = 0 (OK),
# 97 (deploy OK pero revocación falló) o el código real del deploy si falló.
```

- Leer variables de prod (solo lectura): `npx convex env list --prod --names-only`;
  `npx convex env get <VAR> --prod` (captúralo en `$(...)`, **nunca** lo imprimas).
- `convex codegen` **no** despliega funciones a dev; para dev usa `npx convex dev --once`.
- Los scripts de sonda contra prod deben vivir **dentro del repo** (ESM resuelve `node_modules`
  hacia arriba e ignora `NODE_PATH`).

---

## 2. Gate B9 — secretos de prod (programático, fail-closed)

Se captura **una sola** salida validada de `--names-only` y se comprueba programáticamente (no por
inspección visual): ausencia exacta de `E2E_TEST_SUPPORT_KEY`, presencia exacta de `AUTH_SERVER_KEY`
y `GOOGLE_LOGIN_SHARED_SECRET`, y código de salida 0 del CLI. El **valor** de los secretos NO se
comprueba aquí (`--names-only` no lo devuelve y nunca se imprime). Va en una **subshell** para que
sus `exit 1` no cierren una shell interactiva si se pega por partes.

```bash
(
  set -u
  names="$(npx convex env list --prod --names-only)" || { echo "Gate B9: la CLI falló — PARAR" >&2; exit 1; }
  printf '%s\n' "$names" | grep -qx "E2E_TEST_SUPPORT_KEY" && { echo "Gate B9: E2E_TEST_SUPPORT_KEY PRESENTE en prod — PARAR" >&2; exit 1; }
  printf '%s\n' "$names" | grep -qx "AUTH_SERVER_KEY"            || { echo "Gate B9: falta AUTH_SERVER_KEY — PARAR" >&2; exit 1; }
  printf '%s\n' "$names" | grep -qx "GOOGLE_LOGIN_SHARED_SECRET" || { echo "Gate B9: falta GOOGLE_LOGIN_SHARED_SECRET — PARAR" >&2; exit 1; }
  echo "Gate B9 OK."
)
```

(`E2E_TEST_SUPPORT_KEY` se gestiona/rota en **dev**; en prod no debe existir. `grep -qx` exige
coincidencia de **línea completa**.)

---

## 3. Gate NFKC — compatibilidad de emails (MIS-293, A3-i → A3-ii)

Autoriza activar la normalización **NFKC** en `normalizeEmailKey` (A3-ii, PR-1a-bis). La consulta
precursora `auth:accountsWithNonCanonicalEmail` (read-only, desplegada en PR-1a) devuelve las
cuentas cuyo `email` almacenado **no** coincide con su forma canónica completa
(`NFKC` + `trim` + `toLowerCase`), es decir, las que cambiarían bajo A3-ii.

**Se ejecuta DOS veces** (los datos son mutables entre medias vía `seedUser` / administración):

1. **Inicial**, tras desplegar **PR-1a**.
2. **Just-in-time**, **inmediatamente antes** de desplegar **A3-ii** (PR-1a-bis).

```bash
out="$(npx convex run auth:accountsWithNonCanonicalEmail --prod)"; rc=$?
if [ "$rc" -ne 0 ]; then echo "Gate NFKC: la CLI falló (rc=$rc) — PARAR" >&2; exit 1; fi
# Validación como JSON ESTRUCTURADO (no comparación visual de stdout): exactamente [].
printf '%s' "$out" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let a;try{a=JSON.parse(s)}catch{process.exit(1)}process.exit(Array.isArray(a)&&a.length===0?0:1)})' \
  || { echo "Gate NFKC: salida != [] o no es JSON — PARAR" >&2; exit 1; }
echo "Gate NFKC OK (rc=$rc, [])."
```

**Criterio de aprobación (fail-closed):** se continúa **solo si** la salida es, validada como JSON,
**exactamente `[]`** y el código de salida es **0**. Cualquier otra cosa —lista no vacía, error de
CLI, salida no-JSON— **detiene** el despliegue de NFKC.

**Secuencia obligatoria:** PR-1a desplegado → gate inicial `[]` → preparar/auditar/mergear
PR-1a-bis → **repetir** el gate → solo con `[]` + exit 0, desplegar A3-ii.

**Evidencia:** registrar el resultado del gate final vinculado a **commit + deployment
(`greedy-tapir-20`) + timestamp + código de salida (`rc`)**, para acreditar qué versión se autorizó
y contra qué datos.

**PII:** la salida contiene emails. Se publica/registra **solo `[]` o un conteo**; si apareciera
alguna cuenta, **no** se incorpora la salida completa al PR ni a logs/artefactos compartidos — se
trata el detalle como PII operativa y se decide una migración de datos antes de activar NFKC.

---

## 4. Rollback del veto por email (MIS-293, B4/M3)

Tras retirar el interruptor `LOGIN_EMAIL_VETO` (PR-1b), la variable **ausente** significa, **para
el código anterior a PR-1b**, "veto **ACTIVO**" (fail-safe). Por tanto, revertir Convex a un commit
previo con la variable ausente **reabriría** el bloqueo por email (I4/A2). Reglas:

- **Orden de PR-1b:** desplegar el **código nuevo primero**, retirar la variable **después**
  (`npx convex env remove LOGIN_EMAIL_VETO --prod`; en dev,
  `npx convex env remove LOGIN_EMAIL_VETO --deployment dutiful-mole-111`). El código nuevo ya no la
  lee, así que retirarla es un no-op funcional.
- **Rollback planificado** (volver a código anterior a PR-1b): **antes** de desplegar el código
  viejo, `npx convex env set LOGIN_EMAIL_VETO off --prod` y **verificar** (`env get`); solo
  entonces desplegar. Así el fail-safe encuentra `off` y no reactiva el veto.
- **Recuperación si el rollback de código ya ocurrió primero** (incidencia): inmediatamente
  `npx convex env set LOGIN_EMAIL_VETO off --prod` y verificar — neutraliza el veto reactivado sin
  esperar a re-desplegar.
- El día que se decida que el veto no vuelve **nunca**, este apartado se retira junto con la última
  versión de código que leía la variable.

---

## 5. Verificación post-despliegue (smoke)

Sin provocar bloqueos reales ni ensuciar datos:

- Un login fallido normal devuelve el error **genérico** (`"Email o contraseña incorrectos"`).
- Un login correcto entra (o, para no crear sesiones de más, se valida el comportamiento esperado
  del cambio desplegado).
- Para cambios en `convex/` que tocan el login (B5, NFKC, retirada del veto), confirmar que el
  comportamiento anterior no legítimo no ha cambiado más allá de lo previsto.

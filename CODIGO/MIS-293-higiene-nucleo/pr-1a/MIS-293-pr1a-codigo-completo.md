# MIS-293 · PR-1a — Higiene trivial + precursor de compatibilidad — CÓDIGO COMPLETO

Rama: `mistumonso/mis-293-pr1a-higiene-precursor`. Plan: `PLANS/MIS-293-higiene-nucleo.md`
(GO CONDICIONADO ronda 3). Este PR es la **primera** de las tres unidades del núcleo:
**PR-1a → gate `[]` → PR-1a-bis → PR-1b**.

**Contenido de PR-1a:** A1 (retirar `ConvexClientProvider`), A2 (cota `i=` en `verifyPassword` +
prueba de unidad + project `unit`), A3-i (precursor read-only `accountsWithNonCanonicalEmail`,
**NO activa NFKC**), A4 (runbook). **No** hay NFKC aquí (va en PR-1a-bis, tras el gate).

Los snapshots byte-idénticos están junto a este documento, replicando la ruta del repo
(**incluidos `README.md` y `PLANS/RUNBOOK-DESPLIEGUE-CONVEX-PROD.md`**; ver Manifiesto). El runbook
también existe en `PLANS/RUNBOOK-DESPLIEGUE-CONVEX-PROD.md` (documentación), byte-idéntico al
snapshot.

---

## Manifiesto de ficheros (PR-1a)

| Fichero | Acción | Ítem |
|---|---|---|
| `convex/lib/password.ts` | modificado | A2 (cota `i=`) |
| `convex/auth.ts` | modificado | A3-i (internalQuery precursora) |
| `src/app/layout.tsx` | modificado | A1 (desmontar provider) |
| `playwright.config.ts` | modificado | A2 (project `unit`) |
| `README.md` | modificado | A1 (frase del provider, línea 23) |
| `e2e/lib-unit.spec.ts` | **añadido** | A2 (unidad de B5) |
| `PLANS/RUNBOOK-DESPLIEGUE-CONVEX-PROD.md` | **añadido** | A4 (runbook canónico) |
| `src/components/ConvexClientProvider.tsx` | **borrado** | A1 |

Todos tienen snapshot byte-idéntico en `CODIGO/MIS-293-higiene-nucleo/pr-1a/<ruta>` salvo el
borrado (no procede snapshot).

---

## Cambios de la ronda 2 (auditoría de código NO-GO)

- **C1 (deploy-token inseguro)** → runbook §1 reescrito: **subshell acotada** con `umask 077`,
  fichero temporal `mktemp`, **`trap EXIT`** que **revoca** (best-effort, solo si el token llegó a
  crearse) + **borra** el fichero + `unset CONVEX_DEPLOY_KEY` **siempre** (misma limpieza en éxito y
  fallo), **preserva el exit code** del deploy, **aviso visible + acción manual** si la revocación
  falla, y **nombre de token único** (`deploy-<TICKET>-<fecha>-<pid>`).
- **C2 (snapshots incompletos)** → añadidos `pr-1a/README.md` y
  `pr-1a/PLANS/RUNBOOK-DESPLIEGUE-CONVEX-PROD.md`, y este **Manifiesto** completo (añadidos /
  modificados / borrados).
- **Media** → runbook §2: gate B9 **programático fail-closed** (una salida `--names-only`
  validada: ausencia exacta de `E2E_TEST_SUPPORT_KEY`, presencia de `AUTH_SERVER_KEY` y
  `GOOGLE_LOGIN_SHARED_SECRET`, exit 0).
- **Baja** → `withIterationsField` afirma 5 partes y `parts[2]` empieza por `i=`; runbook §3
  registra también el **exit code** del gate NFKC en la evidencia; nombres de token únicos (ya en C1).

---

## Cambios de la ronda 3 (auditoría de código NO-GO) — C1 (revocación no ejecutable)

El CLI de Convex **rechaza** borrar una deploy key si la auth activa es una deploy key (exige
personal access token). En la ronda 2, el `token delete` del trap corría con `CONVEX_DEPLOY_KEY`
aún exportada → la revocación fallaba siempre. Runbook §1 corregido:

- **Revocación con auth personal:** `env -u CONVEX_DEPLOY_KEY -u CONVEX_DEPLOYMENT_TOKEN npx convex
  deployment token delete …`. Igual para `token create` (una credencial heredada de la shell
  bloquearía la auth personal). Prerrequisito documentado: `npx convex login`.
- **Ventana "creado en el servidor, confirmación local perdida":** `creation_attempted=1` se marca
  **antes** de `token create`, y la revocación se intenta **siempre** desde ese punto (el nombre
  único hace inocuo intentar borrar aunque no exista).
- **`deploy_rc` vs `cleanup_rc` separados:** deploy fallido → se preserva su código; deploy OK pero
  revocación fallida → sale **3** y **no** imprime "Deploy correcto"; fichero y **ambas** variables
  (`CONVEX_DEPLOY_KEY`, `CONVEX_DEPLOYMENT_TOKEN`) se limpian **siempre**. Mensaje final
  diferenciado por caso (fallo / OK+revocado / OK+revocación fallida).
- **Media** → se comprueba el resultado de `. "$envfile"` y que `CONVEX_DEPLOY_KEY` quedó definida
  y no vacía (sin imprimirla); `token create` también con las credenciales de deploy desactivadas.
- **Baja** → mensajes finales diferenciados (3 casos); el gate B9 (§2) va en **subshell** para que
  sus `exit 1` no cierren una shell interactiva.

Verificado: `bash -n` del bloque §1 pasa; runbook `PLANS/` y snapshot `CODIGO/` byte-idénticos.

---

## Cambios de la ronda 4 (auditoría de código NO-GO) — C1.1 y C1.2

Estado **vigente** del §1 (el runbook literal embebido en A4 es la fuente de verdad; estas notas
resumen el porqué):

- **C1.1 — el bloque perdía su código y `3` estaba sobrecargado.** Antes, un `case … esac` con solo
  `echo` tras la subshell dejaba el resultado final en 0, y un `convex deploy` que fallara con 3 se
  confundía con "revocación fallida". Ahora **el diagnóstico y el `exit` viven DENTRO de la subshell**
  (en `cleanup`, con `deploy_rc` y `revoke_rc` **separados**): deploy fallido **preserva `deploy_rc`**;
  deploy OK + revocación fallida sale con **`97`** (código reservado **distinto**, no colisiona con
  0/1); un `exit 3` real del deploy se diagnostica como fallo de deploy, **no** de revocación. La
  subshell **propaga** ese código; ya no hay un `echo` final que lo pise.
- **C1.2 — se hacía `source`/`.` del env-file.** Un dotenv **no** es código Bash; una deploy key con
  `|` u otros metacaracteres rompería el `source`. Ahora el env-file se **parsea**: se extrae solo
  `CONVEX_DEPLOY_KEY` (validada **única** y **no vacía**, comillas envolventes retiradas) y se
  **exporta por asignación literal** —que no interpreta metacaracteres— sin `source`, sin `eval` y
  **sin imprimir** el valor.
- **Media/Baja:** `mktemp` comprobado antes de armar el flujo; nombre de token con
  `${BASHPID:-$$}-${RANDOM}` (unicidad aunque `$$` no cambie en subshell); mensajes de error más
  cortos por rama.

Verificado: `bash -n` del §1 (fichero y **copia embebida**) pasa; runbook `PLANS/`, snapshot
`CODIGO/pr-1a/PLANS/` y **copia embebida en este documento** son byte-idénticos entre sí.

**Validación semántica** (arnés local que stubea `npx convex` create/deploy/delete; `bash -n` no
cubre esto). Resultados observados = esperados:

| Escenario | Códigos internos | Código final | Correcto |
|---|---|---|---|
| Deploy OK + revocación OK | deploy 0, revoke 0, rm 0 | **0** | ✔ |
| Deploy FALLA (1) | deploy 1 | **1** (preserva deploy) | ✔ |
| Deploy OK + revocación FALLA | deploy 0, revoke 1 | **97** (reservado, distinto) | ✔ |
| Deploy FALLA con **3** | deploy 3 | **3** (fallo de deploy, **no** 97) | ✔ |
| `token create` FALLA (2) | create 2 | **2** | ✔ |
| Deploy+revoke OK pero **`rm` FALLA** | deploy 0, revoke 0, rm 5 | **98** (reservado) | ✔ |
| Clave **entrecomillada** (`"prod:foo|bar"`) | deploy 0 | **0** | ✔ |

Parseo dotenv (C1.2): con `CONVEX_DEPLOY_KEY=prod:foo|bar|baz` (sin comillas, con `|`), el `deploy`
recibe la clave **entera** `prod:foo|bar|baz`; con `CONVEX_DEPLOY_KEY="prod:foo|bar"` recibe
`prod:foo|bar` (comillas simétricas retiradas, `|` intacto). El `|` no se interpreta como tubería;
con `source` se habría roto.

---

## Cambios de la ronda 5 (auditoría GO) — sugerencias no bloqueantes incorporadas

El auditor dio **GO** y autorizó incorporar estas sin reabrir la auditoría:

- **Media** → `cleanup` comprueba el resultado de `rm -f "$envfile"`: si falla, **avisa** (el
  fichero lleva la deploy key) y, con deploy+revocación OK, el resultado es **`98`** (reservado).
- **Baja** → las comillas envolventes del dotenv se retiran **solo si son simétricas** (ambas
  dobles o ambas simples), nunca una suelta.
- **Baja** → documentado que **`97`/`98` son códigos reservados por este runbook**; un deploy que
  devolviera esos números se sigue diagnosticando bien dentro de `cleanup` (el mensaje distingue el
  caso, no solo el número).

Revalidado: `bash -n` OK; **7** escenarios del arnés con código esperado (incluidos `rm`→`98` y
clave entrecomillada); tres copias del runbook byte-idénticas.

---

## A1 · Retirar `ConvexClientProvider` (código muerto)

Instanciaba un `ConvexReactClient` en el **navegador** sin ningún consumidor (la app va por Server
Actions / `convex/nextjs` en el servidor). `NEXT_PUBLIC_CONVEX_URL` **se conserva**: la usan
`convex/nextjs` (servidor) y los e2e.

### `src/components/ConvexClientProvider.tsx` — BORRAR

Se elimina el fichero completo (no hay snapshot de un borrado; se documenta aquí).

### `src/app/layout.tsx`

```diff
 import type { Metadata } from "next";
 import { Inter, JetBrains_Mono } from "next/font/google";
 import "./globals.css";
-import { ConvexClientProvider } from "@/components/ConvexClientProvider";

 const inter = Inter({
@@
     <html
       lang="es"
       className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
     >
-      <body className="min-h-full flex flex-col">
-        <ConvexClientProvider>{children}</ConvexClientProvider>
-      </body>
+      <body className="min-h-full flex flex-col">{children}</body>
     </html>
```

### `README.md:23`

```diff
-   Esto genera `convex/_generated/` y rellena `.env.local` con `NEXT_PUBLIC_CONVEX_URL` y `CONVEX_DEPLOYMENT`. Sin esto la app funciona pero sin datos (el provider avisa por consola).
+   Esto genera `convex/_generated/` y rellena `.env.local` con `NEXT_PUBLIC_CONVEX_URL` y `CONVEX_DEPLOYMENT`. Sin esto la app arranca pero sin datos.
```

`NEXT_PUBLIC_CONVEX_URL` sigue en la lista de variables requeridas de `README.md:125` (no se
toca) y **no** se retira de Railway/CI.

---

## A2 · B5 — Cota superior a las iteraciones del hash

### `convex/lib/password.ts`

Nueva constante y guarda en `verifyPassword`, **tras** parsear `i=` y **antes** de decodificar
salt/hash (para que el rechazo sea imputable a la cota, no a un decode):

```diff
 const ALGORITHM = "pbkdf2_sha256";
 const VERSION = "v1";
 const ITERATIONS = 600_000;
+// MIS-293 (B5): cota superior defensiva del campo `i=` que verifyPassword lee del
+// hash almacenado. Hoy todos los hashes usan ITERATIONS (600.000), pero un valor
+// manipulado como i=100000000 colgaría el KDF (DoS por CPU). El techo deja holgura
+// para subir el coste en el futuro sin tocar esta cota.
+const MAX_ITERATIONS = 1_000_000;
 const SALT_LENGTH_BYTES = 16;
 const KEY_LENGTH_BITS = 256;
@@ export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
   const iterations = Number(parts[2].replace(/^i=/, ""));
+  // MIS-293 (B5): cota defensiva. Un `i=` fuera de rango (manipulado) colgaría
+  // deriveBits; se trata como hash inválido (misma salida que un formato
+  // malformado). Va tras parsear `i=` y ANTES de decodificar salt/hash, para que
+  // el rechazo sea imputable a la cota y no a un decode base64. `Number.isInteger`
+  // cubre de paso NaN (i= no numérico), el string vacío (Number("")===0) y los
+  // decimales.
+  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) {
+    return false;
+  }
   const salt = base64UrlToBytes(parts[3]);
```

Casos cubiertos por la guarda: `i=100000000` (>techo), `i=abc`/`i=` (`NaN`/0 vía `Number.isInteger`),
`i=1.5` (no entero), `i=0`/`i=-5` (<1). `i=600000` legítimo pasa (600 000 < 1 000 000).

### `e2e/lib-unit.spec.ts` — NUEVO (contenido literal completo)

Prueba de **unidad** que importa `hashPassword`/`verifyPassword` directamente y corre en Node
(WebCrypto) bajo el project `unit`. Los fixtures parten de un hash **real** (`hashPassword`) al que
solo se le reemplaza el campo `i=`, de modo que salt/hash siguen siendo **base64url válidos** y el
`false` rápido queda imputado a la cota de iteraciones, no a un decode.

```ts
// MIS-293 (PR-1a): pruebas de UNIDAD de librería (sin navegador ni Convex).
// Corren bajo el project `unit` de playwright.config.ts e importan directamente
// las funciones de `convex/lib` para ejercitarlas en Node con WebCrypto
// (Playwright transpila TS; `node --test` no ejecutaría estos módulos TS).
//
// NOTA (redacción honesta): el project `unit` HEREDA el `webServer` global de
// playwright.config.ts, así que `--project=unit` NO corre aislado del arranque
// de Next — en una corrida completa `npm run test:e2e` el server arranca una
// sola vez y es inofensivo. Estas pruebas no usan `page`, así que no lanzan
// navegador.
import { test, expect } from "@playwright/test";
import { hashPassword, verifyPassword } from "../convex/lib/password";

// Sustituye el campo `i=<n>` de un hash REAL (con salt y hash base64url VÁLIDOS,
// generados por hashPassword) por otro valor. Así, cuando verifyPassword rechaza,
// el rechazo es imputable al PARSER DE ITERACIONES (la cota B5) y no a un decode
// base64 fallido: salt y hash siguen siendo válidos.
function withIterationsField(realHash: string, iField: string): string {
  const parts = realHash.split("$"); // [algo, v1, i=600000, saltB64, hashB64]
  // Validez explícita del fixture: el hash real DEBE tener 5 partes y la 3.ª
  // empezar por "i=" antes de sustituirla. Así se garantiza que solo cambia el
  // campo de iteraciones (salt/hash quedan intactos y siguen siendo base64url
  // válidos), y que un rechazo posterior es imputable a la cota, no al formato.
  expect(parts).toHaveLength(5);
  expect(parts[2].startsWith("i=")).toBe(true);
  parts[2] = iField;
  return parts.join("$");
}

test.describe("verifyPassword — cota de iteraciones (B5, MIS-293)", () => {
  test("un i= descomunal se rechaza rápido, sin ejecutar el KDF", async () => {
    const real = await hashPassword("Contrasena-Correcta-1!");
    const huge = withIterationsField(real, "i=100000000"); // 100 M
    const t0 = Date.now();
    const result = await verifyPassword("Contrasena-Correcta-1!", huge);
    const elapsed = Date.now() - t0;
    // Se rechaza como hash inválido...
    expect(result).toBe(false);
    // ...y ANTES de derivar: 100 M iteraciones tardarían decenas de segundos.
    expect(elapsed).toBeLessThan(2000);
  });

  test("i= no numérico / vacío / decimal se rechazan (fixtures base64url válidos)", async () => {
    const real = await hashPassword("Contrasena-Correcta-2!");
    for (const badIterations of ["i=abc", "i=", "i=1.5", "i=0", "i=-5"]) {
      const stored = withIterationsField(real, badIterations);
      expect(
        await verifyPassword("Contrasena-Correcta-2!", stored),
        `esperaba false para ${badIterations}`,
      ).toBe(false);
    }
  });

  test("un hash legítimo (i=600000) sigue validando — control positivo", async () => {
    const real = await hashPassword("Contrasena-Correcta-3!");
    expect(await verifyPassword("Contrasena-Correcta-3!", real)).toBe(true);
    expect(await verifyPassword("otra-distinta", real)).toBe(false);
  });
});
```

### `playwright.config.ts`

Nuevo project `unit` (sin `dependencies` ni `storageState`), con `testMatch` explícito:

```diff
       },
     },
+
+    // MIS-293 (PR-1a): pruebas de UNIDAD de librería que corren en Node, sin
+    // navegador (verifyPassword, etc.). testMatch explícito y disjunto. Sin
+    // `dependencies` ni `storageState`. Nota: hereda el `webServer` global de
+    // abajo, así que `--project=unit` NO es independiente del arranque de Next;
+    // en la corrida completa el server arranca una sola vez y es inofensivo.
+    {
+      name: "unit",
+      testMatch: ["lib-unit.spec.ts"],
+    },
   ],
```

---

## A3-i · Precursor de compatibilidad NFKC (read-only, NO activa NFKC)

### `convex/auth.ts`

Nueva `internalQuery` `accountsWithNonCanonicalEmail`, junto a `accountsPendingRotation` (mismo
patrón: solo `id`/`email`, invocable con `npx convex run`). **No** modifica `normalizeEmailKey`, así
que desplegarla **no** cambia el login. Compara la forma canónica **completa**
(`NFKC` + `trim` + `toLowerCase`) para probar exactamente lo que aplicará A3-ii:

```diff
       .map((u) => ({ id: u._id, email: u.email }));
   },
 });

+// MIS-293 (A3-i, precursor de compatibilidad NFKC): devuelve las cuentas cuyo
+// `email` almacenado NO coincide con su forma canónica COMPLETA prevista
+// (`NFKC` + `trim` + `toLowerCase`) — exactamente la que aplicará A3-ii en
+// `normalizeEmailKey`. Es el gate fail-closed que autoriza activar NFKC: debe
+// devolver `[]` ...
+export const accountsWithNonCanonicalEmail = internalQuery({
+  args: {},
+  returns: v.array(v.object({ id: v.id("users"), email: v.string() })),
+  handler: async (ctx) => {
+    const users = await ctx.db.query("users").collect();
+    return users
+      .filter((u) => u.email.normalize("NFKC").trim().toLowerCase() !== u.email)
+      .map((u) => ({ id: u._id, email: u.email }));
+  },
+});
+
 export const cleanupExpiredSessions = internalMutation({
```

`internalQuery` ya está importado en `auth.ts`; no cambian imports.

---

## A4 · Runbook (B9 + gates fail-closed)

Nuevo fichero `PLANS/RUNBOOK-DESPLIEGUE-CONVEX-PROD.md` (con snapshot byte-idéntico en
`pr-1a/PLANS/RUNBOOK-DESPLIEGUE-CONVEX-PROD.md`). Como la auditoría solo dispone de este documento,
se incluye su **contenido literal completo** a continuación (no un resumen). El §1 (estado
**vigente**, tras ronda 4) implementa la corrección de C1/C1.1/C1.2: `token create`/`token delete`
con auth **personal** (deploy key desactivada), `creation_attempted=1` antes de crear, `trap EXIT`
armado antes del intento; **el env-file se PARSEA como dotenv** (se extrae solo `CONVEX_DEPLOY_KEY`,
validada única y no vacía, exportada sin imprimir) **en vez de `source`**; **diagnóstico y `exit`
dentro de la subshell** con `deploy_rc`/`revoke_rc` separados (deploy fallido preserva su código;
deploy OK + revocación fallida → **`97`**, distinto y sin "Deploy correcto"); borrado y `unset`
incondicionales; acción manual inequívoca. *(Las notas de rondas 2–3 abajo son históricas: el `exit
3` y el `source` que mencionan quedaron superados por la ronda 4.)*

<!-- INICIO contenido literal de PLANS/RUNBOOK-DESPLIEGUE-CONVEX-PROD.md -->

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

<!-- FIN contenido literal de PLANS/RUNBOOK-DESPLIEGUE-CONVEX-PROD.md -->

---

## Verificación (tras instalar en el repo, fuera de este documento)

- `npm run lint` + `npm run build` + typecheck de Convex verdes.
- `npm run test:e2e` verde, incluido el project `unit` (B5) y sin regresión de login/recuperación.
- Deploy Convex prod (A2 cota + A3-i precursor) vía deploy-token.
- **Gate A3-i tras el deploy:** `npx convex run auth:accountsWithNonCanonicalEmail --prod` → `[]`
  (fail-closed; evidencia sin PII). Solo con `[]` se procede a PR-1a-bis.

## No incluido en PR-1a (a propósito)

- La activación de NFKC en `normalizeEmailKey` y su prueba Unicode → **PR-1a-bis** (tras gate `[]`).
- La retirada del veto, la reescritura del test del reseed y el borrado de `scripts/login-verify/`
  + `test:unit` → **PR-1b**.

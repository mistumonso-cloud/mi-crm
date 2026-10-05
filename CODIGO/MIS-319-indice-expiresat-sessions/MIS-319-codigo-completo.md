# MIS-319 — Código completo: índice `by_expiresAt` en `sessions` y limpieza por lotes

**Rama:** `mis-319-indice-expiresat-sessions` (desde `main` @ `4ba302f`)
**Plan:** `PLANS/MIS-319-indice-expiresat-sessions.md`. Auditoría del plan, ronda 1: **GO CONDICIONADO** (C1, C2, C3, S1, S2 y S3 incorporadas).
**Estado:** auditoría del código: ronda 1 **NO-GO** (M1, corregido en §0) → ronda 2 **GO CONDICIONADO** (completar los gates de §6 antes del merge/deploy). **Instalado** en la rama; resultados de los gates en §6. Código productivo sin cambios desde la ronda 2.

---

## 0. Respuesta a la auditoría del código, ronda 1 (NO-GO)

El cambio productivo (§2 y §3) **no se ha tocado**. Solo cambia el script de verificación (§4), que se muestra íntegro.

- **M1 — guard de entorno fail-open → ahora fail-closed con evidencia positiva.** Se ha eliminado la detección negativa (`/prod|production/`). Antes de crear el cliente o mutar nada, `assertDevTarget()` exige que se cumpla todo esto, y aborta si falla cualquier punto:
  1. **Ninguna** variable `CONVEX_*` en el entorno del proceso. Así se evita que, por ejemplo, un `CONVEX_DEPLOY_KEY` de prod olvidado en la shell redirija el CLI.
  2. `CONVEX_DEPLOYMENT` de `.env.local` con la forma exacta `dev:<nombre>`. Si falta, está vacío o tiene otro prefijo, aborta.
  3. `NEXT_PUBLIC_CONVEX_URL` es https, su primer label de host es `<nombre>` y termina en `.convex.cloud`.
  4. **Confirmación del propio Convex:** `npx convex run --inline-query "return process.env.CONVEX_CLOUD_URL" --deployment dev` (`dev` = el deployment de dev personal, resuelto por Convex) tiene que devolver **exactamente** `NEXT_PUBLIC_CONVEX_URL`.
  5. Todas las llamadas al CLI llevan `--deployment dev` explícito. El cliente HTTP usa la URL confirmada en el punto 4.
- **S4 — limpieza garantizada:** a partir del primer `reset`, todo va en `try/catch/finally`. El `finally` hace `resetTestIdentity` y comprueba que queden 0 sesiones. Si la limpieza también falla, se avisa, pero se conserva y propaga el **error original**. `fail()`/`process.exit` desaparecen del cuerpo: solo hay un `process.exit(1)` en el `catch` de `main()`, que se ejecuta después de que el `finally` haya terminado.
- **S5 — interferencia global documentada:** la cabecera del script advierte de que `cleanupExpiredSessions` opera sobre toda la tabla. Durante la prueba no debe correr la suite e2e ni otra limpieza (el cron es a las 03:00 UTC), ni nadie más debe usar `reset@test.local`.

Pruebas del guard ya ejecutadas (con una copia del script que termina justo después del guard, sin crear cliente ni mutar nada, borrada después):

| Caso | Resultado |
|---|---|
| `.env.local` real (dev) | `0. destino confirmado ✓` — Convex devuelve exactamente la URL de `.env.local` |
| `CONVEX_DEPLOY_KEY=x` en el entorno | `FALLO: hay variables CONVEX_DEPLOY_KEY en el entorno; ejecútalo sin ellas` |
| `CONVEX_DEPLOYMENT=prod:<nombre>` | ``FALLO: CONVEX_DEPLOYMENT de .env.local no tiene la forma `dev:<nombre>` `` |
| `CONVEX_DEPLOYMENT=` (vacío) | mismo FALLO |
| URL de otro deployment (`https://otro-deploy-123.…`) | `FALLO: NEXT_PUBLIC_CONVEX_URL no corresponde al deployment de dev de CONVEX_DEPLOYMENT` |

## 1. Qué cambia y por qué

- `convex/auth.ts` → `cleanupExpiredSessions` (la invoca el cron diario `"cleanup expired sessions"`, 03:00 UTC, en `convex/crons.ts`; no cambia). Antes buscaba las caducadas con `.filter()` sin índice + `.collect()`, es decir, **leía la tabla `sessions` entera** y borraba en una sola transacción todo lo que encontraba.
- Ahora:
  1. **Índice** `by_expiresAt` sobre `sessions.expiresAt` (`convex/schema.ts`).
  2. La consulta va **por el índice** (`withIndex(... q.lt("expiresAt", now))`): solo lee las filas caducadas.
  3. **Lotes acotados** (`take(1000)`). Si el lote sale lleno, la función se **re-programa a sí misma** (`ctx.scheduler.runAfter(0, internal.auth.cleanupExpiredSessions, {})`). El coste por transacción queda acotado y un atasco se drena en ejecuciones sucesivas.
- **Semántica (S3):** cada lote borra **únicamente las sesiones caducadas al comenzar ese lote** (`expiresAt < now`, estricto como antes). El valor devuelto es **lo borrado en ese lote**, no el total de la cadena. Nadie consume ese valor: el cron lo ignora y no hay otros llamantes en `src/` ni en `e2e/`.
- **Tamaño del lote (C1):** según los límites oficiales de Convex por transacción (https://docs.convex.dev/production/state/limits, consultado el 2026-10-05), son 16.000 documentos escritos, 32.000 escaneados, 16 MiB leídos/escritos, 4.096 rangos de índice y 1.000 funciones programadas. Un lote de 1000 usa unos 1000 deletes (~6 %), ≤ 1000 escaneos (~3 %), ~150 KiB, 1 rango y ≤ 1 programación. Margen amplio.
- **Seguridad:** el cron es solo higiene. La validez de una sesión se comprueba al leer (`convex/lib/authz.ts:31`: `if (session.expiresAt < Date.now()) return null;`), así que un fallo de la limpieza no afecta a la autenticación.
- `internal` ya estaba importado en `convex/auth.ts` (línea 4: `import { internal } from "./_generated/api";`). No hay imports nuevos. La auto-referencia `internal.auth.cleanupExpiredSessions` pasa el typecheck (ver §5).

## 2. Diff completo — `convex/schema.ts`

```diff
--- a/convex/schema.ts
+++ b/convex/schema.ts
@@ -243,7 +243,9 @@
     expiresAt: v.number(),
   })
     .index("by_tokenHash", ["tokenHash"])
-    .index("by_user", ["userId"]),
+    .index("by_user", ["userId"])
+    // MIS-319: la limpieza nocturna va directa a lo caducado (cleanupExpiredSessions).
+    .index("by_expiresAt", ["expiresAt"]),
 
   loginAttempts: defineTable({
     // Email normalizado, o "ip:<ip>" para la capa secundaria — exista o no la
```

Tabla resultante, completa:
```ts
  sessions: defineTable({
    userId: v.id("users"),
    // SHA-256 del token opaco (32 bytes de entropía antes de hashear) — nunca el token en claro.
    tokenHash: v.string(),
    expiresAt: v.number(),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_user", ["userId"])
    // MIS-319: la limpieza nocturna va directa a lo caducado (cleanupExpiredSessions).
    .index("by_expiresAt", ["expiresAt"]),
```

## 3. Diff completo — `convex/auth.ts`

```diff
--- a/convex/auth.ts
+++ b/convex/auth.ts
@@ -432,6 +432,15 @@
   },
 });
 
+// MIS-319: va directa a lo caducado vía el índice `by_expiresAt` (antes leía
+// la tabla entera con .filter()). Borra por lotes acotados: si el lote sale
+// lleno, se re-programa a sí misma, así el coste por transacción queda acotado
+// y un atasco se drena en ejecuciones sucesivas. 1000 deja amplio margen bajo
+// los límites de Convex (16.000 escrituras / 32.000 lecturas por transacción).
+// Cada lote borra solo lo caducado al comenzar ESE lote (`expiresAt < now`,
+// estricto); el número devuelto es lo borrado en este lote, no en la cadena.
+const SESSION_CLEANUP_BATCH = 1000;
+
 export const cleanupExpiredSessions = internalMutation({
   args: {},
   returns: v.number(),
@@ -439,11 +448,14 @@
     const now = Date.now();
     const expired = await ctx.db
       .query("sessions")
-      .filter((q) => q.lt(q.field("expiresAt"), now))
-      .collect();
+      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
+      .take(SESSION_CLEANUP_BATCH);
     for (const session of expired) {
       await ctx.db.delete(session._id);
     }
+    if (expired.length === SESSION_CLEANUP_BATCH) {
+      await ctx.scheduler.runAfter(0, internal.auth.cleanupExpiredSessions, {});
+    }
     return expired.length;
   },
 });
```

Función resultante, completa:
```ts
// MIS-319: va directa a lo caducado vía el índice `by_expiresAt` (antes leía
// la tabla entera con .filter()). Borra por lotes acotados: si el lote sale
// lleno, se re-programa a sí misma, así el coste por transacción queda acotado
// y un atasco se drena en ejecuciones sucesivas. 1000 deja amplio margen bajo
// los límites de Convex (16.000 escrituras / 32.000 lecturas por transacción).
// Cada lote borra solo lo caducado al comenzar ESE lote (`expiresAt < now`,
// estricto); el número devuelto es lo borrado en este lote, no en la cadena.
const SESSION_CLEANUP_BATCH = 1000;

export const cleanupExpiredSessions = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query("sessions")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
      .take(SESSION_CLEANUP_BATCH);
    for (const session of expired) {
      await ctx.db.delete(session._id);
    }
    if (expired.length === SESSION_CLEANUP_BATCH) {
      await ctx.scheduler.runAfter(0, internal.auth.cleanupExpiredSessions, {});
    }
    return expired.length;
  },
});
```

## 4. Fichero nuevo (solo verificación, NO se instala en el árbol del repo): `CODIGO/MIS-319-indice-expiresat-sessions/verify-session-cleanup.mjs`

Prueba funcional en **dev** con más de un lote (C2) y conjunto controlado (S1). Solo usa funciones de test que ya existen en `convex/testSupport.ts`, todas con cerrojo `E2E_TEST_SUPPORT_KEY` + identidad dedicada `reset@test.local`:
- `resetTestIdentity` (mutation): entre otras cosas, borra **todas** las sesiones de la identidad dedicada (`sessions` por `by_user`).
- `testInsertSession` (mutation, args `{ serverKey, email, ttlMs }`, `ttlMs` acotado a [-1 h, 40 días]): inserta una sesión de la identidad dedicada con `expiresAt = Date.now() + ttlMs` y devuelve `{ token }`.
- `countSessionsFor` (query): número de sesiones de la identidad dedicada (`by_user` + `collect`).
- `auth:getSessionUser` (query pública, args `{ token }`): devuelve el usuario si la sesión existe y no ha caducado, o `null`.

La función interna `auth:cleanupExpiredSessions` se invoca con `npx convex run … --deployment dev`, que permite ejecutar funciones internas. El destino se valida antes con el guard de §0 (M1).

Contenido íntegro:
```js
// MIS-319 — verificación funcional en DEV de cleanupExpiredSessions por lotes.
// Uso (desde la raíz del repo, con el código ya desplegado en dev):
//   node CODIGO/MIS-319-indice-expiresat-sessions/verify-session-cleanup.mjs
//
// Condiciones de ejecución (S5): cleanupExpiredSessions opera sobre TODA la
// tabla `sessions`, no solo sobre la identidad de prueba. Durante la prueba no
// debe correr la suite e2e, ni otra limpieza (el cron diario es a las 03:00
// UTC), ni nadie más debe usar la identidad reset@test.local.
//
// Conjunto controlado: SOLO las sesiones de la identidad dedicada del harness
// (reset@test.local), a través de las funciones de test ya existentes en
// convex/testSupport.ts (cerrojos: E2E_TEST_SUPPORT_KEY + identidad dedicada).
// La clave se lee de .env.test.local y nunca se imprime.
//
// Guard de entorno (M1), FAIL-CLOSED: antes de crear el cliente o mutar nada,
// exige evidencia POSITIVA de que el destino es el deployment de dev personal:
//   a) ninguna variable CONVEX_* en el entorno del proceso (p. ej. un
//      CONVEX_DEPLOY_KEY de prod olvidado redirigiría el CLI);
//   b) CONVEX_DEPLOYMENT de .env.local con la forma exacta `dev:<nombre>`;
//   c) NEXT_PUBLIC_CONVEX_URL con la forma https://<nombre>.<…>.convex.cloud;
//   d) el propio Convex, preguntado con `--deployment dev` (su dev personal),
//      devuelve como CONVEX_CLOUD_URL exactamente esa misma URL.
// Todas las llamadas al CLI usan `--deployment dev` explícito.
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const BATCH = 1000; // = SESSION_CLEANUP_BATCH en convex/auth.ts
const EXPIRED = BATCH + 1;
const EMAIL = "reset@test.local";
const POLL_MS = 2000;
const TIMEOUT_MS = 120000;
const CONCURRENCY = 20;

function readEnv(file) {
  const env = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    // Quita el comentario final que escribe el CLI de Convex (`# team: …`).
    env[m[1]] = m[2].replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

function convexCli(args) {
  const res = spawnSync("npx", ["convex", ...args, "--deployment", "dev"], { encoding: "utf8" });
  if (res.status !== 0) throw new Error(`convex ${args[0]} terminó con código ${res.status}: ${res.stderr.trim()}`);
  return res.stdout.trim().split("\n").pop();
}

// ---- Guard de entorno (M1): todo debe probarse; cualquier duda aborta. ----
function assertDevTarget() {
  const inherited = Object.keys(process.env).filter((k) => k.startsWith("CONVEX_"));
  if (inherited.length > 0) throw new Error(`hay variables ${inherited.join(", ")} en el entorno; ejecútalo sin ellas`);

  const local = readEnv(".env.local");
  const dep = /^dev:([a-z0-9]+(?:-[a-z0-9]+)+)$/.exec(local.CONVEX_DEPLOYMENT ?? "");
  if (!dep) throw new Error("CONVEX_DEPLOYMENT de .env.local no tiene la forma `dev:<nombre>`");
  const name = dep[1];

  const url = local.NEXT_PUBLIC_CONVEX_URL ?? "";
  let host;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") throw new Error();
    host = parsed.hostname;
  } catch {
    throw new Error("NEXT_PUBLIC_CONVEX_URL falta o no es una URL https válida");
  }
  if (host.split(".")[0] !== name || !host.endsWith(".convex.cloud")) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL no corresponde al deployment de dev de CONVEX_DEPLOYMENT");
  }

  const raw = convexCli(["run", "--inline-query", "return process.env.CONVEX_CLOUD_URL"]);
  let devUrl;
  try {
    devUrl = JSON.parse(raw);
  } catch {
    devUrl = raw;
  }
  if (devUrl !== url) throw new Error("Convex no confirma que NEXT_PUBLIC_CONVEX_URL sea el deployment de dev personal");

  return url;
}

async function main() {
  const url = assertDevTarget();
  console.log("0. destino confirmado: deployment de dev personal ✓");

  const serverKey = readEnv(".env.test.local").E2E_TEST_SUPPORT_KEY;
  if (!serverKey) throw new Error("falta E2E_TEST_SUPPORT_KEY en .env.test.local");

  const client = new ConvexHttpClient(url);
  const api = anyApi;
  const count = () => client.query(api.testSupport.countSessionsFor, { serverKey, email: EMAIL });
  const insert = (ttlMs) => client.mutation(api.testSupport.testInsertSession, { serverKey, email: EMAIL, ttlMs });
  const reset = () => client.mutation(api.testSupport.resetTestIdentity, { serverKey, email: EMAIL });

  async function pool(n, worker) {
    let next = 0;
    const run = async () => {
      while (next < n) {
        next++;
        await worker();
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, run));
  }

  // S4: a partir de aquí se muta; la limpieza final va en `finally` para que
  // ningún fallo deje sesiones de prueba. Si la limpieza también falla, se
  // informa, pero se conserva y propaga el error ORIGINAL.
  let original;
  try {
    // 1. Estado inicial controlado.
    await reset();
    const initial = await count();
    if (initial !== 0) throw new Error(`estado inicial no es 0 (es ${initial})`);
    console.log("1. estado inicial: 0 sesiones de la identidad dedicada ✓");

    // 2. Siembra: BATCH + 1 caducadas + 1 vigente.
    await pool(EXPIRED, () => insert(-60000));
    const { token: liveToken } = await insert(3600000);
    const seeded = await count();
    if (seeded !== EXPIRED + 1) throw new Error(`tras la siembra se esperaban ${EXPIRED + 1}, hay ${seeded}`);
    console.log(`2. sembradas ${EXPIRED} caducadas + 1 vigente = ${seeded} ✓`);

    // 3. Una única limpieza inicial (función interna → CLI contra dev).
    const firstBatch = Number(convexCli(["run", "auth:cleanupExpiredSessions"]));
    if (firstBatch !== BATCH) throw new Error(`el primer lote debía devolver ${BATCH} (lote lleno), devolvió ${firstBatch}`);
    console.log(`3. primera llamada devolvió ${firstBatch} (borradas en ESTE lote, no el total) ✓`);

    // 4. Espera acotada a que la continuación re-programada drene el resto.
    const deadline = Date.now() + TIMEOUT_MS;
    let remaining = await count();
    while (remaining !== 1 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      remaining = await count();
    }
    if (remaining !== 1) {
      throw new Error(`tras ${TIMEOUT_MS / 1000}s quedan ${remaining} sesiones (se esperaba 1): la continuación no drenó`);
    }
    console.log("4. la continuación se ejecutó: queda 1 sesión ✓");

    // 5. La superviviente es exactamente la vigente.
    const user = await client.query(api.auth.getSessionUser, { token: liveToken });
    if (!user) throw new Error("la sesión vigente ya no resuelve: se borró algo que no estaba caducado");
    console.log("5. la superviviente es la vigente (getSessionUser ≠ null) ✓");
  } catch (err) {
    original = err;
  } finally {
    // 6. Limpieza (siempre).
    try {
      await reset();
      const final = await count();
      if (final !== 0) throw new Error(`la limpieza final dejó ${final} sesiones`);
      console.log("6. limpieza final: 0 sesiones ✓");
    } catch (cleanupErr) {
      console.error(`AVISO: la limpieza final falló: ${cleanupErr.message}`);
      if (!original) original = cleanupErr;
    }
  }
  if (original) throw original;
  console.log("OK — MIS-319 verificado en dev");
}

main().catch((err) => {
  console.error(`FALLO: ${err.message}`);
  process.exit(1);
});
```

## 5. Verificación ya realizada (en un worktree desechable con los snapshots de esta carpeta, sin tocar el árbol del repo)

- `npx tsc --noEmit` en la raíz (el `tsconfig.json` incluye `**/*.ts`, `convex/` incluido): **0 errores**.
- `npx eslint convex/auth.ts convex/schema.ts`: **0 errores, 0 warnings**.
- `node --check verify-session-cleanup.mjs`: sintaxis correcta (también tras las correcciones de la ronda 1).
- Guard de entorno: 1 caso positivo y 4 negativos, tabla en §0.

## 6. Gates tras el GO del código (Fase 5/6) — resultados (2026-10-05)

| # | Gate | Resultado |
|---|---|---|
| 1 | Instalación byte a byte (`cmp`) de `convex/schema.ts` y `convex/auth.ts` | ✅ idénticos |
| 2 | `npx tsc --noEmit` / `npm run lint` / `npm run build` en el árbol real | ✅ 0 errores / 0 errores (1 warning previo `no-img-element` en un fichero no tocado) / build OK |
| 3 | `npx convex dev --once` (dev) | ✅ `Added table indexes: [+] sessions.by_expiresAt   expiresAt, _creationTime` |
| 4 | `verify-session-cleanup.mjs` en dev | ✅ 0 destino dev confirmado · 1 inicio 0 · 2 sembradas 1001 + 1 = 1002 · 3 primera llamada = 1000 · 4 continuación drenó, queda 1 · 5 superviviente = vigente · 6 limpieza a 0 · `OK` (1 min 40 s) |
| 5 | `npm run test:e2e` (local) | ⚠️ No concluyente en local. **Corrida 1:** 77 ✓ · 21 ✘ · 1 skip. 20 de los fallos son `ERR_CONNECTION_REFUSED`: el OOM killer del kernel mató `next-server` a las 17:22 (`Out of memory: Killed process … (next-server …)`; máquina de 5,7 GiB con LibreOffice abierto). **Re-ejecución de los fallidos:** 18 ✓ · 5 ✘. Uno es el conocido `team-admin.spec.ts:84` ("último admin" espera 1 supervisora y en dev hay 2 desde el 2026-09-11). Los otros 4 (`edge-cases` :177, :368, :515 y `full-flow` :11) son la misma familia de esperas de diálogo/listado ya documentada en `PLANS/INFORME-E2E-LOCAL-2026-09-11.md`. Ninguno toca `cleanupExpiredSessions` (que solo invoca el cron), ni las sesiones vigentes (los logins de `auth.setup` funcionan). **Gate de autoridad: el job e2e del CI de la PR.** |
| 6 | Deploy Convex prod + cron sin error | ⏳ tras el merge, con confirmación |

Detalle del plan original de verificación:

1. Instalación byte a byte (`cmp`) de `convex/schema.ts` y `convex/auth.ts` desde esta carpeta.
2. `npm run lint`, `npm run build` y `npx tsc --noEmit` en el árbol real.
3. `npx convex dev --once` contra **dev**: esquema aceptado e índice creado.
4. `node CODIGO/MIS-319-indice-expiresat-sessions/verify-session-cleanup.mjs` (sin e2e, otra limpieza ni otro uso de `reset@test.local` en paralelo; sin variables `CONVEX_*` en la shell). Criterios: inicio en 0 → 1002 sembradas → primera llamada = 1000 → en ≤ 120 s queda 1 → esa 1 es la vigente → limpieza a 0.
5. `npm run test:e2e` (en esta máquina un fallo en local no es concluyente si el RTT es alto; manda el CI de la PR).
6. Tras el merge, deploy de Convex **prod** con confirmación (técnica deploy-token) y comprobación de que el cron de las 03:00 UTC (o un `run` manual confirmado) termina sin error.

## 7. Rollback (C3)

1. Revertir **solo** `convex/auth.ts` (volver a `.filter()` + `.collect()`) y desplegar Convex prod. El índice **se conserva**: es aditivo y el código anterior no lo usa.
2. Opcionalmente, en un deploy posterior, quitar el índice cuando ya no haya código que lo use.

## 8. Fuera de alcance (aceptado por la auditoría como deuda)

Índices de `saleClosures`, unicidad de email en `users`, optimización de `cleanupExpiredResetCodes` y automatización del deploy de Convex (MIS-308).

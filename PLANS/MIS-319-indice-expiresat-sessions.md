# Plan — MIS-319: Índice `by_expiresAt` en `sessions` para la limpieza de sesiones caducadas

## Context

La revisión del esquema del 2026-08-24 encontró un problema en el cron nocturno `cleanupExpiredSessions` (`convex/auth.ts:435-449`). Para encontrar las sesiones caducadas usa `.filter()` sin índice, así que **lee la tabla `sessions` entera** en cada ejecución. `sessions` es la única tabla que crece con cada inicio de sesión. Si algún día supera el tope de lecturas por transacción de Convex, el cron empezaría a fallar, dejaría de limpiar y el problema iría a más él solo. Hoy el riesgo es lejano (en dev hay unas 16 filas), pero el arreglo es pequeño y sigue el patrón que ya usan el resto de tablas.

Resultado esperado: la limpieza va directa a lo caducado a través de un índice, con un coste proporcional a lo que hay que borrar y no al tamaño de la tabla. El usuario no nota ningún cambio.

## Estado actual (anclas verificadas)

- `convex/schema.ts:239-246`: tabla `sessions` con `{ userId, tokenHash, expiresAt: v.number() }`. Índices `by_tokenHash` y `by_user`. **No tiene índice por `expiresAt`.**
- `convex/auth.ts:435-449`:
  ```ts
  export const cleanupExpiredSessions = internalMutation({
    args: {},
    returns: v.number(),
    handler: async (ctx) => {
      const now = Date.now();
      const expired = await ctx.db
        .query("sessions")
        .filter((q) => q.lt(q.field("expiresAt"), now))
        .collect();
      for (const session of expired) {
        await ctx.db.delete(session._id);
      }
      return expired.length;
    },
  });
  ```
- `convex/crons.ts:6-10`: `crons.daily("cleanup expired sessions", { hourUTC: 3, minuteUTC: 0 }, internal.auth.cleanupExpiredSessions)`.
- `convex/auth.ts:4` ya importa `internal`, y el patrón `ctx.scheduler.runAfter(0, internal.…)` ya existe en `convex/passwordReset.ts:99,325`.
- Ningún otro sitio de `src/` ni de `e2e/` llama a `cleanupExpiredSessions`. Las referencias en `CODIGO/MIS-*/` son snapshots históricos y no se tocan.
- La validez de una sesión **no depende** del cron: `convex/lib/authz.ts:31` rechaza `expiresAt < Date.now()` al leer. El cron es solo higiene, no seguridad.

## Cambios

### 1. `convex/schema.ts`: añadir el índice
```ts
    .index("by_tokenHash", ["tokenHash"])
    .index("by_user", ["userId"])
    .index("by_expiresAt", ["expiresAt"]),
```
(más un comentario de una línea con la referencia MIS-319, al estilo del fichero)

### 2. `convex/auth.ts`: reescribir `cleanupExpiredSessions` con el índice y por lotes acotados
```ts
// MIS-319: va directa a lo caducado vía el índice `by_expiresAt` (antes leía
// la tabla entera con .filter()). Además borra por lotes acotados: si el lote
// sale lleno, se re-programa a sí misma, para que ni las lecturas ni las
// escrituras de una sola transacción crezcan sin techo aunque se acumule un
// atasco de sesiones caducadas.
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
**Por qué lotes, que el ticket no pide:** solo con el índice desaparece la lectura de toda la tabla. Pero si se acumularan más caducadas que el tope de **escrituras** por transacción, el `.collect()` + `delete` seguiría fallando por el mismo motivo que el ticket quiere evitar. Con `take(N)` y la re-programación, **el coste por transacción queda acotado y un atasco puede drenarse mediante ejecuciones sucesivas** (S2). Son solo 3 líneas extra.

**Semántica (S3):** cada lote calcula su propio `Date.now()` y borra **únicamente las sesiones caducadas al comenzar ese lote** (`expiresAt < now`, estricto como antes: `expiresAt === now` no se borra). Una cadena de varios lotes puede, por tanto, borrar en una continuación sesiones que caducaron después de que empezara el primer lote. Es compatible con el objetivo, que es higiene. `returns: v.number()` pasa a significar **"borradas en este lote"**, no el total drenado por la cadena (nadie consume el valor; el cron lo ignora).

**Tamaño del lote (C1):** límites oficiales de Convex por transacción de mutation, consultados el 2026-10-05 en https://docs.convex.dev/production/state/limits:

| Límite | Valor oficial | Uso de un lote de 1000 | Margen |
|---|---|---|---|
| Documentos escritos | 16.000 | 1.000 deletes | ~6 % del tope |
| Documentos escaneados | 32.000 | ≤ 1.000 (rango de índice, sin filtro) | ~3 % |
| Datos escritos / leídos | 16 MiB / 16 MiB | 1.000 filas × ~150 B (`userId` + hash hex de 64 + número) ≈ 150 KiB | ~1 % |
| Rangos de índice leídos | 4.096 | 1 (`withIndex`) | — |
| Funciones programadas | 1.000 | ≤ 1 (`runAfter`) | — |
| Tiempo de código de usuario | 1 s (excluye operaciones de BD) | bucle trivial de 1.000 iteraciones | amplio |

`SESSION_CLEANUP_BATCH = 1000` queda muy por debajo de todos los topes, así que se mantiene.

`crons.ts` no cambia.

## Consecuencias asumidas

- Al desplegar, Convex construye el índice nuevo sobre las filas existentes. Con este volumen es instantáneo y no hace falta migración de datos.
- Es un cambio de esquema en `convex/`, así que **requiere deploy manual de Convex a prod** (Fase 9). Railway no lo hace solo.

## Ficheros afectados

- `convex/schema.ts`: 1 índice.
- `convex/auth.ts`: la función `cleanupExpiredSessions` y una constante.
- (Generado: `convex/_generated/*` no cambia, porque no hay funciones nuevas.)

## No-objetivos (radar del ticket, NO en este PR)

- Índice para `saleClosures` (`getWonSalesSummary` / `listWonSalesForPeriod`).
- Unicidad de email en `users` a nivel de BD.
- `cleanupExpiredResetCodes` (`convex/passwordReset.ts:372`) también hace un `collect()` completo, pero esa tabla está acotada por el tope diario de emails. Si la auditoría lo pide, se abre un follow-up en Backlog/Low.
- Automatizar el deploy de Convex (MIS-308).

## Verificación

1. `npx tsc --noEmit` (incluye `convex/`), `npm run lint` y `npm run build` en verde.
2. `npx convex dev --once` contra **dev**: el esquema se acepta y el índice se crea.
3. **Prueba funcional del cron en dev, con más de un lote (C2) y conjunto controlado (S1).** Sin tocar prod. La ejecuta el script `CODIGO/MIS-319-indice-expiresat-sessions/verify-session-cleanup.mjs`, cuyo contenido íntegro va en el `codigo-completo.md`. Solo usa funciones de test que ya existen en `convex/testSupport.ts` y que están protegidas por `E2E_TEST_SUPPORT_KEY` y por la identidad dedicada `reset@test.local`: `resetTestIdentity`, `testInsertSession` y `countSessionsFor`. La clave se lee de `.env.test.local` y nunca se imprime.
   - **Estado inicial controlado:** `resetTestIdentity` borra todas las sesiones de la identidad dedicada. Se exige que `countSessionsFor` sea **0**; si no, el script aborta. Nadie más usa esa identidad, y el script no se ejecuta a la vez que la suite e2e.
   - **Siembra:** `SESSION_CLEANUP_BATCH + 1 = 1001` sesiones caducadas (`ttlMs: -60000`) y **1 vigente** (`ttlMs: 3600000`). Se exige `countSessionsFor = 1002`.
   - **Una única limpieza inicial:** `npx convex run auth:cleanupExpiredSessions`. Debe devolver **exactamente 1000**: es lo borrado en ese lote, no el total de la cadena. Como hay al menos 1001 caducadas, el primer lote sale lleno y tiene que re-programarse. Puede que haya caducadas de otras cuentas en dev; esto no cambia el resultado, porque el lote se llena igual.
   - **Espera determinista y acotada:** se consulta `countSessionsFor` cada 2 s, con un máximo de 120 s, hasta que vale **1**. Pasar de 1002 a 1 exige que la continuación se haya ejecutado, porque el primer lote borra como mucho 1000. Si se agota el tiempo, la prueba falla.
   - **Identificación inequívoca (S1):** sobre el conjunto controlado (solo las sesiones de la identidad dedicada), `count = 1` más `auth:getSessionUser(tokenVigente) ≠ null` demuestran que **la superviviente es justo la vigente** y que **las 1001 caducadas han desaparecido**.
   - **Limpieza:** `resetTestIdentity` de nuevo, y se exige que `countSessionsFor` vuelva a 0.
4. `npm run test:e2e` completo. Ojo: en esta máquina, un fallo en local no es concluyente si el RTT es alto (ver el informe del 2026-09-11). Manda el CI de la PR.
5. Tras el deploy a prod (con confirmación): `npx convex function-spec`/dashboard muestra el índice, y el siguiente cron de las 03:00 UTC (o un `run` manual confirmado) termina sin error en los logs.

## Deploy (Fase 9)

Con permiso explícito: técnica del deploy-token de `PLANS/RUNBOOK-DESPLIEGUE-CONVEX-PROD.md` (`deployment token create --prod` → `CONVEX_DEPLOY_KEY` → `npx convex deploy` → borrar el token). Se hace justo después del merge para que el código de prod y el de `main` no se desalineen.

## Rollback (C3)

El fallo del cron **no afecta a la autenticación**: la validez de una sesión se comprueba al leer (`convex/lib/authz.ts:31`). En el peor caso, las filas caducadas se acumulan sin efecto funcional hasta que se corrija. No hay prisa operativa.

Orden seguro, si la limpieza falla después del deploy (se ve en los logs del cron en el dashboard de Convex prod):
1. **Revertir solo `convex/auth.ts`** a la versión anterior (el `.filter()` + `.collect()`), con un PR de revert, y desplegar Convex prod (deploy-token, con confirmación). **El índice `by_expiresAt` se conserva:** es aditivo y el código anterior no lo usa, así que mantenerlo no tiene riesgo.
2. **Opcionalmente, y en un deploy posterior,** quitar el índice de `convex/schema.ts`, cuando ya no haya código desplegado que lo use. Si se quitara el índice mientras el código que lo usa sigue vivo, `withIndex("by_expiresAt")` fallaría al ejecutarse. El typecheck que `npx convex deploy` hace por defecto lo detecta antes, porque el tipo del esquema ya no tendría ese índice. Aun así, no conviene depender de esa red: el orden seguro es primero el código y después el índice.

## Auditoría del plan — ronda 1 (2026-10-05): GO CONDICIONADO

Condiciones incorporadas:
- **C1** (tamaño del lote): tabla de límites oficiales en "Cambios"; 1000 se mantiene con margen.
- **C2** (prueba de varios lotes): punto 3 de "Verificación", con 1001 caducadas + 1 vigente, una sola limpieza inicial que devuelve 1000 y una espera acotada a que la continuación termine.
- **C3** (rollback): sección "Rollback".
- **S1** (prueba determinista): conjunto controlado de la identidad dedicada (inicio en 0) + `getSessionUser` del token vigente.
- **S2** (redacción): "coste por transacción acotado y atasco drenable por ejecuciones sucesivas".
- **S3** (semántica temporal): "cada lote borra únicamente las sesiones caducadas al comenzar ese lote".

## Metodología / Gate

- Ronda 1 de auditoría del plan: **GO CONDICIONADO**, con las condiciones incorporadas arriba. El **código** sigue pendiente de su propia auditoría (Fase 4).
- Linear: MIS-319 se pasa a **In Progress** al volcar el plan. Ya existe, no se crea ticket nuevo.
- Solo después de un GO (o un GO condicionado): rama `mis-319-indice-expiresat-sessions` desde `main`, código en `CODIGO/MIS-319-indice-expiresat-sessions/` con `MIS-319-codigo-completo.md` **autocontenido** (diffs completos literales de `schema.ts` y `auth.ts`), auditoría del código, instalación byte a byte, PR (pidiendo permiso antes del push), CI en verde, merge, deploy de Convex prod (con confirmación), verificación y cierre en Linear.
- `CODIGO/MIS-319-…/` no se borra nunca.

# MIS-289 — Plan Fase 1A-bis: retirar `auth.login` y cerrar I3

> **Ticket:** MIS-289 (Urgent, In Progress) — "Seguridad login · Fase 1A-bis — Retirar auth.login (cierra I3)"
> **Plan maestro:** `PLANS/PLAN-CORRECCION-SEGURIDAD-LOGIN-2026-08-10.md` (sección 1A.5, GO ronda 6)
> **Informe:** `PLANS/AUDITORIA-SEGURIDAD-LOGIN-2026-08-10.md`
> **Depende de:** MIS-288 (desplegado y verificado en prod 2026-08-12) — este ticket es el **contract** de aquel *expand*.
> **Estado del código:** este documento es solo el PLAN. Nada de código, rama ni despliegue hasta GO de auditoría.

---

## 1. Qué cierra este ticket, y por qué es la pieza que faltaba

MIS-288 cerró I1 (origen autenticado) e I2 (fail-closed), y **migró** el frontend a `auth.loginWithPassword` (action con `serverKey` obligatorio). Pero, para no tirar el flujo durante el despliegue, dejó **dos puertas legacy abiertas a propósito** (patrón expand/contract, opción A aprobada por el usuario):

1. La mutation pública `auth.login` sigue publicada — invocable **directamente contra Convex sin `serverKey`**, con `ipHint` falseable y PBKDF2 a demanda. Mientras exista, **A1 y A3 siguen abiertos por esa puerta**, aunque `loginWithPassword` esté perfectamente cerrada.
2. Las tres funciones de recuperación (`requestPasswordResetCode`, `verifyResetCode`, `resetPasswordWithTicket`) aceptan `serverKey` **opcional** (validado-solo-si-viene). Una llamada directa que **omita** `serverKey` recorre el camino legacy sin comprobación de origen.

**I3 ("Convex cerrado: toda función de auth rechaza llamadas sin `serverKey` válido antes de cualquier efecto lateral") NO está cumplida hasta cerrar esas dos puertas.** Eso es exactamente el alcance de MIS-289.

## 2. Precondición ya satisfecha (esto es lo que hace el cambio seguro)

El *expand* está **100% vivo en producción** desde MIS-288:

- El frontend (`src/lib/auth/actions.ts`) ya envía `serverKey: authServerKey()` en **las cuatro** llamadas: `loginWithPassword` (:32), `requestPasswordResetCode` (:74), `verifyResetCode` (:92), `resetPasswordWithTicket` (:122).
- `src/` **no referencia `auth.login`** en ningún punto (usa `loginWithPassword`). Verificado por grep.

**Consecuencia:** hacer `serverKey` obligatorio y borrar `auth.login` **no puede romper el flujo real** — el cliente de producción ya cumple el contrato nuevo. No hay ventana de incompatibilidad y no hay orden de despliegue crítico frente al frontend (a diferencia de MIS-288). El único despliegue funcionalmente necesario es **Convex a producción**.

## 3. Cambios de código

### 3.1 `convex/auth.ts` — borrar la mutation pública `login`

- Eliminar **solo** el `export const login = mutation({...})` (hoy líneas ~102–110).
- **Conservar** `performLogin` (helper) y `_loginCore` (internalMutation): los sigue usando la action `loginWithPassword`. `performLogin` deja de tener a `login` como llamante pero sigue vivo vía `_loginCore` — no queda código muerto.
- No tocar `loginWithGoogle`, `logout`, `getSessionUser`.

**Riesgo de tipo:** al desaparecer `api.auth.login` de la API generada, cualquier referencia rompe la compilación. Verificado que **no existe ninguna referencia a `api.auth.login`** ni en `src/` ni en `e2e/` (la migración de §3.3 son las 15 llamadas de recuperación sin `serverKey`, no llamadas a `login`; y la prueba 7b invoca `auth:login` por referencia dinámica por nombre, no por la API generada). El `build`/typecheck lo confirma.

### 3.2 `convex/passwordReset.ts` — `serverKey` obligatorio (contract)

En las **tres** funciones (`requestPasswordResetCode` ~:46, `verifyResetCode` ~:164, `resetPasswordWithTicket` ~:249):

- `serverKey: v.optional(v.string())` → **`serverKey: v.string()`**.
- El guard legacy `if (args.serverKey !== undefined && !serverKeyMatches(...))` → **`if (!serverKeyMatches(args.serverKey, AUTH_SERVER_KEY_ENV_VAR))`** como **primera sentencia** del handler (antes de tocar rate limit, construir claves o consultar estado — misma disciplina anti-enumeración que ya sigue el módulo).
- La respuesta a `serverKey` inválido no cambia: el **mismo genérico** que hoy (`{ok:true}` en request; genérico en verify/reset), indistinguible de un fallo normal.
- Retirar los comentarios "expand/contract: opcional en 1A" que quedan obsoletos; sustituir por una línea que diga que el origen se garantiza por `serverKey` obligatorio (I3 cerrada).

### 3.3 `e2e/` — migrar los call sites y el test de retirada

**a) 15 llamadas legacy** en `e2e/password-reset-invariants.spec.ts` que hoy llaman a las tres funciones de recuperación **sin** `serverKey` (líneas aprox. 40, 77, 91, 101, 116, 128, 135, 141, 157, 165, 181, 195, 209, 224, 231): añadir `serverKey: authServerKey()`. Cambio mecánico. `authServerKey()` ya está exportado en `e2e/helpers/test-support.ts` (MIS-288).

**b) Tests I3 existentes** (rechazo con `BAD_KEY`) siguen válidos sin cambios: pasan un `serverKey` string incorrecto, que type-checkea y devuelve el genérico igual con el validador obligatorio.

**c) Prueba 7b (nueva) — la retirada de `auth.login`:** un test que confirme que `auth:login` ya **no existe** como función (falla por *función no encontrada*, **no** por argumento inválido — la distinción es la prueba de que se borró, no de que se le pasó mal los args), mientras `loginWithPassword` sigue respondiendo.
- **No puede** referenciar `api.auth.login` (no compilaría tras el borrado). Usar **referencia dinámica por nombre**: `makeFunctionReference<"mutation">("auth:login")` de `convex/server`, y afirmar que la llamada rechaza con error de tipo "función no encontrada" (p. ej. `CouldNotFindFunction`/mensaje equivalente), distinguiéndolo explícitamente de `ArgumentValidationError`.
- Control positivo en el mismo test: `loginWithPassword` con `serverKey` válido sigue devolviendo un resultado (no "función no encontrada").

**Hueco reconocido:** la prueba 7b se ejercita de verdad **contra el deployment donde ya se retiró** la función. En CI corre contra el Convex de **dev**; hay que desplegar dev antes de que CI la vea verde (igual que en MIS-288 se sincronizó dev). Se documenta en el paso de despliegue.

### 3.4 Documentación / entregable

- `CODIGO/MIS-289-.../CODIGO-COMPLETO.md` con narrativa + código para auditar (fase de código, tras GO del plan).
- No hay cambios de env vars ni de infraestructura (Railway/Cloudflare/Google intactos).

## 4. Qué NO entra (límites explícitos)

- No se toca el perímetro (`src/proxy.ts`), ni cabeceras, ni rate limits (eso fue MIS-288 / es 1B).
- No se toca el frontend (`actions.ts`): ya envía `serverKey`. Cero cambios en `src/`.
- No se reequilibran umbrales ni se mueve `emailWithinLimits` (eso es Fase 2 / MIS-290+).

## 5. Orden de despliegue (1A-bis.9)

Sin downtime y sin dependencia de orden frente al frontend (el frontend ya cumple el contrato en prod). Secuencia:

1. **Deploy a Convex dev** (`dutiful-mole-111`) primero, para que la suite e2e/CI vea la función retirada y `serverKey` obligatorio → CI verde real.
2. Merge del PR (CI en verde).
3. **Deploy a Convex prod** (`greedy-tapir-20`) con la técnica del deploy-token. **Registrar hora exacta e ID de despliegue** (criterio de cierre).
4. Railway hará un rebuild del frontend al mergear; es **inocuo** (frontend sin cambios funcionales). No requiere provisión previa.

**Momento de cierre de I3:** en el instante en que el deploy de Convex prod (paso 3) se promociona. A partir de ahí, `auth:login` no existe y las tres funciones de recuperación exigen `serverKey`.

## 6. Verificación

### 6.1 Automática (CI, contra dev ya desplegado)

```
npm run lint
npm run build                 # incluye typecheck; falla si algo referencia api.auth.login
npm run test:e2e              # 15 call sites migrados + prueba 7b + tests I3 existentes
npm run test:e2e:secret-gate
```

### 6.2 Manual contra producción, tras el deploy de Convex prod

1. **Prueba 7b en prod (cierre de A1/A3 por la puerta vieja):** llamar por nombre dinámico a `auth:login` contra `NEXT_PUBLIC_CONVEX_URL` de prod con credenciales válidas → debe fallar por **función no encontrada**, no devolver token. Si devuelve token, I3 no está cerrada.
2. **Recuperación sin `serverKey`:** llamar directo a `requestPasswordResetCode`/`verifyResetCode`/`resetPasswordWithTicket` **omitiendo** `serverKey` → error de **argumento requerido** (validador), no ejecución. Con `serverKey` inválido → genérico. La puerta legacy está cerrada.
3. **Flujo real intacto:** login por contraseña + recuperación completa por email (cuenta real) siguen funcionando de punta a punta — prueba de que el contract no rompió nada.

## 7. Criterio de "hecho" (del ticket)

- PR mergeado y enlazado.
- **Convex desplegado a producción** (condición de cierre; se ha olvidado 4 veces históricamente).
- Prueba 7b pasada.
- Nota de cierre en Linear con **hora exacta de la retirada e identificador del despliegue** de Convex prod.
- **I3 cumplida** — declarado explícitamente en el cierre.

## 8. Riesgos y mitigación

| Riesgo | Mitigación |
|---|---|
| Alguna referencia oculta a `api.auth.login` rompe el build | `npm run build` (typecheck) lo caza antes de mergear; grep previo confirma que solo estaba en `e2e/` |
| CI rojo porque dev aún tiene la función vieja | Desplegar dev **antes** de mergear (paso 1) |
| La prueba 7b afirma sobre el string de error y Convex cambia el mensaje | Afirmar sobre el **tipo/clase** de error de "función no encontrada" y su distinción de `ArgumentValidationError`, no sobre texto exacto |
| Olvido del deploy de Convex prod (patrón recurrente) | Es criterio de cierre y va con hora + ID registrados; técnica de deploy-token documentada |

---

**Resumen para auditoría:** cambio pequeño, quirúrgico y de bajo riesgo cuya seguridad se apoya en que el *expand* de MIS-288 ya está 100% vivo en producción. Borra una función, endurece tres firmas de opcional a obligatorio, migra 15 call sites de test y añade una prueba de retirada. Cierra I3 y tapa la puerta trasera que mantenía A1/A3 técnicamente abiertos.

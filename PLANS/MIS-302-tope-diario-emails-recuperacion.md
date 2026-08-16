# MIS-302 · B10 — Tope diario de emails de recuperación de contraseña por cuenta

> Dividido de MIS-293 (Fase 3 — Higiene). Plan de récord, **ronda 2** (tras auditoría de plan NO-GO por
> M1/M2). **NO autoriza instalar/mergear/desplegar** — ver "Gate". Alcance elegido por el usuario:
> **B (tope 10/día + helper de test mínimo)**.
>
> **CORRECCIÓN post auditoría de código (ronda 1 · M1):** el mecanismo real de `recordFailedAttempt` es
> una **ventana ANCLADA** en `windowStartedAt` con candado deslizante al llegar al máximo, **no una
> ventana móvil** (el término "móvil" de este plan era inexacto; aparece abajo tal cual se redactó, pero
> el contrato correcto es el anclado). El usuario eligió **mantener el mecanismo anclado (Opción A)**:
> consistente con las otras 3 capas del limitador, cero superficie nueva. Caveat aceptado: pico
> transitorio ~2×10 en un intervalo de 24 h que cruce la frontera; sostenido ~9/día. La descripción
> autoritativa está en `CODIGO/MIS-302-tope-diario-emails/MIS-302-tope-diario-emails-codigo-completo.md`
> §1/§5.2.
>
> **Correcciones ronda 2 (§8 de la auditoría):**
> 1. **M1** — la cuota diaria (`resetday`) solo se consume cuando `upstreamAllowed` (burst e IP
>    permiten la solicitud); las suprimidas por burst/IP **no** cuentan. Así "10 emails/día" no degenera
>    en "10 peticiones/día". Se usa `upstreamAllowed` (no `allowed`) para preservar el candado
>    deslizante diario.
> 2. **M2** — nuevo **test de interacción** que demuestra que las solicitudes suprimidas por burst no
>    consumen cuota diaria (caza el bug de M1), + aserciones explícitas `maxAttempts===10` y
>    `windowMs===24 h`.
> 3. **Media** — `isLocked` sin cortocircuito (lecturas uniformes); `try/finally` con
>    `resetTestIdentity()` en los tests; "día" = **ventana móvil de 24 h** en toda la redacción.

## Contexto

El flujo de recuperación (`convex/passwordReset.ts::requestPasswordResetCode`) ya tiene tres capas
de rate-limit (`convex/lib/rateLimit.ts`), todas sobre la tabla `loginAttempts` vía
`recordFailedAttempt`/`isLocked`:

- **`RESET_REQUEST_LIMIT`** — 5 solicitudes / 15 min, con bloqueo de 15 min. Clave `reset:<email>`.
  Acota **ráfagas cortas**.
- **`RESET_CODE_LIMIT`** — 5 intentos de código / 15 min. Clave `resetcode:<email>` (verificación, no
  envío). Fuera de alcance de B10.
- **`RESET_IP_LIMIT`** — 10 / 15 min por IP. Clave `resetip:<ip>`.

**Hueco que cierra B10:** ninguna capa pone un **techo por cuenta y día** al número de correos de
recuperación **efectivamente enviados**. Un atacante que espere a que expire cada bloqueo de 15 min
puede disparar del orden de 5 emails cada ~15–30 min a un mismo buzón durante horas (mail-bombing /
coste de Resend). B10 añade una **cuarta capa**: un tope diario por cuenta.

**Propiedad crítica que NO se puede romper:** `requestPasswordResetCode` es anti-enumeración **por
respuesta y por tiempo** — nunca consulta `users` ni espera a Resend; solo rate-limita y programa el
envío diferido, devolviendo **siempre** `{ok:true}`. La nueva capa debe conservar esto: su clave se
deriva **solo del email normalizado** (jamás toca `users`), se registra **siempre** (exista o no la
cuenta) y, al toparse, **suprime el envío pero sigue respondiendo `{ok:true}`** — exactamente como ya
hace el bloqueo de 15 min.

## Diseño

### Convex

#### 1. `convex/lib/rateLimit.ts` — nueva config `RESET_DAILY_LIMIT`
Espejo exacto de `RESET_REQUEST_LIMIT` (misma mecánica `recordFailedAttempt`/`isLocked` ya auditada),
cambiando solo ventana (24 h) y máximo (10). `lock:true` para que participe en el gate `allowed` vía
`isLocked` (una config `lock:false` nunca fija `lockedUntil`, así que `isLocked` jamás la vería).
Se añade tras `RESET_IP_LIMIT`:

```ts
// MIS-302 (B10): tope DIARIO de emails de recuperación por cuenta (anti-abuso /
// anti-coste). Capa DISTINTA del burst de 15 min (RESET_REQUEST_LIMIT): aquella
// acota ráfagas; ésta pone un techo por cuenta y día que no se sortea esperando
// a que expire cada bloqueo de 15 min. Misma mecánica sobre `loginAttempts`,
// solo cambian ventana (24 h) y máximo. lock:true para participar en el gate
// `allowed` vía isLocked. Clave `resetday:<email>`.
export const RESET_DAILY_LIMIT: RateLimitConfig = {
  maxAttempts: 10,
  windowMs: 24 * 60 * MIN,
  lock: true,
  lockDurationMs: 24 * 60 * MIN,
};
```
(`MIN = 60 * 1000`, ya definido en el módulo → `24 * 60 * MIN = 86 400 000 ms = 24 h`.)

**Valor 10/día:** generoso para uso legítimo (nadie pide >10 recuperaciones/día) y suficiente para
cerrar el abuso/coste. Las dos capas quedan vivas y con sentido: 5/15min = ráfaga, 10/día = techo.

#### 2. `convex/passwordReset.ts::requestPasswordResetCode` — enhebrar la capa diaria
Importar `RESET_DAILY_LIMIT` del módulo de rate-limit y añadir la clave diaria al gate y al registro.

**Corrección M1 (auditoría ronda 1):** la cuota diaria solo puede consumirla una solicitud que
**habría podido producir una entrega** si el tope diario no existiera — es decir, una solicitud NO
vetada por el burst (`reset:<email>`) ni por la IP (`resetip:<ip>`). Contar TODAS las solicitudes
(incluidas las ya suprimidas por burst/IP) convertiría "10 emails/día" en "10 peticiones/día" y
regalaría una forma barata de estirar un bloqueo de 15 min a 24 h. Por eso el registro de `resetday`
se condiciona a `upstreamAllowed`, **no** a `allowed` (usar `upstreamAllowed` conserva el candado
deslizante diario: una solicitud vetada SOLO por el propio tope diario sigue extendiéndolo, pero una
suprimida por burst/IP no consume cuota diaria).

Además, los tres `isLocked` se evalúan **sin cortocircuito** (Media, auditoría ronda 1): el número de
lecturas ya no depende del estado de los candados. El diseño sobre el handler actual (L64–74):

```ts
    const emailKey = `reset:${normalizedEmail}`;
    const dailyKey = `resetday:${normalizedEmail}`; // MIS-302 (B10)
    const ipKey = normalizeIpHint(args.ipHint ?? null);

    // MIS-302 (B10): las tres capas se leen sin cortocircuito (lecturas
    // uniformes). La clave diaria se deriva SOLO del email normalizado, nunca
    // consulta `users` → conserva la anti-enumeración por respuesta y por tiempo.
    const requestLocked = await isLocked(ctx, emailKey);
    const dailyLocked = await isLocked(ctx, dailyKey);
    const ipLocked = ipKey ? await isLocked(ctx, `resetip:${ipKey}`) : false;

    // "upstream" = capas anteriores al tope diario. Solo una solicitud elegible
    // para entrega (no vetada por burst ni por IP) puede consumir cuota diaria.
    const upstreamAllowed = !requestLocked && !ipLocked;
    const allowed = upstreamAllowed && !dailyLocked;

    // Se contabilizan SOLICITUDES (no fallos): burst e IP se registran SIEMPRE,
    // exista o no la cuenta — de lo contrario el contador delataría por sí mismo
    // si el email existe.
    await recordFailedAttempt(ctx, emailKey, RESET_REQUEST_LIMIT);
    // MIS-302 (B10): la cuota diaria SOLO la consume una solicitud que habría
    // podido entregar si el tope diario no existiera (upstreamAllowed). Usar
    // upstreamAllowed y no `allowed` mantiene el candado deslizante diario: las
    // solicitudes vetadas solo por el propio tope diario siguen extendiéndolo;
    // las suprimidas por burst/IP no consumen cuota.
    if (upstreamAllowed) {
      await recordFailedAttempt(ctx, dailyKey, RESET_DAILY_LIMIT);
    }
    if (ipKey) await recordFailedAttempt(ctx, `resetip:${ipKey}`, RESET_IP_LIMIT);

    await ctx.scheduler.runAfter(0, internal.passwordReset.deliverResetCode, {
      email: args.email,
      allowed,
    });
```

Al toparse, `allowed` pasa a `false` → `deliverResetCode({..., allowed:false})` retorna sin enviar
(camino ya existente); la respuesta pública sigue siendo `{ok:true}`. **Sin cambios** en
`verifyResetCode` ni `resetPasswordWithTicket` (B10 es solo sobre el **envío** del email, no la
verificación ni el cambio).

**Contrato preciso:** el tope es de **diez solicitudes elegibles para entrega por ventana móvil de
24 h** por cuenta. Para una cuenta existente equivale a un máximo de diez envíos programados; para una
inexistente, a diez solicitudes que igualmente no producen email (createResetCode devuelve null), sin
consultar `users` en la mutation pública.

### Test harness (`convex/testSupport.ts`)

#### 3. Limpieza de la clave diaria en `resetTestIdentity` (OBLIGATORIO)
Añadir `resetday:<RESET_TEST_EMAIL>` a `rateLimitKeysForTestIdentity()` (que `resetTestIdentity`
recorre con `resetAttempts`). **Es crítico:** el bloqueo diario dura 24 h; sin limpiarlo, un bloqueo
heredado de una corrida previa envenenaría **todos** los specs de reset durante un día entero (falso
rojo persistente). La enumeración es explícita a propósito (nunca por prefijo), coherente con el resto
de la función:

```ts
    `resetday:${RESET_TEST_EMAIL}`, // MIS-302 (B10): tope diario — ventana de 24h; sin limpiar, un bloqueo heredado envenenaría los specs de reset un día entero
```

#### 4. Helper gated `clearResetRequestWindow` (superficie mínima)
Para poder acumular las 10 solicitudes del día **sin toparse antes con el burst de 5/15min ni esperar
15 min reales**, un helper que limpia **solo** `reset:<email>` de la identidad dedicada. NO toca
`resetday:<email>` (la capa bajo prueba) ni ninguna otra. Mismos cerrojos que el resto del harness
(`assertTestKey` + `assertDedicatedIdentity`); no acepta clave arbitraria — no es introspección
genérica (misma disciplina que `countOversizedLoginAttempts`):

```ts
// MIS-302 (B10): limpia SOLO la ventana del burst de 15 min (`reset:<email>`) de
// la identidad dedicada, para que el spec del tope diario acumule las 10
// solicitudes del día sin toparse antes con el límite de 5/15min ni esperar 15
// min reales. NO toca `resetday:<email>` (la capa bajo prueba) ni ninguna otra.
// Mismos cerrojos que el resto del harness (clave + identidad dedicada); no
// acepta clave arbitraria — no es una introspección genérica.
export const clearResetRequestWindow = mutation({
  args: { serverKey: v.string(), email: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    assertTestKey(args.serverKey);
    const emailKey = assertDedicatedIdentity(args.email); // devuelve la forma normalizada
    await resetAttempts(ctx, `reset:${emailKey}`);
    return null;
  },
});
```
`assertTestKey` es fail-closed (sin `E2E_TEST_SUPPORT_KEY` en prod, lanza aunque esté desplegado) y
`assertDedicatedIdentity` restringe a `RESET_TEST_EMAIL`. **Ambos gates se muestran literales en el
`codigo-completo.md`** (son frontera de seguridad al desplegarse en prod).

## Verificación

### Envoltorios e2e (`e2e/helpers/test-support.ts`)
Dos wrappers nuevos:

```ts
// MIS-302 (B10): solicita un código por la vía DIRECTA (sin UI y SIN ipHint, para
// aislar las capas por email/diaria de la capa por IP). Mismo serverKey que el
// frontend (AUTH_SERVER_KEY, obligatorio desde MIS-289). Devuelve la respuesta
// pública para poder asertar que es idéntica esté o no topada.
export async function requestResetCode(): Promise<{ ok: true }> {
  return await convexClient().mutation(api.passwordReset.requestPasswordResetCode, {
    email: RESET_TEST_EMAIL,
    serverKey: authServerKey(),
  });
}

// MIS-302 (B10): limpia solo la ventana del burst de 15 min de la identidad
// dedicada (ver convex/testSupport.ts::clearResetRequestWindow).
export async function clearResetRequestWindow(): Promise<void> {
  await convexClient().mutation(api.testSupport.clearResetRequestWindow, {
    serverKey: testSupportKey(),
    email: RESET_TEST_EMAIL,
  });
}
```
`requestResetCode` **omite `ipHint`** a propósito: así `ipKey` es `null` y la capa `resetip:` no
participa — el experimento mide **solo** las capas por email y diaria.

### E2E — `e2e/password-reset-daily-cap.spec.ts` (project `chromium-secrets`, identidad DEDICADA)
**Dos** tests. El primero prueba la frontera del tope; el segundo (**M2**, auditoría ronda 1) es el de
interacción que ancla la corrección M1 — sin él, la implementación defectuosa (contar solicitudes
suprimidas) pasaría en verde. Ambos usan `try/finally` con `resetTestIdentity()` (Media): un fallo tras
fijar el candado diario no debe dejar contaminado el deployment 24 h.

**Anclaje del contrato (M2):** el spec fija **explícitamente** los valores elegidos, para que un cambio
accidental (9, 20, 100…) rompa la suite en vez de adaptarse:
```ts
expect(RESET_DAILY_LIMIT.maxAttempts).toBe(10);
expect(RESET_DAILY_LIMIT.windowMs).toBe(24 * 60 * 60 * 1000);
```
El bucle sigue derivando `CAP = RESET_DAILY_LIMIT.maxAttempts` para no duplicar el literal, pero el
requisito de "10/día · 24 h" queda anclado por las dos aserciones anteriores.

**Test 1 — frontera del tope (aislado):**
1. `resetTestIdentity()` (limpia también `resetday:<email>`).
2. Bucle hasta `CAP`: antes de cada solicitud `clearResetRequestWindow()` (el burst NUNCA corta) →
   `requestResetCode()` (`{ok:true}`) → `pollForNewCode(prev)` confirma un código **DISTINTO** del
   anterior (gotcha de memoria: "valor diferente", no solo "no nulo").
3. Solicitud nº `CAP+1`: `clearResetRequestWindow()` otra vez → si se suprime, el corte **NO** viene
   del burst (`reset:<email>` sin candado) sino del tope diario. Debe **seguir respondiendo `{ok:true}`**.
4. Negativo acotado (~3 s): `getLastResetCode()` sigue igual al último código entregado (las `CAP`
   entregas previas ya se confirmaron con polling → nada más puede escribir).

**Test 2 — interacción burst↔diario (ancla M1):** demuestra que las solicitudes suprimidas por el
burst **no** consumen cuota diaria.
1. `resetTestIdentity()`.
2. Entregar `BURST = RESET_REQUEST_LIMIT.maxAttempts` (=5) códigos **sin** limpiar el burst → al 5º,
   `reset:<email>` se bloquea. Guardar el 5º código.
3. Hacer otras `BURST` solicitudes con el burst bloqueado: cada una responde `{ok:true}` pero **no**
   produce código. Negativo acotado (~3 s): `getLastResetCode()` sigue en el 5º código.
4. `clearResetRequestWindow()` (solo el burst) → una solicitud más → `pollForNewCode(5º)` confirma un
   código **nuevo**. Con la corrección M1 es el 6º consumo diario (elegible) y **se entrega**; con la
   implementación defectuosa `resetday` ya estaría en 10 y **se bloquearía** → el test la caza.

Esquema:
```ts
import { test, expect } from "./helpers/secure-test";
import {
  getLastResetCode, resetTestIdentity, requestResetCode, clearResetRequestWindow,
} from "./helpers/test-support";
import { RESET_DAILY_LIMIT, RESET_REQUEST_LIMIT } from "../convex/lib/rateLimit";

const CAP = RESET_DAILY_LIMIT.maxAttempts;
const BURST = RESET_REQUEST_LIMIT.maxAttempts;

async function pollForNewCode(prev: string | null): Promise<string> {
  await expect.poll(async () => await getLastResetCode(), {
    message: "esperando el nuevo código de recuperación en el outbox de test",
    timeout: 10_000,
  }).not.toBe(prev);
  const code = await getLastResetCode();
  if (!code) throw new Error("getLastResetCode() devolvió null tras superar el poll");
  return code;
}
// Espera acotada para asertar el negativo "no llega código nuevo". Inherentemente
// temporal, pero robusta aquí: las entregas previas ya se confirmaron con polling
// y deliverResetCode({allowed:false}) retorna sin escribir. (Follow-up Baja: señal
// determinista del scheduler/outbox si se añadiera.)
async function assertNoNewCode(expected: string): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  expect(await getLastResetCode()).toBe(expected);
}

test.describe("tope diario de emails de recuperación (MIS-302)", () => {
  // Ancla el contrato elegido por el usuario: 10 solicitudes elegibles / ventana móvil 24 h.
  test("la config es 10/día con ventana de 24 h", () => {
    expect(RESET_DAILY_LIMIT.maxAttempts).toBe(10);
    expect(RESET_DAILY_LIMIT.windowMs).toBe(24 * 60 * 60 * 1000);
  });

  test(`entrega ${CAP} emails elegibles y suprime el siguiente, sin delatar el tope`, async () => {
    await resetTestIdentity();
    try {
      let lastCode: string | null = null;
      for (let i = 1; i <= CAP; i++) {
        await clearResetRequestWindow();
        const r = await requestResetCode();
        expect(r.ok).toBe(true);
        lastCode = await pollForNewCode(lastCode);
      }
      // Solicitud nº CAP+1: topada por la capa diaria (el burst se acaba de limpiar).
      await clearResetRequestWindow();
      const suppressed = await requestResetCode();
      expect(suppressed.ok).toBe(true); // respuesta IDÉNTICA a las entregadas
      await assertNoNewCode(lastCode!);
    } finally {
      await resetTestIdentity();
    }
  });

  test("una solicitud suprimida por el burst NO consume cuota diaria (M1)", async () => {
    await resetTestIdentity();
    try {
      // BURST entregas sin limpiar → al BURST-ésimo, reset:<email> se bloquea.
      let lastCode: string | null = null;
      for (let i = 1; i <= BURST; i++) {
        const r = await requestResetCode();
        expect(r.ok).toBe(true);
        lastCode = await pollForNewCode(lastCode);
      }
      const burstCode = lastCode!;
      // BURST solicitudes más con el burst bloqueado: {ok:true} pero sin código nuevo.
      for (let i = 0; i < BURST; i++) {
        const r = await requestResetCode();
        expect(r.ok).toBe(true);
      }
      await assertNoNewCode(burstCode);
      // Limpiar SOLO el burst; la siguiente debe entregar (6º consumo diario elegible).
      // Con el bug (contar suprimidas) resetday ya valdría 10 → se bloquearía.
      await clearResetRequestWindow();
      const r = await requestResetCode();
      expect(r.ok).toBe(true);
      const fresh = await pollForNewCode(burstCode);
      expect(fresh).not.toBe(burstCode);
    } finally {
      await resetTestIdentity();
    }
  });
});
```
*(Tests sin fixture `page`: 100% por API — mismo estilo que el test "login con email >254" de
`password-reset.spec.ts`, que también corre en `chromium-secrets` sin navegador. `BURST=5` requiere que
el tope diario `CAP=10` sea ≥ `2·BURST` para que el 6º consumo diario del test 2 aún sea elegible; con
10/día y burst 5 se cumple con holgura.)*

### Registro del spec
Añadir `"password-reset-daily-cap.spec.ts"` al `testMatch` de `chromium-secrets` en
`playwright.config.ts`. **No** toca `playwright.gate.config.ts` (su gate solo recoge
`secret-sentinel.spec.ts`).

### Cobertura preexistente que no debe romper
- `password-reset*.spec.ts` y `session-*.spec.ts` verdes: el cambio en `requestPasswordResetCode` es
  aditivo (una capa más); esos specs piden 0–1 códigos, muy por debajo de 10/día, y cada uno llama a
  `resetTestIdentity` al inicio (que ahora limpia `resetday`), así que ningún bloqueo diario de este
  spec puede filtrarse a otro.
- Orden de specs (workers:1, secuencial): irrelevante, porque `resetTestIdentity` en cada spec limpia
  la clave diaria.

### Resto
- `npm run lint` (0 errores; 1 warning preexistente ajeno en `Avatar.jsx`), `npm run build`, suite e2e
  completa. `npx convex dev --once` para desplegar las funciones nuevas al deployment de **dev**
  (`dutiful-mole-111`) contra el que corre el e2e, y regenerar `_generated` (debe quedar
  **byte-idéntico**: añadir exports a módulos existentes no cambia los ficheros generados → no se
  commitea `_generated`). Igualdad byte-a-byte CODIGO ↔ repo tras instalar.

## Despliegue

**Toca `convex/`** (nueva config + gate en `requestPasswordResetCode` + helper de test) → **REQUIERE
despliegue de Convex a prod**. El cambio es **aditivo y retrocompatible**: añade una capa de límite y
un helper de test (inerte en prod, `E2E_TEST_SUPPORT_KEY` no existe allí); la firma de
`requestPasswordResetCode` **no cambia**, así que el frontend actual sigue llamándola igual. No hay
cambios en `src/` — el efecto real en prod proviene **100 %** del deploy de Convex; el merge solo trae
código de test + `convex/` al repo (Railway redepliega un frontend funcionalmente idéntico).

Por eso es seguro **desplegar Convex ANTES del merge** (fase *expand*): el tope pasa a aplicarse en
prod en cuanto se despliega. Técnica del runbook `PLANS/RUNBOOK-DESPLIEGUE-CONVEX-PROD.md` §1
(deploy-token; auth personal con `env -u CONVEX_DEPLOY_KEY -u CONVEX_DEPLOYMENT_TOKEN`), precedida del
**Gate B9** (§2: `npx convex env list --prod --names-only` → `E2E_TEST_SUPPORT_KEY` **ausente**,
`AUTH_SERVER_KEY` + `GOOGLE_LOGIN_SHARED_SECRET` **presentes**). prod = `greedy-tapir-20`.

## Gate (metodología estricta)

Este plan **NO** autoriza instalar/mergear/desplegar. Flujo:

1. Código (effort **high**) → entrega autocontenida en `CODIGO/MIS-302-tope-diario-emails/`
   (contenido literal de ficheros nuevos + **diffs `diff -u` completos**, sin condensar; manifiesto
   `find … -type f | LC_ALL=C sort` sin filtro de extensión; evidencia reproducible con greps; gates
   `assertTestKey`/`assertDedicatedIdentity` literales).
2. **Auditoría de código externa** (GO/NO-GO). Un GO CONDICIONADO también es un GO.
3. Instalar byte-idéntico → `npx convex dev --once` → `lint` 0 err / `build` OK / suite e2e verde
   (foco: `password-reset-daily-cap`; sin regresiones en el resto).
4. PR (**permiso antes del push**) → **CI verde** (suite completa; un fallo determinista = regresión
   real, investigar).
5. **Deploy de Convex a prod desde la rama** (confirmación explícita antes; Gate B9 → deploy-token) →
   verificar la capa viva en prod.
6. Merge (asistente, con permiso) → Railway auto-despliega el frontend (sin cambios funcionales).
7. Smoke en prod → cerrar MIS-302.

## Nota de seguridad / anti-enumeración

- La clave `resetday:<email>` se construye **solo** con el email normalizado; nunca se consulta
  `users`. Las lecturas/escrituras de rate-limit y el `deliverResetCode` programado **no dependen de la
  existencia de la cuenta**: un email existente y uno inexistente alimentan exactamente los mismos
  contadores y siguen el mismo camino (el `allowed` que viaja al scheduler no es observable por el
  cliente; `createResetCode` es quien, ya en el action diferido, no encuentra usuario y no envía). Los
  tres `isLocked` se evalúan **sin cortocircuito**, así que su número no varía con el estado de los
  candados. La respuesta pública es **siempre** `{ok:true}`. No se rompe la anti-enumeración.
- El burst y la IP se registran **siempre**; la cuota diaria se registra cuando `upstreamAllowed`
  (independiente de la existencia de la cuenta, que no se consulta). Ningún contador delata si el email
  existe, y de todos modos no es observable por el cliente.
- No se loguea ningún email, código ni hash.
- **Semántica del tope:** es una **ventana móvil de 24 h** (no día natural). Diez solicitudes
  elegibles para entrega dentro de cualquier ventana de 24 h agotan la cuota.
- **Propiedad documentada (heredada del mecanismo actual, no nueva):** bajo solicitudes continuas, cada
  registro tras alcanzar el máximo empuja `lockedUntil` (candado deslizante) — un abusador persistente
  puede mantener a una cuenta topada más allá de 24 h. Es idéntico al comportamiento ya auditado de
  `RESET_REQUEST_LIMIT`; cambiarlo queda fuera de alcance. Con la corrección M1, ese candado deslizante
  lo alimentan solo solicitudes elegibles (no las ya suprimidas por burst/IP).

## Follow-ups (fuera de alcance)
- Tope diario análogo por IP (`resetday-ip:<ip>`), si se quisiera acotar también el abuso desde una IP
  rotando cuentas.
- Métrica/alerta segura de "cuenta que alcanza el tope diario" (sin emails ni hashes), en la línea de
  `LOGIN_EMAIL_COUNTER`.
- **Señal determinista del outbox/scheduler** para el negativo del test (id/contador/timestamp), que
  eliminaría a la vez (a) la espera fija de ~3 s y (b) la comparación de códigos OTP —ésta tiene una
  probabilidad ínfima de falso rojo (~1e-6 por paso) si el generador repitiera código; hoy `getLastResetCode`
  solo devuelve el código, así que ambas quedan como deuda Baja documentada, no bloqueante.
- Sustituir el candado deslizante por una ventana fija diaria si producto lo prefiere.

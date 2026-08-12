# Plan de corrección — auditoría de seguridad del login

> **Estado: ronda 4, pendiente de auditoría.** Sin tickets de Linear y sin una
> línea de código. Los números MIS se asignan cuando el plan reciba el GO.
>
> **Informe de origen:** `PLANS/AUDITORIA-SEGURIDAD-LOGIN-2026-08-10.md`
>
> **Ronda 1:** NO-GO (2 blockers, 5 majors). **Ronda 2:** NO-GO (1 blocker, 3
> majors). **Ronda 3:** NO-GO (1 blocker, 2 majors). **Ronda 4:** NO-GO
> (0 blockers, 2 majors) — ambos de secuencia de despliegue.
>
> **Ronda 5:** NO-GO (0 blockers, 1 major). **Ronda 6: GO** — sin blockers ni
> majors. Aplicadas además las seis sugerencias no bloqueantes de esa ronda.
>
> **Estado: aprobado para implementación.** El GO autoriza crear los seis
> tickets y arrancar 1A. Cada despliegue sigue sujeto a sus gates, y las
> comprobaciones que sólo pueden demostrarse en ejecución (ingreso real de
> Railway, sobreescritura de cabeceras en Cloudflare, CSP en enforcement,
> conteo del KDF bajo concurrencia, rotación de cuentas) están en la sección
> de verificación, no dadas por hechas.

## Contexto

La auditoría del 2026-08-10 revisó los tres flujos de entrada al CRM — email+contraseña, Google OAuth y recuperación por código OTP — y encontró 3 hallazgos altos, 5 medios y 12 bajos. No hay bypass de autenticación ni fuga de credenciales: la criptografía, el anti-enumeración y el manejo del token de sesión están bien hechos.

**Los tres hallazgos altos salen de una única raíz.** El rate limiting es la única defensa contra fuerza bruta, y no resiste a un atacante porque el identificador de origen (`ipHint`) es un argumento de la mutation que el llamante elige:

- `login`, `requestPasswordResetCode` y `verifyResetCode` son mutations **públicas** y `NEXT_PUBLIC_CONVEX_URL` está en el bundle JS → cualquiera llama a Convex directamente y falsifica u omite el `ipHint`.
- Y aun pasando por Next.js, `normalizeIpHint` toma el valor **más a la izquierda** de `x-forwarded-for`, que es justo el que inyecta el cliente: Cloudflare y Railway *añaden* la IP real al final, no la sustituyen.

De ahí, encadenado: la capa por IP no limita nada y además sirve para bloquear la IP de un tercero (A1); el bloqueo por email queda como única defensa y permite dejar a Carlos o Marta fuera del CRM indefinidamente con una petición cada 15 minutos (A2); y sin freno de origen fiable, cualquiera fuerza PBKDF2 de 600.000 iteraciones sin límite contra Convex (A3).

**Resultado buscado:** que el origen de cada intento sea algo que el servidor observa y no algo que el atacante declara; que un ataque no pueda dejar fuera a un usuario legítimo; y que el coste de un intento fallido recaiga en quien lo hace.

## Invariantes

Estas seis frases son el contrato. Cada una tiene su prueba en la sección de verificación, y cada prueba dice qué fase la cubre.

- **I1 — Origen autenticado.** Ninguna petición que no venga de Cloudflare alcanza **ninguna ruta dinámica** de la aplicación. La confianza en `cf-connecting-ip` se deriva de esto, no del nombre de dominio. *(1A)*
- **I2 — Fail-closed.** En un build de producción, si falta cualquier variable de la que dependa una defensa, la aplicación **deja de servir**. Nunca sirve con la defensa desactivada en silencio. *(1A)*
- **I3 — Convex cerrado.** Las funciones de autenticación rechazan cualquier llamada que no venga del servidor de Next.js, **antes** de tocar base de datos, rate limit, scheduler, PBKDF2 o cualquier hashing, **y no queda publicada ninguna función de autenticación sin esa protección**. *(se cumple al cerrar 1A-bis, no al cerrar 1A — ver 1A.5)*
- **I4 — Disponibilidad.** Una contraseña correcta desde un origen no bloqueado **siempre** entra, sea cual sea el contador acumulado sobre ese email. *(1B)*
- **I5 — Coste acotado.** El número de ejecuciones de PBKDF2 que puede provocar un origen está acotado por el límite por IP **incluso bajo peticiones concurrentes**, porque la cuota se consume en una transacción que confirma antes de derivar nada. La cota se demuestra **contando derivaciones reales**, no reservas. *(1B)*
- **I6 — Credenciales no triviales.** Ninguna cuenta con contraseña conserva una anterior a la política en el momento en que se retira el veto por email, y eso se demuestra con **un marcador escrito atómicamente junto al hash**, no infiriéndolo de fechas. *(1B)*
- **I7 — La contraseña reservada sigue vigente.** Una sesión sólo se crea si el `passwordHash` con el que se verificó la contraseña **sigue siendo el del usuario** en el instante de crearla. Un cambio de contraseña concurrente invalida el intento en vuelo. *(1B)*

---

# Paso 0 — Linear

**Creados el 2026-08-10**, todos en `Backlog`, con la cadena de dependencias marcada en Linear: **MIS-288 → MIS-289 → MIS-290 → MIS-291 → MIS-292 → MIS-293**.

| Ticket | Fase | Contenido | Unidad de despliegue |
|---|---|---|---|
| [MIS-288](https://linear.app/mistu-monso/issue/MIS-288) | 1A | Perímetro: I1 · I2 · migración de endpoint · cabeceras y CSP · B8 | PR + deploy Convex + deploy Railway |
| [MIS-289](https://linear.app/mistu-monso/issue/MIS-289) | **1A-bis** | **Retirar `auth.login`. Cierra I3** | PR + **deploy Convex** |
| [MIS-290](https://linear.app/mistu-monso/issue/MIS-290) | 1B-i | Motor y credenciales: I5 · I6 · I7 · B4 · política y rotación. **El veto por email sigue puesto** | PR + deploy Convex |
| [MIS-291](https://linear.app/mistu-monso/issue/MIS-291) | 1B-ii | Retirada del veto: I4 · A2 · B7 | **Sólo `env set` + evidencia.** Sin deploy |
| [MIS-292](https://linear.app/mistu-monso/issue/MIS-292) | 2 | M1 · M3 · M4 | PR + deploy |
| [MIS-293](https://linear.app/mistu-monso/issue/MIS-293) | 3 | Los bajos restantes | PR + deploy |
| [MIS-294](https://linear.app/mistu-monso/issue/MIS-294) | 1A · DiP | **Cerrar el origen con Cloudflare Tunnel.** Defensa en profundidad, **fuera del camino crítico** — bloqueada solo por MIS-288, no bloquea a nadie | Infra (cloudflared + red privada), probado en staging |

MIS-294 se añadió tras el spike 1A.0 (2026-08-11), que probó que el origen es alcanzable sin Cloudflare incluso por IP cruda con el host canónico. Cierra la exposición a nivel de red; I1 ya la cierra el mecanismo A dentro de MIS-288.

Dos particiones que no son cosmética:

- **1A-bis existe porque la retirada del endpoint viejo necesita su propio despliegue.** La ronda 5 detectó que el plan la dejaba en un "commit posterior" sin ticket, rama ni PR: una vez mergeado y desplegado 1A, no había dónde meterlo, y si se olvidaba, `auth.login` seguía publicada sin `serverKey` manteniendo A1 y A3 abiertos. Es condición de cierre de I3, no deuda.
- **1B se parte** porque I6 exige una ventana en producción entre "política desplegada" y "veto retirado" para rotar y verificar las cuentas (ver 1B.4).

Una rama por ticket, PR enlazado, estado en vivo. Nada sobre `main`.

---

# Fase 1A — Perímetro

## 1A.0 Spike previo — capacidades reales de Railway  *(bloquea 1A.1)*

Responder **con una prueba**: ¿se puede alcanzar el contenedor sin pasar por Cloudflare? Probar el dominio `*.up.railway.app`, cualquier dominio alternativo del servicio, y qué ofrece Railway para restringir el ingress (allowlist de IPs, private networking, TCP proxy). Averiguar también **cómo hace Railway el health check**, porque `railway.json` no define `healthcheckPath` hoy y el secreto de origen puede tumbar el despliegue (ver 1A.4).

No es opcional: la ronda 1 dio por bueno "desactivar el dominio" sin comprobar que eso cierra el origen.

## 1A.1 Autenticar el tramo Cloudflare → Railway  *(I1)*

Hace falta **un secreto que el atacante no tenga**. `Host` no lo es: es una cabecera que él también escribe.

### Mecanismo A — cabecera de origen con secreto compartido  *(línea base, siempre)*

- En Cloudflare, una **Transform Rule de request header** que **establezca** (`Set`, sobreescritura incondicional — **no** `Add`, que dejaría el valor del cliente junto al nuestro y permitiría inyectar un segundo valor) `X-Origin-Auth: <secreto>` en **todas** las peticiones al origen.
- En `src/proxy.ts`, primera operación: comparar contra `ORIGIN_SHARED_SECRET` en **tiempo constante**. Si no coincide → `403`.
- Ambos secretos (`ORIGIN_SHARED_SECRET` y `AUTH_SERVER_KEY`) son de **32 bytes aleatorios** mínimo.
- **Rotación sin ventana de 403**: el proxy acepta `ORIGIN_SHARED_SECRET` **y**, si está definida, `ORIGIN_SHARED_SECRET_NEXT`. Rotar es: poner el nuevo valor en `_NEXT` en Railway → cambiar la Transform Rule al nuevo → verificar → mover `_NEXT` a `ORIGIN_SHARED_SECRET` y borrar `_NEXT`. Sin la clave doble, cualquier rotación corta el servicio entre el cambio en Cloudflare y el reinicio de Railway. Procedimiento en el README.
- Se elige como línea base porque **no depende de ninguna capacidad de Railway**: funciona aunque el origen siga siendo alcanzable.
- Limitación honesta: es un bearer token en una cabecera. Si se filtra (logs, volcado de request, un 500 verboso), la protección cae. Por eso es rotable y por eso se acompaña de B.

### Mecanismo B — cerrar el origen  *(resuelto por el spike 1A.0 → ticket MIS-294)*

El spike (2026-08-11, ver `PLANS/MIS-288-spike-1A0.md`) probó que el origen está **completamente expuesto**: el dominio de Railway sirve la app sin Cloudflare, y **la IP cruda `69.46.46.113` responde con `Host: mistu-monso.com`** — así que "desactivar el dominio" no cierra nada. Railway no ofrece allowlist de IP nativo. La única forma real de cerrar el origen a nivel de red es **Cloudflare Tunnel**, habilitado por la red privada `mi-crm.railway.internal`, que el spike confirmó activa.

**Decisión de scope (2026-08-11):** el Tunnel es defensa en profundidad —I1 ya la cierra el mecanismo A en `proxy.ts`, que ships en MIS-288— y es una reconfiguración de red con riesgo de downtime. Va en un **ticket propio, MIS-294**, fuera del PR de código, con su ventana y probado en staging. No bloquea 1B ni las fases siguientes.

## 1A.2 Cobertura completa del perímetro  *(I1 — cierra M6 de la ronda 2)*

El matcher propuesto en la ronda 2 excluía `/_next/image`, que **no es un recurso estático sino un handler dinámico**: una petición directa al origen lo alcanzaba sin pasar por el secreto de origen. I1 era falso.

En vez de proteger ese handler, **se elimina**: `next/image` no se usa en ningún punto del proyecto (verificado — la única aparición de la cadena es el propio comentario de `src/proxy.ts:34`). En `next.config.ts`:

```ts
images: { unoptimized: true }
```

Con el handler fuera, el matcher del proxy sólo excluye lo que es de verdad un fichero servido de disco:

```ts
matcher: ['/((?!_next/static|favicon.ico).*)']
```

Reversión explícita de la decisión de `src/proxy.ts:33-42`. El motivo original sigue valiendo para el *check de cookie*, así que dentro de la función quedan **tres preocupaciones independientes**: secreto de origen (todo), host canónico (todo), cookie optimista (sólo las rutas de siempre). Hay que reescribir ese comentario, no borrarlo.

**Excepciones a I1, enumeradas y justificadas** — la lista es cerrada y cualquier añadido futuro exige revisión:

| Ruta | Por qué se exime | Qué se garantiza a cambio |
|---|---|---|
| `/_next/static/*` | ficheros de disco con hash en el nombre, sin ejecución | ninguna lógica de aplicación, ningún acceso a datos |
| `/favicon.ico` | fichero estático | idem |
| `/api/health` (nueva) | Railway necesita comprobar el servicio sin pasar por Cloudflare (1A.4) | comprueba **solo la presencia** de las variables obligatorias (`typeof x === "string"`), devuelve `200`/`503`; sin base de datos, sin cookies, sin servicios externos, sin leer el *valor* de ninguna variable |

## 1A.3 Fail-closed  *(I2)*

Condición **afirmativa de entorno**, no ausencia de variable:

```
NODE_ENV === "production":
    falta ORIGIN_SHARED_SECRET | APP_CANONICAL_HOST | AUTH_SERVER_KEY
        → rutas dinámicas: 503, y se registra
        → /api/health: TAMBIÉN 503 (guardián de deploy, ver 1A.4)
              → Railway no promociona el deploy; el viejo sano sigue en pie
NODE_ENV !== "production":
    comprobaciones de origen desactivadas; activarlas exige definir las variables
```

Playwright arranca `npm run dev` (`playwright.config.ts:94-99`), así que CI y local caen del lado de desarrollo sin bypass silencioso en producción.

**Refinamiento del spike 1A.0 (2026-08-11, aprobado):** en la ronda de auditoría, `/api/health` quedaba siempre en 200 y un deploy con una variable ausente se promocionaba sirviendo 503 a todos. El spike descubrió que la sonda de Railway corre *antes* de promocionar y que un fallo mantiene el deploy viejo — así que `/api/health` refleja el fail-closed (503 si falta una variable) y se convierte en guardián: el deploy malo nunca llega a producción. `/api/health` sigue exenta del **secreto de origen** y del **check de host** (para que la sonda interna la alcance), pero **no** del chequeo de presencia de variables — ahí es donde guarda.

**Matriz de verificación fail-closed** (cierra M8 de la ronda 2) — en staging con `NODE_ENV=production`, retirando **una variable cada vez**:

| Variable ausente | Dónde | Resultado exigido |
|---|---|---|
| `ORIGIN_SHARED_SECRET` | Railway | 503 en toda ruta dinámica **y en `/api/health`** → el deploy no se promociona |
| `APP_CANONICAL_HOST` | Railway | idem |
| `AUTH_SERVER_KEY` | Railway | idem (además el frontend no puede hablar con Convex) |
| `AUTH_SERVER_KEY` | Convex | las 5 funciones rechazan **antes de cualquier efecto lateral**; ningún token, ningún código programado, ningún ticket consumido |

El último caso no es un 503 sino el *fail-closed* de `serverKeyMatches` (1A.5): sin la variable, `expected` es `undefined` y ninguna clave puede coincidir.

## 1A.4 Health check

`railway.json` no declara `healthcheckPath` hoy (verificado en el spike: no hay path configurado). Con el secreto de origen obligatorio, cualquier sonda directa de Railway recibiría `403` — por eso `/api/health` va exenta. Y como la sonda corre **antes de promocionar el deploy** y un fallo mantiene el deploy viejo, la ruta hace doble papel: reachable + guardián.

- Nueva ruta `/api/health`: **`200` si todas las variables obligatorias están presentes, `503` si falta alguna.** Comprueba **solo presencia** (`typeof process.env.X === "string" && length > 0`), nunca el *valor*, nunca base de datos, cookies ni servicios externos.
- **Invariante de la ruta, documentada en el propio fichero**: nunca debe crecer para comprobar Convex, Resend ni ningún otro servicio. Comprobar presencia de variables de entorno es barato y no toca nada externo; en cuanto tocara un servicio o leyera un *valor* secreto, dejaría de ser segura como ruta sin autenticar.
- Exenta del **secreto de origen** y del **check de host** (para que la sonda interna la alcance), **no** del chequeo de presencia de variables (1A.3).
- `railway.json` declara `"healthcheckPath": "/api/health"` para que la sonda sea explícita y no dependa del comportamiento por defecto de la plataforma.
- **Por qué es mejor que un `200` constante**: un deploy con una env var de seguridad ausente falla el healthcheck y **no llega a promocionarse**; el deploy anterior, sano, sigue sirviendo. Un `200` constante habría promocionado un deploy que sirve 503 a todos.

## 1A.5 Cerrar las funciones de autenticación  *(I3)*

**Nuevo `convex/lib/serverKey.ts`** con **dos** entradas, para resolver la contradicción que señaló la ronda 2 (un helper que lanza no puede producir "el error genérico de cada función"):

- `serverKeyMatches(provided, envVarName): boolean` — comparación en tiempo constante con `constantTimeEqual` (`convex/lib/password.ts:48`), **fail-closed** si la variable no existe. Es la que usan las funciones de autenticación: cada una devuelve **su propio** error genérico cuando da `false`.
- `assertServerKey(provided, envVarName): void` — envoltorio que lanza, construido sobre la anterior. Es la forma que ya usa `convex/testSupport.ts:39-48`, que se refactoriza para consumirla.

**Exigen `serverKey: v.string()`** contra `AUTH_SERVER_KEY`:

| Función | Efecto lateral que NO debe ocurrir sin clave válida |
|---|---|
| `auth.ts::loginWithPassword` | emitir token, escribir en `loginAttempts`, ejecutar PBKDF2 |
| `passwordReset.ts::requestPasswordResetCode` | programar el envío, escribir en `loginAttempts` |
| `passwordReset.ts::verifyResetCode` | consumir un intento, invalidar un código, emitir ticket |
| `passwordReset.ts::resetPasswordWithTicket` | consumir el ticket, cambiar el hash, borrar sesiones |
| `auth.ts::loginWithGoogle` | (ya cerrada; sólo se refactoriza al helper común) |

### Migración de endpoint sin ventana de caída  *(cierra M-R4-1 de la ronda 4)*

El auditor detectó que cambiar `auth.login` de `mutation` a `action` en 1B rompe el login en **los dos** órdenes de despliegue, y también al revertir. Tiene razón, y el mismo razonamiento aplica a 1A: añadir un argumento obligatorio a una mutation rompe igual en ambos sentidos, porque el validador de Convex rechaza tanto la falta del argumento como uno inesperado. La ronda 3 lo daba por "ventana corta pero real"; con la corrección de M-R4-1 encima, mantener dos ventanas de caída en dos fases distintas no se sostiene.

**Se hace una sola migración, aquí, y con la forma final desde el principio.** En vez del `loginWithPasswordV2` que sugería el auditor, el endpoint nuevo se llama **`auth.loginWithPassword`** — descriptivo y simétrico con el `loginWithGoogle` que ya existe, en vez de un sufijo de versión que habría que limpiar después.

Se publica ya como **action**, aunque 1A no lo necesite, precisamente para que 1B sea un cambio **puramente interno**:

| Paso | Ticket | Convex | Frontend | Estado del login |
|---|---|---|---|---|
| 1 | 1A | desplegar con `login` (vieja, intacta) **y** `loginWithPassword` (nueva) | sin tocar | funciona por la vieja |
| 2 | 1A | — | cambiar a `loginWithPassword` | funciona por la nueva |
| 3 | 1A | verificar en producción | — | funciona |
| 4 | **1A-bis** | **retirar `login` y redesplegar Convex** | sin tocar | funciona por la nueva |

**El paso 4 es un ticket propio, no un "commit posterior".** Mientras `auth.login` siga publicada es invocable directamente sin `serverKey`, con `ipHint` falseable y PBKDF2 a demanda: A1 y A3 siguen abiertos por esa puerta aunque el endpoint nuevo esté perfecto. Por eso **I3 no se da por cumplida al cerrar 1A**, sino al cerrar 1A-bis, y por eso 1A-bis se crea en el Paso 0 junto a los demás y no cuando alguien se acuerde.

Salvaguardas para que no se olvide:
- 1A-bis se crea en Linear **a la vez** que 1A, con la dependencia marcada.
- Test automático en 1A-bis: una llamada directa a `auth:login` debe fallar **porque la función ya no existe**, mientras `loginWithPassword` sigue respondiendo. Vive en 1A-bis y no en 1A porque durante 1A debe fallar al revés. **No puede referenciar `api.auth.login`**: una vez borrada la función, esa propiedad no existe en la API generada y el test no compilaría. Usa una referencia dinámica por nombre (`makeFunctionReference("auth:login")` o el equivalente sin tipar) y afirma un error de *función no encontrada*, no un error de argumentos.
- El cierre de 1A-bis registra **la hora exacta** de la retirada **y el identificador del despliegue de Convex que la hizo efectiva**, para que la ventana de convivencia quede auditable de punta a punta.
- El criterio de cierre de 1A dice de forma explícita: *"I3 pendiente hasta 1A-bis"*.

En 1A, `loginWithPassword` es una action fina: comprueba `serverKey` y delega en un `internalMutation` que contiene **la lógica de hoy sin cambios** (rate limit y KDF dentro de una transacción). En 1B-i se sustituyen sus tripas por reserva → KDF → finalización. **Mismo nombre, misma firma, mismo tipo: ningún despliegue de 1B tiene ventana de incompatibilidad.**

Coste asumido: un salto extra action→mutation en 1A que 1A por sí sola no necesitaría. Se paga a cambio de eliminar dos ventanas de caída y de que el rollback de 1B sea un revert normal.

**Invariante de orden — I3:** la comprobación es la **primera sentencia** de cada handler. Antes de `normalizeEmailKey`, de `emailWithinLimits`, de `isLocked`, de cualquier `ctx.db` o `ctx.scheduler`. Se documenta en `convex/lib/serverKey.ts` y se comprueba en la revisión del PR.

**Contrato ante clave ausente o incorrecta:**
- **Incorrecta** → el error genérico de cada función. Indistinguible de "email no existe".
- **Ausente** → el validador de argumentos de Convex rechaza antes del handler. Se acepta a propósito: no revela nada sobre ninguna cuenta, que es lo que el criterio anti-enumeración protege. Argumento obligatorio (no `v.optional`) por coherencia con `loginWithGoogle` y porque un contrato de tipos fuerte vale más que uniformar un mensaje que no filtra nada.

`logout` y `getSessionUser` **no** se tocan: sólo aceptan un token de sesión que ya es un secreto de 256 bits.

## 1A.6 IP de confianza

**Nuevo `src/lib/auth/clientIp.ts`**:

- Devuelve la IP **sólo si** la petición pasó el mecanismo A. Sin ese sello, no hay IP.
- Lee `cf-connecting-ip`. **No** cae de vuelta a `x-forwarded-for`.
- En producción, sin valor resoluble → rechazo en el proxy (I2). En desarrollo, `null` y sin límite por IP, como hoy.
- Reutiliza la validación de formato de `normalizeIpHint` (`convex/lib/rateLimit.ts:16-24`), duplicada en `src/` según el criterio ya establecido de no cruzar imports entre `src/` y `convex/` (`src/lib/auth/google.ts:27-31`).

`src/lib/auth/actions.ts:18,56,69` deja de leer `x-forwarded-for`; añade `serverKey` en las cuatro llamadas (`:20`, `:58`, `:71`, `:97`).

## 1A.7 Cabeceras de seguridad  *(M2 + B8)*

En `next.config.ts` vía `async headers()` con `source: '/:path*'`:

```
default-src 'self';
script-src 'self' 'unsafe-inline';
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
font-src 'self' data:;
connect-src 'self';
frame-ancestors 'none';
base-uri 'self';
form-action 'self';
object-src 'none'
```

| Otras | Valor |
|---|---|
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `X-Content-Type-Options` | `nosniff` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), browsing-topics=()` |
| `Strict-Transport-Security` | `max-age=63072000` — **sin `includeSubDomains` ni `preload`** hasta inventariar subdominios |

**Lo que esta CSP arregla es el clickjacking** (`frame-ancestors`). `script-src` conserva `'unsafe-inline'` porque sin nonce Next no arranca, y `style-src` porque la app usa atributos `style={{…}}` por todas partes y **el nonce no cubre atributos de estilo**. El endurecimiento real va en la fase 3: exige mover la CSP a `proxy.ts` y **desactiva la optimización estática y es incompatible con PPR** (`docs/01-app/02-guides/content-security-policy.md:391-397`).

**No se da por buena por estar presente la cabecera**: se valida en enforcement navegando login, Google, recuperación y una Server Action, con cero violaciones en consola.

**B8**: `experimental: { serverActions: { allowedOrigins: ['mistu-monso.com'] } }` — confirmado que sigue bajo `experimental` en 16.2.10 (`node_modules/next/dist/server/config-shared.d.ts:653`).

## 1A.8 Suite e2e

- **Nuevo helper** que lee `AUTH_SERVER_KEY`, con el patrón de `testSupportKey()` (`e2e/helpers/test-support.ts:11-19`).
- **Los 17 call sites pasan a `loginWithPassword` con `serverKey`**, no al endpoint viejo. `e2e/helpers/test-support.ts:57` (dentro de `loginSucceeds()`), `e2e/test-support.spec.ts:84` y 15 en `e2e/password-reset-invariants.spec.ts`. `auth.login` conserva su firma antigua sin `serverKey` para que el frontend siga funcionando durante la ventana, así que **no acepta el contrato nuevo y ningún test debe apuntarle**: el único que lo menciona es el de 1A-bis, y para comprobar que ya no existe.
- **`loginSucceeds()` sigue llamando a Convex directamente** — deliberado: la contraseña efímera no debe entrar en el navegador, invariante que vigila `scripts/check-secret-leak.mjs`.
- **Un test por función** (I3), sobre el **efecto lateral**, no el valor de retorno:
  - `loginWithPassword` con clave incorrecta → sin token **y** sin fila nueva en `loginAttempts`.
  - `verifyResetCode` con clave incorrecta contra un código válido → el código **sigue usable** después.
  - `resetPasswordWithTicket` con clave incorrecta contra un ticket válido → el ticket **sigue usable** y la contraseña no cambia.
  - `requestPasswordResetCode` con clave incorrecta → **prueba con ventana de observación y control positivo** (la ronda 2 señaló el falso verde): (a) reseed; (b) llamada con clave mala; (c) sondear el outbox durante una ventana suficiente y comprobar que sigue vacío; (d) **control positivo** — llamada con clave buena y sondeo hasta que aparezca un código. Sin (d), un outbox roto daría verde en (c). Es la misma disciplina de "esperar un valor distinto del anterior" que ya usa la suite para entregas asíncronas.

**Hueco reconocido:** secreto de origen, host canónico y fail-closed sólo se activan en builds de producción, así que CI no los ejercita; se cubren en la verificación manual. Automatizarlo exigiría un segundo servidor de Playwright con `NODE_ENV=production`; se propone como follow-up.

## 1A.9 Despliegue y rollback

Las variables se configuran **antes** de desplegar: son inertes hasta que hay código que las lea.

1. `npx convex env set AUTH_SERVER_KEY <32 bytes>` en **prod** y **dev**.
2. En Railway: `AUTH_SERVER_KEY`, `ORIGIN_SHARED_SECRET`, `APP_CANONICAL_HOST`.
3. En Cloudflare: la Transform Rule con `Set` (no `Add`) y el mismo valor que `ORIGIN_SHARED_SECRET`. **Antes** de desplegar el código que lo exige.
4. **Desplegar Convex a producción**, con `login` (vieja) y `loginWithPassword` (nueva) conviviendo — paso 1 de la tabla de 1A.5. El despliegue de Convex es el que se ha caído 4 veces: `deployment token create --prod` → `CONVEX_DEPLOY_KEY` → deploy → borrar el token.
5. Desplegar el frontend apuntando a `loginWithPassword` (Railway al mergear) — paso 2.
6. Verificar el login en producción (paso 3). La retirada de `login` (paso 4) **no forma parte de este despliegue**: la ejecuta el ticket **1A-bis**, con su propio PR y su propio despliegue de Convex.
7. Cloudflare a Full (strict) — **al final**, con el dominio canónico ya respondiendo. (El mecanismo B / Tunnel es el ticket MIS-294, aparte.)

| Síntoma | Causa probable | Salida |
|---|---|---|
| 403 en todo | Transform Rule mal configurada o secreto desalineado | corregir en Cloudflare; inmediato, sin redeploy |
| 503 en todo | falta una variable en Railway (I2 funcionando) | añadirla y reiniciar |
| Despliegue marcado no sano | health check sin exención | verificar `/api/health` y `healthcheckPath` |
| Login falla tras el paso 5 | `AUTH_SERVER_KEY` desalineada entre Convex y Railway | alinear la variable; si no, revertir el frontend al endpoint viejo, que **sigue existiendo hasta el paso 6** |

Los pasos 1-3 son reversibles sin desplegar. El 5 es reversible revirtiendo sólo el frontend, porque `login` sigue publicada: ésa es toda la ventaja de la migración por endpoint versionado. A partir del paso 6, el viejo endpoint ya no está y un revert exige coordinar los dos lados — por eso el 6 va después de verificar. Horario tranquilo de todos modos.

---

# Fase 1B — Rate limiting y credenciales

Depende de 1A: sin origen autenticado, limitar por IP no significa nada.

## 1B.1 Separar las configuraciones de rate limit

Hoy `EMAIL_RATE_LIMIT` lo comparten **tres** flujos y `IP_RATE_LIMIT` **dos** (verificado: `convex/auth.ts:66,67`, `convex/passwordReset.ts:64,65,182,183`). Cinco configuraciones con nombre inequívoco en `convex/lib/rateLimit.ts`:

| Constante | Clave | Uso | Valor |
|---|---|---|---|
| `LOGIN_IP_LIMIT` | `ip:<ip>` | `login` | 10 / 15 min → bloqueo 15 min |
| `LOGIN_EMAIL_COUNTER` | `<email>` | `login` | 50 / 60 min, **sin bloqueo** |
| `RESET_REQUEST_LIMIT` | `reset:<email>` | `requestPasswordResetCode` | 5 / 15 min (sin cambios) |
| `RESET_CODE_LIMIT` | `resetcode:<email>` | `verifyResetCode` | 5 / 15 min (sin cambios) |
| `RESET_IP_LIMIT` | `resetip:<ip>` | ambos flujos de recuperación | 10 / 15 min |

**`LOGIN_EMAIL_COUNTER` es telemetría y nada más.** No veta, y **ningún consumidor lo lee hoy**: el aviso de M4 (fase 2) es de *cambio de contraseña* y no consulta este contador. Queda registrado para alimentar una futura alerta de "intentos de acceso"; mientras esa alerta no exista, su único valor es forense. Se documenta así en el código para que nadie lo confunda con una defensa.

## 1B.2 Reservar la cuota antes del KDF  *(I5 — cierra B3 de la ronda 2)*

El fallo de la ronda 2: el contador se incrementaba **después** de `verifyPassword`. Un burst concurrente lee el contador antes de que ninguno confirme y todos alcanzan el KDF; y con control de concurrencia optimista, los reintentos repiten el trabajo. La serializabilidad deja el contador *final* correcto, pero **no impide el trabajo**: el KDF ya se ejecutó dentro de cada transacción antes de confirmar. Por eso ninguna garantía de aislamiento resolvería esto — y, en efecto, el paquete vendido de Convex no documenta ninguna (sólo una línea sobre errores transitorios del scheduler en `dist/esm-types/server/scheduler.d.ts:18`). Hay que cambiar la forma, no buscar una garantía.

**Se sustituyen las tripas de `auth.loginWithPassword`**, que 1A ya publicó como action (ver 1A.5). **No cambia el nombre, ni la firma, ni el tipo de función: este paso no tiene ventana de incompatibilidad ni requiere coordinar despliegues.** La cuota se consume en una transacción que **confirma antes** de derivar nada:

```
action loginWithPassword(email, password, ipHint, serverKey)
  0. serverKeyMatches(...)  → si no, error genérico          [sin transacción]
  1. runMutation(internal.auth.reserveLoginSlot)             [TRANSACCIÓN 1 — confirma]
       · isLocked(ip:<ip>)  → si bloqueado: {allowed:false}
       · consume cuota de IP AL INTENTAR (no al fallar)
       · busca el usuario; devuelve {allowed, hash, fingerprint}
         donde hash = el real, o DUMMY si no existe el usuario
         y fingerprint = SHA-256(hash)
  2. si !allowed → error genérico                            [sin KDF]
  3. verifyPassword(password, hash)                          [KDF, FUERA de transacción]
  4. runMutation(internal.auth.finalizeLogin, {emailKey, fingerprint, ok, ...})
                                                              [TRANSACCIÓN 2 — confirma]
       · relee por índice by_email (misma consulta exista o no la cuenta):
           - no existe            → error genérico, sin sesión
           - SHA-256(su hash actual) ≠ fingerprint → error genérico, sin sesión
       · ok  → crea sesión, resetea el contador de email
       · !ok → incrementa el contador de email (telemetría)
```

Por qué cierra I5: la transacción 1 es barata (unas lecturas y una escritura) y **confirma antes del paso 3**. N peticiones concurrentes serializan ahí; sólo las 10 primeras reciben `allowed: true`. Los conflictos y reintentos afectan a una transacción barata, nunca al KDF.

### La revalidación del paso 4 no es opcional  *(I7 — cierra B-R3-1 de la ronda 3)*

Partir la autenticación abre una ventana entre el paso 1 (se lee el hash) y el paso 4 (se crea la sesión). Sin revalidar, esta secuencia crea una sesión válida con una contraseña **ya sustituida**:

1. `reserveLoginSlot` lee el hash actual.
2. El KDF valida la contraseña **antigua** correctamente.
3. En paralelo, `resetPasswordWithTicket` cambia `passwordHash` y borra todas las sesiones.
4. `finalizeLogin` recibe `ok: true` y crea una sesión **después** del reset.

Eso rompería la invariante que MIS-285 introdujo a propósito ("cambiar la contraseña invalida todas las sesiones"): sería una regresión causada por esta misma refactorización, no un defecto preexistente. De ahí I7.

- **Se compara una huella, no el hash.** `reserveLoginSlot` devuelve `SHA-256(passwordHash)` y `finalizeLogin` la recalcula sobre el usuario releído. Evita que el hash almacenado viaje por segunda vez en los argumentos de otra función (donde acabaría en trazas de funciones y logs de error), y la comparación es de longitud fija. Se compara con `constantTimeEqual`, por consistencia con el resto del módulo, aunque aquí no haya secreto que proteger por timing.
- **También cubre al usuario borrado** entre reserva y finalización: si `ctx.db.get(userId)` devuelve `null`, error genérico y sin sesión. Es la sugerencia no bloqueante de la ronda 3, plegada aquí porque es la misma relectura.
- **Por qué basta**: `finalizeLogin` es una única transacción que relee y escribe. O ve el hash viejo y confirma antes que el reset —y entonces el reset, al ejecutarse, borra también esta sesión recién creada—, o ve el hash nuevo y rechaza. No hay tercer resultado.
- **Falso negativo aceptado**: si el usuario cambia su contraseña justo mientras inicia sesión en otra pestaña, ese intento en vuelo falla y tiene que repetirlo. Es la dirección segura del error.

Detalles que hay que preservar y documentar:

- **Anti-timing intacto**: `reserveLoginSlot` devuelve `DUMMY_PASSWORD_HASH` (`convex/lib/password.ts:79`) cuando el usuario no existe, así que el coste del paso 3 es idéntico exista o no la cuenta.
- **El hash sale de la transacción** hacia la memoria de la action. Mismo límite de confianza (ambos son código del servidor de Convex) y `reserveLoginSlot` es `internalMutation`, no alcanzable desde fuera. Es una concesión consciente: es la única forma de sacar el KDF de la transacción.
- **La cuota de IP se consume al intentar, no al fallar** — es lo que hace que la reserva acote el trabajo. Consecuencia: los logins correctos también consumen. Con 10/15 min por IP no molesta a dos usuarios, ni siquiera compartiendo NAT de oficina.
- **Un login correcto no resetea el contador de IP**, sólo el de email. Se conserva el criterio ya documentado en `convex/auth.ts:71-79`: si bastara una credencial válida para limpiar la IP, un atacante con una cuenta propia limpiaría el contador y seguiría probando otras.
- **La action no se reintenta** (`at most once`). Para un login es irrelevante: el usuario reintenta.
- **Un único punto de entrada al KDF.** `verifyPassword` no se llama directamente desde la action: se envuelve en un helper que incrementa la instrumentación y **luego** deriva, de modo que sea imposible añadir un camino al KDF que no quede contado. Es la sugerencia de la ronda 4 y es lo que hace que la prueba de I5 siga siendo válida cuando el código evolucione.
- **Coste equivalente exista o no el usuario, también después del KDF.** `finalizeLogin` **no recibe `userId` ni hace `ctx.db.get`**: recibe el `emailKey` y hace siempre la misma consulta indexada `withIndex("by_email", …)`, exista o no la cuenta. Así el trabajo de base de datos es idéntico en ambos caminos sin necesidad de un `ctx.db.get(null)`, que no sería válido — es la precisión que pidió la ronda 5. Si la consulta no devuelve nada, se trata como huella no coincidente y se rechaza. Cierra la diferencia de tiempo posterior a la derivación; el hash señuelo ya cubría la anterior.
- **Sólo afecta a `login`.** Verificado que `resetPasswordWithTicket` llama a `hashPassword` **después** de validar el ticket (`convex/passwordReset.ts:242-252`), así que no es amplificable por un atacante sin ticket. `verifyResetCode` sólo hace SHA-256, que no es un KDF.
- **Lado Next.js y e2e**: `fetchMutation(api.auth.login, …)` → `fetchAction`, y en los tests `.mutation(...)` → `.action(...)`. Mecánico.

## 1B.3 Política de contraseñas y rotación de las existentes  *(I6 — cierra M7 de la ronda 2)*

Al quitar el veto por email, la fortaleza de la contraseña pasa a ser carga estructural. La ronda 2 señaló que aplicar la lista sólo a futuros cambios deja intactas las cuentas existentes, que son justo las que importan.

**Definición concreta de la política**, en un `convex/lib/passwordPolicy.ts` nuevo:
- Longitud 8–128 (como hoy).
- **Corpus versionado de ~10.000 contraseñas**, no ~200. La ronda 3 señaló con razón que una lista corta es irrisoria frente a los ~96.000 intentos/día que el propio plan acepta como riesgo: 200 entradas se agotan en segundos. Se toma un recorte de una lista pública conocida (tipo *rockyou* / *top-10k*), se versiona en el repo —nada de descargas en tiempo de ejecución— y se le añaden los términos del proyecto (`mistumonso`, `vibecoder`, `crm`, el dominio). Coste en el bundle: ~80 KB, irrelevante.
- **Normalización antes de comparar**: `trim`, minúsculas y colapso de dígitos finales (`Password123` y `password1` caen igual que `password`). Se documenta con ejemplos en el propio fichero, porque una lista sin normalización definida no es verificable.
- Se aplica en **todos** los puntos que fijan una contraseña: `resetPasswordWithTicket`, `scripts/hash-password.mjs` y cualquier alta futura. `testSupport.resetTestIdentity` genera 32 bytes aleatorios y nunca puede chocar, pero pasa por la misma función para que no exista un camino que la esquive.

### Marcador de rotación  *(cierra M-R3-1 de la ronda 3)*

El plan anterior proponía comprobar la rotación "comparando `_creationTime` / última modificación contra la fecha del despliegue". No sirve: `_creationTime` es la fecha de **creación**, Convex no expone un `updatedAt` por documento, y aunque lo hiciera, una modificación cualquiera (nombre, rol) no demuestra que se cambiara la contraseña. El gate era inverificable.

**Cambio de esquema** en `convex/schema.ts`, tabla `users`:

```ts
passwordPolicyVersion: v.optional(v.number()),  // versión de política con la que se fijó el hash actual
passwordChangedAt:     v.optional(v.number()),  // epoch ms, para telemetría y para M4
```

- `v.optional` a propósito: **la ausencia del campo es exactamente la señal "esta cuenta no ha rotado"**. No hace falta migrar nada para que el gate funcione desde el primer día.
- `passwordPolicyVersion` se escribe **en el mismo `ctx.db.patch` que `passwordHash`**, nunca por separado, y sólo después de que la contraseña haya pasado la validación. Atomicidad garantizada por la transacción; se documenta como invariante en `passwordPolicy.ts`.
- `CURRENT_PASSWORD_POLICY_VERSION` es una constante en `passwordPolicy.ts`. Endurecer la política en el futuro = subir la constante, y el gate vuelve a exigir rotación a todo el mundo. Ese es el motivo de usar una versión y no un booleano.
- El gate lo evalúa un `internalQuery` nuevo, `accountsPendingRotation()`, que devuelve las cuentas con `passwordHash` cuya `passwordPolicyVersion !== CURRENT`. Se ejecuta con `npx convex run` y debe devolver lista vacía.

**Rotación de las cuentas existentes, y el orden importa:**

1. Se despliega la política, el campo nuevo y su escritura atómica en todos los puntos de fijación.
2. **Cada cuenta con contraseña rota** por el flujo de recuperación, que ya funciona y que ahora valida contra el corpus.
3. `accountsPendingRotation()` devuelve **lista vacía**. Es una comprobación positiva sobre un campo escrito junto al hash, no una inferencia sobre fechas.
4. **Sólo entonces** se retira el veto por email (1B.4).

El paso 4 no es un commit: es **la última operación de la secuencia, y la ejecuta el ticket 1B-ii** como cambio de entorno. Mientras 2 y 3 no estén confirmados, el veto sigue puesto: es peor garantizar disponibilidad sobre una contraseña débil que mantener un bloqueo molesto sobre una fuerte.

## 1B.4 Retirar el veto por email  *(I4, A2 — último paso de la fase)*

### Por qué esto es un ticket aparte  *(cierra M-R4-2 de la ronda 4)*

La ronda 4 señaló que un solo PR no permite cumplir I6: si la política y la retirada del veto viajan juntas, el despliegue activa ambas a la vez y **no existe ventana en producción para rotar y verificar**. La única alternativa dentro de un PR sería desplegar a mano un commit intermedio sin mergear, un procedimiento que ni está definido ni es revisable.

Se aplican **las dos** correcciones que ofrecía el auditor, en capas:

**1. Separación en dos tickets.** 1B-i despliega motor, política y rotación con el veto **puesto**. 1B-ii lo retira. Cada uno con su rama, su PR y su despliegue.

**2. Interruptor operativo, como palanca de rollback.** El veto se controla con `LOGIN_EMAIL_VETO` en el entorno de Convex:

- **Ausente o cualquier valor distinto de `"off"` → veto ACTIVO.** La dirección segura es la de fallar hacia el bloqueo, igual que I2 falla hacia el 503. Un despliegue que se olvide la variable mantiene el comportamiento antiguo, no el nuevo.
- Retirar el veto no es un despliegue: es `npx convex env set LOGIN_EMAIL_VETO off`, tras confirmar el gate.
- **Rollback = volver a poner el veto**, con `env set` y efecto inmediato. Sin revert, sin redeploy, sin ventana. Es exactamente lo que pedía el auditor.
- El interruptor es **temporal**: una vez estable, se retira en la fase 3 y el veto desaparece del código. Se anota allí para que no quede como configuración permanente olvidada.

**Gate de entrada, en este orden:**

1. 1B-i desplegado y verificado en producción.
2. Todas las cuentas con contraseña rotadas por el flujo de recuperación.
3. `accountsPendingRotation()` en **producción** devuelve `[]`.
4. Sólo entonces, `LOGIN_EMAIL_VETO=off`.

### Comportamiento con el veto retirado

1. `isLocked(ip:<ip>)` → **sí veta**, evaluado en `reserveLoginSlot` antes de devolver el hash. Acota el coste (I5).
2. El contador por email **deja de consultar `isLocked`**. Se sigue registrando en `finalizeLogin` como telemetría, pero **nunca impide un intento**.
3. Contraseña correcta desde IP limpia → entra siempre, **siempre que el hash reservado siga vigente** (I7). Eso es I4.

**Consecuencia asumida:** sin veto por cuenta, la resistencia a fuerza bruta distribuida depende del límite por IP y de la fortaleza de la contraseña. Un atacante con 100 IPs consigue ~96.000 intentos/día contra una cuenta. Con I6 cumplido es un riesgo aceptable para este MVP; sin I6 no lo es, y por eso 1B.3 va antes.

**B7 cae de propina**: sin bloqueo por email, `LOCKED_ERROR` desaparece de la respuesta de `login` y se unifica con `GENERIC_ERROR`. El bloqueo por IP también responde genérico; el motivo real sólo en logs.

---

# Fase 2 — Endurecimiento

## M1 — Acotar la longitud del email en `login`

`convex/passwordReset.ts:37-39` ya tiene `emailWithinLimits` (≤254) y lo aplica **antes** de tocar el rate limit; `convex/auth.ts:45` se quedó fuera y escribe un `emailKey` sin cota en `loginAttempts`, que está indexado.

Mover `emailWithinLimits` a `convex/lib/rateLimit.ts` y aplicarlo con la misma disciplina: rechazar con el error genérico **antes** de construir claves o consultar `isLocked` — el matiz que la ronda 1 de M13 falló y la ronda 2 corrigió (`passwordReset.ts:161-166`). Después de la comprobación de `serverKey`, que por I3 va siempre primero. Con 1B.2, el sitio es `reserveLoginSlot`.

## M3 — El ticket de reseteo pasa a cookie httpOnly

- `verifyResetCodeAction` escribe el ticket en cookie `httpOnly` + `secure` + `sameSite: "lax"`, `path: "/recuperar-contrasena"` y **`maxAge` de 15 min, igual que el TTL del ticket**. Nuevos helpers en `src/lib/auth/cookie.ts`, siguiendo el molde de `OAUTH_STATE_*`.
- `resetPasswordAction` lee de la cookie en vez del `FormData` y la borra tras el éxito, antes del `redirect`.
- `RecoverActionState` pierde `ticket`; el `<input type="hidden">` desaparece.
- **La API de Convex no cambia**, así que los call sites directos de los specs siguen valiendo.

## M4 — Avisar por email de un cambio de contraseña

- Nueva plantilla en `convex/lib/resend.ts` siguiendo el molde de `passwordResetCodeHtml` (escapado HTML incluido).
- Nuevo `internalAction` `deliverPasswordChangedNotice` vía `ctx.scheduler.runAfter(0, …)`, mismo patrón que `deliverResetCode`.
- Sin rate limit propio: sólo se dispara tras un cambio consumado, que exige ticket válido.
- Errores de envío: `console.error` sin destinatario ni contenido (`passwordReset.ts:100-102`).

---

# Fase 3 — Higiene

**Cookies (B1, B2)** — `secure` deja de depender de `NODE_ENV` y pasa al interruptor de entorno desplegado de 1A.3. Sesión a `__Host-session`: Next no valida el prefijo, así que hay que garantizar a mano `path: '/'`, `secure: true` y **sin `domain`**. La de OAuth no puede usar `__Host-` (su `path` es `/api/auth/google`); usa `__Secure-`.

**Contraseñas (B5)** — cota superior al campo `i=` que `verifyPassword` (`password.ts:68`) lee del hash. Hoy inalcanzable, pero `i=100000000` colgaría la función.

**Sesiones (B3)** — **ticket propio**. 30 días fijos, sin rotación, sin "cerrar sesión en todos los dispositivos", sin límite de concurrentes. La tabla ya tiene `by_user`.

**OAuth (B6)** — PKCE. La cookie de `state` ya da dónde guardar el `code_verifier`.

**CSP con nonce** — completar M2 (`docs/01-app/02-guides/content-security-policy.md:44-87`). Desactiva la optimización estática y es incompatible con PPR: decisión consciente pendiente.

**HSTS completo** — `includeSubDomains` y valorar `preload`, sólo tras inventariar subdominios.

**Limpieza de superficie**
- Retirar `ConvexClientProvider` (`src/components/ConvexClientProvider.tsx`, montado en `src/app/layout.tsx:34`): instancia un cliente Convex en el navegador que **nada usa**.
- Telemetría con `ctx.meta.getRequestMetadata().ip`: con I3 las llamadas directas deberían ser cero, y si no lo son hay que enterarse.
- Alerta sobre `LOGIN_EMAIL_COUNTER`, que es lo que le daría un consumidor real.
- **Retirar el interruptor `LOGIN_EMAIL_VETO`** y el veto del código, una vez 1B-ii lleve tiempo estable. Es temporal a propósito (ver 1B.4) y no debe quedarse como configuración permanente que nadie recuerda.
- B9: comprobar que `E2E_TEST_SUPPORT_KEY` no existe en prod dentro del procedimiento de despliegue; documentar rotación.
- B10: tope diario de emails de recuperación por cuenta.
- B11: los secretos del job e2e son accesibles a cualquier PR del repo; valorar un GitHub Environment con revisor.
- B12: normalización NFKC en `normalizeEmailKey`.
- Deployment de Convex exclusivo para CI.

---

# Verificación

## Automática

```
npm run lint
npm run build
npm run test:e2e
npm run test:e2e:secret-gate
```

**1A**: los cuatro tests de efecto lateral sin `serverKey`, con ventana de observación y control positivo en el de `requestPasswordResetCode`.

**1B**:

- **Bloqueo por IP**: 10 intentos con `ipHint: "203.0.113.42"` (IPv4 concreta de TEST-NET-3 — **no** notación CIDR, que `normalizeIpHint` descartaría dejando el test en falso verde) → el 11.º rechazado. Requiere añadir `ip:203.0.113.42` a `rateLimitKeysForTestIdentity()` (`convex/testSupport.ts:69-75`), que hoy evita a propósito tocar claves `ip:` por compartidas: la excepción es segura porque esa IP no es de nadie, y se documenta ahí.
- **I4**: contraseña correcta desde otra IP, justo después de agotar la primera.
- **I6**: el corpus rechaza las contraseñas de la lista en todo punto de fijación, y `accountsPendingRotation()` devuelve vacío.
- **I7 — la carrera del cambio de contraseña.** Es la prueba que exige B-R3-1 y necesita pausar el flujo entre el KDF y la finalización. Se hace con las piezas que la refactorización ya expone: llamar a `reserveLoginSlot` desde el test, **cambiar la contraseña en medio** con el flujo de recuperación completo, y sólo entonces llamar a `finalizeLogin` con la huella reservada y `ok: true`. Debe **no crear sesión** y devolver error genérico. `countSessionsFor()` (`convex/testSupport.ts:184`) lo confirma sin instrumentación nueva. Un segundo caso con el usuario borrado en medio cubre la otra mitad de la relectura.

  **Los envoltorios del harness llevan los tres cerrojos de MIS-286, no dos.** `reserveLoginSlot` y `finalizeLogin` son `internalMutation` y no se exponen: lo que el test llama son envoltorios nuevos en `convex/testSupport.ts` que exigen (1) `E2E_TEST_SUPPORT_KEY`, inertes en producción; (2) `assertDedicatedIdentity` — **sólo `RESET_TEST_EMAIL`**, nunca Carlos, Marta ni una cuenta real; y (3) para el caso del borrado, un envoltorio de borrado sujeto a las dos anteriores. Sin el cerrojo 2, el harness podría fabricar sesiones para cualquier cuenta: es justo la línea que `convex/testSupport.ts:52-56` ya traza y que estos envoltorios nuevos deben respetar igual.

### Instrumentación para I5  *(cierra M-R3-2 de la ronda 3)*

Contar filas de `loginAttempts` mide **reservas confirmadas, no derivaciones**. Un bug que ignorase `allowed: false` ejecutaría las 30 derivaciones y el contador seguiría marcando 10: falso verde sobre la garantía central contra A3. Y como la respuesta pública es genérica en ambos casos —y debe seguir siéndolo—, desde fuera son indistinguibles.

Se hace observable el **punto de entrada al KDF**, con los dos mismos cerrojos que ya protegen el outbox de MIS-286 y que esa auditoría dio por buenos:

- **Tabla propia `testKdfCounter`**, no una fila dentro de `testOutbox`. La ronda 4 señaló con razón que reutilizar `testOutbox` contaminaría `getLastResetCode()` (`convex/testSupport.ts:131-150`), que hoy hace `.collect()` sobre el índice `by_email` y devuelve la entrada más reciente: una fila contador se colaría como si fuera un código. Una tabla aparte no obliga a añadir discriminadores ni a filtrar consultas existentes.
- Se incrementa **dentro del helper que envuelve `verifyPassword`** (1B.2), nunca en el call site, para que no pueda existir una entrada al KDF sin contar.
- **`resetTestIdentity()` la vacía**, junto a códigos, sesiones y outbox (`convex/testSupport.ts:104-121`). Sin eso el contador arrastra derivaciones de la ejecución anterior y la prueba de cota deja de ser repetible — el mismo motivo por el que ese reseed existe y se ejecuta al inicio de cada spec, no en el cleanup.
- **Cerrojo 1**: inerte si `E2E_TEST_SUPPORT_KEY` no está en el entorno. En producción esa variable no existe (verificado en la auditoría original), así que el contador nunca se escribe.
- **Cerrojo 2**: sólo se incrementa cuando el email es `RESET_TEST_EMAIL`. Ninguna cuenta real genera escrituras.
- **La respuesta pública no cambia**: sigue siendo el error genérico en todos los casos. La instrumentación es un efecto lateral observable sólo por el harness autenticado.

Prueba: reseed, lanzar **30 intentos concurrentes** contra `203.0.113.42` con contraseña incorrecta, y comprobar que `testKdfCounter ≤ LOGIN_IP_LIMIT.maxAttempts`. Sin este contador, la prueba de concurrencia no demuestra I5.

**Dos limitaciones honestas**, ambas anotadas en el propio fichero de la instrumentación:

- El contador está atado a la clave del harness, así que en producción no existe. La prueba demuestra que **el camino de código** respeta la cuota; la garantía en producción descansa en que sea el mismo camino de código.
- El contador puede **sobrecontar** si el proceso cae entre el incremento y la derivación. El sesgo es conservador: sobrecontar sólo puede hacer *fallar* una prueba de cota superior, nunca aprobarla de más. No invalida la prueba.

## Manual contra producción

| # | Invariante | Prueba | Fase |
|---|---|---|---|
| 1 | I1 | Conectar **directamente al origen** (dominio, IP, lo que encuentre el spike) con `Host: mistu-monso.com` y un `CF-Connecting-IP` inventado → debe fallar. *Si llega a la aplicación, la fase no está hecha.* | 1A |
| 2 | I1 | Repetir contra `/_next/image?url=…` y contra una Server Action (POST a `/login`) → deben fallar igual. La sonda a `/_next/image` **se mantiene aunque el handler esté desactivado y el matcher ya lo cubra**: es la comprobación de que ambas cosas son ciertas, y el día que alguien reactive la optimización de imágenes esta prueba es la que lo detecta | 1A |
| 3 | I1 | A través de Cloudflare, enviar un `X-Origin-Auth` y un `CF-Connecting-IP` propios → la app debe ver los de Cloudflare, no los del cliente. Confirma el `Set` de la Transform Rule y la sobreescritura de la IP | 1A |
| 4 | I2 | Matriz de 1A.3, retirando una variable cada vez | 1A |
| 5 | I3 | Las 5 funciones con clave incorrecta contra Convex directo: ningún token, ningún código, ningún ticket consumido | 1A |
| 6 | — | CSP en enforcement: login, Google, recuperación completa y una Server Action con la consola abierta, cero violaciones. Y `curl -sI` con las cabeceras | 1A |
| 7 | — | **Migración de endpoint sin caída**: tras el paso 1 de 1A.5 (Convex con las dos funciones) y antes del paso 2, el login **sigue funcionando**. Y otra vez entre el 2 y el 4 | 1A |
| 7b | **I3** | Tras desplegar 1A-bis: `auth:login` **ya no existe** — la llamada falla por *función no encontrada*, no por argumento inválido, y la distinción importa — y `loginWithPassword` sigue respondiendo. Es la prueba que cierra I3 | 1A-bis |
| 8 | I5 | 10 intentos fallidos → el 11.º rechazado. El burst concurrente y el conteo de derivaciones son automáticos: producción no lleva instrumentación | 1B-i |
| 9 | I7 | Con sesión abierta en un dispositivo, cambiar la contraseña por recuperación → la sesión antigua muere **y** un login iniciado antes del cambio no crea sesión | 1B-i |
| 10 | I6 | `npx convex run` de `accountsPendingRotation()` en **producción** → `[]`. Es el gate que autoriza 1B-ii, y se ejecuta **antes** de tocar `LOGIN_EMAIL_VETO` | 1B-i |
| 11 | I4 | Con `LOGIN_EMAIL_VETO=off`: agotar la cuota de una IP y entrar con la contraseña correcta **desde otro origen** (móvil con datos, no wifi). Debe entrar. Es la prueba de A2 | 1B-ii |
| 12 | — | **Rollback del veto**: `LOGIN_EMAIL_VETO` de vuelta a activo → el bloqueo por email vuelve, sin redeploy | 1B-ii |
| 13 | — | Carlos y Marta con contraseña y con Google; recuperación de punta a punta con email real | todas |
| 14 | — | Cloudflare en Full (strict) y el sitio sigue sirviendo | 1A |
| 15 | — | Rotar `ORIGIN_SHARED_SECRET` con el mecanismo de clave doble, sin corte de servicio | 1A |

## Criterio de "hecho", por ticket

No es el mismo para todos, y la ronda 5 señaló con razón que exigir un `convex deploy` donde no cambia código es ceremonia vacía.

| Ticket | Cierra cuando |
|---|---|
| 1A | PR mergeado · Convex y Railway desplegados · pruebas manuales 1-7 pasadas · **la nota de cierre dice explícitamente "I3 pendiente hasta 1A-bis"** |
| 1A-bis | PR mergeado · **Convex desplegado** · `auth:login` ya no existe y `loginWithPassword` sigue respondiendo · **hora exacta de la retirada e identificador del despliegue** registrados en la nota de cierre · **I3 cumplida** |
| 1B-i | PR mergeado · Convex desplegado · pruebas 8-9 pasadas · todas las cuentas rotadas y `accountsPendingRotation()` → `[]` en producción (prueba 10) |
| 1B-ii | **No lleva despliegue de código.** PR con el runbook y la evidencia (salida del gate, antes y después) · `LOGIN_EMAIL_VETO=off` aplicado · pruebas 11-12 pasadas. **La evidencia no incluye valores de variables ni salidas que puedan revelar secretos**: se documenta qué variable se cambió y a qué estado, nunca el contenido de `AUTH_SERVER_KEY`, `ORIGIN_SHARED_SECRET` ni ninguna otra |
| 2, 3 | PR mergeado · ticket enlazado · **Convex desplegado a producción** |

El despliegue de Convex es el paso que se ha caído 4 veces, la última en MIS-285: donde aparece en esta tabla, es condición de cierre, no un recordatorio.

---

# Respuesta a la ronda 5

Sin blockers. Un major de proceso.

| # | Hallazgo | Qué cambió |
|---|---|---|
| M-R5-1 | La retirada de `auth.login` no tenía unidad desplegable | **Ticket 1A-bis nuevo**, con PR y despliegue de Convex propios — la primera de las dos opciones del auditor. Se descarta la de desplegar un commit sin mergear: el proyecto no tiene procedimiento para eso y sería justo el tipo de paso manual e irrevisable que ya se ha caído 4 veces con el despliegue de Convex. **I3 pasa a cumplirse al cerrar 1A-bis, no 1A**, y así queda escrito en la definición de la invariante, en la tabla de la migración, en el criterio de cierre de 1A y en la prueba 7b. Cuatro salvaguardas para que no se olvide: se crea en el Paso 0 con la dependencia marcada, test automático de que la función ya no existe, hora de retirada en la nota de cierre, y el cierre de 1A obligado a decir "I3 pendiente". |
| — | Los tests deben nombrar `loginWithPassword` | Corregido en 1A.8: los 17 call sites apuntan al endpoint nuevo. Se explicita que `auth.login` conserva su firma vieja sin `serverKey` para no romper el frontend durante la ventana, así que **no acepta el contrato nuevo y ningún test debe apuntarle** — el único que lo menciona es el de 1A-bis, para comprobar que ya no está. |
| — | 1B-ii no debería exigir `convex deploy` | Adoptado. **Criterio de cierre por ticket**, en tabla: 1B-ii es sólo `env set` + PR de runbook y evidencia. Exigir un despliegue donde no cambia código es ceremonia vacía. |
| — | Comprobación automática de que el endpoint viejo ya no está | Test en 1A-bis. Vive ahí y no en 1A porque durante 1A debe fallar al revés. |
| — | `ctx.db.get(null)` no es válido | `finalizeLogin` ya no recibe `userId`: recibe `emailKey` y hace **siempre la misma consulta indexada `by_email`**, exista o no la cuenta. Trabajo idéntico en ambos caminos sin ningún `get` sobre nulo. |
| — | Hora de retirada auditable | En la nota de cierre de 1A-bis. |
| — | `testKdfCounter` debe reiniciarse en `resetTestIdentity()` | Adoptado, con el motivo: sin eso el contador arrastra derivaciones de la ejecución anterior y la prueba de cota deja de ser repetible. |

# Respuesta a la ronda 4

Sin blockers. Dos majors, ambos de secuencia de despliegue.

| # | Hallazgo | Qué cambió |
|---|---|---|
| M-R4-1 | `mutation` → `action` rompe el login en ambos órdenes de despliegue | **1A.5, bloque nuevo.** Se adopta el endpoint versionado, pero **una sola vez y en 1A**, no en 1B: el mismo razonamiento del auditor aplica a 1A —añadir un argumento obligatorio rompe igual en los dos sentidos— y la ronda 3 lo despachaba como "ventana corta pero real". Mantener dos ventanas de caída en dos fases ya no se sostenía. El endpoint se llama **`auth.loginWithPassword`**, simétrico con `loginWithGoogle`, en vez de un `V2` que habría que limpiar. Se publica **ya como action** en 1A —aunque 1A no lo necesite— para que **1B sea un cambio puramente interno, sin ventana ni coordinación**. Tabla de 4 pasos con el estado del login en cada uno, y prueba manual 7. |
| M-R4-2 | Un solo PR no permite cumplir I6 antes de retirar el veto | Se aplican **las dos** opciones del auditor, en capas: **1B se parte en 1B-i y 1B-ii** (cinco tickets en total), y el veto pasa a un interruptor `LOGIN_EMAIL_VETO` en el entorno de Convex que **por ausencia o valor desconocido queda ACTIVO**. Retirarlo es un `env set`, no un despliegue; el rollback es volver a ponerlo, con efecto inmediato y sin revert. El interruptor es temporal y se retira en la fase 3. |
| — | `testKdfCounter` en tabla propia | Adoptado, con el motivo: una fila contador dentro de `testOutbox` se colaría en el `.collect()` de `getLastResetCode()` (`testSupport.ts:131-150`) como si fuera un código. |
| — | Un único punto de entrada al KDF | `verifyPassword` se envuelve en un helper que cuenta y luego deriva; la action nunca lo llama directo. Imposible añadir un camino sin contar. |
| — | El harness de I7 debe acotarse a la identidad dedicada | Explicitado: los envoltorios nuevos llevan **los tres cerrojos**, incluido `assertDedicatedIdentity`. Sin él, el harness podría fabricar sesiones para cualquier cuenta. |
| — | Trabajo equivalente en `finalizeLogin` | `finalizeLogin` relee y compara en ambos casos en vez de cortocircuitar con `userId` nulo, cerrando la diferencia de tiempo posterior al KDF. |
| — | El contador puede sobrecontar | Documentado, con el argumento de que el sesgo es conservador para una cota superior. |

# Respuesta a la ronda 3

Ronda acotada a tres puntos de 1B. 1A quedó cerrada y no se ha tocado.

| # | Hallazgo | Qué cambió |
|---|---|---|
| B-R3-1 | `finalizeLogin` podía crear sesión con la contraseña ya sustituida | **I7 nueva** y bloque de revalidación en 1B.2. `reserveLoginSlot` devuelve `userId` + `SHA-256(passwordHash)`; `finalizeLogin` relee al usuario en su propia transacción y exige que la huella coincida, o no crea sesión. Se compara la huella y no el hash para que el hash no viaje una segunda vez por argumentos de función. Cubre también el usuario borrado en medio (sugerencia no bloqueante, plegada aquí por ser la misma relectura). Prueba de la carrera en la verificación automática, usando las piezas que la propia refactorización expone y `countSessionsFor()`. Se hace constar que era una **regresión introducida por esta refactorización**, no un defecto preexistente. |
| M-R3-1 | I6 sin marcador fiable de rotación | Campos nuevos `passwordPolicyVersion` y `passwordChangedAt` en `users`, `v.optional` a propósito para que **la ausencia sea la señal de "no rotada"** y no haga falta migrar. Se escriben **en el mismo `patch` que `passwordHash`** y sólo tras validar. Gate = `accountsPendingRotation()` devuelve vacío; se usa versión y no booleano para que endurecer la política vuelva a exigir rotación. Retirada la comprobación por fechas, que era inverificable. |
| M-R3-2 | La prueba concurrente no observaba derivaciones reales | Contador de entradas al KDF con **los dos cerrojos ya auditados de MIS-286** (clave del harness ausente en producción + identidad dedicada). La respuesta pública sigue siendo genérica. Se hace constar la limitación: demuestra el camino de código, no el binario de producción. |
| — | Corpus de contraseñas demasiado corto | De ~200 a **~10.000**, recorte versionado de una lista pública. Con ~96.000 intentos/día aceptados, 200 entradas se agotan en segundos. |
| — | Rotación de `ORIGIN_SHARED_SECRET` con corte | Clave doble: el proxy acepta también `ORIGIN_SHARED_SECRET_NEXT` durante la rotación. Prueba 13. |
| — | `finalizeLogin` y usuarios borrados | Plegado en la revalidación de I7. |
| — | `/api/health` no debe crecer | Invariante documentada en la propia ruta. |
| — | Mantener la sonda a `/_next/image` | Conservada, con el motivo: detecta que alguien reactive la optimización de imágenes. |

# Respuesta a la ronda 2

| # | Hallazgo | Qué cambió |
|---|---|---|
| B3 | El límite por IP no acota el PBKDF2 concurrente | **1B.2 nuevo.** `login` pasa de `mutation` a `action` con reserva de cuota en una transacción que **confirma antes** del KDF. Se argumenta por qué ninguna garantía de aislamiento habría bastado — la serializabilidad fija el estado final, no impide el trabajo — y se hace constar que el paquete vendido de Convex no documenta ninguna. Prueba de concurrencia añadida. |
| M6 | El mecanismo A no cubre `/_next/image` | **1A.2 nuevo.** Verificado que `next/image` no se usa en el proyecto, así que el handler **se elimina** (`images: { unoptimized: true }`) en vez de protegerse. El matcher pasa a excluir sólo `_next/static` y `favicon.ico`. Las excepciones a I1 quedan **tabuladas y justificadas una a una**, con `/api/health` como única excepción dinámica. |
| M7 | B4 no cubre las contraseñas existentes | **1B.3 nuevo.** Política concreta (lista versionada, normalización con ejemplos), aplicada en todos los puntos de fijación, y **rotación obligatoria de las cuentas existentes antes** de retirar el veto. El orden es explícito: el veto se retira en 1B.4, el último paso de la fase. |
| M8 | La verificación fail-closed no cubría I2 | **Matriz de 4 casos en 1A.3**, tres variables en Railway más `AUTH_SERVER_KEY` en Convex, cada una con el resultado exigido. |
| — | `Set` vs `Add` en la Transform Rule | Especificado en 1A.1, con el motivo, y prueba 3 de la verificación manual. |
| — | Secretos de 32 bytes y rotación conjunta | 1A.1. |
| — | Falso verde del scheduler en la prueba negativa | 1A.8: ventana de observación **más control positivo**. |
| — | Contradicción de `assertServerKey` | 1A.5: `serverKeyMatches` devuelve booleano y cada función produce su propio error genérico; `assertServerKey` queda como envoltorio que lanza, para `testSupport`. |
| — | `LOGIN_EMAIL_COUNTER` es sólo telemetría | 1B.1 lo dice explícitamente y aclara que M4 no lo consume. |
| — | Health checks de Railway | **1A.4 nuevo**, con `/api/health` exenta y `healthcheckPath` declarado en `railway.json`. |
| — | Partir la fase 1 | Adoptado: **1A** perímetro, **1B** rate limiting y credenciales, con dependencia marcada en Linear. |

# Respuesta a la ronda 1

| # | Hallazgo | Qué cambió |
|---|---|---|
| B1 | El origen Railway no queda autenticado | Cabecera de origen con secreto compartido como raíz de la confianza, elegida porque no depende de capacidades de Railway. Cerrar el origen es defensa en profundidad y depende del spike, ahora obligatorio. `Host` baja a higiene. |
| B2 | La ausencia de variable desactivaba la defensa | Condición afirmativa de entorno: en producción, faltar una variable devuelve 503. |
| M1 | Contrato de `serverKey` sin orden ni cobertura | I3 fija "primera sentencia"; tabla de efectos laterales prohibidos por función; contrato ante clave ausente resuelto; un test por función sobre el efecto lateral. |
| M2 | 50/hora seguía permitiendo expulsar al usuario | Se elimina el veto por email; I4 es invariante con prueba propia; B4 sube a la fase 1. |
| M3 | Una constante no puede servir a dos flujos | Cinco constantes separadas, verificado en el código. |
| M4 | La CSP bloquearía los scripts de Next | `script-src` explícito; validación en enforcement, no "la cabecera existe". |
| M5 | `203.0.113.0/24` no es un `ipHint` válido | `203.0.113.42`, con nota de por qué el CIDR daría falso verde. |

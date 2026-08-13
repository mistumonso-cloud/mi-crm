# MIS-295 — Ejecutor seguro de verificación de login

Herramienta de operaciones que corre las **pruebas 11-12** de MIS-291 (retirada del
veto por email) contra un deployment de Convex, con secretos fuera de `argv`,
preflight fail-closed, y recuperación verificada ante excepción y señales.

## Ficheros

- `core.mjs` — lógica pura (sin imports de Convex); toda la E/S entra por adaptadores
  inyectados. Es lo que testean los unitarios.
- `index.mjs` — entrypoint: cablea Convex por HTTP (`ConvexHttpClient`) y el CLI de
  Convex por subproceso, gestiona señales y sanea la salida.
- `core.test.mjs` — tests unitarios (`node:test`) con adaptadores falsos.

Instalación (la hace MIS-295 tras el GO de código): copiar los tres a
`scripts/login-verify/` **byte a byte**, y añadir a `package.json`:
`"test:unit": "node --test scripts/login-verify/"`.

## Uso

Desde la raíz del repo. Los secretos entran por **STDIN, exactamente 2 líneas**:
línea 1 = contraseña de `carlos@test.local`; línea 2 = `AUTH_SERVER_KEY` del
deployment. Nunca se pasan por `argv` ni se escriben a disco.

```sh
# Producción (MIS-291): exige --confirm prod
printf '%s\n%s\n' "$PASSWORD" "$AUTH_SERVER_KEY" | \
  node scripts/login-verify/index.mjs --prod --confirm prod

# Deployment preview desechable (integración), restaura el estado inicial
printf '%s\n%s\n' "$PASSWORD" "$AUTH_SERVER_KEY" | \
  node scripts/login-verify/index.mjs --deployment <name> --mode preview --confirm <name>
```

### Argumentos

- `--prod` | `--deployment <name>` — **destino único**. La URL HTTP se deriva del
  MISMO selector (`convex env get CONVEX_CLOUD_URL <selector>`): HTTP y CLI no pueden
  apuntar a deployments distintos.
- `--confirm <token>` — **obligatorio siempre** (prod y preview). Debe igualar el nombre
  del selector: `--confirm prod` con `--prod`, o `--confirm <name>` con `--deployment <name>`.
  (Con `--prod` el token es literalmente `prod`; el selector no contiene el nombre físico
  del deployment.)
- `--mode prod|preview` — por defecto `prod`. `prod` deja `LOGIN_EMAIL_VETO=off` (estado
  deseado de MIS-291). `preview` restaura exactamente el estado inicial. **`--prod` NO admite
  `--mode preview`**: preview exige un `--deployment <name>` desechable.
- `--email <email>` — **solo se permite en `--mode preview`**; en prod queda fijado a
  `carlos@test.local` para no poder dirigir la operación contra una cuenta arbitraria.
- No se admiten selectores ni opciones **duplicados**.

## Códigos de salida

| Código | Significado |
|--------|-------------|
| `0`    | Todas las pruebas OK; estado final correcto. |
| `1`    | Alguna prueba (11/12) falló; recuperación aplicada. |
| `2`    | **Aborto de arranque fail-closed, SIN efectos**: argumentos/stdin inválidos, no se pudo resolver el deployment, gate ≠ `[]`, veto ya off, falta confirmación, o login base fallido. |
| `3`    | Recuperación fallida: **exige intervención manual** (`convex env set LOGIN_EMAIL_VETO off <selector>`). |
| `130`/`143` | Interrumpido por SIGINT/SIGTERM; recuperación aplicada (veto en off). |

## Propiedades de seguridad

- **Secretos fuera de argv:** contraseña y `AUTH_SERVER_KEY` viajan en el **cuerpo HTTP**
  (`loginWithPassword`/`logout`); el CLI solo recibe `off`/`activo` (no secretos).
- **Preflight fail-closed:** aborta sin efectos si el gate `accountsPendingRotation()` ≠ `[]`,
  si el veto no está activo, si la CLI es indeterminada, si falta la confirmación de prod, o
  si el login base no tiene éxito.
- **Lectura focalizada:** `env list --names-only` para presencia y, solo si aparece,
  `env get LOGIN_EMAIL_VETO`; nunca se captura el valor de otras variables del deployment.
- **Recuperación única y ordenada:** una `recoveryPromise` memoizada espera a la transición
  en vuelo antes de escribir `off`, así una señal a mitad de un `env set` no deja el veto activo.
- **Sin token en la salida:** el resultado se clasifica a `{success, error}`; el token solo
  circula en memoria para cerrar la sesión (`logout`). La salida se sanea contra los secretos.

## Límites documentados (no recuperables)

- **SIGKILL, corte de energía o pérdida persistente de red** no permiten completar la
  recuperación: pueden dejar el veto activo. Mitigación manual: `convex env set LOGIN_EMAIL_VETO off <selector>`.
- **Interrupción durante el preflight**, entre el login base y su `logout`, puede dejar una
  sesión no cerrada. No afecta a la configuración ni habilita acceso; caducará sola.
- En **modo preview**, una excepción durante la secuencia deja el veto en `off` (vía
  `safeRecover`) en lugar de restaurar el estado inicial de `finalState`. Aceptable por ser un
  deployment desechable.
- **`logout` es best-effort:** cerrar la sesión creada por un login correcto no invalida la
  prueba si falla (la sesión caduca sola); nunca se imprime el token. El preflight **no**
  aborta por un fallo de `logout` del login base (sí por un login base sin éxito).

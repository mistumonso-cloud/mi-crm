# MIS-291 — Runbook Fase 1B-ii: retirar el veto por email (cierra I4 / A2)

> **LISTO PARA EJECUTAR.** La verificación (pruebas 11-12) y el cambio de estado los
> realiza el **ejecutor seguro de MIS-295** (`scripts/login-verify/`), ya mergeado en
> `main` (PR #54). MIS-291 se limita a: correr ese ejecutor contra prod, capturar su
> evidencia y confirmar el estado final. **Ticket operativo, sin despliegue de código
> de producto.** Diseño: plan maestro `PLANS/PLAN-CORRECCION-SEGURIDAD-LOGIN-2026-08-10.md` §1B.4.
>
> **Historial:** el intento previo de automatizar 11-12 con bash + `npx convex run` fue
> NO-GO (B2: secretos en argv, sin arreglo con `convex run`). Se dividió: el ejecutor
> seguro pasó a **MIS-295** (plan GO ronda 4; código GO ronda 2; mergeado 2026-08-13).
> Este runbook lo consume.

## Contexto

Con I1/I2 (MIS-288), I3 (MIS-289) e I5/I6/I7 (MIS-290) ya vivos en producción, queda
**retirar el veto por email**. Ese veto (5 fallos por `<email>` → bloqueo 15 min) es la
invariante **I4/A2**: hoy es un vector de **DoS dirigido** (dejar fuera a un usuario
legítimo fallando 5 veces contra su email). Con la cuota por IP (I5) acotando el KDF, el
veto por email no aporta defensa y sí riesgo. El interruptor es **fail-safe**:
`LOGIN_EMAIL_VETO` ausente o ≠`off` → veto **ACTIVO**; retirarlo = ponerlo a `off`.

## Gate de entrada (en orden)

1. MIS-290 desplegado y verificado en prod — ✅ (`greedy-tapir-20`, PR #53).
2. Cuentas con contraseña rotadas — ✅.
3. `accountsPendingRotation()` en **prod** = `[]` — ✅ (`npx convex run auth:accountsPendingRotation --prod` → `[]`).
   El propio ejecutor lo revalida en su preflight fail-closed (aborta sin efectos si ≠`[]`).
4. Sólo entonces se corre el ejecutor (que aplica `LOGIN_EMAIL_VETO=off`).

## Cómo funciona el interruptor (para leer la evidencia)

`convex/lib/rateLimit.ts:101` — `emailVetoActive()` = `process.env.LOGIN_EMAIL_VETO !== "off"`.
Con veto **on**: `reserveLoginSlot:85` corta ANTES del KDF si `<email>` está bloqueada
(`LOCKED_ERROR`), y `finalizeLogin:179` registra el fallo (5/15 → bloqueo). Con veto
**off**: ninguno actúa; solo quedan la cuota por IP (I5) y la telemetría
`login-counter:<email>` (que no bloquea). Constantes (`auth.ts:30-31`): bloqueo =
`"Demasiados intentos, inténtalo de nuevo en unos minutos"` (`LOCKED_ERROR`); genérico =
`"Email o contraseña incorrectos"` (`GENERIC_ERROR`).

**Sustitución deliberada de la prueba 11:** el ejecutor llama al login **sin `ipHint`**,
lo que aísla la clave de email de la cuota por IP (`auth.ts:201`) — variante equivalente
para I4 de la "agotar IP + entrar desde otra" del plan maestro.

## Ejecución

Desde la raíz del repo, en `main` con `scripts/login-verify/` presente. Los secretos
entran por **STDIN, 2 líneas** (contraseña de `carlos@test.local` + `AUTH_SERVER_KEY`).
Manejo de secretos, reproducible y auto-limpiante:

- `SCRATCH` = directorio de scratchpad de sesión (`umask 077`). La contraseña se coloca
  **aparte** en `"$SCRATCH/carlos_pw"` (fichero regular, **`chmod 600`**, sin salto final);
  el runbook **valida** que existe, es regular y es `600` antes de usarlo.
- `set +x` explícito: nunca trazar valores expandidos.
- `AUTH_SERVER_KEY` se lee en caliente de Convex prod a la variable `KEY`, **nunca a disco**.
- La contraseña y `KEY` se pasan al ejecutor **por STDIN** con `printf` (builtin de bash →
  no hay proceso externo cuyo `argv`/`/proc` los exponga; con `set +x` tampoco se imprimen).
  La propiedad garantizada es que **ningún secreto aparece en los argumentos de ningún
  proceso**: se ejecutan también `npx`, `stat`, `grep`, `tee`, `shred`, `git` y `date`, pero
  ninguno recibe secretos por `argv` (los flags de `node` no son secretos).
- Todo corre en una **subshell acotada** `( … )` con `trap cleanup EXIT` armado antes de la
  primera validación: al cerrar el paréntesis se ejecuta `shred` del fichero y `unset PW KEY`,
  en éxito y en error, sin depender de que salga la shell interactiva y sin interferir con la
  recuperación de señales del propio ejecutor. `PW` se lee con el builtin `"$(<"$PW_FILE")"`
  (sin proceso externo). **Nota:** `shred` es borrado **best-effort** — en SSD, CoW o con
  snapshots no garantiza borrado físico; la mitigación real es no persistir la contraseña más
  de lo imprescindible (fichero efímero en scratchpad de sesión).

Se ejecuta como **una única subshell Bash acotada** `( … )`: el `EXIT` —y por tanto la
limpieza— ocurre al cerrar el paréntesis, con el `trap` armado **antes** de cualquier
posible salida, y `PW`/`KEY` son locales a la subshell (no quedan en la shell padre). **No
pegar línea a línea en una shell persistente.**

```sh
( set +x                                    # nunca trazar secretos
  umask 077
  : "${SCRATCH:?define SCRATCH al scratchpad de sesión}"
  PW_FILE="$SCRATCH/carlos_pw"              # contraseña colocada aquí aparte, sin salto final
  REPORT="$SCRATCH/mis291-report.json"
  cleanup() { shred -u "$PW_FILE" 2>/dev/null || rm -f "$PW_FILE"; unset PW KEY; }
  trap cleanup EXIT                          # armado ANTES de la primera validación/salida

  [ -f "$PW_FILE" ] && [ "$(stat -c '%a' "$PW_FILE")" = 600 ] || { echo "PW_FILE ausente o no 600"; exit 1; }
  PW="$(<"$PW_FILE")"                        # lectura builtin de bash (sin proceso externo)
  KEY="$(npx convex env get AUTH_SERVER_KEY --prod)" || { echo "no se pudo leer AUTH_SERVER_KEY"; exit 1; }
  [ -n "$PW" ] && [ -n "$KEY" ] || { echo "faltan secretos"; exit 1; }
  COMMIT="$(git rev-parse --short HEAD)" || { echo "git rev-parse falló"; exit 1; }

  # Evidencia inicial FAIL-CLOSED: fallo de CLI NO se clasifica como ausencia; y el veto
  # DEBE estar activo (ausente, o presente con valor ≠ off).
  names="$(npx convex env list --names-only --prod)" \
    || { echo "env list falló: estado inicial indeterminado — abortar"; exit 1; }
  if grep -qx LOGIN_EMAIL_VETO <<<"$names"; then
    init="$(npx convex env get LOGIN_EMAIL_VETO --prod)" || { echo "env get inicial falló — abortar"; exit 1; }
    echo "inicial: LOGIN_EMAIL_VETO presente; valor=$init"
    [ "$init" != off ] || { echo "el veto ya está off: precondición inválida"; exit 1; }
  else
    echo "inicial: LOGIN_EMAIL_VETO ausente (veto activo)"
  fi

  # Ejecutar; exigir éxito de Node Y de tee (PIPESTATUS capturado en UNA sola sentencia):
  printf '%s\n%s\n' "$PW" "$KEY" | node scripts/login-verify/index.mjs --prod --confirm prod | tee "$REPORT"
  st=("${PIPESTATUS[@]}")                    # [0]=printf [1]=node [2]=tee
  [ "${st[1]}" -eq 0 ] || { echo "ejecutor NO devolvió 0 (code=${st[1]})"; exit "${st[1]}"; }
  { [ "${st[2]}" -eq 0 ] && [ -s "$REPORT" ]; } || { echo "no se pudo guardar el report"; exit 1; }

  # Postcondición OBLIGATORIA: estado final EXACTAMENTE off, con código verificado.
  final="$(npx convex env get LOGIN_EMAIL_VETO --prod)" || { echo "env get final falló — abortar"; exit 1; }
  [ "$final" = off ] || { echo "postcondición fallida: LOGIN_EMAIL_VETO=$final (esperado off)"; exit 1; }

  # Solo tras verificar Node + tee + report + postcondición off: sello de éxito.
  echo "OK final: LOGIN_EMAIL_VETO=off commit=$COMMIT deployment=greedy-tapir-20 ts=$(date -u +%FT%TZ)"
)
```

El ejecutor, en una sola pasada (todo verificado y auditado en MIS-295):

1. **Preflight fail-closed:** gate `accountsPendingRotation()`==`[]`, veto inicial **activo**,
   y un **login base correcto** (credenciales + canal). Si algo falla → **código 2, sin efectos**.
2. **Prueba 11 ANTES:** 5 fallos + correcto → `locked`.
3. `env set LOGIN_EMAIL_VETO off` (+ verifica `off`).
4. **Prueba 11 DESPUÉS:** correcto → `success`.
5. **Prueba 12 rollback:** `env set` activo + **regenera** bloqueo (5 fallos) + correcto → `locked`.
6. **Estado final:** `env set off` (+ verifica) + login correcto. Deja `LOGIN_EMAIL_VETO=off`.

Con recuperación única ante excepción/señal (`recoveryPromise`), que garantiza `off` como
estado final **ante errores y señales recuperables** (SIGKILL, corte eléctrico y pérdida
persistente de red quedan documentados como límites no recuperables en MIS-295; mitigación
manual: el rollback de abajo). **Salida:** `{ ok: true, report: [...] }` por stdout (sin
secretos ni token), **código 0** si todas las pruebas pasan.

## Evidencia (sin secretos)

Se captura, antes y después: el estado del interruptor (`env list --names-only` para la
ausencia inicial; `env get LOGIN_EMAIL_VETO --prod` para el valor final), el **`report`
JSON** del ejecutor (pasos y clasificación `locked`/`success`) y el **código de salida de
esa misma ejecución**. Junto al report se registra el **sello de ejecución**:
`commit` de `main` (`git rev-parse --short HEAD`), `deployment` (`greedy-tapir-20`) y
`timestamp` UTC, para vincular la evidencia a la corrida exacta. Nunca valores de
`AUTH_SERVER_KEY`, `ORIGIN_SHARED_SECRET`, contraseñas ni tokens.

| Paso | Acción | Esperado | Resultado |
|------|--------|----------|-----------|
| Gate | `accountsPendingRotation()` prod | `[]` | ✅ `[]` |
| Antes | `env list --names-only` (+ `env get` si presente) | ausente, o valor ≠`off` (veto activo) | _pendiente_ |
| Ejecutor | `report` prueba 11 ANTES | `locked` | _pendiente_ |
| Ejecutor | `report` prueba 11 DESPUÉS | `success` | _pendiente_ |
| Ejecutor | `report` prueba 12 ROLLBACK | `locked` | _pendiente_ |
| Ejecutor | `report` FINAL + código de salida | `success` / `0` | _pendiente_ |
| Después | `env get LOGIN_EMAIL_VETO` | `off` | _pendiente_ |

## Criterio de cierre

- Gate `accountsPendingRotation()` prod = `[]` ✅.
- Ejecutor con **código 0** y `report` con 11-ANTES=`locked`, 11-DESPUÉS=`success`,
  12-ROLLBACK=`locked`, FINAL=`success`.
- `env get LOGIN_EMAIL_VETO --prod` = `off` al final.
- Evidencia sin valores de secretos.
- **Follow-up B7 creado y enlazado** (ver abajo).
- PR doc-only (este runbook + evidencia) mergeado y enlazado en la issue.

## Rollback

Volver a poner el veto: `npx convex env set LOGIN_EMAIL_VETO <≠off> --prod` (o `env remove`).
Inmediato, sin revert de código ni redeploy. (La prueba 12 lo demuestra en vivo.)

## Deuda enviada a follow-up (B7)

Retirado el veto por email, un **bloqueo por IP** sigue devolviendo `LOCKED_ERROR`
(`convex/auth.ts:203`), lo que contradice la unificación con el genérico que afirma el plan
maestro. Es **deuda preexistente, no agravada por MIS-291**, y **no impide cerrar I4/A2**
(el oráculo por cuenta desaparece con el veto; el residuo es por IP). Queda **fuera del
alcance de MIS-291** → **ticket de código propio** (unificar `LOCKED_ERROR` de IP con
`GENERIC_ERROR`), a crear y enlazar **antes de cerrar** MIS-291.

# Plan — MIS-315: Retirar la lectura dual del ticket de reseteo (`__Secure-` y legado `reset_ticket`) tras la ventana de migración de MIS-312

## Context

MIS-312 renombró la cookie del ticket de reseteo a **`__Host-reset_ticket`** (path `/`) y dejó, **a propósito y de forma transitoria**, tres mecanismos de compatibilidad en `src/lib/auth/cookie.ts` para no romper recuperaciones/onboarding **en vuelo** durante el despliegue:

1. **Lectura dual** en `readResetTicketCookie`: cae al nombre anterior `__Secure-reset_ticket` si no está el `__Host-`.
2. **Expiración activa** de `__Secure-reset_ticket` (generación MIS-293→MIS-312) en `set`/`clear`.
3. **Expiración activa** del legado pre-B2 `reset_ticket` (sin prefijo) en `set`/`clear`.

El ticket tiene **TTL 15 min** (`RESET_TICKET_TTL_SECONDS`, duplicado a propósito del `TICKET_TTL_MS` de Convex). El deploy de MIS-312 a prod se completó el **2026-08-24 ~17:26 (hora local)**. Pasados >15 min, **ningún navegador conserva un ticket válido con los nombres antiguos** (los dos son de 15 min), por lo que los tres mecanismos son **código muerto**. MIS-315 los retira. Es limpieza: **no cambia el comportamiento para ningún usuario actual** (los tickets nuevos ya usan solo `__Host-`).

## Precondición (gate temporal)

Solo se codifica/despliega **después** de superar los 15 min desde el deploy de MIS-312 (2026-08-24 ~17:26 local → seguro a partir de ~17:41). Para cuando esto pase auditoría + código, está holgadamente cumplido. No requiere acción, solo confirmarlo.

## Cambios — `src/lib/auth/cookie.ts` (único fichero de producción)

1. **`readResetTicketCookie`** → retirar el fallback; queda:
   ```ts
   return cookieStore.get(RESET_TICKET_COOKIE_NAME)?.value ?? null;
   ```
   (idéntico al comportamiento pre-MIS-312: leer solo `__Host-reset_ticket`.)
2. **`setResetTicketCookie`** → eliminar las **dos** escrituras de expiración legada (`LEGACY_SECURE_RESET_TICKET_COOKIE_NAME` y `LEGACY_RESET_TICKET_COOKIE_NAME`). Queda solo el `set` de `__Host-reset_ticket` (path `/`, httpOnly/secure/lax, 15 min).
3. **`clearResetTicketCookie`** → igual: eliminar las dos expiraciones legadas; queda solo el `clear` de `__Host-reset_ticket` (path `/`).
4. **Borrar las constantes ahora sin uso**: `LEGACY_SECURE_RESET_TICKET_COOKIE_NAME` (L38), `LEGACY_RESET_TICKET_PATH` (L41) y `LEGACY_RESET_TICKET_COOKIE_NAME` (L30). **Verificado por grep**: se usan **solo** en estas tres funciones del ticket; NO las comparten las cookies de sesión/oauth (esas tienen `LEGACY_SESSION_COOKIE_NAME`/`LEGACY_OAUTH_STATE_COOKIE_NAME` propias, fuera de alcance).
5. **Comentarios**: recortar los comentarios de migración MIS-312 dentro de las funciones; en el bloque de nombres legados (L21-27) quitar `reset_ticket` de la lista de nombres aún transitorios (session + oauth_state siguen, con su propia ventana de 30 d / 10 min — no se tocan).

## Cambios — `src/lib/auth/constants.ts` (solo comentario)

- Actualizar el comentario de `RESET_TICKET_COOKIE_NAME` (L24-34): retirar la narrativa de "lectura dual transitoria / coexistencia durante la migración" (ya completada); **conservar** la explicación del invariante `__Host-` (Secure + Path=/ + sin Domain). El valor sigue siendo `"__Host-reset_ticket"`. Sin cambio de código.

## Cambios — `e2e/onboarding.spec.ts`

- **Eliminar los dos tests de migración**: `"migración (lectura dual)…"` y `"migración (transición)…"`. Siembran/asertan el comportamiento de los nombres antiguos (lectura dual y expiración), que dejará de existir → fallarían.
- **Conservar** el test happy-path de onboarding (usa solo `__Host-reset_ticket`).
- **Eliminar el helper `advanceToPasswordStep`** (queda sin uso: el happy-path hace sus pasos inline; solo lo usaban los dos tests eliminados). Conservar `freshPassword`, `waitForResetCode` (los usa el happy-path).
- Actualizar el comentario de cabecera (L1-11) para quitar la descripción de la migración.

## Seguridad / rollback

- **Anti-enumeración y flujo intactos**: no se toca `actions.ts` (las firmas de `set/read/clearResetTicketCookie` no cambian), ni Convex, ni el motor código→ticket.
- **Rollback seguro**: volver al build de MIS-312 (que hace `__Host-` ?? `__Secure-`) tras desplegar MIS-315 no reintroduce riesgo — los tickets con nombre antiguo son de 15 min y la ventana ya pasó; no hay ninguno válido que "resucitar". Las expiraciones activas retiradas son irrelevantes (no queda nada que expirar).

## Fuera de alcance

- Limpieza de las cookies legadas de **sesión/oauth** (`LEGACY_SESSION_COOKIE_NAME`, `LEGACY_OAUTH_STATE_COOKIE_NAME`): distinta ventana de retiro (regla de 30 d de MIS-293) y distinto TTL; no se tocan aquí.
- Sin cambios de backend/Convex. Sin cambios de comportamiento para usuarios nuevos.

## Verificación

1. `npm run lint` + `tsc` + `npm run build` en verde — un import/constante/helper sin usar lo cazaría el linter (no-unused-vars).
2. **e2e**: `password-reset.spec.ts` sigue verde (asserta `__Host-reset_ticket`, path `/`); el happy-path de `onboarding.spec.ts` sigue verde; los dos tests de migración ya no existen.
3. Lógica: recuperación y onboarding completan igual (post-MIS-312 solo usaban `__Host-`).

## Deploy (nota)

`cookie.ts` es **solo frontend** (Next.js). **No hay cambio en `convex/`** → esta vez **no hace falta deploy de Convex a prod**; Railway auto-despliega el frontend al mergear a `main`. (Recordar igualmente el gate del environment `ci` en el e2e.)

## Metodología / Gate

**Este plan NO es GO.** Pendiente de **auditoría de plan externa**; solo un veredicto **GO** explícito autoriza escribir código. Entregables: rama única `mis-315-…`, código en `CODIGO/MIS-315-…/` con `codigo-completo.md` autocontenido, PR enlazado a MIS-315.

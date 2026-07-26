# Gotchas — Vibe Coder CRM

Errores de sesión registrados con fecha, categoría, causa raíz y regla preventiva (regla
2 de `CLAUDE.md`). Los que alcanzan 3+ ocurrencias se promueven a "Errores Críticos" en
`CLAUDE.md`.

## 2026-07-20 — Git / instalación de código

`git mv` sobre archivos untracked falla ("no està sota control de versions"). Un script
con `set -e` que encadenaba varios `git mv` + un `rm -rf` posterior no se detuvo tras los
`git mv` fallidos, y el `rm -rf` borró la carpeta de staging entera, incluidos los
archivos que acababan de fallar al moverse.

**Regla preventiva**: al instalar código que mezcla archivos nuevos (untracked) y
editados (tracked), o se hace `git add` de los nuevos antes del `git mv`, o se usa
`cp` + `git add` en destino en vez de `git mv` para los untracked. Nunca encadenar un
`rm -rf` justo después de comandos cuyo éxito no se verificó de forma independiente.
(Promovido a Error Crítico 2 en `CLAUDE.md`.)

## 2026-07-20 — Convex

`npx convex codegen` dice en su `--help` que no modifica la deployment, pero en la
práctica sí sincroniza el schema/funciones actuales del disco contra la deployment de
dev conectada ("Uploading functions to Convex..."). No es un paso puramente local/
offline de generación de tipos.

**Regla preventiva**: tratar `codegen` como equivalente a un `convex dev --once` a
efectos de qué deployment toca. Si se usa para typecheckear código en staging antes de
auditoría, revertir el schema real y volver a correr `codegen` para dejar la deployment
como estaba.

## 2026-07-20 — Instalación de código (CODIGO/)

Borrar la carpeta `CODIGO/MIS-N-*/` justo al copiar los archivos a `src`/`convex` (en vez
de esperar al merge del PR) hizo perder el `CODIGO-COMPLETO.md` de referencia antes de
que existiera siquiera el PR.

**Regla preventiva**: la carpeta de staging de `CODIGO/` se queda en el árbol de trabajo
durante todo el ciclo (instalación + PR); solo se borra una vez el PR está mergeado a
`main` (es contenido local, nunca se commitea).

## 2026-07-22 — Git / push a main

Justo después de fusionar un PR (squash), un cambio "trivial" de un archivo README de
limpieza se commiteó y subió **directamente a `main`**, sin rama ni PR — la protección de
rama de GitHub lo dejó pasar por bypass de administrador en vez de bloquearlo.

**Regla preventiva**: la regla "nunca push a main sin PR" no tiene excepción de tamaño
—ni un cambio de una línea en un README cuenta como "demasiado pequeño para una rama".
Pedir confirmación explícita antes de cada `git push`, incluido un commit de seguimiento
trivial en una rama ya autorizada para pushear antes.

## 2026-07-23 — E2E (Playwright)

Selectores de "botón de enviar" sin acotar a su formulario chocaban con el botón de
logout en la misma pantalla (ambos coincidían con un selector genérico). Además, tras un
redirect de una Server Action, faltaba un `waitForURL` explícito antes de continuar el
test.

**Regla preventiva**: acotar siempre los selectores de submit al formulario/contenedor
concreto (no un selector global de "botón"), y usar `page.waitForURL(...)` después de
cualquier acción que dispare un redirect de servidor antes de aserciones que dependan de
la nueva ruta.

## 2026-07-26 — CI

El job `e2e` de GitHub Actions fallaba en todos los runs desde que se añadió porque
ninguno de los 5 secrets que necesita (`NEXT_PUBLIC_CONVEX_URL`,
`E2E_CARLOS_EMAIL`/`PASSWORD`, `E2E_MARTA_EMAIL`/`PASSWORD`) estaba configurado en el
repo de GitHub — no era un problema del workflow ni de los tests.

**Regla preventiva**: resuelto en MIS-258 (ver `PLANS/MIS-258-ci-secrets-e2e.md`). De
aquí en adelante, un `e2e` en rojo es señal real, no deuda conocida — investigar antes de
descartarlo.

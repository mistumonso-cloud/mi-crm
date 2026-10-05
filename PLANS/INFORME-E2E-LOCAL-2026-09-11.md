# Informe: estado de Playwright y de la suite e2e en local — 2026-09-11

**Tipo:** informe de solo lectura (diagnóstico). No se ha tocado código ni se ha creado ticket todavía. El plan de corrección, su auditoría y el flujo habitual (ticket → rama → PLANS → CODIGO → PR) vienen después, fallo a fallo, cuando se decida.

## 1. Resumen ejecutivo

- Playwright **ya estaba instalado y operativo** en el repo (nada que instalar): `@playwright/test` 1.61.1, Chromium descargado en `~/.cache/ms-playwright`, `playwright.config.ts` con 6 projects, 21 ficheros de spec en `e2e/` (99 tests), `.env.local` y `.env.test.local` presentes, apuntando al deployment de Convex de **dev** (`dev:dutiful-mole-111`).
- Se han creado **dos cuentas de prueba** en el deployment de dev (no en prod): `admin@test.local` (rol `supervisor` = nivel admin) y `usuario@test.local` (rol `rep` = usuario normal). Un smoke test de Playwright (2 tests, en verde) confirma que ambas entran y que el gating por rol funciona.
- La suite completa se ha ejecutado **tres veces** en esta máquina: 88/99, 10 fallos re-ejecutados aislados (10 fallos otra vez) y 87/99 con 11 fallos. Los fallos son **deterministas** (los mismos tests cada vez).
- **Causa raíz de 10 de los 11 fallos: la red de esta máquina, no el código.** RTT a Internet ≈ 700 ms (normal: 10–30 ms), handshake TLS ≈ 1,2 s, cada llamada a Convex ≈ 2 s. Las Server Actions encadenan varias llamadas y superan los tiempos de espera de los tests (5 s para `toBeHidden`, 30 s por test). Evidencia decisiva: la **misma suite pasó en verde en CI** en la PR de MIS-315, el último código mergeado en `main`.
- **Causa del fallo restante: la cuenta `admin@test.local` recién creada.** El test del guard "último admin" (`e2e/team-admin.spec.ts:84`) asume que en dev hay exactamente **una** supervisora activa (Marta); ahora hay dos.
- Hallazgo colateral: el job `e2e` de CI **nunca se ejecuta en `main`** tras un merge (queda en "waiting" por la aprobación del Environment `ci`, MIS-303). Solo se ejecuta en las PRs.

## 2. Estado de la instalación (verificado)

| Elemento | Estado |
|---|---|
| `@playwright/test` | 1.61.1 (package.json pide ^1.49.0) |
| Navegadores | chromium-1228, chromium_headless_shell-1228, ffmpeg-1011 |
| Config | `playwright.config.ts` (suite) + `playwright.gate.config.ts` (gate de fugas MIS-286) |
| Specs | 21 ficheros en `e2e/`, 99 tests, 1 skip intencional (`team-admin.spec.ts:236`) |
| Scripts npm | `test:e2e`, `test:e2e:report`, `test:e2e:secret-gate` |
| Entorno | `.env.local` (Convex dev, Google, AUTH_SERVER_KEY) y `.env.test.local` (E2E_CARLOS_*, E2E_MARTA_*, E2E_TEST_SUPPORT_KEY, AUTH_SERVER_KEY) presentes |
| Deployment Convex dev | 65 funciones desplegadas; incluye `team.*` y `reminders.*` → coherente con `main` |

## 3. Cuentas de prueba en Convex dev (tras esta sesión)

| Email | Nombre | Rol | Uso |
|---|---|---|---|
| admin@test.local | Admin Test | supervisor (admin) | **Nueva.** Pruebas manuales/ad hoc con nivel admin |
| usuario@test.local | Usuario Test | rep (normal) | **Nueva.** Pruebas manuales/ad hoc con nivel normal |
| carlos@test.local | Carlos | rep | Suite e2e (E2E_CARLOS_*) |
| mistumonso@gmail.com | Marta | supervisor | Suite e2e (E2E_MARTA_*). Es el Gmail real del usuario, no `marta@test.local` |
| reset@test.local | Reset E2E | rep | Identidad dedicada del harness de reseteo (MIS-286) |

Las contraseñas de las dos cuentas nuevas están en la memoria de la sesión de Claude, no en este fichero. Cumplen la política MIS-290 (≥ 8 caracteres, fuera del corpus). Se sembraron con el mismo algoritmo que `scripts/hash-password.mjs` y `npx convex run auth:seedUser`, sin pasar la contraseña por argumentos de CLI.

Smoke test ejecutado (fichero temporal en `tmp/smoke/`, carpeta ignorada por git; no forma parte de la suite):
- `usuario@test.local` entra → aterriza en `/pendientes`, saludo "Hola, Usuario Test"; `/equipo` le redirige fuera y no ve "Usuarios y equipo". ✓
- `admin@test.local` entra → aterriza en `/panel`, saludo "Hola, Admin Test"; en `/equipo` ve "Usuarios y equipo" e "Invitar usuario". ✓

## 4. Resultados de la suite completa

| Corrida | Condiciones | Resultado |
|---|---|---|
| 1 | Suite completa; el smoke test corrió en paralelo contra el mismo servidor | 88 ✓ · 10 ✘ · 1 skip · 15,3 min |
| 2 | `--last-failed`, entorno tranquilo | 0 de 10 recuperados (10 ✘) · 4,5 min |
| 3 | Suite completa, servidor de Next con log capturado | 87 ✓ · 11 ✘ · 1 skip · 15,3 min |

### 4.1 Fallos, uno a uno

| # | Project · spec | Síntoma | Causa atribuida |
|---|---|---|---|
| 1 | chromium-carlos · `full-flow.spec.ts:11` flujo completo de Carlos | Diálogo "Programar seguimiento" no se cierra tras Guardar (botón en "Guardando..."); `toBeHidden` 5 s | Latencia de red (A) |
| 2 | chromium-carlos · `edge-cases.spec.ts:5` cerrar la app a mitad del formulario | Diálogo "Nueva nota" sigue visible | Latencia (A) |
| 3 | chromium-carlos · `edge-cases.spec.ts:125` Carlos edita datos | Diálogo "Editar datos" sigue visible | Latencia (A) |
| 4 | chromium-carlos · `edge-cases.spec.ts:177` posponer desde Pendientes | El ítem sigue en "Para hoy" tras posponer | Latencia (A) |
| 5 | chromium-carlos · `edge-cases.spec.ts:515` segunda venta a contacto Ganado | Diálogo "Registrar venta" sigue visible | Latencia (A) |
| 6 | chromium-carlos · `edge-cases.spec.ts:578` venta directa marca Ganado | Diálogo "Registrar venta" sigue visible | Latencia (A) |
| 7 | chromium-carlos · `team-gating-carlos.spec.ts:10` /equipo no accesible para Carlos | Timeout 30 s (solo en corrida 3; en la 1 pasó) | Latencia (A), en el límite |
| 8 | chromium-marta · `role-gating.spec.ts:22` Marta escritura completa | Diálogo "Nueva nota" sigue visible | Latencia (A) |
| 9 | chromium-secrets · `password-reset-daily-cap.spec.ts:82` entrega 10 y suprime el 11º | Timeout 30 s | Latencia (A): 11 solicitudes + 10 sondeos de código a ~2 s cada llamada no caben en 30 s |
| 10 | chromium-secrets · `password-reset-daily-cap.spec.ts:108` suprimida por burst no consume cuota | Timeout 30 s | Latencia (A), mismo motivo |
| 11 | chromium-marta · `team-admin.spec.ts:75` guard "último admin" | `expect(supers.length).toBe(1)` → recibe 2 | Cuenta `admin@test.local` nueva (B) |

## 5. Evidencia

### (A) Latencia de red de esta máquina

Medidas tomadas durante la sesión (Wi-Fi "LaPalmarola", interfaz `wlo1`, sin VPN ni túnel activo, 2 CPUs, 5 GB RAM, load ≈ 0,8–1,7):

| Medida | Valor | Referencia normal |
|---|---|---|
| `ping 1.1.1.1` (RTT) | 660 ms | 10–30 ms |
| `ping` IP de Convex (Cloudflare 104.18.x) | 720 ms | 20–40 ms |
| curl a Convex `/version`: TLS / primer byte / total | 1,1–1,3 s / 1,7–2,1 s / 1,7–2,1 s | ~0,1 / ~0,2 / ~0,2 s |
| curl a google.com y api.github.com | mismo perfil (TLS ≈ 1,1–1,4 s, total ≈ 2,3 s) | — |

Es decir: **no es Convex, es el enlace**. Todo host remoto sufre lo mismo.

Efecto observado en el servidor de Next (`next dev`, Turbopack) durante la corrida 3, según su propio log:

| Petición | Tiempo |
|---|---|
| `GET /pendientes` | 9,1–12,2 s (se repite en cada navegación) |
| `POST /login` | 7,1–11,9 s |
| `POST /ventas`, `POST /pendientes` | 7,2–7,5 s |
| `GET /ventas` | 7,1 s |

Un render de `/pendientes` hace varias llamadas a Convex (sesión en `src/lib/auth/dal.ts` + queries de la página) y cada una cuesta ≈ 2 s; una Server Action hace mínimo 2 (verificar sesión + mutation) y luego la página se vuelve a renderizar. Con `toBeHidden` a 5 s y 30 s por test, los tests con más pasos encadenados caen. El log de Next **no registra ningún error** (`⨯`, unhandled, ECONN...): las acciones terminan bien, solo tarde.

Traza de Playwright del fallo #1: `POST /contactos/nuevo` 303 en 5,5 s; primer `POST /contactos/<id>` 200 en 3,4 s; el segundo (Programar seguimiento) queda sin respuesta dentro de la ventana del test.

Contraprueba en CI (runners de GitHub, latencia normal):

| Fecha | Evento | Rama | Resultado del job e2e |
|---|---|---|---|
| 2026-08-24 | pull_request | mis-315-retirar-lectura-dual-ticket | ✅ success (misma suite, mismo deployment de dev) |
| 2026-08-21 | pull_request | mis-312-onboarding-invitados | ✅ success (tras un intento fallido previo) |
| 2026-08-20 | pull_request | mis-309-gestion-usuarios | ✅ success |

El código de `main` (4ba302f) es exactamente el que pasó en la PR de MIS-315 más un commit de índice `[skip ci]`.

### (B) Guard "último admin"

`e2e/team-admin.spec.ts:82-84`:

```ts
const supers = activeSupervisors(team);
// El entorno de test tiene exactamente una supervisora activa (Marta).
expect(supers.length).toBe(1);
```

Antes de esta sesión dev tenía una sola cuenta `supervisor` (Marta). Al crear `admin@test.local` como `supervisor`, la precondición deja de cumplirse. Este fallo es 100 % atribuible a la sesión de hoy y se reproduce en CI también, porque CI corre contra el mismo deployment de dev.

## 6. Hallazgos colaterales (sin acción todavía)

1. **CI no verifica `main` tras el merge.** Todos los runs `push` a `main` desde MIS-303 aparecen como `waiting` (Environment `ci` con revisor requerido, nunca aprobado). El job `build` sí corre; el `e2e` no. Es un diseño consciente de MIS-303, pero conviene saber que "main en verde" significa solo lint+build.
2. **La suite comparte el deployment de dev con el uso manual.** Cualquier cuenta o dato que se cree a mano en dev puede romper precondiciones de specs (como ha pasado con #11). La suite ya lo mitiga con `workers: 1` y el harness `testSupport`, pero no con las cuentas.
3. **Timeouts pensados para latencia de CI.** `toBeHidden` con los 5 s por defecto y 30 s por test son ajustados para un entorno con RTT alto. No es un defecto del código de producción.
4. **Marta en dev es el Gmail real del usuario** (no `marta@test.local` como en la memoria antigua). Documentado; no requiere cambio.
5. `tmp/smoke/` (smoke test de las cuentas nuevas) queda en el disco, ignorado por git. No está integrado en la suite.

## 7. Opciones para el plan (a decidir; nada ejecutado)

Para el fallo #11, una de:
- **7.a** Hacer el spec robusto a N supervisoras: localizar a Marta por email (`E2E_MARTA_EMAIL`) y comprobar el guard solo cuando `supers.length === 1`, o desactivar temporalmente a las demás con el harness y restaurarlas en `finally`.
- **7.b** Dejar la suite como está y cambiar `admin@test.local` a `rep`, o eliminarla, y usar a Marta como cuenta admin de pruebas manuales.
- **7.c** Dejar la suite como está y dar de baja lógica (`deactivatedAt`) a `admin@test.local` cuando no se use. Frágil; no recomendada.

Para los fallos #1–#10 (latencia), una o varias de:
- **7.d** No hacer nada en el código: aceptar que el veredicto vinculante es el `e2e` de CI en la PR, y que el rojo local solo es concluyente con red normal (`ping 1.1.1.1` < 100 ms). Es lo que ya recoge la metodología de facto.
- **7.e** Subir `expect.timeout` (p. ej. 15 s) y `timeout` por test (p. ej. 90 s) **solo fuera de CI** en `playwright.config.ts`, para que la suite local sea útil con red lenta sin aflojar CI.
- **7.f** Reducir llamadas a Convex por render/acción (p. ej. sesión + datos en una sola query). Es una mejora de rendimiento real del producto, pero de mayor alcance; solo tendría sentido como ticket propio.

Recomendación para cuando se abra el plan: **7.a + 7.e**, cada una con su ticket MIS, en ese orden. 7.a es un cambio pequeño en un spec; 7.e es un cambio de config de test con impacto cero en producción.

## 8. Cómo reproducir

```bash
# Red (si RTT > 100 ms, el rojo local no es concluyente)
ping -c 3 1.1.1.1

# Suite completa (arranca next dev sola; ~15 min con red lenta)
npm run test:e2e

# Solo los fallidos de la última corrida
npx playwright test --last-failed

# Ver una traza de un fallo
npx playwright show-trace test-results/<carpeta>/trace.zip
```

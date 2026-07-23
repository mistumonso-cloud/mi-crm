# MIS-19 — Pruebas end-to-end del flujo completo de Carlos

## Respuesta a la auditoría de plan

**Veredicto: GO CONDICIONADO.** 0 blockers, 0 majors. Las condiciones son verificaciones normales de implementación (suite en verde de verdad, tsc/lint/build, secrets de CI), no cambios de diseño — todas cumplidas, ver "Verificación" más abajo.

| # | Sugerencia (severidad) | Resolución |
|---|---|---|
| 1 | Media — documentar explícitamente que el ticket dice "Comprado" pero el producto usa `won`/"Ganado" (ya aceptado en MIS-14/MIS-15) | Comentario inline añadido en `e2e/full-flow.spec.ts`, paso 11, justo donde se asserta el estado "Ganado" |
| 2 | Media — limpiar el recordatorio atrasado del caso edge #4 para no acumular pendientes E2E permanentes en el deployment compartido | `edge-cases.spec.ts` completa el recordatorio (vía `completeReminder` directo contra Convex) justo después de verificar el badge "Vencido" |
| 3 | Baja — evitar `toISOString().slice(0,10)` para "hoy"/"mañana", usar fecha local del navegador | `full-flow.spec.ts` paso 5 calcula la fecha con `page.evaluate(() => new Date().toLocaleDateString("en-CA"))`, en el contexto del navegador, no en Node |
| 4 | Baja — en CI usar `npm run test:e2e` en vez de `npx playwright test` directo, por simetría con los scripts documentados | `.github/workflows/ci.yml`, job `e2e`, corre `npm run test:e2e` |

**Deuda enviada a follow-up (no se implementa en este ticket, coincide con el propio marco de la auditoría):** deployment de Convex aislado para CI / preview deployments por rama; estrategia formal de purga de datos E2E históricos.

**Aspectos que la auditoría no pudo verificar, confirmados ahora durante la ejecución real:** las credenciales de `carlos@test.local` (ver `.env.test.local`, no reproducidas en este documento) autentican correctamente contra `dutiful-mole-111` — el `auth.setup.ts` real hizo login sin fallos en las corridas de verificación.

## Respuesta a la auditoría de código v1 → v2

**Veredicto v1: NO-GO.** 2 Majors, 0 Blockers.

| # | Auditoría | Resolución |
|---|---|---|
| M1 | `.env.test.local.example:4` tenía la contraseña real de `carlos@test.local` committeada — cualquier lector del repo obtendría una credencial de escritura contra el deployment de dev compartido. | **Corregido**: `.env.test.local.example` ahora tiene `E2E_CARLOS_PASSWORD=` vacío (mismo patrón que `.env.local.example`, que ya usa valores en blanco para su plantilla). El valor real solo vive en `.env.test.local` (gitignored, local) y deberá configurarse como GitHub Secret para CI. Confirmado que la credencial nunca se pusheó a ningún remoto (`git branch -vv` sin upstream en el momento del hallazgo) — no hace falta rotarla, y el commit que la contenía se corrigió con `git commit --amend` antes de cualquier push, precisamente para que nunca llegase a existir en un historial compartido. |
| M2 | `e2e/full-flow.spec.ts` paso 11 solo comprobaba el texto visible del producto, nunca el importe — el AC dice explícitamente "registra producto e importe"; una regresión que persistiera un importe incorrecto pasaría el test igual. | **Corregido**: el paso 11 ahora hace una comprobación exacta e independiente del locale contra Convex (`api.sales.listSaleClosures`, `amountCents === 19999`) además de una comprobación visible tolerante a espacios (`/199,99\s*€/`, por si el espacio antes de "€" es NBSP). |

**Sugerencias no bloqueantes, ambas aplicadas:**
- (Media) Paso 9 ahora comprueba también que la nota aparece etiquetada como "Llamada" (no solo que el resumen es visible), escopado al mismo `<li>` del historial que contiene esa nota.
- (Baja) `uniquePhone()` ahora mezcla un contador incremental de módulo con el timestamp, para no colisionar si dos llamadas caen en el mismo milisegundo (se invoca más de una vez por test: contacto principal + contacto de control).

**Deuda ya reconocida en la ronda de auditoría de plan, sin cambios**: deployment de Convex aislado para CI/preview por rama.

**No verificado por esta auditoría de código** (ejecución real, tsc/lint/build, secrets de GitHub): confirmado ahora tras el fix — ver "Hallazgos y correcciones" y "Verificación" más abajo, actualizadas tras esta ronda.

## Texto literal del ticket (Linear, `MIS-19`)

> Ejecutar y verificar el flujo completo de trabajo de Carlos desde el primer contacto hasta el cierre de la venta, simulando el uso real del día a día antes del lanzamiento.
>
> **Flujo a verificar paso a paso:**
> 1. Carlos abre la app → aterriza en Pendientes del día.
> 2. Registra un contacto nuevo desde el botón flotante → formulario rápido (nombre + teléfono) → en menos de 30 segundos.
> 3. Al guardar, aterriza en la ficha del nuevo contacto. El estado es `Lead nuevo`.
> 4. Añade una nota de conversación (tipo: llamada, resumen de lo que se habló).
> 5. Programa un seguimiento para mañana con motivo: "Enviarle propuesta".
> 6. Cambia el estado a `En conversación`.
> 7. Al día siguiente, el contacto aparece en Pendientes del día.
> 8. Carlos marca el seguimiento como hecho directamente desde la lista de pendientes.
> 9. Entra en la ficha del contacto y verifica que el historial refleja todo: nota, cambio de estado, seguimiento completado.
> 10. Cierra la venta como ganada: registra producto e importe.
> 11. El estado pasa a `Comprado` automáticamente.
> 12. Verifica la ficha de otro contacto (para confirmar que los datos no se mezclan).
>
> **Casos edge a probar también:** cerrar la app a mitad de un formulario; el historial tras varias acciones seguidas; búsqueda por nombre y por teléfono; pendientes atrasados de días anteriores; guardar un contacto sin nombre.
>
> **Criterio de aceptación:** el flujo completo de 12 pasos se ejecuta sin errores ni fricciones inesperadas. El historial de actividad refleja correctamente todos los eventos. Los casos edge están verificados y documentados. Los bugs encontrados están registrados y resueltos antes del lanzamiento.

## Confirmación de que es la tarea correcta

Verificado cruzando Linear MCP + `PLANS/README.md` + `git log`: MIS-7 a MIS-18 (Fases 1-5) están instalados, mergeados y desplegados. De los issues restantes en Linear, solo tres siguen en Backlog real — MIS-19, MIS-20 ("Pruebas del flujo de supervisión de Marta") y MIS-21 ("Deploy y puesta en marcha"), los tres de Fase 6 — QA y lanzamiento. (MIS-5 y MIS-6 también figuran "Backlog" en Linear pero es el desfase de estado ya documentado en `project-crm-mvp-linear-status-lag`: son fundamentos ya implementados desde el principio, sobre los que todo lo demás se construyó.) Dentro de Fase 6, el orden natural es probar primero el flujo operativo de Carlos (quien genera los datos) antes que el de supervisión de Marta (MIS-20, que necesita datos reales generados por ese flujo) y antes de dar por buena la puesta en producción (MIS-21).

## Punto de partida: qué ya existía y qué faltaba

Búsqueda exhaustiva confirmó que **no existía ningún framework de E2E en el repo**: sin `playwright.config.ts`/`cypress.config.ts`, sin carpeta `tests/`/`e2e/`, sin `.spec.ts`/`.test.ts` en ningún sitio, sin dependencia de testing en `package.json`, sin paso de test en `.github/workflows/ci.yml` (solo `lint`+`build`). Cada ticket anterior (MIS-7 a MIS-18) se "verificó" con una sesión manual de Playwright por navegador durante su propia auditoría, documentada en prosa dentro de la sección "Verificación" de su plan — pero nunca se guardó código de test. MIS-19 monta esa infraestructura desde cero, decidido con el usuario como **activo permanente** del repo (no un script de un solo uso), reutilizable por MIS-20 y como red de regresión futura — el tipo de bug que habría cazado, por ejemplo, el fallo real de `/panel` en producción tras el merge de MIS-17 (deploy de Convex a prod olvidado, sin relación con este ticket pero mismo tipo de gap que un CI con E2E real habría señalado).

## Decisiones fijadas

1. **Playwright, no Cypress ni otra alternativa.** Ya era la herramienta usada de facto en todas las verificaciones manuales anteriores (mencionada explícitamente en varios `PLANS/MIS-N-*.md`); no hay motivo para introducir una segunda herramienta de E2E cuando la primera ya tiene precedente de uso y de familiaridad en el proyecto.

2. **Infraestructura permanente, no un script desechable** (confirmado con el usuario): dependencia `@playwright/test` en `package.json`, `playwright.config.ts` en la raíz, carpeta `e2e/`, scripts `test:e2e`/`test:e2e:report`, y un job nuevo en `.github/workflows/ci.yml`.

3. **Credenciales de test**: `carlos@test.local` (confirmado por el usuario como la contraseña real ya sembrada en el deployment de dev `dutiful-mole-111` — no se re-sembró nada; contraseña no reproducida en este documento). Viven en `.env.test.local` (nuevo, gitignored, mismo patrón que `.env.local`), con `.env.test.local.example` committed como plantilla, sin valores reales.

4. **Un único login reutilizado vía `storageState`, no un login por test.** `e2e/auth.setup.ts` es un proyecto Playwright `setup` del que depende el proyecto `chromium` (patrón oficial de Playwright para auth). Motivo concreto, no genérico: `convex/lib/rateLimit.ts::EMAIL_RATE_LIMIT` bloquea el email 15 minutos tras 5 fallos — repetir logins por test agotaría ese margen en pocas ejecuciones seguidas durante el propio desarrollo de la suite (y de hecho estuvo cerca de agotarse durante la ronda de depuración de este mismo ticket, ver "Hallazgos y correcciones").

5. **Un único worker, sin paralelismo (`workers: 1`, `fullyParallel: false`).** Todos los tests comparten el mismo deployment de Convex de dev (el mismo que usa `npm run dev` en local, vía `.env.local`) — no existe un deployment de Convex exclusivo para CI en este ticket (documentado como mejora futura, no bloqueante: Convex sí soporta "preview deployments" por rama, pero montarlo es alcance mayor que el pedido aquí). Correr en paralelo arriesgaría carreras de datos entre specs que leen las mismas pantallas compartidas (Pendientes, lista de contactos).

6. **El "problema del día siguiente" (pasos 7-8 del ticket): se programa el seguimiento para HOY, no literalmente mañana — decisión de diseño de test, no una debilidad.** Ninguna herramienta puede adelantar el reloj del backend de Convex de forma honesta: sus funciones leen `Date.now()` real, tanto en local (`npx convex dev`) como en la nube — no hay mock de servidor posible sin alterar el propio código de producción para inyectar un reloj falso, lo que MIS-19 no está mandatado a hacer. Verificado en `convex/reminders.ts::listDueToday` (líneas 243-271): el filtro es `dueAt < tomorrowStart` (medianoche Madrid de mañana) y `overdue = dueAt < todayStart`. Un recordatorio programado para **hoy** cumple exactamente la misma condición de "aparece en Pendientes, no vencido" que uno programado ayer "para mañana" una vez que ese mañana ya llegó — el código no distingue ambos casos, así que el test de hoy ejercita el mismo camino con fidelidad completa. El caso realmente distinto — un pendiente **atrasado de días anteriores** (`overdue: true`) — se cubre aparte en `edge-cases.spec.ts`, sembrando un `dueAt` real 3 días en el pasado directamente vía `ConvexHttpClient` (no un mock: un timestamp real que el date-picker de la UI no puede producir, porque no permite fechas pasadas).

7. **Seeding directo contra Convex (`ConvexHttpClient` + token real de sesión) para datos de setup que la UI no puede producir, nunca para las aserciones del propio flujo.** El token se extrae de la cookie `session` del contexto autenticado de Playwright tras el login real de `auth.setup.ts` — confirmado en `src/lib/auth/cookie.ts::readSessionToken` que la cookie guarda el token **en claro** (el hash solo se calcula server-side, en `convex/lib/token.ts`, para comparar contra `sessions.tokenHash`). No es un atajo inseguro para saltarse autenticación: es el mismo token real que Next.js pasaría como `token` a `fetchQuery`/`fetchMutation`, obtenido de un login real. Dos usos: (a) el "contacto de control" del paso 12 (nombre/nota claramente distintos, para comprobar que no se mezcla con el contacto principal del flujo, sin gastar uno de los 12 pasos numerados en crearlo por la UI); (b) el recordatorio atrasado del caso edge #4.

8. **Un único test con 12 `test.step()` para el flujo de 12 pasos, no 12 tests independientes.** Los pasos 2-12 dependen todos del contacto/recordatorio/venta creado por el paso anterior (mismo `contactId` en todos) — la propia guía de Playwright recomienda `test.step()` para esta forma de dependencia lineal fuerte: un solo pass/fail agregado (coherente con el AC, "el flujo completo... se ejecuta sin errores"), pero el reporte señala el paso exacto donde falla algo.

9. **Datos de test con nombre único por timestamp** (`E2E <rol> <epoch>`, `e2e/helpers/test-data.ts`) — evita colisionar con datos de ejecuciones anteriores del propio suite o con datos manuales de desarrollo en el mismo deployment compartido.

10. **Selectores por rol/label/texto visible, nunca `data-testid`.** Confirmado por inspección: no existe ningún `data-testid` en el repo — introducir uno rompería la convención existente sin necesidad, cuando `getByRole`/`getByLabel`/`getByText` ya son suficientes (los formularios usan `<label>` reales vía el componente `Input`/`Select` compartido, y los overlays son diálogos ARIA reales — `role="dialog" aria-modal="true"`, título vía `aria-labelledby` — ver `src/components/ui/overlays/BottomSheet.jsx`).

11. **CI: job nuevo `e2e` (depende de `build`), requiere 3 secrets de GitHub aún no configurados** (`NEXT_PUBLIC_CONVEX_URL`, `E2E_CARLOS_EMAIL`, `E2E_CARLOS_PASSWORD`) apuntando al mismo deployment de dev. Sin ellos el job falla en vez de saltarse en silencio — decisión deliberada (un job requerido que se salta solo defeats the purpose); queda como acción pendiente del usuario antes o después de mergear, no algo que se pueda resolver por CLI sin acceso a los secrets del repo de GitHub.

## Estructura de archivos

```
playwright.config.ts          (NUEVO)
.env.test.local.example       (NUEVO, committed)
.env.test.local                (NUEVO, gitignored — no aparece en CODIGO/ ni en el PR)
.gitignore                    (EDITAR)
package.json                  (EDITAR)
.github/workflows/ci.yml      (EDITAR)
e2e/
  auth.setup.ts                (NUEVO)
  helpers/
    convex-client.ts           (NUEVO)
    test-data.ts                (NUEVO)
  full-flow.spec.ts            (NUEVO)
  edge-cases.spec.ts           (NUEVO)
```

## Hallazgos y correcciones

Ejecutado de verdad, no solo descrito: instalado en la rama `feature/mis-19-pruebas-e2e-flujo-completo`, `npm install` + `npx playwright install chromium` (Chromium arrancó sin problema; `--with-deps` no se usó localmente por requerir `sudo` interactivo en este entorno de desarrollo — irrelevante para CI, que corre en runners de GitHub sin esa restricción), servidor de dev levantado automáticamente por `webServer` de `playwright.config.ts`, contra el deployment de dev real (`dutiful-mole-111`).

**Ningún bug de aplicación encontrado.** Los 7 tests (1 login de setup + 5 casos edge + 1 flujo completo de 12 pasos) pasaron en verde en la primera corrida, y de nuevo en una segunda corrida consecutiva, sin flakiness. El diseño de test ya incorporaba, desde el principio de esta ronda de generación, las dos correcciones de selectores descubiertas en un intento previo de este mismo ticket (contraseña ambigua por `getByLabel`, y el regex de `waitForURL` que también matcheaba `/contactos/nuevo`) — al partir de ese diseño ya corregido, no reaparecieron en esta ronda. No se necesitaron correcciones adicionales de test-authoring en esta ronda de generación.

Adicionalmente: `npx tsc --noEmit`, `npm run lint` (0 errores; 1 warning preexistente no relacionado en `Avatar.jsx`, ya presente en `main` antes de este ticket) y `npm run build` — los tres sin errores nuevos.

**Ronda de auditoría de código (2 Majors + 2 sugerencias, ver "Respuesta a la auditoría de código" más arriba)**: tras aplicar los 4 fixes, se repitió la verificación completa desde cero — `npx tsc --noEmit` limpio, `npm run lint` sin errores nuevos, `npm run build` sin errores, y la suite E2E completa en verde dos veces seguidas (44.9s y 42.8s). Ningún bug de aplicación adicional encontrado en esta ronda — los 2 Majors eran ambos del propio código de test (una credencial mal ubicada y una aserción incompleta), no defectos de `src`/`convex`.

## Verificación

1. **Suite E2E completa, en verde, dos veces seguidas (post-fix de auditoría de código)**: 7/7 tests (`npm run test:e2e`), 44.9s y 42.8s.
2. **Tipos, lint y build (post-fix)**: `npx tsc --noEmit`, `npm run lint`, `npm run build` — sin errores.
3. **Casos edge, los 5, verificados y pasando**: cerrar a mitad de formulario (sin borrador), historial tras varias acciones seguidas, búsqueda por nombre y por teléfono, pendiente atrasado (badge "Vencido", limpiado tras verificar), contacto sin nombre (mensaje real del servidor).
4. **Importe de venta (M2)**: verificado por partida doble — `amountCents === 19999` vía `api.sales.listSaleClosures` y el texto visible formateado (`/199,99\s*€/`).
5. **Credencial de test (M1)**: `.env.test.local.example` sin secreto real; confirmado con `git show HEAD:.env.test.local.example` que el commit final no lo contiene.
6. **CI**: job `e2e` en `.github/workflows/ci.yml`, dependiente de `build`, corre `npm run test:e2e`; no ejecutado en un runner real de GitHub Actions en esta ronda (requiere los 3 secrets pendientes de configurar por el usuario: `NEXT_PUBLIC_CONVEX_URL`, `E2E_CARLOS_EMAIL`, `E2E_CARLOS_PASSWORD`) — la suite en sí ya está probada de extremo a extremo en local contra el mismo deployment de dev que usaría CI.

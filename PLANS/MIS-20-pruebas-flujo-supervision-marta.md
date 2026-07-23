# MIS-20 — Pruebas del flujo de supervisión de Marta

## Respuesta a la auditoría de plan

**Veredicto v1: NO-GO** (1 Major, 2 sugerencias no bloqueantes).

| # | Auditoría | Resolución |
|---|---|---|
| Major 1 | El FAB global "Añadir contacto" (`src/components/crm/AddContactFab.tsx`) se renderiza sin condición de rol en `src/app/(app)/(with-nav)/layout.tsx:41` — visible para Marta, contradiciendo el AC "Marta no puede crear ni editar contactos accidentalmente" y la propia expectativa del plan de que `role-gating.spec.ts` vería "FAB/botones ocultos". `contactos/nuevo/page.tsx` ya admite en un comentario que "el FAB que trae hasta aquí sigue visible para ambos roles". | **Corregido**: MIS-20 incorpora una corrección mínima de producto — `src/app/(app)/(with-nav)/layout.tsx` condiciona `<AddContactFab />` a `user.role === "rep"`, ocultándolo por completo para Marta. Se mantiene el guard de servidor ya existente en `contactos/nuevo/page.tsx` como defensa en profundidad (navegación directa a la URL sigue mostrando el mensaje de solo lectura). `role-gating.spec.ts` verifica ambas capas por separado: FAB ausente para Marta, y `/contactos/nuevo` por URL directa sigue bloqueado. |
| Media | El plan podía dar la impresión de "solo lectura absoluta" para Marta, cuando `addNote`/`scheduleReminder`/`completeReminder` usan `requireUser` (ambos roles), no `requireRole`. | El spec de gating afirma expresamente que "Añadir nota"/"Programar seguimiento"/"Marcar hecho" siguen visibles y funcionales para Marta — ver decisión 9 más abajo. |
| Baja | `carlosTokenFromDisk()` debía validar explícitamente que el JSON leído contiene una cookie `session` y fallar con error claro si no. | Ya estaba así de diseñado; queda explícito como decisión 3 más abajo, no solo implícito en el código. |

## Respuesta a la auditoría de código

**Veredicto ronda 1: NO-GO** (2 Majors, 2 sugerencias no bloqueantes). El Major del FAB de la auditoría de plan quedó confirmado como resuelto; los 2 Majors de esta ronda eran huecos de cobertura nuevos en la propia suite (no en el producto).

| # | Auditoría | Resolución |
|---|---|---|
| Major 1 | `panel-flow.spec.ts` solo verificaba el delta de `talking` en el pipeline — nunca "Ventas ganadas" (`count` + importe acumulado), pese a ser un AC explícito del ticket (paso 2 y el caso "¿importe acumulado correcto tras varios cierres?"). Una regresión en `getWonSalesSummary`/`formatCurrencyCents`/su render pasaría la suite sin detectarse. | **Corregido**: se siembra una venta ganada de importe conocido (123,45 €) como Carlos, se toma baseline de `getWonSalesSummary` antes de sembrar, y se afirma tanto el texto visible (comparado contra `formatCurrencyCents` real, mismo criterio de auditoría de MIS-19) como el valor exacto de `totalAmountCents`/`count` vía Convex tras sembrar. |
| Major 2 | El filtro por estado solo se verificaba por inclusión (el contacto `talking` aparece) — nunca por exclusión. Una regresión que dejara de filtrar (mostrando todos los contactos) habría pasado igual. | **Corregido**: se siembra un contacto de control en estado `lead` (sin cambiar su estado) y se afirma que NO aparece en `/contactos?status=talking` — prueba que el filtro excluye genuinamente, no solo que incluye. |
| Media | `role-gating.spec.ts` solo comprobaba que "Añadir nota"/"Programar seguimiento" eran visibles para Marta, no que fueran realmente funcionales. | Se ejercita de verdad: Marta añade una nota real (rellena y envía el formulario) y se afirma que aparece en el historial de la ficha. |
| Baja | `realtime-panel.spec.ts` usaba una espera fija de 24s; `expect.poll` sería más robusto ante lentitud del runner. | Sustituido por `expect.poll` (reintentos cada 2s, hasta 30s de margen) — se resuelve en cuanto el refresco real ocurre, sin alargar el caso normal. |

Efecto colateral de los 2 Majors: `panel-flow.spec.ts` pasó de ~12s a ~31-39s (2 contactos y una venta más sembrados, más el bucle de verificación móvil ya existente) — se añadió `test.slow()` a ese test tras superar el timeout por defecto de 30s en una corrida.

## Texto literal del ticket (Linear, `MIS-20`)

> Verificar que el flujo de Marta funciona correctamente: que puede entrar al CRM, ver el estado real del pipeline y acceder al detalle de cualquier contacto sin necesitar formación ni ayuda de Carlos.
>
> **Flujo a verificar paso a paso:**
> 1. Marta abre la app → aterriza directamente en el Panel de oportunidades (no en Pendientes).
> 2. El panel muestra los números correctos: cuántos contactos hay en cada estado, total de ventas ganadas e importe acumulado.
> 3. Pulsa sobre un estado (por ejemplo, "En conversación") → se abre la lista de contactos filtrada por ese estado.
> 4. Abre la ficha de un contacto desde esa lista.
> 5. La ficha muestra el historial completo de lo que Carlos ha hecho: notas, cambios de estado, seguimientos completados.
> 6. Navega de vuelta al Panel sin perder el filtro activo.
> 7. Marta no puede crear ni editar contactos accidentalmente (solo lectura salvo las acciones habilitadas para su rol).
>
> **Casos a verificar también:** ¿el panel refleja en tiempo real los cambios de Carlos?; ¿el importe acumulado de ventas es correcto tras varios cierres?; ¿la lista filtrada por estado muestra exactamente los contactos correctos?; ¿el historial de la ficha es legible sin contexto técnico?; ¿la app es usable desde el móvil de Marta sin instrucciones?
>
> **Criterio de aceptación:** Marta aterriza en el Panel al abrir la app. Los números del Panel son correctos y coinciden con el estado real de los contactos. Marta puede navegar desde el Panel hasta la ficha de cualquier contacto y volver. El historial de la ficha es comprensible sin contexto previo. Marta no puede realizar acciones que no corresponden a su rol.

## Confirmación de que es la tarea correcta

MIS-19 (pruebas del flujo de Carlos) ya está instalada y mergeada (PRs #14/#15/#16). De los issues restantes en Linear, solo quedan MIS-20 (este) y MIS-21 ("Deploy y puesta en marcha"), ambos de Fase 6 — QA y lanzamiento. El orden natural sigue siendo probar primero el flujo operativo (ya hecho) y ahora el de supervisión, antes de dar por buena la puesta en producción.

## Punto de partida: qué ya existe y qué falta

La infraestructura de Playwright ya existe, instalada por MIS-19 y verificada en `main`: `playwright.config.ts` (un único usuario, Carlos, con proyectos `setup`/`chromium`), `e2e/auth.setup.ts`, `e2e/helpers/convex-client.ts` (`convexClient()` + `sessionTokenFrom(context)`), `e2e/helpers/test-data.ts`, `e2e/full-flow.spec.ts`, `e2e/edge-cases.spec.ts`. MIS-20 **extiende** esta infraestructura para un segundo usuario autenticado (Marta, rol `supervisor`) — no la reconstruye ni la duplica.

No existe ningún plan ni código previo para MIS-20 — es una tarea desde cero, con la ventaja de heredar todos los patrones ya validados y auditados en MIS-19 (selectores por rol/label, `waitForURL` tras Server Actions, seeding vía `ConvexHttpClient` con token real de sesión, nombres de test con sufijo único, credenciales solo en `.env.test.local` gitignored y GitHub Secrets — nunca en el `.example`, lección aprendida como Major en la auditoría de código de MIS-19).

## Decisiones fijadas

1. **Credenciales de test**: `marta@test.local` / contraseña real confirmada por el usuario (ya sembrada en el deployment de dev `dutiful-mole-111` — no se re-siembra nada). Viven **solo** en `.env.test.local` (gitignored, nunca en este documento ni en ningún archivo committed), con `.env.test.local.example` actualizado con el placeholder vacío (mismo patrón que Carlos).

2. **Dos usuarios en `playwright.config.ts`, sin cruce de specs.** Se renombra el proyecto `chromium` existente a `chromium-carlos` (mismo `storageState`, mismo comportamiento) y se añade `chromium-marta` (nuevo, `storageState: "e2e/.auth/marta.json"`). Ambos proyectos declaran `testMatch` explícito y disjunto (`chromium-carlos` → `full-flow.spec.ts`/`edge-cases.spec.ts`; `chromium-marta` → los 3 specs nuevos de este ticket) — sin este scoping, el `testMatch` por defecto (todo `*.spec.ts` bajo `testDir`) haría que cada proyecto también corriera los specs del otro usuario, fallando por el motivo equivocado (rol, no el bug real que ese spec prueba). Igualmente se separan los proyectos `setup` (renombrado `setup-carlos`) y `setup-marta` (nuevo), cada uno con `testMatch` de un único archivo — antes, con un solo usuario, un regex genérico `/.*\.setup\.ts/` no importaba; con dos, mezclaría ambos logins bajo un mismo nombre de proyecto en el reporte.

3. **Sembrar datos como Carlos mientras se afirma como Marta.** Los specs de Marta necesitan datos que solo Carlos puede crear (`requireRole(ctx, token, "rep")` en `createContact`/`changeContactStatus`/`closeSale`), mientras el navegador bajo test está autenticado como Marta. El helper existente `sessionTokenFrom(context)` solo lee las cookies del contexto *actual* (el de Marta en estos specs) — no sirve para obtener el token de Carlos. Se añade `carlosTokenFromDisk()` a `e2e/helpers/convex-client.ts`: lee `e2e/.auth/carlos.json` directamente del disco (mismo formato JSON que ya escribe `context.storageState()`), sin necesitar ningún `BrowserContext` de Carlos vivo — mismo principio de "token real, sin atajos inseguros" que `sessionTokenFrom`, solo que leído de un archivo en vez de una cookie de un contexto activo. `chromium-marta` depende de **ambos** setups (`dependencies: ["setup-carlos", "setup-marta"]`) para garantizar que `e2e/.auth/carlos.json` ya exista en disco antes de que arranque cualquier test de Marta.

4. **Números del panel verificados por delta conocido, no por valor absoluto.** El deployment de dev (`dutiful-mole-111`) es compartido — ya acumula datos de pruebas manuales y de la propia suite de MIS-19. Afirmar un número absoluto en el panel sería frágil (cambiaría con cualquier otra ejecución o dato manual). En su lugar: se lee el número real vía Convex (`getPipelineSummary`/`getWonSalesSummary`) *antes* de sembrar nada, se siembra un contacto/venta con estado/importe conocido como Carlos, y se afirma que el número mostrado subió exactamente en ese delta.

5. **Rechazo del servidor verificado por el `.data` real de `ConvexError`, no solo por el tipo de excepción.** Confirmado en `convex/lib/authz.ts`: `requireRole` lanza `ConvexError("No autorizado")`. El cliente HTTP de Convex (`convex@1.42.1`) reenvía ese `errorData` real — mismo criterio que ya usa el código de producción (`err.data === "No autorizado"` en `src/lib/contacts/actions.ts`, documentado en `PLANS/MIS-14`/`MIS-15`). Se reutiliza exactamente ese chequeo para los 3 mutations gateados, invocados con el token real de sesión de Marta.

6. **Test de tiempo real: aislado en su propio archivo, `test.slow()`, espera real de pared (~24s).** `PanelAutoRefresh.tsx` corre un `setInterval` real de 20 000 ms, sin ninguna guarda mockeable desde un test sin tocar código de producción. Confirmado con el usuario: se incluye como test real (no se omite), con espera de pared genuina — se siembra un cambio de estado como Carlos *después* de que la sesión de Marta ya está viendo el panel, se esperan ~24s (margen sobre el intervalo real de 20s, sin acercarse al siguiente ciclo de 40s), y se afirma que el número subió sin ningún `page.reload()`. Vive en su propio archivo (`realtime-panel.spec.ts`) con `test.slow()` para no penalizar el tiempo del resto de la suite ni bloquear su desarrollo/depuración.

7. **Paso 6 del ticket ("vuelve al Panel sin perder el filtro activo") se interpreta como navegación atrás desde la ficha hacia la lista filtrada.** El Panel en sí no tiene estado de filtro propio (los filtros viven en `/contactos?status=X`) — la comprobación con sentido real es que, al volver atrás desde la ficha, la lista intermedia sigue mostrando `?status=talking` en la URL y el chip "Filtrado por:" sigue visible, en vez de resetearse a una lista sin filtrar.

8. **Verificación de móvil (320px) reutiliza la técnica ya validada en la auditoría de MIS-17** (`document.documentElement.scrollWidth === document.documentElement.clientWidth` vía `page.evaluate`, en vez de inventar una técnica nueva), plegada como paso final de `panel-flow.spec.ts` en vez de un archivo aparte — ocho líneas de aserción no justifican un archivo propio, y reutiliza IDs/URLs que el propio test ya tiene en scope.

9. **Corrección mínima de producto, dentro del alcance de MIS-20: ocultar el FAB "Añadir contacto" para Marta.** `src/app/(app)/(with-nav)/layout.tsx:41` renderiza `<AddContactFab />` sin usar `user.role` (ya disponible en la misma función, vía `await getUser()`) — visible para ambos roles hoy. Se condiciona a `user.role === "rep"`. El guard de servidor en `contactos/nuevo/page.tsx` (mensaje de solo lectura si `user.role !== "rep"`) se mantiene sin cambios como defensa en profundidad ante navegación directa a la URL (bookmark, escritura manual). `role-gating.spec.ts` verifica ambas capas por separado: (a) el FAB no está presente en absoluto para Marta en `/panel`, (b) navegar directamente a `/contactos/nuevo` sigue mostrando el mensaje de solo lectura, no el formulario.

10. **Marta no tiene "solo lectura absoluta" — el spec de gating lo deja explícito, no implícito.** `addNote`, `scheduleReminder` y `completeReminder` usan `requireUser` (ambos roles), no `requireRole`: Marta puede añadir notas, programar/reprogramar seguimientos y marcarlos como hechos. `role-gating.spec.ts` afirma expresamente que esos tres controles siguen visibles y funcionales para Marta en la ficha de un contacto — evita que el test dé a entender un bloqueo total que no corresponde al comportamiento real ni pedido por el ticket.

11. **`carlosTokenFromDisk()` valida explícitamente la forma del JSON leído.** Si `e2e/.auth/carlos.json` no existe, no es JSON válido, o no contiene una cookie `session`, lanza un error claro indicando que el project `setup-carlos` no corrió (en vez de un `undefined` silencioso que fallaría más adelante con un error confuso de Convex).

## Estructura de archivos

```
playwright.config.ts              (EDITAR — setup-carlos/setup-marta, chromium-carlos/chromium-marta con testMatch explícito)
src/app/(app)/(with-nav)/layout.tsx (EDITAR — <AddContactFab /> condicionado a user.role === "rep")
.env.test.local.example           (EDITAR — E2E_MARTA_EMAIL=marta@test.local, E2E_MARTA_PASSWORD= vacío)
.github/workflows/ci.yml          (EDITAR — 2 secrets nuevos en el job e2e)
e2e/
  auth-marta.setup.ts              (NUEVO — login real, waitForURL("/panel"), guarda e2e/.auth/marta.json)
  helpers/
    convex-client.ts                (EDITAR — añade carlosTokenFromDisk(), con validación explícita de forma)
  panel-flow.spec.ts               (NUEVO — 7 pasos del ticket + paso extra de verificación móvil 320px)
  role-gating.spec.ts              (NUEVO — FAB ausente + guard de servidor por URL directa + controles SÍ disponibles para Marta + rechazo real del servidor en los 3 mutations gateados)
  realtime-panel.spec.ts           (NUEVO — test.slow(), espera real ~24s)
```

## Verificación (plan de verificación, a ejecutar tras el GO)

1. `npx playwright test --list` tras editar `playwright.config.ts` — confirma que el scoping de `testMatch`/`dependencies` resuelve sin errores antes de escribir los specs nuevos.
2. `npx playwright test --project=setup-marta` en aislado — confirma login real y creación de `e2e/.auth/marta.json`.
3. Suite completa (`npm run test:e2e`) en verde, al menos dos veces seguidas — confirmando que `chromium-carlos` y `chromium-marta` corren solo sus propios specs, sin cruce.
4. `realtime-panel.spec.ts` corrido también en aislado al menos una vez antes de la corrida conjunta, dado su coste (~25s+).
5. `npx tsc --noEmit`, `npm run lint`, `npm run build` sin errores nuevos.
6. Cualquier bug real de aplicación encontrado durante la ejecución se documenta y arregla en la misma ronda, igual que MIS-19 (criterio de aceptación explícito del ticket: "los bugs encontrados están registrados y resueltos").

## Hallazgos y correcciones

Ejecutado de verdad, no solo descrito: instalado directamente en la rama `feature/mis-20-pruebas-flujo-supervision-marta`, dependencias ya presentes (Playwright instalado desde MIS-19), `npx playwright test --list` confirmó el scoping de `testMatch`/`dependencies` de los dos usuarios antes de escribir ningún spec real, suite completa corrida contra el dev server real y el deployment de dev real (`dutiful-mole-111`).

**Ningún bug de aplicación adicional encontrado**, más allá de la corrección del FAB ya prevista y exigida por la auditoría del plan (Major, ver arriba) — aplicada tal cual: `src/app/(app)/(with-nav)/layout.tsx` ahora condiciona `<AddContactFab />` a `user.role === "rep"`, y el comentario de `src/app/(app)/contactos/nuevo/page.tsx` se actualizó para reflejar que el guard de servidor pasa a ser defensa en profundidad (ya no la única barrera).

**Un fallo transitorio detectado y descartado como flaky, no como bug real**: en la primera corrida de la suite completa, `full-flow.spec.ts` (paso 12, ya existente de MIS-19, sin relación con los cambios de MIS-20) falló con `net::ERR_ABORTED; maybe frame was detached?` al navegar a la ficha del contacto de control — timeout de 30s superado. Repetido en aislado (`npx playwright test full-flow.spec.ts --project=chromium-carlos`) pasó limpio en 18.6s, y las dos corridas completas siguientes de la suite (14/14 tests) pasaron sin ningún fallo. Se interpreta como contención transitoria del dev server durante una corrida larga (14 tests, ~2 minutos), no como una regresión introducida por los cambios de este ticket (el fix del FAB no afecta a Carlos, `user.role === "rep"` sigue siendo `true` para él) — no se tocó nada de `full-flow.spec.ts` para "arreglar" este fallo, ya que no era reproducible.

Verificación de estabilidad: suite completa (`npm run test:e2e`, 14 tests: 2 setups + 12 tests reales) corrida tres veces en total — 1 fallo transitorio ya explicado, 2 corridas limpias consecutivas después.

Adicionalmente: `npx tsc --noEmit`, `npm run lint` (0 errores, 1 warning preexistente no relacionado en `Avatar.jsx`, ya presente en `main` antes de este ticket) y `npm run build` — los tres sin errores nuevos.

**Ronda 2 (correcciones de la auditoría de código)**: aplicados los 2 Majors + 2 sugerencias (ver "Respuesta a la auditoría de código" arriba). Sin bugs de aplicación nuevos — ambos Majors eran huecos de cobertura en la suite, no defectos de `src`/`convex`. `panel-flow.spec.ts` superó el timeout por defecto de 30s tras añadir el sembrado de venta + contacto de control (duración real ~31-39s) — corregido con `test.slow()`. Suite completa corrida dos veces seguidas tras el fix, ambas en verde (14/14). `npx tsc --noEmit`, `npm run lint`, `npm run build` re-verificados sin errores nuevos.

## Verificación

1. **`npx playwright test --list`**: 14 tests listados (2 setups + 5 de `edge-cases.spec.ts` + 1 de `full-flow.spec.ts`, todos bajo `chromium-carlos`; 1 de `panel-flow.spec.ts` + 1 de `realtime-panel.spec.ts` + 4 de `role-gating.spec.ts`, todos bajo `chromium-marta`) — scoping de `testMatch`/`dependencies` confirmado sin cruce entre usuarios.
2. **Suite E2E completa, en verde, dos veces seguidas tras la ronda 2 de correcciones**: 14/14 tests (`npm run test:e2e`).
3. **`realtime-panel.spec.ts`** corrido dentro de la suite completa (26-28s por corrida, `expect.poll` en vez de espera fija tras la ronda 2).
4. **Tipos, lint y build**: `npx tsc --noEmit`, `npm run lint`, `npm run build` — sin errores.
5. **Los 7 pasos del ticket + verificación móvil**: cubiertos en `panel-flow.spec.ts` (aterriza en Panel, números por delta de pipeline Y de ventas ganadas/importe, filtro con inclusión Y exclusión verificadas, ficha con historial completo, vuelta preservando filtro, sin overflow a 320px).
6. **Rol y gating**: cubiertos en `role-gating.spec.ts` (FAB ausente, guard de servidor por URL directa, "Añadir nota" ejercitada de verdad como Marta —no solo visible—, "Programar seguimiento" visible, rechazo real del servidor en los 3 mutations gateados).
7. **Tiempo real**: cubierto en `realtime-panel.spec.ts` (espera real con `expect.poll`, sin `page.reload()`).
8. **CI**: `E2E_MARTA_EMAIL`/`E2E_MARTA_PASSWORD` añadidos al job `e2e` de `.github/workflows/ci.yml`, junto a los 3 secrets de MIS-19 (los 5 siguen sin configurar en GitHub — deuda ya conocida, no nueva de este ticket).

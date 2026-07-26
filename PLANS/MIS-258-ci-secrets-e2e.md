# MIS-258 — CI: el job `e2e` falla en GitHub Actions por falta de secrets

> **Estado**: Secrets configurados y verificados en verde. PR #30 abierto (rama `chore/mis-258-ci-secrets-e2e`), CI del propio PR confirma `build`+`e2e` en verde. Pendiente de merge.

## Contexto

### Texto literal del ticket (Linear, `MIS-258`)

> **Qué pasa:** el workflow `CI` (`.github/workflows/ci.yml`) tiene un job `e2e` que corre `npm run test:e2e` con estas env vars desde `secrets.*`: `NEXT_PUBLIC_CONVEX_URL`, `E2E_CARLOS_EMAIL`/`E2E_CARLOS_PASSWORD`, `E2E_MARTA_EMAIL`/`E2E_MARTA_PASSWORD`. Estos secrets no estaban configurados en el repo de GitHub (`mistumonso-cloud/mi-crm`), así que llegaban vacíos al runner y los tests de login (`auth.setup.ts`, `auth-marta.setup.ts`) fallaban de inmediato antes de poder ejecutar ningún test real. Confirmado como fallo preexistente, no causado por ningún PR concreto (falla igual en MIS-19, MIS-20, reapertura de MIS-8). El job `build` (lint + build) sí pasa.
>
> **Qué hay que hacer:** configurar los 5 secrets que el workflow espera en GitHub (Settings → Secrets and variables → Actions), apuntando al deployment de dev de Convex y a las credenciales reales de Carlos/Marta. Verificar que un run de CI posterior pasa el job `e2e` en verde.

### Punto de partida: qué ya existe y qué falta

Verificado leyendo el código y el estado real del repo, no asumido:

- `.github/workflows/ci.yml` — único workflow del repo. Job `e2e` (`needs: build`) inyecta exactamente 5 `secrets.*` como env vars al paso `npm run test:e2e`. El workflow, `playwright.config.ts` y los tests (`e2e/*.spec.ts`) están correctos — no hace falta tocar ninguno.
- `gh secret list --repo mistumonso-cloud/mi-crm` devolvía **vacío**: no había ningún secret configurado, no era un caso de "valores incorrectos" sino de "nada configurado".
- `gh run view` sobre el run más reciente de `main` confirmaba las 5 env vars llegando vacías, y los errores literales `"Faltan E2E_CARLOS_EMAIL/E2E_CARLOS_PASSWORD..."` / `"Faltan E2E_MARTA_EMAIL/E2E_MARTA_PASSWORD..."`.
- Los valores correctos ya existen y se usan a diario en local:
  - `.env.local` → `NEXT_PUBLIC_CONVEX_URL=https://dutiful-mole-111.eu-west-1.convex.cloud` (deployment de dev de Convex, siempre activo en la nube — Playwright no necesita levantar Convex en CI, solo que la URL sea alcanzable).
  - `.env.test.local` (gitignored) → `E2E_CARLOS_EMAIL=carlos@test.local`, `E2E_MARTA_EMAIL=marta@test.local`, y las contraseñas de los dos usuarios de prueba ya sembrados en ese mismo deployment (ver `reference-crm-dev-test-users`).
- `playwright.config.ts`: el `webServer` lanza `npm run dev` (Next.js), no `npx convex dev` — no hace falta ningún paso adicional de arranque de Convex en el job de CI, solo que las 5 env vars lleguen con valor.

## Decisión fijada

**Configurar los 5 secrets del workflow en GitHub con los mismos valores que ya funcionan en local**, sin tocar ningún archivo de `src/`, `convex/`, `e2e/` ni el workflow. No hay `CODIGO/` que instalar — el fix vive enteramente en la configuración del repo de GitHub (Settings → Secrets and variables → Actions), no en git:

| Secret | Valor | Origen |
|---|---|---|
| `NEXT_PUBLIC_CONVEX_URL` | `https://dutiful-mole-111.eu-west-1.convex.cloud` | `.env.local` |
| `E2E_CARLOS_EMAIL` | `carlos@test.local` | `.env.test.local` |
| `E2E_CARLOS_PASSWORD` | *(valor real del usuario de prueba Carlos)* | `.env.test.local` |
| `E2E_MARTA_EMAIL` | `marta@test.local` | `.env.test.local` |
| `E2E_MARTA_PASSWORD` | *(valor real del usuario de prueba Marta)* | `.env.test.local` |

## Fuera de alcance (explícito)

- **Deployment de Convex dedicado a CI** (aislado del que usa `npm run dev` en local) — ya documentado como deuda conocida y aceptada (ver `playwright.config.ts`, `workers: 1` deliberado para no chocar contra el mismo deployment compartido). No es parte de este ticket.
- **Cualquier cambio a `.github/workflows/ci.yml`, `playwright.config.ts` o `e2e/*.spec.ts`** — ya están correctos; el gap era puramente de configuración de secrets, no de código.
- **Rotar las contraseñas de Carlos/Marta** — se reutilizan las mismas credenciales sintéticas ya sembradas y documentadas, no se generan nuevas.

## Limpieza de índices arrastrada de MIS-253

Al tocar `PLANS/README.md` y `CODIGO/README.md` para este ticket, se corrige de paso un olvido del cierre de MIS-253 (su PR #29 ya está mergeado a `main` y el ticket ya está Done en Linear desde 2026-07-26, pero los índices seguían mostrando "pendiente de auditoría"):

- `PLANS/README.md`: fila de MIS-253 → **Instalado**.
- `CODIGO/README.md`: fila de MIS-253 → **Instalado**; carpeta de staging `CODIGO/MIS-253-vista-requieren-atencion/` eliminada (ya no hace falta, el PR está mergeado).

## Verificación

1. `gh secret set` × 5 (valores arriba) — confirmado con `gh secret list --repo mistumonso-cloud/mi-crm`: aparecen los 5 nombres.
2. Se relanzó el job fallido del run de CI más reciente en `main` (el del merge de MIS-253, commit `c4cda4b`) **sin necesidad de ningún commit ni PR nuevo**: `gh run rerun 30207222547 --failed`.
3. Resultado real, observado con `gh run watch`:
   - `e2e` → **✓ en 2m5s**
   - `build` → **✓ en 33s** (ya estaba en verde, no se relanzó)
   - Run completo: <https://github.com/mistumonso-cloud/mi-crm/actions/runs/30207222547>

## Archivos afectados

| Archivo | Tipo |
|---|---|
| `PLANS/MIS-258-ci-secrets-e2e.md` | Nuevo |
| `PLANS/README.md` | Editar (fila MIS-258 nueva + fila MIS-253 corregida) |
| `CODIGO/README.md` | Editar (fila MIS-253 corregida) |
| `CODIGO/MIS-253-vista-requieren-atencion/` | Eliminada (staging ya no necesario) |

No se toca ningún archivo de `src/`, `convex/`, `e2e/` ni `.github/workflows/ci.yml`.

## Estado

**Auditoría:** GO condicionado — condiciones: excluir del commit los cambios ajenos de `DESIGN/`, incluir este documento (estaba untracked) y confirmar en el run de CI del propio PR que `e2e` vuelve a pasar. Las tres se cumplieron antes de mergear.

**Secrets configurados y verificados en verde** (ver sección Verificación). PR #30 abierto en la rama `chore/mis-258-ci-secrets-e2e`; el run de CI disparado por el propio PR confirmó `build` (33s) y `e2e` (2m20s) en verde: <https://github.com/mistumonso-cloud/mi-crm/actions/runs/30208187112>.

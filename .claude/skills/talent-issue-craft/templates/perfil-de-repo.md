# Perfil de repo — parametrización de talent-issue-craft

Rellenado para **Vibe Coder CRM** (`mistumonso-cloud/mi-crm`) el 2026-07-26. Derivado del
propio repo (`CLAUDE.md`, `package.json`, `.github/workflows/ci.yml`, historial de
Linear) salvo los campos marcados como asumidos — revisar y corregir si algo no encaja.

## 1. Identidad y stack

| Parámetro | Valor |
|---|---|
| Nombre del repo/producto | Vibe Coder CRM (`mi-crm`) |
| Stack principal | Next.js 16 (App Router, Turbopack) + React 19 + Tailwind v4 — UI web sí. Backend Convex (documentos, no relacional — sin RLS por fila; seguridad vía `requireRole`/`requireUser` en cada query/mutation, ver `convex/lib/authz.ts`). Sin API pública de terceros, solo la propia app. |
| Idiomas del producto | Español (contenido/UI). Identificadores técnicos en inglés. |
| ¿Multi-tema (claro/oscuro)? | No — sin soporte de dark mode en `src/styles/` a día de hoy. |

## 2. Checks/gates del repo

| Gate | Comando | ¿Bloqueante? |
|---|---|---|
| typecheck | `npx tsc --noEmit` | Sí (Quality Gates de `CLAUDE.md`) |
| lint | `npm run lint` | Sí — es además el único check de rama obligatorio en GitHub (`build` en branch protection de `main`) |
| build | `npm run build` | Sí (job `build` de CI) |
| tests unit | — no hay suite de unit tests en este repo | N/A |
| E2E (Playwright) | `npx playwright test` (CI: `npm run test:e2e`, job `e2e`) | Sí en la práctica (es "la señal de verdad real" del repo, ver `CLAUDE.md` § Quality Gates y memoria de MIS-258) — **pero no es un check obligatorio de branch protection**, solo `build` lo es formalmente en GitHub. |

## 3. Régimen de cierre

- Default de este repo: rama (`feat/fix/refactor/docs/chore/hotfix/mis-N-slug`) + PR a `main` + revisión de auditoría GO/NO-GO + squash merge. **Sin magic words de auto-cierre** (`fixes/closes/resolves`) en el PR — el cierre de la issue en Linear es manual y explícito (`save_issue(state="Done")`) justo tras el merge, con el PR enlazado como adjunto permanente.
- Enriquecido: cualquier ticket que toque `convex/schema.ts` o `convex/*.ts` requiere un `npx convex deploy` explícito a producción **después** de fusionar a `main` (paso aparte y obligatorio — el build de Railway no lo hace, ver Error Crítico 3 de `CLAUDE.md`).

## 4. Superficies sensibles

- **Auth**: `convex/auth.ts`, `src/lib/auth/**` (cookie de sesión `HttpOnly`, hash de contraseña).
- **Autorización por rol**: `convex/lib/authz.ts` (`requireRole`/`requireUser`) — toda query/mutation de `convex/*.ts` que toque datos de contactos/notas/recordatorios/ventas.
- **Datos personales**: `convex/contacts.ts` (nombre, teléfono, email de contactos reales/potenciales clientes).
- Sin pagos, sin migraciones destructivas conocidas hasta la fecha.

## 5. Convenciones

- Título de issue: frase descriptiva en español, sin prefijo de tipo en el título (el tipo va en el identificador de Linear, `MIS-N`) — ej. "Vista: Leads sin próximo paso («Requieren atención»)", "CI: el job e2e falla en GitHub Actions por falta de secrets".
- Rama: `feat/`, `fix/`, `refactor/`, `docs/`, `chore/`, `hotfix/` + `mis-N-slug` (número del ticket de Linear siempre que exista).
- Estimate: sin uso de estimate/story points en este proyecto (equipo de una sola persona + agente).

## 6. Destinatario de escalada

**Asumido, confirmar**: el ejecutor escala directamente al dueño del proyecto (Mistu Monso), por el propio canal de la sesión de Claude Code donde se está trabajando — no hay más gente en el equipo a día de hoy.

## 7. Escalera de enforcement (¿cuándo se corre `audit-issue`?)

- [x] **Dev solo** → antes de empezar cada issue.
- [ ] **Equipo** → al pasar una issue de backlog a la lista de trabajo.
- [ ] **Multi-agente** → además, al agrupar lotes de trabajo y al asignar a un ejecutor.

**Asumido, confirmar**: este repo ya tiene su propio gate de auditoría GO/NO-GO (plan +
código) más elaborado que el `audit-issue` de este skill — se propone `audit-issue`
como pre-check **adicional**, antes de escribir el plan, no como sustituto de la
auditoría ya existente.

**Regla de elegibilidad (idéntica en todos los peldaños)**: el gate operativo SOLO se satisface con una corrida `--issue` (evidencia remota completa) que termine con `classification_source=marker` + `operational_gate_eligible=true` + exit 0. `--file` (body-only) y cualquier override NUNCA lo acreditan — son pre-check de autoría y calibración.

## 8. Umbral de `audit-issue` y calibración

| Parámetro | Valor |
|---|---|
| Umbral `--min-score` vigente | Default genérico: 70 — sin historial propio todavía (skill recién instalado, 2026-07-26) |
| Método | `references/02-verificaciones.md` §10 (≥5 gold vs ≥5 malas → discriminación completa) |
| Última calibración | N/A — pendiente |
| Próxima recalibración | Al acumular 10+ issues de este repo pasadas por `audit-issue --issue` |

## 9. Loop post-rechazo

- Registro de gaps: **a definir** — candidato natural: una sección de "Deuda enviada a follow-up" en `PLANS/MIS-N-*.md` (patrón ya en uso en este repo para hallazgos no bloqueantes de auditoría).
- Responsable de iterar las plantillas con los gaps acumulados: el dueño del proyecto.
- Recordatorio: cambio de núcleo = canon + manifest + 9 plantillas en el MISMO cambio (`templates/00-nucleo.md` §mantenimiento).

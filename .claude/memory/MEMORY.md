# Memoria del proyecto — Vibe Coder CRM

Estado y decisiones acumuladas, en paralelo a la memoria automática entre sesiones de
Claude Code (que vive fuera del repo). Este archivo es la versión visible/versionada
para cualquiera que abra el repo.

## Producto

Dos cuentas fijas, sin alta pública: Carlos (`rep`, operativo, home = "Pendientes del
día") y Marta (`supervisor`, dueña, home = "Panel de oportunidades").

## Flujo de trabajo

- Tracker: Linear, equipo `MIS`, proyecto "CRM - MVP". Toda tarea de código pasa por una
  issue en "In Progress" antes de tocar código.
- Implementación: plan en `PLANS/MIS-N-slug.md` → (si aplica código) staging en
  `CODIGO/MIS-N-slug/` → revisión de auditoría GO/NO-GO → instalación en `src/`/`convex/`
  en rama `feat|fix|chore/mis-N-slug` → PR a `main` → merge (squash) → issue a "Done"
  con el PR enlazado. `PLANS/README.md` y `CODIGO/README.md` son los índices de estado.
- Ningún cambio se sube a GitHub sin GO de auditoría; ningún push se hace sin
  confirmación explícita del dueño del proyecto, incluidos commits de seguimiento
  triviales en una rama ya autorizada.
- Cambio en `convex/schema.ts` o `convex/*.ts` → hace falta un `npx convex deploy`
  explícito a producción después de fusionar a `main` (el build de Railway no lo hace).

## CI

Desde MIS-258 (2026-07-26), el workflow de GitHub Actions (`build` + `e2e`) es una señal
de verdad: los 5 secrets que necesita `e2e` (Convex + credenciales de Carlos/Marta) están
configurados. Un `e2e` en rojo es una regresión real, no ruido conocido.

## Adopción de este CLAUDE.md/AGENTS.md

2026-07-26: se adoptó una plantilla base de `CLAUDE.md`/`AGENTS.md`, tanto a nivel global
del usuario (`~/.claude/CLAUDE.md`) como en este proyecto, reemplazando el AGENTS.md
anterior (que solo tenía el aviso de versión de Next.js — se conservó ese aviso, con sus
marcadores `<!-- BEGIN/END:nextjs-agent-rules -->`, dentro del nuevo archivo). Decisiones
tomadas al adoptarla:

- Sin referencias a IA en commits a partir de ahora (antes se usaba `Co-Authored-By`; los
  commits ya hechos no se reescriben).
- Memoria en-repo (este archivo + `gotchas.md`) en paralelo a la memoria automática
  privada existente, no en su lugar.
- Prefijos de rama cortos (`feat/`, `fix/`, `refactor/`, `docs/`, `chore/`, `hotfix/`)
  siempre con el número de ticket de Linear, sustituyendo el antiguo `feature/mis-N-slug`.
- La regla de "seguridad de datos por defecto" se reescribió para el modelo real de este
  proyecto (Convex: `requireRole`/`requireUser`), no Row Level Security de Postgres.

## Skill de Linear (`.claude/skills/linear-skill/`)

2026-07-26: instalado también aquí (además de a nivel global del usuario, en
`~/.claude/skills/`). Usa el mismo servidor MCP de Linear que ya teníamos activo
(`mcp__linear__*`) como capa primaria para operación puntual, y scripts propios en
TypeScript (GraphQL directo, sin dependencias externas) solo para batch/webhooks. Sin
conflicto con el flujo ya establecido.

**Ojo al aplicarlo a este proyecto**: el skill asume una organización más grande de la
que tenemos (team "ENG", cycles semanales, Triage formal, taxonomía de labels, auto-cierre
de issues por "magic words" en el PR). Este proyecto no usa nada de eso — un solo team
(`MIS`), fases en vez de cycles, sin labels, cierre manual de issues (`Done` = merged +
enlazado, nunca automático). Los workflows del skill (triage, cycle planning/review) no
aplican tal cual aquí; los prompts puntuales (crear issue con dedupe, buscar duplicados,
weekly report) sí son reutilizables sin fricción.

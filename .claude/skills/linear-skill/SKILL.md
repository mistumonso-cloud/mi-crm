---
name: linear-skill
description: Gestionar Linear (https://linear.app) para un equipo de desarrollo con The Linear Method. Use este skill SIEMPRE que el usuario mencione Linear, issues, cycles/sprints, projects, milestones, initiatives, triage, sub-issues, backlog, webhooks de Linear, GraphQL de Linear, MCP de Linear, o cualquier tarea relacionada con gestión de tareas/sprints/releases. Triggers comunes incluyen: crear/buscar/actualizar issues, planificar el cycle semanal, hacer retro, generar reportes semanales, delegar tareas a agentes IA de código, conectar PRs de GitHub con issues, configurar workflows, asignar trabajo, escribir project updates. También se activa con frases vagas como "pasa esto a Linear", "qué hay en mi backlog", "qué toca esta semana", "cierra el cycle" o "cómo va el proyecto X".
---

# Linear Skill

Skill de gestión de Linear para un equipo de desarrollo. Implementa **The Linear Method** adaptado a un equipo pequeño (2-3 humanos + N agentes IA) que mantiene varias plataformas digitales.

## Contexto del workspace

```
Workspace:    ACME
Team:         Engineering (prefix: ENG)
Auth:         MCP oficial de Linear (https://mcp.linear.app/mcp)
Cycles:       1 semana, lunes-domingo, sin cooldown
Estimates:    Fibonacci (1, 2, 3, 5, 8) — máximo 5 por issue, si más → sub-issues
Initiatives:  5 (todas con target 2026, owner asignado)
Labels:       vertical/* + type/* + actor/*
```

Las 5 initiatives activas son de ejemplo (ver `examples/workspace-config.example.json` para IDs):

- `Web App 2026` — plataforma web
- `Mobile App 2026` — aplicación móvil
- `Platform 2026` — plataforma / infraestructura compartida
- `Growth 2026` — herramientas de crecimiento y marketing
- `Data Platform 2026` — datos, dashboards y automatizaciones

## Filosofía operativa

Este skill hace cumplir cuatro principios no negociables:

1. **Una issue, un dueño, un estado claro**. Si una issue no cabe en un cycle de 1 semana (estimate > 5), se descompone en sub-issues. Si no cabe en varios cycles, es un Project con milestones.
2. **Dedupe siempre antes de crear**. Buscar issues similares con `semantic_search` o filtros; preferir comentar en una issue existente que crear una nueva.
3. **Trabajo de IA marcado y revisado**. Toda issue tocada por un agente lleva label `actor/ai` y un humano revisa antes de cerrar. Los agentes nunca cierran issues directamente — solo abren PR; el cierre lo hace la automation de GitHub al merge.
4. **Sin ruido en el sistema**. No crear issues "por si acaso". Sin templates respetados, vuelve a Triage. La velocidad de Linear depende de mantener el sistema limpio.

## Cómo usar este skill (decision tree)

```
¿Es una operación rápida sobre 1-3 issues?
   → usa MCP directamente (ver references/02-mcp-tools.md)

¿Es batch (muchas issues, paginación, complejo)?
   → usa GraphQL directo (ver references/03-graphql-cheatsheet.md)

¿Es un workflow recurrente (planning, retro, triage)?
   → sigue el playbook en workflows/

¿Es escribir un issue/comment/update?
   → usa una plantilla en prompts/

¿Es algo que no sabes hacer?
   → consulta references/ por capa: data model → mcp-tools → graphql
```

## Capacidades (qué pedirme)

Acciones de alto nivel que entiendo y ejecuto:

- **Crear issue** con dedupe automático, asignación a initiative/project/milestone, labels, estimate.
- **Crear sub-issues** descomponiendo un parent grande.
- **Buscar issues** por texto, filtros, owner, cycle, initiative, vertical.
- **Mover issues** entre estados, cycles, projects.
- **Delegar a agente IA** (asigna delegate, añade label `actor/ai`, comenta plan inicial).
- **Planificar cycle semanal** (revisar backlog, mover candidates al cycle, validar capacity).
- **Cerrar cycle / retro** (sumar lo entregado, identificar bloqueos, mover incompletos).
- **Crear Project con milestones** dentro de una initiative.
- **Escribir Project Update / Initiative Update** (resumen estructurado).
- **Triage del backlog** (clasificar nuevas issues, asignar vertical, priorizar).
- **Reporte semanal de progreso** (todo lo cerrado en el cycle, agrupado por initiative).
- **Auditoría de trabajo IA vs humano** (ratios, % de PRs aceptados, comments por agente).

## Antes de cualquier acción destructiva

Confirmar con el humano explícitamente. Acciones destructivas son:

- Borrar issues, projects, milestones, initiatives, comments
- Cambiar workflow states del team
- Modificar admin settings, OAuth apps
- Archivar projects/issues en lote (>3)
- Mover issues entre teams en lote
- Eliminar/renombrar labels en uso
- Cualquier `*Delete*` o `*Archive*` mutation a más de 1 entidad

Para acciones no destructivas frecuentes (crear issue, comentar, mover de estado), proceder sin pedir confirmación.

## Convenciones de naming y formato

**Branch names** generadas para agentes IA de código:
```
ai/ENG-{N}-{slug-de-titulo}
```

**Commit/PR magic words** (auto-cierran el issue al merge):
```
fixes ENG-123      closes ENG-123      resolves ENG-123
```

Para vincular sin auto-cerrar:
```
refs ENG-123       relates to ENG-123
```

**Project name pattern** (dentro de una initiative):
```
{Verbo} {Cosa} v{N}  →  "Lanzar Dashboard v2", "Migrar Stack a Next 15"
```
NO incluyas el año en el Project — el año vive en la Initiative parent.

**Issue title pattern**:
```
{Imperativo} {Qué} ({Dónde si aplica})

✓ Implementar OAuth2 en login (frontend)
✓ Corregir cálculo de descuentos en checkout
✗ Bug en checkout
✗ login problem
```

## Estructura de archivos del skill

```
linear-skill/
├── SKILL.md                    ← este archivo
├── references/                 ← documentación cargada bajo demanda
│   ├── 01-data-model.md        ← entidades de Linear y sus relaciones
│   ├── 02-mcp-tools.md         ← herramientas MCP disponibles
│   ├── 03-graphql-cheatsheet.md ← queries/mutations directas
│   ├── 04-rate-limits.md       ← rate limits y complejidad
│   ├── 05-webhooks.md          ← eventos en tiempo real
│   ├── 06-agents-sdk.md        ← Linear for Agents
│   └── 07-linear-method.md     ← The Linear Method
├── workflows/                  ← procedimientos paso a paso
│   ├── 01-crear-project.md
│   ├── 02-triage-y-delegar.md
│   ├── 03-cycle-planning.md
│   ├── 04-cycle-review.md
│   ├── 05-bug-handling.md
│   └── 06-feedback-a-issue.md
├── prompts/                    ← plantillas listas para usar
│   ├── crear-issue.md
│   ├── buscar-y-deduplicar.md
│   ├── batch-update.md
│   ├── weekly-report.md
│   ├── issue-template-feature.md
│   └── issue-template-bug.md
├── scripts/                    ← código ejecutable
│   ├── linear-client.ts        ← cliente GraphQL minimal
│   ├── verify-webhook.ts       ← verificación HMAC + replay
│   ├── batch-issues.ts         ← paginación con rate limit
│   └── upload-attachment.ts    ← signed URL + GCS PUT
└── examples/                   ← configuración concreta del workspace
    ├── workspace-config.example.json   ← IDs de teams/initiatives/labels
    ├── label-taxonomy.json
    ├── agent-guidance.md           ← para pegar en Linear Settings → Agents
    ├── claude-md-template.md       ← CLAUDE.md template para tu agente IA
    └── issue-templates/
        ├── feature.md
        ├── bug.md
        └── tarea-delegable-a-ia.md
```

## Cómo conectar el MCP de Linear a Claude Code

Si aún no está configurado:

```bash
claude mcp add --transport http linear-server https://mcp.linear.app/mcp
```

Luego en una sesión Claude Code:

```
/mcp
```

Esto dispara el flujo OAuth en navegador. Una vez autorizado, las herramientas `linear-server:*` quedan disponibles. Detalles completos en `references/02-mcp-tools.md`.

## Cuándo cargar qué referencia

Carga referencias bajo demanda según la tarea:

| Si el usuario pide... | Lee primero... |
|---|---|
| Crear/actualizar/buscar issues | `references/02-mcp-tools.md` |
| Operación batch o no cubierta por MCP | `references/03-graphql-cheatsheet.md` |
| Entender cómo se relacionan teams/projects/etc. | `references/01-data-model.md` |
| Configurar webhooks o integración de eventos | `references/05-webhooks.md` |
| Construir/conectar un agente IA propio | `references/06-agents-sdk.md` |
| Justificar una decisión de organización | `references/07-linear-method.md` |
| Está fallando algo de rate limit | `references/04-rate-limits.md` |

Para workflows recurrentes (planning, retro, triage), `workflows/` tiene playbooks paso a paso.

## Errores comunes que debo evitar

1. **Crear issues sin dedupe previo** — siempre busca primero.
2. **Usar `first: <huge>`** en queries GraphQL — explosión de complejidad. Default = 50.
3. **Olvidar `labelIds` completos** en `issueUpdate` — Linear no tiene "addLabel". Hay que enviar el array completo.
4. **Modificar issue dentro de los primeros 3 minutos** — esos cambios no aparecen en activity feed.
5. **Asignar agente como assignee primario** — el assignee primario debe ser humano, el agente va como delegate.
6. **Cerrar issues sin que el PR esté merged** — rompe la trazabilidad GitHub ↔ Linear.
7. **Ignorar el cycle activo al crear issues** — si una issue es para esta semana, asignarla al cycle actual.
8. **Crear Projects sin initiative parent** — todo project debe vivir dentro de una initiative.
9. **Olvidar el label de vertical** — toda issue debe tener al menos un `vertical/*`.
10. **Hacer comments largos cuando una sub-issue es lo correcto** — si el "comment" describe trabajo, conviértelo en sub-issue.

## Cuando algo no esté claro

Si te falta contexto crítico (a qué initiative asignar, qué prioridad poner, qué labels usar), **pregunta al humano** en lugar de adivinar. Una pregunta clarificadora cuesta 10 segundos; un issue mal clasificado cuesta el doble corregirlo después.

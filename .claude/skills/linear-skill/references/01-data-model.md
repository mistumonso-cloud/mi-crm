# Linear — Modelo de datos

Referencia completa de las entidades de Linear y sus relaciones. Lee este documento cuando necesites entender qué campo va dónde, qué relaciones existen entre entidades, o qué propiedades soporta cada objeto.

## Tabla de contenidos

1. [Jerarquía conceptual](#jerarquía-conceptual)
2. [Workspace](#workspace)
3. [Team](#team)
4. [Initiative](#initiative)
5. [Project](#project)
6. [Milestone](#milestone)
7. [Cycle](#cycle)
8. [Issue](#issue) ← entidad central
9. [Sub-issues e issue relations](#sub-issues-e-issue-relations)
10. [Workflow State](#workflow-state)
11. [Label](#label)
12. [Comment](#comment)
13. [Attachment](#attachment)
14. [Document](#document)
15. [Customer y Customer Need](#customer-y-customer-need)
16. [User vs App User (agente)](#user-vs-app-user-agente)
17. [Agent Session y Agent Activity](#agent-session-y-agent-activity)
18. [Otras entidades](#otras-entidades-relevantes)

## Jerarquía conceptual

```
Workspace (ACME)
├── Initiatives (workspace-level, atraviesan teams)
│   ├── Web App 2026
│   ├── Mobile App 2026
│   ├── Platform 2026
│   ├── Growth 2026
│   └── Data Platform 2026
│
├── Teams
│   └── Engineering (ENG)
│       ├── Cycles (1 semana c/u)
│       ├── Workflow States (Triage → Backlog → Todo → In Progress → In Review → Done/Canceled)
│       ├── Issues
│       │   ├── Sub-issues
│       │   ├── Comments
│       │   ├── Attachments
│       │   ├── Labels
│       │   └── Estimate, Priority, Assignee, Delegate
│       └── Templates
│
└── Workspace-level features
    ├── Customers + Customer Needs
    ├── Asks
    ├── Pulse
    ├── Insights / Dashboards
    ├── Agents (app users)
    └── Documents
```

Un **Project** vive dentro de una o varias Initiatives (puede compartirse entre teams). Las **issues** pertenecen a exactamente un Team, opcionalmente a un Project, opcionalmente a un Milestone, opcionalmente a un Cycle.

## Workspace

La cuenta de la organización. Contiene todo lo demás. Es la **unidad de facturación** y de identidad.

**Propiedades clave**:
- `id` (UUID), `name` ("ACME"), `urlKey` ("acme")
- `gitBranchFormat` — patrón de branch names que Linear genera
- Configuración de Initiatives, Customers, Pulse, agentes, Asks, etc. (todas son workspace-level)

**Decisiones operativas**:
- Solo ACME usa **un** workspace. NO crear workspaces separados por vertical.
- Los miembros se invitan al workspace; luego se añaden a teams individuales.

## Team

Grupo que trabaja junto frecuentemente. Cada team tiene su propio ritmo (cycles, triage, backlog).

**Propiedades clave**:
- `id`, `name` ("Engineering"), `key` ("ENG") — el prefix de los issues (ENG-1, ENG-2…)
- `cyclesEnabled`, `cycleDuration`, `cycleStartDay`, `cycleCooldownTime`
- `triageEnabled` — si el team tiene bandeja Triage activa
- `defaultIssueState`, `defaultIssueEstimate`
- `timezone` — relevante para cycles
- Configuración por team: workflow states, templates, agents asignables, agent guidance

**Configuración actual del team ENG**:
- Cycles: 1 week, lunes-domingo, sin cooldown, auto-create 2 cycles
- Auto-add started/completed issues a cycle: ON
- Auto-add active issues con due date: OFF
- Estimates: Fibonacci (1, 2, 3, 5, 8)

**Cuándo crear otro team**:
- Solo si un grupo nuevo necesita SU PROPIO backlog y SU PROPIO ritmo de cycles
- 2-3 humanos no necesitan más teams. Mantenerlo así.

## Initiative

Concepto **workspace-level** introducido en julio 2024. Agrupa Projects bajo un objetivo estratégico. **Atraviesan teams** y duran meses/años. Visible para todos los miembros (no soporta privacidad por team).

**Propiedades clave**:
- `id`, `name`, `description` (Markdown)
- `owner` (User) — único responsable, no múltiples
- `state` — `Planned`, `Active`, `Completed`
- `targetDate` — puede ser day/month/quarter/half/year
- `health` — calculado de los project updates
- `subInitiatives` — sí, soportadas (parent/child)

**Las 5 initiatives activas**:

| Nombre | Vertical asociado | Target |
|---|---|---|
| Web App 2026 | web | 2026 |
| Mobile App 2026 | mobile | 2026 |
| Platform 2026 | platform | 2026 |
| Growth 2026 | growth | 2026 |
| Data Platform 2026 | data | 2026 |

Cuando una issue pertenece a un Project, hereda implícitamente la Initiative del project. **No marques la initiative directamente en el issue** — déjala derivar del project.

## Project

Esfuerzo entregable acotado en el tiempo. Tiene fecha de entrega y un único `lead`.

**Propiedades clave**:
- `id`, `name`, `description`, `summary` (campo TL;DR), `icon`, `color`
- `state` — `backlog`, `planned`, `started`, `paused`, `completed`, `canceled`
- `lead` (User) — único
- `members` — colaboradores, opt-in para notificaciones
- `startDate`, `targetDate` — pueden ser día concreto, mes, quarter, half o year
- `priority`, `health` (`onTrack`, `atRisk`, `offTrack`), `progress` (0-1)
- `teams` — uno o varios (raro tener varios)
- `initiatives` — uno o varios
- `milestones`, `documents`, `projectUpdates`
- `gitBranchFormat`

**Cuándo es Project (vs no serlo)**:
- ✅ Tiene fecha de entrega y se acaba
- ✅ Tiene un único entregable identificable
- ✅ Tiene lead único
- ❌ Trabajo continuo sin fin → no es project, es backlog del team
- ❌ Sin fecha clara → no es project todavía, todavía es idea

**Naming**: imperativo + objeto + versión, sin año:
- ✓ "Lanzar Dashboard de Métricas v1"
- ✓ "Migrar autenticación a OAuth"
- ✓ "Refactor del módulo de pagos"
- ✗ "Dashboard 2026" (el año va en la initiative)

## Milestone

Fase intermedia dentro de un Project. NO es un mini-project — es un checkpoint.

**Propiedades clave**:
- `id`, `name`, `description`, `targetDate`
- `project` (parent), `sortOrder`
- `progress` (0-1), `state`

**Patrón típico** (3-5 milestones por project, no más):
```
Project: "Lanzar Dashboard de Métricas v1"
├── M1: Diseño y wireframes aprobados
├── M2: Backend con datos reales
├── M3: Frontend funcional
├── M4: Beta cerrada con feedback
└── M5: Lanzamiento público
```

Cada Issue del project se asigna a 0 o 1 milestone. Los milestones dan la **barra de progreso por fase**.

## Cycle

Periodo de tiempo (1 semana en el team ENG). Linear los crea automáticamente. Los issues no completados se mueven al siguiente cycle.

**Propiedades clave**:
- `id`, `number` (1, 2, 3…), `name` (opcional)
- `team` (parent)
- `startsAt`, `endsAt` — fechas inmutables una vez en el pasado
- `progress`, `completedAt`, `autoArchivedAt`
- `issues` (las del cycle), `uncompletedIssuesUponClose`

**Ciclo de vida**:
1. Linear crea el cycle automáticamente (auto-create 2 ahead)
2. El equipo lo planifica el lunes (mover issues del backlog al cycle)
3. Trabajo durante la semana; los started issues se auto-añaden si no estaban
4. El viernes/domingo se cierra; los incompletos rebotan al siguiente
5. Linear archiva el cycle cerrado

**Reglas**:
- Las fechas pasadas no se pueden cambiar
- Un cycle activo puede cerrarse anticipadamente
- El día de inicio se elige una vez por team, no por cycle individual

## Issue

**Entidad central** de Linear. Todo gira en torno a issues.

**Propiedades obligatorias al crear**:
- `title` (string)
- `teamId` — el team al que pertenece

**Propiedades opcionales pero importantes**:
- `description` — Markdown, puede ser largo
- `assigneeId` — humano responsable principal (NO un agente)
- `delegateId` — agente delegado (entró en Linear for Agents 2025)
- `stateId` — workflow state actual
- `projectId`, `cycleId`, `projectMilestoneId` — vinculación
- `parentId` — para sub-issues
- `labelIds` — array de UUIDs de labels (workspace o team)
- `priority` — entero: 0 None, 1 Urgent, 2 High, 3 Normal/Medium, 4 Low
- `estimate` — número de la escala (Fibonacci: 1, 2, 3, 5, 8)
- `dueDate` — ISO date
- `templateId` — si se crea desde un template

**Propiedades derivadas / read-only**:
- `id` (UUID), `identifier` ("ENG-123") — Linear te permite usar el identifier en lugar del UUID en muchas mutations
- `branchName` — generado automáticamente; usable para crear branches
- `url` — link directo a la issue
- `createdAt`, `updatedAt`, `completedAt`, `canceledAt`, `archivedAt`

**Importante**:
- Las modificaciones en los **primeros 3 minutos** se consideran parte de la creación y NO aparecen en activity feed.
- Para añadir/quitar labels NO existe `issueAddLabel` — hay que recuperar `labelIds` actuales y reenviarlos completos en `issueUpdate`.

**Priority — convención de uso en ENG**:
- `Urgent` (1) — bloqueando producción, hay revenue/usuarios afectados
- `High` (2) — del cycle actual, debe entregarse esta semana
- `Normal/Medium` (3) — del backlog priorizado, próximo cycle
- `Low` (4) — nice-to-have, sin compromiso de fecha
- `None` (0) — sin priorizar todavía

## Sub-issues e issue relations

**Sub-issues** (parent/child):
- Una issue puede tener un `parent` y/o varias `children`
- Cada sub-issue es **independiente**: tiene su propio state, assignee, estimate, cycle
- Casos de uso: descomponer una feature grande, dividir trabajo entre humano e IA, fasear un bug fix complejo

**Issue relations** (no jerárquico):
- `blocks` / `blockedBy` — A bloquea a B
- `relatedTo` — relacionado, sin dirección
- `duplicateOf` — A es duplicado de B (cierra A, mantiene B)

**Regla operativa**: Si una issue tiene estimate >5, divídela en sub-issues. Si tiene >3 sub-issues complejas, conviértela en Project.

## Workflow State

Estado en el flujo de trabajo. **Cada team define los suyos**, dentro de 6 *types* fijos:

| Type | Significado | Ejemplo en ENG |
|---|---|---|
| `triage` | bandeja de entrada, sin clasificar | "Triage" |
| `backlog` | clasificada, sin priorizar | "Backlog" |
| `unstarted` | priorizada, lista para arrancar | "Todo" |
| `started` | en progreso | "In Progress", "In Review" |
| `completed` | terminada | "Done" |
| `canceled` | abandonada | "Canceled", "Duplicate" |

**Propiedades**:
- `id`, `name`, `type` (uno de los 6), `color`, `position`
- `team` (parent)

**Reglas**:
- Un team puede tener múltiples states del mismo type (ej: "In Progress" e "In Review" ambos type=`started`)
- Triage es opcional pero recomendado
- Auto-archivo: states `completed` y `canceled` archivan automáticamente tras N días configurable

## Label

Etiqueta para filtrar y organizar. Pueden ser de **workspace** (compartidas por todos los teams) o de **team** (solo ese team las ve).

**Propiedades**:
- `id`, `name`, `color`, `description`
- `team` (null si es workspace label)
- `parent` — soporta jerarquía (label groups)

**Taxonomía actual del workspace**:

```
vertical/  (workspace, agrupa por producto)
├── vertical/web
├── vertical/platform
├── vertical/mobile
├── vertical/growth
└── vertical/data

(legacy de Linear, mantener):
├── Bug
├── Feature
└── Improvement
```

**Recomendado añadir** (si no existen):
```
type/         (workspace)
├── type/feature
├── type/bug
├── type/chore
├── type/refactor
├── type/security
└── type/docs

area/         (workspace)
├── area/frontend
├── area/backend
├── area/infra
├── area/db
└── area/integrations

actor/        (workspace) — clave para distinguir trabajo IA vs humano
├── actor/human
├── actor/ai
└── actor/needs-review

risk/         (workspace) — opcional
├── risk/low
├── risk/medium
└── risk/high
```

**Reglas**:
- Toda issue debe tener al menos un `vertical/*`
- Una issue tocada por un agente debe tener `actor/ai`
- No duplicar `priority` con labels (Linear ya tiene priority como campo)

## Comment

Mensaje en una issue. Soporta threads, menciones, reacciones, sync con Slack/GitHub.

**Propiedades**:
- `id`, `body` (Markdown), `user` (autor), `issue` (parent)
- `parent` — si es respuesta en un thread
- `editedAt`, `reactions`
- `botActor` — si el comment lo creó una integración

**Buenas prácticas**:
- Si un comment describe trabajo a hacer, conviértelo en sub-issue.
- Para conversaciones largas, usa threads (`parent`) en vez de comments planos.
- Mencionar (`@username`) genera notificación.

## Attachment

Adjunto en una issue. Puede ser archivo (subido a GCS de Linear) o URL externa (PR de GitHub, ticket de Zendesk, doc).

**Propiedades**:
- `id`, `title`, `subtitle`, `url`, `metadata` (JSON con info del source)
- `source` — string identificando origen ("github", "figma", custom...)
- `issue` (parent)

**Patrones**:
- PRs de GitHub se adjuntan automáticamente cuando el commit/PR menciona el issue
- Para subir archivos se usa `attachmentLinkURL` o flow de signed URL

## Document

Doc Markdown enriquecido vinculado a un Project, Initiative o Issue.

**Propiedades**:
- `id`, `title`, `content` (Markdown), `icon`
- `project` o `initiative` (uno de los dos como parent)
- Soporta secciones colapsables `+++ Title ... +++`

**Cuándo usarlo**:
- Specs de un project
- Notas de retrospectiva
- Decision records
- Documentación operativa que evoluciona

## Customer y Customer Need

**Customer Requests** lanzados en diciembre 2024. Permiten ligar feedback de usuarios reales a issues/projects.

**Customer**:
- `id`, `name`, `domain`, `tier`, `revenue`, `size`
- Sincronizable desde Salesforce, HubSpot, Intercom

**Customer Need** (también llamado Customer Request):
- `id`, `body`, `customer`, `attachment` (la fuente — Slack thread, Intercom, email...)
- `issue` o `project` — a qué se vincula
- `priority`, `bundleId` (agrupar varias por tema)

**Uso en ACME**: si un equipo de operación de ACME nos pide algo (ej: "necesitamos endpoint para reportes"), se crea un Customer Need vinculado al issue de desarrollo. Esto preserva trazabilidad sin meter operación en Linear.

## User vs App User (agente)

**User**: persona humana. `id`, `name`, `displayName`, `email`, `avatarUrl`.

**App User** (agente IA, lanzado mayo 2025 en "Linear for Agents"):
- Es un user con `isApp: true`
- Tiene perfil completo, claramente identificado como app
- Se @-menciona, se asigna, comenta como cualquier user
- **No es seat facturable** — instalado y gestionado por admins
- Visible en menús de assignment si la app tiene scope `app:assignable`
- Visible en menciones si tiene scope `app:mentionable`

**Cuando una issue se asigna a un agente**:
- El humano sigue siendo `assignee` primario (responsabilidad)
- El agente se pone como `delegate` (contributor)
- Hay un campo distinto **Delegate** que permite filtrar e Insights por agente

## Agent Session y Agent Activity

Sistema introducido con Linear for Agents para que los agentes IA reporten progreso de manera estructurada.

**AgentSession**:
- Unidad de trabajo entre agente y workspace
- 6 estados: `pending`, `active`, `error`, `awaitingInput`, `complete`, `stale`
- Linear los gestiona automáticamente según la última `AgentActivity` emitida
- Se asocia a una issue + un agente

**AgentActivity** (tipos):
- `thought` — razonamiento interno visible
- `action` — acción ejecutada (con resultado)
- `elicitation` — pidiendo input al humano
- `prompt` — entrada original
- `response` — respuesta del agente

**Restricción crítica**: el agente debe responder con `agentActivityCreate` o `agentSessionUpdate` en **<10 segundos** o la sesión se marca como `unresponsive`.

Detalles completos en `references/06-agents-sdk.md`.

## Otras entidades relevantes

- **IssueLabel** — relación many-to-many entre Issue y Label
- **IssueRelation** — relación many-to-many entre Issues (blocks, relatedTo, duplicateOf)
- **Reaction** — emoji reaction a comments o issues
- **ProjectUpdate** — status update semanal (text + health)
- **InitiativeUpdate** — equivalente a project update, a nivel initiative
- **IssueSLA** — para tracking de tiempos de respuesta
- **Reminder** — recordatorios programados sobre issues
- **Favorite** — items favoriteados por un user
- **View** (custom view) — filtros guardados, list/board/timeline
- **Template** — plantillas de issue/project con valores por defecto
- **Webhook** — config de webhooks salientes
- **OAuthApp** — apps OAuth instaladas en el workspace
- **AuditEntry** — entrada de log de auditoría (Enterprise)
- **PermissionChange** — cambio de permisos
- **Reaction** — reacciones emoji en issues/comments

Para detalles GraphQL de cualquiera de estas entidades, ver `references/03-graphql-cheatsheet.md` o el schema vivo en https://studio.apollographql.com/public/Linear-API/variant/current/schema/reference

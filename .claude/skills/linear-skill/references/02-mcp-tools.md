# Linear MCP — Herramientas disponibles

Referencia de las herramientas expuestas por el MCP server oficial de Linear (`https://mcp.linear.app/mcp`). Lee este documento cuando vayas a hacer cualquier operación contra Linear; es la primera capa de acceso (más simple que GraphQL directo).

## Tabla de contenidos

1. [Conexión y autenticación](#conexión-y-autenticación)
2. [Convenciones de las tools MCP](#convenciones-de-las-tools-mcp)
3. [Tools de listing](#tools-de-listing)
4. [Tools de reading (get)](#tools-de-reading-get)
5. [Tools de saving (create/update)](#tools-de-saving-createupdate)
6. [Tools de creating (specialized)](#tools-de-creating-specialized)
7. [Tools de delete](#tools-de-delete)
8. [Other tools](#other-tools)
9. [Patrones comunes](#patrones-comunes)
10. [Coste y limitaciones](#coste-y-limitaciones)

## Conexión y autenticación

**Endpoint**: `https://mcp.linear.app/mcp` (HTTP streamable)

**Endpoint legacy SSE**: `https://mcp.linear.app/sse` (compatibilidad con `mcp-remote`)

**Autenticación**: OAuth 2.1 con dynamic client registration. Linear gestiona el flujo. Soporta también `Authorization: Bearer <token>` con un OAuth access token o personal API key directamente.

**Configuración en Claude Code**:

```bash
claude mcp add --transport http linear-server https://mcp.linear.app/mcp
```

Después, en una sesión:

```
/mcp
```

Esto abre el navegador para autorizar. Una vez autorizado, las tools quedan disponibles bajo prefix `linear-server:` (o el nombre que hayas dado al MCP).

**Configuración alternativa (Windsurf/Zed/VS Code y otros editores compatibles)** vía `mcp-remote`:

```json
{
  "mcpServers": {
    "linear": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://mcp.linear.app/mcp"]
    }
  }
}
```

**Verificar conexión**: pide al modelo "lista mis teams en Linear" — si responde con `Engineering (ENG)`, la conexión está bien.

## Convenciones de las tools MCP

Todas las tools del MCP de Linear comparten unas convenciones:

1. **Aceptan identifiers humanos además de UUIDs**:
   - Issue: `ENG-123` o el UUID
   - Team: `ENG` o el UUID
   - User: email, displayName, o `me` (para el viewer)
   - Project: nombre del project o UUID

2. **Devuelven JSON estructurado** con todos los campos relevantes; las URLs de Linear están incluidas para abrir directamente en navegador.

3. **Operaciones idempotentes en su mayoría** — `save_*` hace upsert (crea si no existe, actualiza si sí).

4. **Sin paginación implícita** — la mayoría retornan los primeros 50 resultados; usa filtros para acotar.

5. **Errores legibles** — los mensajes de error vienen del API GraphQL y suelen explicar qué falta.

## Tools de listing

Recuperan colecciones. Soportan filtros básicos.

### `list_issues`

Lista issues con filtros. Es la tool más usada.

**Parámetros principales**:
- `team` — `ENG` o UUID o nombre
- `assignee` — `me`, email, displayName o UUID; especial `nobody` para sin asignar
- `delegate` — agente IA delegado
- `state` — uno o varios state names (`Todo`, `In Progress`, `Done`)
- `stateType` — uno o varios types (`triage`, `backlog`, `unstarted`, `started`, `completed`, `canceled`)
- `project` — nombre o UUID
- `cycle` — número o UUID; especial `current` para cycle activo
- `initiative` — nombre o UUID
- `label` — uno o varios; nombre o UUID
- `priority` — entero (0-4)
- `query` — full-text search
- `createdAfter`, `updatedAfter`, `dueBefore` — fechas ISO
- `parent` — para ver sub-issues de una issue parent
- `includeArchived` — boolean
- `first` — máximo de resultados (defecto 50)

**Ejemplo de uso**:
```
"Dame las issues asignadas a mí en el cycle activo del team ENG"
→ list_issues(team="ENG", assignee="me", cycle="current")

"Lista las issues con label vertical/data en estado started"
→ list_issues(team="ENG", label="vertical/data", stateType="started")

"Dame todas las issues con label actor/ai del último mes"
→ list_issues(team="ENG", label="actor/ai", createdAfter="2026-04-04")
```

### `list_projects`

Lista projects del workspace.

**Parámetros**:
- `team` — filtrar projects de un team
- `initiative` — filtrar por initiative
- `state` — `backlog`, `planned`, `started`, `paused`, `completed`, `canceled`
- `lead` — `me` o usuario
- `includeArchived` — boolean

```
"Lista los projects activos de la initiative Growth 2026"
→ list_projects(initiative="Growth 2026", state="started")
```

### `list_teams`

Lista los teams del workspace. Casi siempre será solo `Engineering (ENG)`.

### `list_users`

Lista miembros del workspace, incluyendo app users (agentes) si tienes scope.

**Filtros útiles**:
- `query` — búsqueda por nombre/email
- `includeApps` — boolean para incluir o no a los agentes IA

### `list_documents`

Documents del workspace.

### `list_cycles`

Cycles del team. Los cycles vienen ordenados por número.

**Filtros**:
- `team` — `ENG`
- `type` — `current`, `next`, `previous`, `unfinished`

### `list_comments`

Comments de un issue específico.

**Parámetros**:
- `issue` — `ENG-123` o UUID (requerido)

### `list_issue_labels` / `list_project_labels`

Labels disponibles en el team o workspace.

### `list_issue_statuses`

Workflow states del team. Útil para descubrir IDs de los states antes de hacer `save_issue` con `stateId`.

### `list_milestones`

Milestones de un project.

**Parámetros**:
- `project` — nombre o UUID (requerido)

## Tools de reading (get)

Recuperan UN objeto específico con todos sus detalles.

### `get_issue`

```
"Muéstrame ENG-42 con sus comments y attachments"
→ get_issue(issue="ENG-42")
```

Devuelve la issue completa: title, description, state, assignee, delegate, project, cycle, milestone, labels, estimate, priority, dueDate, attachments, branch name, URL, comments (con threads), reactions, sub-issues, parent.

### `get_project`

Devuelve el project con: lead, members, milestones, projectUpdates, documents, issues count, health, progress.

### `get_team`

Configuración del team: cycles config, workflow states, members, agents asignados.

### `get_user`

Perfil de user (humano o app).

### `get_document`

Document con su contenido Markdown.

### `get_issue_status`

Detalles de un workflow state.

### `get_milestone`

Milestone con sus issues.

## Tools de saving (create/update)

**Importante**: Linear consolidó `create_*` y `update_*` en `save_*` (upsert). Si pasas un `id`, actualiza; si no, crea.

### `save_issue`

La tool **más importante** del skill. Crea o actualiza una issue.

**Para crear** (sin `id`):
- `team` (requerido) — `ENG` o UUID
- `title` (requerido) — string
- `description` — Markdown
- `assignee` — user identifier (default: nadie)
- `delegate` — agente identifier
- `state` — name del state
- `project` — nombre o UUID
- `cycle` — número, UUID, o `current`/`next`
- `milestone` — nombre o UUID (debe pertenecer al project)
- `parent` — `ENG-X` para crear como sub-issue
- `labels` — array de nombres ["vertical/data", "type/feature"]
- `priority` — entero 0-4
- `estimate` — número
- `dueDate` — ISO date

**Para actualizar** (con `id` o `identifier`):
- `id` o `identifier: "ENG-42"`
- Cualquier campo modificable

**⚠️ Cuidado con labels en update**: el field `labels` REEMPLAZA el conjunto entero. Para añadir un label sin perder los existentes, primero `get_issue`, luego enviar `[...existing, "new-label"]`.

**Ejemplos**:

```
"Crea un issue 'Implementar OAuth en login' en el project 'Auth v2', 
  asígnalo al cycle actual, label vertical/growth, type/feature, priority high, estimate 3"

→ save_issue(
    team="ENG",
    title="Implementar OAuth en login (frontend)",
    description="…",
    project="Auth v2",
    cycle="current",
    labels=["vertical/growth", "type/feature"],
    priority=2,
    estimate=3
  )
```

```
"Mueve ENG-42 a In Progress y asígnamelo"

→ save_issue(
    identifier="ENG-42",
    state="In Progress",
    assignee="me"
  )
```

### `save_project`

Crea o actualiza un project.

**Para crear**:
- `team` (requerido)
- `name` (requerido)
- `description`, `summary`
- `lead` — user identifier
- `state` — `planned`, `started`
- `startDate`, `targetDate`
- `priority`
- `initiatives` — array de nombres/UUIDs (vincular a initiatives)

**Ejemplo**:
```
"Crea un project 'Lanzar Dashboard de Métricas v1' en la initiative Data Platform 2026, 
  con target Q3 2026, lead yo"

→ save_project(
    team="ENG",
    name="Lanzar Dashboard de Métricas v1",
    description="…",
    lead="me",
    state="planned",
    targetDate="2026-09-30",
    initiatives=["Data Platform 2026"]
  )
```

### `save_comment`

Crea o actualiza un comment en un issue.

**Para crear**:
- `issue` (requerido) — `ENG-X`
- `body` (requerido) — Markdown
- `parent` — UUID del comment al que responde (para threads)

**Ejemplo**:
```
"Comenta en ENG-42 que ya empecé el branch y abrí el PR #123"
→ save_comment(
    issue="ENG-42",
    body="Empecé el trabajo. Branch: `ai/ENG-42-implementar-oauth`. PR: https://github.com/.../pull/123"
  )
```

### `save_document`

Crea o actualiza un Document (vinculado a project o initiative).

### `save_milestone`

Crea o actualiza un milestone dentro de un project.

**Para crear**:
- `project` (requerido)
- `name` (requerido)
- `description`
- `targetDate`
- `sortOrder` — para ordenar manualmente

## Tools de creating (specialized)

### `create_issue_label`

Crea un nuevo label.

**Parámetros**:
- `name` (requerido)
- `color` — hex
- `description`
- `team` — UUID, si null el label es de workspace
- `parentLabel` — UUID, para crear dentro de un label group

### `create_attachment`

Crea un attachment en una issue.

**Parámetros**:
- `issue` (requerido)
- `title` (requerido)
- `url` (requerido) — link externo
- `subtitle`, `iconUrl`, `metadata`

```
"Adjunta el doc de Notion https://notion.so/... a ENG-42"
→ create_attachment(
    issue="ENG-42",
    title="Especificación funcional",
    url="https://notion.so/...",
    iconUrl="https://www.notion.so/images/favicon.ico"
  )
```

## Tools de delete

**Aplica regla de confirmación** del SKILL.md — siempre pedir confirmación al humano.

### `delete_attachment`

Borra un attachment por ID.

### `delete_comment`

Borra un comment.

**Cuándo usarla**:
- Borrar comments de prueba
- Limpiar comments duplicados de una integración rota

**Cuándo NO usarla**:
- Borrar comments con valor histórico (mejor editarlos para anotar contexto)

## Other tools

### `extract_images`

Extrae y devuelve las imágenes embebidas en una description o comment Markdown. Útil cuando la issue tiene imágenes pegadas y necesitas verlas.

```
"Muéstrame las imágenes pegadas en ENG-42"
→ extract_images(issue="ENG-42")
```

### `search_documentation`

Busca en la documentación oficial de Linear. Útil para responder preguntas del tipo "¿cómo configuro X feature?".

```
"¿Cómo activo Triage Intelligence?"
→ search_documentation(query="enable Triage Intelligence")
```

## Patrones comunes

### Patrón 1 — Crear issue con dedupe

Antes de crear cualquier issue importante:

```
1. list_issues(team="ENG", query="<keywords del title propuesto>", first=10)
2. Revisar resultados:
   - Si hay muy similar en started/unstarted → comentar en esa
   - Si hay similar en backlog → preguntar al humano si actualizar la existente
   - Si no hay nada → save_issue(...)
```

### Patrón 2 — Delegar a agente IA

```
1. save_issue(
     identifier="ENG-X",
     delegate="<agente>",
     labels=[...current, "actor/ai"],
     state="In Progress"
   )
2. save_comment(
     issue="ENG-X",
     body="Delegada a @<agente>. Plan inicial:\n\n1. ...\n2. ...\n\nReview esperado por <humano>."
   )
```

### Patrón 3 — Cerrar cycle y mover incompletos

Linear lo hace automáticamente: los issues no completados al cerrar el cycle se mueven al siguiente. **No hace falta tool específica**.

Pero antes de cerrar:

```
1. list_issues(team="ENG", cycle="current", stateType=["started", "unstarted"])
2. Revisar cada uno:
   - Si está casi listo → mover a "In Review"
   - Si está bloqueado → comentar el blocker
   - Si ya no es prioridad → mover a backlog (sale del cycle)
3. Generar reporte de retro (ver workflows/04-cycle-review.md)
```

### Patrón 4 — Crear project con milestones de un golpe

Esto requiere varias tool calls porque los milestones referencian al project que aún no existe:

```
1. save_project(team="ENG", name="X", initiatives=["..."], targetDate="...")
   → recibes el ID del project
2. save_milestone(project="<projectId>", name="M1: ...", targetDate="...", sortOrder=1)
3. save_milestone(project="<projectId>", name="M2: ...", targetDate="...", sortOrder=2)
4. ...
```

### Patrón 5 — Bulk update de labels

Como `save_issue` reemplaza labels:

```
1. get_issue(issue="ENG-X") → obtienes labels actuales
2. save_issue(
     identifier="ENG-X",
     labels=[...currentLabels, "actor/ai"]
   )
```

Para muchos issues, mejor usar GraphQL directo (ver `references/03-graphql-cheatsheet.md`).

## Coste y limitaciones

**Coste de contexto**: añadir el MCP de Linear en Claude Code consume ~17.3k tokens en tool definitions. Es significativo. Si el contexto está apretado, considera:

- Desactivar el MCP cuando no estás trabajando en Linear (`/mcp` para gestionar)
- Para batch jobs, usar GraphQL directo desde un script en lugar de MCP

**Tools no disponibles vía MCP** (requieren GraphQL directo):
- `agentSessionUpdate` — para emitir actividad como agente
- `customerCreate` / `customerNeedCreate` — Customer Requests
- `cycleCreate` / `cycleUpdate` — los cycles los gestiona Linear
- `initiativeUpdate` — solo lectura desde MCP, escritura vía GraphQL
- Operaciones admin (workflow states, OAuth apps, webhooks)

Para esas operaciones, ver `references/03-graphql-cheatsheet.md`.

**Identificadores legacy**: si una mutation MCP falla con "not found" pero la entidad existe, prueba con UUID en lugar del identifier humano. El MCP resuelve identifiers pero ocasionalmente falla con nombres ambiguos.

**Rate limits del MCP**: heredados del API. Ver `references/04-rate-limits.md`. En la práctica, no los vas a tocar en operación interactiva — solo en batch.

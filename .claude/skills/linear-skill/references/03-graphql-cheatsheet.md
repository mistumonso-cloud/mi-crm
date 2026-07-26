# Linear GraphQL — Cheatsheet

Referencia de queries y mutations GraphQL directas contra el API de Linear. Usa esto cuando el MCP no cubre tu caso (batch jobs, paginación grande, mutations admin), cuando necesites más control sobre los campos retornados, o cuando estés escribiendo scripts.

## Tabla de contenidos

1. [Endpoint y autenticación](#endpoint-y-autenticación)
2. [Estructura de queries](#estructura-de-queries)
3. [Queries esenciales](#queries-esenciales)
4. [Mutations esenciales](#mutations-esenciales)
5. [Filtros — la sintaxis](#filtros--la-sintaxis)
6. [Paginación con cursor](#paginación-con-cursor)
7. [Manejo de errores](#manejo-de-errores)
8. [SDK oficial @linear/sdk](#sdk-oficial-linearsdk)

## Endpoint y autenticación

**Endpoint**:
```
POST https://api.linear.app/graphql
Content-Type: application/json
```

**Autenticación**:

```http
# Personal API key (sin "Bearer", único caso especial de Linear)
Authorization: lin_api_xxxxxxxxxxxxxxxxxxx

# OAuth access token (con "Bearer")
Authorization: Bearer <access_token>
```

**Schema vivo y explorable**:
- GraphiQL: navegar al schema
- Apollo Studio: https://studio.apollographql.com/public/Linear-API/variant/current/schema/reference

**Para obtener Personal API key**:
Settings → API → Personal API keys → Create new

## Estructura de queries

Linear usa **connections** (estilo Relay) para listas. Toda colección sigue:

```graphql
{
  edges { node { ...fields } }
  nodes { ...fields }   # shortcut, mismo resultado que edges.node
  pageInfo { hasNextPage endCursor hasPreviousPage startCursor }
}
```

**Toda query con muchos resultados debe usar `first: N`** (default 50). Sin `first` explícito Linear pagina 50 y consumes complejidad innecesaria.

## Queries esenciales

### Viewer (yo)

```graphql
query Me {
  viewer {
    id
    name
    email
    displayName
  }
}
```

### Listar teams

```graphql
query Teams {
  teams(first: 10) {
    nodes {
      id
      name
      key
      cyclesEnabled
      cycleDuration
    }
  }
}
```

### Listar issues con filtros (el caballo de batalla)

```graphql
query MyActiveIssues($cycleId: String) {
  issues(
    first: 50,
    filter: {
      assignee: { isMe: { eq: true } }
      state: { type: { in: ["started", "unstarted"] } }
      cycle: { id: { eq: $cycleId } }
    }
    orderBy: priority
  ) {
    nodes {
      id
      identifier
      title
      priority
      estimate
      state { name type }
      project { name }
      cycle { number }
      assignee { displayName }
      labels { nodes { name } }
      url
    }
    pageInfo { hasNextPage endCursor }
  }
}
```

### Issue específica con todo

```graphql
query Issue($id: String!) {
  issue(id: $id) {
    id
    identifier
    title
    description
    priority
    estimate
    state { name type }
    assignee { displayName email }
    project { name }
    cycle { number }
    projectMilestone { name }
    labels { nodes { id name } }
    parent { identifier title }
    children { nodes { identifier title state { name } } }
    branchName
    url
    attachments { nodes { title url } }
    comments(first: 50) {
      nodes {
        id
        body
        user { displayName }
        createdAt
      }
    }
  }
}
```

`$id` puede ser UUID o identifier (`ENG-42`).

### Listar projects de una initiative

```graphql
query InitiativeProjects($initiativeId: String!) {
  initiative(id: $initiativeId) {
    id
    name
    projects(first: 50) {
      nodes {
        id
        name
        state
        progress
        health
        targetDate
        lead { displayName }
        issueCount: issues { totalCount }
      }
    }
  }
}
```

### Cycle activo y sus issues

```graphql
query CurrentCycle($teamId: String!) {
  team(id: $teamId) {
    activeCycle {
      id
      number
      startsAt
      endsAt
      progress
      issues(first: 100) {
        nodes {
          identifier
          title
          state { name type }
          assignee { displayName }
          estimate
        }
      }
    }
  }
}
```

### Búsqueda full-text

```graphql
query Search($query: String!) {
  issueSearch(query: $query, first: 20) {
    nodes {
      identifier
      title
      state { name type }
      url
    }
  }
}
```

## Mutations esenciales

### Crear issue

```graphql
mutation CreateIssue($input: IssueCreateInput!) {
  issueCreate(input: $input) {
    success
    issue {
      id
      identifier
      url
      branchName
    }
  }
}
```

Variables:
```json
{
  "input": {
    "teamId": "<uuid del team ENG>",
    "title": "Implementar OAuth en login (frontend)",
    "description": "## Contexto\n...\n\n## Criterios de aceptación\n- [ ] ...",
    "stateId": "<uuid del state Todo>",
    "projectId": "<uuid del project>",
    "projectMilestoneId": "<uuid del milestone>",
    "cycleId": "<uuid del cycle current>",
    "assigneeId": "<uuid del user>",
    "labelIds": ["<uuid label vertical/growth>", "<uuid label type/feature>"],
    "priority": 2,
    "estimate": 3,
    "parentId": null,
    "dueDate": "2026-05-15"
  }
}
```

### Actualizar issue

```graphql
mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
  issueUpdate(id: $id, input: $input) {
    success
    issue { identifier title state { name } }
  }
}
```

`$id` acepta UUID o identifier (ENG-42).

**⚠️ labelIds reemplaza el array completo**. Para añadir/quitar:

```javascript
// Pseudo-código TS
const issue = await client.issue("ENG-42");
const currentLabels = await issue.labels();
const currentIds = currentLabels.nodes.map(l => l.id);
const newIds = [...currentIds, newLabelId];
await client.issueUpdate("ENG-42", { labelIds: newIds });
```

### Crear comment

```graphql
mutation CreateComment($input: CommentCreateInput!) {
  commentCreate(input: $input) {
    success
    comment { id body url }
  }
}
```

```json
{
  "input": {
    "issueId": "<uuid de la issue>",
    "body": "Markdown content here",
    "parentId": null
  }
}
```

### Crear project con milestones

Linear requiere crear el project primero, luego los milestones referenciando el `projectId`:

```graphql
mutation CreateProject($input: ProjectCreateInput!) {
  projectCreate(input: $input) {
    success
    project { id name url }
  }
}
```

```json
{
  "input": {
    "teamIds": ["<team uuid>"],
    "name": "Lanzar Dashboard de Métricas v1",
    "description": "...",
    "leadId": "<user uuid>",
    "state": "planned",
    "startDate": "2026-05-11",
    "targetDate": "2026-09-30",
    "initiativeIds": ["<initiative uuid>"]
  }
}
```

Después, para cada milestone:

```graphql
mutation CreateMilestone($input: ProjectMilestoneCreateInput!) {
  projectMilestoneCreate(input: $input) {
    success
    projectMilestone { id name }
  }
}
```

```json
{
  "input": {
    "projectId": "<project uuid>",
    "name": "M1: Diseño aprobado",
    "description": "...",
    "targetDate": "2026-06-15",
    "sortOrder": 1024
  }
}
```

### Project Update (status update semanal)

```graphql
mutation CreateProjectUpdate($input: ProjectUpdateCreateInput!) {
  projectUpdateCreate(input: $input) {
    success
    projectUpdate { id }
  }
}
```

```json
{
  "input": {
    "projectId": "<project uuid>",
    "body": "## Esta semana\n- ...\n\n## Próxima semana\n- ...\n\n## Bloqueos\n- ninguno",
    "health": "onTrack"
  }
}
```

`health` ∈ `onTrack` | `atRisk` | `offTrack`.

### Initiative Update

Análogo:

```graphql
mutation CreateInitiativeUpdate($input: InitiativeUpdateCreateInput!) {
  initiativeUpdateCreate(input: $input) {
    success
    initiativeUpdate { id }
  }
}
```

### Crear sub-issue

Igual que `issueCreate`, pero pasando `parentId`:

```json
{
  "input": {
    "teamId": "...",
    "title": "Sub-tarea: refactor del cliente HTTP",
    "parentId": "<uuid del issue parent>",
    "labelIds": [...]
  }
}
```

### Issue relations (block / relate / duplicate)

```graphql
mutation CreateIssueRelation($input: IssueRelationCreateInput!) {
  issueRelationCreate(input: $input) {
    success
    issueRelation { id }
  }
}
```

```json
{
  "input": {
    "issueId": "<uuid issue A>",
    "relatedIssueId": "<uuid issue B>",
    "type": "blocks"
  }
}
```

`type` ∈ `blocks` | `related` | `duplicate`.

### Customer Need (vincular feedback a issue)

```graphql
mutation CreateCustomerNeed($input: CustomerNeedCreateInput!) {
  customerNeedCreate(input: $input) {
    success
    customerNeed { id }
  }
}
```

```json
{
  "input": {
    "customerId": "<uuid del customer interno (ej: equipo Data Platform)>",
    "body": "Descripción del feedback recibido",
    "issueId": "<uuid del issue de desarrollo>",
    "priority": 2
  }
}
```

### Agent activity (solo si construyes un agente propio)

Ver `references/06-agents-sdk.md` para detalle completo.

```graphql
mutation CreateAgentActivity($input: AgentActivityCreateInput!) {
  agentActivityCreate(input: $input) {
    success
    agentActivity { id }
  }
}
```

## Filtros — la sintaxis

Los filtros de Linear son objetos anidados con operadores. La estructura general:

```graphql
filter: {
  <field>: { <operator>: <value> }
}
```

**Operadores comunes**:
- `eq`, `neq` — equals / not equals
- `in`, `nin` — array de valores
- `contains`, `notContains` — substring (en strings)
- `containsIgnoreCase`, `notContainsIgnoreCase`
- `startsWith`, `endsWith`
- `gt`, `gte`, `lt`, `lte` — comparaciones (números, fechas)
- `null` — boolean (true = es null)

**Combinadores**: `and`, `or` (arrays de sub-filtros).

**Ejemplos**:

```graphql
# Issues con label vertical/data O vertical/growth
filter: {
  or: [
    { labels: { name: { eq: "vertical/data" } } }
    { labels: { name: { eq: "vertical/growth" } } }
  ]
}

# Issues started Y priority high+
filter: {
  and: [
    { state: { type: { eq: "started" } } }
    { priority: { lte: 2 } }
  ]
}

# Issues sin assignee
filter: {
  assignee: { null: true }
}

# Issues asignadas a mí o delegadas a un agente
filter: {
  or: [
    { assignee: { isMe: { eq: true } } }
    { delegate: { id: { eq: "<agente uuid>" } } }
  ]
}

# Issues creadas en los últimos 7 días con label actor/ai
filter: {
  and: [
    { createdAt: { gte: "2026-04-27T00:00:00Z" } }
    { labels: { name: { eq: "actor/ai" } } }
  ]
}
```

**Helper especial**: `assignee: { isMe: { eq: true } }` para filtrar por el viewer actual sin necesidad de su UUID.

## Paginación con cursor

Para iterar sobre muchas issues:

```graphql
query Page($after: String) {
  issues(first: 50, after: $after, filter: { ... }) {
    nodes { ... }
    pageInfo { hasNextPage endCursor }
  }
}
```

Patrón en código:

```typescript
let after: string | null = null;
const allIssues = [];

while (true) {
  const result = await client.query({ first: 50, after, filter: {...} });
  allIssues.push(...result.nodes);
  if (!result.pageInfo.hasNextPage) break;
  after = result.pageInfo.endCursor;
}
```

## Manejo de errores

**Errores de validación** vienen en el array `errors` de la respuesta:

```json
{
  "errors": [
    {
      "message": "Argument 'teamId' is required but was not provided.",
      "extensions": {
        "type": "invalid input",
        "userPresentableMessage": "Team is required to create an issue."
      }
    }
  ]
}
```

**Rate limit** devuelve HTTP 400 con:

```json
{
  "errors": [{
    "extensions": { "code": "RATELIMITED" }
  }]
}
```

Manejo recomendado:

```typescript
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      if (e.errors?.[0]?.extensions?.code === "RATELIMITED" && i < maxRetries - 1) {
        const delay = Math.pow(2, i) * 1000; // exponential backoff
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw e;
    }
  }
  throw new Error("max retries reached");
}
```

## SDK oficial @linear/sdk

Para JavaScript/TypeScript hay un SDK que abstrae GraphQL.

**Instalación**:
```bash
npm install @linear/sdk
```

**Uso básico**:

```typescript
import { LinearClient } from "@linear/sdk";

const client = new LinearClient({ apiKey: process.env.LINEAR_API_KEY! });
// o: new LinearClient({ accessToken: oauthToken });

const me = await client.viewer;
console.log(me.email);

// Listar issues
const issues = await client.issues({
  first: 50,
  filter: {
    assignee: { isMe: { eq: true } },
    state: { type: { eq: "started" } }
  }
});

for (const issue of issues.nodes) {
  console.log(issue.identifier, issue.title);
}

// Crear issue
const result = await client.createIssue({
  teamId: "<team uuid>",
  title: "Test",
  description: "...",
  priority: 2
});

if (result.success) {
  const created = await result.issue;
  console.log(created.identifier);
}

// Actualizar
await client.updateIssue("ENG-42", {
  stateId: "<uuid>",
  assigneeId: "<uuid>"
});
```

**Iterator pattern** del SDK:

```typescript
let after: string | undefined;
do {
  const page = await client.issues({ first: 50, after });
  for (const issue of page.nodes) {
    // process
  }
  after = page.pageInfo.endCursor;
} while (page.pageInfo.hasNextPage);
```

Detalles completos en https://linear.app/developers/sdk

Para un cliente listo para usar, ver `scripts/linear-client.ts` en este skill.

# Linear — Rate limits y complejidad

Lee este documento cuando estés haciendo operaciones batch (más de ~50 issues), cuando una query GraphQL falle con `RATELIMITED`, o cuando el MCP esté lento sospechosamente.

## Los tres tipos de límites

Linear aplica tres dimensiones de rate limiting:

| Tipo de auth | Requests/hora | Complexity points/hora |
|---|---|---|
| Personal API key | 1,500 | 3,000,000 |
| OAuth (per workspace user) | dinámico (escala con paid users) | dinámico |
| No autenticadas | bajo (por IP) | — |

Para ACME (2-3 paid users + el MCP), los límites efectivos OAuth son cómodos para uso interactivo. Solo los rozarás en batch grande o si tienes loops accidentales.

## Cómo funciona la complejidad

Cada query/mutation tiene un coste de **complexity points** calculado **estáticamente** sobre la query, no dinámicamente sobre la respuesta:

- **Un objeto simple** → 1 punto
- **Una connection con N nodos solicitados** → 2 + N puntos
- **Campos anidados** → multiplicativo

**Ejemplos del coste**:

```graphql
# Coste ~1
{ viewer { id name } }

# Coste ~52  (2 + 50 nodos)
{ issues(first: 50) { nodes { id title } } }

# Coste ~152  (2 + 50, y dentro de cada uno comments con first:5 = 2+5)
{ issues(first: 50) { nodes { id comments(first: 5) { nodes { id } } } } }

# Coste ~5,002  ⚠️ explosión
{ issues(first: 100) { nodes { comments(first: 50) { nodes { user { issues(first: 50) { nodes { id } } } } } } } }
```

**Regla #1**: **siempre define `first` explícitamente**. Sin `first`, Linear pagina 50 por defecto, lo cual cuenta para complejidad aunque solo uses 5 resultados.

**Regla #2**: **evita anidamientos profundos**. Si necesitas comments de muchas issues, mejor hacer 2 queries separadas que una anidada.

**Regla #3**: **`includeArchived: false`** por defecto. Pedir archivados infla resultados sin valor.

## Headers de respuesta

Cada respuesta del API incluye headers de telemetría:

```
X-RateLimit-Requests-Limit:        <límite total>
X-RateLimit-Requests-Remaining:    <quedan>
X-RateLimit-Requests-Reset:        <epoch en que se resetea>
X-Complexity:                      <coste de esta request>
X-RateLimit-Complexity-Limit:      <límite total complejidad>
X-RateLimit-Complexity-Remaining:  <quedan>
X-RateLimit-Complexity-Reset:      <epoch>
```

Patrón recomendado: leer `X-Complexity-Remaining` y aplicar throttling proactivo si baja del 20% del límite.

## Errores de rate limit

**HTTP 400** con cuerpo:

```json
{
  "errors": [{
    "message": "Rate limit exceeded for X",
    "extensions": {
      "code": "RATELIMITED",
      "type": "rate-limit",
      "retryAfter": 60
    }
  }]
}
```

`retryAfter` viene en segundos.

## Estrategia de backoff

Para batch jobs:

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  options = { maxRetries: 5, baseDelayMs: 1000 }
): Promise<T> {
  for (let attempt = 0; attempt < options.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const isRateLimit = err.errors?.[0]?.extensions?.code === "RATELIMITED";
      if (!isRateLimit || attempt === options.maxRetries - 1) throw err;

      const retryAfter = err.errors[0].extensions.retryAfter;
      const delay = retryAfter
        ? retryAfter * 1000
        : options.baseDelayMs * Math.pow(2, attempt);

      console.warn(`Rate limited. Retrying in ${delay}ms (attempt ${attempt + 1})`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error("Max retries reached");
}
```

## Caching local recomendado

Estos datos cambian raramente. Cachéalos para evitar fetches innecesarios:

| Dato | TTL recomendado |
|---|---|
| Lista de teams | 1 hora |
| Lista de labels | 5 min |
| Workflow states del team | 5 min |
| Lista de users | 5 min |
| Initiative IDs | 1 hora |
| Project IDs (active) | 1 min |

Cache en memoria es suficiente para Claude Code (proceso corto). Para servicios persistentes, usar Redis con los TTLs anteriores.

## Buenas prácticas concretas

### Cuando hagas listing

```graphql
# ✗ Mal — pide demasiado por nodo
{ issues(first: 100) { nodes { ...everything... } } }

# ✓ Bien — solo lo necesario, y after-paginas si hace falta
{ issues(first: 50) { nodes { id identifier title state { name } } pageInfo { hasNextPage endCursor } } }
```

### Cuando hagas filtros

```graphql
# ✗ Mal — trae todo y filtra en cliente
{ issues(first: 1000) { nodes { ... } } }

# ✓ Bien — filtra server-side
{ issues(first: 50, filter: { ... }) { nodes { ... } } }
```

### Cuando actualices muchos issues

Linear NO tiene mutation batch. Si tienes que actualizar 100 issues:

```typescript
// Throttle: 5 mutations/segundo es seguro
const CONCURRENCY = 5;
const issues = [...];

for (let i = 0; i < issues.length; i += CONCURRENCY) {
  const batch = issues.slice(i, i + CONCURRENCY);
  await Promise.all(batch.map(issue =>
    withRetry(() => client.updateIssue(issue.id, updates))
  ));
  await new Promise(r => setTimeout(r, 200));
}
```

### Cuando hagas polling

**No lo hagas**. Usa webhooks (`references/05-webhooks.md`).

Si DE VERDAD necesitas polling (caso raro):
- Mínimo 60s entre polls
- `updatedAt` filter para solo traer lo cambiado

### Cuando uses el MCP

El MCP también está sujeto a rate limits del API. Si el MCP devuelve errores raros tras muchas llamadas seguidas:

1. Esperar 1 minuto
2. Reintentar
3. Si persiste, revisar `X-RateLimit-*` (no expuesto al MCP cliente, pero sí al usuario logueado)

## Estimando complejidad de una query antes de ejecutarla

```typescript
function estimateComplexity(query: string): number {
  // Heurística: encontrar todas las connections con `first:`
  const matches = [...query.matchAll(/first:\s*(\d+)/g)];
  return matches.reduce((sum, m) => sum + 2 + parseInt(m[1]), 0);
}
```

Para queries complejas, el verdadero coste lo conoces solo después de la primera ejecución (en `X-Complexity`).

## Cuotas en perspectiva

3,000,000 puntos/hora con cycles típicos:

- 100 listings de 50 issues = ~5,200 puntos → 0.17% del límite
- 1,000 mutations de issueUpdate = ~5,000 puntos → 0.17% del límite
- 1 sync completo de 10,000 issues con paginación = ~10,400 puntos → 0.34% del límite

En la práctica, **un script razonable nunca toca el límite**. Solo se golpea con loops accidentales o subqueries explosivas.

## Si estás cerca del límite

1. Acumular operaciones en una cola (BullMQ, simple in-memory)
2. Procesar a velocidad constante (ej: 10 ops/segundo)
3. Si tienes control sobre el flujo, prefiere un job nocturno para batch grandes

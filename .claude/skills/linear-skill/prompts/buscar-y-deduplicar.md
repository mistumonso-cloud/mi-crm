# Prompt — Buscar y deduplicar

Plantilla para encontrar issues en el workspace antes de crear, modificar o reportar. La búsqueda eficiente es el cimiento del trabajo limpio en Linear.

## Cuándo usar

- Antes de crear cualquier issue (dedupe)
- Cuando el humano pregunta "¿hay algo sobre X?"
- Cuando reportes el estado de un área
- Para auditoría de un tema (ej: "todos los bugs de auth")

## Estrategias de búsqueda

### A — Búsqueda por texto (semántico/full-text)

```
list_issues(team="ENG", query="<keywords>", first=20)
```

Linear hace búsqueda en title + description + comments. **NO usar comillas** ni operadores especiales (los traduce mal).

```
✓ "oauth login frontend"
✓ "dashboard pdf export"
✗ "OAuth AND login"
✗ "\"exact phrase\""
```

### B — Búsqueda por filtro estructurado

Para queries específicas:

```
list_issues(
  team="ENG",
  label="vertical/data",
  stateType="started",
  priority=2,
  first=50
)
```

### C — Búsqueda por relación

Para encontrar lo conectado a algo:

```
# Sub-issues de una issue
list_issues(team="ENG", parent="ENG-100")

# Issues de un project
list_issues(team="ENG", project="Auth v2")

# Issues de un milestone
list_issues(team="ENG", projectMilestone="<uuid>")

# Issues de un cycle
list_issues(team="ENG", cycle="current")
list_issues(team="ENG", cycle=12)  # cycle número 12

# Issues de una initiative (a través de projects)
list_issues(team="ENG", initiative="Growth 2026")
```

## Patrones de deduplicación

### Patrón 1 — Antes de crear una issue nueva

Workflow recomendado:

```
1. Extraer 3-5 keywords del title propuesto
2. Buscar:
   list_issues(team="ENG", query="<keywords>", first=10)
3. Filtrar mentalmente:
   - Same intent + state abierto → potencial duplicado
   - Same intent + state cerrado → potencial regresión
   - Related pero distinto → relacionar al crear
4. Decidir:
   a) Si claro duplicado → comentar en existente, no crear
   b) Si potencial duplicado → preguntar al humano
   c) Si solo relacionado → crear nueva con relation
   d) Si nada parecido → crear nueva
```

Mostrar al humano:

```
Encontré estas issues similares al pedido:

🟢 ENG-87 "Implementar export PDF dashboard" — Backlog, prioridad medium, 3 puntos
🟡 ENG-65 "Export del dashboard en Excel" — Done hace 2 meses
⚫ ENG-23 "Dashboard exports varios" — Canceled hace 6 meses

Opciones:
A) Comentar y subir prioridad de ENG-87 (parece exactamente lo pedido)
B) Crear nueva, relacionada con ENG-87 (si es feature distinta)
C) No es nada de lo anterior, crear nueva sin relación

¿Cuál?
```

### Patrón 2 — Auditoría temática

Cuando el humano pregunta "¿qué tenemos pendiente sobre auth?":

```
1. Búsqueda amplia:
   list_issues(team="ENG", query="auth login oauth password", first=50)
   
2. Filtrar por state si tiene sentido:
   stateType=["unstarted", "backlog", "started"]
   
3. Agrupar por:
   - State (Backlog vs Todo vs In Progress)
   - Initiative/Project
   - Owner
   
4. Reportar resumido, no listado entero.
```

Output esperado:

```
Issues abiertas relacionadas con auth (12 total):

🚧 In Progress (2):
- ENG-101 "OAuth en login" — @persona, 3 ptos, cycle actual

📋 Todo (3):
- ENG-95, ENG-103, ENG-110 — total 8 ptos

🗂️ Backlog (7):
- 4 features (varias prioridades)
- 3 bugs (priority low/medium)

¿Quieres que profundice en alguno?
```

### Patrón 3 — Búsqueda histórica (regresiones)

Para detectar regresiones, buscar también archivadas:

```
list_issues(
  team="ENG",
  query="<keywords>",
  includeArchived=true,
  stateType="completed",
  first=10
)
```

Si hay issue cerrada que matchea, evaluar si es regresión:

```
🔍 ENG-65 "Login falla con caracteres especiales" — Done hace 4 meses

Si el bug actual es similar, es regresión. Crear nuevo bug, relacionar 
como `relatedTo` el viejo, mencionar en description que es regresión 
y el commit que lo corrigió antes para investigar qué cambió.
```

## Búsqueda en customer needs

A veces lo que pides existe en el contexto de Customer Needs:

```
# Vía GraphQL (no expuesto en MCP):

query CustomerNeedsByText($q: String!) {
  customerNeeds(filter: { body: { containsIgnoreCase: { eq: $q } } }, first: 20) {
    nodes {
      id
      body
      customer { name }
      issue { identifier title state { name } }
      project { name }
    }
  }
}
```

Esto encuentra **demanda de usuarios** alrededor de un tema, aunque no haya issue de desarrollo aún.

## Errores comunes en búsqueda

❌ **Buscar por título muy corto**: "auth" devuelve cientos de matches. Usa 3-5 keywords.

❌ **Asumir que `list_issues` sin filtro es la lista completa**: paginación es 50 por defecto. Usa filters.

❌ **Olvidar `includeArchived=true` cuando buscas histórico**: por defecto solo devuelve no archivadas.

❌ **Buscar solo en title**: el body de la issue tiene mucho más contexto. La query busca en ambos.

❌ **No agrupar/resumir resultados**: 30 issues sin estructura es ruido. Agrupa por state/owner/initiative.

❌ **Tomar el primer match como "el correcto"**: revisa los siguientes 3-5 también; las palabras pueden engañar.

## Tip — guardar búsquedas frecuentes

Para queries recurrentes, crear **Custom Views** en Linear UI:

```
- "Mis issues del cycle actual" — filtros: assignee=me, cycle=current
- "Bugs urgent abiertos" — type/bug + priority<=2 + state.type IN [unstarted, started]
- "Trabajo IA pendiente review" — label actor/ai + state=In Review
- "Backlog priorizado vertical/data" — vertical/data + state=Backlog + priority<=3
```

Las custom views son colaborativas (las ven todos los del team) o personales.

# Prompt — Crear issue (con dedupe)

Plantilla para crear una nueva issue en Linear, asegurando dedupe previo y triage completo. Úsala cuando el humano pida "crea una issue para X" o pegue un fragmento que se debe convertir en issue.

## Flow recomendado

### Paso 1 — Buscar duplicados ANTES de crear

```
list_issues(
  team="ENG",
  query="<keywords del titulo propuesto>",
  first=10,
  includeArchived=false
)
```

Mostrar al humano los matches:

```
Antes de crear, encontré estas issues similares:
- ENG-87 "Implementar export PDF" (Backlog, prioridad medium)
- ENG-65 "Export del dashboard" (Done, hace 2 meses)

¿Crear nueva o relacionar con alguna existente?
```

Esperar respuesta antes de proceder.

### Paso 2 — Recoger inputs mínimos

Si faltan, pedir explícitamente. Inputs requeridos:

| Campo | Default si no se da |
|---|---|
| `title` | OBLIGATORIO — pedir |
| `description` | Estructurar con plantilla (abajo) |
| `vertical` | OBLIGATORIO — pedir si no es inferible |
| `type` | Inferir o pedir |
| `priority` | Default: 3 (Normal) — pedir confirmación |
| `estimate` | Pedir o sugerir |
| `assignee` | Default: nadie en backlog, pedir si va al cycle |
| `cycle` | Default: null (backlog), pedir si es esta semana |
| `project` | Si pertenece a uno, pedir nombre |

### Paso 3 — Estructurar el title

Patrón **imperativo + qué + dónde (si aplica)**:

```
✓ "Implementar OAuth en login (frontend)"
✓ "Corregir cálculo de descuento en checkout"
✓ "Migrar API de payments a Stripe v2"

✗ "Bug en checkout"
✗ "OAuth"  
✗ "necesidad: hacer un dashboard"
```

### Paso 4 — Estructurar la description

Plantilla universal (adaptar según type):

```markdown
## Contexto
[Por qué esta issue importa. 1-2 párrafos de contexto.
Si es feature: a quién sirve. Si es bug: qué está roto.]

## Comportamiento esperado / criterios de aceptación
- [ ] Criterio 1 (verificable)
- [ ] Criterio 2 (verificable)
- [ ] ...

## Información adicional
[Links a Figma, docs, threads de Slack, etc.]

## Out of scope
[Lo que explícitamente NO entra en esta issue]
```

Para bugs, ver plantilla específica en `examples/issue-templates/bug.md`.

Para features, ver `examples/issue-templates/feature.md`.

### Paso 5 — Decidir vertical label

Reglas:

| Plataforma del trabajo | Label |
|---|---|
| example.com (web app) | `vertical/web` |
| example.com (plataforma) | `vertical/platform` |
| example.com (app móvil) | `vertical/mobile` |
| Plataforma de streaming | `vertical/growth` |
| Tools internos (dashboards, autom.) | `vertical/data` |

Si toca varios verticals (ej: refactor compartido), poner solo el principal y mencionar otros en description.

### Paso 6 — Decidir type label

| Si es... | Label |
|---|---|
| Funcionalidad nueva | `type/feature` |
| Bug en algo existente | `type/bug` |
| Mantenimiento, deps, CI | `type/chore` |
| Mejora interna sin cambio funcional | `type/refactor` |
| Vulnerabilidad, hardening | `type/security` |
| Documentación | `type/docs` |

### Paso 7 — Decidir priority

```
Urgent (1) → bloqueando producción/revenue HOY
High (2) → del cycle actual, debe entregarse esta semana
Normal (3) → priorizado, próximo cycle
Low (4) → nice-to-have, sin compromiso
```

Si se decide en planning del cycle, usar al menos `Normal`.

### Paso 8 — Estimar

Fibonacci:

```
1 = trabajo trivial, < 2h          (typo, log fix, dep update)
2 = pequeño, ~medio día            (función nueva acotada, refactor pequeño)
3 = mediano, 1 día                 (feature de tamaño chico, bug normal)
5 = grande, 2-3 días               (feature significativa, refactor moderado)
8 = épico, debería ser sub-issues  (feature grande, sólo si excepcional)
```

Si > 5: NO crear así. Pedir al humano que dividamos en sub-issues primero.

### Paso 9 — Considerar si va a IA

Antes de cerrar el formulario, pregúntate:

```
¿Esta issue cumple criterios de delegable a IA?
(ver workflows/02-triage-y-delegar.md sección 1.4)
  Sí → añadir label actor/ai
  No → seguir adelante (no añadir actor/human, es default)
```

### Paso 10 — Crear

```
save_issue(
  team="ENG",
  title="<titulo formateado>",
  description="<description estructurada>",
  labels=["vertical/<X>", "type/<X>", "actor/ai" if applicable],
  priority=<N>,
  estimate=<N>,
  project="<nombre o null>",
  projectMilestone="<nombre o null>",
  cycle="current" if esta semana else null,
  state="Backlog" if backlog else "Todo",
  assignee="<user o null>"
)
```

### Paso 11 — Confirmar al humano

```
✅ Issue creada: ENG-X "<titulo>"
   URL: https://linear.app/...
   
   Labels: vertical/growth, type/feature, actor/ai
   Priority: High
   Estimate: 3
   Project: Auth v2
   Cycle: current
   Assignee: @persona

¿Algo que ajustar?
```

## Variantes

### Variante A — Crear varias issues de un golpe

Si el humano pega una lista:

```
1. Para cada item, ejecutar dedupe + triage independiente
2. Pero crearlas TODAS antes de confirmar
3. Resumen al final con todos los IDs creados
4. Si alguna requiere clarificación → no crearla, listar las que sí se pudo
```

### Variante B — Crear sub-issue

Mismo flow, pero pasando `parent="ENG-X"`:

```
save_issue(
  team="ENG",
  parent="ENG-100",  // identifier del parent
  title="Sub-tarea: ...",
  ...
)
```

La sub-issue hereda del parent: project, milestone, cycle (si parent las tiene). Pero puedes overrideearlas.

### Variante C — Crear issue con template de Linear

Si el team tiene templates configurados:

```
save_issue(
  team="ENG",
  template="Bug Report",  // nombre del template
  title="<titulo>",
  ...  // los demás campos overridean los del template
)
```

## Anti-patrones

❌ **No buscar duplicados**: causa fragmentación del backlog.

❌ **Description vacía o "ver Slack"**: contexto perdido a futuro.

❌ **Sin vertical label**: imposible filtrar/agrupar por plataforma.

❌ **Estimate aspiracional vs realista**: usa 5 si crees que es 3 — siempre acaba siendo más.

❌ **Asignar issue al cycle actual sin capacidad disponible**: revisa el cycle antes.

❌ **Title que es síntoma en vez de acción**: "Login no funciona" → "Corregir validación de password en login"

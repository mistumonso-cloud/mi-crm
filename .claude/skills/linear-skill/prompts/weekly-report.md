# Prompt — Reporte semanal

Plantilla para generar el reporte semanal del equipo ACME. Útil viernes para compartir con stakeholders (CEO de ACME, leads de los verticales, etc.) lo entregado en la semana.

## Output esperado

Un Markdown que se puede compartir por:
- Slack (canal del equipo o canal directo con CEO)
- Email
- Document en Linear (asociado al workspace)

Estructura:

```markdown
# ACME — Cycle W<N> (semana del <fecha-fecha>)

## TL;DR
[1-2 frases con lo más relevante. Lo que el lector se llevaría
si solo leyera esto.]

## Por initiative

### Mobile App 2026
- Entregado: ...
- En progreso: ...
- Riesgos: ...

### Data Platform 2026
[idem]

### Growth 2026
[idem]

### Web App 2026
[idem]

### Platform 2026
[idem]

## Métricas
- Velocity: X/Y puntos completados (Z%)
- Issues cerradas: N
- Bugs detectados: M (de los cuales X críticos)
- PRs mergeados: P

## Highlights
[2-4 cosas notables, con contexto humano. No solo issues.]

## Próxima semana
[Top 3-5 prioridades del próximo cycle]

## Solicitudes / bloqueos
[Cosas que el equipo necesita de fuera]
```

## Cómo generarlo

### Paso 1 — Recoger los datos

```
1. Identificar el cycle que se cierra:
   list_cycles(team="ENG", type="current")  // si lo generamos viernes
   o
   list_cycles(team="ENG", type="previous")  // si lunes mirando el pasado

2. Issues completadas en el cycle:
   list_issues(
     team="ENG",
     cycle="<cycleId>",
     stateType="completed",
     first=100
   )

3. Issues en progreso (rebotando o aún activas):
   list_issues(
     team="ENG",
     cycle="<cycleId>",
     stateType=["started", "unstarted"],
     first=100
   )

4. Bugs nuevos creados esta semana:
   list_issues(
     team="ENG",
     label="type/bug",
     createdAfter="<lunes-de-esta-semana ISO>",
     first=50
   )

5. Customer Needs procesados (vía GraphQL):
   query CustomerNeedsThisWeek { ... }
```

### Paso 2 — Agrupar por initiative

Para cada issue completada, extraer su `project.initiative.name`. Agrupar:

```
Data Platform 2026:
  - ENG-101 (Done)
  - ENG-103 (Done)
  - ENG-110 (In Review)

Growth 2026:
  - ENG-87 (Done)
  - ENG-95 (In Progress)
```

### Paso 3 — Generar prosa por sección

Para cada initiative con actividad:

```markdown
### Data Platform 2026

**Entregado**:
- Dashboard de métricas v1: M2 completado (ENG-101, ENG-103). 
  [Highlight humano si aplica: "Equipo de Data Platform ya está usándolo en daily."]

**En progreso**:
- ENG-110 "Export PDF" en review, merge esperado lunes.

**Riesgos**:
- M3 (frontend) puede retrasarse si no llega diseño esta semana.
```

NO listar issues sin contexto. **Sintetizar**: "varios fixes de auth" es mejor que ENG-87, ENG-91, ENG-95 listados.

### Paso 4 — Calcular métricas

```
velocity_planned = sum(estimate of all issues in cycle on Monday)  
                  // dato del Project Update del lunes

velocity_completed = sum(estimate of all issues in cycle now in state Done)

bugs_new = count(issues created this week with label type/bug)
bugs_critical = count of those with priority=1

prs_merged = derived from attachments (GitHub PR with state=merged)
```

Algunos datos requieren web_fetch o API de GitHub si no están en Linear.

### Paso 5 — Highlights

Esta es la parte humana. Pregúntate:

```
- ¿Hubo alguna entrega especialmente impactante?
- ¿Algún bug crítico resuelto rápido (S1)?
- ¿Algún logro del equipo IA destacable?
- ¿Alguna métrica de producto mejorada (si tenemos visibilidad)?
- ¿Algún reconocimiento que merece visibilidad?
```

Escribir 2-4 highlights concretos, no genéricos:

```
✓ "Lanzamos Dashboard v1 a Media; primer feedback positivo, 
    usándose en daily de planning"
✓ "Resuelto S1 de checkout en 23 min (ENG-99). Post-mortem en la issue."
✓ "@persona shipeó 4 PRs incluyendo refactor mayor del payment client."

✗ "Buen trabajo del equipo"  ← genérico, sin sustancia
✗ "Cerramos 11 issues"        ← ya está en métricas
```

### Paso 6 — Próxima semana

Lo que el cycle planificado del lunes contendrá. Para esto:

```
list_issues(team="ENG", cycle="next", first=50)
```

(Si el next cycle aún no se planifica, mejor escribir "TBD lunes".)

### Paso 7 — Solicitudes / bloqueos

Si el equipo necesita algo de fuera:

```
- "Esperando diseño de M3 (Data Platform). @persona-design"
- "Necesitamos credenciales de API X. CC @stakeholder"
- "Decisión pendiente: ¿migrar BD ahora o post-lanzamiento?"
```

Incluir si y solo si hay algo concreto. NO inventar bloqueos por relleno.

### Paso 8 — Output final

Pegar todo el Markdown estructurado.

Opcionalmente, crear como Document en Linear:

```
mutation documentCreate({
  title: "Weekly W<N> — ACME",
  content: "<markdown>",
  // sin project ni initiative parent → es workspace document
})
```

O simplemente devolver el Markdown al humano para que lo copie/pegue.

## Variantes

### Variante A — Reporte para CEO (más alto nivel)

Menos detalle técnico, más impacto:

```
- Foco en initiatives, no en issues individuales
- Métricas de producto si están disponibles (no solo de Linear)
- Quitar la sección "Bugs nuevos detectados" (irrelevante a nivel ejecutivo)
- Highlights centrados en valor entregado, no en cantidad
```

### Variante B — Reporte interno solo del equipo

Más detalle, más honesto:

```
- Incluir issues que NO se completaron y por qué
- Lecciones aprendidas (de retro)
- Trabajo IA: % aceptación, casos de fricción
- Comentarios crudos sobre fricción interna (process, herramientas)
```

### Variante C — Reporte mensual

Agregando 4 cycles:

```
- Velocity trend (4 puntos)
- Initiatives status (cambios significativos)
- Big releases del mes
- Top issues por impacto, no por count
```

## Anti-patrones

❌ **Solo listar identifiers de issues**: ruido, sin valor para el lector.

❌ **Reporte que repite Linear UI**: si el lector ya tiene Linear, ¿por qué leer un dump?

❌ **Métricas sin contexto**: "Velocity 14 puntos" no dice nada sin comparativa.

❌ **Highlights genéricos**: "buen trabajo del equipo" no aporta. Sé específico.

❌ **Reportar todas las initiatives aunque no haya actividad**: si esta semana no hubo movimiento en una, omitirla con "(sin actividad esta semana)" o no listarla.

❌ **Omitir riesgos por miedo a transparentar**: el reporte sin riesgos huele a barniz. Si todo está perfect siempre, nadie te cree.

## Tip — Automatización

Una vez tengas un patrón estable, este reporte puede:

1. Generarse automáticamente en un cron (viernes 5pm)
2. Postearse a Slack #equipo-acme
3. Crearse como Document en Linear automáticamente

Implementación de referencia: usar `scripts/linear-client.ts` con un nuevo script `weekly-report.ts` que ejecute todos los queries y formatee el markdown.

# Workflow — Cycle Planning (lunes)

Ritual de los lunes. Decidir qué se compromete el equipo a entregar esta semana. Para 2-3 personas con cycles de 1 semana, debe ser **rápido (15-30 min máximo)**.

## Cuándo ejecutar

- Lunes por la mañana, primera tarea de la semana
- O si se delega a Claude: el humano dice "planifiquemos el cycle"

## Pre-requisitos

- [ ] El cycle de la semana pasada está cerrado (issues incompletas rebotaron al actual automáticamente)
- [ ] Triage del backlog está al día (no hay issues huérfanas en estado Triage)

## Paso 1 — Tomar foto del estado actual

```
list_cycles(team="ENG", type="current")
→ obtener cycleId del cycle activo

list_issues(team="ENG", cycle=<currentCycleId>, first=100)
→ todas las issues del cycle: las que rebotaron + las que se añadieron auto
```

Obtener:
- `Total estimate` ya en el cycle (las que rebotaron)
- `Total estimate` por persona

## Paso 2 — Calcular capacidad

**Capacidad por persona y por cycle**:

```
1 persona, 1 semana, 5 días, ~6h productivas/día = 30h
1 estimate point ≈ 4 horas
=> Capacidad teórica: ~7 estimate points por persona por semana
```

**Capacidad realista**: 70-80% del teórico para dejar buffer:

```
~5-6 puntos por persona para 1 semana
```

Para ACME (3 personas):

```
Capacidad total realista: 15-18 puntos por cycle
```

Capacidad de los agentes IA: variable. Empezar a contar cuando tengas 1 mes de datos.

## Paso 3 — Listar candidatos para el cycle

Issues a considerar para meter en el cycle:

```
list_issues(
  team="ENG",
  stateType=["unstarted", "backlog"],
  priority=[1, 2],  // Urgent y High
  cycle=null,  // sin cycle aún
  first=50
)
```

Y issues que rebotaron (ya en el cycle):

```
list_issues(team="ENG", cycle="current", first=100)
```

## Paso 4 — Preguntar al humano por las prioridades de la semana

Pregúntale **explícitamente**:

```
Capacidad realista del equipo esta semana: ~15-18 puntos.
Issues que rebotaron del cycle anterior: X (Y puntos).
Quedan disponibles: Z puntos.

¿Qué QUIERES entregar esta semana? Lista 3-5 prioridades.
```

Espera lista del humano. Para cada prioridad mencionada:

1. Buscar la issue (si existe)
2. Si no existe, crear (con prompts/crear-issue.md)
3. Asignarla al cycle actual

## Paso 5 — Mover issues al cycle

Para cada issue priorizada:

```
save_issue(
  identifier="ENG-X",
  cycle="current",
  state="Todo"  // si no estaba ya empezada
)
```

## Paso 6 — Validar suma de estimates

Después de meter las prioridades:

```
total_in_cycle = sum(issue.estimate for issue in cycle_issues)
```

**Reglas**:

- Si total > capacidad → quitar las menos prioritarias del cycle (volver a backlog)
- Si total < capacidad * 0.7 → AVISAR al humano, hay holgura
- Si total ~ capacidad → 

Mensaje de validación:

```
Cycle planificado:
- 12 issues, total estimate 16 puntos
- Capacidad estimada: 15-18 puntos (3 personas × 5-6)
- Mix: 60% feature, 25% bug, 15% chore
- Verticals: 4 growth, 3 data, 5 mobile

¿Confirmas o ajustas?
```

## Paso 7 — Asignar issues a personas

Si el humano ya repartió implícitamente, OK. Si no:

```
Issues sin assignee:
- ENG-101: ...
- ENG-105: ...
- ENG-112: ...

¿Cómo las repartimos?
```

Patrón típico para 3 personas que hacen de todo:
- Cada persona ~5-6 puntos
- Agrupar por vertical/area cuando sea posible (menos context switching)
- Issues delegables a IA: marcar `actor/ai` y dejar al humano lead que las supervise

## Paso 8 — Confirmar y comunicar

Resumen para el humano:

```
✅ Cycle planificado:
URL: https://linear.app/acme/cycle/<N>

Por persona:
- @persona1: 5 issues (6 puntos)
- @persona2: 4 issues (5 puntos)  
- @persona3: 3 issues (5 puntos) + 2 issues actor/ai (3 puntos)

Por vertical:
- vertical/growth: 4 issues
- vertical/data: 3 issues
- vertical/mobile: 5 issues

Mix:
- type/feature: 7
- type/bug: 3
- type/chore: 2

Capacidad usada: 16/16 puntos (100%) - lleno.
```

Linear notifica automáticamente a los assignees por su Inbox.

## Anti-patrones del cycle planning

❌ **Meter todo el backlog al cycle "por si acaso"**: capacidad realista, no aspiracional.

❌ **No estimar issues antes de meterlas al cycle**: sin estimate no puedes calcular capacidad.

❌ **Cambiar el cycle a mitad de semana** ("vamos a meter X más"): rompe el commitment. Mejor que entre al siguiente cycle salvo que sea verdaderamente urgent.

❌ **Asignar issues sin que el assignee esté presente**: el assignee debe aceptar implícitamente.

❌ **Cycle planning de 2 horas**: es 15-30 min para un equipo pequeño. Si toma más, hay un problema más profundo (backlog desordenado, issues mal estimadas, prioridades confusas).

❌ **No mirar lo que rebotó del cycle anterior**: si algo lleva 3 cycles rebotando, tienes que decidir: priorizar de verdad o cancelar. No dejar que rebote eternamente.

## Tip — Delegación a IA durante planning

Buena oportunidad para identificar candidatos IA. Para cada issue del cycle:

```
¿Cumple criterios de delegable a IA? (ver workflows/02-triage-y-delegar.md sección 1.4)
  Sí → label actor/ai, delegate asignado
  No → label actor/human (o sin label, default)
```

Si delegas durante planning, el agente arranca esa misma mañana. Productividad real.

## Después del planning

- Linear muestra el cycle activo en el sidebar
- Cada developer ve "My Issues" filtrado al cycle
- Los Project Updates de viernes tendrán datos reales
- A mitad de cycle (miércoles), revisión rápida de bloqueos
- Cierre el viernes (ver workflows/04-cycle-review.md)

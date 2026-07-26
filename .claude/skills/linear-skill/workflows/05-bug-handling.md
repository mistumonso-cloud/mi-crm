# Workflow — Bug handling

Manejo de bugs end-to-end: desde reporte hasta cierre. Este flujo es distinto al de features porque los bugs requieren repro verificable y pueden ser urgent (afectando producción).

## Cuándo ejecutar

- Cuando alguien reporta un comportamiento inesperado
- Cuando un test/CI falla en main
- Cuando hay errores en Sentry / logs / monitoreo
- Cuando un usuario externo reporta algo via support

## Paso 1 — Recoger el reporte

Antes de crear la issue, juntar la info mínima:

```
1. Síntoma: ¿qué pasa que no debería?
2. Repro: pasos exactos para reproducir
3. Resultado esperado vs observado
4. Ambiente: producción / staging / local
5. Frecuencia: siempre / a veces / 1 sola vez
6. Severidad: ¿afecta a usuarios pagados? ¿bloquea revenue?
7. Evidencia: logs, screenshots, error messages, sentry link
```

Si falta repro reproducible → **NO crear issue todavía**. Pedir más info al reporter. Bugs sin repro son ruido.

## Paso 2 — Buscar duplicados

```
list_issues(
  team="ENG",
  query="<keywords del síntoma>",
  label="type/bug",
  first=10,
  includeArchived=false
)
```

Si encuentras un bug similar:
- En estado abierto → **comentar en ese**, no crear nuevo. Añadir info adicional como evidencia.
- Cerrado pero reciente (último mes) → puede ser regresión. Crear nuevo bug, vincular como `relatedTo` el cerrado.
- Cerrado hace tiempo → crear nuevo bug.

## Paso 3 — Determinar severidad y prioridad

**Severidad** (interna, para triage):

| Severity | Significado |
|---|---|
| S1 — Crítico | Producción caída. Revenue o seguridad afectados |
| S2 — Alto | Feature crítica rota. Workaround difícil |
| S3 — Medio | Feature secundaria rota. Workaround existe |
| S4 — Bajo | Cosmético, edge case. Sin impacto real |

**Mapeo a Linear priority**:

| Severity | Linear priority | Cycle |
|---|---|---|
| S1 | Urgent (1) | Hoy. Drop everything. |
| S2 | High (2) | Este cycle |
| S3 | Normal (3) | Próximo cycle o backlog |
| S4 | Low (4) | Backlog, sin compromiso |

## Paso 4 — Crear el bug

Usar plantilla `examples/issue-templates/bug.md`:

```
save_issue(
  team="ENG",
  title="<descripción concisa del síntoma>",
  description="<usar plantilla bug.md>",
  labels=[
    "type/bug",
    "vertical/<X>",  // web / mobile / etc.
    "area/<X>"       // frontend / backend / infra / etc.
  ],
  priority=<según severity>,
  cycle="current" if S1 or S2,
  state="In Progress" if S1 (drop everything),
  assignee="<quien va a investigar>"
)
```

## Paso 5a — Si es S1 (urgent / hot fix)

Flujo separado más rápido:

```
1. Crear el bug con priority=1, cycle=current, state=In Progress
2. Notificar al equipo (Slack manual, no esperar Linear notifications)
3. Asignar al humano más cercano al área afectada
4. Investigación + fix en branch dedicado (NO esperar al cycle planning)
5. Hot fix → PR → merge → deploy
6. Post-mortem en comment de la issue (o documento si es grande)
7. ¿Es delegable a IA? → NO para S1. Humano siempre.
8. Cerrar issue con merge del PR
9. Una vez resuelto, comment con timeline:
   - Detectado: HH:MM
   - Diagnosticado: HH:MM
   - Fix mergeado: HH:MM
   - Deployado: HH:MM
   - Tiempo total: X minutos
```

## Paso 5b — Si es S2 / S3

Flujo normal:

```
1. Crear el bug con priority y labels correctos
2. Si S2 → meter al cycle actual
3. Si S3 → backlog, próximo cycle
4. Si tiene repro automatizable y scope claro → label actor/ai (delegable)
5. Si requiere investigación → humano
6. Asignar
```

## Paso 5c — Si es S4

```
1. Crear con priority=4, sin cycle
2. Backlog
3. Etiquetar bien para que sea encontrable
4. Posiblemente nunca se haga; aceptarlo
```

## Paso 6 — Investigación

Para bugs no triviales, comentar el avance en la issue:

```
save_comment(
  issue="ENG-X",
  body=`## Investigación

### Lo que sé
- ...

### Lo que descarté
- No es A porque ...
- No es B porque ...

### Hipótesis actual
- C, porque ...

### Próximos pasos
- ...`
)
```

Esto preserva el knowledge y hace fácil que otra persona retome.

## Paso 7 — Fix

Patrón estándar:

```
1. Branch: bug/ENG-X-<slug>  (o ai/ENG-X-<slug> si delegado a IA)
2. Test que reproduce el bug (debería fallar antes del fix)
3. Fix mínimo
4. Test debe pasar
5. PR con "Fixes ENG-X"
6. Review humano
7. Merge → automation cierra issue
```

**Para S1**, branch `hotfix/ENG-X-<slug>`, deploy directo a producción tras review.

## Paso 8 — Verificación post-fix

Antes de marcar como Done:

- [ ] Test añadido cubre el bug
- [ ] Manual: reproducir el bug original — ya no ocurre
- [ ] No regresiones detectadas (CI verde)
- [ ] Si afectaba producción, verificado en producción

## Paso 9 — Documentación post-mortem (solo S1)

Para cualquier S1, post-mortem brevísimo en la issue:

```
## Post-mortem

### Qué pasó
[1 párrafo]

### Causa raíz
[Por qué pasó técnicamente]

### Por qué no lo detectamos antes
[Análisis honesto]

### Cómo prevenir similares
- [ ] Acción 1
- [ ] Acción 2
```

Las "acciones de prevención" se convierten en sub-issues o issues nuevas (label `type/chore` o `area/<X>`).

## Anti-patrones de bug handling

❌ **Crear issue sin repro reproducible**: ruido. Pedir info primero.

❌ **No buscar duplicados antes de crear**: causa que se trabajen en paralelo bugs idénticos.

❌ **Marcar como S1 todo lo que parece urgent al humano que reporta**: la severidad es objetiva (impacto medible), no subjetiva (urgencia percibida).

❌ **Delegar S1 a IA**: el riesgo es alto y la ambigüedad inicial también. Humano siempre.

❌ **Cerrar bug sin test de regresión**: el bug volverá.

❌ **No documentar post-mortem en S1**: perdemos la lección. Mínimo 1 párrafo.

❌ **Investigar sin documentar avance**: si pausas o alguien retoma, no hay continuidad.

❌ **Hot fix sin review** (incluso en S1): siempre 4 ojos. Aunque sea rápido (5 min de review).

## Patrones útiles

### Bug con repro intermitente

Más difícil. Patrón:

```
1. Issue con label investigation/intermittent
2. Añadir más logging primero (sub-issue)
3. Esperar que ocurra de nuevo con logs activos
4. Una vez con logs, repro estable → fix normal
```

### Bug que no es bug (es feature mal entendida)

```
1. Verificar en spec / docs
2. Si sí es comportamiento esperado → cerrar como Canceled con razón
3. Pero crear sub-issue type/docs si la documentación es ambigua
```

### Bug que requiere coordinación con servicio externo

```
1. Crear issue con label external-blocker
2. Comentar dependencia (ticket en JIRA del partner, etc.)
3. State = Backlog hasta que la dependencia se resuelva
4. NO meter al cycle (no podemos terminarlo)
```

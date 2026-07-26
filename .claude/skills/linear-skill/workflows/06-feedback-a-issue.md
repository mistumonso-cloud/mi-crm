# Workflow — Feedback a Issue

Convertir feedback de equipos internos (Data Platform, Mobile App, Web App) o de usuarios externos en issues bien estructuradas en Linear, conservando trazabilidad al origen via Customer Needs.

## Cuándo ejecutar

- El humano pega un thread de Slack del equipo de Data Platform
- El humano forwarda un email de un partner
- El humano dice "mira lo que me preguntó X, hay que hacer algo"
- Llega un ticket de support
- Hay un comentario en el changelog público

## Paso 1 — Identificar items de trabajo

Un thread de Slack puede contener:

- 0 items (solo conversación)
- 1 item (un pedido claro)
- N items (múltiples pedidos en la misma conversación)

Para cada item identificable:

1. ¿Es **petición de feature**, **reporte de bug**, o **pregunta**?
2. ¿Tiene scope claro o necesita aclaración?

Si necesita aclaración:
- **NO crear issue todavía**
- Pedir al humano que aclare con el reporter
- Cuando vuelva con info → seguir paso 2

## Paso 2 — Crear Customer si no existe

En ACME, los "customers" internos son los equipos verticales (Data Platform, Mobile App, etc.). Crearlos si no existen:

```
mutation customerCreate({
  name: "Equipo Data Platform",  // o "Equipo Mobile App", etc.
  domain: null,           // no aplica para internos
  externalIds: [],
  tier: null
})
```

(Esta mutation no está en MCP — usa GraphQL directo o linear-client.ts)

Customers externos (sponsors, partners externos) sí pueden tener domain.

## Paso 3 — Decidir: ¿Customer Need o Issue directa?

**Customer Need** — si:
- El feedback viene de un canal/persona externa al equipo ACME
- Quieres preservar la fuente para mostrar al stakeholder "te escuchamos"
- Hay potencial de varios feedbacks similares para bundlear

**Issue directa** — si:
- El feedback viene de alguien dentro de ACME
- Es un follow-up técnico interno (de un retro, de un debug session)
- No hay valor en preservar el "quién pidió"

En el 80% de casos del equipo ACME: Customer Need.

## Paso 4 — Crear el Customer Need + Issue

Patrón "from need to ticket":

### Si va a ser una issue nueva:

```
1. Crear el issue (bien estructurado, con todo el triage hecho)
2. Crear el Customer Need vinculado al issue:

mutation customerNeedCreate({
  customerId: "<uuid del customer>",
  body: "<texto del feedback original, casi literal>",
  issueId: "<uuid del issue creado>",
  priority: 2  // basado en triage del issue
})
```

### Si vincular a issue existente:

```
mutation customerNeedCreate({
  customerId: "<uuid del customer>",
  body: "<feedback>",
  issueId: "<uuid del issue existente>",
  priority: 2
})
```

Esto incrementa el contador de Customer Needs en esa issue → **señal fuerte de demanda**.

## Paso 5 — Si el feedback genera múltiples issues

A veces un thread genera 3-5 issues. Patrón:

```
1. Crear cada issue con triage completo (vertical, type, priority, estimate)
2. Crear UN solo Customer Need con bundleId compartido:
   - need_1: customerId, body, issueId=A, bundleId="xyz123"
   - need_2: customerId, body, issueId=B, bundleId="xyz123"
   - need_3: customerId, body, issueId=C, bundleId="xyz123"
3. Esto agrupa los needs en la UI del Customer
```

## Paso 6 — Adjuntar la fuente

El Customer Need por sí mismo es metadata. Para preservar la fuente original (Slack thread, email):

```
mutation attachmentLinkURL({
  issueId: "<uuid>",
  url: "<link al thread de Slack o email>",
  title: "Solicitud original de @<persona>",
  subtitle: "<resumen 1 línea>"
})
```

Si el thread de Slack es interno y el link no es público fuera del workspace de Slack, está bien — los devs de ACME sí pueden acceder.

## Paso 7 — Confirmar al humano

Resumen para validación:

```
✅ Procesado feedback de @persona en #canal-X.

Issues creadas:
- ENG-101: "Añadir export PDF a dashboard" 
  → vertical/data, type/feature, priority high, estimate 3
  → vinculado a Customer Need
- ENG-102: "Corregir cálculo de fechas en weekly report"
  → vertical/data, type/bug, priority medium, estimate 2
  → vinculado a Customer Need

Customer: "Equipo Data Platform"
Customer Needs creados: 2 (bundle compartido)

Slack thread adjunto a ambas.
```

## Paso 8 — Comunicar al solicitante

Una buena práctica (humana, no automatizable):

```
"Gracias por el feedback. Hemos creado las issues ENG-101 y ENG-102.
Esperamos abordar la primera este sprint y la segunda el siguiente.
Te avisamos cuando estén listas."
```

Linear no envía esto automáticamente — es responsabilidad del humano que recibió el feedback.

## Patrones específicos

### Patrón A — El feedback es ambiguo

```
"Estaría bien que el dashboard fuera más rápido."

→ NO crear issue. Pedir aclaración al humano:
   "Más rápido en qué? Cuál es la página/acción específica? Qué tan rápido?"
```

Cuando vuelva con datos concretos, crear.

### Patrón B — El feedback es duplicado de algo en backlog

```
list_issues(team="ENG", query="<keywords del feedback>", first=10)

→ Si hay match:
   1. NO crear nueva issue
   2. Crear Customer Need vinculado a la EXISTENTE
   3. Considera subir prioridad si era baja (varios needs = más demanda)
```

### Patrón C — El feedback es realmente sobre operación (no desarrollo)

A veces el equipo de Data Platform pregunta cosas que no son de ACME:

```
"¿Pueden hacer un post sobre X?"

→ NO crear issue en ENG.
→ Recordar al solicitante que ACME solo hace desarrollo.
→ Redirigir al canal/persona correcto.
```

### Patrón D — El feedback es preguntar cómo usar algo existente

```
"¿Cómo configuro X en el dashboard?"

→ NO crear issue para "implementar X" si X ya existe.
→ Crear issue type/docs si la docs es ambigua.
→ Responder al solicitante con instrucciones.
```

## Anti-patrones

❌ **Crear una issue por cada mensaje de Slack sin filtrar**: el 90% no es trabajo.

❌ **Issues con descriptions tipo "ver thread"**: si el thread se borra/archiva, pierdes el contexto. Copia lo importante a la description.

❌ **Customer Needs sin Customer**: pierdes la trazabilidad agregada. Crea el Customer primero.

❌ **Vincular Customer Need a Project en lugar de Issue**: para feedback puntual, Issue. Project Customer Needs son para "demanda agregada de algo grande".

❌ **No comunicar al solicitante**: si nadie le dice que se hizo, asume que fue ignorado y deja de reportar.

## Tip — automatización futura

Linear soporta integración nativa con:
- Intercom → Customer Needs auto
- Zendesk → idem
- Slack → webhook personalizado posible

Si el equipo de Data Platform usa Slack intensivamente, considerar configurar:
- Bot de Slack que captura mensajes con cierta sintaxis (ej: `/feedback`)
- Lo manda a un endpoint
- El endpoint crea Customer Need automáticamente vinculado al canal

Pendiente, no urgente. Primero validar que el flujo manual funciona.

# Linear — Webhooks y eventos

Lee este documento cuando vayas a configurar receivers de eventos de Linear (para automatizaciones, integraciones, agentes IA, dashboards en tiempo real). Linear envía webhooks firmados con HMAC-SHA256 ante eventos de issues, projects, comments, etc.

## Tabla de contenidos

1. [Configuración](#configuración)
2. [Headers y formato del payload](#headers-y-formato-del-payload)
3. [Verificación de seguridad](#verificación-de-seguridad)
4. [Tipos de eventos](#tipos-de-eventos)
5. [Reintentos](#reintentos)
6. [Webhook agentic — AgentSessionEvent](#webhook-agentic--agentsessionevent)
7. [Patrones de procesamiento](#patrones-de-procesamiento)
8. [Debugging](#debugging)

## Configuración

**Vía UI**: Settings → API → Webhooks → New webhook

**Vía API** (mutation):

```graphql
mutation CreateWebhook($input: WebhookCreateInput!) {
  webhookCreate(input: $input) {
    success
    webhook { id secret }
  }
}
```

```json
{
  "input": {
    "url": "https://my-server.com/linear-webhook",
    "teamId": "<uuid del team o null para workspace>",
    "label": "Mi handler",
    "resourceTypes": ["Issue", "Comment", "Project"],
    "allPublicTeams": false
  }
}
```

**Importante**: la respuesta incluye `secret` — guárdalo. Es el secret usado para verificar la firma HMAC. NO se puede recuperar después; si lo pierdes, hay que regenerar el webhook.

## Headers y formato del payload

Cada webhook llega como POST con estos headers:

```
Content-Type:        application/json; charset=utf-8
Linear-Delivery:     <UUID único de esta entrega>
Linear-Event:        <Issue | Comment | Project | ... >
Linear-Signature:    <hex HMAC-SHA256 del body>
User-Agent:          Linear-Webhook
```

**Cuerpo (JSON)**:

```json
{
  "action": "create",          // create | update | remove
  "type": "Issue",             // entidad
  "data": { ... },             // objeto entero
  "updatedFrom": { ... },      // valores anteriores (solo en update)
  "webhookTimestamp": 1746369000000,
  "webhookId": "<uuid>",
  "organizationId": "<uuid>"
}
```

`webhookTimestamp` es ms desde epoch. Úsalo para anti-replay.

## Verificación de seguridad

**Tres validaciones obligatorias**:

### 1. Verificar firma HMAC-SHA256

```typescript
import * as crypto from "crypto";

function verifySignature(
  rawBody: string | Buffer,
  signatureHeader: string,
  secret: string
): boolean {
  const computed = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  // timing-safe comparison para prevenir timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(computed),
    Buffer.from(signatureHeader)
  );
}
```

**⚠️ Crítico**: `rawBody` debe ser el body crudo, no el resultado de `JSON.parse(body)`. Frameworks como Express con `body-parser` reemplazan el body por defecto. Configura para preservar el raw:

```typescript
// Express
import express from "express";
const app = express();
app.use(express.raw({ type: "application/json" }));

app.post("/linear-webhook", (req, res) => {
  const rawBody = req.body; // Buffer
  const signature = req.header("Linear-Signature")!;
  if (!verifySignature(rawBody, signature, SECRET)) {
    return res.status(401).end();
  }
  const payload = JSON.parse(rawBody.toString());
  // ...procesar
  res.status(200).end();
});
```

### 2. Validar timestamp (anti-replay)

```typescript
function isFreshTimestamp(webhookTimestampMs: number, toleranceSeconds = 60): boolean {
  const nowMs = Date.now();
  const ageMs = Math.abs(nowMs - webhookTimestampMs);
  return ageMs < toleranceSeconds * 1000;
}
```

Rechaza webhooks de hace más de 60 segundos (atacante podría reenviar uno capturado).

### 3. Validar IP de origen (opcional pero recomendado)

Linear publica un rango de IPs para webhooks salientes. Configurar firewall o validar con allowlist.

**Ejemplo combinado** (handler completo):

```typescript
function handleWebhook(req: Request, res: Response) {
  const rawBody = req.body as Buffer;
  const signature = req.header("Linear-Signature");
  const eventType = req.header("Linear-Event");
  const deliveryId = req.header("Linear-Delivery");

  if (!signature || !eventType) {
    return res.status(400).end("Missing headers");
  }

  if (!verifySignature(rawBody, signature, process.env.LINEAR_WEBHOOK_SECRET!)) {
    return res.status(401).end("Bad signature");
  }

  const payload = JSON.parse(rawBody.toString());

  if (!isFreshTimestamp(payload.webhookTimestamp)) {
    return res.status(401).end("Stale timestamp");
  }

  // Procesa async, responde rápido
  enqueueForProcessing({ deliveryId, eventType, payload });
  res.status(200).end();
}
```

Ver implementación completa lista para usar en `scripts/verify-webhook.ts`.

## Tipos de eventos

Estos son los `Linear-Event` que Linear puede enviar:

### Eventos de entidades

| Type | Acciones | Descripción |
|---|---|---|
| `Issue` | create, update, remove | Cambios en issues |
| `Comment` | create, update, remove | Comments en issues |
| `Project` | create, update, remove | Cambios en projects |
| `ProjectUpdate` | create, update, remove | Status updates de projects |
| `Cycle` | create, update | Cycles |
| `User` | create, update, remove | Cambios de miembros |
| `Team` | create, update, remove | Cambios de teams |
| `Attachment` | create, update, remove | Adjuntos |
| `IssueLabel` | create, update, remove | Cambios de labels |
| `Document` | create, update, remove | Documents |
| `Initiative` | create, update, remove | Initiatives |
| `InitiativeUpdate` | create, update, remove | Updates de initiatives |
| `Reaction` | create, remove | Reacciones emoji |
| `Customer` | create, update, remove | Customers (Customer Requests) |
| `CustomerNeed` | create, update, remove | Customer Needs |
| `IssueSLA` | created, updated, lapsed | SLAs |
| `OAuthApp` | create, remove | Apps OAuth |
| `AuditEntry` | create | Log entries (Enterprise) |
| `PermissionChange` | created | Cambios de permisos |
| `AppUserNotification` | create | Notificaciones para tu app |
| `AgentSessionEvent` | created, prompted | **Para agentes IA** |

### Subscripción selectiva

Al crear el webhook, especifica solo los `resourceTypes` que te interesan. Reduce ruido y procesamiento.

```
✓ Para un agente IA: ["AgentSessionEvent", "Issue", "Comment"]
✓ Para sync con CI/CD: ["Issue"]
✓ Para dashboard: ["Issue", "Project", "Cycle"]
```

## Reintentos

Linear reintenta webhooks que no responden con 2xx en **5 segundos**:

| Intento | Delay |
|---|---|
| Original | 0 |
| Retry 1 | +1 minuto |
| Retry 2 | +1 hora |
| Retry 3 | +6 horas |

Tras múltiples fallos consecutivos, Linear puede deshabilitar el webhook automáticamente. Revisar Settings → API → Webhooks para ver estado.

**Implicación**: tu handler debe **responder 200 en menos de 5 segundos**. Si tu procesamiento es más lento, encolar y procesar async:

```typescript
app.post("/linear-webhook", async (req, res) => {
  // 1. Validar firma
  if (!validate(req)) return res.status(401).end();

  // 2. Encolar (rápido)
  await queue.add({ payload: req.body });

  // 3. Responder inmediatamente
  res.status(200).end();
});

// Worker separado procesa la cola con todo el tiempo del mundo
queue.process(async (job) => {
  await handlePayload(job.data.payload);
});
```

**Idempotencia**: usa `Linear-Delivery` (UUID único por entrega) para deduplicar. Si recibes el mismo `Linear-Delivery` dos veces (por reintento), no proceses dos veces.

## Webhook agentic — AgentSessionEvent

Si construyes un agente IA usando "Linear for Agents", recibes eventos especiales `AgentSessionEvent`.

**Dos acciones**:
- `created` — alguien asignó la issue al agente o lo @-mencionó
- `prompted` — humano envió un nuevo prompt al agente en la sesión existente

**Payload típico**:

```json
{
  "action": "created",
  "type": "AgentSessionEvent",
  "data": {
    "agentSession": {
      "id": "<uuid>",
      "issue": { "id": "...", "identifier": "ENG-42", "title": "..." },
      "comment": null,
      "promptContext": "User has asked you to: <full context formatted for LLM>",
      "guidance": {
        "workspace": "<markdown del workspace agent guidance>",
        "team": "<markdown del team agent guidance>"
      }
    }
  },
  "webhookTimestamp": 1746369000000,
  "organizationId": "..."
}
```

`promptContext` viene **ya formateado para LLM** — incluye contexto de la issue, comments recientes, project specs si los hay, etc. Es el mejor punto de partida.

**Restricción crítica**: el agente debe responder con `agentActivityCreate` o `agentSessionUpdate` en **menos de 10 segundos** o la sesión se marca como `unresponsive`.

Patrón recomendado:

```typescript
// 1. Recibir webhook
async function handleAgentSession(payload) {
  const sessionId = payload.data.agentSession.id;

  // 2. Inmediatamente: emitir un "thought" (cumple los 10s)
  await client.agentActivityCreate({
    agentSessionId: sessionId,
    type: "thought",
    body: "Recibido. Analizando la issue..."
  });

  // 3. Procesar real (puede tardar minutos)
  await processIssueWithLLM(payload);
}
```

Detalles completos en `references/06-agents-sdk.md`.

## Patrones de procesamiento

### Patrón 1 — Sync de Linear ↔ herramienta interna

```
Issue.update → webhook → mi servicio → actualizar mi DB
```

Procesar `updatedFrom` para saber qué cambió:

```typescript
const { data, updatedFrom } = payload;
if (updatedFrom?.stateId && data.state.type === "completed") {
  // Issue se acaba de cerrar
  await markAsCompletedInMyDB(data.id);
}
```

### Patrón 2 — Notificación a Slack/Discord/email

```
Issue.create con label `urgent` → webhook → Slack DM al lead
```

Filtrar antes de actuar:

```typescript
if (
  payload.action === "create" &&
  payload.type === "Issue" &&
  payload.data.priority === 1
) {
  await slackNotify({ ... });
}
```

### Patrón 3 — Generación de reportes

```
Cycle.update con state=completed → generar reporte de retro automático
```

### Patrón 4 — Agente IA respondiendo a delegations

```
Issue.update con delegate=mi_agente → webhook → mi agente arranca
```

Pero la forma correcta para agentes es usar **AgentSessionEvent**, no inferir de Issue webhooks.

## Debugging

**Logs de Linear**: Settings → API → Webhooks → click en el webhook → tab "Deliveries". Ves todas las deliveries con request/response.

**Reintento manual**: en la misma página puedes "redeliver" un webhook fallido.

**Test endpoint** desde local:
- Usar `ngrok`, `Cloudflare Tunnel` o `Hookdeck CLI` para exponer localhost.
- En Settings → Webhooks, configurar la URL pública del tunnel.
- Tras debugging, cambiar a producción.

**Headers esenciales para logging**:

```typescript
console.log({
  delivery: req.header("Linear-Delivery"),  // único, para correlacionar
  event: req.header("Linear-Event"),        // tipo de evento
  size: req.body.length                     // tamaño del payload
});
```

**Errores comunes**:
- 401 por firma inválida → casi siempre por body parser que muta el raw body antes de verificar
- 5 segundos timeout → procesamiento síncrono lento, hay que encolar
- Eventos perdidos → revisar lista de `resourceTypes` configurada
- Reintentos infinitos → tu handler está respondiendo 5xx; revisar logs

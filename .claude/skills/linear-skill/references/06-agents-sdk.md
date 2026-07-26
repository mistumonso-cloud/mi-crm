# Linear for Agents

Lee este documento cuando vayas a construir o conectar un agente IA propio a Linear como app user (assignable, mentionable, con sesiones de trabajo visibles), o cuando conectes tu agente IA de coding.

## ¿Qué es "Linear for Agents"?

Lanzado el 20 de mayo de 2025. Convierte a los agentes IA en **ciudadanos de primera clase** del workspace:

- Aparecen en menús de assign y @-mention como cualquier user
- Tienen perfil propio (nombre, avatar, descripción)
- Reciben webhooks específicos cuando se les asigna trabajo
- Reportan progreso de manera estructurada (Agent Sessions + Activities)
- **No consumen seat facturable**

Filosofía clave de Linear: los agentes son **delegates**, no responsables. Cuando asignas un issue a un agente, el humano sigue siendo `assignee` (responsable) y el agente entra como `delegate` (contributor).

## Modelo conceptual

```
Issue
├── assignee: <human>              ← el responsable
├── delegate: <agent app user>      ← el agente trabajando
└── AgentSession (1:N)
    ├── status: pending|active|awaitingInput|complete|error|stale
    └── AgentActivity (1:N)
        ├── thought
        ├── action
        ├── elicitation
        ├── prompt
        └── response
```

## Agentes ya disponibles en el marketplace de Linear

A mayo 2026, instalables desde Settings → Apps → Marketplace:

| Agente | Tipo | Notas |
|---|---|---|
| **GitHub Copilot coding agent** | Coding | Integración nativa |
| **Devin** | Coding autonomous | Cognition Labs |
| **Factory (Droids)** | Coding | Multi-agente |
| **Sentry Seer** | Debugging | Error analysis |
| **Charlie** | PR review | TypeScript especialista |
| **Pixelesq, Ranger, Reflag, Stilla, Panaptico** | Variados | Nichos específicos |

Además hay agentes de coding open-source **BYOK** que hacen a Claude Code assignable, agentes de generación de PRDs/product specs, y agentes propios construidos con el SDK.

**Nota importante**: Anthropic **no tiene un agente Claude Code oficial** registrado en Linear (mayo 2026). Para usar Claude Code como agente Linear hay tres opciones:

1. **Un agente open-source BYOK** — convierte Claude Code en agente assignable de Linear
2. **Construir tu propio agente** con OAuth y este SDK
3. **Usar Claude Code interactivamente con el MCP** (lo que hacemos en este skill — no es agente assignable, pero funciona perfecto para uso interactivo)

## Opción 1 — Agente de coding BYOK (Claude Code assignable)

Varias apps open-source convierten Claude Code en un agente assignable de Linear. El patrón general:

**Qué hace**:
- Cada issue asignada al agente crea un **git worktree aislado** (`worktrees/ENG-42/`)
- Corre Claude Code en ese worktree
- Transmite *thoughts* y *actions* como Agent Activities al issue de Linear
- Abre PR cuando termina

**Modelo BYOK** (bring your own keys):
- Usa tu cuenta Anthropic Pro/Max o API key
- No paga por usuario; el coste es Anthropic + el del runner

**Despliegue**:
- **Managed**: la versión hospedada del proveedor — registras y conectas
- **Self-hosted**: clonar repo, configurar `.env`, levantar el server. Para webhooks locales, usar Hookdeck CLI o Cloudflare Tunnel.

**Configuración recomendada**:

1. Instalar el agente desde Settings → Apps → Marketplace
2. Conectar tu cuenta Anthropic (BYOK)
3. Conectar el repo de GitHub que mantenga el equipo
4. Configurar **workflows seleccionables por labels**:
   - Label `actor/ai-plan` → el agente solo planifica, no implementa
   - Label `actor/ai-bug` → workflow especializado en bugs
   - Label `actor/ai-feature` → workflow estándar para features
5. Configurar `CLAUDE.md` global en el archivo de configuración del agente con convenciones del equipo (ver `examples/claude-md-template.md`)
6. Configurar **agent guidance** en Linear (Settings → Agents → tu agente → Additional guidance)

**Cómo lo usas**:
```
1. Triage: identificas una issue candidata para IA
2. La asignas como delegate al agente, label actor/ai
3. El agente recibe webhook AgentSessionEvent
4. Crea worktree, corre Claude Code, comenta progreso en la issue
5. Termina con PR open en GitHub
6. Tú revisas, aprueba, merge → workflow automation cierra issue
```

## Opción 2 — Construir tu propio agente

Si quieres más control (ej: tu propio agente que no es coding, sino algo específico tuyo).

### Pasos de alto nivel

1. **Crear OAuth app** en Settings → API → OAuth applications
   - Redirect URI: tu callback
   - Scopes: `read`, `write`, `app:assignable`, `app:mentionable`
2. **Configurar webhooks** con resourceType `AgentSessionEvent`
3. **Implementar OAuth flow** (`actor=app` para que las acciones aparezcan como del agente)
4. **Listener de webhooks**: handle `AgentSessionEvent` con action `created` y `prompted`
5. **Responder en <10s** con un primer `agentActivityCreate` (al menos un thought)
6. **Procesar el trabajo real** y emitir actividades incrementales
7. **Cerrar la session** con `agentActivityCreate` type=`response`

### Esqueleto de handler

```typescript
import { LinearWebhookClient } from "@linear/sdk/webhooks";
import { LinearClient } from "@linear/sdk";

const webhookClient = new LinearWebhookClient(process.env.LINEAR_WEBHOOK_SECRET!);

app.post("/agent-webhook", express.raw({ type: "application/json" }), async (req, res) => {
  // 1. Verificar
  const signature = req.header("Linear-Signature");
  const timestamp = req.header("Linear-Timestamp");
  if (!webhookClient.verify(req.body, signature!, timestamp)) {
    return res.status(401).end();
  }

  const payload = JSON.parse(req.body.toString());

  if (payload.type !== "AgentSessionEvent") {
    return res.status(200).end();
  }

  // 2. Responder rápido
  res.status(200).end();

  // 3. Procesar async
  await handleAgentSession(payload);
});

async function handleAgentSession(payload: any) {
  const sessionId = payload.data.agentSession.id;
  const agentClient = await getAgentClient(payload.organizationId);

  // 3a. Acuse rápido (cumple los 10s)
  await agentClient.agentActivityCreate({
    agentSessionId: sessionId,
    type: "thought",
    body: "Empezando a analizar la issue..."
  });

  // 3b. Trabajo real
  const issue = payload.data.agentSession.issue;
  const promptContext = payload.data.agentSession.promptContext;
  const guidance = payload.data.agentSession.guidance;

  const result = await myLLM({
    system: `${guidance.workspace}\n\n${guidance.team}`,
    user: promptContext
  });

  // 3c. Reportar progreso intermedio (opcional)
  await agentClient.agentActivityCreate({
    agentSessionId: sessionId,
    type: "action",
    body: `Ejecutando: ${result.actionDescription}`
  });

  // 3d. Si hace falta input humano
  if (result.needsClarification) {
    await agentClient.agentActivityCreate({
      agentSessionId: sessionId,
      type: "elicitation",
      body: `¿Puedes confirmar X?`
    });
    return;  // session entra en awaitingInput
  }

  // 3e. Respuesta final
  await agentClient.agentActivityCreate({
    agentSessionId: sessionId,
    type: "response",
    body: result.summary
  });

  // 3f. Opcional: enlazar a tu dashboard
  await agentClient.agentSessionUpdate(sessionId, {
    externalUrls: [{ label: "Run details", url: `https://my-dashboard.com/run/${runId}` }]
  });
}
```

### Tipos de Agent Activity

- `thought` — razonamiento visible (público en la UI). Ej: "El error parece estar en el cálculo de impuestos"
- `action` — acción ejecutada con su resultado. Ej: "Ejecutando tests... 24/25 pass"
- `elicitation` — pidiendo input al humano. Pone la session en estado `awaitingInput`
- `prompt` — el prompt que recibió (Linear lo pone automáticamente)
- `response` — respuesta final del agente (cierra la session si no hay más actividad)

### Estados de Agent Session

Linear gestiona el estado automáticamente según la última actividad:

| Estado | Cuándo |
|---|---|
| `pending` | Session creada, agente aún no respondió |
| `active` | Agente trabajando (último activity reciente) |
| `awaitingInput` | Última activity fue `elicitation` |
| `complete` | Última activity fue `response` y no hubo más prompts |
| `error` | El agente reportó error o lleva mucho tiempo sin activity |
| `stale` | La sesión quedó sin activity por más del threshold |

### Agent Guidance — el "system prompt" del workspace

En Settings → Agents → Additional guidance puedes escribir Markdown que se pasa automáticamente al agente en cada session (campo `guidance.workspace` y `guidance.team`).

Útil para codificar:
- Repositorio a usar para cada tipo de cambio
- Convenciones de commits/PRs
- Cómo referenciar issues
- Proceso de review esperado
- Lenguaje y tono

Ver `examples/agent-guidance.md` para una plantilla de ejemplo.

## Opción 3 — Claude Code interactivo + MCP

Esta es la opción que el skill por defecto cubre. **No** convierte Claude Code en agente assignable de Linear. Pero es:

- ✅ Más simple (no requiere registrar OAuth app)
- ✅ Más barato (no requiere infra adicional)
- ✅ Suficiente para 95% de los casos cuando un humano está conduciendo

**Cómo se ve en uso**:

```
Tú (en Claude Code): "Ve a Linear, busca las issues de esta semana del project X, 
                      empieza con la más urgente, abre branch, etc."

Claude Code:
1. Llama linear-server:list_issues(...)
2. Lee la issue elegida
3. Crea branch local con el branchName de Linear
4. Implementa
5. Llama linear-server:save_issue para mover a "In Progress"
6. Comenta progreso con linear-server:save_comment
7. Abre PR
8. Linear automation lo lleva a "In Review" automáticamente
```

**No genera AgentSession** porque no es app user. Pero sí registra los cambios bajo tu user humano. Perfecto para sesiones interactivas.

## Cuál elegir

| Caso | Opción |
|---|---|
| Quiero delegar issues a Claude Code y olvidarme | **Un agente BYOK** (Claude Code assignable) |
| Tengo un agente custom (no coding) que quiero integrar | **OAuth app propia** |
| Trabajo interactivamente y solo quiero tools de Linear en Claude Code | **MCP (default del skill)** |
| Quiero que un agente de coding agarre issues asignadas | Instalar **el agente** desde marketplace |

## Combinaciones

Las opciones no son excluyentes. Un equipo puede tener:

- **MCP** instalado en Claude Code de cada developer (uso interactivo)
- **Un agente BYOK** registrado como agent para delegations async (via labels)
- **Otro agente** registrado para issues con label `actor/ai-2`

Cada agente compite limpiamente porque van con label distinto.

## Referencias adicionales

- Documentación oficial: https://linear.app/developers/agents
- Agent Interaction SDK overview: https://linear.app/now/our-approach-to-building-the-agent-interaction-sdk
- Linear for Agents marketplace: https://linear.app/integrations/agents

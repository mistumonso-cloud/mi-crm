# Linear Skill

Skill de Claude Code para gestión de Linear en un equipo de desarrollo.

## Qué hace

Automatiza y estandariza la operación del equipo de desarrollo en Linear: triage, planning, ejecución, retro y delegación a agentes IA. Implementa **The Linear Method** adaptado al contexto de un equipo pequeño (2-3 humanos + agentes IA) que mantiene varias plataformas digitales.

Capacidades principales:

- Crear/buscar/actualizar issues con dedupe automático
- Crear projects con milestones siguiendo el Linear Method
- Triage estructurado del backlog
- Delegación segura a agentes IA de código
- Cycle planning semanal y retro
- Generación de reportes y project updates
- Operaciones batch con paginación y rate limit
- Verificación de webhooks de Linear (HMAC + anti-replay)
- Subida de attachments via signed URL
- Customer Needs vinculados a issues

## Instalación

### Prerequisito: Claude Code instalado

Si aún no lo tienes:
- macOS/Linux: https://claude.com/code
- Verifica con: `claude --version`

### Paso 1 — Descomprimir el skill

```bash
# Donde sea que descomprimas (ejemplo: ~/.claude/skills/)
mkdir -p ~/.claude/skills
cd ~/.claude/skills
unzip /ruta/a/linear-skill.zip
```

Esto crea `~/.claude/skills/linear-skill/` con todo el contenido.

### Paso 2 — Conectar el MCP de Linear a Claude Code

```bash
claude mcp add --transport http linear-server https://mcp.linear.app/mcp
```

Luego inicia Claude Code y ejecuta:

```
/mcp
```

Esto abre el navegador para autorizar OAuth con Linear. Una vez autorizado, las tools `linear-server:*` quedan disponibles.

### Paso 3 — Personalizar el config con tus IDs reales

Edita `~/.claude/skills/linear-skill/examples/workspace-config.example.json` y reemplaza los `<fill-in>` con los UUIDs reales de tu workspace.

Forma rápida de obtenerlos:

1. Crea una Personal API key en Linear (Settings → API → Personal API keys)
2. Ejecuta:

```bash
cd ~/.claude/skills/linear-skill/scripts
export LINEAR_API_KEY=lin_api_xxxxxx
npx ts-node linear-client.ts
```

Esto imprime tu workspace info. Luego ejecuta queries puntuales contra GraphQL para obtener los UUIDs específicos. Las queries están listadas dentro del JSON en el campo `queries_to_fill_uuids`.

### Paso 4 (opcional) — Instalar dependencias para los scripts

```bash
cd ~/.claude/skills/linear-skill
npm init -y
npm install -D ts-node typescript @types/node
```

Los scripts no son necesarios para el uso interactivo (eso lo cubre el MCP), pero son útiles para batch jobs y webhooks.

## Uso básico

Una vez instalado, en cualquier sesión de Claude Code puedes pedir:

```
"Crea una issue para implementar OAuth en el login de la Web App"
"Lista mis issues del cycle actual"
"Planifiquemos el cycle de esta semana"
"Cierra el cycle y genera retro"
"Delega ENG-42 a tu agente IA"
"Cuántos bugs nuevos hay esta semana"
"Genera el weekly report"
```

Claude Code activará el skill automáticamente cuando detecte que el contexto es Linear.

## Estructura del skill

```
linear-skill/
├── SKILL.md                # entry point (siempre cargado)
├── README.md               # este archivo
├── references/             # documentación bajo demanda
│   ├── 01-data-model.md
│   ├── 02-mcp-tools.md
│   ├── 03-graphql-cheatsheet.md
│   ├── 04-rate-limits.md
│   ├── 05-webhooks.md
│   ├── 06-agents-sdk.md
│   └── 07-linear-method.md
├── workflows/              # playbooks paso a paso
│   ├── 01-crear-project.md
│   ├── 02-triage-y-delegar.md
│   ├── 03-cycle-planning.md
│   ├── 04-cycle-review.md
│   ├── 05-bug-handling.md
│   └── 06-feedback-a-issue.md
├── prompts/                # plantillas listas para usar
│   ├── crear-issue.md
│   ├── buscar-y-deduplicar.md
│   ├── batch-update.md
│   ├── weekly-report.md
│   ├── issue-template-feature.md
│   └── issue-template-bug.md
├── scripts/                # código TypeScript ejecutable
│   ├── linear-client.ts
│   ├── verify-webhook.ts
│   ├── batch-issues.ts
│   └── upload-attachment.ts
└── examples/               # configuración del workspace
    ├── workspace-config.example.json
    ├── label-taxonomy.json
    ├── agent-guidance.md
    ├── claude-md-template.md
    └── issue-templates/
        ├── feature.md
        ├── bug.md
        └── tarea-delegable-a-ia.md
```

## Cómo cargar referencias bajo demanda

El skill usa **progressive disclosure**: el SKILL.md siempre está en contexto (es corto), las referencias se cargan solo cuando hacen falta. La tabla en SKILL.md ("Cuándo cargar qué referencia") guía esto.

Si quieres que Claude Code lea una referencia específica de antemano, puedes pedirlo:

```
"Lee references/05-webhooks.md, vamos a configurar un webhook"
```

## Configuración recomendada de Linear (pre-skill)

Idealmente el workspace ya tiene:

- ✅ Cycles habilitados (1 semana)
- ✅ Triage habilitado en el team
- ✅ Estimates en escala Fibonacci (1, 2, 3, 5, 8)
- ✅ Workflow states: Triage → Backlog → Todo → In Progress → In Review → Done/Canceled
- ✅ Initiatives habilitadas
- ✅ Agent guidance configurado (pegar `examples/agent-guidance.md`)
- ⚠️ Labels de la taxonomía (ver `examples/label-taxonomy.json`) — **algunas pueden faltar**

Si hay configuración faltante, el skill puede ayudarte a crearla:

```
"Configura los labels que faltan según la taxonomía del skill"
```

## Solución de problemas

### El MCP de Linear no aparece en /mcp

```bash
# Verificar
claude mcp list

# Si no está, añadirlo
claude mcp add --transport http linear-server https://mcp.linear.app/mcp

# Reiniciar Claude Code
```

### Errores de "tool not found" al pedir cosas de Linear

El MCP no está conectado. Sigue paso 2 de la instalación.

### Errores de "RATELIMITED"

Estás haciendo demasiadas operaciones. Espera 1 minuto y reintenta. Si es batch, usa `scripts/batch-issues.ts` que tiene throttling correcto.

### El skill no se activa cuando hablo de Linear

Puede que el SKILL.md no esté siendo cargado. Verifica:

```bash
ls ~/.claude/skills/linear-skill/SKILL.md
```

Si existe, puede que Claude Code esté en modo donde no auto-detecta skills. Forzar con:

```
"Usa el skill linear-skill: <tu petición>"
```

## Actualizar el skill

```bash
cd ~/.claude/skills/
rm -rf linear-skill/
unzip /ruta/a/linear-skill-nuevo.zip
```

Conserva tu `examples/workspace-config.example.json` personalizado:

```bash
cp linear-skill/examples/workspace-config.example.json /tmp/
unzip linear-skill-nuevo.zip
mv /tmp/workspace-config.example.json linear-skill/examples/
```

## Filosofía

Este skill hace cumplir 4 reglas no negociables:

1. **Una issue, un dueño, un estado claro**
2. **Dedupe siempre antes de crear**
3. **Trabajo de IA marcado y revisado por humano**
4. **Sin ruido en el sistema**

Si alguna de estas reglas te molesta, probablemente estés intentando un anti-patrón. El Linear Method existe por motivos. Ver `references/07-linear-method.md`.

## Versiones

- **v1.0** — versión inicial. SKILL completo con 7 referencias, 6 workflows, 6 prompts, 4 scripts, 5 ejemplos.

## Contribuir

Las modificaciones se hacen directamente sobre tu copia. Si quieres compartir mejoras con el equipo:

1. Edita los archivos relevantes
2. Re-empaqueta: `cd ~ && zip -r linear-skill-v1.1.zip .claude/skills/linear-skill/`
3. Compártelo con el equipo

## Licencia

Uso interno.

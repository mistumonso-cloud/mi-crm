# MIS-288 · Spike 1A.0 — Capacidades de Railway y Cloudflare

Tres preguntas que hay que responder **con una prueba** antes de escribir el proxy.
De sus respuestas depende qué forma toma 1A.1 (autenticar el origen) y 1A.4 (health check).

---

## Ya verificado desde fuera (no tienes que hacerlo)

- `mistu-monso.com` **está detrás de Cloudflare** (proxied): `server: cloudflare`, `cf-ray: …-MAD`, IPs de rango Cloudflare (`188.114.96.5`, `188.114.97.5`).
- **No hay cabeceras de seguridad** en el edge hoy (confirma M2).
- **No existe `/api/health`** (404). `/` responde 307 → `/login`.

---

## Lo que necesito de ti — 3 bloques

### Bloque 1 — ¿Se puede llegar a Railway sin pasar por Cloudflare?  *(la pregunta central)*

**Dónde:** Railway → proyecto CRM → servicio (el de la web) → pestaña **Settings → Networking**.

**Anota:**
1. ¿Hay un dominio de Railway del tipo `xxxxx.up.railway.app` activo? Cópiame el nombre exacto.
2. ¿Está `mistu-monso.com` listado ahí como custom domain?
3. ¿Existe la opción **Private Networking**? ¿Y algún toggle de **Public Networking / TCP Proxy**?

**Qué decide:** si el dominio `*.up.railway.app` responde la app directamente (sin Cloudflare), el **mecanismo B es obligatorio** — no basta la cabecera-secreto. Si el servicio puede quedar solo en red privada + Cloudflare Tunnel, esa es la solución fuerte.

> En cuanto me pases el nombre del dominio `*.up.railway.app`, **la prueba de alcance directo la hago yo desde aquí** (es un dominio público). No tienes que lanzar curl.

### Bloque 2 — ¿Cómo hace Railway el health check?

**Dónde:** Railway → servicio → **Settings → Deploy** (busca "Healthcheck" / "Health Check Path").

**Anota:**
1. ¿Hay un **Healthcheck Path** configurado ahora mismo? (esperado: no, `railway.json` no lo define).
2. Si hay alguna nota en la UI sobre cómo hace la sonda (sobre el puerto interno del contenedor vs. el dominio público).

**Qué decide:** la sonda de Railway golpea el contenedor por su **red interna**, no a través de Cloudflare → **no llevará la cabecera `X-Origin-Auth`**. Por eso `/api/health` tiene que quedar **exenta** del check de origen (1A.4). Confirmar esto evita que el secreto de origen tumbe el deploy.

### Bloque 3 — Cloudflare: ¿podemos inyectar la cabecera de origen? ¿y en qué modo SSL estamos?

**Dónde:** Cloudflare → dominio `mistu-monso.com`.

**Anota:**
1. **Rules → Transform Rules → Modify Request Header**: ¿te deja crear una regla "Set (static)"? (En plan Free hay hasta 10; debería dejar). No la crees aún — solo confirma que la opción está.
2. **SSL/TLS → Overview**: ¿en qué modo está? (esperado por las notas del proyecto: **Full**; el objetivo es **Full (strict)**, pero eso se cambia al final del despliegue, no ahora).

**Qué decide:** el mecanismo A de 1A.1 depende de poder poner una Transform Rule con `Set` (sobreescritura), no `Add`. Si por lo que sea no estuviera disponible, habría que replantear cómo firma Cloudflare el tráfico de origen.

---

## Lo que hago yo en cuanto me des el dominio de Railway

```
# alcance directo: si responde SIN cf-ray, el origen es alcanzable sin Cloudflare
curl -sSI https://<dominio>.up.railway.app/login
dig +short <dominio>.up.railway.app
```

---

## Resultado del bloque 1 — 2026-08-11

**El origen está completamente expuesto.** Probado desde fuera:

- Dominio Railway `mi-crm-production-b627.up.railway.app` → resuelve a `69.46.46.113` (IP de Railway, no de Cloudflare). `/login` → 200, `server: railway-hikari`, **sin `cf-ray`**.
- La **IP de origen sirve la app con `Host: mistu-monso.com`** saltándose Cloudflare → **quitar el subdominio `.up.railway.app` NO sirve de nada**: la IP responde el host canónico igual.
- El origen **acepta `CF-Connecting-IP`/`X-Forwarded-For` falsos del cliente** (HTTP 200). A1 confirmado, en vivo, en producción.

**Consecuencias para el diseño:**

1. **Mecanismo B "desactivar dominio" queda descartado** (opción 3 del plan): la IP responde el host canónico igual. Confirmado empíricamente, no teoría.
2. **Railway no ofrece allowlist de IP entrante** nativo → la única forma real de cerrar el origen a nivel de red es **Cloudflare Tunnel**, y el habilitador ya existe: **Private Networking activo** (`mi-crm.railway.internal`, IPv4 & IPv6).
3. **Mecanismo A (secreto de origen en `proxy.ts`) es la línea de defensa que cierra el agujero a nivel de app** y ships en el código de MIS-288: tras el deploy, cualquier petición sin `X-Origin-Auth` → 403, venga por el dominio de Railway o por la IP cruda. No depende de Railway.
4. **Full (strict) no protege contra esto**: valida el cert CF→origen, no impide que un tercero pegue al origen. Sigue mereciendo la pena por el MITM CF→origen, pero no es la respuesta a A1.

## Tabla de decisión

| Pregunta | Respuesta | Rama del plan |
|---|---|---|
| ¿Railway alcanzable sin Cloudflare? | **SÍ** (dominio + IP cruda con host canónico) | Mecanismo B obligatorio; "desactivar dominio" descartado |
| ¿Railway soporta red privada / Tunnel? | **SÍ** — `mi-crm.railway.internal` activo | **Cloudflare Tunnel** es el mecanismo B |
| ¿Sonda de health por red interna (sin CF)? | **SÍ, y no hay path configurado hoy.** Railway la llama "before a deploy completes" | `/api/health` exenta del secreto de origen (1A.4). Ver refinamiento abajo |
| ¿Transform Rule `Set` disponible? | **Sí, confirmado** — Rules → Overview → Create rule → "request header transform rule" (con acción Set static) | Mecanismo A viable |
| ¿Modo SSL actual? | **Full** (plan Free) | Objetivo Full (strict), al final del despliegue |

## Principio que refuerza el bloque 3 — nada en la capa Cloudflare cuenta como seguridad

El origen es alcanzable directamente (bloque 1), así que **cualquier control que viva solo en Cloudflare —Managed Transforms, WAF, "Add security headers"— es evitable pegando al origen**. Consecuencia firme para MIS-288:

- Las **cabeceras de seguridad van en `next.config.ts`** (1A.7), no en el toggle "Add security headers" de Cloudflare. Fuente única, versionada, y viaja con la app.
- El **secreto de origen se valida en `proxy.ts`** (mecanismo A), no es una configuración de Cloudflare que un origen directo se salte.
- La Transform Rule de Cloudflare **solo inyecta** `X-Origin-Auth`; quien de verdad decide es el proxy. Cloudflare es el emisor del secreto, no el guardián.

Nota sobre IP: `CF-Connecting-IP` la pone Cloudflare por defecto (no es un Managed Transform). El toggle "Remove visitor IP headers" debe quedar **OFF** — la necesitamos. Como el mecanismo A rechaza todo lo que no venga de Cloudflare, la `CF-Connecting-IP` que llega a `clientIp.ts` es siempre la de Cloudflare, fiable.

## Spike cerrado — veredicto

1. **I1 se cumple con el mecanismo A** (secreto en `proxy.ts`): toda petición sin `X-Origin-Auth` → 403 antes de tocar lógica, venga por el dominio de Railway o por la IP cruda. Ships en el código de MIS-288 y no depende de Railway.
2. **Mecanismo B = Cloudflare Tunnel**, habilitado por la red privada ya activa. Es **defensa en profundidad** contra fuga del secreto, no requisito de I1. Es infra con riesgo de downtime → decisión de scope pendiente (¿dentro de MIS-288 o ticket propio?).
3. **"Desactivar dominio" y "allowlist de IP" descartados**: el primero no cierra la IP cruda; el segundo Railway no lo ofrece nativo.
4. **`/api/health`**: exenta del secreto de origen + comprueba presencia de variables obligatorias (guardián de deploy). Refinamiento de 1A.3/1A.4 arriba.
5. **SSL Full → Full (strict)** al final del despliegue; no resuelve A1 pero cierra el MITM CF→origen.

## Decisión de scope (2026-08-11)

- **Mecanismo B (Tunnel) → ticket propio [MIS-294](https://linear.app/mistu-monso/issue/MIS-294)**, defensa en profundidad, fuera del camino crítico. Bloqueado por MIS-288, no bloquea a nadie.
- **Refinamiento de `/api/health`** (guardián de deploy + chequeo de presencia de variables): **aprobado** por el usuario el 2026-08-11. Aplicado a 1A.3/1A.4 del plan.
- **Transform Rules "Set static": confirmado disponible** (Rules → Overview → Create rule → "request header transform rule").

**Spike 100% cerrado.** Las tres preguntas respondidas. MIS-288 listo para código.

## Refinamiento que destapa el bloque 2 — `/api/health` como guardián del deploy

La sonda de Railway corre **antes de dar el deploy por bueno**; si falla, Railway **no promociona** el deploy nuevo y mantiene el viejo sirviendo (con `restartPolicy: ON_FAILURE`). Eso convierte a `/api/health` en un sitio ideal para **guardar el deploy contra una mala configuración**, y afina la relación entre 1A.3 (fail-closed) y 1A.4:

- **`/api/health` NO exige el secreto de origen** — la sonda interna no lo lleva. (Ya en el plan.)
- **Pero SÍ comprueba que las variables obligatorias están presentes**, y devuelve 503 si falta alguna.

Resultado: un deploy con una env var de seguridad ausente **falla el healthcheck y no llega a promocionarse** — el deploy viejo, sano, sigue en pie. Es más seguro que la redacción actual del plan (1A.3 decía que `/api/health` queda siempre en 200 aunque el resto esté en fail-closed): con esa versión, un deploy mal configurado se promocionaba y servía 503 a todo el mundo.

**Matiz que preserva la invariante de la ruta:** `/api/health` comprueba *presencia* de variables (`typeof x !== "undefined"`), **nunca su valor ni ningún servicio externo** — sigue sin tocar Convex, Resend ni base de datos. La invariante de 1A.4 ("nunca crece para comprobar servicios") se mantiene intacta.

→ **Propuesta de cambio menor a 1A.3/1A.4 del plan**, a confirmar antes de implementar. No reabre ninguna invariante; las refuerza.

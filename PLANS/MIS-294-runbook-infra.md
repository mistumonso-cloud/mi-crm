# MIS-294 · Runbook de infra — Cloudflare Tunnel (fase de ejecución en dashboards)

> **Qué es esto.** El plan `PLANS/MIS-294-cloudflare-tunnel.md` (GO CONDICIONADO, ronda 2) ya está
> aprobado y el **paso 1 (Ligar a IPv6) está COMPLETADO** (G1 cerrado, ver abajo). Este documento es
> el **runbook operativo de los pasos 2→6**: montar `cloudflared` + Tunnel en Cloudflare Zero Trust
> y **cerrar el origen público** de Railway. Se ejecuta en **dashboards** (Railway + Cloudflare); no
> hay más cambios de código.
>
> **Reparto:** **tú** ejecutas en Railway/Cloudflare (no tengo acceso). **Yo** hago las
> verificaciones públicas (`curl`/`dig`) y te confirmo cada gate. **Nunca imprimas el `TUNNEL_TOKEN`.**
>
> **Ventana:** ejecutar en **bajo tráfico**. El único corte real es el paso 5 (repunte DNS, segundos).
> **Umbral de rollback:** si un gate no pasa en **≤10 min** de diagnóstico → revertir el paso y abortar
> la ventana.

---

## Datos ya capturados (no hay que volver a averiguarlos)

| Dato | Valor | Fuente |
|------|-------|--------|
| **PORT interno** del servicio web | **8080** | Logs de arranque: `Network: http://[::]:8080` |
| Destino interno del servicio web | `http://mi-crm.railway.internal:8080` | Red privada Railway (IPv6/AAAA) |
| Host canónico (lo exige `proxy.ts`) | `mistu-monso.com` | `APP_CANONICAL_HOST` |
| Región del proyecto | US West | Dashboard Railway |
| Réplicas del servicio web hoy | **1** | Dashboard Railway → decide M4 |
| Commit del cambio de repo | `23b0162` (PR #68) | `main` |

**G1 (paso 1) — CERRADO** ✅: deploy `-H ::` activo, `next start` ligado a `[::]:8080`, público 200
sin regresión (HSTS+CSP), mecanismo A dando 403 al origen directo.

---

## ⚠️ Decisión previa obligatoria — M4 (bloquea el paso 6)

Antes de ejecutar el **paso 6** (corte del ingress público) hay que cerrar M4 con **una** de estas dos:

- **Opción A (recomendada):** el servicio `cloudflared` corre con **≥2 réplicas** → ≥2 conectores en
  el Tunnel → sin punto único de fallo. Se ensaya el failover real (**G3-Fail**).
- **Opción B:** solo **1 réplica** posible (límite de plan) → **aceptas el SPOF por escrito**
  (comentario en MIS-294), con el rollback DNS (**G-Roll**) como mitigación operativa.

> Se decide al llegar al paso 3 (cuando veas en Railway si el plan te deja ≥2 réplicas del servicio
> `cloudflared`). El servicio web hoy corre a 1 réplica — es un indicio, pero confírmalo en el propio
> servicio `cloudflared`.

---

## Paso 0 — Preparación (sin tocar tráfico)

**0.1 · Transform Rule (gate G0) — ✅ YA CONFIRMADO, NADA QUE HACER.** Verificado en el dashboard
(2026-08-18): la regla **"MIS-288 origin auth"** (Rules → Overview → Request Header Transform Rules)
dispara sobre **`All incoming requests`** — **sin filtro de host**. Por tanto inyecta `X-Origin-Auth`
en toda petición que pasa por Cloudflare, incluido el canario `tunnel-canary.mistu-monso.com`.
- **No hay que ampliar ni tocar la regla.** El canario queda auto-cubierto.
- **No hay ampliación temporal que revertir** en el paso 6 (el checkpoint de limpieza de la TR se
  vuelve un no-op).
- ⚠️ La regla contiene el valor del secreto de origen. No exponerlo en capturas/logs compartidos.

**0.2 · Captura del DNS actual (para G-Roll).** En Cloudflare → **DNS → Records**, apunta el registro
actual de `mistu-monso.com` **completo**: **tipo, nombre, destino/contenido, estado proxied
(naranja/gris) y TTL**. Guárdalo (captura o texto). Es el valor exacto a restaurar en rollback.
> Manda esos datos aquí y los dejo registrados como evidencia G-Roll.

- [x] G0: Transform Rule confirmada `All incoming requests` (sin filtro de host) → canario auto-cubierto
- [ ] DNS previo de `mistu-monso.com` capturado

---

## Paso 2 — Crear el Tunnel en Cloudflare Zero Trust

1. Cloudflare → **Zero Trust** → **Networks** → **Tunnels** → **Create a tunnel**.
2. Tipo **Cloudflared**. Nómbralo p. ej. `mi-crm-railway`.
3. Cloudflare te muestra el **token de instalación**. **Copia el `TUNNEL_TOKEN`** — lo pegarás como
   variable de entorno en Railway en el paso 3. **No lo pegues aquí ni en ningún log.**
4. No añadas todavía ningún public hostname (eso es paso 4 y 5).

- [ ] Tunnel creado, `TUNNEL_TOKEN` copiado (en tu portapapeles / gestor, no en chat)

---

## Paso 3 — Desplegar `cloudflared` como servicio en Railway

1. En el **mismo proyecto** Railway → **New** → **Empty Service** (o Docker Image).
2. **Imagen fijada por digest** (no solo tag). Usa la imagen oficial de Cloudflare **por digest**:
   - En el dashboard, fuente = Docker Image: `cloudflare/cloudflared@sha256:<DIGEST>`.
   - 👉 **Fija el digest exacto** del `cloudflare/cloudflared:latest` vigente en el momento (mira el
     digest en Docker Hub / `docker manifest inspect`). **Anota aquí el digest usado.**
3. **Start command:** `tunnel --no-autoupdate run`
4. **Variable de entorno:** `TUNNEL_TOKEN = <el token del paso 2>` (Railway → Variables).
5. **Réplicas (decisión M4):** intenta poner **2 réplicas** (Settings → Deploy → Replicas).
   - Si te deja → **Opción A**. Si no → **Opción B** (1 réplica + aceptar SPOF por escrito).
6. **Restart policy** activa (ON_FAILURE), igual que el servicio web.
7. Deploy.

**Gate G3 — conector(es) HEALTHY:** en Cloudflare → Zero Trust → el Tunnel debe mostrar
**conector(es) HEALTHY** (≥2 si Opción A). Sin public hostname aún → **el tráfico real no cambia**.

**Gate G3-Fail (solo Opción A) — ensayo de failover:** con ≥2 conectores, **reinicia/detén una
réplica** en Railway y comprueba: (a) el Tunnel sigue sano por la otra; (b) el conector detenido
desaparece/se degrada en Zero Trust; (c) el restart lo devuelve a HEALTHY. → **cierra M4**.

- [ ] Servicio `cloudflared` desplegado (digest anotado: `________`)
- [ ] M4 decidido: ☐ A (≥2 réplicas) ☐ B (1 réplica + SPOF aceptado en MIS-294)
- [ ] G3: conector(es) HEALTHY
- [ ] G3-Fail: failover ensayado (si Opción A)

**Rollback del paso 3:** eliminar el servicio `cloudflared` (no afecta al tráfico, aún sin hostname).

---

## Paso 4 — Canario end-to-end (probar el Tunnel SIN tocar el apex)

> Esto prueba toda la cadena **Cloudflare → cloudflared → red privada IPv6 → 8080 → Next** con un
> hostname de usar y tirar, **antes** de tocar `mistu-monso.com`.

1. En el Tunnel (Zero Trust) → **Public Hostnames** → **Add a public hostname**:
   - **Subdomain:** `tunnel-canary` · **Domain:** `mistu-monso.com`
   - **Service:** `HTTP` → `mi-crm.railway.internal:8080`
   - **Additional application settings → HTTP Settings → HTTP Host Header:** `mistu-monso.com`
     *(imprescindible: satisface el check de host canónico de `proxy.ts`)*.

**Gate G4a — smoke por el canario.** Avísame y lanzo:
`curl -sSI https://tunnel-canary.mistu-monso.com/login` → debe dar respuesta válida de la app
(**200/307 → /login**), demostrando que la ruta privada funciona y conserva host canónico +
`X-Origin-Auth`.

**[Sugerencia auditoría — media] Evidencia de trayecto privado, no del edge público:** además del
200, confirmamos en los **logs del servicio `cloudflared`** (Railway) la **petición correlacionada**
por timestamp/path del canario. Así probamos que fue por el Tunnel/red privada IPv6 y **no** por el
ingress público por accidente. → Pásame los logs del conector tras mi curl.

- [ ] Public hostname canario creado (con Host Header `mistu-monso.com`)
- [ ] G4a: `curl` al canario → app OK
- [ ] Petición correlacionada visible en logs de `cloudflared`

**No se toca el apex hasta que G4a pasa.** Rollback: retirar el hostname canario (el apex sigue por
el edge de Railway, intacto).

---

## Paso 5 — Repuntar el apex `mistu-monso.com` por el Tunnel  ⟵ *único corte real (segundos)*

1. En el Tunnel → **Public Hostnames** → **Add a public hostname**:
   - **Subdomain:** *(vacío)* · **Domain:** `mistu-monso.com` (el apex)
   - **Service:** `HTTP` → `mi-crm.railway.internal:8080`
   - **HTTP Host Header:** `mistu-monso.com`
2. Cloudflare **sustituye automáticamente** el registro DNS del apex por el del Tunnel
   (`<uuid>.cfargotunnel.com`, proxied).

**Gate G4b — evidencia de ruta Tunnel (no vale `cf-ray`):**
- **(a) DNS→UUID:** el DNS autoritativo de `mistu-monso.com` apunta a `<uuid>.cfargotunnel.com`
  (visible en el panel DNS de Cloudflare). ← esto lo confirmo yo + tú en el panel.
- **(b) Petición correlacionada** en los logs del conector `cloudflared` por timestamp/path del smoke.

**Smoke funcional del paso 5** (avísame y lo corro por fuera + tú validas login en navegador):
- Login por **contraseña** OK.
- Login **Google** OK (redirect_uri intacto — el hostname no cambia; MIS-264).
- Cookies `__Host-` / `__Secure-` presentes.
- **[Sugerencia auditoría] Cabeceras** HSTS + CSP con nonce presentes por la nueva ruta.

- [ ] Apex añadido al Tunnel; DNS→UUID confirmado (G4b-a)
- [ ] Petición correlacionada en logs del conector (G4b-b)
- [ ] Smoke: contraseña + Google + cookies + cabeceras

**Rollback del paso 5 → G-Roll** (ver abajo).

---

## Paso 6 — Eliminar TODO el ingress público del servicio web  ⟵ *requiere M4 cerrado*

> **No ejecutar hasta que M4 esté cerrado** (Opción A verificada con G3-Fail, o Opción B aceptada por
> escrito en MIS-294).

En Railway → **servicio web** → **Settings → Networking**, retira **todo**:
1. El **dominio generado** `*.up.railway.app`.
2. **`mistu-monso.com` como custom domain** del servicio web (a partir de ahora sirve por Tunnel, no
   como custom domain de Railway).
3. Cualquier **Public Networking / TCP Proxy** restante.

Objetivo: el servicio web queda **solo en red privada, sin ningún endpoint público**.

**Gate G5 — cierre total del ingress** (lo verifico yo):
- `curl -sS -H 'Host: mistu-monso.com' http://69.46.46.113/login` → **NO** sirve la app.
- `curl --resolve mistu-monso.com:443:69.46.46.113 -sSI https://mistu-monso.com/login` (HTTPS con
  SNI/host canónico) → **NO** sirve la app.
- `*.up.railway.app` **ya no resuelve/enruta** al servicio.
- La pestaña Networking del servicio web **no lista ningún dominio público**.

**Gate G6 — healthcheck sin ingress público:** el deploy del servicio web sigue **pasando el
healthcheck interno** `/api/health` (Railway lo sonda por red interna, no por Cloudflare/Tunnel).

**Limpieza en este checkpoint final:**
- Retirar el **hostname canario** `tunnel-canary.mistu-monso.com` del Tunnel.
- ~~Revertir la ampliación temporal de la Transform Rule (G0)~~ → **no aplica**: la regla nunca se
  amplió (dispara sobre `All incoming requests`, ver paso 0.1). Nada que revertir.

- [ ] Ingress público del servicio web eliminado (los 3 puntos)
- [ ] G5: IP cruda y SNI ya no sirven; `*.up.railway.app` no enruta; Networking vacío
- [ ] G6: healthcheck interno sigue verde
- [ ] Canario retirado + Transform Rule revertida

**Rollback del paso 6:** re-añadir el ingress público del servicio web (vuelve el edge de Railway
como origen) + G-Roll si además hay que devolver el DNS.

---

## G-Roll — rollback de DNS explícito

- **Antes** (paso 0) queda registrado el DNS previo completo (tipo/nombre/destino/proxied/TTL).
- **Reversión:** en Cloudflare → DNS, retira el public hostname del Tunnel para `mistu-monso.com` y
  **restaura manualmente** el registro **exactamente** al valor capturado (no asumas que reaparece
  solo). **Fuente autoritativa del destino restaurado: el panel/API de Cloudflare** (`dig` solo como
  evidencia complementaria).
- **Checkpoint:** `curl -sSI https://mistu-monso.com/login` sirve la app por el edge de Railway (con
  el ingress público re-añadido).
- **Orden de reversión total** (si se aborta tras el paso 6): (a) re-añadir ingress público del
  servicio web; (b) restaurar DNS con G-Roll; (c) verificar smoke; (d) opcionalmente parar
  `cloudflared`.

---

## Sugerencias de auditoría incorporadas a este runbook

- **[Media]** G1/G4a distinguen **"proceso escucha en `::`"** (ya probado, G1) de **"`cloudflared`
  llega por `mi-crm.railway.internal`"** (se prueba en G4a con log del conector). El público IPv4 sano
  **no** prueba por sí solo el trayecto privado IPv6.
- **[Media]** Conservar como evidencia el **destino efectivo** que usa `cloudflared` (log del conector),
  para no dar por buena una prueba que pasara por error por el ingress público.
- **[Baja]** Registrar el **comportamiento dual-stack** observado (ya anotado en G1: `[::]:8080`).
- **[Baja]** Verificar también el **rollback del `startCommand`** (revertir el commit `23b0162`) si el
  binding IPv6 diera una incompatibilidad inesperada, además del rollback DNS.

---

## Registro de ejecución (rellenar durante la ventana)

| Gate | Inicio | Aprobado | Rollback | Notas / evidencia |
|------|--------|----------|----------|-------------------|
| G0 | 2026-08-18 | 2026-08-18 | — | ✅ TR "MIS-288 origin auth" = `All incoming requests`, sin filtro de host → canario auto-cubierto |
| DNS previo | | | | tipo/nombre/destino/proxied/TTL |
| G3 | | | | nº conectores HEALTHY |
| G3-Fail | | | | (si Opción A) |
| G4a | | | | curl canario + log conector |
| G4b | | | | DNS→UUID + petición correlacionada |
| Smoke p5 | | | | pass/Google/cookies/cabeceras |
| G5 | | | | IP cruda + SNI + `*.up.railway.app` |
| G6 | | | | healthcheck interno |
| Limpieza | | | | canario retirado + TR revertida |

---

## Follow-up (crear al cierre, Backlog/Low, relacionados con MIS-294)

- Procedimiento periódico de actualización de `cloudflared` (revisar digest).
- Rotación programada de `TUNNEL_TOKEN`.
- Monitorización histórica de disponibilidad y latencia del Tunnel.
- **Monitorización M4:** definir quién recibe la alarma y qué estado dispara intervención
  (p. ej. `<2 conectores HEALTHY durante >N min`).

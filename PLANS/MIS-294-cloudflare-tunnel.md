# MIS-294 · Cerrar el origen con Cloudflare Tunnel (mecanismo B, defensa en profundidad de 1A)

> **Historial de auditoría**
> - **Ronda 1 (2026-08-17): NO-GO.** Blocker B1 + majors M1–M4.
> - **Ronda 2 (2026-08-18): correcciones aplicadas** a B1 y M1–M4, más sugerencias no
>   bloqueantes (pin de imagen, umbrales de rollback, HTTPS/SNI, verificación de cabeceras).
>   Los fragmentos revisados están marcados con **[R2]**.
> - **Ronda 2 → veredicto: GO CONDICIONADO (2026-08-18).** B1 y M1–M4 cerrados en diseño.
>   **Condición:** confirmar ≥2 réplicas en Railway + verificar failover real, o aceptación
>   explícita del SPOF, **antes del paso 6**. Sugerencias aceptadas incorporadas. Fragmentos de
>   ronda 3 marcados con **[R3]**.

## [R3] Condición del GO (bloquea el paso 6, no el código)

Antes de eliminar el ingress público (paso 6) hay que **cerrar M4 en ejecución**:

1. Confirmar en Railway que el servicio `cloudflared` puede correr **≥2 réplicas** en el plan
   actual, y **ensayar el failover real** (gate **G3-Fail**).
2. Si **no** hubiera ≥2 réplicas disponibles, el **usuario acepta expresamente el SPOF** por
   escrito (comentario en MIS-294) antes del corte, con G-Roll como mitigación operativa.

Es una condición de **runbook** (fase de ejecución en dashboards), no del código de repo — no
bloquea escribir el cambio de `railway.json`, pero **sí** bloquea el paso 6.

## Contexto — por qué se hace

El spike 1A.0 (`PLANS/MIS-288-spike-1A0.md`, 2026-08-11) probó **en vivo** que el origen de
Railway está **completamente expuesto**:

- `mi-crm-production-b627.up.railway.app` → `69.46.46.113` sirve la app **sin pasar por
  Cloudflare** (`server: railway-hikari`, sin `cf-ray`).
- La **IP cruda responde con `Host: mistu-monso.com`** → retirar el subdominio `.up.railway.app`
  **no cierra nada**: la IP sigue sirviendo el host canónico **mientras exista cualquier ingress
  público en el servicio**.
- Railway **no ofrece allowlist de IP** entrante nativa.

El **mecanismo A** (secreto de origen `X-Origin-Auth` validado en `src/proxy.ts`) ya cierra **I1
a nivel de app**: cualquier petición directa al origen sin la cabecera → 403. Ships desde MIS-288.

Este ticket cierra el hueco **a nivel de red** (mecanismo B): montar **Cloudflare Tunnel** sobre
la red privada `mi-crm.railway.internal` (activa, confirmada en el spike) y **eliminar TODO el
ingress público del servicio web de Railway**, de modo que **si el secreto de origen se filtrara,
el origen seguiría inalcanzable**. El mecanismo A se mantiene como segunda capa. Es **defensa en
profundidad**, no requisito de I1, y **fuera del camino crítico** (no bloquea 1B ni fases 2-3).
Riesgo real: **reconfiguración de red con posible downtime** → por eso es ticket propio, con orden
de corte, gates verificables y verificación externa.

## Estado actual (anclas de código y topología)

- **Topología hoy:** navegador → Cloudflare (proxied, SSL **Full**, edge-HSTS OFF) → **edge de
  Railway** → contenedor Next. `mistu-monso.com` está hoy dado de alta como **custom domain del
  servicio web** en Railway; así enruta el edge de Railway. En paralelo, la **IP cruda
  `69.46.46.113`** y el dominio `*.up.railway.app` alcanzan el contenedor **sin Cloudflare**.
- **Red privada Railway:** `mi-crm.railway.internal` activa (IPv4 & IPv6 — spike). Es el
  habilitador del Tunnel.
- **`railway.json`** → `deploy.startCommand: "npm run start"` (= `next start`),
  `healthcheckPath: "/api/health"`, `restartPolicyType: ON_FAILURE`.
- **`package.json`** → `"start": "next start"`, Next **16.2.10**. `next start` por defecto liga a
  `0.0.0.0` (**solo IPv4**). La red privada de Railway resuelve por **IPv6** (`AAAA` de
  `*.railway.internal`) → un servicio que solo escucha IPv4 **no es alcanzable** por otro servicio
  vía red privada. Railway exige ligar a `::`.
- **`src/proxy.ts`** — mecanismo A: en `NODE_ENV==="production"` exige `X-Origin-Auth`
  (`secretMatches`, comparación en tiempo constante) + **host canónico** (`APP_CANONICAL_HOST`),
  antes de tocar lógica. La **Transform Rule de Cloudflare** que inyecta `X-Origin-Auth` vive a
  **nivel de zona**; hay que confirmar su **filtro** (ver gate G0) para que cubra también el
  hostname canario del paso 4 → **mecanismo A intacto como 2ª capa**.
- **`src/app/api/health/route.ts`** — sonda **interna** de Railway, exenta del secreto de origen.
  El healthcheck de Railway golpea el contenedor por su red interna (no por Cloudflare ni por el
  Tunnel), así que sigue funcionando **sin ingress público** (a confirmar en G5).
- **`next.config.ts`** — HSTS (`Strict-Transport-Security: max-age=63072000; includeSubDomains`)
  lo sirve **la app**, no el edge de Cloudflare → intacto tras el corte.

## Diseño

**`cloudflared` como servicio Railway aparte + Tunnel gestionado en remoto (por token).** Es el
patrón idiomático de Railway y el más simple: la config de ingress vive en Cloudflare (no en el
repo), como MIS-258 fue "config-only".

1. **Servicio nuevo `cloudflared`** en el mismo proyecto Railway, desde la imagen oficial
   **fijada por digest** (ver §Sugerencias aplicadas), con comando `tunnel --no-autoupdate run` y
   variable de entorno `TUNNEL_TOKEN` (el token del Tunnel gestionado). Al estar en el mismo
   proyecto/región, alcanza el servicio web por `mi-crm.railway.internal`. **Alta disponibilidad:
   ≥2 réplicas** (ver §Continuidad operativa — M4).
2. **Tunnel en Cloudflare Zero Trust** (gestionado en remoto): **public hostname**
   `mistu-monso.com` → servicio `http://mi-crm.railway.internal:${PORT}` (el PORT interno del
   servicio web), con **HTTP Host Header = `mistu-monso.com`** para satisfacer el check de host
   canónico de `proxy.ts`. Al crear el public hostname, Cloudflare **actualiza el registro DNS**
   de `mistu-monso.com` para apuntarlo al Tunnel (`<uuid>.cfargotunnel.com`, proxied). El registro
   DNS previo se **captura antes** y su restauración se define de forma explícita (ver M3/G-Roll).
3. **Ligar el servicio web a IPv6:** cambiar `startCommand` a **`next start -H ::`** en
   `railway.json`. Es el **único cambio de repo**. En Linux `::` es dual-stack (IPv4-mapped),
   así que el edge público de Railway sigue funcionando durante la transición.
4. **[R2 · B1] Eliminar TODO el ingress público del servicio web** (Railway → servicio web →
   Settings → Networking): retirar **el dominio generado `*.up.railway.app`**, retirar
   **`mistu-monso.com` como custom domain del servicio web** (a partir del corte sirve por Tunnel,
   no como custom domain de Railway), y **desactivar cualquier Public Networking / TCP Proxy**
   restante. Objetivo inequívoco: el servicio web queda **solo en red privada, sin ningún dominio
   ni endpoint público**. Esto es lo que cierra de verdad la IP cruda — retirar solo
   `*.up.railway.app` **no basta** (contrato del Contexto).

**SSL/TLS:** con Tunnel, el tramo edge↔`cloudflared` lo cifra Cloudflare por el propio Tunnel; el
tramo `cloudflared`→origen es red privada interna. El objetivo "Full (strict)" del plan de
seguridad deja de aplicar a esta ruta (ya no hay origin-pull directo). HSTS lo sigue emitiendo la
app → sin cambios.

## Cambios por fichero

- **`railway.json`** (único fichero de repo): `deploy.startCommand`
  `"npm run start"` → `"npm run start -- -H ::"` (o `"next start -H ::"`). El **literal exacto** se
  fija en la fase de código verificando que `npm run start -- -H ::` propaga el flag, y se **anota
  en el runbook** antes de ejecutar (sugerencia baja aplicada).

Todo lo demás es **infra en dashboards** (sin código): servicio `cloudflared` en Railway, Tunnel
+ public hostname en Cloudflare Zero Trust, y eliminación del ingress público. No hay cambios en
`convex/` → **no hay deploy a Convex**.

## Gates verificables (los puntos «no verificables desde el texto» se convierten en gate)

- **G0 — Transform Rule. [R3]** Antes de nada, confirmar en Cloudflare el **filtro** de la
  Transform Rule que inyecta `X-Origin-Auth`. Si está acotada a `Host == mistu-monso.com`,
  **ampliarla de forma limitada** a `Host in {mistu-monso.com, tunnel-canary.mistu-monso.com}` —
  **no** ampliar a toda la zona salvo que se haya comprobado que ningún otro hostname proxied
  enviaría el secreto a un origen distinto. Gate: una petición al canario llega a Next **con**
  `X-Origin-Auth` (no recibe 403 por secreto). La ampliación temporal al canario se **revierte** en
  el checkpoint final del paso 6.
- **G-Port — puerto interno.** Registrar el **PORT interno real** del servicio web (Railway →
  Variables / Networking). El public hostname y el canario apuntan a ese puerto.
- **G1 — IPv6.** Tras merge de `-H ::`: `https://mistu-monso.com` sigue sirviendo público (aún por
  edge de Railway). Evidencia: `curl -sSI` con 200/307 y cabeceras de seguridad presentes.
- **G3 — conector HEALTHY.** El servicio `cloudflared` (≥2 réplicas) muestra **≥2 conectores
  HEALTHY** en Zero Trust.
- **[R3] G3-Fail — ensayo de failover de una réplica.** Con el canario ya sirviendo (o en cuanto
  haya ≥2 conectores), **detener/reiniciar controladamente una réplica** y comprobar que:
  (a) el smoke sigue funcionando por la réplica restante; (b) el conector detenido **desaparece o
  se degrada** en Zero Trust como se espera; (c) la política de restart lo **devuelve a HEALTHY**.
  Cierra la condición del GO (M4). Si Railway **no** permite ≥2 réplicas, este gate se sustituye
  por la **aceptación explícita del SPOF** por el usuario (ver §Condición del GO).
- **[R2 · M1] G4a — prueba end-to-end por el Tunnel ANTES de tocar el apex.** Con un **hostname
  canario** temporal `tunnel-canary.mistu-monso.com` → mismo servicio
  `http://mi-crm.railway.internal:${PORT}` y **Host header `mistu-monso.com`**:
  `curl -sSI https://tunnel-canary.mistu-monso.com/login` devuelve respuesta válida de la app
  (200/307 → `/login`), demostrando la cadena **Cloudflare → cloudflared → DNS privado → puerto →
  Next** y que conserva host canónico + `X-Origin-Auth`. **No se toca el apex hasta que G4a pasa.**
- **[R2 · M2] G4b — evidencia específica de ruta Tunnel (no `cf-ray`).** Al repuntar el apex:
  1. **DNS autoritativo** de `mistu-monso.com` apunta al **UUID** `<uuid>.cfargotunnel.com` (verlo
     en el panel DNS de Cloudflare / API; `cf-ray` **no** sirve como prueba de ruta porque ya
     estaba presente antes del cambio).
  2. **Petición correlacionada** visible en los **logs del conector** (logs del servicio
     `cloudflared` en Railway) por timestamp/path del smoke. `cf-ray` queda como comprobación
     secundaria, no como prueba.
- **[R2 · B1] G5 — cierre total del ingress público.** Tras eliminar todo ingress:
  - `curl -sS -H 'Host: mistu-monso.com' http://69.46.46.113/login` → **no** sirve la app.
  - `curl --resolve mistu-monso.com:443:69.46.46.113 -sSI https://mistu-monso.com/login` (HTTPS con
    **SNI/host canónico**, sugerencia media aplicada) → **no** sirve la app.
  - El dominio generado `*.up.railway.app` **ya no resuelve/enruta** al servicio.
  - En Railway, la pestaña Networking del servicio web **no lista ningún dominio público**.
- **G6 — healthcheck sin ingress público.** El deploy del servicio web sigue pasando el
  healthcheck interno `/api/health` tras retirar el ingress (Railway lo sonda por red interna).

## Orden de corte (minimizar downtime) — runbook

Ejecutado en **ventana de bajo tráfico**. Cada paso tiene su gate; si falla, se ejecuta el rollback
del paso antes de avanzar. **Umbral de rollback [R2, sugerencia media]:** si un gate no pasa en
**≤10 min** de intentos de diagnóstico, se revierte el paso y se aborta la ventana.

0. **G0 + G-Port:** confirmar filtro de la Transform Rule (ampliar al canario si hace falta) y el
   PORT interno real. **[R2 · M3] Capturar el registro DNS actual** de `mistu-monso.com`: **tipo,
   nombre, destino/contenido, estado proxied (naranja/gris) y TTL efectivo**, y guardarlo como
   evidencia (sin exponer tokens). Es el valor a restaurar en rollback.
1. **Ligar a IPv6.** Merge del cambio `railway.json` (`-H ::`) → Railway redeploya el servicio web.
   **Gate G1.** Rollback: revertir el commit (redeploy del anterior).
2. **Crear el Tunnel** en Cloudflare Zero Trust (gestionado por token). Copiar el `TUNNEL_TOKEN`
   (**nunca se imprime**).
3. **Desplegar `cloudflared`** en Railway con `TUNNEL_TOKEN`, imagen **fijada por digest**, **≥2
   réplicas**, restart automático. **Gate G3.** (Sin public hostname aún → tráfico real intacto.)
   Rollback: eliminar el servicio `cloudflared`.
4. **[R2 · M1] Canario end-to-end.** Añadir el public hostname **canario**
   `tunnel-canary.mistu-monso.com` (Host header `mistu-monso.com`). **Gate G4a.** Si pasa, se
   procede; el canario se retira al final del paso 5. Rollback: retirar el canario (no afecta al
   apex, que sigue por Railway).
5. **Repuntar el apex.** Añadir el public hostname **`mistu-monso.com`** al Tunnel (Cloudflare
   sustituye el DNS por el del Tunnel). **Gate G4b** (DNS→UUID + petición correlacionada en logs
   del conector) **y** smoke funcional: login por contraseña, login **Google** (redirect_uri
   intacto, hostname no cambia), cookies `__Host-`/`__Secure-`, y **[R2, sugerencia baja]
   cabeceras HSTS/CSP/seguridad** presentes. Rollback: **G-Roll** (abajo).
6. **[R2 · B1] Eliminar TODO el ingress público** del servicio web (dominio generado + custom
   domain `mistu-monso.com` + Public Networking/TCP Proxy). **Gate G5 + G6.** Retirar también el
   hostname **canario**. Rollback: re-añadir el ingress público del servicio web (vuelve el edge de
   Railway como origen) + G-Roll si además hay que devolver el DNS.

### [R2 · M3] G-Roll — rollback de DNS explícito y ejecutable

- **Antes** (paso 0) queda registrado el registro DNS previo completo (tipo/nombre/destino/proxied/
  TTL).
- **Reversión:** en el panel DNS de Cloudflare, retirar el public hostname del Tunnel para
  `mistu-monso.com` y **restaurar manualmente** el registro exactamente al valor capturado (no se
  asume que reaparezca solo). **Responsable:** el usuario (acceso a Cloudflare). **Checkpoint
  final:** `curl -sSI https://mistu-monso.com/login` sirve la app por el edge de Railway (con el
  ingress público re-añadido). **[R3] Fuente autoritativa del destino restaurado: el panel/API de
  Cloudflare** (no `dig`); `dig` se conserva solo como evidencia complementaria.
- **Orden de reversión total** (si se aborta tras el paso 6): (a) re-añadir ingress público del
  servicio web; (b) restaurar DNS con G-Roll; (c) verificar smoke; (d) opcionalmente parar
  `cloudflared`.

## [R2 · M4] Continuidad operativa de `cloudflared`

Tras el paso 6, `mistu-monso.com` depende de `cloudflared`. Contrato mínimo de continuidad:

- **Redundancia:** **≥2 réplicas** del servicio `cloudflared` en Railway → el mismo Tunnel expone
  **≥2 conectores**; Cloudflare balancea entre ellos, así que la caída de una réplica no interrumpe
  el servicio (cloudflared soporta múltiples conectores por Tunnel).
- **Reinicio automático:** política de restart de Railway activa para el servicio `cloudflared`.
- **Monitorización:** alarma/vigilancia del estado de conectores en Zero Trust (y de la salud del
  servicio en Railway). **[R3]** Registrar **quién recibe la alarma** y **qué estado dispara
  intervención** (p. ej. <2 conectores HEALTHY durante >N min).
- **Rollback operativo probado:** el G-Roll de arriba es el camino de reversión si el Tunnel se
  degrada; se documenta y se deja verificado.
- Si por límite de plan **no** hubiera redundancia disponible, se **documenta y acepta
  expresamente** el riesgo residual (SPOF) con el G-Roll como mitigación operativa. → **Decisión
  del usuario** al dar el GO.

## Reparto (quién ejecuta qué)

- **Yo (repo + verificación externa pública):** el cambio en `railway.json` (CODIGO/ + PR), y las
  comprobaciones por `curl`/`dig` contra dominios/IPs públicas (dominio Railway, IP cruda,
  `mistu-monso.com`, canario). No imprimo tokens.
- **Tú (dashboards, sin acceso mío):** confirmar Transform Rule y PORT, capturar el DNS previo,
  crear el Tunnel y copiar `TUNNEL_TOKEN`, crear el servicio `cloudflared` (digest + ≥2 réplicas)
  con esa env var, añadir canario y luego apex, eliminar el ingress público, y ejecutar G-Roll si
  hace falta. Te doy el runbook con los pasos exactos y los checkpoints.

## Riesgos y mitigaciones

- **Binding IPv6 rompe el edge público durante la transición.** Mitigación: `::` es dual-stack en
  Linux; **G1** verifica el público **antes** de tocar la red. Rollback: revertir el commit.
- **`cloudflared` no resuelve `mi-crm.railway.internal` / puerto o binding mal.** Mitigación:
  **G4a (canario end-to-end) antes de tocar el apex** → un fallo de ruta se descubre sin downtime.
- **Falso positivo por `cf-ray`.** Mitigación: **G4b** exige DNS→UUID + petición correlacionada en
  el conector.
- **Rollback DNS incompleto.** Mitigación: **G-Roll** con captura previa y restauración manual
  explícita.
- **SPOF de `cloudflared`.** Mitigación: **≥2 réplicas + restart + monitorización** (M4).
- **OAuth Google (MIS-264).** El hostname `mistu-monso.com` **no cambia** → redirect_uri intacto;
  verificación explícita en el paso 5.
- **Downtime.** Ventana de bajo tráfico; el corte real es el paso 5 (repunte DNS proxied, segundos)
  y el paso 6 (no afecta al tráfico por Cloudflare). Umbral de rollback: 10 min por gate.

## No-objetivos

- No se toca el **mecanismo A** (`X-Origin-Auth` sigue vigente como 2ª capa).
- No se migra a **Full (strict)** (queda fuera de ruta con Tunnel; decisión aparte si procede).
- No se cierra **Convex** (servicio distinto, el navegador va directo a `*.convex.cloud`).
- No se rota `ORIGIN_SHARED_SECRET` (rotación es su propio procedimiento).

## Verificación

- **Local (repo):** `railway.json` sigue siendo JSON válido; `npm run build` no se ve afectado
  (el flag `-H ::` es solo de runtime, no de build). Sin cambios de app → e2e sin cambios.
- **Pre-corte (externa):** confirmar el estado del spike: `curl -sSI` a
  `mi-crm-production-b627.up.railway.app/login` responde sin `cf-ray`; IP cruda responde con host
  canónico.
- **Durante/post-corte:** los gates **G0–G6 + G-Roll** de arriba (incluye HTTPS con SNI y
  verificación de cabeceras HSTS/CSP).
- **[R2, sugerencia baja] Evidencia antes/después:** conservar rutas públicas de Railway, registro
  DNS, estado de conectores y resultados de smokes (sin exponer tokens).

## Sugerencias no bloqueantes aplicadas

- **Imagen `cloudflared` fijada por digest** (no solo `--no-autoupdate`): se fija el digest exacto
  en la fase de ejecución y se anota en el runbook.
- **Umbrales de rollback temporales:** 10 min por gate antes de revertir.
- **HTTPS con SNI/host canónico** en G5 (además del HTTP contra la IP histórica).
- **Verificar HSTS/CSP/cabeceras** en el smoke del paso 5.
- **Anotar PORT interno y literal final de `startCommand`** antes de ejecutar el runbook.
- **[R3] Timestamps por gate:** registrar inicio, aprobación y (si aplica) rollback de cada gate.
- **[R3] Limpieza en el checkpoint final del paso 6:** eliminar el **hostname canario** y revertir
  la **ampliación temporal de la Transform Rule** (G0) en el mismo checkpoint.

## Follow-up (deuda enviada, no bloquea el GO)

Tickets a crear al cierre (Backlog/Low, relacionados con MIS-294):

- Procedimiento periódico de actualización de `cloudflared` (revisar digest).
- Rotación programada de `TUNNEL_TOKEN`.
- Monitorización histórica de disponibilidad y latencia del Tunnel.

## Metodología / Gate

**Este plan NO es GO.** Está en `PLANS/MIS-294-cloudflare-tunnel.md`, **pendiente de la ronda 2 de
auditoría externa**. No se crea rama, no se escribe código, no se toca Railway/Cloudflare ni prod
hasta un **GO explícito** (o GO condicionado, cuyas condiciones se incorporan antes de avanzar).
El ticket MIS-294 está en **In Progress**.

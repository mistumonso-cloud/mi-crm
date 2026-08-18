# MIS-21 — Deploy y puesta en marcha (cierre ligero del MVP)

> **Estado:** **GO CONDICIONADO (ronda 2, 2026-08-18).** Ronda 1 = NO-GO (M1: el fallback de export
> manual no garantizaba copia durable); ronda 2 cerró M1 + sugerencias media/baja (**[R2]**); ronda 2
> → GO CONDICIONADO, con 3 sugerencias baja aplicadas (**[R3]**). Las condiciones del GO son los gates
> de ejecución del propio runbook (smoke, copia durable efectiva, ciclo de vida de Carlos si se hace,
> registro de evidencias antes de Done). Ya se puede ejecutar siguiendo estos gates.

## Contexto

MIS-21 es el ticket de **lanzamiento del MVP** (milestone *Fase 6 — QA y lanzamiento*, único
**Urgent** abierto). El grueso ya está desplegado y vivo: la app corre en `mistu-monso.com` (Railway
+ Convex prod `greedy-tapir-20`, Cloudflare delante), con login por contraseña y Google, y toda la
cadena de seguridad (MIS-288…303). El ticket lleva en Backlog desde junio arrastrando criterios de
aceptación de "lanzamiento empresarial" que ya no encajan.

**Decisión de alcance (confirmada con el usuario, 2026-08-18):** el CRM es un **proyecto de
aprendizaje**; Carlos y Marta son **personajes de práctica**, no usuarios reales. Por tanto MIS-21 se
cierra en modo **ligero**: (1) verificar que prod funciona de punta a punta, (2) **montar backups de
Convex** (sí lo quiere), (3) documentar lo diferido conscientemente, y (4) cerrar el ticket. **Sin
QA en dispositivos reales, sin cuentas de usuarios reales, sin monitorización de errores.** No hay
cambios de código de aplicación.

## Estado actual (verificado en exploración — no re-hacer)

- **App viva:** `mistu-monso.com` sirve 200 con HSTS + CSP nonce; origen directo da 403 (mecanismo A).
- **Deploy:** Railway auto-deploya frontend al mergear a `main`; Convex prod se despliega a mano con
  el runbook canónico `PLANS/RUNBOOK-DESPLIEGUE-CONVEX-PROD.md` (deployment `greedy-tapir-20`).
- **Health gate:** `src/app/api/health/route.ts` devuelve 503 en prod si faltan `ORIGIN_SHARED_SECRET`
  / `APP_CANONICAL_HOST` / `AUTH_SERVER_KEY` → un deploy mal configurado no se promociona.
- **Usuarios:** alta cerrada, solo vía `internalMutation` `auth:seedUser` (admin key) con hash
  pre-calculado por `scripts/hash-password.mjs` (PBKDF2-SHA256, 600k iter). Roles `rep`/`supervisor`;
  el rol solo decide la pantalla de aterrizaje (`/pendientes` vs `/panel`), no permisos de escritura.
  `mistumonso@gmail.com` ya existe en prod como `supervisor`.
- **Móvil 320px:** cubierto por e2e (`edge-cases.spec.ts`, `panel-flow.spec.ts`).
- **Backups:** **no existe nada** → se monta en este ticket.
- **Monitorización de errores:** no hay (Sentry/etc.) → se documenta como diferido.

## Plan

### Paso 1 · Verificación de producción
Dividida entre lo que compruebo yo (HTTP público) y lo que confirmas tú (flujos autenticados en
navegador — requieren login real).

- **Yo (`curl`, público):** `/login` → 200 con HSTS+CSP; `/api/health` → 200 sin CSP; origen directo
  (`69.46.46.113` con Host canónico) → 403; `/api/auth/google/start` emite `code_challenge` +
  `code_challenge_method=S256` (PKCE de MIS-299).
- **Tú (navegador, en `mistu-monso.com`):**
  - Login por **contraseña** con `mistumonso@gmail.com` → aterriza en `/panel` (supervisor).
  - Login con **Google** (mismo email) → aterriza en `/panel`, sesión en `mistu-monso.com`.
  - Recorrido core por flujo (resultado funcional de cada uno, no solo "sin errores de consola"):
    Panel, Contactos (crear/ver), Pendientes, Ventas.
  - **[R2] Datos de prueba:** cualquier contacto/venta creado en el recorrido se marca como dato de
    prueba (p. ej. prefijo reconocible) o se **elimina al terminar**, para no dejar basura en prod.

### Paso 2 · (Opcional) Cuenta Carlos de prueba en prod para ver el rol `rep`
Solo si quieres comprobar en vivo la pantalla de aterrizaje del comercial. Procedimiento con
herramientas ya existentes (sin código nuevo):
1. `node scripts/hash-password.mjs` → escribes una contraseña (oculta) → copias el hash.
2. `npx convex run auth:seedUser '{"name":"Carlos","email":"carlos@mistu-monso.com","passwordHash":"<hash>","role":"rep"}' --prod`
3. Login con esa cuenta → debe redirigir a `/pendientes` (rol `rep`).
4. **[R2] Decisión de retención — ANTES de crearla:** decidir si la cuenta se **elimina tras el
   smoke** o se **conserva**.
   - Si se **elimina:** borrarla al terminar (mutation interna de borrado / dashboard) y verificar
     `accountsPendingRotation --prod` = `[]`.
   - Si se **conserva:** registrar en este runbook **responsable** (el usuario) y **dónde queda la
     contraseña** (gestor de contraseñas, nunca en el repo/Linear/chat). Es una cuenta de prueba con
     rol `rep`, sin permisos extra (el rol solo cambia la pantalla de aterrizaje).
> Nota: `seedUser` exige `passwordHash` incluso para cuentas que luego usen Google — es el único
> punto de alta. Si no te interesa ver el rol `rep`, se salta este paso entero.

### Paso 3 · Backups de Convex (prod `greedy-tapir-20`)
Objetivo: dejar de tener los datos sin ninguna copia. Dos mecanismos; se prefiere el programado y el
manual es el mínimo garantizado. **[R2 · M1] El gate de este paso NO se satisface por la mera
existencia inicial de un fichero: exige una copia que quede almacenada de forma DURABLE y siga
existiendo tras la ejecución.**

- **Vía preferida — Backups programados (dashboard):** Convex Dashboard → deployment `greedy-tapir-20`
  → **Settings → Backups** → activar backups **periódicos** si el plan contratado lo permite.
  Verificar que aparece al menos una copia listada y su cadencia. Si esto está activo, cierra el paso
  por sí solo (las copias las retiene Convex).
- **Vía mínima garantizada — Export manual DURABLE:** si el plan **no** ofrece backups programados,
  ejecutar una copia inicial con `npx convex export --prod --path <fichero>.zip` y, **para cerrar el
  gate [R2 · M1]:**
  1. **Guardar el ZIP en una ubicación DURABLE fuera del entorno de ejecución** (no en `/tmp`, no en
     el checkout del repo, no en el equipo como única copia). P. ej. almacenamiento en la nube del
     usuario / disco de backups.
  2. **Registrar en este runbook:** ubicación (identificación **suficiente para localizarla, pero
     [R3] NUNCA una URL compartida, credencial ni dato que conceda acceso**), **responsable** (el
     usuario) y **control de acceso** (quién puede leerla).
  3. **Fijar y anotar la cadencia manual** y la **fecha de la próxima ejecución** (p. ej. "export
     manual mensual, próximo: <fecha>"). **[R3] Anotar también la fecha del export almacenado** para
     distinguir la copia vigente de futuras copias.
  4. **Verificar el artefacto almacenado:** que el fichero existe en la ubicación durable y **no está
     vacío** (tamaño > 0 / se abre como ZIP válido).
- **[R2] El ZIP de backup NO se versiona ni se adjunta al PR** (queda solo en la ubicación durable).
- Se documenta el mecanismo elegido, la ubicación/responsable/cadencia y la restauración (abajo) en
  este mismo runbook.

**[R2] Restauración (documentada, NO se ejecuta para cerrar MIS-21).** No presentar
`npx convex import --prod` como operación directa. Antes de una hipotética restauración real:
autorización explícita del usuario, **destino** confirmado (qué deployment), **modo de import**
(reemplazo vs merge; el flag de sobrescritura del tipo `--replace` **[R3] se confirmará contra la
herramienta disponible en el momento de autorizar la restauración**, no se da por hecho aquí), y
**copia previa del estado existente** (export del estado actual antes de importar, por si hay que
revertir). La restauración solo se ensaya/ejecuta si alguna vez hace falta de verdad, con su propia
autorización.

### Paso 4 · Documentar diferidos y cerrar
- **Monitorización de errores:** diferida a propósito (proyecto de aprendizaje). Se registra como
  decisión, no como deuda urgente.
- **Footgun del deploy manual de Convex** (olvidado 3× históricamente): mitigado **parcialmente** por
  el runbook canónico + el health gate 503. **[R2] Precisión:** el health gate solo comprueba la
  presencia de variables obligatorias — **NO detecta un backend Convex desactualizado** (funciones/env
  sin desplegar). La disciplina del runbook sigue siendo la salvaguarda real. Se menciona, no se
  cambia nada de código.
- **Footgun de fuentes en build-time** (Next descarga Google Fonts al construir → tumbó un deploy de
  Railway): candidato a **ticket propio** (auto-hospedar con `next/font/local`). Fuera de MIS-21.
- **Linear:** comentario de cierre con el estado real, resultados de verificación y decisiones de
  alcance; MIS-21 → **Done** con el PR (docs) enlazado.

**[R2] Deuda enviada a follow-up (tickets Backlog/Low al cierre, sin bloquear MIS-21):**
- Monitorización de errores (diferida por decisión de alcance).
- Auto-hospedar las fuentes para eliminar la dependencia de red en build.
- Automatización del deploy de Convex (el footgun histórico).
- QA en dispositivos reales y alta de usuarios reales (excluidos del MVP ligero; solo si el proyecto
  deja de ser de aprendizaje).

## Ficheros a tocar

- **Este fichero** (`PLANS/MIS-21-cierre-launch.md`) se convierte en el entregable vivo: checklist de
  verificación + runbook de backups + registro de diferidos, rellenado durante la ejecución.
- **Opcional:** una nota breve de backups en `README.md` (sección despliegue) apuntando aquí.
- **Sin cambios en `src/**` ni `convex/**`** → sin build/e2e afectados, **sin deploy de Convex**
  (salvo el paso 2 opcional, que es `convex run`, no `convex deploy`). El PR será **docs-only**.

## Verificación (cómo se comprueba que está hecho)

**[R2] Registro de evidencia:** cada verificación anota **fecha, autor y resultado**, y **NUNCA
incluye** cookies, contraseñas, hashes ni tokens (ni en este documento ni en Linear).

- **Paso 1:** mis `curl` en verde (evidencia pegada) + tú confirmas el smoke autenticado **por flujo**:
  (a) login por contraseña → `/panel`; (b) login Google → `/panel`; (c) recorrido core con el
  resultado funcional de cada operación (no solo "sin errores de consola").
- **Paso 2 (si se hace):** login con Carlos → `/pendientes`; `npx convex run auth:accountsPendingRotation --prod` → `[]`; y **decisión de retención resuelta** (cuenta eliminada, o conservada con responsable/contraseña registrados).
- **Paso 3 [R2 · M1]:** copia **durable** confirmada — **o** backup programado visible en el dashboard,
  **o** el ZIP de export guardado en ubicación durable (fuera del entorno de ejecución) con
  **ubicación + responsable + control de acceso + cadencia/próxima fecha** registrados y el artefacto
  verificado **existente y no vacío**. El ZIP no se versiona ni se adjunta al PR.
- **Paso 4:** MIS-21 en **Done** en Linear con el comentario de cierre y el PR docs enlazado; deudas
  (monitorización, fuentes, deploy Convex, QA/usuarios reales) registradas como follow-up por separado.

## Evidencia de ejecución

### Paso 1 · Verificación pública (`curl`) — ✅ (2026-08-18, por mí)
- **`/login`** → `HTTP 200`, `server: cloudflare`, `strict-transport-security: max-age=63072000; includeSubDomains`, CSP con `nonce-…` + `strict-dynamic`. ✅
- **`/api/health`** → `HTTP 200`, `x-frame-options: DENY`, **sin** CSP (exenta, correcto). ✅
- **Origen directo, IP cruda `69.46.46.113`:**
  - HTTP → `301` redirect a `https://mistu-monso.com/login` (redirección HTTP→HTTPS del edge de
    Railway; no sirve la app).
  - **HTTPS con SNI/host canónico (bypass Cloudflare)** → **`403`** = mecanismo A (MIS-288) vivo:
    sin `X-Origin-Auth` no sirve. ✅ Por Cloudflare el mismo request → `200`.
- **`/api/auth/google/start`** → `307` a Google con `redirect_uri=https://mistu-monso.com/api/auth/google/callback`
  (dominio canónico, MIS-264) y **`code_challenge_method=S256`** (PKCE, MIS-299). ✅

### Paso 1 · Smoke autenticado (navegador) — ✅ (2026-08-18, confirmado por el usuario)
- Login por **contraseña** (`mistumonso@gmail.com`) → aterriza en `/panel` (supervisor). ✅
- Login con **Google** (mismo email) → aterriza en `/panel`. ✅
- Recorrido core (Panel, Contactos crear/ver, Pendientes, Ventas) → correcto, sin errores. ✅
### Paso 2 · Cuenta Carlos (opcional) — ⏭️ NO se ejecuta (el usuario la salta; no necesaria para el cierre)

### Paso 3 · Backups — ✅ (2026-08-18) — DOS capas
- **Capa 1 — Backup de Convex (dashboard "Backup Now"):** snapshot creado `Backup from 18/8/2026
  15:11:11` (incluye file storage), retenido por Convex. **Caduca a los 7 días** (backups
  automáticos = PRO, no contratado → decisión consciente en proyecto de aprendizaje). Red de
  seguridad inmediata; re-ejecutar periódicamente.
- **Capa 2 — Export durable (no caduca):** `npx convex export --prod` → ZIP verificado **no vacío**
  (11 KB, 26 ficheros, todas las tablas: users, contacts, saleClosures, reminders, notes, sessions,
  etc.). Entregado al usuario y **guardado en su almacenamiento privado (carpeta "CRM")**.
  - **Responsable:** el usuario. **Cadencia:** mensual + antes de cambios grandes.
  - El ZIP **no se versiona ni se adjunta al PR**; contiene datos sensibles (hashes/sesiones) → solo
    en almacenamiento privado.

### Paso 4 · Cierre — ⏳ en curso
- **Follow-ups creados (Backlog/Low, relacionados con MIS-21):** **MIS-306** (monitorización de
  errores), **MIS-307** (auto-hospedar fuentes), **MIS-308** (automatizar deploy de Convex). QA en
  dispositivos reales / usuarios reales quedan **excluidos** del MVP ligero (documentado, sin ticket).
- **Pendiente:** PR docs mergeado + MIS-21 → Done con PR enlazado.

## Metodología / Gate

**Este plan NO es GO.** Ronda 1 = NO-GO (M1); ronda 2 con M1 y sugerencias aceptadas aplicadas
(**[R2]**), pendiente de ronda 2 de auditoría. No se crea rama, no se toca prod/dashboards/Convex
hasta un **GO explícito**. Al arrancar la ejecución, MIS-21 pasa a **In Progress**; rama propia + PR
docs contra `main`; "Done" = PR mergeado + enlazado + verificación hecha.

### [R2] Resolución de la ronda 1 (resumen para el auditor)
- **M1 (Major) — copia durable:** cerrado. El gate de backup ya no se satisface por la existencia
  inicial de un ZIP; exige almacenamiento durable fuera del entorno de ejecución + ubicación/
  responsable/control de acceso + cadencia/próxima fecha + verificación de artefacto no vacío (Paso 3).
- **Sug. media (restauración):** `import --prod` documentado con autorización/destino/modo/copia
  previa, y explícitamente NO se ejecuta para cerrar MIS-21 (Paso 3).
- **Sug. media (Carlos):** decisión de retención (eliminar vs conservar) fijada ANTES de crear la
  cuenta, con responsable/contraseña si se conserva (Paso 2).
- **Sug. media (datos de prueba):** contactos/ventas del recorrido se marcan o se limpian (Paso 1).
- **Sug. baja (evidencia por flujo / fecha-autor-resultado / sin secretos):** aplicado en Verificación.
- **Sug. baja (ZIP no versionado):** aplicado en Paso 3.
- **Coherencia health gate:** corregido el texto — el gate NO detecta un backend Convex desactualizado
  (Paso 4).

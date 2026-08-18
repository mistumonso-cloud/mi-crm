# MIS-294 · Código completo (autocontenido para auditoría)

**Ticket:** MIS-294 — Cerrar el origen con Cloudflare Tunnel (mecanismo B, defensa en profundidad
de 1A).
**Plan aprobado:** `PLANS/MIS-294-cloudflare-tunnel.md` (ronda 2 → **GO CONDICIONADO**, 2026-08-18).
**Rama:** `mistumonso/mis-294-seguridad-login-cerrar-el-origen-con-cloudflare-tunnel`.

> Este documento es **autocontenido**: no requiere abrir el repo ni ejecutar nada. Contiene el
> contenido íntegro del único fichero modificado (antes y después) y su diff completo.

---

## Alcance del código

MIS-294 es **infra en dashboards** (servicio `cloudflared` en Railway + Tunnel en Cloudflare Zero
Trust + eliminación del ingress público), ejecutada por runbook. **El único cambio en el repo** es
ligar el servidor Next a IPv6 para que el servicio sea alcanzable por la **red privada** de Railway
(`mi-crm.railway.internal`, que resuelve por IPv6 / `AAAA`). Sin esto, `cloudflared` no puede
alcanzar el origen por red privada.

- **No** hay cambios en `convex/` → **no hay deploy a Convex**.
- **No** hay cambios en código de aplicación (`src/**`) → e2e y build sin cambios funcionales.

### Justificación técnica del flag (verificado contra los docs de esta versión de Next)

- Next **16.2.10**. Docs `node_modules/next/dist/docs/01-app/03-api-reference/06-cli/next.md`,
  sección **`next start` options**:
  - `-H` o `--hostname <hostname>` — *Specify a hostname on which to start the application
    (default: 0.0.0.0)*.
  - `-p` o `--port <port>` — *(default: 3000, **env: PORT**)*. Railway inyecta `PORT`; por eso
    **no** se fija el puerto en el comando: `next start` lo toma del entorno.
- `next start` liga por defecto a `0.0.0.0` (**solo IPv4**). Ligar a `::` (IPv6) habilita la
  alcanzabilidad por la red privada de Railway; en Linux `::` es **dual-stack** (acepta también
  IPv4-mapped con `net.ipv6.bindv6only=0`, el valor por defecto), así que el edge público de
  Railway sigue funcionando durante la transición.
- `railway.json` invoca el script npm `start` (`"start": "next start"` en `package.json`).
  `npm run start -- -H ::` **reenvía** `-- -H ::` al script → efectivamente `next start -H ::`.
  Se mantiene la resolución del binario local de Next por npm y **no** se modifica `package.json`
  (así `npm run start` en local no cambia salvo que se le pasen args explícitos).

---

## Fichero modificado: `railway.json`

### Contenido ÍNTEGRO — ANTES

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "npm run build"
  },
  "deploy": {
    "startCommand": "npm run start",
    "healthcheckPath": "/api/health",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

### Contenido ÍNTEGRO — DESPUÉS

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "npm run build"
  },
  "deploy": {
    "startCommand": "npm run start -- -H ::",
    "healthcheckPath": "/api/health",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

### Diff unificado completo

```diff
diff --git a/railway.json b/railway.json
index a85f5d0..1b1d661 100644
--- a/railway.json
+++ b/railway.json
@@ -5,7 +5,7 @@
     "buildCommand": "npm run build"
   },
   "deploy": {
-    "startCommand": "npm run start",
+    "startCommand": "npm run start -- -H ::",
     "healthcheckPath": "/api/health",
     "restartPolicyType": "ON_FAILURE",
     "restartPolicyMaxRetries": 10
```

El resto del fichero (build, healthcheckPath, política de restart) queda **idéntico**. El
`healthcheckPath: "/api/health"` sigue siendo la sonda interna de Railway (exenta del secreto de
origen en `src/proxy.ts`), no afectada por el cambio de binding ni por el Tunnel.

---

## Verificación

- **JSON válido:** el fichero sigue siendo JSON bien formado (una sola línea cambia, sin comas ni
  llaves nuevas).
- **Build:** el flag `-H ::` es de **runtime** (`next start`), no de build; `npm run build` no se
  ve afectado.
- **App/e2e:** sin cambios en `src/**` ni `convex/**` → suite e2e y comportamiento funcional
  intactos.
- **Runtime (se comprueba en el runbook, gate G1 del plan):** tras el deploy, `next start` liga a
  `::` y `https://mistu-monso.com` sigue sirviendo público por el edge de Railway (aún sin Tunnel),
  confirmando que el dual-stack no rompe el ingress existente.

---

## Fuera de este PR (infra, por runbook del plan)

Servicio `cloudflared` (imagen fijada por digest, ≥2 réplicas), Tunnel + public hostname en
Cloudflare Zero Trust, hostname canario de prueba (G4a), evidencia de ruta Tunnel (G4b), rollback
DNS (G-Roll) y eliminación del ingress público (G5/G6). Todo ello está en
`PLANS/MIS-294-cloudflare-tunnel.md`. **Condición del GO (M4):** confirmar ≥2 réplicas + failover
real (G3-Fail), o aceptación explícita del SPOF, **antes del paso 6**.

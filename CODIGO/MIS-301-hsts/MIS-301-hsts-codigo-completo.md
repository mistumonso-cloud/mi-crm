# MIS-301 · HSTS completo (includeSubDomains) — Entrega de código (ronda 1)

> Plan de récord: `PLANS/MIS-301-hsts.md` (**GO CONDICIONADO** de auditoría de plan; condiciones A/B
> bakeadas en el Gate). **Documento autocontenido**: el auditor solo ve este texto. Incluye diffs
> literales, el spec nuevo íntegro, el **inventario autoritativo** que sostiene la decisión, y la
> evidencia de lint + e2e del spec. Effort: **high**. **No autoriza subir/mergear/desplegar.**

## 1. Alcance y contrato

Añade `includeSubDomains` a la cabecera HSTS. Valor final:
`Strict-Transport-Security: max-age=63072000; includeSubDomains` (2 años; **sin `preload`**, decisión
consciente por su casi-irreversibilidad). **Frontend-only**: no toca `convex/` → sin deploy de Convex;
Railway auto-despliega al mergear. **Sin cambio en Cloudflare** (su edge-HSTS sigue desactivado; el
origen es la fuente — §3).

## 2. Manifiesto

`find CODIGO/MIS-301-hsts -type f | LC_ALL=C sort`:
```
CODIGO/MIS-301-hsts/MIS-301-hsts-codigo-completo.md
CODIGO/MIS-301-hsts/e2e/hsts.spec.ts
CODIGO/MIS-301-hsts/next.config.ts
CODIGO/MIS-301-hsts/playwright.config.ts
```

| # | Fichero | Cambio |
|---|---------|--------|
| 1 | `next.config.ts` | valor HSTS `max-age=63072000` → `max-age=63072000; includeSubDomains` (+ comentario) |
| 2 | `playwright.config.ts` | registra `hsts.spec.ts` en `chromium-unauth` |
| 3 | `e2e/hsts.spec.ts` | **NUEVO** — 1 test (cardinalidad 1 + valor exacto, `headersArray()`) |

**No toca `convex/`** (ni `_generated`) → frontend-only.

## 3. Inventario autoritativo (evidencia de la decisión, M1) — verificado 2026-08-16

**Lista COMPLETA de registros DNS de Cloudflare** (captura DNS → Records, "6 of 6", íntegra — no
adivinada):

| Name | Type | Rol | ¿Host web (navegador)? |
|------|------|-----|------------------------|
| `mistu-monso.com` (apex) | CNAME (Proxied) | → `68d6ddbt.up.railway.app` | **SÍ — la única.** HTTPS vía Cloudflare |
| `send.mistu-monso.com` | MX | `feedback-smtp.eu-w…` | No — correo; sin A/AAAA/CNAME → no resuelve a web |
| `send.mistu-monso.com` | TXT | `v=spf1 include:amazon…` | No — SPF (correo) |
| `resend._domainkey…` | TXT | DKIM `p=MIGf…` | No — correo |
| `_dmarc…` | TXT | `v=DMARC1; p=none;` | No — correo |
| `_railway-verify…` | TXT | `railway-verify=…` | No — verificación Railway |

- **Solo el apex es host web**, y va por HTTPS. `send` es subdominio **solo de correo** (MX/SPF/DKIM);
  HSTS es política de navegador, no afecta a SMTP. Sin `www` (Cloudflare lo señala), **sin comodín `*`**,
  sin AAAA-only/CNAME/HTTPS-SVCB extra ni delegaciones NS. Sin Workers/Pages/Tunnels (aparecerían como
  registro/ruta; no hay). El usuario **aceptó explícitamente** el riesgo residual de subdominios
  desconocidos/futuros (mitigado por la invariante "HTTPS antes de DNS").

**Fuente de la cabecera = solo el origen** (descartadas otras, captura Cloudflare Rules + SSL/TLS):
- Edge-HSTS de Cloudflare **DESACTIVADO** ("Enable HSTS").
- Cloudflare Rules: única regla = "MIS-288 origin auth" (**Request** Header Transform, `X-Origin-Auth`);
  **"No Response Header Transform Rules created"** → nada toca la cabecera HSTS (de *response*). Sin URL
  Rewrite/Redirect/Configuration/Origin/Cache rules.
- ∴ el HSTS lo emite **solo `next.config.ts`** y Cloudflare lo reenvía. El smoke post-deploy (§6) lo
  confirma empíricamente: si tras el deploy la cabecera muestra `includeSubDomains`, el origen es la
  fuente; si no cambiara, habría un override en Cloudflare a investigar.

## 4. Diffs unificados (salida literal de `git diff HEAD`)

### 4.1 `next.config.ts`
```diff
diff --git a/next.config.ts b/next.config.ts
--- a/next.config.ts
+++ b/next.config.ts
@@ -20,9 +20,14 @@ const SECURITY_HEADERS = [
     key: "Permissions-Policy",
     value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
   },
-  // Sin includeSubDomains ni preload hasta inventariar subdominios (fase 3);
-  // también aquí, no solo en Cloudflare, para sobrevivir a un cambio de CDN.
-  { key: "Strict-Transport-Security", value: "max-age=63072000" },
+  // MIS-301: includeSubDomains añadido tras inventario AUTORITATIVO de la zona DNS
+  // (6/6 registros; solo el apex es web; `send` es correo; sin www ni comodín) y
+  // aceptación del usuario. preload NO (casi irreversible). Esta es la ÚNICA fuente
+  // del HSTS: Cloudflare tiene el edge-HSTS DESACTIVADO y ninguna Response Header
+  // Transform Rule lo toca (verificado 2026-08-16), así que Cloudflare la reenvía.
+  // includeSubDomains condiciona TODO subdominio presente y FUTURO: cualquier
+  // subdominio-web nuevo debe tener HTTPS válido ANTES de publicarse en DNS.
+  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
 ];
 
 const nextConfig: NextConfig = {
```
(Único cambio en el fichero: valor de la cabecera + comentario. `max-age` intacto en `63072000`; sin
`preload`; las demás cabeceras de `SECURITY_HEADERS` y el resto de `nextConfig` sin tocar.)

### 4.2 `playwright.config.ts`
```diff
diff --git a/playwright.config.ts b/playwright.config.ts
--- a/playwright.config.ts
+++ b/playwright.config.ts
@@ -70,7 +70,12 @@ export default defineConfig({
     {
       name: "chromium-unauth",
-      testMatch: ["google-auth.spec.ts", "legacy-cookie-migration.spec.ts", "csp-nonce.spec.ts"],
+      testMatch: [
+        "google-auth.spec.ts",
+        "legacy-cookie-migration.spec.ts",
+        "csp-nonce.spec.ts",
+        "hsts.spec.ts",
+      ],
       use: { ...devices["Desktop Chrome"] },
     },
```

## 5. Fichero NUEVO — contenido íntegro literal: `e2e/hsts.spec.ts`
```ts
// MIS-301: HSTS completo (includeSubDomains). Corre en "chromium-unauth" (sin
// sesión) y usa el fixture `request` (HTTP crudo) para inspeccionar la cabecera de
// respuesta. `next.config.ts` `headers()` emite el HSTS con independencia del
// entorno (los navegadores lo ignoran sobre http/localhost, pero la CABECERA se
// envía y es inspeccionable), así que `npm run dev` ya la sirve.
//
// Fija el contrato exacto con `headersArray()` (no `headers()`, que combinaría
// duplicados en un solo valor): debe existir EXACTAMENTE UNA cabecera HSTS.
import { test, expect } from "@playwright/test";

test.describe("HSTS (MIS-301)", () => {
  test("exactamente UNA cabecera Strict-Transport-Security = max-age=2años + includeSubDomains, sin preload", async ({
    request,
  }) => {
    const res = await request.get("/login");
    const hsts = res
      .headersArray()
      .filter((h) => h.name.toLowerCase() === "strict-transport-security");
    expect(hsts.length, "debe haber EXACTAMENTE una cabecera HSTS").toBe(1);
    expect(hsts[0].value).toBe("max-age=63072000; includeSubDomains");
    // Decisión consciente: preload FUERA (casi irreversible). Redundante con el
    // toBe anterior, pero deja explícita la intención.
    expect(hsts[0].value).not.toContain("preload");
  });
});
```

## 6. Evidencia (lint + e2e) y verificación restante

### 6.1 Ya ejecutado
- `npm run lint` → **0 errores** (1 warning preexistente ajeno en `Avatar.jsx`).
- `npx playwright test hsts --project=chromium-unauth` → **1 passed**:
  ```
  ✓  HSTS (MIS-301) › exactamente UNA cabecera Strict-Transport-Security = max-age=2años + includeSubDomains, sin preload
  1 passed
  ```
  (Confirma en dev: una sola cabecera HSTS con valor exacto.)

### 6.2 Tras GO de esta auditoría
1. Instalar byte-idéntico (ya coincide: `diff -q` CODIGO ↔ repo OK, 3/3).
2. `npm run lint` / `npm run build` / **suite e2e completa** (regresión).
3. PR (permiso antes del push) → CI verde.
4. **[CONDICIÓN A del GO de plan] Re-inventario autoritativo JUSTO antes del merge** (usuario; DNS/
   Cloudflare son estado mutable): DNS sigue mostrando **"6 of 6"** con los mismos 6 registros (solo el
   apex como host web), sin comodín/delegaciones, sin Workers/Pages/Tunnels, edge-HSTS off y sin
   Response Header Transform Rule de HSTS. Si aparece un host web nuevo → **DETENER** hasta validar su
   HTTPS. Guardar fecha+captura junto al PR.
5. Merge (con permiso) → Railway auto-despliega (frontend-only, **sin Convex**).
6. **[CONDICIÓN B del GO de plan] Smoke productivo AUTOMÁTICO** (usuario; fichero temporal, se borra):
   ```
   headers="$(mktemp)"
   curl -sS -D "$headers" -o /dev/null https://mistu-monso.com/login
   test "$(grep -ci '^strict-transport-security:' "$headers")" -eq 1     # una sola cabecera
   grep -qi '^strict-transport-security: max-age=63072000; includeSubDomains\r\?$' "$headers"  # valor exacto
   rm -f "$headers"
   ```
   (Secundario cacheable: `hstspreload.org` — desaparece "No includeSubDomains"; "No preload" persiste.)

## 7. Greps reproducibles (salida literal del shell)

Valor HSTS efectivo (una sola definición, con `includeSubDomains`, sin `preload` en el valor):
```
$ grep -n "Strict-Transport-Security" next.config.ts
30:  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
```
Registro del spec en `chromium-unauth`:
```
$ grep -n "hsts.spec.ts" playwright.config.ts
77:        "hsts.spec.ts",
```
La palabra `preload` en el spec aparece **3 veces** — SOLO en el nombre del test y en la aserción
`not.toContain("preload")` / su comentario (ninguna la EMITE; el valor exacto lo fija el `toBe(...)`):
```
$ grep -c "preload" e2e/hsts.spec.ts
3
```
El cambio NO toca `convex/` (0 ficheros):
```
$ grep -rl "Strict-Transport\|hsts" convex 2>/dev/null | wc -l
0
```

## 8. Mapa a la lista de la auditoría de plan §8
1. **Diff exacto de `next.config.ts`** → §4.1.
2. **Spec completo con `headersArray()` y cardinalidad uno** → §5 (`hsts.length === 1` + valor exacto).
3. **Registro del spec en `chromium-unauth`** → §4.2.
4. **Manifiesto sin cambios adicionales ni `convex/`** → §2 (3 ficheros; ninguno bajo `convex/`; §7 grep vacío).
5. **Evidencia del inventario repetido justo antes del deploy** → §6.2 paso 4 (CONDICIÓN A, en el Gate).
6. **Smoke productivo con cardinalidad y valor exactos** → §6.2 paso 6 (CONDICIÓN B, automatizado).

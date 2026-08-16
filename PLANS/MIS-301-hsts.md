# MIS-301 · HSTS completo (includeSubDomains)

> Dividido de MIS-293 (Fase 3 — Higiene). Plan de récord, **ronda 2** (tras auditoría de plan NO-GO por
> M1/M2). **NO autoriza instalar/mergear/desplegar** — ver "Gate".
>
> **Correcciones ronda 2 (§8 de la auditoría):**
> 1. **M1** — inventario de subdominios ahora **autoritativo** (lista completa de DNS de Cloudflare, no
>    adivinando nombres) + **aceptación explícita del usuario** del riesgo residual. Además se descartó
>    otra fuente de la cabecera (Cloudflare Rules).
> 2. **M2** — documentado el **rollback real** (`max-age=0` + esperar), el riesgo residual de política
>    almacenada, y la **invariante operativa** (todo subdominio-web nuevo con HTTPS antes de publicarlo).
> 3. **Media/Baja** — e2e con `headersArray()` exigiendo **una sola** cabecera HSTS; smoke principal por
>    `curl` directo HTTPS (hstspreload/securityheaders como secundario); ticket **MIS-304** abierto para
>    "Always Use HTTPS"; documentado que `includeSubDomains` condiciona también subdominios futuros.

## 0. Decisión consciente + aceptación del riesgo (M1)

**Elegido por el usuario: `includeSubDomains` SÍ, `preload` NO.** El usuario, con el inventario delante
(§1), **aceptó explícitamente** activar `includeSubDomains` asumiendo: (1) hoy no rompe nada; (2) todo
subdominio-web nuevo deberá tener HTTPS antes de publicarlo en DNS; (3) revertir no es instantáneo (§3).
- **`preload` NO**: casi irreversible (retirarse tarda meses/años; compromete HTTPS en apex + todo
  subdominio presente y futuro para siempre). La propia `hstspreload.org` lo **desaconseja** salvo
  necesidad. Follow-up, decisión aparte.

## 1. Inventario autoritativo (M1) — verificado 2026-08-16

**Fuente autoritativa: lista completa de registros DNS de Cloudflare** (captura DNS → Records, "6 of 6",
lista íntegra, no adivinada):

| Name | Type | Contenido / rol | ¿Web visitable por navegador? |
|------|------|-----------------|-------------------------------|
| `mistu-monso.com` (apex) | CNAME (Proxied) | → `68d6ddbt.up.railway.app` | **SÍ — la única.** HTTPS vía Cloudflare |
| `send.mistu-monso.com` | MX | `feedback-smtp.eu-w…` | No — correo (SMTP), sin A/AAAA/CNAME → no resuelve a web |
| `send.mistu-monso.com` | TXT | `v=spf1 include:amazon…` | No — SPF (correo) |
| `resend._domainkey…` | TXT | `p=MIGf…` | No — DKIM (correo) |
| `_dmarc…` | TXT | `v=DMARC1; p=none;` | No — DMARC (correo) |
| `_railway-verify…` | TXT | `railway-verify=…` | No — verificación de Railway |

- **Solo el apex es un host web**, y va por HTTPS (proxied). `send` es un subdominio **solo de correo**
  (MX/SPF/DKIM); HSTS es una política de **navegador**, no afecta a SMTP → el correo no se ve afectado.
  El resto son registros TXT de validación (no hosts).
- **Sin `www`** (Cloudflare lo señala en "Recommendations": "Visitors cannot reach www…"), **sin
  comodín `*`**, sin registros AAAA-only/CNAME/HTTPS-SVCB adicionales ni delegaciones NS. La lista
  "6 of 6" es exhaustiva.
- **Sin Workers/Pages/Tunnels/custom hostnames** propios: cualquiera de ellos aparecería como registro
  DNS o ruta; no hay ninguno más allá de los 6 (plan Free, sin Workers configurados).
- **Riesgo residual (aceptado por el usuario):** un subdominio-web **desconocido o futuro** sin HTTPS
  quedaría inaccesible. Mitigado por la invariante de §3.

**Fuente de la cabecera HSTS = solo el origen (descartadas otras):**
- Cloudflare **edge HSTS DESACTIVADO** (captura SSL/TLS → Edge Certificates: botón "Enable HSTS").
- Cloudflare **Rules**: única regla activa = "MIS-288 origin auth" (**Request** Header Transform,
  `X-Origin-Auth`); **"No Response Header Transform Rules created"** → ninguna regla toca la cabecera
  HSTS (que es de *response*). Sin URL Rewrite/Redirect/Configuration/Origin/Cache rules.
- ∴ la cabecera `Strict-Transport-Security` que ve el navegador la emite **solo `next.config.ts`
  (`headers()`)** y Cloudflare la reenvía → el cambio de código es la fuente efectiva (lo confirma el
  smoke de §4).

## 2. Diseño

### `next.config.ts` — añadir `includeSubDomains` (único cambio de código)
```diff
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
```
`max-age` se mantiene en `63072000` (2 años). Sin `preload`. Ningún otro cambio.

## 3. Rollback real e invariante operativa (M2)

`includeSubDomains` **no se revierte al instante** quitando la directiva: un navegador que ya recibió
`max-age=63072000; includeSubDomains` mantiene esa política hasta su vencimiento (≤ 2 años). Rollback
real si apareciera un subdominio-web sin HTTPS:
1. Servir desde el **apex por HTTPS** la cabecera `Strict-Transport-Security: max-age=0` (cambio en
   `next.config.ts`, mismo flujo frontend-only) — instruye a los navegadores a **borrar** la política.
2. Mantenerlo el tiempo operativo necesario para que los clientes **revisiten el apex** y la borren.
3. Corregir el HTTPS del subdominio afectado.
4. Restablecer luego el HSTS (apex-only o con includeSubDomains).

**Riesgo residual:** los clientes que no revisiten el apex conservan la política anterior hasta que
caduque. No es comparable a `preload` (irreversible), pero **no es instantáneo**.
*(Alternativa menos contundente: servir temporalmente HSTS **apex-only** —`max-age=63072000` sin
`includeSubDomains`— en vez de `max-age=0`; deja de forzar HTTPS en subdominios sin borrar la política
del apex. `max-age=0` es lo más contundente pero elimina también la del apex durante ese periodo.)*

**Invariante operativa (a respetar siempre):** **todo subdominio-web nuevo debe tener HTTPS válido antes
de publicar su registro DNS.** (Candidato a automatización/monitorización → follow-up.)

## 4. Verificación

### E2E nuevo — `e2e/hsts.spec.ts` (project `chromium-unauth`, sin sesión)
Usa `headersArray()` para exigir **exactamente una** cabecera HSTS con el valor exacto (no basta el
valor combinado de `headers()`). `next.config.ts` `headers()` emite la cabecera en cualquier entorno
(los navegadores la ignoran sobre http/localhost, pero **se envía** y es inspeccionable):
```ts
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
    expect(hsts[0].value).not.toContain("preload"); // decisión consciente: preload fuera
  });
});
```
Registrar `"hsts.spec.ts"` en `chromium-unauth.testMatch` de `playwright.config.ts`.

### Resto
`npm run lint` (0 err), `npm run build`, suite e2e completa (regresión). **No toca `convex/`**.

### Smoke de prod (lo hace el usuario; esta máquina no alcanza mistu-monso.com — [[project_crm_prod_domain]])
**Principal — `curl` directo por HTTPS mostrando TODAS las cabeceras** (evita el cacheo de
hstspreload/securityheaders y prueba el binding real):
```
curl -sS -D - -o /dev/null https://mistu-monso.com/login | grep -i "strict-transport-security"
```
Debe salir **una sola** línea con `strict-transport-security: max-age=63072000; includeSubDomains`.
Esto **también confirma la fuente efectiva**: si tras el deploy la cabecera muestra `includeSubDomains`,
el origen es la fuente (como se dedujo en §1); si NO cambiara, habría un override en Cloudflare
(Rules/Workers) que investigar. **Secundario** (cacheable): recargar
`hstspreload.org/?domain=mistu-monso.com` → el error "No includeSubDomains directive" desaparece (el de
"No preload" persiste, esperado). Aceptación: la app sigue cargando con normalidad.

## 5. Despliegue

**Frontend-only** (`next.config.ts` + `e2e/hsts.spec.ts` + `playwright.config.ts`). **No toca
`convex/`** → auto-deploy solo del frontend por Railway al mergear, **sin `npx convex deploy`**. **Sin
cambio en Cloudflare** (edge-HSTS sigue desactivado; el origen es la fuente).

## 6. Gate (metodología estricta) — con condiciones del GO de plan

Este plan **NO** autoriza instalar/mergear/desplegar. Flujo: código (effort **high**) → entrega
autocontenida en `CODIGO/MIS-301-hsts/` (diffs `diff -u` completos + spec nuevo íntegro + inventario
autoritativo §1 embebido como evidencia) → **auditoría de código externa** (GO/NO-GO; un GO CONDICIONADO
también es GO) → instalar byte-idéntico → lint/build/e2e verdes → PR (**permiso antes del push**) → CI
verde → **[CONDICIÓN A] re-inventario autoritativo JUSTO ANTES del merge** → merge (asistente, con
permiso) → Railway auto-despliega → **[CONDICIÓN B] smoke productivo automatizado** (usuario) +
aceptación → cerrar MIS-301.

**[CONDICIÓN A del GO] Re-inventario autoritativo inmediatamente antes del merge/deploy** (DNS y
Cloudflare son estado mutable; el HSTS quedará almacenado hasta 2 años). Lo hace el usuario (esta
máquina no accede a Cloudflare) y me pega el resultado; **si aparece cualquier host web nuevo, se
DETIENE** hasta validar su HTTPS:
1. Reabrir **DNS → Records** y confirmar que **sigue mostrando "6 of 6"** con los mismos 6 registros
   (solo el apex como host web), **sin comodín `*`** ni delegaciones NS nuevas.
2. Confirmar que **no** aparecieron **Workers/Pages/Tunnels/custom hostnames**.
3. Confirmar que **edge-HSTS** sigue desactivado y que **no** hay **Response Header Transform Rule** que
   añada HSTS.
- Se guarda **fecha + captura** del inventario final junto al PR (Baja, para auditorías futuras).

**[CONDICIÓN B del GO] Smoke productivo AUTOMÁTICO** (no solo visual), tras el auto-deploy — lo corre el
usuario en un terminal/dispositivo que alcance prod:
```
headers="$(mktemp)"
curl -sS -D "$headers" -o /dev/null https://mistu-monso.com/login
test "$(grep -ci '^strict-transport-security:' "$headers")" -eq 1 && echo "OK: una sola cabecera HSTS" || echo "FALLO: cardinalidad != 1"
grep -qi '^strict-transport-security: max-age=63072000; includeSubDomains\r\?$' "$headers" && echo "OK: valor exacto" || echo "FALLO: valor inesperado"
rm -f "$headers"
```
Ambas comprobaciones deben dar OK. (Secundario cacheable: `hstspreload.org` — el error "No
includeSubDomains" desaparece; "No preload" persiste, esperado.)

## 7. Follow-ups (fuera de alcance de MIS-301)
- **`preload`**: decisión aparte por su irreversibilidad (requiere `includeSubDomains` ya + `preload` +
  submit en `hstspreload.org`).
- **HSTS de borde en Cloudflare** (belt-and-suspenders): activarlo con los mismos valores daría una 2ª
  fuente si el origen se reconfigurara. No necesario ahora; duplicaría.
- **MIS-304** (creado): Cloudflare "Always Use HTTPS" está desactivado — evaluar activarlo (cubre la 1ª
  visita; ojo a bucles de redirección con el origen).
- **Monitorización/automatización** que impida publicar un subdominio-web en DNS sin HTTPS válido
  (soporte de la invariante de §3).

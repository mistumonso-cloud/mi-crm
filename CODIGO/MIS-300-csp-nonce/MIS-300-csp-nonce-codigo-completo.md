# MIS-300 · CSP con nonce por petición (completa M2) — Entrega de código (ronda 1)

> Plan de récord: `PLANS/MIS-300-csp-nonce.md` (**GO** de auditoría de plan, ronda 2). **Documento
> autocontenido**: el auditor solo ve este texto. Incluye diffs literales, el fichero nuevo íntegro, y
> la **salida literal del build** y de los e2e (evidencia de que el render dinámico global y el nonce
> funcionan de verdad). Effort: **high**. **No autoriza subir/mergear/desplegar.**

## 1. Alcance y contrato

Completa **M2**: mueve la CSP de `next.config.ts` (estática, `script-src 'unsafe-inline'`) a
`src/proxy.ts`, que la emite **por petición con un nonce fresco**. Único directivo que cambia:
`script-src` pierde `'unsafe-inline'` y pasa a `'self' 'nonce-<n>' 'strict-dynamic'` (+`'unsafe-eval'`
solo fuera de producción). `style-src` **mantiene** `'unsafe-inline'` (atributos `style={{}}`; el nonce
no cubre atributos de estilo). Beneficio: un `<script>` inline inyectado por XSS no se ejecuta sin el
nonce del request.

**Precondición estructural (M1 de la auditoría de plan):** el nonce por petición SOLO funciona con
render dinámico — una página prerenderizada en build se generó sin el nonce, así que sus `<script>` no
lo llevan y el navegador los bloquea. Se fuerza render dinámico **global** con `await connection()` en
el root layout (mecanismo de este Next 16), verificado por el build: **ninguna** ruta queda estática.

**Decisión de producto: GO** (usuario) — coste ~nulo (ya todo dinámico salvo `/_not-found`, sin PPR).
**Frontend-only**: no toca `convex/` → sin deploy de Convex; Railway auto-despliega al mergear.

## 2. Manifiesto

`find CODIGO/MIS-300-csp-nonce -type f | LC_ALL=C sort` (sin filtro de extensión):
```
CODIGO/MIS-300-csp-nonce/MIS-300-csp-nonce-codigo-completo.md
CODIGO/MIS-300-csp-nonce/e2e/csp-nonce.spec.ts
CODIGO/MIS-300-csp-nonce/next.config.ts
CODIGO/MIS-300-csp-nonce/playwright.config.ts
CODIGO/MIS-300-csp-nonce/src/app/layout.tsx
CODIGO/MIS-300-csp-nonce/src/proxy.ts
```

| # | Fichero | Cambio |
|---|---------|--------|
| 1 | `src/app/layout.tsx` | root layout `async` + `await connection()` (fuerza render dinámico global, M1) |
| 2 | `src/proxy.ts` | + `buildCsp(nonce, isProd)`; import `randomBytes`; nonce+CSP en request/response en la ruta de éxito |
| 3 | `next.config.ts` | retira la CSP estática (const + `IS_PRODUCTION` + entrada del header); conserva las demás cabeceras |
| 4 | `playwright.config.ts` | registra `csp-nonce.spec.ts` en `chromium-unauth` |
| 5 | `e2e/csp-nonce.spec.ts` | **NUEVO** — 4 tests |

**No toca `convex/`** (ni `_generated`) → **frontend-only**, sin deploy de Convex.

## 3. Diffs unificados (salida literal de `git diff HEAD`)

### 3.1 `src/app/layout.tsx`
```diff
diff --git a/src/app/layout.tsx b/src/app/layout.tsx
--- a/src/app/layout.tsx
+++ b/src/app/layout.tsx
@@ -1,4 +1,5 @@
 import type { Metadata } from "next";
+import { connection } from "next/server";
 import { Inter, JetBrains_Mono } from "next/font/google";
 import "./globals.css";
 
@@ -19,11 +20,18 @@ export const metadata: Metadata = {
   description: "CRM minimalista para pequeños negocios de ventas digitales.",
 };
 
-export default function RootLayout({
+export default async function RootLayout({
   children,
 }: Readonly<{
   children: React.ReactNode;
 }>) {
+  // MIS-300 (M2): el nonce por petición (CSP en src/proxy.ts) exige render
+  // dinámico: una página prerenderizada en build se generó sin conocer el nonce,
+  // así que sus <script> no lo llevan y el navegador los bloquea. connection()
+  // corta el prerender de TODO el árbol (incluida la not-found por defecto), que
+  // pasa a renderizarse por petición con el nonce del proxy. Ver
+  // node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md.
+  await connection();
   return (
     <html
       lang="es"
```

### 3.2 `src/proxy.ts`
```diff
diff --git a/src/proxy.ts b/src/proxy.ts
--- a/src/proxy.ts
+++ b/src/proxy.ts
@@ -1,6 +1,6 @@
 import { NextResponse } from "next/server";
 import type { NextRequest } from "next/server";
-import { createHash, timingSafeEqual } from "node:crypto";
+import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
 import { SESSION_COOKIE_NAME } from "./lib/auth/constants";
 
@@ -42,6 +42,29 @@ function isCookieGated(pathname: string): boolean {
   );
 }
 
+// MIS-300 (M2): CSP con nonce por petición. Único directivo que cambia frente a
+// la CSP estática anterior (que vivía en next.config.ts): `script-src` pierde
+// 'unsafe-inline' y pasa a 'nonce-<n>' 'strict-dynamic'. `style-src` MANTIENE
+// 'unsafe-inline' porque la app usa atributos style={{}} por todas partes y el
+// nonce no cubre atributos de estilo. En desarrollo React/Next usan eval (HMR,
+// overlay), así que fuera de producción se añade 'unsafe-eval'. `'strict-dynamic'`
+// deja que el script de arranque de Next (que lleva el nonce) cargue sus chunks
+// sin allowlist de host; `'self'` queda como fallback para navegadores CSP2.
+function buildCsp(nonce: string, isProd: boolean): string {
+  return [
+    "default-src 'self'",
+    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isProd ? "" : " 'unsafe-eval'"}`,
+    "style-src 'self' 'unsafe-inline'",
+    "img-src 'self' data:",
+    "font-src 'self' data:",
+    "connect-src 'self' https://*.convex.cloud wss://*.convex.cloud",
+    "frame-ancestors 'none'",
+    "base-uri 'self'",
+    "form-action 'self'",
+    "object-src 'none'",
+  ].join("; ");
+}
+
 // Comparación en tiempo constante y de longitud fija: hasheamos ambos lados con
 // SHA-256 antes de timingSafeEqual, así no se filtra la longitud del secreto ni
 // puede lanzar por longitudes distintas. Node runtime está garantizado en
@@ -112,7 +135,19 @@ export function proxy(request: NextRequest) {
     return res;
   }
 
-  return NextResponse.next();
+  // MIS-300 (M2): ruta de éxito → emite un nonce fresco y la CSP en las cabeceras
+  // del REQUEST (Next extrae 'nonce-…' de ahí y lo inyecta en sus <script> durante
+  // el SSR) y del RESPONSE (para el navegador). Requiere render dinámico global
+  // (await connection() en src/app/layout.tsx). Las salidas tempranas de arriba
+  // (health/503/403/redirect) no llevan nonce a propósito: no son HTML de app.
+  const nonce = randomBytes(16).toString("base64");
+  const csp = buildCsp(nonce, process.env.NODE_ENV === "production");
+  const requestHeaders = new Headers(request.headers);
+  requestHeaders.set("x-nonce", nonce);
+  requestHeaders.set("content-security-policy", csp);
+  const response = NextResponse.next({ request: { headers: requestHeaders } });
+  response.headers.set("content-security-policy", csp);
+  return response;
 }
```
Contexto (sin cambios): antes de este bloque están las salidas tempranas — `/api/health` GET/HEAD →
`NextResponse.next()`; en producción, 503 si faltan env vars, 403 si el origen/host no valida; y el
redirect cookie-gated → `/login` con `res.cookies.set("session","",{maxAge:0})`. **Ninguna** de esas
lleva el nonce (no son HTML de app). El `matcher` (`["/((?!_next/static|favicon.ico).*)"]`) no cambia.

### 3.3 `next.config.ts`
```diff
diff --git a/next.config.ts b/next.config.ts
--- a/next.config.ts
+++ b/next.config.ts
@@ -1,43 +1,18 @@
 import type { NextConfig } from "next";
 
-// MIS-288 (1A.7 + 1A.2): cabeceras de seguridad, CSP y desactivación del
-// optimizador de imágenes.
-
-// CSP de fase 1. Lo que arregla de verdad es el CLICKJACKING (frame-ancestors
-// 'none'): /login y el paso del código OTP dejan de ser embebibles.
-//
-// `script-src` conserva 'unsafe-inline' porque sin nonce Next no arranca sus
-// scripts de bootstrap; `style-src` también, porque la app usa atributos
-// style={{…}} por todas partes y el nonce no cubre atributos de estilo. El
-// endurecimiento real de script-src (CSP con nonce en proxy.ts) es fase 3 —
-// desactiva la optimización estática y es incompatible con PPR.
+// MIS-288 (1A.7 + 1A.2): cabeceras de seguridad y desactivación del optimizador
+// de imágenes.
 //
-// `connect-src` incluye Convex porque ConvexClientProvider sigue montado en
-// esta fase (aunque nada del navegador lo use); la fase 3 lo retira y entonces
-// connect-src puede estrecharse a 'self'.
-// `next dev` sirve con NODE_ENV="development"; `next start` (Railway) con
-// "production". React y el runtime de dev de Next usan eval (HMR, overlay de
-// errores), así que en desarrollo hace falta 'unsafe-eval' o se rompe la
-// interactividad de cliente. En PRODUCCIÓN no se incluye — CSP más estricta,
-// tal como documenta la guía de CSP de Next.
-const IS_PRODUCTION = process.env.NODE_ENV === "production";
-
-const CONTENT_SECURITY_POLICY = [
-  "default-src 'self'",
-  `script-src 'self' 'unsafe-inline'${IS_PRODUCTION ? "" : " 'unsafe-eval'"}`,
-  "style-src 'self' 'unsafe-inline'",
-  "img-src 'self' data:",
-  "font-src 'self' data:",
-  "connect-src 'self' https://*.convex.cloud wss://*.convex.cloud",
-  "frame-ancestors 'none'",
-  "base-uri 'self'",
-  "form-action 'self'",
-  "object-src 'none'",
-].join("; ");
+// MIS-300 (M2, fase 3): la Content-Security-Policy YA NO vive aquí. Se movió a
+// `src/proxy.ts`, que la emite POR PETICIÓN con un nonce fresco (`script-src`
+// pierde 'unsafe-inline' y pasa a 'nonce-<n>' 'strict-dynamic'). Fijarla también
+// aquí crearía DOS cabeceras CSP y el navegador aplicaría su intersección,
+// rompiendo la app. Estas cabeceras restantes NO llevan nonce, así que se quedan
+// como estáticas (aplican a toda respuesta que sirve Next vía headers()).
 
 const SECURITY_HEADERS = [
-  { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
-  // Redundante con frame-ancestors, cubre navegadores viejos.
+  // Redundante con frame-ancestors (que ahora vive en la CSP del proxy), cubre
+  // navegadores viejos y respuestas sin CSP.
   { key: "X-Frame-Options", value: "DENY" },
   { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
   { key: "X-Content-Type-Options", value: "nosniff" },
```
(Sin más cambios en `next.config.ts`: `SECURITY_HEADERS` conserva Referrer-Policy, X-Content-Type-Options,
Permissions-Policy y **Strict-Transport-Security** — HSTS es MIS-301, no se toca; `images.unoptimized`
y `experimental.serverActions.allowedOrigins` intactos.)

### 3.4 `playwright.config.ts`
```diff
diff --git a/playwright.config.ts b/playwright.config.ts
--- a/playwright.config.ts
+++ b/playwright.config.ts
@@ -70,7 +70,7 @@ export default defineConfig({
     {
       name: "chromium-unauth",
-      testMatch: ["google-auth.spec.ts", "legacy-cookie-migration.spec.ts"],
+      testMatch: ["google-auth.spec.ts", "legacy-cookie-migration.spec.ts", "csp-nonce.spec.ts"],
       use: { ...devices["Desktop Chrome"] },
     },
```

## 4. Fichero NUEVO — contenido íntegro literal: `e2e/csp-nonce.spec.ts`
```ts
// MIS-300 (M2): CSP con nonce por petición. Corre en "chromium-unauth" (sin
// sesión) y usa el fixture `request` (HTTP crudo, sin ejecutar JS) para inspeccionar
// la CABECERA CSP y el HTML servido por el servidor.
//
// Verifica que el proxy emite una CSP con nonce fresco cuyo `script-src` no lleva
// 'unsafe-inline', y que Next inyecta ese MISMO nonce en todos sus <script>
// ejecutables — tanto en una ruta dinámica (/login) como en una 404: esto último
// prueba que el render dinámico global (await connection() en el root layout)
// alcanza también la not-found por defecto (si siguiera estática, su HTML no
// tendría el nonce del request y no coincidiría).
//
// LÍMITE (dev): el e2e corre con `npm run dev` (NODE_ENV != production), donde
// `script-src` incluye además 'unsafe-eval'; su AUSENCIA es prod-only y se cubre
// con el build + el smoke de producción, no aquí.
import { test, expect } from "@playwright/test";

// Devuelve el token-list del directivo pedido. Tolerante a espacios repetidos y a
// mayúsculas/minúsculas en el NOMBRE del directivo (parseo por directiva, no regex
// global: así `style-src 'unsafe-inline'` no se confunde con `script-src`).
function directiveTokens(csp: string, directive: string): string[] | null {
  for (const part of csp.split(";")) {
    const trimmed = part.trim().replace(/\s+/g, " ");
    if (!trimmed) continue;
    const [name, ...tokens] = trimmed.split(" ");
    if (name.toLowerCase() === directive.toLowerCase()) return tokens;
  }
  return null;
}

// Nonce del directivo `script-src` (alfabeto base64 completo, incl. + / =).
function nonceFromScriptSrc(csp: string): string {
  const tokens = directiveTokens(csp, "script-src");
  expect(tokens, "la CSP debe tener un directivo script-src").not.toBeNull();
  const tok = tokens!.find((t) => /^'nonce-[A-Za-z0-9+/=]+'$/.test(t));
  expect(tok, "script-src debe llevar un 'nonce-…'").toBeTruthy();
  return tok!.slice("'nonce-".length, -1);
}

// Debe haber EXACTAMENTE una cabecera CSP (detecta que la CSP estática de
// next.config.ts no sobrevivió y que no hay doble política).
function singleCsp(headersArray: { name: string; value: string }[]): string {
  const csps = headersArray.filter((h) => h.name.toLowerCase() === "content-security-policy");
  expect(csps.length, "debe existir EXACTAMENTE una cabecera Content-Security-Policy").toBe(1);
  return csps[0].value;
}

// <script> EJECUTABLES del HTML (excluye los de datos, p.ej. type="application/json").
function executableScriptTags(html: string): string[] {
  return (html.match(/<script\b[^>]*>/gi) ?? []).filter(
    (tag) => !/\btype\s*=\s*"[^"]*json[^"]*"/i.test(tag),
  );
}

// Comprueba: al menos un <script> ejecutable (no vacío), cada uno con EXACTAMENTE
// un nonce, todos iguales al del header, y ninguno con un nonce distinto.
function expectAllScriptsCarryNonce(html: string, headerNonce: string): void {
  const tags = executableScriptTags(html);
  expect(tags.length, "debe haber al menos un <script> ejecutable").toBeGreaterThan(0);
  for (const tag of tags) {
    const matches = [...tag.matchAll(/\bnonce="([^"]*)"/gi)];
    expect(matches.length, `un <script> sin (o con más de un) nonce: ${tag}`).toBe(1);
    expect(matches[0][1]).toBe(headerNonce);
  }
}

test.describe("CSP con nonce por petición (MIS-300)", () => {
  test("/login: script-src con nonce+strict-dynamic sin unsafe-inline; todos los <script> con el nonce", async ({
    request,
  }) => {
    const res = await request.get("/login");
    expect(res.status()).toBe(200);

    const csp = singleCsp(res.headersArray());
    const tokens = directiveTokens(csp, "script-src")!;
    expect(tokens).toContain("'strict-dynamic'");
    expect(tokens).not.toContain("'unsafe-inline'");
    // El nonce va en la CSP y en el HTML, NO como cabecera de respuesta suelta.
    expect(res.headers()["x-nonce"]).toBeUndefined();

    const headerNonce = nonceFromScriptSrc(csp);
    expectAllScriptsCarryNonce(await res.text(), headerNonce);
  });

  test("404 not-found: dinámica y con nonce coherente (M1)", async ({ request }) => {
    const res = await request.get("/__e2e_csp_missing_mis300");
    expect(res.status()).toBe(404);

    const csp = singleCsp(res.headersArray());
    const tokens = directiveTokens(csp, "script-src")!;
    expect(tokens).toContain("'strict-dynamic'");
    expect(tokens).not.toContain("'unsafe-inline'");

    const headerNonce = nonceFromScriptSrc(csp);
    // Si la not-found siguiera prerenderizada estática, su HTML no traería el
    // nonce de ESTE request y esta aserción fallaría.
    expectAllScriptsCarryNonce(await res.text(), headerNonce);
  });

  test("frescura: dos peticiones → nonces distintos, cada header coincide con SU html", async ({
    request,
  }) => {
    const r1 = await request.get("/login");
    const r2 = await request.get("/login");
    const n1 = nonceFromScriptSrc(singleCsp(r1.headersArray()));
    const n2 = nonceFromScriptSrc(singleCsp(r2.headersArray()));
    expect(n1).not.toBe(n2);
    expectAllScriptsCarryNonce(await r1.text(), n1);
    expectAllScriptsCarryNonce(await r2.text(), n2);
  });

  test("/api/health (salida temprana): conserva X-Frame-Options y NO lleva CSP", async ({
    request,
  }) => {
    const res = await request.get("/api/health");
    const headers = res.headers();
    // Las demás cabeceras de next.config.ts siguen presentes…
    expect(headers["x-frame-options"]).toBe("DENY");
    // …y la CSP solo la pone el proxy en la ruta de éxito HTML (health sale antes).
    expect(headers["content-security-policy"]).toBeUndefined();
  });
});
```

## 5. Evidencia literal — build (M1) y e2e

### 5.1 `npm run build` — TODAS las rutas dinámicas (gate M1)
Antes de MIS-300 `/_not-found` era `○ (Static)`. Tras `await connection()` en el root layout:
```
Route (app)
┌ ƒ /
├ ƒ /_not-found
├ ƒ /api/auth/google/callback
├ ƒ /api/auth/google/start
├ ƒ /api/health
├ ƒ /contactos
├ ƒ /contactos/[id]
├ ƒ /contactos/nuevo
├ ƒ /login
├ ƒ /panel
├ ƒ /pendientes
├ ƒ /recuperar-contrasena
└ ƒ /ventas

ƒ Proxy (Middleware)
ƒ  (Dynamic)  server-rendered on demand
```
**No aparece la leyenda `○ (Static)`**: ninguna ruta HTML queda prerenderizada bajo la CSP por petición.
Lint: 0 errores (1 warning preexistente ajeno en `Avatar.jsx`).

### 5.2 `npx playwright test csp-nonce --project=chromium-unauth` — 4/4
```
  ✓  /login: script-src con nonce+strict-dynamic sin unsafe-inline; todos los <script> con el nonce
  ✓  404 not-found: dinámica y con nonce coherente (M1)
  ✓  frescura: dos peticiones → nonces distintos, cada header coincide con SU html
  ✓  /api/health (salida temprana): conserva X-Frame-Options y NO lleva CSP
  4 passed
```
El test de `/api/health` **pasa** → confirma que las demás cabeceras de `next.config.ts` (X-Frame-Options)
SÍ se combinan con la salida temprana `NextResponse.next()` del proxy, y que hay **una sola** CSP
(ausente en health). *(Las respuestas que el proxy CREA directamente —403/503— son producción-only y no
se ejercitan aquí; su comportamiento de cabeceras es preexistente y MIS-300 no lo altera.)*

### 5.3 Forma de la CSP emitida (para referencia; el valor real lo asertan los tests)
- **dev** (`NODE_ENV != production`, lo que corre el e2e):
  `default-src 'self'; script-src 'self' 'nonce-<b64-16B>' 'strict-dynamic' 'unsafe-eval'; style-src
  'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'
  https://*.convex.cloud wss://*.convex.cloud; frame-ancestors 'none'; base-uri 'self'; form-action
  'self'; object-src 'none'`
- **prod**: idéntica **sin** ` 'unsafe-eval'` en `script-src`.

## 6. Greps reproducibles (con salida literal)
```
$ grep -nE "connection" src/app/layout.tsx
2:import { connection } from "next/server";
34:  await connection();
$ grep -nE "buildCsp|randomBytes|content-security-policy" src/proxy.ts
3:import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
53:function buildCsp(nonce: string, isProd: boolean): string {
143:  const nonce = randomBytes(16).toString("base64");
147:  requestHeaders.set("content-security-policy", csp);
149:  response.headers.set("content-security-policy", csp);
# La CSP ya NO se fija en next.config.ts (solo se menciona en el comentario):
$ grep -nE 'key: "Content-Security-Policy"' next.config.ts   →   (sin resultados)
$ grep -n "csp-nonce.spec.ts" playwright.config.ts
94:        "csp-nonce.spec.ts",   # (chromium-unauth)
```

## 7. Verificación restante (tras GO de esta auditoría)

1. Instalar byte-idéntico (ya coincide: `diff -r` CODIGO ↔ repo OK, 5/5).
2. `npm run lint` (0 err) / `npm run build` (evidencia §5.1) / **suite e2e completa** (regresión: si el
   nonce rompiera el arranque de scripts de Next, login/panel/contactos/ventas/recuperación fallarían).
   Además verificación manual `npm run dev` + navegador: HMR/overlay OK, consola sin violaciones CSP.
3. PR (permiso antes del push) → CI verde.
4. Merge (con permiso) → Railway auto-despliega el frontend (**sin deploy de Convex**).
5. Smoke prod con **GET** (binding header↔HTML), fichero temporal único: `tmp="$(mktemp)"; curl -sS -D -
   https://mistu-monso.com/login -o "$tmp"` → confirmar en la cabecera `content-security-policy` un
   `script-src` con `'nonce-…' 'strict-dynamic'`, **sin** `'unsafe-inline'` ni `'unsafe-eval'`, que ese
   nonce coincide con el de los `<script>` de `$tmp`, y (Baja) registrar `cache-control`/estado de caché
   de Cloudflare para confirmar que no reusa HTML con un nonce anterior; `rm -f "$tmp"`. Aceptación del
   usuario: la app carga sin roturas ni violaciones CSP.

## 8. Mapa a la lista de la auditoría de plan §8

1. **Import y llamada literal a `connection()` en el root layout** → §3.1 (diff), §6 (grep).
2. **Construcción CSP y prod/dev** → §3.2 `buildCsp` (`'unsafe-eval'` solo si `!isProd`), §5.3.
3. **Mutación de request/response headers en la ruta final** → §3.2 (bloque final del `proxy`).
4. **CSP estática eliminada, conservando las otras cabeceras** → §3.3 (const + entrada del header
   fuera; Referrer/X-Content-Type/Permissions/HSTS intactas).
5. **Parser de directivas + extractor base64** → §4 `directiveTokens` (por `;`, `\s+`→espacio,
   `toLowerCase`) y `nonceFromScriptSrc` (`[A-Za-z0-9+/=]+`).
6. **Aserciones no vacías sobre todos los scripts** → §4 `expectAllScriptsCarryNonce` (≥1, exactamente
   un nonce por script, todos == header).
7. **Cobertura /login, 404, frescura, /api/health** → §4, cuatro tests; resultados en §5.2.
8. **Salida literal del build con `/_not-found` dinámica** → §5.1.
9. **Manifiesto completo y ausencia de `convex/`** → §2 (5 ficheros; ninguno bajo `convex/`).

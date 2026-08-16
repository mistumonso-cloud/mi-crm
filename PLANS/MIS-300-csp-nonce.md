# MIS-300 · CSP con nonce por petición (completa M2)

> Dividido de MIS-293 (Fase 3 — Higiene). Plan de récord, **ronda 2** (tras auditoría de plan NO-GO por
> M1/M2). **NO autoriza instalar/mergear/desplegar** — ver "Gate".
>
> **Correcciones ronda 2 (§8 de la auditoría):**
> 1. **M1** — el nonce por petición SOLO funciona con render dinámico; añadir la cabecera en el proxy
>    NO convierte el HTML preconstruido de `/_not-found` en SSR con nonce. Se añade el mecanismo
>    explícito de este Next 16 para **forzar render dinámico global** (`await connection()` en el root
>    layout) + gate de **evidencia de build** de que ninguna ruta queda estática. `src/app/layout.tsx`
>    entra al manifiesto.
> 2. **M2** — el e2e añade cobertura sobre una ruta **404/not-found** con nonce coherente (la
>    consecuencia real de la decisión), no solo `/login` (que ya era dinámica).
> 3. **Media/Baja** — parseo de CSP **por directiva** (no regex global); todos los `<script>` generados
>    llevan el nonce; comprobar **una sola** CSP efectiva; comprobar una respuesta temprana
>    (`/api/health`) para las demás cabeceras; smoke de prod con **GET** (binding header↔HTML); extractor
>    de nonce con alfabeto base64 completo (`+/=`); dos requests → parejas coherentes distintas.

## 0. Decisión de producto (GO/NO-GO) — el ticket exige abrir por aquí

El nonce por petición **obliga a render dinámico en todas las páginas** → desactiva optimización
estática/ISR, **incompatible con PPR**, sin cacheo de HTML autenticado en CDN. **Decisión del usuario:
GO.** Para ESTA app el coste práctico es ~nulo: el `build` ya marca **todo `ƒ (Dynamic)`** salvo
`/_not-found`; **PPR no está activado** (`experimental` solo tiene `serverActions.allowedOrigins`);
Cloudflare cachea `/_next/static`, no el HTML autenticado. Beneficio real: `script-src` deja de tener
`'unsafe-inline'` (M2, la palanca de XSS). Clickjacking ya cubierto por `frame-ancestors 'none'` +
`X-Frame-Options: DENY`.

## Contexto (estado actual)

- **CSP estática** en `next.config.ts` (`headers()`, `source: "/:path*"`): `script-src 'self'
  'unsafe-inline'` (+ `'unsafe-eval'` fuera de producción), junto a X-Frame-Options, Referrer-Policy,
  X-Content-Type-Options, Permissions-Policy, HSTS.
- **`src/proxy.ts`** (middleware Node, Next 16) ya corre en todas las rutas dinámicas (matcher
  `["/((?!_next/static|favicon.ico).*)"]`) para el secreto de origen (I1), host canónico (I2) y check
  optimista de cookie. Node runtime garantizado; ya importa `node:crypto`.
- **Root layout `src/app/layout.tsx`** es **síncrono** y envuelve TODA ruta, incluida la not-found por
  defecto (no hay `not-found.tsx`/`global-not-found.tsx` propios → `/_not-found` es el default de Next).
- **El navegador no ejecuta `<script>` manuales** (sin `dangerouslySetInnerHTML`) **ni conecta con
  Convex** (verificado: `panel/PanelAutoRefresh.tsx` usa `router.refresh()` polling; el resto usa
  Server Actions + `fetchQuery`/`fetchMutation` en servidor; sin `convex/react` en `src`). → Next
  gestiona sus propios scripts; basta con que reciba el nonce para inyectarlo automáticamente.

## Diseño

### 1. `src/app/layout.tsx` — forzar render dinámico GLOBAL (M1, precondición del nonce)
Una página prerenderizada en build se generó **sin** conocer el nonce → sus `<script>` no lo llevan y
el navegador los bloquea. Mecanismo de ESTE Next 16 (guía instalada
`node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md` §"Forcing dynamic rendering" +
`.../04-functions/connection.md`): `await connection()` corta el prerender. Se pone en el **root
layout** (envuelve toda ruta, incl. la not-found por defecto), haciéndolo `async`:
```ts
import { connection } from "next/server";
// …fuentes/metadata sin cambios…
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await connection(); // corta el prerender: TODO el árbol se renderiza por petición (incl. /_not-found)
  return ( <html …>…{children}…</html> );
}
```
**Gate de build (obligatorio):** tras el cambio, `npm run build` debe mostrar **todas** las rutas como
`ƒ (Dynamic)`; en particular `/_not-found` deja de ser `○ (Static)`. Si alguna quedara estática, nonce y
HTML estarían desacoplados → **no se continúa**; la salida del build se incluye literal en el
`codigo-completo.md` como evidencia.

### 2. `src/proxy.ts` — generar nonce + CSP por petición (en la ruta de éxito)
El proxy fija la CSP en las cabeceras **del request** (Next parsea `'nonce-{v}'` de ahí y lo inyecta en
sus scripts durante el SSR) **y** en las del **response** (para el navegador).

- Helper `buildCsp(nonce: string, isProd: boolean): string` con los directivos actuales, cambiando
  **solo `script-src`**:
  ```
  default-src 'self';
  script-src 'self' 'nonce-<nonce>' 'strict-dynamic'   (+ " 'unsafe-eval'" si !isProd);
  style-src 'self' 'unsafe-inline';                     ← SE MANTIENE (atributos style={{}}; el nonce no cubre atributos de estilo)
  img-src 'self' data:;
  font-src 'self' data:;
  connect-src 'self' https://*.convex.cloud wss://*.convex.cloud;   ← sin cambios (ver follow-up)
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self';
  object-src 'none'
  ```
  `'strict-dynamic'` hace que Next (script con nonce) cargue sus chunks sin allowlist de host; `'self'`
  se conserva como fallback CSP2.
- Nonce: `randomBytes(16).toString("base64")` (16 B, node:crypto ya importado). Fresco por petición.
- Aplicarlo **solo en el `return NextResponse.next()` final** (ruta de éxito, tras pasar 503/403/cookie):
  ```ts
  const nonce = randomBytes(16).toString("base64");
  const csp = buildCsp(nonce, process.env.NODE_ENV === "production");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("content-security-policy", csp);
  return res;
  ```
  Las salidas tempranas (`/api/health`, 503 misconfig, 403 origen/host, redirect cookie-gated → /login)
  **no** llevan nonce: no son HTML de app (el /login destino del redirect recibe su propia CSP al
  cargarse). `!isProd` (`NODE_ENV !== "production"`) → en `npm run dev` (e2e) y test se añade
  `'unsafe-eval'` y todo lo demás igual, así que el e2e ejercita la ruta real.

### 3. `next.config.ts` — retirar SOLO la CSP (la mueve el proxy)
- Eliminar la entrada `Content-Security-Policy` de `SECURITY_HEADERS` y el `const
  CONTENT_SECURITY_POLICY` + `IS_PRODUCTION` (quedarían sin uso → lint). **Una sola** cabecera CSP en
  todo el sistema (la del proxy); dos CSP simultáneas se aplican como intersección y romperían.
- **Se mantienen** en `next.config.ts`: X-Frame-Options DENY, Referrer-Policy, X-Content-Type-Options,
  Permissions-Policy, **Strict-Transport-Security** (HSTS es MIS-301, no se toca aquí). Aplican vía
  `headers()` a las respuestas que sirve Next; el clickjacking en páginas de app queda además cubierto
  por `frame-ancestors 'none'` de la CSP del proxy.
- Actualizar el comentario de cabecera para reflejar que la CSP vive en `proxy.ts` (fase 3 hecha).

## Verificación

### E2E nuevo — `e2e/csp-nonce.spec.ts` (project `chromium-unauth`, sin sesión)
Helpers robustos (Media/Baja):
- **Parseo por directiva:** partir la CSP por `;`, localizar el token-list de `script-src`, y asertar
  sobre ÉL (no regex global) — así `style-src 'unsafe-inline'` no se confunde con `script-src`.
- **Extractor de nonce:** `nonce-([A-Za-z0-9+/=]+)` (alfabeto base64 completo, incl. `+ / =`).
- **Todos los scripts:** recoger TODOS los `<script …>` del HTML servido y asertar que cada uno lleva
  `nonce="<mismo>"` (Next los nonce-a todos cuando la CSP del request trae el nonce).

Casos:
1. **`/login` (ruta ya dinámica):** existe **exactamente una** cabecera `content-security-policy`
   (`response.headersArray()`); su `script-src` contiene `'nonce-…'` y `'strict-dynamic'` y **NO**
   `'unsafe-inline'`; el nonce del header == el de TODOS los `<script>` del HTML.
2. **404 / not-found (M1+M2, la prueba clave):** GET a una URL inexistente fija
   `/__e2e_csp_missing_<fijo>` → **status 404**; CSP con `'nonce-…' 'strict-dynamic'` y sin
   `'unsafe-inline'` en `script-src`; nonce del header == nonce de los `<script>` del HTML 404. Prueba
   que la not-found se renderiza dinámica y con nonce coherente (si siguiera estática, no coincidirían).
3. **Frescura + coherencia por pareja:** dos GET a `/login` → `nonce₁ ≠ nonce₂` **y** cada header
   coincide con el nonce del HTML de SU propia respuesta (`header₁=HTML₁`, `header₂=HTML₂`).
4. **Respuesta temprana + una sola CSP:** GET `/api/health` → lleva `X-Frame-Options: DENY` (las demás
   cabeceras de `next.config.ts` sobreviven) y **NO** lleva `content-security-policy` (el proxy solo la
   pone en la ruta de éxito HTML; confirma además que la CSP estática de config desapareció).

### Evidencia de build (M1, gate)
`npm run build` incluido literal en el `codigo-completo.md`: **ninguna** ruta HTML aparece como
`○ (Static)` bajo la CSP por petición; `/_not-found` figura como `ƒ`.

### Regresión (el gate real)
La **suite e2e completa** prueba que la app sigue cargando/funcionando bajo la CSP con nonce (login,
panel, contactos, ventas, recuperación): si el nonce rompiera el arranque de scripts de Next,
fallarían. Verificación manual `npm run dev` + navegador: HMR/overlay OK y consola **sin violaciones
CSP**. Registrar el spec en `chromium-unauth.testMatch` de `playwright.config.ts`.

### Resto
`npm run lint` (0 err), `npm run build` (además de la evidencia, confirma que compila sin la CSP en
config), suite e2e completa. **No toca `convex/`** → sin `convex dev`/codegen ni deploy de Convex.

## Despliegue

**Frontend-only** (`src/app/layout.tsx` + `src/proxy.ts` + `next.config.ts` + tests). **No toca
`convex/`** → como MIS-299: **auto-deploy solo del frontend por Railway al mergear, sin `npx convex
deploy`**.

Smoke en prod (tras merge + deploy Railway), con **GET** (no solo HEAD, para probar el binding
header↔HTML): `curl -sS -D - https://mistu-monso.com/login -o /tmp/login.html` (a través de Cloudflare,
que inyecta el secreto de origen) → confirmar `content-security-policy` con `'nonce-…' 'strict-dynamic'`
en `script-src`, **sin** `'unsafe-inline'` (ni `'unsafe-eval'`) en `script-src`, y que ese nonce
coincide con el de los `<script>` de `/tmp/login.html`. **Aceptación del usuario:** cargar la app en
prod y confirmar que no hay roturas (login, panel, navegación, un 404) ni violaciones CSP en consola.

## Gate (metodología estricta)

Este plan **NO** autoriza instalar/mergear/desplegar. Flujo: código (effort **high**) → entrega
autocontenida en `CODIGO/MIS-300-csp-nonce/` (contenido literal de ficheros nuevos + **diffs `diff -u`
completos** + salida literal del `build`; el auditor solo ve ese texto) → **auditoría de código
externa** (GO/NO-GO; un GO CONDICIONADO también es GO) → instalar byte-idéntico → lint/build/e2e verdes
→ PR (**permiso antes del push**) → CI verde → merge (asistente, con permiso) → Railway auto-despliega
el frontend → smoke + aceptación → cerrar MIS-300.

## Follow-ups (fuera de alcance de MIS-300)
- **Estrechar `connect-src` a `'self'`**: el navegador ya no conecta con Convex (verificado), así que
  las entradas `*.convex.cloud` son peso muerto; candidato claro y de bajo riesgo, verificable aparte.
- `upgrade-insecure-requests` en la CSP — evaluar junto a HSTS (MIS-301).
- HSTS `includeSubDomains`/`preload` → **MIS-301** (no tocar aquí).
- Retirada futura de estilos inline (`style={{}}`) para poder quitar `'unsafe-inline'` de `style-src`.
- Trusted Types, si se justificara.

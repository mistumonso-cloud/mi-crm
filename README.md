# Vibe Coder CRM

CRM minimalista para pequeños negocios de ventas digitales. Next.js (App Router) + Tailwind v4 + Convex. Ver `DESIGN/design-system/design.md` para los principios de diseño.

## Stack

- **Next.js 16** (App Router, TypeScript, Turbopack)
- **Tailwind CSS v4**, tokens de marca en `src/styles/tokens/*.css`, cargados en `src/app/globals.css`
- **Convex** como base de datos / backend (`convex/schema.ts`)
- Componentes base del design system en `src/components/ui/**`
- Autenticación por sesión (token opaco en cookie `HttpOnly`) con roles `rep`/`supervisor`, con login por contraseña o con Google — ver "Autenticación y roles"

## Primeros pasos

1. Instala dependencias (ya hecho si acabas de clonar):
   ```bash
   npm install
   ```
2. Arranca Convex (te pedirá login y creará el proyecto en tu cuenta de Convex):
   ```bash
   npx convex dev
   ```
   Esto genera `convex/_generated/` y rellena `.env.local` con `NEXT_PUBLIC_CONVEX_URL` y `CONVEX_DEPLOYMENT`. Sin esto la app funciona pero sin datos (el provider avisa por consola).
3. En otra terminal, arranca Next.js:
   ```bash
   npm run dev
   ```
4. Abre [http://localhost:3000](http://localhost:3000).

## Estructura

```
convex/                          esquema y funciones de Convex (incluye auth.ts, crons.ts)
DESIGN/design-system/            design system original (tokens, componentes de referencia, plantillas)
CODIGO/                          código generado por tarea de Linear, revisado y pendiente de instalar en src/convex
PLANS/                            planes de implementación por tarea de Linear
src/app/(auth)/login/            pantalla de login
src/app/api/auth/google/         Route Handlers del login con Google (OAuth)
src/app/(app)/                   rutas protegidas (header con logout; (with-nav)/ añade barra inferior + FAB)
src/lib/auth/                    DAL (getUser), server actions de login/logout, cookie de sesión, cliente OAuth de Google
src/proxy.ts                     protección optimista de rutas (redirige a /login si no hay cookie)
src/components/ui/               componentes base (Button, Card, Input, Badge, StatusBadge, Tabs...)
src/components/crm/              componentes específicos del CRM (BottomNav, AddContactFab)
src/lib/                         utilidades compartidas
src/styles/tokens/               tokens de color/tipografía/espaciado/radios, copiados del design system
scripts/hash-password.mjs        genera el hash para sembrar usuarios (ver "Autenticación y roles")
```

Los componentes en `src/components/ui` son `.jsx` (no `.tsx`) a propósito: son una copia directa del design system de referencia; los `.d.ts` junto a cada uno les añaden tipos para poder usarlos con seguridad desde TypeScript.

## Autenticación y roles

Sesión en base de datos (Convex), no JWT: token opaco de 32 bytes en cookie `HttpOnly`, revocación instantánea en logout. Hay dos roles fijos, `rep` (Carlos) y `supervisor` (Marta) — no hay pantalla de registro, los usuarios se siembran a mano.

Para crear el primer usuario:

```bash
node scripts/hash-password.mjs        # pide la password por stdin (oculta), imprime el hash
npx convex run auth:seedUser '{"name":"Carlos","email":"...","passwordHash":"<hash de arriba>","role":"rep"}'
```

Repite para Marta con `"role":"supervisor"`. Detalles de diseño (rate limiting, formato del hash, limpieza de sesiones expiradas) en `PLANS/MIS-7-autenticacion-roles.md`. El guard de rol por página que describía ese plan (bloqueo mutuo entre `/pendientes` y `/panel`) se aflojó en MIS-18: ambos roles tienen ahora acceso de lectura a las dos pantallas — ver `PLANS/MIS-18-navegacion-principal.md`, sección "Nota de seguridad (ADR)". Esto no afecta a `convex/lib/authz.ts`, que sigue protegiendo las mutations/queries de Convex por rol.

### Login con Google (MIS-260)

"Entrar con Google" convive con el login por contraseña — el alta sigue cerrada: **nunca crea un usuario nuevo**. Si el email de la cuenta de Google (verificado por Google, `email_verified === true`) coincide con un usuario ya provisionado en `users`, se autentica exactamente igual que con contraseña (misma tabla `sessions`, misma cookie). Si no coincide, se rechaza con un mensaje genérico.

Variables de entorno nuevas (`.env.local`):

| Variable | Notas |
|---|---|
| `GOOGLE_CLIENT_ID` | De Google Cloud Console. Server-only, sin prefijo `NEXT_PUBLIC_` |
| `GOOGLE_CLIENT_SECRET` | Server-only, nunca en el bundle cliente |
| `GOOGLE_OAUTH_REDIRECT_URI` | Valor exacto fijo — ver tabla de abajo, uno por entorno |
| `GOOGLE_LOGIN_SHARED_SECRET` | Generar con algo como `openssl rand -base64 32`. Debe ponerse **igual** en `.env.local` y en Convex: `npx convex env set GOOGLE_LOGIN_SHARED_SECRET <valor>` — protege la mutation `loginWithGoogle` para que solo el propio servidor de Next.js pueda invocarla (si no, sería una mutation pública invocable con cualquier email, sin pasar por Google) |

Redirect URIs a registrar en Google Cloud Console (Authorized redirect URIs) — la ruta es siempre `/api/auth/google/callback`:

| Entorno | Redirect URI |
|---|---|
| Dev | `http://localhost:3000/api/auth/google/callback` |
| Producción | `https://mi-crm-production-b627.up.railway.app/api/auth/google/callback` |

**Producción queda fuera de alcance de MIS-260**: el deployment de Convex de producción está pendiente de un fix aparte ya conocido (deploy manual olvidado varias veces) — la redirect URI de prod puede registrarse ya en Google Console (config estática, no cuesta nada tenerla lista), pero el código y los datos de producción no se tocan en este ticket.

### Harness seguro de pruebas e2e (MIS-286)

El flujo de recuperación de contraseña (MIS-285) manda un **código por email** y en BD solo guarda su hash, así que un test no puede leerlo por medios normales. `convex/testSupport.ts` abre la mínima puerta que lo permite, cerrada con **tres cerrojos independientes**:

1. **Credencial de alta entropía** `E2E_TEST_SUPPORT_KEY`, comparada en tiempo constante y **fail-closed**. En producción esa variable **no existe**, así que todas esas funciones lanzan aunque el código esté desplegado.
2. **Identidad dedicada** `reset@test.local`: las funciones rechazan cualquier otro email, así que el harness no puede tocar las cuentas de Carlos ni de Marta.
3. **Secretos efímeros**: la contraseña de esa identidad **se genera en cada llamada** a `resetTestIdentity` y solo se devuelve al llamante ya autenticado. **No hay ninguna contraseña válida en el repositorio.**

| Variable | Dónde |
|---|---|
| `E2E_TEST_SUPPORT_KEY` | Convex **dev** (`npx convex env set E2E_TEST_SUPPORT_KEY <valor>`), `.env.test.local` y GitHub Secrets. **Ausente en producción** (verificar con `npx convex env list --prod`) |

**Gate de fugas** — `npm run test:e2e:secret-gate`. Las trazas de Playwright serializan los parámetros de las acciones y CI publica los artefactos 14 días, así que un `fill()` con una contraseña la dejaría como texto descargable. Los specs con secretos corren en el project `chromium-secrets` **sin trace, vídeo ni screenshots**, y el gate lo demuestra en dos fases: con la captura activada el centinela **debe** aparecer (control positivo: prueba que el escáner funciona), y con la política real **no debe** aparecer en ficheros, dentro de los `.zip` de trace ni en la salida del proceso. Corre en CI y también en local.

> Una filtración de `E2E_TEST_SUPPORT_KEY` **exige rotarla de inmediato**: como el rol no autoriza nada (ver `convex/lib/authz.ts`), la identidad dedicada tiene acceso completo al CRM de dev igual que cualquier usuario.

## Despliegue (Railway)

El repo incluye `railway.json` (build con Nixpacks, `npm run build` / `npm run start`). Railway detecta Node.js automáticamente a partir de `package.json`.

Pasos:

1. En Railway, crea un deployment de Convex de producción: `npx convex deploy` (o desde el dashboard de Convex, entorno "Production").
2. En el servicio de Railway, define las variables de entorno (Settings → Variables):
   - `NEXT_PUBLIC_CONVEX_URL`
   - `NEXT_PUBLIC_CONVEX_SITE_URL`
   - `CONVEX_DEPLOYMENT`

   (los mismos valores que genera Convex, pero apuntando al deployment de producción, no al de `convex dev`).
3. Con el repo de GitHub ya conectado a Railway, cada push a `main` dispara un build y deploy automático.

# Vibe Coder CRM

CRM minimalista para pequeños negocios de ventas digitales. Next.js (App Router) + Tailwind v4 + Convex. Ver `DESIGN/design-system/design.md` para los principios de diseño.

## Stack

- **Next.js 16** (App Router, TypeScript, Turbopack)
- **Tailwind CSS v4**, tokens de marca en `src/styles/tokens/*.css`, cargados en `src/app/globals.css`
- **Convex** como base de datos / backend (`convex/schema.ts`)
- Componentes base del design system en `src/components/ui/**`
- Autenticación por sesión (token opaco en cookie `HttpOnly`) con roles `rep`/`supervisor` — ver "Autenticación y roles"

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
src/app/(app)/                   rutas protegidas (header con logout; (with-nav)/ añade barra inferior + FAB)
src/lib/auth/                    DAL (getUser), server actions de login/logout, cookie de sesión
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

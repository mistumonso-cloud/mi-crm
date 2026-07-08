# MIS-7 — Autenticación y roles — código listo para revisión

Corresponde al plan aprobado (v5, GO) en `PLANS/MIS-7-autenticacion-roles.md`. Esta carpeta reproduce la estructura real de destino dentro del proyecto — cada archivo de aquí va exactamente a la misma ruta relativa dentro de `convex/` o `src/` en la raíz del repo.

Este código **ya fue implementado y verificado una vez** en una sesión anterior (typecheck limpio, lint limpio, desplegado en el deployment de dev, los 2 pre-checks del plan pasaron, cuentas de prueba sembradas y probadas) y **luego revertido a petición del usuario** para pasar primero por revisión. Es el mismo código, reconstruido aquí tal cual.

**v2 de este código**: una revisión estática encontró un bug real en `src/proxy.ts` (bucle infinito de redirects entre `/` y `/login` si la cookie existe pero la sesión ya no es válida) y dos detalles menores (matcher demasiado amplio, comportamiento del reset de rate-limit por IP sin documentar). Los tres están corregidos aquí — ver "Respuesta a la revisión de código (v5 → v6)" en el plan.

## Cómo instalarlo (cuando se apruebe)

1. **Archivos nuevos** — copiar tal cual, respetando la ruta:
   - `convex/auth.ts`, `convex/crons.ts`, `convex/lib/password.ts`, `convex/lib/token.ts`, `convex/lib/authz.ts`, `convex/lib/rateLimit.ts`
   - `src/proxy.ts`
   - `src/lib/auth/constants.ts`, `cookie.ts`, `dal.ts`, `actions.ts`
   - `src/app/(auth)/login/page.tsx`, `LoginForm.tsx`
   - `src/app/(app)/layout.tsx`, `page.tsx`, `pendientes/page.tsx`, `panel/page.tsx`
   - `scripts/hash-password.mjs`
   - Los `.d.ts` bajo `src/components/ui/**` — son declaraciones de tipos que faltaban para los componentes `.jsx` ya existentes (`Button`, `Input`, `Card`, `Avatar`, `Badge`, `StatusBadge`, `Checkbox`, `Select`, `Switch`, `Tabs`). Sin ellos, `Input`/`suffix`/`label` con strings no compila (TypeScript infiere `null` en vez de `string` a partir de los valores por defecto del `.jsx`). Son copias de `DESIGN/design-system/components/**/*.d.ts`, igual que los propios `.jsx` ya fueron copiados de ahí en su momento.

2. **Archivo a EDITAR** (no sobrescribir sin más, es una ampliación del existente):
   - `convex/schema.ts` — el de esta carpeta es el **archivo completo resultante** (tabla `contacts` original + `users`/`sessions`/`loginAttempts` nuevas). Reemplaza el actual por este.

3. **Archivo a BORRAR**:
   - `src/app/page.tsx` (el actual, de bienvenida) — su ruta `"/"` pasa a `src/app/(app)/page.tsx` (el dispatcher por rol). Si conviven los dos, Next falla el build por ruta duplicada.

## Después de copiar los archivos

1. `npx convex dev --once` (o dejar `npx convex dev` corriendo) para desplegar el esquema y las funciones nuevas.
2. Sembrar Carlos y Marta (no hay UI de registro, según el criterio de aceptación de MIS-7):
   ```
   node scripts/hash-password.mjs        # pide la password por stdin, imprime el hash
   npx convex run auth:seedUser '{"name":"Carlos","email":"...","passwordHash":"<hash de arriba>","role":"rep"}'
   node scripts/hash-password.mjs
   npx convex run auth:seedUser '{"name":"Marta","email":"...","passwordHash":"<hash de arriba>","role":"supervisor"}'
   ```
3. Verificar con la lista de comprobación end-to-end del plan (`PLANS/MIS-7-autenticacion-roles.md`, sección "Verificación end-to-end").

## Qué NO cubre este código (a propósito)

- MIS-18 (barra de navegación/botonera real), MIS-13 (home de Carlos) y MIS-17 (home de Marta) — `/pendientes` y `/panel` son placeholders mínimos a sustituir por esas tareas.
- No hay reactividad de cliente (`useQuery`) para datos protegidos — ver la sección "Regla: sin queries reactivas de cliente" del plan.

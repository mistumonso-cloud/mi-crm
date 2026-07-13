# MIS-18 — Navegación principal: barra inferior y botón flotante

> **Estado**: **GO para implementación** (confirmado por auditoría tras v3, corrección documental menor). Aún no hay código en `CODIGO/MIS-18-navegacion-principal/`.

## Contexto

El proyecto CRM en Linear tiene la pantalla principal repartida en varias tareas: **MIS-7** (login/roles, ya instalado), **MIS-18** (esta tarea: barra de navegación/FAB), **MIS-13** (home real de Carlos) y **MIS-17** (home real de Marta) — ver `PLANS/MIS-7-autenticacion-roles.md`, sección "Contexto". `src/app/(app)/layout.tsx` tiene desde MIS-7 un comentario explícito reservando este trabajo: *"Barra mínima para cumplir 'logout accesible desde la app' — MIS-18 sustituirá/absorberá esto con la navegación real (barra inferior + FAB)."*

Investigación previa confirma:
- No existen todavía `/contactos` (MIS-9, Backlog), `/contactos/nuevo` (MIS-8, Backlog) ni la ficha de contacto `/contactos/[id]` (MIS-10, Backlog).
- `src/app/(app)/pendientes/page.tsx` y `src/app/(app)/panel/page.tsx` son placeholders literales instalados por MIS-7, protegidos con `requireRole("rep")` y `requireRole("supervisor")` respectivamente (de `src/lib/auth/dal.ts`).
- Ya existen componentes cliente (`"use client"`) en el repo: todo `src/components/ui/**` (copias del design system — `Button.jsx`, `Avatar.jsx`, `Badge.jsx`, `Card.jsx`, `Input.jsx`, `Select.jsx`, `Checkbox.jsx`, `Switch.jsx`, `Tabs.jsx`, `StatusBadge.jsx`, todos usan `React.useState` para hover/focus) y `src/app/(auth)/login/LoginForm.tsx`. Lo que **no** tiene precedente en el repo es `usePathname()`/`next/link` con navegación interactiva basada en la ruta activa — eso sí es nuevo con `BottomNav`.
- No hay ningún componente `Icon` portado a `src/components/ui` — el design system de referencia tiene `DESIGN/design-system/ui_kits/crm/icons.jsx`, pero nunca se instaló en `src/`.
- `src/components/crm/` existe vacía, reservada en el README raíz para "componentes específicos del CRM, por construir" — es el sitio designado para lo que construye esta tarea.
- Mockup de referencia oficial: `DESIGN/design-system/templates/app-shell/AppShell.dc.html`, cabecera: *"Prototipo navegable: barra inferior, FAB y pantallas Pendientes/Contactos/Panel. Arranque por rol (Carlos → Pendientes, Marta → Panel)."*

## Respuesta a la auditoría (v1 → v2)

La v1 de este plan recibió **NO-GO** (revisión estática, sin `npm run dev`/build/lint). Hallazgos y resolución:

| # | Hallazgo | Severidad | Resuelto en v2 |
|---|---|---|---|
| 1 | Aflojar `requireRole` en Pendientes/Panel es una expansión real de autorización, y la decisión no quedaba registrada fuera del plan (ni en el ticket/AC de MIS-18 ni en un ADR) | Mayor | Sección "Nota de seguridad (ADR)" dedicada, con quién/cuándo/por qué decidió y qué NO cambia. Acción de seguimiento: actualizar la descripción/AC de MIS-18 en Linear |
| 2 | Safe-area del bottom nav mal especificada: el contenido se centraba en toda la altura `72px + safe-area` en vez de solo en la zona útil, pudiendo caer parte del área táctil en zona insegura (home indicator) | Mayor | `BottomNav` pasa a `boxSizing:"border-box"` + `paddingBottom: env(safe-area-inset-bottom)` explícito, dejando el contenido centrado únicamente en los 72px útiles |
| 3 | Frase "el matcher cubre exactamente las rutas existentes" imprecisa: `/contactos/:path*` también machea subrutas aún inexistentes | Menor | Reformulada: es un prefijo intencional, no una lista exacta; no es problema de seguridad porque `getUser()` en el DAL sigue siendo la fuente de verdad real |
| 4 | `README.md` raíz (líneas ~39 y ~61) menciona `requireRole` en el DAL — quedará obsoleto en cuanto se elimine | Menor | Añadido a la checklist de documentación a actualizar **durante la fase de código**, no en esta fase de plan |
| 5 | SVGs decorativos del bottom nav sin `aria-hidden`, ruido para lectores de pantalla | Menor | Añadido `aria-hidden="true" focusable="false"` a los 3 iconos y al glifo "+" del FAB |

Validado sin cambios por la auditoría: el patrón de route group `(with-nav)`, `proxy.ts` con `"/contactos/:path*"`, `usePathname()` en client component, y mantener `getUser()` en cada page en vez de fiarse solo del layout padre.

## Respuesta a la auditoría (v2 → v3) — **GO**

Los 2 mayores quedaron confirmados como resueltos (ADR de autorización con alcance correctamente acotado a páginas Next, sin tocar `convex/lib/authz.ts`; fix de safe-area con `boxSizing:"border-box"` + `paddingBottom`). Un hallazgo menor nuevo:

| # | Hallazgo | Severidad | Resuelto en v3 |
|---|---|---|---|
| 6 | "Único componente cliente existente en el repo: `LoginForm.tsx`" era falso — `src/components/ui/core/Button.jsx`, `Avatar.jsx` y `src/components/ui/feedback/Badge.jsx` (y de hecho todo `src/components/ui/**`) ya son `"use client"` | Menor | Corregido en "Contexto" y en la sección de `BottomNav.tsx`: sigue siendo cierto que no hay precedente de `usePathname()`/navegación por ruta activa, pero `"use client"` en sí no es nuevo |

**Condiciones de verificación durante la implementación** (de la propia auditoría, a cumplir en la fase de código):
- No tocar `convex/lib/authz.ts`.
- Actualizar `README.md` al eliminar `requireRole` del DAL de Next (ver checklist de documentación).
- Ejecutar el pre-check de route groups antes de portar contenido final.
- Verificar manualmente iPhone/notch para confirmar que labels/iconos quedan fuera del home indicator.
- Confirmar con `rg "requireRole" src/` que no queda import/call real del DAL eliminado.

## Nota de seguridad (ADR) — ampliación de acceso a Pendientes/Panel

**Decisión**: Carlos (`rep`) y Marta (`supervisor`) pasan a tener acceso de lectura a `/pendientes` **y** `/panel` por igual, sustituyendo el bloqueo mutuo estricto que instaló MIS-7 (`requireRole("rep")`/`requireRole("supervisor")`, que redirigían a cualquiera que no coincidiera exactamente con el rol de la página).

**Quién decide y cuándo**: decisión tomada explícitamente por el usuario (propietario del producto) el 2026-07-13, durante la planificación de MIS-18, tras presentarle 3 opciones (aflojar guards / pestañas filtradas por rol / 3 pestañas con guards intactos y rebote silencioso). Eligió aflojar los guards.

**Por qué es la lectura correcta del criterio original, no una regresión**: el propio texto de MIS-7 para el rol de Marta dice literalmente *"acceso de lectura a todos los contactos y su historial... puede ver todo lo que Carlos hace"*. La implementación instalada de MIS-7 fue más estricta que ese texto (bloqueo mutuo total en vez de solo diferenciar el home por defecto). Esta ampliación corrige esa discrepancia entre spec e implementación; no introduce una capacidad nueva no contemplada.

**Qué NO cambia**:
- `convex/lib/authz.ts::requireUser` / `requireRole` — funciones **distintas**, en otro módulo, que protegen las `query`/`mutation` de Convex (no las páginas de Next.js) — quedan completamente intactas. Cualquier operación de escritura futura (alta de contacto en MIS-8, cambio de estado en MIS-14, cierre de venta en MIS-15...) sigue debiendo llamarlas como primera línea, sin excepción. Este ADR es exclusivamente sobre qué **páginas** puede visitar cada rol, no sobre qué **operaciones de datos** puede ejecutar.
- El aterrizaje por defecto no cambia (Carlos → Pendientes, Marta → Panel vía el dispatcher de `(app)/page.tsx`).
- Pendientes y Panel, en su forma actual (placeholders de MIS-13/MIS-17), no escriben datos — no hay ninguna mutation nueva expuesta al rol "equivocado".

**Acción de seguimiento**: actualizar la descripción/criterio de aceptación de MIS-18 en Linear para que registre este cambio de autorización explícitamente, no solo en este documento.

## Arquitectura — route group anidado `(with-nav)`

```
src/app/(app)/
  layout.tsx                  EDITAR — solo el comentario obsoleto; el header (Avatar+nombre+logout)
                               no cambia, MIS-18 no lo pide.
  page.tsx                    SIN CAMBIOS — dispatcher por rol
  (with-nav)/                 NUEVO route group — no afecta la URL, solo agrupa layout
    layout.tsx                 NUEVO — monta <BottomNav/> + <AddContactFab/> alrededor de children
    pendientes/page.tsx        MOVER (git mv) desde (app)/pendientes/ — requireRole("rep") → getUser()
    contactos/page.tsx         NUEVO — placeholder MIS-9, getUser() (compartida, sin requireRole)
    panel/page.tsx             MOVER (git mv) desde (app)/panel/ — requireRole("supervisor") → getUser()
  contactos/
    nuevo/page.tsx             NUEVO — placeholder MIS-8, destino del FAB, getUser(), SIN barra/FAB
                                (vive fuera de (with-nav) a propósito — exclusión estructural, no un
                                if de pathname que alguien tenga que recordar mantener en MIS-8/MIS-10)
    [id]/                      NO se crea en MIS-18 — hueco reservado para MIS-10, también fuera de
                                (with-nav), también sin barra/FAB

src/components/crm/
  BottomNav.tsx                NUEVO
  AddContactFab.tsx            NUEVO
```

Confirmado contra `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route-groups.md`: los route groups no afectan la URL y sirven exactamente para esto — "Opting specific route segments into sharing a layout, while keeping others out." El único caveat es que dos grupos no resuelvan a la misma URL; aquí no ocurre (`/contactos` vs `/contactos/nuevo` son URLs distintas). Auditoría lo valida como correcto.

**Pre-check obligatorio** (hacerlo antes de portar contenido real): crear la estructura de carpetas vacía (páginas con un marcador mínimo), levantar `npm run dev`, confirmar que `/pendientes`, `/contactos` y `/contactos/nuevo` resuelven cada una a su página y que solo las dos primeras heredan el layout de `(with-nav)`. **Plan B** si Next no resolviera el árbol como se espera en esta instalación: mover `contactos/nuevo` (y en su momento `[id]`) dentro de `(with-nav)` también, y ocultar `BottomNav`/`AddContactFab` ahí con un chequeo de `usePathname()` — degrada de exclusión estructural a exclusión por ruta, sin bloquear el resto de la tarea.

`src/lib/auth/dal.ts`: `pendientes/page.tsx` y `panel/page.tsx` pasan de `requireRole(role)` a `getUser()` a secas. `requireRole` (el de Next/DAL) queda sin ningún call site tras este cambio y se elimina — ver ADR arriba para la justificación de seguridad, y la sección "Checklist de documentación" para lo que hay que actualizar en el README raíz cuando esto se ejecute.

## `proxy.ts`

Matcher actual:
```ts
["/", "/login", "/pendientes/:path*", "/panel/:path*"]
```
Pasa a:
```ts
["/", "/login", "/pendientes/:path*", "/panel/:path*", "/contactos/:path*"]
```
Cubre `/contactos`, `/contactos/nuevo` y el futuro `/contactos/[id]`. **Precisión**: `/contactos/:path*` es un *prefijo*, no una lista de rutas exactas — también machearía cualquier subruta futura bajo `/contactos/` aunque no exista todavía. Es intencional y no supone un riesgo de seguridad: el matcher de `proxy.ts` es solo el check optimista de existencia de cookie (redirige a `/login` si falta), nunca la fuente de verdad — esa sigue siendo `getUser()` en el DAL, llamado en cada page.

## `BottomNav.tsx` (`src/components/crm/BottomNav.tsx`)

`"use client"` — primer uso de `usePathname()`/navegación interactiva basada en ruta activa en el repo; ya existen componentes cliente del design system (`Button.jsx`, `Avatar.jsx`, `Badge.jsx`, etc.) y `LoginForm.tsx`, así que el patrón `"use client"` en sí no es nuevo, solo `usePathname()` lo es.

```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/pendientes", label: "Pendientes", Icon: ClockIcon },
  { href: "/contactos", label: "Contactos", Icon: ContactsIcon },
  { href: "/panel", label: "Panel", Icon: PanelIcon },
];

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Navegación principal"
      style={{
        position: "fixed", insetInline: 0, bottom: 0,
        height: "calc(72px + env(safe-area-inset-bottom))",
        boxSizing: "border-box",
        paddingLeft: 4, paddingRight: 4, paddingTop: 0,
        paddingBottom: "env(safe-area-inset-bottom)",
        background: "var(--color-surface)", borderTop: "1px solid var(--color-border)",
        display: "flex", alignItems: "center", zIndex: 10,
      }}
    >
      {TABS.map(({ href, label, Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            style={{
              flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
              gap: 2, padding: "6px 0", textDecoration: "none",
            }}
          >
            <span style={{
              width: 40, height: 30, borderRadius: "var(--radius-full)",
              background: active ? "var(--color-accent-tint)" : "transparent",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "background-color .18s ease-out",
            }}>
              <Icon stroke={active ? "var(--color-accent)" : "var(--text-tertiary)"} />
            </span>
            <span style={{
              fontSize: 10, fontWeight: active ? 600 : 500,
              color: active ? "var(--color-accent)" : "var(--text-tertiary)",
            }}>
              {label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
```

**Fix de safe-area (hallazgo #2)**: antes, `height` incluía el safe-area pero `alignItems:"center"` centraba el contenido en TODA esa altura, desplazando iconos/labels hacia abajo, potencialmente dentro de la zona insegura del home indicator en iPhones con notch. Ahora, `boxSizing:"border-box"` hace que `paddingBottom: env(safe-area-inset-bottom)` se reste de la altura total en vez de sumarse aparte, dejando exactamente 72px de caja de contenido arriba del padding — `alignItems:"center"` centra dentro de esos 72px únicamente, y el safe-area queda como espacio inerte debajo, sin contenido dentro.

Iconos (SVG `18×18`, paths tomados literalmente de `AppShell.dc.html` líneas 206/221/236; `aria-hidden`/`focusable` para el hallazgo #5):

```tsx
function ClockIcon({ stroke }: { stroke: string }) {
  return (
    <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  );
}
function ContactsIcon({ stroke }: { stroke: string }) {
  return (
    <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function PanelIcon({ stroke }: { stroke: string }) {
  return (
    <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}
```

No se porta un componente `Icon` genérico del design system (`icons.jsx`) porque `BottomNav` es el único consumidor por ahora. Se reevalúa cuando MIS-8/MIS-10 necesiten más iconos.

## `AddContactFab.tsx` (`src/components/crm/AddContactFab.tsx`)

```tsx
import Link from "next/link";

export function AddContactFab() {
  return (
    <Link
      href="/contactos/nuevo"
      aria-label="Añadir contacto"
      style={{
        position: "fixed", right: 16, bottom: "calc(88px + env(safe-area-inset-bottom))",
        width: 52, height: 52, borderRadius: "var(--radius-full)",
        background: "var(--color-accent)", color: "var(--color-accent-contrast)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 26, fontWeight: 300, lineHeight: 1, textDecoration: "none",
        boxShadow: "0 4px 14px rgba(59,82,102,.4)", zIndex: 20,
      }}
    >
      <span aria-hidden="true">+</span>
    </Link>
  );
}
```

El offset `bottom: calc(88px + env(safe-area-inset-bottom))` no tenía el bug del hallazgo #2 (el FAB no centra contenido dentro de una caja con padding — es un círculo posicionado directamente por `bottom`/`right`), así que no cambia respecto a v1; solo se envuelve el glifo "+" en `<span aria-hidden="true">` porque el nombre accesible ya lo aporta `aria-label` en el `<Link>` (hallazgo #5). El `boxShadow` usa el valor literal del mockup (`rgba(59,82,102,.4)`, el accent con alpha) en vez de un token `--shadow-*` (esos son grises neutros, pensados para cards/modales) — es un shadow "de marca" para el FAB, no un descuido.

## `(with-nav)/layout.tsx`

```tsx
import type { ReactNode } from "react";
import { BottomNav } from "@/components/crm/BottomNav";
import { AddContactFab } from "@/components/crm/AddContactFab";

export default function WithNavLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="flex flex-1 flex-col" style={{ paddingBottom: "calc(72px + env(safe-area-inset-bottom))" }}>
        {children}
      </div>
      <AddContactFab />
      <BottomNav />
    </>
  );
}
```

## Placeholders

`contactos/page.tsx` (dentro de `(with-nav)`) sigue el patrón exacto de `pendientes/page.tsx`/`panel/page.tsx` de MIS-7 (mismo `Badge`, mismos tokens `var(--text-primary)`/`var(--text-secondary)`, texto "Aquí se construirá la lista de contactos (MIS-9)."), con `getUser()` en vez de `requireRole()` — Contactos es compartida por ambos roles.

`contactos/nuevo/page.tsx` (fuera de `(with-nav)`, sin barra/FAB): mismo patrón, `getUser()`, texto "Aquí se construirá el formulario de añadir contacto (MIS-8)." Añade un enlace mínimo `<Link href="/contactos">‹ Volver a Contactos</Link>` — al vivir fuera de `(with-nav)` no hay barra para volver atrás. No es el back button real de MIS-8, solo evita un callejón sin salida durante la verificación de esta tarea.

## Flujo

1. Login (MIS-7) → dispatcher de `(app)/page.tsx` redirige a `/pendientes` (Carlos) o `/panel` (Marta), sin cambios.
2. La ruta cae dentro de `(with-nav)/`: pasa primero por `(app)/layout.tsx` (header + logout), luego por `(with-nav)/layout.tsx`, que monta `BottomNav` y `AddContactFab` alrededor del contenido.
3. `BottomNav` (cliente) lee `usePathname()`, resalta la pestaña que coincide.
4. Click en cualquier pestaña → navegación de Next dentro del mismo grupo `(with-nav)` → cambia `usePathname()`, se re-resalta.
5. Click en FAB (visible en las 3 pantallas) → navega a `/contactos/nuevo`, fuera de `(with-nav)` → no se renderiza `BottomNav` ni `AddContactFab` ahí.
6. Cada página sigue llamando su propio `getUser()` — un layout padre no se re-ejecuta necesariamente en navegación entre rutas hermanas.

## Verificación end-to-end

1. Login como Carlos → aterriza en `/pendientes`, barra visible, pestaña "Pendientes" resaltada.
2. Click "Contactos" → `/contactos`, placeholder MIS-9, resaltado se mueve.
3. Click "Panel" → accesible también para Carlos (guard aflojado, ver ADR), placeholder MIS-17, resaltado se mueve. Confirmar que ya NO redirige a `/pendientes`.
4. Click FAB desde cualquiera de las 3 pantallas → `/contactos/nuevo`, sin barra ni FAB, enlace de vuelta funciona.
5. Repetir 1-4 con Marta (aterriza en `/panel`; confirmar que ahora también puede entrar a `/pendientes`).
6. **DevTools modo móvil con notch simulado (ej. iPhone 14 Pro)** — verificación específica del fix de safe-area: confirmar que iconos y labels de las 3 pestañas quedan por encima de la línea del home indicator, dentro de la banda de 72px, y que el padding de safe-area se ve como espacio en blanco debajo de los labels, no como parte de su área centrada.
7. Scroll en una pantalla con contenido largo → el contenido no queda oculto bajo la barra fija.
8. Incógnito sin sesión → `/contactos` y `/contactos/nuevo` redirigen a `/login`.
9. Navegación directa por URL a `/contactos/nuevo` (sin pasar por el FAB) → carga igual, sin barra — confirma que la exclusión es estructural, no depende de cómo se llegó.
10. Teclado (Tab): las 3 pestañas y el FAB alcanzables, foco visible; la pestaña activa expone `aria-current="page"`; lector de pantalla no anuncia ruido de los SVG/glifo decorativos, solo la etiqueta de cada pestaña y "Añadir contacto" del FAB.
11. `grep -rn "requireRole" src/` tras el cambio → solo debe quedar, si acaso, en comentarios/documentación histórica, ningún import real del DAL.

## Checklist de documentación a actualizar durante la fase de código (no en esta fase de plan)

- `README.md` raíz, línea ~39 (`src/lib/auth/ DAL (getUser/requireRole)...`) → quitar la mención a `requireRole`.
- `README.md` raíz, línea ~61 (referencia a "guards de rol" en la sección de Autenticación) → matizar que el guard por rol específico de página ya no aplica a Pendientes/Panel, sigue aplicando a nivel de operaciones Convex.
- Descripción/AC de MIS-18 en Linear → registrar el cambio de autorización (ver ADR).

## Archivos afectados (resumen)

```
src/app/(app)/
  layout.tsx                       EDITAR — comentario obsoleto
  (with-nav)/layout.tsx            NUEVO
  (with-nav)/pendientes/page.tsx   MOVIDO — requireRole("rep") → getUser()
  (with-nav)/contactos/page.tsx    NUEVO — placeholder MIS-9
  (with-nav)/panel/page.tsx        MOVIDO — requireRole("supervisor") → getUser()
  contactos/nuevo/page.tsx         NUEVO — placeholder MIS-8

src/components/crm/
  BottomNav.tsx                    NUEVO
  AddContactFab.tsx                NUEVO

src/lib/auth/dal.ts                EDITAR — se elimina requireRole (NO tocar convex/lib/authz.ts)
src/proxy.ts                       EDITAR — matcher + "/contactos/:path*"
README.md                          EDITAR — durante la fase de código, ver checklist arriba
```

## Nota de desviación menor respecto a `design.md`

El principio general del design system dice "texto cuerpo nunca < 14px", pero el label de cada pestaña es de 10px en el mockup validado como referencia oficial de esta tarea. Se interpreta como un label de navegación (categoría más pequeña que "Caption", 12px, no "cuerpo") y se sigue el mockup al pixel por ser la referencia explícita de MIS-18 — anotado aquí por transparencia, no es un olvido.

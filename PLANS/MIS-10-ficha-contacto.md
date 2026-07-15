# MIS-10 — Pantalla: Ficha del contacto (v3)

## Respuesta a la auditoría de código v1 → v2

Veredicto recibido sobre el código generado: **NO-GO**. Un hallazgo mayor de responsive corregido antes de reenviar; dos menores resueltos/reconocidos.

| # | Auditoría | Resolución |
|---|---|---|
| Mayor | `ContactDetailView.tsx` — el bloque de seguimiento y la barra de acciones rápidas (3 botones "Añadir nota" / "Cambiar estado" / "Cerrar venta") usaban `display: flex` en una sola fila con `flex: 1` a partes iguales; `Button` fuerza `whiteSpace: 'nowrap'` (`src/components/ui/core/Button.jsx:80`). En móvil estrecho (320-390px) los textos largos podían desbordar o comprimirse ilegibles. | Adoptado. Ambos contenedores pasan a `flexWrap: "wrap"`. La barra de acciones usa `flex: "1 1 130px"` en cada botón (en vez de `flex: 1` puro): con eso, 2 botones caben por fila en anchos estrechos y el tercero baja a una segunda fila, estirándose a todo el ancho — sin overflow horizontal en ningún tamaño. El bloque de seguimiento pasa a `flexWrap: "wrap"` con el texto en `flex: "1 1 160px"`, dejando que el botón "Programar seguimiento" baje de línea si no cabe. |
| Menor | El plan describía el bloque de seguimiento soportando ya la variante "programado" internamente, pero el código no la scaffoldea (documentado en NOTES.md). | Reconocido, sin cambios — ya estaba documentado como desviación deliberada (`tsc` prueba que esa rama es hoy inalcanzable; ver más abajo, "Bloque de seguimiento"). No bloqueante según la propia auditoría. |
| Menor | `BottomSheet.jsx` — `createPortal(..., document.body)` se ejecuta directamente en el cuerpo del componente; si algún caller futuro montara con `open=true` inicial, fallaría en SSR (no bloqueante para MIS-10, que siempre inicia con `sheet=null`, pero es un componente genérico reutilizable por MIS-11/12/14/15). | Adoptado. Se añade una guarda `isClient` vía `React.useSyncExternalStore(() => () => {}, () => true, () => false)` — no se usó el patrón habitual `useState(false)` + `setState` en un `useEffect` porque el lint `react-hooks/set-state-in-effect` de este proyecto lo prohíbe explícitamente (lo confirmó un intento fallido durante esta misma corrección: `npm run lint` lo rechazó). El componente ahora devuelve `null` hasta que `isClient` es `true`, evitando `document.body` en el render del servidor. |

## Respuesta a la auditoría de plan v1 → v2

Veredicto recibido: **GO con condiciones**. Dos hallazgos mayores adoptados antes de generar código; el resto, aprobado tal cual.

| # | Auditoría | Resolución |
|---|---|---|
| Mayor | `BottomSheet` no cumple semántica/modal accesible: falta `role="dialog"`, `aria-modal`, etiquetado del título, gestión de foco inicial/retorno y bloqueo del fondo mientras está abierto. | Adoptado. El `BottomSheet` pasa a: `role="dialog"` + `aria-modal="true"` + `aria-labelledby` apuntando al `id` del título (`React.useId()`); al abrir, guarda `document.activeElement` y mueve el foco al primer elemento focable de la hoja; al cerrar, restaura el foco al elemento original. El fondo se bloquea aplicando el atributo nativo `inert` (HTML estándar, soportado en todos los navegadores evergreen) a los hermanos del portal en `document.body` mientras la hoja está abierta — evita reinventar un focus-trap manual: con los hermanos `inert`, ni el foco de teclado ni un lector de pantalla pueden alcanzar el contenido de detrás. Se renderiza vía `createPortal(..., document.body)` para poder aplicar `inert` a sus hermanos sin depender de la estructura interna de la página. |
| Mayor | Contradicción sobre `company`: el snippet de `getContact` lo devolvía pero la resolución propuesta decía "no mostrarlo" — como `contact` se pasa entero al cliente, el campo viajaría igual por React Flight aunque la vista no lo use. | Adoptado. `company` se elimina por completo del contrato de `getContact` (no se devuelve) en vez de devolverlo sin usar. Se reintroducirá cuando exista una vía de escritura real para ese campo. Esto también resuelve el punto abierto #1 de la versión anterior del plan. |
| Menor | La justificación de `getRequestTime()` afirmaba sin verificar que la app tiene Cache Components activado; `next.config.ts` no tiene `cacheComponents: true`. | Adoptado. Se reformula la justificación: el patrón se reutiliza porque ya existe en `contactos/page.tsx` (instalado en MIS-9) y satisface el lint `react-hooks/purity`, sin afirmar que `cacheComponents` esté activo hoy — no se toca el comentario ya mergeado de MIS-9, solo se evita repetir la misma afirmación no verificada en código nuevo. |
| Menor | Tipar `contact` a mano en `ContactDetailView` en vez de derivarlo de la función Convex, arriesgando *drift* entre `getContact` y la vista. | Adoptado. Se deriva con `NonNullable<FunctionReturnType<typeof api.contacts.getContact>>`, mismo patrón que ya usa `ContactList.tsx` (`FunctionReturnType<typeof api.contacts.listContacts>[number]`). |
| Aprobado | Ocultar solo "Cerrar venta" en `won`/`lost` (punto abierto #2 de v1) | Aprobado tal cual — el mockup (`ContactDetail.dc.html:90,425`) lo confirma. |
| Aprobado | Mostrar siempre "Contacto añadido" en el historial aunque no haya `initialNote` (punto abierto #3 de v1) | Aprobado tal cual — "razonable y veraz para el modelo actual". |
| Aprobado | Auth (`getUser` + `readSessionToken` + `fetchQuery`, sin token de cliente), `responsibleName` desde `createdBy`, sin tablas/mutations nuevas | Aprobado sin cambios. |

## Contexto

Siguiente tarea tras MIS-8 (alta) y MIS-9 (lista), ambas instaladas. La ficha del contacto es la pantalla central del CRM: desde ella Carlos y Marta ven todo lo que hay sobre una persona y acceden a las 4 acciones del día a día (añadir nota, cambiar estado, programar seguimiento, cerrar venta). El placeholder actual en `src/app/(app)/contactos/[id]/page.tsx` ya dice explícitamente "esto lo sustituye MIS-10" y solo muestra nombre/estado/teléfono/`initialNote`, sin historial ni acciones.

**Alcance de este ticket (acordado antes de escribir este plan):** MIS-10 entrega la pantalla — visualización de los datos del contacto, historial mínimo derivable del modelo de datos actual, y los 4 puntos de entrada a las acciones — pero **no** la lógica de guardado de ninguna acción. Cada acción abre un bottom-sheet con contenido "Disponible próximamente"; su formulario y su mutation reales quedan para su ticket dedicado:

- Añadir nota → MIS-11
- Cambiar estado → MIS-14 (el propio texto de MIS-10 ya remite a esta tarea)
- Programar seguimiento → MIS-12
- Cerrar venta → MIS-15

Esto mantiene la disciplina de una-tarea-un-PR ya seguida en MIS-7/8/9/18, evitando que un solo PR mezcle el alcance de 5 tickets de Linear distintos.

## `convex/contacts.ts` — extender `getContact`

La query actual (líneas 90-116) solo devuelve `{_id, name, phone, status, initialNote}`. Se añade `email`, `_creationTime` (para el evento "contacto añadido" del historial) y `responsibleName` (resuelto desde `createdBy`, el único dato de "responsable" que existe hoy — no hay campo de asignación independiente en el modelo). **`company` no se añade**: existe en el schema pero ninguna mutation lo rellena hoy y la ficha no lo muestra (ausente del mockup aprobado); devolverlo sin usarlo ensancharía el contrato de la query y, al pasarse `contact` entero al cliente, el campo viajaría igual por React Flight sin ningún consumidor (hallazgo de la auditoría de plan v1→v2). Se añadirá cuando exista una vía de escritura real:

```ts
export const getContact = query({
  args: { token: v.string(), id: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("contacts"),
      name: v.string(),
      phone: v.optional(v.string()),
      email: v.optional(v.string()),
      status: contactStatusValidator,
      initialNote: v.optional(v.string()),
      _creationTime: v.number(),
      responsibleName: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireUser(ctx, args.token); // lectura: ambos roles, sin cambios
    const contactId = ctx.db.normalizeId("contacts", args.id);
    if (!contactId) return null;
    const contact = await ctx.db.get(contactId);
    if (!contact) return null;

    // "Responsable" = quien dio de alta el contacto (createdBy, obligatorio
    // en el schema). No hay campo de asignación separado — createContact
    // solo permite rol "rep", así que en la práctica es siempre Carlos.
    const creator = await ctx.db.get(contact.createdBy);

    return {
      _id: contact._id,
      name: contact.name,
      phone: contact.phone,
      email: contact.email,
      status: contact.status,
      initialNote: contact.initialNote,
      _creationTime: contact._creationTime,
      responsibleName: creator?.name ?? "—", // defensivo: usuario borrado, caso no esperado hoy
    };
  },
});
```

No se toca `convex/schema.ts` (ninguna tabla/índice nuevo), ni `createContact`, ni `listContacts`.

## `src/lib/request-time.ts` (NUEVO) — extraído de `contactos/page.tsx`

`getRequestTime()` vive hoy sin exportar dentro de `(with-nav)/contactos/page.tsx` (líneas 15-18), usando `connection()` de `next/server` porque el lint `react-hooks/purity` prohíbe `Date.now()` directo en el cuerpo de un Server Component. La ficha necesita el mismo valor `now` (para el historial relativo), así que es la segunda vez que se necesita exactamente este workaround — se extrae ahora en vez de duplicar el comentario explicativo por segunda vez. **Nota de la auditoría de plan v1→v2**: el comentario original de MIS-9 atribuye este patrón a "Cache Components", pero `next.config.ts` no tiene `cacheComponents: true` — no se puede confirmar que ese modo esté activo hoy. No se toca el comentario ya mergeado de MIS-9 (fuera de alcance de este ticket), pero el código nuevo no repite esa afirmación sin verificar; se justifica solo por el patrón ya existente y el lint real:

```ts
import { connection } from "next/server";

// connection() + Date.now() en una función aparte: el lint react-hooks/purity
// prohíbe Date.now() directo en el cuerpo de un Server Component. Mismo
// patrón que ya usa contactos/page.tsx (MIS-9); compartido aquí entre
// contactos/page.tsx y contactos/[id]/page.tsx (MIS-10) para no duplicarlo.
export async function getRequestTime(): Promise<number> {
  await connection();
  return Date.now();
}
```

`(with-nav)/contactos/page.tsx` pasa a importarlo desde aquí en vez de definirlo localmente (cambio mínimo, mismo comportamiento).

## `src/components/ui/overlays/BottomSheet.jsx` + `.d.ts` (NUEVO)

Primer componente de overlay/modal del repo — confirmado por grep que no existe ninguno (`role="dialog"`, `Modal`, `Sheet`: cero resultados en `src/`). Sigue la misma convención que el resto de `ui/`: `.jsx` + `.d.ts` a mano, `"use client"`, estilos inline con variables CSS.

**Corrección de la auditoría de plan v1→v2 (hallazgo mayor):** la v1 de este componente no era un diálogo accesible — sin `role`/`aria-modal`, sin gestión de foco, sin bloqueo del contenido de fondo. Se corrige así:

- `role="dialog"` + `aria-modal="true"` + `aria-labelledby` apuntando al `id` del título (vía `React.useId()`).
- Al abrir: se guarda `document.activeElement` y se mueve el foco al primer elemento focable de la hoja (o a la propia hoja, `tabIndex={-1}`, si no hay ninguno).
- Al cerrar: se restaura el foco al elemento que lo tenía antes de abrir.
- El fondo se bloquea con el atributo nativo `inert` (HTML estándar) sobre los hermanos del portal en `document.body` mientras la hoja está abierta — ni el foco de teclado ni un lector de pantalla pueden alcanzar el contenido de detrás, sin necesidad de un focus-trap manual. Se renderiza con `createPortal(..., document.body)` precisamente para poder aplicar `inert` a sus hermanos sin depender de la estructura interna de la página.
- `Escape` sigue cerrando la hoja.

**Corrección de la auditoría de código v1→v2 (hallazgo menor):** guarda `isClient` para no llamar `createPortal(..., document.body)` durante el render del servidor si un futuro caller montara con `open=true` inicial. Implementada con `React.useSyncExternalStore` (no `useState` + `useEffect`, porque `react-hooks/set-state-in-effect` de este proyecto prohíbe el setState síncrono dentro de un efecto — confirmado al intentarlo). La animación usa `animationName`/`animationDuration`/`animationTimingFunction` en vez de la propiedad abreviada `animation` con `<style jsx global>`: styled-jsx no se usa en ningún otro sitio del repo y su soporte en esta versión de Next.js no está verificado, así que el `@keyframes` vive como CSS global plano en `src/app/globals.css` (ver esa sección más abajo).

```jsx
"use client";
import React from "react";
import { createPortal } from "react-dom";

/**
 * Hoja inferior genérica (bottom sheet), accesible como diálogo modal. El
 * cuerpo (children) es libre a propósito: MIS-11/12/14/15 sustituirán el
 * contenido placeholder por su formulario real sin tocar este shell.
 */
export function BottomSheet({ open, onClose, title, children }) {
  // createPortal(..., document.body) no puede ejecutarse en el servidor.
  // MIS-10 siempre abre con open=false inicial, pero como componente
  // genérico reutilizable, esta guarda lo deja seguro para un futuro caller
  // que monte con open=true.
  const isClient = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const titleId = React.useId();
  const sheetRef = React.useRef(null);
  const previousFocusRef = React.useRef(null);

  React.useEffect(() => {
    if (!open) return undefined;

    previousFocusRef.current = document.activeElement;

    const focusable = sheetRef.current?.querySelector(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    (focusable ?? sheetRef.current)?.focus();

    // Bloquea el resto de la app para foco/lectores de pantalla mientras la
    // hoja está abierta, sin reinventar un focus-trap manual.
    const siblings = Array.from(document.body.children).filter(
      (el) => el !== sheetRef.current?.parentElement,
    );
    siblings.forEach((el) => el.setAttribute("inert", ""));

    const onKeyDown = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      siblings.forEach((el) => el.removeAttribute("inert"));
      previousFocusRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open || !isClient) return null;

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 100 }}>
      <div
        onClick={onClose}
        aria-hidden="true"
        style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.45)" }}
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 101,
          background: "var(--color-surface)",
          borderRadius: "20px 20px 0 0",
          maxHeight: "92vh",
          overflowY: "auto",
          paddingBottom: "env(safe-area-inset-bottom)",
          animationName: "mis10-sheet-slide-up",
          animationDuration: ".22s",
          animationTimingFunction: "ease-out",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 4px" }} aria-hidden="true">
          <div style={{ width: 36, height: 4, borderRadius: 999, background: "var(--color-border)" }} />
        </div>
        {title && (
          <h2 id={titleId} style={{ padding: "0 20px 8px", fontSize: 17, fontWeight: 700, color: "var(--text-primary)" }}>
            {title}
          </h2>
        )}
        <div style={{ padding: "0 20px 20px" }}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
```

Sin gesto de arrastre real (el "drag handle" es puramente decorativo) — fuera de alcance explícito de este ticket. `z-index` alto porque la ficha vive fuera de `(with-nav)` (sin barra inferior/FAB con los que coordinar). `react-dom` ya es una dependencia existente (React 19/Next.js) — no se añade ninguna nueva.

## `src/app/(app)/contactos/[id]/page.tsx` (EDITAR) — Server Component

Reemplaza el placeholder completo. Mismo patrón de auth que hoy (`getUser()` + `readSessionToken()` + `fetchQuery`, nunca `useQuery` de cliente — regla de seguridad del token explícita desde la auditoría de MIS-9), añadiendo `getRequestTime()` y pasando los datos ya resueltos a un componente cliente:

```tsx
import { getUser } from "@/lib/auth/dal";
import { readSessionToken } from "@/lib/auth/cookie";
import { getRequestTime } from "@/lib/request-time";
import { api } from "../../../../../convex/_generated/api";
import { fetchQuery } from "convex/nextjs";
import Link from "next/link";
import { ContactDetailView } from "./ContactDetailView";

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await getUser();
  const { id } = await params;
  const token = await readSessionToken();
  const contact = await fetchQuery(api.contacts.getContact, { token: token!, id });
  const now = await getRequestTime();

  if (!contact) {
    return ( /* estado "no encontrado", igual que hoy, sin cambios */ );
  }

  return (
    <div className="flex flex-1 flex-col">
      <header style={{ padding: "16px 20px 0" }}>
        <Link href="/contactos" style={{ fontSize: 14, fontWeight: 600, color: "var(--color-accent)" }}>
          ‹ Contactos
        </Link>
      </header>
      <ContactDetailView contact={contact} now={now} />
    </div>
  );
}
```

## `src/app/(app)/contactos/[id]/ContactDetailView.tsx` (NUEVO, `"use client"`)

Único componente cliente de la pantalla; posee el estado de qué bottom-sheet está abierto. Recibe los datos ya resueltos como props (nunca el token), mismo patrón que `ContactList.tsx` de MIS-9.

**Corrección de la auditoría de plan v1→v2 (menor):** el tipo del contacto se derivaba a mano en la v1 de este plan, arriesgando *drift* entre `getContact` y la vista. Se deriva ahora directamente de la función Convex, igual que ya hace `ContactList.tsx` (`type Contact = FunctionReturnType<typeof api.contacts.listContacts>[number]`):

```ts
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../../../convex/_generated/api";

type Contact = NonNullable<FunctionReturnType<typeof api.contacts.getContact>>;
type SheetKind = "note" | "status" | "schedule" | "close" | null;

type ContactDetailViewProps = {
  contact: Contact;
  now: number;
};
```

Estructura, de arriba a abajo:

1. **Tarjeta principal** (`Card`): `Avatar name={contact.name}` + nombre + `StatusBadge state={contact.status}` + "Responsable: {responsibleName}" en texto pequeño gris. Teléfono como `<a href={"tel:" + contact.phone}>` tappable (solo si existe). Email solo si `contact.email` existe. `company` no forma parte del contrato (ver sección de `getContact` más arriba), así que no hay nada que renderizar para ese campo.
2. **Bloque de seguimiento**: solo la variante "Sin seguimiento programado" es alcanzable hoy — no existe ningún campo de recordatorio en el schema (eso es MIS-12). Botón "Programar seguimiento" abre `setSheet("schedule")`. Bloque completo oculto si `status` es `won` o `lost`. **Desviación encontrada al generar el código** (no prevista en el GO del plan): la v2 de este plan proponía escribir el bloque soportando ya ambas variantes internamente (con la del "seguimiento programado" sin usar todavía), pero `tsc --noEmit` demostró que, al no existir ningún dato real que la alimente, TypeScript prueba por análisis de flujo que esa rama es siempre inalcanzable (`never`) — mantenerla habría sido código muerto sin forma de probarlo. Se simplifica: hoy solo se renderiza la variante "sin seguimiento"; MIS-12 añadirá la rama "programado" cuando exista el campo real. No cambia ningún criterio de verificación (ninguno de los pasos de "Verificación end-to-end" ejercita la variante "programado"). **Corrección de la auditoría de código v1→v2 (hallazgo mayor, responsive):** el contenedor pasa a `flexWrap: "wrap"` y el texto a `flex: "1 1 160px"`, para que el botón "Programar seguimiento" baje de línea en vez de desbordar en viewports estrechos (320-390px).
3. **Barra de acciones rápidas**: "Añadir nota" (`setSheet("note")`) y "Cambiar estado" (`setSheet("status")`) siempre visibles; "Cerrar venta" (`setSheet("close")`) oculto si `status` es `won`/`lost` — se sigue el mockup de diseño (`ContactDetail.dc.html`), aprobado tal cual por la auditoría de plan v1→v2 sobre la lectura literal del texto del ticket. **Corrección de la auditoría de código v1→v2 (mismo hallazgo mayor):** el contenedor de los 3 botones pasa de `display: flex` simple a `flexWrap: "wrap"` con `flex: "1 1 130px"` en cada botón (en vez de `flex: 1` a partes iguales) — `Button` fuerza `whiteSpace: "nowrap"` (`src/components/ui/core/Button.jsx:80`), así que en 320-390px los textos largos ("Cambiar estado", "Cerrar venta") desbordaban o se comprimían ilegibles con 3 columnas iguales. Con `flex-basis: 130px`, 2 botones caben por fila y el tercero baja a una segunda fila, estirándose a todo el ancho.
4. **Historial** (`## Historial`): construido en memoria, sin tabla nueva (no existe `notes` ni un log de cambios de estado — eso es MIS-11/MIS-14/MIS-16):
   - Entrada "Contacto añadido" — siempre presente (es un hecho real), `formatRelativeTime(contact._creationTime, now)`.
   - Entrada con `contact.initialNote` (la nota de alta de MIS-8), si existe, encima de la anterior.
   - Si no hay `initialNote`: se muestra igualmente "Contacto añadido", con una leyenda secundaria bajo la lista: *"Aún no hay más actividad registrada."* Aprobado tal cual por la auditoría de plan v1→v2 ("razonable y veraz para el modelo actual"). MIS-16 sustituirá esto por el timeline real agregado (notas + cambios de estado + seguimientos completados).
5. **`BottomSheet`** montado una sola vez al final. `open={sheet !== null}`, `title` según el tipo (`"Nueva nota"`, `"Cambiar estado"`, `"Programar seguimiento"`, `"Cerrar venta"`), mismo cuerpo para los 4: texto "Disponible próximamente." + `Button variant="secondary"` "Cancelar" → `setSheet(null)`.

**Reutilizado sin cambios:** `Card`, `Button`, `Avatar`, `StatusBadge` (con `PIPELINE_STATES`, que ya cubre los 7 estados del schema incl. `won`/`lost`), `formatRelativeTime` de `src/lib/contacts/format.ts`. No se toca `convex/schema.ts`, `convex/lib/authz.ts`, ni el layout `(with-nav)`.

Los 3 puntos abiertos de la v1 de este plan (`email`/`company`, qué acciones se ocultan en `won`/`lost`, entrada de historial sin `initialNote`) quedaron resueltos en la auditoría de plan v1→v2 — ver tabla al inicio del documento. Nota adicional de la auditoría: no existe `PLANS/MIS-27*` en el repo porque las tareas de Fase 0 (diseño) son prompts para herramienta de diseño, no planes de implementación — se verificó el mockup real (`ContactDetail.dc.html`) en su lugar.

## Verificación end-to-end

1. Desde `/contactos`, pulsar un contacto abre `/contactos/<id>` con nombre, teléfono, estado, responsable.
2. Si el contacto tiene `initialNote`, aparece en el historial junto con "Contacto añadido"; si no, aparece solo "Contacto añadido" + leyenda de "sin más actividad".
3. "Añadir nota" abre el bottom-sheet con título "Nueva nota" y "Disponible próximamente"; "Cancelar", click en el backdrop y `Escape` lo cierran.
4. Igual para "Cambiar estado" y (si `status` no es `won`/`lost`) "Cerrar venta".
5. Con `status` `won` o `lost`: no aparecen "Cerrar venta" ni el bloque de seguimiento; "Añadir nota" y "Cambiar estado" siguen visibles.
6. Con `status` distinto de `won`/`lost`: aparece "Sin seguimiento programado" + botón que abre la hoja "Programar seguimiento".
7. Pulsar el teléfono dispara `tel:` en un dispositivo/emulador.
8. Ambos roles (`rep`/`supervisor`) ven la ficha igual.
9. Sin sesión, `/contactos/<id>` redirige a `/login`.
10. ID inexistente o mal formado sigue mostrando "Contacto no encontrado" (sin regresión).
11. `grep -rn "useQuery" src/app/(app)/contactos/` no da resultados.
12. `npm run build` y `npm run lint` limpios.

## Archivos afectados

```
convex/contacts.ts                                         EDITAR — getContact: + email, _creationTime, responsibleName
src/lib/request-time.ts                                     NUEVO  — getRequestTime() extraído (compartido con MIS-9)
src/app/(app)/(with-nav)/contactos/page.tsx                 EDITAR — importa getRequestTime desde src/lib/request-time.ts
src/components/ui/overlays/BottomSheet.jsx                  NUEVO  — hoja inferior genérica reutilizable
src/components/ui/overlays/BottomSheet.d.ts                 NUEVO
src/app/(app)/contactos/[id]/page.tsx                       EDITAR — reemplaza el placeholder (Server Component)
src/app/(app)/contactos/[id]/ContactDetailView.tsx          NUEVO  — cliente, estado de qué hoja está abierta
src/app/globals.css                                         EDITAR — + @keyframes mis10-sheet-slide-up (ver NOTES.md, "Desviación respecto al plan v2")
```

**Desviación encontrada al generar el código** (no prevista en el GO del plan): la animación de entrada del `BottomSheet` no usa `<style jsx global>` (styled-jsx no se usa en ningún otro sitio del repo y su soporte en esta versión de Next.js no está verificado); el `@keyframes` se define como CSS global plano en `globals.css`, mismo mecanismo que ya usa el proyecto para el resto de tokens. Detalle completo en `CODIGO/MIS-10-ficha-contacto/NOTES.md`.

Reutilizado sin cambios: `Card`, `Button`, `Avatar`, `StatusBadge`, `formatRelativeTime`. No se toca `convex/schema.ts`, `convex/lib/authz.ts`, `listContacts`, ni el layout `(with-nav)`.

## Estado

**Instalado** — ver PR de la rama `feature/mis-10-ficha-contacto`. Auditoría de código: NO-GO en v1 (responsive de la barra de acciones/bloque de seguimiento), corregido y GO en v2. Antes de instalar se desplegó `getContact` en el deployment de dev (`npx convex dev --once`) y se verificó end-to-end con Playwright contra `carlos@test.local`: login, ficha con datos reales (con y sin `initialNote`), los 3 bottom-sheets abren/cierran (Cancelar, `Escape`, click en backdrop), y sin overflow horizontal a 360px ni 320px — 19/19 comprobaciones OK, sin errores de consola. `tsc --noEmit`, `npm run lint` y `npm run build` limpios sobre el árbol ya instalado.

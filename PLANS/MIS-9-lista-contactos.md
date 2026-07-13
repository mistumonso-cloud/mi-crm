# MIS-9 — Pantalla: Lista de contactos con búsqueda en tiempo real (v2)

## Contexto

Siguiente tarea tras MIS-8 (formulario de alta, instalado). El AC pide: lista de todos los contactos ordenada por fecha de último contacto (más reciente primero), con nombre/estado/fecha de último contacto por fila; búsqueda instantánea (sin botón, sin recarga) por nombre y teléfono; pulsar un contacto abre su ficha; FAB de añadir siempre visible. El FAB y la barra inferior ya viven en el layout `(with-nav)` (MIS-18), así que esta tarea solo sustituye el placeholder de `(with-nav)/contactos/page.tsx`.

## Respuesta a la auditoría v1 → v2

| # | Auditoría | Resolución |
|---|---|---|
| Bloqueante | v1 leía `readSessionToken()` en el servidor y lo pasaba como prop a un componente cliente que llamaba `useQuery(api.contacts.listContacts, {token})` — expone el token de sesión `HttpOnly` a JS del cliente, contradiciendo la regla explícita de `PLANS/MIS-7-autenticacion-roles.md:98-102` ("sin queries reactivas de cliente para datos protegidos mientras dure este esquema", que nombra a MIS-9 explícitamente). Con XSS, ese token de 30 días permite invocar cualquier función Convex como el usuario, incluida `createContact` (rol `rep`). | Se adopta la **opción segura sin migración de auth**: `/contactos` sigue siendo Server Component con `fetchQuery` (mismo patrón que `contactos/[id]/page.tsx`); la lista ya resuelta se pasa como prop (datos, no token) a un componente cliente que solo hace *filtrado en memoria* mientras se escribe. No se abre ninguna migración de identidad — no hace falta para lo que pide este ticket. Se pierde la reactividad Convex en vivo entre pestañas/usuarios (ej. Marta no ve un alta de Carlos sin recargar); es la misma limitación ya documentada y aceptada en MIS-7 para todo el MVP mientras el token sea opaco. |
| Menor | `_creationTime` como "último contacto" | Aceptado por el auditor tal cual, con la deuda ya documentada hacia MIS-11. Sin cambios. |
| Menor | `collect()` sin paginación | Aceptado para MVP pequeño; se deja explícito como deuda si el volumen crece. |
| Menor | `formatRelativeTime` debería aceptar `now` opcional para evitar edge cases de umbrales en tests | Adoptado: firma pasa a `formatRelativeTime(ms: number, now: number = Date.now())`. |

**Decisión de datos (sin cambios respecto a v1):** no existe ningún campo de "último contacto" — la tabla `contacts` solo tiene `_creationTime`. No se añade un campo `lastContactAt` nuevo en este ticket: para un contacto que solo tiene el evento "alta" (que es lo único que existe hasta que MIS-11 introduzca notas/interacciones), la fecha de creación **es** honestamente su único y más reciente contacto. Se usa `_creationTime` como valor de ordenación y de visualización, con un comentario explícito en el código señalando que MIS-11 deberá introducir un campo real (`lastContactAt`) y backfillearlo desde `_creationTime` en ese momento.

**Decisión de búsqueda (sin cambios de fondo, cambia el mecanismo de carga):** no se usa un search index de Convex (son de tipo prefijo/token sobre un único campo, no encajan bien con "substring en nombre *o* teléfono"). Con el volumen esperado de un CRM personal en fase MVP, se trae la lista completa **vía Server Component** (`fetchQuery`, no `useQuery`) y se filtra en memoria en el cliente mientras se escribe — cero latencia de red por tecla, sin ningún round-trip adicional al teclear. Lo único que se pierde frente a v1 es el empuje automático de altas hechas en *otras* pestañas/sesiones sin recargar; el filtrado en sí sigue siendo instantáneo porque nunca dependió de la red.

## Respuesta a la auditoría de plan v2 (GO con menores)

El bloqueante de v1 quedó validado como resuelto (sin token en props, sin `useQuery` cliente, `listContacts` llama `requireUser`). Tres ajustes menores se adoptan antes de generar código:

| # | Sugerencia | Resolución |
|---|---|---|
| 1 | Búsqueda de teléfono demasiado literal — `"+34 600 000 000"` no aparece al buscar `"600000000"` | Adoptado: normalizar a solo dígitos en ambos lados (`digitsOnly(phone).includes(digitsOnly(q))`) cuando `q` contiene algún dígito; el nombre se compara aparte con `includes` simple sobre minúsculas. Se añade también normalización de acentos en el nombre (`"Lucía"` ~ `"lucia"`) vía `.normalize("NFD").replace(/[\u0300-\u036f]/g, "")` — coste marginal, mejora real de UX, sin dependencias nuevas. |
| 2 | Posible mismatch de hidratación: `formatRelativeTime(c._creationTime)` con `Date.now()` implícito puede diferir entre el render del servidor y el del cliente cerca de un umbral | Adoptado: `page.tsx` captura `const now = Date.now()` una sola vez y lo pasa como prop a `ContactList`, que lo reenvía a cada `formatRelativeTime(c._creationTime, now)`. Un único valor `now` para todo el árbol, nunca recalculado en cliente. |
| 3 | El estado vacío "Aún no hay contactos" con CTA a `/contactos/nuevo` es engañoso para Marta (rol `supervisor`, sin permiso de escritura) | Adoptado: `page.tsx` pasa `canCreate={user.role === "rep"}` a `ContactList`. Con `canCreate`, el estado vacío muestra el botón "Añadir primer contacto"; sin él, un texto de solo lectura ("Aún no hay contactos. Carlos puede darlos de alta."), coherente con el mensaje que ya usa `contactos/nuevo/page.tsx` para Marta. |

## `convex/contacts.ts` — nueva query `listContacts`

```ts
export const listContacts = query({
  args: { token: v.string() },
  returns: v.array(v.object({
    _id: v.id("contacts"),
    name: v.string(),
    phone: v.optional(v.string()),
    status: contactStatusValidator,
    _creationTime: v.number(),
  })),
  handler: async (ctx, args) => {
    await requireUser(ctx, args.token); // lectura: ambos roles, igual que getContact
    const contacts = await ctx.db.query("contacts").order("desc").collect();
    return contacts.map((c) => ({
      _id: c._id, name: c.name, phone: c.phone, status: c.status, _creationTime: c._creationTime,
    }));
  },
});
```

`.order("desc")` sobre `_creationTime` no necesita índice nuevo. Sin paginación en este ticket (deuda documentada si el volumen crece).

## `src/lib/contacts/format.ts` (nuevo) — fecha relativa en español

```ts
export function formatRelativeTime(ms: number, now: number = Date.now()): string { ... }
```

Sin dependencias nuevas (no hay `date-fns`/`dayjs` en el repo). Umbrales calcados del mockup `DESIGN/design-system/templates/contacts/Contacts.dc.html`: "ahora mismo" / "hace N minutos" / "hace N horas" / "ayer" / "hace N días" / "hace N semanas" / "hace N meses". El parámetro `now` (por defecto `Date.now()`, inyectable en tests) evita depender del reloj real para probar los umbrales. Reutilizable por MIS-10 (ficha) más adelante.

## `src/app/(app)/(with-nav)/contactos/page.tsx` (edita, reemplaza el placeholder) — Server Component

```ts
export default async function ContactosPage() {
  const user = await getUser(); // autenticación, ambos roles, sin requireRole (lectura compartida)
  const token = await readSessionToken();
  const contacts = await fetchQuery(api.contacts.listContacts, { token: token! });
  const now = Date.now(); // capturado una vez, pasado como prop — evita mismatch de hidratación (ver auditoría GO, #2)
  return <ContactList contacts={contacts} now={now} canCreate={user.role === "rep"} />;
}
```

Mismo patrón exacto que `contactos/[id]/page.tsx` (`getUser()` + `readSessionToken()` + `fetchQuery`) — no se introduce ningún mecanismo nuevo de auth.

## Componente cliente `src/app/(app)/(with-nav)/contactos/ContactList.tsx` (nuevo, `"use client"`)

- **Props: `{ contacts: Contact[]; now: number; canCreate: boolean }`** — datos ya resueltos, nunca el token. Sin `useQuery`, sin `convex/react` en este archivo.
- Barra de búsqueda: `Input` (`src/components/ui/forms/Input.jsx`) reutilizado tal cual, con `prefix` = icono lupa inline SVG, `size="sm"`, `placeholder="Buscar por nombre o teléfono"`, controlado con `useState`. Botón "×" para limpiar cuando hay texto, superpuesto sobre `Input` (detalle de implementación menor).
- Filtrado (ajustado por auditoría GO, #1): `useMemo` sobre `contacts` con `q = query.trim().toLowerCase()`; si `q` vacío devuelve todo; si no:
  - nombre: `normalizeText(c.name).includes(normalizeText(q))`, con `normalizeText` = minúsculas + `.normalize("NFD").replace(/[\u0300-\u036f]/g, "")` (sin acentos).
  - teléfono: `digitsOnly(c.phone ?? "").includes(digitsOnly(q))`, con `digitsOnly` = `.replace(/\D/g, "")`. Si `digitsOnly(q)` es `""` (búsqueda sin dígitos), esta rama no aporta coincidencias falsas positivas (`"".includes("")` se evita comprobando `digitsOnly(q).length > 0` antes de aplicarla).
  - coincide si nombre O teléfono coinciden.
- Estados vacíos (según `emptyNoContacts` / `emptySearch` / `showList` del mockup):
  - `contacts.length === 0` → si `canCreate`, "Aún no hay contactos" + botón a `/contactos/nuevo`; si no (Marta), "Aún no hay contactos. Carlos puede darlos de alta." sin botón (ajustado por auditoría GO, #3).
  - `q !== "" && filtered.length === 0` → `Sin resultados para "{query}"`.
  - si no, lista.
- Fila de contacto: `Link href="/contactos/${c._id}"`, con `Avatar` (`src/components/ui/core/Avatar.jsx`, reutilizado tal cual), nombre, `StatusBadge state={c.status}` (`src/components/ui/feedback/StatusBadge.jsx`, reutilizado tal cual), y `formatRelativeTime(c._creationTime, now)` en gris secundario debajo (ajustado por auditoría GO, #2). Sin chip "Hoy" (`pendingToday`) — depende de MIS-13, fuera de alcance.
- Cabecera: "Contactos" + contador `{contacts.length} contactos`.

## Verificación end-to-end

1. Con contactos existentes (los de prueba de MIS-8 + nuevos), `/contactos` lista todos, orden más reciente primero.
2. Escribir en la búsqueda filtra al vuelo, sin parpadeo ni recarga, por nombre y por fragmento de teléfono.
3. Borrar la búsqueda restaura la lista completa.
4. Búsqueda sin resultados → mensaje "Sin resultados para...".
5. Pulsar un contacto navega a `/contactos/<id>`.
6. FAB visible y funcional desde esta pantalla.
7. Añadir un contacto nuevo desde el FAB y volver a `/contactos` (navegación normal, no misma pestaña sin recargar) → aparece el primero en la lista. **No** se verifica push en vivo entre pestañas — limitación conocida y aceptada (ver tabla de auditoría).
8. Ambos roles ven la lista igual.
9. Sin sesión, `/contactos` redirige a `/login`.
10. Cuenta/tabla sin contactos → Carlos ve "Aún no hay contactos" + botón; Marta ve el mismo texto sin botón.
11. Buscar `"600000000"` encuentra un contacto guardado como `"+34 600 000 000"`; buscar `"lucia"` encuentra `"Lucía Fernández"`.
12. `grep -rn "useQuery" src/app/(app)/(with-nav)/contactos/` no da resultados — confirma que no se coló el patrón v1.
13. `npm run build` y `npm run lint` limpios.

## Archivos afectados

```
convex/contacts.ts                                    EDITAR — + listContacts
src/lib/contacts/format.ts                             NUEVO — formatRelativeTime
src/app/(app)/(with-nav)/contactos/page.tsx             EDITAR — reemplaza placeholder MIS-9 (Server Component)
src/app/(app)/(with-nav)/contactos/ContactList.tsx      NUEVO — cliente, recibe contacts ya resueltos
```

Reutilizado sin cambios: `Input`, `Avatar`, `StatusBadge`, `AddContactFab`, `BottomNav`. No se toca `convex/schema.ts`, `convex/lib/authz.ts`, `src/proxy.ts`, ni el mecanismo de sesión de MIS-7.

## Estado

**Instalado** — ver PR de la rama `feature/mis-9-lista-contactos`. Código generado y auditado con GO (código), con dos ajustes adicionales aplicados durante la instalación no previstos en la auditoría de código:

- `import type { api }` en `ContactList.tsx` (ya recomendado por la auditoría de código, aplicado antes de instalar).
- `minHeight: 0` en los contenedores flex de la lista (ya recomendado por la auditoría de código, aplicado antes de instalar).
- `Date.now()` movido a una función `getRequestTime()` aparte (con `connection()` de `next/server` antes) en `page.tsx`: esta versión de Next.js usa Cache Components, y el lint `react-hooks/purity` rechaza llamar a `Date.now()` directamente en el cuerpo de un Server Component. No estaba previsto en ninguna auditoría — apareció al ejecutar `npm run lint` durante la instalación.

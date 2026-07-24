# MIS-255 — Aviso de contacto duplicado al crear

> **Estado**: **Instalado en producción** (no toca Convex, así que "producción" aquí es simplemente el merge a `main` — sin paso de `convex deploy`). PR #27 fusionado a `main` (2026-07-24). Ver PR de la rama `feature/mis-255-aviso-duplicado`.

## Contexto

Mejora de la Fase 2 — Gestión de contactos, no estaba en el PRD original. Hoy, al dar de alta un contacto (`/contactos/nuevo`), no hay ninguna comprobación de que el teléfono ya pertenezca a otro contacto. En este negocio la misma persona suele escribir primero por Instagram y luego por WhatsApp, o vuelve a preguntar meses después — sin aviso, Carlos acaba creando fichas repetidas de la misma persona, partiendo el historial de actividad entre dos fichas y dejando el estado del pipeline incoherente (una ficha en "Negociando", la otra en "Lead nuevo" sin que nadie lo note).

### Texto literal del ticket (Linear, `MIS-255`)

> Al crear un contacto, si el **teléfono ya existe** en otro contacto, mostrar un **aviso de posible duplicado** antes de guardar.
>
> **Por qué (mejora — no estaba en el PRD original):** en este negocio la misma persona escribe por Instagram y por WhatsApp, o vuelve a preguntar meses después. Sin aviso, Carlos crea fichas repetidas del mismo cliente y el CRM pierde fiabilidad (historial partido, estado incoherente). Un aviso simple mantiene los datos limpios desde el principio.
>
> **Diseño:**
> * Al escribir el teléfono (o al guardar) en «Añadir contacto», si hay coincidencia, avisar: «Ya existe un contacto con este teléfono: [nombre]».
> * Carlos puede **abrir la ficha existente** o **crear el contacto igualmente** (el aviso no bloquea, solo advierte).
> * Comparar por teléfono normalizado (ignorar espacios, guiones, prefijo).
>
> **Criterio de aceptación:**
> * Al introducir un teléfono ya registrado, se muestra el aviso con el nombre del contacto existente.
> * Se puede abrir la ficha existente desde el aviso.
> * Se puede crear el contacto igualmente si Carlos lo decide.
> * La comparación tolera diferencias de formato (espacios, guiones, prefijo).

### Punto de partida: qué ya existe y qué falta

Verificado leyendo el código real, no asumido:

- `src/app/(app)/contactos/nuevo/page.tsx` (Server Component): hoy solo hace el guard de rol (`user.role === "rep"`) y renderiza `<NewContactForm />` sin props — no hace ningún fetch de datos.
- `src/app/(app)/contactos/nuevo/NewContactForm.tsx` (Client Component): **todos** los campos (nombre, teléfono, email, canal, notas) son no controlados — sin `value`/`onChange`, sin `useState` en ningún sitio. Un comentario explícito documenta que el botón "Guardar" depende solo de `isPending`, nunca de estado derivado del cliente — filosofía de progressive enhancement deliberada ("con JS sin hidratar, un disabled basado en useState nace en true para siempre"). Envío vía `useActionState(createContactAction, initialState)`.
- `src/lib/contacts/actions.ts::createContactAction` — sin ninguna comprobación de duplicados hoy. En éxito hace `redirect(/contactos/${result.id})` (fuera del try/catch) — no existe un camino de "quedarse en la página tras guardar".
- `convex/contacts.ts::createContact` — solo valida longitud/obligatoriedad de nombre/teléfono/email/nota; no comprueba si el teléfono ya existe en otro documento.
- `convex/contacts.ts::listContacts` — **ya devuelve** `{_id, name, phone, status, _creationTime}` de todos los contactos, en un `.collect()` sin paginar ni índice (mismo criterio ya aceptado para una tabla pequeña, ~15-20 filas hoy — ver su propio comentario). Ya se usa así en `ContactList.tsx` (MIS-9) para la búsqueda en tiempo real por nombre/teléfono.
- `convex/schema.ts`: la tabla `contacts` solo tiene `.index("by_status", ["status"])` — nada sobre `phone`. `phone` es `v.optional(v.string())` a nivel de schema (la obligatoriedad se aplica en la capa de aplicación, en `createContact`).

### Restricción arquitectónica confirmada (no se reabre)

Este repo tiene una decisión deliberada, ya documentada en `PLANS/MIS-17-panel-oportunidades.md` (decisión 1) y confirmada de nuevo aquí por grep: **nunca se usa `useQuery` de Convex desde un Client Component**. El token de sesión vive únicamente en una cookie `HttpOnly`; pasarlo a un componente cliente para alimentar una query en vivo lo filtraría a estado de React / tráfico de WebSocket, justo lo que esa cookie está diseñada a evitar. Todo lo "en vivo" en este repo se resuelve con una Server Action + `refresh()`, o con `router.refresh()` periódico (panel de Marta) — nunca con una suscripción de cliente.

**Consecuencia directa para este ticket**: el aviso de duplicado no puede ser una consulta a Convex por cada tecla que pulsa Carlos. Tiene que comparar contra datos ya obtenidos en el servidor (la misma `listContacts` que ya existe), no contra una query nueva en vivo.

### Precedentes de UI ya existentes (para no inventar un patrón nuevo)

- No existe ningún modal/diálogo de "dos acciones" en el repo. El único `BottomSheet` (`src/components/ui/overlays/BottomSheet.jsx`) se usa exclusivamente dentro de la ficha del contacto (`ContactDetailView.tsx`, para nota/estado/seguimiento/cierre/edición) — nunca en `/contactos/nuevo`, que es una página completa, no un overlay.
- El único precedente de aviso "informativo, no bloqueante" (no un error) es la tarjeta de "Próximo seguimiento" en `ContactDetailView.tsx` (líneas ~138-158): un `<Card>` con `background: var(--color-warning-bg)` y texto en `var(--color-warning-fg)`, persistente, sin gatear ninguna acción. Tokens ya definidos en `src/styles/tokens/colors.css`: `--color-warning-bg: #FEF3C7`, `--color-warning-fg: #B45309`.
- La navegación a la ficha de un contacto siempre es `<Link href={`/contactos/${id}`}>`, nunca `router.push`.
- No existe normalización de teléfono para comparar duplicados en ningún sitio del repo. Solo hay un `digitsOnly` **privado** en `ContactList.tsx` (quita todo lo que no sea dígito) usado para búsqueda por substring — semántica distinta a una clave de igualdad exacta para duplicados, y no exportado desde ningún sitio.

## Decisiones fijadas

1. **`page.tsx` obtiene la lista completa de contactos y la pasa como prop a `NewContactForm`.** Reutiliza literalmente `listContacts` (la misma query que ya usa `ContactList.tsx`) — sin query ni índice nuevos en Convex. Se pide siempre, independientemente del rol (mismo criterio de "fetch primero, rama de rol después" que ya usan otras páginas del repo) — no hay fuga de datos hacia Marta: `<NewContactForm>` nunca se instancia en su rama del `if`, así que la prop nunca se serializa hacia su navegador aunque el fetch se haga incondicionalmente.

2. **El campo teléfono gana un `onChange` que espeja el valor a un `useState` nuevo, usado únicamente para calcular el aviso — sin `value=`, sigue sin ser un input controlado.** Es la única desviación de la filosofía "todo no controlado" del archivo, y se reduce al mínimo posible: no se transforma nunca lo que se re-inyecta en el campo (no hay `value=` que pelee con lo que el usuario teclea), así que no hay ninguna diferencia funcional entre esto y un input controlado completo — pero mantener el `<input>` sin `value=` es más consistente con el resto del archivo y evita cualquier duda sobre inputs que cambian de no-controlado a controlado. Sin JS hidratado, el campo funciona exactamente igual que hoy (el aviso es puramente aditivo, nunca condición para escribir o enviar).

3. **Nuevo archivo `src/lib/contacts/phone.ts` con `phoneKey(phone: string): string`.** Quita todo lo que no sea dígito y, si quedan más de 9, se queda con los últimos 9 — los números de teléfono españoles (móvil o fijo, sin distinción de longitud por tipo de línea) tienen siempre 9 dígitos, así que comparar los últimos 9 hace que `"+34600000000"`, `"34 600 000 000"`, `"0034-600-000-000"` y `"600000000"` normalicen todos al mismo valor, sin necesitar un parser de teléfono real (tipo libphonenumber) — el AC solo pide tolerar espacios/guiones/prefijo, no validación de formato completa. Por debajo de 9 dígitos devuelve `""` (no los dígitos parciales tal cual): evita avisos prematuros mientras Carlos sigue escribiendo, y evita un falso aviso si algún contacto antiguo tuviera un teléfono corto o mal formado (`phone` no tiene regex de formato server-side, solo un tope de longitud). Vive en su propio archivo, no en `src/lib/contacts/format.ts` (que son formatters de *salida*, ms → texto) — esto es una clave de comparación para lógica de negocio, categoría distinta; mismo criterio de un concepto por archivo pequeño que ya usan `channel.ts`/`status.ts` en el mismo directorio. No reutiliza el `digitsOnly` privado de `ContactList.tsx` (semántica de búsqueda por substring, no de igualdad exacta) — se duplica la línea de quitar no-dígitos a propósito, mismo criterio ya aceptado en el repo para pequeñas normalizaciones sin fuente compartida entre consumidores distintos.

4. **Colisión entre dos personas reales distintas:** para un número español completo, la clave de 9 dígitos *es* el número nacional entero — dos contactos con la misma clave son, por definición, el mismo teléfono, no una coincidencia espuria de "últimos 9 dígitos" entre números distintos. Único caso de borde aceptado, no resuelto: mientras Carlos teclea un número con prefijo (p. ej. va por `"+34 600 0"`, 8 dígitos, sin clave todavía), hay un instante fugaz en que la cadena de dígitos en curso podría coincidir por casualidad con un contacto no relacionado — se autocorrige en la siguiente tecla (`useMemo` se reevalúa en cada render) y no merece una solución con parsing real de teléfono para un aviso que ya de por sí no bloquea nada.

5. **Tarjeta de aviso con el mismo estilo que "Próximo seguimiento"** (`Card` + `--color-warning-bg`/`--color-warning-fg`), bajo el campo teléfono, solo cuando `useMemo` encuentra coincidencia: «Ya existe un contacto con este teléfono: **{nombre}**» + `<Link href="/contactos/{id}">Ver ficha existente →</Link>`.

6. **El botón "Guardar" no cambia.** Nunca estuvo condicionado a nada del cliente más que `isPending` — "crear el contacto igualmente" (AC) ya funciona sin tocar el submit ni `createContactAction`.

7. **Sin cambios en `createContactAction`, `convex/contacts.ts` ni `convex/schema.ts`.** El AC enmarca esto como un aviso de UI, no como una restricción de integridad de datos (no pide impedir duplicados, solo advertir). No se añade comprobación de servidor, no se añade índice por teléfono, no se ensancha ningún contrato sin consumidor.

## `src/lib/contacts/phone.ts` (NUEVO)

```ts
// Normalización de teléfono para detectar posibles duplicados al crear un
// contacto (MIS-255, AC: "comparar por teléfono normalizado — ignorar
// espacios, guiones, prefijo"). Vive en su propio archivo, no en
// src/lib/contacts/format.ts: format.ts son formatters de SALIDA (fecha,
// hora, importe -> texto para mostrar); esto es una clave de comparación
// para lógica de negocio (¿es "el mismo" teléfono que otro ya guardado?),
// categoría distinta — mismo criterio de un concepto por archivo pequeño
// que ya usa este directorio (channel.ts para el enum de canal, status.ts
// para los enums de estado).
//
// No reutiliza el `digitsOnly` privado de ContactList.tsx (MIS-9): aquel
// existe para búsqueda por SUBSTRING mientras se escribe en el buscador de
// la lista (cualquier fragmento de dígitos que aparezca dentro del
// teléfono cuenta como acierto). Esto necesita una CLAVE DE IGUALDAD
// EXACTA para duplicados — semántica distinta, aunque ambas empiecen
// quitando lo que no sea dígito. Se duplica esa línea a propósito, mismo
// criterio ya aceptado en el repo para pequeñas normalizaciones sin fuente
// compartida entre módulos (p.ej. contactChannelValidator duplicado entre
// convex/schema.ts y convex/contacts.ts).

// Longitud de un número de teléfono español completo — igual para móvil y
// fijo (España no distingue longitud por tipo de línea, a diferencia de
// otros países). Mismo supuesto de un solo país ya aceptado en este
// directorio (ver timeZone "Europe/Madrid" fija en format.ts).
const SPAIN_PHONE_DIGITS = 9;

// Deja solo los dígitos y, si hay más de 9, se queda con los últimos 9 —
// el número nacional real, sea cual sea lo que venga delante (+34, 0034,
// un 0 de marcación de más...). Así "+34600000000", "34 600 000 000",
// "0034-600-000-000" y "600000000" normalizan los 4 al mismo valor, sin
// necesitar un parser de prefijos internacionales real (tipo
// libphonenumber) — el AC solo pide tolerar espacios/guiones/prefijo, no
// validación de formato completa.
//
// Por debajo de 9 dígitos se devuelve "" (no los dígitos parciales tal
// cual): un número de España real nunca tiene una coincidencia válida por
// debajo de esa longitud, y devolver el prefijo parcial arriesgaba (a)
// avisos prematuros mientras Carlos todavía está escribiendo, y (b) un
// falso aviso si algún contacto antiguo tuviera un teléfono igual de
// corto/mal formado (phone es v.optional(v.string()) en el schema, sin
// regex de formato server-side — ver PHONE_MAX en convex/contacts.ts). El
// llamador (NewContactForm.tsx) trata "" como "todavía sin clave, no
// comprobar".
//
// Colisión entre dos personas reales distintas: para un número de España
// completo, esta clave ES el número entero — dos contactos con la misma
// clave son, por definición, el mismo teléfono, no una coincidencia de
// "últimos 9 dígitos" entre números distintos.
export function phoneKey(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < SPAIN_PHONE_DIGITS) return "";
  return digits.slice(-SPAIN_PHONE_DIGITS);
}
```

## `src/app/(app)/contactos/nuevo/page.tsx` (EDITAR)

```tsx
import Link from "next/link";
import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../../convex/_generated/api";
import { getUser } from "@/lib/auth/dal";
import { readSessionToken } from "@/lib/auth/cookie";
import { NewContactForm } from "./NewContactForm";

// Placeholder de MIS-18 sustituido por el formulario real (MIS-8). Solo
// "rep" (Carlos) puede crear contactos — ver requireRole en
// convex/contacts.ts::createContact. Se comprueba el rol aquí para mostrar
// un mensaje claro a Marta en vez de dejarle rellenar un formulario
// condenado a fallar en el servidor. Desde MIS-20, el FAB de
// (with-nav)/layout.tsx ya no trae hasta aquí para Marta (se oculta si
// user.role !== "rep") — este guard pasa a ser defensa en profundidad para
// quien llegue por navegación directa a la URL (bookmark, escritura
// manual), no la única barrera como antes.
export default async function NuevoContactoPage() {
  const user = await getUser();
  const token = await readSessionToken(); // getUser() ya garantiza sesión válida aquí — mismo patrón que contactos/[id]/page.tsx

  // MIS-255: lista completa de contactos existentes, para el aviso de
  // posible duplicado por teléfono dentro del propio formulario
  // (NewContactForm, useMemo sobre `existingContacts`). Reutiliza
  // literalmente la MISMA query que ya usa /contactos (ContactList.tsx) —
  // sin query nueva, sin índice nuevo: listContacts ya devuelve {_id,
  // name, phone, status, _creationTime} de cada contacto sin paginar (ver
  // comentario en convex/contacts.ts). Se pide también cuando
  // user.role !== "rep" (Marta, caso de navegación directa a la URL):
  // mismo criterio de "fetch primero, rama después" ya usado en
  // contactos/[id]/page.tsx, en vez de complicar este archivo con un
  // fetch condicional. No hay fuga hacia Marta por esto: <NewContactForm>
  // no se instancia en su rama, así que existingContacts nunca se
  // serializa en el payload de RSC que llega a su navegador.
  const existingContacts = await fetchQuery(api.contacts.listContacts, { token: token! });

  return (
    <div className="flex flex-1 flex-col" style={{ padding: "16px 20px" }}>
      <Link
        href="/contactos"
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: "var(--color-accent)",
          textDecoration: "none",
          alignSelf: "flex-start",
          marginBottom: 16,
        }}
      >
        ‹ Cancelar
      </Link>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)", marginBottom: 20 }}>
        Nuevo contacto
      </h1>
      {user.role === "rep" ? (
        <NewContactForm existingContacts={existingContacts} />
      ) : (
        <p style={{ fontSize: 14, color: "var(--text-secondary)" }}>
          Solo el rol operativo puede añadir contactos. Tu cuenta tiene acceso de lectura.
        </p>
      )}
    </div>
  );
}
```

## `src/app/(app)/contactos/nuevo/NewContactForm.tsx` (EDITAR)

```tsx
"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../../../convex/_generated/api";
import { Button } from "@/components/ui/core/Button";
import { Card } from "@/components/ui/core/Card";
import { Input } from "@/components/ui/forms/Input";
import { Select } from "@/components/ui/forms/Select";
import { CONTACT_CHANNEL_OPTIONS } from "@/lib/contacts/channel";
import { phoneKey } from "@/lib/contacts/phone";
import { createContactAction, type CreateContactState } from "@/lib/contacts/actions";

const initialState: CreateContactState = undefined;

// Mismo patrón que el `Contact` local de ContactList.tsx y de
// ContactDetailView.tsx (ninguno de los dos exporta el suyo — cada
// consumidor de una query redeclara su propio alias junto al punto de
// uso). Se redeclara aquí a propósito, no se importa de ningún sitio.
type Contact = FunctionReturnType<typeof api.contacts.listContacts>[number];

// "disabled" del botón depende solo de isPending (envío en curso), no de
// estado de cliente derivado de los campos: con JS sin hidratar, un
// "disabled" basado en useState nace en true para siempre y deja el
// formulario inutilizable, pese a que las Server Actions de Next soportan
// envío progresivo sin JS. `required` nativo + la validación real del
// servidor son la única autoridad. El aviso de duplicado de MIS-255 (más
// abajo) respeta esto: es puramente informativo, nunca gatea "Guardar".
export function NewContactForm({ existingContacts }: { existingContacts: Contact[] }) {
  const [state, formAction, isPending] = useActionState(createContactAction, initialState);

  // MIS-255: espejo de e.target.value SOLO para alimentar el aviso de
  // duplicado — no la fuente de verdad del campo. El <input> de teléfono
  // sigue sin `value=` (no controlado por React), mismo espíritu de
  // progressive enhancement que el resto de este formulario (ver
  // comentario de arriba): sin JS hidratado no hay onChange que alimente
  // este estado, y el campo funciona exactamente igual que hoy — esto es
  // una mejora puramente aditiva, nunca una condición para poder escribir
  // o enviar el formulario.
  const [phone, setPhone] = useState("");

  // Aviso no bloqueante de posible contacto duplicado por teléfono,
  // recalculado en cada tecla. Comparación por clave normalizada
  // (phoneKey — ver src/lib/contacts/phone.ts), no por el string crudo,
  // para tolerar espacios/guiones/prefijo tal como pide el AC.
  const duplicate = useMemo(() => {
    const key = phoneKey(phone);
    if (!key) return null; // menos de 9 dígitos todavía — ver phoneKey
    return existingContacts.find((c) => c.phone && phoneKey(c.phone) === key) ?? null;
  }, [phone, existingContacts]);

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Input
        label="Nombre completo"
        name="name"
        placeholder="Nombre y apellido"
        autoFocus
        autoComplete="name"
        required
        maxLength={120}
        disabled={isPending}
        error={state?.field === "name" ? state.error : null}
      />
      <Input
        label="Teléfono / WhatsApp"
        name="phone"
        type="tel"
        placeholder="+34 600 000 000"
        autoComplete="tel"
        required
        maxLength={40}
        disabled={isPending}
        error={state?.field === "phone" ? state.error : null}
        onChange={(e) => setPhone(e.target.value)}
      />
      {duplicate && (
        // Mismo patrón visual que la card de "Próximo seguimiento" de
        // ContactDetailView.tsx (background var(--color-warning-bg), texto
        // var(--color-warning-fg)) — único precedente en el repo de
        // "informativo, no bloqueante". No gatea "Guardar": isPending
        // sigue siendo la única condición del botón, tal como pide el AC
        // ("el aviso no bloquea, solo advierte").
        <Card
          padding="md"
          style={{ background: "var(--color-warning-bg)", display: "flex", flexDirection: "column", gap: 6 }}
        >
          <p style={{ fontSize: 13, color: "var(--color-warning-fg)" }}>
            Ya existe un contacto con este teléfono: <strong>{duplicate.name}</strong>
          </p>
          <Link
            href={`/contactos/${duplicate._id}`}
            style={{ fontSize: 13, fontWeight: 600, color: "var(--color-accent)", textDecoration: "none" }}
          >
            Ver ficha existente →
          </Link>
        </Card>
      )}
      <Input
        label={
          <>
            Email <span style={{ color: "var(--text-tertiary)", fontWeight: 400 }}>(opcional)</span>
          </>
        }
        name="email"
        type="email"
        placeholder="correo@ejemplo.com"
        autoComplete="email"
        maxLength={254}
        disabled={isPending}
        error={state?.field === "email" ? state.error : null}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <Select
          label={
            <>
              Canal de captación <span style={{ color: "var(--text-tertiary)", fontWeight: 400 }}>(opcional)</span>
            </>
          }
          name="channel"
          options={[{ value: "", label: "Selecciona un canal (opcional)" }, ...CONTACT_CHANNEL_OPTIONS]}
          defaultValue=""
          disabled={isPending}
        />
        {state?.field === "channel" && (
          <span style={{ fontSize: 12, color: "var(--color-danger-fg)" }}>{state.error}</span>
        )}
      </div>
      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
          Notas iniciales <span style={{ color: "var(--text-tertiary)", fontWeight: 400 }}>(opcional)</span>
        </span>
        <textarea
          name="initialNote"
          placeholder="De dónde viene, qué preguntó, cualquier detalle..."
          disabled={isPending}
          rows={3}
          maxLength={2000}
          style={{
            padding: "10px 12px",
            border: "1px solid var(--color-border-strong)",
            borderRadius: "var(--radius-md)",
            fontFamily: "var(--font-sans)",
            fontSize: 14,
            color: "var(--text-primary)",
            background: "var(--color-surface)",
            resize: "none",
          }}
        />
        {state?.field === "initialNote" && (
          <span style={{ fontSize: 12, color: "var(--color-danger-fg)" }}>{state.error}</span>
        )}
      </label>

      {state?.error && !state.field && (
        <div role="alert" style={{ fontSize: 13, color: "var(--color-danger-fg)" }}>
          {state.error}
        </div>
      )}

      <Button type="submit" full size="lg" disabled={isPending}>
        {isPending ? "Guardando…" : "Guardar"}
      </Button>
    </form>
  );
}
```

## Fuera de alcance (explícito)

- **Comprobación de servidor / restricción de unicidad en `createContact`** — el AC pide un aviso, no un bloqueo ni una regla de integridad de datos. Si se necesitara en el futuro, es un ticket aparte.
- **`updateContact` (editar un contacto existente, MIS-252)** — el ticket dice explícitamente "al crear un contacto"; el propio plan de MIS-252 ya dejó esto fuera de su alcance.
- **Parser de teléfono real (tipo libphonenumber) o soporte multi-país** — el AC solo pide tolerar espacios/guiones/prefijo; el supuesto de números españoles de 9 dígitos ya es el mismo que usa el resto del repo (placeholder `+34 600 000 000`, zona horaria fija "Europe/Madrid" en `format.ts`).
- **Nuevo test e2e dedicado** — no se añade en este plan. Se revisaron `full-flow.spec.ts`/`edge-cases.spec.ts`: usan `getByLabel("Teléfono / WhatsApp").fill(...)`, que sigue disparando el `onChange` nuevo sin romperse. Recomendado como mejora futura no bloqueante.
- **`ContactList.tsx` / búsqueda de la lista** — sin cambios; su `digitsOnly` privado no se toca ni se comparte con `phoneKey` (semánticas distintas, ver decisión 3).

## Verificación end-to-end

1. `npx tsc --noEmit`, `npm run lint`, `npm run build` limpios.
2. Crear un contacto con teléfono `600111222`. Ir a "Añadir contacto" de nuevo y escribir `+34 600 111 222` (mismo número, con prefijo y espacios) → aparece el aviso «Ya existe un contacto con este teléfono: [nombre]» en cuanto se completan los 9 dígitos relevantes.
3. Pulsar "Ver ficha existente →" → navega a `/contactos/{id}` del contacto ya creado.
4. Volver a "Añadir contacto", repetir el teléfono, ignorar el aviso y pulsar "Guardar" → el contacto nuevo se crea igualmente (sin bloqueo), redirige a su propia ficha nueva.
5. Teléfono sin coincidencia (número no usado antes) → no aparece ningún aviso.
6. Tras ver el aviso, borrar dígitos del teléfono → el aviso desaparece solo (reactividad de `useMemo`, sin recargar).
7. Escribir un teléfono de menos de 9 dígitos → sin aviso (clave vacía, ver `phoneKey`).
8. Reejecutar `full-flow.spec.ts`/`edge-cases.spec.ts` (Playwright) — deben seguir en verde sin modificarlos.
9. Login como Marta → `/contactos/nuevo` sigue mostrando el mensaje de solo lectura (sin cambios en el guard de rol; `existingContacts` se pide pero `NewContactForm` no se instancia en su rama).
10. Viewport móvil 320-375px: la tarjeta de aviso no desborda (mismo `Card`/`padding="md"` ya usado en otras pantallas a este ancho).

## Archivos afectados

| Archivo | Tipo |
|---|---|
| `src/lib/contacts/phone.ts` | Nuevo |
| `src/app/(app)/contactos/nuevo/page.tsx` | Editar |
| `src/app/(app)/contactos/nuevo/NewContactForm.tsx` | Editar |

No se toca: `convex/contacts.ts`, `convex/schema.ts`, `src/lib/contacts/actions.ts`, `src/lib/contacts/format.ts`, `ContactList.tsx`, ningún test e2e.

## Puntos abiertos (no bloqueantes)

- Caso de borde de colisión fugaz mientras se teclea un prefijo largo (ver decisión 4) — autocorrige en la siguiente tecla, no se resuelve con parsing real.
- Si el volumen de contactos creciera mucho, `listContacts` (ya sin paginar desde MIS-9) seguiría siendo el cuello de botella antes que este ticket — no es una regresión introducida aquí.
- Sin e2e dedicado (ver "Fuera de alcance") — recomendado como mejora futura.

## Estado

**Auditoría de plan:** GO sin blockers ni majors. Sugerencias no bloqueantes adoptadas como follow-up (no en este ticket): añadir un e2e dedicado (teléfono duplicado con formato distinto, enlace a ficha existente, guardar igualmente); si el producto pasa a soportar teléfonos no españoles, mover la normalización a un ticket aparte con parser real; la falta de paginación en `listContacts` es deuda de MIS-9, no de este ticket.

**Implementado** en la rama `feature/mis-255-aviso-duplicado`. Cambios reales: `src/lib/contacts/phone.ts` (nuevo), `src/app/(app)/contactos/nuevo/page.tsx`, `src/app/(app)/contactos/nuevo/NewContactForm.tsx`.

Evidencia real de verificación:

1. **`npx tsc --noEmit`**: limpio.
2. **`npm run lint`**: 0 errores (1 warning preexistente en `Avatar.jsx`, no introducido por este cambio).
3. **`npm run build`**: compilación de producción correcta, las 7 rutas generadas sin error.
4. **Suite Playwright completa** (`npx playwright test`): **15/15 tests existentes en verde**, sin modificarlos — incluida la comprobación de gating de rol de Marta en `/contactos/nuevo` (confirma indirectamente que no hay fuga de `existingContacts` hacia su rama).
5. **Verificación manual real de los comportamientos nuevos**, con 2 tests Playwright temporales añadidos a `edge-cases.spec.ts`, ejecutados y luego **revertidos** (`git checkout`) antes de commitear — decisión explícita de no añadir e2e dedicado permanente (ver Fuera de alcance), pero sí verificar con evidencia real:
   - Contacto existente con teléfono `+34 600 XXX XXX` → en "Añadir contacto", escribir el mismo número sin prefijo y con guiones (`600-XXX-XXX`) → aparece el aviso «Ya existe un contacto con este teléfono: [nombre]» con el enlace correcto (`href="/contactos/{id}"`) → **crear igualmente** (Guardar) → el contacto nuevo se crea sin bloqueo, redirige a su propia ficha.
   - Teléfono sin coincidencia → sin aviso. Teléfono coincidente → aviso. Borrar el campo → el aviso desaparece solo (reactividad de `useMemo`, sin recargar).

**Auditoría de código:** GO. Sin blockers ni majors. Sugerencias no bloqueantes adoptadas como follow-up (no en este ticket): e2e dedicado para duplicado con formato distinto/enlace/crear igualmente; si se soportan teléfonos fuera de España, mover `phoneKey` a un ticket aparte con parser real.

**Desplegado:** PR #27 fusionado a `main` (squash merge, 2026-07-24). El check `e2e` de CI falló como es sabido (MIS-258, sin secrets configurados — no bloquea el merge); `build` pasó limpio. Este ticket no toca Convex — no requiere `npx convex deploy`.

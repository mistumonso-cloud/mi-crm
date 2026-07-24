# MIS-14 — Código completo (Reapertura v3: Inactivo entra al picker manual, Ganado sale)

Todos los archivos tocados por esta reapertura, concatenados en un único documento para copiar a auditoría. Cada sección indica la ruta real de destino y si es NUEVO o EDITAR. Ver `PLANS/MIS-14-gestion-estados-contacto.md` (sección "Reapertura (jul 2026) — v3") para el porqué de cada decisión.

Ya verificado antes de generar este documento: `npx convex dev --once`, `npx tsc --noEmit`, `npm run lint`, `npm run build` limpios; suite Playwright completa 15/15 en verde; 4 comprobaciones manuales de los comportamientos nuevos (Inactivo alcanzable/Ganado ausente del picker, contacto ya-Ganado con 6 opciones y reapertura de "Cerrar venta", defensa en profundidad invertida, deep link "Ganado" del panel sigue filtrando).

---

## `src/lib/contacts/status.ts` (EDITAR)

```ts
// Tipo del estado de pipeline de un contacto — mismos 7 literales que
// contacts.status en convex/schema.ts / contactStatusValidator en
// convex/contacts.ts. Tipo puro (sin v.union de Convex), duplicado a
// propósito frente al schema — mismo criterio ya aceptado en el repo (ver
// contactStatusValidator duplicado en convex/reminders.ts). Existe para
// tipar código de src/ (incluido src/lib/notes/history.ts) sin acoplar a
// los tipos generados de Convex.
export type ContactStatus =
  | "lead"
  | "talking"
  | "proposal"
  | "negotiating"
  | "won"
  | "lost"
  | "inactive";

// Subconjunto seleccionable desde "Cambiar estado" (MIS-14, reapertura jul
// 2026): los 6 estados del AC reabierto, de "Lead nuevo" a "Perdido", SIN
// "Ganado". "Ganado" deja de ser alcanzable por este picker manual a partir
// de esta reapertura: solo se asigna al cerrar una venta (closeSale en
// convex/sales.ts, MIS-15) — closeSale nunca consultó esta constante, no le
// afecta este cambio. "Inactivo" entra a cambio: existe en el schema desde
// MIS-9, pero hasta esta reapertura ningún código podía asignarlo. v1/v2 de
// este ticket tenía la combinación inversa exacta — ver
// PLANS/MIS-14-gestion-estados-contacto.md, sección histórica.
//
// No confundir con PIPELINE_SUMMARY_STATUSES, más abajo: consumidor
// distinto (panel de Marta / filtro de la lista), que conserva a propósito
// los 6 valores ANTIGUOS.
//
// Sin labels propios aquí: los textos vienen siempre de PIPELINE_STATES en
// StatusBadge.jsx (única fuente de verdad ya usada en
// ContactList/Pendientes/ficha) — no se duplica texto en este archivo.
export const SELECTABLE_STATUSES: readonly Exclude<ContactStatus, "won">[] = [
  "lead",
  "talking",
  "proposal",
  "negotiating",
  "inactive",
  "lost",
];

// Subconjunto usado por el desglose del panel de Marta (MIS-17,
// panel/page.tsx) y por el filtro ?status= de /contactos (contactos/
// page.tsx, que valida los deep links que el propio panel genera) — los 6
// estados "activos canónicos" del AC de MIS-17 (de "Lead nuevo" a
// "Perdido", CON "Ganado", SIN "Inactivo"), en la misma forma que devuelve
// getPipelineSummary en convex/contacts.ts.
//
// Deliberadamente DISTINTO de SELECTABLE_STATUSES a partir de esta
// reapertura de MIS-14 (jul 2026). Antes de este cambio ambas constantes
// coincidían por COINCIDENCIA, no por diseño: panel/page.tsx y
// contactos/page.tsx importaban SELECTABLE_STATUSES (el array del picker
// de "Cambiar estado") sin motivo real para compartirlo con el panel — un
// acoplamiento accidental. El checklist de esta reapertura de MIS-14 no
// incluye al panel entre las pantallas a revisar; su propio rediseño (que
// sí tocaría este array, para incluir "Inactivo" y mover "Ganado" a su
// propia tarjeta de ventas) queda para la futura reapertura de MIS-17, que
// ya referencia este cambio en su propio ticket de Linear ("Depende de la
// migración de datos de MIS-14").
export const PIPELINE_SUMMARY_STATUSES: readonly Exclude<ContactStatus, "inactive">[] = [
  "lead",
  "talking",
  "proposal",
  "negotiating",
  "won",
  "lost",
];
```

---

## `convex/contacts.ts` (EDITAR)

```ts
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireRole, requireUser } from "./lib/authz";

const contactStatusValidator = v.union(
  v.literal("lead"),
  v.literal("talking"),
  v.literal("proposal"),
  v.literal("negotiating"),
  v.literal("won"),
  v.literal("lost"),
  v.literal("inactive"),
);

// MIS-8 (reapertura jul 2026) — duplicado de v.union en convex/schema.ts a
// propósito, mismo criterio que contactStatusValidator arriba: sin
// validador compartido entre convex/ y src/. Se usa directamente como tipo
// del argumento `channel` (igual que status: contactStatusValidator en
// changeContactStatus) — Convex rechaza en la capa de validación de
// argumentos cualquier valor fuera de los 5 literales, sin necesitar un
// workaround tipo v.string() + normalizeId (ese workaround es específico de
// IDs de formato libre que llegan por la URL; channel siempre llega de un
// <select> cerrado, ya validado también en createContactAction antes de
// invocar esta mutation).
const contactChannelValidator = v.union(
  v.literal("instagram"),
  v.literal("web"),
  v.literal("llamada"),
  v.literal("whatsapp"),
  v.literal("referido"),
);

// Subconjunto de contactStatusValidator seleccionable desde "Cambiar
// estado" (MIS-14, reapertura jul 2026) — los 6 estados del AC reabierto:
// de "Lead nuevo" a "Perdido", SIN "Ganado". "Ganado" deja de ser
// alcanzable por esta vía manual a partir de esta reapertura: solo se
// asigna al cerrar una venta (closeSale en convex/sales.ts, MIS-15) —
// closeSale no consulta esta constante, no le afecta este cambio.
// "Inactivo" entra a cambio: existe en el schema desde MIS-9 pero, hasta
// esta reapertura, ningún ticket definía cómo llegar a él. (v1/v2 de este
// ticket tenía ["lead","talking","proposal","negotiating","won","lost"] —
// la combinación inversa; ver PLANS/MIS-14-gestion-estados-contacto.md,
// sección histórica.) Duplicado respecto a SELECTABLE_STATUSES en
// src/lib/contacts/status.ts a propósito: convex/ y src/ son módulos
// independientes, sin validador compartido (mismo criterio que
// contactStatusValidator duplicado en convex/reminders.ts).
const CHANGEABLE_STATUSES = ["lead", "talking", "proposal", "negotiating", "inactive", "lost"] as const;

const NAME_MAX = 120;
const PHONE_MAX = 40;
const NOTE_MAX = 2000;
// Límite convencional de longitud total de una dirección de email (RFC
// 5321). Sin regex de formato server-side — mismo nivel de validación que
// el resto de campos opcionales de texto (initialNote); el formato lo
// cubre gratis type="email" en el cliente (NewContactForm.tsx).
const EMAIL_MAX = 254;

export const createContact = mutation({
  args: {
    token: v.string(),
    name: v.string(),
    phone: v.string(),
    email: v.optional(v.string()),
    channel: v.optional(contactChannelValidator),
    initialNote: v.optional(v.string()),
  },
  returns: v.union(
    v.object({ success: v.literal(true), id: v.id("contacts") }),
    v.object({
      success: v.literal(false),
      error: v.string(),
      field: v.optional(
        v.union(v.literal("name"), v.literal("phone"), v.literal("email"), v.literal("initialNote")),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    // Solo "rep" (Carlos) puede crear contactos — Marta tiene acceso de
    // lectura, no de escritura, según el criterio original de MIS-7. No
    // confundir con el ADR de MIS-18: ese abrió acceso de LECTURA a páginas
    // (Pendientes/Panel), nunca tocó operaciones de escritura.
    const user = await requireRole(ctx, args.token, "rep");

    const name = args.name.trim();
    if (!name) {
      return { success: false as const, error: "El nombre es obligatorio", field: "name" as const };
    }
    if (name.length > NAME_MAX) {
      return {
        success: false as const,
        error: `El nombre no puede superar ${NAME_MAX} caracteres`,
        field: "name" as const,
      };
    }

    const phone = args.phone.trim();
    if (!phone) {
      return { success: false as const, error: "El teléfono es obligatorio", field: "phone" as const };
    }
    if (phone.length > PHONE_MAX) {
      return {
        success: false as const,
        error: `El teléfono no puede superar ${PHONE_MAX} caracteres`,
        field: "phone" as const,
      };
    }

    const emailTrimmed = args.email?.trim();
    if (emailTrimmed && emailTrimmed.length > EMAIL_MAX) {
      return {
        success: false as const,
        error: `El email no puede superar ${EMAIL_MAX} caracteres`,
        field: "email" as const,
      };
    }

    const initialNoteTrimmed = args.initialNote?.trim();
    if (initialNoteTrimmed && initialNoteTrimmed.length > NOTE_MAX) {
      return {
        success: false as const,
        error: `La nota no puede superar ${NOTE_MAX} caracteres`,
        field: "initialNote" as const,
      };
    }

    const id = await ctx.db.insert("contacts", {
      name,
      phone,
      status: "lead", // estado inicial fijo por AC, no un default arbitrario
      createdBy: user.id,
      ...(emailTrimmed ? { email: emailTrimmed } : {}),
      ...(args.channel ? { channel: args.channel } : {}),
      ...(initialNoteTrimmed ? { initialNote: initialNoteTrimmed } : {}),
    });
    return { success: true as const, id };
  },
});

// MIS-252: edita nombre/teléfono/email/canal de un contacto existente
// desde su ficha. Solo "rep" (Carlos) — Marta no tiene esta acción (AC).
export const updateContact = mutation({
  args: {
    token: v.string(),
    contactId: v.string(), // v.string(), no v.id("contacts"): mismo motivo que getContact.args.id
    name: v.string(),
    phone: v.string(),
    email: v.optional(v.string()),
    channel: v.optional(contactChannelValidator),
  },
  returns: v.union(
    v.object({ success: v.literal(true) }),
    v.object({
      success: v.literal(false),
      error: v.string(),
      field: v.optional(
        v.union(
          v.literal("contactId"),
          v.literal("name"),
          v.literal("phone"),
          v.literal("email"),
          v.literal("channel"),
        ),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    // Solo "rep" (Carlos) puede editar datos del contacto (AC: "no es
    // visible para Marta") — mismo gating que changeContactStatus/
    // closeSale, mismo ADR de MIS-18. No se usa el usuario devuelto:
    // a diferencia de createContact, esta mutation no registra "quién
    // editó" (el AC no lo pide, y no hay tabla de historial para ello).
    await requireRole(ctx, args.token, "rep");

    const contactId = ctx.db.normalizeId("contacts", args.contactId);
    if (!contactId) {
      return { success: false as const, error: "Contacto no encontrado", field: "contactId" as const };
    }
    const contact = await ctx.db.get(contactId);
    if (!contact) {
      return { success: false as const, error: "Contacto no encontrado", field: "contactId" as const };
    }

    const name = args.name.trim();
    if (!name) {
      return { success: false as const, error: "El nombre es obligatorio", field: "name" as const };
    }
    if (name.length > NAME_MAX) {
      return {
        success: false as const,
        error: `El nombre no puede superar ${NAME_MAX} caracteres`,
        field: "name" as const,
      };
    }

    const phone = args.phone.trim();
    if (!phone) {
      return { success: false as const, error: "El teléfono es obligatorio", field: "phone" as const };
    }
    if (phone.length > PHONE_MAX) {
      return {
        success: false as const,
        error: `El teléfono no puede superar ${PHONE_MAX} caracteres`,
        field: "phone" as const,
      };
    }

    const emailTrimmed = args.email?.trim();
    if (emailTrimmed && emailTrimmed.length > EMAIL_MAX) {
      return {
        success: false as const,
        error: `El email no puede superar ${EMAIL_MAX} caracteres`,
        field: "email" as const,
      };
    }

    // A diferencia de createContact (insert: omitir la clave del objeto =
    // "no guardar este campo"), ctx.db.patch hace un merge superficial:
    // omitir una clave dice "no toques el valor existente", NO "vacíalo".
    // Confirmado en node_modules/convex/dist/cjs-types/server/database.d.ts:
    // "Fields with value undefined are removed. Fields not specified in
    // the patch are left [unchanged]." Por eso aquí SIEMPRE se incluyen
    // las claves email/channel (con undefined explícito si el formulario
    // las dejó vacías) — así vaciar el campo en la edición sí lo borra,
    // a diferencia del patrón `...(x ? {email: x} : {})` de createContact,
    // que solo es correcto para un insert nuevo.
    await ctx.db.patch(contactId, {
      name,
      phone,
      email: emailTrimmed || undefined,
      channel: args.channel,
    });

    return { success: true as const };
  },
});

// args.id es v.string() (no v.id("contacts")) a propósito: con v.id() el
// validator de argumentos rechaza un ID de formato inválido ANTES de que el
// handler pueda capturarlo, propagando un error no controlado hasta la
// Server Component. ctx.db.normalizeId lo resuelve a null de forma segura,
// tratándolo igual que "fila inexistente".
export const getContact = query({
  args: { token: v.string(), id: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("contacts"),
      name: v.string(),
      phone: v.optional(v.string()),
      email: v.optional(v.string()),
      channel: v.optional(contactChannelValidator),
      status: contactStatusValidator,
      initialNote: v.optional(v.string()),
      _creationTime: v.number(),
      responsibleName: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireUser(ctx, args.token); // lectura: ambos roles
    const contactId = ctx.db.normalizeId("contacts", args.id);
    if (!contactId) return null; // formato inválido o ID de otra tabla
    const contact = await ctx.db.get(contactId);
    if (!contact) return null; // formato válido, fila borrada/inexistente

    // "Responsable" = quien dio de alta el contacto (createdBy, obligatorio
    // en el schema). No hay campo de asignación separado — createContact
    // solo permite rol "rep", así que en la práctica es siempre Carlos.
    // No se añade `company` al contrato: existe en el schema pero ninguna
    // mutation lo rellena hoy y la ficha (MIS-10) no lo muestra — devolverlo
    // sin consumidor ensancharía el contrato para nada (hallazgo de la
    // auditoría de plan v1→v2 de MIS-10).
    const creator = await ctx.db.get(contact.createdBy);

    return {
      _id: contact._id,
      name: contact.name,
      phone: contact.phone,
      email: contact.email,
      channel: contact.channel,
      status: contact.status,
      initialNote: contact.initialNote,
      _creationTime: contact._creationTime,
      responsibleName: creator?.name ?? "—", // defensivo: usuario borrado, caso no esperado hoy
    };
  },
});

// Lista completa de contactos para MIS-9. Sin paginación ni search index a
// propósito (ver PLANS/MIS-9-lista-contactos.md): el volumen esperado de un
// CRM personal en MVP es pequeño y la búsqueda se filtra en memoria en el
// cliente. Ordenado por _creationTime desc como proxy de "último contacto"
// hasta que MIS-11 añada tracking real de interacciones (lastContactAt,
// backfilleado desde _creationTime en ese momento).
export const listContacts = query({
  args: { token: v.string() },
  returns: v.array(
    v.object({
      _id: v.id("contacts"),
      name: v.string(),
      phone: v.optional(v.string()),
      status: contactStatusValidator,
      _creationTime: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireUser(ctx, args.token); // lectura: ambos roles, igual que getContact
    const contacts = await ctx.db.query("contacts").order("desc").collect();
    return contacts.map((c) => ({
      _id: c._id,
      name: c.name,
      phone: c.phone,
      status: c.status,
      _creationTime: c._creationTime,
    }));
  },
});

// MIS-14: cambia el estado de pipeline de un contacto en un solo paso,
// registrando el cambio en statusChanges para el historial de la ficha.
export const changeContactStatus = mutation({
  args: {
    token: v.string(),
    contactId: v.string(), // v.string(), no v.id("contacts"): mismo motivo que getContact.args.id
    status: contactStatusValidator,
  },
  returns: v.union(
    v.object({ success: v.literal(true) }),
    v.object({
      success: v.literal(false),
      error: v.string(),
      field: v.optional(v.union(v.literal("contactId"), v.literal("status"))),
    }),
  ),
  handler: async (ctx, args) => {
    // Solo "rep" (Carlos) puede cambiar el estado — condición YA CERRADA
    // por el ADR de MIS-18 (PLANS/MIS-18-navegacion-principal.md, "Qué NO
    // cambia"): "cambio de estado en MIS-14... sigue debiendo llamar
    // [requireRole] como primera línea, sin excepción."
    const user = await requireRole(ctx, args.token, "rep");

    const contactId = ctx.db.normalizeId("contacts", args.contactId);
    if (!contactId) {
      return { success: false as const, error: "Contacto no encontrado", field: "contactId" as const };
    }
    const contact = await ctx.db.get(contactId);
    if (!contact) {
      return { success: false as const, error: "Contacto no encontrado", field: "contactId" as const };
    }

    // Defensa en profundidad: la mutation es un endpoint público invocable
    // directamente con un token válido, sin pasar por changeStatusAction.
    // Un valor fuera de CHANGEABLE_STATUSES (p.ej. "won", que a partir de
    // esta reapertura ya no es un estado manejable por changeContactStatus
    // — solo closeSale en convex/sales.ts puede asignarlo) no debe
    // persistirse aunque pase el v.union de 7 literales del validador de
    // argumentos.
    if (!CHANGEABLE_STATUSES.includes(args.status as (typeof CHANGEABLE_STATUSES)[number])) {
      return { success: false as const, error: "Estado no disponible", field: "status" as const };
    }

    // No-op explícito: pedir el mismo estado que ya tiene no es un cambio
    // real. Se rechaza como error controlado — mismo criterio que
    // completeReminder ante un recordatorio ya "done" — en vez de éxito
    // silencioso, para no ensuciar statusChanges con una fila
    // fromStatus === toStatus sin información real. No alcanzable desde
    // la UI normal (el picker excluye el estado actual).
    if (contact.status === args.status) {
      return { success: false as const, error: "El contacto ya está en ese estado", field: "status" as const };
    }

    await ctx.db.insert("statusChanges", {
      contactId,
      fromStatus: contact.status,
      toStatus: args.status,
      changedBy: user.id,
      changedAt: Date.now(),
    });
    await ctx.db.patch(contactId, { status: args.status });

    return { success: true as const };
  },
});

// Historial de cambios de estado de un contacto, para la ficha (MIS-14).
export const listStatusChanges = query({
  args: { token: v.string(), contactId: v.string() },
  returns: v.array(
    v.object({
      _id: v.id("statusChanges"),
      fromStatus: contactStatusValidator,
      toStatus: contactStatusValidator,
      changedByName: v.string(),
      changedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireUser(ctx, args.token); // lectura: ambos roles, igual que listNotes/listRemindersForContact
    const contactId = ctx.db.normalizeId("contacts", args.contactId);
    if (!contactId) return []; // ID inválido: page.tsx ya maneja "no encontrado" vía getContact

    const changes = await ctx.db
      .query("statusChanges")
      .withIndex("by_contact", (q) => q.eq("contactId", contactId))
      .order("desc")
      .collect();

    return Promise.all(
      changes.map(async (c) => {
        const changer = await ctx.db.get(c.changedBy);
        return {
          _id: c._id,
          fromStatus: c.fromStatus,
          toStatus: c.toStatus,
          changedByName: changer?.name ?? "—", // defensivo: usuario borrado, caso no esperado hoy — mismo fallback que notes.ts/reminders.ts
          changedAt: c.changedAt,
        };
      }),
    );
  },
});

// MIS-17: resumen del pipeline por estado, para las 6 tarjetas del panel
// de Marta (AC: "Muestra cuántos contactos hay en cada estado activo").
// Mismas 6 claves que PIPELINE_SUMMARY_STATUSES en
// src/lib/contacts/status.ts — "inactive" queda fuera a propósito, mismo
// criterio ya aplicado ahí. NOTA (MIS-14, reapertura jul 2026): antes de
// esta reapertura este comentario decía "mismos 6 estados que
// CHANGEABLE_STATUSES arriba", porque ambas constantes coincidían por
// casualidad; esta reapertura cambió CHANGEABLE_STATUSES para excluir
// "won" e incluir "inactive" (AC reabierto), así que esa igualdad deja de
// ser cierta. Este query NO cambia: el AC de MIS-17 (fuera de alcance de
// esta reapertura, todavía en Backlog) sigue pidiendo la tarjeta "Ganado"
// en el panel — el propio checklist de esta reapertura excluye
// explícitamente al panel de las pantallas a revisar. Objeto con las 6
// claves ya contadas (no un array {status,count}[]): panel/page.tsx
// conoce de antemano esas 6 categorías fijas, indexar por clave evita un
// .find() por tarjeta en el cliente.
//
// Full table scan sin índice, deliberado — mismo criterio que listContacts
// arriba: la guía oficial de Convex (node_modules/convex/dist/esm-types/
// server/database.d.ts) acepta un full table scan en tablas "que se
// mantendrán muy pequeñas (unos pocos cientos a unos pocos miles de
// documentos)" — contacts tiene hoy ~15-20 filas. 6 queries indexadas
// (by_status) supondrían 6 escaneos en vez de 1, sin ventaja medible a
// este volumen; el índice queda disponible sin usar, igual que antes de
// MIS-17.
export const getPipelineSummary = query({
  args: { token: v.string() },
  returns: v.object({
    lead: v.number(),
    talking: v.number(),
    proposal: v.number(),
    negotiating: v.number(),
    won: v.number(),
    lost: v.number(),
  }),
  handler: async (ctx, args) => {
    await requireUser(ctx, args.token); // lectura: ambos roles, igual que listContacts
    const contacts = await ctx.db.query("contacts").collect();

    const summary = { lead: 0, talking: 0, proposal: 0, negotiating: 0, won: 0, lost: 0 };
    for (const c of contacts) {
      if (c.status !== "inactive") {
        summary[c.status] += 1;
      }
    }
    return summary;
  },
});
```

---

## `src/app/(app)/(with-nav)/panel/page.tsx` (EDITAR)

```tsx
import Link from "next/link";
import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../../convex/_generated/api";
import { getUser } from "@/lib/auth/dal";
import { readSessionToken } from "@/lib/auth/cookie";
import { Badge } from "@/components/ui/feedback/Badge";
import { Card } from "@/components/ui/core/Card";
import { StatusBadge } from "@/components/ui/feedback/StatusBadge";
import { PIPELINE_SUMMARY_STATUSES } from "@/lib/contacts/status";
import { formatCurrencyCents } from "@/lib/contacts/format";
import { PanelAutoRefresh } from "./PanelAutoRefresh";

// Sustituye el placeholder de MIS-9/MIS-18 con el panel real de Marta
// (MIS-17): resumen del pipeline por estado + total de ventas ganadas,
// cada estado pulsable hacia /contactos?status=<estado>. Accesible también
// a Carlos desde el ADR de MIS-18 (ambos roles, solo lectura). Ver
// PLANS/MIS-17-panel-oportunidades.md para el ADR de "tiempo real"
// (PanelAutoRefresh) y el resto de decisiones.
//
// A partir de MIS-14 (reapertura jul 2026), este archivo usa
// PIPELINE_SUMMARY_STATUSES en vez de SELECTABLE_STATUSES — antes ambas
// constantes coincidían por casualidad; MIS-14 las diverge (ver
// src/lib/contacts/status.ts). Este archivo permanece funcionalmente sin
// cambios: sigue mostrando las mismas 6 tarjetas, en el mismo orden, con
// "Ganado" incluido.
export default async function PanelPage() {
  const user = await getUser();
  const token = await readSessionToken(); // getUser() ya garantiza sesión válida aquí

  const [pipeline, wonSales] = await Promise.all([
    fetchQuery(api.contacts.getPipelineSummary, { token: token! }),
    fetchQuery(api.sales.getWonSalesSummary, { token: token! }),
  ]);

  return (
    <div className="flex flex-1 flex-col" style={{ padding: "16px 20px 24px", gap: 20 }}>
      <PanelAutoRefresh />

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <Badge tone="accent" style={{ alignSelf: "flex-start" }}>
          Supervisora
        </Badge>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)" }}>Hola, {user.name}</h1>
        <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>Estado del negocio de un vistazo.</p>
      </div>

      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>Pipeline por estado</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {PIPELINE_SUMMARY_STATUSES.map((status) => (
            // Sin aria-label manual a propósito (hallazgo real durante la
            // verificación de MIS-17): StatusBadge.jsx es "use client", así
            // que PIPELINE_STATES[status].label no se puede leer desde este
            // Server Component — solo se puede renderizar el componente
            // <StatusBadge> como referencia cliente, no leer sus datos en el
            // servidor. El nombre accesible del Link se deriva de su
            // contenido visible (el número + el texto del badge ya
            // hidratado), que ya coincide exactamente con lo que se ve en
            // pantalla — evita además duplicar las etiquetas en un segundo
            // sitio (PIPELINE_STATES sigue siendo la única fuente).
            <Link
              key={status}
              href={`/contactos?status=${status}`}
              // minWidth: 0 anula el min-width:auto por defecto de los
              // grid items — sin esto, CSS Grid ensancha la columna entera
              // hasta caber la palabra más larga sin partir (p. ej.
              // "conversación", 12 caracteres, en la columna de "En
              // conversación"/"Negociando"/"Perdido"), desbordando el grid
              // completo a 320px aunque whiteSpace:"normal" ya permita
              // envolver dentro de cada badge individual. Hallazgo real
              // durante la verificación (Playwright a 320px), no solo
              // razonado — ver decisión 13 del plan.
              style={{ textDecoration: "none", color: "inherit", display: "block", minWidth: 0 }}
            >
              <Card
                interactive
                padding="md"
                style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}
              >
                <span style={{ fontSize: 28, fontWeight: 800, lineHeight: 1, color: "var(--text-primary)" }}>
                  {pipeline[status]}
                </span>
                {/* MIS-17 v2 (corrige M1 de la auditoría de plan): whiteSpace
                    "normal" + maxWidth 100% anulan el nowrap por defecto de
                    StatusBadge — "Propuesta enviada" (la etiqueta más larga)
                    envuelve a 2 líneas en vez de desbordar la tarjeta en
                    320-375px. boxSizing "border-box" explícito y defensivo:
                    Tailwind Preflight (src/app/globals.css) ya lo pone
                    global, pero se fija aquí para no depender de eso. Ver
                    decisión 13 del plan. */}
                <StatusBadge
                  state={status}
                  style={{
                    alignSelf: "flex-start",
                    whiteSpace: "normal",
                    maxWidth: "100%",
                    boxSizing: "border-box",
                  }}
                />
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>Ventas ganadas</h2>
        <Card padding="md" style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 28, fontWeight: 800, lineHeight: 1, color: "var(--text-primary)" }}>
              {wonSales.count}
            </span>
            <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
              {wonSales.count === 1 ? "venta cerrada" : "ventas cerradas"}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 28, fontWeight: 800, lineHeight: 1, color: "var(--status-won-fg)" }}>
              {formatCurrencyCents(wonSales.totalAmountCents)}
            </span>
            <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>importe total</span>
          </div>
        </Card>
      </section>
    </div>
  );
}
```

---

## `src/app/(app)/(with-nav)/contactos/page.tsx` (EDITAR)

```tsx
import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../../convex/_generated/api";
import { getUser } from "@/lib/auth/dal";
import { readSessionToken } from "@/lib/auth/cookie";
import { getRequestTime } from "@/lib/request-time";
import { PIPELINE_SUMMARY_STATUSES } from "@/lib/contacts/status";
import type { ContactStatus } from "@/lib/contacts/status";
import { ContactList } from "./ContactList";

// MIS-17: además del filtro de texto ya existente (MIS-9), la lista acepta
// un filtro de estado inicial vía ?status=<estado> — la forma en que el
// panel de Marta enlaza a "los contactos en esta fase" (AC: "al pulsar un
// estado, abre la lista de contactos filtrada por ese estado"). Se valida
// aquí, en el Server Component, contra PIPELINE_SUMMARY_STATUSES (los
// mismos 6 estados pulsables del panel — "inactive" nunca es destino de
// enlace válido) y se entrega a ContactList ya tipado; un ?status=
// manipulado a mano se ignora silenciosamente, sin error.
//
// MIS-14 (reapertura jul 2026): este archivo importaba antes
// SELECTABLE_STATUSES (el array del picker de "Cambiar estado"), que
// coincidía con los estados pulsables del panel por casualidad, no por
// diseño. MIS-14 flipeó SELECTABLE_STATUSES (quita "won", añade
// "inactive"), así que se cambia aquí a PIPELINE_SUMMARY_STATUSES para no
// romper el deep link "Ganado" del panel -> /contactos?status=won.
export default async function ContactosPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const user = await getUser();
  const token = await readSessionToken();
  const contacts = await fetchQuery(api.contacts.listContacts, { token: token! });
  const now = await getRequestTime(); // capturado una vez, pasado como prop — evita mismatch de hidratación

  const { status } = await searchParams;
  const statusRaw = status ?? "";
  const initialStatusFilter: ContactStatus | null = PIPELINE_SUMMARY_STATUSES.includes(
    statusRaw as (typeof PIPELINE_SUMMARY_STATUSES)[number],
  )
    ? (statusRaw as (typeof PIPELINE_SUMMARY_STATUSES)[number])
    : null;

  return (
    <ContactList
      // MIS-17 v2 (corrige M2 de la auditoría de plan): key fuerza remount
      // cuando cambia el filtro resuelto por la URL — necesario porque
      // BottomNav enlaza a "/contactos" sin query string, y sin esta key
      // el useState(initialStatusFilter) de ContactList conservaría el
      // filtro viejo tras ese salto. Ver decisión 14 del plan.
      key={initialStatusFilter ?? "all"}
      contacts={contacts}
      now={now}
      canCreate={user.role === "rep"}
      initialStatusFilter={initialStatusFilter}
    />
  );
}
```

---

## Archivos afectados

| Archivo | Tipo |
|---|---|
| `src/lib/contacts/status.ts` | Editar |
| `convex/contacts.ts` | Editar |
| `src/app/(app)/(with-nav)/panel/page.tsx` | Editar |
| `src/app/(app)/(with-nav)/contactos/page.tsx` | Editar |

No se toca ningún otro archivo (`ChangeStatusForm.tsx`, `changeStatusAction`, `ContactList.tsx`, `pendientes/page.tsx`, `ContactDetailView.tsx`, `convex/schema.ts`, `convex/sales.ts`, ningún test e2e) — ver "Fuera de alcance" en `PLANS/MIS-14-gestion-estados-contacto.md`.

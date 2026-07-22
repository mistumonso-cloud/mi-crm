import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../../convex/_generated/api";
import { getUser } from "@/lib/auth/dal";
import { readSessionToken } from "@/lib/auth/cookie";
import { getRequestTime } from "@/lib/request-time";
import { SELECTABLE_STATUSES } from "@/lib/contacts/status";
import type { ContactStatus } from "@/lib/contacts/status";
import { ContactList } from "./ContactList";

// MIS-17: además del filtro de texto ya existente (MIS-9), la lista acepta
// un filtro de estado inicial vía ?status=<estado> — la forma en que el
// panel de Marta enlaza a "los contactos en esta fase" (AC: "al pulsar un
// estado, abre la lista de contactos filtrada por ese estado"). Se valida
// aquí, en el Server Component, contra SELECTABLE_STATUSES (los mismos 6
// estados pulsables del panel — "inactive" nunca es destino de enlace
// válido) y se entrega a ContactList ya tipado; un ?status= manipulado a
// mano se ignora silenciosamente, sin error.
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
  const initialStatusFilter: ContactStatus | null = SELECTABLE_STATUSES.includes(
    statusRaw as (typeof SELECTABLE_STATUSES)[number],
  )
    ? (statusRaw as (typeof SELECTABLE_STATUSES)[number])
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

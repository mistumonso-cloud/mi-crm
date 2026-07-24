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
// mismos 6 estados pulsables del panel) y se entrega a ContactList ya
// tipado; un ?status= manipulado a mano se ignora silenciosamente, sin
// error.
//
// MIS-14 (reapertura jul 2026): este archivo importaba antes
// SELECTABLE_STATUSES (el array del picker de "Cambiar estado"), que
// coincidía con los estados pulsables del panel por casualidad, no por
// diseño. MIS-14 flipeó SELECTABLE_STATUSES (quita "won", añade
// "inactive"), así que se cambió aquí a PIPELINE_SUMMARY_STATUSES para no
// romper el deep link "Ganado" del panel -> /contactos?status=won.
//
// MIS-17 (reapertura jul 2026): PIPELINE_SUMMARY_STATUSES se corrige a su
// vez (quita "won", añade "inactive") — así que a partir de ahora es
// "?status=inactive" el que funciona como deep link válido desde el
// panel, y "?status=won" el que se ignora silenciosamente (antes era al
// revés). Sin cambios de lógica en este archivo: la validación
// `.includes(...)` ya era genérica sobre la constante.
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

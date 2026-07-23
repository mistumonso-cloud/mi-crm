"use server";

import { ConvexError } from "convex/values";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { fetchMutation } from "convex/nextjs";
import { api } from "../../../convex/_generated/api";
import { readSessionToken } from "@/lib/auth/cookie";
import { SELECTABLE_STATUSES } from "@/lib/contacts/status";
import { CONTACT_CHANNELS, type ContactChannel } from "@/lib/contacts/channel";

export type CreateContactState =
  | { error: string; field?: "name" | "phone" | "email" | "channel" | "initialNote" }
  | undefined;

export async function createContactAction(
  _prevState: CreateContactState,
  formData: FormData,
): Promise<CreateContactState> {
  const token = await readSessionToken();
  if (!token) redirect("/login"); // defensa en profundidad; getUser() ya debería haber redirigido antes de renderizar el form

  const name = String(formData.get("name") ?? "");
  const phone = String(formData.get("phone") ?? "");
  const emailRaw = String(formData.get("email") ?? "").trim();

  // Validado contra el enum antes de llamar a Convex (mismo motivo y mismo
  // patrón que la validación de "type" en addNoteAction): un POST manipulado
  // con un channel fuera del enum no debe llegar a la mutation y disparar un
  // error de validación de argumentos de Convex sin manejar.
  // Object.prototype.hasOwnProperty.call, no el operador `in` — `in` acepta
  // también claves heredadas de la cadena de prototipos (p.ej. "toString").
  const channelRaw = String(formData.get("channel") ?? "");
  let channel: ContactChannel | undefined;
  if (channelRaw) {
    if (!Object.prototype.hasOwnProperty.call(CONTACT_CHANNELS, channelRaw)) {
      return { error: "Canal inválido", field: "channel" };
    }
    channel = channelRaw as ContactChannel;
  }

  const initialNoteRaw = String(formData.get("initialNote") ?? "").trim();

  let result;
  try {
    result = await fetchMutation(api.contacts.createContact, {
      token,
      name,
      phone,
      email: emailRaw || undefined,
      channel,
      initialNote: initialNoteRaw || undefined,
    });
  } catch (err) {
    // requireRole lanza ConvexError("No autenticado") si la sesión se
    // revocó/expiró entre cargar la página y enviar el formulario, o
    // ConvexError("No autorizado") si un usuario no-"rep" fuerza la request
    // saltándose el guard de la page — se distinguen para no mandar a /login
    // a alguien que sí tiene sesión válida, solo el rol equivocado.
    if (err instanceof ConvexError) {
      redirect(err.data === "No autorizado" ? "/contactos" : "/login");
    }
    throw err; // cualquier otro error, no lo enmascaramos
  }

  if (!result.success) {
    return { error: result.error, field: result.field };
  }

  redirect(`/contactos/${result.id}`); // fuera de try/catch
}

export type UpdateContactState =
  | { success: true }
  | { success: false; error: string; field?: "contactId" | "name" | "phone" | "email" | "channel" }
  | undefined;

// MIS-252: edita nombre/teléfono/email/canal de un contacto existente
// desde su ficha, en un solo paso (EditContactForm.tsx). A diferencia de
// createContactAction (redirige a la ficha del contacto NUEVO), esta se
// queda en la misma ficha — mismo patrón que changeStatusAction/
// closeSaleAction: ya hay un contactId concreto, así que un "No
// autorizado" (Marta forzando el POST) redirige de vuelta a esa misma
// ficha, no a "/contactos".
export async function updateContactAction(
  _prevState: UpdateContactState,
  formData: FormData,
): Promise<UpdateContactState> {
  const token = await readSessionToken();
  if (!token) redirect("/login");

  const contactId = String(formData.get("contactId") ?? "");
  const name = String(formData.get("name") ?? "");
  const phone = String(formData.get("phone") ?? "");
  const emailRaw = String(formData.get("email") ?? "").trim();

  // Mismo patrón que createContactAction: hasOwnProperty, no `in`.
  const channelRaw = String(formData.get("channel") ?? "");
  let channel: ContactChannel | undefined;
  if (channelRaw) {
    if (!Object.prototype.hasOwnProperty.call(CONTACT_CHANNELS, channelRaw)) {
      return { success: false, error: "Canal inválido", field: "channel" };
    }
    channel = channelRaw as ContactChannel;
  }

  let result;
  try {
    result = await fetchMutation(api.contacts.updateContact, {
      token,
      contactId,
      name,
      phone,
      email: emailRaw || undefined,
      channel,
    });
  } catch (err) {
    if (err instanceof ConvexError) {
      redirect(err.data === "No autorizado" ? `/contactos/${contactId}` : "/login");
    }
    throw err;
  }

  if (!result.success) {
    return { success: false, error: result.error, field: result.field };
  }

  refresh(); // Next 16: re-renderiza /contactos/[id] en la misma respuesta — mismo patrón que changeStatusAction/closeSaleAction
  return { success: true };
}

export type ChangeStatusState =
  | { success: true }
  | { success: false; error: string; field?: "contactId" | "status" }
  | undefined;

// MIS-14: cambia el estado de pipeline de un contacto desde la ficha, en
// un solo paso (un botón por estado destino en ChangeStatusForm.tsx).
export async function changeStatusAction(
  _prevState: ChangeStatusState,
  formData: FormData,
): Promise<ChangeStatusState> {
  const token = await readSessionToken();
  if (!token) redirect("/login");

  const contactId = String(formData.get("contactId") ?? "");

  // Validado contra SELECTABLE_STATUSES ANTES de llamar a Convex — mismo
  // motivo que la validación de dueAt/reason en reminders/actions.ts: un
  // POST manipulado con un valor fuera de la lista no debe llegar a la
  // mutation y disparar un error de validación de argumentos de Convex
  // sin manejar.
  const statusRaw = String(formData.get("status") ?? "");
  if (!SELECTABLE_STATUSES.includes(statusRaw as (typeof SELECTABLE_STATUSES)[number])) {
    return { success: false, error: "Estado inválido", field: "status" };
  }
  const status = statusRaw as (typeof SELECTABLE_STATUSES)[number];

  let result;
  try {
    result = await fetchMutation(api.contacts.changeContactStatus, { token, contactId, status });
  } catch (err) {
    // requireRole(ctx, token, "rep") — ConvexError("No autenticado") si la
    // sesión se revocó/expiró entre cargar la ficha y pulsar un estado, o
    // ConvexError("No autorizado") si Marta fuerza la request saltándose
    // el gating de UI (ver ContactDetailView.tsx, prop canChangeStatus).
    // A diferencia de createContactAction (que redirige a "/contactos"
    // porque en ese punto el contacto ni siquiera existe todavía), aquí sí
    // hay un contactId concreto: se redirige de vuelta a esa misma ficha.
    if (err instanceof ConvexError) {
      redirect(err.data === "No autorizado" ? `/contactos/${contactId}` : "/login");
    }
    throw err;
  }

  if (!result.success) {
    return { success: false, error: result.error, field: result.field === "status" ? "status" : undefined };
  }

  refresh(); // Next 16: re-renderiza /contactos/[id] en la MISMA respuesta — mismo patrón que scheduleReminderAction/completeReminderAction
  return { success: true };
}

export type CloseSaleState =
  | { success: true }
  | {
      success: false;
      error: string;
      field?: "contactId" | "outcome" | "product" | "amountCents" | "purchaseDate" | "lossReason";
    }
  | undefined;

// outcome llega como texto libre desde el <input type="hidden"> de
// CloseSaleForm.tsx — se valida contra esta lista ANTES de construir el
// objeto de argumentos de fetchMutation. Nota importante (lección de la
// auditoría de plan v1→v2 de MIS-14): comparar un `string` con !==/===
// contra literales NO estrecha su tipo a una unión finita en TypeScript —
// mismo error de fondo (TS2345/TS2322) que causó el NO-GO de esa auditoría.
// Se usa el patrón ya corregido y validado en ese plan: array.includes(v as
// Literal) + cast explícito tras la comprobación, no una comparación de
// igualdad directa.
const SALE_OUTCOMES = ["won", "lost"] as const;

// Duplicadas de convex/sales.ts a propósito — mismo motivo que
// isValidEpochMs duplicada entre convex/reminders.ts y
// src/lib/reminders/actions.ts: esta Server Action es la primera línea de
// defensa contra un POST manipulado, pero la mutation es el endpoint
// público real y revalida todo de forma independiente.
function isValidEpochMs(value: number): boolean {
  return (
    Number.isFinite(value) &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    !Number.isNaN(new Date(value).getTime())
  );
}

function isValidAmountCents(value: number): boolean {
  return Number.isFinite(value) && Number.isSafeInteger(value) && value > 0;
}

// MIS-15: cierra una oportunidad de venta (ganada o perdida) desde la
// ficha, en un solo paso (CloseSaleForm.tsx). A diferencia de
// changeStatusAction (un único <form> con varios <button type="submit">
// homogéneos), aquí "ganada" y "perdida" tienen campos completamente
// distintos — la distinción llega como un único campo oculto "outcome" que
// el propio formulario ya fijó mediante estado local de React antes de
// montar el <form> (ver decisión 10 del plan), no mediante múltiples
// submit-buttons.
export async function closeSaleAction(
  _prevState: CloseSaleState,
  formData: FormData,
): Promise<CloseSaleState> {
  const token = await readSessionToken();
  if (!token) redirect("/login");

  const contactId = String(formData.get("contactId") ?? "");

  const outcomeRaw = String(formData.get("outcome") ?? "");
  if (!SALE_OUTCOMES.includes(outcomeRaw as (typeof SALE_OUTCOMES)[number])) {
    return { success: false, error: "Resultado de venta inválido", field: "outcome" };
  }
  const outcome = outcomeRaw as (typeof SALE_OUTCOMES)[number];

  let product: string | undefined;
  let amountCents: number | undefined;
  let purchaseDate: number | undefined;
  let lossReason: string | undefined;

  if (outcome === "won") {
    product = String(formData.get("product") ?? "");

    // amountCents llega ya calculado en el navegador (euros -> céntimos,
    // ver CloseSaleForm.tsx) — mismo criterio que dueDateMs en
    // ScheduleReminderForm.tsx: esta Server Action nunca reparsea el string
    // de euros original.
    const amountRaw = formData.get("amountCents");
    amountCents = typeof amountRaw === "string" ? Number(amountRaw) : NaN;
    if (!isValidAmountCents(amountCents)) {
      return { success: false, error: "El importe debe ser un número positivo", field: "amountCents" };
    }

    // purchaseDateMs llega ya calculado en el navegador — mismo criterio
    // exacto que dueDateMs: new Date("YYYY-MM-DD") se interpretaría como
    // medianoche UTC en el servidor, no la medianoche local del usuario.
    const purchaseDateRaw = formData.get("purchaseDateMs");
    purchaseDate = typeof purchaseDateRaw === "string" ? Number(purchaseDateRaw) : NaN;
    if (!isValidEpochMs(purchaseDate)) {
      return { success: false, error: "Fecha de compra inválida", field: "purchaseDate" };
    }
  } else {
    lossReason = String(formData.get("lossReason") ?? "");
  }

  let result;
  try {
    result = await fetchMutation(api.sales.closeSale, {
      token,
      contactId,
      outcome,
      product,
      amountCents,
      purchaseDate,
      lossReason,
    });
  } catch (err) {
    // requireRole(ctx, token, "rep") — ConvexError("No autenticado") si la
    // sesión se revocó/expiró entre cargar la ficha y confirmar, o
    // ConvexError("No autorizado") si Marta fuerza la request saltándose el
    // gating de UI (ver ContactDetailView.tsx, canChangeStatus reutilizada
    // también para "Cerrar venta" — decisión 4 del plan). Mismo patrón que
    // changeStatusAction: hay un contactId concreto, se redirige de vuelta
    // a esa misma ficha en vez de a "/contactos".
    if (err instanceof ConvexError) {
      redirect(err.data === "No autorizado" ? `/contactos/${contactId}` : "/login");
    }
    throw err;
  }

  if (!result.success) {
    return { success: false, error: result.error, field: result.field };
  }

  refresh(); // Next 16: re-renderiza /contactos/[id] en la MISMA respuesta — mismo patrón que changeStatusAction
  return { success: true };
}

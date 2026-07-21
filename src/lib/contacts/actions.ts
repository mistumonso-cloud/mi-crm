"use server";

import { ConvexError } from "convex/values";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { fetchMutation } from "convex/nextjs";
import { api } from "../../../convex/_generated/api";
import { readSessionToken } from "@/lib/auth/cookie";
import { SELECTABLE_STATUSES } from "@/lib/contacts/status";

export type CreateContactState = { error: string; field?: "name" | "phone" | "initialNote" } | undefined;

export async function createContactAction(
  _prevState: CreateContactState,
  formData: FormData,
): Promise<CreateContactState> {
  const token = await readSessionToken();
  if (!token) redirect("/login"); // defensa en profundidad; getUser() ya debería haber redirigido antes de renderizar el form

  const name = String(formData.get("name") ?? "");
  const phone = String(formData.get("phone") ?? "");
  const initialNoteRaw = String(formData.get("initialNote") ?? "").trim();

  let result;
  try {
    result = await fetchMutation(api.contacts.createContact, {
      token,
      name,
      phone,
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

"use server";

import { ConvexError } from "convex/values";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { fetchMutation } from "convex/nextjs";
import { api } from "../../../convex/_generated/api";
import { readSessionToken } from "@/lib/auth/cookie";

export type ScheduleReminderState =
  | { success: true }
  | { success: false; error: string; field?: "contactId" | "dueAt" | "reason" }
  | undefined;

export type CompleteReminderState = { success: true } | { success: false; error: string } | undefined;

// Duplicada de convex/reminders.ts a propósito — mismo motivo que
// isValidEpochMs en src/lib/notes/actions.ts: la mutation es un endpoint
// público invocable directamente con un token válido, sin pasar por esta
// Server Action.
function isValidEpochMs(value: number): boolean {
  return (
    Number.isFinite(value) &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    !Number.isNaN(new Date(value).getTime())
  );
}

export async function scheduleReminderAction(
  _prevState: ScheduleReminderState,
  formData: FormData,
): Promise<ScheduleReminderState> {
  const token = await readSessionToken();
  if (!token) redirect("/login");

  const contactId = String(formData.get("contactId") ?? "");

  // dueDateMs llega ya calculado en el navegador (ver
  // ScheduleReminderForm.tsx) — esta Server Action NUNCA reparsea el string
  // "YYYY-MM-DD" del input type="date": new Date("YYYY-MM-DD") lo
  // interpretaría como medianoche UTC (formas fecha-only del spec
  // ECMA-262), no la medianoche local del usuario. Mismo motivo que
  // occurredAtMs en src/lib/notes/actions.ts.
  const dueDateRaw = formData.get("dueDateMs");
  const dueAt = typeof dueDateRaw === "string" ? Number(dueDateRaw) : NaN;
  if (!isValidEpochMs(dueAt)) return { success: false, error: "Fecha inválida", field: "dueAt" };

  const reason = String(formData.get("reason") ?? "");

  let result;
  try {
    result = await fetchMutation(api.reminders.scheduleReminder, { token, contactId, dueAt, reason });
  } catch (err) {
    // requireUser solo puede lanzar ConvexError("No autenticado") aquí —
    // no hay requireRole, así que no existe la rama "No autorizado".
    if (err instanceof ConvexError) redirect("/login");
    throw err;
  }

  if (!result.success) {
    return {
      success: false,
      error: result.error,
      field: result.field === "dueAt" || result.field === "reason" ? result.field : undefined,
    };
  }

  refresh(); // Next 16: re-renderiza la ruta actual (ficha o /pendientes) en la MISMA respuesta
  return { success: true };
}

export async function completeReminderAction(
  _prevState: CompleteReminderState,
  formData: FormData,
): Promise<CompleteReminderState> {
  const token = await readSessionToken();
  if (!token) redirect("/login");

  const id = String(formData.get("reminderId") ?? "");

  let result;
  try {
    result = await fetchMutation(api.reminders.completeReminder, { token, id });
  } catch (err) {
    if (err instanceof ConvexError) redirect("/login");
    throw err;
  }

  if (!result.success) return { success: false, error: result.error };

  refresh();
  return { success: true };
}

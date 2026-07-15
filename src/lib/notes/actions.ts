"use server";

import { ConvexError } from "convex/values";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { fetchMutation } from "convex/nextjs";
import { api } from "../../../convex/_generated/api";
import { readSessionToken } from "@/lib/auth/cookie";
import { NOTE_TYPES, type NoteType } from "@/lib/notes/types";

export type AddNoteState =
  | { success: true }
  | { success: false; error: string; field?: "type" | "occurredAt" | "text" }
  | undefined;

// Duplicada de convex/notes.ts a propósito — ver comentario ahí. Un POST
// manipulado con occurredAtMs=1e20 (finito, positivo, pero fuera del rango
// de Date) rompería formatDateTime() en el cliente con un RangeError si
// llegara a persistirse (hallazgo bloqueante de la auditoría de plan v3→v4).
function isValidEpochMs(value: number): boolean {
  return (
    Number.isFinite(value) &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    !Number.isNaN(new Date(value).getTime())
  );
}

export async function addNoteAction(_prevState: AddNoteState, formData: FormData): Promise<AddNoteState> {
  const token = await readSessionToken();
  if (!token) redirect("/login");

  const contactId = String(formData.get("contactId") ?? "");

  // Validado contra el enum antes de llamar a Convex: un Server Action es un
  // endpoint HTTP público como cualquier otro (node_modules/next/dist/docs/
  // 01-app/02-guides/server-actions.md) — un POST manipulado con un `type`
  // fuera del enum no debe llegar a la mutation y disparar un error de
  // validación de Convex sin manejar. Object.prototype.hasOwnProperty.call,
  // no el operador `in`: `in` recorre también la cadena de prototipos y
  // aceptaría claves heredadas como "toString" o "constructor" (hallazgo
  // mayor de la auditoría de plan v2→v3).
  const typeRaw = String(formData.get("type") ?? "");
  if (!Object.prototype.hasOwnProperty.call(NOTE_TYPES, typeRaw)) {
    return { success: false, error: "Tipo de nota inválido", field: "type" };
  }
  const type = typeRaw as NoteType;

  // occurredAtMs llega ya calculado en el cliente (ver AddNoteForm.tsx) — la
  // Server Action NO reparsea un string datetime-local, porque ese parseo
  // ocurriría en la zona horaria del runtime del servidor (Railway/Node), no
  // la del usuario (hallazgo bloqueante de la auditoría de plan v1→v2).
  const occurredAtRaw = formData.get("occurredAtMs");
  const occurredAt = typeof occurredAtRaw === "string" ? Number(occurredAtRaw) : NaN;
  if (!isValidEpochMs(occurredAt)) return { success: false, error: "Fecha/hora inválida", field: "occurredAt" };

  const text = String(formData.get("text") ?? "");

  let result;
  try {
    result = await fetchMutation(api.notes.addNote, { token, contactId, type, occurredAt, text });
  } catch (err) {
    // requireUser solo puede lanzar ConvexError("No autenticado") aquí — no
    // hay requireRole, así que no existe la rama "No autorizado".
    if (err instanceof ConvexError) redirect("/login");
    throw err;
  }

  if (!result.success) {
    return {
      success: false,
      error: result.error,
      field: result.field === "text" || result.field === "occurredAt" ? result.field : undefined,
    };
  }

  refresh(); // Next 16: re-renderiza /contactos/[id] en la MISMA respuesta
  return { success: true };
}

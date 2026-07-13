"use server";

import { ConvexError } from "convex/values";
import { redirect } from "next/navigation";
import { fetchMutation } from "convex/nextjs";
import { api } from "../../../convex/_generated/api";
import { readSessionToken } from "@/lib/auth/cookie";

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

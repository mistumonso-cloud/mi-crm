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

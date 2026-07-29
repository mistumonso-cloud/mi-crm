import Link from "next/link";
import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../../convex/_generated/api";
import { getUser } from "@/lib/auth/dal";
import { readSessionToken } from "@/lib/auth/cookie";
import { NewContactForm } from "./NewContactForm";

// Placeholder de MIS-18 sustituido por el formulario real (MIS-8). MIS-251
// (reapertura): el formulario ya no distingue por rol — createContact deja
// de exigir "rep" en el servidor (decisión de negocio confirmada por el
// usuario, ver PLANS/MIS-251-rol-supervision-marta.md). Antes de esta
// reapertura, MIS-20 comprobaba el rol aquí para mostrar un mensaje de
// solo lectura a Marta en vez del formulario; ese guard se retira junto
// con el gating del FAB en (with-nav)/layout.tsx.
export default async function NuevoContactoPage() {
  await getUser(); // solo chequeo de sesión — mismo patrón que contactos/[id]/page.tsx
  const token = await readSessionToken(); // getUser() ya garantiza sesión válida aquí — mismo patrón que contactos/[id]/page.tsx

  // MIS-255: lista completa de contactos existentes, para el aviso de
  // posible duplicado por teléfono dentro del propio formulario
  // (NewContactForm, useMemo sobre `existingContacts`). Reutiliza
  // literalmente la MISMA query que ya usa /contactos (ContactList.tsx) —
  // sin query nueva, sin índice nuevo: listContacts ya devuelve {_id,
  // name, phone, status, _creationTime} de cada contacto sin paginar (ver
  // comentario en convex/contacts.ts).
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
      <NewContactForm existingContacts={existingContacts} />
    </div>
  );
}

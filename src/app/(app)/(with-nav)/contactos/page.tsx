import { connection } from "next/server";
import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../../convex/_generated/api";
import { getUser } from "@/lib/auth/dal";
import { readSessionToken } from "@/lib/auth/cookie";
import { ContactList } from "./ContactList";

// connection() + Date.now() fuera del cuerpo del componente: esta app de
// Next.js usa Cache Components, que exige diferir explícitamente a tiempo de
// petición cualquier operación no determinista (ver node_modules/next/dist/
// docs/01-app/01-getting-started/08-caching.md, "Working with
// non-deterministic operations"). Aislarlo en una función aparte también
// satisface react-hooks/purity, que prohíbe llamar a Date.now() directamente
// dentro del cuerpo de un componente.
async function getRequestTime(): Promise<number> {
  await connection();
  return Date.now();
}

// Sustituye el placeholder de MIS-9. Server Component con fetchQuery (no
// useQuery de cliente): el token de sesión vive en una cookie HttpOnly a
// propósito (MIS-7) y no debe pasarse a un componente cliente. La lista ya
// resuelta se entrega como prop; el filtrado por búsqueda ocurre en memoria
// en ContactList — ver PLANS/MIS-9-lista-contactos.md, "Respuesta a la
// auditoría v1 → v2" para el razonamiento completo.
export default async function ContactosPage() {
  const user = await getUser();
  const token = await readSessionToken();
  const contacts = await fetchQuery(api.contacts.listContacts, { token: token! });
  const now = await getRequestTime(); // capturado una vez, pasado como prop — evita mismatch de hidratación

  return <ContactList contacts={contacts} now={now} canCreate={user.role === "rep"} />;
}

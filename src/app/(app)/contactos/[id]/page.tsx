import Link from "next/link";
import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../../convex/_generated/api";
import { getUser } from "@/lib/auth/dal";
import { readSessionToken } from "@/lib/auth/cookie";
import { getRequestTime } from "@/lib/request-time";
import { ContactDetailView } from "./ContactDetailView";

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getUser(); // MIS-14: se captura el valor (antes no hacía falta) para user.role -> canChangeStatus
  const { id } = await params;
  const token = await readSessionToken(); // getUser() ya garantiza sesión válida aquí

  const [contact, notes, reminders, statusChanges] = await Promise.all([
    fetchQuery(api.contacts.getContact, { token: token!, id }),
    fetchQuery(api.notes.listNotes, { token: token!, contactId: id }),
    fetchQuery(api.reminders.listRemindersForContact, { token: token!, contactId: id }),
    fetchQuery(api.contacts.listStatusChanges, { token: token!, contactId: id }),
  ]);

  if (!contact) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-16 text-center">
        <p style={{ color: "var(--text-secondary)" }}>Contacto no encontrado.</p>
        <Link href="/contactos" style={{ color: "var(--color-accent)", fontWeight: 600 }}>
          ‹ Volver a Contactos
        </Link>
      </div>
    );
  }

  const now = await getRequestTime();

  return (
    <div className="flex flex-1 flex-col">
      <div style={{ padding: "16px 20px 0" }}>
        <Link
          href="/contactos"
          style={{ fontSize: 14, fontWeight: 600, color: "var(--color-accent)", textDecoration: "none" }}
        >
          ‹ Contactos
        </Link>
      </div>
      <ContactDetailView
        contact={contact}
        now={now}
        notes={notes}
        reminders={reminders}
        statusChanges={statusChanges}
        canChangeStatus={user.role === "rep"}
      />
    </div>
  );
}

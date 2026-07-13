import Link from "next/link";
import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../../convex/_generated/api";
import { getUser } from "@/lib/auth/dal";
import { readSessionToken } from "@/lib/auth/cookie";
import { StatusBadge } from "@/components/ui/feedback/StatusBadge";

// Placeholder de la ficha del contacto (lo sustituye MIS-10) con datos
// reales — el AC de MIS-8 exige abrir "la ficha del contacto recién
// creado", así que mostrar los datos reales es la única forma de verificar
// que el alta funcionó. Sin timeline/edición/segundo FAB: eso es scope
// íntegro de MIS-10. Vive fuera de (with-nav), sin barra ni FAB, mismo
// criterio que /contactos/nuevo desde MIS-18.
export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await getUser();
  const { id } = await params;
  const token = await readSessionToken(); // getUser() ya garantiza sesión válida aquí

  const contact = await fetchQuery(api.contacts.getContact, { token: token!, id });

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

  return (
    <div className="flex flex-1 flex-col" style={{ padding: "16px 20px", gap: 16 }}>
      <Link
        href="/contactos"
        style={{ fontSize: 14, fontWeight: 600, color: "var(--color-accent)", textDecoration: "none", alignSelf: "flex-start" }}
      >
        ‹ Contactos
      </Link>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)" }}>{contact.name}</h1>
        <StatusBadge state={contact.status} />
      </div>
      {contact.phone && <p style={{ color: "var(--text-secondary)" }}>{contact.phone}</p>}
      {contact.initialNote && (
        <div
          style={{
            padding: 14,
            borderRadius: "var(--radius-lg)",
            border: "1px solid var(--color-border)",
            background: "var(--color-surface)",
          }}
        >
          {contact.initialNote}
        </div>
      )}
      <p style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
        Aquí se construirá la ficha completa del contacto (MIS-10).
      </p>
    </div>
  );
}

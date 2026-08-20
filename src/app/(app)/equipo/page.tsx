import Link from "next/link";
import { redirect } from "next/navigation";
import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../convex/_generated/api";
import { getUser } from "@/lib/auth/dal";
import { readSessionToken } from "@/lib/auth/cookie";
import { TeamView } from "./TeamView";

// MIS-309: pantalla de administración de usuarios ("Usuarios y equipo"). Vive
// FUERA de (with-nav) —pantalla completa, como contactos/nuevo—: se llega desde
// una tarjeta del Panel visible solo para la propietaria, no desde una pestaña.
//
// El gate de rol aquí es defensa en profundidad para la NAVEGACIÓN (evita
// renderizar la pantalla a Carlos): la autorización real vive en Convex
// (requireOwner en cada función de team.ts), que es lo que impide de verdad
// administrar usuarios aunque alguien llame directamente al endpoint.
export default async function EquipoPage() {
  const user = await getUser();
  if (user.role !== "supervisor") redirect("/");

  const token = await readSessionToken(); // getUser() ya garantiza sesión válida aquí
  const team = await fetchQuery(api.team.listTeam, { token: token! });

  return (
    <div className="flex flex-1 flex-col" style={{ padding: "16px 20px 32px" }}>
      <Link
        href="/panel"
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: "var(--color-accent)",
          textDecoration: "none",
          alignSelf: "flex-start",
          marginBottom: 16,
        }}
      >
        ‹ Volver al panel
      </Link>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
        Usuarios y equipo
      </h1>
      <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "4px 0 20px" }}>
        Gestiona quién tiene acceso al CRM
      </p>
      <TeamView team={team} currentUserId={user.id} />
    </div>
  );
}

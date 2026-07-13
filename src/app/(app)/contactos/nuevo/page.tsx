import Link from "next/link";
import { getUser } from "@/lib/auth/dal";
import { NewContactForm } from "./NewContactForm";

// Placeholder de MIS-18 sustituido por el formulario real (MIS-8). Solo
// "rep" (Carlos) puede crear contactos — ver requireRole en
// convex/contacts.ts::createContact. Se comprueba el rol aquí para mostrar
// un mensaje claro a Marta en vez de dejarle rellenar un formulario
// condenado a fallar en el servidor; el FAB que trae hasta aquí sigue
// visible para ambos roles (decisión aceptada en la auditoría de MIS-8).
export default async function NuevoContactoPage() {
  const user = await getUser();

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
        <NewContactForm />
      ) : (
        <p style={{ fontSize: 14, color: "var(--text-secondary)" }}>
          Solo el rol operativo puede añadir contactos. Tu cuenta tiene acceso de lectura.
        </p>
      )}
    </div>
  );
}

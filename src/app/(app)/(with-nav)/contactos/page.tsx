import { Badge } from "@/components/ui/feedback/Badge";
import { getUser } from "@/lib/auth/dal";

// Placeholder — lo sustituye MIS-9 (Pantalla: Lista de contactos). Compartida
// por ambos roles (Carlos y Marta), sin requireRole.
export default async function ContactosPage() {
  const user = await getUser();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <Badge tone="accent">Contactos</Badge>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)" }}>Hola, {user.name}</h1>
      <p style={{ fontSize: 14, color: "var(--text-secondary)", maxWidth: 320 }}>
        Aquí se construirá la lista de contactos con búsqueda en tiempo real (MIS-9).
      </p>
    </div>
  );
}

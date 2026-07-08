import { Badge } from "@/components/ui/feedback/Badge";
import { requireRole } from "@/lib/auth/dal";

// Placeholder — lo sustituye MIS-13 (Pantalla: Pendientes del día).
export default async function PendientesPage() {
  const user = await requireRole("rep");

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <Badge tone="accent">Operativo</Badge>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)" }}>Hola, {user.name}</h1>
      <p style={{ fontSize: 14, color: "var(--text-secondary)", maxWidth: 320 }}>
        Aquí se construirá el home de Carlos: la lista de pendientes del día (MIS-13).
      </p>
    </div>
  );
}

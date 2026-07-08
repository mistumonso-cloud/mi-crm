import { Badge } from "@/components/ui/feedback/Badge";
import { requireRole } from "@/lib/auth/dal";

// Placeholder — lo sustituye MIS-17 (Pantalla: Panel de oportunidades).
export default async function PanelPage() {
  const user = await requireRole("supervisor");

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <Badge tone="accent">Supervisora</Badge>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)" }}>Hola, {user.name}</h1>
      <p style={{ fontSize: 14, color: "var(--text-secondary)", maxWidth: 320 }}>
        Aquí se construirá el panel de oportunidades de Marta (MIS-17).
      </p>
    </div>
  );
}

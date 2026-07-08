import { Button } from "@/components/ui/core/Button";
import { Card } from "@/components/ui/core/Card";
import { StatusBadge } from "@/components/ui/feedback/StatusBadge";

export default function Home() {
  return (
    <div className="flex flex-1 items-center justify-center bg-[var(--color-bg)] px-4 py-16">
      <Card style={{ width: "100%", maxWidth: 420, display: "flex", flexDirection: "column", gap: 16 }}>
        <h1 className="text-[length:var(--text-heading-lg)] font-semibold text-[var(--text-primary)]">
          Vibe Coder CRM
        </h1>
        <p className="text-[length:var(--text-body-sm)] text-[var(--text-secondary)]">
          Estructura del proyecto lista. Conecta Convex y empieza a construir
          las pantallas del CRM.
        </p>
        <StatusBadge state="talking" />
        <Button>Crear primer contacto</Button>
      </Card>
    </div>
  );
}

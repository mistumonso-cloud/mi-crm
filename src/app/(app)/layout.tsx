import type { ReactNode } from "react";
import { Avatar } from "@/components/ui/core/Avatar";
import { Button } from "@/components/ui/core/Button";
import { logoutAction } from "@/lib/auth/actions";
import { getUser } from "@/lib/auth/dal";

// Header superior (nombre + logout), común a toda la app. La navegación real
// (barra inferior + FAB) vive en (with-nav)/layout.tsx, anidado dentro de
// este — ver MIS-18. Este layout no la incluye directamente porque
// contactos/nuevo (y en su momento la ficha del contacto, MIS-10) viven
// fuera de (with-nav) a propósito, sin barra ni FAB.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getUser();

  return (
    <div className="flex flex-1 flex-col" style={{ background: "var(--color-bg)" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "12px 16px",
          borderBottom: "1px solid var(--color-border)",
          background: "var(--color-surface)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Avatar name={user.name} size="sm" />
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{user.name}</span>
        </div>
        <form action={logoutAction}>
          <Button type="submit" variant="ghost" size="sm">
            Cerrar sesión
          </Button>
        </form>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}

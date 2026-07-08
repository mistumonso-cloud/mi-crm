import type { ReactNode } from "react";
import { Avatar } from "@/components/ui/core/Avatar";
import { Button } from "@/components/ui/core/Button";
import { logoutAction } from "@/lib/auth/actions";
import { getUser } from "@/lib/auth/dal";

// Barra mínima para cumplir "logout accesible desde la app" — MIS-18
// sustituirá/absorberá esto con la navegación real (barra inferior + FAB).
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

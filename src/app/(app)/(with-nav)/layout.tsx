import type { ReactNode } from "react";
import { AddContactFab } from "@/components/crm/AddContactFab";
import { BottomNav } from "@/components/crm/BottomNav";

// Envuelve Pendientes/Contactos/Panel con la barra inferior + FAB. Fuera de
// este route group (contactos/nuevo, y en su momento la ficha del contacto de
// MIS-10) no se hereda esto — exclusión estructural por carpeta, no un
// chequeo de pathname que haya que recordar mantener en tareas futuras.
export default function WithNavLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <div
        className="flex flex-1 flex-col"
        style={{ paddingBottom: "calc(72px + env(safe-area-inset-bottom))" }}
      >
        {children}
      </div>
      <AddContactFab />
      <BottomNav />
    </>
  );
}

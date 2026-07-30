"use client";

import { usePathname } from "next/navigation";
import { AddContactFab } from "./AddContactFab";

// MIS-259: Ventas pinta su propio FAB ("Registrar venta", ver SalesList.tsx)
// desde dentro de la propia pantalla, porque necesita abrir un BottomSheet
// con estado local — el FAB genérico de aquí no puede hacer eso, solo
// navegar. Se suprime aquí, en la capa compartida del layout, para no
// superponer dos botones flotantes en la misma esquina.
export function PageFab() {
  const pathname = usePathname();
  if (pathname === "/ventas") return null;
  return <AddContactFab />;
}

import type { ReactNode } from "react";
import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../convex/_generated/api";
import { AddContactFab } from "@/components/crm/AddContactFab";
import { BottomNav } from "@/components/crm/BottomNav";
import { getUser } from "@/lib/auth/dal";
import { readSessionToken } from "@/lib/auth/cookie";

// Envuelve Pendientes/Contactos/Panel con la barra inferior + FAB. MIS-12
// añade aquí la lectura de countDueToday para alimentar el badge de
// "Pendientes" del BottomNav — se hace en el layout (no en cada page) para
// que el badge esté visible y actualizado en las 3 pestañas, no solo en
// /pendientes. Fuera de este route group (contactos/nuevo, contactos/[id])
// no se hereda nada de esto — exclusión estructural por carpeta.
//
// await getUser() aquí es redundante con (app)/layout.tsx (que ya redirige
// a /login si no hay sesión) pero barato de repetir: getUser() está
// envuelto en cache() de React, así que dentro de la misma petición no
// vuelve a golpear Convex. Se mantiene por el mismo motivo documentado en
// src/lib/auth/dal.ts — un layout no se re-ejecuta en cada navegación
// entre hermanos (Pendientes↔Contactos↔Panel), así que este badge NO se
// refresca solo con la navegación normal entre tabs; se refresca cuando
// una Server Action (programar/completar un recordatorio) llama a
// refresh(), que sí re-renderiza el árbol completo incluida esta capa
// compartida (ver "Refresh data" / ejemplo del contador de notificaciones
// del header en node_modules/next/dist/docs/01-app/01-getting-started/
// 07-mutating-data.md).
export default async function WithNavLayout({ children }: { children: ReactNode }) {
  await getUser(); // solo chequeo de sesión — MIS-251 retira el gating por rol del FAB (ver abajo)
  const token = await readSessionToken(); // getUser() ya garantiza sesión válida aquí
  const dueTodayCount = await fetchQuery(api.reminders.countDueToday, { token: token! });

  return (
    <>
      <div
        className="flex flex-1 flex-col"
        style={{ paddingBottom: "calc(72px + env(safe-area-inset-bottom))" }}
      >
        {children}
      </div>
      {/* MIS-251 (reapertura): antes solo visible para "rep" (MIS-20) —
          revertido por decisión de negocio (Marta conserva acceso de
          escritura completo, igual que Carlos; ver PLANS/MIS-251-rol-
          supervision-marta.md). createContact ya no exige rol "rep" en el
          servidor, así que mostrarlo a Marta ya no lleva a un callejón sin
          salida. */}
      <AddContactFab />
      <BottomNav dueTodayCount={dueTodayCount} />
    </>
  );
}

import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../../convex/_generated/api";
import { getUser } from "@/lib/auth/dal";
import { readSessionToken } from "@/lib/auth/cookie";
import { SalesList } from "./SalesList";

// MIS-256: pantalla Ventas — listado de ventas ganadas + resumen por
// periodo (mes/trimestre/año en curso). Se piden los 3 periodos en
// paralelo en el servidor (convex/sales.ts::listWonSalesForPeriod) para
// que cambiar de pestaña en SalesList sea instantáneo, sin refetch — mismo
// patrón servidor-fetch / cliente-render que contactos/page.tsx +
// ContactList.tsx. Disponible para Carlos y Marta por igual (sin gating de
// rol, consistente con MIS-251); hereda FAB + BottomNav de
// (with-nav)/layout.tsx sin cambios ahí (la ruta vive dentro del mismo
// grupo).
export default async function VentasPage() {
  await getUser();
  const token = await readSessionToken(); // getUser() ya garantiza sesión válida aquí

  // MIS-259: listContacts se pide aquí en paralelo (no en SalesList/cliente)
  // para alimentar el selector de contacto de "Registrar venta" sin un
  // round-trip extra — mismo patrón servidor-fetch que los 3 periodos.
  const [month, quarter, year, contacts] = await Promise.all([
    fetchQuery(api.sales.listWonSalesForPeriod, { token: token!, period: "month" }),
    fetchQuery(api.sales.listWonSalesForPeriod, { token: token!, period: "quarter" }),
    fetchQuery(api.sales.listWonSalesForPeriod, { token: token!, period: "year" }),
    fetchQuery(api.contacts.listContacts, { token: token! }),
  ]);

  return (
    <div className="flex flex-1 flex-col" style={{ padding: "16px 20px 24px", gap: 20 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)" }}>Ventas</h1>
        <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>Ventas cerradas y facturación por periodo.</p>
      </div>
      <SalesList month={month} quarter={quarter} year={year} contacts={contacts} />
    </div>
  );
}

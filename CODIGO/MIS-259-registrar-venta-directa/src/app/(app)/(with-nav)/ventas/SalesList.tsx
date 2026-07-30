"use client";

import { useState } from "react";
import Link from "next/link";
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../../../convex/_generated/api";
import { Card } from "@/components/ui/core/Card";
import { Avatar } from "@/components/ui/core/Avatar";
import { BottomSheet } from "@/components/ui/overlays/BottomSheet";
import { formatCurrencyCents, formatDate } from "@/lib/contacts/format";
import { RegisterSaleForm } from "./RegisterSaleForm";

type Period = "month" | "quarter" | "year";

type Sale = {
  id: string;
  contactId: string;
  contactName: string;
  product: string;
  amountCents: number;
  purchaseDate: number;
};

type SalesForPeriod = { count: number; totalAmountCents: number; sales: Sale[] };
type Contact = FunctionReturnType<typeof api.contacts.listContacts>[number];

const PERIOD_LABELS: Record<Period, string> = {
  month: "Mes",
  quarter: "Trimestre",
  year: "Año",
};

// MIS-256: los 3 periodos llegan ya calculados desde el servidor
// (ventas/page.tsx, Promise.all de listWonSalesForPeriod) — cambiar de
// pestaña aquí es solo estado local, sin refetch ni recarga. Selector pill
// nuevo (no el componente Tabs existente, de estilo subrayado): replica el
// segmented-control ya aprobado en el diseño de MIS-257
// (DESIGN/design-system/templates/sales/Sales.dc.html).
export function SalesList({
  month,
  quarter,
  year,
  contacts,
}: {
  month: SalesForPeriod;
  quarter: SalesForPeriod;
  year: SalesForPeriod;
  contacts: Contact[];
}) {
  const [period, setPeriod] = useState<Period>("month");
  // MIS-259: FAB local + hoja propia, mismo mecanismo que
  // ContactDetailView.tsx usa para CloseSaleForm — PageFab.tsx suprime el
  // FAB genérico "Añadir contacto" en esta ruta para no superponerlos.
  const [sheetOpen, setSheetOpen] = useState(false);
  const dataByPeriod: Record<Period, SalesForPeriod> = { month, quarter, year };
  const data = dataByPeriod[period];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div
        role="tablist"
        aria-label="Periodo"
        style={{
          display: "flex",
          gap: 0,
          background: "var(--color-muted)",
          borderRadius: "var(--radius-lg)",
          padding: 4,
        }}
      >
        {(["month", "quarter", "year"] as Period[]).map((p) => {
          const active = p === period;
          return (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setPeriod(p)}
              style={{
                flex: 1,
                height: 38,
                border: "none",
                borderRadius: "calc(var(--radius-lg) - 4px)",
                background: active ? "var(--color-surface)" : "transparent",
                boxShadow: active ? "var(--shadow-sm)" : "none",
                fontSize: 13,
                fontWeight: 600,
                color: active ? "var(--text-primary)" : "var(--text-tertiary)",
                cursor: "pointer",
              }}
            >
              {PERIOD_LABELS[p]}
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-tertiary)" }}>Facturado</span>
        <span style={{ fontSize: 40, fontWeight: 700, lineHeight: 1.15, color: "var(--status-won-fg)" }}>
          {formatCurrencyCents(data.totalAmountCents)}
        </span>
        <span style={{ fontSize: 14, color: "var(--text-secondary)", marginTop: 4 }}>
          {data.count === 1 ? "1 venta cerrada" : `${data.count} ventas cerradas`}
        </span>
      </div>

      {data.sales.length === 0 ? (
        <p style={{ fontSize: 14, color: "var(--text-secondary)", textAlign: "center", padding: "48px 0" }}>
          Aún no hay ventas en este periodo
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {data.sales.map((sale) => (
            <li key={sale.id}>
              <Link
                href={`/contactos/${sale.contactId}`}
                style={{ textDecoration: "none", color: "inherit", display: "block" }}
              >
                <Card
                  interactive
                  padding="md"
                  style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}
                >
                  <Avatar name={sale.contactName} size="md" />
                  <div style={{ flex: "1 1 160px", minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>
                      {sale.contactName}
                    </span>
                    <span
                      style={{
                        fontSize: 13,
                        color: "var(--text-secondary)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {sale.product}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-end",
                      gap: 4,
                      flexShrink: 0,
                    }}
                  >
                    <span style={{ fontSize: 15, fontWeight: 700, color: "var(--status-won-fg)" }}>
                      {formatCurrencyCents(sale.amountCents)}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{formatDate(sale.purchaseDate)}</span>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* MIS-259: FAB propio de Ventas — mismo estilo/posición fijos que
          AddContactFab.tsx, duplicado a propósito (criterio de "cada pieza
          autocontenida" ya establecido en el repo) porque este abre una
          hoja con estado local en vez de navegar. aria-label distinto de
          "Añadir contacto" (sugerencia de la auditoría de plan) para que
          ambos FABs tengan nombres accesibles inequívocos. */}
      <button
        type="button"
        aria-label="Registrar venta"
        onClick={() => setSheetOpen(true)}
        style={{
          position: "fixed",
          right: 16,
          bottom: "calc(88px + env(safe-area-inset-bottom))",
          width: 52,
          height: 52,
          borderRadius: "var(--radius-full)",
          background: "var(--color-accent)",
          color: "var(--color-accent-contrast)",
          border: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 26,
          fontWeight: 300,
          lineHeight: 1,
          cursor: "pointer",
          boxShadow: "0 4px 14px rgba(59,82,102,.4)",
          zIndex: 20,
        }}
      >
        <span aria-hidden="true">+</span>
      </button>

      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Registrar venta">
        <RegisterSaleForm contacts={contacts} onDone={() => setSheetOpen(false)} />
      </BottomSheet>
    </div>
  );
}

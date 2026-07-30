"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../../../convex/_generated/api";
import { Button } from "@/components/ui/core/Button";
import { Input } from "@/components/ui/forms/Input";
import { Avatar } from "@/components/ui/core/Avatar";
import { StatusBadge } from "@/components/ui/feedback/StatusBadge";
import { registerDirectSaleAction, type RegisterDirectSaleState } from "@/lib/contacts/actions";

type Contact = FunctionReturnType<typeof api.contacts.listContacts>[number];

const initialState: RegisterDirectSaleState = undefined;

// Duplicadas de ContactList.tsx a propósito — mismo criterio de
// autocontención ya establecido en el repo (cada formulario/lista trae su
// propio helper de búsqueda en vez de importar uno compartido).
function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

function matches(contact: Contact, query: string): boolean {
  const nameMatch = normalizeText(contact.name).includes(normalizeText(query));
  if (nameMatch) return true;

  const queryDigits = digitsOnly(query);
  if (queryDigits.length === 0) return false;
  return digitsOnly(contact.phone ?? "").includes(queryDigits);
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

// "YYYY-MM-DD" en la zona LOCAL del navegador — duplicado a propósito de
// CloseSaleForm.tsx (cada formulario de este directorio es autocontenido).
function msToDateLocal(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dateLocalToMs(dateLocal: string): number {
  const [y, m, d] = dateLocal.split("-").map(Number);
  if (!y || !m || !d) return NaN;
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

function eurosToCents(eurosLocal: string): number {
  if (!eurosLocal) return NaN;
  const euros = Number(eurosLocal);
  if (!Number.isFinite(euros)) return NaN;
  return Math.round(euros * 100);
}

// MIS-259: formulario de 2 pasos dentro de la misma hoja — paso 1 elige un
// contacto en CUALQUIER estado (incluidos los ya "Ganado", el caso de venta
// repetida que motiva esta tarea), paso 2 son los mismos 3 campos que la
// rama "won" de CloseSaleForm.tsx. Máximo 4 toques: abrir la hoja (fuera de
// este componente) -> buscar/tocar un contacto -> rellenar -> Confirmar.
export function RegisterSaleForm({ contacts, onDone }: { contacts: Contact[]; onDone: () => void }) {
  const [state, formAction, isPending] = useActionState(registerDirectSaleAction, initialState);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [query, setQuery] = useState("");
  const [amountLocal, setAmountLocal] = useState("");
  const [purchaseDateLocal, setPurchaseDateLocal] = useState(() => msToDateLocal(Date.now()));

  useEffect(() => {
    if (state?.success) onDone();
  }, [state, onDone]);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return contacts;
    return contacts.filter((c) => matches(c, q));
  }, [contacts, query]);

  if (selectedContact === null) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Input
          prefix={<SearchIcon />}
          size="sm"
          placeholder="Buscar por nombre o teléfono"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Buscar contacto"
          autoFocus
        />
        {filtered.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--text-secondary)", textAlign: "center", padding: "24px 0" }}>
            Sin resultados
          </p>
        ) : (
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: 2,
              maxHeight: 320,
              overflowY: "auto",
            }}
          >
            {filtered.map((c) => (
              <li key={c._id}>
                <button
                  type="button"
                  onClick={() => setSelectedContact(c)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    width: "100%",
                    padding: "10px 4px",
                    background: "none",
                    border: "none",
                    borderBottom: "1px solid var(--color-border)",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <Avatar name={c.name} size="sm" />
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{c.name}</span>
                    {c.phone && (
                      <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{c.phone}</span>
                    )}
                  </div>
                  <StatusBadge state={c.status} dot={false} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <Button type="button" variant="ghost" full onClick={onDone}>
          Cancelar
        </Button>
      </div>
    );
  }

  const amountCents = eurosToCents(amountLocal);
  const purchaseDateMs = purchaseDateLocal ? dateLocalToMs(purchaseDateLocal) : NaN;

  // Errores generales (p. ej. "Contacto no encontrado", field: "contactId")
  // — se excluyen los 3 fields que ya tienen su propio mensaje inline abajo.
  const generalError =
    state && "error" in state && state.field !== "product" && state.field !== "amountCents" && state.field !== "purchaseDate"
      ? state.error
      : null;

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <input type="hidden" name="contactId" value={selectedContact._id} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 14, color: "var(--text-secondary)" }}>
          Cliente: <strong style={{ color: "var(--text-primary)" }}>{selectedContact.name}</strong>
        </span>
        <button
          type="button"
          onClick={() => setSelectedContact(null)}
          disabled={isPending}
          style={{ background: "none", border: "none", color: "var(--color-accent)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
        >
          Cambiar
        </button>
      </div>
      <Input
        label="Producto o servicio vendido"
        name="product"
        placeholder="Ej.: Plan anual Premium"
        required
        maxLength={200} // mismo límite que PRODUCT_MAX en convex/sales.ts — solo hint de UI
        disabled={isPending}
        error={state && "field" in state && state.field === "product" ? state.error : null}
      />
      <input type="hidden" name="amountCents" value={Number.isFinite(amountCents) ? amountCents : ""} />
      <Input
        label="Importe de la venta"
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0.01"
        suffix="€"
        value={amountLocal}
        onChange={(e) => setAmountLocal(e.target.value)}
        required
        disabled={isPending}
        error={state && "field" in state && state.field === "amountCents" ? state.error : null}
      />
      <input type="hidden" name="purchaseDateMs" value={Number.isFinite(purchaseDateMs) ? purchaseDateMs : ""} />
      <Input
        label="Fecha de la compra"
        type="date"
        value={purchaseDateLocal}
        onChange={(e) => setPurchaseDateLocal(e.target.value)}
        required
        disabled={isPending}
        error={state && "field" in state && state.field === "purchaseDate" ? state.error : null}
      />
      {generalError && (
        <div role="alert" style={{ fontSize: 13, color: "var(--color-danger-fg)" }}>
          {generalError}
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <Button type="button" variant="secondary" full onClick={() => setSelectedContact(null)} disabled={isPending}>
          Atrás
        </Button>
        <Button type="submit" variant="primary" full disabled={isPending}>
          {isPending ? "Guardando…" : "Confirmar"}
        </Button>
      </div>
    </form>
  );
}

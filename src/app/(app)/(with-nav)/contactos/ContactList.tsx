"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../../../convex/_generated/api";
import { Input } from "@/components/ui/forms/Input";
import { Avatar } from "@/components/ui/core/Avatar";
import { StatusBadge, PIPELINE_STATES } from "@/components/ui/feedback/StatusBadge";
import { formatRelativeTime } from "@/lib/contacts/format";
import type { ContactStatus } from "@/lib/contacts/status";

type Contact = FunctionReturnType<typeof api.contacts.listContacts>[number];

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
  if (queryDigits.length === 0) return false; // evita falso positivo de "".includes("")
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

function ClearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function ContactList({
  contacts,
  now,
  canCreate,
  initialStatusFilter,
}: {
  contacts: Contact[];
  now: number;
  canCreate: boolean;
  initialStatusFilter: ContactStatus | null;
}) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ContactStatus | null>(initialStatusFilter);
  const router = useRouter();

  const filtered = useMemo(() => {
    const q = query.trim();
    return contacts.filter((c) => {
      if (statusFilter && c.status !== statusFilter) return false;
      if (q && !matches(c, q)) return false;
      return true;
    });
  }, [contacts, query, statusFilter]);

  const noContactsAtAll = contacts.length === 0;
  const hasActiveFilters = query.trim() !== "" || statusFilter !== null;
  const noResults = !noContactsAtAll && hasActiveFilters && filtered.length === 0;

  // Limpia el filtro localmente Y en la URL: si solo se limpiara el estado
  // local, un F5 posterior volvería a leer ?status=... de la URL y
  // "resucitaría" el filtro que Marta acababa de quitar — useState solo lee
  // initialStatusFilter en el montaje inicial, no en renders posteriores.
  function clearStatusFilter() {
    setStatusFilter(null);
    router.replace("/contactos");
  }

  return (
    <div className="flex flex-1 flex-col" style={{ minHeight: 0 }}>
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 5,
          background: "var(--color-surface)",
          borderBottom: "1px solid var(--color-border)",
          padding: "12px 20px 14px",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)" }}>Contactos</h1>
          <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-tertiary)" }}>
            {contacts.length} {contacts.length === 1 ? "contacto" : "contactos"}
          </span>
        </div>
        <div style={{ position: "relative" }}>
          <Input
            prefix={<SearchIcon />}
            size="sm"
            placeholder="Buscar por nombre o teléfono"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Buscar contactos"
            style={{ paddingRight: query ? 28 : undefined }}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Limpiar búsqueda"
              style={{
                position: "absolute",
                right: 10,
                top: "50%",
                transform: "translateY(-50%)",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 2,
                display: "flex",
                color: "var(--text-tertiary)",
              }}
            >
              <ClearIcon />
            </button>
          )}
        </div>
        {statusFilter && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
            <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>Filtrado por:</span>
            <StatusBadge state={statusFilter} />
            <button
              type="button"
              onClick={clearStatusFilter}
              aria-label="Quitar filtro de estado"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 2,
                color: "var(--text-tertiary)",
                fontSize: 12,
              }}
            >
              <ClearIcon />
              Quitar
            </button>
          </div>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {noContactsAtAll && (
          <div
            className="flex flex-col items-center justify-center text-center"
            style={{ height: "100%", padding: "40px 32px", gap: 12 }}
          >
            <p style={{ fontSize: 17, fontWeight: 600, color: "var(--text-primary)" }}>Aún no hay contactos</p>
            {canCreate ? (
              <>
                <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>Empieza añadiendo tu primer contacto</p>
                <Link
                  href="/contactos/nuevo"
                  style={{
                    marginTop: 8,
                    background: "var(--color-accent)",
                    color: "var(--color-accent-contrast)",
                    borderRadius: "var(--radius-md)",
                    padding: "12px 20px",
                    fontSize: 14,
                    fontWeight: 600,
                    textDecoration: "none",
                  }}
                >
                  Añadir primer contacto
                </Link>
              </>
            ) : (
              <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>Carlos puede darlos de alta.</p>
            )}
          </div>
        )}

        {noResults && (
          <div
            className="flex flex-col items-center justify-center text-center"
            style={{ height: "100%", padding: "40px 32px", gap: 8 }}
          >
            <p style={{ fontSize: 17, fontWeight: 600, color: "var(--text-primary)" }}>
              {query.trim()
                ? `Sin resultados para "${query}"`
                : statusFilter
                ? `Sin contactos en "${PIPELINE_STATES[statusFilter].label}"`
                : "Sin resultados"}
            </p>
            <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              {query.trim() ? "Prueba con otro nombre o número" : "Prueba quitando el filtro de estado"}
            </p>
          </div>
        )}

        {!noContactsAtAll && !noResults && (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {filtered.map((c) => (
              <li key={c._id} style={{ borderBottom: "1px solid var(--color-border)" }}>
                <Link
                  href={`/contactos/${c._id}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "13px 20px",
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  <Avatar name={c.name} size="md" />
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{c.name}</span>
                      <StatusBadge state={c.status} dot={false} />
                    </div>
                    <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
                      {formatRelativeTime(c._creationTime, now)}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

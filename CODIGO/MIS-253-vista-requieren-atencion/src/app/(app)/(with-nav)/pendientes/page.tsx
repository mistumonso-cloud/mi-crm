import Link from "next/link";
import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../../convex/_generated/api";
import { getUser } from "@/lib/auth/dal";
import { readSessionToken } from "@/lib/auth/cookie";
import { Card } from "@/components/ui/core/Card";
import { Avatar } from "@/components/ui/core/Avatar";
import { Badge } from "@/components/ui/feedback/Badge";
import { StatusBadge } from "@/components/ui/feedback/StatusBadge";
import { formatDate } from "@/lib/contacts/format";
import { CompleteReminderButton } from "@/components/crm/CompleteReminderButton";

// Home de Carlos (MIS-13): recordatorios de seguimiento vencidos o de hoy
// (convex/reminders.ts::listDueToday), ordenados por dueAt asc (vencidos
// primero — dueAt es fecha sin hora, medianoche Europe/Madrid, decisión ya
// cerrada en MIS-12, no reabierta aquí). Cada fila muestra nombre, estado
// de pipeline (StatusBadge) y motivo; "marcar hecho" y el tap en el nombre
// son acciones directas sin entrar en la ficha (AC del ticket).
//
// MIS-253: segunda sección "Requieren atención" — contactos activos sin
// ningún seguimiento programado (convex/contacts.ts::listNeedsAttention),
// visible solo para Carlos (rol "rep") — AC explícito del ticket, ver
// PLANS/MIS-253-vista-requieren-atencion.md ("Tensión real con el ADR de
// MIS-18"). La sección "Para hoy" pasa a tener su propio <h2> para que las
// dos secciones tengan sentido visual una debajo de la otra.
export default async function PendientesPage() {
  const user = await getUser();
  const token = await readSessionToken(); // getUser() ya garantiza sesión válida aquí
  const isRep = user.role === "rep";

  const reminders = await fetchQuery(api.reminders.listDueToday, { token: token! });
  // MIS-253: solo se pide para Carlos — es una query nueva y más cara que
  // listDueToday (scan de contacts + reminders + una consulta a notes por
  // contacto candidato) que nunca se renderiza para Marta.
  const needsAttention = isRep ? await fetchQuery(api.contacts.listNeedsAttention, { token: token! }) : [];

  return (
    <div className="flex flex-1 flex-col" style={{ padding: "16px 20px 24px", gap: 20 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <Badge tone="accent" style={{ alignSelf: "flex-start" }}>
          Operativo
        </Badge>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)" }}>Hola, {user.name}</h1>
        <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>Seguimientos vencidos o de hoy.</p>
      </div>

      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>Para hoy</h2>
        {reminders.length === 0 ? (
          <p style={{ fontSize: 14, color: "var(--text-secondary)", textAlign: "center", padding: "32px 0" }}>
            No tienes seguimientos pendientes para hoy.
          </p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            {reminders.map((r) => (
              <li key={r._id}>
                <Card padding="md" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
                  <Avatar name={r.contactName} size="md" />
                  <div style={{ flex: "1 1 200px", minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <Link
                        href={`/contactos/${r.contactId}`}
                        style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", textDecoration: "none" }}
                      >
                        {r.contactName}
                      </Link>
                      {r.contactStatus && <StatusBadge state={r.contactStatus} dot={false} />}
                      <Badge tone={r.overdue ? "danger" : "warning"}>{r.overdue ? "Vencido" : "Hoy"}</Badge>
                    </div>
                    <p style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{formatDate(r.dueAt)}</p>
                    <p style={{ fontSize: 14, color: "var(--text-secondary)" }}>{r.reason}</p>
                  </div>
                  <CompleteReminderButton reminderId={r._id} style={{ flex: "0 0 auto" }} />
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {isRep && (
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>Requieren atención</h2>
          {needsAttention.length === 0 ? (
            <p style={{ fontSize: 14, color: "var(--text-secondary)", textAlign: "center", padding: "32px 0" }}>
              Ningún contacto activo sin seguimiento programado.
            </p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              {needsAttention.map((c) => (
                <li key={c._id}>
                  <Link href={`/contactos/${c._id}`} style={{ textDecoration: "none", color: "inherit", display: "block" }}>
                    <Card
                      interactive
                      padding="md"
                      style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}
                    >
                      <Avatar name={c.name} size="md" />
                      <div style={{ flex: "1 1 200px", minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          {/* overflowWrap: hallazgo real durante la verificación
                              (viewport 320px) — un contacto de prueba ya existente
                              en el deployment de dev con un nombre de una sola
                              palabra muy larga (sin espacios) desbordaba la
                              tarjeta, porque un <span> normal no rompe una
                              palabra sin puntos de corte. No hay precedente de
                              esta guarda en ningún otro sitio del repo
                              (ContactList.tsx, "Para hoy" de esta misma página,
                              ficha del contacto...) — mismo gap preexistente en
                              todos ellos, fuera de alcance de MIS-253 arreglarlo
                              en los demás; aquí se corrige porque esta sección
                              nueva lo expuso durante su propia verificación. */}
                          <span
                            style={{
                              fontSize: 15,
                              fontWeight: 700,
                              color: "var(--text-primary)",
                              overflowWrap: "anywhere",
                            }}
                          >
                            {c.name}
                          </span>
                          {/* whiteSpace/maxWidth/boxSizing: hallazgo real durante
                              la verificación (viewport 320px, estado "Propuesta
                              enviada") — mismo fix ya aplicado en panel/page.tsx
                              (MIS-17): sin esto, el nowrap por defecto de
                              StatusBadge.jsx desborda la tarjeta. */}
                          <StatusBadge
                            state={c.status}
                            dot={false}
                            style={{ whiteSpace: "normal", maxWidth: "100%", boxSizing: "border-box" }}
                          />
                        </div>
                        <p style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
                          Último contacto: {formatDate(c.lastContactAt)}
                        </p>
                      </div>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

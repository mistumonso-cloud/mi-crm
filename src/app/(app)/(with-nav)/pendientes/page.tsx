import Link from "next/link";
import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../../convex/_generated/api";
import { getUser } from "@/lib/auth/dal";
import { readSessionToken } from "@/lib/auth/cookie";
import { Card } from "@/components/ui/core/Card";
import { Badge } from "@/components/ui/feedback/Badge";
import { formatDate } from "@/lib/contacts/format";
import { CompleteReminderButton } from "@/components/crm/CompleteReminderButton";

// Implementación MÍNIMA para cumplir el AC de MIS-12 ("aparece en
// pendientes al llegar la fecha", "marcar como hecho... desde pendientes"):
// solo lista los recordatorios de seguimiento vencidos o de hoy
// (convex/reminders.ts::listDueToday), con su acción "marcar hecho". MIS-13
// (Pantalla: Pendientes del día) sustituirá esto por el home completo de
// Carlos: otros tipos de pendientes, filtros, orden configurable, diseño
// final — ver PLANS/MIS-12-recordatorio-proximo-contacto.md, "Puntos
// abiertos".
export default async function PendientesPage() {
  const user = await getUser();
  const token = await readSessionToken(); // getUser() ya garantiza sesión válida aquí

  const reminders = await fetchQuery(api.reminders.listDueToday, { token: token! });

  return (
    <div className="flex flex-1 flex-col" style={{ padding: "16px 20px 24px", gap: 16 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <Badge tone="accent" style={{ alignSelf: "flex-start" }}>
          Operativo
        </Badge>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)" }}>Hola, {user.name}</h1>
        <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>Seguimientos vencidos o de hoy.</p>
      </div>

      {reminders.length === 0 ? (
        <p style={{ fontSize: 14, color: "var(--text-secondary)", textAlign: "center", padding: "32px 0" }}>
          No hay seguimientos pendientes para hoy.
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {reminders.map((r) => (
            <li key={r._id}>
              <Card padding="md" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
                <div style={{ flex: "1 1 200px", minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <Link
                      href={`/contactos/${r.contactId}`}
                      style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", textDecoration: "none" }}
                    >
                      {r.contactName}
                    </Link>
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

      <p style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
        Solo se muestran los seguimientos programados desde la ficha del contacto (MIS-12). MIS-13 ampliará
        esta pantalla con el resto de pendientes del día, filtros y el diseño final del home de Carlos.
      </p>
    </div>
  );
}

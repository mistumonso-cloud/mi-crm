"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../../convex/_generated/api";
import { Avatar } from "@/components/ui/core/Avatar";
import { Badge } from "@/components/ui/feedback/Badge";
import { Button } from "@/components/ui/core/Button";
import { Card } from "@/components/ui/core/Card";
import { BottomSheet } from "@/components/ui/overlays/BottomSheet";
import { InviteUserForm } from "./InviteUserForm";
import {
  changeRoleAction,
  setUserActiveAction,
  resendInviteAction,
  type ChangeRoleState,
  type SetUserActiveState,
  type ResendInviteState,
} from "@/lib/team/actions";

type TeamMember = FunctionReturnType<typeof api.team.listTeam>[number];

// Un supervisor "activo" cuenta para el guard "último admin": rol supervisor,
// sin baja y sin invitación pendiente. Espejo EXACTO de isActiveSupervisor en
// convex/team.ts — aquí es SOLO para deshabilitar visualmente; la autoridad
// real es el guard del servidor.
function isActiveSupervisor(u: TeamMember): boolean {
  return u.role === "supervisor" && u.deactivatedAt == null && u.invitePendingSince == null;
}

function statusBadge(u: TeamMember) {
  if (u.deactivatedAt != null) return <Badge tone="neutral">Inactivo</Badge>;
  if (u.invitePendingSince != null) return <Badge tone="warning">Invitación pendiente</Badge>;
  return <Badge tone="success">Activo</Badge>;
}

function roleBadge(u: TeamMember) {
  return u.role === "supervisor" ? (
    <Badge tone="accent">Propietaria</Badge>
  ) : (
    <Badge tone="neutral">Comercial</Badge>
  );
}

export function TeamView({
  team,
  currentUserId,
}: {
  team: TeamMember[];
  currentUserId: string;
}) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [actionsUserId, setActionsUserId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "warning"; text: string } | null>(null);

  const selected = team.find((u) => u.id === actionsUserId) ?? null;
  const activeSupervisorCount = team.filter(isActiveSupervisor).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Button type="button" full size="lg" onClick={() => setInviteOpen(true)}>
        + Invitar usuario
      </Button>

      {notice && (
        <Card
          padding="md"
          // Un fallo (warning) se anuncia con role="alert" (más urgente para
          // lectores de pantalla); una confirmación (success), con role="status".
          role={notice.tone === "warning" ? "alert" : "status"}
          style={{ background: `var(--color-${notice.tone}-bg)`, display: "flex", flexDirection: "column", gap: 4 }}
        >
          <p style={{ fontSize: 13, color: `var(--color-${notice.tone}-fg)`, margin: 0 }}>{notice.text}</p>
        </Card>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {team.map((u) => (
          <Card key={u.id} padding="md" style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Avatar name={u.name} />
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    color: "var(--text-primary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {u.name}
                </span>
                {u.id === currentUserId && (
                  <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-tertiary)" }}>Tú</span>
                )}
              </div>
              <span
                style={{
                  fontSize: 13,
                  color: "var(--text-secondary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {u.email}
              </span>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
                {roleBadge(u)}
                {statusBadge(u)}
              </div>
            </div>
            <button
              type="button"
              aria-label={`Acciones de ${u.name}`}
              onClick={() => setActionsUserId(u.id)}
              style={{
                border: "none",
                background: "none",
                cursor: "pointer",
                padding: 8,
                fontSize: 20,
                lineHeight: 1,
                color: "var(--text-tertiary)",
                borderRadius: "var(--radius-md)",
                flexShrink: 0,
              }}
            >
              ⋯
            </button>
          </Card>
        ))}
      </div>

      <BottomSheet open={inviteOpen} onClose={() => setInviteOpen(false)} title="Invitar usuario">
        <InviteUserForm
          onDone={() => setInviteOpen(false)}
          onResult={({ delivered }) =>
            setNotice(
              delivered
                ? { tone: "success", text: "Invitación enviada." }
                : {
                    tone: "warning",
                    text: "Usuario creado como «Invitación pendiente», pero el email no se pudo enviar. Usa «Reenviar invitación» en su ficha.",
                  },
            )
          }
        />
      </BottomSheet>

      <BottomSheet
        open={selected != null}
        onClose={() => setActionsUserId(null)}
        title={selected?.name}
      >
        {selected && (
          <UserActions
            user={selected}
            isLastActiveSupervisor={isActiveSupervisor(selected) && activeSupervisorCount === 1}
            isSelf={selected.id === currentUserId}
            onResult={(n) => setNotice(n)}
            onDone={() => setActionsUserId(null)}
          />
        )}
      </BottomSheet>
    </div>
  );
}

const changeRoleInitial: ChangeRoleState = undefined;
const setActiveInitial: SetUserActiveState = undefined;
const resendInitial: ResendInviteState = undefined;

function UserActions({
  user,
  isLastActiveSupervisor,
  isSelf,
  onResult,
  onDone,
}: {
  user: TeamMember;
  isLastActiveSupervisor: boolean;
  isSelf: boolean;
  onResult: (n: { tone: "success" | "warning"; text: string } | null) => void;
  onDone: () => void;
}) {
  const [roleState, roleAction, rolePending] = useActionState(changeRoleAction, changeRoleInitial);
  const [activeState, activeAction, activePending] = useActionState(
    setUserActiveAction,
    setActiveInitial,
  );
  const [resendState, resendAction, resendPending] = useActionState(resendInviteAction, resendInitial);
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);
  // Consumo ÚNICO de un resultado con éxito: aunque BottomSheet desmonta a sus
  // hijos al cerrar (`if (!open) return null` en BottomSheet.jsx, así que este
  // ref se reinicia en cada apertura), este cerrojo evita procesar dos veces el
  // mismo estado dentro de un mismo montaje.
  const handledRef = useRef(false);

  // Cambiar rol / (des)activar con éxito cierra la hoja: el refresh() del
  // servidor ya ha actualizado la lista antes de que el estado llegue a `success`.
  // Al completar, se LIMPIA cualquier aviso previo (invitación/reenvío) para que
  // no quede colgando un mensaje de una operación anterior.
  useEffect(() => {
    if ((roleState?.success || activeState?.success) && !handledRef.current) {
      handledRef.current = true;
      onResult(null);
      onDone();
    }
  }, [roleState, activeState, onResult, onDone]);

  // M4: el reenvío NO se trata como éxito silencioso. Se consume `delivered`
  // ANTES de cerrar y se eleva un aviso persistente a /equipo — un reenvío que
  // no salió (delivered:false) deja señal visible (la fila sigue pendiente, que
  // por sí sola no distingue "no entregado" de "aún sin aceptar").
  useEffect(() => {
    if (resendState?.success && !handledRef.current) {
      handledRef.current = true;
      onResult(
        resendState.delivered
          ? { tone: "success", text: `Invitación reenviada a ${user.name}.` }
          : {
              tone: "warning",
              text: `No se pudo reenviar la invitación a ${user.name}. Vuelve a intentarlo.`,
            },
      );
      onDone();
    }
  }, [resendState, onResult, onDone, user.name]);

  const pending = rolePending || activePending || resendPending;
  const nextRole = user.role === "supervisor" ? "rep" : "supervisor";
  const nextRoleLabel = nextRole === "rep" ? "Hacer Comercial" : "Hacer Propietaria";
  const isDeactivated = user.deactivatedAt != null;
  const isPendingInvite = user.invitePendingSince != null;

  const errorText =
    (roleState && !roleState.success && roleState.error) ||
    (activeState && !activeState.success && activeState.error) ||
    (resendState && !resendState.success && resendState.error) ||
    null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {isPendingInvite && !isDeactivated && (
        <form action={resendAction}>
          <input type="hidden" name="userId" value={user.id} />
          <Button type="submit" variant="secondary" full disabled={pending} style={{ justifyContent: "flex-start" }}>
            Reenviar invitación
          </Button>
        </form>
      )}

      {/* Cambiar rol. Bajar a Comercial al último supervisor activo va
          deshabilitado (reflejo visual; el guard real está en el servidor). */}
      <form action={roleAction}>
        <input type="hidden" name="userId" value={user.id} />
        <input type="hidden" name="role" value={nextRole} />
        <Button
          type="submit"
          variant="secondary"
          full
          disabled={pending || (nextRole === "rep" && isLastActiveSupervisor)}
          style={{ justifyContent: "flex-start" }}
        >
          {nextRoleLabel}
        </Button>
      </form>

      {/* Desactivar / reactivar. */}
      {isDeactivated ? (
        <form action={activeAction}>
          <input type="hidden" name="userId" value={user.id} />
          <Button
            type="submit"
            name="active"
            value="true"
            variant="secondary"
            full
            disabled={pending}
            style={{ justifyContent: "flex-start" }}
          >
            Reactivar acceso
          </Button>
        </form>
      ) : confirmingDeactivate ? (
        <Card padding="md" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
            ¿Quitar el acceso a {user.name}?
          </p>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>
            {isSelf
              ? "Perderás el acceso al CRM. Podrás recuperarlo solo si otra administradora te reactiva."
              : "No podrá entrar al CRM. Podrás reactivarle más adelante."}
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <Button
              type="button"
              variant="ghost"
              full
              onClick={() => setConfirmingDeactivate(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <form action={activeAction} style={{ flex: 1 }}>
              <input type="hidden" name="userId" value={user.id} />
              <Button type="submit" name="active" value="false" variant="danger" full disabled={pending}>
                Quitar acceso
              </Button>
            </form>
          </div>
        </Card>
      ) : (
        <Button
          type="button"
          variant="danger"
          full
          onClick={() => setConfirmingDeactivate(true)}
          disabled={pending || isLastActiveSupervisor}
          style={{ justifyContent: "flex-start" }}
        >
          Quitar acceso
        </Button>
      )}

      {isLastActiveSupervisor && !isDeactivated && (
        <p style={{ fontSize: 12, color: "var(--text-tertiary)", margin: 0 }}>
          Es la única administradora activa: no puede quedarse el CRM sin administración.
        </p>
      )}

      {errorText && (
        <div role="alert" style={{ fontSize: 13, color: "var(--color-danger-fg)" }}>
          {errorText}
        </div>
      )}

      <Button type="button" variant="ghost" full onClick={onDone} disabled={pending}>
        Cerrar
      </Button>
    </div>
  );
}

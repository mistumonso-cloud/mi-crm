"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/core/Button";
import { Input } from "@/components/ui/forms/Input";
import { closeSaleAction, type CloseSaleState } from "@/lib/contacts/actions";

const initialState: CloseSaleState = undefined;

// "YYYY-MM-DD" en la zona LOCAL del navegador — duplicado a propósito de
// ScheduleReminderForm.tsx (cada formulario de este directorio es
// autocontenido, mismo criterio que la duplicación de isValidEpochMs entre
// convex/ y src/lib/).
function msToDateLocal(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Mismo motivo que dateLocalToMs en ScheduleReminderForm.tsx: new
// Date("YYYY-MM-DD") se interpretaría como medianoche UTC. Se calcula en el
// NAVEGADOR — la Server Action nunca reparsea el string.
function dateLocalToMs(dateLocal: string): number {
  const [y, m, d] = dateLocal.split("-").map(Number);
  if (!y || !m || !d) return NaN;
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

// input type="number" expone siempre su .value con "." como separador
// decimal en el DOM (HTML Standard, independiente del locale de
// visualización del navegador) — Number(...) directo es seguro, sin
// normalizar comas. Math.round evita que un resultado con error de coma
// flotante (p. ej. 15.005 * 100 = 1500.4999999999998) produzca céntimos no
// enteros.
function eurosToCents(eurosLocal: string): number {
  if (!eurosLocal) return NaN;
  const euros = Number(eurosLocal);
  if (!Number.isFinite(euros)) return NaN;
  return Math.round(euros * 100);
}

type Outcome = "won" | "lost";

// Flujo de 2 pasos dentro de la misma hoja (AC: "se le presentan dos
// opciones"). Paso 1 (outcome === null): dos botones grandes que solo
// cambian estado local, no son submit. Paso 2 (outcome elegido): un único
// <form> con los campos de esa opción + "Confirmar", más "Atrás" para
// volver al paso 1 sin cerrar la hoja. Máximo 3 toques: abrir la hoja
// (fuera de este componente) -> elegir Ganada/Perdida -> Confirmar.
export function CloseSaleForm({ contactId, onDone }: { contactId: string; onDone: () => void }) {
  const [state, formAction, isPending] = useActionState(closeSaleAction, initialState);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // Controlados SOLO donde hace falta cómputo derivado (importe -> céntimos,
  // fecha -> epoch ms) — mismo criterio que dueDateLocal en
  // ScheduleReminderForm.tsx. product/lossReason son campos no controlados
  // (name + validación en el servidor), mismo criterio que reason en ese
  // mismo formulario.
  const [amountLocal, setAmountLocal] = useState("");
  const [purchaseDateLocal, setPurchaseDateLocal] = useState(() => msToDateLocal(Date.now()));

  useEffect(() => {
    if (state?.success) onDone();
  }, [state, onDone]);

  if (outcome === null) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Button variant="primary" full onClick={() => setOutcome("won")}>
          Venta ganada
        </Button>
        <Button variant="danger" full onClick={() => setOutcome("lost")}>
          Venta perdida
        </Button>
        <Button type="button" variant="ghost" full onClick={onDone}>
          Cancelar
        </Button>
      </div>
    );
  }

  const amountCents = eurosToCents(amountLocal);
  const purchaseDateMs = purchaseDateLocal ? dateLocalToMs(purchaseDateLocal) : NaN;

  // Errores de campo específico ya se muestran junto a su Input/textarea;
  // este bloque cubre solo errores generales (p. ej. "Este contacto ya
  // tiene una venta cerrada", field: "contactId") — se excluyen aquí los
  // 4 fields que YA tienen su propio mensaje inline más abajo.
  const generalError =
    state && "error" in state &&
    state.field !== "product" &&
    state.field !== "amountCents" &&
    state.field !== "purchaseDate" &&
    state.field !== "lossReason"
      ? state.error
      : null;

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <input type="hidden" name="contactId" value={contactId} />
      <input type="hidden" name="outcome" value={outcome} />
      {outcome === "won" ? (
        <>
          <Input
            label="Producto o servicio vendido"
            name="product"
            placeholder="Ej.: Plan anual Premium"
            required
            maxLength={200} // mismo límite que PRODUCT_MAX en convex/sales.ts — solo hint de UI, la mutation es la autoridad real
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
          <input
            type="hidden"
            name="purchaseDateMs"
            value={Number.isFinite(purchaseDateMs) ? purchaseDateMs : ""}
          />
          <Input
            label="Fecha de la compra"
            type="date"
            value={purchaseDateLocal}
            onChange={(e) => setPurchaseDateLocal(e.target.value)}
            required
            disabled={isPending}
            error={state && "field" in state && state.field === "purchaseDate" ? state.error : null}
          />
        </>
      ) : (
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>Motivo de pérdida</span>
          <textarea
            name="lossReason"
            placeholder='Ej.: "Precio demasiado alto", "Eligió a la competencia"...'
            required
            rows={3}
            maxLength={200} // mismo límite que LOSS_REASON_MAX en convex/sales.ts
            disabled={isPending}
            style={{
              width: "100%",
              padding: "10px 12px",
              fontFamily: "var(--font-sans)",
              fontSize: 14,
              color: "var(--text-primary)",
              background: isPending ? "var(--color-muted)" : "var(--color-surface)",
              border: "1px solid var(--color-border-strong)",
              borderRadius: "var(--radius-md)",
              outline: "none",
              resize: "vertical",
            }}
          />
          {state && "field" in state && state.field === "lossReason" && (
            <span style={{ fontSize: 12, color: "var(--color-danger-fg)" }}>{state.error}</span>
          )}
        </label>
      )}
      {generalError && (
        <div role="alert" style={{ fontSize: 13, color: "var(--color-danger-fg)" }}>
          {generalError}
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <Button type="button" variant="secondary" full onClick={() => setOutcome(null)} disabled={isPending}>
          Atrás
        </Button>
        <Button type="submit" variant={outcome === "won" ? "primary" : "danger"} full disabled={isPending}>
          {isPending ? "Guardando…" : "Confirmar"}
        </Button>
      </div>
    </form>
  );
}

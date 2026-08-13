"use client";

import { useTransition, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/core/Button";
import { Input } from "@/components/ui/forms/Input";
import {
  requestResetCodeAction,
  verifyResetCodeAction,
  resetPasswordAction,
  type RecoverActionState,
} from "@/lib/auth/actions";

const initialState: RecoverActionState = { step: "email" };

// MIS-285: 3 pasos (email → código → nueva contraseña) en un único
// componente cliente. No usa useActionState (un hook por form obligaría a
// sincronizar 3 estados independientes para saber "cuál fue el último en
// responder"): en su lugar, un único useState local + useTransition, y las
// server actions se invocan directamente pasándoles el FormData del form que
// disparó el submit — siguen siendo Server Actions normales, solo que el
// resultado se enruta a mano al estado del wizard.
export function RecoverForm() {
  const [state, setState] = useState<RecoverActionState>(initialState);
  const [isPending, startTransition] = useTransition();

  function handleEmailSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await requestResetCodeAction(state, formData);
      setState(result);
    });
  }

  function handleCodeSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await verifyResetCodeAction(state, formData);
      setState(result);
    });
  }

  function handlePasswordSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await resetPasswordAction(state, formData);
      setState(result);
    });
  }

  return (
    <div style={{ width: "100%", maxWidth: 375, display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
            Recuperar contraseña
          </h1>
          <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: "4px 0 0" }}>
            {state.step === "email" && "Te enviaremos un código a tu email"}
            {state.step === "code" && "Introduce el código de 6 dígitos que te hemos enviado"}
            {state.step === "password" && "Elige tu nueva contraseña"}
          </p>
        </div>
      </div>

      {state.step === "email" && (
        <form action={handleEmailSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Input
            label="Email"
            name="email"
            type="email"
            placeholder="tucorreo@email.com"
            autoComplete="email"
            required
            disabled={isPending}
          />
          <Button type="submit" full size="lg" disabled={isPending}>
            {isPending ? "Enviando…" : "Enviar código"}
          </Button>
        </form>
      )}

      {state.step === "code" && (
        <form action={handleCodeSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <input type="hidden" name="email" value={state.email} />
          <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>{state.email}</p>
          <Input
            label="Código"
            name="code"
            type="text"
            inputMode="numeric"
            maxLength={6}
            placeholder="000000"
            autoComplete="one-time-code"
            required
            disabled={isPending}
          />

          {state.error && <ErrorBox message={state.error} />}

          <Button type="submit" full size="lg" disabled={isPending}>
            {isPending ? "Comprobando…" : "Continuar"}
          </Button>

          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <button
              type="button"
              onClick={() => {
                const formData = new FormData();
                formData.set("email", state.email);
                handleEmailSubmit(formData);
              }}
              disabled={isPending}
              style={linkButtonStyle}
            >
              Reenviar código
            </button>
            <button
              type="button"
              onClick={() => setState({ step: "email" })}
              disabled={isPending}
              style={linkButtonStyle}
            >
              Usar otro email
            </button>
          </div>
        </form>
      )}

      {state.step === "password" && (
        <form action={handlePasswordSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* MIS-292 (M3): el ticket ya no viaja en un hidden input; va en una
              cookie httpOnly que la Server Action lee server-side. */}
          <Input
            label="Nueva contraseña"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={128}
            disabled={isPending}
          />
          <Input
            label="Repite la contraseña"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={128}
            disabled={isPending}
          />

          {state.error && <ErrorBox message={state.error} />}

          <Button type="submit" full size="lg" disabled={isPending}>
            {isPending ? "Guardando…" : "Guardar nueva contraseña"}
          </Button>
        </form>
      )}

      <a
        href="/login"
        style={{ textAlign: "center", fontSize: 13, color: "var(--text-secondary)", textDecoration: "none" }}
      >
        Volver al login
      </a>
    </div>
  );
}

const linkButtonStyle: CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  cursor: "pointer",
  fontSize: 13,
  color: "var(--color-accent)",
  textDecoration: "underline",
};

function ErrorBox({ message }: { message: string }) {
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 12px",
        borderRadius: "var(--radius-md)",
        background: "var(--color-danger-bg)",
        color: "var(--color-danger-fg)",
        fontSize: 13,
      }}
    >
      {message}
    </div>
  );
}

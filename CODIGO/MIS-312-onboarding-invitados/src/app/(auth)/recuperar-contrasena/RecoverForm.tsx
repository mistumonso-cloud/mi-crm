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

// MIS-312: textos parametrizables para reutilizar el MISMO wizard en dos rutas
// —recuperación (`/recuperar-contrasena`) y onboarding de invitados
// (`/configurar-contrasena`)— sin duplicar la lógica de los 3 pasos ni las
// server actions. Los valores por defecto son los de recuperación, así que la
// ruta existente no cambia de comportamiento.
export type RecoverCopy = {
  title: string;
  subtitleEmail: string;
  subtitleCode: string;
  subtitlePassword: string;
  submitEmailIdle: string;
  submitPasswordIdle: string;
  footerHref: string;
  footerLabel: string;
};

const RECOVER_COPY: RecoverCopy = {
  title: "Recuperar contraseña",
  subtitleEmail: "Te enviaremos un código a tu email",
  subtitleCode: "Introduce el código de 6 dígitos que te hemos enviado",
  subtitlePassword: "Elige tu nueva contraseña",
  submitEmailIdle: "Enviar código",
  submitPasswordIdle: "Guardar nueva contraseña",
  footerHref: "/login",
  footerLabel: "Volver al login",
};

// MIS-285: 3 pasos (email → código → nueva contraseña) en un único
// componente cliente. No usa useActionState (un hook por form obligaría a
// sincronizar 3 estados independientes para saber "cuál fue el último en
// responder"): en su lugar, un único useState local + useTransition, y las
// server actions se invocan directamente pasándoles el FormData del form que
// disparó el submit — siguen siendo Server Actions normales, solo que el
// resultado se enruta a mano al estado del wizard.
export function RecoverForm({
  copy = RECOVER_COPY,
  initialEmail,
}: {
  copy?: RecoverCopy;
  initialEmail?: string;
} = {}) {
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
            {copy.title}
          </h1>
          <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: "4px 0 0" }}>
            {state.step === "email" && copy.subtitleEmail}
            {state.step === "code" && copy.subtitleCode}
            {state.step === "password" && copy.subtitlePassword}
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
            defaultValue={initialEmail}
            required
            disabled={isPending}
          />
          <Button type="submit" full size="lg" disabled={isPending}>
            {isPending ? "Enviando…" : copy.submitEmailIdle}
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
            {isPending ? "Guardando…" : copy.submitPasswordIdle}
          </Button>
        </form>
      )}

      <a
        href={copy.footerHref}
        style={{ textAlign: "center", fontSize: 13, color: "var(--text-secondary)", textDecoration: "none" }}
      >
        {copy.footerLabel}
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

"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/core/Button";
import { Input } from "@/components/ui/forms/Input";
import { loginAction, type LoginActionState } from "@/lib/auth/actions";

const initialState: LoginActionState = undefined;

// MIS-260: initialError llega de page.tsx (Server Component) cuando el
// redirect completo de página tras el callback de Google trae
// ?error=google — un caso que useActionState no cubre, porque ese hook solo
// conoce el resultado de un submit del propio formulario de password.
type LoginFormProps = {
  initialError?: string;
  // MIS-285: aviso tras completar la recuperación de contraseña
  // (?reset=ok), leído en page.tsx igual que el error de Google.
  initialSuccess?: string;
};

export function LoginForm({ initialError, initialSuccess }: LoginFormProps) {
  const [state, formAction, isPending] = useActionState(loginAction, initialState);
  const [showPassword, setShowPassword] = useState(false);

  // Prioridad al error del propio submit de password sobre el que venga de
  // Google: si el usuario ya está reintentando con password tras un fallo
  // de Google, el error relevante es el nuevo.
  const displayError = state?.error ?? initialError;

  return (
    <div style={{ width: "100%", maxWidth: 375, display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center" }}>
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: "var(--radius-lg)",
            background: "var(--color-accent)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <MenuIcon />
        </div>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
            Vibe Coder CRM
          </h1>
          <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: "4px 0 0" }}>
            Gestiona tus contactos y nunca pierdas una venta
          </p>
        </div>
      </div>

      <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {!displayError && initialSuccess && (
          <div
            role="status"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 12px",
              borderRadius: "var(--radius-md)",
              background: "var(--color-success-bg)",
              color: "var(--color-success-fg)",
              fontSize: 13,
            }}
          >
            {initialSuccess}
          </div>
        )}
        <Input
          label="Email"
          name="email"
          type="email"
          placeholder="tucorreo@email.com"
          autoComplete="email"
          required
          disabled={isPending}
        />
        <Input
          label="Contraseña"
          name="password"
          type={showPassword ? "text" : "password"}
          placeholder="••••••••"
          autoComplete="current-password"
          required
          disabled={isPending}
          suffix={
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                display: "inline-flex",
                color: "inherit",
              }}
            >
              {showPassword ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          }
        />

        <a
          href="/recuperar-contrasena"
          style={{ alignSelf: "flex-end", fontSize: 13, color: "var(--color-accent)", textDecoration: "none" }}
        >
          ¿Olvidaste tu contraseña?
        </a>

        {/* MIS-312: pista para quien ha sido invitado y aún no tiene contraseña. */}
        <p style={{ fontSize: 12, color: "var(--text-tertiary)", margin: 0 }}>
          ¿Primera vez? Revisa tu email de invitación para crear tu contraseña.
        </p>

        {displayError && (
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
            <AlertIcon />
            {displayError}
          </div>
        )}

        <Button type="submit" full size="lg" disabled={isPending}>
          {isPending ? (
            <>
              <SpinnerIcon />
              Verificando…
            </>
          ) : (
            "Entrar"
          )}
        </Button>
      </form>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1, height: 1, background: "var(--color-border)" }} />
        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>o</span>
        <div style={{ flex: 1, height: 1, background: "var(--color-border)" }} />
      </div>

      {/* Enlace real, sin onClick/JS: navega a /api/auth/google/start, que
          redirige a Google. Funciona igual con o sin JS hidratado, mismo
          criterio de progressive enhancement que el resto del formulario. */}
      <a
        href="/api/auth/google/start"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          height: 44,
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--color-border)",
          background: "var(--color-surface)",
          color: "var(--text-primary)",
          fontSize: 14,
          fontWeight: 600,
          textDecoration: "none",
        }}
      >
        <GoogleIcon />
        Entrar con Google
      </a>
    </div>
  );
}

function MenuIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-contrast)" strokeWidth="2" strokeLinecap="round">
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a21.4 21.4 0 0 1 5.06-5.94M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 7 11 7a21.4 21.4 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" strokeOpacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.13-.84 2.09-1.8 2.73v2.27h2.91c1.7-1.57 2.69-3.88 2.69-6.64z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.17l-2.91-2.27c-.81.54-1.84.86-3.05.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.33C2.44 15.98 5.48 18 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.71c-.18-.54-.28-1.11-.28-1.71s.1-1.17.28-1.71V4.96H.96A8.996 8.996 0 0 0 0 9c0 1.45.35 2.83.96 4.04l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.96 4.96l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}

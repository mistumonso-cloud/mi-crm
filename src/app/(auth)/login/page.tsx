import { redirect } from "next/navigation";
import { getSession, landingPathForRole } from "@/lib/auth/dal";
import { LoginForm } from "./LoginForm";

// MIS-260: mensaje único para cualquier fallo del flujo de Google — mismo
// criterio anti-enumeración que el error genérico del login por password,
// nunca distingue el motivo real (eso solo se loguea server-side en el
// Route Handler de callback).
const GOOGLE_LOGIN_ERROR_MESSAGE =
  "No se pudo iniciar sesión con Google. Si tu cuenta no está registrada en el CRM, contacta con un administrador.";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reset?: string }>;
}) {
  // Comprobación real (no la optimista de src/proxy.ts): si ya hay una sesión
  // válida, saltar directamente al home por rol. Si la cookie existe pero la
  // sesión ya no es válida, getSession() devuelve null y esta página se
  // renderiza con normalidad — no hay redirect en bucle porque esto usa el
  // DAL real, no la mera presencia de la cookie.
  const user = await getSession();
  if (user) {
    redirect(landingPathForRole(user.role));
  }

  const { error, reset } = await searchParams;
  const googleError = error === "google";

  return (
    <div className="flex flex-1 items-center justify-center bg-[var(--color-bg)] px-4 py-16">
      <LoginForm
        initialError={googleError ? GOOGLE_LOGIN_ERROR_MESSAGE : undefined}
        initialSuccess={reset === "ok" ? "Contraseña actualizada. Ya puedes iniciar sesión." : undefined}
      />
    </div>
  );
}

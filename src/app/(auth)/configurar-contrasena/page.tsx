import { redirect } from "next/navigation";
import { getSession, landingPathForRole } from "@/lib/auth/dal";
import { RecoverForm, type RecoverCopy } from "../recuperar-contrasena/RecoverForm";

// MIS-312: pantalla de bienvenida para invitados que crean su PRIMERA contraseña.
// Reutiliza el MISMO wizard de 3 pasos (email → código → contraseña) y las MISMAS
// server actions del flujo de recuperación (motor de código+ticket de MIS-285),
// solo con copy de alta. Anti-enumeración intacta: `requestPasswordResetCode`
// responde igual exista o no la cuenta.

const MAX_EMAIL_LENGTH = 254;
const EMAIL_FORMAT = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Normaliza el `?email=` del enlace de la invitación. Solo prellena el campo (no
// autoriza nada; el servidor revalida en el flujo de código). DESCARTA (deja el
// campo vacío) si viene como array, vacío, sobredimensionado (>254) o sin forma
// de email — NUNCA trunca (truncar podría convertir una entrada manipulada en
// otra dirección aparentemente válida y disparar un envío innecesario de código).
function normalizeInitialEmail(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_EMAIL_LENGTH || !EMAIL_FORMAT.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

const ONBOARDING_COPY: RecoverCopy = {
  title: "Te damos la bienvenida",
  subtitleEmail: "Te enviaremos un código para crear tu contraseña",
  subtitleCode: "Introduce el código de 6 dígitos que te hemos enviado",
  subtitlePassword: "Crea tu contraseña",
  submitEmailIdle: "Enviar código",
  submitPasswordIdle: "Crear contraseña",
  footerHref: "/login",
  footerLabel: "Volver al inicio de sesión",
};

export default async function ConfigurarContrasenaPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string | string[] }>;
}) {
  // Mismo guard que login/recuperar: un usuario ya logueado no hace onboarding.
  const user = await getSession();
  if (user) {
    redirect(landingPathForRole(user.role));
  }

  const { email } = await searchParams;
  const initialEmail = normalizeInitialEmail(email);

  return (
    <div className="flex flex-1 items-center justify-center bg-[var(--color-bg)] px-4 py-16">
      <RecoverForm copy={ONBOARDING_COPY} initialEmail={initialEmail} />
    </div>
  );
}

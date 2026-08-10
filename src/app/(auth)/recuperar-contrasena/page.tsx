import { redirect } from "next/navigation";
import { getSession, landingPathForRole } from "@/lib/auth/dal";
import { RecoverForm } from "./RecoverForm";

// MIS-285: mismo criterio que login/page.tsx:22-25 — si ya hay sesión válida,
// no tiene sentido ofrecer recuperar una contraseña.
export default async function RecoverPasswordPage() {
  const user = await getSession();
  if (user) {
    redirect(landingPathForRole(user.role));
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-[var(--color-bg)] px-4 py-16">
      <RecoverForm />
    </div>
  );
}

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/dal";
import { LoginForm } from "./LoginForm";

export default async function LoginPage() {
  // Comprobación real (no la optimista de src/proxy.ts): si ya hay una sesión
  // válida, saltar directamente al home por rol. Si la cookie existe pero la
  // sesión ya no es válida, getSession() devuelve null y esta página se
  // renderiza con normalidad — no hay redirect en bucle porque esto usa el
  // DAL real, no la mera presencia de la cookie.
  const user = await getSession();
  if (user) {
    redirect(user.role === "rep" ? "/pendientes" : "/panel");
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-[var(--color-bg)] px-4 py-16">
      <LoginForm />
    </div>
  );
}

import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth/dal";

// Dispatcher puro: no tiene JSX propio, solo decide a dónde redirigir según el
// rol. MIS-13/MIS-17 son los destinos reales.
export default async function AppIndexPage() {
  const user = await getUser();
  redirect(user.role === "rep" ? "/pendientes" : "/panel");
}

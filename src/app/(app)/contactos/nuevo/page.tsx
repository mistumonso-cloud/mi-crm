import Link from "next/link";
import { Badge } from "@/components/ui/feedback/Badge";
import { getUser } from "@/lib/auth/dal";

// Placeholder — lo sustituye MIS-8 (Pantalla: Añadir contacto). Destino del
// FAB. Vive fuera de (with-nav) a propósito: sin barra ni FAB (el ticket
// describe esta pantalla como "donde se usa el botón de volver"). El enlace
// de abajo es solo para no dejar un callejón sin salida durante la
// verificación de MIS-18 — MIS-8 define el back button real.
export default async function NuevoContactoPage() {
  const user = await getUser();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <Link
        href="/contactos"
        style={{
          alignSelf: "flex-start",
          marginLeft: 16,
          marginBottom: -8,
          fontSize: 14,
          fontWeight: 600,
          color: "var(--color-accent)",
          textDecoration: "none",
        }}
      >
        ‹ Volver a Contactos
      </Link>
      <Badge tone="accent">Nuevo contacto</Badge>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)" }}>Hola, {user.name}</h1>
      <p style={{ fontSize: 14, color: "var(--text-secondary)", maxWidth: 320 }}>
        Aquí se construirá el formulario de añadir contacto (MIS-8).
      </p>
    </div>
  );
}

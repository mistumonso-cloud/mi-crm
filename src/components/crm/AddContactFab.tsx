import Link from "next/link";

export function AddContactFab() {
  return (
    <Link
      href="/contactos/nuevo"
      aria-label="Añadir contacto"
      style={{
        position: "fixed",
        right: 16,
        bottom: "calc(88px + env(safe-area-inset-bottom))",
        width: 52,
        height: 52,
        borderRadius: "var(--radius-full)",
        background: "var(--color-accent)",
        color: "var(--color-accent-contrast)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 26,
        fontWeight: 300,
        lineHeight: 1,
        textDecoration: "none",
        // Shadow "de marca" (accent con alpha), no uno de los tokens
        // --shadow-*: esos son grises neutros pensados para cards/modales.
        boxShadow: "0 4px 14px rgba(59,82,102,.4)",
        zIndex: 20,
      }}
    >
      <span aria-hidden="true">+</span>
    </Link>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge } from "@/components/ui/feedback/Badge";

const TABS = [
  { href: "/pendientes", label: "Pendientes", Icon: ClockIcon },
  { href: "/contactos", label: "Contactos", Icon: ContactsIcon },
  { href: "/panel", label: "Panel", Icon: PanelIcon },
];

// dueTodayCount (MIS-12): recordatorios de seguimiento vencidos o de hoy,
// vía convex/reminders.ts::countDueToday, resuelto por
// (with-nav)/layout.tsx — la "notificación in-app de pendientes de hoy"
// que exige el AC del ticket. No existe ningún otro mecanismo de
// toast/push en el repo (ver PLANS/MIS-12-recordatorio-proximo-contacto.md,
// Contexto, decisión 3): un badge persistente y visible en cada
// navegación cumple el requisito del MVP sin infraestructura de push.
export function BottomNav({ dueTodayCount = 0 }: { dueTodayCount?: number }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navegación principal"
      style={{
        position: "fixed",
        insetInline: 0,
        bottom: 0,
        height: "calc(72px + env(safe-area-inset-bottom))",
        // boxSizing + paddingBottom (en vez de sumar el safe-area solo a la
        // altura) deja exactamente 72px de caja de contenido arriba del
        // padding, para que el centrado no desplace iconos/labels hacia la
        // zona insegura del home indicator en iPhones con notch.
        boxSizing: "border-box",
        paddingLeft: 4,
        paddingRight: 4,
        paddingTop: 0,
        paddingBottom: "env(safe-area-inset-bottom)",
        background: "var(--color-surface)",
        borderTop: "1px solid var(--color-border)",
        display: "flex",
        alignItems: "stretch",
        zIndex: 10,
      }}
    >
      {TABS.map(({ href, label, Icon }) => {
        const active = pathname === href;
        const showBadge = href === "/pendientes" && dueTodayCount > 0;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              textDecoration: "none",
            }}
          >
            <span
              style={{
                position: "relative",
                width: 40,
                height: 30,
                borderRadius: "var(--radius-full)",
                background: active ? "var(--color-accent-tint)" : "transparent",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "background-color .18s ease-out",
              }}
            >
              <Icon stroke={active ? "var(--color-accent)" : "var(--text-tertiary)"} />
              {showBadge && (
                <Badge
                  tone="danger"
                  aria-label={`${dueTodayCount} seguimiento${dueTodayCount === 1 ? "" : "s"} pendiente${dueTodayCount === 1 ? "" : "s"} para hoy`}
                  style={{
                    position: "absolute",
                    top: -2,
                    right: -2,
                    minWidth: 16,
                    height: 16,
                    padding: "0 4px",
                    fontSize: 10,
                    justifyContent: "center",
                  }}
                >
                  {dueTodayCount > 9 ? "9+" : dueTodayCount}
                </Badge>
              )}
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: active ? 600 : 500,
                color: active ? "var(--color-accent)" : "var(--text-tertiary)",
              }}
            >
              {label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

function ClockIcon({ stroke }: { stroke: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function ContactsIcon({ stroke }: { stroke: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function PanelIcon({ stroke }: { stroke: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}

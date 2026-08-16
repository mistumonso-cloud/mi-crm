import type { NextConfig } from "next";

// MIS-288 (1A.7 + 1A.2): cabeceras de seguridad y desactivación del optimizador
// de imágenes.
//
// MIS-300 (M2, fase 3): la Content-Security-Policy YA NO vive aquí. Se movió a
// `src/proxy.ts`, que la emite POR PETICIÓN con un nonce fresco (`script-src`
// pierde 'unsafe-inline' y pasa a 'nonce-<n>' 'strict-dynamic'). Fijarla también
// aquí crearía DOS cabeceras CSP y el navegador aplicaría su intersección,
// rompiendo la app. Estas cabeceras restantes NO llevan nonce, así que se quedan
// como estáticas (aplican a toda respuesta que sirve Next vía headers()).

const SECURITY_HEADERS = [
  // Redundante con frame-ancestors (que ahora vive en la CSP del proxy), cubre
  // navegadores viejos y respuestas sin CSP.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  // MIS-301: includeSubDomains añadido tras inventario AUTORITATIVO de la zona DNS
  // (6/6 registros; solo el apex es web; `send` es correo; sin www ni comodín) y
  // aceptación del usuario. preload NO (casi irreversible). Esta es la ÚNICA fuente
  // del HSTS: Cloudflare tiene el edge-HSTS DESACTIVADO y ninguna Response Header
  // Transform Rule lo toca (verificado 2026-08-16), así que Cloudflare la reenvía.
  // includeSubDomains condiciona TODO subdominio presente y FUTURO: cualquier
  // subdominio-web nuevo debe tener HTTPS válido ANTES de publicarse en DNS.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  // 1A.2: el handler /_next/image es una ruta dinámica y el proyecto no usa
  // next/image en ningún sitio, así que se desactiva en vez de dejarlo como
  // superficie sin cubrir por el secreto de origen.
  images: { unoptimized: true },

  // B8: fuera de este origen, la comprobación Origin/Host de las Server
  // Actions falla cerrado. Detrás de Cloudflare el Host efectivo es el
  // dominio canónico.
  experimental: {
    serverActions: { allowedOrigins: ["mistu-monso.com"] },
  },

  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;

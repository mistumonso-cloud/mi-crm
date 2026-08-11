import type { NextConfig } from "next";

// MIS-288 (1A.7 + 1A.2): cabeceras de seguridad, CSP y desactivación del
// optimizador de imágenes.

// CSP de fase 1. Lo que arregla de verdad es el CLICKJACKING (frame-ancestors
// 'none'): /login y el paso del código OTP dejan de ser embebibles.
//
// `script-src` conserva 'unsafe-inline' porque sin nonce Next no arranca sus
// scripts de bootstrap; `style-src` también, porque la app usa atributos
// style={{…}} por todas partes y el nonce no cubre atributos de estilo. El
// endurecimiento real de script-src (CSP con nonce en proxy.ts) es fase 3 —
// desactiva la optimización estática y es incompatible con PPR.
//
// `connect-src` incluye Convex porque ConvexClientProvider sigue montado en
// esta fase (aunque nada del navegador lo use); la fase 3 lo retira y entonces
// connect-src puede estrecharse a 'self'.
// `next dev` sirve con NODE_ENV="development"; `next start` (Railway) con
// "production". React y el runtime de dev de Next usan eval (HMR, overlay de
// errores), así que en desarrollo hace falta 'unsafe-eval' o se rompe la
// interactividad de cliente. En PRODUCCIÓN no se incluye — CSP más estricta,
// tal como documenta la guía de CSP de Next.
const IS_PRODUCTION = process.env.NODE_ENV === "production";

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${IS_PRODUCTION ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.convex.cloud wss://*.convex.cloud",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
  // Redundante con frame-ancestors, cubre navegadores viejos.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  // Sin includeSubDomains ni preload hasta inventariar subdominios (fase 3);
  // también aquí, no solo en Cloudflare, para sobrevivir a un cambio de CDN.
  { key: "Strict-Transport-Security", value: "max-age=63072000" },
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

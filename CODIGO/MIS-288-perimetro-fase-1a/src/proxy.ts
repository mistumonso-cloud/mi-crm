import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { SESSION_COOKIE_NAME } from "./lib/auth/constants";

// MIS-288 (1A.1–1A.3): el proxy tiene ahora TRES preocupaciones independientes,
// aplicadas en este orden:
//
//   1. Secreto de origen (I1) — solo pasa lo que venga de Cloudflare, que
//      inyecta X-Origin-Auth vía Transform Rule. El spike 1A.0 probó que al
//      origen se llega directo (dominio de Railway e incluso IP cruda con el
//      host canónico), así que este check es la línea de defensa real; sin él,
//      cualquiera falsea `cf-connecting-ip` y con ello el rate limiting.
//   2. Host canónico — higiene contra cache poisoning / hosts raros.
//   3. Check optimista de cookie — el de siempre, SOLO en las rutas de
//      siempre. La fuente de verdad real sigue siendo el DAL
//      (src/lib/auth/dal.ts), llamado desde cada page protegida.
//
// Los checks 1 y 2 solo aplican en producción (NODE_ENV === "production"): en
// dev/test (npm run dev, que es lo que arranca Playwright) no se exige nada de
// Cloudflare, así que no hay bypass silencioso en producción pero local y CI
// funcionan sin configuración extra.
//
// A propósito NO redirige "/login" -> "/" solo porque exista la cookie: una
// cookie presente no significa sesión válida. Si el proxy asumiera "hay cookie
// = autenticado" y bounceara /login -> /, y el DAL detecta la sesión inválida y
// manda / -> /login, se entra en un bucle infinito. Dejar "/login" accesible lo
// rompe. En Next 16 `proxy.ts` usa Node.js siempre; el config `runtime` no está
// disponible aquí (exportarlo lanza error de build), así que no se declara.

// Prefijos con check optimista de cookie — la MISMA lista que antes vivía en el
// matcher (MIS-18), ahora explícita aquí porque el matcher se amplió para que
// los checks de origen cubran TODAS las rutas dinámicas (incluidas
// /api/auth/google/* y las Server Actions, que un matcher-allowlist dejaba
// fuera). "/login" queda deliberadamente fuera de esta lista (ver arriba).
const COOKIE_GATED_PREFIXES = ["/pendientes", "/panel", "/contactos"];

function isCookieGated(pathname: string): boolean {
  if (pathname === "/") return true;
  return COOKIE_GATED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

// Comparación en tiempo constante y de longitud fija: hasheamos ambos lados con
// SHA-256 antes de timingSafeEqual, así no se filtra la longitud del secreto ni
// puede lanzar por longitudes distintas. Node runtime está garantizado en
// proxy.ts (Next 16), así que node:crypto está disponible.
function secretMatches(provided: string, expected: string | undefined): boolean {
  if (!expected) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

// Acepta ORIGIN_SHARED_SECRET y, si está definida, ORIGIN_SHARED_SECRET_NEXT —
// la clave doble permite rotar el secreto sin ventana de 403: se pone el nuevo
// en _NEXT, se cambia la Transform Rule, se verifica, y se promueve _NEXT a la
// principal.
function originAuthenticated(request: NextRequest): boolean {
  const provided = request.headers.get("x-origin-auth") ?? "";
  return (
    secretMatches(provided, process.env.ORIGIN_SHARED_SECRET) ||
    secretMatches(provided, process.env.ORIGIN_SHARED_SECRET_NEXT)
  );
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // /api/health: exenta del secreto de origen, del host y del fail-closed —
  // pero SOLO en GET/HEAD, que es lo que usa la sonda interna de Railway (no
  // pasa por Cloudflare y no lleva el secreto). Cualquier otro método pasa por
  // el perímetro normal; el route handler solo expone GET, así que responde
  // 405. El route handler decide 200/503 según la presencia de variables (1A.4).
  if (pathname === "/api/health" && (request.method === "GET" || request.method === "HEAD")) {
    return NextResponse.next();
  }

  if (process.env.NODE_ENV === "production") {
    const originSecret = process.env.ORIGIN_SHARED_SECRET;
    const canonicalHost = process.env.APP_CANONICAL_HOST;
    const authServerKey = process.env.AUTH_SERVER_KEY;

    // Fail-closed (I2): sin las variables obligatorias no servimos nada
    // dinámico. Devolver 503 aquí es lo que hace que un deploy mal configurado
    // no llegue a promocionarse (junto al guardián de /api/health).
    if (!originSecret || !canonicalHost || !authServerKey) {
      return new NextResponse("Service Unavailable", { status: 503 });
    }

    // I1: solo lo que venga de Cloudflare (lleva el secreto de origen).
    if (!originAuthenticated(request)) {
      return new NextResponse("Forbidden", { status: 403 });
    }

    // Host canónico.
    if (request.headers.get("host") !== canonicalHost) {
      return new NextResponse("Forbidden", { status: 403 });
    }
  }

  // Check optimista de cookie — solo en las rutas de siempre.
  if (isCookieGated(pathname) && !request.cookies.has(SESSION_COOKIE_NAME)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

// Matcher ampliado: el secreto de origen debe cubrir TODA ruta dinámica, no
// solo las protegidas por cookie. Se excluyen únicamente los ficheros servidos
// de disco (/_next/static y /favicon.ico), que no ejecutan lógica. /_next/image
// NO se excluye a propósito (queda cubierto), aunque además se desactivó el
// optimizador en next.config.ts.
export const config = {
  matcher: ["/((?!_next/static|favicon.ico).*)"],
};

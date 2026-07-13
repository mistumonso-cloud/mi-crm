import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "./lib/auth/constants";

// Check optimista: solo mira si existe la cookie, sin tocar Convex. La fuente
// de verdad real es el DAL (src/lib/auth/dal.ts), llamado desde cada page
// protegida.
//
// A propósito NO redirige "/login" -> "/" solo porque exista la cookie: una
// cookie presente no significa sesión válida (puede haber expirado o haberse
// revocado por logout en otro dispositivo/cron). Si el proxy asumiera "hay
// cookie = autenticado" y bounceara /login -> /, y el DAL detecta la sesión
// inválida y manda de vuelta / -> /login, se entra en un bucle infinito de
// redirects entre proxy (check falso-optimista) y DAL (check real). Dejar
// "/login" siempre accesible rompe ese bucle. Si se quiere la UX de saltarse
// el login cuando ya hay sesión válida, esa comprobación vive en
// src/app/(auth)/login/page.tsx usando el DAL real (getSession()), no aquí.
//
// En Next 16, `proxy.ts` usa Node.js siempre; el config `runtime` no está
// disponible aquí y exportarlo lanza error de build, así que no se declara.

export function proxy(request: NextRequest) {
  const hasSession = request.cookies.has(SESSION_COOKIE_NAME);
  const { pathname } = request.nextUrl;

  if (!hasSession && pathname !== "/login") {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

// Matcher explícito (allowlist) en vez de negativo: un matcher negativo tipo
// "todo excepto _next/static|_next/image|favicon.ico" bloquea de más — assets
// públicos como /next.svg, /robots.txt, o futuros /api/* quedarían atrapados
// por el proxy sin necesidad.
//
// MIS-18: "/contactos/:path*" es un prefijo, no una lista de rutas exactas —
// cubre /contactos, /contactos/nuevo y el futuro /contactos/[id] (MIS-10) con
// una sola entrada, a costa de también matchear subrutas aún inexistentes.
// No es un problema de seguridad: este matcher es solo el check optimista de
// cookie, getUser() en el DAL sigue siendo la fuente de verdad real.
export const config = {
  matcher: ["/", "/login", "/pendientes/:path*", "/panel/:path*", "/contactos/:path*"],
};

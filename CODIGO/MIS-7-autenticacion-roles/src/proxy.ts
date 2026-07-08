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

// Matcher explícito (allowlist) en vez de negativo: cubre exactamente las
// rutas que existen hoy en la app. Un matcher negativo tipo
// "todo excepto _next/static|_next/image|favicon.ico" bloquea de más —
// assets públicos como /next.svg, /robots.txt, o futuros /api/* quedarían
// atrapados por el proxy sin necesidad.
export const config = {
  matcher: ["/", "/login", "/pendientes/:path*", "/panel/:path*"],
};

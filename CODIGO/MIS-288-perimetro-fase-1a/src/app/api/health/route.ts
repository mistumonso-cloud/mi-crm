import { NextResponse } from "next/server";

// MIS-288 (1A.4): endpoint de health y guardián de despliegue.
//
// Railway llama a esta ruta ANTES de dar un deploy por bueno, por su red
// interna (no pasa por Cloudflare), así que no lleva el secreto de origen —
// por eso src/proxy.ts la exime del secreto y del check de host. Y como una
// sonda fallida hace que Railway NO promocione el deploy (mantiene el viejo
// sano en pie), esta ruta comprueba además que las variables obligatorias
// ESTÁN presentes y devuelve 503 si falta alguna: un deploy mal configurado
// no llega a producción.
//
// INVARIANTE (no crecer): comprobar la PRESENCIA de env vars es barato y no
// toca nada externo. Esta ruta nunca debe consultar Convex, Resend ni base de
// datos, ni leer el VALOR de un secreto — es la única ruta dinámica sin
// autenticar, y en cuanto tocara un servicio dejaría de ser segura como tal.

export const dynamic = "force-dynamic";

// Los dos secretos siguen el contrato de 32 bytes; se exige un mínimo holgado
// (16) que ataja un valor en blanco o claramente truncado sin acoplar el health
// a un formato exacto. APP_CANONICAL_HOST es un hostname, no un secreto: solo se
// exige que no esté en blanco.
const REQUIRED_ENV_VARS: ReadonlyArray<{ name: string; minLength: number }> = [
  { name: "ORIGIN_SHARED_SECRET", minLength: 16 },
  { name: "APP_CANONICAL_HOST", minLength: 1 },
  { name: "AUTH_SERVER_KEY", minLength: 16 },
];

function isPresent({ name, minLength }: { name: string; minLength: number }): boolean {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length >= minLength;
}

export async function GET() {
  // El perímetro (y por tanto el guardián de variables) solo aplica en
  // producción — en dev/test las defensas de origen están desactivadas
  // (src/proxy.ts), así que no exigimos nada aquí.
  if (process.env.NODE_ENV !== "production") {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const allPresent = REQUIRED_ENV_VARS.every(isPresent);
  // Respuesta deliberadamente opaca: no se dice qué variable falta (la
  // respuesta es pública, exenta del secreto de origen).
  return NextResponse.json({ ok: allPresent }, { status: allPresent ? 200 : 503 });
}

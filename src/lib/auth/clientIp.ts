import { headers } from "next/headers";

// MIS-288 (1A.6): única fuente de verdad de "de dónde viene esta petición".
//
// Lee SOLO `cf-connecting-ip`, la cabecera que escribe Cloudflare y que el
// cliente no puede sobreescribir cuando la petición pasa por Cloudflare. Su
// fiabilidad se apoya en el secreto de origen de src/proxy.ts: nada que no
// venga de Cloudflare llega hasta aquí (403 antes), así que la
// `cf-connecting-ip` que vemos siempre la puso Cloudflare.
//
// NUNCA cae de vuelta a `x-forwarded-for`: el spike 1A.0 probó que el origen
// acepta un `x-forwarded-for`/`cf-connecting-ip` falso del cliente, así que un
// fallback derrotaría todo el ejercicio.
//
// La validación de formato está DUPLICADA de convex/lib/rateLimit.ts a
// propósito: src/ y convex/ corren en runtimes/bundles distintos y el repo no
// cruza imports entre ambos (mismo criterio que src/lib/auth/google.ts).
const MAX_IP_LENGTH = 45; // suficiente para IPv6
const IPV4_RE = /^(\d{1,3})(\.\d{1,3}){3}$/;
const IPV6_RE = /^[0-9a-fA-F:]+$/;

function normalizeIp(raw: string | null): string | null {
  if (!raw) return null;
  const first = raw.split(",")[0]?.trim() ?? "";
  if (!first || first.length > MAX_IP_LENGTH) return null;
  const looksLikeIpv4 = IPV4_RE.test(first);
  const looksLikeIpv6 = first.includes(":") && IPV6_RE.test(first);
  if (!looksLikeIpv4 && !looksLikeIpv6) return null;
  return first;
}

// Devuelve la IP tras una validación SIMPLE de formato (forma IPv4/IPv6, no RFC
// completa — no comprueba que cada octeto sea ≤255), o null si no hay cabecera
// resoluble. Mismo criterio que normalizeIpHint en convex/lib/rateLimit.ts, con
// el que debe mantenerse alineado. En desarrollo (sin Cloudflare delante)
// devolverá null y no se aplicará límite por IP — igual que hoy cuando falta.
export async function getClientIp(): Promise<string | null> {
  const store = await headers();
  return normalizeIp(store.get("cf-connecting-ip"));
}

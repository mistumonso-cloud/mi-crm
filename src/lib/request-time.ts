import { connection } from "next/server";

// connection() + Date.now() en una función aparte: el lint react-hooks/purity
// prohíbe Date.now() directo en el cuerpo de un Server Component. Mismo
// patrón que ya usaba contactos/page.tsx (MIS-9) de forma local; se extrae
// aquí como util compartido entre esa página y contactos/[id]/page.tsx
// (MIS-10) para no duplicar el workaround por segunda vez.
export async function getRequestTime(): Promise<number> {
  await connection();
  return Date.now();
}

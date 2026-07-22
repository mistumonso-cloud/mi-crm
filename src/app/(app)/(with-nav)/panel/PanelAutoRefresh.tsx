"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Intervalo de refresco automático, en ms. Marta es una sesión de
// navegador DISTINTA a la de Carlos y no dispara ninguna mutation propia —
// a diferencia del resto del repo, donde "tiempo real" se resuelve con
// refresh() (next/cache) tras la propia Server Action del usuario (ver
// PLANS/MIS-16-historial-actividad.md, decisión 5), aquí no hay ninguna
// acción propia que reaccionar. router.refresh() (next/navigation,
// cliente) re-renderiza el árbol de Server Components de la ruta actual
// con datos frescos (fetchQuery se re-ejecuta en el servidor con el token
// de la cookie HttpOnly, que nunca pasa por este componente) sin desmontar
// los Client Components ya vivos — ver decisión 1 de
// PLANS/MIS-17-panel-oportunidades.md para el ADR completo frente a
// useQuery.
const REFRESH_INTERVAL_MS = 20_000;

// Sin render propio (retorna null): su única función es mantener vivo el
// intervalo mientras /panel esté montado. Se desmonta solo al navegar
// fuera de /panel, limpiando el intervalo vía el cleanup de useEffect.
export function PanelAutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => {
      // Evita refrescar mientras la pestaña/app está en segundo plano
      // (pantalla bloqueada, otra pestaña activa) — no lo pide el AC, pero
      // evita gastar lecturas de Convex sin que nadie las vea.
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [router]);

  return null;
}

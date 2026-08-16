# MIS-293 · PR-1a-bis — Activar NFKC (A3-ii) — CÓDIGO COMPLETO

Rama (a crear tras GO): `mistumonso/mis-293-pr1a-bis-nfkc`. Plan: `PLANS/MIS-293-higiene-nucleo.md`
(A3-ii, ya GO). **Segunda** de las tres unidades del núcleo: `PR-1a → gate [] → **PR-1a-bis** → PR-1b`.

**Prerrequisito ya cumplido:** PR-1a mergeado y desplegado a prod (PR #58, `5f91583`,
`greedy-tapir-20`); **gate NFKC inicial = `[]`** (0 cuentas no canónicas). Eso **habilita** activar
NFKC. La consulta precursora `accountsWithNonCanonicalEmail` (A3-i) ya vive en prod y es el gate que
se **repite just-in-time** antes de desplegar esto.

> **Documento autocontenido:** el auditor solo ve este texto. Ambos ficheros están **modificados**
> (no nuevos); se incluyen sus **diffs literales completos**.

---

## Manifiesto de ficheros (PR-1a-bis)

| Fichero | Acción | Ítem |
|---|---|---|
| `convex/lib/rateLimit.ts` | modificado | A3-ii (NFKC en `normalizeEmailKey`) |
| `e2e/lib-unit.spec.ts` | modificado | A3-ii (test de unidad NFKC) |

Ambos con snapshot byte-idéntico en `CODIGO/MIS-293-higiene-nucleo/pr-1a-bis/<ruta>`.

---

## A3-ii · `convex/lib/rateLimit.ts` — NFKC en `normalizeEmailKey`

Única línea de comportamiento. Aplica la **forma canónica completa** `NFKC → trim → toLowerCase`
(la misma que el gate `accountsWithNonCanonicalEmail` de A3-i comparó contra los datos de prod).
No cambia firmas, ni el resto del módulo, ni el schema.

```diff
 export function normalizeEmailKey(email: string): string {
-  return email.trim().toLowerCase();
+  // MIS-293 (B12 / A3-ii): NFKC ANTES de trim + toLowerCase, para que dos formas
+  // Unicode compatibles (ligaduras, anchura completa, …) produzcan la MISMA clave
+  // de rate-limit y la MISMA búsqueda `by_email`. Se activa tras confirmar en prod
+  // que `accountsWithNonCanonicalEmail` (A3-i) devuelve `[]` (ninguna cuenta
+  // almacenada cambia bajo NFKC), así que ninguna búsqueda existente se rompe.
+  return email.normalize("NFKC").trim().toLowerCase();
 }
```

**Consecuencia (Baja, ronda 1):** el gate `[]` no prueba que las cuentas sean ASCII, sino que **toda
email almacenada es invariante bajo `NFKC → trim → toLowerCase`** (podría haber caracteres Unicode
ya canónicos). Por tanto, activar NFKC **no cambia la clave** de ninguna cuenta existente ni rompe
su búsqueda `by_email`. Solo cambia el resultado para entradas **no canónicas** (caracteres de
compatibilidad), que ahora canonizan a su forma esperada.

---

## A3-ii · `e2e/lib-unit.spec.ts` — test de unidad NFKC (project `unit`)

Se añade el import de `normalizeEmailKey` y un `describe` nuevo al final. Los tests de B5 (PR-1a) no
cambian.

**Import (diff):**

```diff
 import { test, expect } from "@playwright/test";
 import { hashPassword, verifyPassword } from "../convex/lib/password";
+import { normalizeEmailKey } from "../convex/lib/rateLimit";
```

**Bloque añadido al final (literal):**

```diff
 });
+
+test.describe("normalizeEmailKey — NFKC (B12 / A3-ii, MIS-293)", () => {
+  test("aplica NFKC además de trim + minúsculas", () => {
+    // Ligadura "ﬀ" (U+FB00) -> NFKC -> "ff"; con espacios y mayúsculas alrededor.
+    expect(normalizeEmailKey("  OﬀICE@Example.COM  ")).toBe("office@example.com");
+    // Carácter de anchura completa "Ｔ" (U+FF34) -> "T" -> minúscula "t".
+    expect(normalizeEmailKey("Ｔest@x.com")).toBe("test@x.com");
+  });
+
+  test("un email ASCII puro solo se recorta y pasa a minúsculas (no-regresión)", () => {
+    expect(normalizeEmailKey("  Carlos@Test.Local  ")).toBe("carlos@test.local");
+    expect(normalizeEmailKey("marta@test.local")).toBe("marta@test.local");
+  });
+});
```

**Verificación de los fixtures (comprobado con Node antes de fijarlos):**
`("  OﬀICE@Example.COM  ")` → `"office@example.com"`; `("Ｔest@x.com")` → `"test@x.com"`;
`("  Carlos@Test.Local  ")` → `"carlos@test.local"`. (La ligadura `ﬀ`=U+FB00 y el fullwidth
`Ｔ`=U+FF34 solo canonizan **con** NFKC; sin él, esas aserciones fallarían — es la prueba de que
NFKC se aplica.)

---

## Verificación

- `npm run lint`, `npm run build` (typecheck), `npx convex codegen` verdes.
- e2e project `unit`: los 3 tests de B5 (PR-1a) **y** los 2 nuevos de NFKC en verde.
- Igualdad byte-a-byte CODIGO ↔ repo tras instalar.

## Secuencia de despliegue (crítica, ya aprobada)

Tras merge de PR-1a-bis: **repetir el gate** `npx convex run auth:accountsWithNonCanonicalEmail
--prod` **justo antes** de desplegar (los datos son mutables desde el gate inicial de PR-1a). **Solo
con JSON `[]` y exit 0** se despliega NFKC a `greedy-tapir-20` (runbook §1, deploy-token seguro).
Evidencia (commit + deployment + timestamp + rc) sin PII. Después: PR-1b (retirar el veto).

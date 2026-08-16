// MIS-293 (PR-1a): pruebas de UNIDAD de librería (sin navegador ni Convex).
// Corren bajo el project `unit` de playwright.config.ts e importan directamente
// las funciones de `convex/lib` para ejercitarlas en Node con WebCrypto
// (Playwright transpila TS; `node --test` no ejecutaría estos módulos TS).
//
// NOTA (redacción honesta): el project `unit` HEREDA el `webServer` global de
// playwright.config.ts, así que `--project=unit` NO corre aislado del arranque
// de Next — en una corrida completa `npm run test:e2e` el server arranca una
// sola vez y es inofensivo. Estas pruebas no usan `page`, así que no lanzan
// navegador.
import { test, expect } from "@playwright/test";
import { hashPassword, verifyPassword } from "../convex/lib/password";
import { normalizeEmailKey } from "../convex/lib/rateLimit";

// Sustituye el campo `i=<n>` de un hash REAL (con salt y hash base64url VÁLIDOS,
// generados por hashPassword) por otro valor. Así, cuando verifyPassword rechaza,
// el rechazo es imputable al PARSER DE ITERACIONES (la cota B5) y no a un decode
// base64 fallido: salt y hash siguen siendo válidos.
function withIterationsField(realHash: string, iField: string): string {
  const parts = realHash.split("$"); // [algo, v1, i=600000, saltB64, hashB64]
  // Validez explícita del fixture: el hash real DEBE tener 5 partes y la 3.ª
  // empezar por "i=" antes de sustituirla. Así se garantiza que solo cambia el
  // campo de iteraciones (salt/hash quedan intactos y siguen siendo base64url
  // válidos), y que un rechazo posterior es imputable a la cota, no al formato.
  expect(parts).toHaveLength(5);
  expect(parts[2].startsWith("i=")).toBe(true);
  parts[2] = iField;
  return parts.join("$");
}

test.describe("verifyPassword — cota de iteraciones (B5, MIS-293)", () => {
  test("un i= descomunal se rechaza rápido, sin ejecutar el KDF", async () => {
    const real = await hashPassword("Contrasena-Correcta-1!");
    const huge = withIterationsField(real, "i=100000000"); // 100 M
    const t0 = Date.now();
    const result = await verifyPassword("Contrasena-Correcta-1!", huge);
    const elapsed = Date.now() - t0;
    // Se rechaza como hash inválido...
    expect(result).toBe(false);
    // ...y ANTES de derivar: 100 M iteraciones tardarían decenas de segundos.
    expect(elapsed).toBeLessThan(2000);
  });

  test("i= no numérico / vacío / decimal se rechazan (fixtures base64url válidos)", async () => {
    const real = await hashPassword("Contrasena-Correcta-2!");
    for (const badIterations of ["i=abc", "i=", "i=1.5", "i=0", "i=-5"]) {
      const stored = withIterationsField(real, badIterations);
      expect(
        await verifyPassword("Contrasena-Correcta-2!", stored),
        `esperaba false para ${badIterations}`,
      ).toBe(false);
    }
  });

  test("un hash legítimo (i=600000) sigue validando — control positivo", async () => {
    const real = await hashPassword("Contrasena-Correcta-3!");
    expect(await verifyPassword("Contrasena-Correcta-3!", real)).toBe(true);
    expect(await verifyPassword("otra-distinta", real)).toBe(false);
  });
});

test.describe("normalizeEmailKey — NFKC (B12 / A3-ii, MIS-293)", () => {
  test("aplica NFKC además de trim + minúsculas", () => {
    // Ligadura "ﬀ" (U+FB00) -> NFKC -> "ff"; con espacios y mayúsculas alrededor.
    expect(normalizeEmailKey("  OﬀICE@Example.COM  ")).toBe("office@example.com");
    // Carácter de anchura completa "Ｔ" (U+FF34) -> "T" -> minúscula "t".
    expect(normalizeEmailKey("Ｔest@x.com")).toBe("test@x.com");
  });

  test("un email ASCII puro solo se recorta y pasa a minúsculas (no-regresión)", () => {
    expect(normalizeEmailKey("  Carlos@Test.Local  ")).toBe("carlos@test.local");
    expect(normalizeEmailKey("marta@test.local")).toBe("marta@test.local");
  });
});

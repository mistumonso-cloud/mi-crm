// MIS-293 (PR-1a): pruebas de UNIDAD de librería (sin navegador ni Convex).
// Corren bajo el project `unit` de playwright.config.ts e importan directamente
// las funciones de `convex/lib` (y, desde MIS-299, de `src/lib/auth/google`) para
// ejercitarlas en Node con WebCrypto (Playwright transpila TS; `node --test` no
// ejecutaría estos módulos TS).
//
// NOTA (redacción honesta): el project `unit` HEREDA el `webServer` global de
// playwright.config.ts, así que `--project=unit` NO corre aislado del arranque
// de Next — en una corrida completa `npm run test:e2e` el server arranca una
// sola vez y es inofensivo. Estas pruebas no usan `page`, así que no lanzan
// navegador.
import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { hashPassword, verifyPassword } from "../convex/lib/password";
import { normalizeEmailKey } from "../convex/lib/rateLimit";
import {
  callbackPreconditionsOk,
  computePkceChallenge,
  exchangeCodeForAccessToken,
  generatePkceVerifier,
  isValidPkceVerifier,
  runGoogleCallback,
  type CallbackDeps,
  type CallbackInputs,
} from "../src/lib/auth/google";

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

// ---------------------------------------------------------------------------
// MIS-299 (B6, PKCE)
// ---------------------------------------------------------------------------

// Spies de las colaboradoras inyectadas de runGoogleCallback. Registran los
// argumentos recibidos para poder asertar tanto el número de llamadas como su
// contenido exacto. `exchange` devuelve un access token fijo, `fetchEmail` un
// email fijo y `login` un éxito fijo, de modo que el camino feliz sea observable.
function spyDeps() {
  const calls = {
    exchange: [] as Array<[string, string]>,
    fetchEmail: [] as string[],
    login: [] as string[],
  };
  const deps: CallbackDeps = {
    exchange: async (code, verifier) => {
      calls.exchange.push([code, verifier]);
      return "access-token";
    },
    fetchEmail: async (accessToken) => {
      calls.fetchEmail.push(accessToken);
      return "user@example.com";
    },
    login: async (email) => {
      calls.login.push(email);
      return { success: true, token: "session-token", role: "rep" };
    },
  };
  return { deps, calls };
}

test.describe("runGoogleCallback — gate de precondiciones (MIS-299)", () => {
  test("verifier AUSENTE con state válido → rechazo SIN intercambio", async () => {
    const { deps, calls } = spyDeps();
    const inputs: CallbackInputs = { code: "auth-code", returnedState: "s", savedState: "s", codeVerifier: null };
    const result = await runGoogleCallback(inputs, deps);
    expect(result.ok).toBe(false);
    expect(calls.exchange).toHaveLength(0); // no se llegó al fetch del token
    expect(calls.fetchEmail).toHaveLength(0);
    expect(calls.login).toHaveLength(0);
  });

  test("verifier MALFORMADO con state válido → rechazo SIN intercambio", async () => {
    const { deps, calls } = spyDeps();
    const inputs: CallbackInputs = { code: "auth-code", returnedState: "s", savedState: "s", codeVerifier: "too-short" };
    const result = await runGoogleCallback(inputs, deps);
    expect(result.ok).toBe(false);
    expect(calls.exchange).toHaveLength(0);
  });

  test("state NO coincidente → rechazo SIN intercambio", async () => {
    const { deps, calls } = spyDeps();
    const verifier = generatePkceVerifier();
    const inputs: CallbackInputs = { code: "auth-code", returnedState: "s1", savedState: "s2", codeVerifier: verifier };
    const result = await runGoogleCallback(inputs, deps);
    expect(result.ok).toBe(false);
    expect(calls.exchange).toHaveLength(0);
  });

  test("control positivo: verifier válido atraviesa exchange→email→login con args EXACTOS", async () => {
    const { deps, calls } = spyDeps();
    const verifier = generatePkceVerifier();
    const inputs: CallbackInputs = { code: "auth-code", returnedState: "s", savedState: "s", codeVerifier: verifier };
    const result = await runGoogleCallback(inputs, deps);
    expect(result).toEqual({ ok: true, token: "session-token", role: "rep" });
    // exchange recibe EXACTAMENTE el code y el verifier validados (una vez).
    expect(calls.exchange).toEqual([["auth-code", verifier]]);
    // fetchEmail recibe el access token devuelto por exchange.
    expect(calls.fetchEmail).toEqual(["access-token"]);
    // login recibe el email devuelto por fetchEmail.
    expect(calls.login).toEqual(["user@example.com"]);
  });
});

test.describe("callbackPreconditionsOk / isValidPkceVerifier (MIS-299)", () => {
  test("isValidPkceVerifier — longitudes frontera y juego de caracteres RFC 7636", () => {
    expect(isValidPkceVerifier("A".repeat(42))).toBe(false); // < 43
    expect(isValidPkceVerifier("A".repeat(43))).toBe(true); // mínimo
    expect(isValidPkceVerifier("A".repeat(128))).toBe(true); // máximo
    expect(isValidPkceVerifier("A".repeat(129))).toBe(false); // > 128
    expect(isValidPkceVerifier(null)).toBe(false);
    // 43 chars pero con un carácter FUERA del juego "unreserved":
    expect(isValidPkceVerifier("+".padEnd(43, "A"))).toBe(false); // '+'
    expect(isValidPkceVerifier("A".repeat(21) + " " + "A".repeat(21))).toBe(false); // espacio
    // Los cuatro "unreserved" no alfanuméricos SÍ se aceptan:
    expect(isValidPkceVerifier("-._~".padEnd(43, "A"))).toBe(true);
  });

  test("callbackPreconditionsOk — gate completo", () => {
    const v = "A".repeat(43);
    expect(callbackPreconditionsOk({ code: "c", returnedState: "s", savedState: "s", codeVerifier: v })).toBe(true);
    expect(callbackPreconditionsOk({ code: null, returnedState: "s", savedState: "s", codeVerifier: v })).toBe(false);
    expect(callbackPreconditionsOk({ code: "c", returnedState: null, savedState: "s", codeVerifier: v })).toBe(false);
    expect(callbackPreconditionsOk({ code: "c", returnedState: "s", savedState: "other", codeVerifier: v })).toBe(false);
    expect(callbackPreconditionsOk({ code: "c", returnedState: "s", savedState: "s", codeVerifier: null })).toBe(false);
  });
});

test.describe("generatePkceVerifier / computePkceChallenge (MIS-299)", () => {
  test("generatePkceVerifier — válido (43 chars) y distinto entre llamadas", () => {
    const a = generatePkceVerifier();
    const b = generatePkceVerifier();
    expect(isValidPkceVerifier(a)).toBe(true);
    expect(isValidPkceVerifier(b)).toBe(true);
    expect(a).toHaveLength(43);
    expect(a).not.toBe(b);
  });

  test("computePkceChallenge — S256 = base64url(SHA-256(verifier)) sin padding", async () => {
    const verifier = "verifier-fijo-de-prueba-MIS299";
    // Control independiente con node:crypto (base64url de Node ya va sin padding).
    const expected = createHash("sha256").update(verifier).digest("base64url");
    expect(await computePkceChallenge(verifier)).toBe(expected);
    expect(expected).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

test.describe("exchangeCodeForAccessToken — POST con code_verifier (MIS-299)", () => {
  test("el body del intercambio incluye code_verifier y el resto de parámetros", async () => {
    const ENV_KEYS = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_OAUTH_REDIRECT_URI"] as const;
    // Guarda el estado PREVIO distinguiendo "ausente" de "definida" (no asignar
    // nunca el string "undefined" al restaurar).
    const saved = ENV_KEYS.map((k) => [k, k in process.env, process.env[k]] as const);
    process.env.GOOGLE_CLIENT_ID = "client-id-dummy";
    process.env.GOOGLE_CLIENT_SECRET = "client-secret-dummy";
    process.env.GOOGLE_OAUTH_REDIRECT_URI = "https://example.test/api/auth/google/callback";

    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ access_token: "at-123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const token = await exchangeCodeForAccessToken("auth-code-xyz", "verifier-abc");
      expect(token).toBe("at-123");
      // Una SOLA llamada a fetch, al endpoint y con el método/content-type exactos.
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe("https://oauth2.googleapis.com/token");
      expect(calls[0].init?.method).toBe("POST");
      const headers = new Headers(calls[0].init?.headers);
      expect(headers.get("Content-Type")).toBe("application/x-www-form-urlencoded");
      const body = new URLSearchParams(String(calls[0].init?.body));
      expect(body.get("code")).toBe("auth-code-xyz");
      expect(body.get("code_verifier")).toBe("verifier-abc");
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("redirect_uri")).toBe("https://example.test/api/auth/google/callback");
      expect(body.get("client_id")).toBe("client-id-dummy");
      expect(body.get("client_secret")).toBe("client-secret-dummy");
      // Exactitud: SOLO esos seis parámetros, ninguno de más.
      expect([...body.keys()].sort()).toEqual([
        "client_id",
        "client_secret",
        "code",
        "code_verifier",
        "grant_type",
        "redirect_uri",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
      for (const [k, had, val] of saved) {
        if (!had) delete process.env[k];
        else process.env[k] = val as string;
      }
    }
  });
});

# MIS-312 — Código completo (onboarding de primera contraseña para invitados) — Ronda 3

Entregable para la **auditoría de código**. Ronda 1 → GO CONDICIONADO; ronda 2 cerró la condición
(prueba de migración); **ronda 3 corrige un bug que cazó el CI**. Plan:
`PLANS/MIS-312-onboarding-invitados.md`. Rama `mis-312-onboarding-invitados` (base `main` @ `a536613`).

Documento **autocontenido**: contenido íntegro de los **2 ficheros nuevos** y diff completo de los
**8 modificados**. Copias byte-idénticas en el directorio + `MIS-312.diff`.

## Ronda 3 — fix cazado por el e2e en CI (bug REAL, no de test)
El e2e de CI ejecutó todo verde salvo el test "migración (transición)", que reveló un **bug real**:
la expiración de la cookie `__Secure-reset_ticket` en `setResetTicketCookie`/`clearResetTicketCookie`
se emitía **sin `Secure`**. El navegador **RECHAZA** borrar una cookie con prefijo `__Secure-` si el
`Set-Cookie` de expiración no lleva `Secure` → **la cookie vieja no se retiraría en producción**.
Corrección: la expiración de `__Secure-reset_ticket` ahora incluye `httpOnly + secure + sameSite`
(atributos con los que se emitió). Con esto la migración retira de verdad la variante antigua.
(Los otros 49 tests del project de secretos, incluidos onboarding-happy y migración-lectura-dual,
pasaron en verde en esa misma corrida de CI.)

## Verificación
- `npm run lint` → **0 errores** (1 warning preexistente ajeno: `<img>` en `Avatar.jsx`).
- `npx tsc --noEmit` (TODO el proyecto, e2e incluido) → **verde**.
- `npm run build` (Next 16.2.10) → **verde**; `/configurar-contrasena` registrada (dynamic ƒ).
- **e2e Playwright en CI**: build ✔; en la corrida anterior, 49/50 verdes y el único fallo fue el
  bug de arriba (ya corregido) — se re-ejecuta en CI tras este fix. (No ejecutable en esta máquina
  por límite de RAM.)

## Estrategia de migración de la cookie (contrato final)
La cookie del ticket → **`__Host-reset_ticket`** (path `/`; sube de `__Secure-` a `__Host-`). La API
de cookies de Next indexa por NOMBRE (`ResponseCookies._parsed.set(name,…)`), así que no se pueden
emitir dos `Set-Cookie` del mismo nombre en una respuesta → se usan **nombres distintos**:
- `setResetTicketCookie`: emite `__Host-` (path `/`) **y** expira `__Secure-reset_ticket` (path
  estrecho, **con `Secure`** — fix ronda 3) + el legado `reset_ticket`.
- `readResetTicketCookie`: `__Host-` con **fallback transitorio** a `__Secure-` (recuperaciones en
  vuelo). Retirada registrada en **MIS-315**.
- `clearResetTicketCookie`: expira las tres generaciones en su path (la `__Secure-` con `Secure`).

## Mapa de cambios

### Ficheros NUEVOS (contenido íntegro abajo)
- `src/app/(auth)/configurar-contrasena/page.tsx` — pantalla de bienvenida (guard de sesión,
  normaliza `?email=`, renderiza el wizard con copy de alta).
- `e2e/onboarding.spec.ts` — e2e: onboarding + atributos de cookie + migración (lectura dual y transición).

### Ficheros MODIFICADOS (diff completo abajo)
- `src/lib/auth/constants.ts` — `RESET_TICKET_COOKIE_NAME` → `__Host-reset_ticket`.
- `src/lib/auth/cookie.ts` — set/read/clear (path `/`, migración M1 con expiración `Secure` de la
  `__Secure-`, lectura dual); constantes `LEGACY_SECURE_RESET_TICKET_COOKIE_NAME` y `LEGACY_RESET_TICKET_PATH`.
- `src/app/(auth)/recuperar-contrasena/RecoverForm.tsx` — parametrizado (`copy` + `initialEmail`).
- `src/app/(auth)/login/page.tsx` — mensaje `?reset=ok` neutro.
- `src/app/(auth)/login/LoginForm.tsx` — pista "¿Primera vez?…".
- `convex/lib/resend.ts` — invitación → `/configurar-contrasena?email=…`, copy sin "«Recuperar contraseña»".
- `e2e/password-reset.spec.ts` — asertos de nombre/path/mensaje (regresión).
- `playwright.config.ts` — registra `onboarding.spec.ts` en `chromium-secrets`.

## Seguridad / invariantes
- **Anti-enumeración intacta**: cero cambios de backend de auth; reutiliza `requestPasswordResetCode`
  (siempre `{ok:true}`) / `verifyResetCode` / `resetPasswordWithTicket` (ya limpia `invitePendingSince`
  y revoca sesiones). Login sin identifier-first.
- **Cookie del ticket**: `__Host-` (Secure + Path=/ + sin Domain), httpOnly, sameSite lax, single-use,
  TTL 15 min. Migración sin coexistencia (expira las viejas, la `__Secure-` con `Secure`) + lectura
  dual transitoria (retirada en MIS-315).
- **`?email=`**: solo prellena; se **descarta** (no se trunca) si array/vacío/>254/sin forma de email.

---

# Ficheros NUEVOS — contenido íntegro

## `src/app/(auth)/configurar-contrasena/page.tsx`

```tsx
import { redirect } from "next/navigation";
import { getSession, landingPathForRole } from "@/lib/auth/dal";
import { RecoverForm, type RecoverCopy } from "../recuperar-contrasena/RecoverForm";

// MIS-312: pantalla de bienvenida para invitados que crean su PRIMERA contraseña.
// Reutiliza el MISMO wizard de 3 pasos (email → código → contraseña) y las MISMAS
// server actions del flujo de recuperación (motor de código+ticket de MIS-285),
// solo con copy de alta. Anti-enumeración intacta: `requestPasswordResetCode`
// responde igual exista o no la cuenta.

const MAX_EMAIL_LENGTH = 254;
const EMAIL_FORMAT = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Normaliza el `?email=` del enlace de la invitación. Solo prellena el campo (no
// autoriza nada; el servidor revalida en el flujo de código). DESCARTA (deja el
// campo vacío) si viene como array, vacío, sobredimensionado (>254) o sin forma
// de email — NUNCA trunca (truncar podría convertir una entrada manipulada en
// otra dirección aparentemente válida y disparar un envío innecesario de código).
function normalizeInitialEmail(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_EMAIL_LENGTH || !EMAIL_FORMAT.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

const ONBOARDING_COPY: RecoverCopy = {
  title: "Te damos la bienvenida",
  subtitleEmail: "Te enviaremos un código para crear tu contraseña",
  subtitleCode: "Introduce el código de 6 dígitos que te hemos enviado",
  subtitlePassword: "Crea tu contraseña",
  submitEmailIdle: "Enviar código",
  submitPasswordIdle: "Crear contraseña",
  footerHref: "/login",
  footerLabel: "Volver al inicio de sesión",
};

export default async function ConfigurarContrasenaPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string | string[] }>;
}) {
  // Mismo guard que login/recuperar: un usuario ya logueado no hace onboarding.
  const user = await getSession();
  if (user) {
    redirect(landingPathForRole(user.role));
  }

  const { email } = await searchParams;
  const initialEmail = normalizeInitialEmail(email);

  return (
    <div className="flex flex-1 items-center justify-center bg-[var(--color-bg)] px-4 py-16">
      <RecoverForm copy={ONBOARDING_COPY} initialEmail={initialEmail} />
    </div>
  );
}

```

## `e2e/onboarding.spec.ts`

```ts
// MIS-312: onboarding de primera contraseña para invitados (/configurar-contrasena).
// Reutiliza el motor de código+ticket de MIS-285, así que corre en el project
// "chromium-secrets" (circula la contraseña efímera de la identidad dedicada y la
// nueva que fija el propio spec, ninguna como literal). Cubre: el wizard en la
// ruta nueva, los atributos de la cookie del ticket (ahora `__Host-`, path `/`),
// su ausencia tras consumir, y la MIGRACIÓN M1 en dos frentes:
//   - lectura dual: una recuperación en vuelo completa con la cookie ANTIGUA
//     `__Secure-reset_ticket`;
//   - transición + expiración: el flujo nuevo emite `__Host-reset_ticket` y expira
//     las dos generaciones antiguas (`__Secure-reset_ticket` de MIS-293 y el legado
//     pre-MIS-293 `reset_ticket`), sin coexistencia.
import { randomBytes } from "node:crypto";
import { test, expect } from "./helpers/secure-test";
import { RESET_TEST_EMAIL, getLastResetCode, loginSucceeds, resetTestIdentity } from "./helpers/test-support";

function freshPassword(): string {
  return randomBytes(24).toString("base64url");
}

async function waitForResetCode(): Promise<string> {
  await expect
    .poll(async () => await getLastResetCode(), {
      message: "esperando a que deliverResetCode escriba el código en el outbox de test",
      timeout: 10_000,
    })
    .not.toBeNull();
  const code = await getLastResetCode();
  if (!code) throw new Error("getLastResetCode() devolvió null tras superar el poll");
  return code;
}

// Avanza el wizard (en la ruta dada) hasta el paso de contraseña, dejando emitido
// el ticket nuevo en `__Host-reset_ticket`. Devuelve el valor del ticket (Playwright
// lee cookies httpOnly). El botón del paso 1 depende del copy de cada ruta.
async function advanceToPasswordStep(
  page: import("@playwright/test").Page,
  route: string,
  sendCodeButton: string,
): Promise<void> {
  await page.goto(route);
  await page.getByLabel("Email").fill(RESET_TEST_EMAIL);
  await page.getByRole("button", { name: sendCodeButton }).click();
  const code = await waitForResetCode();
  await page.getByLabel("Código").fill(code);
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByLabel("Nueva contraseña")).toBeVisible();
}

test.describe("onboarding de primera contraseña (MIS-312)", () => {
  test("bienvenida con email prellenado → código → crear contraseña → /login?reset=ok", async ({ page }) => {
    const oldPassword = await resetTestIdentity();
    const newPassword = freshPassword();

    // Se llega con el email prellenado desde el enlace de la invitación.
    await page.goto(`/configurar-contrasena?email=${encodeURIComponent(RESET_TEST_EMAIL)}`);
    await expect(page.getByRole("heading", { name: "Te damos la bienvenida" })).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveValue(RESET_TEST_EMAIL);

    await page.getByRole("button", { name: "Enviar código" }).click();
    await expect(page.getByLabel("Código")).toBeVisible();

    const code = await waitForResetCode();
    await page.getByLabel("Código").fill(code);
    await page.getByRole("button", { name: "Continuar" }).click();

    await expect(page.getByLabel("Nueva contraseña")).toBeVisible();

    // Atributos de la cookie del ticket (MIS-312: `__Host-`, path `/`).
    const ticketCookie = (await page.context().cookies()).find((c) => c.name === "__Host-reset_ticket");
    expect(ticketCookie, "la cookie del ticket debe existir en el paso de contraseña").toBeTruthy();
    expect(ticketCookie!.httpOnly).toBe(true);
    expect(ticketCookie!.secure).toBe(true);
    expect(ticketCookie!.sameSite).toBe("Lax");
    expect(ticketCookie!.path).toBe("/");
    const nowSec = Date.now() / 1000;
    expect(ticketCookie!.expires).toBeGreaterThan(nowSec + 700); // ~15 min con tolerancia amplia
    expect(ticketCookie!.expires).toBeLessThan(nowSec + 1000);
    // Inaccesible a JavaScript.
    const jsCookies = await page.evaluate(() => document.cookie);
    expect(jsCookies).not.toContain("__Host-reset_ticket");

    await page.getByLabel("Nueva contraseña").fill(newPassword);
    await page.getByLabel("Repite la contraseña").fill(newPassword);
    await page.getByRole("button", { name: "Crear contraseña" }).click();

    await page.waitForURL(/\/login\?reset=ok/);
    await expect(page.getByText("Contraseña guardada")).toBeVisible();

    // La contraseña nueva funciona (y la vieja ya no) — vía ConvexHttpClient, sin teclear en login.
    expect(await loginSucceeds(newPassword)).toBe(true);
    expect(await loginSucceeds(oldPassword)).toBe(false);

    // Tras consumir el ticket, su cookie se borró.
    const cookieAfter = (await page.context().cookies()).find((c) => c.name === "__Host-reset_ticket");
    expect(cookieAfter, "la cookie del ticket debe borrarse tras crear la contraseña").toBeFalsy();
  });

  test("migración (lectura dual): una recuperación en vuelo completa con la cookie __Secure- antigua", async ({
    page,
    context,
  }) => {
    const oldPassword = await resetTestIdentity();
    const newPassword = freshPassword();

    // Llega al paso de contraseña por el flujo normal → el ticket VÁLIDO queda en
    // __Host-reset_ticket. Se lee su valor (Playwright lee cookies httpOnly).
    await advanceToPasswordStep(page, "/recuperar-contrasena", "Enviar código");
    const host = (await context.cookies()).find((c) => c.name === "__Host-reset_ticket");
    expect(host, "debería existir __Host-reset_ticket tras verificar").toBeTruthy();
    const ticket = host!.value;

    // Reproduce el estado "en vuelo antes del despliegue": el ticket válido solo
    // vive en la cookie ANTIGUA `__Secure-reset_ticket` (path estrecho), sin __Host-.
    await context.clearCookies();
    await context.addCookies([
      {
        name: "__Secure-reset_ticket",
        value: ticket,
        domain: "localhost",
        path: "/recuperar-contrasena",
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ]);

    // Al enviar la contraseña, resetPasswordAction no encuentra __Host- y cae al
    // fallback __Secure- (lectura dual) → completa el cambio.
    await page.getByLabel("Nueva contraseña").fill(newPassword);
    await page.getByLabel("Repite la contraseña").fill(newPassword);
    await page.getByRole("button", { name: "Guardar nueva contraseña" }).click();

    await page.waitForURL(/\/login\?reset=ok/);
    expect(await loginSucceeds(newPassword)).toBe(true);
    expect(await loginSucceeds(oldPassword)).toBe(false);
  });

  test("migración (transición): el flujo nuevo emite __Host- y expira las dos cookies antiguas", async ({
    page,
    context,
  }) => {
    // Siembra las DOS generaciones antiguas en su path estrecho (tickets ficticios;
    // aquí solo se prueba la migración de cookies, no su validez):
    //  - `__Secure-reset_ticket` (MIS-293 → MIS-312)
    //  - `reset_ticket` (legado pre-MIS-293)
    await context.addCookies([
      {
        name: "__Secure-reset_ticket",
        value: "stale-secure-pre-mis312",
        domain: "localhost",
        path: "/recuperar-contrasena",
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
      {
        name: "reset_ticket",
        value: "stale-legacy-pre-mis293",
        domain: "localhost",
        path: "/recuperar-contrasena",
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ]);

    const oldPassword = await resetTestIdentity();
    const newPassword = freshPassword();

    await advanceToPasswordStep(page, "/recuperar-contrasena", "Enviar código");

    // Tras emitir el ticket nuevo, en la MISMA respuesta: existe __Host-reset_ticket
    // (path "/", con atributos correctos) y NINGUNA de las dos cookies antiguas
    // queda (no coexisten cookies del ticket).
    const cookies = await context.cookies();
    const host = cookies.find((c) => c.name === "__Host-reset_ticket");
    expect(host, "debe existir __Host-reset_ticket").toBeTruthy();
    expect(host!.path).toBe("/");
    expect(host!.httpOnly).toBe(true);
    expect(host!.secure).toBe(true);
    expect(host!.sameSite).toBe("Lax");
    expect(
      cookies.find((c) => c.name === "__Secure-reset_ticket"),
      "la __Secure- antigua no debe quedar tras emitir la __Host-",
    ).toBeFalsy();
    expect(
      cookies.find((c) => c.name === "reset_ticket"),
      "el legado reset_ticket no debe quedar",
    ).toBeFalsy();

    // Y el flujo completa con el ticket nuevo.
    await page.getByLabel("Nueva contraseña").fill(newPassword);
    await page.getByLabel("Repite la contraseña").fill(newPassword);
    await page.getByRole("button", { name: "Guardar nueva contraseña" }).click();
    await page.waitForURL(/\/login\?reset=ok/);
    expect(await loginSucceeds(newPassword)).toBe(true);
  });
});

```


---

# Ficheros MODIFICADOS — diff completo

## `src/lib/auth/constants.ts`

```diff

```

## `src/lib/auth/cookie.ts`

```diff
diff --git a/src/lib/auth/cookie.ts b/src/lib/auth/cookie.ts
index 5ff81a8..1778c91 100644
--- a/src/lib/auth/cookie.ts
+++ b/src/lib/auth/cookie.ts
@@ -178,7 +178,16 @@ export async function setResetTicketCookie(ticket: string): Promise<void> {
   // estrecho) para que no coexistan dos cookies del ticket durante la migración.
   // Nombre DISTINTO al de arriba ⇒ la API de Next (indexa por nombre) no lo
   // deduplica y emite ambos `Set-Cookie`.
-  cookieStore.set(LEGACY_SECURE_RESET_TICKET_COOKIE_NAME, "", { path: LEGACY_RESET_TICKET_PATH, maxAge: 0 });
+  // OBLIGATORIO `secure: true`: el navegador RECHAZA borrar una cookie con prefijo
+  // `__Secure-` si el Set-Cookie de expiración no lleva `Secure` (sin esto, la
+  // cookie vieja NO se retira). Se replican los atributos con que se emitió.
+  cookieStore.set(LEGACY_SECURE_RESET_TICKET_COOKIE_NAME, "", {
+    httpOnly: true,
+    secure: true,
+    sameSite: "lax",
+    path: LEGACY_RESET_TICKET_PATH,
+    maxAge: 0,
+  });
   // Legacy pre-B2 (nombre sin prefijo), en su path original.
   cookieStore.set(LEGACY_RESET_TICKET_COOKIE_NAME, "", { path: LEGACY_RESET_TICKET_PATH, maxAge: 0 });
 }
@@ -207,6 +216,15 @@ export async function clearResetTicketCookie(): Promise<void> {
   });
   // MIS-312: expira también las variantes de migración en su path estrecho
   // (borrar una cookie exige repetir su `path` exacto). Nombres distintos ⇒ sin colisión.
-  cookieStore.set(LEGACY_SECURE_RESET_TICKET_COOKIE_NAME, "", { path: LEGACY_RESET_TICKET_PATH, maxAge: 0 });
+  // OBLIGATORIO `secure: true`: el navegador RECHAZA borrar una cookie con prefijo
+  // `__Secure-` si el Set-Cookie de expiración no lleva `Secure` (sin esto, la
+  // cookie vieja NO se retira). Se replican los atributos con que se emitió.
+  cookieStore.set(LEGACY_SECURE_RESET_TICKET_COOKIE_NAME, "", {
+    httpOnly: true,
+    secure: true,
+    sameSite: "lax",
+    path: LEGACY_RESET_TICKET_PATH,
+    maxAge: 0,
+  });
   cookieStore.set(LEGACY_RESET_TICKET_COOKIE_NAME, "", { path: LEGACY_RESET_TICKET_PATH, maxAge: 0 });
 }

```

## `src/app/(auth)/recuperar-contrasena/RecoverForm.tsx`

```diff

```

## `src/app/(auth)/login/page.tsx`

```diff

```

## `src/app/(auth)/login/LoginForm.tsx`

```diff

```

## `convex/lib/resend.ts`

```diff

```

## `e2e/password-reset.spec.ts`

```diff

```

## `playwright.config.ts`

```diff

```


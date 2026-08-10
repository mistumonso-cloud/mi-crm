# MIS-285 — Código completo

> Recuperación de contraseña por código (OTP) enviado por email con Resend.
> Plan: [PLANS/MIS-285-recuperacion-contrasena-plan.md](../../PLANS/MIS-285-recuperacion-contrasena-plan.md) (v3.2, GO condicionado activado tras el merge de [MIS-286](https://linear.app/mistu-monso/issue/MIS-286)).
> Rama: `mistumonso/mis-285-email-transaccional-con-resend-recuperacion-de-contrasena` · Commit: pendiente (aún no commiteado) · PR: pendiente.
>
> **3ª ronda de auditoría de código.** 1ª ronda: NO-GO por M12 y M13. 2ª ronda: M12 resuelto, pero M13 seguía incompleto en `verifyResetCode` (validaba el email DESPUÉS de ya haber construido y consultado la clave de rate limit) y se detectó M14 (carrera en el test nuevo de M12). Ambos corregidos en esta ronda — ver "Qué cambió en esta ronda" justo debajo. M12 y el resto de la implementación (backend restante, Resend, UI, e2e, cron, MIS-286) no se reabren.

## Qué cambió en esta ronda (3ª)

**M13 (resto) — `verifyResetCode` seguía usando el email antes de validar su límite.** La 2ª ronda añadió `emailWithinLimits(emailKey)` en `verifyResetCode`, pero el propio email fuera de contrato ya se había usado para construir `resetcode:<email>` y consultar `isLocked(ctx, rateLimitKey)` con esa clave sobredimensionada, ANTES de llegar a la validación — la amplificación que M13 debía cerrar seguía abierta en el subsistema de rate limit. **Corrección**: `emailWithinLimits(emailKey)` se comprueba ahora como el primerísimo paso del handler, antes de construir `rateLimitKey` o de tocar `isLocked`/`recordFailedAttempt` en cualquier forma — un email inválido devuelve el error genérico sin ninguna I/O de rate limit. La validación del formato del código (`CODE_FORMAT`) sigue yendo por `fail()`, pero solo se alcanza con un email ya válido. Prueba añadida: `verifyResetCode` invocado directamente con email vacío y de 255 caracteres, respuesta genérica sin excepción.

**M14 — el test nuevo de M12 tenía una carrera con el outbox.** `testOutbox` nunca borra entregas anteriores (solo `resetTestIdentity()` lo hace) y `getLastResetCode()` devuelve la de mayor `createdAt` entre TODAS las filas de la identidad. El helper `requestAndGetCode()` solo esperaba "no nulo" (`.not.toBeNull()`), así que en la segunda llamada del test de M12 (con una entrega previa ya en el outbox) esa condición se satisfacía de inmediato con el código VIEJO, sin haber esperado a que la segunda entrega (programada vía `ctx.scheduler`, no esperada por la mutation) terminara — resultado no determinista según el scheduling real. **Corrección**: `requestAndGetCode()` acepta ahora un `previousCode` opcional y el poll exige un valor no nulo **y distinto** del anterior; el test de M12 pasa el código viejo como referencia en su segunda llamada. El resto de los call sites (una sola llamada por test, outbox vacío tras `resetTestIdentity()`) no cambian de comportamiento.

Ambos fixes son mínimos y locales a `convex/passwordReset.ts` (reordenar una validación) y `e2e/password-reset-invariants.spec.ts` (el helper + 1 test nuevo) — no se tocó nada más de lo ya aprobado.

## Resumen de lo implementado

- **Backend** (`convex/passwordReset.ts`): `requestPasswordResetCode` (mutation pública, anti-enumeración por respuesta y por tiempo — no consulta `users`, programa el trabajo real vía `ctx.scheduler`), `deliverResetCode` (internalAction, único punto con `fetch`), `createResetCode` (internalMutation, invalida códigos previos no usados del mismo usuario), `verifyResetCode` (mutation pública, 5 intentos, emite ticket opaco de 15 min al acertar), `resetPasswordWithTicket` (mutation pública, cambia la contraseña e invalida TODAS las sesiones del usuario en la misma mutation), `cleanupExpiredResetCodes` (internalMutation para el cron).
- **Resend** (`convex/lib/resend.ts`): `fetch` directo a la API REST de Resend, sin SDK — mismo criterio que `src/lib/auth/google.ts`. Plantilla HTML con los tokens de marca (`#3B5266`, `#1A1D24`, `#6B7280`, `#FAFAFA`/`#FFFFFF`/`#E5E7EB`), `name` escapado antes de interpolar.
- **`generateNumericCode`** (`convex/lib/token.ts`): rejection sampling sobre `crypto.getRandomValues`, misma familia de primitiva que `generateOpaqueToken`.
- **UI**: `/recuperar-contrasena` (`page.tsx` + `RecoverForm.tsx`, 3 pasos), enlace "¿Olvidaste tu contraseña?" en `LoginForm.tsx`, aviso de éxito `?reset=ok` en `login/page.tsx`.
- **e2e**: `password-reset.spec.ts` (flujo UI completo) y `password-reset-invariants.spec.ts` (código incorrecto, 6º intento bloqueado, código caducado, ticket reutilizado, invalidación de sesiones, determinismo de `generateNumericCode`) — ambos en el project `chromium-secrets` (sin trace/vídeo/captura), usando `secure-test.ts` y los helpers de MIS-286 (`resetTestIdentity`, `getLastResetCode`, `expireResetCode`, `countSessionsFor`, `loginSucceeds`). Las comprobaciones "contraseña nueva funciona / vieja ya no" y "código incorrecto/caducado/ticket reutilizado" se hacen por `ConvexHttpClient`, no por formulario — la única contraseña que se teclea en el navegador es la nueva contraseña del propio formulario bajo prueba, y tanto ella como la contraseña efímera de partida se generan en tiempo de ejecución (nunca literales).
- **`convex/schema.ts` no se toca**: `passwordResetCodes` y `testOutbox` ya los define MIS-286 (merged).
- **`src/proxy.ts` no se toca**: `/recuperar-contrasena` no está en su `matcher`, así que sigue accesible sin sesión (comprobado).

---

# Ficheros nuevos

## `convex/lib/resend.ts`

Cliente de Resend por `fetch` puro, sin SDK.

```ts
// MIS-285: envío de emails transaccionales vía la API REST de Resend.
//
// Sin SDK `resend`: un `fetch` directo evita una dependencia nueva y el
// runtime Node ("use node") que exigiría el SDK — mismo criterio que
// src/lib/auth/google.ts, que ya habla con la API de Google por fetch puro.

const RESEND_API_URL = "https://api.resend.com/emails";

function getResendApiKey(): string {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("Falta RESEND_API_KEY en el entorno de Convex");
  return key;
}

function getResendFrom(): string {
  const from = process.env.RESEND_FROM;
  if (!from) throw new Error("Falta RESEND_FROM en el entorno de Convex");
  return from;
}

// El nombre del usuario es texto libre almacenado en `users.name` — se
// escapa antes de interpolarlo en el HTML del email, igual que cualquier
// otro dato de usuario que acabe en una plantilla.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function passwordResetCodeHtml(name: string, code: string): string {
  const safeName = escapeHtml(name);
  const safeCode = escapeHtml(code);
  return `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:0;background-color:#FAFAFA;font-family:'Inter',system-ui,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FAFAFA;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:420px;background-color:#FFFFFF;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="background-color:#3B5266;padding:20px 24px;">
                <span style="color:#FFFFFF;font-size:16px;font-weight:700;">Vibe Coder CRM</span>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 24px;">
                <p style="margin:0 0 8px;color:#1A1D24;font-size:15px;">Hola${safeName ? ` ${safeName}` : ""},</p>
                <p style="margin:0 0 20px;color:#1A1D24;font-size:15px;">
                  Este es tu código para restablecer la contraseña:
                </p>
                <div style="text-align:center;margin:0 0 20px;">
                  <span style="display:inline-block;padding:12px 24px;border-radius:8px;background-color:#EAEFF3;color:#3B5266;font-size:28px;font-weight:700;letter-spacing:6px;">
                    ${safeCode}
                  </span>
                </div>
                <p style="margin:0 0 4px;color:#6B7280;font-size:13px;">
                  Válido durante 15 minutos y de un solo uso.
                </p>
                <p style="margin:0;color:#6B7280;font-size:13px;">
                  Si no has sido tú, ignora este correo — tu contraseña actual sigue funcionando.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

// Errores de Resend se relanzan SIN incluir código, destinatario ni cuerpo —
// solo el estado HTTP, para no dejar datos sensibles en logs de servidor.
export async function sendPasswordResetCodeEmail(
  to: string,
  name: string,
  code: string,
): Promise<void> {
  const res = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getResendApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: getResendFrom(),
      to,
      subject: "Tu código para restablecer la contraseña",
      html: passwordResetCodeHtml(name, code),
    }),
  });
  if (!res.ok) {
    throw new Error(`Resend respondió ${res.status}`);
  }
}
```

---

## `convex/passwordReset.ts`

Backend completo del flujo: 5 funciones públicas/internas + el cron de limpieza.

```ts
// MIS-285: recuperación de contraseña por código (OTP) enviado por email con
// Resend. Depende del harness de MIS-286 (convex/testSupport.ts) para poder
// verificarse en e2e sin abrir un agujero de seguridad, y de las tablas
// `passwordResetCodes` / `testOutbox` que ya define el esquema de MIS-286.
//
// Anti-enumeración por RESPUESTA y por TIEMPO: `requestPasswordResetCode` no
// consulta `users` ni espera a Resend — solo rate-limita y programa el
// trabajo real vía scheduler, así que el tiempo de respuesta es idéntico
// exista o no la cuenta. Ver PLANS/MIS-285-recuperacion-contrasena-plan.md.

import { v } from "convex/values";
import { internalMutation, internalAction, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { constantTimeEqual, hashPassword } from "./lib/password";
import { generateNumericCode, generateOpaqueToken, hashToken } from "./lib/token";
import {
  EMAIL_RATE_LIMIT,
  IP_RATE_LIMIT,
  isLocked,
  normalizeEmailKey,
  normalizeIpHint,
  recordFailedAttempt,
  resetAttempts,
} from "./lib/rateLimit";
import { sendPasswordResetCodeEmail } from "./lib/resend";
import { RESET_TEST_EMAIL } from "./lib/testIdentity";

const CODE_TTL_MS = 15 * 60 * 1000;
const TICKET_TTL_MS = 15 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const MAX_EMAIL_LENGTH = 254;
const CODE_FORMAT = /^\d{6}$/;
const GENERIC_CODE_ERROR = "Código incorrecto o caducado";
const TICKET_EXPIRED_ERROR = "La sesión de recuperación caducó, vuelve a empezar";
const PASSWORD_POLICY_ERROR = "La contraseña debe tener entre 8 y 128 caracteres";

function emailWithinLimits(normalized: string): boolean {
  return normalized.length > 0 && normalized.length <= MAX_EMAIL_LENGTH;
}

// 1. Mutation pública: rate-limita y programa el envío diferido. Nunca toca
// `users` ni espera a Resend — el tiempo de respuesta no debe delatar si el
// email existe.
export const requestPasswordResetCode = mutation({
  args: { email: v.string(), ipHint: v.optional(v.string()) },
  returns: v.object({ ok: v.literal(true) }),
  handler: async (ctx, args) => {
    const normalizedEmail = normalizeEmailKey(args.email);
    // M13: un email fuera de los límites del contrato (vacío o >254) no llega
    // a construir claves de rate limit ni a programar trabajo — mismo
    // resultado público {ok:true} que cualquier otra solicitud, así que no
    // añade una forma nueva de distinguir entradas.
    if (!emailWithinLimits(normalizedEmail)) return { ok: true as const };

    const emailKey = `reset:${normalizedEmail}`;
    const ipKey = normalizeIpHint(args.ipHint ?? null);

    let allowed = !(await isLocked(ctx, emailKey));
    if (allowed && ipKey) allowed = !(await isLocked(ctx, `resetip:${ipKey}`));

    // Se contabilizan SOLICITUDES (no fallos): siempre se registra, exista o
    // no la cuenta — de lo contrario el contador delataría por sí mismo si
    // el email existe.
    await recordFailedAttempt(ctx, emailKey, EMAIL_RATE_LIMIT);
    if (ipKey) await recordFailedAttempt(ctx, `resetip:${ipKey}`, IP_RATE_LIMIT);

    await ctx.scheduler.runAfter(0, internal.passwordReset.deliverResetCode, {
      email: args.email,
      allowed,
    });
    return { ok: true as const };
  },
});

// 2. internalAction: única función de este módulo con `fetch` (Resend). Los
// errores se registran sin código, destinatario ni cuerpo.
export const deliverResetCode = internalAction({
  args: { email: v.string(), allowed: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!args.allowed) return null;

    const created = await ctx.runMutation(internal.passwordReset.createResetCode, {
      email: args.email,
    });
    if (!created) return null;

    // Solo la identidad dedicada del harness (MIS-286) deposita el código en
    // claro en el outbox de test — cualquier otro destinatario (pruebas
    // manuales con un email real incluidas) omite este paso sin más.
    if (normalizeEmailKey(created.email) === RESET_TEST_EMAIL) {
      await ctx.runMutation(internal.testSupport.recordOutbox, {
        email: created.email,
        code: created.code,
      });
    }

    try {
      await sendPasswordResetCodeEmail(created.email, created.name, created.code);
    } catch (err) {
      console.error("deliverResetCode: fallo al enviar con Resend", err instanceof Error ? err.message : err);
    }
    return null;
  },
});

// 3. internalMutation: busca el usuario, invalida códigos previos no usados
// y crea uno nuevo. Solo el ÚLTIMO código generado sigue siendo válido.
export const createResetCode = internalMutation({
  args: { email: v.string() },
  returns: v.union(
    v.object({ code: v.string(), email: v.string(), name: v.string() }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const emailKey = normalizeEmailKey(args.email);
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", emailKey))
      .unique();
    if (!user) return null;

    for (const row of await ctx.db
      .query("passwordResetCodes")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect()) {
      if (!row.usedAt) await ctx.db.delete(row._id);
    }

    const code = generateNumericCode(6);
    await ctx.db.insert("passwordResetCodes", {
      userId: user._id,
      codeHash: await hashToken(code),
      expiresAt: Date.now() + CODE_TTL_MS,
      attempts: 0,
    });

    // M12: un código nuevo debe poder verificarse aunque el anterior haya
    // agotado sus 5 intentos y bloqueado `resetcode:<email>` — si no se
    // resetea aquí, verifyResetCode rechaza el código nuevo (correcto o no)
    // por el candado del código viejo. Solo la clave por email: el contador
    // de IP (`resetip:<ip>`) es compartido entre cuentas y no se toca, mismo
    // criterio que el resto del rate limiting de este módulo.
    await resetAttempts(ctx, `resetcode:${emailKey}`);

    return { code, email: emailKey, name: user.name };
  },
});

// 4. Mutation pública: verifica el código y, si coincide, emite un ticket
// opaco de un solo uso que autoriza el cambio de contraseña.
export const verifyResetCode = mutation({
  args: { email: v.string(), code: v.string(), ipHint: v.optional(v.string()) },
  returns: v.union(
    v.object({ ok: v.literal(true), ticket: v.string() }),
    v.object({ ok: v.literal(false), error: v.string() }),
  ),
  handler: async (ctx, args) => {
    const emailKey = normalizeEmailKey(args.email);

    // M13 (ronda 2): un email fuera del contrato (vacío o >254) se rechaza
    // ANTES de construir `resetcode:<email>` o de tocar el rate limit en
    // cualquier forma — ni lectura (isLocked) ni escritura (fail()). La
    // ronda 1 validaba esto DESPUÉS de ya haber consultado isLocked con la
    // clave sobredimensionada, lo que seguía dejando pasar la amplificación
    // que M13 debía cerrar.
    if (!emailWithinLimits(emailKey)) {
      return { ok: false as const, error: GENERIC_CODE_ERROR };
    }

    const rateLimitKey = `resetcode:${emailKey}`;
    const ipKey = normalizeIpHint(args.ipHint ?? null);

    if (await isLocked(ctx, rateLimitKey)) {
      return { ok: false as const, error: GENERIC_CODE_ERROR };
    }
    if (ipKey && (await isLocked(ctx, `resetip:${ipKey}`))) {
      return { ok: false as const, error: GENERIC_CODE_ERROR };
    }

    const fail = async () => {
      await recordFailedAttempt(ctx, rateLimitKey, EMAIL_RATE_LIMIT);
      if (ipKey) await recordFailedAttempt(ctx, `resetip:${ipKey}`, IP_RATE_LIMIT);
      return { ok: false as const, error: GENERIC_CODE_ERROR };
    };

    // El email ya es válido en este punto — un código con formato incorrecto
    // sí pasa por fail() y cuenta como intento, igual que un código válido
    // pero equivocado.
    if (!CODE_FORMAT.test(args.code)) return await fail();

    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", emailKey))
      .unique();

    if (!user) return await fail();

    const rows = await ctx.db
      .query("passwordResetCodes")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const active = rows.find(
      (row) => !row.usedAt && row.codeHash !== undefined && row.expiresAt > Date.now(),
    );
    if (!active || active.attempts >= MAX_CODE_ATTEMPTS) return await fail();

    const matches = constantTimeEqual(
      new TextEncoder().encode(await hashToken(args.code)),
      new TextEncoder().encode(active.codeHash as string),
    );
    if (!matches) {
      await ctx.db.patch(active._id, { attempts: active.attempts + 1 });
      return await fail();
    }

    const ticket = generateOpaqueToken();
    await ctx.db.patch(active._id, {
      codeHash: undefined, // consume el código: no puede volver a emitir tickets
      ticketHash: await hashToken(ticket),
      ticketExpiresAt: Date.now() + TICKET_TTL_MS,
    });
    await resetAttempts(ctx, rateLimitKey);

    return { ok: true as const, ticket };
  },
});

// 5. Mutation pública: cambia la contraseña e invalida TODAS las sesiones del
// usuario, atómicamente en la misma mutation.
export const resetPasswordWithTicket = mutation({
  args: { ticket: v.string(), newPassword: v.string() },
  returns: v.union(
    v.object({ ok: v.literal(true) }),
    v.object({ ok: v.literal(false), error: v.string() }),
  ),
  handler: async (ctx, args) => {
    if (args.newPassword.length < 8 || args.newPassword.length > 128) {
      return { ok: false as const, error: PASSWORD_POLICY_ERROR };
    }

    const ticketHash = await hashToken(args.ticket);
    const row = await ctx.db
      .query("passwordResetCodes")
      .withIndex("by_ticketHash", (q) => q.eq("ticketHash", ticketHash))
      .unique();

    if (!row || row.usedAt || !row.ticketExpiresAt || row.ticketExpiresAt < Date.now()) {
      return { ok: false as const, error: TICKET_EXPIRED_ERROR };
    }

    await ctx.db.patch(row.userId, { passwordHash: await hashPassword(args.newPassword) });
    await ctx.db.patch(row._id, { usedAt: Date.now() });

    for (const session of await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", row.userId))
      .collect()) {
      await ctx.db.delete(session._id);
    }

    return { ok: true as const };
  },
});

// 6. Cron diario (convex/crons.ts): purga filas caducadas para no acumular
// basura indefinidamente. No es un requisito de seguridad (los campos ya
// caducados se tratan como inválidos en cualquier lectura), solo higiene.
export const cleanupExpiredResetCodes = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db.query("passwordResetCodes").collect();
    let deleted = 0;
    for (const row of rows) {
      // Ya consumida (cambio de contraseña completado), o ningún camino
      // sigue siendo utilizable: el código expiró sin llegar a emitir
      // ticket, o el ticket emitido también expiró sin usarse.
      const consumed = row.usedAt !== undefined;
      const codeDead = row.codeHash === undefined || row.expiresAt < now;
      const ticketDead = row.ticketHash === undefined || (row.ticketExpiresAt ?? 0) < now;
      if (consumed || (codeDead && ticketDead)) {
        await ctx.db.delete(row._id);
        deleted++;
      }
    }
    return deleted;
  },
});
```

---

## `src/app/(auth)/recuperar-contrasena/page.tsx`

Server Component — mismo criterio que `login/page.tsx` para redirigir si ya hay sesión.

```tsx
import { redirect } from "next/navigation";
import { getSession, landingPathForRole } from "@/lib/auth/dal";
import { RecoverForm } from "./RecoverForm";

// MIS-285: mismo criterio que login/page.tsx:22-25 — si ya hay sesión válida,
// no tiene sentido ofrecer recuperar una contraseña.
export default async function RecoverPasswordPage() {
  const user = await getSession();
  if (user) {
    redirect(landingPathForRole(user.role));
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-[var(--color-bg)] px-4 py-16">
      <RecoverForm />
    </div>
  );
}
```

---

## `src/app/(auth)/recuperar-contrasena/RecoverForm.tsx`

Client Component de 3 pasos. Un único `useState` local + `useTransition` en vez de tres `useActionState` (ver comentario del propio fichero: sincronizar 3 hooks independientes para saber "cuál respondió último" sería más complejo sin ganar nada).

```tsx
"use client";

import { useTransition, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/core/Button";
import { Input } from "@/components/ui/forms/Input";
import {
  requestResetCodeAction,
  verifyResetCodeAction,
  resetPasswordAction,
  type RecoverActionState,
} from "@/lib/auth/actions";

const initialState: RecoverActionState = { step: "email" };

// MIS-285: 3 pasos (email → código → nueva contraseña) en un único
// componente cliente. No usa useActionState (un hook por form obligaría a
// sincronizar 3 estados independientes para saber "cuál fue el último en
// responder"): en su lugar, un único useState local + useTransition, y las
// server actions se invocan directamente pasándoles el FormData del form que
// disparó el submit — siguen siendo Server Actions normales, solo que el
// resultado se enruta a mano al estado del wizard.
export function RecoverForm() {
  const [state, setState] = useState<RecoverActionState>(initialState);
  const [isPending, startTransition] = useTransition();

  function handleEmailSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await requestResetCodeAction(state, formData);
      setState(result);
    });
  }

  function handleCodeSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await verifyResetCodeAction(state, formData);
      setState(result);
    });
  }

  function handlePasswordSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await resetPasswordAction(state, formData);
      setState(result);
    });
  }

  return (
    <div style={{ width: "100%", maxWidth: 375, display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
            Recuperar contraseña
          </h1>
          <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: "4px 0 0" }}>
            {state.step === "email" && "Te enviaremos un código a tu email"}
            {state.step === "code" && "Introduce el código de 6 dígitos que te hemos enviado"}
            {state.step === "password" && "Elige tu nueva contraseña"}
          </p>
        </div>
      </div>

      {state.step === "email" && (
        <form action={handleEmailSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Input
            label="Email"
            name="email"
            type="email"
            placeholder="tucorreo@email.com"
            autoComplete="email"
            required
            disabled={isPending}
          />
          <Button type="submit" full size="lg" disabled={isPending}>
            {isPending ? "Enviando…" : "Enviar código"}
          </Button>
        </form>
      )}

      {state.step === "code" && (
        <form action={handleCodeSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <input type="hidden" name="email" value={state.email} />
          <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>{state.email}</p>
          <Input
            label="Código"
            name="code"
            type="text"
            inputMode="numeric"
            maxLength={6}
            placeholder="000000"
            autoComplete="one-time-code"
            required
            disabled={isPending}
          />

          {state.error && <ErrorBox message={state.error} />}

          <Button type="submit" full size="lg" disabled={isPending}>
            {isPending ? "Comprobando…" : "Continuar"}
          </Button>

          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <button
              type="button"
              onClick={() => {
                const formData = new FormData();
                formData.set("email", state.email);
                handleEmailSubmit(formData);
              }}
              disabled={isPending}
              style={linkButtonStyle}
            >
              Reenviar código
            </button>
            <button
              type="button"
              onClick={() => setState({ step: "email" })}
              disabled={isPending}
              style={linkButtonStyle}
            >
              Usar otro email
            </button>
          </div>
        </form>
      )}

      {state.step === "password" && (
        <form action={handlePasswordSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <input type="hidden" name="ticket" value={state.ticket} />
          <Input
            label="Nueva contraseña"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={128}
            disabled={isPending}
          />
          <Input
            label="Repite la contraseña"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={128}
            disabled={isPending}
          />

          {state.error && <ErrorBox message={state.error} />}

          <Button type="submit" full size="lg" disabled={isPending}>
            {isPending ? "Guardando…" : "Guardar nueva contraseña"}
          </Button>
        </form>
      )}

      <a
        href="/login"
        style={{ textAlign: "center", fontSize: 13, color: "var(--text-secondary)", textDecoration: "none" }}
      >
        Volver al login
      </a>
    </div>
  );
}

const linkButtonStyle: CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  cursor: "pointer",
  fontSize: 13,
  color: "var(--color-accent)",
  textDecoration: "underline",
};

function ErrorBox({ message }: { message: string }) {
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 12px",
        borderRadius: "var(--radius-md)",
        background: "var(--color-danger-bg)",
        color: "var(--color-danger-fg)",
        fontSize: 13,
      }}
    >
      {message}
    </div>
  );
}
```

---

## `e2e/password-reset.spec.ts`

Flujo UI completo, project `chromium-secrets`.

```ts
// MIS-285: flujo UI completo de recuperación de contraseña por código.
//
// Corre en el project "chromium-secrets" (MIS-286): aquí circula la
// contraseña efímera de la identidad dedicada y la nueva contraseña que fija
// el propio spec, ninguna de las dos como literal — ambas se generan en
// tiempo de ejecución. "la contraseña nueva funciona" / "la vieja ya no" se
// comprueban con ConvexHttpClient (loginSucceeds), NO rellenando el
// formulario de login: lo único que se teclea en la UI es la contraseña
// nueva del formulario de restablecimiento, que es la funcionalidad bajo
// prueba (ver PLANS/MIS-285-recuperacion-contrasena-plan.md, "Manejo del
// secreto").
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

test.describe("recuperación de contraseña por código (MIS-285)", () => {
  test("pedir código → verificarlo → fijar nueva contraseña → /login?reset=ok", async ({ page }) => {
    const oldPassword = await resetTestIdentity();
    const newPassword = freshPassword();

    await page.goto("/recuperar-contrasena");
    await page.getByLabel("Email").fill(RESET_TEST_EMAIL);
    await page.getByRole("button", { name: "Enviar código" }).click();

    await expect(page.getByLabel("Código")).toBeVisible();

    const code = await waitForResetCode();
    await page.getByLabel("Código").fill(code);
    await page.getByRole("button", { name: "Continuar" }).click();

    await expect(page.getByLabel("Nueva contraseña")).toBeVisible();
    await page.getByLabel("Nueva contraseña").fill(newPassword);
    await page.getByLabel("Repite la contraseña").fill(newPassword);
    await page.getByRole("button", { name: "Guardar nueva contraseña" }).click();

    await page.waitForURL(/\/login\?reset=ok/);
    await expect(page.getByText("Contraseña actualizada")).toBeVisible();

    expect(await loginSucceeds(newPassword)).toBe(true);
    expect(await loginSucceeds(oldPassword)).toBe(false);
  });
});
```

---

## `e2e/password-reset-invariants.spec.ts`

Invariantes de seguridad por API (`ConvexHttpClient`), project `chromium-secrets`.

```ts
// MIS-285: invariantes de seguridad del flujo de recuperación de contraseña,
// verificadas por API (ConvexHttpClient) — no por formulario, mismo criterio
// que password-reset.spec.ts. Corre en "chromium-secrets" (MIS-286): la
// contraseña efímera de la identidad dedicada circula por aquí.
import { randomBytes } from "node:crypto";
import { test, expect } from "./helpers/secure-test";
import { convexClient, api } from "./helpers/convex-client";
import {
  RESET_TEST_EMAIL,
  countSessionsFor,
  expireResetCode,
  getLastResetCode,
  loginSucceeds,
  resetTestIdentity,
} from "./helpers/test-support";
import { generateNumericCode } from "../convex/lib/token";

function freshPassword(): string {
  return randomBytes(24).toString("base64url");
}

// Cambia un dígito, garantizando un código distinto del real sin asumir
// nada sobre su valor concreto.
function wrongCode(realCode: string): string {
  const firstDigit = Number(realCode[0]);
  const flipped = (firstDigit + 1) % 10;
  return `${flipped}${realCode.slice(1)}`;
}

// M14 (auditoría, ronda 2): `testOutbox` nunca borra entregas anteriores
// (solo resetTestIdentity() lo hace) y getLastResetCode() devuelve la de
// mayor createdAt entre TODAS — así que pedir un segundo código dentro del
// mismo test, con una entrega previa aún en el outbox, hace que
// `.not.toBeNull()` se satisfaga con el código VIEJO antes de que la nueva
// entrega (programada, no esperada por la mutation) haya terminado. El poll
// debe exigir un valor distinto del anterior, no solo "no nulo".
async function requestAndGetCode(previousCode: string | null = null): Promise<string> {
  const client = convexClient();
  await client.mutation(api.passwordReset.requestPasswordResetCode, { email: RESET_TEST_EMAIL });

  await expect
    .poll(
      async () => {
        const current = await getLastResetCode();
        return current !== null && current !== previousCode;
      },
      { message: "esperando una entrega nueva y distinta en el outbox de test", timeout: 10_000 },
    )
    .toBe(true);
  const code = await getLastResetCode();
  if (!code) throw new Error("getLastResetCode() devolvió null tras confirmar una entrega nueva");
  return code;
}

test.describe("generateNumericCode — invariantes deterministas", () => {
  test("longitud exacta 6, solo dígitos, y no siempre el mismo valor", () => {
    const samples = Array.from({ length: 200 }, () => generateNumericCode(6));

    for (const code of samples) {
      expect(code).toMatch(/^\d{6}$/);
      const asNumber = Number(code);
      expect(asNumber).toBeGreaterThanOrEqual(0);
      expect(asNumber).toBeLessThanOrEqual(999999);
    }

    expect(new Set(samples).size).toBeGreaterThan(1);
  });
});

test.describe("recuperación de contraseña — invariantes de seguridad (MIS-285)", () => {
  test("código incorrecto devuelve un error genérico", async () => {
    await resetTestIdentity();
    const realCode = await requestAndGetCode();
    const client = convexClient();

    const result = await client.mutation(api.passwordReset.verifyResetCode, {
      email: RESET_TEST_EMAIL,
      code: wrongCode(realCode),
    });

    expect(result.ok).toBe(false);
  });

  test("el 6.º intento queda bloqueado incluso con el código correcto", async () => {
    await resetTestIdentity();
    const realCode = await requestAndGetCode();
    const client = convexClient();

    for (let i = 0; i < 5; i++) {
      const result = await client.mutation(api.passwordReset.verifyResetCode, {
        email: RESET_TEST_EMAIL,
        code: wrongCode(realCode),
      });
      expect(result.ok).toBe(false);
    }

    // El código real ya no sirve: 5 intentos fallidos consumen el margen,
    // sea por `attempts >= 5` en la fila o por el rate limit de
    // `resetcode:<email>` — ambos caminos deben rechazar por igual.
    const finalAttempt = await client.mutation(api.passwordReset.verifyResetCode, {
      email: RESET_TEST_EMAIL,
      code: realCode,
    });
    expect(finalAttempt.ok).toBe(false);
  });

  test("un código caducado se rechaza sin esperar 15 minutos", async () => {
    await resetTestIdentity();
    const realCode = await requestAndGetCode();

    const hadActiveCode = await expireResetCode();
    expect(hadActiveCode).toBe(true);

    const client = convexClient();
    const result = await client.mutation(api.passwordReset.verifyResetCode, {
      email: RESET_TEST_EMAIL,
      code: realCode,
    });
    expect(result.ok).toBe(false);
  });

  test("un ticket ya usado no puede reutilizarse para un segundo cambio", async () => {
    await resetTestIdentity();
    const realCode = await requestAndGetCode();
    const client = convexClient();

    const verified = await client.mutation(api.passwordReset.verifyResetCode, {
      email: RESET_TEST_EMAIL,
      code: realCode,
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) throw new Error("unreachable");

    const firstChange = await client.mutation(api.passwordReset.resetPasswordWithTicket, {
      ticket: verified.ticket,
      newPassword: freshPassword(),
    });
    expect(firstChange.ok).toBe(true);

    const secondChange = await client.mutation(api.passwordReset.resetPasswordWithTicket, {
      ticket: verified.ticket,
      newPassword: freshPassword(),
    });
    expect(secondChange.ok).toBe(false);
  });

  // M12 (auditoría, ronda 2): tras agotar los 5 intentos de un código,
  // solicitar uno nuevo debe desbloquear la verificación — el rate limit de
  // `resetcode:<email>` no puede quedar atado al código anterior.
  test("tras 5 intentos fallidos, pedir un código nuevo desbloquea la verificación", async () => {
    await resetTestIdentity();
    const staleCode = await requestAndGetCode();
    const client = convexClient();

    for (let i = 0; i < 5; i++) {
      const result = await client.mutation(api.passwordReset.verifyResetCode, {
        email: RESET_TEST_EMAIL,
        code: wrongCode(staleCode),
      });
      expect(result.ok).toBe(false);
    }

    const freshCode = await requestAndGetCode(staleCode);
    const result = await client.mutation(api.passwordReset.verifyResetCode, {
      email: RESET_TEST_EMAIL,
      code: freshCode,
    });
    expect(result.ok).toBe(true);
  });

  // M13 (auditoría, ronda 2): la frontera pública debe rechazar entradas que
  // no cumplen el contrato (código que no son 6 dígitos) sin lanzar excepción
  // ni tratarlas de forma distinta a un código simplemente incorrecto.
  test("verifyResetCode rechaza códigos que no son 6 dígitos, con el mismo error genérico", async () => {
    await resetTestIdentity();
    await requestAndGetCode();
    const client = convexClient();

    for (const malformed of ["", "12345", "1234567", "abcdef", "12345a", "1 2345"]) {
      const result = await client.mutation(api.passwordReset.verifyResetCode, {
        email: RESET_TEST_EMAIL,
        code: malformed,
      });
      expect(result.ok).toBe(false);
    }
  });

  // M13: un email fuera del límite del contrato (>254) no debe lanzar ni
  // recibir trato distinto — mismo {ok:true} genérico que cualquier email
  // bien formado, exista o no la cuenta.
  test("requestPasswordResetCode con un email excesivamente largo responde {ok:true} sin lanzar", async () => {
    const client = convexClient();
    const oversizedEmail = `${"a".repeat(250)}@test.local`;
    const result = await client.mutation(api.passwordReset.requestPasswordResetCode, {
      email: oversizedEmail,
    });
    expect(result).toEqual({ ok: true });
  });

  // M13 (auditoría, ronda 2): la misma validación, pero contra
  // verifyResetCode directamente — la ronda 1 solo la probó en
  // requestPasswordResetCode. Email vacío y de 255 caracteres, respuesta
  // genérica sin excepción, invocada directamente por ConvexHttpClient (sin
  // pasar por el formulario, que ya recorta con maxLength/required).
  test("verifyResetCode con email vacío o excesivamente largo responde genérico sin lanzar", async () => {
    const client = convexClient();
    for (const badEmail of ["", `${"a".repeat(250)}@test.local`]) {
      const result = await client.mutation(api.passwordReset.verifyResetCode, {
        email: badEmail,
        code: "123456",
      });
      expect(result.ok).toBe(false);
    }
  });

  test("cambiar la contraseña invalida todas las sesiones existentes", async () => {
    const oldPassword = await resetTestIdentity();
    expect(await loginSucceeds(oldPassword)).toBe(true); // crea una sesión
    expect(await countSessionsFor()).toBeGreaterThan(0);

    const realCode = await requestAndGetCode();
    const client = convexClient();
    const verified = await client.mutation(api.passwordReset.verifyResetCode, {
      email: RESET_TEST_EMAIL,
      code: realCode,
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) throw new Error("unreachable");

    const changed = await client.mutation(api.passwordReset.resetPasswordWithTicket, {
      ticket: verified.ticket,
      newPassword: freshPassword(),
    });
    expect(changed.ok).toBe(true);

    expect(await countSessionsFor()).toBe(0);
  });
});
```

---

# Ficheros modificados

## `convex/lib/token.ts`

```diff
--- a/convex/lib/token.ts
+++ b/convex/lib/token.ts
@@ -25,3 +25,17 @@ export async function hashToken(token: string): Promise<string> {
   const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
   return bytesToHex(new Uint8Array(digest));
 }
+
+// MIS-285: código numérico del flujo de recuperación de contraseña (OTP por
+// email). Rejection sampling sobre la misma fuente de entropía que
+// generateOpaqueToken — un simple `% 10**digits` sesgaría ligeramente los
+// dígitos bajos, porque 2**32 no es múltiplo exacto de 10**digits.
+export function generateNumericCode(digits = 6): string {
+  const max = 10 ** digits;
+  const limit = Math.floor(0x100000000 / max) * max;
+  let value: number;
+  do {
+    value = crypto.getRandomValues(new Uint32Array(1))[0];
+  } while (value >= limit);
+  return String(value % max).padStart(digits, "0");
+}
```

## `convex/crons.ts`

```diff
--- a/convex/crons.ts
+++ b/convex/crons.ts
@@ -9,4 +9,12 @@ crons.daily(
   internal.auth.cleanupExpiredSessions,
 );
 
+// MIS-285: purga diaria de códigos/tickets de recuperación de contraseña
+// caducados o ya consumidos.
+crons.daily(
+  "cleanup expired reset codes",
+  { hourUTC: 3, minuteUTC: 5 },
+  internal.passwordReset.cleanupExpiredResetCodes,
+);
+
 export default crons;
```

## `playwright.config.ts`

```diff
--- a/playwright.config.ts
+++ b/playwright.config.ts
@@ -82,7 +82,7 @@ export default defineConfig({
     // playwright.gate.config.ts: el gate replica estos valores a propósito.
     {
       name: "chromium-secrets",
-      testMatch: ["test-support.spec.ts"],
+      testMatch: ["test-support.spec.ts", "password-reset.spec.ts", "password-reset-invariants.spec.ts"],
       use: {
         ...devices["Desktop Chrome"],
         trace: "off",
```

## `src/app/(auth)/login/LoginForm.tsx`

```diff
--- a/src/app/(auth)/login/LoginForm.tsx
+++ b/src/app/(auth)/login/LoginForm.tsx
@@ -13,9 +13,12 @@ const initialState: LoginActionState = undefined;
 // conoce el resultado de un submit del propio formulario de password.
 type LoginFormProps = {
   initialError?: string;
+  // MIS-285: aviso tras completar la recuperación de contraseña
+  // (?reset=ok), leído en page.tsx igual que el error de Google.
+  initialSuccess?: string;
 };
 
-export function LoginForm({ initialError }: LoginFormProps) {
+export function LoginForm({ initialError, initialSuccess }: LoginFormProps) {
   const [state, formAction, isPending] = useActionState(loginAction, initialState);
   const [showPassword, setShowPassword] = useState(false);
 
@@ -51,6 +54,23 @@ export function LoginForm({ initialError }: LoginFormProps) {
       </div>
 
       <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
+        {!displayError && initialSuccess && (
+          <div
+            role="status"
+            style={{
+              display: "flex",
+              alignItems: "center",
+              gap: 8,
+              padding: "10px 12px",
+              borderRadius: "var(--radius-md)",
+              background: "var(--color-success-bg)",
+              color: "var(--color-success-fg)",
+              fontSize: 13,
+            }}
+          >
+            {initialSuccess}
+          </div>
+        )}
         <Input
           label="Email"
           name="email"
@@ -87,6 +107,13 @@ export function LoginForm({ initialError }: LoginFormProps) {
           }
         />
 
+        <a
+          href="/recuperar-contrasena"
+          style={{ alignSelf: "flex-end", fontSize: 13, color: "var(--color-accent)", textDecoration: "none" }}
+        >
+          ¿Olvidaste tu contraseña?
+        </a>
+
         {displayError && (
           <div
             role="alert"
```

## `src/app/(auth)/login/page.tsx`

```diff
--- a/src/app/(auth)/login/page.tsx
+++ b/src/app/(auth)/login/page.tsx
@@ -12,7 +12,7 @@ const GOOGLE_LOGIN_ERROR_MESSAGE =
 export default async function LoginPage({
   searchParams,
 }: {
-  searchParams: Promise<{ error?: string }>;
+  searchParams: Promise<{ error?: string; reset?: string }>;
 }) {
   // Comprobación real (no la optimista de src/proxy.ts): si ya hay una sesión
   // válida, saltar directamente al home por rol. Si la cookie existe pero la
@@ -24,12 +24,15 @@ export default async function LoginPage({
     redirect(landingPathForRole(user.role));
   }
 
-  const { error } = await searchParams;
+  const { error, reset } = await searchParams;
   const googleError = error === "google";
 
   return (
     <div className="flex flex-1 items-center justify-center bg-[var(--color-bg)] px-4 py-16">
-      <LoginForm initialError={googleError ? GOOGLE_LOGIN_ERROR_MESSAGE : undefined} />
+      <LoginForm
+        initialError={googleError ? GOOGLE_LOGIN_ERROR_MESSAGE : undefined}
+        initialSuccess={reset === "ok" ? "Contraseña actualizada. Ya puedes iniciar sesión." : undefined}
+      />
     </div>
   );
 }
```

## `src/lib/auth/actions.ts`

```diff
--- a/src/lib/auth/actions.ts
+++ b/src/lib/auth/actions.ts
@@ -35,3 +35,73 @@ export async function logoutAction(): Promise<void> {
   await clearSessionCookie();
   redirect("/login");
 }
+
+// MIS-285: recuperación de contraseña por código (OTP). Un único tipo de
+// estado para las 3 actions — cada una avanza `step` según el resultado, y
+// RecoverForm.tsx (Client Component) decide qué paso pintar a partir de él.
+export type RecoverActionState =
+  | { step: "email" }
+  | { step: "code"; email: string; error?: string }
+  | { step: "password"; ticket: string; error?: string };
+
+// Anti-enumeración: SIEMPRE avanza a "code", exista o no la cuenta — el
+// backend (requestPasswordResetCode) ya responde con el mismo timing en
+// ambos casos, así que esta action no puede añadir una distinción que el
+// backend evitó a propósito.
+export async function requestResetCodeAction(
+  _prevState: RecoverActionState,
+  formData: FormData,
+): Promise<RecoverActionState> {
+  const email = String(formData.get("email") ?? "");
+  const ipHint = (await headers()).get("x-forwarded-for") ?? undefined;
+
+  await fetchMutation(api.passwordReset.requestPasswordResetCode, { email, ipHint });
+
+  return { step: "code", email };
+}
+
+export async function verifyResetCodeAction(
+  _prevState: RecoverActionState,
+  formData: FormData,
+): Promise<RecoverActionState> {
+  const email = String(formData.get("email") ?? "");
+  const code = String(formData.get("code") ?? "");
+  const ipHint = (await headers()).get("x-forwarded-for") ?? undefined;
+
+  const result = await fetchMutation(api.passwordReset.verifyResetCode, { email, code, ipHint });
+
+  if (!result.ok) {
+    return { step: "code", email, error: result.error };
+  }
+  return { step: "password", ticket: result.ticket };
+}
+
+const PASSWORD_MISMATCH_ERROR = "Las contraseñas no coinciden";
+const PASSWORD_POLICY_ERROR = "La contraseña debe tener entre 8 y 128 caracteres";
+
+export async function resetPasswordAction(
+  _prevState: RecoverActionState,
+  formData: FormData,
+): Promise<RecoverActionState> {
+  const ticket = String(formData.get("ticket") ?? "");
+  const newPassword = String(formData.get("newPassword") ?? "");
+  const confirmPassword = String(formData.get("confirmPassword") ?? "");
+
+  if (newPassword !== confirmPassword) {
+    return { step: "password", ticket, error: PASSWORD_MISMATCH_ERROR };
+  }
+  if (newPassword.length < 8 || newPassword.length > 128) {
+    return { step: "password", ticket, error: PASSWORD_POLICY_ERROR };
+  }
+
+  const result = await fetchMutation(api.passwordReset.resetPasswordWithTicket, {
+    ticket,
+    newPassword,
+  });
+
+  if (!result.ok) {
+    return { step: "password", ticket, error: result.error };
+  }
+
+  redirect("/login?reset=ok");
+}
```

## `.env.local.example`

```diff
--- a/.env.local.example
+++ b/.env.local.example
@@ -10,3 +10,8 @@ GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
 # Debe coincidir EXACTAMENTE con el mismo valor puesto en Convex vía:
 #   npx convex env set GOOGLE_LOGIN_SHARED_SECRET <valor>
 GOOGLE_LOGIN_SHARED_SECRET=
+
+# Recuperación de contraseña por código (MIS-285) — SOLO en Convex, NUNCA aquí
+# ni en Railway: convex/lib/resend.ts las lee de process.env del deployment.
+#   npx convex env set RESEND_API_KEY <valor>
+#   npx convex env set RESEND_FROM no-reply@mistu-monso.com
```

## `README.md`

```diff
--- a/README.md
+++ b/README.md
@@ -83,6 +83,21 @@ Redirect URIs a registrar en Google Cloud Console (Authorized redirect URIs) —
 
 **Producción queda fuera de alcance de MIS-260**: el deployment de Convex de producción está pendiente de un fix aparte ya conocido (deploy manual olvidado varias veces) — la redirect URI de prod puede registrarse ya en Google Console (config estática, no cuesta nada tenerla lista), pero el código y los datos de producción no se tocan en este ticket.
 
+### Recuperación de contraseña por código (MIS-285)
+
+"¿Olvidaste tu contraseña?" en el login lleva a `/recuperar-contrasena`, un flujo de 3 pasos (email → código → nueva contraseña). El código son 6 dígitos, caduca en 15 minutos y admite 5 intentos; al verificarlo se emite un ticket opaco (también 15 min, un solo uso) que autoriza el cambio. Al cambiar la contraseña se invalidan **todas** las sesiones del usuario — no hay auto-login, hay que volver a entrar. La respuesta a "pedir código" es siempre genérica y con el mismo timing exista o no la cuenta (anti-enumeración): la mutation pública no consulta `users` ni espera al envío, solo programa el trabajo real vía `ctx.scheduler`.
+
+El envío usa la API REST de Resend directamente por `fetch` desde una Convex action (`convex/lib/resend.ts`), sin el SDK `resend` — mismo criterio que el cliente de Google OAuth (`src/lib/auth/google.ts`), que ya habla con una API externa sin depender de un SDK.
+
+Variables de entorno nuevas (**solo en Convex, nunca en `.env.local` ni en Railway** — no hay lógica de envío en Next.js):
+
+| Variable | Convex dev | Convex prod |
+|---|---|---|
+| `RESEND_API_KEY` | `npx convex env set RESEND_API_KEY <valor>` | Gate de predeploy: debe existir antes de `npx convex deploy` |
+| `RESEND_FROM` | `npx convex env set RESEND_FROM no-reply@mistu-monso.com` | Idem |
+
+El dominio `mistu-monso.com` ya está verificado en Resend (DKIM/SPF/DMARC en Cloudflare) — ver `PLANS/MIS-285-resend-dns-setup.md`.
+
 ### Harness seguro de pruebas e2e (MIS-286)
 
 El flujo de recuperación de contraseña (MIS-285) manda un **código por email** y en BD solo guarda su hash, así que un test no puede leerlo por medios normales. `convex/testSupport.ts` abre la mínima puerta que lo permite, cerrada con **tres cerrojos independientes**:
```

## `PLANS/README.md`

```diff
--- a/PLANS/README.md
+++ b/PLANS/README.md
@@ -27,3 +27,5 @@ Planes de implementación por tarea de Linear (proyecto CRM - MVP), en orden de
 | [MIS-260](https://linear.app/mistu-monso/issue/MIS-260) | Login con Google (OAuth), conviviendo con el login por contraseña | [MIS-260-login-google.md](./MIS-260-login-google.md) | **Instalado** — ver PR #42 de la rama `feature/mis-260-login-google` |
 | [MIS-261](https://linear.app/mistu-monso/issue/MIS-261) | Arreglar despliegue de Convex en producción (catch-up, sin cambios de esquema) | [MIS-261-fix-convex-prod-deploy.md](./MIS-261-fix-convex-prod-deploy.md) | **Instalado** — ver PR #43 |
 | [MIS-262](https://linear.app/mistu-monso/issue/MIS-262) | Desplegar login con Google a producción | [MIS-262-deploy-google-login-produccion.md](./MIS-262-deploy-google-login-produccion.md) | **Instalado** — ver PR #44, pendiente solo de verificación manual final |
+| [MIS-286](https://linear.app/mistu-monso/issue/MIS-286) | Harness seguro de pruebas e2e para recuperación de contraseña | [MIS-286-harness-seguro-e2e-recuperacion.md](./MIS-286-harness-seguro-e2e-recuperacion.md) | **Instalado** — ver PR #47 |
+| [MIS-285](https://linear.app/mistu-monso/issue/MIS-285) | Email transaccional con Resend: recuperación de contraseña por código (OTP) | [MIS-285-recuperacion-contrasena-plan.md](./MIS-285-recuperacion-contrasena-plan.md) | En desarrollo — GO condicionado activado tras el merge de MIS-286 |
```

> `convex/schema.ts` y `src/proxy.ts` **no se tocan** — el primero ya lo definió MIS-286, el segundo porque `/recuperar-contrasena` debe seguir accesible sin sesión y por eso NO se añade a su `matcher`. `convex/_generated/api.d.ts`/`server.d.ts` se regeneran automáticamente con `npx convex dev` / `npx convex codegen` y no se incluyen aquí.

---

# Evidencia de ejecución (local, 2026-08-10 — tras el fix de M13/M14, 3ª ronda)

- **`npx tsc --noEmit -p .`** → limpio, 0 errores.
- **`npm run lint`** → 0 errores (1 warning preexistente y no relacionado, `Avatar.jsx`/`no-img-element`).
- **`npm run build`** → compila; `/recuperar-contrasena` aparece en el árbol de rutas (`ƒ /recuperar-contrasena`).
- **`npx convex dev --once`** → funciones desplegadas al deployment de dev (`dutiful-mole-111`) sin errores, incluido el reordenamiento de M13 en `verifyResetCode`.
- **`npm run test:e2e -- --project=chromium-secrets`** → **15/15 passed**, dos ejecuciones consecutivas (repetibilidad, M8): los 11 tests de MIS-285 (flujo completo + 10 invariantes — el nuevo test directo de M13 sobre `verifyResetCode`, y el de M12 corregido para M14) y los 4 ya existentes del harness de MIS-286, todos en verde ambas veces.
- **`npm run test:e2e`** (suite completa, todos los projects) → sin cambios respecto a rondas anteriores: **30 passed**, **8 failed** — mismo lote de flakiness **preexistente y ya documentado** (`edge-cases.spec.ts`, `full-flow.spec.ts`, `role-gating.spec.ts`), ticketado como **[MIS-287](https://linear.app/mistu-monso/issue/MIS-287)** (Backlog, no bloqueante). Ningún fallo nuevo introducido por esta ronda.
- **`npm run test:e2e:secret-gate`** → Fase A (control positivo) detecta el centinela; Fase B (política real) no encuentra rastro en artefactos, `.zip` de trace ni salida del proceso. **Gate superado.**

## Pendiente antes de desplegar a producción (gates ya conocidos, no de este ticket)

- `RESEND_API_KEY` y `RESEND_FROM` deben existir en Convex **producción** antes de `npx convex deploy` (hoy solo están en dev).
- `E2E_TEST_SUPPORT_KEY` debe seguir **ausente** en Convex producción (ya verificado en la auditoría de MIS-286, sin cambios en este ticket).
- `npx convex deploy` es un paso manual históricamente olvidado (ver `PLANS/MIS-261-fix-convex-prod-deploy.md`) — recordarlo explícitamente al desplegar.

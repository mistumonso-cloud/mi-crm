# MIS-298 · B3 — "Cerrar sesión en todos los dispositivos" (revocación global bajo demanda)

> Dividido de MIS-293 (Fase 3). Plan de récord, **ronda 2** (tras auditoría de plan NO-GO por
> M1/M2/M3). **NO autoriza instalar/mergear/desplegar** — ver "Gate".

## Contexto

B3 enumeraba cuatro carencias del modelo de sesión: 30 días fijos, sin rotación, sin "cerrar sesión
en todos los dispositivos", sin límite de concurrentes. Al explorar el código:

- El modelo de sesión ya es sólido: tabla `sessions` `{ userId, tokenHash (SHA-256 del token opaco de
  32 B), expiresAt }` con índices `by_tokenHash` y **`by_user`**; lectura por hash con **comprobación
  de expiración** (`lookupSessionUser` en `convex/lib/authz.ts`); cron diario `cleanupExpiredSessions`.
- **La revocación global AL CAMBIAR LA CONTRASEÑA YA EXISTE**: `resetPasswordWithTicket`
  (`convex/passwordReset.ts`) ya borra todas las sesiones del usuario (`by_user` → delete) tras fijar
  el nuevo hash. El único camino que cambia una contraseña es el flujo de recuperación (el otro
  escritor de `passwordHash` es `seedUser`, aprovisionamiento de usuario nuevo, sin sesiones).

**Hueco real que queda (alcance elegido: B):** hoy `logout` solo mata **la sesión actual**; no hay
forma de que un usuario cierre **las demás** sesiones **bajo demanda** sin cambiar la contraseña.

Alcance del usuario: **solo B**. Rotación / TTL deslizante (chocan con la lectura de sesión en Server
Components, donde no se puede reescribir la cookie) y límite de concurrentes (bajo valor para 2
usuarios) quedan **fuera**, como follow-ups.

## Diseño

### Convex
1. **`convex/lib/session.ts`** — helper reutilizable:
   ```ts
   export async function revokeAllUserSessions(ctx: MutationCtx, userId: Id<"users">): Promise<number> {
     const sessions = await ctx.db.query("sessions").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
     for (const s of sessions) await ctx.db.delete(s._id);
     return sessions.length;
   }
   ```
2. **`convex/passwordReset.ts::resetPasswordWithTicket`** — sustituir el bucle `by_user` inline (hoy
   ~L283-289) por `await revokeAllUserSessions(ctx, row.userId);`. **Refactor sin cambio de
   comportamiento** (DRY).
3. **`convex/auth.ts`** — nueva mutation `logoutAllSessions`, con **comprobación de vigencia (M1)**
   reutilizando `lookupSessionUser` (ya importado en auth.ts; valida `expiresAt` y devuelve el
   `userId` como `.id`), sin duplicar la regla de expiración:
   ```ts
   export const logoutAllSessions = mutation({
     args: { token: v.string() },
     returns: v.null(),
     handler: async (ctx, args) => {
       // Solo una sesión VIGENTE autoriza la revocación global. Una fila expirada
       // (aún no purgada por el cron) NO debe poder expulsar sesiones nuevas.
       const user = await lookupSessionUser(ctx, args.token);
       if (user) await revokeAllUserSessions(ctx, user.id);
       return null;
     },
   });
   ```
   Revoca **todas** las sesiones del usuario (incluida la actual → tras la acción queda deslogueado en
   todas partes). **Mismo modelo de confianza que `logout`** (el token es la credencial portadora, sin
   `serverKey`). Token desconocido **o expirado** → no-op.

### Next (frontend)
4. **`src/lib/auth/actions.ts`** — `logoutAllAction`, calcada de `logoutAction`:
   ```ts
   export async function logoutAllAction(): Promise<void> {
     const token = await readSessionToken();
     if (token) await fetchMutation(api.auth.logoutAllSessions, { token });
     await clearSessionCookie();
     redirect("/login");
   }
   ```
5. **`src/app/(app)/layout.tsx`** — junto al `<form action={logoutAction}>` (L32-36), un segundo
   `<form action={logoutAllAction}>` con `<Button variant="ghost" size="sm">` de **nombre accesible
   exacto** `"Cerrar sesión en todos los dispositivos"`. Mismo patrón (Server Action, sin JS de
   cliente). (Baja: si el texto largo apretara en pantallas estrechas, se puede acortar el rótulo
   VISUAL manteniendo el nombre accesible completo vía `aria-label`; se decide en código.)

## Verificación

### Fixture de test necesario (M1)
Para probar el rechazo de un token expirado hace falta **insertar una sesión expirada**, imposible por
la API pública. Se añade **una** mutation de test-support, gated por `E2E_TEST_SUPPORT_KEY` y
restringida a la identidad dedicada (`assertTestKey` + `assertDedicatedIdentity`), en
`convex/testSupport.ts`:
```ts
// testInsertSession({ serverKey, email, ttlMs }) -> { token }
//   assertTestKey(serverKey); assertDedicatedIdentity(email);   // <- gate visible en la entrega
//   Inserta una sesión para la identidad dedicada con expiresAt = Date.now() + ttlMs
//   (ttlMs negativo => ya expirada). Devuelve el token en claro. Reusa generateOpaqueToken/hashToken.
```
`ttlMs` **acotado** a un rango finito razonable (p. ej. `[-1h, +40 días]`); fuera de rango → error,
aunque esté protegido por `E2E_TEST_SUPPORT_KEY`. La identidad debe existir: los specs llaman antes a
`resetTestIdentity`, que la siembra y deja 0 sesiones. **El gate `assertTestKey` +
`assertDedicatedIdentity` se muestra literal en el codigo-completo.md** (es frontera de seguridad al
desplegarse en prod).

### E2E — `e2e/session-revoke-all.spec.ts` (project `chromium-secrets`, identidad DEDICADA)
Aislado de Carlos/Marta: opera **solo** sobre `RESET_TEST_EMAIL`, así que revocar "todas sus sesiones"
no toca `carlos.json` ni las de Marta. Toda la preparación/limpieza va en **`try/finally` best-effort**
para no dejar sesiones colgando si un test falla antes de tiempo. Casos:

1. **Revoca TODAS (núcleo).** `resetTestIdentity` → `testInsertSession` ×2 (válidas, tokens A, B) →
   `countSessionsFor === 2`, `getSessionUser(A)` y `(B)` no nulos → `logoutAllSessions({token: A})` →
   `countSessionsFor === 0`, `getSessionUser(A) === null` **y** `getSessionUser(B) === null` (revoca
   más que la "actual").
2. **Token EXPIRADO no revoca — no-op EXACTO (M1).** `resetTestIdentity` → `testInsertSession`
   expirada (E, ttlMs<0) + válida (V). `lookupSessionUser` es de solo lectura (no purga la fila
   expirada), así que el contrato es no-op estricto:
   ```ts
   const before = await countSessionsFor(email);      // == 2 (E + V)
   await logoutAllSessions({ token: E });
   expect(await countSessionsFor(email)).toBe(before); // igualdad EXACTA
   expect(await getSessionUser(V)).not.toBeNull();     // la vigente sobrevive
   expect(await getSessionUser(E)).toBeNull();          // control: E ya no autentica (expirada)
   ```
3. **Token DESCONOCIDO → null, sin cambios (Media).** con 1 sesión válida presente, capturar
   `before = countSessionsFor`, `logoutAllSessions({token: "no-existe"})`, exigir
   `countSessionsFor === before` y `getSessionUser(V)` no nulo.

   *(Caso de aislamiento entre usuarios RETIRADO por la auditoría: nació como sugerencia Media, no es
   necesario para B3, y `carlosTokenFromDisk()` sería frágil en `chromium-secrets` —project sin
   `dependencies` de `setup-carlos`—. La propiedad "no cruza de usuario" es correcta por construcción:
   `revokeAllUserSessions` filtra por `by_user` sobre un único `userId`.)*

### E2E UI — cableado botón → Server Action → mutation (M2, OBLIGATORIO)
Mismo spec, `chromium-secrets` (teclea contraseña real, trace off). `try/finally` best-effort donde la
**limpieza va por `resetTestIdentity`** (test-support, independiente del token del navegador, que en el
camino feliz habrá quedado revocado):
1. `resetTestIdentity` → login **por navegador** como la identidad dedicada (sesión C en el jar).
2. `testInsertSession` válida extra (D) por `convexClient` (segunda sesión del mismo usuario).
3. Localizar y **pulsar el botón por su nombre accesible exacto** `getByRole("button", { name: "Cerrar sesión en todos los dispositivos" })`.
4. `waitForURL(/\/login/)`.
5. La **cookie de sesión desaparece** del jar (no solo el redirect): `context.cookies()` sin la cookie
   `SESSION_COOKIE_NAME` (constante importada de `src/lib/auth/constants`, sin duplicar el literal).
6. `getSessionUser(D) === null` → la mutation revocó también la otra sesión.

### Cobertura preexistente que no debe romper
- `password-reset*.spec.ts` verde tras el refactor de `resetPasswordWithTicket` (comportamiento
  idéntico). `session-cookie.spec.ts` (logout de una sola sesión) intacto.
- Registrar `session-revoke-all.spec.ts` en `chromium-secrets.testMatch` de `playwright.config.ts`.

### Resto
- `npm run lint`, `npm run build`, suite e2e completa. Igualdad byte-a-byte CODIGO ↔ repo.

## Despliegue

**Toca `convex/`** (nueva mutation + helper + `testInsertSession` + refactor) → **REQUIERE despliegue
de Convex a prod**. El cambio es **puramente aditivo y retrocompatible**: añade funciones nuevas y
refactoriza `resetPasswordWithTicket` sin cambiar su comportamiento; el frontend actual en prod **no**
llama a `logoutAllSessions`. Por eso es seguro **desplegar Convex ANTES del merge** (fase *expand*):
la mutation existe en prod antes de que Railway publique el frontend que la usa. Técnica del runbook
`PLANS/RUNBOOK-DESPLIEGUE-CONVEX-PROD.md` (deploy-token; auth personal con
`env -u CONVEX_DEPLOY_KEY -u CONVEX_DEPLOYMENT_TOKEN` para crear/borrar el token).

## Gate (metodología estricta, orden de despliegue corregido — M3)

Este plan **NO** autoriza instalar/mergear/desplegar. Flujo:

1. Código (effort **high**) → entrega autocontenida en `CODIGO/MIS-298-sessions/` (contenido literal
   de novedades + **diffs `diff -u` completos**, sin condensar; manifiesto y evidencia reproducible).
2. **Auditoría de código externa** (GO/NO-GO).
3. Instalar byte-idéntico → `lint` 0 err / `build` OK / suite e2e verde (foco: `session-revoke-all`).
4. PR (permiso antes del push) → **CI verde**.
5. **Deploy de Convex a prod desde la rama** (confirmación explícita antes; retrocompatible) →
   **verificar que `logoutAllSessions` está disponible en prod** antes de continuar.
6. Merge (asistente, con permiso) → Railway auto-despliega el frontend (que ya encuentra la mutation
   viva en prod).
7. Smoke completo en prod: login → abrir 2 sesiones → pulsar el botón → la otra sesión deja de valer →
   cerrar MIS-298.

## Nota de seguridad
`logoutAllSessions` es pública y solo protegida por el token vigente (mismo criterio que `logout`). Un
atacante que ya tuviera el token httpOnly de la víctima podría desloguearla en todas partes — pero
tener ese token ya implica compromiso de la cuenta; riesgo marginal nulo, coincide con `logout`. No se
loguea ningún token ni hash. (Baja documentada: "todas" = las sesiones existentes en el instante de la
transacción de revocación; una sesión creada legítimamente después no está incluida — sin problema
práctico por el modelo transaccional de Convex.)

## Follow-ups (fuera de alcance)
Rotación de token / TTL deslizante; límite de concurrentes; posible pantalla de seguridad dedicada si
el botón no encaja en el header; métricas seguras de revocaciones (sin tokens/hashes).

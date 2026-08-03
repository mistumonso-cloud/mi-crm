# MIS-262 — Desplegar login con Google a producción

> **Estado**: Plan v3 — **GO** (ronda 2, tras aplicar las condiciones de la ronda 1; ver "Auditoría" abajo). Ejecución en curso.

## Contexto

MIS-260 (login con Google, conviviendo con el login por contraseña) está
implementado, auditado (2 rondas) y verificado en dev — PR #42 abierto,
todavía sin fusionar. MIS-261 (cerrado) puso el deployment de Convex de
producción (`greedy-tapir-20`) al día con `main`. Esta tarea es el
despliegue a producción de MIS-260: variables de entorno, deploy de Convex,
fusión del PR, y el mismo patch de email de Marta que ya se hizo en dev,
ahora en la tabla `users` de producción.

## Decisión de secuencia (para evitar una ventana rota)

Railway auto-despliega el frontend en cada push a `main`, pero Convex
necesita su propio `npx convex deploy` aparte (la causa exacta de MIS-261).
Si se fusionara el PR #42 primero, Railway pondría en producción el nuevo
frontend (botón "Entrar con Google", rutas `/api/auth/google/*`) **antes**
de que `loginWithGoogle` exista en Convex prod — cualquiera que pulsara el
botón en ese hueco vería un error de función inexistente.

**Orden elegido para evitar esa ventana (corregido tras auditoría, ver sección "Auditoría" abajo):**
1. Configurar las variables de entorno (Railway + Convex prod) — no dispara
   ningún deploy por sí solo si se usa `--skip-deploys` en Railway.
2. Crear el archivo desechable `convex/_patchMartaEmail.ts` (ver más abajo)
   **antes** del dry-run, para que la evidencia auditada del dry-run incluya
   exactamente lo mismo que se despliega de verdad.
3. `npx convex deploy --dry-run --verbose` desde la rama
   `feature/mis-260-login-google` — confirma sin cambios de índices/esquema/auth.
4. Deploy real de Convex a prod desde esa misma rama (antes de fusionar el
   PR) — sube `loginWithGoogle` y el patch mutation juntos, tal cual se
   auditó. En este punto el frontend en vivo (Railway) sigue siendo el
   viejo — sin botón de Google, así que no hay ningún cambio visible ni
   riesgo todavía.
5. Ejecutar el patch del email de Marta **ahora, antes de fusionar** — así
   nunca hay una ventana en la que el botón de Google ya esté visible en
   producción pero el email de Marta en la base de datos todavía no
   coincida con su cuenta de Google real.
6. Verificar, borrar el archivo desechable, redeploy de limpieza (mismo
   ciclo que en dev), y confirmar con `git status --short` que no queda
   nada del árbol de trabajo local antes de fusionar (ni
   `_patchMartaEmail.ts` ni cambios generados por `convex deploy`).
7. Fusionar el PR #42 → Railway despliega el frontend nuevo. Como Convex y
   los datos ya están listos desde los pasos 4-6, no hay ventana rota.
8. Verificación manual real.

## Variables de entorno

| Variable | Dónde | Valor |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Railway (prod) | Mismo que dev — es el mismo cliente OAuth de Google, ya registrado con las dos redirect URIs (dev y prod) |
| `GOOGLE_CLIENT_SECRET` | Railway (prod) | Mismo que dev, mismo motivo |
| `GOOGLE_OAUTH_REDIRECT_URI` | Railway (prod) | `https://mi-crm-production-b627.up.railway.app/api/auth/google/callback` (**distinto** del de dev — cada entorno con su propio valor fijo, ya registrado en Google Console) |
| `GOOGLE_LOGIN_SHARED_SECRET` | Railway (prod) **y** Convex prod (`npx convex env set --prod`) | **Nuevo, generado aparte — NO reutilizar el de dev.** Un secreto compartido entre dos entornos distintos es peor práctica que uno por entorno: si el de dev se filtrara, no debe comprometer prod y viceversa. |

`railway variable set` soporta `--skip-deploys` para fijar variables sin
disparar un build inmediato — se usa aquí porque el build real solo debe
pasar en el paso 7 (tras fusionar el PR), no antes.

## Deploy de Convex (pasos 2-4)

Desde la rama `feature/mis-260-login-google` (checkout local, sin fusionar
todavía): `npx convex deploy --typecheck disable` contra `greedy-tapir-20`,
mismo wrapper de pseudo-tty ya usado en MIS-261 para el prompt de
confirmación del CLI.

**Riesgo**: mismo tipo de cambio que MIS-261 (código de funciones nuevo,
`loginWithGoogle` + refactor de `login`/`createSession`) — sin cambios de
índices en el `schema.ts` (los archivos de MIS-260 no tocan `schema.ts`,
confirmado en `PLANS/MIS-260-login-google.md`, decisión 10: "Sin cambios en
`convex/schema.ts`"). Se confirma con `--dry-run --verbose` inmediatamente
antes, mismo procedimiento que MIS-261.

## Patch del email de Marta en prod (paso 5)

Mismo patrón que en dev (`convex/_patchMartaEmail.ts`, `internalMutation`
desechable, mismo estilo que `_precheck.ts` de MIS-7), esta vez apuntando a
`--prod`. **Reforzado tras auditoría** (ver "Auditoría" abajo) con dos
comprobaciones explícitas antes de tocar nada: que no exista ya ningún
usuario con el email nuevo (evita colisión/sobrescritura silenciosa), y que
la fila encontrada siga teniendo exactamente `name: "Marta"` y
`role: "supervisor"` (evita parchear una fila que no es la que se espera):

```ts
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

export const patchMartaEmail = internalMutation({
  args: {},
  returns: v.union(
    v.literal("patched"),
    v.literal("not_found"),
    v.literal("conflict_new_email_taken"),
    v.literal("unexpected_shape"),
  ),
  handler: async (ctx) => {
    const existingNewEmail = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", "mistumonso@gmail.com"))
      .unique();
    if (existingNewEmail) return "conflict_new_email_taken" as const;

    const marta = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", "marta@test.local"))
      .unique();
    if (!marta) return "not_found" as const;
    if (marta.name !== "Marta" || marta.role !== "supervisor") {
      return "unexpected_shape" as const;
    }

    await ctx.db.patch(marta._id, { email: "mistumonso@gmail.com" });
    return "patched" as const;
  },
});
```

Ejecutado con `npx convex run _patchMartaEmail:patchMartaEmail '{}' --prod`
(ya está desplegado por el paso 4 de deploy real, que sube todo `convex/` junto con
`loginWithGoogle`). Solo se continúa si el resultado es exactamente
`"patched"` — cualquier otro valor detiene el procedimiento para revisar a
mano. Verificado con `npx convex data users --prod`, borrado el archivo
después, y un deploy más para dejar limpio el deployment (mismo ciclo que
en dev) — todo esto **antes** de fusionar el PR (paso 7).

## Auditoría (ronda 1) — GO CONDICIONADO, aplicado en esta versión (v2)

| # | Hallazgo | Severidad | Resolución |
|---|---|---|---|
| 1 | El patch del email de Marta aparecía DESPUÉS de fusionar el PR — ventana en la que el botón de Google ya está visible en producción pero el email de Marta en la BD todavía no coincide con su cuenta real | Media | Reordenado: el patch (paso 5) ocurre justo después del deploy de Convex (paso 4) y antes de fusionar el PR (paso 7) |
| 2 | La mutation de patch no comprobaba colisión con el email nuevo ni que la fila encontrada siguiera siendo `name:"Marta"`/`role:"supervisor"` | Media | Añadidas ambas comprobaciones explícitas antes de `ctx.db.patch`, con valores de retorno distintos (`conflict_new_email_taken`, `unexpected_shape`) para poder distinguir el motivo si no continúa |
| 3 | `_patchMartaEmail.ts` debía existir ya durante el `--dry-run` que autoriza el deploy, para que la evidencia auditada coincida exactamente con lo que se despliega de verdad | Baja | Reordenado: el archivo se crea (paso 2) antes del dry-run (paso 3), no después |

## Fuera de alcance

- Cualquier cambio de código — ya está todo en MIS-260/PR #42, esta tarea es
  solo despliegue y configuración, sin `CODIGO/`.
- El usuario `Revisor` (`vibecodercrm.test`) en prod — no se toca, no
  investigado (deuda de MIS-261).
- Automatizar el deploy de Convex tras merge (CI-driven) — deuda
  identificada en MIS-261, no se resuelve aquí.

## Verificación

1. `npx convex deploy --dry-run --verbose` desde `feature/mis-260-login-google`, confirmar sin cambios de índices/esquema antes del deploy real (mismo patrón que MIS-261).
2. Tras el deploy de Convex (paso 4): `npx convex data users --prod` — las 3 filas actuales (Carlos, Marta con su email viejo todavía, Revisor) intactas.
3. Tras el patch (paso 5): `npx convex data users --prod` de nuevo — Marta con `mistumonso@gmail.com`, `name` sin cambios, Carlos y Revisor intactos.
4. Tras fusionar el PR y que Railway termine el deploy: comprobación manual real de la usuaria — entrar en `https://mi-crm-production-b627.up.railway.app/login` con la cuenta de Google `mistumonso@gmail.com` y confirmar que aterriza en `/panel` como Marta/supervisor.
5. Confirmar que el login por contraseña de Carlos en producción sigue funcionando igual (regresión cero).
6. Confirmar que `/ventas` y `/panel` (verificados en MIS-261) siguen funcionando tras este nuevo deploy.

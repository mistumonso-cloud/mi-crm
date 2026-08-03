# MIS-261 — Arreglar despliegue de Convex en producción (catch-up, sin cambios de esquema)

> **Estado**: Plan listo para auditoría — no se ha ejecutado ningún deploy real todavía, solo `--dry-run`.

## Contexto

Railway auto-despliega el frontend de Next.js en cada push a `main`, pero el deployment de Convex de producción (`greedy-tapir-20`) necesita un `npx convex deploy` manual aparte — y ese paso se ha "olvidado" 3 veces en el histórico de este proyecto (MIS-11, MIS-17, MIS-259), cada vez rompiendo una pantalla concreta en producción hasta que se detecta por un error real del usuario y se corrige a mano.

Estado confirmado ahora mismo contra `greedy-tapir-20` (comandos reales, no supuestos):
- `npx convex data users --prod`: 3 usuarios (Carlos, Marta con `marta@test.local` — sin tocar, correcto, eso es MIS-260/262 aparte —, y un usuario `Revisor` de `vibecodercrm.test` no documentado en memoria, probablemente de una revisión externa anterior; no se toca).
- `npx convex data --prod` (listado de tablas): existen las 8 tablas actuales (`contacts`, `loginAttempts`, `notes`, `reminders`, `saleClosures`, `sessions`, `statusChanges`, `users`) — los nombres de tabla están al día, la duda real es el código de las funciones, no el esquema de tablas.
- `contacts` en prod tiene al menos una fila real (`Jorge Antúnez`) — confirmado por la usuaria que es un contacto de prueba propio (no un cliente real), pero se trata igualmente como dato real a preservar: no se borra ni modifica nada de `contacts`/`notes`/`reminders`/`saleClosures` en esta tarea.

## Evidencia: `npx convex deploy --dry-run --verbose` desde `main` (commit `e4ac3f2`)

Ejecutado de verdad (vía wrapper de pseudo-tty para el prompt de confirmación del CLI, técnica ya documentada — `--dry-run` garantiza que no se aplica nada aunque se confirme el prompt). Resultado relevant:

```
"schemaChange": {
  "indexDiffs": {
    "": {
      "added_indexes": [],
      "removed_indexes": [],
      "enabled_indexes": [],
      "disabled_indexes": []
    }
  }
},
"authDiff": { "added": [], "removed": [] },
"definitionDiffs": {},
"componentDiffs": {}
```

**Lectura**: cero cambios de índices, cero cambios de esquema, cero cambios de auth config. El único cambio real es de código de funciones — el árbol de funciones que se desplegaría incluye `sales.js:registerDirectSale` (la función que falta desde MIS-259) y confirma que el resto (`contacts.js`, `notes.js`, `reminders.js`, `auth.js`, `lib/*`) coincide con lo ya commiteado en `main`. Único aviso no relacionado con datos: "Change the server's version for Node.js actions" (bump de versión de runtime, no de nuestro código).

**Conclusión de riesgo**: bajo. No hay migración de esquema que pueda chocar con las filas ya existentes en `contacts`/`notes`/`reminders`/`saleClosures`/`users`/`sessions`. Es un despliegue de código de funciones, equivalente a lo que ya se hizo sin incidentes en MIS-11/17/259 en su momento (el problema histórico nunca fue que el deploy fallara o corrompiera datos — fue que **no se ejecutaba**).

## Procedimiento

1. Desde `main` (no desde ninguna rama de feature — así no se mezcla este catch-up con MIS-260, que se despliega aparte y después): `npx convex deploy --typecheck disable` (sin `--dry-run`), vía el wrapper de pseudo-tty ya documentado para el prompt de confirmación: `printf 'y\n' | script -qec "npx convex deploy --typecheck disable" /tmp/deploy.log`.
2. Verificar inmediatamente después: `npx convex data users --prod` (confirmar que las 3 filas siguen intactas, ninguna se pierde) y una comprobación funcional real en el sitio de producción (`https://mi-crm-production-b627.up.railway.app`) — abrir `/ventas` y confirmar que ya no da el error que llevaba desde MIS-259.
3. Actualizar esta misma tabla de estado en `PLANS/README.md`/`CODIGO/README.md` no aplica (no hay `CODIGO/` para este ticket — es una operación, no código nuevo).

## Fuera de alcance

- El login con Google (MIS-260): se despliega a producción en un ticket aparte, después de este, con su propio plan (variables de entorno de Google en Railway + Convex, patch del email de Marta en prod).
- Cualquier limpieza de `contacts`/datos de prueba en prod (el contacto "Jorge Antúnez" no se toca).
- Resolver de raíz el "por qué se olvida el deploy" (¿CI-driven deploy? ¿hook post-merge?) — la usuaria ya mencionó en una sesión anterior que quiere cambiar este flujo pero sin concretar aún cómo; no se decide aquí, se deja para cuando lo concrete.

## Verificación

1. `npx convex deploy --dry-run --verbose` ya ejecutado — evidencia arriba, sin sorpresas.
2. Tras el deploy real: `npx convex data users --prod` con las mismas 3 filas de antes (sin pérdida de datos).
3. Comprobación manual en `https://mi-crm-production-b627.up.railway.app/ventas` — la pantalla debe cargar y "Registrar venta directa" debe funcionar sin el error de función inexistente.
4. Confirmar que `/panel` y el resto de pantallas siguen funcionando igual (regresión cero en lo que ya funcionaba).

## Resultado real (ejecutado)

Auditoría del plan: **GO CONDICIONADO** — condiciones (main en `e4ac3f2`, sin diffs locales, dry-run repetido justo antes, target = `greedy-tapir-20`) verificadas y confirmadas antes del deploy real.

Deploy ejecutado con `npx convex deploy --typecheck disable` (vía wrapper de pseudo-tty): `✔ No indexes are deleted by this push`, `✔ Deployed Convex functions to https://greedy-tapir-20.eu-west-1.convex.cloud`.

Verificación post-deploy:
- `npx convex data users --prod`: las mismas 3 filas de antes (Carlos, Marta, Revisor), mismos `_id` — sin pérdida de datos.
- `https://mi-crm-production-b627.up.railway.app`: `/login` → 200, `/ventas` y `/panel` → 307 (redirigen a login sin sesión, comportamiento normal, sin error 500).
- **Pendiente de la usuaria**: confirmar manualmente, con sesión real, que "Registrar venta directa" funciona en `/ventas` — no verificable por el agente sin credenciales reales de producción.

## Estado

**Deploy real ejecutado y verificado** (datos intactos, sitio operativo). Pendiente solo de la confirmación manual funcional de la usuaria en `/ventas`.

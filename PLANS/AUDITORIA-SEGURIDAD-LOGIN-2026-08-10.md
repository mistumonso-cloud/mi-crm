# Auditoría de seguridad — sistema de login

**Fecha:** 2026-08-10
**Alcance (exclusivo):** login con email+contraseña, login con Google (OAuth), y recuperación de contraseña por código (OTP).
**Modo:** solo lectura. No se ha modificado ni desplegado nada.
**Commit auditado:** `2523b3b` (main, árbol limpio).

## Superficie revisada

| Área | Ficheros |
|---|---|
| Login password | `convex/auth.ts`, `convex/lib/password.ts`, `convex/lib/session.ts`, `convex/lib/token.ts`, `convex/lib/rateLimit.ts`, `src/lib/auth/actions.ts`, `src/app/(auth)/login/*` |
| Login Google | `convex/auth.ts::loginWithGoogle`, `src/lib/auth/google.ts`, `src/app/api/auth/google/start/route.ts`, `src/app/api/auth/google/callback/route.ts` |
| Recuperación OTP | `convex/passwordReset.ts`, `convex/lib/resend.ts`, `convex/lib/testIdentity.ts`, `convex/testSupport.ts`, `src/app/(auth)/recuperar-contrasena/*` |
| Sesión / transporte | `src/lib/auth/cookie.ts`, `src/lib/auth/dal.ts`, `src/lib/auth/constants.ts`, `src/proxy.ts`, `convex/schema.ts`, `next.config.ts` |

## Resumen ejecutivo

La base criptográfica y el diseño anti-enumeración están **bien hechos** — mejor que la media de un MVP. No he encontrado ningún *bypass* de autenticación, ni fuga de `passwordHash`, ni el token de sesión cruzando al navegador, ni open redirect, ni fallo en el flujo OAuth.

Los problemas reales están concentrados en un sitio: **el rate limiting no resiste a un atacante**, porque el único identificador de origen (`ipHint`) es un dato que elige el cliente, no una IP observada por el servidor. De ahí salen los tres hallazgos altos, y todos son de **denegación de servicio y coste**, no de robo de credenciales.

| Severidad | Nº |
|---|---|
| Alto | 3 |
| Medio | 5 |
| Bajo | 12 |

---

## ALTO

### A1 — El rate limiting por IP es evadible y además sirve para bloquear a terceros

`convex/lib/rateLimit.ts:16-24`, `convex/auth.ts:38,46`, `convex/passwordReset.ts:56,172`, `src/lib/auth/actions.ts:18,56,69`

La IP no se observa: se recibe como argumento `ipHint` de la mutation. Dos caminos independientes lo rompen:

1. **Llamada directa a Convex.** Las mutations `login`, `requestPasswordResetCode` y `verifyResetCode` son públicas y `NEXT_PUBLIC_CONVEX_URL` está en el bundle JS. Un atacante llama a Convex sin pasar por Next.js y **omite o falsifica `ipHint`** a voluntad. Es el mismo razonamiento que el propio código documenta para justificar `serverKey` en `loginWithGoogle` (`convex/auth.ts:129-137`) — pero no se aplicó al `ipHint`.
2. **Incluso pasando por Next.js.** `normalizeIpHint` toma `x-forwarded-for.split(",")[0]`, es decir el valor **más a la izquierda**. Ese es exactamente el que inyecta el cliente: Cloudflare y Railway *añaden* la IP real al final de la cadena, no la sustituyen. El comentario del código ("la más cercana al cliente real cuando se confía en el proxy de la plataforma") tiene el criterio invertido.

Consecuencias:

- La capa de límite por IP (`ip:`, `resetip:`) **no limita absolutamente nada**: basta rotar el valor.
- Al revés, es un arma: 20 intentos fallidos con `ipHint: "<IP de la oficina>"` **bloquean esa IP durante 1 hora** para todo el mundo (`IP_RATE_LIMIT`, `convex/lib/rateLimit.ts:41-45`). Aplica igual al flujo de recuperación vía `resetip:`.

Con esto caído, el único freno real que queda es el contador por email — que es el hallazgo A2.

### A2 — El bloqueo por email permite mantener a Carlos o Marta fuera del CRM indefinidamente

`convex/lib/rateLimit.ts:33-37`, `convex/auth.ts:51-53`

5 fallos en 15 minutos bloquean la cuenta 15 minutos. Los emails de los dos únicos usuarios son conocidos o adivinables. Una petición cada 15 minutos —trivial de automatizar, y con A1 sin ningún coste ni traza de origen— mantiene la cuenta bloqueada de forma permanente.

Mitigación parcial existente: `loginWithGoogle` no consulta el bloqueo, así que quien tenga Google vinculado puede entrar igual. No hay ninguna alerta ni registro que avise de que esto está pasando.

### A3 — Agotamiento de CPU y facturación vía PBKDF2 sin freno previo

`convex/auth.ts:63`, `convex/lib/password.ts:9,63-73`

`login` ejecuta **siempre** 600.000 iteraciones de PBKDF2 — también cuando el email no existe, a propósito, contra el hash señuelo (mitigación de timing, correcta en sí misma).

El problema es que lo único que puede impedir esa ejecución es el candado por email, y **un email distinto en cada petición estrena candado**. Con la capa de IP inservible (A1), un atacante genera carga de CPU arbitraria en el deployment de Convex a coste casi cero para él: latencia degradada para los usuarios reales y consumo de cuota/facturación.

La defensa anti-timing es la correcta; lo que falta es un límite global previo que no dependa de un identificador que elige el atacante.

---

## MEDIO

### M1 — `login` no acota la longitud del email antes de usarlo como clave de rate limit

`convex/auth.ts:45` vs. `convex/passwordReset.ts:37-39,53,167-169`

`convex/passwordReset.ts` sí valida (`emailWithinLimits`, ≤254 caracteres) **antes** de tocar el rate limit; el comentario del código deja claro que fue un hallazgo de auditoría previa (M13) corregido en dos rondas. **`convex/auth.ts::login` quedó fuera de esa corrección**: `normalizeEmailKey(args.email)` no tiene cota y el resultado se escribe tal cual en `loginAttempts.emailKey`, que además está indexado (`convex/schema.ts:225-232`).

Es la misma amplificación de escritura que M13 cerró en el otro módulo, todavía abierta aquí.

### M2 — Ninguna cabecera de seguridad: `/login` es embebible en un iframe

`next.config.ts` (vacío)

No hay `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options` / `frame-ancestors`, `Referrer-Policy` ni `Permissions-Policy`.

- **Clickjacking**: `/login` y `/recuperar-contrasena` se pueden embeber en un sitio de terceros y superponer con una interfaz falsa — sobre el formulario de credenciales y sobre el paso de introducción del código OTP.
- **Sin CSP**, cualquier XSS futuro tiene impacto máximo.
- **Sin HSTS**, un primer acceso por HTTP es interceptable (relacionado con M5).

### M3 — El ticket de reseteo es un bearer token que vive en el navegador

`convex/passwordReset.ts:217-225`, `src/lib/auth/actions.ts:76,86`, `src/app/(auth)/recuperar-contrasena/RecoverForm.tsx:23,128`

`verifyResetCode` devuelve el ticket al cliente; `RecoverForm` lo guarda en estado React y lo pinta en un `<input type="hidden">`, y viaja en el payload RSC.

Es una credencial de 15 minutos que autoriza cambiar la contraseña de la cuenta, y **no está ligada al navegador ni a la sesión**: quien la tenga, la usa. A diferencia del token de sesión —que sí está correctamente en cookie `httpOnly` y nunca cruza al cliente (verificado)—, este queda expuesto a cualquier XSS, a extensiones y al historial del DOM. El sitio natural es una cookie `httpOnly` con `path` acotado al flujo.

### M4 — Un reseteo de contraseña no notifica al usuario

`convex/passwordReset.ts:231-263`

`resetPasswordWithTicket` cambia el hash e invalida todas las sesiones —ambas cosas correctas y atómicas—, pero **no envía ningún email de aviso**. El usuario legítimo no tiene forma de enterarse de que su contraseña ha sido cambiada.

El email del código sí dice "si no has sido tú, ignora este correo", pero eso sólo cubre el caso en que el ataque *no* prospera. Si prospera, no hay ninguna señal.

### M5 — Verificar el modo TLS de Cloudflare hacia el origen (no verificable en solo lectura)

Según las notas del proyecto, `mistu-monso.com` está en Cloudflare proxied con **SSL en modo "Full"**. En "Full", Cloudflare acepta *cualquier* certificado del origen, incluido uno autofirmado o suplantado — un atacante en el tramo Cloudflare↔Railway puede interceptar credenciales en claro. Lo correcto es **"Full (strict)"**.

No he podido confirmarlo desde el repositorio; queda como punto a verificar en el panel de Cloudflare. Va acompañado de la ausencia de HSTS (M2).

---

## BAJO

| # | Hallazgo | Ubicación |
|---|---|---|
| B1 | `secure` de la cookie de sesión depende de `NODE_ENV === "production"`. Cualquier despliegue no-local con otro `NODE_ENV` serviría la cookie sin `Secure`. Debería ser incondicional salvo en localhost. | `src/lib/auth/cookie.ts:12,23` |
| B2 | Sin prefijo `__Host-` en la cookie de sesión. Un subdominio de `mistu-monso.com` (hoy inexistente, mañana quizá no) podría fijar `session` en el navegador de la víctima → *session fixation*. | `src/lib/auth/constants.ts:4` |
| B3 | Sesión de 30 días fija, sin rotación, sin "cerrar sesión en todos los dispositivos", sin límite de sesiones concurrentes y sin re-autenticación para acciones sensibles. Un token robado vale un mes. | `src/lib/auth/cookie.ts:4`, `convex/lib/session.ts:8` |
| B4 | Política de contraseña sólo por longitud (8–128). Sin comprobación contra contraseñas filtradas ni bloqueo de las más comunes: `"12345678"` es aceptada. | `convex/passwordReset.ts:238`, `src/lib/auth/actions.ts:93` |
| B5 | `verifyPassword` lee el número de iteraciones del hash almacenado (`i=`) sin cota superior. Hoy no es alcanzable (todos los hashes los genera el servidor), pero un valor como `i=100000000` colgaría la mutation. Defensa en profundidad barata. | `convex/lib/password.ts:68` |
| B6 | Sin PKCE en el flujo OAuth. Cliente confidencial con intercambio server-side, así que el riesgo real es bajo, pero `code_challenge` es coste cero y es lo esperado hoy. | `src/lib/auth/google.ts:38-51` |
| B7 | El error de bloqueo (`LOCKED_ERROR`) se distingue del genérico y se devuelve **sin ejecutar PBKDF2** → oráculo por respuesta *y* por tiempo de "esta cuenta está bloqueada ahora mismo". Fuga menor, pero rompe parcialmente el criterio anti-enumeración que el resto del módulo cuida con esmero. | `convex/auth.ts:48-53` |
| B8 | `serverActions.allowedOrigins` no está configurado. Next.js hace la comprobación Origin/Host por defecto y falla cerrado, pero detrás de Cloudflare+Railway conviene declararlo explícitamente en vez de depender de la reescritura de `X-Forwarded-Host`. | `next.config.ts` |
| B9 | El harness de pruebas (`convex/testSupport.ts`) se despliega a producción con 4 funciones **públicas**. **Verificado en esta auditoría: `E2E_TEST_SUPPORT_KEY` NO existe en el entorno de Convex de producción**, así que están inertes — el *fail-closed* funciona como se diseñó. El riesgo residual es de configuración: si alguien setea esa variable en prod, `resetTestIdentity` reescribe un usuario y `getLastResetCode` devuelve códigos OTP en claro. | `convex/testSupport.ts:39-48,80,131` |
| B10 | Bombardeo de emails de recuperación: 5 por email cada 15 min, y la capa IP no cuenta (A1) → 20 emails/hora a una víctima de forma indefinida, sin CAPTCHA. Molestia para el usuario y consumo de cuota de Resend. | `convex/passwordReset.ts:58-70` |
| B11 | El job `e2e` de CI expone `GOOGLE_CLIENT_SECRET`, `GOOGLE_LOGIN_SHARED_SECRET` y `E2E_TEST_SUPPORT_KEY` a un workflow que se ejecuta **desde la rama del PR**. Con un solo mantenedor no es explotable; cualquier colaborador futuro con permiso de push podría exfiltrarlos modificando el workflow en su propio PR. | `.github/workflows/ci.yml:38-48` |
| B12 | `normalizeEmailKey` sólo hace `trim` + `toLowerCase`, sin normalización Unicode ni de dominio. Con alta manual de usuarios no es explotable hoy; lo sería si el alta se abriera. | `convex/lib/rateLimit.ts:3-5` |

---

## Lo que está bien (y conviene no romper al arreglar lo demás)

- **Hashing de contraseñas**: PBKDF2-HMAC-SHA256, 600.000 iteraciones (recomendación OWASP vigente), salt de 16 bytes por fila, formato versionado con los parámetros embebidos → migrable sin romper logins.
- **Comparación en tiempo constante** en los tres sitios donde importa: contraseña, `serverKey` de Google y hash del código OTP.
- **Token de sesión**: 256 bits de entropía, en base de datos **sólo el SHA-256**, cookie `httpOnly` + `SameSite=Lax` + `path=/` explícito.
- **El token de sesión nunca cruza al navegador.** Verificado fichero a fichero: sólo se usa en Server Components y Server Actions; ningún componente `"use client"` lo recibe como prop. Es un punto que se rompe con facilidad y aquí está intacto.
- **Anti-enumeración sólida**: en `login`, hash señuelo real para igualar el coste; en el flujo de recuperación, `requestPasswordResetCode` **ni siquiera consulta `users`** y difiere todo el trabajo al scheduler, así que el tiempo de respuesta es idéntico exista o no la cuenta. Es un diseño mejor que el habitual.
- **OAuth**: `state` de 256 bits en cookie `httpOnly` efímera (10 min) con `path` acotado a `/api/auth/google`, comparado y **borrado siempre**, con o sin éxito. Email verificado contra el endpoint `userinfo` de Google con un `access_token` obtenido por intercambio server-side con el `client_secret`. Un único mensaje de error genérico para cualquier fallo, con el motivo real sólo en logs de servidor.
- **`loginWithGoogle`** protegida por secreto compartido comparado en tiempo constante y *fail-closed*, y **nunca da de alta usuarios**: sólo autentica a quien ya existe.
- **Flujo OTP**: código de 6 dígitos con *rejection sampling* (sin sesgo), sólo el hash en base de datos, TTL 15 min, un solo uso, 5 intentos máximo, códigos anteriores invalidados al pedir uno nuevo, y **destrucción de todas las sesiones del usuario** al cambiar la contraseña, atómicamente en la misma mutation.
- **Validadores `returns`** en las queries que hacen *estructuralmente imposible* filtrar `passwordHash`.
- **Plantilla de email** con escapado HTML del nombre; los errores de Resend se registran sin código, sin destinatario y sin cuerpo.
- **Sin open redirects** en ningún punto de los tres flujos.
- **Autorización coherente**: toda función sensible de Convex pasa por `requireUser`, y todas las páginas protegidas llaman a `getUser()`. `src/proxy.ts` es explícitamente un check optimista y está documentado como tal.
- **Sin secretos en el repositorio ni en el historial de git**: sólo ficheros `.example`, y `.gitignore` cubre `.env*` correctamente.

---

## Orden sugerido para el plan de corrección

No es el plan — es la lectura de dependencias que propongo para hacerlo.

1. **A1 primero.** Es la raíz: mientras el origen lo elija el cliente, A2 y A3 no tienen arreglo real. Implica decidir cómo obtener una IP de confianza (cabecera del proxy correcta, o el valor derecho de `x-forwarded-for` contando saltos conocidos) y **cómo impedir que las mutations acepten un `ipHint` arbitrario** desde llamadas directas a Convex.
2. **A2 y A3** encima de A1, más un límite global que no dependa del email.
3. **M2** (cabeceras) es la corrección de mejor relación impacto/esfuerzo del informe: unas pocas líneas en `next.config.ts`.
4. **M1, M4, M3** en ese orden de esfuerzo creciente.
5. **M5** es verificación en el panel de Cloudflare, no código.
6. Los BAJO, agrupados: B1+B2 juntos (cookie), B4+B5 juntos (contraseña), el resto sueltos.

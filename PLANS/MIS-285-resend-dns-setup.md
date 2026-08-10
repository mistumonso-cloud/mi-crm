# MIS-285 · Fase 1 — Verificación del dominio en Resend (DNS en Cloudflare)

> Guía de configuración (no toca código). Objetivo: dejar `mistu-monso.com` **verificado en Resend** para poder enviar emails transaccionales (recuperación de contraseña).
>
> Ticket: [MIS-285](https://linear.app/mistu-monso/issue/MIS-285/email-transaccional-con-resend-recuperacion-de-contrasena)
> Docs Resend: https://resend.com/docs/dashboard/domains/introduction

---

## ✅ Estado: registros DNS creados (2026-08-09)

Los 4 registros se añadieron **vía la API de Cloudflare** (token con permiso *Edit zone DNS*, no manualmente) y están verificados en los dos nameservers autoritativos (`milan` / `angela.ns.cloudflare.com`):

| Registro | Estado | ID en Cloudflare |
|---|---|---|
| TXT `resend._domainkey` (DKIM) | ✅ activo | `be03e8ac40c3726bafd72e22db7efae6` |
| MX `send` (prio 10) | ✅ activo | `4287aaa75083525bc740b8219eb8c084` |
| TXT `send` (SPF) | ✅ activo | `6491a0078cbf842de50435bc312a4729` |
| TXT `_dmarc` (DMARC) | ✅ activo | `80970fef2d6dacc2b206eb34aa73c5b1` |

**Dominio verificado en Resend el 2026-08-09** (confirmado por el usuario en el panel de Resend). Fase 1 **cerrada**. → Siguiente: fase 2 (código), ver `PLANS/MIS-285-recuperacion-contrasena-plan.md`.

> Nota: la `RESEND_API_KEY` disponible es de tipo *"Sending access"* (solo envío). No permite gestionar/verificar dominios por API (`403 code 1010`), por eso la verificación se hizo desde el panel. Para el código solo hace falta permiso de envío.

> La guía manual de más abajo se conserva como referencia (no hace falta seguirla: ya está hecho por API).

---

## Proveedor de DNS: Cloudflare (confirmado)

Los nameservers de `mistu-monso.com` son de Cloudflare:

```
milan.ns.cloudflare.com
angela.ns.cloudflare.com
```

Así que **todos los registros se añaden en el panel de Cloudflare** → tu dominio → **DNS → Records**.

## Comprobación de conflictos: NINGUNO

Reconocimiento hecho el 2026-08-09 con `dig`. Los nombres donde Resend quiere escribir están **vacíos** hoy:

| Registro que pide Resend | ¿Existe ya algo ahí? |
|---|---|
| `MX` en la raíz | vacío |
| `TXT`/SPF en la raíz | vacío |
| `TXT` en `_dmarc` | vacío |
| `TXT` en `resend._domainkey` (DKIM) | vacío |
| `MX` / `TXT` en `send` | vacíos |

→ **Se pueden añadir los 4 registros tal cual, sin pisar ni tocar nada existente.** El registro `A` de la raíz (que sirve la web vía Cloudflare proxy) es independiente del email; no se toca.

---

## Los 4 registros a añadir (valores EXACTOS para Cloudflare)

> ⚠️ **Detalle importante de Cloudflare:** en el campo **Name**, Cloudflare **añade solo** `.mistu-monso.com`. Escribe el nombre **corto** (`resend._domainkey`, `send`, `_dmarc`). Si escribes el dominio completo, quedará duplicado (`resend._domainkey.mistu-monso.com.mistu-monso.com`).
>
> ⚠️ **No pongas comillas** alrededor de los valores TXT: Cloudflare las añade solo. Pega el texto tal cual.
>
> ⚠️ MX y TXT en Cloudflare **no se proxyan** (no hay nube naranja); es correcto, déjalos como están.

### 1) DKIM — TXT

| Campo | Valor |
|---|---|
| **Type** | `TXT` |
| **Name** | `resend._domainkey` |
| **Content** | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC/W6MPLukrCCS2Qn+S00CcwqjEgnxAk9eZfBMLlblF3ddQDBv6TiTp0WmkbZxGlMZptr1Dwom2AkvDGA4aT+DWYVrwG5Ek0lI5aFKYMDhfN5mYrmfWE1JlFKL8iRRJQoWFJJ3vJ+HGLHO1nGfSTTRb8NnL2QgQV71WLuYFq015YQIDAQAB` |
| **TTL** | Auto |

### 2) SPF — MX (subdominio `send`)

| Campo | Valor |
|---|---|
| **Type** | `MX` |
| **Name** | `send` |
| **Mail server** | `feedback-smtp.eu-west-1.amazonses.com` |
| **Priority** | `10` |
| **TTL** | Auto |

### 3) SPF — TXT (subdominio `send`)

| Campo | Valor |
|---|---|
| **Type** | `TXT` |
| **Name** | `send` |
| **Content** | `v=spf1 include:amazonses.com ~all` |
| **TTL** | Auto |

### 4) DMARC — TXT (recomendado)

| Campo | Valor |
|---|---|
| **Type** | `TXT` |
| **Name** | `_dmarc` |
| **Content** | `v=DMARC1; p=none;` |
| **TTL** | Auto |

---

## Pasos en Cloudflare (uno a uno)

1. Entra en **dash.cloudflare.com** → selecciona **mistu-monso.com**.
2. Menú lateral → **DNS** → **Records**.
3. **Add record** → rellena el registro **1 (DKIM)** con los valores de arriba → **Save**.
4. Repite **Add record** para el **2 (MX send)**, el **3 (TXT send)** y el **4 (DMARC)**.
5. Comprueba que quedan 4 registros nuevos: 1×MX (`send`) y 3×TXT (`resend._domainkey`, `send`, `_dmarc`).

## Verificar en Resend

6. Espera 1–5 min (Cloudflare propaga muy rápido).
7. Vuelve a **Resend → Domains → mistu-monso.com** y pulsa **Verify**.
8. Los tres bloques (DKIM, SPF, DMARC) deben pasar a **verificado/verde**. Si alguno sigue en “pending”, espera unos minutos más y reintenta.

## Comprobación por tu cuenta (opcional, con `dig`)

```bash
dig +short TXT resend._domainkey.mistu-monso.com   # debe devolver el p=MIGf...
dig +short MX  send.mistu-monso.com                # feedback-smtp.eu-west-1.amazonses.com (prio 10)
dig +short TXT send.mistu-monso.com                # v=spf1 include:amazonses.com ~all
dig +short TXT _dmarc.mistu-monso.com              # v=DMARC1; p=none;
```

---

## Notas

- **Remitente de los emails:** una vez verificado el dominio raíz, podremos enviar desde `no-reply@mistu-monso.com` (u otra dirección `@mistu-monso.com`). El subdominio `send` es solo el *Return-Path* / rebotes (bounces) que usa Amazon SES por debajo; no es la dirección visible.
- **DMARC `p=none`** es solo monitorización (no bloquea nada). Es el punto de partida recomendado; más adelante se puede endurecer a `quarantine`/`reject` si interesa.
- **Clave API de Resend:** cuando lleguemos al código (fase 2), la API key va en **variables de entorno** (Convex + Railway), **nunca** commiteada al repo.
- **RGPD:** Resend usa Amazon SES en `eu-west-1` (UE) → reflejar el proveedor como encargado del tratamiento en la política de privacidad.

## Siguiente paso (fase 2)

Con el dominio verificado, el siguiente paso es el **plan de implementación** del flujo de recuperación de contraseña (integración de Resend en Convex + pantallas + plantilla de email) en `PLANS/`, que pasará por el **gate de GO** antes de tocar código.

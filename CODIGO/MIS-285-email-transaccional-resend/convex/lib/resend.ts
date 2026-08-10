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

import { Resend } from "resend";

const FROM_DOMAIN = process.env.EMAIL_FROM_DOMAIN || "yeyo.dev";
const FROM_EMAIL = `notificaciones@${FROM_DOMAIN}`;

let resend: Resend | null = null;

/** El envío de correo es opcional: sin API key la app funciona, solo no notifica. */
export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

function getClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (!resend) {
    resend = new Resend(apiKey);
  }
  return resend;
}

/**
 * Envuelve el envío para que una caída del proveedor de correo nunca haga fallar
 * la operación de negocio que lo disparó. Devuelve si se llegó a enviar.
 */
async function send(payload: Parameters<Resend["emails"]["send"]>[0]): Promise<boolean> {
  const client = getClient();
  if (!client) {
    console.warn("[Email] RESEND_API_KEY sin configurar: se omite el envío.");
    return false;
  }
  try {
    await client.emails.send(payload);
    return true;
  } catch (error) {
    console.error("[Email] Fallo al enviar:", error instanceof Error ? error.message : error);
    return false;
  }
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export interface MaintenanceMovementEmail {
  recipients: string[];
  action: string;
  actorName: string;
  actorEmail: string;
  actorRole: string;
  equipmentName: string;
  branchName: string;
  occurredAt: Date;
  details: Array<{ label: string; value: unknown }>;
  equipmentUrl: string;
}

export async function sendMaintenanceMovementEmail(data: MaintenanceMovementEmail) {
  const recipients = Array.from(new Set(data.recipients.map((email) => email.trim().toLowerCase()).filter(Boolean)));
  if (!recipients.length) return;

  const detailRows = data.details
    .filter((detail) => detail.value !== undefined && detail.value !== null && detail.value !== "")
    .map((detail) => `
      <tr>
        <td style="padding: 9px 12px; color: #CC5803; font-size: 12px; font-weight: 700; vertical-align: top;">${escapeHtml(detail.label)}</td>
        <td style="padding: 9px 12px; color: #2A2522; font-size: 13px; line-height: 1.45;">${escapeHtml(detail.value)}</td>
      </tr>`)
    .join("");

  return send({
    from: `Allio Mantenimiento <${FROM_EMAIL}>`,
    to: recipients,
    subject: `${data.action} · ${data.equipmentName}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"></head>
      <body style="font-family: Inter, Arial, sans-serif; background: #FFF6EE; margin: 0; padding: 24px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr><td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="max-width: 100%; background: #ffffff; border-radius: 20px; overflow: hidden;">
              <tr><td style="padding: 28px 32px; background: #2A2522;">
                <p style="margin: 0 0 7px; color: #FFF6EE; font-size: 12px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase;">Movimiento de mantenimiento</p>
                <h1 style="margin: 0; color: #ffffff; font-size: 22px;">${escapeHtml(data.action)}</h1>
              </td></tr>
              <tr><td style="padding: 28px 32px;">
                <h2 style="margin: 0 0 6px; color: #2A2522; font-size: 19px;">${escapeHtml(data.equipmentName)}</h2>
                <p style="margin: 0 0 22px; color: #CC5803; font-size: 13px;">${escapeHtml(data.branchName)} · ${escapeHtml(data.occurredAt.toLocaleString("es-EC", { timeZone: "America/Guayaquil" }))}</p>
                <div style="padding: 14px 16px; background: #FFF6EE; border-radius: 14px; margin-bottom: 20px;">
                  <strong style="display: block; color: #2A2522; font-size: 14px;">Registrado por ${escapeHtml(data.actorName)}</strong>
                  <span style="color: #CC5803; font-size: 12px;">${escapeHtml(data.actorEmail)} · ${escapeHtml(data.actorRole)}</span>
                </div>
                <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid rgba(47,36,58,0.09); border-radius: 12px; overflow: hidden;">
                  ${detailRows}
                </table>
                <a href="${escapeHtml(data.equipmentUrl)}" style="display: inline-block; margin-top: 22px; padding: 12px 20px; border-radius: 12px; background: #CC5803; color: #ffffff; text-decoration: none; font-size: 13px; font-weight: 800;">Ver ficha e historial</a>
              </td></tr>
            </table>
          </td></tr>
        </table>
      </body>
      </html>`,
  });
}

export async function sendVerificationCode(to: string, name: string, code: string) {
  try {
    return send({
      from: `Allio <${FROM_EMAIL}>`,
      to,
      subject: "Tu código de verificación · Allio",
      html: `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"></head>
        <body style="font-family: 'Inter', system-ui, sans-serif; background: #FFF6EE; margin: 0; padding: 0;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td align="center" style="padding: 40px 16px;">
                <table width="480" cellpadding="0" cellspacing="0" style="background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.06);">
                  <tr>
                    <td style="background: linear-gradient(135deg, #CC5803, #D9803E); padding: 32px; text-align: center;">
                      <h1 style="color: #ffffff; font-size: 24px; margin: 0;">Allio</h1>
                      <p style="color: rgba(255,255,255,0.85); font-size: 14px; margin: 8px 0 0;">Verifica tu correo electrónico</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 32px; text-align: center;">
                      <h2 style="color: #2A2522; font-size: 20px; margin: 0 0 12px;">¡Hola ${name}!</h2>
                      <p style="color: #6b7f8b; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">
                        Usa el siguiente código para verificar tu cuenta:
                      </p>
                      <div style="background: #FFF6EE; border-radius: 12px; padding: 20px; margin: 0 0 24px; letter-spacing: 8px; font-size: 32px; font-weight: 800; color: #CC5803; font-family: monospace;">
                        ${code}
                      </div>
                      <p style="color: #6b7f8b; font-size: 12px; line-height: 1.5; margin: 0;">
                        Este código expira en 10 minutos.<br>
                        Si no solicitaste esta verificación, ignora este correo.
                      </p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 24px 32px; background: #f8fafc; border-top: 1px solid rgba(26,46,53,0.06);">
                      <p style="color: #6b7f8b; font-size: 12px; margin: 0; text-align: center;">
                        © 2026 Allio — Todos los derechos reservados.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
    });
    console.log(`[Email] Verification code sent to ${to}`);
  } catch (err) {
    console.error("[Email] Verification failed:", err);
  }
}

export async function sendWelcomeEmail(to: string, name: string) {
  try {
    return send({
      from: `Allio <${FROM_EMAIL}>`,
      to,
      subject: "¡Bienvenido a Allio!",
      html: `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"></head>
        <body style="font-family: 'Inter', system-ui, sans-serif; background: #FFF6EE; margin: 0; padding: 0;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td align="center" style="padding: 40px 16px;">
                <table width="480" cellpadding="0" cellspacing="0" style="background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.06);">
                  <tr>
                    <td style="background: linear-gradient(135deg, #CC5803, #D9803E); padding: 32px; text-align: center;">
                      <h1 style="color: #ffffff; font-size: 24px; margin: 0;">Allio</h1>
                      <p style="color: rgba(255,255,255,0.85); font-size: 14px; margin: 8px 0 0;">Diagnóstico financiero para tu restaurante</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 32px;">
                      <h2 style="color: #2A2522; font-size: 20px; margin: 0 0 12px;">¡Hola ${name}!</h2>
                      <p style="color: #6b7f8b; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
                        Bienvenido a Allio. Ya puedes empezar a diagnosticar tu restaurante y descubrir oportunidades para mejorar tu rentabilidad.
                      </p>
                      <a href="https://${FROM_DOMAIN}/onboarding" style="display: inline-block; background: linear-gradient(135deg, #CC5803, #D9803E); color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 700; font-size: 14px;">
                        Comenzar diagnóstico
                      </a>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 24px 32px; background: #f8fafc; border-top: 1px solid rgba(26,46,53,0.06);">
                      <p style="color: #6b7f8b; font-size: 12px; margin: 0; text-align: center;">
                        © 2026 Allio — Todos los derechos reservados.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
    });
    console.log(`[Email] Welcome sent to ${to}`);
  } catch (err) {
    console.error("[Email] Welcome failed:", err);
  }
}

export async function sendAlertEmail(to: string, subject: string, message: string) {
  try {
    return send({
      from: `Allio Alertas <${FROM_EMAIL}>`,
      to,
      subject: `⚠️ ${subject}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"></head>
        <body style="font-family: 'Inter', system-ui, sans-serif; background: #FFF6EE; margin: 0; padding: 0;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td align="center" style="padding: 40px 16px;">
                <table width="480" cellpadding="0" cellspacing="0" style="background: #ffffff; border-radius: 16px; overflow: hidden;">
                  <tr>
                    <td style="background: #EF4444; padding: 24px; text-align: center;">
                      <h1 style="color: #ffffff; font-size: 20px; margin: 0;">⚠️ Alerta</h1>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 32px;">
                      <h2 style="color: #2A2522; font-size: 18px; margin: 0 0 12px;">${subject}</h2>
                      <p style="color: #6b7f8b; font-size: 14px; line-height: 1.6; margin: 0;">${message}</p>
                      <a href="https://${FROM_DOMAIN}/dashboard" style="display: inline-block; margin-top: 20px; background: #CC5803; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 700; font-size: 14px;">
                        Ver dashboard
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
    });
    console.log(`[Email] Alert sent to ${to}: ${subject}`);
  } catch (err) {
    console.error("[Email] Alert failed:", err);
  }
}

export async function sendReminderEmail(to: string, subject: string, message: string, ctaLabel?: string, ctaLink?: string) {
  try {
    return send({
      from: `Allio <${FROM_EMAIL}>`,
      to,
      subject: `📌 Recordatorio: ${subject}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"></head>
        <body style="font-family: 'Inter', system-ui, sans-serif; background: #FFF6EE; margin: 0; padding: 0;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td align="center" style="padding: 40px 16px;">
                <table width="480" cellpadding="0" cellspacing="0" style="background: #ffffff; border-radius: 16px; overflow: hidden;">
                  <tr>
                    <td style="background: #F59E0B; padding: 24px; text-align: center;">
                      <h1 style="color: #ffffff; font-size: 20px; margin: 0;">📌 Recordatorio</h1>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 32px;">
                      <h2 style="color: #2A2522; font-size: 18px; margin: 0 0 12px;">${subject}</h2>
                      <p style="color: #6b7f8b; font-size: 14px; line-height: 1.6; margin: 0;">${message}</p>
                      ${ctaLabel && ctaLink ? `<a href="${ctaLink}" style="display: inline-block; margin-top: 20px; background: #CC5803; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 700; font-size: 14px;">${ctaLabel}</a>` : ""}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
    });
    console.log(`[Email] Reminder sent to ${to}: ${subject}`);
  } catch (err) {
    console.error("[Email] Reminder failed:", err);
  }
}

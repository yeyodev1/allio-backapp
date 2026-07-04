import { Resend } from "resend";

const RESEND_API_KEY = process.env.RESEND_API_KEY || "re_GePtvFJm_NGAkkfHCxBbJWfboGaP94c2a";
const FROM_DOMAIN = process.env.EMAIL_FROM_DOMAIN || "yeyo.dev";
const FROM_EMAIL = `notificaciones@${FROM_DOMAIN}`;

let resend: Resend | null = null;

function getClient(): Resend {
  if (!resend) {
    resend = new Resend(RESEND_API_KEY);
  }
  return resend;
}

export async function sendVerificationCode(to: string, name: string, code: string) {
  try {
    await getClient().emails.send({
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
                    <td style="background: linear-gradient(135deg, #588B8B, #7BA3A3); padding: 32px; text-align: center;">
                      <h1 style="color: #ffffff; font-size: 24px; margin: 0;">Allio</h1>
                      <p style="color: rgba(255,255,255,0.85); font-size: 14px; margin: 8px 0 0;">Verifica tu correo electrónico</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 32px; text-align: center;">
                      <h2 style="color: #2F243A; font-size: 20px; margin: 0 0 12px;">¡Hola ${name}!</h2>
                      <p style="color: #6b7f8b; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">
                        Usa el siguiente código para verificar tu cuenta:
                      </p>
                      <div style="background: #FFF6EE; border-radius: 12px; padding: 20px; margin: 0 0 24px; letter-spacing: 8px; font-size: 32px; font-weight: 800; color: #588B8B; font-family: monospace;">
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
    await getClient().emails.send({
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
                    <td style="background: linear-gradient(135deg, #588B8B, #7BA3A3); padding: 32px; text-align: center;">
                      <h1 style="color: #ffffff; font-size: 24px; margin: 0;">Allio</h1>
                      <p style="color: rgba(255,255,255,0.85); font-size: 14px; margin: 8px 0 0;">Diagnóstico financiero para tu restaurante</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 32px;">
                      <h2 style="color: #2F243A; font-size: 20px; margin: 0 0 12px;">¡Hola ${name}!</h2>
                      <p style="color: #6b7f8b; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
                        Bienvenido a Allio. Ya puedes empezar a diagnosticar tu restaurante y descubrir oportunidades para mejorar tu rentabilidad.
                      </p>
                      <a href="https://${FROM_DOMAIN}/onboarding" style="display: inline-block; background: linear-gradient(135deg, #588B8B, #7BA3A3); color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 700; font-size: 14px;">
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
    await getClient().emails.send({
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
                      <h2 style="color: #2F243A; font-size: 18px; margin: 0 0 12px;">${subject}</h2>
                      <p style="color: #6b7f8b; font-size: 14px; line-height: 1.6; margin: 0;">${message}</p>
                      <a href="https://${FROM_DOMAIN}/dashboard" style="display: inline-block; margin-top: 20px; background: #588B8B; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 700; font-size: 14px;">
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
    await getClient().emails.send({
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
                      <h2 style="color: #2F243A; font-size: 18px; margin: 0 0 12px;">${subject}</h2>
                      <p style="color: #6b7f8b; font-size: 14px; line-height: 1.6; margin: 0;">${message}</p>
                      ${ctaLabel && ctaLink ? `<a href="${ctaLink}" style="display: inline-block; margin-top: 20px; background: #588B8B; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 700; font-size: 14px;">${ctaLabel}</a>` : ""}
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

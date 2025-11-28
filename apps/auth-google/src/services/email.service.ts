import nodemailer from "nodemailer";
import { env } from "../config/env";

// Crear transporter de nodemailer
const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_PORT === 465, // true para 465, false para otros puertos
  auth: {
    user: env.SMTP_USER,
    pass: env.SMTP_PASSWORD,
  },
});

/**
 * Envía un email de reset de password
 */
export async function sendPasswordResetEmail(
  email: string,
  resetUrl: string
): Promise<void> {
  const mailOptions = {
    from: env.SMTP_FROM,
    to: email,
    subject: "Restablecer contraseña",
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Restablecer Contraseña</title>
      </head>
      <body style="font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #ffffff; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #0f0f0f;">
        <div style="background-color: #0f0f0f; border: 1px solid rgba(148, 153, 236, 0.3); border-radius: 12px; overflow: hidden;">
          
          <!-- Header -->
          <div style="background: linear-gradient(135deg, rgba(148, 153, 236, 0.2) 0%, rgba(148, 153, 236, 0.1) 100%); padding: 30px; text-align: center; border-bottom: 1px solid rgba(148, 153, 236, 0.3);">
            <h1 style="color: rgba(148, 153, 236, 1); margin: 0; font-size: 24px; font-weight: 600;">🔐 Restablecer Contraseña</h1>
          </div>
          
          <!-- Content -->
          <div style="padding: 30px; background-color: #0f0f0f;">
            <p style="color: #e0e0e0; margin-bottom: 20px;">Hola,</p>
            
            <p style="color: #b0b0b0; margin-bottom: 20px;">Recibimos una solicitud para restablecer la contraseña de tu cuenta.</p>
            
            <p style="color: #b0b0b0; margin-bottom: 30px;">Haz clic en el siguiente botón para crear una nueva contraseña:</p>
            
            <!-- Button -->
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetUrl}" 
                 style="background-color: rgba(148, 153, 236, 1); 
                        color: #0f0f0f; 
                        padding: 14px 32px; 
                        text-decoration: none; 
                        border-radius: 8px; 
                        font-weight: 600;
                        font-size: 14px;
                        display: inline-block;
                        transition: all 0.3s ease;">
                Restablecer Contraseña
              </a>
            </div>
            
            <!-- Warning -->
            <div style="background-color: rgba(148, 153, 236, 0.1); border-left: 3px solid rgba(148, 153, 236, 1); padding: 15px; margin: 25px 0; border-radius: 0 8px 8px 0;">
              <p style="color: #b0b0b0; font-size: 13px; margin: 0;">
                ⚠️ Si no solicitaste restablecer tu contraseña, puedes ignorar este correo. Tu contraseña no será modificada.
              </p>
            </div>
            
            <p style="color: #808080; font-size: 13px; margin-top: 20px;">
              ⏱️ Este enlace expirará en 1 hora por seguridad.
            </p>
            
            <!-- Divider -->
            <hr style="border: none; border-top: 1px solid rgba(148, 153, 236, 0.2); margin: 25px 0;">
            
            <!-- Link fallback -->
            <p style="color: #606060; font-size: 11px; text-align: center;">
              Si el botón no funciona, copia y pega este enlace en tu navegador:<br>
              <a href="${resetUrl}" style="color: rgba(148, 153, 236, 0.8); word-break: break-all; font-size: 10px;">${resetUrl}</a>
            </p>
          </div>
          
          <!-- Footer -->
          <div style="background-color: rgba(148, 153, 236, 0.05); padding: 20px; text-align: center; border-top: 1px solid rgba(148, 153, 236, 0.2);">
            <p style="color: #505050; font-size: 11px; margin: 0;">
              © ${new Date().getFullYear()} Auth Service. Todos los derechos reservados.
            </p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `
      Restablecer Contraseña
      
      Hola,
      
      Recibimos una solicitud para restablecer la contraseña de tu cuenta.
      
      Visita el siguiente enlace para crear una nueva contraseña:
      ${resetUrl}
      
      Si no solicitaste restablecer tu contraseña, puedes ignorar este correo.
      Tu contraseña no será modificada.
      
      Este enlace expirará en 1 hora por seguridad.
    `,
  };

  await transporter.sendMail(mailOptions);
}

/**
 * Verifica la conexión SMTP
 */
export async function verifyEmailConnection(): Promise<boolean> {
  try {
    await transporter.verify();
    return true;
  } catch {
    return false;
  }
}

import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const domain = "devteamatcci.site";

interface EmailTemplate {
  title: string;
  message: string;
  ctaText?: string;
  ctaUrl?: string;
}

const generateEmailHtml = ({
  title,
  message,
  ctaText,
  ctaUrl,
}: EmailTemplate) => `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
  </head>
  <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
    <table role="presentation" style="width: 100%; border-collapse: collapse;">
      <tr>
        <td style="padding: 40px 0; text-align: center; background-color: #ffffff;">
          <img src="https://clubcashin.com/img/favicon_dark.png?v2" alt="Club Cash In Logo" style="width: 150px; height: 150px; margin-bottom: 20px;">
          
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h1 style="color: #333333; font-size: 24px; margin-bottom: 20px;">${title}</h1>
            
            <p style="color: #666666; font-size: 16px; line-height: 1.5; margin-bottom: 30px;">
              ${message}
            </p>

            ${
              ctaText && ctaUrl
                ? `
            <a href="${ctaUrl}" 
               style="display: inline-block; padding: 12px 24px; background-color: #FF6B00; 
                      color: white; text-decoration: none; border-radius: 5px; 
                      font-weight: bold; margin-top: 20px;">
              ${ctaText}
            </a>
            `
                : ""
            }
          </div>
        </td>
      </tr>
      <tr>
        <td style="padding: 20px; text-align: center; background-color: #333333; color: white;">
          <p style="margin: 0; font-size: 14px;">
            © ${new Date().getFullYear()} Club Cash In. Todos los derechos reservados.
          </p>
          <p style="margin: 10px 0 0; font-size: 12px; color: #999999;">
            Este es un correo automático, por favor no responder.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>
`;

const sendEmail = async (
  to: string,
  subject: string,
  template: EmailTemplate
) => {
  try {
    const response = await resend.emails.send({
      from: `Club Cash In <no-reply@${domain}>`,
      to: [to],
      subject: subject,
      html: generateEmailHtml(template),
    });
    console.log(response);
  } catch (error) {
    console.error(error);
  }
};

export const sendPreApplicationApprovalEmail = async (
  to: string,
  name: string
) => {
  await sendEmail(to, "Pre-aprobación de solicitud de crédito", {
    title: "Pre-aprobación de solicitud de crédito aprobada",
    message: `Hola ${name},

    Gracias por aplicar con Club Cash In. Te informamos que tu solicitud ha sido pre-aprobada.
    Te contactaremos pronto para finalizar el proceso.`,
  });
};

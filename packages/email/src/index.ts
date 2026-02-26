import { Resend } from "resend";
import LiquidationEmail from "./templates/LiquidationTemplate";
import * as React from "react";

import { z } from "zod";

// Validaciones de variables de entorno
const apiKey = process.env.RESEND_API_KEY;
const domain = process.env.EMAIL_DOMAIN;

if (!apiKey) {
  throw new Error(
    "❌ [Email Package] RESEND_API_KEY is missing. Please add it to your environment variables."
  );
}

if (!domain) {
  throw new Error(
    "❌ [Email Package] EMAIL_DOMAIN is missing. Please add it to your environment variables (e.g., servicioscashin.com)."
  );
}

const resend = new Resend(apiKey);

// Schema para validación de correo
const emailSchema = z.string().email({ message: "Formato de correo electrónico inválido" });

export interface SendLiquidationEmailParams {
  to: string;
  investorName: string;
  amount: string;
  creditNumber: string;
  date: string;
  currencySymbol?: string;
  attachment?: {
    filename: string;
    content: Buffer;
  };
}

export const sendLiquidationEmail = async ({
  to,
  investorName,
  amount,
  creditNumber,
  date,
  currencySymbol,
  attachment,
}: SendLiquidationEmailParams) => {
  // Validar formato de correo antes de enviar
  emailSchema.parse(to);

  try {
    const { data, error } = await resend.emails.send({
      from: `Club Cash In <no-reply@${domain}>`,
      to: [to],
      subject: `Liquidación Procesada - Crédito ${creditNumber}`,
      react: React.createElement(LiquidationEmail, {
        investorName,
        amount,
        creditNumber,
        date,
        currencySymbol,
      }),
      attachments: attachment ? [attachment] : undefined,
    });

    if (error) {
      console.error("[sendLiquidationEmail] Resend API Error:", error);
      return { success: false, error };
    }

    console.log(`[sendLiquidationEmail] Liquidation email sent to ${to}. ID: ${data?.id}`);
    return { success: true, data };
  } catch (err) {
    console.error("[sendLiquidationEmail] Unexpected Error:", err);
    return { success: false, error: err };
  }
};

export const sendSimpleEmail = async (to: string, subject: string, message: string) => {
  // Validar formato de correo antes de enviar
  emailSchema.parse(to);

  try {
    const { data, error } = await resend.emails.send({
      from: `Club Cash In <no-reply@${domain}>`,
      to: [to],
      subject: subject,
      html: `<strong>${message}</strong>`,
    });

    if (error) {
       console.error("[sendSimpleEmail] Resend API Error:", error);
       return { success: false, error };
    }

    console.log(`[sendSimpleEmail] Test email sent to ${to}. ID: ${data?.id}`);
    return { success: true, data };
  } catch (err) {
    console.error("[sendSimpleEmail] Unexpected Error:", err);
    return { success: false, error: err };
  }
};

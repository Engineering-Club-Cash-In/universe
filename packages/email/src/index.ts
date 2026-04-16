/// <reference types="node" />
import { Resend } from "resend";
import LiquidationEmail from "./templates/LiquidationTemplate";
import PasswordResetEmail from "./templates/PasswordResetTemplate";
import NewCreditEmail from "./templates/NewCreditTemplate";
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
  reportUrl?: string;
}


export const sendLiquidationEmail = async ({
  to,
  investorName,
  amount,
  creditNumber,
  date,
  currencySymbol,
  attachment,
  reportUrl,
}: SendLiquidationEmailParams) => {
  // Validar formato de correo antes de enviar
  emailSchema.parse(to);

  try {
    const { data, error } = await resend.emails.send({
      from: `Club Cash In <no-reply@${domain}>`,
      to: [to],
      subject: `Liquidación Procesada - ${new Date().toLocaleString("es-GT", { month: "long", year: "numeric" })}`,
      react: React.createElement(LiquidationEmail, {
        investorName,
        amount,
        creditNumber,
        date,
        currencySymbol,
        reportUrl,
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

export const sendPasswordResetEmail = async (to: string, resetUrl: string) => {
  emailSchema.parse(to);

  try {
    const { data, error } = await resend.emails.send({
      from: `Club Cash In <no-reply@${domain}>`,
      to: [to],
      subject: "Restablecer contraseña - CashIn",
      react: React.createElement(PasswordResetEmail, { resetUrl }),
    });

    if (error) {
      console.error("[sendPasswordResetEmail] Resend API Error:", error);
      return { success: false, error };
    }

    console.log(`[sendPasswordResetEmail] Password reset email sent to ${to}. ID: ${data?.id}`);
    return { success: true, data };
  } catch (err) {
    console.error("[sendPasswordResetEmail] Unexpected Error:", err);
    return { success: false, error: err };
  }
};

export interface SendNewCreditNotificationParams {
  to: string[];
  clientName: string;
  creditNumber: string;
  capital: string;
  plazo: number;
  cuota: string;
  interestRate: string;
  investors: string[];
  currencySymbol?: string;
  vehiculoMarca?: string;
  vehiculoLinea?: string;
  vehiculoModelo?: string;
  vehiculoPlaca?: string;
  vehiculoVin?: string;
  montoAsegurado?: number;
  opportunityId?: string;
}

export const sendNewCreditNotification = async ({
  to,
  clientName,
  creditNumber,
  capital,
  plazo,
  cuota,
  interestRate,
  investors,
  currencySymbol,
  vehiculoMarca,
  vehiculoLinea,
  vehiculoModelo,
  vehiculoPlaca,
  vehiculoVin,
  montoAsegurado,
  opportunityId,
}: SendNewCreditNotificationParams) => {
  try {
    const validEmails = to.filter((email) => {
      try { emailSchema.parse(email); return true; } catch { return false; }
    });

    if (validEmails.length === 0) {
      console.warn("[sendNewCreditNotification] No valid admin emails found");
      return { success: false, error: "No valid emails" };
    }

    const { data, error } = await resend.emails.send({
      from: `Club Cash In <no-reply@${domain}>`,
      to: validEmails,
      subject: `Nuevo Crédito Creado - ${creditNumber} | ${clientName}`,
      react: React.createElement(NewCreditEmail, {
        clientName,
        creditNumber,
        capital,
        plazo,
        cuota,
        interestRate,
        investors,
        currencySymbol,
        vehiculoMarca,
        vehiculoLinea,
        vehiculoModelo,
        vehiculoPlaca,
        vehiculoVin,
        montoAsegurado,
        opportunityId,
      }),
    });

    if (error) {
      console.error("[sendNewCreditNotification] Resend API Error:", error);
      return { success: false, error };
    }

    console.log(`[sendNewCreditNotification] Email sent to ${validEmails.length} admins. ID: ${data?.id}`);
    return { success: true, data };
  } catch (err) {
    console.error("[sendNewCreditNotification] Unexpected Error:", err);
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

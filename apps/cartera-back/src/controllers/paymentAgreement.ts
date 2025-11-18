import { and, eq, gte, inArray, lte, sql, sum } from "drizzle-orm";
import { db } from "../database";
import { pagos_credito, convenios_pago, convenios_pagos_resume, creditos } from "../database/db";

interface CreatePaymentAgreementInput {
  credit_id: number;
  payment_ids: number[];
  total_agreement_amount: number;
  number_of_months: number;
  reason?: string;
  observations?: string;
  created_by: number;
}

export async function createPaymentAgreement(input: CreatePaymentAgreementInput) {
  try {
    const {
      credit_id,
      payment_ids,
      total_agreement_amount,
      number_of_months,
      reason,
      observations,
      created_by,
    } = input;

    // Validate input
    if (!credit_id || !payment_ids || payment_ids.length === 0) {
      throw new Error("Credit ID and payment IDs are required");
    }

    if (total_agreement_amount <= 0) {
      throw new Error("Total agreement amount must be greater than 0");
    }

    if (number_of_months <= 0) {
      throw new Error("Number of months must be greater than 0");
    }

    // 1. Validate that payments exist and belong to the credit
    const payments = await db
      .select()
      .from(pagos_credito)
      .where(inArray(pagos_credito.pago_id, payment_ids));

    if (payments.length === 0) {
      throw new Error("No payments found with the provided IDs");
    }

    if (payments.length !== payment_ids.length) {
      throw new Error("Some payments do not exist");
    }

    // Verify that all payments belong to the same credit
    const allFromSameCredit = payments.every(
      (payment) => payment.credito_id === credit_id
    );
    
    if (!allFromSameCredit) {
      throw new Error("All payments must belong to the same credit");
    }

    // Check if credit exists
    const [creditExists] = await db
      .select()
      .from(creditos)
      .where(eq(creditos.credito_id, credit_id));

    if (!creditExists) {
      throw new Error("Credit not found");
    }

    // Check if credit already has an active agreement
    const existingAgreement = await db
      .select()
      .from(convenios_pago)
      .where(
        and(
          eq(convenios_pago.credito_id, credit_id),
          eq(convenios_pago.activo, true),
          eq(convenios_pago.completado, false)
        )
      );

    if (existingAgreement.length > 0) {
      throw new Error("Credit already has an active payment agreement");
    }

    // 2. Calculate monthly installment
    const monthly_installment = total_agreement_amount / number_of_months;

    // 3. Create the agreement
    const [agreement] = await db
      .insert(convenios_pago)
      .values({
        credito_id: credit_id,
        monto_total_convenio: total_agreement_amount.toString(),
        numero_meses: number_of_months,
        cuota_mensual: monthly_installment.toString(),
        fecha_convenio: new Date(),
        monto_pagado: "0",
        monto_pendiente: total_agreement_amount.toString(),
        pagos_realizados: 0,
        pagos_pendientes: number_of_months,
        activo: true,
        completado: false,
        motivo: reason,
        observaciones: observations,
        created_by,
      })
      .returning();

    if (!agreement) {
      throw new Error("Failed to create payment agreement");
    }

    // 4. Associate payments to the agreement (pivot table)
    const agreementPaymentsData = payment_ids.map((payment_id) => ({
      convenio_id: agreement.convenio_id,
      pago_id: payment_id,
    }));

    await db.insert(convenios_pagos_resume).values(agreementPaymentsData);

    // 5. Update credit status to "EN_CONVENIO"
    await db
      .update(creditos)
      .set({ 
        statusCredit: "EN_CONVENIO" 
      })
      .where(eq(creditos.credito_id, credit_id));

    return {
      success: true,
      data: agreement,
      message: "Payment agreement created successfully"
    };

  } catch (error) {
    console.error("Error creating payment agreement:", error);
    
    // Return structured error response
    return {
      success: false,
      data: null,
      message: error instanceof Error ? error.message : "Unknown error occurred",
      error: error
    };
  }
}


interface GetPaymentAgreementsFilters {
  credit_id?: number;
  start_date?: Date;
  end_date?: Date;
  year?: number;
  month?: number;
  day?: number;
  status?: 'active' | 'completed' | 'inactive' | 'all';
}

export async function getPaymentAgreements(filters: GetPaymentAgreementsFilters = {}) {
  try {
    const {
      credit_id,
      start_date,
      end_date,
      year,
      month,
      day,
      status = 'all'
    } = filters;

    // Validate date inputs
    if (start_date && end_date && start_date > end_date) {
      throw new Error("Start date cannot be after end date");
    }

    if (month && (month < 1 || month > 12)) {
      throw new Error("Month must be between 1 and 12");
    }

    if (day && (day < 1 || day > 31)) {
      throw new Error("Day must be between 1 and 31");
    }

    if (year && year < 1900) {
      throw new Error("Invalid year");
    }

    // Build the query dynamically based on filters
    const conditions = [];

    // Filter by credit_id if provided
    if (credit_id) {
      conditions.push(eq(convenios_pago.credito_id, credit_id));
    }

    // Filter by status
    if (status === 'active') {
      conditions.push(eq(convenios_pago.activo, true));
      conditions.push(eq(convenios_pago.completado, false));
    } else if (status === 'completed') {
      conditions.push(eq(convenios_pago.completado, true));
    } else if (status === 'inactive') {
      conditions.push(eq(convenios_pago.activo, false));
    }

    // Filter by date range
    if (start_date) {
      conditions.push(gte(convenios_pago.fecha_convenio, start_date));
    }
    if (end_date) {
      conditions.push(lte(convenios_pago.fecha_convenio, end_date));
    }

    // Filter by year
    if (year) {
      conditions.push(
        sql`EXTRACT(YEAR FROM ${convenios_pago.fecha_convenio}) = ${year}`
      );
    }

    // Filter by month
    if (month) {
      conditions.push(
        sql`EXTRACT(MONTH FROM ${convenios_pago.fecha_convenio}) = ${month}`
      );
    }

    // Filter by day
    if (day) {
      conditions.push(
        sql`EXTRACT(DAY FROM ${convenios_pago.fecha_convenio}) = ${day}`
      );
    }

    // Apply all conditions and execute query
    const agreements = conditions.length > 0
      ? await db.select().from(convenios_pago).where(and(...conditions))
      : await db.select().from(convenios_pago);

    if (!agreements || agreements.length === 0) {
      return {
        success: true,
        data: [],
        message: "No payment agreements found"
      };
    }

    // Get detailed info for each agreement
    const agreementsWithDetails = await Promise.all(
      agreements.map(async (agreement) => {
        try {
          // Get all payments associated with this agreement
          const paymentsResume = await db
            .select({
              payment_id: convenios_pagos_resume.pago_id,
              payment: pagos_credito,
            })
            .from(convenios_pagos_resume)
            .innerJoin(
              pagos_credito,
              eq(convenios_pagos_resume.pago_id, pagos_credito.pago_id)
            )
            .where(eq(convenios_pagos_resume.convenio_id, agreement.convenio_id));

          // Format payment details
          const payments = paymentsResume.map((pr) => ({
            payment_id: pr.payment_id,
            cuota_id: pr.payment.cuota_id,
            fecha_pago: pr.payment.fecha_pago,
            monto_boleta: pr.payment.monto_boleta,
            pagado: pr.payment.pagado,
            // Payment breakdown
            abonos: {
              abono_capital: pr.payment.abono_capital,
              abono_interes: pr.payment.abono_interes,
              abono_iva_12: pr.payment.abono_iva_12,
              abono_interes_ci: pr.payment.abono_interes_ci,
              abono_iva_ci: pr.payment.abono_iva_ci,
              abono_seguro: pr.payment.abono_seguro,
              abono_gps: pr.payment.abono_gps,
              pago_del_mes: pr.payment.pago_del_mes,
            },
            // Remaining amounts
            restantes: {
              capital_restante: pr.payment.capital_restante,
              interes_restante: pr.payment.interes_restante,
              iva_12_restante: pr.payment.iva_12_restante,
              seguro_restante: pr.payment.seguro_restante,
              gps_restante: pr.payment.gps_restante,
              total_restante: pr.payment.total_restante,
            },
            mora: pr.payment.mora,
            otros: pr.payment.otros,
            observaciones: pr.payment.observaciones,
            mes_pagado: pr.payment.mes_pagado,
          }));

          // Calculate totals from payments
          const total_paid_from_payments = payments.reduce(
            (sum, p) => sum + (Number(p.monto_boleta) || 0),
            0
          );

          const paid_payments_count = payments.filter((p) => p.pagado).length;

          const progress = Number(agreement.monto_total_convenio) > 0
            ? ((Number(agreement.monto_pagado) / Number(agreement.monto_total_convenio)) * 100).toFixed(2)
            : "0.00";

          return {
            ...agreement,
            payments,
            summary: {
              total_payments: payments.length,
              paid_payments: paid_payments_count,
              unpaid_payments: payments.length - paid_payments_count,
              total_paid_from_payments,
              progress_percentage: progress,
            },
          };
        } catch (error) {
          console.error(`Error processing agreement ${agreement.convenio_id}:`, error);
          // Return agreement without details if there's an error
          return {
            ...agreement,
            payments: [],
            summary: {
              total_payments: 0,
              paid_payments: 0,
              unpaid_payments: 0,
              total_paid_from_payments: 0,
              progress_percentage: "0.00",
            },
            error: "Failed to load payment details"
          };
        }
      })
    );

    return {
      success: true,
      data: agreementsWithDetails,
      message: `Found ${agreementsWithDetails.length} payment agreement(s)`
    };

  } catch (error) {
    console.error("Error getting payment agreements:", error);
    
    return {
      success: false,
      data: [],
      message: error instanceof Error ? error.message : "Unknown error occurred",
      error: error
    };
  }
}
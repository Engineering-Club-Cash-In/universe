import Big from "big.js";
import { eq, and } from "drizzle-orm";
import { db } from "../database";
import { creditos, creditos_inversionistas, cuotas_credito, pagos_credito } from "../database/db";
import z from "zod";

interface UpdateInstallmentsParams {
  numero_credito_sifco: string;
  nueva_cuota: number;
}

const updateInstallments = async ({ 
  numero_credito_sifco, 
  nueva_cuota 
}: UpdateInstallmentsParams): Promise<void> => {
  
  // 1. Obtener información del crédito
  const [credito] = await db
    .select({
      credito_id: creditos.credito_id,
      capital: creditos.capital,
      deudatotal: creditos.deudatotal,
      porcentaje_interes: creditos.porcentaje_interes,
      cuota_interes: creditos.cuota_interes,
      iva_12: creditos.iva_12,
      seguro_10_cuotas: creditos.seguro_10_cuotas,
      gps: creditos.gps,
      membresias_pago: creditos.membresias_pago,
    })
    .from(creditos)
    .where(eq(creditos.numero_credito_sifco, numero_credito_sifco));

  if (!credito) {
    throw new Error(`No se encontró el crédito con número SIFCO: ${numero_credito_sifco}`);
  }

  // 2. Obtener los pagos que NO están pagados, ordenados por cuota_id
  const pagosNoPagados = await db
    .select()
    .from(pagos_credito)
    .where(
      and(
        eq(pagos_credito.credito_id, credito.credito_id),
        eq(pagos_credito.pagado, false)
      )
    )
    .orderBy(pagos_credito.cuota_id);

  if (pagosNoPagados.length === 0) {
    throw new Error("No hay cuotas pendientes por actualizar");
  }

  // 3. Capital en memoria SIEMPRE viene del crédito
  let capitalEnMemoria = new Big(credito.capital);

  // Montos fijos por mes
  const seguroFijoPorMes = new Big(credito.seguro_10_cuotas ?? 0);
  const gpsFijoPorMes = new Big(credito.gps ?? 0);
  const membresiasFijoPorMes = new Big(credito.membresias_pago ?? 0);
  const porcentajeInteres = new Big(credito.porcentaje_interes ?? 0).div(100);

  // Nueva cuota mensual
  const cuotaMensual = new Big(nueva_cuota);

  // Deuda total del crédito (temporal, viene del crédito)
  const deudaTotalCredito = new Big(credito.deudatotal);

  // 4. Recorrer y actualizar cada pago no pagado
  for (const pago of pagosNoPagados) {
    // Calcular interés e IVA del MES basado en el capital en memoria
    const interesMes = capitalEnMemoria.times(porcentajeInteres).round(2);
    const ivaMes = interesMes.times(0.12).round(2);

    // Abonos fijos del mes
    const abonoSeguro = seguroFijoPorMes;
    const abonoGps = gpsFijoPorMes;
    const abonoMembresias = membresiasFijoPorMes;

    // Calcular abono a capital del MES
    const montosExtras = interesMes.plus(ivaMes).plus(abonoSeguro).plus(abonoGps).plus(abonoMembresias);
    const abonoCapital = cuotaMensual.minus(montosExtras);

    // Restar el abono del capital en memoria
    capitalEnMemoria = capitalEnMemoria.minus(abonoCapital);
    if (capitalEnMemoria.lt(0)) capitalEnMemoria = new Big(0);

    // Restantes del MES
    const capitalRestanteMes = abonoCapital;
    const interesRestanteMes = interesMes;
    const ivaRestanteMes = ivaMes;
    const seguroRestanteMes = abonoSeguro;
    const gpsRestanteMes = abonoGps;

    // 5. Actualizar el pago
    await db
      .update(pagos_credito)
      .set({
        cuota: cuotaMensual.toString(),
        cuota_interes: credito.cuota_interes,  // Del crédito
        pago_del_mes: cuotaMensual.toString(),
        capital_restante: capitalRestanteMes.round(2).toString(),
        interes_restante: interesRestanteMes.round(2).toString(),
        iva_12_restante: ivaRestanteMes.round(2).toString(),
        seguro_restante: seguroRestanteMes.toString(),
        gps_restante: gpsRestanteMes.toString(),
        total_restante: capitalEnMemoria.round(2).toString(),
        membresias: membresiasFijoPorMes.toString(),
        membresias_pago: membresiasFijoPorMes.toString(),
        membresias_mes: membresiasFijoPorMes.toString(),
      })
      .where(eq(pagos_credito.pago_id, pago.pago_id));
  }

  // 6. Actualizar la cuota en el crédito principal
  await db
    .update(creditos)
    .set({
      cuota: cuotaMensual.toString(),
    })
    .where(eq(creditos.credito_id, credito.credito_id));

  console.log(`✅ Se actualizaron ${pagosNoPagados.length} cuotas para el crédito ${numero_credito_sifco}`);
};

export { updateInstallments };

 

// ========================================
// TIPOS E INTERFACES
// ========================================

const creditUpdateSchema = z.object({
  credito_id: z.number().int().positive(),
  cuota: z.number().min(0),
  plazo: z.number().min(0),
  mora: z.number().optional(),
  numero_credito_sifco: z.string().max(1000).optional(),
  inversionistas: z
    .array(
      z.object({
        inversionista_id: z.number().int().positive(),
        monto_aportado: z.number().positive(),
        porcentaje_cash_in: z.number().min(0).max(100),
        porcentaje_inversion: z.number().min(0).max(100),
        cuota_inversionista: z.number().min(0).optional(),
      })
    )
    .min(0),
  capital: z.number().nonnegative(),
  porcentaje_interes: z.number().min(0).max(100),
  seguro_10_cuotas: z.number().min(0),
  membresias_pago: z.number().min(0),
  otros: z.number().min(0),
});

type CreditUpdateData = z.infer<typeof creditUpdateSchema>;

interface ValidationResult {
  success: boolean;
  error?: {
    message: string;
    [key: string]: unknown;
  };
}

interface SetContext {
  status: number;
}

// ========================================
// 1. VALIDACIONES
// ========================================

/**
 * Valida que los porcentajes de inversionistas sumen 100%
 */
const validateInvestorsPercentages = (
  inversionistas: CreditUpdateData['inversionistas'],
  set: SetContext
): ValidationResult => {
  for (const inv of inversionistas) {
    const total = Number(inv.porcentaje_cash_in) + Number(inv.porcentaje_inversion);
    if (total !== 100) {
      set.status = 400;
      return {
        success: false,
        error: {
          message: `El cash-in y la inversión para el inversionista con ID ${inv.inversionista_id} deben sumar 100%`,
          detalle: { inversionista_id: inv.inversionista_id, total },
        }
      };
    }
  }
  return { success: true };
};

/**
 * Valida que la suma de cuotas de inversionistas coincida con la cuota del crédito
 */
const validateInvestorsQuotas = (
  inversionistas: CreditUpdateData['inversionistas'],
  cuota: number,
  set: SetContext
): ValidationResult => {
  const totalCuotaInversionista = inversionistas.reduce(
    (acc: Big, inv) => acc.plus(inv.cuota_inversionista ?? 0),
    new Big(0)
  );
  const totalCuotaInversionistaRedondeado = totalCuotaInversionista.round(2);

  if (Number(cuota) !== totalCuotaInversionistaRedondeado.toNumber()) {
    set.status = 400;
    return {
      success: false,
      error: {
        message: "La suma de las cuotas asignadas a los inversionistas debe ser igual a la cuota del crédito.",
        cuotaEsperada: cuota,
        totalCuotaInversionista: totalCuotaInversionistaRedondeado.toNumber(),
      }
    };
  }
  return { success: true };
};

/**
 * Valida que la suma de montos aportados coincida con el capital
 */
const validateInvestorsCapital = (
  inversionistas: CreditUpdateData['inversionistas'],
  capital: number,
  set: SetContext
): ValidationResult => {
  const totalMontoAportado = inversionistas.reduce(
    (acc: Big, inv) => acc.plus(inv.monto_aportado ?? 0),
    new Big(0)
  );
  const totalMontoAportadoRedondeado = totalMontoAportado.round(2);

  if (Number(capital) !== totalMontoAportadoRedondeado.toNumber()) {
    set.status = 400;
    return {
      success: false,
      error: {
        message: "La suma de los montos aportados de los inversionistas debe ser igual al capital del crédito.",
        capitalEsperado: capital,
        totalMontoAportado: totalMontoAportadoRedondeado.toNumber(),
      }
    };
  }
  return { success: true };
};

// ========================================
// 2. CÁLCULO DE DEUDA TOTAL
// ========================================

/**
 * Calcula la deuda total del crédito basándose en los parámetros
 */
function calcularDeudaTotal({
  capital,
  porcentaje_interes,
  seguro_10_cuotas,
  membresias_pago,
  otros,
  gps,
  cuota,
  plazo,
}: {
  capital: number;
  porcentaje_interes: number;
  seguro_10_cuotas: number;
  membresias_pago: number;
  otros: number;
  gps: number;
  cuota: number;
  plazo: number;
}): {
  capital: string;
  interes: string;
  totalDeuda: string;
  cuota: string;
  iva_12: string;
  plazo: string;
  gps: string;
} {
  const bigCapital = new Big(capital);
  const interes = bigCapital.times(new Big(porcentaje_interes).div(100));
  const iva_12 = interes.times(0.12).round(2);
  
  const deudatotal = bigCapital
    .plus(interes)
    .plus(iva_12)
    .plus(seguro_10_cuotas ?? 0)
    .plus(gps ?? 0)
    .plus(membresias_pago ?? 0)
    .plus(otros ?? 0);

  return {
    capital: bigCapital.round(2).toString(),
    interes: interes.round(2).toString(),
    iva_12: iva_12.toString(),
    totalDeuda: deudatotal.toString(),
    cuota: cuota.toString(),
    plazo: plazo.toString(),
    gps: gps.toString(),
  };
}

// ========================================
// 3. DETECCIÓN DE CAMBIOS QUE AFECTAN LA DEUDA
// ========================================

/**
 * Detecta si hubo cambios en campos que afectan la deuda total
 */
const detectDebtAffectingChanges = (
  fieldsToUpdate: Partial<CreditUpdateData>,
  current: any
): boolean => {
  const camposQueModificanDeuda = [
    "capital",
    "porcentaje_interes",
    "seguro_10_cuotas",
    "membresias_pago",
    "otros",
    "cuota",
    "plazo",
  ];

  return camposQueModificanDeuda.some((campo) => {
    const nuevo = fieldsToUpdate[campo as keyof typeof fieldsToUpdate];
    const actual = current[campo as keyof typeof current];
    
    const isValidBigSource = (v: unknown): v is string | number =>
      typeof v === "string" || typeof v === "number";
    
    return (
      nuevo !== undefined &&
      isValidBigSource(nuevo) &&
      isValidBigSource(actual) &&
      !new Big(nuevo).eq(new Big(actual))
    );
  });
};

// ========================================
// 4. ACTUALIZACIÓN DE CUOTA INICIAL (OTROS)
// ========================================

/**
 * Actualiza el campo "otros" en la cuota inicial si cambió
 */
const updateInitialQuotaOtros = async (
  credito_id: number,
  otros: number
): Promise<void> => {
  const cuotaInicial = await db
    .select({ id: cuotas_credito.cuota_id })
    .from(cuotas_credito)
    .where(
      and(
        eq(cuotas_credito.credito_id, credito_id),
        eq(cuotas_credito.numero_cuota, 0)
      )
    );

  if (cuotaInicial.length) {
    await db
      .update(pagos_credito)
      .set({ otros: otros.toString() })
      .where(eq(pagos_credito.cuota_id, cuotaInicial[0].id));
  }
};

// ========================================
// 5. ACTUALIZACIÓN DE INVERSIONISTAS
// ========================================

/**
 * Actualiza los inversionistas del crédito
 */
const updateInvestors = async (
  credito_id: number,
  inversionistas: CreditUpdateData['inversionistas'],
  updateFields: any,
  current: any,
  numero_credito_sifco?: string
): Promise<void> => {
  if (inversionistas.length === 0) return;

  // Eliminar inversionistas existentes
  await db
    .delete(creditos_inversionistas)
    .where(eq(creditos_inversionistas.credito_id, credito_id));

  // Preparar datos de nuevos inversionistas
  const creditosInversionistasData = inversionistas.map((inv) => {
    const montoAportado = new Big(inv.monto_aportado);
    const porcentajeCashIn = new Big(inv.porcentaje_cash_in);
    const porcentajeInversion = new Big(inv.porcentaje_inversion);
    const interes = new Big(
      updateFields.porcentaje_interes ?? current?.porcentaje_interes ?? 0
    );
    const newCuotaInteres = montoAportado.times(interes.div(100)).round(2);

    const montoInversionista = newCuotaInteres
      .times(porcentajeInversion)
      .div(100)
      .round(2);
    const montoCashIn = newCuotaInteres
      .times(porcentajeCashIn)
      .div(100)
      .round(2);

    const ivaInversionista = montoInversionista.gt(0)
      ? montoInversionista.times(0.12).round(2)
      : new Big(0);
    const ivaCashIn = montoCashIn.gt(0)
      ? montoCashIn.times(0.12).round(2)
      : new Big(0);

    return {
      credito_id: credito_id,
      inversionista_id: inv.inversionista_id,
      monto_aportado: montoAportado.toString(),
      porcentaje_cash_in: porcentajeCashIn.toString(),
      porcentaje_participacion_inversionista: porcentajeInversion.toString(),
      monto_inversionista: montoInversionista.toString(),
      monto_cash_in: montoCashIn.toString(),
      iva_inversionista: ivaInversionista.toString(),
      iva_cash_in: ivaCashIn.toString(),
      fecha_creacion: new Date(),
      cuota_inversionista: inv.cuota_inversionista?.toString() ?? "0",
      numero_credito_sifco: numero_credito_sifco ?? undefined,
    };
  });

  // Insertar nuevos inversionistas
  if (creditosInversionistasData.length > 0) {
    await db.insert(creditos_inversionistas).values(creditosInversionistasData);
  }
};

// ========================================
// 6. SINCRONIZACIÓN DE CUOTAS Y PLAZOS
// ========================================

/**
 * Sincroniza las cuotas cuando cambia el monto o el plazo
 */
const syncScheduleOnTermsChange = async ({
  creditoId,
  newCuota,
  newPlazo,
  preloadCredit,
}: {
  creditoId: number;
  newCuota: number;
  newPlazo: number;
  preloadCredit: any;
}): Promise<void> => {
  // Aquí iría la lógica de sincronización
  // Por ahora solo un placeholder
  console.log('Syncing schedule for credit:', creditoId);
  console.log('New quota:', newCuota, 'New term:', newPlazo);
};

// ========================================
// FUNCIÓN PRINCIPAL DE ACTUALIZACIÓN
// ========================================

export const updateCredit = async ({ body, set }: any) => {
  try {
    console.log("Updating credit with body:", body);
    
    // 1. Validar schema
    const parseResult = creditUpdateSchema.safeParse(body);
    if (!parseResult.success) {
      set.status = 400;
      return {
        message: "Validation failed",
        errors: parseResult.error.flatten().fieldErrors,
      };
    }

    const {
      credito_id,
      inversionistas = [],
      mora,
      cuota,
      numero_credito_sifco,
      ...fieldsToUpdate
    } = parseResult.data;

    // 2. Buscar el crédito actual
    const [current] = await db
      .select()
      .from(creditos)
      .where(
        and(
          eq(creditos.credito_id, credito_id),
          eq(creditos.statusCredit, "ACTIVO")
        )
      )
      .limit(1);

    if (!current) {
      set.status = 400;
      return { message: "Credit not found" };
    }

    // 3. Validar inversionistas
    const percentagesValidation = validateInvestorsPercentages(inversionistas, set);
    if (!percentagesValidation.success) {
      return percentagesValidation.error;
    }

    const quotasValidation = validateInvestorsQuotas(inversionistas, cuota, set);
    if (!quotasValidation.success) {
      return quotasValidation.error;
    }

    const capitalValidation = validateInvestorsCapital(
      inversionistas,
      fieldsToUpdate.capital,
      set
    );
    if (!capitalValidation.success) {
      return capitalValidation.error;
    }

    // 4. Preparar campos de actualización
    const updateFields: any = { ...fieldsToUpdate };
    
    const formatCredit = inversionistas.some(
      (inv) => Number(inv.porcentaje_inversion) > 0
    ) ? "Pool" : "Individual";
    
    updateFields.formato_credito = formatCredit;
    if (mora !== undefined) updateFields.mora = mora.toString();
    if (cuota !== undefined) updateFields.cuota = cuota.toString();
    if (numero_credito_sifco !== undefined) {
      updateFields.numero_credito_sifco = numero_credito_sifco;
    }

    // 5. Detectar cambios que afectan la deuda
    const changes = detectDebtAffectingChanges(fieldsToUpdate, current);
    const otrosModificado =
      fieldsToUpdate.otros !== undefined &&
      !new Big(fieldsToUpdate.otros).eq(new Big(current.otros));

    // 6. Verificar cambios en cuota o plazo
    const willChangeCuota =
      cuota !== undefined && !new Big(cuota).eq(new Big(current.cuota));
    const willChangePlazo =
      fieldsToUpdate.plazo !== undefined &&
      !new Big(fieldsToUpdate.plazo).eq(new Big(current.plazo));

    if (willChangeCuota || willChangePlazo) {
      console.log("Will change cuota or plazo");
      await syncScheduleOnTermsChange({
        creditoId: credito_id,
        newCuota: Number(cuota ?? current.cuota),
        newPlazo: Number(fieldsToUpdate.plazo ?? current.plazo),
        preloadCredit: current,
      });
    }

    // 7. Recalcular deuda si hay cambios relevantes
if (changes) {
  console.log("Changes detected in fields that affect deuda_total");

  const nuevaDeudaTotal = calcularDeudaTotal({
    capital: fieldsToUpdate.capital ?? current.capital,
    porcentaje_interes: fieldsToUpdate.porcentaje_interes ?? current.porcentaje_interes,
    seguro_10_cuotas: fieldsToUpdate.seguro_10_cuotas ?? current.seguro_10_cuotas,
    membresias_pago: fieldsToUpdate.membresias_pago ?? current.membresias_pago,
    otros: fieldsToUpdate.otros ?? current.otros,
    gps: new Big(current.gps).toNumber(),
    cuota: cuota ?? current.cuota,
    plazo: fieldsToUpdate.plazo ?? current.plazo,
  });

  updateFields.deudatotal = nuevaDeudaTotal.totalDeuda;
  updateFields.cuota = nuevaDeudaTotal.cuota;
  updateFields.plazo = fieldsToUpdate.plazo ?? current.plazo;
  updateFields.otros = fieldsToUpdate.otros ?? current.otros;
  updateFields.iva_12 = nuevaDeudaTotal.iva_12;
  updateFields.gps = nuevaDeudaTotal.gps;
  updateFields.cuota_interes = nuevaDeudaTotal.interes;
  updateFields.membresias_pago = fieldsToUpdate.membresias_pago ?? current.membresias_pago;
  updateFields.seguro_10_cuotas = fieldsToUpdate.seguro_10_cuotas ?? current.seguro_10_cuotas;

  // Actualizar "otros" en la cuota inicial si cambió
  if (otrosModificado) {
    await updateInitialQuotaOtros(credito_id, fieldsToUpdate.otros);
  }

  // Actualizar pagos si la cuota cambió
  if (cuota !== undefined && !new Big(cuota).eq(new Big(current.cuota))) {
    await updateInstallments({
      numero_credito_sifco: numero_credito_sifco ?? current.numero_credito_sifco,
      nueva_cuota: cuota,
    });
  }
}

    updateFields.membresias = fieldsToUpdate.membresias_pago ?? current.membresias_pago;

    // 8. Actualizar el crédito
    const [updatedCredit] = await db
      .update(creditos)
      .set(updateFields)
      .where(eq(creditos.credito_id, credito_id))
      .returning();

    // 9. Actualizar inversionistas
    await updateInvestors(
      credito_id,
      inversionistas,
      updateFields,
      current,
      numero_credito_sifco
    );

    set.status = 200;
    return updatedCredit;
  } catch (error) {
    console.error("Error al actualizar el crédito:", error);
    set.status = 500;
    return { message: "Error al actualizar el crédito" };
  }
};
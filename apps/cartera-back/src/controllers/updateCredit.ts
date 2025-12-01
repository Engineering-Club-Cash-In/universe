import Big from "big.js";
import { eq, and, inArray } from "drizzle-orm";
import { db } from "../database";
import { creditos, creditos_inversionistas, cuotas_credito, pagos_credito } from "../database/db";
import z from "zod";

interface UpdateInstallmentsParams {
  numero_credito_sifco: string;
  nueva_cuota: number;
  all?: boolean;
}

const updateInstallments = async ({ 
  numero_credito_sifco, 
  nueva_cuota ,

  all = false,
}: UpdateInstallmentsParams): Promise<void> => {
  
  // 1️⃣ Obtener crédito y pagos en paralelo (en lugar de secuencial)
  const [creditoResult, pagosNoPagados] = await Promise.all([
    db
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
      .where(eq(creditos.numero_credito_sifco, numero_credito_sifco))
      .limit(1),
    
    // 🔥 Optimización: Hacer el WHERE con subconsulta en lugar de dos queries
    db
      .select()
      .from(pagos_credito)
      .where(
        and(
          eq(pagos_credito.credito_id, 
            db.select({ id: creditos.credito_id })
              .from(creditos)
              .where(eq(creditos.numero_credito_sifco, numero_credito_sifco))
              .limit(1)
          ),
          eq(pagos_credito.pagado, all)
        )
      )
      .orderBy(pagos_credito.cuota_id)
  ]);

  const credito = creditoResult[0];

  // 2️⃣ Validaciones
  if (!credito) {
    throw new Error(`No se encontró el crédito con número SIFCO: ${numero_credito_sifco}`);
  }

  if (pagosNoPagados.length === 0) {
    throw new Error("No hay cuotas pendientes por actualizar");
  }

  // 3️⃣ Pre-calcular constantes una sola vez (fuera del loop)
  const capitalInicial = new Big(credito.capital);
  const seguroFijoPorMes = new Big(credito.seguro_10_cuotas ?? 0);
  const gpsFijoPorMes = new Big(credito.gps ?? 0);
  const membresiasFijoPorMes = new Big(credito.membresias_pago ?? 0);
  const porcentajeInteres = new Big(credito.porcentaje_interes ?? 0).div(100);
  const cuotaMensual = new Big(nueva_cuota);
  const cuotaInteresCredito = credito.cuota_interes;

  // Capital en memoria
  let capitalEnMemoria = capitalInicial;

  // 4️⃣ Preparar todas las actualizaciones en memoria primero (batch)
  const actualizaciones = pagosNoPagados.map((pago) => {
    // Cálculos del mes
    const interesMes = capitalEnMemoria.times(porcentajeInteres).round(2);
    const ivaMes = interesMes.times(0.12).round(2);

    // Abono a capital
    const montosExtras = interesMes.plus(ivaMes).plus(seguroFijoPorMes).plus(gpsFijoPorMes).plus(membresiasFijoPorMes);
    const abonoCapital = cuotaMensual.minus(montosExtras);

    // Actualizar capital en memoria
    capitalEnMemoria = capitalEnMemoria.minus(abonoCapital);
    if (capitalEnMemoria.lt(0)) capitalEnMemoria = new Big(0);

    // Retornar objeto de actualización
    return {
      pago_id: pago.pago_id,
      datos: {
        cuota: cuotaMensual.toString(),
        cuota_interes: cuotaInteresCredito,
        pago_del_mes: cuotaMensual.toString(),
        capital_restante: abonoCapital.round(2).toString(),
        interes_restante: interesMes.round(2).toString(),
        iva_12_restante: ivaMes.round(2).toString(),
        seguro_restante: seguroFijoPorMes.toString(),
        gps_restante: gpsFijoPorMes.toString(),
        total_restante: capitalEnMemoria.round(2).toString(),
        membresias: membresiasFijoPorMes.toString(),
        membresias_pago: membresiasFijoPorMes.toString(),
        membresias_mes: membresiasFijoPorMes.toString(),
      }
    };
  });

  // 5️⃣ Ejecutar TODAS las actualizaciones en paralelo (batch update)
  await Promise.all([
    // Actualizar todos los pagos
    ...actualizaciones.map(({ pago_id, datos }) =>
      db
        .update(pagos_credito)
        .set(datos)
        .where(eq(pagos_credito.pago_id, pago_id))
    ),
    // Actualizar el crédito
    db
      .update(creditos)
      .set({ cuota: cuotaMensual.toString() })
      .where(eq(creditos.credito_id, credito.credito_id))
  ]);

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
   asesor_id: z.number().int().positive().optional(),
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
      asesor_id,
      ...fieldsToUpdate
    } = parseResult.data;

    // 2. Buscar el crédito actual
    const [current] = await db
  .select()
  .from(creditos)
  .where(
    and(
      eq(creditos.credito_id, credito_id),
      inArray(creditos.statusCredit, ["ACTIVO", "MOROSO", "PENDIENTE_CANCELACION","EN_CONVENIO"])
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
 if (asesor_id !== undefined) { // ✅ Agregar al update
      updateFields.asesor_id = asesor_id;
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
interface UpdateAllInstallmentsParams {
  numero_credito_sifco?: string; // Opcional por si querés uno específico
}

export const updateAllInstallments = async ({
  numero_credito_sifco
}: UpdateAllInstallmentsParams = {}): Promise<void> => {
  try {
    console.log("\n🔄 ========== ACTUALIZANDO CUOTAS ==========");

    // 1️⃣ Query optimizada con construcción condicional más limpia
    const whereConditions = numero_credito_sifco
      ? and(
          eq(creditos.statusCredit, 'ACTIVO'),
          eq(creditos.numero_credito_sifco, numero_credito_sifco)
        )
      : eq(creditos.statusCredit, 'ACTIVO');

    // 2️⃣ Query única con límite condicional inline
    let query = db
      .select({
        numero_credito_sifco: creditos.numero_credito_sifco,
        cuota: creditos.cuota,
      })
      .from(creditos)
      .where(whereConditions);

    if (numero_credito_sifco) {
      query = query.limit(1) as any;
    }

    const creditosAActualizar = await query;

    // 3️⃣ Early return si no hay datos
    if (creditosAActualizar.length === 0) {
      const mensaje = numero_credito_sifco
        ? `Crédito ${numero_credito_sifco} no encontrado o no está activo`
        : 'No hay créditos activos para actualizar';
      console.log(`⚠️ ${mensaje}`);
      return;
    }

    console.log(`📋 Total de créditos a actualizar: ${creditosAActualizar.length}\n`);

    // 4️⃣ Procesamiento con Promise.allSettled (paralelo en lugar de secuencial)
    const resultados = await Promise.allSettled(
      creditosAActualizar.map(async (credito) => {
        console.log(`⏳ Procesando: ${credito.numero_credito_sifco} - Cuota: Q${credito.cuota}`);
        
        await updateInstallments({
          numero_credito_sifco: credito.numero_credito_sifco,
          nueva_cuota: Number(credito.cuota)
        });
        
        console.log(`   ✅ ${credito.numero_credito_sifco} actualizado correctamente\n`);
        return credito.numero_credito_sifco;
      })
    );

    // 5️⃣ Análisis de resultados más eficiente
    const exitosos = resultados.filter(r => r.status === 'fulfilled');
    const fallidos = resultados.filter(r => r.status === 'rejected') as PromiseRejectedResult[];
    
    const errores = fallidos.map((resultado, idx) => ({
      credito: creditosAActualizar[resultados.indexOf(resultado)].numero_credito_sifco,
      error: resultado.reason instanceof Error ? resultado.reason.message : String(resultado.reason)
    }));

    // 6️⃣ Resumen final
    console.log("📊 ========== RESUMEN ==========");
    console.log(`✅ Exitosos: ${exitosos.length}`);
    console.log(`❌ Fallidos: ${fallidos.length}`);
    console.log(`📋 Total procesados: ${creditosAActualizar.length}`);
    
    if (errores.length > 0) {
      console.log("\n⚠️ Errores detallados:");
      errores.forEach(({ credito, error }) => {
        console.log(`   - ${credito}: ${error}`);
      });
    }
    
    console.log("🎉 Proceso completado\n");

  } catch (error) {
    console.error('\n❌ Error crítico en updateAllInstallments:', error);
    throw error;
  }
};

interface AjustarCuotasCompletoParams {
  numero_credito_sifco: string;
  cuota_real_actual: number;
  crear_cuotas_historicas?: boolean; // Flag opcional
}

const ajustarCuotasCompleto = async ({
  numero_credito_sifco,
  cuota_real_actual,
  crear_cuotas_historicas = false,
}: AjustarCuotasCompletoParams): Promise<void> => {
  
  console.log(`\n🔧 Ajuste completo del crédito ${numero_credito_sifco}`);

  // 1️⃣ Obtener crédito
  const creditoResult = await db
    .select({ 
      credito_id: creditos.credito_id,
      plazo: creditos.plazo,
      fecha_desembolso: creditos.fecha_creacion,
    })
    .from(creditos)
    .where(eq(creditos.numero_credito_sifco, numero_credito_sifco))
    .limit(1);

  const credito = creditoResult[0];
  if (!credito) throw new Error("Crédito no encontrado");

  // 2️⃣ Obtener cuotas y pagos existentes
  const [cuotasExistentes, pagosExistentes] = await Promise.all([
    db.select()
      .from(cuotas_credito)
      .where(eq(cuotas_credito.credito_id, credito.credito_id))
      .orderBy(cuotas_credito.numero_cuota),
    
    db.select()
      .from(pagos_credito)
      .where(eq(pagos_credito.credito_id, credito.credito_id))
      .orderBy(pagos_credito.cuota_id),
  ]);

  const cuotas_faltantes = cuota_real_actual - 1;

  console.log(`📊 Estado:`);
  console.log(`   Cuotas existentes: ${cuotasExistentes.length}`);
  console.log(`   Pagos existentes: ${pagosExistentes.length}`);
  console.log(`   Cuotas históricas faltantes: ${cuotas_faltantes}`);

  await db.transaction(async (tx) => {
    
    // 3️⃣ OPCIONAL: Crear cuotas históricas en cuotas_credito
    if (crear_cuotas_historicas && cuotas_faltantes > 0) {
      console.log(`\n🔄 Creando ${cuotas_faltantes} cuotas históricas...`);
      
      const fechaBase = new Date(credito.fecha_desembolso);
      
      for (let i = 1; i <= cuotas_faltantes; i++) {
        const fechaVencimiento = new Date(fechaBase);
        fechaVencimiento.setMonth(fechaVencimiento.getMonth() + i);

        await tx.insert(cuotas_credito).values({
          credito_id: credito.credito_id,
          numero_cuota: i,
          fecha_vencimiento: fechaVencimiento.toISOString().split('T')[0],
          pagado: true, // ✅ Marcadas como pagadas (históricas)
          liquidado_inversionistas: true, // Asumimos que ya se liquidaron
          fecha_liquidacion_inversionistas: fechaVencimiento,
        });
        
        console.log(`   ✅ Cuota histórica #${i} creada`);
      }
    }

    // 4️⃣ Renumerar cuotas existentes
    console.log(`\n🔄 Renumerando cuotas existentes...`);
    
    for (let i = 0; i < cuotasExistentes.length; i++) {
      const cuota = cuotasExistentes[i];
      const nuevo_numero = cuota_real_actual + i;
      
      await tx
        .update(cuotas_credito)
        .set({ numero_cuota: nuevo_numero })
        .where(eq(cuotas_credito.cuota_id, cuota.cuota_id));
      
      console.log(`   ✅ Cuota #${cuota.numero_cuota} → #${nuevo_numero}`);
    }

    // 5️⃣ Los pagos ya están vinculados por cuota_id (FK)
    // No necesitas actualizar nada en pagos_credito
    console.log(`\n✅ Pagos vinculados automáticamente vía FK (cuota_id)`);
  });

  console.log(`\n🎉 Ajuste completado exitosamente!`);
};

// 🔥 Uso:
await ajustarCuotasCompleto({
  numero_credito_sifco: "SIFCO-12345",
  cuota_real_actual: 19,
  crear_cuotas_historicas: true, // 👈 Crea cuotas #1-18
});
import Big from "big.js";
import { eq, and } from "drizzle-orm";
import { db } from "../database";
import {
  creditos,
  creditos_inversionistas,
  creditos_inversionistas_espejo,
} from "../database/db";
import z from "zod";

const CUBE_INVESTMENT_ID = 86;

// ========================================
// SCHEMA DE VALIDACIÓN
// ========================================

const addInvestorToCreditSchema = z.object({
  inversionista_id: z.number().int().positive(),
  monto_aportado: z.number().positive(),
  porcentaje_cash_in: z.number().min(0).max(100).optional(),
  porcentaje_inversion: z.number().min(0).max(100).optional(),
  tipo_operacion: z.enum(["reinversion", "compra_cartera"]),
  fecha_inicio_participacion: z.string().optional(),
});

type AddInvestorData = z.infer<typeof addInvestorToCreditSchema>;

// ========================================
// RECALCULAR INVERSIONISTAS
// ========================================

/**
 * Recalcula cuotas, intereses, IVA y participación para un array de inversionistas.
 * Misma lógica que updateInvestors en updateCredit.ts
 */
function recalcularInversionistas(
  inversionistasArray: {
    inversionista_id: number;
    monto_aportado: Big;
    porcentaje_cash_in: Big;
    porcentaje_inversion: Big;
    fecha_inicio_participacion: string;
  }[],
  creditoData: {
    cuota: string;
    porcentaje_interes: string;
    seguro_10_cuotas: string;
    gps: string;
    membresias_pago: string;
  },
  credito_id: number,
  numero_credito_sifco: string,
) {
  const capitalTotal = inversionistasArray.reduce(
    (acc, inv) => acc.plus(inv.monto_aportado),
    new Big(0),
  );
  const cuotaTotal = new Big(creditoData.cuota);
  const seguro = new Big(creditoData.seguro_10_cuotas ?? 0);
  const gps = new Big(creditoData.gps ?? 0);
  const membresias = new Big(creditoData.membresias_pago ?? 0);
  const tasaInteres = new Big(creditoData.porcentaje_interes ?? 0);

  // Encontrar al inversionista con mayor monto
  const inversionistaMayor = inversionistasArray.reduce((max, current) =>
    current.monto_aportado.gt(max.monto_aportado) ? current : max,
  );

  const cuotaSinCargos = cuotaTotal.minus(seguro).minus(gps).minus(membresias);

  return inversionistasArray.map((inv) => {
    const porcentajeParticipacion = inv.monto_aportado
      .div(capitalTotal)
      .times(100);

    const cuotaBase = cuotaSinCargos
      .times(porcentajeParticipacion.div(100))
      .round(6);

    const esMayor =
      inv.inversionista_id === inversionistaMayor.inversionista_id;

    const cuotaInversionista = esMayor
      ? cuotaBase.plus(seguro).plus(gps).plus(membresias).round(6)
      : cuotaBase;

    // Interés sobre monto aportado
    const cuotaInteres = inv.monto_aportado.times(tasaInteres.div(100)).round(2);

    // Distribución entre inversionista y cash-in
    const montoInversionista = cuotaInteres
      .times(inv.porcentaje_inversion)
      .div(100)
      .round(2);

    const montoCashIn = cuotaInteres
      .times(inv.porcentaje_cash_in)
      .div(100)
      .round(2);

    // IVA 12%
    const ivaInversionista = montoInversionista.gt(0)
      ? montoInversionista.times(0.12).round(2)
      : new Big(0);

    const ivaCashIn = montoCashIn.gt(0)
      ? montoCashIn.times(0.12).round(2)
      : new Big(0);

    return {
      credito_id,
      inversionista_id: inv.inversionista_id,
      monto_aportado: inv.monto_aportado.toString(),
      porcentaje_cash_in: inv.porcentaje_cash_in.toString(),
      porcentaje_participacion_inversionista:
        inv.porcentaje_inversion.toString(),
      monto_inversionista: montoInversionista.toString(),
      monto_cash_in: montoCashIn.toString(),
      iva_inversionista: ivaInversionista.toString(),
      iva_cash_in: ivaCashIn.toString(),
      fecha_creacion: new Date(),
      fecha_inicio_participacion:
        inv.fecha_inicio_participacion || "2025-12-01",
      cuota_inversionista: cuotaInversionista.toString(),
      numero_credito_sifco: numero_credito_sifco ?? undefined,
    };
  });
}

// ========================================
// CONTROLLER PRINCIPAL
// ========================================

export const addInvestorToCredit = async ({ body, set }: any) => {
  try {
    // 1. Validar schema
    const parseResult = addInvestorToCreditSchema.safeParse(body);
    if (!parseResult.success) {
      set.status = 400;
      return {
        message: "Validation failed",
        errors: parseResult.error.flatten().fieldErrors,
      };
    }

    const {
      inversionista_id,
      monto_aportado,
      porcentaje_cash_in,
      porcentaje_inversion,
      tipo_operacion,
      fecha_inicio_participacion,
    } = parseResult.data;

    // 2. GET interno — traer créditos candidatos del inversionista
    // TODO: Implementar GET que devuelve los créditos candidatos
    // Por ahora placeholder: devuelve los credito_id donde participa
    const creditosCandidatos: { credito_id: number }[] = [];

    // === AQUÍ VA EL GET INTERNO ===
    // creditosCandidatos = await getCreditos(inversionista_id, ...);
    // ==============================

    if (creditosCandidatos.length === 0) {
      set.status = 404;
      return {
        success: false,
        message: "No se encontraron créditos candidatos para este inversionista",
      };
    }

    const resultados: any[] = [];
    const errores: any[] = [];

    // 3. Para cada crédito candidato
    await db.transaction(async (tx) => {
      for (const candidato of creditosCandidatos) {
        try {
          const { credito_id } = candidato;

          // 3a. Traer info del crédito
          const [creditoData] = await tx
            .select({
              credito_id: creditos.credito_id,
              capital: creditos.capital,
              cuota: creditos.cuota,
              porcentaje_interes: creditos.porcentaje_interes,
              seguro_10_cuotas: creditos.seguro_10_cuotas,
              gps: creditos.gps,
              membresias_pago: creditos.membresias_pago,
              numero_credito_sifco: creditos.numero_credito_sifco,
            })
            .from(creditos)
            .where(eq(creditos.credito_id, credito_id))
            .limit(1);

          if (!creditoData) {
            errores.push({ credito_id, razon: "Crédito no encontrado" });
            continue;
          }

          // 3b. Traer inversionistas actuales (padre)
          const inversionistasActuales = await tx
            .select({
              inversionista_id: creditos_inversionistas.inversionista_id,
              monto_aportado: creditos_inversionistas.monto_aportado,
              porcentaje_cash_in: creditos_inversionistas.porcentaje_cash_in,
              porcentaje_participacion_inversionista:
                creditos_inversionistas.porcentaje_participacion_inversionista,
              fecha_inicio_participacion:
                creditos_inversionistas.fecha_inicio_participacion,
            })
            .from(creditos_inversionistas)
            .where(eq(creditos_inversionistas.credito_id, credito_id));

          // 3c. Buscar CUBE
          const cubeActual = inversionistasActuales.find(
            (inv) => inv.inversionista_id === CUBE_INVESTMENT_ID,
          );

          if (!cubeActual) {
            errores.push({
              credito_id,
              razon: "CUBE no encontrado en este crédito",
            });
            continue;
          }

          const montoCubeActual = new Big(cubeActual.monto_aportado);
          const montoNuevo = new Big(monto_aportado);

          // 3d. Validar que hay suficiente monto en CUBE
          if (montoNuevo.gt(montoCubeActual)) {
            errores.push({
              credito_id,
              razon: `Monto solicitado (${montoNuevo}) excede monto de CUBE (${montoCubeActual})`,
            });
            continue;
          }

          // 3e. Determinar porcentajes del nuevo inversionista
          let porcCashIn: Big;
          let porcInversion: Big;

          // Si ya existe en creditos_inversionistas, jalar sus porcentajes
          const existenteEnPadre = inversionistasActuales.find(
            (inv) => inv.inversionista_id === inversionista_id,
          );

          if (existenteEnPadre && porcentaje_cash_in === undefined) {
            porcCashIn = new Big(existenteEnPadre.porcentaje_cash_in);
            porcInversion = new Big(
              existenteEnPadre.porcentaje_participacion_inversionista,
            );
          } else {
            porcCashIn = new Big(porcentaje_cash_in ?? 0);
            porcInversion = new Big(porcentaje_inversion ?? 100);
          }

          // 3f. Armar nuevo array de inversionistas
          const nuevoArray: {
            inversionista_id: number;
            monto_aportado: Big;
            porcentaje_cash_in: Big;
            porcentaje_inversion: Big;
            fecha_inicio_participacion: string;
          }[] = [];

          for (const inv of inversionistasActuales) {
            if (inv.inversionista_id === CUBE_INVESTMENT_ID) {
              // Restarle a CUBE
              const nuevoMontoCube = montoCubeActual.minus(montoNuevo);
              if (nuevoMontoCube.gt(0)) {
                nuevoArray.push({
                  inversionista_id: inv.inversionista_id,
                  monto_aportado: nuevoMontoCube,
                  porcentaje_cash_in: new Big(inv.porcentaje_cash_in),
                  porcentaje_inversion: new Big(
                    inv.porcentaje_participacion_inversionista,
                  ),
                  fecha_inicio_participacion: inv.fecha_inicio_participacion,
                });
              }
              // Si queda en 0, no se incluye (se elimina)
            } else if (inv.inversionista_id === inversionista_id) {
              // Si el inversionista ya existe, sumar su monto
              nuevoArray.push({
                inversionista_id: inv.inversionista_id,
                monto_aportado: new Big(inv.monto_aportado).plus(montoNuevo),
                porcentaje_cash_in: porcCashIn,
                porcentaje_inversion: porcInversion,
                fecha_inicio_participacion:
                  fecha_inicio_participacion ??
                  inv.fecha_inicio_participacion,
              });
            } else {
              nuevoArray.push({
                inversionista_id: inv.inversionista_id,
                monto_aportado: new Big(inv.monto_aportado),
                porcentaje_cash_in: new Big(inv.porcentaje_cash_in),
                porcentaje_inversion: new Big(
                  inv.porcentaje_participacion_inversionista,
                ),
                fecha_inicio_participacion: inv.fecha_inicio_participacion,
              });
            }
          }

          // Si el inversionista no existía en el padre, agregarlo
          const yaExiste = nuevoArray.some(
            (inv) => inv.inversionista_id === inversionista_id,
          );
          if (!yaExiste) {
            nuevoArray.push({
              inversionista_id,
              monto_aportado: montoNuevo,
              porcentaje_cash_in: porcCashIn,
              porcentaje_inversion: porcInversion,
              fecha_inicio_participacion:
                fecha_inicio_participacion ??
                new Date().toISOString().split("T")[0],
            });
          }

          // 3g. Recalcular todo para creditos_inversionistas (PADRE)
          const dataPadre = recalcularInversionistas(
            nuevoArray,
            creditoData,
            credito_id,
            creditoData.numero_credito_sifco,
          );

          // 3h. Borrar e insertar en creditos_inversionistas
          await tx
            .delete(creditos_inversionistas)
            .where(eq(creditos_inversionistas.credito_id, credito_id));

          if (dataPadre.length > 0) {
            await tx.insert(creditos_inversionistas).values(dataPadre);
          }

          // 3i. Armar cuotas del padre para el espejo
          const parentCuotas = new Map(
            dataPadre.map((p) => [
              p.inversionista_id,
              p.cuota_inversionista,
            ]),
          );

          // 3j. Recalcular para creditos_inversionistas_espejo
          const dataEspejo = recalcularInversionistas(
            nuevoArray,
            creditoData,
            credito_id,
            creditoData.numero_credito_sifco,
          );

          // Espejo hereda cuota del padre + asignar status
          const statusEspejo =
            tipo_operacion === "reinversion"
              ? "pendiente_reinversion"
              : "pendiente_compra_cartera";

          const dataEspejoConStatus = dataEspejo.map((inv) => ({
            ...inv,
            cuota_inversionista:
              parentCuotas.get(inv.inversionista_id) ??
              inv.cuota_inversionista,
            status:
              inv.inversionista_id === inversionista_id
                ? statusEspejo
                : "completado",
            updated_at: new Date(),
          }));

          // 3k. Borrar e insertar en creditos_inversionistas_espejo
          await tx
            .delete(creditos_inversionistas_espejo)
            .where(
              eq(creditos_inversionistas_espejo.credito_id, credito_id),
            );

          if (dataEspejoConStatus.length > 0) {
            await tx
              .insert(creditos_inversionistas_espejo)
              .values(dataEspejoConStatus);
          }

          resultados.push({
            credito_id,
            numero_credito_sifco: creditoData.numero_credito_sifco,
            inversionistas_padre: dataPadre.length,
            inversionistas_espejo: dataEspejoConStatus.length,
            cube_eliminado: !nuevoArray.some(
              (inv) => inv.inversionista_id === CUBE_INVESTMENT_ID,
            ),
          });

          console.log(
            `✅ Crédito ${creditoData.numero_credito_sifco} actualizado - ${dataPadre.length} inversionistas`,
          );
        } catch (err) {
          errores.push({
            credito_id: candidato.credito_id,
            razon:
              err instanceof Error ? err.message : String(err),
          });
        }
      }
    });

    set.status = 200;
    return {
      success: true,
      message: `Procesados: ${resultados.length} créditos, ${errores.length} errores`,
      resultados,
      errores,
    };
  } catch (error) {
    console.error("[addInvestorToCredit] Error:", error);
    set.status = 500;
    return {
      success: false,
      message: "Error al agregar inversionista a créditos",
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

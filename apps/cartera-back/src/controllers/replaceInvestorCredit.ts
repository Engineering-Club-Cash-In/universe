import Big from "big.js";
import { eq, and, inArray, ne } from "drizzle-orm";
import { db } from "../database";
import {
  creditos,
  creditos_inversionistas,
  creditos_inversionistas_espejo,
} from "../database/db";
import z from "zod";
import { getCreditCandidates } from "./assignCapital";

// ========================================
// ID fijo de CUBE INVESTMENTS S.A.
// CUBE es el inversionista principal/"la casa" al que se le
// resta/devuelve participación cuando entran/salen inversionistas.
// ========================================
const CUBE_INVESTMENT_ID = 86;

// ========================================
// SCHEMA DE VALIDACIÓN
// ========================================
// Recibe:
//   - creditos: un credito_id o un arreglo de credito_ids
//     Estos son los créditos ORIGINALES de donde se van a SACAR
//     los inversionistas pendientes y reubicarlos en créditos nuevos.
// ========================================

const replaceInvestorCreditSchema = z.object({
  creditos: z.union([
    z.number().int().positive(),
    z.array(z.number().int().positive()).min(1),
  ]),
});

// ========================================
// RECALCULAR INVERSIONISTAS
// ========================================
// Misma función que en addInvestorToCredit.ts
// Toma un array de inversionistas con montos redistribuidos y
// recalcula toda la distribución financiera:
//   - Porcentaje de participación
//   - Cuota del inversionista (mayor absorbe cargos fijos)
//   - Intereses y distribución cash-in/inversionista
//   - IVA 12%
// ========================================

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

    const cuotaInteres = inv.monto_aportado.times(tasaInteres.div(100)).round(2);

    const montoInversionista = cuotaInteres
      .times(inv.porcentaje_inversion)
      .div(100)
      .round(2);

    const montoCashIn = cuotaInteres
      .times(inv.porcentaje_cash_in)
      .div(100)
      .round(2);

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
// CONTROLLER PRINCIPAL: replaceInvestorCredit
// ========================================
//
// FLUJO GENERAL:
// Este método REVIERTE inversionistas pendientes de créditos viejos
// y los REUBICA en créditos nuevos.
//
// 1. Recibir credito_id(s) — los créditos ORIGINALES donde hay inversionistas pendientes
// 2. Buscar en esos créditos los registros espejo con status != "completado"
//    (pendiente_reinversion o pendiente_compra_cartera)
// 3. Agrupar por inversionista: juntar el monto total y tipo de operación
// 4. Para cada inversionista pendiente:
//    a. Llamar getCreditCandidates() → busca NUEVOS créditos (los viejos NO aparecen
//       porque todavía tienen pendings — por eso NO los borramos primero)
//    b. Distribuir el monto en los nuevos créditos (misma lógica de addInvestorToCredit:
//       restarle a CUBE, recalcular cuotas, nuke & rebuild en padre y espejo)
// 5. DESPUÉS de asignar los nuevos créditos, limpiar los VIEJOS:
//    a. Quitar al inversionista pendiente del crédito viejo (padre y espejo)
//    b. Devolverle el monto a CUBE
//    c. Recalcular cuotas de los inversionistas que quedan
//    d. Nuke & rebuild en ambas tablas
//
// ¿POR QUÉ BORRAR DESPUÉS Y NO ANTES?
// Porque getCreditCandidates() filtra créditos con espejo en status pendiente.
// Si borramos los pendings ANTES del GET, esos mismos créditos aparecerían
// como candidatos y el inversionista podría terminar en el mismo crédito
// del que lo estamos sacando. Borrando DESPUÉS, nos aseguramos de que
// los nuevos créditos sean realmente NUEVOS.
//
// EJEMPLO:
//   Crédito 101 tiene a inversionista 42 con Q20,000 en status "pendiente_reinversion"
//   1. Buscamos nuevos candidatos → el crédito 101 NO aparece (tiene pending)
//   2. Encontramos crédito 205 y 310 como candidatos
//   3. Distribuimos Q20,000 entre crédito 205 y 310 (restando a CUBE en cada uno)
//   4. AHORA sí limpiamos crédito 101:
//      - Sacamos a inversionista 42
//      - Le devolvemos Q20,000 a CUBE
//      - Recalculamos cuotas de los que quedan
// ========================================

export const replaceInvestorCredit = async ({ body, set }: any) => {
  try {
    // ================================================================
    // PASO 1: VALIDAR SCHEMA
    // Acepta un solo credito_id o un arreglo de credito_ids.
    // Estos son los créditos de donde se van a SACAR los inversionistas
    // pendientes para reubicarlos.
    // ================================================================
    const parseResult = replaceInvestorCreditSchema.safeParse(body);
    if (!parseResult.success) {
      set.status = 400;
      return {
        message: "Validation failed",
        errors: parseResult.error.flatten().fieldErrors,
      };
    }

    const { creditos: creditosInput } = parseResult.data;

    // Normalizar a array
    const creditoIds = Array.isArray(creditosInput)
      ? creditosInput
      : [creditosInput];

    // ================================================================
    // PASO 2: BUSCAR INVERSIONISTAS PENDIENTES EN LOS CRÉDITOS INDICADOS
    // Traemos todos los registros de creditos_inversionistas_espejo que
    // NO tienen status "completado". Estos son los que vamos a revertir.
    //
    // De cada registro necesitamos:
    //   - inversionista_id: quién es
    //   - credito_id: de qué crédito lo vamos a sacar
    //   - monto_aportado: cuánto tiene (para redistribuir)
    //   - status: para saber el tipo_operacion (reinversion o compra_cartera)
    //   - porcentaje_cash_in / porcentaje_participacion: para reusar
    // ================================================================
    const pendientes = await db
      .select({
        id: creditos_inversionistas_espejo.id,
        credito_id: creditos_inversionistas_espejo.credito_id,
        inversionista_id: creditos_inversionistas_espejo.inversionista_id,
        monto_aportado: creditos_inversionistas_espejo.monto_aportado,
        porcentaje_cash_in: creditos_inversionistas_espejo.porcentaje_cash_in,
        porcentaje_participacion_inversionista:
          creditos_inversionistas_espejo.porcentaje_participacion_inversionista,
        status: creditos_inversionistas_espejo.status,
      })
      .from(creditos_inversionistas_espejo)
      .where(
        and(
          inArray(creditos_inversionistas_espejo.credito_id, creditoIds),
          ne(creditos_inversionistas_espejo.status, "completado"),
        ),
      );

    if (pendientes.length === 0) {
      set.status = 404;
      return {
        success: false,
        message: "No se encontraron inversionistas pendientes en los créditos indicados",
      };
    }

    // ================================================================
    // PASO 3: AGRUPAR POR INVERSIONISTA
    // Un mismo inversionista puede estar pendiente en varios créditos.
    // Agrupamos para saber:
    //   - Monto total a redistribuir (suma de todos sus montos pendientes)
    //   - Tipo de operación (reinversion o compra_cartera)
    //   - Porcentajes (tomamos los del primer registro encontrado)
    //   - De qué créditos hay que sacarlo (para la limpieza posterior)
    //
    // Ejemplo:
    //   Inversionista 42 pendiente en crédito 101 (Q15,000) y crédito 102 (Q10,000)
    //   → montoTotal = Q25,000
    //   → creditosOrigen = [101, 102]
    // ================================================================
    const porInversionista = new Map<
      number,
      {
        inversionista_id: number;
        montoTotal: Big;
        tipo_operacion: "reinversion" | "compra_cartera";
        porcentaje_cash_in: string;
        porcentaje_inversion: string;
        creditosOrigen: { credito_id: number; monto: string }[];
      }
    >();

    for (const p of pendientes) {
      if (!porInversionista.has(p.inversionista_id)) {
        porInversionista.set(p.inversionista_id, {
          inversionista_id: p.inversionista_id,
          montoTotal: new Big(0),
          tipo_operacion:
            p.status === "pendiente_reinversion"
              ? "reinversion"
              : "compra_cartera",
          porcentaje_cash_in: p.porcentaje_cash_in,
          porcentaje_inversion: p.porcentaje_participacion_inversionista,
          creditosOrigen: [],
        });
      }
      const entry = porInversionista.get(p.inversionista_id)!;
      entry.montoTotal = entry.montoTotal.plus(p.monto_aportado);
      entry.creditosOrigen.push({
        credito_id: p.credito_id,
        monto: p.monto_aportado,
      });
    }

    console.log(
      `🔄 ${porInversionista.size} inversionista(s) pendiente(s) a reubicar`,
    );

    const resultadosNuevos: any[] = [];
    const resultadosLimpieza: any[] = [];
    const errores: any[] = [];

    // ================================================================
    // PASO 4: PARA CADA INVERSIONISTA PENDIENTE, BUSCAR NUEVOS CRÉDITOS
    // Y DISTRIBUIR SU MONTO
    //
    // IMPORTANTE: Hacemos esto ANTES de limpiar los créditos viejos.
    // ¿Por qué? Porque getCreditCandidates() filtra créditos con espejo
    // en status pendiente. Si borramos los pendings primero, esos mismos
    // créditos aparecerían como candidatos y el inversionista podría
    // terminar en el mismo crédito del que lo sacamos.
    //
    // Al hacer el GET primero, garantizamos que los candidatos sean
    // créditos DIFERENTES a los que ya tienen pendings.
    // ================================================================
    await db.transaction(async (tx) => {
      for (const [, invData] of porInversionista) {
        const {
          inversionista_id,
          montoTotal,
          tipo_operacion,
          porcentaje_cash_in,
          porcentaje_inversion,
          creditosOrigen,
        } = invData;

        console.log(
          `\n📊 Procesando inversionista ${inversionista_id} - Q${montoTotal} desde ${creditosOrigen.length} crédito(s)`,
        );

        // ── 4a. Buscar NUEVOS créditos candidatos ──
        // El GET no traerá los créditos viejos porque tienen pendings
        const candidatos = await getCreditCandidates(montoTotal.toNumber());

        if (candidatos.length === 0) {
          errores.push({
            inversionista_id,
            razon: "No se encontraron créditos candidatos nuevos",
          });
          continue;
        }

        // ── 4b. Distribuir el monto entre los nuevos créditos ──
        // Misma lógica que addInvestorToCredit: ir crédito por crédito,
        // tomar lo que CUBE tenga disponible, pasar al siguiente si no alcanza.
        let montoRestante = new Big(montoTotal);
        const porcCashIn = new Big(porcentaje_cash_in);
        const porcInversion = new Big(porcentaje_inversion);

        const statusEspejo =
          tipo_operacion === "reinversion"
            ? "pendiente_reinversion"
            : "pendiente_compra_cartera";

        for (const candidato of candidatos) {
          if (montoRestante.lte(0)) break;

          const { credito_id, numero_credito_sifco, credito_completo } = candidato;

          if (!credito_completo) continue;

          const { credito: creditoRaw, inversionistas_detalle } = credito_completo;

          const creditoData = {
            cuota: creditoRaw.cuota,
            porcentaje_interes: creditoRaw.porcentaje_interes,
            seguro_10_cuotas: creditoRaw.seguro_10_cuotas,
            gps: creditoRaw.gps,
            membresias_pago: creditoRaw.membresias_pago,
          };

          const inversionistasActuales = inversionistas_detalle.map((inv: any) => ({
            inversionista_id: inv.inversionista_id,
            monto_aportado: inv.monto_aportado,
            porcentaje_cash_in: inv.porcentaje_cash_in,
            porcentaje_participacion_inversionista:
              inv.porcentaje_participacion_inversionista,
            fecha_inicio_participacion: inv.fecha_inicio_participacion,
          }));

          // ── Buscar CUBE en el nuevo crédito ──
          const cubeActual = inversionistasActuales.find(
            (inv: any) => inv.inversionista_id === CUBE_INVESTMENT_ID,
          );

          if (!cubeActual) continue;

          const montoCubeActual = new Big(cubeActual.monto_aportado);

          // ── Cuánto tomar: lo que CUBE tenga o lo que falta, lo que sea menor ──
          const montoParaEsteCredito = montoRestante.gt(montoCubeActual)
            ? montoCubeActual
            : montoRestante;

          // ── Armar nuevo array de inversionistas para el nuevo crédito ──
          const nuevoArray: {
            inversionista_id: number;
            monto_aportado: Big;
            porcentaje_cash_in: Big;
            porcentaje_inversion: Big;
            fecha_inicio_participacion: string;
          }[] = [];

          for (const inv of inversionistasActuales) {
            if (inv.inversionista_id === CUBE_INVESTMENT_ID) {
              const nuevoMontoCube = montoCubeActual.minus(montoParaEsteCredito);
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
            } else if (inv.inversionista_id === inversionista_id) {
              nuevoArray.push({
                inversionista_id: inv.inversionista_id,
                monto_aportado: new Big(inv.monto_aportado).plus(montoParaEsteCredito),
                porcentaje_cash_in: porcCashIn,
                porcentaje_inversion: porcInversion,
                fecha_inicio_participacion: inv.fecha_inicio_participacion,
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

          // Si el inversionista no existía en este crédito, agregarlo
          const yaExiste = nuevoArray.some(
            (inv) => inv.inversionista_id === inversionista_id,
          );
          if (!yaExiste) {
            nuevoArray.push({
              inversionista_id,
              monto_aportado: montoParaEsteCredito,
              porcentaje_cash_in: porcCashIn,
              porcentaje_inversion: porcInversion,
              fecha_inicio_participacion: new Date().toISOString().split("T")[0],
            });
          }

          // ── Recalcular y nuke & rebuild en PADRE ──
          const dataPadre = recalcularInversionistas(
            nuevoArray,
            creditoData,
            credito_id,
            numero_credito_sifco,
          );

          await tx
            .delete(creditos_inversionistas)
            .where(eq(creditos_inversionistas.credito_id, credito_id));

          if (dataPadre.length > 0) {
            await tx.insert(creditos_inversionistas).values(dataPadre);
          }

          // ── Recalcular y nuke & rebuild en ESPEJO ──
          const parentCuotas = new Map(
            dataPadre.map((p) => [p.inversionista_id, p.cuota_inversionista]),
          );

          const dataEspejo = recalcularInversionistas(
            nuevoArray,
            creditoData,
            credito_id,
            numero_credito_sifco,
          );

          const dataEspejoConStatus = dataEspejo.map((inv) => ({
            ...inv,
            cuota_inversionista:
              parentCuotas.get(inv.inversionista_id) ??
              inv.cuota_inversionista,
            status: (inv.inversionista_id === inversionista_id
              ? statusEspejo
              : "completado") as
              | "pendiente_reinversion"
              | "pendiente_compra_cartera"
              | "completado",
            updated_at: new Date(),
          }));

          await tx
            .delete(creditos_inversionistas_espejo)
            .where(eq(creditos_inversionistas_espejo.credito_id, credito_id));

          if (dataEspejoConStatus.length > 0) {
            await tx
              .insert(creditos_inversionistas_espejo)
              .values(dataEspejoConStatus);
          }

          montoRestante = montoRestante.minus(montoParaEsteCredito);

          resultadosNuevos.push({
            credito_id,
            numero_credito_sifco,
            inversionista_id,
            monto_asignado: montoParaEsteCredito.toString(),
            cube_eliminado: !nuevoArray.some(
              (inv) => inv.inversionista_id === CUBE_INVESTMENT_ID,
            ),
          });

          console.log(
            `   ✅ Nuevo crédito ${numero_credito_sifco} - asignado Q${montoParaEsteCredito} - quedan Q${montoRestante}`,
          );
        }

        // ================================================================
        // PASO 5: LIMPIAR LOS CRÉDITOS VIEJOS
        // AHORA que ya asignamos los nuevos créditos, volvemos a los viejos
        // y limpiamos:
        //   - Sacamos al inversionista pendiente del padre y espejo
        //   - Le devolvemos el monto a CUBE
        //   - Recalculamos las cuotas de los que quedan
        //
        // Para cada crédito origen:
        //   a. Traer inversionistas actuales del padre
        //   b. Quitar al inversionista pendiente del array
        //   c. Sumarle su monto a CUBE (devolverle lo que le quitamos)
        //   d. Recalcular todo
        //   e. Nuke & rebuild en padre y espejo
        // ================================================================
        for (const origen of creditosOrigen) {
          const { credito_id: origenCreditoId, monto: montoOrigen } = origen;

          console.log(
            `   🧹 Limpiando crédito origen ${origenCreditoId} - devolviendo Q${montoOrigen} a CUBE`,
          );

          // ── Traer data fresca del crédito origen ──
          const [creditoOrigenData] = await tx
            .select({
              credito_id: creditos.credito_id,
              cuota: creditos.cuota,
              porcentaje_interes: creditos.porcentaje_interes,
              seguro_10_cuotas: creditos.seguro_10_cuotas,
              gps: creditos.gps,
              membresias_pago: creditos.membresias_pago,
              numero_credito_sifco: creditos.numero_credito_sifco,
            })
            .from(creditos)
            .where(eq(creditos.credito_id, origenCreditoId))
            .limit(1);

          if (!creditoOrigenData) continue;

          // ── Traer inversionistas actuales del padre ──
          const invActualesOrigen = await tx
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
            .where(eq(creditos_inversionistas.credito_id, origenCreditoId));

          // ── Armar array SIN el inversionista pendiente y CON CUBE restaurado ──
          const arrayLimpio: {
            inversionista_id: number;
            monto_aportado: Big;
            porcentaje_cash_in: Big;
            porcentaje_inversion: Big;
            fecha_inicio_participacion: string;
          }[] = [];

          for (const inv of invActualesOrigen) {
            if (inv.inversionista_id === inversionista_id) {
              // ── Quitar al inversionista pendiente ──
              // No lo incluimos en el array, se va del crédito
              continue;
            } else if (inv.inversionista_id === CUBE_INVESTMENT_ID) {
              // ── CUBE: devolverle el monto del inversionista que sale ──
              arrayLimpio.push({
                inversionista_id: inv.inversionista_id,
                monto_aportado: new Big(inv.monto_aportado).plus(montoOrigen),
                porcentaje_cash_in: new Big(inv.porcentaje_cash_in),
                porcentaje_inversion: new Big(
                  inv.porcentaje_participacion_inversionista,
                ),
                fecha_inicio_participacion: inv.fecha_inicio_participacion,
              });
            } else {
              // ── Los demás: se quedan igual ──
              arrayLimpio.push({
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

          // ── Si CUBE no existía (raro pero por seguridad), crearlo con el monto devuelto ──
          const cubeEnArray = arrayLimpio.some(
            (inv) => inv.inversionista_id === CUBE_INVESTMENT_ID,
          );
          if (!cubeEnArray) {
            arrayLimpio.push({
              inversionista_id: CUBE_INVESTMENT_ID,
              monto_aportado: new Big(montoOrigen),
              porcentaje_cash_in: new Big(0),
              porcentaje_inversion: new Big(100),
              fecha_inicio_participacion: "2025-12-01",
            });
          }

          // ── Recalcular y nuke & rebuild PADRE del crédito origen ──
          const dataPadreOrigen = recalcularInversionistas(
            arrayLimpio,
            creditoOrigenData,
            origenCreditoId,
            creditoOrigenData.numero_credito_sifco,
          );

          await tx
            .delete(creditos_inversionistas)
            .where(eq(creditos_inversionistas.credito_id, origenCreditoId));

          if (dataPadreOrigen.length > 0) {
            await tx.insert(creditos_inversionistas).values(dataPadreOrigen);
          }

          // ── Recalcular y nuke & rebuild ESPEJO del crédito origen ──
          // Solo los inversionistas que quedan (sin el pendiente), todos con status "completado"
          const parentCuotasOrigen = new Map(
            dataPadreOrigen.map((p) => [
              p.inversionista_id,
              p.cuota_inversionista,
            ]),
          );

          const dataEspejoOrigen = recalcularInversionistas(
            arrayLimpio,
            creditoOrigenData,
            origenCreditoId,
            creditoOrigenData.numero_credito_sifco,
          );

          const dataEspejoOrigenFinal = dataEspejoOrigen.map((inv) => ({
            ...inv,
            cuota_inversionista:
              parentCuotasOrigen.get(inv.inversionista_id) ??
              inv.cuota_inversionista,
            status: "completado" as const,
            updated_at: new Date(),
          }));

          await tx
            .delete(creditos_inversionistas_espejo)
            .where(
              eq(creditos_inversionistas_espejo.credito_id, origenCreditoId),
            );

          if (dataEspejoOrigenFinal.length > 0) {
            await tx
              .insert(creditos_inversionistas_espejo)
              .values(dataEspejoOrigenFinal);
          }

          resultadosLimpieza.push({
            credito_id: origenCreditoId,
            numero_credito_sifco: creditoOrigenData.numero_credito_sifco,
            inversionista_removido: inversionista_id,
            monto_devuelto_a_cube: montoOrigen,
            inversionistas_restantes: dataPadreOrigen.length,
          });

          console.log(
            `   🧹 Crédito ${creditoOrigenData.numero_credito_sifco} limpio - ${dataPadreOrigen.length} inversionistas restantes`,
          );
        }
      }
    });

    // ================================================================
    // PASO 6: RESPUESTA FINAL
    // Devuelve el detalle de:
    //   - nuevos_creditos: a dónde fueron los inversionistas
    //   - creditos_limpiados: de dónde se sacaron y cómo quedaron
    //   - errores: si algo falló
    // ================================================================
    set.status = 200;
    return {
      success: true,
      message: `Reubicados: ${resultadosNuevos.length} nuevos, ${resultadosLimpieza.length} limpiados, ${errores.length} errores`,
      nuevos_creditos: resultadosNuevos,
      creditos_limpiados: resultadosLimpieza,
      errores,
    };
  } catch (error) {
    console.error("[replaceInvestorCredit] Error:", error);
    set.status = 500;
    return {
      success: false,
      message: "Error al reubicar inversionistas",
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

// ========================================
// SCHEMA DE VALIDACIÓN - REASIGNACIÓN MANUAL
// ========================================
// Este endpoint NO usa getCreditCandidates.
// Vos le decís exactamente:
//   - De qué crédito sacar al inversionista (credito_espejo_removido_id)
//   - A qué créditos moverlo y con cuánto (reasignaciones[])
//   - Qué tipo de operación es (para el status del espejo)
//   - Opcionalmente porcentajes (si no, se jalan del padre si ya existe)
//
// El monto que se saca del crédito origen se le devuelve a CUBE.
// En los créditos destino se le resta a CUBE el monto asignado.
// Todo se recalcula en ambas tablas (padre y espejo).
// ========================================

const manualReassignSchema = z.object({
  inversionista_id: z.number().int().positive(),
  credito_espejo_removido_id: z.number().int().positive(),
  tipo_operacion: z.enum(["reinversion", "compra_cartera"]).default("reinversion"),
  porcentaje_cash_in: z.number().min(0).max(100).optional(),
  porcentaje_inversion: z.number().min(0).max(100).optional(),
  reasignaciones: z
    .array(
      z.object({
        credito_destino_id: z.number().int().positive(),
        monto: z.number().positive(),
      }),
    )
    .min(1),
});

// ========================================
// CONTROLLER: manualReassignInvestor
// ========================================
//
// FLUJO:
// 1. Validar el body
// 2. Traer la data del crédito ORIGEN y sus inversionistas
// 3. Encontrar al inversionista en el crédito origen y obtener su monto
// 4. PRIMERO: Procesar las REASIGNACIONES (agregar a créditos destino)
//    Para cada crédito destino:
//      a. Traer data del crédito e inversionistas actuales
//      b. Restarle a CUBE el monto de la reasignación
//      c. Agregar al inversionista (o sumarle si ya existía)
//      d. Recalcular todo
//      e. Nuke & rebuild en padre y espejo
// 5. DESPUÉS: Limpiar el crédito ORIGEN
//      a. Quitar al inversionista del array
//      b. Devolverle su monto a CUBE
//      c. Si CUBE no existía (fue eliminado antes), crearlo con el monto devuelto
//      d. Recalcular todo
//      e. Nuke & rebuild en padre y espejo (espejo queda todo "completado")
//
// EJEMPLO:
//   Body:
//   {
//     "inversionista_id": 108,
//     "credito_espejo_removido_id": 8784,
//     "tipo_operacion": "reinversion",
//     "reasignaciones": [
//       { "credito_destino_id": 8827, "monto": 60000 },
//       { "credito_destino_id": 8802, "monto": 40000 }
//     ]
//   }
//
//   Resultado:
//   - Crédito 8784: Luis sale, Q100,000 devueltos a CUBE, recalculado
//   - Crédito 8827: Luis entra con Q60,000, restado de CUBE, recalculado
//   - Crédito 8802: Luis entra con Q40,000, restado de CUBE, recalculado
// ========================================

export const manualReassignInvestor = async ({ body, set }: any) => {
  try {
    // ================================================================
    // PASO 1: VALIDAR SCHEMA
    // ================================================================
    const parseResult = manualReassignSchema.safeParse(body);
    if (!parseResult.success) {
      set.status = 400;
      return {
        message: "Validation failed",
        errors: parseResult.error.flatten().fieldErrors,
      };
    }

    const {
      inversionista_id,
      credito_espejo_removido_id,
      tipo_operacion,
      porcentaje_cash_in,
      porcentaje_inversion,
      reasignaciones,
    } = parseResult.data;

    const resultadosAsignacion: any[] = [];
    const errores: any[] = [];
    let origenInfo: { credito_id: number; numero_credito_sifco: string; monto_devuelto: string } | null = null;

    await db.transaction(async (tx) => {
      // ================================================================
      // PASO 2: TRAER DATA DEL CRÉDITO ORIGEN
      // Necesitamos saber cuánto tiene el inversionista ahí para
      // devolverle ese monto a CUBE cuando lo saquemos.
      // ================================================================
      const [creditoOrigen] = await tx
        .select({
          credito_id: creditos.credito_id,
          cuota: creditos.cuota,
          porcentaje_interes: creditos.porcentaje_interes,
          seguro_10_cuotas: creditos.seguro_10_cuotas,
          gps: creditos.gps,
          membresias_pago: creditos.membresias_pago,
          numero_credito_sifco: creditos.numero_credito_sifco,
        })
        .from(creditos)
        .where(eq(creditos.credito_id, credito_espejo_removido_id))
        .limit(1);

      if (!creditoOrigen) {
        set.status = 404;
        return { success: false, message: "Crédito origen no encontrado" };
      }

      // ── Traer inversionistas actuales del origen (padre) ──
      const invOrigenActuales = await tx
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
        .where(eq(creditos_inversionistas.credito_id, credito_espejo_removido_id));

      // ── Verificar que el inversionista esté en el crédito origen ──
      const invEnOrigen = invOrigenActuales.find(
        (inv) => inv.inversionista_id === inversionista_id,
      );

      if (!invEnOrigen) {
        set.status = 404;
        return {
          success: false,
          message: `Inversionista ${inversionista_id} no encontrado en crédito ${credito_espejo_removido_id}`,
        };
      }

      const montoEnOrigen = new Big(invEnOrigen.monto_aportado);

      console.log(
        `\n🔄 Reasignación manual: inversionista ${inversionista_id}`,
      );
      console.log(
        `   Origen: crédito ${creditoOrigen.numero_credito_sifco} - Q${montoEnOrigen}`,
      );

      // ================================================================
      // PASO 3: DETERMINAR PORCENTAJES
      // Si vienen en el body, usar esos. Si no, jalar del crédito origen.
      // ================================================================
      const porcCashIn = new Big(
        porcentaje_cash_in ?? Number(invEnOrigen.porcentaje_cash_in),
      );
      const porcInversion = new Big(
        porcentaje_inversion ??
          Number(invEnOrigen.porcentaje_participacion_inversionista),
      );

      const statusEspejo =
        tipo_operacion === "reinversion"
          ? "pendiente_reinversion"
          : "pendiente_compra_cartera";

      // ================================================================
      // PASO 4: PROCESAR REASIGNACIONES (AGREGAR A CRÉDITOS DESTINO)
      // Para cada crédito destino:
      //   - Traer data del crédito e inversionistas
      //   - Restarle a CUBE el monto
      //   - Agregar al inversionista
      //   - Recalcular todo y nuke & rebuild en padre y espejo
      // ================================================================
      for (const reasignacion of reasignaciones) {
        const { credito_destino_id, monto } = reasignacion;
        const montoAsignar = new Big(monto);

        console.log(
          `\n   📌 Asignando Q${montoAsignar} a crédito ${credito_destino_id}`,
        );

        // ── Traer data del crédito destino ──
        const [creditoDestino] = await tx
          .select({
            credito_id: creditos.credito_id,
            cuota: creditos.cuota,
            porcentaje_interes: creditos.porcentaje_interes,
            seguro_10_cuotas: creditos.seguro_10_cuotas,
            gps: creditos.gps,
            membresias_pago: creditos.membresias_pago,
            numero_credito_sifco: creditos.numero_credito_sifco,
          })
          .from(creditos)
          .where(eq(creditos.credito_id, credito_destino_id))
          .limit(1);

        if (!creditoDestino) {
          errores.push({
            credito_destino_id,
            razon: "Crédito destino no encontrado",
          });
          continue;
        }

        // ── Traer inversionistas actuales del destino ──
        const invDestinoActuales = await tx
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
          .where(eq(creditos_inversionistas.credito_id, credito_destino_id));

        // ── Buscar CUBE en el destino ──
        const cubeDestino = invDestinoActuales.find(
          (inv) => inv.inversionista_id === CUBE_INVESTMENT_ID,
        );

        if (!cubeDestino) {
          errores.push({
            credito_destino_id,
            razon: "CUBE no encontrado en crédito destino",
          });
          continue;
        }

        const montoCubeDestino = new Big(cubeDestino.monto_aportado);

        // ── Validar que CUBE tenga suficiente ──
        if (montoAsignar.gt(montoCubeDestino)) {
          errores.push({
            credito_destino_id,
            razon: `Monto Q${montoAsignar} excede CUBE Q${montoCubeDestino} en crédito destino`,
          });
          continue;
        }

        // ── Armar nuevo array: restar a CUBE, agregar inversionista ──
        const nuevoArrayDestino: {
          inversionista_id: number;
          monto_aportado: Big;
          porcentaje_cash_in: Big;
          porcentaje_inversion: Big;
          fecha_inicio_participacion: string;
        }[] = [];

        for (const inv of invDestinoActuales) {
          if (inv.inversionista_id === CUBE_INVESTMENT_ID) {
            // ── Restarle a CUBE ──
            const nuevoMontoCube = montoCubeDestino.minus(montoAsignar);
            if (nuevoMontoCube.gt(0)) {
              nuevoArrayDestino.push({
                inversionista_id: inv.inversionista_id,
                monto_aportado: nuevoMontoCube,
                porcentaje_cash_in: new Big(inv.porcentaje_cash_in),
                porcentaje_inversion: new Big(
                  inv.porcentaje_participacion_inversionista,
                ),
                fecha_inicio_participacion: inv.fecha_inicio_participacion,
              });
            }
            // Si queda en 0, CUBE se elimina
          } else if (inv.inversionista_id === inversionista_id) {
            // ── Inversionista ya existía: sumarle ──
            nuevoArrayDestino.push({
              inversionista_id: inv.inversionista_id,
              monto_aportado: new Big(inv.monto_aportado).plus(montoAsignar),
              porcentaje_cash_in: porcCashIn,
              porcentaje_inversion: porcInversion,
              fecha_inicio_participacion: inv.fecha_inicio_participacion,
            });
          } else {
            // ── Otro inversionista: copiar igual ──
            nuevoArrayDestino.push({
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

        // ── Si el inversionista no existía en el destino, agregarlo ──
        const yaExisteDestino = nuevoArrayDestino.some(
          (inv) => inv.inversionista_id === inversionista_id,
        );
        if (!yaExisteDestino) {
          nuevoArrayDestino.push({
            inversionista_id,
            monto_aportado: montoAsignar,
            porcentaje_cash_in: porcCashIn,
            porcentaje_inversion: porcInversion,
            fecha_inicio_participacion: new Date().toISOString().split("T")[0],
          });
        }

        // ── Recalcular y nuke & rebuild PADRE del destino ──
        const dataPadreDestino = recalcularInversionistas(
          nuevoArrayDestino,
          creditoDestino,
          credito_destino_id,
          creditoDestino.numero_credito_sifco,
        );

        await tx
          .delete(creditos_inversionistas)
          .where(eq(creditos_inversionistas.credito_id, credito_destino_id));

        if (dataPadreDestino.length > 0) {
          await tx.insert(creditos_inversionistas).values(dataPadreDestino);
        }

        // ── Recalcular y nuke & rebuild ESPEJO del destino ──
        const parentCuotasDestino = new Map(
          dataPadreDestino.map((p) => [
            p.inversionista_id,
            p.cuota_inversionista,
          ]),
        );

        const dataEspejoDestino = recalcularInversionistas(
          nuevoArrayDestino,
          creditoDestino,
          credito_destino_id,
          creditoDestino.numero_credito_sifco,
        );

        const dataEspejoDestinoFinal = dataEspejoDestino.map((inv) => ({
          ...inv,
          cuota_inversionista:
            parentCuotasDestino.get(inv.inversionista_id) ??
            inv.cuota_inversionista,
          status: (inv.inversionista_id === inversionista_id
            ? statusEspejo
            : "completado") as
            | "pendiente_reinversion"
            | "pendiente_compra_cartera"
            | "completado",
          updated_at: new Date(),
        }));

        await tx
          .delete(creditos_inversionistas_espejo)
          .where(
            eq(creditos_inversionistas_espejo.credito_id, credito_destino_id),
          );

        if (dataEspejoDestinoFinal.length > 0) {
          await tx
            .insert(creditos_inversionistas_espejo)
            .values(dataEspejoDestinoFinal);
        }

        resultadosAsignacion.push({
          credito_destino_id,
          numero_credito_sifco: creditoDestino.numero_credito_sifco,
          monto_asignado: montoAsignar.toString(),
          inversionistas_padre: dataPadreDestino.length,
          inversionistas_espejo: dataEspejoDestinoFinal.length,
          cube_eliminado: !nuevoArrayDestino.some(
            (inv) => inv.inversionista_id === CUBE_INVESTMENT_ID,
          ),
        });

        console.log(
          `   ✅ Crédito ${creditoDestino.numero_credito_sifco} - Q${montoAsignar} asignado`,
        );
      }

      // ================================================================
      // PASO 5: LIMPIAR EL CRÉDITO ORIGEN
      // Ahora que las reasignaciones están hechas, sacamos al inversionista
      // del crédito origen y le devolvemos su monto a CUBE.
      //
      // - Quitar al inversionista del array
      // - Sumarle su monto a CUBE (devolverle lo que le quitamos)
      // - Si CUBE no existía (fue eliminado), crearlo con el monto devuelto
      // - Recalcular todo
      // - Nuke & rebuild en AMBAS tablas (padre y espejo)
      // - Espejo queda todo como "completado"
      // ================================================================
      console.log(
        `\n🧹 Limpiando crédito origen ${creditoOrigen.numero_credito_sifco} - devolviendo Q${montoEnOrigen} a CUBE`,
      );

      // ── Re-traer inversionistas del origen (pueden haber cambiado si el origen
      //    también era un destino en las reasignaciones) ──
      const invOrigenFresh = await tx
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
        .where(eq(creditos_inversionistas.credito_id, credito_espejo_removido_id));

      // ── Armar array SIN el inversionista y CON CUBE restaurado ──
      const arrayOrigenLimpio: {
        inversionista_id: number;
        monto_aportado: Big;
        porcentaje_cash_in: Big;
        porcentaje_inversion: Big;
        fecha_inicio_participacion: string;
      }[] = [];

      for (const inv of invOrigenFresh) {
        if (inv.inversionista_id === inversionista_id) {
          // ── Quitar al inversionista: no incluir ──
          continue;
        } else if (inv.inversionista_id === CUBE_INVESTMENT_ID) {
          // ── CUBE: devolverle el monto ──
          arrayOrigenLimpio.push({
            inversionista_id: inv.inversionista_id,
            monto_aportado: new Big(inv.monto_aportado).plus(montoEnOrigen),
            porcentaje_cash_in: new Big(inv.porcentaje_cash_in),
            porcentaje_inversion: new Big(
              inv.porcentaje_participacion_inversionista,
            ),
            fecha_inicio_participacion: inv.fecha_inicio_participacion,
          });
        } else {
          // ── Otros: copiar igual ──
          arrayOrigenLimpio.push({
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

      // ── Si CUBE no existía en el origen (raro), crearlo ──
      const cubeEnOrigen = arrayOrigenLimpio.some(
        (inv) => inv.inversionista_id === CUBE_INVESTMENT_ID,
      );
      if (!cubeEnOrigen) {
        arrayOrigenLimpio.push({
          inversionista_id: CUBE_INVESTMENT_ID,
          monto_aportado: montoEnOrigen,
          porcentaje_cash_in: new Big(0),
          porcentaje_inversion: new Big(100),
          fecha_inicio_participacion: "2025-12-01",
        });
      }

      // ── Recalcular y nuke & rebuild PADRE del origen ──
      const dataPadreOrigenFinal = recalcularInversionistas(
        arrayOrigenLimpio,
        creditoOrigen,
        credito_espejo_removido_id,
        creditoOrigen.numero_credito_sifco,
      );

      await tx
        .delete(creditos_inversionistas)
        .where(eq(creditos_inversionistas.credito_id, credito_espejo_removido_id));

      if (dataPadreOrigenFinal.length > 0) {
        await tx.insert(creditos_inversionistas).values(dataPadreOrigenFinal);
      }

      // ── Recalcular y nuke & rebuild ESPEJO del origen ──
      // Todo queda como "completado" porque el inversionista ya se fue
      const parentCuotasOrigenFinal = new Map(
        dataPadreOrigenFinal.map((p) => [
          p.inversionista_id,
          p.cuota_inversionista,
        ]),
      );

      const dataEspejoOrigenFinal = recalcularInversionistas(
        arrayOrigenLimpio,
        creditoOrigen,
        credito_espejo_removido_id,
        creditoOrigen.numero_credito_sifco,
      );

      const dataEspejoOrigenConStatus = dataEspejoOrigenFinal.map((inv) => ({
        ...inv,
        cuota_inversionista:
          parentCuotasOrigenFinal.get(inv.inversionista_id) ??
          inv.cuota_inversionista,
        status: "completado" as const,
        updated_at: new Date(),
      }));

      await tx
        .delete(creditos_inversionistas_espejo)
        .where(
          eq(
            creditos_inversionistas_espejo.credito_id,
            credito_espejo_removido_id,
          ),
        );

      if (dataEspejoOrigenConStatus.length > 0) {
        await tx
          .insert(creditos_inversionistas_espejo)
          .values(dataEspejoOrigenConStatus);
      }

      console.log(
        `   🧹 Crédito origen ${creditoOrigen.numero_credito_sifco} limpio - ${dataPadreOrigenFinal.length} inversionistas restantes`,
      );

      // Guardar info del origen para la respuesta
      origenInfo = {
        credito_id: credito_espejo_removido_id,
        numero_credito_sifco: creditoOrigen.numero_credito_sifco,
        monto_devuelto: montoEnOrigen.toString(),
      };
    });

    // ================================================================
    // PASO 6: RESPUESTA FINAL
    // ================================================================
    set.status = 200;
    return {
      success: true,
      message: `Reasignación manual completada: ${resultadosAsignacion.length} destinos, ${errores.length} errores`,
      credito_origen: {
        credito_id: origenInfo?.credito_id,
        numero_credito_sifco: origenInfo?.numero_credito_sifco,
        inversionista_removido: inversionista_id,
        monto_devuelto_a_cube: origenInfo?.monto_devuelto,
      },
      reasignaciones: resultadosAsignacion,
      errores,
    };
  } catch (error) {
    console.error("[manualReassignInvestor] Error:", error);
    set.status = 500;
    return {
      success: false,
      message: "Error en reasignación manual",
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

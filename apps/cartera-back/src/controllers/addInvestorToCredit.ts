import Big from "big.js";
import { and, eq, isNull } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { db } from "../database";
import {
  admins,
  asesores,
  creditos,
  creditos_inversionistas,
  creditos_inversionistas_espejo,
  inversionistas,
  platform_users,
} from "../database/db";
import z from "zod";
import { getCreditCandidates } from "./assignCapital";
import { sendInvestorAddedToCreditsNotification } from "@cci/email";

const JWT_SECRET = process.env.JWT_SECRET || "supersecreto";

// ================================================================
// DESTINATARIOS DEL CORREO "COMPRA DE CARTERA POR VALIDAR"
// Solo se usa en el correo que dispara addInvestorToCredit cuando
// tipo_operacion === "compra_cartera". Va al equipo interno chico.
// ================================================================
const COMPRA_CARTERA_PENDIENTE_RECIPIENTS = {
  to: [
    "diego.l@clubcashin.com",
    "jalvaradp@clubcashin.com",
    "daniel.r@clubcashin.com",
      "diego.a@sepresta.com",
      "pablo.z@clubcashin.com"

  ],
};

// ========================================
// ID fijo de CUBE INVESTMENTS S.A. en la tabla inversionistas.
// CUBE es el inversionista principal/"la casa". Siempre está presente
// en los créditos y es al que se le resta participación cuando
// entra un nuevo inversionista.
// ========================================
const CUBE_INVESTMENT_ID = 86;

// ========================================
// SCHEMA DE VALIDACIÓN
// ========================================
// Valida el body del request:
//   - inversionista_id: ID del inversionista que se quiere agregar
//   - monto_aportado: cuánto capital va a aportar (se distribuye entre créditos)
//   - porcentaje_cash_in / porcentaje_inversion: opcionales, si el inversionista
//     ya existe en creditos_inversionistas se jalan de ahí
//   - tipo_operacion: define el status del espejo ("reinversion" o "compra_cartera")
//   - fecha_inicio_participacion: opcional, fecha desde cuándo participa
// ========================================

const addInvestorToCreditSchema = z.object({
  inversionista_id: z.number().int().positive(),
  monto_aportado: z.number().positive(),
  porcentaje_cash_in: z.number().min(0).max(100).optional(),
  porcentaje_inversion: z.number().min(0).max(100).optional(),
  tipo_operacion: z.enum(["reinversion", "compra_cartera"]),
  tipo_reinversion: z
    .enum(["reinversion_capital", "reinversion_interes", "reinversion_total"])
    .optional(),
  fecha_inicio_participacion: z.string().optional(),
});

// ========================================
// RECALCULAR INVERSIONISTAS
// ========================================
// Esta función toma un array de inversionistas (ya con montos redistribuidos)
// y recalcula TODA la distribución financiera para cada uno:
//   - Porcentaje de participación
//   - Cuota del inversionista
//   - Intereses
//   - Distribución entre inversionista y cash-in
//   - IVA
//
// Es la misma lógica que usa updateInvestors en updateCredit.ts
// pero encapsulada como función pura (recibe datos, devuelve datos).
//
// IMPORTANTE: El capital total del crédito NO cambia, solo se redistribuye
// entre los inversionistas. La cuota total tampoco cambia.
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
  // ── PASO 1: Sumar el capital total de todos los inversionistas ──
  // Esto es la base para calcular el porcentaje de participación de cada uno.
  // Ejemplo: si CUBE tiene Q70,000 y el nuevo tiene Q30,000 → capitalTotal = Q100,000
  const capitalTotal = inversionistasArray.reduce(
    (acc, inv) => acc.plus(inv.monto_aportado),
    new Big(0),
  );

  // ── PASO 2: Extraer datos fijos del crédito ──
  // Estos valores vienen del crédito y NO cambian durante la redistribución
  const cuotaTotal = new Big(creditoData.cuota);
  const seguro = new Big(creditoData.seguro_10_cuotas ?? 0);
  const gps = new Big(creditoData.gps ?? 0);
  const membresias = new Big(creditoData.membresias_pago ?? 0);
  const tasaInteres = new Big(creditoData.porcentaje_interes ?? 0);

  // ── PASO 3: Encontrar al inversionista con mayor monto aportado ──
  // El inversionista mayor es el que "absorbe" los cargos fijos
  // (seguro, GPS, membresías) en su cuota. Los demás no los pagan.
  const inversionistaMayor = inversionistasArray.reduce((max, current) =>
    current.monto_aportado.gt(max.monto_aportado) ? current : max,
  );

  // ── PASO 4: Calcular cuota sin cargos fijos ──
  // cuotaSinCargos = cuotaTotal - seguro - GPS - membresías
  // Esta es la base que se reparte proporcionalmente entre inversionistas.
  // Los cargos fijos se suman SOLO al inversionista mayor.
  const cuotaSinCargos = cuotaTotal.minus(seguro).minus(gps).minus(membresias);

  // ── PASO 5: Calcular todo para cada inversionista ──
  return inversionistasArray.map((inv) => {
    // ── 5a. Porcentaje de participación ──
    // Fórmula: (montoAportado / capitalTotal) * 100
    // Ejemplo: Q30,000 / Q100,000 * 100 = 30%
    const porcentajeParticipacion = inv.monto_aportado
      .div(capitalTotal)
      .times(100);

    // ── 5b. Cuota base ──
    // Fórmula: cuotaSinCargos * (porcentajeParticipacion / 100)
    // Es la porción de la cuota mensual que le corresponde a este inversionista
    // SIN incluir los cargos fijos.
    const cuotaBase = cuotaSinCargos
      .times(porcentajeParticipacion.div(100))
      .round(6);

    // ── 5c. Determinar si es el inversionista mayor ──
    // Si es el mayor, se le suman seguro + GPS + membresías a su cuota.
    // Si NO es el mayor, su cuota es solo la cuotaBase.
    const esMayor =
      inv.inversionista_id === inversionistaMayor.inversionista_id;

    const cuotaInversionista = esMayor
      ? cuotaBase.plus(seguro).plus(gps).plus(membresias).round(6)
      : cuotaBase;

    // ── 5d. Calcular interés mensual sobre el monto aportado ──
    // Fórmula: montoAportado * (tasaInteres / 100)
    // Ejemplo: Q30,000 * (3% / 100) = Q900
    const cuotaInteres = inv.monto_aportado.times(tasaInteres.div(100)).round(2);

    // ── 5e. Distribuir el interés entre inversionista y cash-in ──
    // montoInversionista = interés que se queda el inversionista
    // montoCashIn = interés que se queda Cash-In (la empresa)
    // Ejemplo: si porcentaje_inversion = 80% y porcentaje_cash_in = 20%
    //   montoInversionista = Q900 * 80% = Q720
    //   montoCashIn = Q900 * 20% = Q180
    const montoInversionista = cuotaInteres
      .times(inv.porcentaje_inversion)
      .div(100)
      .round(2);

    const montoCashIn = cuotaInteres
      .times(inv.porcentaje_cash_in)
      .div(100)
      .round(2);

    // ── 5f. Calcular IVA (12%) sobre cada porción de interés ──
    // Solo se calcula si el monto es mayor a 0
    const ivaInversionista = montoInversionista.gt(0)
      ? montoInversionista.times(0.12).round(2)
      : new Big(0);

    const ivaCashIn = montoCashIn.gt(0)
      ? montoCashIn.times(0.12).round(2)
      : new Big(0);

    // ── 5g. Retornar objeto listo para insertar en la BD ──
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
// CONTROLLER PRINCIPAL: addInvestorToCredit
// ========================================
//
// FLUJO GENERAL:
// 1. Validar el body del request
// 2. Llamar a getCreditCandidates() para obtener los créditos candidatos
//    (ya vienen ordenados por score, con toda la data: crédito, inversionistas, espejo)
// 3. Iterar los créditos candidatos y DISTRIBUIR el monto del inversionista:
//    - Si CUBE en el crédito tiene suficiente → tomar todo el monto restante
//    - Si CUBE tiene MENOS de lo que falta → tomar todo lo de CUBE y pasar al siguiente crédito
//    - Si CUBE queda en 0 → se elimina del crédito
//    - El monto se va descontando crédito por crédito hasta agotarse
// 4. Para cada crédito procesado:
//    a. Armar el nuevo array de inversionistas (CUBE restado, nuevo inversionista agregado)
//    b. Recalcular cuotas, intereses, IVA para TODOS los inversionistas del crédito
//    c. Borrar y reinsertar en creditos_inversionistas (PADRE)
//    d. Borrar y reinsertar en creditos_inversionistas_espejo (ESPEJO)
//       con el status correspondiente (pendiente_reinversion o pendiente_compra_cartera)
// 5. Devolver resumen: monto total, distribuido, sin asignar, detalle por crédito
//
// EJEMPLO:
//   Inversionista quiere meter Q50,000
//   Crédito 1 (score 1800): CUBE tiene Q20,000 → toma Q20,000, CUBE se elimina, quedan Q30,000
//   Crédito 2 (score 1600): CUBE tiene Q40,000 → toma Q30,000, CUBE queda con Q10,000, quedan Q0
//   FIN - Se procesaron 2 créditos, monto_distribuido = Q50,000, monto_sin_asignar = Q0
// ========================================

export const addInvestorToCredit = async ({ body, set, request }: any) => {
  try {
    // ================================================================
    // PASO 1: VALIDAR SCHEMA DEL REQUEST
    // Verifica que el body tenga todos los campos requeridos y con
    // los tipos correctos. Si falla, devuelve 400 con los errores.
    // ================================================================
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
      tipo_reinversion,
      fecha_inicio_participacion,
    } = parseResult.data;

    // ================================================================
    // VALIDACIÓN CONDICIONAL
    // `tipo_reinversion` es OBLIGATORIO cuando `tipo_operacion` es
    // "compra_cartera". Define qué modalidad (capital/interés/total)
    // se asigna a los créditos nuevos que entran con esta operación.
    // En reinversión interna no se usa (se ignora si viene).
    // ================================================================
    if (tipo_operacion === "compra_cartera" && !tipo_reinversion) {
      set.status = 400;
      return {
        message: "Validation failed",
        errors: {
          tipo_reinversion: [
            "tipo_reinversion es requerido cuando tipo_operacion es 'compra_cartera'",
          ],
        },
      };
    }

    // ================================================================
    // PASO 2: GET INTERNO - OBTENER CRÉDITOS CANDIDATOS
    // Llama a getCreditCandidates() de assignCapital.ts que:
    //   - Trae créditos ACTIVOS de tipo Vehículo
    //   - Filtra los que tienen pagos sin validar
    //   - Filtra los que tienen espejo en proceso (pendiente_*)
    //   - Valida que CUBE esté presente y sea el líder del pool
    //   - Calcula un score de prioridad para cada crédito
    //   - Los ordena por score DESC (mejores primero)
    //   - Incluye credito_completo con toda la data relacional
    // ================================================================
    const candidatos = await getCreditCandidates(monto_aportado);

    if (candidatos.length === 0) {
      set.status = 404;
      return {
        success: false,
        message: "No se encontraron créditos candidatos",
      };
    }

    const resultados: any[] = [];
    const errores: any[] = [];

    // ================================================================
    // MONTO RESTANTE: es el "saldo" que falta por distribuir.
    // Empieza con el monto total y se va descontando crédito por crédito.
    // Cuando llega a 0, se deja de procesar.
    // ================================================================
    let montoRestante = new Big(monto_aportado);

    // ================================================================
    // PASO 3: ITERAR CRÉDITOS Y DISTRIBUIR MONTO
    // Todo dentro de una transacción para que si algo falla,
    // se haga rollback de TODOS los cambios.
    // ================================================================
    await db.transaction(async (tx) => {
      // ================================================================
      // PASO 3.0 (solo compra_cartera): RESOLUCIÓN DE MODALIDAD
      // Antes de tocar los créditos, decidimos qué hacer con la modalidad
      // global del inversionista y con sus c_i_e existentes, según la Y
      // (tipo_reinversion) que viene en el request vs la X (global actual).
      //
      // Reglas:
      //   - X == "reinversion_combinada" → no tocar global ni backfill.
      //   - X == "reinversion_variable"  → global pasa a combinada;
      //                                     backfill de c_i_e NULL del
      //                                     inversionista con Y.
      //   - X == Y                        → no tocar global ni backfill.
      //   - cualquier otro y X != Y       → global pasa a combinada;
      //                                     backfill de c_i_e NULL del
      //                                     inversionista con X.
      //
      // En todos los casos, los c_i_e NUEVOS que se inserten en este
      // loop llevan tipo_reinversion = Y (estampado más abajo).
      // ================================================================
      if (tipo_operacion === "compra_cartera") {
        const [invRow] = await tx
          .select({ tipo_reinversion: inversionistas.tipo_reinversion })
          .from(inversionistas)
          .where(eq(inversionistas.inversionista_id, inversionista_id));

        if (!invRow) {
          throw new Error(
            `Inversionista ${inversionista_id} no encontrado`,
          );
        }

        const X = invRow.tipo_reinversion;
        const Y = tipo_reinversion!;

        const debeEscalar =
          X !== "reinversion_combinada" && X !== Y;

        if (debeEscalar) {
          // ── Backfill: si X era "variable", usamos Y; sino, X ──
          const valorBackfill =
            X === "reinversion_variable" ? Y : X;

          // ── Global del inversionista → combinada ──
          await tx
            .update(inversionistas)
            .set({ tipo_reinversion: "reinversion_combinada" })
            .where(eq(inversionistas.inversionista_id, inversionista_id));

          // ── Stampar las c_i_e existentes del inversionista que están
          //    en NULL con la modalidad previa (o Y si venía de variable) ──
          await tx
            .update(creditos_inversionistas_espejo)
            .set({ tipo_reinversion: valorBackfill })
            .where(
              and(
                eq(
                  creditos_inversionistas_espejo.inversionista_id,
                  inversionista_id,
                ),
                isNull(creditos_inversionistas_espejo.tipo_reinversion),
              ),
            );
        }
      }

      for (const candidato of candidatos) {
        // ── Si ya se distribuyó todo el monto, no seguir ──
        if (montoRestante.lte(0)) break;

        const { credito_id, numero_credito_sifco, credito_completo } = candidato;

        // ── Validar que el candidato tenga data completa ──
        if (!credito_completo) {
          errores.push({ credito_id, razon: "Sin data completa del crédito" });
          continue;
        }

        const {
          credito: creditoRaw,
          inversionistas_detalle,
          espejo: espejoActual,
        } = credito_completo;

        // ── Mapa de tipo_reinversion actual por inversionista en el espejo ──
        // Lo usamos para preservar los valores existentes de los OTROS
        // inversionistas al reinsertar el espejo (solo el inversionista
        // nuevo recibe el Y que llega en el request).
        const tipoReinvActualPorInv = new Map<
          number,
          typeof creditos_inversionistas_espejo.$inferSelect.tipo_reinversion
        >(
          (espejoActual ?? []).map((e: any) => [
            e.inversionista_id as number,
            e.tipo_reinversion ?? null,
          ]),
        );

        // ── Extraer datos del crédito que necesitamos para recalcular ──
        // Estos vienen del GET, no hacemos queries adicionales
        const creditoData = {
          cuota: creditoRaw.cuota,
          porcentaje_interes: creditoRaw.porcentaje_interes,
          seguro_10_cuotas: creditoRaw.seguro_10_cuotas,
          gps: creditoRaw.gps,
          membresias_pago: creditoRaw.membresias_pago,
        };

        // ── Mapear inversionistas actuales del crédito ──
        // Estos también vienen del GET (inversionistas_detalle)
        const inversionistasActuales = inversionistas_detalle.map((inv: any) => ({
          inversionista_id: inv.inversionista_id,
          monto_aportado: inv.monto_aportado,
          porcentaje_cash_in: inv.porcentaje_cash_in,
          porcentaje_participacion_inversionista: inv.porcentaje_participacion_inversionista,
          fecha_inicio_participacion: inv.fecha_inicio_participacion,
        }));

        // ================================================================
        // PASO 3a: BUSCAR CUBE EN LOS INVERSIONISTAS DEL CRÉDITO
        // CUBE (ID 86) siempre debe estar. Si no está, es un error
        // y saltamos este crédito.
        // ================================================================
        const cubeActual = inversionistasActuales.find(
          (inv: any) => inv.inversionista_id === CUBE_INVESTMENT_ID,
        );

        if (!cubeActual) {
          errores.push({
            credito_id,
            razon: "CUBE no encontrado en este crédito",
          });
          continue;
        }

        const montoCubeActual = new Big(cubeActual.monto_aportado);

        // ================================================================
        // PASO 3b: DETERMINAR CUÁNTO TOMAR DE ESTE CRÉDITO
        // Si el monto restante es MAYOR que lo que CUBE tiene:
        //   → Tomar TODO lo de CUBE (CUBE se elimina)
        //   → El sobrante se lleva al siguiente crédito
        // Si el monto restante es MENOR o IGUAL que lo de CUBE:
        //   → Tomar solo lo que falta (CUBE se queda con el resto)
        //   → Ya no se procesan más créditos
        //
        // Ejemplo:
        //   montoRestante = Q30,000 | CUBE tiene Q20,000
        //   → montoParaEsteCredito = Q20,000 (todo lo de CUBE)
        //   → montoRestante después = Q10,000 (sigue al siguiente crédito)
        // ================================================================
        const montoParaEsteCredito = montoRestante.gt(montoCubeActual)
          ? montoCubeActual
          : montoRestante;

        // ================================================================
        // PASO 3c: DETERMINAR PORCENTAJES DEL NUEVO INVERSIONISTA
        // Prioridad:
        //   1. Si se pasaron en el request → usar esos
        //   2. Si el inversionista YA EXISTE en ESTE crédito → jalar de ahí
        //   3. Si existe en CUALQUIER OTRO crédito → jalar de ahí
        //   4. Default: cash_in=20%, inversion=80%
        // ================================================================
        let porcCashIn: Big;
        let porcInversion: Big;

        if (porcentaje_cash_in !== undefined) {
          // Porcentajes explícitos del request
          porcCashIn = new Big(porcentaje_cash_in);
          porcInversion = new Big(porcentaje_inversion ?? 80);
        } else {
          // Sin porcentajes explícitos → calcular la MODA desde TODOS los créditos del inversionista
          const todosCreditos = await tx
            .select({
              porcentaje_cash_in: creditos_inversionistas.porcentaje_cash_in,
              porcentaje_participacion_inversionista:
                creditos_inversionistas.porcentaje_participacion_inversionista,
            })
            .from(creditos_inversionistas)
            .where(eq(creditos_inversionistas.inversionista_id, inversionista_id));

          if (todosCreditos.length > 0) {
            // Calcular la moda del porcentaje de inversión
            const freq = new Map<string, number>();
            for (const c of todosCreditos) {
              const pct = String(Math.round(Number(c.porcentaje_participacion_inversionista ?? 0)));
              freq.set(pct, (freq.get(pct) ?? 0) + 1);
            }
            let modaInversion = "80";
            let maxCount = 0;
            for (const [pct, count] of freq) {
              if (count > maxCount) { modaInversion = pct; maxCount = count; }
            }
            porcInversion = new Big(modaInversion);
            porcCashIn = new Big(100).minus(porcInversion);
          } else {
            // No existe en ningún crédito → defaults 80/20
            porcCashIn = new Big(20);
            porcInversion = new Big(80);
          }
        }

        // ================================================================
        // PASO 3d: ARMAR EL NUEVO ARRAY DE INVERSIONISTAS
        // Recorremos los inversionistas actuales del crédito y:
        //   - CUBE: le restamos el montoParaEsteCredito. Si queda en 0, NO lo incluimos.
        //   - Inversionista nuevo (si ya existía): le SUMAMOS el montoParaEsteCredito.
        //   - Los demás: se copian tal cual (no cambian).
        // Si el inversionista NO existía en el crédito, lo agregamos al final.
        //
        // El resultado es un array NUEVO con la distribución correcta,
        // listo para recalcular todas las cuotas.
        // ================================================================
        const nuevoArray: {
          inversionista_id: number;
          monto_aportado: Big;
          porcentaje_cash_in: Big;
          porcentaje_inversion: Big;
          fecha_inicio_participacion: string;
        }[] = [];

        for (const inv of inversionistasActuales) {
          if (inv.inversionista_id === CUBE_INVESTMENT_ID) {
            // ── CUBE: restarle el monto asignado a este crédito ──
            const nuevoMontoCube = montoCubeActual.minus(montoParaEsteCredito);
            if (nuevoMontoCube.gt(0)) {
              // CUBE todavía tiene saldo → se queda con el resto
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
            // Si nuevoMontoCube <= 0, CUBE se elimina (no se incluye en el array)
          } else if (inv.inversionista_id === inversionista_id) {
            // ── Inversionista ya existía: sumarle el monto nuevo ──
            nuevoArray.push({
              inversionista_id: inv.inversionista_id,
              monto_aportado: new Big(inv.monto_aportado).plus(montoParaEsteCredito),
              porcentaje_cash_in: porcCashIn,
              porcentaje_inversion: porcInversion,
              fecha_inicio_participacion:
                fecha_inicio_participacion ??
                inv.fecha_inicio_participacion,
            });
          } else {
            // ── Otro inversionista: se copia igual, no cambia ──
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

        // ── Si el inversionista NO existía en el crédito, agregarlo como nuevo ──
        const yaExiste = nuevoArray.some(
          (inv) => inv.inversionista_id === inversionista_id,
        );
        if (!yaExiste) {
          nuevoArray.push({
            inversionista_id,
            monto_aportado: montoParaEsteCredito,
            porcentaje_cash_in: porcCashIn,
            porcentaje_inversion: porcInversion,
            fecha_inicio_participacion:
              fecha_inicio_participacion ??
              new Date().toISOString().split("T")[0],
          });
        }

        // ================================================================
        // PASO 3e: RECALCULAR CUOTAS PARA TABLA PADRE (creditos_inversionistas)
        // Con el nuevo array redistribuido, recalculamos:
        //   - Porcentaje de participación de cada uno
        //   - Cuota del inversionista (el mayor absorbe cargos fijos)
        //   - Intereses, distribución cash-in/inversionista, IVA
        // ================================================================
        const dataPadre = recalcularInversionistas(
          nuevoArray,
          creditoData,
          credito_id,
          numero_credito_sifco,
        );

        // ================================================================
        // PASO 3f: NUKE & REBUILD EN creditos_inversionistas
        // Borramos TODOS los registros del crédito en la tabla padre
        // y reinsertamos el array recalculado.
        // Es más limpio que hacer updates parciales y evita inconsistencias.
        // ================================================================
        await tx
          .delete(creditos_inversionistas)
          .where(eq(creditos_inversionistas.credito_id, credito_id));

        if (dataPadre.length > 0) {
          await tx.insert(creditos_inversionistas).values(dataPadre);
        }

        // ================================================================
        // PASO 3h: ARMAR DATA DEL ESPEJO A PARTIR DEL PADRE
        // El espejo hereda exactamente la cuota_inversionista del padre,
        // así que reusamos dataPadre y solo le agregamos status + updated_at.
        // ================================================================

        // ── Determinar el status del espejo según tipo_operacion ──
        // "reinversion" → "pendiente_reinversion"
        // "compra_cartera" → "pendiente_compra_cartera" (espera aceptación)
        // Solo el inversionista nuevo recibe este status.
        // Los demás inversionistas quedan como "completado".
        const statusEspejo =
          tipo_operacion === "reinversion"
            ? "pendiente_reinversion"
            : "pendiente_compra_cartera";

        const dataEspejoConStatus = dataPadre.map((inv) => ({
          ...inv,
          // Solo el inversionista nuevo recibe el status pendiente
          // Los demás se mantienen como "completado"
          status: (inv.inversionista_id === inversionista_id
              ? statusEspejo
              : "completado") as "pendiente_reinversion" | "pendiente_compra_cartera" | "completado",
          // tipo_reinversion:
          //   - target (inversionista que entra en esta op): Y (solo en compra_cartera)
          //   - resto: preservamos el valor existente del espejo (si tenía)
          tipo_reinversion:
            inv.inversionista_id === inversionista_id
              ? tipo_operacion === "compra_cartera"
                ? tipo_reinversion ?? null
                : null
              : tipoReinvActualPorInv.get(inv.inversionista_id) ?? null,
          updated_at: new Date(),
        }));

        // ================================================================
        // PASO 3i: NUKE & REBUILD EN creditos_inversionistas_espejo
        // Mismo patrón que el padre: borrar todo y reinsertar.
        // ================================================================
        await tx
          .delete(creditos_inversionistas_espejo)
          .where(eq(creditos_inversionistas_espejo.credito_id, credito_id));

        if (dataEspejoConStatus.length > 0) {
          await tx
            .insert(creditos_inversionistas_espejo)
            .values(dataEspejoConStatus);
        }

        // ================================================================
        // Activar bandera_reinversion en el crédito cuando sea compra_cartera
        // Mientras el espejo esté en pendiente_compra_cartera, cofidi
        // redirige los intereses del inversionista nuevo a CUBE.
        // Se apaga en compraCarteraAceptada (o en replaceInvestorCredit
        // si se cancela/reasigna).
        // ================================================================
        if (tipo_operacion === "compra_cartera") {
          await tx
            .update(creditos)
            .set({ bandera_reinversion: true })
            .where(eq(creditos.credito_id, credito_id));
        }

        // ================================================================
        // PASO 3j: DESCONTAR EL MONTO ASIGNADO DEL SALDO RESTANTE
        // Si aún queda monto, el loop continúa al siguiente crédito.
        // Si ya se agotó (montoRestante <= 0), el break al inicio del
        // loop cortará la iteración.
        // ================================================================
        montoRestante = montoRestante.minus(montoParaEsteCredito);

        resultados.push({
          credito_id,
          numero_credito_sifco,
          monto_asignado: montoParaEsteCredito.toString(),
          inversionistas_padre: dataPadre.length,
          inversionistas_espejo: dataEspejoConStatus.length,
          cube_eliminado: !nuevoArray.some(
            (inv) => inv.inversionista_id === CUBE_INVESTMENT_ID,
          ),
        });

        console.log(
          `✅ Crédito ${numero_credito_sifco} - asignado Q${montoParaEsteCredito} - quedan Q${montoRestante}`,
        );
      }
    });

    // ================================================================
    // PASO 4: NOTIFICAR A LOS ADMINS POR CORREO
    // Solo se notifica en COMPRA DE CARTERA (no en reinversión).
    // Si hubo créditos procesados, mandamos un mail a todos los admins
    // activos con el detalle de la operación. Va envuelto en try/catch
    // para que un fallo de Resend NO rompa la respuesta del endpoint.
    // ================================================================
    if (tipo_operacion === "compra_cartera" && resultados.length > 0) {
      try {
        // ── Resolver quién disparó la operación a partir del JWT ──
        let usuarioEmail: string | undefined;
        let usuarioNombre: string | undefined;

        try {
          const authHeader = request?.headers?.get?.("Authorization");
          if (authHeader?.startsWith("Bearer ")) {
            const token = authHeader.replace("Bearer ", "").trim();
            const decoded = jwt.verify(token, JWT_SECRET) as any;
            usuarioEmail = decoded.email ?? decoded.correo ?? undefined;

            if (usuarioEmail) {
              const [pu] = await db
                .select({
                  admin_id: platform_users.admin_id,
                  asesor_id: platform_users.asesor_id,
                })
                .from(platform_users)
                .where(eq(platform_users.email, usuarioEmail));

              if (pu?.admin_id) {
                const [a] = await db
                  .select({
                    nombre: admins.nombre,
                    apellido: admins.apellido,
                  })
                  .from(admins)
                  .where(eq(admins.admin_id, pu.admin_id));
                if (a) usuarioNombre = `${a.nombre} ${a.apellido}`.trim();
              } else if (pu?.asesor_id) {
                const [s] = await db
                  .select({ nombre: asesores.nombre })
                  .from(asesores)
                  .where(eq(asesores.asesor_id, pu.asesor_id));
                if (s) usuarioNombre = s.nombre;
              }
            }
          }
        } catch (jwtErr) {
          console.warn(
            "[addInvestorToCredit] No se pudo resolver el usuario desde el JWT:",
            jwtErr,
          );
        }

        const [inv] = await db
          .select({ nombre: inversionistas.nombre })
          .from(inversionistas)
          .where(eq(inversionistas.inversionista_id, inversionista_id));

        const montoDistribuido = new Big(monto_aportado)
          .minus(montoRestante)
          .toString();

        await sendInvestorAddedToCreditsNotification({
          to: COMPRA_CARTERA_PENDIENTE_RECIPIENTS.to,
          inversionistaNombre: inv?.nombre ?? `Inversionista ${inversionista_id}`,
          tipoOperacion: tipo_operacion,
          montoTotal: new Big(monto_aportado).toString(),
          montoDistribuido,
          montoSinAsignar: montoRestante.toString(),
          creditos: resultados.map((r) => ({
            numero_credito_sifco: r.numero_credito_sifco,
            monto_asignado: r.monto_asignado,
            cube_eliminado: r.cube_eliminado,
            tipo_reinversion: tipo_reinversion ?? null,
          })),
          usuarioNombre,
          usuarioEmail,
        });
      } catch (mailErr) {
        console.error(
          "[addInvestorToCredit] Error enviando notificación por correo:",
          mailErr,
        );
      }
    }

    // ================================================================
    // PASO 5: RESPUESTA FINAL
    // Devuelve un resumen completo de la distribución:
    //   - monto_total: lo que pidió el inversionista
    //   - monto_distribuido: lo que efectivamente se asignó a créditos
    //   - monto_sin_asignar: lo que sobró (si no hubo suficientes créditos)
    //   - resultados: detalle por crédito procesado
    //   - errores: créditos que fallaron y por qué
    // ================================================================
    set.status = 200;
    return {
      success: true,
      message: `Procesados: ${resultados.length} créditos, ${errores.length} errores`,
      monto_total: monto_aportado,
      monto_distribuido: new Big(monto_aportado).minus(montoRestante).toString(),
      monto_sin_asignar: montoRestante.toString(),
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


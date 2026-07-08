import Big from "big.js";
import { and, eq, isNull } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { db } from "../database";
import {
  admins,
  asesores,
  compras_credito_inversionista,
  creditos,
  creditos_inversionistas,
  creditos_inversionistas_espejo,
  inversionistas,
  platform_users,
} from "../database/db";
import z from "zod";
import {
  getCreditCandidates,
  getCreditCandidateById,
  type CreditCandidate,
} from "./assignCapital";
import { sendInvestorAddedToCreditsNotification } from "@cci/email";
import {
  resolveModalidadFacturacionSpread,
  type ModalidadFacturacionSpreadRow,
} from "./modalidadFacturacion";

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
      "pablo.z@clubcashin.com",
      "sara.r@clubcashin.com"

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
  // Solo aplica cuando tipo_operacion === "compra_cartera". Si viene, el
  // % Inversionista / % Cash In se calcula del catálogo (por monto_aportado)
  // y SE IGNORAN porcentaje_cash_in / porcentaje_inversion si vinieran.
  modalidad_facturacion: z
    .enum(["p2p_directa", "factura_cube", "factura_cube_pequeno"])
    .optional(),
  tipo_operacion: z.enum(["reinversion", "compra_cartera"]),
  tipo_reinversion: z
    .enum([
      "sin_reinversion",
      "reinversion_capital",
      "reinversion_interes",
      "reinversion_total",
      // Modalidades que solo aplican cuando el inversionista es combinada: el
      // sobrante del excedente / el monto del variable se reinvierten en un
      // crédito nuevo con esa misma modalidad.
      "reinversion_excedente",
      "reinversion_variable",
    ])
    .optional(),
  // Se sigue aceptando por compatibilidad, pero YA NO se usa para actualizar
  // la fecha de las filas (ni del inversionista nuevo ni del existente).
  fecha_inicio_participacion: z.string().optional(),
  // Nuevos campos para el buscador de capital
  minimo: z.number().int().positive().optional(),
  // MODO MANUAL: arreglo de { credito_id, monto }. Si viene (y no vacío) se
  // IGNORA el buscador de candidatos y se opera SOLO sobre estos créditos,
  // asignando a cada uno su `monto`. La suma de los montos debe igualar
  // monto_aportado. El resto del flujo (recálculo, padre/espejo, correo) es
  // idéntico al modo automático.
  manual: z
    .array(
      z.object({
        credito_id: z.number().int().positive(),
        monto: z.number().positive(),
      }),
    )
    .min(1)
    .optional(),
})
  .superRefine((data, ctx) => {
    if (!data.manual || data.manual.length === 0) return;

    // No se permiten créditos repetidos: el loop borra y reinserta por
    // credito_id, así que un duplicado se pisaría a sí mismo.
    const ids = data.manual.map((m) => m.credito_id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["manual"],
        message: "No se permiten créditos duplicados en 'manual'",
      });
    }

    // La suma de los montos manuales debe igualar monto_aportado
    // (tolerancia de 1 centavo por redondeos de coma flotante).
    const suma = data.manual.reduce((acc, m) => acc + m.monto, 0);
    if (Math.abs(suma - data.monto_aportado) > 0.01) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["manual"],
        message: `La suma de los montos manuales (${suma}) debe igualar monto_aportado (${data.monto_aportado})`,
      });
    }
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
  tipo_operacion: "reinversion" | "compra_cartera",
) {
  // Fallback de fecha de inicio cuando un inversionista llega sin fecha:
  // - reinversion → 1 de diciembre de 2025 (fecha fija acordada).
  // - compra_cartera → fecha de hoy (el front debería mandar siempre la que
  //   el usuario eligió; este fallback solo aplica si no viene).
  const hoy = new Date();
  const fechaInicioFallback =
    tipo_operacion === "reinversion"
      ? "2025-12-01"
      : hoy.toISOString().split("T")[0];
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

  // ── PASO 5: Validar capital total ──
  // Si el capital es 0, no se puede calcular participación. Abortamos para evitar corrupción.
  if (capitalTotal.eq(0)) {
    throw new Error("No se puede recalcular participaciones en un crédito con capital total Q0.00");
  }

  // ── PASO 6: Calcular todo para cada inversionista ──
  return inversionistasArray.map((inv) => {
    // ── 6a. Porcentaje de participación ──
    // Fórmula: (montoAportado / capitalTotal) * 100
    // Ejemplo: Q30,000 / Q100,000 * 100 = 30%
    const porcentajeParticipacion = inv.monto_aportado.div(capitalTotal).times(100);

    // ── 6b. Cuota base ──
    // Fórmula: cuotaSinCargos * (porcentajeParticipacion / 100)
    // Es la porción de la cuota mensual que le corresponde a este inversionista
    // SIN incluir los cargos fijos.
    const cuotaBase = cuotaSinCargos
      .times(porcentajeParticipacion.div(100))
      .round(6);

    // ── 6c. Determinar si es el inversionista mayor ──
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
        inv.fecha_inicio_participacion || fechaInicioFallback,
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
      modalidad_facturacion,
      tipo_operacion,
      tipo_reinversion,
      // NOTA: fecha_inicio_participacion se sigue aceptando en el body pero
      // ya NO se desestructura ni se usa: no actualiza la fecha de las filas.
      minimo,
      manual,
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
    // MODALIDAD DE FACTURACIÓN
    // OPCIONAL a nivel backend (retrocompatible: el front todavía no la
    // manda). Si VIENE, define el % Inversionista / % Cash In desde el bracket
    // del catálogo (por monto_aportado) y esos valores MANDAN sobre cualquier
    // porcentaje del request. Si NO viene, el flujo de porcentajes sigue como
    // antes. Solo aplica a compra_cartera; en reinversión se rechaza si viene.
    // ================================================================
    if (tipo_operacion !== "compra_cartera" && modalidad_facturacion) {
      set.status = 400;
      return {
        message: "Validation failed",
        errors: {
          modalidad_facturacion: [
            "modalidad_facturacion solo aplica cuando tipo_operacion es 'compra_cartera'",
          ],
        },
      };
    }

    let modalidadFacturacionSpreadRow: ModalidadFacturacionSpreadRow | null = null;
    if (modalidad_facturacion) {
      modalidadFacturacionSpreadRow = await resolveModalidadFacturacionSpread(
        monto_aportado,
        modalidad_facturacion,
      );
      if (!modalidadFacturacionSpreadRow) {
        set.status = 400;
        return {
          message: "Validation failed",
          errors: {
            monto_aportado: [
              `No existe un bracket de modalidad de facturación para el monto Q${monto_aportado}`,
            ],
          },
        };
      }
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
    // ================================================================
    // MODO MANUAL vs AUTOMÁTICO
    // Si vino `manual` (arreglo no vacío) NO se usa el buscador: se opera
    // SOLO sobre esos créditos, asignando a cada uno su `monto` propio.
    // ================================================================
    const esManual = Array.isArray(manual) && manual.length > 0;

    // Mapa credito_id → monto a asignar (solo se llena en modo manual).
    const montoManualPorCredito = new Map<number, Big>();

    let candidatos: CreditCandidate[];

    if (esManual) {
      console.log("================================================================");
      console.log(`[addInvestorToCredit] MODO MANUAL: ${manual!.length} crédito(s) forzado(s)`);

      const armados: CreditCandidate[] = [];
      const noEncontrados: number[] = [];

      for (const item of manual!) {
        // Mismo credito_completo que arma getCreditCandidates en su paso 8,
        // para que el flujo aguas abajo sea idéntico.
        const candidato = await getCreditCandidateById(item.credito_id);
        if (!candidato) {
          noEncontrados.push(item.credito_id);
          continue;
        }
        montoManualPorCredito.set(item.credito_id, new Big(item.monto));
        armados.push(candidato);
        console.log(
          ` - Credito ${item.credito_id} (${candidato.numero_credito_sifco}): asignar Q${item.monto}`,
        );
      }
      console.log("================================================================");

      if (noEncontrados.length > 0) {
        set.status = 404;
        return {
          success: false,
          message: `Créditos no encontrados: ${noEncontrados.join(", ")}`,
        };
      }

      candidatos = armados;
    } else {
      console.log("================================================================");
      console.log("[addInvestorToCredit] Llamando a getCreditCandidates con:");
      console.log(` - monto: ${monto_aportado}`);
      console.log(` - limit (minimo): ${minimo ?? "Sin límite"}`);
      console.log(` - inversionista_id: ${inversionista_id}`);
      console.log(` - porcentaje_inversion: ${porcentaje_inversion}`);
      console.log("================================================================");

      candidatos = await getCreditCandidates(monto_aportado, minimo, inversionista_id, porcentaje_inversion);

      console.log(`[addInvestorToCredit] Candidatos encontrados: ${candidatos.length}`);
      candidatos.forEach((c, i) => {
        console.log(` [${i}] Credito: ${c.numero_credito_sifco}, Score: ${c.score}, Capital Activo: ${c.capital_activo}`);
      });
      console.log("================================================================");
    }

    if (candidatos.length === 0) {
      set.status = 404;
      return {
        success: false,
        message: "No se encontraron créditos candidatos",
      };
    }

    // ================================================================
    // FILTRO: créditos compatibles con la modalidad solicitada (Y)
    // Aplica SIEMPRE que vino un `tipo_reinversion` (Y) en el request.
    // Vale para compra_cartera y reinversión.
    //
    // Acepta créditos cuyo espejo:
    //   • tiene la MISMA modalidad que Y
    //   • está en NULL (modalidad no asignada todavía)
    // Descarta créditos cuyo espejo tiene a algún inversionista con un
    // tipo_reinversion no-null distinto a Y. Esto incluye "sin_reinversion"
    // como un valor concreto: si Y ≠ sin_reinversion, los espejos en
    // sin_reinversion se descartan.
    // ================================================================
    const filtradosPorTipoReinversion: {
      credito_id: number;
      numero_credito_sifco: string;
      razon: string;
      tipo_reinversion_actual: string;
      tipo_reinversion_solicitado: string;
    }[] = [];

    // En modo MANUAL se omite este filtro: el operador eligió los créditos
    // explícitamente, así que no se descartan por modalidad del espejo.
    if (tipo_reinversion && !esManual) {
      candidatos = candidatos.filter((candidato) => {
        const espejoActual = candidato.credito_completo?.espejo ?? [];

        // Conflicto: algún inv del espejo con tipo no-null distinto a Y.
        // (Solo NULL no es conflicto; misma modalidad tampoco.)
        const conflicto = espejoActual.find(
          (e: any) =>
            e.tipo_reinversion !== null &&
            e.tipo_reinversion !== tipo_reinversion,
        );

        if (conflicto) {
          filtradosPorTipoReinversion.push({
            credito_id: candidato.credito_id,
            numero_credito_sifco: candidato.numero_credito_sifco,
            razon: `inversionista ${conflicto.inversionista_id} del espejo ya tiene modalidad ${conflicto.tipo_reinversion}`,
            tipo_reinversion_actual: String(conflicto.tipo_reinversion),
            tipo_reinversion_solicitado: tipo_reinversion,
          });
          return false;
        }

        return true;
      });

      console.log(
        `[addInvestorToCredit] Filtro tipo_reinversion: ${filtradosPorTipoReinversion.length} descartados, ${candidatos.length} compatibles`,
      );

      if (candidatos.length === 0) {
        set.status = 404;
        return {
          success: false,
          message:
            "No se encontraron créditos candidatos compatibles (todos tienen alguna modalidad ya asignada)",
          descartados: filtradosPorTipoReinversion,
        };
      }
    }

    // ================================================================
    // MODO MANUAL: VALIDACIONES PRE-TRANSACCIÓN
    // En manual saltamos getCreditCandidates, así que replicamos a mano sus
    // guards críticos sobre el snapshot ya cargado (no se toca la BD):
    //   1. Espejo SIN operación en curso (todas las filas en "completado").
    //      getCreditCandidates descarta los pendiente_*; si no lo hiciéramos,
    //      el nuke&rebuild del espejo borraría esas filas pendientes y las
    //      reinsertaría como "completado", perdiendo la compra/reinversión
    //      en vuelo de ese crédito.
    //   2. CUBE presente y con tope suficiente. Como el monto es una
    //      instrucción exacta, NO asignamos parcial: si algún crédito no cabe,
    //      fallamos TODA la operación para que el operador corrija y reintente.
    // ================================================================
    if (esManual) {
      const violaciones: {
        credito_id: number;
        numero_credito_sifco: string;
        razon: string;
        cube_disponible?: string;
        monto_solicitado: string;
      }[] = [];

      for (const candidato of candidatos) {
        const montoSolicitado =
          montoManualPorCredito.get(candidato.credito_id) ?? new Big(0);

        // ── Guard 0: crédito sin proceso de devolución a Cube ──
        // getCreditCandidates filtra por estado_devolucion = NO_APLICA. En
        // manual saltamos ese filtro, así que lo replicamos: un crédito en
        // PENDIENTE_AUTORIZACION / VERIFICADO / RECHAZADO se está devolviendo a
        // Cube; asignarle un inversionista genera la doble asignación que
        // liquidación (exitInvestor) provocaría después.
        const estadoDevolucion =
          candidato.credito_completo?.credito?.estado_devolucion;
        if (estadoDevolucion && estadoDevolucion !== "NO_APLICA") {
          violaciones.push({
            credito_id: candidato.credito_id,
            numero_credito_sifco: candidato.numero_credito_sifco,
            razon: `El crédito está en proceso de devolución a Cube (estado ${estadoDevolucion}); no se puede reasignar manualmente`,
            monto_solicitado: montoSolicitado.toString(),
          });
          continue;
        }

        // ── Guard 1: espejo sin operación en curso ──
        // Un crédito pasa solo si TODAS sus filas de espejo están en
        // "completado" (o no tiene filas de espejo). Si alguna está en
        // pendiente_*, ya hay un proceso en curso y reasignarlo lo pisaría.
        const espejoPendiente = (
          candidato.credito_completo?.espejo ?? []
        ).find((e: any) => e.status && e.status !== "completado");

        if (espejoPendiente) {
          violaciones.push({
            credito_id: candidato.credito_id,
            numero_credito_sifco: candidato.numero_credito_sifco,
            razon: `El espejo tiene una operación en curso (status ${espejoPendiente.status}); no se puede reasignar manualmente`,
            monto_solicitado: montoSolicitado.toString(),
          });
          continue;
        }

        // ── Guard 2: CUBE presente ──
        const cubePadre = (
          candidato.credito_completo?.inversionistas_detalle ?? []
        ).find((inv: any) => inv.inversionista_id === CUBE_INVESTMENT_ID);

        if (!cubePadre) {
          violaciones.push({
            credito_id: candidato.credito_id,
            numero_credito_sifco: candidato.numero_credito_sifco,
            razon: "El crédito no tiene a CUBE en el padre",
            monto_solicitado: montoSolicitado.toString(),
          });
          continue;
        }

        // ── Guard 3: CUBE con tope suficiente ──
        const montoCubePadre = new Big(cubePadre.monto_aportado);
        if (montoSolicitado.gt(montoCubePadre)) {
          violaciones.push({
            credito_id: candidato.credito_id,
            numero_credito_sifco: candidato.numero_credito_sifco,
            razon:
              "El monto solicitado supera el tope disponible de CUBE en este crédito",
            cube_disponible: montoCubePadre.toString(),
            monto_solicitado: montoSolicitado.toString(),
          });
        }
      }

      if (violaciones.length > 0) {
        set.status = 409;
        return {
          success: false,
          message:
            "No se pudo crear la asignación manual: uno o más créditos no son elegibles (en devolución a Cube, espejo con operación en curso, sin CUBE, o monto sobre el tope de CUBE)",
          violaciones,
        };
      }
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
    // GUARD: exclusividad excedente/variable (solo compra_cartera).
    // La escalada a combinada backfillea los créditos existentes con la
    // modalidad previa (X) e inserta los nuevos con la solicitada (Y). Si X y Y
    // son las dos modalidades de monto fijo opuestas, quedaría un inversionista
    // combinada con excedente Y variable a la vez, y getInvestorTotalsGlobales
    // aplicaría el monto_reinversion único a ambos pools con sentidos opuestos.
    // Se rechaza antes de tocar nada (misma regla que el modal y /asignar-reinversion).
    // ================================================================
    if (tipo_operacion === "compra_cartera" && tipo_reinversion) {
      const [invActual] = await db
        .select({ tipo_reinversion: inversionistas.tipo_reinversion })
        .from(inversionistas)
        .where(eq(inversionistas.inversionista_id, inversionista_id));
      const X = invActual?.tipo_reinversion ?? null;
      const Y = tipo_reinversion;
      const debeEscalar = X !== "reinversion_combinada" && X !== Y;

      const espejosExistentes = await db
        .select({ tipo_reinversion: creditos_inversionistas_espejo.tipo_reinversion })
        .from(creditos_inversionistas_espejo)
        .where(eq(creditos_inversionistas_espejo.inversionista_id, inversionista_id));

      // Modalidades por-crédito resultantes: existentes (NULL→backfill si escala)
      // + la de los créditos nuevos (Y).
      const modalidadesFinales = new Set<string | null>();
      for (const e of espejosExistentes) {
        modalidadesFinales.add(e.tipo_reinversion === null && debeEscalar ? X : e.tipo_reinversion);
      }
      modalidadesFinales.add(Y);

      if (modalidadesFinales.has("reinversion_excedente") && modalidadesFinales.has("reinversion_variable")) {
        set.status = 409;
        return {
          success: false,
          message:
            "No se puede mezclar Excedente y Variable en el mismo inversionista: el monto de reinversión es único (una modalidad recibe un monto fijo y la otra reinvierte un monto fijo).",
        };
      }
    }

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
          // ── Backfill: preservar SIEMPRE la modalidad previa (X) del
          //    inversionista. variable/excedente ya son modalidades válidas
          //    por-crédito dentro de una combinada, así que estampar los
          //    créditos existentes con la modalidad nueva (Y) les cambiaría el
          //    cálculo de reinversión. ──
          const valorBackfill = X;

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
        // En modo manual cada crédito trae su propio monto independiente,
        // así que NO cortamos por el saldo global.
        if (!esManual && montoRestante.lte(0)) break;

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

        // ── Mapa de modalidad_facturacion actual por inversionista en el
        //    espejo. Igual que arriba: al hacer nuke&rebuild, los inversionistas
        //    que NO son el nuevo deben conservar lo que ya tenían. ──
        const modalidadFacturacionActualPorInv = new Map<
          number,
          {
            modalidad_facturacion: typeof creditos_inversionistas_espejo.$inferSelect.modalidad_facturacion;
            modalidad_facturacion_spread_id: number | null;
          }
        >(
          (espejoActual ?? []).map((e: any) => [
            e.inversionista_id as number,
            {
              modalidad_facturacion: e.modalidad_facturacion ?? null,
              modalidad_facturacion_spread_id: e.modalidad_facturacion_spread_id ?? null,
            },
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

        // ── Mapear inversionistas del PADRE y del ESPEJO por separado ──
        // monto_aportado y los montos derivados (monto_inversionista,
        // monto_cash_in, iva_*) se calculan independientemente por tabla.
        // cuota_inversionista y los porcentajes se calculan desde el ESPEJO
        // y se replican al padre.
        const inversionistasPadre = inversionistas_detalle.map((inv: any) => ({
          inversionista_id: inv.inversionista_id,
          monto_aportado: inv.monto_aportado,
          porcentaje_cash_in: inv.porcentaje_cash_in,
          porcentaje_participacion_inversionista: inv.porcentaje_participacion_inversionista,
          fecha_inicio_participacion: inv.fecha_inicio_participacion,
        }));

        const inversionistasEspejo = (espejoActual ?? []).map((inv: any) => ({
          inversionista_id: inv.inversionista_id,
          monto_aportado: inv.monto_aportado,
          porcentaje_cash_in: inv.porcentaje_cash_in,
          porcentaje_participacion_inversionista: inv.porcentaje_participacion_inversionista,
          fecha_inicio_participacion: inv.fecha_inicio_participacion,
        }));

        // ================================================================
        // PASO 3a: BUSCAR CUBE EN EL PADRE (autoridad para montoParaEsteCredito)
        // CUBE (ID 86) siempre debe estar en el padre. Si no está, es un
        // error y saltamos este crédito.
        // ================================================================
        const cubePadre = inversionistasPadre.find(
          (inv: any) => inv.inversionista_id === CUBE_INVESTMENT_ID,
        );

        if (!cubePadre) {
          errores.push({
            credito_id,
            razon: "CUBE no encontrado en el padre del crédito",
          });
          continue;
        }

        const montoCubePadre = new Big(cubePadre.monto_aportado);

        // ================================================================
        // PASO 3b: DETERMINAR CUÁNTO TOMAR DE ESTE CRÉDITO
        // El monto se basa en el CUBE del PADRE (es la verdad confirmada).
        // Si el espejo tiene un CUBE con monto distinto, se le aplicará la
        // misma operación pero con su propio monto inicial.
        // ================================================================
        // En modo manual el objetivo es el monto del arreglo para ESTE
        // crédito; en automático es el saldo global restante. En ambos casos
        // se topa al monto de CUBE en el padre (no se toma más de lo que tiene).
        const montoObjetivo = esManual
          ? (montoManualPorCredito.get(credito_id) ?? new Big(0))
          : montoRestante;

        const montoParaEsteCredito = montoObjetivo.gt(montoCubePadre)
          ? montoCubePadre
          : montoObjetivo;

        // ================================================================
        // PASO 3c: DETERMINAR PORCENTAJES DEL NUEVO INVERSIONISTA
        // Prioridad:
        //   0. Si vino modalidad_facturacion → el spread del bracket manda
        //      (ignora porcentaje_cash_in/porcentaje_inversion del request)
        //   1. Si se pasaron en el request → usar esos
        //   2. Si el inversionista YA EXISTE en ESTE crédito → jalar de ahí
        //   3. Si existe en CUALQUIER OTRO crédito → jalar de ahí
        //   4. Default: cash_in=20%, inversion=80%
        // ================================================================
        let porcCashIn: Big;
        let porcInversion: Big;

        if (modalidadFacturacionSpreadRow) {
          porcInversion = new Big(modalidadFacturacionSpreadRow.spread);
          porcCashIn = new Big(100).minus(porcInversion);
        } else if (porcentaje_cash_in !== undefined) {
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
        // PASO 3d: ARMAR LOS NUEVOS ARRAYS (PADRE y ESPEJO) INDEPENDIENTES
        // Aplicamos la misma operación (restar a CUBE, sumar/agregar al
        // inversionista nuevo) a cada fuente con SU propio monto_aportado.
        // Si CUBE queda en Q0 en una fuente, se elimina de esa fuente
        // (independencia total entre padre y espejo).
        // ================================================================

        // Fecha por defecto para el inversionista nuevo (cuando no existía):
        // reinversion → 2025-12-01 (fija), compra_cartera → fecha de hoy.
        const fechaPorDefecto =
          tipo_operacion === "reinversion"
            ? "2025-12-01"
            : new Date().toISOString().split("T")[0];

        // Helper: aplica la operación a una fuente (padre o espejo) y
        // devuelve el array operado listo para recalcular.
        const construirArrayOperado = (fuente: any[]) => {
          const result: {
            inversionista_id: number;
            monto_aportado: Big;
            porcentaje_cash_in: Big;
            porcentaje_inversion: Big;
            fecha_inicio_participacion: string;
          }[] = [];

          for (const inv of fuente) {
            if (inv.inversionista_id === CUBE_INVESTMENT_ID) {
              // ── CUBE: restarle el monto operativo. Si queda en 0, se elimina. ──
              // CUBE siempre es 100% cash_in / 0% inversión — ignoramos los
              // valores que vengan en la fuente porque pueden estar corruptos
              // (ver bug histórico de los 19 créditos invertidos).
              const nuevoMontoCube = new Big(inv.monto_aportado).minus(
                montoParaEsteCredito,
              );
              if (nuevoMontoCube.gt(0)) {
                result.push({
                  inversionista_id: inv.inversionista_id,
                  monto_aportado: nuevoMontoCube,
                  porcentaje_cash_in: new Big(100),
                  porcentaje_inversion: new Big(0),
                  fecha_inicio_participacion: inv.fecha_inicio_participacion,
                });
              }
            } else if (inv.inversionista_id === inversionista_id) {
              // ── Inversionista ya existía en esta fuente: sumarle el monto ──
              result.push({
                inversionista_id: inv.inversionista_id,
                monto_aportado: new Big(inv.monto_aportado).plus(
                  montoParaEsteCredito,
                ),
                porcentaje_cash_in: porcCashIn,
                porcentaje_inversion: porcInversion,
                // Se conserva la fecha existente. El fecha_inicio_participacion
                // del request se sigue aceptando pero NO se usa para actualizar.
                fecha_inicio_participacion: inv.fecha_inicio_participacion,
              });
            } else {
              // ── Otro inversionista: se copia igual ──
              result.push({
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

          // Si el inversionista no existía en esta fuente, agregarlo
          const yaExiste = result.some(
            (i) => i.inversionista_id === inversionista_id,
          );
          if (!yaExiste) {
            result.push({
              inversionista_id,
              monto_aportado: montoParaEsteCredito,
              porcentaje_cash_in: porcCashIn,
              porcentaje_inversion: porcInversion,
              // Fecha por defecto (no se usa la del request).
              fecha_inicio_participacion: fechaPorDefecto,
            });
          }

          return result;
        };

        const nuevoArrayPadre = construirArrayOperado(inversionistasPadre);
        // Si el espejo está vacío (no había filas), caemos al padre como fuente
        const nuevoArrayEspejo =
          inversionistasEspejo.length > 0
            ? construirArrayOperado(inversionistasEspejo)
            : nuevoArrayPadre.map((x) => ({ ...x }));

        // ================================================================
        // PASO 3e: RECALCULAR INDEPENDIENTEMENTE PADRE Y ESPEJO
        // Cada uno con su propio capital total → cada uno con sus propios
        // montos derivados (monto_inversionista, monto_cash_in, iva_*).
        // ================================================================
        const dataPadreRaw = recalcularInversionistas(
          nuevoArrayPadre,
          creditoData,
          credito_id,
          numero_credito_sifco,
          tipo_operacion,
        );

        const dataEspejoRaw = recalcularInversionistas(
          nuevoArrayEspejo,
          creditoData,
          credito_id,
          numero_credito_sifco,
          tipo_operacion,
        );

        // ================================================================
        // PASO 3e.1: REPLICAR cuota_inversionista Y porcentajes DEL ESPEJO
        // AL PADRE. monto_aportado, monto_inversionista, monto_cash_in,
        // iva_* quedan independientes (cada uno con su cálculo propio).
        // ================================================================
        const espejoPorInv = new Map<
          number,
          (typeof dataEspejoRaw)[number]
        >();
        for (const e of dataEspejoRaw) {
          espejoPorInv.set(e.inversionista_id, e);
        }

        const dataPadre = dataPadreRaw.map((inv) => {
          const e = espejoPorInv.get(inv.inversionista_id);
          return {
            ...inv,
            // Si el inversionista existe en el espejo, replicar su cuota
            // y porcentajes para que coincidan. Si no, mantener los propios.
            cuota_inversionista: e?.cuota_inversionista ?? inv.cuota_inversionista,
            porcentaje_cash_in: e?.porcentaje_cash_in ?? inv.porcentaje_cash_in,
            porcentaje_participacion_inversionista:
              e?.porcentaje_participacion_inversionista ??
              inv.porcentaje_participacion_inversionista,
          };
        });

        // ================================================================
        // PASO 3f: NUKE & REBUILD EN creditos_inversionistas
        // ================================================================
        await tx
          .delete(creditos_inversionistas)
          .where(eq(creditos_inversionistas.credito_id, credito_id));

        if (dataPadre.length > 0) {
          await tx.insert(creditos_inversionistas).values(dataPadre);
        }

        // ================================================================
        // PASO 3h: ARMAR DATA DEL ESPEJO DESDE dataEspejoRaw (no del padre)
        // El espejo lleva sus propios montos derivados; solo le agregamos
        // status + tipo_reinversion + updated_at.
        // ================================================================
        const statusEspejo =
          tipo_operacion === "reinversion"
            ? "pendiente_reinversion"
            : "pendiente_compra_cartera";

        const dataEspejoConStatus = dataEspejoRaw.map((inv) => ({
          ...inv,
          // Solo el inversionista nuevo recibe el status pendiente
          // Los demás se mantienen como "completado"
          status: (inv.inversionista_id === inversionista_id
              ? statusEspejo
              : "completado") as "pendiente_reinversion" | "pendiente_compra_cartera" | "completado",
          // tipo_reinversion (prioridad: lo que viene > viejo del espejo > null):
          //   - target: si viene Y en el request lo usa; si no, preserva el
          //     valor previo del espejo. Aplica tanto en compra_cartera como
          //     en reinversión (no perdemos trazabilidad de la modalidad).
          //   - resto: preserva el valor existente del espejo.
          tipo_reinversion:
            inv.inversionista_id === inversionista_id
              ? tipo_reinversion ??
                tipoReinvActualPorInv.get(inv.inversionista_id) ??
                null
              : tipoReinvActualPorInv.get(inv.inversionista_id) ?? null,
          // Igual patrón que tipo_reinversion: solo el inversionista nuevo
          // recibe la modalidad de esta operación; el resto conserva la suya.
          modalidad_facturacion:
            inv.inversionista_id === inversionista_id
              ? modalidad_facturacion ??
                modalidadFacturacionActualPorInv.get(inv.inversionista_id)
                  ?.modalidad_facturacion ??
                null
              : modalidadFacturacionActualPorInv.get(inv.inversionista_id)
                  ?.modalidad_facturacion ?? null,
          modalidad_facturacion_spread_id:
            inv.inversionista_id === inversionista_id
              ? modalidadFacturacionSpreadRow?.id ??
                modalidadFacturacionActualPorInv.get(inv.inversionista_id)
                  ?.modalidad_facturacion_spread_id ??
                null
              : modalidadFacturacionActualPorInv.get(inv.inversionista_id)
                  ?.modalidad_facturacion_spread_id ?? null,
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
        // PASO 3i.2: REGISTRAR LA OPERACIÓN EN compras_credito_inversionista
        // Guardamos SOLO el monto nuevo que entró a este crédito en esta
        // operación (montoParaEsteCredito), NO la suma acumulada que ya
        // queda en el padre/espejo. Esto permite que, cuando se acepte la
        // compra/reinversión, el correo reporte el monto real ingresado
        // en esta operación (buscando los registros por status pendiente).
        // ================================================================
        await tx.insert(compras_credito_inversionista).values({
          credito_id,
          inversionista_id,
          monto_aportado: montoParaEsteCredito.toString(),
          tipo_operacion,
          // Misma lógica que el espejo: si vino en el request lo usa, sino
          // preserva el viejo del espejo, sino null. Aplica en ambas operaciones.
          tipo_reinversion:
            tipo_reinversion ??
            tipoReinvActualPorInv.get(inversionista_id) ??
            null,
          modalidad_facturacion: modalidad_facturacion ?? null,
          modalidad_facturacion_spread_id: modalidadFacturacionSpreadRow?.id ?? null,
          status: statusEspejo,
        });

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
          cube_eliminado: !nuevoArrayPadre.some(
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
                .select({ admin_id: platform_users.admin_id, asesor_id: platform_users.asesor_id })
                .from(platform_users)
                .where(eq(platform_users.email, usuarioEmail));
              if (pu?.admin_id) {
                const [a] = await db
                  .select({ nombre: admins.nombre, apellido: admins.apellido })
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
          console.warn("[addInvestorToCredit] No se pudo resolver el usuario desde el JWT:", jwtErr);
        }
        const [inv] = await db
          .select({ nombre: inversionistas.nombre })
          .from(inversionistas)
          .where(eq(inversionistas.inversionista_id, inversionista_id));
        const montoDistribuido = new Big(monto_aportado).minus(montoRestante).toString();
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
            // El email muestra "Tradicional" cuando tipo_reinversion es null,
            // así que mapeamos sin_reinversion → null para preservar ese label.
            tipo_reinversion:
              tipo_reinversion && tipo_reinversion !== "sin_reinversion"
                ? tipo_reinversion
                : null,
          })),
          usuarioNombre,
          usuarioEmail,
        });
      } catch (mailErr) {
        console.error("[addInvestorToCredit] Error enviando notificación por correo:", mailErr);
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


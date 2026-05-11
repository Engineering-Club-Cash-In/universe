import Big from "big.js";
import { eq, and, inArray, ne } from "drizzle-orm";
import { db } from "../database";
import {
  creditos,
  creditos_inversionistas,
  creditos_inversionistas_espejo,
  inversionistas,
  usuarios,
} from "../database/db";
import z from "zod";
import jwt from "jsonwebtoken";
import { sendSessionCancelledNotification } from "@cci/email";
import { INVESTOR_STATUS_CHANGE_RECIPIENTS } from "../utils/functions/investorStatusRecipients";

const JWT_SECRET = process.env.JWT_SECRET || "6b7a1d9e4f27b4c8d91e5f03a7aa9378db7e2b5c8f3c83de7a9e5f16f5b2a6df";

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

const returnPendingToCubeSchema = z.object({
  creditos: z.union([
    z.number().int().positive(),
    z.array(z.number().int().positive()).min(1),
  ]),
  // Si viene, la limpieza se restringe a ese inversionista (solo se
  // sacan sus filas y su monto vuelve a CUBE). Si no viene, se mantiene
  // el comportamiento original: sacar a todos los inversionistas con
  // status != "completado" de los créditos indicados.
  inversionista_id: z.number().int().positive().optional(),
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
// CONTROLLER: returnPendingInvestorsToCube
// ========================================
//
// FLUJO:
// Limpia créditos sacando a todos los inversionistas con status
// pendiente (!= "completado") y devolviendo su monto a CUBE.
//
// 1. Recibir credito_id(s)
// 2. Buscar en el espejo los registros con status != "completado"
// 3. Agrupar por crédito: qué inversionistas sacar y monto total a devolver a CUBE
// 4. Para cada crédito:
//    a. Traer inversionistas actuales del padre
//    b. Sacar a los pendientes del array
//    c. Devolver el monto total a CUBE (crear CUBE si no existía)
//    d. Recalcular cuotas
//    e. Nuke & rebuild en padre y espejo (todos "completado")
// ========================================

export const returnPendingInvestorsToCube = async ({ body, set, request }: any) => {
  try {
    // ================================================================
    // PASO 0: IDENTIFICACIÓN DEL USUARIO (JWT)
    // request puede ser undefined cuando esta función se llama
    // internamente (ej: job expirarCompraCarteraVencidas), por eso
    // todo el bloque es opcional.
    // ================================================================
    const authHeader = request?.headers?.get?.("authorization") ?? null;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    let adminName = "Job Automatico";
    let adminEmail = "";

    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        adminName = decoded.nombre || decoded.email || "Administrador";
        adminEmail = decoded.email || "";
      } catch (err) {
        console.warn("[returnPendingInvestorsToCube] Token inválido o expirado");
      }
    }

    // ================================================================
    // PASO 1: VALIDAR SCHEMA
    // Acepta un solo credito_id o un arreglo de credito_ids.
    // ================================================================
    const parseResult = returnPendingToCubeSchema.safeParse(body);
    if (!parseResult.success) {
      set.status = 400;
      return {
        message: "Validation failed",
        errors: parseResult.error.flatten().fieldErrors,
      };
    }

    const { creditos: creditosInput, inversionista_id: filtroInversionistaId } =
      parseResult.data;

    // Normalizar a array
    const creditoIds = Array.isArray(creditosInput)
      ? creditosInput
      : [creditosInput];

    // ================================================================
    // PASO 2: BUSCAR INVERSIONISTAS PENDIENTES
    // Todos los registros del espejo con status != "completado"
    // en los créditos indicados. Si viene filtroInversionistaId, se
    // limita a ese inversionista.
    // ================================================================
    const pendientes = await db
      .select({
        credito_id: creditos_inversionistas_espejo.credito_id,
        inversionista_id: creditos_inversionistas_espejo.inversionista_id,
        monto_aportado: creditos_inversionistas_espejo.monto_aportado,
      })
      .from(creditos_inversionistas_espejo)
      .where(
        and(
          inArray(creditos_inversionistas_espejo.credito_id, creditoIds),
          ne(creditos_inversionistas_espejo.status, "completado"),
          ...(typeof filtroInversionistaId === "number"
            ? [
                eq(
                  creditos_inversionistas_espejo.inversionista_id,
                  filtroInversionistaId,
                ),
              ]
            : []),
        ),
      );

    if (pendientes.length === 0) {
      set.status = 404;
      return {
        success: false,
        message: filtroInversionistaId
          ? `No se encontraron filas pendientes del inversionista ${filtroInversionistaId} en los créditos indicados`
          : "No se encontraron inversionistas pendientes en los créditos indicados",
      };
    }

    // ================================================================
    // PASO 3: AGRUPAR POR CRÉDITO Y RECOPILAR DATA PARA CORREO
    // ================================================================
    const porCredito = new Map<
      number,
      {
        monto_total_a_cube: Big;
        inversionistas_a_sacar: Set<number>;
      }
    >();

    for (const p of pendientes) {
      if (!porCredito.has(p.credito_id)) {
        porCredito.set(p.credito_id, {
          monto_total_a_cube: new Big(0),
          inversionistas_a_sacar: new Set(),
        });
      }
      const entry = porCredito.get(p.credito_id)!;
      entry.monto_total_a_cube = entry.monto_total_a_cube.plus(p.monto_aportado);
      entry.inversionistas_a_sacar.add(p.inversionista_id);
    }

    // ── Data adicional para el reporte (Inversionistas y Clientes) ──
    const uniqueInvestorIds = Array.from(new Set(pendientes.map(p => p.inversionista_id)));
    const invData = await db
      .select({ id: inversionistas.inversionista_id, nombre: inversionistas.nombre })
      .from(inversionistas)
      .where(inArray(inversionistas.inversionista_id, uniqueInvestorIds));
    const investorMap = new Map(invData.map(i => [i.id, i.nombre]));

    const creditDetails = await db
      .select({
        id: creditos.credito_id,
        sifco: creditos.numero_credito_sifco,
        cliente: usuarios.nombre
      })
      .from(creditos)
      .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
      .where(inArray(creditos.credito_id, Array.from(porCredito.keys())));
    const creditMap = new Map(creditDetails.map(c => [c.id, c]));

    console.log(
      `🧹 ${porCredito.size} crédito(s) a limpiar`,
    );

    const resultados: any[] = [];

    // ================================================================
    // PASO 4: TRANSACCIÓN DE LIMPIEZA
    // ================================================================
    await db.transaction(async (tx) => {
      for (const [creditoId, info] of porCredito) {
        const { monto_total_a_cube, inversionistas_a_sacar } = info;

        // ── Traer data fresca del crédito ──
        const [creditoData] = await tx
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
          .where(eq(creditos.credito_id, creditoId))
          .limit(1);

        if (!creditoData) continue;

        // ── Traer inversionistas actuales del padre ──
        const invActuales = await tx
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
          .where(eq(creditos_inversionistas.credito_id, creditoId));

        // ── Armar array SIN los pendientes y CON CUBE restaurado ──
        const arrayLimpio: {
          inversionista_id: number;
          monto_aportado: Big;
          porcentaje_cash_in: Big;
          porcentaje_inversion: Big;
          fecha_inicio_participacion: string;
        }[] = [];

        for (const inv of invActuales) {
          if (inversionistas_a_sacar.has(inv.inversionista_id)) {
            continue;
          }
          if (inv.inversionista_id === CUBE_INVESTMENT_ID) {
            arrayLimpio.push({
              inversionista_id: inv.inversionista_id,
              monto_aportado: new Big(inv.monto_aportado).plus(monto_total_a_cube),
              porcentaje_cash_in: new Big(inv.porcentaje_cash_in),
              porcentaje_inversion: new Big(
                inv.porcentaje_participacion_inversionista,
              ),
              fecha_inicio_participacion: inv.fecha_inicio_participacion,
            });
          } else {
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

        // ── Si CUBE no existía, crearlo con el monto devuelto ──
        const cubeEnArray = arrayLimpio.some(
          (inv) => inv.inversionista_id === CUBE_INVESTMENT_ID,
        );
        if (!cubeEnArray) {
          arrayLimpio.push({
            inversionista_id: CUBE_INVESTMENT_ID,
            monto_aportado: monto_total_a_cube,
            porcentaje_cash_in: new Big(0),
            porcentaje_inversion: new Big(100),
            fecha_inicio_participacion: new Date().toISOString().split("T")[0],
          });
        }

        // ── Recalcular y nuke & rebuild PADRE ──
        const dataPadre = recalcularInversionistas(
          arrayLimpio,
          creditoData,
          creditoId,
          creditoData.numero_credito_sifco,
        );

        await tx
          .delete(creditos_inversionistas)
          .where(eq(creditos_inversionistas.credito_id, creditoId));

        if (dataPadre.length > 0) {
          await tx.insert(creditos_inversionistas).values(dataPadre);
        }

        // ── Nuke & rebuild ESPEJO (todo "completado") ──
        const dataEspejo = dataPadre.map((inv) => ({
          ...inv,
          status: "completado" as const,
          updated_at: new Date(),
        }));

        await tx
          .delete(creditos_inversionistas_espejo)
          .where(eq(creditos_inversionistas_espejo.credito_id, creditoId));

        if (dataEspejo.length > 0) {
          await tx.insert(creditos_inversionistas_espejo).values(dataEspejo);
        }

        // ── Apagar bandera_reinversion del crédito ──
        await tx
          .update(creditos)
          .set({ bandera_reinversion: false })
          .where(eq(creditos.credito_id, creditoId));

        resultados.push({
          credito_id: creditoId,
          numero_credito_sifco: creditoData.numero_credito_sifco,
          inversionistas_removidos: Array.from(inversionistas_a_sacar),
          monto_devuelto_a_cube: monto_total_a_cube.toString(),
          inversionistas_restantes: dataPadre.length,
        });

        console.log(
          `   🧹 Crédito ${creditoData.numero_credito_sifco} limpio - ${inversionistas_a_sacar.size} removido(s), Q${monto_total_a_cube} a CUBE, ${dataPadre.length} restantes`,
        );
      }
    });

    // ================================================================
    // PASO 5: NOTIFICACIÓN POR CORREO
    // ================================================================
    try {
      const affectedInvestorNames = Array.from(new Set(pendientes.map(p => investorMap.get(p.inversionista_id)))).join(", ");
      
      const emailCredits = Array.from(porCredito.entries()).map(([creditoId, info]) => {
        const details = creditMap.get(creditoId);
        return {
          sifco: details?.sifco || "N/A",
          cliente: details?.cliente || "Desconocido",
          monto: info.monto_total_a_cube.toFixed(2)
        };
      });

      await sendSessionCancelledNotification({
        to: INVESTOR_STATUS_CHANGE_RECIPIENTS,
        affectedInvestorNames,
        adminName,
        adminEmail,
        credits: emailCredits
      });
    } catch (mailErr) {
      console.error("[returnPendingInvestorsToCube] Falló envío de correo:", mailErr);
    }

    // ================================================================
    // PASO 6: RESPUESTA
    // ================================================================
    set.status = 200;
    return {
      success: true,
      message: `${resultados.length} crédito(s) limpiado(s)`,
      creditos_limpiados: resultados,
    };
  } catch (error) {
    console.error("[returnPendingInvestorsToCube] Error:", error);
    set.status = 500;
    return {
      success: false,
      message: "Error al limpiar pendientes",
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

        // ── Activar bandera_reinversion en el destino si es compra_cartera ──
        // Mientras el espejo esté en pendiente_compra_cartera, cofidi redirige
        // los intereses del inversionista nuevo a CUBE. Se apaga al aceptar
        // la compra o si se limpia/cancela después.
        if (tipo_operacion === "compra_cartera") {
          await tx
            .update(creditos)
            .set({ bandera_reinversion: true })
            .where(eq(creditos.credito_id, credito_destino_id));
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

      // ── Apagar bandera_reinversion del crédito origen ──
      // El espejo del origen quedó todo en "completado": ya no hay
      // inversionistas pendientes a quienes redirigir intereses.
      await tx
        .update(creditos)
        .set({ bandera_reinversion: false })
        .where(eq(creditos.credito_id, credito_espejo_removido_id));

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
        //@ts-ignore
        credito_id: origenInfo?.credito_id,
        //@ts-ignore
        numero_credito_sifco: origenInfo?.numero_credito_sifco,
        inversionista_removido: inversionista_id,
        //@ts-ignore
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

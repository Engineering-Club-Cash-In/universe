import Big from "big.js";
import { eq, and, inArray, ne } from "drizzle-orm";
import { db } from "../database";
import {
  compras_credito_inversionista,
  creditos,
  creditos_inversionistas,
  creditos_inversionistas_espejo,
  inversionistas,
  usuarios,
} from "../database/db";
import z from "zod";
import jwt from "jsonwebtoken";
import { sendSessionCancelledNotification } from "@cci/email";
import { COMPRA_CARTERA_RECIPIENTS } from "../utils/functions/compraCarteraRecipients";

const JWT_SECRET = process.env.JWT_SECRET || "supersecreto";

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
    //
    // El espejo nos dice QUIÉN tiene operación pendiente. El monto a
    // devolver a CUBE NO sale de aquí: el monto_aportado del espejo es
    // el acumulado (lo que el inversionista ya tenía + lo de la compra
    // pendiente). El delta real de la operación pendiente está en
    // compras_credito_inversionista (ver PASO 2b).
    // ================================================================
    const pendientes = await db
      .select({
        credito_id: creditos_inversionistas_espejo.credito_id,
        inversionista_id: creditos_inversionistas_espejo.inversionista_id,
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
    // PASO 2b: LEER DELTAS DESDE compras_credito_inversionista
    // Cada fila aquí guarda el monto NUEVO de UNA operación (no el
    // acumulado). Si el mismo (credito_id, inversionista_id) tiene
    // varias filas pendientes (varias compras sin aceptar), las
    // sumamos: ese total es lo que vuelve a CUBE para ese par.
    // ================================================================
    const comprasPendientes = await db
      .select({
        credito_id: compras_credito_inversionista.credito_id,
        inversionista_id: compras_credito_inversionista.inversionista_id,
        monto_aportado: compras_credito_inversionista.monto_aportado,
      })
      .from(compras_credito_inversionista)
      .where(
        and(
          inArray(compras_credito_inversionista.credito_id, creditoIds),
          ne(compras_credito_inversionista.status, "completado"),
          ...(typeof filtroInversionistaId === "number"
            ? [
                eq(
                  compras_credito_inversionista.inversionista_id,
                  filtroInversionistaId,
                ),
              ]
            : []),
        ),
      );

    const deltaPorPar = new Map<string, Big>();
    for (const c of comprasPendientes) {
      const key = `${c.credito_id}-${c.inversionista_id}`;
      const prev = deltaPorPar.get(key) ?? new Big(0);
      deltaPorPar.set(key, prev.plus(new Big(c.monto_aportado)));
    }

    // ================================================================
    // PASO 3: AGRUPAR POR CRÉDITO Y RECOPILAR DATA PARA CORREO
    // monto_total_a_cube = suma de DELTAS de las compras pendientes
    // (no del monto_aportado acumulado del espejo). Si no hay registro
    // en compras (data legacy previa a esa tabla), caemos al monto del
    // espejo como fallback histórico.
    // ================================================================
    const porCredito = new Map<
      number,
      {
        monto_total_a_cube: Big;
        inversionistas_con_pendiente: Set<number>;
      }
    >();

    // Para el fallback legacy necesitamos el monto del espejo de los
    // pares que no tengan registro en compras. Lo cargamos solo si hay
    // pares sin delta para no traer data de más.
    const paresSinDelta = pendientes.filter(
      (p) => !deltaPorPar.has(`${p.credito_id}-${p.inversionista_id}`),
    );
    const montoEspejoLegacy = new Map<string, Big>();
    if (paresSinDelta.length > 0) {
      const legacyRows = await db
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
          ),
        );
      for (const r of legacyRows) {
        montoEspejoLegacy.set(
          `${r.credito_id}-${r.inversionista_id}`,
          new Big(r.monto_aportado),
        );
      }
    }

    for (const p of pendientes) {
      if (!porCredito.has(p.credito_id)) {
        porCredito.set(p.credito_id, {
          monto_total_a_cube: new Big(0),
          inversionistas_con_pendiente: new Set(),
        });
      }
      const entry = porCredito.get(p.credito_id)!;
      const key = `${p.credito_id}-${p.inversionista_id}`;
      const delta =
        deltaPorPar.get(key) ??
        montoEspejoLegacy.get(key) ??
        new Big(0);
      entry.monto_total_a_cube = entry.monto_total_a_cube.plus(delta);
      entry.inversionistas_con_pendiente.add(p.inversionista_id);
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
        const { monto_total_a_cube, inversionistas_con_pendiente } = info;

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

        // ── Traer inversionistas actuales del PADRE y del ESPEJO ──
        // Ambas tablas se procesan independientes: pueden tener desfases
        // históricos en monto_aportado (ej: el espejo puede traer un monto
        // mayor que el padre por un ajuste viejo). La cancelación resta el
        // delta de la compra a CADA tabla por separado, y las cuotas se
        // recalculan también de forma independiente con el monto propio de
        // cada tabla.
        const invActualesPadre = await tx
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

        const invActualesEspejo = await tx
          .select({
            inversionista_id: creditos_inversionistas_espejo.inversionista_id,
            monto_aportado: creditos_inversionistas_espejo.monto_aportado,
            porcentaje_cash_in: creditos_inversionistas_espejo.porcentaje_cash_in,
            porcentaje_participacion_inversionista:
              creditos_inversionistas_espejo.porcentaje_participacion_inversionista,
            fecha_inicio_participacion:
              creditos_inversionistas_espejo.fecha_inicio_participacion,
          })
          .from(creditos_inversionistas_espejo)
          .where(eq(creditos_inversionistas_espejo.credito_id, creditoId));

        const espejoPorInv = new Map(
          invActualesEspejo.map((i) => [i.inversionista_id, i]),
        );

        // Lista de inversionistas que terminaron saliendo del crédito
        // (su posición acumulada en el PADRE era igual o menor al delta).
        const inversionistas_removidos: number[] = [];

        type InvArrayItem = {
          inversionista_id: number;
          monto_aportado: Big;
          porcentaje_cash_in: Big;
          porcentaje_inversion: Big;
          fecha_inicio_participacion: string;
        };

        const arrayPadre: InvArrayItem[] = [];
        const arrayEspejo: InvArrayItem[] = [];

        for (const invP of invActualesPadre) {
          const invE = espejoPorInv.get(invP.inversionista_id);
          const montoPadreActual = new Big(invP.monto_aportado);
          const montoEspejoActual = invE
            ? new Big(invE.monto_aportado)
            : montoPadreActual;

          if (inversionistas_con_pendiente.has(invP.inversionista_id)) {
            const key = `${creditoId}-${invP.inversionista_id}`;
            const delta =
              deltaPorPar.get(key) ??
              montoEspejoLegacy.get(key) ??
              montoPadreActual;

            const nuevoMontoPadre = montoPadreActual.minus(delta);
            const nuevoMontoEspejo = montoEspejoActual.minus(delta);

            // La regla de remoción se evalúa contra el PADRE (la fuente de
            // verdad). Si el padre queda en <=0, también se saca del espejo
            // para no dejar filas zombies.
            if (nuevoMontoPadre.lte(0)) {
              inversionistas_removidos.push(invP.inversionista_id);
              continue;
            }

            arrayPadre.push({
              inversionista_id: invP.inversionista_id,
              monto_aportado: nuevoMontoPadre,
              porcentaje_cash_in: new Big(invP.porcentaje_cash_in),
              porcentaje_inversion: new Big(
                invP.porcentaje_participacion_inversionista,
              ),
              fecha_inicio_participacion: invP.fecha_inicio_participacion,
            });
            arrayEspejo.push({
              inversionista_id: invP.inversionista_id,
              monto_aportado: nuevoMontoEspejo.lte(0)
                ? nuevoMontoPadre
                : nuevoMontoEspejo,
              porcentaje_cash_in: new Big(
                invE?.porcentaje_cash_in ?? invP.porcentaje_cash_in,
              ),
              porcentaje_inversion: new Big(
                invE?.porcentaje_participacion_inversionista ??
                  invP.porcentaje_participacion_inversionista,
              ),
              fecha_inicio_participacion:
                invE?.fecha_inicio_participacion ??
                invP.fecha_inicio_participacion,
            });
          } else if (invP.inversionista_id === CUBE_INVESTMENT_ID) {
            arrayPadre.push({
              inversionista_id: invP.inversionista_id,
              monto_aportado: montoPadreActual.plus(monto_total_a_cube),
              porcentaje_cash_in: new Big(invP.porcentaje_cash_in),
              porcentaje_inversion: new Big(
                invP.porcentaje_participacion_inversionista,
              ),
              fecha_inicio_participacion: invP.fecha_inicio_participacion,
            });
            arrayEspejo.push({
              inversionista_id: invP.inversionista_id,
              monto_aportado: montoEspejoActual.plus(monto_total_a_cube),
              porcentaje_cash_in: new Big(
                invE?.porcentaje_cash_in ?? invP.porcentaje_cash_in,
              ),
              porcentaje_inversion: new Big(
                invE?.porcentaje_participacion_inversionista ??
                  invP.porcentaje_participacion_inversionista,
              ),
              fecha_inicio_participacion:
                invE?.fecha_inicio_participacion ??
                invP.fecha_inicio_participacion,
            });
          } else {
            // Otros inversionistas: cada tabla copia su propio valor.
            arrayPadre.push({
              inversionista_id: invP.inversionista_id,
              monto_aportado: montoPadreActual,
              porcentaje_cash_in: new Big(invP.porcentaje_cash_in),
              porcentaje_inversion: new Big(
                invP.porcentaje_participacion_inversionista,
              ),
              fecha_inicio_participacion: invP.fecha_inicio_participacion,
            });
            arrayEspejo.push({
              inversionista_id: invP.inversionista_id,
              monto_aportado: montoEspejoActual,
              porcentaje_cash_in: new Big(
                invE?.porcentaje_cash_in ?? invP.porcentaje_cash_in,
              ),
              porcentaje_inversion: new Big(
                invE?.porcentaje_participacion_inversionista ??
                  invP.porcentaje_participacion_inversionista,
              ),
              fecha_inicio_participacion:
                invE?.fecha_inicio_participacion ??
                invP.fecha_inicio_participacion,
            });
          }
        }

        // ── Si CUBE no existía en alguna tabla, crearlo ──
        const fechaCubeDefault = new Date().toISOString().split("T")[0];
        if (!arrayPadre.some((i) => i.inversionista_id === CUBE_INVESTMENT_ID)) {
          arrayPadre.push({
            inversionista_id: CUBE_INVESTMENT_ID,
            monto_aportado: monto_total_a_cube,
            porcentaje_cash_in: new Big(0),
            porcentaje_inversion: new Big(100),
            fecha_inicio_participacion: fechaCubeDefault,
          });
        }
        if (!arrayEspejo.some((i) => i.inversionista_id === CUBE_INVESTMENT_ID)) {
          arrayEspejo.push({
            inversionista_id: CUBE_INVESTMENT_ID,
            monto_aportado: monto_total_a_cube,
            porcentaje_cash_in: new Big(0),
            porcentaje_inversion: new Big(100),
            fecha_inicio_participacion: fechaCubeDefault,
          });
        }

        // ── Recalcular cuotas INDEPENDIENTE para padre y espejo ──
        // Cada tabla usa su propio array (con sus propios monto_aportado),
        // así las cuotas reflejan el monto real de cada tabla.
        const dataPadre = recalcularInversionistas(
          arrayPadre,
          creditoData,
          creditoId,
          creditoData.numero_credito_sifco,
        );

        const dataEspejoBase = recalcularInversionistas(
          arrayEspejo,
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

        // ── Espejo: agregar status="completado" + updated_at ──
        const dataEspejo = dataEspejoBase.map((inv) => ({
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

        // ── Limpiar compras_credito_inversionista pendientes ──
        // Como la operación de los inversionistas que salen NUNCA llegó
        // a completarse (cancelación / expiración), borramos sus filas
        // pendientes en compras_credito_inversionista. Si no, quedarían
        // como deltas "huérfanos" y una próxima aceptación de otra
        // compra sobre el mismo crédito los sumaría, inflando el monto
        // del correo y el % ponderado.
        // Conservamos los registros con status "completado" (audit
        // trail de operaciones que sí cerraron en el pasado).
        if (inversionistas_con_pendiente.size > 0) {
          await tx
            .delete(compras_credito_inversionista)
            .where(
              and(
                eq(compras_credito_inversionista.credito_id, creditoId),
                inArray(
                  compras_credito_inversionista.inversionista_id,
                  Array.from(inversionistas_con_pendiente),
                ),
                ne(compras_credito_inversionista.status, "completado"),
              ),
            );
        }

        // ── Apagar bandera_reinversion del crédito ──
        await tx
          .update(creditos)
          .set({ bandera_reinversion: false })
          .where(eq(creditos.credito_id, creditoId));

        resultados.push({
          credito_id: creditoId,
          numero_credito_sifco: creditoData.numero_credito_sifco,
          inversionistas_con_pendiente: Array.from(inversionistas_con_pendiente),
          inversionistas_removidos,
          monto_devuelto_a_cube: monto_total_a_cube.toString(),
          inversionistas_restantes: dataPadre.length,
        });

        console.log(
          `   🧹 Crédito ${creditoData.numero_credito_sifco} limpio - ${inversionistas_con_pendiente.size} pendiente(s) (${inversionistas_removidos.length} salieron del crédito), Q${monto_total_a_cube} a CUBE, ${dataPadre.length} restantes`,
        );
      }
    });

    // ================================================================
    // PASO 5: NOTIFICACIÓN POR CORREO (Solo si es acción manual/HTTP)
    // ================================================================
    if (request) {
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
          to: COMPRA_CARTERA_RECIPIENTS.to,
          cc: COMPRA_CARTERA_RECIPIENTS.cc,
          affectedInvestorNames,
          adminName,
          adminEmail,
          credits: emailCredits
        });
      } catch (mailErr) {
        console.error("[returnPendingInvestorsToCube] Falló envío de correo:", mailErr);
      }
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
    let origenInfo: {
      credito_id: number;
      numero_credito_sifco: string;
      monto_devuelto: string;
      inversionista_salio_del_credito: boolean;
    } | null = null;

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

      // ── Leer el DELTA de la operación pendiente ──
      // El monto_aportado del padre/espejo es el acumulado (lo que el
      // inversionista ya tenía + lo de la compra pendiente). Para saber
      // qué monto vuelve a CUBE necesitamos el delta de la(s) operación(es)
      // pendiente(s) en compras_credito_inversionista. Si hay varias filas
      // pendientes para el mismo par, las sumamos. Fallback al monto del
      // padre solo para data legacy sin registros en compras.
      const comprasPendientesOrigen = await tx
        .select({
          monto_aportado: compras_credito_inversionista.monto_aportado,
        })
        .from(compras_credito_inversionista)
        .where(
          and(
            eq(
              compras_credito_inversionista.credito_id,
              credito_espejo_removido_id,
            ),
            eq(
              compras_credito_inversionista.inversionista_id,
              inversionista_id,
            ),
            ne(compras_credito_inversionista.status, "completado"),
          ),
        );

      const deltaPendienteOrigen = comprasPendientesOrigen.reduce(
        (acc, r) => acc.plus(new Big(r.monto_aportado)),
        new Big(0),
      );

      const montoPadreOrigen = new Big(invEnOrigen.monto_aportado);
      const montoEnOrigen = deltaPendienteOrigen.gt(0)
        ? deltaPendienteOrigen
        : montoPadreOrigen;

      console.log(
        `\n🔄 Reasignación manual: inversionista ${inversionista_id}`,
      );
      console.log(
        `   Origen: crédito ${creditoOrigen.numero_credito_sifco} - delta pendiente Q${montoEnOrigen} (padre acumulado Q${montoPadreOrigen})`,
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

        // ── Traer inversionistas actuales del destino (padre + espejo) ──
        // El destino tambien procesa cada tabla independiente. La regla de
        // CUBE-suficiente se evalúa sobre el padre (fuente de verdad).
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

        const invDestinoEspejoActuales = await tx
          .select({
            inversionista_id: creditos_inversionistas_espejo.inversionista_id,
            monto_aportado: creditos_inversionistas_espejo.monto_aportado,
            porcentaje_cash_in: creditos_inversionistas_espejo.porcentaje_cash_in,
            porcentaje_participacion_inversionista:
              creditos_inversionistas_espejo.porcentaje_participacion_inversionista,
            fecha_inicio_participacion:
              creditos_inversionistas_espejo.fecha_inicio_participacion,
          })
          .from(creditos_inversionistas_espejo)
          .where(
            eq(creditos_inversionistas_espejo.credito_id, credito_destino_id),
          );

        const espejoPorInvDestino = new Map(
          invDestinoEspejoActuales.map((i) => [i.inversionista_id, i]),
        );

        // ── Buscar CUBE en el destino (padre) ──
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

        // ── Validar que CUBE tenga suficiente (en el padre) ──
        if (montoAsignar.gt(montoCubeDestino)) {
          errores.push({
            credito_destino_id,
            razon: `Monto Q${montoAsignar} excede CUBE Q${montoCubeDestino} en crédito destino`,
          });
          continue;
        }

        type InvArrayItem = {
          inversionista_id: number;
          monto_aportado: Big;
          porcentaje_cash_in: Big;
          porcentaje_inversion: Big;
          fecha_inicio_participacion: string;
        };

        const arrayDestinoPadre: InvArrayItem[] = [];
        const arrayDestinoEspejo: InvArrayItem[] = [];

        for (const invP of invDestinoActuales) {
          const invE = espejoPorInvDestino.get(invP.inversionista_id);
          const montoPadreActual = new Big(invP.monto_aportado);
          const montoEspejoActual = invE
            ? new Big(invE.monto_aportado)
            : montoPadreActual;

          if (invP.inversionista_id === CUBE_INVESTMENT_ID) {
            // Restarle al CUBE el monto asignado (cada tabla con su propio valor).
            const nuevoMontoCubePadre = montoPadreActual.minus(montoAsignar);
            const nuevoMontoCubeEspejo = montoEspejoActual.minus(montoAsignar);

            if (nuevoMontoCubePadre.gt(0)) {
              arrayDestinoPadre.push({
                inversionista_id: invP.inversionista_id,
                monto_aportado: nuevoMontoCubePadre,
                porcentaje_cash_in: new Big(invP.porcentaje_cash_in),
                porcentaje_inversion: new Big(
                  invP.porcentaje_participacion_inversionista,
                ),
                fecha_inicio_participacion: invP.fecha_inicio_participacion,
              });
            }
            if (nuevoMontoCubeEspejo.gt(0)) {
              arrayDestinoEspejo.push({
                inversionista_id: invP.inversionista_id,
                monto_aportado: nuevoMontoCubeEspejo,
                porcentaje_cash_in: new Big(
                  invE?.porcentaje_cash_in ?? invP.porcentaje_cash_in,
                ),
                porcentaje_inversion: new Big(
                  invE?.porcentaje_participacion_inversionista ??
                    invP.porcentaje_participacion_inversionista,
                ),
                fecha_inicio_participacion:
                  invE?.fecha_inicio_participacion ??
                  invP.fecha_inicio_participacion,
              });
            }
          } else if (invP.inversionista_id === inversionista_id) {
            // Inversionista ya existía: sumarle el delta a cada tabla con
            // su propio monto base.
            arrayDestinoPadre.push({
              inversionista_id: invP.inversionista_id,
              monto_aportado: montoPadreActual.plus(montoAsignar),
              porcentaje_cash_in: porcCashIn,
              porcentaje_inversion: porcInversion,
              fecha_inicio_participacion: invP.fecha_inicio_participacion,
            });
            arrayDestinoEspejo.push({
              inversionista_id: invP.inversionista_id,
              monto_aportado: montoEspejoActual.plus(montoAsignar),
              porcentaje_cash_in: porcCashIn,
              porcentaje_inversion: porcInversion,
              fecha_inicio_participacion:
                invE?.fecha_inicio_participacion ??
                invP.fecha_inicio_participacion,
            });
          } else {
            // Otros: copiar cada uno con su propio valor.
            arrayDestinoPadre.push({
              inversionista_id: invP.inversionista_id,
              monto_aportado: montoPadreActual,
              porcentaje_cash_in: new Big(invP.porcentaje_cash_in),
              porcentaje_inversion: new Big(
                invP.porcentaje_participacion_inversionista,
              ),
              fecha_inicio_participacion: invP.fecha_inicio_participacion,
            });
            arrayDestinoEspejo.push({
              inversionista_id: invP.inversionista_id,
              monto_aportado: montoEspejoActual,
              porcentaje_cash_in: new Big(
                invE?.porcentaje_cash_in ?? invP.porcentaje_cash_in,
              ),
              porcentaje_inversion: new Big(
                invE?.porcentaje_participacion_inversionista ??
                  invP.porcentaje_participacion_inversionista,
              ),
              fecha_inicio_participacion:
                invE?.fecha_inicio_participacion ??
                invP.fecha_inicio_participacion,
            });
          }
        }

        // ── Si el inversionista no existía en el destino, agregarlo en
        //    ambas tablas con el mismo monto (no hay valor histórico previo). ──
        const hoy = new Date();
        const hoyStr = hoy.toISOString().split("T")[0];
        const dosMesesAtras = new Date(hoy.getFullYear(), hoy.getMonth() - 2, hoy.getDate())
          .toISOString()
          .split("T")[0];
        if (
          !arrayDestinoPadre.some(
            (inv) => inv.inversionista_id === inversionista_id,
          )
        ) {
          arrayDestinoPadre.push({
            inversionista_id,
            monto_aportado: montoAsignar,
            porcentaje_cash_in: porcCashIn,
            porcentaje_inversion: porcInversion,
            fecha_inicio_participacion: tipo_operacion === "reinversion" ? dosMesesAtras : hoyStr,
          });
        }
        if (
          !arrayDestinoEspejo.some(
            (inv) => inv.inversionista_id === inversionista_id,
          )
        ) {
          arrayDestinoEspejo.push({
            inversionista_id,
            monto_aportado: montoAsignar,
            porcentaje_cash_in: porcCashIn,
            porcentaje_inversion: porcInversion,
            fecha_inicio_participacion: tipo_operacion === "reinversion" ? dosMesesAtras : hoyStr,
          });
        }

        // ── Recalcular cuotas INDEPENDIENTE para padre y espejo ──
        const dataPadreDestino = recalcularInversionistas(
          arrayDestinoPadre,
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

        const dataEspejoDestino = recalcularInversionistas(
          arrayDestinoEspejo,
          creditoDestino,
          credito_destino_id,
          creditoDestino.numero_credito_sifco,
        );

        const dataEspejoDestinoFinal = dataEspejoDestino.map((inv) => ({
          ...inv,
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

        // ── Registrar el delta de esta reasignación en compras_credito_inversionista ──
        // Mismo patrón que addInvestorToCredit: guardamos SOLO el monto
        // nuevo asignado a este destino (montoAsignar), no el acumulado.
        // El correo de aceptación/expiración después lo lee desde aquí.
        await tx.insert(compras_credito_inversionista).values({
          credito_id: credito_destino_id,
          inversionista_id,
          monto_aportado: montoAsignar.toString(),
          tipo_operacion,
          tipo_reinversion: null,
          status: statusEspejo,
        });

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
          cube_eliminado: !arrayDestinoPadre.some(
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
      // ── Leer ambas tablas para el origen (padre + espejo) ──
      // El cleanup del origen aplica el delta de forma INDEPENDIENTE en padre
      // y espejo: cada uno arranca con su propio monto y puede terminar en
      // un valor distinto si arrastraba un desfase histórico.
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

      const invOrigenEspejoFresh = await tx
        .select({
          inversionista_id: creditos_inversionistas_espejo.inversionista_id,
          monto_aportado: creditos_inversionistas_espejo.monto_aportado,
          porcentaje_cash_in: creditos_inversionistas_espejo.porcentaje_cash_in,
          porcentaje_participacion_inversionista:
            creditos_inversionistas_espejo.porcentaje_participacion_inversionista,
          fecha_inicio_participacion:
            creditos_inversionistas_espejo.fecha_inicio_participacion,
        })
        .from(creditos_inversionistas_espejo)
        .where(
          eq(
            creditos_inversionistas_espejo.credito_id,
            credito_espejo_removido_id,
          ),
        );

      const espejoPorInvOrigen = new Map(
        invOrigenEspejoFresh.map((i) => [i.inversionista_id, i]),
      );

      type InvArrayItem = {
        inversionista_id: number;
        monto_aportado: Big;
        porcentaje_cash_in: Big;
        porcentaje_inversion: Big;
        fecha_inicio_participacion: string;
      };

      const arrayOrigenPadre: InvArrayItem[] = [];
      const arrayOrigenEspejo: InvArrayItem[] = [];

      let inversionistaRemovidoDelOrigen = false;

      for (const invP of invOrigenFresh) {
        const invE = espejoPorInvOrigen.get(invP.inversionista_id);
        const montoPadreActual = new Big(invP.monto_aportado);
        const montoEspejoActual = invE
          ? new Big(invE.monto_aportado)
          : montoPadreActual;

        if (invP.inversionista_id === inversionista_id) {
          const nuevoMontoPadre = montoPadreActual.minus(montoEnOrigen);
          const nuevoMontoEspejo = montoEspejoActual.minus(montoEnOrigen);
          // Regla de remoción basada en el padre (fuente de verdad).
          if (nuevoMontoPadre.lte(0)) {
            inversionistaRemovidoDelOrigen = true;
            continue;
          }
          arrayOrigenPadre.push({
            inversionista_id: invP.inversionista_id,
            monto_aportado: nuevoMontoPadre,
            porcentaje_cash_in: new Big(invP.porcentaje_cash_in),
            porcentaje_inversion: new Big(
              invP.porcentaje_participacion_inversionista,
            ),
            fecha_inicio_participacion: invP.fecha_inicio_participacion,
          });
          arrayOrigenEspejo.push({
            inversionista_id: invP.inversionista_id,
            monto_aportado: nuevoMontoEspejo.lte(0)
              ? nuevoMontoPadre
              : nuevoMontoEspejo,
            porcentaje_cash_in: new Big(
              invE?.porcentaje_cash_in ?? invP.porcentaje_cash_in,
            ),
            porcentaje_inversion: new Big(
              invE?.porcentaje_participacion_inversionista ??
                invP.porcentaje_participacion_inversionista,
            ),
            fecha_inicio_participacion:
              invE?.fecha_inicio_participacion ??
              invP.fecha_inicio_participacion,
          });
        } else if (invP.inversionista_id === CUBE_INVESTMENT_ID) {
          arrayOrigenPadre.push({
            inversionista_id: invP.inversionista_id,
            monto_aportado: montoPadreActual.plus(montoEnOrigen),
            porcentaje_cash_in: new Big(invP.porcentaje_cash_in),
            porcentaje_inversion: new Big(
              invP.porcentaje_participacion_inversionista,
            ),
            fecha_inicio_participacion: invP.fecha_inicio_participacion,
          });
          arrayOrigenEspejo.push({
            inversionista_id: invP.inversionista_id,
            monto_aportado: montoEspejoActual.plus(montoEnOrigen),
            porcentaje_cash_in: new Big(
              invE?.porcentaje_cash_in ?? invP.porcentaje_cash_in,
            ),
            porcentaje_inversion: new Big(
              invE?.porcentaje_participacion_inversionista ??
                invP.porcentaje_participacion_inversionista,
            ),
            fecha_inicio_participacion:
              invE?.fecha_inicio_participacion ??
              invP.fecha_inicio_participacion,
          });
        } else {
          arrayOrigenPadre.push({
            inversionista_id: invP.inversionista_id,
            monto_aportado: montoPadreActual,
            porcentaje_cash_in: new Big(invP.porcentaje_cash_in),
            porcentaje_inversion: new Big(
              invP.porcentaje_participacion_inversionista,
            ),
            fecha_inicio_participacion: invP.fecha_inicio_participacion,
          });
          arrayOrigenEspejo.push({
            inversionista_id: invP.inversionista_id,
            monto_aportado: montoEspejoActual,
            porcentaje_cash_in: new Big(
              invE?.porcentaje_cash_in ?? invP.porcentaje_cash_in,
            ),
            porcentaje_inversion: new Big(
              invE?.porcentaje_participacion_inversionista ??
                invP.porcentaje_participacion_inversionista,
            ),
            fecha_inicio_participacion:
              invE?.fecha_inicio_participacion ??
              invP.fecha_inicio_participacion,
          });
        }
      }

      // ── Si CUBE no existía en alguna tabla (raro), crearlo ──
      if (
        !arrayOrigenPadre.some((i) => i.inversionista_id === CUBE_INVESTMENT_ID)
      ) {
        arrayOrigenPadre.push({
          inversionista_id: CUBE_INVESTMENT_ID,
          monto_aportado: montoEnOrigen,
          porcentaje_cash_in: new Big(0),
          porcentaje_inversion: new Big(100),
          fecha_inicio_participacion: "2025-12-01",
        });
      }
      if (
        !arrayOrigenEspejo.some(
          (i) => i.inversionista_id === CUBE_INVESTMENT_ID,
        )
      ) {
        arrayOrigenEspejo.push({
          inversionista_id: CUBE_INVESTMENT_ID,
          monto_aportado: montoEnOrigen,
          porcentaje_cash_in: new Big(0),
          porcentaje_inversion: new Big(100),
          fecha_inicio_participacion: "2025-12-01",
        });
      }

      // ── Recalcular cuotas INDEPENDIENTE para padre y espejo ──
      const dataPadreOrigenFinal = recalcularInversionistas(
        arrayOrigenPadre,
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

      const dataEspejoOrigenFinal = recalcularInversionistas(
        arrayOrigenEspejo,
        creditoOrigen,
        credito_espejo_removido_id,
        creditoOrigen.numero_credito_sifco,
      );

      const dataEspejoOrigenConStatus = dataEspejoOrigenFinal.map((inv) => ({
        ...inv,
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

      // ── Limpiar compras_credito_inversionista pendientes del origen ──
      // El inversionista salió del crédito origen (su monto volvió a CUBE
      // y/o se reasignó a los destinos). Cualquier delta pendiente que
      // hubiera quedado para ese par (origen, inversionista) ya no es
      // válido: si lo dejamos, una próxima aceptación lo sumaría como
      // monto fantasma. Conservamos los "completado" (audit trail).
      await tx
        .delete(compras_credito_inversionista)
        .where(
          and(
            eq(
              compras_credito_inversionista.credito_id,
              credito_espejo_removido_id,
            ),
            eq(
              compras_credito_inversionista.inversionista_id,
              inversionista_id,
            ),
            ne(compras_credito_inversionista.status, "completado"),
          ),
        );

      // ── Apagar bandera_reinversion del crédito origen ──
      // El espejo del origen quedó todo en "completado": ya no hay
      // inversionistas pendientes a quienes redirigir intereses.
      await tx
        .update(creditos)
        .set({ bandera_reinversion: false })
        .where(eq(creditos.credito_id, credito_espejo_removido_id));

      console.log(
        `   🧹 Crédito origen ${creditoOrigen.numero_credito_sifco} limpio - ${dataPadreOrigenFinal.length} inversionistas restantes${
          inversionistaRemovidoDelOrigen
            ? ` (inversionista ${inversionista_id} salió del crédito)`
            : ` (inversionista ${inversionista_id} se queda con posición previa)`
        }`,
      );

      // Guardar info del origen para la respuesta
      origenInfo = {
        credito_id: credito_espejo_removido_id,
        numero_credito_sifco: creditoOrigen.numero_credito_sifco,
        monto_devuelto: montoEnOrigen.toString(),
        inversionista_salio_del_credito: inversionistaRemovidoDelOrigen,
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
        inversionista_id,
        inversionista_salio_del_credito:
          //@ts-ignore
          origenInfo?.inversionista_salio_del_credito ?? false,
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

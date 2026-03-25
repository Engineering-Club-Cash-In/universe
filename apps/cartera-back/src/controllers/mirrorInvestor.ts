import Big from "big.js";
import { db } from "../database";
import {
  creditos,
  creditos_inversionistas,
  creditos_inversionistas_espejo,
  inversionistas,
  usuarios,
} from "../database/db";
import { and, eq, ilike, sql, or, inArray } from "drizzle-orm";

/** Quita tildes/acentos de un string */
function removeAccents(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Busca un inversionista por nombre.
 * 1) Trae candidatos de la BD con ILIKE en la primera palabra (sin tildes via translate())
 * 2) Puntúa cada candidato por cuántas palabras del input aparecen en su nombre
 * 3) Retorna solo el/los de mayor puntaje
 */
async function buscarInversionista(nombreCompleto: string) {
  const inputNorm = removeAccents(nombreCompleto.toLowerCase().trim());
  const partes = inputNorm.split(/\s+/);

  const candidatos = await db
    .select({
      inversionista_id: inversionistas.inversionista_id,
      nombre: inversionistas.nombre,
    })
    .from(inversionistas)
    .where(
      sql`translate(lower(${inversionistas.nombre}), 'áéíóúàèìòùäëïöüâêîôûñ', 'aeiouaeiouaeiouaeioun') ILIKE ${"%" + partes[0] + "%"}`
    );

  if (candidatos.length <= 1) return candidatos;

  const scored = candidatos.map((c) => {
    const nombreNorm = removeAccents(c.nombre.toLowerCase());
    const score = partes.filter((p) => nombreNorm.includes(p)).length;
    return { ...c, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const maxScore = scored[0].score;
  return scored
    .filter((s) => s.score === maxScore)
    .map(({ score, ...rest }) => rest);
}

// ─────────────────────────────────────────────────────────────
// FUNCIÓN: calcularCuotaInversionista
// Replica la lógica de createCredit.ts líneas 335-494
// pero consultando datos reales de la BD en vez de recibirlos.
//
// Parámetros:
//   - tx: transacción de Drizzle
//   - creditoId: ID del crédito
//   - inversionistaId: ID del inversionista para quien calculamos
//   - montoAportadoEspejo: el capital del inversionista en el espejo (body.capital)
//
// Lógica:
//   1. Trae el crédito (cuota, seguro, membresías, capital total)
//   2. Trae TODOS los inversionistas reales de ese crédito (creditos_inversionistas)
//   3. Calcula porcentajeParticipacion = montoAportadoEspejo / capitalTotal * 100
//   4. cuotaSinCargos = cuota - membresías - seguro
//   5. cuotaBase = cuotaSinCargos * (porcentajeParticipacion / 100)
//   6. Determina quién es el inversionista mayor (por monto_aportado en la tabla REAL)
//   7. Si ESTE inversionista es el mayor → cuotaBase + seguro + membresías
//   8. Si no → cuotaBase
// ─────────────────────────────────────────────────────────────
async function calcularCuotaInversionista(
  tx: any,
  creditoId: number,
  inversionistaId: number,
  montoAportadoEspejo: Big
) {
  // 1) Traer datos del crédito
  const [creditoData] = await tx
    .select({
      capital: creditos.capital,
      cuota: creditos.cuota,
      seguro_10_cuotas: creditos.seguro_10_cuotas,
      membresias_pago: creditos.membresias_pago,
    })
    .from(creditos)
    .where(eq(creditos.credito_id, creditoId))
    .limit(1);

  if (!creditoData) {
    throw new Error(`No se encontró crédito con ID ${creditoId}`);
  }

  const capitalTotal = new Big(creditoData.capital);
  const cuotaTotal = new Big(creditoData.cuota);
  const seguro = new Big(creditoData.seguro_10_cuotas || 0);
  const membresias = new Big(creditoData.membresias_pago || 0);

  // 2) Traer TODOS los inversionistas reales de este crédito
  const inversionistasReales = await tx
    .select({
      inversionista_id: creditos_inversionistas.inversionista_id,
      monto_aportado: creditos_inversionistas.monto_aportado,
    })
    .from(creditos_inversionistas)
    .where(eq(creditos_inversionistas.credito_id, creditoId));

  // 3) Porcentaje de participación = montoAportadoEspejo / capitalTotal * 100
  const porcentajeParticipacion = montoAportadoEspejo.div(capitalTotal).times(100);

  // 4) Cuota sin cargos = cuota - membresías - seguro
  const cuotaSinCargos = cuotaTotal.minus(membresias).minus(seguro);

  // 5) Cuota base = cuotaSinCargos * (porcentajeParticipacion / 100)
  const cuotaBase = cuotaSinCargos.times(porcentajeParticipacion.div(100)).round(2);

  // 6) Encontrar al inversionista con mayor monto_aportado (en la tabla REAL)
  let mayorId: number | null = null;
  let mayorMonto = new Big(0);

  for (const inv of inversionistasReales) {
    const monto = new Big(inv.monto_aportado);
    if (monto.gt(mayorMonto)) {
      mayorMonto = monto;
      mayorId = inv.inversionista_id;
    }
  }

  const esMayor = inversionistaId === mayorId;

  // 7/8) Si es el mayor → sumar seguro + membresías
  let cuotaInversionista: Big;
  if (esMayor) {
    cuotaInversionista = cuotaBase.plus(seguro).plus(membresias).round(2);
  } else {
    cuotaInversionista = cuotaBase;
  }

  console.log(`[calcularCuotaInversionista] credito=${creditoId} inv=${inversionistaId}`);
  console.log(`  capitalTotal=${capitalTotal} | cuotaTotal=${cuotaTotal}`);
  console.log(`  seguro=${seguro} | membresias=${membresias}`);
  console.log(`  montoAportadoEspejo=${montoAportadoEspejo} | %participacion=${porcentajeParticipacion.toFixed(4)}%`);
  console.log(`  cuotaSinCargos=${cuotaSinCargos} | cuotaBase=${cuotaBase}`);
  console.log(`  esMayor=${esMayor} (mayor=${mayorId}, monto=${mayorMonto})`);
  console.log(`  cuotaInversionista=${cuotaInversionista}`);

  return {
    cuotaInversionista,
    porcentajeParticipacion,
  };
}

/**
 * Controller: llenarTablaEspejo
 *
 * Body:
 * {
 *   inversionista: "nombre del inversionista",
 *   creditos: [{
 *     meses_en_credito: number,
 *     cliente: "nombre del cliente",
 *     numero_credito_sifco?: string, // opcional: si viene, busca por este número en vez del nombre
 *     capital: number,          // monto_aportado del espejo
 *     inversor: number,         // porcentaje_inversion (0 a 1, ej: 0.8 = 80%)
 *     interes_inversor: number, // monto_inversionista directo
 *     iva: number               // iva_inversionista
 *   }]
 * }
 *
 * - inversor se usa directo como multiplicador (ya viene de 0 a 1)
 * - porcentaje_cash_in = 100 - (inversor * 100)
 * - cuota_inversionista se calcula con la misma lógica de createCredit
 * - Si no existe padre en creditos_inversionistas, igual se inserta el espejo
 */
export const llenarTablaEspejo = async ({ body, query, set }: any) => {
  try {
    const { inversionista: nombreInversionista, creditos: creditosInput } = body;
    const calcularCuota = query?.calcular_cuota === "true";

    // 1) Buscar inversionista por nombre
    const inversionistasEncontrados = await buscarInversionista(nombreInversionista);

    if (inversionistasEncontrados.length === 0) {
      set.status = 404;
      return {
        success: false,
        message: `No se encontró inversionista con nombre: "${nombreInversionista}"`,
      };
    }

    if (inversionistasEncontrados.length > 1) {
      set.status = 400;
      return {
        success: false,
        message: `Se encontraron ${inversionistasEncontrados.length} inversionistas con ese nombre. Sea más específico.`,
        candidatos: inversionistasEncontrados.map((i) => ({
          id: i.inversionista_id,
          nombre: i.nombre,
        })),
      };
    }

    const inversionistaId = inversionistasEncontrados[0].inversionista_id;
    const resultados: any[] = [];
    const omitidos: any[] = [];

    // 2) Transacción para procesar todos los créditos
    await db.transaction(async (tx) => {
      for (const creditoInput of creditosInput) {
        const {
          cliente,
          numero_credito_sifco,
          capital,
          inversor,
        } = creditoInput;

        // inversor viene de 0 a 1 (ej: 0.8 = 80%)
        // porcentaje_cash_in = 100 - (inversor * 100)
        const inversorPct = new Big(inversor).times(100);   // 0.8 → 80
        const porcCashIn = new Big(100).minus(inversorPct);  // 100 - 80 = 20

        // 2a) Buscar crédito: por numero_credito_sifco si viene, sino por nombre del cliente
        let creditosEncontrados: { credito_id: number; porcentaje_interes: string | null; nombre_usuario: string | null }[];
        console.log(`[ESPEJO] Buscando crédito para cliente="${cliente}"${numero_credito_sifco ? ` con SIFCO="${numero_credito_sifco}"` : ""}`);

        if (numero_credito_sifco) {
          creditosEncontrados = await tx
            .select({
              credito_id: creditos.credito_id,
              porcentaje_interes: creditos.porcentaje_interes,
              nombre_usuario: usuarios.nombre,
            })
            .from(creditos)
            .innerJoin(usuarios, eq(usuarios.usuario_id, creditos.usuario_id))
            .where(eq(creditos.numero_credito_sifco, numero_credito_sifco.trim()));
        } else {
          const clienteNorm = removeAccents(cliente.trim().toLowerCase());
          creditosEncontrados = await tx
            .select({
              credito_id: creditos.credito_id,
              porcentaje_interes: creditos.porcentaje_interes,
              nombre_usuario: usuarios.nombre,
            })
            .from(creditos)
            .innerJoin(usuarios, eq(usuarios.usuario_id, creditos.usuario_id))
            .where(
              sql`translate(lower(${usuarios.nombre}), 'áéíóúàèìòùäëïöüâêîôûñÁÉÍÓÚÑ', 'aeiouaeiouaeiouaeiounaeioun') ILIKE ${"%" + clienteNorm + "%"}`
            );
        }

        if (creditosEncontrados.length === 0) {
          omitidos.push({
            cliente,
            razon: numero_credito_sifco
              ? `No se encontró crédito con número SIFCO: "${numero_credito_sifco}"`
              : `No se encontró crédito para cliente: "${cliente}"`,
          });
          continue;
        }

        // 2b) Buscar cuál crédito tiene relación con este inversionista en creditos_inversionistas
        let creditoId: number | null = null;
        let porcentajeInteres: string | null = null;

        for (const cred of creditosEncontrados) {
          const [padreTemp] = await tx
            .select({ id: creditos_inversionistas.id })
            .from(creditos_inversionistas)
            .where(
              and(
                eq(creditos_inversionistas.credito_id, cred.credito_id),
                eq(creditos_inversionistas.inversionista_id, inversionistaId)
              )
            )
            .limit(1);

          if (padreTemp) {
            creditoId = cred.credito_id;
            porcentajeInteres = cred.porcentaje_interes;
            break;
          }
        }

        // Si no hay padre: omitir siempre
        if (!creditoId) {
          const ref = numero_credito_sifco
            ? `crédito SIFCO "${numero_credito_sifco}"`
            : `cliente "${cliente}"`;
          omitidos.push({
            cliente,
            razon: `No se encontró padre en creditos_inversionistas para inversionista "${nombreInversionista}" y ${ref}.`,
          });
          continue;
        }

        // 3) Calcular o no la cuota_inversionista según el query param
        const montoAportado = new Big(capital);
        let cuotaInversionista: Big;

        if (calcularCuota) {
          const resultado = await calcularCuotaInversionista(tx, creditoId, inversionistaId, montoAportado);
          cuotaInversionista = resultado.cuotaInversionista;
        } else {
          // Sin cálculo: traer cuota del padre si existe, sino poner 0
          const [padre] = await tx
            .select({
              cuota_inversionista: creditos_inversionistas.cuota_inversionista,
              porcentaje_participacion_inversionista: creditos_inversionistas.porcentaje_participacion_inversionista,
            })
            .from(creditos_inversionistas)
            .where(
              and(
                eq(creditos_inversionistas.credito_id, creditoId),
                eq(creditos_inversionistas.inversionista_id, inversionistaId)
              )
            )
            .limit(1);

          cuotaInversionista = new Big(padre?.cuota_inversionista ?? 0);
        }

        // 4) Cálculos de interés y distribución
        const interes = new Big(porcentajeInteres ?? 0);

        // cuota_interes = capital * (porcentaje_interes / 100)
        const cuotaInteres = montoAportado.times(interes.div(100)).round(2);

        // monto_cash_in = cuota_interes * (porcentaje_cash_in / 100)
        const montoCashIn = cuotaInteres.times(porcCashIn).div(100).round(2);

        // iva_cash_in = monto_cash_in * 0.12
        const ivaCashIn = Number(montoCashIn) > 0
          ? montoCashIn.times(0.12).round(2)
          : new Big(0);

        // interes_inversor = cuota_interes - monto_cash_in
        const monto_inv = cuotaInteres.times(inversorPct).div(100).round(2);

        // iva_inversionista = interes_inversor * 0.12
        const ivaInversor = Number(monto_inv) > 0
          ? monto_inv.times(0.12).round(2)
          : new Big(0);

        console.log(`[ESPEJO] Cliente: ${cliente} | calcularCuota=${calcularCuota}`);
        console.log(`  capital=${montoAportado} | inversor=${inversor} → %cashIn=${porcCashIn}`);
        console.log(`  %interes=${interes} | cuotaInteres=${cuotaInteres}`);
        console.log(`  montoCashIn=${montoCashIn} | ivaCashIn=${ivaCashIn}`);
        console.log(`  cuotaInversionista=${cuotaInversionista}`);

        const dataEspejo = {
          credito_id: creditoId,
          inversionista_id: inversionistaId,
          cuota_inversionista: cuotaInversionista.toString(),
          porcentaje_participacion_inversionista: inversorPct.toString(),
          monto_aportado: montoAportado.toString(),
          porcentaje_cash_in: porcCashIn.toString(),
          monto_inversionista: new Big(monto_inv).toString(),
          monto_cash_in: montoCashIn.toString(),
          iva_inversionista: new Big(ivaInversor).toString(),
          iva_cash_in: ivaCashIn.toString(),
          fecha_creacion: new Date(),
        };

        // 5) Upsert en tabla espejo
        const [existente] = await tx
          .select()
          .from(creditos_inversionistas_espejo)
          .where(
            and(
              eq(creditos_inversionistas_espejo.credito_id, creditoId),
              eq(creditos_inversionistas_espejo.inversionista_id, inversionistaId)
            )
          )
          .limit(1);

        if (existente) {
          await tx
            .update(creditos_inversionistas_espejo)
            .set({ ...dataEspejo, updated_at: new Date() })
            .where(eq(creditos_inversionistas_espejo.id, existente.id));
        } else {
          await tx
            .insert(creditos_inversionistas_espejo)
            .values(dataEspejo);
        }

        resultados.push({
          cliente,
          credito_id: creditoId,
          accion: existente ? "actualizado" : "creado",
          data: dataEspejo,
        });
      }
    });

    set.status = 200;
    return {
      success: true,
      message: `Se procesaron ${resultados.length} créditos, ${omitidos.length} omitidos`,
      inversionista: {
        id: inversionistaId,
        nombre: inversionistasEncontrados[0].nombre,
      },
      resultados,
      omitidos,
    };
  } catch (error) {
    console.error("[llenarTablaEspejo] Error:", error);
    set.status = 500;
    return {
      success: false,
      message: "Error al llenar tabla espejo",
      error: String(error),
    };
  }
};

/**
 * Controller: getCreditsWithMirrors
 * 
 * Retorna todos los créditos separados por:
 * - con_espejo: Tienen registro en creditos_inversionistas_espejo (excluyendo inversionista_id = 86)
 * - sin_espejo: No tienen registro (o solo tienen el 86)
 */
export const getCreditsWithMirrors = async ({ set }: any) => {
  try {
    const allCredits = await db
      .select({
        credito_id: creditos.credito_id,
        numero_credito_sifco: creditos.numero_credito_sifco,
        cliente: usuarios.nombre,
        espejo: {
          id: creditos_inversionistas_espejo.id,
          inversionista_id: creditos_inversionistas_espejo.inversionista_id,
          monto_aportado: creditos_inversionistas_espejo.monto_aportado,
          cuota_inversionista: creditos_inversionistas_espejo.cuota_inversionista,
        },
        nombre_inversionista: inversionistas.nombre,
        real_inversionista_id: creditos_inversionistas.inversionista_id
      })
      .from(creditos)
      .innerJoin(usuarios, eq(usuarios.usuario_id, creditos.usuario_id))
      .leftJoin(
        creditos_inversionistas_espejo,
        eq(creditos.credito_id, creditos_inversionistas_espejo.credito_id)
      )
      .leftJoin(
        inversionistas,
        eq(creditos_inversionistas_espejo.inversionista_id, inversionistas.inversionista_id)
      )
      .leftJoin(
        creditos_inversionistas,
        eq(creditos.credito_id, creditos_inversionistas.credito_id)
      );

    const creditMap = new Map<number, any>();

    for (const row of allCredits) {
      if (!creditMap.has(row.credito_id)) {
        creditMap.set(row.credito_id, {
          credito_id: row.credito_id,
          numero_credito_sifco: row.numero_credito_sifco,
          cliente: row.cliente,
          mirrors: [],
          hasBlockedInvestor: false
        });
      }
      
      const entry = creditMap.get(row.credito_id);
      
      // Chequear bloqueo en el inversionista REAL
      if (row.real_inversionista_id === 86 || row.real_inversionista_id === 89) {
          entry.hasBlockedInvestor = true;
      }
      
      // Chequear bloqueo en el inversionista ESPEJO y agregar si válido
      if (row.espejo && row.espejo.id) {
          if (row.espejo.inversionista_id === 86 || row.espejo.inversionista_id === 89) {
              entry.hasBlockedInvestor = true;
          } else {
             // Evitar duplicados (por el left join múltiple)
             const exists = entry.mirrors.some((m: any) => m.id === row.espejo?.id);
             if (!exists && row.espejo) {
                entry.mirrors.push({
                    ...row.espejo,
                    nombre_inversionista: row.nombre_inversionista
                });
             }
          }
      }
    }

    const conEspejo: any[] = [];
    const sinEspejo: any[] = [];

    for (const credit of creditMap.values()) {
        const hasBlocked = credit.hasBlockedInvestor;
        delete credit.hasBlockedInvestor;

        // Si tiene algún inversionista bloqueado (86 u 89) YA SEA REAL O ESPEJO, lo omitimos TOTALMENTE.
        if (hasBlocked) {
            continue;
        }

        if (credit.mirrors.length > 0) {
            conEspejo.push(credit);
        } else {
            delete credit.mirrors;
            sinEspejo.push(credit);
        }
    }

    set.status = 200;
    return {
      success: true,
      con_espejo: conEspejo,
      sin_espejo: sinEspejo
    };

  } catch (error) {
    console.error("[getCreditsWithMirrors] Error:", error);
    set.status = 500;
    return {
      success: false,
      message: "Error al obtener creditos con espejo",
      error: String(error),
    };
  }
};


/**
 * Controller: getCreditsByInvestor
 * 
 * Recibe query param `id` (inversionista_id).
 * Retorna lista de créditos donde ese inversionista participa (como real o como espejo).
 * Para cada crédito, incluye:
 * - Datos del crédito (numero_credito_sifco, cliente)
 * - Lista de inversionistas REALES
 * - Lista de inversionistas ESPEJOS
 */
export const getCreditsByInvestor = async ({ query, set }: any) => {
  try {
    const { id } = query;
    if (!id) {
      set.status = 400;
      return { success: false, message: "Falta el parámetro 'id' (inversionista_id)" };
    }
    
    // Convertir el id a entero (si es string)
    const targetId = Number(id);
    if (isNaN(targetId)) {
        set.status = 400;
        return { success: false, message: "El ID debe ser un número válido" };
    }

    // 1) Encontrar IDs de créditos donde participa este inversionista
    //    En la tabla REAL
    const realParticipations = await db
      .select({ credito_id: creditos_inversionistas.credito_id })
      .from(creditos_inversionistas)
      .where(eq(creditos_inversionistas.inversionista_id, targetId));

    //    En la tabla ESPEJO
    const mirrorParticipations = await db
      .select({ credito_id: creditos_inversionistas_espejo.credito_id })
      .from(creditos_inversionistas_espejo)
      .where(eq(creditos_inversionistas_espejo.inversionista_id, targetId));
      
    const uniqueCreditIds = new Set<number>();
    realParticipations.forEach(r => uniqueCreditIds.add(r.credito_id));
    mirrorParticipations.forEach(m => uniqueCreditIds.add(m.credito_id));
    
    const creditIds = Array.from(uniqueCreditIds);
    
    if (creditIds.length === 0) {
        return {
            success: true,
            message: "El inversionista no tiene créditos asociados.",
            data: []
        };
    }

    // 2) Query principal: Detalles de créditos
    const creditsDetails = await db
        .select({
            credito_id: creditos.credito_id,
            numero_credito_sifco: creditos.numero_credito_sifco,
            cliente: usuarios.nombre,
        })
        .from(creditos)
        .innerJoin(usuarios, eq(usuarios.usuario_id, creditos.usuario_id))
        .where(inArray(creditos.credito_id, creditIds));
        
    // 3) Inversionistas Reales (para esos creditos)
    const allRealInvestors = await db
        .select({
            credito_id: creditos_inversionistas.credito_id,
            inversionista_id: creditos_inversionistas.inversionista_id,
            nombre: inversionistas.nombre,
            monto_aportado: creditos_inversionistas.monto_aportado,
            porcentaje: creditos_inversionistas.porcentaje_participacion_inversionista
        })
        .from(creditos_inversionistas)
        .innerJoin(inversionistas, eq(inversionistas.inversionista_id, creditos_inversionistas.inversionista_id))
        .where(inArray(creditos_inversionistas.credito_id, creditIds));

    // 4) Inversionistas Espejo (para esos creditos)
    const allMirrorInvestors = await db
        .select({
            credito_id: creditos_inversionistas_espejo.credito_id,
            inversionista_id: creditos_inversionistas_espejo.inversionista_id,
            nombre: inversionistas.nombre,
            monto_aportado: creditos_inversionistas_espejo.monto_aportado,
            porcentaje: creditos_inversionistas_espejo.porcentaje_participacion_inversionista,
            cuota_inversionista: creditos_inversionistas_espejo.cuota_inversionista
        })
        .from(creditos_inversionistas_espejo)
        .innerJoin(inversionistas, eq(inversionistas.inversionista_id, creditos_inversionistas_espejo.inversionista_id))
        .where(inArray(creditos_inversionistas_espejo.credito_id, creditIds));

    // 5) Armar respuesta
    const results = creditsDetails.map(c => {
        // Filtrar arrays en memoria
        const realForThisCredit = allRealInvestors.filter(r => r.credito_id === c.credito_id);
        const mirrorForThisCredit = allMirrorInvestors.filter(m => m.credito_id === c.credito_id);
        
        return {
            ...c,
            inversionistas_originales: realForThisCredit,
            inversionistas_espejos: mirrorForThisCredit
        };
    });

    set.status = 200;
    return {
      success: true,
      inversionista_consultado: targetId,
      data: results
    };

  } catch (error) {
    console.error("[getCreditsByInvestor] Error:", error);
    set.status = 500;
    return {
      success: false,
      message: "Error al obtener créditos por inversionista",
      error: String(error),
    };
  }
};

/**
 * Controller: asignarReinversionEspejo
 *
 * Body:
 * {
 *   asignaciones: [{
 *     id_credito_inversionista_espejo: number,
 *     tipo_reinversion: string
 *   }]
 * }
 */
export const asignarReinversionEspejo = async ({ body, set }: any) => {
  try {
    const { asignaciones, inversionista_id } = body;

    if (!inversionista_id) {
      set.status = 400;
      return { success: false, message: "Falta el inversionista_id" };
    }

    const resultados: any[] = [];
    const omitidos: any[] = [];
    let idsActuales: number[] = [];

    await db.transaction(async (tx) => {
      // 1) Obtener todos los IDs de créditos espejo actuales para este inversionista
      const actuales = await tx
        .select({ id: creditos_inversionistas_espejo.id })
        .from(creditos_inversionistas_espejo)
        .where(eq(creditos_inversionistas_espejo.inversionista_id, inversionista_id));

      idsActuales = actuales.map((a) => a.id);
      const idsEnviados = asignaciones.map((a: any) => a.id_credito_inversionista_espejo);

      // 2) Identificar IDs desaparecidos (están en la base pero no en el body)
      const desaparecidos = idsActuales.filter((id) => !idsEnviados.includes(id));

      // 3) Actualizar los que SÍ vienen en el arreglo
      for (const req of asignaciones) {
        const { id_credito_inversionista_espejo, tipo_reinversion } = req;
        
        // Verificar que el ID enviado realmente pertenezca a este inversionista
        if (!idsActuales.includes(id_credito_inversionista_espejo)) {
          omitidos.push({ id_credito_inversionista_espejo, razon: "El ID no pertenece a este inversionista o no existe" });
          continue;
        }

        await tx
          .update(creditos_inversionistas_espejo)
          .set({ tipo_reinversion, updated_at: new Date() })
          .where(eq(creditos_inversionistas_espejo.id, id_credito_inversionista_espejo));

        resultados.push({ id_credito_inversionista_espejo, tipo_reinversion });
      }

      // 4) Marcar como 'sin_reinversion' los desaparecidos
      if (desaparecidos.length > 0) {
        await tx
          .update(creditos_inversionistas_espejo)
          .set({ tipo_reinversion: "sin_reinversion", updated_at: new Date() })
          .where(inArray(creditos_inversionistas_espejo.id, desaparecidos));
      }
    });

    set.status = 200;
    return {
      success: true,
      message: `Sincronización completada. Actualizados: ${resultados.length}, Marcados sin reinversión: ${idsActuales.length - resultados.length}, Omitidos: ${omitidos.length}.`,
      resultados,
      omitidos
    };
  } catch (error) {
    console.error("[asignarReinversionEspejo] Error:", error);
    set.status = 500;
    return {
      success: false,
      message: "Error al asignar tipos de reinversión",
      error: String(error)
    };
  }
};

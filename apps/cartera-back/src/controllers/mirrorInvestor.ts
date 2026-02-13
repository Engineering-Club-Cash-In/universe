import Big from "big.js";
import { db } from "../database";
import {
  creditos,
  creditos_inversionistas,
  creditos_inversionistas_espejo,
  inversionistas,
  usuarios,
} from "../database/db";
import { and, eq, ilike, sql } from "drizzle-orm";

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
          interes_inversor,
          iva,
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
          creditosEncontrados = await tx
            .select({
              credito_id: creditos.credito_id,
              porcentaje_interes: creditos.porcentaje_interes,
              nombre_usuario: usuarios.nombre,
            })
            .from(creditos)
            .innerJoin(usuarios, eq(usuarios.usuario_id, creditos.usuario_id))
            .where(ilike(usuarios.nombre, `%${cliente.trim()}%`));
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

        console.log(`[ESPEJO] Cliente: ${cliente} | calcularCuota=${calcularCuota}`);
        console.log(`  capital=${montoAportado} | inversor=${inversor} → %cashIn=${porcCashIn}`);
        console.log(`  %interes=${interes} | cuotaInteres=${cuotaInteres}`);
        console.log(`  montoCashIn=${montoCashIn} | ivaCashIn=${ivaCashIn}`);
        console.log(`  interes_inversor=${interes_inversor} | iva=${iva}`);
        console.log(`  cuotaInversionista=${cuotaInversionista}`);

        const dataEspejo = {
          credito_id: creditoId,
          inversionista_id: inversionistaId,
          cuota_inversionista: cuotaInversionista.toString(),
          porcentaje_participacion_inversionista: inversorPct.toString(),
          monto_aportado: montoAportado.toString(),
          porcentaje_cash_in: porcCashIn.toString(),
          monto_inversionista: new Big(interes_inversor).toString(),
          monto_cash_in: montoCashIn.toString(),
          iva_inversionista: new Big(iva).toString(),
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
            .set(dataEspejo)
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

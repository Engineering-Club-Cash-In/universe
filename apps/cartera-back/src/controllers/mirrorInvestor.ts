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

  // Traer candidatos que coincidan con la primera palabra (sin acentos)
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

  // Puntuar: cuántas palabras del input aparecen en el nombre del candidato
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

/**
 * Controller: llenarTablaEspejo
 *
 * Body:
 * {
 *   inversionista: "nombre del inversionista",
 *   creditos: [{
 *     meses_en_credito: number,
 *     cliente: "nombre del cliente",
 *     capital: number,
 *     inversor: number,        // porcentaje_inversion
 *     interes_inversor: number, // monto_inversionista directo
 *     iva: number              // iva_inversionista
 *   }]
 * }
 *
 * Campos calculados: monto_cash_in, iva_cash_in
 * Campos del padre: cuota_inversionista, porcentaje_participacion, porcentaje_cash_in
 */
export const llenarTablaEspejo = async ({ body, set }: any) => {
  try {
    const { inversionista: nombreInversionista, creditos: creditosInput } = body;

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

    // 2) Transacción para procesar todos los créditos
    await db.transaction(async (tx) => {
      for (const creditoInput of creditosInput) {
        const {
          cliente,
          capital,
          interes_inversor,
          iva,
        } = creditoInput;

        // 2a) Buscar crédito por nombre del cliente
        const creditosEncontrados = await tx
          .select({
            credito_id: creditos.credito_id,
            porcentaje_interes: creditos.porcentaje_interes,
            nombre_usuario: usuarios.nombre,
          })
          .from(creditos)
          .innerJoin(usuarios, eq(usuarios.usuario_id, creditos.usuario_id))
          .where(ilike(usuarios.nombre, `%${cliente.trim()}%`));

        if (creditosEncontrados.length === 0) {
          throw new Error(`No se encontró crédito para cliente: "${cliente}"`);
        }

        // 2b) De los créditos encontrados, buscar cuál tiene padre con este inversionista
        let creditoId: number | null = null;
        let padre: any = null;
        let porcentajeInteres: string | null = null;

        for (const cred of creditosEncontrados) {
          const [padreTemp] = await tx
            .select()
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
            padre = padreTemp;
            porcentajeInteres = cred.porcentaje_interes;
            break;
          }
        }

        if (!padre || !creditoId) {
          throw new Error(
            `No se encontró relación padre entre inversionista "${nombreInversionista}" y cliente "${cliente}"`
          );
        }

        // 3) Cálculos
        const montoAportado = new Big(capital);
        const porcCashInPadre = new Big(padre.porcentaje_cash_in);
        const interes = new Big(porcentajeInteres ?? 0);

        // cuota_interes = capital * (porcentaje_interes / 100)
        const cuotaInteres = montoAportado.times(interes.div(100)).round(2);

        // monto_cash_in = cuota_interes * (porcentaje_cash_in_padre / 100)
        const montoCashIn = cuotaInteres.times(porcCashInPadre).div(100).round(2);

        // iva_cash_in = monto_cash_in * 0.12
        const ivaCashIn = Number(montoCashIn) > 0
          ? montoCashIn.times(0.12).round(2)
          : new Big(0);

        console.log(`[ESPEJO] Cliente: ${cliente}`);
        console.log(`  capital=${montoAportado} | %interes=${interes} | cuotaInteres=${cuotaInteres}`);
        console.log(`  %cashIn(padre)=${porcCashInPadre} | montoCashIn=${montoCashIn} | ivaCashIn=${ivaCashIn}`);
        console.log(`  interes_inversor=${interes_inversor} | iva=${iva}`);
        console.log(`  cuota_inversionista(padre)=${padre.cuota_inversionista}`);

        const dataEspejo = {
          credito_id: creditoId,
          inversionista_id: inversionistaId,
          cuota_inversionista: padre.cuota_inversionista,
          porcentaje_participacion_inversionista: padre.porcentaje_participacion_inversionista,
          monto_aportado: montoAportado.toString(),
          porcentaje_cash_in: porcCashInPadre.toString(),
          monto_inversionista: new Big(interes_inversor).toString(),
          monto_cash_in: montoCashIn.toString(),
          iva_inversionista: new Big(iva).toString(),
          iva_cash_in: ivaCashIn.toString(),
          fecha_creacion: new Date(),
        };

        // 4) Upsert: verificar si ya existe
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
      message: `Se procesaron ${resultados.length} créditos para inversionista "${inversionistasEncontrados[0].nombre}"`,
      inversionista: {
        id: inversionistaId,
        nombre: inversionistasEncontrados[0].nombre,
      },
      resultados,
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

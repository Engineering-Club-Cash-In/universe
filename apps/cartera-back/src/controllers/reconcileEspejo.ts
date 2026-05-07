import { db } from "../database";
import {
  creditos,
  creditos_inversionistas,
  creditos_inversionistas_espejo,
  cuotas_credito,
  inversionistas,
  pagos_credito,
  pagos_credito_inversionistas_espejo,
  usuarios,
} from "../database/db";
import { and, eq, sql, gte, lte } from "drizzle-orm";

// --- Helpers (mismos que mirrorInvestor.ts) ---

function removeAccents(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

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

// Parsea "ene. 26", "dic. 25", "feb. 2026", etc. -> { mes: number, anio: number }
function parseCuotaMes(cuotaMes: string): { mes: number; anio: number } | null {
  const meses: Record<string, number> = {
    ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
    jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12,
  };

  const cleaned = cuotaMes.toLowerCase().replace(/\./g, "").trim();
  const parts = cleaned.split(/\s+/);
  if (parts.length < 2) return null;

  const mesKey = parts[0].substring(0, 3);
  const mes = meses[mesKey];
  if (!mes) return null;

  let anio = parseInt(parts[1]);
  if (isNaN(anio)) return null;
  if (anio < 100) anio += 2000;

  return { mes, anio };
}

/**
 * POST /reconcile-espejo
 *
 * Body:
 * {
 *   inversionista: "nombre del inversionista",
 *   creditos: [{
 *     cliente: "nombre del cliente",
 *     cuota_mes: "ene. 26"  // columna "CUOTA DE MES" del Excel
 *   }]
 * }
 *
 * Para cada crédito:
 * 1. Fuzzy match inversionista -> inversionista_id
 * 2. Fuzzy match cliente -> credito_id (filtrado por inversionista en espejo)
 * 3. Busca el registro LIQUIDADO en pagos_credito_inversionistas_espejo
 * 4. Parsea cuota_mes -> mes/anio -> busca la cuota en cuotas_credito
 * 5. Busca el pago de esa cuota en pagos_credito
 * 6. Actualiza el pago_id en el registro espejo LIQUIDADO
 * 7. Los demas registros espejo posteriores de ese credito+inversionista -> NO_LIQUIDADO
 */
export const reconcileEspejo = async ({ body, set }: any) => {
  try {
    const { inversionista: nombreInversionista, creditos: creditosInput } = body;

    // 1) Buscar inversionista
    const invEncontrados = await buscarInversionista(nombreInversionista);

    if (invEncontrados.length === 0) {
      set.status = 404;
      return {
        success: false,
        message: `No se encontro inversionista: "${nombreInversionista}"`,
      };
    }

    if (invEncontrados.length > 1) {
      set.status = 400;
      return {
        success: false,
        message: `Multiples inversionistas encontrados para "${nombreInversionista}". Sea mas especifico.`,
        candidatos: invEncontrados,
      };
    }

    const inversionistaId = invEncontrados[0].inversionista_id;
    const inversionistaNombre = invEncontrados[0].nombre;

    const resultados: any[] = [];
    const omitidos: any[] = [];

    // 2) Procesar cada credito
    await db.transaction(async (tx) => {
      for (const input of creditosInput) {
        const { cliente, cuota_mes, abono_capital, abono_interes, abono_iva_12 } = input;

        // 2a) Parsear cuota_mes
        const parsed = parseCuotaMes(cuota_mes);
        if (!parsed) {
          omitidos.push({ cliente, razon: `No se pudo parsear cuota_mes: "${cuota_mes}"` });
          continue;
        }

        // 2b) Fuzzy match cliente -> creditos
        const clienteNorm = removeAccents(cliente.trim().toLowerCase());
        const creditosEncontrados = await tx
          .select({
            credito_id: creditos.credito_id,
            nombre_usuario: usuarios.nombre,
          })
          .from(creditos)
          .innerJoin(usuarios, eq(usuarios.usuario_id, creditos.usuario_id))
          .where(
            sql`translate(lower(${usuarios.nombre}), 'áéíóúàèìòùäëïöüâêîôûñÁÉÍÓÚÑ', 'aeiouaeiouaeiouaeiounaeioun') ILIKE ${"%" + clienteNorm + "%"}`
          );

        if (creditosEncontrados.length === 0) {
          omitidos.push({ cliente, razon: `No se encontro credito para cliente: "${cliente}"` });
          continue;
        }

        // 2c) Filtrar: cual de esos creditos tiene espejo con este inversionista
        let creditoId: number | null = null;

        for (const cred of creditosEncontrados) {
          const [espejoExiste] = await tx
            .select({ id: creditos_inversionistas_espejo.id })
            .from(creditos_inversionistas_espejo)
            .where(
              and(
                eq(creditos_inversionistas_espejo.credito_id, cred.credito_id),
                eq(creditos_inversionistas_espejo.inversionista_id, inversionistaId)
              )
            )
            .limit(1);

          if (espejoExiste) {
            creditoId = cred.credito_id;
            break;
          }
        }

        if (!creditoId) {
          omitidos.push({
            cliente,
            razon: `No se encontro espejo para inversionista "${inversionistaNombre}" y cliente "${cliente}"`,
          });
          continue;
        }

        // 2d) Buscar registro LIQUIDADO en pagos_credito_inversionistas_espejo
        const [registroLiquidado] = await tx
          .select()
          .from(pagos_credito_inversionistas_espejo)
          .where(
            and(
              eq(pagos_credito_inversionistas_espejo.credito_id, creditoId),
              eq(pagos_credito_inversionistas_espejo.inversionista_id, inversionistaId),
              eq(pagos_credito_inversionistas_espejo.estado_liquidacion, "LIQUIDADO")
            )
          )
          .limit(1);

        // 2e) Buscar la cuota del mes/anio indicado
        const { mes, anio } = parsed;
        const fechaInicio = new Date(anio, mes - 1, 1);
        const fechaFin = new Date(anio, mes, 0); // ultimo dia del mes

        const cuotasDelMes = await tx
          .select({
            cuota_id: cuotas_credito.cuota_id,
            numero_cuota: cuotas_credito.numero_cuota,
            fecha_vencimiento: cuotas_credito.fecha_vencimiento,
          })
          .from(cuotas_credito)
          .where(
            and(
              eq(cuotas_credito.credito_id, creditoId),
              gte(cuotas_credito.fecha_vencimiento, fechaInicio.toISOString().split("T")[0]),
              lte(cuotas_credito.fecha_vencimiento, fechaFin.toISOString().split("T")[0])
            )
          );

        if (cuotasDelMes.length === 0) {
          omitidos.push({
            cliente,
            razon: `No se encontro cuota para credito_id=${creditoId} en ${mes}/${anio}`,
          });
          continue;
        }

        const cuota = cuotasDelMes[0];

        // 2f) Buscar el pago de esa cuota
        const [pagoDelMes] = await tx
          .select({
            pago_id: pagos_credito.pago_id,
          })
          .from(pagos_credito)
          .where(
            and(
              eq(pagos_credito.credito_id, creditoId),
              eq(pagos_credito.cuota_id, cuota.cuota_id)
            )
          )
          .limit(1);

        if (!pagoDelMes) {
          omitidos.push({
            cliente,
            razon: `No se encontro pago para cuota_id=${cuota.cuota_id} (credito_id=${creditoId}, ${mes}/${anio})`,
          });
          continue;
        }

        let accion = "UPDATE";

        if (registroLiquidado) {
          // 2g) UPDATE: Actualizar el registro LIQUIDADO existente
          const updateData: any = { pago_id: pagoDelMes.pago_id, updated_at: new Date() };
          if (abono_capital) updateData.abono_capital = abono_capital;
          if (abono_interes) updateData.abono_interes = abono_interes;
          if (abono_iva_12) updateData.abono_iva_12 = abono_iva_12;

          await tx
            .update(pagos_credito_inversionistas_espejo)
            .set(updateData)
            .where(eq(pagos_credito_inversionistas_espejo.id, registroLiquidado.id));
        } else {
          // 2g-alt) INSERT: No hay LIQUIDADO, crear registro nuevo
          accion = "INSERT";

          // Verificar si ya existe un registro con este pago_id + inversionista
          const [yaExiste] = await tx
            .select({ id: pagos_credito_inversionistas_espejo.id })
            .from(pagos_credito_inversionistas_espejo)
            .where(
              and(
                eq(pagos_credito_inversionistas_espejo.pago_id, pagoDelMes.pago_id),
                eq(pagos_credito_inversionistas_espejo.inversionista_id, inversionistaId)
              )
            )
            .limit(1);

          if (yaExiste) {
            // Ya existe con ese pago_id, hacer UPDATE
            accion = "UPDATE_EXISTING";
            const updateData: any = {
              estado_liquidacion: "LIQUIDADO",
              updated_at: new Date(),
            };
            if (abono_capital) updateData.abono_capital = abono_capital;
            if (abono_interes) updateData.abono_interes = abono_interes;
            if (abono_iva_12) updateData.abono_iva_12 = abono_iva_12;

            await tx
              .update(pagos_credito_inversionistas_espejo)
              .set(updateData)
              .where(eq(pagos_credito_inversionistas_espejo.id, yaExiste.id));
          } else {
            // INSERT nuevo
            await tx
              .insert(pagos_credito_inversionistas_espejo)
              .values({
                pago_id: pagoDelMes.pago_id,
                inversionista_id: inversionistaId,
                credito_id: creditoId,
                abono_capital: abono_capital || "0",
                abono_interes: abono_interes || "0",
                abono_iva_12: abono_iva_12 || "0",
                porcentaje_participacion: input.porcentaje_participacion || "80",
                fecha_pago: new Date(),
                estado_liquidacion: "LIQUIDADO",
                cuota: input.cuota || "0",
                liquidacion_id: input.liquidacion_id || null,
              });
          }
        }

        // 2g.1) Marcar la cuota como liquidada a inversionistas
        await tx
          .update(cuotas_credito)
          .set({
            liquidado_inversionistas: true,
            fecha_liquidacion_inversionistas: new Date(),
          })
          .where(eq(cuotas_credito.cuota_id, cuota.cuota_id));

        // 2h) Los demas registros espejo de este credito+inversionista con cuotas POSTERIORES -> NO_LIQUIDADO
        const otrosRegistros = await tx
          .select({
            id: pagos_credito_inversionistas_espejo.id,
            pago_id: pagos_credito_inversionistas_espejo.pago_id,
          })
          .from(pagos_credito_inversionistas_espejo)
          .where(
            and(
              eq(pagos_credito_inversionistas_espejo.credito_id, creditoId),
              eq(pagos_credito_inversionistas_espejo.inversionista_id, inversionistaId),
              sql`${pagos_credito_inversionistas_espejo.pago_id} != ${pagoDelMes.pago_id}`
            )
          );

        let posterioresActualizados = 0;
        for (const otro of otrosRegistros) {
          if (otro.pago_id === null) continue;

          // Buscar la cuota de este pago
          const [pagoOtro] = await tx
            .select({ cuota_id: pagos_credito.cuota_id })
            .from(pagos_credito)
            .where(eq(pagos_credito.pago_id, otro.pago_id))
            .limit(1);

          if (!pagoOtro?.cuota_id) continue;

          const [cuotaOtro] = await tx
            .select({ fecha_vencimiento: cuotas_credito.fecha_vencimiento })
            .from(cuotas_credito)
            .where(eq(cuotas_credito.cuota_id, pagoOtro.cuota_id))
            .limit(1);

          if (!cuotaOtro) continue;

          const fechaCuotaOtro = new Date(cuotaOtro.fecha_vencimiento);
          if (fechaCuotaOtro > fechaFin) {
            await tx
              .update(pagos_credito_inversionistas_espejo)
              .set({ estado_liquidacion: "NO_LIQUIDADO", updated_at: new Date() })
              .where(eq(pagos_credito_inversionistas_espejo.id, otro.id));

            // Marcar la cuota posterior como NO liquidada a inversionistas
            await tx
              .update(cuotas_credito)
              .set({
                liquidado_inversionistas: false,
                fecha_liquidacion_inversionistas: null,
              })
              .where(eq(cuotas_credito.cuota_id, pagoOtro.cuota_id));

            posterioresActualizados++;
          }
        }

        resultados.push({
          cliente,
          credito_id: creditoId,
          cuota_mes: cuota_mes,
          cuota_id: cuota.cuota_id,
          pago_id_asignado: pagoDelMes.pago_id,
          accion,
          posteriores_a_no_liquidado: posterioresActualizados,
        });
      }
    });

    set.status = 200;
    return {
      success: true,
      message: `Procesados ${resultados.length} creditos, ${omitidos.length} omitidos`,
      inversionista: { id: inversionistaId, nombre: inversionistaNombre },
      resultados,
      omitidos,
    };
  } catch (error) {
    console.error("[reconcileEspejo] Error:", error);
    set.status = 500;
    return {
      success: false,
      message: "Error en reconciliacion espejo",
      error: String(error),
    };
  }
};

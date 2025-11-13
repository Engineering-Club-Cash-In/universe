// app.ts (o donde declares tus rutas Elysia)
import { z } from "zod";
import { db } from "../database/index";
import {
  creditos,
  creditos_inversionistas,
  cuotas_credito,
  inversionistas,
  pagos_credito,
  pagos_credito_inversionistas,
  usuarios,
} from "../database/db/schema";
import { eq, and, sql, inArray, ilike, like } from "drizzle-orm";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
export const insertInvestor = async ({ body, set }: any) => {
  try {
    let inversionistasToInsert = [];

    // Permitir un solo objeto o un arreglo
    if (Array.isArray(body)) {
      inversionistasToInsert = body;
    } else if (typeof body === "object") {
      inversionistasToInsert = [body];
    }

    // Validación mínima: nombre y emite_factura son obligatorios
    const isValid = inversionistasToInsert.every(
      (inv) => inv.nombre && typeof inv.emite_factura !== "undefined"
    );
    if (!isValid || inversionistasToInsert.length === 0) {
      set.status = 400;
      return {
        message: "Todos los inversionistas deben tener nombre y emite_factura.",
      };
    }

    // Insertar en la tabla inversionistas
    const inserted = await db
      .insert(inversionistas)
      .values(
        inversionistasToInsert.map(
          ({
            nombre,
            emite_factura,
            reinversion = false, // default false
            banco = null,
            tipo_cuenta = null,
            numero_cuenta = null,
          }) => ({
            nombre,
            emite_factura,
            reinversion,
            banco,
            tipo_cuenta,
            numero_cuenta,
          })
        )
      )
      .returning();

    set.status = 201;
    return inserted;
  } catch (error) {
    set.status = 500;
    return { message: "Error inserting investors", error: String(error) };
  }
};
// GET: Obtener inversionistas (uno o todos)
export const getInvestors = async ({ query, set }: any) => {
  try {
    // Si quieres buscar por ID
    if (query.id) {
      const result = await db
        .select()
        .from(inversionistas)
        .where(eq(inversionistas.inversionista_id, query.id));
      set.status = result.length ? 200 : 404;
      return result.length
        ? result[0]
        : { message: "Inversionista no encontrado" };
    }

    // Si quieres buscar por nombre
    if (query.nombre) {
      const result = await db
        .select()
        .from(inversionistas)
        .where(eq(inversionistas.nombre, query.nombre));
      set.status = result.length ? 200 : 404;
      return result.length
        ? result
        : { message: "Inversionista no encontrado" };
    }

    // Si no hay query, trae todos
    const all = await db.select().from(inversionistas);
    set.status = 200;
    return all;
  } catch (error) {
    set.status = 500;
    return {
      message: "Error al consultar inversionistas",
      error: String(error),
    };
  }
};

import Big from "big.js";

export const getInvestorsWithCredits = async () => {
  const data = await db
    .select({
      inversionista_id: inversionistas.inversionista_id,
      nombre: inversionistas.nombre,
      emite_factura: inversionistas.emite_factura,
      credito_id: creditos_inversionistas.credito_id,
      porcentaje_participacion:
        creditos_inversionistas.porcentaje_participacion_inversionista,
      monto_asignado: creditos_inversionistas.monto_inversionista,
      iva: creditos_inversionistas.iva_inversionista,
      numero_credito_sifco: creditos.numero_credito_sifco,
      capital: creditos.capital,
    })
    .from(inversionistas)
    .leftJoin(
      creditos_inversionistas,
      eq(
        inversionistas.inversionista_id,
        creditos_inversionistas.inversionista_id
      )
    )
    .leftJoin(
      creditos,
      eq(creditos_inversionistas.credito_id, creditos.credito_id)
    );

  const resultado = data.reduce((acc: any[], item) => {
    const inversionistaExistente = acc.find(
      (inv) => inv.inversionista_id === item.inversionista_id
    );

    const creditoData = item.credito_id
      ? {
          credito_id: item.credito_id,
          numero_credito_sifco: item.numero_credito_sifco,
          capital: item.capital,
          porcentaje_participacion: item.porcentaje_participacion,
          monto_asignado: item.monto_asignado,
          iva: item.iva,
        }
      : null;

    if (inversionistaExistente) {
      if (creditoData) {
        inversionistaExistente.creditos.push(creditoData);
      }
      inversionistaExistente.total_creditos =
        inversionistaExistente.creditos.length;

      // 🔥 Sumar el monto asignado
      const currentSum = new Big(inversionistaExistente.total_monto_asignado);
      const newSum = creditoData
        ? currentSum.plus(creditoData.monto_asignado ?? 0)
        : currentSum;
      inversionistaExistente.total_monto_asignado = newSum.toString();
    } else {
      acc.push({
        inversionista_id: item.inversionista_id,
        nombre: item.nombre,
        emite_factura: item.emite_factura,
        total_creditos: creditoData ? 1 : 0,
        total_monto_asignado: creditoData
          ? new Big(creditoData.monto_asignado ?? 0).toString()
          : "0",
        creditos: creditoData ? [creditoData] : [],
      });
    }

    return acc;
  }, []);

  return resultado;
};

/**
 * Processes and replaces all investors of a given credit:
 * - Fetches the credit and its current investors
 * - Calculates new values for each investor (using Big.js)
 * - Deletes previous investors
 * - Inserts the updated investor data
 *
 * @param credito_id - The credit ID to process
 * @returns The inserted investors data after processing
 * @throws Error if the credit does not exist
 */

export async function processAndReplaceCreditInvestors(
  credito_id: number,
  abono_capital: number,
  addition: boolean,
  inversionista_id: number
) {
  // 1. Fetch credit details
  const credit = await db.query.creditos.findFirst({
    where: (c, { eq }) => eq(c.credito_id, credito_id),
  });

  if (!credit) {
    throw new Error("Credit not found");
  }

  // 2. Fetch all investors for this credit
  const investors = await db.query.creditos_inversionistas.findMany({
    where: (ci, { eq, and }) =>
      and(
        eq(ci.inversionista_id, inversionista_id),
        eq(ci.credito_id, credito_id)
      ),
  });

  if (investors.length === 0) {
    return [];
  }
  console.log("adition", addition);
  // 3. Process and calculate new values for each investor
  const processedInvestors = investors.map((inv) => {
    const montoAportado = addition
      ? new Big(inv.monto_aportado).add(abono_capital)
      : new Big(inv.monto_aportado).minus(abono_capital);
    console.log("montoAportado", montoAportado.toString());
    const porcentajeCashIn = new Big(inv.porcentaje_cash_in);
    const porcentajeInversion = new Big(
      inv.porcentaje_participacion_inversionista
    );
    const cuota = montoAportado
      .times(credit.porcentaje_interes)
      .div(100)
      .round(2);

    // Proportional amounts
    const montoInversionista = cuota
      .times(porcentajeInversion)
      .div(100)
      .round(2);
    const montoCashIn = cuota.times(porcentajeCashIn).div(100).round(2);

    // IVAs
    const ivaInversionista = montoInversionista.gt(0)
      ? montoInversionista.times(0.12).round(2)
      : new Big(0);
    const ivaCashIn = montoCashIn.gt(0)
      ? montoCashIn.times(0.12).round(2)
      : new Big(0);

    return {
      ...inv, // trae el id necesario para el update
      credito_id,
      monto_aportado: montoAportado.toFixed(2),
      porcentaje_cash_in: porcentajeCashIn.toFixed(2),
      porcentaje_participacion_inversionista: porcentajeInversion.toFixed(2),
      monto_inversionista: montoInversionista.toFixed(2),
      monto_cash_in: montoCashIn.toFixed(2),
      iva_inversionista: ivaInversionista.toFixed(2),
      iva_cash_in: ivaCashIn.toFixed(2),
      fecha_creacion: new Date(),
      cuota_inversionista: inv.cuota_inversionista,
    };
  });

  // 4. Update all processed investors by their id
  for (const inv of processedInvestors) {
    await db
      .update(creditos_inversionistas)
      .set({
        cuota_inversionista: inv.cuota_inversionista,
        porcentaje_participacion_inversionista:
          inv.porcentaje_participacion_inversionista,
        monto_aportado: inv.monto_aportado,
        porcentaje_cash_in: inv.porcentaje_cash_in,
        iva_inversionista: inv.iva_inversionista,
        iva_cash_in: inv.iva_cash_in,
        monto_inversionista: inv.monto_inversionista,
        monto_cash_in: inv.monto_cash_in,
        // fecha_creacion: inv.fecha_creacion, // Descomenta si deseas actualizarla
      })
      .where(eq(creditos_inversionistas.id, inv.id));
  }

  // 5. Return the new updated data (could re-fetch if you want actual DB values)
  return processedInvestors;
}
export async function processAndReplaceCreditInvestorsReverse(
  credito_id: number,
  abono_capital: number,
  addition: boolean,
  pago_id: number
) {
  // 1. Fetch credit details
  const credit = await db.query.creditos.findFirst({
    where: (c, { eq }) => eq(c.credito_id, credito_id),
  });

  if (!credit) {
    throw new Error("Credit not found");
  }

  // 2. Fetch all investors for this credit
  const investors = await db.query.creditos_inversionistas.findMany({
    where: (ci, { eq }) => eq(ci.credito_id, credito_id),
  });

  if (investors.length === 0) {
    return [];
  }
  console.log("adition", addition);
  // 3. Process and calculate new values for each investor
  const processedInvestors = investors.map(async (inv) => {
    const [abonoCapital] = await db
      .select({
        abono_capital: pagos_credito_inversionistas.abono_capital,
      })
      .from(pagos_credito_inversionistas)
      .where(
        and(
          eq(pagos_credito_inversionistas.pago_id, pago_id),
          eq(
            pagos_credito_inversionistas.inversionista_id,
            inv.inversionista_id
          )
        )
      );
    console.log(abonoCapital);
    const montoAportado = addition
      ? new Big(inv.monto_aportado).add(abono_capital)
      : new Big(inv.monto_aportado).minus(abono_capital);
    console.log("montoAportado", montoAportado.toString());
    const porcentajeCashIn = new Big(inv.porcentaje_cash_in);
    const porcentajeInversion = new Big(
      inv.porcentaje_participacion_inversionista
    );
    const cuota = montoAportado
      .times(credit.porcentaje_interes)
      .div(100)
      .round(2);

    // Proportional amounts
    const montoInversionista = cuota
      .times(porcentajeInversion)
      .div(100)
      .round(2);
    const montoCashIn = cuota.times(porcentajeCashIn).div(100).round(2);

    // IVAs
    const ivaInversionista = montoInversionista.gt(0)
      ? montoInversionista.times(0.12).round(2)
      : new Big(0);
    const ivaCashIn = montoCashIn.gt(0)
      ? montoCashIn.times(0.12).round(2)
      : new Big(0);

    return {
      ...inv, // trae el id necesario para el update
      credito_id,
      monto_aportado: montoAportado.toFixed(2),
      porcentaje_cash_in: porcentajeCashIn.toFixed(2),
      porcentaje_participacion_inversionista: porcentajeInversion.toFixed(2),
      monto_inversionista: montoInversionista.toFixed(2),
      monto_cash_in: montoCashIn.toFixed(2),
      iva_inversionista: ivaInversionista.toFixed(2),
      iva_cash_in: ivaCashIn.toFixed(2),
      fecha_creacion: new Date(),
      cuota_inversionista: inv.cuota_inversionista,
    };
  });

  // 4. Update all processed investors by their id
  for (const inv of processedInvestors) {
    await db
      .update(creditos_inversionistas)
      .set({
        cuota_inversionista: (await inv).cuota_inversionista,
        porcentaje_participacion_inversionista: (await inv)
          .porcentaje_participacion_inversionista,
        monto_aportado: (await inv).monto_aportado,
        porcentaje_cash_in: (await inv).porcentaje_cash_in,
        iva_inversionista: (await inv).iva_inversionista,
        iva_cash_in: (await inv).iva_cash_in,
        monto_inversionista: (await inv).monto_inversionista,
        monto_cash_in: (await inv).monto_cash_in,
        // fecha_creacion: inv.fecha_creacion, // Descomenta si deseas actualizarla
      })
      .where(eq(creditos_inversionistas.id, (await inv).id));
  }

  // 5. Return the new updated data (could re-fetch if you want actual DB values)
  return processedInvestors;
}

/**
 * Resumen de pagos NO LIQUIDADOS agrupados por inversionista, incluyendo detalle de créditos,
 * usuario titular, totales, IVA, ISR, % inversor y ajuste de cuota según si factura o no.
 */
/**
 * Resumen de pagos NO LIQUIDADOS agrupados por inversionista y crédito.
 * Devuelve también subtotales por inversionista, totales globales,
 * y cada resumen individual incluye su subtotal global.
 */
export async function resumeInvestor(
  investorId: number, // 👈 ahora obligatorio
  page = 1,
  perPage = 10,
  numeroCreditoSifco?: string, // 👈 filtro nuevo
  nombreUsuario?: string // 👈 filtro nuevo
) {
  console.log("resumeInvestor for", investorId);

  // 1. Consulta inversionista único
  const listaInversionistas = await db
    .select({
      inversionista_id: inversionistas.inversionista_id,
      inversionista: inversionistas.nombre,
      emite_factura: inversionistas.emite_factura,
      reinversion: inversionistas.tipo_reinversion,
      banco: inversionistas.banco,
      tipo_cuenta: inversionistas.tipo_cuenta,
      numero_cuenta: inversionistas.numero_cuenta,
    })
    .from(inversionistas)
    .where(eq(inversionistas.inversionista_id, investorId))
    .limit(1);

  if (listaInversionistas.length === 0) {
    return { inversionistas: [], page, perPage, totalItems: 0, totalPages: 0 };
  }

  const inversionistaIds = listaInversionistas.map((i) => i.inversionista_id);

  // 2. Créditos asociados al inversionista
  const creditosParticipa = await db
    .select({
      credito_id: creditos_inversionistas.credito_id,
      inversionista_id: creditos_inversionistas.inversionista_id,
      monto_aportado: creditos_inversionistas.monto_aportado,
      porcentaje_inversionista:
        creditos_inversionistas.porcentaje_participacion_inversionista,
      cuota_inversionista: creditos_inversionistas.cuota_inversionista,
    })
    .from(creditos_inversionistas)
    .where(inArray(creditos_inversionistas.inversionista_id, inversionistaIds));

  let creditosIds = creditosParticipa.map((c) => c.credito_id);

  if (creditosIds.length === 0) {
    return { inversionistas: [], page, perPage, totalItems: 0, totalPages: 0 };
  }

  // 3. Info de créditos con filtros
  let conditions = [inArray(creditos.credito_id, creditosIds)];

  if (numeroCreditoSifco) {
    conditions.push(eq(creditos.numero_credito_sifco, numeroCreditoSifco));
  }

  if (nombreUsuario) {
    conditions.push(ilike(usuarios.nombre, `%${nombreUsuario}%`));
  }

  const creditosInfo = await db
    .select({
      credito_id: creditos.credito_id,
      numero_credito_sifco: creditos.numero_credito_sifco,
      nombre_usuario: usuarios.nombre,
      nit_usuario: usuarios.nit,
      capital: creditos.capital,
      porcentaje_interes: creditos.porcentaje_interes,
      cuota_interes: creditos.cuota_interes,
      iva12: creditos.iva_12,
      fecha_creacion: creditos.fecha_creacion,
      plazo: creditos.plazo,
    })
    .from(creditos)
    .leftJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
    .where(and(...conditions));

  creditosIds = creditosInfo.map((c) => c.credito_id);

  if (creditosIds.length === 0) {
    return { inversionistas: [], page, perPage, totalItems: 0, totalPages: 0 };
  }

  // 🚀 Paginación sobre créditos
  const totalItems = creditosIds.length;
  const totalPages = Math.ceil(totalItems / perPage);
  const creditosIdsPaginados = creditosIds.slice(
    (page - 1) * perPage,
    page * perPage
  );

  // 5. Armar estructura final (idéntico a tu versión original, solo que limitado a los créditos paginados)
  // 5️⃣ Armar estructura final (idéntico al original pero limitado a los créditos paginados)
  const inversionistasResumen = await Promise.all(
    listaInversionistas.map(async (inv) => {
      // Créditos del inversionista dentro de la página actual
      const creditosDeInv = creditosParticipa.filter(
        (c) =>
          c.inversionista_id === inv.inversionista_id &&
          creditosIdsPaginados.includes(c.credito_id)
      );

      // Inicializar subtotales
      let subtotal = {
        total_abono_capital: new Big(0),
        total_abono_interes: new Big(0),
        total_abono_iva: new Big(0),
        total_isr: new Big(0),
        total_cuota: new Big(0),
        total_monto_aportado: new Big(0),
        totalAbonoGeneralInteres: new Big(0),
      };

      // Procesar créditos del inversionista
      const creditosData = await Promise.all(
        creditosDeInv.map(async (c) => {
          // 📌 Obtener info del crédito
          const [credito] = await db
            .select({
              numero_credito_sifco: creditos.numero_credito_sifco,
              nombre_usuario: usuarios.nombre,
              nit_usuario: usuarios.nit,
              capital: creditos.capital,
              fecha_creacion: creditos.fecha_creacion,
              porcentaje_interes: creditos.porcentaje_interes,
              plazo: creditos.plazo,
              meses_en_credito: sql<number>`
              GREATEST(
                0,
                (
                  (DATE_PART('year', AGE(LEAST(COALESCE(${creditos.fecha_creacion}, CURRENT_DATE), CURRENT_DATE), ${creditos.fecha_creacion}))::int * 12)
                  + DATE_PART('month', AGE(LEAST(COALESCE(${creditos.fecha_creacion}, CURRENT_DATE), CURRENT_DATE), ${creditos.fecha_creacion}))::int
                  + CASE
                      WHEN EXTRACT(DAY FROM LEAST(COALESCE(${creditos.fecha_creacion}, CURRENT_DATE), CURRENT_DATE))
                           >= EXTRACT(DAY FROM ${creditos.fecha_creacion})
                      THEN 1 ELSE 0
                    END
                )
              )
            `.as("meses_en_credito"),
              cuota_interes: creditos.cuota_interes,
              iva12: creditos.iva_12,
            })
            .from(creditos)
            .leftJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
            .where(eq(creditos.credito_id, c.credito_id))
            .limit(1);

          // 📌 Pagos no liquidados
          const pagos = await db
            .select({
              abono_capital: pagos_credito_inversionistas.abono_capital,
              abono_interes: pagos_credito_inversionistas.abono_interes,
              abono_iva_12: pagos_credito_inversionistas.abono_iva_12,
              fecha_pago: pagos_credito_inversionistas.fecha_pago,
              porcentaje_participacion:
                pagos_credito_inversionistas.porcentaje_participacion,
              abonoGeneralInteres: pagos_credito.abono_interes,
              cuota: cuotas_credito.numero_cuota,
            })
            .from(pagos_credito_inversionistas)
            .innerJoin(
              pagos_credito,
              eq(pagos_credito_inversionistas.pago_id, pagos_credito.pago_id)
            )
            .innerJoin(
              cuotas_credito,
              eq(pagos_credito.cuota_id, cuotas_credito.cuota_id)
            )
            .where(
              and(
                eq(
                  pagos_credito_inversionistas.inversionista_id,
                  inv.inversionista_id
                ),
                eq(pagos_credito_inversionistas.credito_id, c.credito_id),
                eq(
                  pagos_credito_inversionistas.estado_liquidacion,
                  "NO_LIQUIDADO"
                )
              )
            );

          // 📊 Totales del crédito
          let total_abono_capital = new Big(0);
          let total_abono_interes = new Big(0);
          let total_abono_iva = new Big(0);
          let total_isr = new Big(0);
          let total_cuota = new Big(0);
          let total_monto_aportado = new Big(c.monto_aportado ?? 0);
          let totalAbonoGeneralInteres = new Big(0);
          let meses_en_credito: number | null = null;

          if (credito?.fecha_creacion) {
            const inicio = dayjs(credito.fecha_creacion);
            const hoy = dayjs();
            meses_en_credito = hoy.diff(inicio, "month");
          }

          // 🧮 Detalle de pagos
          const pagos_detalle = pagos
            .sort((a, b) => {
              // Si alguno no tiene fecha, lo manda al final
              if (!a.fecha_pago) return 1;
              if (!b.fecha_pago) return -1;

              const fechaA = new Date(a.fecha_pago).getTime();
              const fechaB = new Date(b.fecha_pago).getTime();

              return fechaA - fechaB; // Ascendente (más antiguos primero)
              // return fechaB - fechaA; // Descendente (más recientes primero)
            })
            .map((pago) => {
              const abono_capital = new Big(pago.abono_capital ?? 0);
              const abono_interes = new Big(pago.abono_interes ?? 0);
              const abono_iva = new Big(pago.abono_iva_12 ?? 0);
              const isr = abono_interes.times(0.05);
              const cuota = pago.cuota ?? 0;
              let cuota_inversor;

              switch (inv.reinversion) {
                case "sin_reinversion":
                  // Se paga todo: capital + interés + (IVA o -ISR)
                  cuota_inversor = abono_capital
                    .plus(abono_interes)
                    .plus(inv.emite_factura ? abono_iva : isr.neg());
                  break;

                case "reinversion_capital":
                  // Solo se paga interés + (IVA o -ISR), el capital se reinvierte
                  cuota_inversor = abono_interes.plus(
                    inv.emite_factura ? abono_iva : isr.neg()
                  );
                  break;

                case "reinversion_interes":
                  // Solo se paga capital + (IVA o -ISR), el interés se reinvierte
                  cuota_inversor = abono_capital.plus(
                    inv.emite_factura ? abono_iva : isr.neg()
                  );
                  break;

                case "reinversion_total":
                  // Todo se reinvierte, solo se pagan impuestos si aplica
                  cuota_inversor = 0;
                  break;

                default:
                  // Fallback: sin reinversión (por si acaso)
                  cuota_inversor = abono_capital
                    .plus(abono_interes)
                    .plus(inv.emite_factura ? abono_iva : isr.neg());
              }
              const abonoGeneralInteres = inv.emite_factura
                ? abono_interes.plus(abono_iva)
                : abono_interes.minus(isr);

              // Acumular totales
              totalAbonoGeneralInteres =
                totalAbonoGeneralInteres.plus(abonoGeneralInteres);
              total_abono_capital = total_abono_capital.plus(abono_capital);
              total_abono_interes = total_abono_interes.plus(abono_interes);
              total_abono_iva = total_abono_iva.plus(abono_iva);
              total_isr = total_isr.plus(isr);
              total_cuota = total_cuota.plus(cuota_inversor);

              return {
                mes: pago.fecha_pago
                  ? pago.fecha_pago.toLocaleString("es-GT", { month: "long" })
                  : null,
                abono_capital: Number(abono_capital.toString()),
                abono_interes: Number(abono_interes.toString()),
                abono_iva: Number(abono_iva.toString()),
                isr: Number(isr.toString()),
                porcentaje_inversor: pago.porcentaje_participacion,
                cuota_inversor: Number(cuota_inversor.toString()),
                cuota: cuota,
                fecha_pago: pago.fecha_pago,
                cuota_inversionista: c.cuota_inversionista,
                abonoGeneralInteres: Number(abonoGeneralInteres.toString()),
                tasaInteresInvesor: Number(
                  new Big(credito?.porcentaje_interes ?? 0).mul(
                    pago.porcentaje_participacion
                  )
                ),
              };
            });

          // Acumular subtotales
          subtotal.total_monto_aportado =
            subtotal.total_monto_aportado.plus(total_monto_aportado);
          subtotal.total_abono_capital =
            subtotal.total_abono_capital.plus(total_abono_capital);
          subtotal.total_abono_interes =
            subtotal.total_abono_interes.plus(total_abono_interes);
          subtotal.total_abono_iva =
            subtotal.total_abono_iva.plus(total_abono_iva);
          subtotal.total_isr = subtotal.total_isr.plus(total_isr);
          subtotal.total_cuota = subtotal.total_cuota.plus(total_cuota);
          subtotal.totalAbonoGeneralInteres =
            subtotal.totalAbonoGeneralInteres.plus(totalAbonoGeneralInteres);

          return {
            credito_id: c.credito_id,
            numero_credito_sifco: credito?.numero_credito_sifco,
            nombre_usuario: credito?.nombre_usuario,
            nit_usuario: credito?.nit_usuario,
            capital: credito?.capital,
            porcentaje_interes: credito?.porcentaje_interes,
            cuota_interes: credito?.cuota_interes,
            iva12: credito?.iva12,
            fecha_creacion: credito?.fecha_creacion,
            monto_aportado: c.monto_aportado,
            porcentaje_inversionista: c.porcentaje_inversionista,
            cuota_inversionista: c.cuota_inversionista,
            plazo: credito.plazo,
            pagos: pagos_detalle,
            total_abono_capital: Number(total_abono_capital.toString()),
            total_abono_interes: Number(total_abono_interes.toString()),
            total_abono_iva: Number(total_abono_iva.toString()),
            total_isr: Number(total_isr.toString()),
            total_cuota: Number(total_cuota.toString()),
            meses_en_credito,
          };
        })
      );

      // 🔹 Retornar estructura del inversionista
      return {
        inversionista_id: inv.inversionista_id,
        nombre_inversionista: inv.inversionista,
        emite_factura: inv.emite_factura,
        banco: inv.banco,
        tipo_cuenta: inv.tipo_cuenta,
        numero_cuenta: inv.numero_cuenta,
        re_inversion: inv.reinversion,
        creditos: creditosData,
        subtotal: {
          total_abono_capital: Number(subtotal.total_abono_capital.toString()),
          total_abono_interes: Number(subtotal.total_abono_interes.toString()),
          total_abono_iva: Number(subtotal.total_abono_iva.toString()),
          total_isr: Number(subtotal.total_isr.toString()),
          total_cuota: Number(subtotal.total_cuota.toString()),
          total_monto_aportado: Number(
            subtotal.total_monto_aportado.toString()
          ),
          totalAbonoGeneralInteres: Number(
            subtotal.totalAbonoGeneralInteres.toString()
          ),
        },
      };
    })
  );

  return {
    inversionistas: inversionistasResumen,
    page,
    perPage,
    totalItems,
    totalPages,
  };
}

export const liquidateByInvestorSchema = z.object({
  inversionista_id: z.number(),
});
/**
 * Liquida todos los pagos de un inversionista, cambiando su estado a "LIQUIDADO"
 * @param inversionista_id ID del inversionista cuyos pagos serán liquidados
 * @returns Un objeto con el mensaje y el número de registros actualizados
 * @throws Error si no se actualiza ningún registro
 */
export async function liquidateByInvestorId(inversionista_id: number) {
  console.log(
    `Liquidando todos los pagos para inversionista_id: ${inversionista_id}`
  );

  // Actualizar estado_liquidacion a "LIQUIDADO" para todos los pagos de ese inversionista
  const result = await db
    .update(pagos_credito_inversionistas)
    .set({
      estado_liquidacion: "LIQUIDADO",
    })
    .where(eq(pagos_credito_inversionistas.inversionista_id, inversionista_id));

  if (!result.rowCount || result.rowCount === 0) {
    throw new Error(
      "[ERROR] No se encontró ningún pago para liquidar con el inversionista_id dado"
    );
  }

  return {
    message: "Pagos liquidados correctamente",
    updatedCount: result.rowCount ?? 0,
  };
}

import dayjs from "dayjs";
import "dayjs/locale/es";
import { InversionistaReporte } from "../utils/interface";

import ExcelJS from "exceljs";

dayjs.locale("es");

export function generarHTMLReporte(
  inversionista: InversionistaReporte,
  logoUrl: string = import.meta.env.LOGO_URL || ""
): string {
  const {
    nombre_inversionista: nombre_inversionista,
    emite_factura,
    creditos: creditosData,
    subtotal,
  } = inversionista;
  const fechaHoy = dayjs().format("DD [de] MMMM YYYY");

  // Totales formateados
  const capitalActivo = creditosData
    .reduce((s, c) => s + parseFloat(c.monto_aportado || "0"), 0)
    .toLocaleString("es-GT", { style: "currency", currency: "GTQ" });
  const abonoCapital = subtotal.total_abono_capital
    ? subtotal.total_abono_capital.toLocaleString("es-GT", {
        style: "currency",
        currency: "GTQ",
      })
    : "";

  const abonoInteres = subtotal.total_abono_interes
    ? subtotal.total_abono_interes.toLocaleString("es-GT", {
        style: "currency",
        currency: "GTQ",
      })
    : "";

  const granTotal = subtotal.total_cuota
    ? subtotal.total_cuota.toLocaleString("es-GT", {
        style: "currency",
        currency: "GTQ",
      })
    : "";

  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Reporte de Inversiones</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: 'Segoe UI', Arial, sans-serif;
      background: #fff;
    }
    .wrapper {
      width: 2450px;
      margin: 0 auto;
      background: #fff;
      padding: 0;
    }
    .header-row {
      display: flex;
      align-items: flex-start;
      padding: 36px 50px 8px 50px;
      width: 100%;
      box-sizing: border-box;
      justify-content: space-between;
      margin-bottom: 10px;
    }
    .logo {
      width: 210px;
      height: auto;
      margin-right: 32px;
    }
    .header-totals-row {
      flex: 1;
      display: flex;
      align-items: flex-end;
      justify-content: center;
      gap: 120px;
    }
    .header-total-block {
      text-align: center;
      min-width: 240px;
    }
    .header-total-value {
      font-size: 3.4rem;
      font-weight: bold;
      margin-bottom: 6px;
      color: #1d293b;
      line-height: 1.07;
      letter-spacing: 0.01em;
    }
    .header-total-label {
      color: #8c98b5;
      font-size: 1.33rem;
      margin-top: 2px;
      margin-bottom: 0px;
      font-weight: 400;
      letter-spacing: 0.01em;
    }
    .header-company-side {
      min-width: 160px;
      margin-left: 26px;
      margin-top: 12px;
      text-align: right;
    }
    .header-company-name {
      color: #215da8;
      font-size: 2.25rem;
      font-weight: bold;
      line-height: 2.8rem;
      margin-bottom: 10px;
    }
    .factura-label {
      color: #64748b;
      font-size: 1.18rem;
      margin-top: 4px;
      display: block;
    }
    .table-wrapper {
      margin-top: 22px;
      width: 100%;
      overflow-x: auto;
      background: #fff;
    }
    table {
      min-width: 2350px;
      border-collapse: collapse;
      width: 100%;
      background: #fff;
      font-size: 1.13rem;
    }
    thead th {
      background: #0485c2;
      color: #fff;
      font-weight: 700;
      font-size: 1.11rem;
      padding: 13px 5px;
      border-bottom: 2.5px solid #e0e7ef;
      white-space: nowrap;
      text-align: left;
    }
    td {
      font-size: 1.11rem;
      padding: 11px 4px;
      border-bottom: 1.1px solid #e0e7ef;
      white-space: nowrap;
      text-overflow: ellipsis;
      overflow: hidden;
      background: #fff;
      vertical-align: middle;
    }
    tr.total {
      font-weight: bold;
      background: #f0f9ff;
      font-size: 1.19rem;
    }
    .footer {
      color: #64748b;
      font-size: 1.11rem;
      margin-top: 28px;
      padding-left: 16px;
    }
    @media print {
      .wrapper, table {
        width: 2450px !important;
        min-width: 2450px !important;
        max-width: none !important;
      }
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header-row">
      <div>
        ${
          logoUrl
            ? `<img src="${logoUrl}" class="logo" alt="Logo" />`
            : `<div class="logo" style="width:210px;height:70px;background:#e0e0e0;border-radius:12px;"></div>`
        }
      </div>
      <div class="header-totals-row">
        <div class="header-total-block">
          <div class="header-total-value">${capitalActivo}</div>
          <div class="header-total-label">Capital activo</div>
        </div>
        <div class="header-total-block">
          <div class="header-total-value">${abonoCapital}</div>
          <div class="header-total-label">Abono capital</div>
        </div>
        <div class="header-total-block">
          <div class="header-total-value">${abonoInteres}</div>
          <div class="header-total-label">Interés recibido</div>
        </div>
        <div class="header-total-block">
          <div class="header-total-value">${granTotal}</div>
          <div class="header-total-label">Gran total a recibir</div>
        </div>
      </div>
      <div class="header-company-side">
        <div class="header-company-name">${nombre_inversionista}</div>
        <span class="factura-label">${
          emite_factura ? "Sí" : "No"
        } emite factura</span>
      </div>
    </div>
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Meses en crédito</th>
            <th>Nombre</th>
            <th>Capital</th>
            <th>%</th>
            <th>% Inversionista</th>
            <th>TASA DE INTERÉS INVERSOR</th>
            <th>Cuota Inversionista</th>
            <th>IVA Inversionista</th>
            <th>ISR</th>
            <th>Abono capital</th>
            <th>% INVERSOR</th>
            <th>Capital restante</th>
            <th>CUOTA DE MES</th>
             <th>Plazo</th>
            <th>NIT</th>
          </tr>
        </thead>
        <tbody>
          ${creditosData
            .map((c) =>
              c.pagos && c.pagos.length > 0
                ? c.pagos
                    .map(
                      (pago) => `
                                <tr>
                                  <td>${c.meses_en_credito ?? ""}</td>
                                  <td>${c.nombre_usuario ?? ""}</td>
                          <td>
                  Q${Big(c.monto_aportado || 0)
                    .add(Big(pago.abono_capital || 0))
                    .toFixed(2)
                    .replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
                </td>
                                  <td>${c.porcentaje_interes ?? ""} %</td>
                                  <td>${pago.porcentaje_inversor ?? ""} %</td>
                  <td>${pago.tasaInteresInvesor} %</td>
                  <td>Q${Number(pago.abono_interes ?? 0).toLocaleString(
                    "es-GT",
                    { minimumFractionDigits: 2 }
                  )}</td>
                  <td>Q${Number(pago.abono_iva ?? 0).toLocaleString("es-GT", {
                    minimumFractionDigits: 2,
                  })}</td>
                  <td>Q${Number(pago.isr ?? 0).toLocaleString("es-GT", {
                    minimumFractionDigits: 2,
                  })}</td>
                  <td>Q${Number(pago.abono_capital ?? 0).toLocaleString(
                    "es-GT",
                    { minimumFractionDigits: 2 }
                  )}</td>
                  <td>Q${Number(pago.abonoGeneralInteres ?? 0).toLocaleString(
                    "es-GT"
                  )}</td>
                              <td>
                  Q${Big(c.monto_aportado || 0)}
                </td>
        <td>${pago.mes || "-"}${pago.cuota ? ` (Cuota #${pago.cuota})` : ""}</td>
                  <td>${c.plazo ?? ""}</td>
                  <td>${c.nit_usuario ?? ""}</td>
                </tr>
              `
                    )
                    .join("")
                : ""
            )
            .join("")}
          <tr class="total">
            <td>Total</td>
            <td></td>
            <td> </td>
            <td></td>
            <td></td>
            <td> </td>
          <td>${
            subtotal.total_abono_interes
              ? subtotal.total_abono_interes.toLocaleString("es-GT", {
                  style: "currency",
                  currency: "GTQ",
                })
              : ""
          }</td>
<td>${
    subtotal.total_abono_iva
      ? subtotal.total_abono_iva.toLocaleString("es-GT", {
          style: "currency",
          currency: "GTQ",
        })
      : ""
  }</td>
<td>${
    subtotal.total_isr
      ? subtotal.total_isr.toLocaleString("es-GT", {
          style: "currency",
          currency: "GTQ",
        })
      : ""
  }</td>
<td>${
    subtotal.total_abono_capital
      ? subtotal.total_abono_capital.toLocaleString("es-GT", {
          style: "currency",
          currency: "GTQ",
        })
      : ""
  }</td>
<td>${
    subtotal.total_abono_general_interes
      ? subtotal.total_abono_general_interes.toLocaleString("es-GT", {
          style: "currency",
          currency: "GTQ",
        })
      : ""
  }</td>
<td>${
    subtotal.total_monto_aportado
      ? subtotal.total_monto_aportado.toLocaleString("es-GT", {
          style: "currency",
          currency: "GTQ",
        })
      : ""
  }</td>

            <td></td>
            <td></td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="footer">
      Generado por Club Cashin.com · ${fechaHoy}
    </div>
  </div>
</body>
</html>
`;
}

export const findOrCreateInvestor = async (
  nombre: string,
  emite_factura: boolean = true
) => {
  // 1. Buscar inversionista por nombre con LIKE
  const existingInvestor = await db
    .select()
    .from(inversionistas)
    .where(like(inversionistas.nombre, `%${nombre}%`))
    .limit(1);

  if (existingInvestor.length > 0) {
    return existingInvestor[0];
  }

  // 2. Si no existe, crear inversionista con defaults
  const [newInvestor] = await db
    .insert(inversionistas)
    .values({
      nombre, // Usar el nombre como está definido en el schema
      emite_factura, // Usar emite_factura como está definido en el schema
      banco: null,
      tipo_cuenta: null,
      numero_cuenta: null,
    })
    .returning();

  return newInvestor;
};

export const updateInvestor = async ({ body, set }: any) => {
  try {
    // Permitir un solo objeto o un arreglo
    let inversionistasToUpdate = [];
    if (Array.isArray(body)) {
      inversionistasToUpdate = body;
    } else if (typeof body === "object") {
      inversionistasToUpdate = [body];
    }

    // Validación mínima: debe traer inversionista_id
    const isValid = inversionistasToUpdate.every(
      (inv) => typeof inv.inversionista_id !== "undefined"
    );
    if (!isValid || inversionistasToUpdate.length === 0) {
      set.status = 400;
      return {
        message:
          "Cada inversionista debe incluir inversionista_id para actualizar.",
      };
    }

    const updatedResults = [];
    for (const inv of inversionistasToUpdate) {
      const {
        inversionista_id,
        nombre,
        emite_factura,
        tipo_reinversion, // ⭐ Agregado
        banco,
        tipo_cuenta,
        numero_cuenta,
      } = inv;

      // Construir dinámicamente solo los campos enviados
      const updateData: any = {};
      if (typeof nombre !== "undefined") updateData.nombre = nombre;
      if (typeof emite_factura !== "undefined")
        updateData.emite_factura = emite_factura;
      if (typeof tipo_reinversion !== "undefined")
        // ⭐ Agregado
        updateData.tipo_reinversion = tipo_reinversion;
      if (typeof banco !== "undefined") updateData.banco = banco;
      if (typeof tipo_cuenta !== "undefined")
        updateData.tipo_cuenta = tipo_cuenta;
      if (typeof numero_cuenta !== "undefined")
        updateData.numero_cuenta = numero_cuenta;

      // Si no hay nada que actualizar, saltar
      if (Object.keys(updateData).length === 0) continue;

      const [updated] = await db
        .update(inversionistas)
        .set(updateData)
        .where(eq(inversionistas.inversionista_id, inversionista_id))
        .returning();

      updatedResults.push(updated);
    }

    set.status = 200;
    return updatedResults;
  } catch (error) {
    set.status = 500;
    return { message: "Error updating investors", error: String(error) };
  }
};
interface InversionistaResumen {
  inversionista_id: number;
  nombre: string;
  emite_factura: boolean;
  reinversion:
    | "sin_reinversion"
    | "reinversion_capital"
    | "reinversion_interes"
    | "reinversion_total";
  banco: string | null;
  tipo_cuenta: string | null;
  numero_cuenta: string | null;
  total_abono_capital: number;
  total_abono_interes: number;
  total_abono_iva: number;
  total_isr: number;
  total_a_recibir: number;
}

export async function resumenGlobalInversionistas(
  inversionistaId?: number,
  mes?: number,
  anio?: number,
  excel: boolean = false
): Promise<
  InversionistaResumen[] | { success: boolean; url: string; filename: string }
> {
  // 🔎 Condiciones dinámicas
  const condiciones: any[] = [
    eq(pagos_credito_inversionistas.estado_liquidacion, "NO_LIQUIDADO"),
  ];

  if (inversionistaId) {
    condiciones.push(
      eq(pagos_credito_inversionistas.inversionista_id, inversionistaId)
    );
  }

  if (mes) {
    condiciones.push(
      sql`EXTRACT(MONTH FROM ${pagos_credito_inversionistas.fecha_pago}) = ${mes}`
    );
  }

  if (anio) {
    condiciones.push(
      sql`EXTRACT(YEAR FROM ${pagos_credito_inversionistas.fecha_pago}) = ${anio}`
    );
  }

  // 📊 Query agregada
  const result = await db
    .select({
      inversionista_id: inversionistas.inversionista_id,
      nombre: inversionistas.nombre,
      emite_factura: inversionistas.emite_factura,
      reinversion: inversionistas.tipo_reinversion,
      banco: inversionistas.banco,
      tipo_cuenta: inversionistas.tipo_cuenta,
      numero_cuenta: inversionistas.numero_cuenta,

      total_abono_capital: sql<number>`COALESCE(SUM(${pagos_credito_inversionistas.abono_capital}), 0)`,
      total_abono_interes: sql<number>`COALESCE(SUM(${pagos_credito_inversionistas.abono_interes}), 0)`,
      total_abono_iva: sql<number>`COALESCE(SUM(${pagos_credito_inversionistas.abono_iva_12}), 0)`,
      total_isr: sql<number>`COALESCE(SUM(${pagos_credito_inversionistas.abono_interes} * 0.05), 0)`,

      total_a_recibir: sql<number>`COALESCE(SUM(
        ${pagos_credito_inversionistas.abono_capital} 
        + ${pagos_credito_inversionistas.abono_interes} 
        + CASE 
            WHEN ${inversionistas.emite_factura} 
              THEN ${pagos_credito_inversionistas.abono_iva_12} 
              ELSE -(${pagos_credito_inversionistas.abono_interes} * 0.05) 
          END
      ), 0)`,
    })
    .from(inversionistas)
    .leftJoin(
      pagos_credito_inversionistas,
      eq(
        inversionistas.inversionista_id,
        pagos_credito_inversionistas.inversionista_id
      )
    )
    .where(and(...condiciones))
    .groupBy(
      inversionistas.inversionista_id,
      inversionistas.nombre,
      inversionistas.emite_factura,
      inversionistas.tipo_reinversion,
      inversionistas.banco,
      inversionistas.tipo_cuenta,
      inversionistas.numero_cuenta
    );
  // 📂 Si excel = true → generar archivo, subir a R2 y devolver URL
  if (excel) {
    const workbook = new ExcelJS.Workbook();

    const sheet = workbook.addWorksheet("Resumen Inversionistas");

    // Encabezados
    sheet.addRow([
      "ID",
      "Nombre",
      "Factura",
      "Reinversión",
      "Banco",
      "Tipo Cuenta",
      "Número Cuenta",
      "Capital",
      "Interés",
      "IVA",
      "ISR",
      "Total a Recibir",
    ]);

    // Filas
    result.forEach((inv) => {
      sheet.addRow([
        inv.inversionista_id,
        inv.nombre,
        inv.emite_factura ? "Sí" : "No",
        inv.reinversion ? "Sí" : "No",
        inv.banco ?? "",
        inv.tipo_cuenta ?? "",
        inv.numero_cuenta ?? "",
        inv.total_abono_capital,
        inv.total_abono_interes,
        inv.total_abono_iva,
        inv.total_isr,
        inv.total_a_recibir,
      ]);
    });

    // Ajustar ancho automático
    sheet.columns.forEach((col) => {
      let maxLength = 10;
      col.eachCell?.({ includeEmpty: true }, (cell) => {
        const len = cell.value ? cell.value.toString().length : 0;
        if (len > maxLength) maxLength = len;
      });
      col.width = maxLength + 2;
    });

    const buffer = await workbook.xlsx.writeBuffer();

    // 🚀 Subir directo a R2
    const filename = `resumen_inversionistas_${Date.now()}.xlsx`;
    const s3 = new S3Client({
      endpoint: process.env.BUCKET_REPORTS_URL,
      region: "auto",
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
      },
    });

    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.BUCKET_REPORTS,
        Key: filename,
        Body: new Uint8Array(buffer),
        ContentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })
    );

    const url = `${process.env.URL_PUBLIC_R2_REPORTS}/${filename}`;

    return {
      success: true,
      url,
      filename,
    };
  }

  return result;
}

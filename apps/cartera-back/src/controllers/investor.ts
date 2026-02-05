// app.ts (o donde declares tus rutas Elysia)
import { z } from "zod";
import { db } from "../database/index";
import {
  bancos,
  boletasPagoInversionista,
  creditos,
  creditos_inversionistas,
  cuotas_credito,
  inversionistas,
  liquidaciones,
  pagos_credito,
  pagos_credito_inversionistas,
  platform_users,
  usuarios,
} from "../database/db/schema";
import { eq, and, sql, inArray, ilike, like, desc, count } from "drizzle-orm";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
export const insertInvestor = async ({ body, set }: any) => {
  try {
    const inversionistasToUpsert = Array.isArray(body) ? body : [body];

    if (inversionistasToUpsert.length === 0) {
      set.status = 400;
      return { message: "No se proporcionaron inversionistas para procesar." };
    }

    // 🔥 Validación flexible
    const errores: string[] = [];

    for (let index = 0; index < inversionistasToUpsert.length; index++) {
      const inv = inversionistasToUpsert[index];

      // 🔥 Debe venir DPI o nombre (al menos uno)
      if (!inv.dpi && !inv.nombre?.trim()) {
        errores.push(
          `Inversionista #${index + 1}: debe proporcionar DPI o nombre`
        );
      }
      // 🔥 Validar DPI si viene
      if (inv.dpi && (typeof inv.dpi !== "number" || inv.dpi < 0)) {
        errores.push(`Inversionista #${index + 1}: DPI inválido`);
      }
      // 🔥 Validar email si viene
      if (inv.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inv.email)) {
        errores.push(`Inversionista #${index + 1}: email inválido`);
      }
      // 🔥 Validar emite_factura si viene
      if (
        inv.emite_factura !== undefined &&
        typeof inv.emite_factura !== "boolean"
      ) {
        errores.push(
          `Inversionista #${index + 1}: emite_factura debe ser boolean`
        );
      }

      // 🔥 Si viene banco (nombre o id), resolverlo
      if (inv.banco) {
        let banco_id = null;

        if (typeof inv.banco === "number") {
          const bancoExiste = await db
            .select()
            .from(bancos)
            .where(eq(bancos.banco_id, inv.banco))
            .limit(1);

          if (bancoExiste.length === 0) {
            errores.push(
              `Inversionista #${index + 1}: banco con ID ${inv.banco} no existe`
            );
          } else {
            banco_id = inv.banco;
          }
        } else if (typeof inv.banco === "string") {
          const nombreBanco = inv.banco.trim();

          const bancosCoincidentes = await db
            .select()
            .from(bancos)
            .where(ilike(bancos.nombre, `%${nombreBanco}%`))
            .limit(5);

          if (bancosCoincidentes.length === 0) {
            errores.push(
              `Inversionista #${index + 1}: no se encontró banco que coincida con "${nombreBanco}"`
            );
          } else if (bancosCoincidentes.length === 1) {
            banco_id = bancosCoincidentes[0].banco_id;
          } else {
            const matchExacto = bancosCoincidentes.find(
              (b) => b.nombre.toLowerCase() === nombreBanco.toLowerCase()
            );

            banco_id = matchExacto
              ? matchExacto.banco_id
              : bancosCoincidentes[0].banco_id;
          }
        } else {
          errores.push(
            `Inversionista #${index + 1}: banco debe ser ID (number) o nombre (string)`
          );
        }

        inv._banco_id = banco_id;
      }
    }

    if (errores.length > 0) {
      set.status = 400;
      return { message: "Errores de validación", errores };
    }

    const resultados: any[] = [];

    // 🔥 PROCESAR UNO POR UNO para manejar INSERT vs UPDATE
    for (const inv of inversionistasToUpsert) {
      // 🔥 Verificar si ya existe
      let existente = null;

      if (inv.dpi) {
        // Buscar por DPI
        const result = await db
          .select()
          .from(inversionistas)
          .where(eq(inversionistas.dpi, inv.dpi))
          .limit(1);
        existente = result[0] || null;
      } else if (inv.nombre?.trim()) {
        // Buscar por nombre
        const result = await db
          .select()
          .from(inversionistas)
          .where(eq(inversionistas.nombre, inv.nombre.trim()))
          .limit(1);
        existente = result[0] || null;
      }

      if (existente) {
        // 🔥 YA EXISTE → UPDATE solo los campos que vienen
        const updateData: any = {};

        if (inv.nombre?.trim()) updateData.nombre = inv.nombre.trim();
        if (inv.email?.trim())
          updateData.email = inv.email.trim().toLowerCase();
        if (inv.emite_factura !== undefined)
          updateData.emite_factura = inv.emite_factura;
        if (inv.tipo_reinversion?.trim())
          updateData.tipo_reinversion = inv.tipo_reinversion.trim();
        if (inv._banco_id) updateData.banco_id = inv._banco_id;
        if (inv.tipo_cuenta?.trim())
          updateData.tipo_cuenta = inv.tipo_cuenta.trim();
        if (inv.numero_cuenta?.trim())
          updateData.numero_cuenta = inv.numero_cuenta.trim();
        if (inv.dpi) updateData.dpi = inv.dpi;

        const [updated] = await db
          .update(inversionistas)
          .set(updateData)
          .where(
            eq(inversionistas.inversionista_id, existente.inversionista_id)
          )
          .returning();

        resultados.push(updated);
      } else {
        // 🔥 NO EXISTE → INSERT (requiere nombre obligatorio)
        const nombre = inv.nombre?.trim();

        if (!nombre) {
          // Si no hay nombre, saltamos este registro
          console.warn(`⚠️ Inversionista sin nombre para INSERT:`, inv);
          continue;
        }

        const insertData = {
          nombre,
          dpi: inv.dpi || null,
          email: inv.email?.trim().toLowerCase() || null,
          emite_factura: inv.emite_factura ?? false,
          tipo_reinversion: inv.tipo_reinversion?.trim() || "sin_reinversion",
          banco_id: inv._banco_id || null,
          tipo_cuenta: inv.tipo_cuenta?.trim() || null,
          numero_cuenta: inv.numero_cuenta?.trim() || null,
        };

        const [inserted] = await db
          .insert(inversionistas)
          .values(insertData)
          .returning();

        resultados.push(inserted);
      }
    }

    set.status = 201;
    return {
      message: `Procesados exitosamente ${resultados.length} inversionista(s)`,
      data: resultados,
    };
  } catch (error: any) {
    console.error("Error upserting investors:", error);

    if (error.code === "23505") {
      const detalle = error.detail || "";
      if (detalle.includes("dpi")) {
        set.status = 409;
        return {
          message: "Ya existe un inversionista con ese DPI",
          error: "duplicate_dpi",
        };
      }
      if (detalle.includes("nombre")) {
        set.status = 409;
        return {
          message: "Ya existe un inversionista con ese nombre",
          error: "duplicate_nombre",
        };
      }
    }

    set.status = 500;
    return {
      message: "Error al procesar inversionistas",
      error: error.message || String(error),
    };
  }
};
// GET: Obtener inversionistas (uno o todos)
export const getInvestors = async ({ query, set }: any) => {
  try {
    // Buscar por ID
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

    // Buscar por DPI
    if (query.dpi) {
      const dpiNumber = parseInt(query.dpi);
      if (isNaN(dpiNumber)) {
        set.status = 400;
        return { message: "DPI debe ser un número válido" };
      }

      const result = await db
        .select()
        .from(inversionistas)
        .where(eq(inversionistas.dpi, dpiNumber));
      set.status = result.length ? 200 : 404;
      return result.length
        ? result[0]
        : { message: "Inversionista no encontrado con ese DPI" };
    }

    // Buscar por nombre
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
    console.error("Error al consultar inversionistas:", error);
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
      porcentaje_cash_in: porcentajeCashIn.toString(),
      porcentaje_participacion_inversionista: porcentajeInversion.toString(),
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
      porcentaje_cash_in: porcentajeCashIn.toString(),
      porcentaje_participacion_inversionista: porcentajeInversion.toString(),
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
  investorId?: number,
  page = 1,
  perPage = 10,
  numeroCreditoSifco?: string,
  nombreUsuario?: string,
  dpi?: string,
  incluirLiquidados = false,
  numeroCuota?: number
) {
  console.log(
    "resumeInvestor for",
    investorId,
    "DPI:",
    dpi,
    "Incluir liquidados:",
    incluirLiquidados
  );

  // 1. Consulta inversionista (por ID o DPI)
  let queryConditions = [];

  if (investorId) {
    queryConditions.push(eq(inversionistas.inversionista_id, investorId));
  }

  if (dpi) {
    queryConditions.push(eq(inversionistas.dpi, parseInt(dpi)));
  }

  // Si no hay ningún filtro, retornar vacío
  if (queryConditions.length === 0) {
    return { inversionistas: [], page, perPage, totalItems: 0, totalPages: 0 };
  }

  // 🔥 CAMBIO: Ahora hacemos JOIN con la tabla bancos
  const listaInversionistas = await db
    .select({
      inversionista_id: inversionistas.inversionista_id,
      inversionista: inversionistas.nombre,
      emite_factura: inversionistas.emite_factura,
      reinversion: inversionistas.tipo_reinversion,
      banco_id: inversionistas.banco_id,
      banco_nombre: bancos.nombre,
      tipo_cuenta: inversionistas.tipo_cuenta,
      numero_cuenta: inversionistas.numero_cuenta,
      dpi: inversionistas.dpi,
   tiene_boleta_pendiente: sql<boolean>`
      EXISTS (
        SELECT 1 
        FROM cartera.boletas_pago_inversionista 
        WHERE cartera.boletas_pago_inversionista.inversionista_id = ${inversionistas.inversionista_id}
        AND cartera.boletas_pago_inversionista.estado = 'PENDIENTE'
      )
    `.as('tiene_boleta_pendiente'),
    })
    .from(inversionistas)
    .leftJoin(bancos, eq(inversionistas.banco_id, bancos.banco_id))
    .where(and(...queryConditions))
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

  // 5️⃣ Armar estructura final
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
        total_capital_creditos: new Big(0),
        total_capital_actual: new Big(0),
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
              cuota_interes: creditos.cuota_interes,
              iva12: creditos.iva_12,
            })
            .from(creditos)
            .leftJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
            .where(eq(creditos.credito_id, c.credito_id))
            .limit(1);

          // 📌 Pagos (liquidados o no según el parámetro)
          let pagosConditions = [
            eq(
              pagos_credito_inversionistas.inversionista_id,
              inv.inversionista_id
            ),
            eq(pagos_credito_inversionistas.credito_id, c.credito_id),
          ];

          // 🆕 Filtrar por estado de liquidación
          if (!incluirLiquidados) {
            pagosConditions.push(
              eq(
                pagos_credito_inversionistas.estado_liquidacion,
                "NO_LIQUIDADO"
              )
            );
          }

          // 🆕 Filtrar por número de cuota si se proporciona
          if (numeroCuota !== undefined) {
            pagosConditions.push(eq(cuotas_credito.numero_cuota, numeroCuota));
          }

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
              estado_liquidacion:
                pagos_credito_inversionistas.estado_liquidacion,
              fecha_vencimiento_cuota: cuotas_credito.fecha_vencimiento, // 🔥 FECHA DE LA CUOTA
              fecha_pago_efectivo_cuota: cuotas_credito.fecha_liquidacion_inversionistas, // 🔥 FECHA PAGO EFECTIVO
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
            .where(and(...pagosConditions));

          // 📊 Totales del crédito
          let total_abono_capital = new Big(0);
          let total_abono_interes = new Big(0);
          let total_abono_iva = new Big(0);
          let total_isr = new Big(0);
          let total_cuota = new Big(0);
          let total_monto_aportado = new Big(c.monto_aportado ?? 0);
          let totalAbonoGeneralInteres = new Big(0);

          // 🆕 Capital del crédito y capital actual
          const capital_credito = new Big(credito?.capital ?? 0);

          // ✅ Cálculo de meses_en_credito con dayjs
          let meses_en_credito: number | null = null;
          if (credito?.fecha_creacion) {
            const inicio = dayjs(credito.fecha_creacion);
            const hoy = dayjs();
            meses_en_credito = hoy.diff(inicio, "month");
          }

          // 🧮 Detalle de pagos
          const pagos_detalle = pagos
            .sort((a, b) => {
              // 🔥 ORDENAR POR FECHA DE VENCIMIENTO DE LA CUOTA
              if (!a.fecha_vencimiento_cuota) return 1;
              if (!b.fecha_vencimiento_cuota) return -1;
              const fechaA = new Date(a.fecha_vencimiento_cuota).getTime();
              const fechaB = new Date(b.fecha_vencimiento_cuota).getTime();
              return fechaA - fechaB;
            })
            .map((pago) => {
              const abono_capital = new Big(pago.abono_capital ?? 0);
              const abono_interes = new Big(pago.abono_interes ?? 0);
              const abono_iva = new Big(pago.abono_iva_12 ?? 0);
              const isr = abono_interes.times(0.07).round(2);
              const cuota = pago.cuota ?? 0;
              let cuota_inversor;
              let abonoGeneralInteres;

              // 🔥 USAR FECHA DE LA CUOTA PARA EL MES (prioridad: fecha_pago_efectivo, luego fecha_vencimiento)
        const fechaParaMes = pago.fecha_vencimiento_cuota || pago.fecha_vencimiento_cuota;
const mes = fechaParaMes
  ? dayjs(fechaParaMes).format('MMMM') // 🔥 Esto da el mes correcto
  : null;
  console.log("Fecha para mes:", fechaParaMes, "→ Mes:", mes);
       // 🆕 CORRECCIÓN: Cálculo según emite_factura
              if (inv.emite_factura) {
                abonoGeneralInteres = abono_interes.plus(abono_iva);
              } else {
                abonoGeneralInteres = abono_interes.minus(isr);
              }

              switch (inv.reinversion) {
                case "sin_reinversion":
                  cuota_inversor = abono_capital
                    .plus(abono_interes)
                    .plus(inv.emite_factura ? abono_iva : isr.neg());
                  break;

                case "reinversion_capital":
                  cuota_inversor = abono_interes.plus(
                    inv.emite_factura ? abono_iva : isr.neg()
                  );
                  break;

                case "reinversion_interes":
                  cuota_inversor = abono_capital.plus(
                    inv.emite_factura ? abono_iva : isr.neg()
                  );
                  break;

                case "reinversion_total":
                  cuota_inversor = new Big(0);
                  break;

                default:
                  cuota_inversor = abono_capital
                    .plus(abono_interes)
                    .plus(inv.emite_factura ? abono_iva : isr.neg());
              }

              // 🆕 CORRECCIÓN: Acumular totales
              totalAbonoGeneralInteres =
                totalAbonoGeneralInteres.plus(abonoGeneralInteres);
              total_abono_capital = total_abono_capital.plus(abono_capital);
              total_abono_interes = total_abono_interes.plus(abono_interes);
              total_abono_iva = total_abono_iva.plus(abono_iva);

              if (inv.emite_factura) {
                // ISR se queda en 0
              } else {
                total_isr = total_isr.plus(isr);
              }

              total_cuota = total_cuota.plus(cuota_inversor);

              return {
                mes, // 🔥 AHORA USA LA FECHA DE LA CUOTA
                abono_capital: Number(abono_capital.toString()),
                abono_interes: Number(abono_interes.toString()),
                abono_iva: Number(abono_iva.toString()),
                isr: inv.emite_factura ? 0 : Number(isr.toString()),
                porcentaje_inversor: pago.porcentaje_participacion,
                cuota_inversor: Number(cuota_inversor.toString()),
                cuota: cuota,
                fecha_pago: pago.fecha_pago,
                fecha_vencimiento_cuota: pago.fecha_vencimiento_cuota, // 🔥 NUEVA
                fecha_pago_efectivo_cuota: pago.fecha_pago_efectivo_cuota, // 🔥 NUEVA
                cuota_inversionista: c.cuota_inversionista,
                abonoGeneralInteres: Number(abonoGeneralInteres.toString()),
                tasaInteresInvesor: Number(
                  new Big(credito?.porcentaje_interes ?? 0).mul(
                    pago.porcentaje_participacion
                  )
                ),
                estado_liquidacion: pago.estado_liquidacion,
              };
            });

          // 🆕 Calcular capital actual (capital - total_abono_capital)
          const capital_actual = capital_credito.minus(total_abono_capital);

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
          subtotal.total_capital_creditos =
            subtotal.total_capital_creditos.plus(capital_credito);
          subtotal.total_capital_actual =
            subtotal.total_capital_actual.plus(capital_actual);

          return {
            credito_id: c.credito_id,
            numero_credito_sifco: credito?.numero_credito_sifco,
            nombre_usuario: credito?.nombre_usuario,
            nit_usuario: credito?.nit_usuario,
            capital: credito?.capital,
            capital_actual: Number(capital_actual.toString()),
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
        banco_id: inv.banco_id,
        banco: inv.banco_nombre,
        tipo_cuenta: inv.tipo_cuenta,
        numero_cuenta: inv.numero_cuenta,
        re_inversion: inv.reinversion,
        tieneBoletaPendiente: inv.tiene_boleta_pendiente,
        dpi: inv.dpi,
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
          total_capital_creditos: Number(
            subtotal.total_capital_creditos.toString()
          ),
          total_capital_actual: Number(
            subtotal.total_capital_actual.toString()
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
  inversionista_id: z.number().optional(), // 🆕 Ahora es opcional
});
export async function liquidateByInvestorId(inversionista_id?: number) {
  if (inversionista_id) {
    console.log(`Liquidando inversionista_id: ${inversionista_id}`);
  } else {
    console.log("⚠️ LIQUIDANDO TODOS LOS INVERSIONISTAS ⚠️");
  }

  // 🔍 PASO 1: Determinar qué inversionistas liquidar
  let inversionistasALiquidar: number[] = [];

  if (inversionista_id) {
    inversionistasALiquidar = [inversionista_id];
  } else {
    const inversionistasConPagos = await db
      .selectDistinct({
        inversionista_id: pagos_credito_inversionistas.inversionista_id,
      })
      .from(pagos_credito_inversionistas)
      .where(
        eq(pagos_credito_inversionistas.estado_liquidacion, "NO_LIQUIDADO")
      );

    inversionistasALiquidar = inversionistasConPagos.map(
      (i) => i.inversionista_id
    );
  }

  if (inversionistasALiquidar.length === 0) {
    const mensaje = inversionista_id
      ? `No se encontró ningún pago NO_LIQUIDADO para el inversionista_id: ${inversionista_id}`
      : "No se encontró ningún pago NO_LIQUIDADO en el sistema";
    throw new Error(`[ERROR] ${mensaje}`);
  }

  console.log(
    `📋 Se liquidarán ${inversionistasALiquidar.length} inversionista(s)`
  );

  // 📊 PASO 2: Procesar cada inversionista
  let totalPagosLiquidados = 0;
  let totalLiquidaciones = 0;
  let inversionistasSaltados = 0;
  const reportesGenerados: Array<{ 
    inversionista_id: number; 
    url: string;
    boleta_id: number;
    boleta_url: string;
  }> = [];
  const errores: Array<{
    inversionista_id: number;
    razon: string;
  }> = [];

  for (const inv_id of inversionistasALiquidar) {
    try {
      console.log(`\n💰 Procesando inversionista ${inv_id}...`);

      // 🔍 PASO 2.1: Buscar boleta PENDIENTE del inversionista
      console.log(`  🔍 Buscando boleta PENDIENTE...`);
      const [boletaPendiente] = await db
        .select()
        .from(boletasPagoInversionista)
        .where(
          and(
            eq(boletasPagoInversionista.inversionista_id, inv_id),
            eq(boletasPagoInversionista.estado, "PENDIENTE")
          )
        )
        .orderBy(desc(boletasPagoInversionista.fecha_subida)) // La más reciente
        .limit(1);

      // 🚨 SI NO HAY BOLETA PENDIENTE, SALTAR ESTE INVERSIONISTA
      if (!boletaPendiente) {
        const razon = "No tiene boleta PENDIENTE";
        console.warn(`  ⚠️ ${razon} - Saltando inversionista ${inv_id}`);
        errores.push({
          inversionista_id: inv_id,
          razon: razon,
        });
        inversionistasSaltados++;
        continue; // 🔥 Seguir con el siguiente inversionista
      }

      console.log(`  ✅ Boleta encontrada: ID ${boletaPendiente.boleta_id}`);
      console.log(`     URL: ${boletaPendiente.boleta_url}`);
      console.log(`     Monto: Q${boletaPendiente.monto_boleta ?? "N/A"}`);
      console.log(`     Fecha subida: ${boletaPendiente.fecha_subida}`);

      // 🆕 Obtener datos del inversionista
      const resumen = await resumeInvestor(
        inv_id,
        1,
        999999,
        undefined,
        undefined,
        undefined,
        false,
        undefined
      );

      if (!resumen.inversionistas || resumen.inversionistas.length === 0) {
        console.log(`  ⚠️ Inversionista ${inv_id} sin pagos pendientes`);
        errores.push({
          inversionista_id: inv_id,
          razon: "Sin pagos pendientes",
        });
        inversionistasSaltados++;
        continue;
      }

      const inversionista = resumen.inversionistas[0];

      if (
        Number(inversionista.subtotal.total_cuota) === 0 ||
        !inversionista.creditos.some((c) => c.pagos.length > 0)
      ) {
        console.log(`  ⚠️ Inversionista ${inv_id} sin pagos para liquidar`);
        errores.push({
          inversionista_id: inv_id,
          razon: "Sin pagos para liquidar",
        });
        inversionistasSaltados++;
        continue;
      }

      const cantidadPagos = inversionista.creditos.reduce(
        (sum, cred) => sum + (cred.pagos?.length ?? 0),
        0
      );

      console.log(`  📊 Total pagos a liquidar: ${cantidadPagos}`);

      // 🆕 PASO 3: Crear registro de liquidación CON la boleta
      const [liquidacion] = await db
        .insert(liquidaciones)
        .values({
          inversionista_id: inv_id,
          boleta_id: boletaPendiente.boleta_id, // 🔥 SIEMPRE con boleta
          total_pagos_liquidados: cantidadPagos,
          total_capital: inversionista.subtotal.total_abono_capital.toString(),
          total_interes: inversionista.subtotal.total_abono_interes.toString(),
          total_iva: inversionista.subtotal.total_abono_iva.toString(),
          total_isr: inversionista.subtotal.total_isr.toString(),
          total_cuota: inversionista.subtotal.total_cuota.toString(),
          fecha_liquidacion: new Date(),
        })
        .returning();

      console.log(
        `  ✅ Liquidación creada: liquidacion_id=${liquidacion.liquidacion_id}`
      );

      // 🔥 PASO 3.1: Marcar boleta como PROCESADO
      await db
        .update(boletasPagoInversionista)
        .set({
          estado: "PROCESADO",
          fecha_procesado: new Date(),
        })
        .where(eq(boletasPagoInversionista.boleta_id, boletaPendiente.boleta_id));

      console.log(`  ✅ Boleta ${boletaPendiente.boleta_id} marcada como PROCESADO`);

      // 🆕 PASO 4: Obtener IDs de pagos y actualizar
      const pagosIds: number[] = [];
      for (const credito of inversionista.creditos) {
        if (credito.pagos && credito.pagos.length > 0) {
          const pagosBD = await db
            .select({ id: pagos_credito_inversionistas.id })
            .from(pagos_credito_inversionistas)
            .where(
              and(
                eq(pagos_credito_inversionistas.inversionista_id, inv_id),
                eq(pagos_credito_inversionistas.credito_id, credito.credito_id),
                eq(
                  pagos_credito_inversionistas.estado_liquidacion,
                  "NO_LIQUIDADO"
                )
              )
            );
          pagosIds.push(...pagosBD.map((p) => p.id));
        }
      }

      const updateResult = await db
        .update(pagos_credito_inversionistas)
        .set({
          estado_liquidacion: "LIQUIDADO",
          liquidacion_id: liquidacion.liquidacion_id,
        })
        .where(inArray(pagos_credito_inversionistas.id, pagosIds));

      console.log(`  ✅ ${updateResult.rowCount ?? 0} pagos actualizados`);

      // 🆕 PASO 5: Generar PDF usando la data que YA TENEMOS
      console.log(`  📄 Generando PDF...`);

      const logoUrl = process.env.LOGO_URL || "";
      const html = generarHTMLReporte(inversionista as any, logoUrl);

      const browser = await puppeteer.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
        ],
      });

      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "networkidle0" });

      const pdfBuffer = await page.pdf({
        printBackground: true,
        width: "2500px",
        height: "980px",
        landscape: false,
        margin: { top: 20, bottom: 20, left: 8, right: 8 },
      });

      await browser.close();

      // 🆕 PASO 6: Subir a R2
      const filename = `liquidacion_${liquidacion.liquidacion_id}_${Date.now()}.pdf`;
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
          Body: pdfBuffer,
          ContentType: "application/pdf",
        })
      );

      const url = `${process.env.URL_PUBLIC_R2_REPORTS}/${filename}`;

      console.log(`  ✅ PDF generado y guardado: ${filename}`);
      
      // 🆕 PASO 7: Actualizar liquidación con URL del reporte
      await db
        .update(liquidaciones)
        .set({ reporte_liquidacion_url: url })
        .where(eq(liquidaciones.liquidacion_id, liquidacion.liquidacion_id));

      console.log(
        `  ✅ Reporte actualizado en liquidación ${liquidacion.liquidacion_id}`
      );
      
      reportesGenerados.push({ 
        inversionista_id: inv_id, 
        url,
        boleta_id: boletaPendiente.boleta_id,
        boleta_url: boletaPendiente.boleta_url,
      });
      
      totalPagosLiquidados += updateResult.rowCount ?? 0;
      totalLiquidaciones++;
    } catch (error) {
      console.error(`  ❌ Error procesando inversionista ${inv_id}:`, error);
      errores.push({
        inversionista_id: inv_id,
        razon: error instanceof Error ? error.message : "Error desconocido",
      });
      inversionistasSaltados++;
      // 🔥 NO hacemos throw, solo seguimos con el siguiente
    }
  }

  // 📝 PASO 8: Mensaje final
  const mensaje = inversionista_id
    ? totalLiquidaciones > 0 
      ? `Inversionista ${inversionista_id} liquidado correctamente`
      : `No se pudo liquidar al inversionista ${inversionista_id}`
    : `${totalLiquidaciones} inversionistas liquidados correctamente (${inversionistasSaltados} saltados)`;

  console.log(`\n✅ RESUMEN FINAL:`);
  console.log(`   - Liquidaciones creadas: ${totalLiquidaciones}`);
  console.log(`   - Pagos liquidados: ${totalPagosLiquidados}`);
  console.log(`   - PDFs generados: ${reportesGenerados.length}`);
  console.log(`   - Boletas procesadas: ${reportesGenerados.length}`);
  console.log(`   - Inversionistas saltados: ${inversionistasSaltados}`);
  
  if (errores.length > 0) {
    console.log(`\n⚠️ INVERSIONISTAS NO PROCESADOS:`);
    errores.forEach(e => {
      console.log(`   - ID ${e.inversionista_id}: ${e.razon}`);
    });
  }

  return {
    message: mensaje,
    updatedCount: totalPagosLiquidados,
    inversionista_id: inversionista_id ?? "TODOS",
    liquidaciones_creadas: totalLiquidaciones,
    inversionistas_saltados: inversionistasSaltados,
    reportes: reportesGenerados,
    errores: errores.length > 0 ? errores : undefined,
  };
}
import dayjs from "dayjs";
import "dayjs/locale/es";
import { InversionistaReporte } from "../utils/interface";

import ExcelJS from "exceljs";
import puppeteer from "puppeteer";

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
  console.log(`🔍 Buscando/creando inversionista: "${nombre}"`);
  
  // 🧹 NORMALIZAR nombre
  const nombreNormalizado = nombre.trim();
  const nombreLower = nombreNormalizado.toLowerCase();
  
  // 1️⃣ BÚSQUEDA EXACTA (case insensitive)
  console.log(`   🎯 Estrategia 1: Búsqueda exacta...`);
  const exactMatch = await db
    .select()
    .from(inversionistas)
    .where(sql`LOWER(TRIM(${inversionistas.nombre})) = ${nombreLower}`)
    .limit(1);

  if (exactMatch.length > 0) {
    console.log(`   ✅ Inversionista encontrado (exacto): ${exactMatch[0].nombre} (ID: ${exactMatch[0].inversionista_id})`);
    return exactMatch[0];
  }

  // 2️⃣ BÚSQUEDA SIN TILDES
  console.log(`   🎯 Estrategia 2: Búsqueda sin tildes...`);
  const nombreSinTildes = nombreNormalizado
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  
  const withoutAccents = await db
    .select()
    .from(inversionistas)
    .where(
      sql`LOWER(
        TRIM(
          translate(
            ${inversionistas.nombre}, 
            'áéíóúÁÉÍÓÚñÑ', 
            'aeiouAEIOUnN'
          )
        )
      ) = ${nombreSinTildes}`
    )
    .limit(1);

  if (withoutAccents.length > 0) {
    console.log(`   ✅ Inversionista encontrado (sin tildes): ${withoutAccents[0].nombre} (ID: ${withoutAccents[0].inversionista_id})`);
    return withoutAccents[0];
  }

  // 3️⃣ BÚSQUEDA "COMIENZA CON" - Para nombres con apellidos extras
  console.log(`   🎯 Estrategia 3: Búsqueda "comienza con"...`);
  
  // 🔥 BUSCAR SI ALGÚN NOMBRE EN BD ESTÁ CONTENIDO EN EL NOMBRE DEL EXCEL
  // Ejemplo: Si en BD hay "Ana Lucia Salvatierra" y en Excel "Ana Lucia Salvatierra Mayen"
  //          debería encontrar el de BD porque "Ana Lucia Salvatierra" está contenido
  
  const allInvestors = await db
    .select()
    .from(inversionistas);
  
  // Buscar si el nombre del Excel COMIENZA con algún nombre de BD
  const startsWithMatch = allInvestors.find(inv => {
    const invNombreLower = inv.nombre.toLowerCase().trim();
    const nombreLowerTrim = nombreLower.trim();
    
    // Si el nombre de BD está contenido al inicio del nombre del Excel
    return nombreLowerTrim.startsWith(invNombreLower) && nombreLowerTrim.length > invNombreLower.length;
  });

  if (startsWithMatch) {
    console.log(`   ✅ Inversionista encontrado (nombre base): ${startsWithMatch.nombre} (ID: ${startsWithMatch.inversionista_id})`);
    console.log(`   ℹ️  "${nombreNormalizado}" coincide con "${startsWithMatch.nombre}"`);
    return startsWithMatch;
  }

  // 4️⃣ BÚSQUEDA INVERSA - Si en BD hay un nombre más largo
  console.log(`   🎯 Estrategia 4: Búsqueda inversa (nombre más largo en BD)...`);
  
  const containsMatch = allInvestors.find(inv => {
    const invNombreLower = inv.nombre.toLowerCase().trim();
    const nombreLowerTrim = nombreLower.trim();
    
    // Si el nombre del Excel está contenido al inicio del nombre de BD
    return invNombreLower.startsWith(nombreLowerTrim) && invNombreLower.length > nombreLowerTrim.length;
  });

  if (containsMatch) {
    console.log(`   ✅ Inversionista encontrado (nombre completo en BD): ${containsMatch.nombre} (ID: ${containsMatch.inversionista_id})`);
    console.log(`   ℹ️  "${nombreNormalizado}" es parte de "${containsMatch.nombre}"`);
    return containsMatch;
  }

  // 5️⃣ BÚSQUEDA POR PALABRAS CLAVE (más restrictiva)
  console.log(`   🎯 Estrategia 5: Búsqueda por palabras clave...`);
  
  // Dividir en palabras (ignorar palabras muy cortas como "de", "la", etc.)
  const palabras = nombreNormalizado
    .split(/\s+/)
    .filter(p => p.length > 2 && !['del', 'de', 'la', 'los', 'las'].includes(p.toLowerCase()));
  
  if (palabras.length >= 2) { // Solo si tiene al menos 2 palabras significativas
    // Buscar inversionistas que tengan TODAS las palabras importantes
    const wordMatches = allInvestors.filter(inv => {
      const invWords = inv.nombre.toLowerCase().split(/\s+/);
      // Verificar que TODAS las palabras del Excel estén en el nombre de BD
      return palabras.every(palabra => 
        invWords.some(w => w.includes(palabra.toLowerCase()))
      );
    });

    if (wordMatches.length === 1) {
      console.log(`   ✅ Inversionista encontrado (por palabras): ${wordMatches[0].nombre} (ID: ${wordMatches[0].inversionista_id})`);
      return wordMatches[0];
    } else if (wordMatches.length > 1) {
      console.log(`   ⚠️ Múltiples matches (${wordMatches.length}):`);
      wordMatches.forEach((inv, idx) => {
        console.log(`      ${idx + 1}. ${inv.nombre} (ID: ${inv.inversionista_id})`);
      });
      
      // 🔥 Usar el que tenga el nombre más corto (más probable que sea el base)
      const shortest = wordMatches.reduce((prev, curr) => 
        prev.nombre.length < curr.nombre.length ? prev : curr
      );
      
      console.log(`   ✅ Usando el más corto: ${shortest.nombre} (ID: ${shortest.inversionista_id})`);
      return shortest;
    }
  }

  // 6️⃣ NO EXISTE → CREAR NUEVO
  console.log(`   ➕ Inversionista no encontrado, creando nuevo...`);
  
  const [newInvestor] = await db
    .insert(inversionistas)
    .values({
      nombre: nombreNormalizado,
      emite_factura,
      banco_id: null,
      tipo_cuenta: null,
      numero_cuenta: null,
    })
    .returning();

  console.log(`   ✅ Inversionista creado: ${newInvestor.nombre} (ID: ${newInvestor.inversionista_id})`);
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
        dpi,
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
      if (typeof dpi !== "undefined") updateData.dpi = dpi;

      // Si no hay nada que actualizar, saltar
      if (Object.keys(updateData).length === 0) continue;
      console.log(
        "Actualizando inversionista_id:",
        inversionista_id,
        updateData
      );
      const [updated] = await db
        .update(inversionistas)
        .set(updateData)
        .where(eq(inversionistas.inversionista_id, inversionista_id))
        .returning();

      updatedResults.push(updated);
    }
    console.log("Inversionistas actualizados:", updatedResults.length);
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

  // 📊 Query agregada con la NUEVA LÓGICA + JOIN con bancos
  const result = await db
    .select({
      inversionista_id: inversionistas.inversionista_id,
      nombre: inversionistas.nombre,
      emite_factura: inversionistas.emite_factura,
      reinversion: inversionistas.tipo_reinversion,
      banco_id: inversionistas.banco_id, // 🔥 ID del banco
      banco_nombre: bancos.nombre, // 🔥 Nombre del banco desde la tabla
      tipo_cuenta: inversionistas.tipo_cuenta,
      numero_cuenta: inversionistas.numero_cuenta,

      total_abono_capital: sql<number>`COALESCE(SUM(${pagos_credito_inversionistas.abono_capital}), 0)`,
      total_abono_interes: sql<number>`COALESCE(SUM(${pagos_credito_inversionistas.abono_interes}), 0)`,

      // 🆕 IVA: SIEMPRE se suma (mostrar la cantidad)
      total_abono_iva: sql<number>`COALESCE(SUM(${pagos_credito_inversionistas.abono_iva_12}), 0)`,

      // 🆕 ISR: Solo se calcula si NO emite factura, de lo contrario = 0
      total_isr: sql<number>`COALESCE(SUM(
        CASE 
          WHEN ${inversionistas.emite_factura} 
            THEN 0 
            ELSE ${pagos_credito_inversionistas.abono_interes} * 0.07
        END
      ), 0)`,

      // 🆕 Total a recibir con la nueva lógica
      total_a_recibir: sql<number>`COALESCE(SUM(
        ${pagos_credito_inversionistas.abono_capital} 
        + ${pagos_credito_inversionistas.abono_interes} 
        + CASE 
            WHEN ${inversionistas.emite_factura} 
              THEN ${pagos_credito_inversionistas.abono_iva_12}
            ELSE -(${pagos_credito_inversionistas.abono_interes} * 0.07)
          END
      ), 0)`,
    })
    .from(inversionistas)
    .leftJoin(
      bancos,
      eq(inversionistas.banco_id, bancos.banco_id) // 🔥 JOIN con tabla bancos
    )
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
      inversionistas.banco_id, // 🔥 Ahora agrupamos por banco_id
      bancos.nombre, // 🔥 Y también por banco.nombre
      inversionistas.tipo_cuenta,
      inversionistas.numero_cuenta
    );

  // 📂 Si excel = true → generar archivo, subir a R2 y devolver URL
  if (excel) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Resumen Inversionistas");

    // 🎨 Estilo del encabezado
    const headerRow = sheet.addRow([
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

    // Estilizar encabezados
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF0070C0" },
    };
    headerRow.alignment = { horizontal: "center", vertical: "middle" };

    // Filas de datos
    result.forEach((inv) => {
      const row = sheet.addRow([
        inv.inversionista_id,
        inv.nombre,
        inv.emite_factura ? "Sí" : "No",
        inv.reinversion || "sin_reinversion",
        inv.banco_nombre ?? "", // 🔥 Ahora usamos banco_nombre
        inv.tipo_cuenta ?? "",
        inv.numero_cuenta ?? "",
        Number(inv.total_abono_capital).toFixed(2),
        Number(inv.total_abono_interes).toFixed(2),
        Number(inv.total_abono_iva).toFixed(2),
        Number(inv.total_isr).toFixed(2),
        Number(inv.total_a_recibir).toFixed(2),
      ]);

      // 🆕 Resaltar ISR = 0 cuando emite factura
      if (inv.emite_factura) {
        const isrCell = row.getCell(11); // Columna ISR
        isrCell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFE0E0E0" }, // Gris claro
        };
        isrCell.font = { color: { argb: "FF808080" } }; // Texto gris
      }

      // 🆕 Formato de moneda para columnas numéricas
      for (let i = 8; i <= 12; i++) {
        row.getCell(i).numFmt = "Q#,##0.00";
      }
    });

    // Ajustar ancho automático
    sheet.columns.forEach((col, index) => {
      let maxLength = 10;
      col.eachCell?.({ includeEmpty: true }, (cell) => {
        const len = cell.value ? cell.value.toString().length : 0;
        if (len > maxLength) maxLength = len;
      });
      col.width = maxLength + 2;
    });

    // Congelar primera fila (encabezados)
    sheet.views = [{ state: "frozen", ySplit: 1 }];

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

  // Map result to match InversionistaResumen interface
  return result.map((inv) => ({
    inversionista_id: inv.inversionista_id,
    nombre: inv.nombre,
    emite_factura: inv.emite_factura,
    reinversion: inv.reinversion,
    banco: inv.banco_nombre,
    tipo_cuenta: inv.tipo_cuenta,
    numero_cuenta: inv.numero_cuenta,
    total_abono_capital: inv.total_abono_capital,
    total_abono_interes: inv.total_abono_interes,
    total_abono_iva: inv.total_abono_iva,
    total_isr: inv.total_isr,
    total_a_recibir: inv.total_a_recibir,
  }));
}
/**
 * Obtiene liquidaciones con sus pagos
 * @param inversionista_id - Filtrar por inversionista (opcional)
 * @param liquidacion_id - Filtrar por liquidación específica (opcional)
 * @param dpi - Filtrar por DPI del inversionista (opcional)
 * @param page - Número de página
 * @param perPage - Registros por página
 */
export async function getLiquidaciones({
  inversionista_id,
  liquidacion_id,
  dpi,
  page = 1,
  perPage = 10,
}: {
  inversionista_id?: number;
  liquidacion_id?: number;
  dpi?: string;
  page?: number;
  perPage?: number;
}) {
  console.log("[getLiquidaciones] Params:", {
    inversionista_id,
    liquidacion_id,
    dpi,
    page,
    perPage,
  });

  // 🔍 Construir condiciones
  const conditions = [];

  if (inversionista_id) {
    conditions.push(eq(liquidaciones.inversionista_id, inversionista_id));
  }

  if (liquidacion_id) {
    conditions.push(eq(liquidaciones.liquidacion_id, liquidacion_id));
  }

  // 🆕 Filtro por DPI
  if (dpi) {
    conditions.push(eq(inversionistas.dpi, parseInt(dpi)));
  }

  // 📊 Query principal con joins
  const query = db
    .select({
      // Datos de liquidación
      liquidacion_id: liquidaciones.liquidacion_id,
      inversionista_id: liquidaciones.inversionista_id,
      boleta_id: liquidaciones.boleta_id, // 🔥 NUEVO
      total_pagos_liquidados: liquidaciones.total_pagos_liquidados,
      total_capital: liquidaciones.total_capital,
      total_interes: liquidaciones.total_interes,
      total_iva: liquidaciones.total_iva,
      total_isr: liquidaciones.total_isr,
      total_cuota: liquidaciones.total_cuota,
      reporte_liquidacion: liquidaciones.reporte_liquidacion_url,
      fecha_liquidacion: liquidaciones.fecha_liquidacion,
      // Datos del inversionista
      nombre_inversionista: inversionistas.nombre,
      emite_factura: inversionistas.emite_factura,
      dpi: inversionistas.dpi,
    })
    .from(liquidaciones)
    .leftJoin(
      inversionistas,
      eq(liquidaciones.inversionista_id, inversionistas.inversionista_id)
    )
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(liquidaciones.fecha_liquidacion));

  // 🔢 Contar total de registros
  const totalQuery = db
    .select({ count: count() })
    .from(liquidaciones)
    .leftJoin(
      inversionistas,
      eq(liquidaciones.inversionista_id, inversionistas.inversionista_id)
    )
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  const [{ count: totalItems }] = await totalQuery;
  const totalPages = Math.ceil(totalItems / perPage);

  // 📄 Paginación
  const liquidacionesData = await query
    .limit(perPage)
    .offset((page - 1) * perPage);

  // 💰 Para cada liquidación, traer sus pagos Y boleta
  const liquidacionesConPagos = await Promise.all(
    liquidacionesData.map(async (liq) => {
      // 📄 Traer boleta asociada a esta liquidación (si existe)
      let boletaData = null;
      
      if (liq.boleta_id) {
        console.log(`🔍 Buscando boleta ID: ${liq.boleta_id} para liquidación ${liq.liquidacion_id}`);
        
        const [boleta] = await db
          .select({
            boleta_id: boletasPagoInversionista.boleta_id,
            inversionista_id: boletasPagoInversionista.inversionista_id,
            boleta_url: boletasPagoInversionista.boleta_url,
            estado: boletasPagoInversionista.estado,
            monto_boleta: boletasPagoInversionista.monto_boleta,
            notas: boletasPagoInversionista.notas,
            fecha_subida: boletasPagoInversionista.fecha_subida,
            fecha_procesado: boletasPagoInversionista.fecha_procesado,
            subido_por_nombre: platform_users.email, // 🔥 Nombre de quien subió
          })
          .from(boletasPagoInversionista)
          .leftJoin(
            platform_users,
            eq(boletasPagoInversionista.subido_por, platform_users.id)
          )
          .where(eq(boletasPagoInversionista.boleta_id, liq.boleta_id))
          .limit(1);

        if (boleta) {
          boletaData = {
            boleta_id: boleta.boleta_id,
            inversionista_id: boleta.inversionista_id,
            boleta_url: boleta.boleta_url,
            estado: boleta.estado,
            monto_boleta: boleta.monto_boleta ? Number(boleta.monto_boleta) : null,
            notas: boleta.notas,
            fecha_subida: boleta.fecha_subida,
            fecha_procesado: boleta.fecha_procesado,
            subido_por: boleta.subido_por_nombre,
          };
          
          console.log(`✅ Boleta encontrada: ${boleta.boleta_url}`);
        } else {
          console.warn(`⚠️ Boleta ID ${liq.boleta_id} no encontrada en BD`);
        }
      } else {
        console.log(`ℹ️ Liquidación ${liq.liquidacion_id} no tiene boleta asociada`);
      }

      // 💳 Traer pagos de esta liquidación
      const pagos = await db
        .select({
          pago_id: pagos_credito_inversionistas.id,
          pago_credito_id: pagos_credito_inversionistas.pago_id,
          credito_id: pagos_credito_inversionistas.credito_id,
          abono_capital: pagos_credito_inversionistas.abono_capital,
          abono_interes: pagos_credito_inversionistas.abono_interes,
          abono_iva: pagos_credito_inversionistas.abono_iva_12,
          porcentaje_participacion:
            pagos_credito_inversionistas.porcentaje_participacion,
          fecha_pago: pagos_credito_inversionistas.fecha_pago,
          cuota: pagos_credito_inversionistas.cuota,
          // Info del crédito
          numero_credito_sifco: creditos.numero_credito_sifco,
          nombre_cliente: usuarios.nombre,
          nit_cliente: usuarios.nit,
        })
        .from(pagos_credito_inversionistas)
        .leftJoin(
          creditos,
          eq(pagos_credito_inversionistas.credito_id, creditos.credito_id)
        )
        .leftJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
        .where(
          eq(pagos_credito_inversionistas.liquidacion_id, liq.liquidacion_id)
        )
        .orderBy(pagos_credito_inversionistas.fecha_pago);

      // 💰 Calcular ISR por pago
      const pagosConISR = pagos.map((pago) => {
        const abono_interes = new Big(pago.abono_interes ?? 0);
        const isr = liq.emite_factura ? new Big(0) : abono_interes.times(0.07);

        return {
          ...pago,
          abono_capital: Number(pago.abono_capital),
          abono_interes: Number(pago.abono_interes),
          abono_iva: Number(pago.abono_iva),
          isr: Number(isr.toString()),
          cuota: Number(pago.cuota),
        };
      });

      return {
        liquidacion_id: liq.liquidacion_id,
        inversionista_id: liq.inversionista_id,
        nombre_inversionista: liq.nombre_inversionista ?? "TODOS",
        emite_factura: liq.emite_factura,
        dpi: liq.dpi,
        
        // 🔥 BOLETA ASOCIADA
        boleta: boletaData,
        
        totales: {
          total_pagos_liquidados: liq.total_pagos_liquidados,
          total_capital: Number(liq.total_capital),
          total_interes: Number(liq.total_interes),
          total_iva: Number(liq.total_iva),
          total_isr: Number(liq.total_isr),
          total_cuota: Number(liq.total_cuota),
        },
        reporte_liquidacion: liq.reporte_liquidacion,
        fecha_liquidacion: liq.fecha_liquidacion,
        pagos: pagosConISR,
      };
    })
  );

  return {
    liquidaciones: liquidacionesConPagos,
    page,
    perPage,
    totalItems,
    totalPages,
  };
}
/**
 * Obtiene el rendimiento de un inversionista por DPI
 * @param dpi - DPI del inversionista
 */
export async function getInvestorPerformance(dpi: string) {
  console.log("[getInvestorPerformance] DPI:", dpi);

  // 1️⃣ Buscar inversionista por DPI
  const [inversionista] = await db
    .select({
      inversionista_id: inversionistas.inversionista_id,
      nombre: inversionistas.nombre,
      dpi: inversionistas.dpi,
    })
    .from(inversionistas)
    .where(eq(inversionistas.dpi, parseInt(dpi)))
    .limit(1);

  if (!inversionista) {
    throw new Error(`No se encontró inversionista con DPI: ${dpi}`);
  }

  // 2️⃣ Obtener todas las inversiones del inversionista
  const inversiones = await db
    .select({
      credito_id: creditos_inversionistas.credito_id,
      monto_aportado: creditos_inversionistas.monto_aportado,
      cuota_inversionista: creditos_inversionistas.cuota_inversionista,
    })
    .from(creditos_inversionistas)
    .where(
      eq(
        creditos_inversionistas.inversionista_id,
        inversionista.inversionista_id
      )
    );

  // 3️⃣ Calcular totales
  let capital_total_aportado = new Big(0);
  let rendimiento_total = new Big(0);

  for (const inv of inversiones) {
    // Sumar capital aportado
    capital_total_aportado = capital_total_aportado.plus(
      inv.monto_aportado ?? 0
    );

    // Buscar cuotas LIQUIDADAS de este crédito para este inversionista
    const pagosLiquidados = await db
      .select({
        cuota: pagos_credito_inversionistas.cuota,
      })
      .from(pagos_credito_inversionistas)
      .where(
        and(
          eq(
            pagos_credito_inversionistas.inversionista_id,
            inversionista.inversionista_id
          ),
          eq(pagos_credito_inversionistas.credito_id, inv.credito_id),
          eq(pagos_credito_inversionistas.estado_liquidacion, "LIQUIDADO")
        )
      );

    // Sumar todas las cuotas liquidadas de este crédito
    const suma_cuotas_liquidadas = pagosLiquidados.reduce(
      (sum, pago) => sum.plus(pago.cuota ?? 0),
      new Big(0)
    );

    // Calcular rendimiento de este crédito
    const rendimiento_credito = suma_cuotas_liquidadas.times(1.2);

    // Acumular rendimiento total
    rendimiento_total = rendimiento_total.plus(rendimiento_credito);
  }

  return {
    inversionista_id: inversionista.inversionista_id,
    nombre: inversionista.nombre,
    dpi: inversionista.dpi?.toString(),
    capital_total_aportado: Number(capital_total_aportado.toString()),
    cantidad_inversiones: inversiones.length,
    rendimiento_estimado: Number(rendimiento_total.toString()),
  };
}

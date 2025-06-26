import { db } from "../database/index";
import { creditos, pagos_credito, usuarios } from "../database/db/schema";
import { z } from "zod";
import Big from "big.js";
import { and, eq, sql } from "drizzle-orm";
import { findOrCreateUserByName } from "./users";
import { findOrCreateAdvisorByName } from "./advisor";
// Only input fields, no calculated fields here!
const creditSchema = z.object({
  usuario: z.string().max(1000),
  numero_credito_sifco: z.string().max(1000),
  capital: z.number().nonnegative(),
  porcentaje_interes: z.number().min(0).max(100),
  porcentaje_cash_in: z.number().min(0).max(100),
  seguro_10_cuotas: z.number().min(0),
  gps: z.number().min(0),
  inversionista_id: z.number().int().positive(),
  observaciones: z.string().max(1000),
  no_poliza: z.string().max(1000),
  como_se_entero: z.string().max(100),
  asesor: z.string().max(1000),
  plazo: z.number().int().min(1).max(360),
  porcentaje_participacion_inversionista: z.number().min(0).max(100),
  cuota: z.number().min(0),
  membresias_pago: z.number().min(0),
  formato_credito: z.string().max(1000),
  categoria: z.string().max(1000), // Optional field for category
  nit: z.string().max(1000),
  otros: z.number().min(0),
});
export interface CreditInsert {
  usuario_id: number;
  numero_credito_sifco: string;
  capital: string;
  porcentaje_interes: string;
  cuota_interes: string;
  iva_12: string;
  deudatotal: string;
  seguro_10_cuotas: string;
  gps: string;
  observaciones: string;
  no_poliza: string;
  como_se_entero: string;
  asesor_id: number;
  plazo: number;
  inversionista_id: number;
  porcentaje_participacion_inversionista: string;
  monto_asignado_inversionista: string;
  iva_inversionista: string;
  porcentaje_cash_in: string;
  cuota_cash_in: string;
  iva_cash_in: string;
  cuota: string;
  membresias_pago: string;
  membresias: string;
  formato_credito: string;
}

export const insertCredit = async ({ body, set }: { body: any; set: any }) => {
  try {
    // Step 1: Validate input with Zod
    const parseResult = creditSchema.safeParse(body);

    if (!parseResult.success) {
      set.status = 400;
      return {
        message: "Validation failed",
        errors: parseResult.error.flatten().fieldErrors,
      };
    }
    console.log("Parsed credit data:", parseResult.data);
    const creditData = parseResult.data;

    // Step 2: Calculate derived fields (using Big.js for precision)
    const capital = new Big(creditData.capital);
    const porcentaje_interes = new Big(creditData.porcentaje_interes ?? 0);
    const plazo = new Big(creditData.plazo ?? 1);
    const porcentaje_cash_in = new Big(creditData.porcentaje_cash_in ?? 0);

    // Calculate monthly payment ("cuota")
    const cuota_interes = capital
      .times(porcentaje_interes.div(100))
     .round(2);

    let cuota_cash_in: Big | undefined = undefined;
    let iva_cash_in: Big | undefined = undefined;

    const porcentaje_participacion =
      creditData.porcentaje_participacion_inversionista ?? 100.0;
    const monto_asignado = capital
      .times(porcentaje_participacion)
      .div(100)
      .round(2);
    // Calculate IVA (12% of monto_asignado)
    const iva_12 = cuota_interes.times(0.12).round(2);
    const iva_inversionista = monto_asignado.times(0.12).round(2);
    if (creditData.porcentaje_cash_in) {
      cuota_cash_in = cuota_interes.times(porcentaje_cash_in).div(100).round(2);
      iva_cash_in = cuota_cash_in.times(0.12).round(2);
    }
    // Calculate total debt

    const deudatotal = capital
      .plus(cuota_interes)
      .plus(iva_12)
      .plus(creditData.seguro_10_cuotas ?? 0)
      .plus(creditData.gps ?? 0)
      .plus(creditData.membresias_pago ?? 0)
      .plus(creditData.otros ?? 0)
      .round(2)
      .toString();
    const user = await findOrCreateUserByName(
      creditData.usuario,
      creditData.categoria,
      creditData.nit,
      creditData.como_se_entero
    );
    console.log("User found or created:", user);
    const advisor = await findOrCreateAdvisorByName(creditData.asesor, true);
    // Step 3: Prepare insert data (all stringified for Drizzle numerics)
    const creditDataForInsert: CreditInsert = {
      usuario_id: user.usuario_id,
      numero_credito_sifco: creditData.numero_credito_sifco, // <--- aquí
      capital: capital.toString(),
      porcentaje_interes: creditData.porcentaje_interes
        ? porcentaje_interes.toString()
        : "0",
      cuota: creditData.cuota ? creditData.cuota.toString() : "0",
      cuota_interes: cuota_interes.toString(),
      deudatotal: deudatotal.toString(),

      seguro_10_cuotas: creditData.seguro_10_cuotas
        ? creditData.seguro_10_cuotas.toString()
        : "0",
      gps: creditData.gps ? creditData.gps.toString() : "0",
      observaciones: creditData.observaciones ?? "0", // <--- aquí
      no_poliza: creditData.no_poliza ?? undefined, // <--- aquí
      como_se_entero: creditData.como_se_entero ?? " ", // <--- aquí
      asesor_id: advisor.asesor_id ?? 0, // <--- aquí
      plazo: creditData.plazo ? creditData.plazo : 0,

      iva_12: iva_12 ? iva_12.toString() : "0",

      inversionista_id: creditData.inversionista_id ?? null,
      porcentaje_participacion_inversionista:
        creditData.porcentaje_participacion_inversionista
          ? new Big(
              creditData.porcentaje_participacion_inversionista
            ).toString()
          : "0",
      monto_asignado_inversionista: monto_asignado.toString(),
      iva_inversionista: iva_inversionista.toString(),
      porcentaje_cash_in: porcentaje_cash_in.toString(),
      cuota_cash_in: cuota_cash_in ? cuota_cash_in.toString() : "0",
      iva_cash_in: iva_cash_in ? iva_cash_in.toString() : "0",
      membresias_pago: creditData.membresias_pago
        ? new Big(creditData.membresias_pago).toString()
        : "0",
      membresias: creditData.membresias_pago
        ? new Big(creditData.membresias_pago).toString()
        : "0",
      formato_credito: creditData.formato_credito ?? " ", //
    };
    console.log("Credit data for insert:", creditDataForInsert);
    // Step 4: Insert the credit record
    const [newCredit] = await db
      .insert(creditos)
      .values(creditDataForInsert)
      .returning();

    set.status = 201;
    return newCredit;
  } catch (error) {
    set.status = 500;
    return { message: "Error inserting credit", error: String(error) };
  }
};

// All fields optional except credito_id
export const creditUpdateSchema = z.object({
  credito_id: z.number().int().positive(),
  usuario_id: z.number().int().positive().optional(),
  numero_credito_sifco: z.number().optional(),
  capital: z.number().optional(),
  porcentaje_interes: z.number().optional(),
  deudaTotal: z.number().optional(),
  cuota: z.number().optional(),
  iva_12: z.number().optional(),
  seguro_10_cuotas: z.number().optional(),
  gps: z.number().optional(),
  observaciones: z.string().optional(),
  no_poliza: z.number().optional(),
  como_se_entero: z.string().optional(),
  asesor_id: z.number().optional(),
  plazo: z.number().optional(),
  capital_interes: z.number().optional(),
  inversionista_id: z.number().optional(),
  porcentaje_participacion_inversionista: z.number().optional(),
  monto_asignado_inversionista: z.number().optional(),
  iva_inversionista: z.number().optional(),
  porcentaje_cash_in: z.number().optional(),
  cuota_cash_in: z.number().optional(),
  iva_cash_in: z.number().optional(),
});

export const updateCredit = async ({
  body,
  set,
}: {
  body: unknown;
  set: any;
}) => {
  // 1. Validate input
  const parseResult = creditUpdateSchema.safeParse(body);
  if (!parseResult.success) {
    set.status = 400;
    return {
      message: "Validation failed",
      errors: parseResult.error.flatten().fieldErrors,
    };
  }
  const { credito_id, ...fieldsToUpdate } = parseResult.data;

  // 2. Fetch current credit data
  const [current] = await db
    .select()
    .from(creditos)
    .where(eq(creditos.credito_id, credito_id))
    .limit(1);

  if (!current) {
    set.status = 404;
    return { message: "Credit not found" };
  }

  // 3. Determine if recalculation is needed
  const willRecalculate =
    fieldsToUpdate.capital !== undefined ||
    fieldsToUpdate.porcentaje_interes !== undefined;

  let updateData = { ...current, ...fieldsToUpdate };

  // 4. Convert all numeric fields to string right after merging
  const numericFields = [
    "capital",
    "porcentaje_interes",
    "deudaTotal",
    "cuota",
    "iva_12",
    "seguro_10_cuotas",
    "gps",
    "monto_asignado_inversionista",
    "iva_inversionista",
    "porcentaje_cash_in",
    "cuota_cash_in",
    "iva_cash_in",
    "porcentaje_participacion_inversionista",
    "capital_interes",
  ];
  // 2. Castea temporalmente para hacer el update sin que TS moleste
  const tempData: Record<string, any> = { ...updateData };
  for (const field of numericFields) {
    if (
      tempData[field] !== undefined &&
      tempData[field] !== null &&
      typeof tempData[field] !== "string"
    ) {
      tempData[field] = tempData[field].toString();
    }
  }

  // 4. Only recalculate if capital or porcentaje_interes change
  if (willRecalculate) {
    // Always get latest for calculations
    const capital = new Big(
      fieldsToUpdate.capital !== undefined
        ? fieldsToUpdate.capital
        : current.capital
    );
    const porcentaje_interes = new Big(
      fieldsToUpdate.porcentaje_interes !== undefined
        ? fieldsToUpdate.porcentaje_interes
        : current.porcentaje_interes
    );
    const plazo = new Big(
      fieldsToUpdate.plazo !== undefined ? fieldsToUpdate.plazo : current.plazo
    );
    const porcentaje_cash_in = new Big(
      fieldsToUpdate.porcentaje_cash_in !== undefined
        ? fieldsToUpdate.porcentaje_cash_in
        : current.porcentaje_cash_in
    );
    const porcentaje_participacion = new Big(
      fieldsToUpdate.porcentaje_participacion_inversionista !== undefined
        ? fieldsToUpdate.porcentaje_participacion_inversionista
        : current.porcentaje_participacion_inversionista
    );

    // Calculated fields
    const cuota_interes = capital
      .times(porcentaje_interes.div(100).plus(1))
      .div(plazo)
      .round(2);
    const deudaTotal = cuota_interes.times(plazo).round(2);
    const cuota_cash_in = cuota_interes
      .times(porcentaje_cash_in)
      .div(100)
      .round(2);
    const iva_cash_in = cuota_cash_in.times(0.12).round(2);
    const iva_12 = cuota_interes.times(0.12).round(2);
    const monto_asignado = capital
      .times(porcentaje_participacion)
      .div(100)
      .round(2);
    const iva_inversionista = monto_asignado.times(0.12).round(2);

    // Assign calculated fields as strings for Drizzle numeric compatibility
    updateData = {
      ...updateData,
      cuota: cuota_interes.toString(),
      deudaTotal: Number(deudaTotal),
      iva_12: iva_12.toString(),
      cuota_cash_in: cuota_cash_in.toString(),
      iva_cash_in: iva_cash_in.toString(),
      monto_asignado_inversionista: monto_asignado.toString(),
      iva_inversionista: iva_inversionista.toString(),
      capital: capital.toString(),
    };
  }

  delete tempData.credito_id;
  // 6. Execute the update
  const [updatedCredit] = await db
    .update(creditos)
    .set(tempData)
    .where(eq(creditos.credito_id, credito_id))
    .returning();

  set.status = 200;
  return updatedCredit;
};

const fraccionSchema = z
  .object({
    credito_id: z.number().int().positive().optional(),
    inversionista_id: z.number().int().positive(),
    porcentaje_participacion_inversionista: z.number().min(0).max(100),
    porcentaje_cashin: z.number().min(0).max(100),
    capital: z.number().positive(),
    plazo: z.number().int().min(1),
    cuota: z.number().min(0),
  })
  .refine(
    (data) =>
      data.porcentaje_participacion_inversionista + data.porcentaje_cashin ===
      100,
    {
      message:
        "La suma de porcentaje_participacion_inversionista y porcentaje_cashin en cada fracción debe ser 100",
    }
  );

const dividirCreditoSchema = z.object({
  parent_credito_id: z.number().int().positive(),
  fracciones: z.array(fraccionSchema).min(1),
});

// --- Servicio ---
 


export const getCreditoByNumero = async (numero_credito_sifco: string) => {
  try {
    // Busca el crédito por número
    const credito = await db
      .select()
      .from(creditos)
      .where(eq(creditos.numero_credito_sifco, numero_credito_sifco))
        .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
      .limit(1);

    if (credito.length === 0) {
      return { message: "Crédito no encontrado" };
    }
    return credito[0];
  } catch (error) {
    console.error("[getCreditoByNumero] Error:", error);
    return { message: "Error consultando crédito", error: String(error) };
  }
};

/**
 * Fetches paginated credits, with their user and payments for a specific month and year, in a single query.
 * @param mes Month number (1-12).
 * @param anio Year (e.g., 2025).
 * @param page Page number (starts at 1).
 * @param perPage Records per page.
 * @returns Paginated credits, each with user and matching payments.
 */
export async function getCreditosWithUserByMesAnio(
  mes: number,
  anio: number,
  page: number = 1,
  perPage: number = 10
) {
  const offset = (page - 1) * perPage;

  // Select credits and join with users, filter by month and year of credit creation
  const rows = await db
    .select({
      creditos, // returns all columns from creditos
      usuarios, // returns all columns from usuarios
    })
    .from(creditos)
    .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
    .where(
      and(
        sql`EXTRACT(MONTH FROM ${creditos.fecha_creacion}) = ${mes}`,
        sql`EXTRACT(YEAR FROM ${creditos.fecha_creacion}) = ${anio}`
      )
    )
    .limit(perPage)
    .offset(offset);

  // Get total count for pagination
  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(creditos)
    .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
    .where(
      and(
        sql`EXTRACT(MONTH FROM ${creditos.fecha_creacion}) = ${mes}`,
        sql`EXTRACT(YEAR FROM ${creditos.fecha_creacion}) = ${anio}`
      )
    );

  return {
    data: rows,
    page,
    perPage,
    totalCount: Number(count),
    totalPages: Math.ceil(Number(count) / perPage),
  };
}
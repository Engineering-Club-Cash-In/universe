import { ORPCError } from "@orpc/server";
import {
	and,
	asc,
	desc,
	eq,
	getTableColumns,
	ilike,
	ne,
	or,
} from "drizzle-orm";
import { z } from "zod";
import { getOnlyRenapInfoController } from "../controllers/bot";
import { db } from "../db";
import { companies } from "../db/schema/crm";
import { partnerMembers } from "../db/schema/partners";
import { renapInfo } from "../db/schema/renap";
import {
	type NewVehicleVendor,
	vehicles,
	vehicleVendors,
} from "../db/schema/vehicles";
import {
	errorDeCambioDeVendedor,
	erroresDeVendedor,
	normalizarDatosVendedor,
	TIPO_VENDEDOR_AGENCIA,
	usosDelVendedor,
	VENDOR_TYPES,
} from "../lib/agency-sellers";
import {
	buildRenapFullName,
	renapGenderToVendorGender,
} from "../lib/contract-parties";
import { eqDpi } from "../lib/dpi-lookup";
import { crmProcedure } from "../lib/orpc";
import { normalizarDpi, validarDpi } from "../utils/cui-validation";

const vendorDataSchema = z
	.object({
		name: z.string().min(1, "El nombre es requerido"),
		phone: z.string().optional(),
		dpi: z.string().nullable().optional(),
		vendorType: z.enum(VENDOR_TYPES, {
			message: "Tipo de vendedor requerido",
		}),
		gender: z.enum(["male", "female"]).nullable().optional(),
		companyName: z.string().optional(),
		companyId: z.string().uuid().nullable().optional(),
		email: z.string().email().optional().or(z.literal("")),
		address: z.string().optional(),
	})
	.superRefine((data, ctx) => {
		for (const error of erroresDeVendedor(data)) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: [error.path],
				message: error.message,
			});
		}
	});

async function mensajeDpiDuplicado(dpi: string, excluirId?: string) {
	const [vendor] = await db
		.select()
		.from(vehicleVendors)
		.where(
			excluirId
				? and(eq(vehicleVendors.dpi, dpi), ne(vehicleVendors.id, excluirId))
				: eq(vehicleVendors.dpi, dpi),
		)
		.limit(1);

	if (!vendor) return null;
	const detalle =
		vendor.vendorType === "empresa"
			? vendor.companyName || "Empresa"
			: vendor.vendorType === TIPO_VENDEDOR_AGENCIA
				? "Vendedor de agencia"
				: "Individual";
	return `Ya existe un vendedor con el DPI ${dpi}: ${vendor.name} (${detalle})`;
}

async function validarAgencia(companyId: string | null) {
	if (!companyId) return;
	const [empresa] = await db
		.select({ id: companies.id })
		.from(companies)
		.where(eq(companies.id, companyId))
		.limit(1);
	if (!empresa) {
		throw new ORPCError("BAD_REQUEST", {
			message: "La agencia seleccionada no existe",
		});
	}
}

export const vendorsRouter = {
	// Get all vendors
	getAll: crmProcedure.handler(async () => {
		const vendors = await db
			.select({
				...getTableColumns(vehicleVendors),
				agenciaNombre: companies.name,
			})
			.from(vehicleVendors)
			.leftJoin(companies, eq(companies.id, vehicleVendors.companyId))
			.orderBy(desc(vehicleVendors.createdAt));

		return vendors;
	}),

	// Vendedores de una agencia/predio, para asignarlos a una oportunidad o a
	// un usuario del tracker.
	getAgencySellers: crmProcedure
		.input(z.object({ companyId: z.string().uuid() }))
		.handler(async ({ input }) => {
			return db
				.select({
					id: vehicleVendors.id,
					name: vehicleVendors.name,
					email: vehicleVendors.email,
					phone: vehicleVendors.phone,
					companyId: vehicleVendors.companyId,
				})
				.from(vehicleVendors)
				.where(
					and(
						eq(vehicleVendors.vendorType, TIPO_VENDEDOR_AGENCIA),
						eq(vehicleVendors.companyId, input.companyId),
					),
				)
				.orderBy(asc(vehicleVendors.name));
		}),

	// Get vendor by ID
	getById: crmProcedure
		.input(z.object({ id: z.string() }))
		.handler(async ({ input }) => {
			const [vendor] = await db
				.select()
				.from(vehicleVendors)
				.where(eq(vehicleVendors.id, input.id))
				.limit(1);

			if (!vendor) {
				throw new ORPCError("NOT_FOUND", {
					message: "Vendedor no encontrado",
				});
			}

			return vendor;
		}),

	// Create new vendor
	create: crmProcedure
		.input(vendorDataSchema)
		.handler(async ({ input }) => {
			const datos = normalizarDatosVendedor(input);

			if (datos.dpi) {
				const duplicado = await mensajeDpiDuplicado(datos.dpi);
				if (duplicado) throw new ORPCError("CONFLICT", { message: duplicado });
			}
			await validarAgencia(datos.companyId);

			const [newVendor] = await db
				.insert(vehicleVendors)
				.values({
					...datos,
					phone: datos.phone || null,
					email: datos.email || null,
				} as NewVehicleVendor)
				.returning();

			return newVendor;
		}),

	// Update vendor
	update: crmProcedure
		.input(
			z.object({
				id: z.string(),
				data: vendorDataSchema,
			}),
		)
		.handler(async ({ input }) => {
			const datos = normalizarDatosVendedor(input.data);

			if (datos.dpi) {
				const duplicado = await mensajeDpiDuplicado(datos.dpi, input.id);
				if (duplicado) throw new ORPCError("CONFLICT", { message: duplicado });
			}
			await validarAgencia(datos.companyId);

			return db.transaction(async (tx) => {
				// FOR UPDATE antes de revisar usos: quien asigna este vendedor lo
				// toma FOR SHARE en su propia transacción, así que un cambio de tipo
				// o de agencia no puede cruzarse con esa asignación.
				const [actual] = await tx
					.select({
						vendorType: vehicleVendors.vendorType,
						companyId: vehicleVendors.companyId,
					})
					.from(vehicleVendors)
					.where(eq(vehicleVendors.id, input.id))
					.for("update")
					.limit(1);

				if (!actual) {
					throw new ORPCError("NOT_FOUND", {
						message: "Vendedor no encontrado",
					});
				}

				const cambiaAlcance =
					actual.vendorType !== datos.vendorType ||
					(actual.companyId ?? null) !== datos.companyId;
				if (cambiaAlcance) {
					const error = errorDeCambioDeVendedor(
						{
							vendorType: actual.vendorType,
							companyId: actual.companyId ?? null,
						},
						{ vendorType: datos.vendorType, companyId: datos.companyId },
						await usosDelVendedor(tx, input.id),
					);
					if (error) throw new ORPCError("CONFLICT", { message: error });
				}

				const [updated] = await tx
					.update(vehicleVendors)
					.set({
						...datos,
						phone: datos.phone || null,
						email: datos.email || null,
						updatedAt: new Date(),
					})
					.where(eq(vehicleVendors.id, input.id))
					.returning();

				return updated;
			});
		}),

	// Delete vendor
	delete: crmProcedure
		.input(z.object({ id: z.string() }))
		.handler(async ({ input }) => {
			const [conCuenta] = await db
				.select({ id: partnerMembers.id })
				.from(partnerMembers)
				.where(eq(partnerMembers.sellerId, input.id))
				.limit(1);
			if (conCuenta) {
				throw new ORPCError("CONFLICT", {
					message:
						"Este vendedor tiene usuarios del tracker asignados. Quítaselos en Admin > Usuarios antes de eliminarlo",
				});
			}

			const [deleted] = await db
				.delete(vehicleVendors)
				.where(eq(vehicleVendors.id, input.id))
				.returning();

			return deleted;
		}),

	// Get vendor by vehicleId
	getByVehicleId: crmProcedure
		.input(z.object({ vehicleId: z.string().uuid() }))
		.handler(async ({ input }) => {
			// First get the vehicle to find the vendorId
			const [vehicle] = await db
				.select()
				.from(vehicles)
				.where(eq(vehicles.id, input.vehicleId))
				.limit(1);

			if (!vehicle || !vehicle.vendorId) {
				return null;
			}

			// Then get the vendor
			const [vendor] = await db
				.select()
				.from(vehicleVendors)
				.where(eq(vehicleVendors.id, vehicle.vendorId))
				.limit(1);

			return vendor || null;
		}),

	// Search vendors
	search: crmProcedure
		.input(
			z.object({
				query: z.string().optional(),
				vendorType: z.string().optional(),
			}),
		)
		.handler(async ({ input }) => {
			const conditions = [];

			if (input.query) {
				conditions.push(
					or(
						ilike(vehicleVendors.name, `%${input.query}%`),
						ilike(vehicleVendors.dpi, `%${input.query}%`),
						ilike(vehicleVendors.phone, `%${input.query}%`),
						ilike(vehicleVendors.companyName, `%${input.query}%`),
					),
				);
			}

			// Sin tipo explícito es la búsqueda del vendedor legal: un vendedor
			// de agencia no debe aparecer ahí.
			conditions.push(
				input.vendorType
					? eq(vehicleVendors.vendorType, input.vendorType)
					: ne(vehicleVendors.vendorType, TIPO_VENDEDOR_AGENCIA),
			);

			const result = await db
				.select()
				.from(vehicleVendors)
				.where(and(...conditions))
				.orderBy(desc(vehicleVendors.createdAt));

			return result;
		}),

	/**
	 * Datos del dueño del vehículo a partir del DPI, para autollenar al crear o
	 * asignar un vendedor. Primero el vendedor ya registrado, luego la copia
	 * local de RENAP y solo al final se consulta RENAP (cuesta). No guarda el
	 * vendedor.
	 */
	lookupByDpi: crmProcedure
		.input(z.object({ dpi: z.string() }))
		.handler(async ({ input }) => {
			const resultadoDpi = validarDpi(input.dpi);
			// Un DPI que no pasa el dígito verificador se busca igual: si ya hay
			// un vendedor registrado con él (registros viejos guardados validando
			// solo el largo), hay que poder completarle el género con "Completar
			// con RENAP". Solo se rechaza si no existe.
			const dpi = resultadoDpi.valid
				? resultadoDpi.dpiLimpio
				: normalizarDpi(input.dpi);

			const [vendor] = await db
				.select()
				.from(vehicleVendors)
				.where(
					and(
						eqDpi(vehicleVendors.dpi, dpi),
						ne(vehicleVendors.vendorType, TIPO_VENDEDOR_AGENCIA),
					),
				)
				.limit(1);

			if (!resultadoDpi.valid) {
				if (!vendor) {
					throw new ORPCError("BAD_REQUEST", { message: resultadoDpi.error });
				}
				// RENAP no resuelve un DPI inválido: se devuelve lo registrado
				return {
					fuente: "vendedor" as const,
					vendorId: vendor.id,
					dpi,
					nombre: vendor.name,
					genero: (vendor.gender as "male" | "female" | null) ?? null,
				};
			}

			if (vendor?.gender) {
				return {
					fuente: "vendedor" as const,
					vendorId: vendor.id,
					dpi,
					nombre: vendor.name,
					genero: vendor.gender as "male" | "female",
				};
			}

			const leerRenapLocal = async () => {
				const [persona] = await db
					.select()
					.from(renapInfo)
					.where(eqDpi(renapInfo.dpi, dpi))
					.limit(1);
				return persona;
			};

			let persona = await leerRenapLocal();
			if (!persona) {
				const renap = await getOnlyRenapInfoController(dpi);
				if (renap.success) persona = await leerRenapLocal();
			}

			if (!persona) {
				// Sin RENAP se devuelve lo que haya para que lo completen a mano.
				return {
					fuente: vendor ? ("vendedor" as const) : null,
					vendorId: vendor?.id ?? null,
					dpi,
					nombre: vendor?.name ?? null,
					genero: null,
				};
			}

			return {
				fuente: "renap" as const,
				vendorId: vendor?.id ?? null,
				dpi,
				// El nombre legal de RENAP manda sobre el que se escribió a mano.
				nombre: buildRenapFullName(persona),
				genero: renapGenderToVendorGender(persona.gender),
			};
		}),
};

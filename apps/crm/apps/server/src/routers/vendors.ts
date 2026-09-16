import { ORPCError } from "@orpc/server";
import { and, desc, eq, ilike, ne, or } from "drizzle-orm";
import { z } from "zod";
import { getOnlyRenapInfoController } from "../controllers/bot";
import { db } from "../db";
import { renapInfo } from "../db/schema/renap";
import {
	type NewVehicleVendor,
	vehicles,
	vehicleVendors,
} from "../db/schema/vehicles";
import {
	buildRenapFullName,
	renapGenderToVendorGender,
} from "../lib/contract-parties";
import { eqDpi } from "../lib/dpi-lookup";
import { crmProcedure } from "../lib/orpc";
import { validarDpi } from "../utils/cui-validation";

export const vendorsRouter = {
	// Get all vendors
	getAll: crmProcedure.handler(async () => {
		const vendors = await db
			.select()
			.from(vehicleVendors)
			.orderBy(desc(vehicleVendors.createdAt));

		return vendors;
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
		.input(
			z.object({
				name: z.string().min(1, "El nombre es requerido"),
				phone: z.string().optional(),
				dpi: z
					.string()
					.min(13, "DPI debe tener 13 dígitos")
					.max(13, "DPI debe tener 13 dígitos"),
				vendorType: z.enum(["individual", "empresa"], {
					message: "Tipo de vendedor requerido",
				}),
				gender: z.enum(["male", "female"]).nullable().optional(),
				companyName: z.string().optional(),
				email: z.string().email().optional().or(z.literal("")),
				address: z.string().optional(),
			}),
		)
		.handler(async ({ input }) => {
			// Check if DPI already exists
			const existingVendor = await db
				.select()
				.from(vehicleVendors)
				.where(eq(vehicleVendors.dpi, input.dpi))
				.limit(1);

			if (existingVendor.length > 0) {
				const vendor = existingVendor[0];
				throw new ORPCError("CONFLICT", {
					message: `Ya existe un vendedor con el DPI ${input.dpi}: ${vendor.name} (${vendor.vendorType === "empresa" ? vendor.companyName || "Empresa" : "Individual"})`,
				});
			}

			const [newVendor] = await db
				.insert(vehicleVendors)
				.values({
					...input,
					phone: input.phone || null,
					email: input.email || null,
				} as NewVehicleVendor)
				.returning();

			return newVendor;
		}),

	// Update vendor
	update: crmProcedure
		.input(
			z.object({
				id: z.string(),
				data: z.object({
					name: z.string().min(1, "El nombre es requerido"),
					phone: z.string().optional(),
					dpi: z
						.string()
						.min(13, "DPI debe tener 13 dígitos")
						.max(13, "DPI debe tener 13 dígitos"),
					vendorType: z.enum(["individual", "empresa"]),
					gender: z.enum(["male", "female"]).nullable().optional(),
					companyName: z.string().optional(),
					email: z.string().email().optional().or(z.literal("")),
					address: z.string().optional(),
				}),
			}),
		)
		.handler(async ({ input }) => {
			// Check if DPI exists for another vendor (not the current one being updated)
			const existingVendor = await db
				.select()
				.from(vehicleVendors)
				.where(
					and(
						eq(vehicleVendors.dpi, input.data.dpi),
						ne(vehicleVendors.id, input.id), // Different vendor ID
					),
				)
				.limit(1);

			if (existingVendor.length > 0) {
				const vendor = existingVendor[0];
				throw new ORPCError("CONFLICT", {
					message: `Ya existe un vendedor con el DPI ${input.data.dpi}: ${vendor.name} (${vendor.vendorType === "empresa" ? vendor.companyName || "Empresa" : "Individual"})`,
				});
			}

			const [updated] = await db
				.update(vehicleVendors)
				.set({
					...input.data,
					phone: input.data.phone || null,
					email: input.data.email || null,
					updatedAt: new Date(),
				})
				.where(eq(vehicleVendors.id, input.id))
				.returning();

			return updated;
		}),

	// Delete vendor
	delete: crmProcedure
		.input(z.object({ id: z.string() }))
		.handler(async ({ input }) => {
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

			if (input.vendorType) {
				conditions.push(eq(vehicleVendors.vendorType, input.vendorType));
			}

			const result = await db
				.select()
				.from(vehicleVendors)
				.where(conditions.length > 0 ? and(...conditions) : undefined)
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
			if (!resultadoDpi.valid) {
				throw new ORPCError("BAD_REQUEST", { message: resultadoDpi.error });
			}
			const dpi = resultadoDpi.dpiLimpio;

			const [vendor] = await db
				.select()
				.from(vehicleVendors)
				.where(eqDpi(vehicleVendors.dpi, dpi))
				.limit(1);

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

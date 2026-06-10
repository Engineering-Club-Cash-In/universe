import { openai } from "@ai-sdk/openai";
import { ORPCError } from "@orpc/server";
import { generateObject, generateText } from "ai";
import { and, desc, eq, ilike, inArray, not, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
	casosCobros,
	checklistItemEvidence,
	contratosFinanciamiento,
	conveniosPago,
	INSPECTION_360_STATUSES,
	inspectionChecklistItems,
	type NewChecklistItemEvidence,
	type NewInspectionChecklistItem,
	type NewVehicle,
	type NewVehicleInspection,
	type NewVehicleInspection360Item,
	type NewVehiclePhoto,
	vehicleDocuments,
	vehicleInspection360Items,
	vehicleInspections,
	vehiclePhotos,
	vehicles,
} from "../db/schema";
import { isUniqueViolation } from "../lib/db-errors";
import {
	mapOCRToVehicleForm,
	vehicleRegistrationOCRSchema,
} from "../lib/ocr-schema";
import {
	crmProcedure,
	protectedProcedure,
	publicProcedure,
	tallerOrCrmProcedure,
} from "../lib/orpc";
import { ROLES } from "../lib/roles";
import {
	buildUploadPrefix,
	deleteFileFromR2,
	getFileUrl,
	verifyUploadedDocumentInR2,
} from "../lib/storage";
import {
	prepareValuationContext,
	vehicleValuationSchema,
} from "../lib/valuation-schema";
import {
	buildManualValuationData,
	MANUAL_VALUATION_RESULT,
	MANUAL_VALUATION_TECHNICIAN_NAME,
} from "../lib/manual-valuation";
import { canAccessSalesTeamActions } from "../lib/sales-permissions";

// Configuration Constants for Evidence Uploads
const MAX_EVIDENCE_FILES_PER_ITEM = 10;
const MAX_FILE_SIZE_MB = 50; // Reference for frontend/upload API
const ALLOWED_MIME_TYPES = [
	"image/jpeg",
	"image/jpg",
	"image/png",
	"video/mp4",
	"video/quicktime",
];
const MANUAL_VALUATION_COMMA_DECIMAL_PATTERN = /^\d+,\d+$/;
const MANUAL_VALUATION_THOUSANDS_PATTERN = /^\d{1,3}(,\d{3})+(\.\d+)?$/;
const MANUAL_VALUATION_PLAIN_NUMBER_PATTERN = /^\d+(\.\d+)?$/;

const normalizeManualValuationAmount = (
	value: string,
	fieldLabel: string,
): string => {
	const sanitized = value.replace(/[Qq\s]/g, "");

	if (!sanitized) {
		throw new ORPCError("BAD_REQUEST", {
			message: `${fieldLabel} debe ser un número válido`,
		});
	}

	if (MANUAL_VALUATION_THOUSANDS_PATTERN.test(sanitized)) {
		return sanitized.replace(/,/g, "");
	}

	if (MANUAL_VALUATION_COMMA_DECIMAL_PATTERN.test(sanitized)) {
		throw new ORPCError("BAD_REQUEST", {
			message: `${fieldLabel} debe usar punto para decimales`,
		});
	}

	if (!MANUAL_VALUATION_PLAIN_NUMBER_PATTERN.test(sanitized)) {
		throw new ORPCError("BAD_REQUEST", {
			message: `${fieldLabel} debe ser un número válido`,
		});
	}

	return sanitized;
};

export const vehiclesRouter = {
	// Get all vehicles with their latest inspection and photos
	getAll: publicProcedure
		.input(
			z
				.object({
					limit: z.number().optional().default(10),
					offset: z.number().optional().default(0),
					query: z.string().optional(),
					status: z.string().optional(),
					category: z.string().optional(),
					// Excluir vehículos con cierto status
					excludeStatus: z
						.enum(["pending", "available", "sold", "maintenance", "auction"])
						.optional(),
					// Filtro de propiedad: "owned" = solo Cash In, "not_owned" = solo externos, undefined = todos
					ownership: z.enum(["owned", "not_owned"]).optional(),
				})
				.optional(),
		)
		.handler(async ({ input }) => {
			const limit = input?.limit ?? 10;
			const offset = input?.offset ?? 0;
			const query = input?.query;
			const status = input?.status;
			const category = input?.category;
			const excludeStatus = input?.excludeStatus;
			const ownership = input?.ownership;

			// Build conditions
			const conditions = [];
			const isInspectionStatus = status === "approved" || status === "rejected";

			if (query) {
				conditions.push(
					or(
						ilike(vehicles.make, `%${query}%`),
						ilike(vehicles.model, `%${query}%`),
						ilike(vehicles.licensePlate, `%${query}%`),
						ilike(vehicles.vinNumber, `%${query}%`),
					),
				);
			}

			if (status && status !== "all") {
				if (isInspectionStatus) {
					conditions.push(eq(vehicleInspections.status, status as any));
				} else {
					// Fallback to vehicle status for: pending, available, sold, maintenance, auction
					conditions.push(eq(vehicles.status, status as any));
				}
			}

			// Excluir vehículos con cierto status
			if (excludeStatus) {
				conditions.push(not(eq(vehicles.status, excludeStatus as any)));
			}

			// Filtro de propiedad
			if (ownership === "owned") {
				conditions.push(eq(vehicles.isOwned, true));
			} else if (ownership === "not_owned") {
				conditions.push(eq(vehicles.isOwned, false));
			}

			// Category filters
			if (category === "commercial") {
				conditions.push(eq(vehicleInspections.vehicleRating, "Comercial"));
			} else if (category === "non-commercial") {
				conditions.push(eq(vehicleInspections.vehicleRating, "No comercial"));
			} else if (category === "alerts") {
				conditions.push(
					sql`json_array_length(${vehicleInspections.alerts}) > 0`,
				);
			}

			// 1. Get total count and paginated IDs
			// We need to join if we are filtering by inspection properties or status
			const needsJoin =
				category === "commercial" ||
				category === "non-commercial" ||
				category === "alerts" ||
				isInspectionStatus;

			// Always LEFT JOIN for ordering by latest inspection date
			const idsQueryBase = db
				.select({ id: vehicles.id, createdAt: vehicles.createdAt })
				.from(vehicles)
				.leftJoin(vehicleInspections, eq(vehicles.id, vehicleInspections.vehicleId))
				.groupBy(vehicles.id, vehicles.createdAt);

			const countQueryBase = db
				.select({ count: sql<number>`count(distinct ${vehicles.id})` })
				.from(vehicles);

			// idsQuery always has the leftJoin; countQuery only joins when needed for filters
			const idsQuery = idsQueryBase;

			const countQuery = needsJoin
				? countQueryBase.innerJoin(
						vehicleInspections,
						eq(vehicles.id, vehicleInspections.vehicleId),
					)
				: countQueryBase;

			const whereClause =
				conditions.length > 0 ? and(...conditions) : undefined;

			const [totalResult] = await countQuery.where(whereClause);
			const total = Number(totalResult?.count || 0);

			const paginatedIds = await idsQuery
				.where(whereClause)
				.orderBy(
				sql`CASE WHEN MAX(${vehicleInspections.inspectionDate}) IS NULL THEN 1 ELSE 0 END ASC`,
				sql`COALESCE(MAX(${vehicleInspections.inspectionDate}), ${vehicles.createdAt}) DESC`,
			)
				.limit(limit)
				.offset(offset);

			const vehicleIdsArray = paginatedIds.map((r) => r.id);

			if (vehicleIdsArray.length === 0) {
				return {
					data: [],
					total,
					limit,
					offset,
				};
			}

			// 2. Fetch full data for these IDs
			const result = await db
				.select()
				.from(vehicles)
				.leftJoin(
					vehicleInspections,
					eq(vehicles.id, vehicleInspections.vehicleId),
				)
				.where(or(...vehicleIdsArray.map((id) => eq(vehicles.id, id))))
				.orderBy(desc(vehicleInspections.inspectionDate), desc(vehicles.createdAt));

			// Get photos only for these vehicles
			const allPhotos = await db
				.select()
				.from(vehiclePhotos)
				.where(
					or(...vehicleIdsArray.map((id) => eq(vehiclePhotos.vehicleId, id))),
				)
				.orderBy(vehiclePhotos.category, vehiclePhotos.photoType);

			// Group photos by vehicle ID
			const photosByVehicle = new Map();
			allPhotos.forEach((photo) => {
				if (!photosByVehicle.has(photo.vehicleId)) {
					photosByVehicle.set(photo.vehicleId, []);
				}
				photosByVehicle.get(photo.vehicleId).push(photo);
			});

			// Group vehicles with their inspections and photos
			const vehiclesMap = new Map();

			// Initialize map with the order of IDs to preserve sort order
			vehicleIdsArray.forEach((_id) => {
				// We'll populate this as we process results
				// But wait, result might have multiple rows per vehicle.
				// We need to ensure we return them in the correct order.
			});

			result.forEach((row) => {
				const vehicleId = row.vehicles.id;

				if (!vehiclesMap.has(vehicleId)) {
					vehiclesMap.set(vehicleId, {
						...row.vehicles,
						inspections: [],
						photos: photosByVehicle.get(vehicleId) || [],
					});
				}

				if (row.vehicle_inspections) {
					vehiclesMap.get(vehicleId).inspections.push(row.vehicle_inspections);
				}
			});

			// Get payment agreements for vehicles
			const vehicleConvenios =
				vehicleIdsArray.length > 0
					? await db
							.select({
								vehicleId: contratosFinanciamiento.vehicleId,
								hasActiveConvenio: conveniosPago.activo,
							})
							.from(contratosFinanciamiento)
							.leftJoin(
								casosCobros,
								eq(contratosFinanciamiento.id, casosCobros.contratoId),
							)
							.leftJoin(
								conveniosPago,
								eq(casosCobros.id, conveniosPago.casoCobroId),
							)
							.where(
								and(
									or(
										...vehicleIdsArray.map((id) =>
											eq(contratosFinanciamiento.vehicleId, id),
										),
									),
									eq(conveniosPago.activo, true),
								),
							)
					: [];

			// Add convenio info to vehicles and sort by the original paginated order
			const vehiclesWithConvenios = vehicleIdsArray
				.map((id) => vehiclesMap.get(id))
				.filter(Boolean) // Should be all, but just in case
				.map((vehicle) => ({
					...vehicle,
					hasPaymentAgreement: vehicleConvenios.some(
						(c) => c.vehicleId === vehicle.id && c.hasActiveConvenio,
					),
				}));

			return {
				data: vehiclesWithConvenios,
				total,
				limit,
				offset,
			};
		}),

	// Get vehicle by ID with all related data
	getById: tallerOrCrmProcedure
		.input(z.object({ id: z.string() }))
		.handler(async ({ input }) => {
			const [vehicle] = await db
				.select()
				.from(vehicles)
				.where(eq(vehicles.id, input.id))
				.limit(1);

			if (!vehicle) {
				throw new ORPCError("NOT_FOUND", { message: "Vehículo no encontrado" });
			}

			const inspections = await db
				.select()
				.from(vehicleInspections)
				.where(eq(vehicleInspections.vehicleId, input.id))
				.orderBy(desc(vehicleInspections.createdAt));

			// Get checklist items and 360 items for each inspection
			const inspectionsWithChecklist = await Promise.all(
				inspections.map(async (inspection) => {
					const checklistItems = await db
						.select()
						.from(inspectionChecklistItems)
						.where(eq(inspectionChecklistItems.inspectionId, inspection.id))
						.orderBy(inspectionChecklistItems.category);

					let evidenceData: (typeof checklistItemEvidence.$inferSelect)[] = [];
					if (checklistItems.length > 0) {
						evidenceData = await db
							.select()
							.from(checklistItemEvidence)
							.where(
								inArray(
									checklistItemEvidence.itemId,
									checklistItems.map((i) => i.id),
								),
							);
					}

					const itemsWithEvidence = checklistItems.map((item) => ({
						...item,
						evidence: evidenceData.filter((ev) => ev.itemId === item.id),
					}));

					const inspection360ItemsData = await db
						.select()
						.from(vehicleInspection360Items)
						.where(eq(vehicleInspection360Items.inspectionId, inspection.id))
						.orderBy(vehicleInspection360Items.area);

					return {
						...inspection,
						checklistItems: itemsWithEvidence,
						inspection360Items: inspection360ItemsData,
					};
				}),
			);

			const photos = await db
				.select()
				.from(vehiclePhotos)
				.where(eq(vehiclePhotos.vehicleId, input.id))
				.orderBy(vehiclePhotos.category, vehiclePhotos.photoType);

			return {
				...vehicle,
				inspections: inspectionsWithChecklist,
				photos,
			};
		}),

	// Create new vehicle (used vehicles - all fields required)
	create: protectedProcedure
		.input(
			z.object({
				make: z.string(),
				model: z.string(),
				year: z.number(),
				licensePlate: z.string(),
				vinNumber: z.string(),
				motorNumber: z.string().optional(),
				color: z.string(),
				vehicleType: z.string(),
				milesMileage: z.number().nullable().optional(),
				kmMileage: z.number(),
				origin: z.string(),
				cylinders: z.string(),
				engineCC: z.string(),
				fuelType: z.string(),
				transmission: z.string(),
				companyId: z.string().nullable().optional(),
				status: z.string().optional().default("pending"),
				isNew: z.boolean().optional().default(false),
				isOwned: z.boolean().optional().default(false),
				// Campos para contratos legales
				seats: z.number().nullable().optional(),
				doors: z.number().nullable().optional(),
				axles: z.number().nullable().optional().default(2),
				vehicleUse: z.string().nullable().optional(),
				series: z.string().nullable().optional(),
				iscvCode: z.string().nullable().optional(),
			}),
		)
		.handler(async ({ input }) => {
			try {
				const [newVehicle] = await db
					.insert(vehicles)
					.values(input as NewVehicle)
					.returning();

				return newVehicle;
			} catch (error: unknown) {
				if (isUniqueViolation(error, "vehicles_license_plate_unique")) {
					throw new ORPCError("BAD_REQUEST", {
						message: `Ya existe un vehículo con la placa "${input.licensePlate}"`,
					});
				}
				if (isUniqueViolation(error, "vehicles_vin_number_unique")) {
					throw new ORPCError("BAD_REQUEST", {
						message: `Ya existe un vehículo con el número de chasis/VIN "${input.vinNumber}"`,
					});
				}
				throw error;
			}
		}),

	// Create new vehicle (for brand new vehicles from dealer - minimal required fields)
	createNewVehicle: protectedProcedure
		.input(
			z.object({
				// Campos básicos requeridos (conocidos desde proforma)
				make: z.string(),
				model: z.string(),
				year: z.number(),
				color: z.string(),
				vehicleType: z.string(),
				// Campos opcionales (llegan después del dealer)
				licensePlate: z.string().optional(),
				vinNumber: z.string().optional(),
				motorNumber: z.string().optional(),
				milesMileage: z.number().nullable().optional(),
				kmMileage: z.number().optional().default(0),
				origin: z.string().optional(),
				cylinders: z.string().optional(),
				engineCC: z.string().optional(),
				fuelType: z.string().optional(),
				transmission: z.string().optional(),
				companyId: z.string().nullable().optional(),
				status: z.string().optional().default("pending"),
				isOwned: z.boolean().optional().default(false),
				// Campos para contratos legales
				seats: z.number().nullable().optional(),
				doors: z.number().nullable().optional(),
				axles: z.number().nullable().optional().default(2),
				vehicleUse: z.string().nullable().optional(),
				series: z.string().nullable().optional(),
				iscvCode: z.string().nullable().optional(),
			}),
		)
		.handler(async ({ input }) => {
			try {
				const [newVehicle] = await db
					.insert(vehicles)
					.values({
						...input,
						isNew: true, // Siempre es vehículo nuevo
						kmMileage: input.kmMileage ?? 0, // Default 0 para nuevos
					} as NewVehicle)
					.returning();

				return newVehicle;
			} catch (error: unknown) {
				if (isUniqueViolation(error, "vehicles_license_plate_unique")) {
					throw new ORPCError("BAD_REQUEST", {
						message: `Ya existe un vehículo con la placa "${input.licensePlate}"`,
					});
				}
				throw error;
			}
		}),

	// Update vehicle
	update: tallerOrCrmProcedure
		.input(
			z.object({
				id: z.string(),
				data: z.object({
					make: z.string().optional(),
					model: z.string().optional(),
					year: z.number().optional(),
					licensePlate: z.string().nullable().optional(),
					vinNumber: z.string().nullable().optional(),
					motorNumber: z.string().nullable().optional(),
					color: z.string().optional(),
					vehicleType: z.string().optional(),
					milesMileage: z.number().nullable().optional(),
					kmMileage: z.number().optional(),
					origin: z.string().nullable().optional(),
					cylinders: z.string().nullable().optional(),
					engineCC: z.string().nullable().optional(),
					fuelType: z.string().nullable().optional(),
					transmission: z.string().nullable().optional(),
					companyId: z.string().nullable().optional(),
					isNew: z.boolean().optional(),
					isOwned: z.boolean().optional(),
					status: z
						.enum(["pending", "available", "sold", "maintenance", "auction"])
						.optional(),
					// Campos para contratos legales
					seats: z.number().nullable().optional(),
					doors: z.number().nullable().optional(),
					axles: z.number().nullable().optional(),
					vehicleUse: z.string().nullable().optional(),
					series: z.string().nullable().optional(),
					iscvCode: z.string().nullable().optional(),
				}),
			}),
		)
		.handler(async ({ input }) => {
			try {
				const [updated] = await db
					.update(vehicles)
					.set({
						...input.data,
						updatedAt: new Date(),
					})
					.where(eq(vehicles.id, input.id))
					.returning();

				return updated;
			} catch (error: unknown) {
				if (isUniqueViolation(error, "vehicles_license_plate_unique")) {
					throw new ORPCError("BAD_REQUEST", {
						message: `Ya existe un vehículo con la placa "${input.data.licensePlate}"`,
					});
				}
				throw error;
			}
		}),

	// Delete vehicle
	delete: protectedProcedure
		.input(z.object({ id: z.string() }))
		.handler(async ({ input }) => {
			// Delete related photos first
			await db
				.delete(vehiclePhotos)
				.where(eq(vehiclePhotos.vehicleId, input.id));

			// Delete inspections
			await db
				.delete(vehicleInspections)
				.where(eq(vehicleInspections.vehicleId, input.id));

			// Delete the vehicle
			const [deleted] = await db
				.delete(vehicles)
				.where(eq(vehicles.id, input.id))
				.returning();

			return deleted;
		}),

	// Search vehicles
	search: protectedProcedure
		.input(
			z.object({
				query: z.string().optional(),
				status: z
					.enum(["pending", "available", "sold", "maintenance", "auction"])
					.optional(),
				vehicleType: z.string().optional(),
				fuelType: z.string().optional(),
			}),
		)
		.handler(async ({ input }) => {
			const conditions = [];

			if (input.query) {
				conditions.push(
					or(
						ilike(vehicles.make, `%${input.query}%`),
						ilike(vehicles.model, `%${input.query}%`),
						ilike(vehicles.licensePlate, `%${input.query}%`),
						ilike(vehicles.vinNumber, `%${input.query}%`),
					),
				);
			}

			if (input.status) {
				conditions.push(eq(vehicles.status, input.status));
			}

			if (input.vehicleType) {
				conditions.push(eq(vehicles.vehicleType, input.vehicleType));
			}

			if (input.fuelType) {
				conditions.push(eq(vehicles.fuelType, input.fuelType));
			}

			const result = await db
				.select()
				.from(vehicles)
				.where(conditions.length > 0 ? and(...conditions) : undefined)
				.orderBy(desc(vehicles.createdAt));

			return result;
		}),

	// Search ONLY vehicles with recorded inspections
	searchWithInspections: tallerOrCrmProcedure
		.input(
			z.object({
				query: z.string().optional(),
				status: z
					.enum(["pending", "available", "sold", "maintenance", "auction"])
					.optional(),
				vehicleType: z.string().optional(),
				fuelType: z.string().optional(),
			}),
		)
		.handler(async ({ input }) => {
			const conditions = [];

			if (input.query) {
				conditions.push(
					or(
						ilike(vehicles.make, `%${input.query}%`),
						ilike(vehicles.model, `%${input.query}%`),
						ilike(vehicles.licensePlate, `%${input.query}%`),
						ilike(vehicles.vinNumber, `%${input.query}%`),
					),
				);
			}

			if (input.status) {
				conditions.push(eq(vehicles.status, input.status));
			}

			if (input.vehicleType) {
				conditions.push(eq(vehicles.vehicleType, input.vehicleType));
			}

			if (input.fuelType) {
				conditions.push(eq(vehicles.fuelType, input.fuelType));
			}

			// Use innerJoin to ensure the vehicle has at least one inspection
			const result = await db
				.selectDistinct({
					id: vehicles.id,
					make: vehicles.make,
					model: vehicles.model,
					year: vehicles.year,
					licensePlate: vehicles.licensePlate,
					vinNumber: vehicles.vinNumber,
					motorNumber: vehicles.motorNumber,
					color: vehicles.color,
					vehicleType: vehicles.vehicleType,
					milesMileage: vehicles.milesMileage,
					kmMileage: vehicles.kmMileage,
					origin: vehicles.origin,
					cylinders: vehicles.cylinders,
					engineCC: vehicles.engineCC,
					fuelType: vehicles.fuelType,
					transmission: vehicles.transmission,
					trim: vehicles.trim,
					traction: vehicles.traction,
					status: vehicles.status,
					createdAt: vehicles.createdAt,
				})
				.from(vehicles)
				.innerJoin(
					vehicleInspections,
					eq(vehicles.id, vehicleInspections.vehicleId),
				)
				.where(conditions.length > 0 ? and(...conditions) : undefined)
				.orderBy(desc(vehicles.createdAt));

			return result;
		}),

	// Create vehicle inspection
	createInspection: protectedProcedure
		.input(
			z.object({
				vehicleId: z.string(),
				technicianName: z.string(),
				inspectionDate: z.date(),
				inspectionResult: z.string(),
				vehicleRating: z.string(),
				marketValue: z.string().optional().default("0"),
				suggestedCommercialValue: z.string().optional().default("0"),
				bankValue: z.string().optional().default("0"),
				currentConditionValue: z.string(),
				vehicleEquipment: z.string(),
				importantConsiderations: z.string().optional(),
				scannerUsed: z.boolean(),
				scannerResultUrl: z.string().optional(),
				airbagWarning: z.boolean(),
				missingAirbag: z.string().optional(),
				testDrive: z.boolean(),
				noTestDriveReason: z.string().optional(),
				status: z.string().optional().default("pending"),
				alerts: z.array(z.string()).optional().default([]),
			}),
		)
		.handler(async ({ input }) => {
			const [newInspection] = await db
				.insert(vehicleInspections)
				.values(input as NewVehicleInspection)
				.returning();

			// Update vehicle status based on inspection
			if (input.status === "approved") {
				await db
					.update(vehicles)
					.set({
						status: "available",
						updatedAt: new Date(),
					})
					.where(eq(vehicles.id, input.vehicleId));
			}

			return newInspection;
		}),

	upsertManualValuation: crmProcedure
		.input(
			z.object({
				vehicleId: z.string().uuid(),
				vehicleRating: z.enum(["Comercial", "No comercial"]),
				marketValue: z.string().trim(),
				suggestedCommercialValue: z.string().trim(),
				bankValue: z.string().trim(),
				currentConditionValue: z.string().trim(),
			}),
		)
		.handler(async ({ input, context }) => {
			const userRole = context.userRole || "";
			const canManageManualValuation = canAccessSalesTeamActions(userRole);

			if (!canManageManualValuation) {
				throw new ORPCError("FORBIDDEN", {
					message:
						"Solo administradores y supervisores de ventas pueden cargar valores manuales",
				});
			}

			const [vehicle] = await db
				.select({ id: vehicles.id })
				.from(vehicles)
				.where(eq(vehicles.id, input.vehicleId))
				.limit(1);

			if (!vehicle) {
				throw new ORPCError("NOT_FOUND", {
					message: "Vehículo no encontrado",
				});
			}

			const normalizedMarketValue = normalizeManualValuationAmount(
				input.marketValue,
				"Valor mercado",
			);
			const normalizedSuggestedCommercialValue = normalizeManualValuationAmount(
				input.suggestedCommercialValue,
				"Valor comercial sugerido",
			);
			const normalizedBankValue = normalizeManualValuationAmount(
				input.bankValue,
				"Valor bancario",
			);
			const normalizedCurrentConditionValue = normalizeManualValuationAmount(
				input.currentConditionValue,
				"Valor condiciones actuales",
			);

			const [latestInspection] = await db
				.select()
				.from(vehicleInspections)
				.where(eq(vehicleInspections.vehicleId, input.vehicleId))
				.orderBy(
					desc(vehicleInspections.inspectionDate),
					desc(vehicleInspections.createdAt),
				)
				.limit(1);

			const isManualValuation =
				latestInspection &&
				latestInspection.technicianName === MANUAL_VALUATION_TECHNICIAN_NAME &&
				latestInspection.inspectionResult === MANUAL_VALUATION_RESULT;

			const manualValuationData = buildManualValuationData({
				vehicleRating: input.vehicleRating,
				marketValue: normalizedMarketValue,
				suggestedCommercialValue: normalizedSuggestedCommercialValue,
				bankValue: normalizedBankValue,
				currentConditionValue: normalizedCurrentConditionValue,
			});

			if (isManualValuation) {
				const [updatedInspection] = await db
					.update(vehicleInspections)
					.set(manualValuationData)
					.where(eq(vehicleInspections.id, latestInspection.id))
					.returning();

				return {
					action: "updated" as const,
					inspection: updatedInspection,
				};
			}

			const [newInspection] = await db
				.insert(vehicleInspections)
				.values({
					vehicleId: input.vehicleId,
					...manualValuationData,
				})
				.returning();

			return {
				action: "created" as const,
				inspection: newInspection,
			};
		}),

	// Update inspection
	updateInspection: protectedProcedure
		.input(
			z.object({
				id: z.string(),
				data: z.object({
					technicianName: z.string().optional(),
					inspectionDate: z.date().optional(),
					inspectionResult: z.string().optional(),
					vehicleRating: z.string().optional(),
					marketValue: z.string().optional(),
					suggestedCommercialValue: z.string().optional(),
					bankValue: z.string().optional(),
					currentConditionValue: z.string().optional(),
					vehicleEquipment: z.string().optional(),
					importantConsiderations: z.string().optional(),
					scannerUsed: z.boolean().optional(),
					scannerResultUrl: z.string().optional(),
					airbagWarning: z.boolean().optional(),
					missingAirbag: z.string().optional(),
					testDrive: z.boolean().optional(),
					noTestDriveReason: z.string().optional(),
					status: z
						.enum(["pending", "approved", "rejected", "auction"])
						.optional(),
					alerts: z.array(z.string()).optional(),
				}),
			}),
		)
		.handler(async ({ input }) => {
			const [updated] = await db
				.update(vehicleInspections)
				.set({
					...input.data,
					updatedAt: new Date(),
				})
				.where(eq(vehicleInspections.id, input.id))
				.returning();

			return updated;
		}),

	// Upload vehicle photo
	uploadPhoto: protectedProcedure
		.input(
			z.object({
				vehicleId: z.string(),
				inspectionId: z.string().nullable().optional(),
				category: z.string(),
				photoType: z.string(),
				title: z.string(),
				description: z.string().optional(),
				url: z.string(),
			}),
		)
		.handler(async ({ input }) => {
			const [newPhoto] = await db
				.insert(vehiclePhotos)
				.values(input as NewVehiclePhoto)
				.returning();

			return newPhoto;
		}),

	// Delete photo
	deletePhoto: protectedProcedure
		.input(z.object({ id: z.string() }))
		.handler(async ({ input }) => {
			const [deleted] = await db
				.delete(vehiclePhotos)
				.where(eq(vehiclePhotos.id, input.id))
				.returning();

			return deleted;
		}),

	// Get inspection by ID
	getInspectionById: protectedProcedure
		.input(z.object({ id: z.string() }))
		.handler(async ({ input }) => {
			const [inspection] = await db
				.select()
				.from(vehicleInspections)
				.where(eq(vehicleInspections.id, input.id))
				.limit(1);

			if (!inspection) {
				throw new ORPCError("NOT_FOUND", {
					message: "Inspección no encontrada",
				});
			}

			const photos = await db
				.select()
				.from(vehiclePhotos)
				.where(eq(vehiclePhotos.inspectionId, input.id));

			const checklistItems = await db
				.select()
				.from(inspectionChecklistItems)
				.where(eq(inspectionChecklistItems.inspectionId, input.id))
				.orderBy(inspectionChecklistItems.category);

			let evidenceData: (typeof checklistItemEvidence.$inferSelect)[] = [];
			if (checklistItems.length > 0) {
				evidenceData = await db
					.select()
					.from(checklistItemEvidence)
					.where(
						inArray(
							checklistItemEvidence.itemId,
							checklistItems.map((i) => i.id),
						),
					);
			}

			const itemsWithEvidence = checklistItems.map((item) => ({
				...item,
				evidence: evidenceData.filter((ev) => ev.itemId === item.id),
			}));

			return {
				...inspection,
				photos,
				checklistItems: itemsWithEvidence,
			};
		}),

	// Get latest inspection by vehicle ID
	getLatestInspectionByVehicleId: protectedProcedure
		.input(z.object({ vehicleId: z.string().uuid() }))
		.handler(async ({ input }) => {
			const [inspection] = await db
				.select()
				.from(vehicleInspections)
				.where(eq(vehicleInspections.vehicleId, input.vehicleId))
				.orderBy(desc(vehicleInspections.inspectionDate))
				.limit(1);

			return inspection || null;
		}),

	// Validate if license plate or VIN is already used
	validateLicensePlate: publicProcedure
		.input(
			z.object({
				licensePlate: z.string().optional(),
				vinNumber: z.string().optional(),
				id: z.string().optional(),
			}),
		)
		.handler(async ({ input }) => {
			if (!input.licensePlate && !input.vinNumber) return { valid: true };

			let foundVehicle = null;

			// 1. Priority: Find by Plate exactly
			if (input.licensePlate) {
				const cleanInputPlate = input.licensePlate
					.replace(/[^a-zA-Z0-9]/g, "")
					.toUpperCase();

				const existingWithPlate = await db
					.select()
					.from(vehicles)
					.where(
						and(
							sql`REPLACE(REPLACE(UPPER(${vehicles.licensePlate}), ' ', ''), '-', '') = ${cleanInputPlate}`,
							input.id ? not(eq(vehicles.id, input.id)) : undefined,
						),
					)
					.limit(1);
				
				foundVehicle = existingWithPlate[0] || null;
			}

			// 2. Fallback: Find by VIN exactly (only if not found by plate)
			if (!foundVehicle && input.vinNumber) {
				const cleanInputVin = input.vinNumber
					.replace(/[^a-zA-Z0-9]/g, "")
					.toUpperCase();

				const existingWithVin = await db
					.select()
					.from(vehicles)
					.where(
						and(
							sql`REPLACE(REPLACE(UPPER(${vehicles.vinNumber}), ' ', ''), '-', '') = ${cleanInputVin}`,
							input.id ? not(eq(vehicles.id, input.id)) : undefined,
						),
					)
					.limit(1);
				
				foundVehicle = existingWithVin[0] || null;
			}

			// 3. Result
			if (foundVehicle) {
				return {
					valid: false,
					alreadyExists: true,
					vehicle: foundVehicle,
					message: `Vehículo registrado encontrado.`,
				};
			}

			return { valid: true, message: "", alreadyExists: false };
		}),

	// Get statistics
	getStatistics: publicProcedure.handler(async () => {
		const allVehicles = await db.select().from(vehicles);
		const allInspections = await db.select().from(vehicleInspections);

		const stats = {
			totalVehicles: allVehicles.length,
			availableVehicles: allVehicles.filter((v) => v.status === "available")
				.length,
			pendingVehicles: allVehicles.filter((v) => v.status === "pending").length,
			soldVehicles: allVehicles.filter((v) => v.status === "sold").length,
			totalInspections: allInspections.length,
			approvedInspections: allInspections.filter((i) => i.status === "approved")
				.length,
			pendingInspections: allInspections.filter((i) => i.status === "pending")
				.length,
			rejectedInspections: allInspections.filter((i) => i.status === "rejected")
				.length,
			commercialVehicles: allInspections.filter(
				(i) => i.vehicleRating === "Comercial",
			).length,
			nonCommercialVehicles: allInspections.filter(
				(i) => i.vehicleRating === "No comercial",
			).length,
			vehiclesWithAlerts: allInspections.filter(
				(i) => i.alerts && (i.alerts as string[]).length > 0,
			).length,
		};

		return stats;
	}),

	// Create full inspection with all data (vehicle + inspection + checklist)
	createFullInspection: publicProcedure
		.input(
			z.object({
				// Vehicle data
				vehicle: z.object({
					id: z.string().optional(),
					make: z.string(),
					model: z.string(),
					year: z.number(),
					licensePlate: z.string(),
					vinNumber: z.string(),
					motorNumber: z.string().optional(),
					color: z.string(),
					vehicleType: z.string(),
					milesMileage: z.number().nullable().optional(),
					kmMileage: z.number(),
					origin: z.enum(["Nacional", "Importado"]),
					cylinders: z.string(),
					engineCC: z.string(),
					fuelType: z.enum(["Gasolina", "Diesel", "Eléctrico", "Híbrido"]),
					transmission: z.enum(["Automático", "Manual"]),
					companyId: z.string().nullable().optional(),
					// Campos para contratos legales
					seats: z.number().nullable().optional(),
					doors: z.number().nullable().optional(),
					axles: z.number().nullable().optional().default(2),
					vehicleUse: z.string().nullable().optional(),
					series: z.string().nullable().optional(),
					iscvCode: z.string().nullable().optional(),
					trim: z.string().optional(),
					traction: z.string().optional(),
					isOwned: z.boolean().optional(),
				}),
				// Inspection data
				inspection: z.object({
					technicianName: z.string(),
					inspectionDate: z.date(),
					inspectionResult: z.string(),
					vehicleRating: z.enum(["Comercial", "No comercial"]),
					marketValue: z.string().optional().default("0"),
					suggestedCommercialValue: z.string().optional().default("0"),
					bankValue: z.string().optional().default("0"),
					currentConditionValue: z.string(),
					vehicleEquipment: z.string(),
					importantConsiderations: z.string().optional(),
					scannerUsed: z.boolean(),
					scannerResultUrl: z.string().optional(),
					airbagWarning: z.boolean(),
					missingAirbag: z.string().optional(),
					testDrive: z.boolean(),
					noTestDriveReason: z.string().optional(),
					sectionTimes: z.record(z.string(), z.number()).optional().default({}),
					tiresCondition: z.number().optional(),
					tireConditionFrontLeft: z.number().optional(),
					tireConditionFrontRight: z.number().optional(),
					tireConditionRearLeft: z.number().optional(),
					tireConditionRearRight: z.number().optional(),
					hasSpareTire: z.boolean().optional(),
					tireConditionSpare: z.number().optional(),
					paintCondition: z.number().optional(),
					hasAgencyHistory: z.boolean().optional(),
					rejectionEvidenceUrl: z.string().optional(),
					status: z
						.enum(["pending", "approved", "rejected", "auction"])
						.optional()
						.default("pending"),
				}),
				// Checklist items
				checklistItems: z.array(
					z.object({
						category: z.string(),
						item: z.string(),
						checked: z.boolean(),
						severity: z.string().optional().default("critical"),
						notes: z.string().optional(),
						evidence: z
							.array(
								z.object({
									url: z
										.string()
										.url({ message: "Evidence URL must be valid" }),
									mimeType: z.string().regex(/^(image|video)\//, {
										message: "File must be an image or video",
									}),
									originalName: z.string().min(1).max(255),
								}),
							)
							.max(MAX_EVIDENCE_FILES_PER_ITEM, {
								message: `Maximum ${MAX_EVIDENCE_FILES_PER_ITEM} evidence files allowed per checklist item`,
							})
							.optional(),
					}),
				),
				// 360 Inspection Items
				inspection360Items: z
					.array(
						z.object({
							area: z.string(),
							checkpoint: z.string(),
							status: z.enum(INSPECTION_360_STATUSES),
							comment: z.string().optional(),
							metadata: z.record(z.any()).optional(),
						}),
					)
					.optional()
					.default([]),
				// Photo URLs (optional, can be added later)
				photos: z
					.array(
						z.object({
							category: z.string(),
							photoType: z.string(),
							title: z.string(),
							description: z.string().optional(),
							url: z.string(),
							valuatorComment: z.string().optional(),
							noCommentsChecked: z.boolean().optional(),
						}),
					)
					.optional(),
				// AI Recommendation storage
				aiValuation: z
					.object({
						suggestedValue: z.number(),
						baseMarketValue: z.number().optional(),
						reasoning: z.string(),
						marketAnalysis: z.string(),
						depreciationFactors: z.array(z.string()),
						confidence: z.string(),
						commercialClassification: z.string(),
						commercialClassificationReasoning: z.string(),
					})
					.optional(),
			}),
		)
		.handler(async ({ input }) => {
			// Log incoming data for debugging
			console.log("=== createFullInspection DEBUG ===");
			console.log("Vehicle data:", JSON.stringify(input.vehicle, null, 2));
			console.log(
				"Inspection data:",
				JSON.stringify(input.inspection, null, 2),
			);
			console.log("Checklist items count:", input.checklistItems?.length || 0);
			console.log("Photos count:", input.photos?.length || 0);

			// Start a transaction
			try {
				return await db.transaction(async (tx) => {
					// 1. Identify or create vehicle by ID - Sanitize blank IDs
					let vehicleId: string;
					const { id: rawId, ...vehicleData } = input.vehicle;
					const vehicleInputId = rawId && rawId.trim() !== "" ? rawId : undefined;

					if (vehicleInputId) {
						// Try to update existing vehicle by ID
						const [updated] = await tx
							.update(vehicles)
							.set({
								...vehicleData,
								updatedAt: new Date(),
							})
							.where(eq(vehicles.id, vehicleInputId))
							.returning();
						
						if (updated) {
							vehicleId = updated.id;
						} else {
							// Fallback: If ID not found, create new vehicle with that ID
							const [newVehicle] = await tx
								.insert(vehicles)
								.values({
									id: vehicleInputId,
									...vehicleData,
									status: "pending",
								} as NewVehicle)
								.returning();
							vehicleId = newVehicle.id;
						}
					} else {
						// Create new vehicle (no ID provided or ID was blank)
						const [newVehicle] = await tx
							.insert(vehicles)
							.values({
								...vehicleData,
								status: "pending",
							} as NewVehicle)
							.returning();
						vehicleId = newVehicle.id;
					}

					// 2. Create inspection - Clean numeric values
					const cleanValue = (value: string | undefined): string | null => {
						// Treat empty/whitespace-only values as unknown (NULL in DB)
						if (!value || value.trim() === "") {
							return null;
						}
						const normalized = value.replace(/[,_\s]/g, "");
						const parsed = Number.parseFloat(normalized);
						if (Number.isNaN(parsed)) {
							// Non-empty but invalid numeric string: fail validation rather than coercing to "0"
							throw new ORPCError("BAD_REQUEST", {
								message: "Invalid monetary value provided",
							});
						}
						return parsed.toString();
					};

					const [newInspection] = await tx
						.insert(vehicleInspections)
						.values({
							vehicleId,
							...input.inspection,
							marketValue: cleanValue(input.inspection.marketValue),
							suggestedCommercialValue: cleanValue(
								input.inspection.suggestedCommercialValue,
							),
							bankValue: cleanValue(input.inspection.bankValue),
							currentConditionValue: cleanValue(
								input.inspection.currentConditionValue,
							),
							// Save AI recommendations if provided
							aiSuggestedValue: input.aiValuation?.suggestedValue?.toString(),
							// TODO: baseMarketValue may also be mapped if there's a specific column for it, but the client maps it to marketValue above
							aiReasoning: input.aiValuation?.reasoning,
							aiMarketAnalysis: input.aiValuation?.marketAnalysis,
							aiDepreciationFactors: input.aiValuation?.depreciationFactors,
							aiConfidence: input.aiValuation?.confidence,
							aiCommercialClassification:
								input.aiValuation?.commercialClassification,
							status: "pending",
							alerts: [],
						} as NewVehicleInspection)
						.returning();

					// 3. Create checklist items
					if (input.checklistItems.length > 0) {
						const insertedChecklistItems = await tx
							.insert(inspectionChecklistItems)
							.values(
								input.checklistItems.map(
									(item) =>
										({
											inspectionId: newInspection.id,
											category: item.category,
											item: item.item,
											checked: item.checked,
											severity: item.severity,
											notes: item.notes,
										}) as NewInspectionChecklistItem,
								),
							)
							.returning({
								id: inspectionChecklistItems.id,
								category: inspectionChecklistItems.category,
								item: inspectionChecklistItems.item,
							});

						const evidenceToInsert: NewChecklistItemEvidence[] = [];

						for (const inputItem of input.checklistItems) {
							if (inputItem.evidence && inputItem.evidence.length > 0) {
								const insertedItem = insertedChecklistItems.find(
									(i) =>
										i.category === inputItem.category &&
										i.item === inputItem.item,
								);

								if (insertedItem) {
									for (const ev of inputItem.evidence) {
										evidenceToInsert.push({
											itemId: insertedItem.id,
											url: ev.url,
											mimeType: ev.mimeType,
											originalName: ev.originalName,
										});
									}
								} else {
									throw new ORPCError("INTERNAL_SERVER_ERROR", {
										message: `Failed to link evidence to checklist item: ${inputItem.category} - ${inputItem.item}`,
									});
								}
							}
						}

						if (evidenceToInsert.length > 0) {
							await tx.insert(checklistItemEvidence).values(evidenceToInsert);
						}
					}

					// 4. Create 360 Inspection Items
					if (input.inspection360Items && input.inspection360Items.length > 0) {
						await tx.insert(vehicleInspection360Items).values(
							input.inspection360Items.map(
								(item) =>
									({
										inspectionId: newInspection.id,
										...item,
									}) as NewVehicleInspection360Item,
							),
						);
					}

					// 5. Create photos if provided
					if (input.photos && input.photos.length > 0) {
						await tx.insert(vehiclePhotos).values(
							input.photos.map(
								(photo) =>
									({
										vehicleId,
										inspectionId: newInspection.id,
										...photo,
									}) as NewVehiclePhoto,
							),
						);
					}

					// 5. Update vehicle and inspection status
					const criticalIssues = input.checklistItems.filter(
						(item) => item.checked && item.severity === "critical",
					);

					// Prioritize rejection if there are critical issues
					const finalStatus =
						criticalIssues.length > 0 || input.inspection.status === "rejected"
							? "rejected"
							: input.inspection.status === "approved"
								? "approved"
								: "pending";

					if (finalStatus === "rejected") {
						await tx
							.update(vehicles)
							.set({
								status: "maintenance",
								updatedAt: new Date(),
							})
							.where(eq(vehicles.id, vehicleId));

						const alertsArray = criticalIssues.map((item) => item.item);

						await tx
							.update(vehicleInspections)
							.set({
								status: "rejected",
								alerts: alertsArray,
								updatedAt: new Date(),
							})
							.where(eq(vehicleInspections.id, newInspection.id));
					} else if (finalStatus === "approved") {
						await tx
							.update(vehicles)
							.set({
								status: "available",
								updatedAt: new Date(),
							})
							.where(eq(vehicles.id, vehicleId));

						await tx
							.update(vehicleInspections)
							.set({
								status: "approved",
								updatedAt: new Date(),
							})
							.where(eq(vehicleInspections.id, newInspection.id));
					}

					return {
						vehicleId,
						inspectionId: newInspection.id,
						success: true,
					};
				});
			} catch (error) {
				console.error("Error in createFullInspection:", error);
				throw new ORPCError("BAD_REQUEST", {
					message: `Error al guardar la inspección: ${error instanceof Error ? error.message : "Error desconocido"}`,
				});
			}
		}),

	// OCR endpoint for vehicle registration card (tarjeta de circulación)
	processVehicleRegistrationOCR: publicProcedure
		.input(
			z.object({
				imageBase64: z
					.string()
					.describe("Base64 encoded image of the vehicle registration card"),
				mimeType: z
					.string()
					.optional()
					.default("image/jpeg")
					.describe("MIME type of the image"),
			}),
		)
		.handler(async ({ input }) => {
			try {
				console.log("Processing OCR for vehicle registration card...");

				// Use DeepSeek model for OCR processing
				const isPDF = input.mimeType === "application/pdf";

				// Convert base64 string to Buffer for file content
				const fileBuffer = Buffer.from(input.imageBase64, "base64");

				const { object } = await generateObject({
					model: openai("gpt-4o-mini"),
					schema: vehicleRegistrationOCRSchema,
					messages: [
						{
							role: "system",
							content: `Eres un especialista en extracción de datos de tarjetas de circulación guatemaltecas del SAT (Superintendencia de Administración Tributaria).

Tu tarea es extraer información específica de vehículos de estos documentos oficiales. Extrae estos campos cuando estén disponibles:

INFORMACIÓN DEL VEHÍCULO:
- Placa (formato: P0-123ABC)
- Marca (ej: TOYOTA, NISSAN) 
- Línea (nombre del modelo, ej: COROLLA, SENTRA)
- Modelo/Año (año del vehículo, ej: 2020, 2023)
- Color (descripción del color)
- Tipo de vehículo (ej: AUTOMOVIL, CAMIONETA)
- Uso (ej: PARTICULAR, COMERCIAL)

ESPECIFICACIONES TÉCNICAS:
- VIN/Chasis/Serie (números de identificación únicos)
- Motor/CC (Cilindrada, buscar etiqueta "Cilindrada" o "CC")
- Cilindros (número)
- Asientos (Número de pasajeros, buscar etiqueta "Asientos" o "No. Asientos")

REGLAS IMPORTANTES:
- Si encuentras al menos 3 campos correctos: extractionSuccess = true
- Si extraes menos de 3 campos: extractionSuccess = false  
- Siempre retorna un objeto JSON válido con extractionSuccess como boolean y extractionErrors como array
- Deja campos vacíos ("") si no los encuentras claramente
- NO uses estructura "properties", retorna el objeto directamente
- Ejemplo correcto: {"licensePlate": "P0-123ABC", "make": "TOYOTA", "line": "COROLLA", "model": "2020", "use": "PARTICULAR", "seats": "5", "cc": "2000", "extractionSuccess": true, "extractionErrors": []}`,
						},
						{
							role: "user",
							content: [
								{
									type: "text",
									text: "Extrae la información de esta tarjeta de circulación:",
								},
								isPDF
									? {
											type: "file",
											data: fileBuffer,
											mediaType: "application/pdf",
											filename: "tarjeta_circulacion.pdf",
										}
									: {
											type: "image",
											image: fileBuffer,
											mediaType: input.mimeType,
										},
							],
						},
					],
				});

				console.log("OCR extraction result:", object);

				// Map OCR data to vehicle form format
				const mappedData = mapOCRToVehicleForm(object);

				return {
					success: true,
					ocrData: object,
					mappedFormData: mappedData,
					message: object.extractionSuccess
						? "Información extraída exitosamente de la tarjeta de circulación"
						: "Información extraída parcialmente. Algunos campos necesitan ser completados manualmente.",
				};
			} catch (error) {
				console.error("OCR processing error:", error);

				// Create user-friendly error message
				let userMessage =
					"No se pudo procesar el archivo. Por favor complete los campos manualmente.";

				// Handle specific error types for better UX
				if (error instanceof Error) {
					const errorMsg = error.message.toLowerCase();
					if (errorMsg.includes("schema") || errorMsg.includes("validation")) {
						userMessage =
							"Error al procesar la respuesta. Por favor intente nuevamente o complete manualmente.";
					} else if (
						errorMsg.includes("file") ||
						errorMsg.includes("pdf") ||
						errorMsg.includes("image")
					) {
						userMessage =
							"El formato del archivo no es compatible. Por favor convierta a imagen (JPG/PNG) e intente nuevamente.";
					} else if (errorMsg.includes("api") || errorMsg.includes("key")) {
						userMessage =
							"Error de configuración del servicio. Contacte al administrador.";
					} else if (
						errorMsg.includes("network") ||
						errorMsg.includes("timeout")
					) {
						userMessage =
							"Error de conexión. Verifique su internet e intente nuevamente.";
					}
				}

				// Throw ORPCError instead of returning success=false to make ORPC return proper error status
				throw new ORPCError("BAD_REQUEST", { message: userMessage });
			}
		}),

	// AI Vehicle Valuation endpoint
	getAIVehicleValuation: publicProcedure
		.input(
			z.object({
				vehicleData: z.any().describe("Complete vehicle data from inspection"),
				checklistItems: z.array(z.any()).describe("Inspection checklist items"),
				photos: z.array(z.any()).describe("Vehicle photos"),
			}),
		)
		.handler(async ({ input }) => {
			try {
				console.log("Generating AI vehicle valuation...");

				// Prepare comprehensive context for AI
				const context = prepareValuationContext(
					input.vehicleData,
					input.checklistItems,
					input.photos,
				);

				// Step 1: Web search for current market prices
				console.log("Searching web for current market prices...");
				const {
					text: marketResearch,
					sources,
					usage: searchUsage,
				} = await generateText({
					model: openai("gpt-5-mini"),
					prompt: `Busca precios actuales de mercado para: ${context.make} ${context.model} ${context.year} usado en Guatemala.
Incluye precios de venta en portales como OLX, Encuentra24, Facebook Marketplace Guatemala, y cualquier referencia relevante.
Responde con un resumen conciso de los precios encontrados en Quetzales (GTQ).`,
					tools: {
						web_search: openai.tools.webSearch({
							searchContextSize: "medium",
							userLocation: {
								type: "approximate",
								city: "Guatemala City",
								country: "GT",
							},
						}),
					},
				});
				console.log("Market research results:", marketResearch);
				console.log("Sources:", sources);

				// Step 2: Generate structured valuation with market data
				const { object, usage: valuationUsage } = await generateObject({
					model: openai("gpt-5-mini"),
					schema: vehicleValuationSchema,
					messages: [
						{
							role: "system",
							content: `Eres un experto valuador de vehículos en Guatemala con más de 20 años de experiencia en el mercado automotriz guatemalteco.

DATOS DE MERCADO ACTUALES (obtenidos de búsqueda web en tiempo real):
${marketResearch}

${sources?.length ? `Fuentes consultadas:\n${sources.map((s) => `- ${"url" in s ? s.url : s.id}`).join("\n")}` : ""}

Tu tarea es realizar una valoración precisa de vehículos basada en:

CONTEXTO DEL MERCADO GUATEMALTECO:
- Ubicación: Ciudad de Guatemala
- Moneda: Quetzales (GTQ)
- Mercado: Vehículos usados Guatemala 2024-2025
- Depreciación promedio: 15-20% anual
- Factores locales: Importación, impuestos, disponibilidad de repuestos

METODOLOGÍA DE VALORACIÓN:
1. Analizar marca, modelo, año y depreciación
2. Evaluar condición técnica y estética (especialmente estado de pintura y vida útil de neumáticos)
3. Considerar kilometraje, mantenimiento y si cuenta con historial de agencia
4. Revisar equipamiento y características especiales
5. Aplicar ajustes por problemas detectados
6. Comparar con mercado local

RANGOS DE VALORES TÍPICOS (Referencia):
- Económicos: Q25,000 - Q80,000
- Medianos: Q80,000 - Q200,000
- Premium: Q200,000 - Q500,000+

CLASIFICACIÓN COMERCIAL:
Debes clasificar el vehículo como "Comercial" o "No comercial" basándote ÚNICA Y EXCLUSIVAMENTE en qué tan fácil es vender la MARCA Y MODELO en el mercado, IGNORANDO POR COMPLETO EL ESTADO FÍSICO O LOS DAÑOS DEL VEHÍCULO:
- Comercial: Vehículos con alta demanda en Guatemala, marcas populares y modelos comunes. ¡IMPORTANTE! Incluso si un vehículo "Comercial" está destruido o en pésimo estado, SIGUE SIENDO COMERCIAL porque pertenece a un modelo de alta demanda. (Ejemplo: Un Toyota Corolla o Mazda CX-5 siempre es Comercial, aunque tenga daños graves).
- No comercial: Vehículos de nicho, marcas poco conocidas, modelos con poco movimiento en el mercado guatemalteco. Estrictamente por su baja demanda de modelo, no por daños. (Ejemplo: Un Hyundai Veloster o Volkswagen Passat siempre será No Comercial, aunque esté nítido físicamente).

VALOR DE MERCADO BASE Y VALOR SUGERIDO:
Recuerda que debes proveer dos valores:
1. baseMarketValue: Valor del vehículo funcionando y sin choques de acuerdo al mercado.
2. suggestedValue: Valor final ya castigado por los daños físicos y mecánicos (condición actual).

Proporciona una valoración conservadora pero realista para el mercado guatemalteco.`,
						},
						{
							role: "user",
							content: `Valora este vehículo con la siguiente información:

INFORMACIÓN BÁSICA:
- Marca: ${context.make}
- Modelo/Línea: ${context.model}
- Versión o Equipamiento: ${context.trim}
- Año: ${context.year} (${context.age} años de antigüedad)
- Tipo: ${context.vehicleType}
- Color: ${context.color}
- Origen: ${context.origin}

ESPECIFICACIONES TÉCNICAS:
- Motor: ${context.engineCC} CC, ${context.cylinders} cilindros
- Combustible: ${context.fuelType}
- Transmisión: ${context.transmission}
- Tracción: ${context.traction}
- Kilometraje: ${context.kmMileage} km

CONDICIÓN Y ESTADO:
- Fecha de inspección: ${context.inspectionDate}
- Técnico: ${context.technicianName}
- Observaciones generales: ${context.inspectionResult}
- Vida útil de neumáticos (Promedio): ${context.tiresCondition}
- Detalle de neumáticos: 
  * Frontal Izquierda: ${context.tireConditionFrontLeft}
  * Frontal Derecha: ${context.tireConditionFrontRight}
  * Trasera Izquierda: ${context.tireConditionRearLeft}
  * Trasera Derecha: ${context.tireConditionRearRight}
${context.hasSpareTire ? `- Llanta de repuesto: ${context.tireConditionSpare}` : "- Sin llanta de repuesto"}
- Estado general de la pintura: ${context.paintCondition}
- ¿Tiene historial de agencia?: ${context.hasAgencyHistory}
- Problemas críticos encontrados: ${context.criticalIssueCount} (${context.criticalIssues.join(", ") || "Ninguno"})
- Problemas menores: ${context.warningIssueCount} (${context.warningIssues.join(", ") || "Ninguno"})

EQUIPAMIENTO:
${context.vehicleEquipment}

VERIFICACIONES TÉCNICAS:
- Scanner usado: ${context.scannerUsed ? "Sí" : "No"}
- Problemas de airbag: ${context.airbagWarning ? "Sí" : "No"}
- Prueba de manejo: ${context.testDrive ? "Sí" : "No"}

DOCUMENTACIÓN:
- Total de fotos: ${context.photoCount}
- Fotos exteriores: ${context.hasExteriorPhotos ? "Sí" : "No"}
- Fotos interiores: ${context.hasInteriorPhotos ? "Sí" : "No"}
- Fotos del motor: ${context.hasEnginePhotos ? "Sí" : "No"}

OBSERVACIONES DEL VALUADOR EN FOTOS:
${
	context.hasPhotoComments
		? context.photoComments
				.map(
					(comment: { category: string; photoType: string; comment: string }) =>
						`- ${comment.category} (${comment.photoType}): ${comment.comment}`,
				)
				.join("\n")
		: "Sin observaciones especiales en las fotografías"
}

CONSIDERACIONES ESPECIALES:
${context.importantConsiderations}

Por favor proporciona una valoración detallada en Quetzales para el mercado guatemalteco actual (${context.evaluationDate}).`,
						},
					],
				});

				console.log("AI valuation result:", object);

				// Token usage tracking
				const totalInputTokens =
					(searchUsage.inputTokens ?? 0) + (valuationUsage.inputTokens ?? 0);
				const totalOutputTokens =
					(searchUsage.outputTokens ?? 0) + (valuationUsage.outputTokens ?? 0);
				const totalTokens = totalInputTokens + totalOutputTokens;

				// gpt-5-mini pricing per 1M tokens
				const GPT5_MINI_INPUT_COST_PER_M = 0.25;
				const GPT5_MINI_OUTPUT_COST_PER_M = 2.0;
				const TOKENS_PER_M = 1_000_000;
				const estimatedCostUSD =
					(totalInputTokens * GPT5_MINI_INPUT_COST_PER_M) / TOKENS_PER_M +
					(totalOutputTokens * GPT5_MINI_OUTPUT_COST_PER_M) / TOKENS_PER_M;

				console.log("=== AI VALUATION TOKEN USAGE ===");
				console.log(
					`Web Search - Input: ${searchUsage.inputTokens}, Output: ${searchUsage.outputTokens}, Total: ${searchUsage.totalTokens}`,
				);
				console.log(
					`Valuation  - Input: ${valuationUsage.inputTokens}, Output: ${valuationUsage.outputTokens}, Total: ${valuationUsage.totalTokens}`,
				);
				console.log(
					`Combined   - Input: ${totalInputTokens}, Output: ${totalOutputTokens}, Total: ${totalTokens}`,
				);
				console.log(`Estimated Cost: $${estimatedCostUSD.toFixed(6)} USD`);
				console.log("================================");

				return {
					success: true,
					valuation: object,
					message: "Valoración por IA generada exitosamente",
					usage: {
						webSearch: {
							inputTokens: searchUsage.inputTokens,
							outputTokens: searchUsage.outputTokens,
							totalTokens: searchUsage.totalTokens,
						},
						valuation: {
							inputTokens: valuationUsage.inputTokens,
							outputTokens: valuationUsage.outputTokens,
							totalTokens: valuationUsage.totalTokens,
						},
						total: {
							inputTokens: totalInputTokens,
							outputTokens: totalOutputTokens,
							totalTokens,
						},
						estimatedCostUSD: Number(estimatedCostUSD.toFixed(6)),
					},
				};
			} catch (error) {
				console.error("AI valuation error:", error);

				// Return user-friendly error
				throw new ORPCError("BAD_REQUEST", {
					message:
						"No se pudo generar la valoración por IA. Por favor complete la valoración manualmente.",
				});
			}
		}),

	// Vehicle Documents Management
	getVehicleDocuments: crmProcedure
		.input(z.object({ vehicleId: z.string().uuid() }))
		.handler(async ({ input }) => {
			// Verify user has access to the vehicle
			const [vehicle] = await db
				.select()
				.from(vehicles)
				.where(eq(vehicles.id, input.vehicleId))
				.limit(1);

			if (!vehicle) {
				throw new ORPCError("NOT_FOUND", { message: "Vehículo no encontrado" });
			}

			// Get documents with uploader info
			const documents = await db
				.select({
					id: vehicleDocuments.id,
					filename: vehicleDocuments.filename,
					originalName: vehicleDocuments.originalName,
					mimeType: vehicleDocuments.mimeType,
					size: vehicleDocuments.size,
					documentType: vehicleDocuments.documentType,
					description: vehicleDocuments.description,
					uploadedAt: vehicleDocuments.uploadedAt,
					filePath: vehicleDocuments.filePath,
					uploadedBy: vehicleDocuments.uploadedBy,
				})
				.from(vehicleDocuments)
				.where(eq(vehicleDocuments.vehicleId, input.vehicleId))
				.orderBy(vehicleDocuments.uploadedAt);

			// Generate signed URLs for each document
			const documentsWithUrls = await Promise.all(
				documents.map(async (doc) => {
					const url = await getFileUrl(doc.filePath);
					return {
						...doc,
						url,
					};
				}),
			);

			return documentsWithUrls;
		}),

	uploadVehicleDocument: crmProcedure
		.input(
			z.object({
				vehicleId: z.string().uuid(),
				documentType: z.string(),
				description: z.string().optional(),
				file: z.object({
					name: z.string(),
					type: z.string(),
					size: z.number(),
					key: z.string(), // R2 key from presigned upload
				}),
			}),
		)
		.handler(async ({ input, context }) => {
			// Verify vehicle exists
			const [vehicle] = await db
				.select()
				.from(vehicles)
				.where(eq(vehicles.id, input.vehicleId))
				.limit(1);

			if (!vehicle) {
				throw new ORPCError("NOT_FOUND", { message: "Vehículo no encontrado" });
			}

			// Admin, sales, sales_supervisor and analyst can upload documents
			if (
				!["admin", "sales", "sales_supervisor", "analyst"].includes(
					context.userRole,
				)
			) {
				throw new ORPCError("FORBIDDEN", {
					message: "No tienes permiso para subir documentos",
				});
			}

			const uploadedFile = await verifyUploadedDocumentInR2({
				key: input.file.key,
				expectedPrefix: buildUploadPrefix("vehicle_document", input.vehicleId),
				filename: input.file.name,
				mimeType: input.file.type,
			});
			const uniqueFilename = uploadedFile.key.split("/").pop()!;
			// Save to database
			const [newDocument] = await db
				.insert(vehicleDocuments)
				.values({
					vehicleId: input.vehicleId,
					filename: uniqueFilename,
					originalName: input.file.name,
					mimeType: uploadedFile.mimeType,
					size: uploadedFile.size,
					documentType: input.documentType,
					description: input.description || undefined,
					uploadedBy: context.userId,
					filePath: uploadedFile.key,
				})
				.returning();

			// Update analysis checklist if it exists
			const { updateChecklistForVehicleDocument } = await import(
				"../lib/checklist"
			);
			await updateChecklistForVehicleDocument(
				input.vehicleId,
				input.documentType,
				newDocument.id,
			);

			return newDocument;
		}),

	deleteVehicleDocument: crmProcedure
		.input(z.object({ documentId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			// Get document
			const [document] = await db
				.select()
				.from(vehicleDocuments)
				.where(eq(vehicleDocuments.id, input.documentId))
				.limit(1);

			if (!document) {
				throw new ORPCError("NOT_FOUND", {
					message: "Documento no encontrado",
				});
			}

			// Verify permissions (admin or uploader)
			if (
				context.userRole === "admin" ||
				document.uploadedBy === context.userId
			) {
				// Delete from R2
				await deleteFileFromR2(document.filePath);

				// Delete from database
				await db
					.delete(vehicleDocuments)
					.where(eq(vehicleDocuments.id, input.documentId));

				return { success: true };
			}

			throw new ORPCError("FORBIDDEN", {
				message: "No tienes permiso para eliminar este documento",
			});
		}),
};

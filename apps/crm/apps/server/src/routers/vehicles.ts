import { openai } from "@ai-sdk/openai";
import { ORPCError } from "@orpc/server";
import { generateObject } from "ai";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
	mapOCRToVehicleForm,
	vehicleRegistrationOCRSchema,
} from "../lib/ocr-schema";
import {
	prepareValuationContext,
	vehicleValuationSchema,
} from "../lib/valuation-schema";
import { db } from "../db";
import {
	casosCobros,
	contratosFinanciamiento,
	conveniosPago,
	inspectionChecklistItems,
	type NewInspectionChecklistItem,
	type NewVehicle,
	type NewVehicleInspection,
	type NewVehiclePhoto,
	vehicleDocuments,
	vehicleInspections,
	vehiclePhotos,
	vehicles,
} from "../db/schema";
import { crmProcedure, protectedProcedure, publicProcedure } from "../lib/orpc";
import {
	deleteFileFromR2,
	generateUniqueFilename,
	getFileUrl,
	uploadFileToR2,
	validateFile,
} from "../lib/storage";

export const vehiclesRouter = {
	// Get all vehicles with their latest inspection and photos
	getAll: publicProcedure
		.input(
			z.object({
				limit: z.number().optional().default(10),
				offset: z.number().optional().default(0),
				query: z.string().optional(),
				status: z.string().optional(),
				category: z.string().optional(),
			}).optional()
		)
		.handler(async ({ input }) => {
			const limit = input?.limit ?? 10;
			const offset = input?.offset ?? 0;
			const query = input?.query;
			const status = input?.status;
			const category = input?.category;

			// Build conditions
			const conditions = [];
			if (query) {
				conditions.push(
					or(
						ilike(vehicles.make, `%${query}%`),
						ilike(vehicles.model, `%${query}%`),
						ilike(vehicles.licensePlate, `%${query}%`),
						ilike(vehicles.vinNumber, `%${query}%`),
					)
				);
			}
			if (status && status !== 'all') {
				conditions.push(eq(vehicles.status, status as any));
			}

			// Category filters
			if (category === 'commercial') {
				conditions.push(eq(vehicleInspections.vehicleRating, 'Comercial'));
			} else if (category === 'non-commercial') {
				conditions.push(eq(vehicleInspections.vehicleRating, 'No comercial'));
			} else if (category === 'alerts') {
				conditions.push(sql`json_array_length(${vehicleInspections.alerts}) > 0`);
			}

			// 1. Get total count and paginated IDs
			// We need to join if we are filtering by inspection properties
			const needsJoin = category === 'commercial' || category === 'non-commercial' || category === 'alerts';

			const idsQueryBase = db
				.selectDistinct({ id: vehicles.id, createdAt: vehicles.createdAt })
				.from(vehicles);

			const countQueryBase = db
				.select({ count: sql<number>`count(distinct ${vehicles.id})` })
				.from(vehicles);

			const idsQuery = needsJoin
				? idsQueryBase.innerJoin(vehicleInspections, eq(vehicles.id, vehicleInspections.vehicleId))
				: idsQueryBase;

			const countQuery = needsJoin
				? countQueryBase.innerJoin(vehicleInspections, eq(vehicles.id, vehicleInspections.vehicleId))
				: countQueryBase;

			const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

			const [totalResult] = await countQuery.where(whereClause);
			const total = Number(totalResult?.count || 0);

			const paginatedIds = await idsQuery
				.where(whereClause)
				.orderBy(desc(vehicles.createdAt))
				.limit(limit)
				.offset(offset);

			const vehicleIdsArray = paginatedIds.map(r => r.id);

			if (vehicleIdsArray.length === 0) {
				return {
					data: [],
					total,
					limit,
					offset
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
				.where(
					or(...vehicleIdsArray.map(id => eq(vehicles.id, id)))
				)
				.orderBy(desc(vehicles.createdAt));

			// Get photos only for these vehicles
			const allPhotos = await db
				.select()
				.from(vehiclePhotos)
				.where(
					or(...vehicleIdsArray.map(id => eq(vehiclePhotos.vehicleId, id)))
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

			// Get all checklist items for all inspections of these vehicles
			const allInspectionIds = result
				.filter((row) => row.vehicle_inspections)
				.map((row) => row.vehicle_inspections!.id);

			const allChecklistItems =
				allInspectionIds.length > 0
					? await db
						.select()
						.from(inspectionChecklistItems)
						.where(
							or(...allInspectionIds.map(id => eq(inspectionChecklistItems.inspectionId, id)))
						)
						.orderBy(inspectionChecklistItems.category)
					: [];

			// Group checklist items by inspection ID
			const checklistByInspection = new Map();
			allChecklistItems.forEach((item) => {
				if (!checklistByInspection.has(item.inspectionId)) {
					checklistByInspection.set(item.inspectionId, []);
				}
				checklistByInspection.get(item.inspectionId).push(item);
			});

			// Group vehicles with their inspections and photos
			const vehiclesMap = new Map();

			// Initialize map with the order of IDs to preserve sort order
			vehicleIdsArray.forEach(_id => {
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
					const inspectionWithChecklist = {
						...row.vehicle_inspections,
						checklistItems:
							checklistByInspection.get(row.vehicle_inspections.id) || [],
					};
					vehiclesMap.get(vehicleId).inspections.push(inspectionWithChecklist);
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
				.map(id => vehiclesMap.get(id))
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
				offset
			};
		}),

	// Get vehicle by ID with all related data
	getById: protectedProcedure
		.input(z.object({ id: z.string() }))
		.handler(async ({ input }) => {
			const [vehicle] = await db
				.select()
				.from(vehicles)
				.where(eq(vehicles.id, input.id))
				.limit(1);

			if (!vehicle) {
				throw new Error("Vehículo no encontrado");
			}

			const inspections = await db
				.select()
				.from(vehicleInspections)
				.where(eq(vehicleInspections.vehicleId, input.id))
				.orderBy(desc(vehicleInspections.createdAt));

			// Get checklist items for each inspection
			const inspectionsWithChecklist = await Promise.all(
				inspections.map(async (inspection) => {
					const checklistItems = await db
						.select()
						.from(inspectionChecklistItems)
						.where(eq(inspectionChecklistItems.inspectionId, inspection.id))
						.orderBy(inspectionChecklistItems.category);

					return {
						...inspection,
						checklistItems,
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

	// Create new vehicle
	create: protectedProcedure
		.input(
			z.object({
				make: z.string(),
				model: z.string(),
				year: z.number(),
				licensePlate: z.string(),
				vinNumber: z.string(),
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
			}),
		)
		.handler(async ({ input }) => {
			const [newVehicle] = await db
				.insert(vehicles)
				.values(input as NewVehicle)
				.returning();

			return newVehicle;
		}),

	// Update vehicle
	update: protectedProcedure
		.input(
			z.object({
				id: z.string(),
				data: z.object({
					make: z.string().optional(),
					model: z.string().optional(),
					year: z.number().optional(),
					licensePlate: z.string().optional(),
					vinNumber: z.string().optional(),
					color: z.string().optional(),
					vehicleType: z.string().optional(),
					milesMileage: z.number().nullable().optional(),
					kmMileage: z.number().optional(),
					origin: z.string().optional(),
					cylinders: z.string().optional(),
					engineCC: z.string().optional(),
					fuelType: z.string().optional(),
					transmission: z.string().optional(),
					companyId: z.string().nullable().optional(),
					status: z
						.enum(["pending", "available", "sold", "maintenance", "auction"])
						.optional(),
				}),
			}),
		)
		.handler(async ({ input }) => {
			const [updated] = await db
				.update(vehicles)
				.set({
					...input.data,
					updatedAt: new Date(),
				})
				.where(eq(vehicles.id, input.id))
				.returning();

			return updated;
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

	// Create vehicle inspection
	createInspection: protectedProcedure
		.input(
			z.object({
				vehicleId: z.string(),
				technicianName: z.string(),
				inspectionDate: z.date(),
				inspectionResult: z.string(),
				vehicleRating: z.string(),
				marketValue: z.string(),
				suggestedCommercialValue: z.string(),
				bankValue: z.string(),
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
				throw new Error("Inspección no encontrada");
			}

			const photos = await db
				.select()
				.from(vehiclePhotos)
				.where(eq(vehiclePhotos.inspectionId, input.id));

			return {
				...inspection,
				photos,
			};
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
					make: z.string(),
					model: z.string(),
					year: z.number(),
					licensePlate: z.string(),
					vinNumber: z.string(),
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
				}),
				// Inspection data
				inspection: z.object({
					technicianName: z.string(),
					inspectionDate: z.date(),
					inspectionResult: z.string(),
					vehicleRating: z.enum(["Comercial", "No comercial"]),
					marketValue: z.string(),
					suggestedCommercialValue: z.string(),
					bankValue: z.string(),
					currentConditionValue: z.string(),
					vehicleEquipment: z.string(),
					importantConsiderations: z.string().optional(),
					scannerUsed: z.boolean(),
					scannerResultUrl: z.string().optional(),
					airbagWarning: z.boolean(),
					missingAirbag: z.string().optional(),
					testDrive: z.boolean(),
					noTestDriveReason: z.string().optional(),
				}),
				// Checklist items
				checklistItems: z.array(
					z.object({
						category: z.string(),
						item: z.string(),
						checked: z.boolean(),
						severity: z.string().optional().default("critical"),
					}),
				),
				// Photo URLs (optional, can be added later)
				photos: z
					.array(
						z.object({
							category: z.string(),
							photoType: z.string(),
							title: z.string(),
							description: z.string().optional(),
							url: z.string(),
						}),
					)
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
					// 1. Check if vehicle exists by VIN or create new
					let vehicleId: string;
					const existingVehicle = await tx
						.select()
						.from(vehicles)
						.where(eq(vehicles.vinNumber, input.vehicle.vinNumber))
						.limit(1);

					if (existingVehicle.length > 0) {
						// Update existing vehicle
						const [updated] = await tx
							.update(vehicles)
							.set({
								...input.vehicle,
								updatedAt: new Date(),
							})
							.where(eq(vehicles.vinNumber, input.vehicle.vinNumber))
							.returning();
						vehicleId = updated.id;
					} else {
						// Create new vehicle
						const [newVehicle] = await tx
							.insert(vehicles)
							.values({
								...input.vehicle,
								status: "pending",
							} as NewVehicle)
							.returning();
						vehicleId = newVehicle.id;
					}

					// 2. Create inspection - Clean numeric values
					const cleanValue = (value: string): string => {
						// Remove formatting but keep as string for the database
						return Number.parseFloat(value.replace(/[,_\s]/g, "")).toString();
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
							status: "pending",
							alerts: [],
						} as NewVehicleInspection)
						.returning();

					// 3. Create checklist items
					if (input.checklistItems.length > 0) {
						await tx.insert(inspectionChecklistItems).values(
							input.checklistItems.map(
								(item) =>
									({
										inspectionId: newInspection.id,
										...item,
									}) as NewInspectionChecklistItem,
							),
						);
					}

					// 4. Create photos if provided
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

					// 5. Update vehicle status based on checklist
					const criticalIssues = input.checklistItems.filter(
						(item) => item.checked && item.severity === "critical",
					);

					if (criticalIssues.length > 0) {
						await tx
							.update(vehicles)
							.set({
								status: "maintenance",
								updatedAt: new Date(),
							})
							.where(eq(vehicles.id, vehicleId));

						// Safely handle alerts array - ensure proper JSON serialization
						const alertsArray = criticalIssues.map((item) => item.item);

						await tx
							.update(vehicleInspections)
							.set({
								status: "rejected",
								alerts: alertsArray,
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
				throw new Error(
					`Error al guardar la inspección: ${error instanceof Error ? error.message : "Error desconocido"}`,
				);
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

ESPECIFICACIONES TÉCNICAS:
- VIN/Chasis/Serie (números de identificación únicos)
- Motor/CC (cilindrada)
- Cilindros (número)
- Asientos (número)

REGLAS IMPORTANTES:
- Si encuentras al menos 3 campos correctos: extractionSuccess = true
- Si extraes menos de 3 campos: extractionSuccess = false  
- Siempre retorna un objeto JSON válido con extractionSuccess como boolean y extractionErrors como array
- Deja campos vacíos ("") si no los encuentras claramente
- NO uses estructura "properties", retorna el objeto directamente
- Ejemplo correcto: {"licensePlate": "P0-123ABC", "make": "TOYOTA", "line": "COROLLA", "model": "2020", "extractionSuccess": true, "extractionErrors": []}`,
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

				const { object } = await generateObject({
					model: openai("gpt-4o-mini"),
					schema: vehicleValuationSchema,
					messages: [
						{
							role: "system",
							content: `Eres un experto valuador de vehículos en Guatemala con más de 20 años de experiencia en el mercado automotriz guatemalteco.

Tu tarea es realizar una valoración precisa de vehículos basada en:

CONTEXTO DEL MERCADO GUATEMALTECO:
- Ubicación: Ciudad de Guatemala
- Moneda: Quetzales (GTQ)
- Mercado: Vehículos usados Guatemala 2024-2025
- Depreciación promedio: 15-20% anual
- Factores locales: Importación, impuestos, disponibilidad de repuestos

METODOLOGÍA DE VALORACIÓN:
1. Analizar marca, modelo, año y depreciación
2. Evaluar condición técnica y estética
3. Considerar kilometraje y mantenimiento
4. Revisar equipamiento y características especiales
5. Aplicar ajustes por problemas detectados
6. Comparar con mercado local

RANGOS DE VALORES TÍPICOS (Referencia):
- Económicos: Q25,000 - Q80,000
- Medianos: Q80,000 - Q200,000  
- Premium: Q200,000 - Q500,000+

Proporciona una valoración conservadora pero realista para el mercado guatemalteco.`,
						},
						{
							role: "user",
							content: `Valora este vehículo con la siguiente información:

INFORMACIÓN BÁSICA:
- Marca: ${context.make}
- Modelo/Línea: ${context.model}
- Año: ${context.year} (${context.age} años de antigüedad)
- Tipo: ${context.vehicleType}
- Color: ${context.color}
- Origen: ${context.origin}

ESPECIFICACIONES TÉCNICAS:
- Motor: ${context.engineCC} CC, ${context.cylinders} cilindros
- Combustible: ${context.fuelType}
- Transmisión: ${context.transmission}
- Kilometraje: ${context.kmMileage} km

CONDICIÓN Y ESTADO:
- Fecha de inspección: ${context.inspectionDate}
- Técnico: ${context.technicianName}
- Observaciones generales: ${context.inspectionResult}
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
${context.hasPhotoComments
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

				return {
					success: true,
					valuation: object,
					message: "Valoración por IA generada exitosamente",
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
				throw new Error("Vehículo no encontrado");
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
					data: z.string(), // Base64
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
				throw new Error("Vehículo no encontrado");
			}

			// Only admin and sales can upload documents
			if (!["admin", "sales"].includes(context.userRole)) {
				throw new Error("No tienes permiso para subir documentos");
			}

			// Create File/Blob from data
			const fileBuffer = Buffer.from(input.file.data, "base64");
			const fileBlob = new Blob([fileBuffer], { type: input.file.type });

			// Validate file
			const validation = validateFile({
				type: input.file.type,
				size: input.file.size,
			} as File);

			if (!validation.valid) {
				throw new Error(validation.error);
			}

			// Generate unique filename
			const uniqueFilename = generateUniqueFilename(input.file.name);

			// Upload to R2
			const { key } = await uploadFileToR2(
				fileBlob,
				uniqueFilename,
				input.vehicleId,
			);

			// Save to database
			const [newDocument] = await db
				.insert(vehicleDocuments)
				.values({
					vehicleId: input.vehicleId,
					filename: uniqueFilename,
					originalName: input.file.name,
					mimeType: input.file.type,
					size: input.file.size,
					documentType: input.documentType,
					description: input.description,
					uploadedBy: context.userId,
					filePath: key,
				})
				.returning();

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
				throw new Error("Documento no encontrado");
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

			throw new Error("No tienes permiso para eliminar este documento");
		}),
};

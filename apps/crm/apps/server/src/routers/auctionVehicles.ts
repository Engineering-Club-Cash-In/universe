import { and, desc, eq } from "drizzle-orm";
import z from "zod";
import { auctionExpenses, auctionVehicles } from "../db/schema/auctionVehicles";
import { db } from "../db";
import {
	vehicleInspections,
	vehiclePhotos,
	vehicles,
} from "../db/schema/vehicles";
import { protectedProcedure } from "../lib/orpc";

export const auctionRouter = {
	/**
	 * Create an auction entry for a vehicle
	 * - Validates that the vehicle exists
	 * - Gets the latest inspection to extract the marketValue
	 * - Requires auctionPrice and calculates lossValue = marketValue - auctionPrice
	 * - Inserts into auction_vehicles
	 * - Updates vehicle.status to "auction"
	 */
	createAuction: protectedProcedure
		.input(
			z.object({
				vehicleId: z.string().uuid(),
				description: z.string(),
				auctionPrice: z.string(), // required now!
			}),
		)
		.handler(async ({ input }) => {
			const { vehicleId, description, auctionPrice } = input;

			// 1. Validate vehicle exists
			const [vehicle] = await db
				.select()
				.from(vehicles)
				.where(eq(vehicles.id, vehicleId))
				.limit(1);

			if (!vehicle) {
				throw new Error("Vehicle not found");
			}

			// 2. Get latest inspection to fetch marketValue
			const [latestInspection] = await db
				.select()
				.from(vehicleInspections)
				.where(eq(vehicleInspections.vehicleId, vehicleId))
				.orderBy(desc(vehicleInspections.inspectionDate))
				.limit(1);

			if (!latestInspection) {
				throw new Error("No inspection found for this vehicle");
			}

			const marketValue = latestInspection.marketValue;

			// 3. Calculate lossValue
			const m = Number.parseFloat(marketValue.toString());
			const a = Number.parseFloat(auctionPrice.toString());
			const lossValue = (m - a).toFixed(2);

			// 4. Insert auction entry
			const [newAuction] = await db
				.insert(auctionVehicles)
				.values({
					vehicleId,
					description,
					marketValue,
					auctionPrice,
					lossValue,
					status: "pending",
				})
				.returning();

			// 5. Update vehicle status -> auction
			await db
				.update(vehicles)
				.set({ status: "auction" })
				.where(eq(vehicles.id, vehicleId));

			await db
				.update(vehicleInspections)
				.set({ status: "auction" })
				.where(eq(vehicleInspections.vehicleId, vehicleId));

			return newAuction;
		}),

	/**
	 * Add an expense for a given auction
	 * - Inserts into auction_expenses
	 */
	addAuctionExpense: protectedProcedure
		.input(
			z.object({
				auctionId: z.string().uuid(),
				description: z.string(),
				amount: z.string(), // keep as string for NUMERIC
			}),
		)
		.handler(async ({ input }) => {
			const { auctionId, description, amount } = input;

			const [expense] = await db
				.insert(auctionExpenses)
				.values({
					auctionId,
					description,
					amount,
				})
				.returning();

			return expense;
		}),
	/**
	 * Close an auction (mark as sold)
	 * - Validates vehicle and auction existence
	 * - Requires auctionPrice
	 * - Recalculates lossValue = marketValue - auctionPrice
	 * - Updates auction_vehicles.status = "sold"
	 * - Updates vehicles.status = "sold"
	 */
	closeAuction: protectedProcedure
		.input(
			z.object({
				vehicleId: z.string().uuid(),
				auctionPrice: z.string(), // required final sale price
			}),
		)
		.handler(async ({ input }) => {
			const { vehicleId, auctionPrice } = input;

			// 1. Validate vehicle exists
			const [vehicle] = await db
				.select()
				.from(vehicles)
				.where(eq(vehicles.id, vehicleId))
				.limit(1);

			if (!vehicle) {
				throw new Error("Vehicle not found");
			}

			// 2. Get auction record
			const [auction] = await db
				.select()
				.from(auctionVehicles)
				.where(eq(auctionVehicles.vehicleId, vehicleId))
				.limit(1);

			if (!auction) {
				throw new Error("Auction entry not found for this vehicle");
			}

			// 3. Get latest inspection to fetch marketValue
			const [latestInspection] = await db
				.select()
				.from(vehicleInspections)
				.where(eq(vehicleInspections.vehicleId, vehicleId))
				.orderBy(desc(vehicleInspections.inspectionDate))
				.limit(1);

			if (!latestInspection) {
				throw new Error("No inspection found for this vehicle");
			}

			const marketValue = Number.parseFloat(
				latestInspection.marketValue.toString(),
			);
			const finalAuctionPrice = Number.parseFloat(auctionPrice.toString());
			const lossValue = (marketValue - finalAuctionPrice).toFixed(2);

			// 4. Update auction record
			const [updatedAuction] = await db
				.update(auctionVehicles)
				.set({
					auctionPrice: auctionPrice,
					lossValue,
					status: "sold",
				})
				.where(eq(auctionVehicles.vehicleId, vehicleId))
				.returning();

			// 5. Update vehicle status -> sold
			await db
				.update(vehicles)
				.set({ status: "sold" })
				.where(eq(vehicles.id, vehicleId));

			return updatedAuction;
		}) /**
	 * Get paginated auctions with vehicle, inspection and expenses info
	 * Optional filters: vehicleId, status
	 */ /**
	 * Get paginated auctions with vehicle, inspection, photos and expenses info
	 * Optional filters: vehicleId, status
	 */,
	getAuctions: protectedProcedure
		.input(
			z.object({
				page: z.number().min(1).default(1),
				limit: z.number().min(1).max(50).default(10),
				vehicleId: z.string().uuid().optional(),
				status: z
					.enum(["pending", "available", "sold", "maintenance", "auction"])
					.optional(),
			}),
		)
		.handler(async ({ input }) => {
			const { page, limit, vehicleId, status } = input;
			const offset = (page - 1) * limit;

			const conditions = [];
			if (vehicleId) conditions.push(eq(auctionVehicles.vehicleId, vehicleId));
			if (status) conditions.push(eq(vehicles.status, status));

			const whereCondition =
				conditions.length > 0 ? and(...conditions) : undefined;

			const auctions = await db
				.select({
					// Auction
					auctionId: auctionVehicles.id,
					description: auctionVehicles.description,
					auctionStatus: auctionVehicles.status,
					auctionPrice: auctionVehicles.auctionPrice,
					lossValue: auctionVehicles.lossValue,

					// Vehicle
					vehicleId: vehicles.id,
					make: vehicles.make,
					model: vehicles.model,
					year: vehicles.year,
					licensePlate: vehicles.licensePlate,
					vinNumber: vehicles.vinNumber,
					color: vehicles.color,
					vehicleType: vehicles.vehicleType,
					kmMileage: vehicles.kmMileage,
					milesMileage: vehicles.milesMileage,
					origin: vehicles.origin,
					cylinders: vehicles.cylinders,
					engineCC: vehicles.engineCC,
					fuelType: vehicles.fuelType,
					transmission: vehicles.transmission,
					seguroVigente: vehicles.seguroVigente,
					numeroPoliza: vehicles.numeroPoliza,
					companiaSeguro: vehicles.companiaSeguro,
					fechaInicioSeguro: vehicles.fechaInicioSeguro,
					fechaVencimientoSeguro: vehicles.fechaVencimientoSeguro,
					montoAsegurado: vehicles.montoAsegurado,
					deducible: vehicles.deducible,
					tipoCobertura: vehicles.tipoCobertura,
					gpsActivo: vehicles.gpsActivo,
					dispositivoGPS: vehicles.dispositivoGPS,
					imeiGPS: vehicles.imeiGPS,
					ubicacionActualGPS: vehicles.ubicacionActualGPS,
					ultimaSeñalGPS: vehicles.ultimaSeñalGPS,
					vehicleStatus: vehicles.status,

					// Inspection
					inspectionId: vehicleInspections.id,
					inspectionDate: vehicleInspections.inspectionDate,
					inspectionResult: vehicleInspections.inspectionResult,
					technicianName: vehicleInspections.technicianName,
					vehicleRating: vehicleInspections.vehicleRating,
					marketValue: vehicleInspections.marketValue,
					bankValue: vehicleInspections.bankValue,
					suggestedCommercialValue: vehicleInspections.suggestedCommercialValue,
					currentConditionValue: vehicleInspections.currentConditionValue,
					vehicleEquipment: vehicleInspections.vehicleEquipment,
					importantConsiderations: vehicleInspections.importantConsiderations,
					scannerUsed: vehicleInspections.scannerUsed,
					scannerResultUrl: vehicleInspections.scannerResultUrl,
					airbagWarning: vehicleInspections.airbagWarning,
					missingAirbag: vehicleInspections.missingAirbag,
					testDrive: vehicleInspections.testDrive,
					noTestDriveReason: vehicleInspections.noTestDriveReason,
					inspectionStatus: vehicleInspections.status,
					alerts: vehicleInspections.alerts,

					// Photos
					photoId: vehiclePhotos.id,
					photoUrl: vehiclePhotos.url,
					photoTitle: vehiclePhotos.title,
					photoCategory: vehiclePhotos.category,
					photoDescription: vehiclePhotos.description,
					photoType: vehiclePhotos.photoType,
					valuatorComment: vehiclePhotos.valuatorComment,
					noCommentsChecked: vehiclePhotos.noCommentsChecked,

					// Expenses
					expenseId: auctionExpenses.id,
					expenseDescription: auctionExpenses.description,
					expenseAmount: auctionExpenses.amount,
				})
				.from(auctionVehicles)
				.innerJoin(vehicles, eq(vehicles.id, auctionVehicles.vehicleId))
				.leftJoin(
					vehicleInspections,
					eq(vehicleInspections.vehicleId, vehicles.id),
				)
				.leftJoin(vehiclePhotos, eq(vehiclePhotos.vehicleId, vehicles.id)) // 👈 fotos
				.leftJoin(
					auctionExpenses,
					eq(auctionExpenses.auctionId, auctionVehicles.id),
				)
				.where(whereCondition)
				.orderBy(desc(auctionVehicles.createdAt))
				.limit(limit)
				.offset(offset);

			// Group rows into nested structure
			const grouped = auctions.reduce((acc, row) => {
				let auction = acc.find((a: { auctionId: string }) => a.auctionId === row.auctionId);
				if (!auction) {
					auction = {
						auctionId: row.auctionId,
						description: row.description,
						auctionStatus: row.auctionStatus,
						auctionPrice: row.auctionPrice,
						lossValue: row.lossValue,
						vehicle: {
							id: row.vehicleId,
							make: row.make,
							model: row.model,
							year: row.year,
							licensePlate: row.licensePlate,
							vinNumber: row.vinNumber,
							color: row.color,
							vehicleType: row.vehicleType,
							kmMileage: row.kmMileage,
							milesMileage: row.milesMileage,
							origin: row.origin,
							cylinders: row.cylinders,
							engineCC: row.engineCC,
							fuelType: row.fuelType,
							transmission: row.transmission,
							seguroVigente: row.seguroVigente,
							numeroPoliza: row.numeroPoliza,
							companiaSeguro: row.companiaSeguro,
							fechaInicioSeguro: row.fechaInicioSeguro,
							fechaVencimientoSeguro: row.fechaVencimientoSeguro,
							montoAsegurado: row.montoAsegurado,
							deducible: row.deducible,
							tipoCobertura: row.tipoCobertura,
							gpsActivo: row.gpsActivo,
							dispositivoGPS: row.dispositivoGPS,
							imeiGPS: row.imeiGPS,
							ubicacionActualGPS: row.ubicacionActualGPS,
							ultimaSeñalGPS: row.ultimaSeñalGPS,
							status: row.vehicleStatus,
						},
						inspections: [],
						photos: [],
						expenses: [],
					};
					acc.push(auction);
				}

				// Agrupar inspecciones
				if (
					row.inspectionId &&
					!auction.inspections.find(
						(i: { id: string }) => i.id === row.inspectionId,
					)
				) {
					auction.inspections.push({
						id: row.inspectionId,
						date: row.inspectionDate,
						result: row.inspectionResult,
						technicianName: row.technicianName,
						rating: row.vehicleRating,
						marketValue: row.marketValue,
						bankValue: row.bankValue,
						suggestedCommercialValue: row.suggestedCommercialValue,
						currentConditionValue: row.currentConditionValue,
						vehicleEquipment: row.vehicleEquipment,
						importantConsiderations: row.importantConsiderations,
						scannerUsed: row.scannerUsed,
						scannerResultUrl: row.scannerResultUrl,
						airbagWarning: row.airbagWarning,
						missingAirbag: row.missingAirbag,
						testDrive: row.testDrive,
						noTestDriveReason: row.noTestDriveReason,
						status: row.inspectionStatus,
						alerts: row.alerts,
					});
				}

				// Agrupar fotos
				if (
					row.photoId &&
					!auction.photos.find(
						(p: { id: string | null }) => p.id === row.photoId,
					)
				) {
					auction.photos.push({
						id: row.photoId,
						url: row.photoUrl,
						title: row.photoTitle,
						category: row.photoCategory,
						description: row.photoDescription,
						type: row.photoType,
						valuatorComment: row.valuatorComment,
						noCommentsChecked: row.noCommentsChecked,
					});
				}

				// Agrupar gastos
				if (
					row.expenseId &&
					!auction.expenses.find((e: { id: string }) => e.id === row.expenseId)
				) {
					auction.expenses.push({
						id: row.expenseId,
						description: row.expenseDescription,
						amount: row.expenseAmount,
					});
				}

				return acc;
			}, [] as any[]);

			return {
				page,
				limit,
				data: grouped,
			};
		}),

	/**
	 * Cancel an auction (remove auction entry and reset vehicle)
	 * - Validates vehicle and auction existence
	 * - Deletes auction record
	 * - Updates vehicles.status = "pending"
	 * - Updates inspections.status = "pending"
	 */
	cancelAuction: protectedProcedure
		.input(
			z.object({
				vehicleId: z.string().uuid(),
			}),
		)
		.handler(async ({ input }) => {
			const { vehicleId } = input;

			// 1. Validate vehicle exists
			const [vehicle] = await db
				.select()
				.from(vehicles)
				.where(eq(vehicles.id, vehicleId))
				.limit(1);

			if (!vehicle) {
				throw new Error("Vehicle not found");
			}

			// 2. Validate auction entry exists
			const [auction] = await db
				.select()
				.from(auctionVehicles)
				.where(eq(auctionVehicles.vehicleId, vehicleId))
				.limit(1);

			if (!auction) {
				throw new Error("Auction entry not found for this vehicle");
			}

			// 3. Delete auction record
			await db
				.delete(auctionVehicles)
				.where(eq(auctionVehicles.vehicleId, vehicleId));

			// 4. Reset vehicle status -> pending
			await db
				.update(vehicles)
				.set({ status: "pending" })
				.where(eq(vehicles.id, vehicleId));

			// 5. Reset inspections -> pending
			await db
				.update(vehicleInspections)
				.set({ status: "pending" })
				.where(eq(vehicleInspections.vehicleId, vehicleId));

			return {
				success: true,
				message: "Auction canceled, vehicle and inspections reset to pending",
			};
		}),
};

import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { vehicleInspections, vehicles } from "../db/schema/vehicles";
import { protectedProcedure } from "../lib/orpc";
import { auctionExpenses, auctionVehicles } from "@/db/schema/auctionVehicles";
import z from "zod";

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
      })
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
      const m = parseFloat(marketValue.toString());
      const a = parseFloat(auctionPrice.toString());
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

      return newAuction;
    }),

  /**
   * Add an expense for a given auction
   * - Inserts into auction_expenses
   */
  addAuctionExpense: protectedProcedure
    .input(
      z.object({
        auctionId: z.uuid(),
        description: z.string(),
        amount: z.string(), // keep as string for NUMERIC
      })
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
      })
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

      const marketValue = parseFloat(latestInspection.marketValue.toString());
      const finalAuctionPrice = parseFloat(auctionPrice.toString());
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
    }), /**
   * Get paginated auctions with vehicle, inspection and expenses info
   * Optional filters: vehicleId, status
   */
  getAuctions: protectedProcedure
    .input(
      z.object({
        page: z.number().min(1).default(1),
        limit: z.number().min(1).max(50).default(10),
        vehicleId: z.string().uuid().optional(), // optional filter
        status: z
          .enum(["pending", "available", "sold", "maintenance", "auction"])
          .optional(), // optional filter by vehicle status
      })
    )
    .handler(async ({ input }) => {
      const { page, limit, vehicleId, status } = input;
      const offset = (page - 1) * limit;

      // Build dynamic conditions
      const conditions = [];
      if (vehicleId) conditions.push(eq(auctionVehicles.vehicleId, vehicleId));
      if (status) conditions.push(eq(vehicles.status, status));

      const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

      // Query auctions with joins
      const auctions = await db
        .select({
          // Auction info
          auctionId: auctionVehicles.id,
          description: auctionVehicles.description,
          auctionStatus: auctionVehicles.status,
          auctionPrice: auctionVehicles.auctionPrice,
          lossValue: auctionVehicles.lossValue,

          // Vehicle info
          vehicleId: vehicles.id,
          model: vehicles.model,
          year: vehicles.year,
          licensePlate: vehicles.licensePlate,
          vehicleType: vehicles.vehicleType,
          milesMileage: vehicles.milesMileage,
          kmMileage: vehicles.kmMileage,
          origin: vehicles.origin,
          cylinders: vehicles.cylinders,
          engineCC: vehicles.engineCC,
          fuelType: vehicles.fuelType,
          transmission: vehicles.transmission,
          seguroVigente: vehicles.seguroVigente,
          vehicleStatus: vehicles.status, // ✅ included

          // Inspection info
          inspectionDate: vehicleInspections.inspectionDate,
          inspectionResult: vehicleInspections.inspectionResult,
          vehicleRating: vehicleInspections.vehicleRating,
          marketValue: vehicleInspections.marketValue,
          bankValue: vehicleInspections.bankValue,

          // Expenses info
          expenseId: auctionExpenses.id,
          expenseDescription: auctionExpenses.description,
          expenseAmount: auctionExpenses.amount,
        })
        .from(auctionVehicles)
        .innerJoin(vehicles, eq(vehicles.id, auctionVehicles.vehicleId))
        .leftJoin(vehicleInspections, eq(vehicleInspections.vehicleId, vehicles.id))
        .leftJoin(auctionExpenses, eq(auctionExpenses.auctionId, auctionVehicles.id))
        .where(whereCondition)
        .orderBy(desc(auctionVehicles.createdAt))
        .limit(limit)
        .offset(offset);

      // Group expenses per auction
      const grouped = auctions.reduce((acc, row) => {
        let auction = acc.find((a) => a.auctionId === row.auctionId);
        if (!auction) {
          auction = {
            auctionId: row.auctionId,
            description: row.description,
            auctionStatus: row.auctionStatus,
            auctionPrice: row.auctionPrice,
            lossValue: row.lossValue,
            vehicle: {
              vehicleId: row.vehicleId,
              model: row.model,
              year: row.year,
              licensePlate: row.licensePlate,
              vehicleType: row.vehicleType,
              milesMileage: row.milesMileage,
              kmMileage: row.kmMileage,
              origin: row.origin,
              cylinders: row.cylinders,
              engineCC: row.engineCC,
              fuelType: row.fuelType,
              transmission: row.transmission,
              seguroVigente: row.seguroVigente,
              status: row.vehicleStatus, // ✅ vehicle status grouped
            },
            inspection: {
              inspectionDate: row.inspectionDate,
              inspectionResult: row.inspectionResult,
              vehicleRating: row.vehicleRating,
              marketValue: row.marketValue,
              bankValue: row.bankValue,
            },
            expenses: [],
          };
          acc.push(auction);
        }
        if (row.expenseId) {
          auction.expenses.push({
            expenseId: row.expenseId,
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
};

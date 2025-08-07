import { z } from "zod";
import { eq, desc, and, or, ilike } from "drizzle-orm";
import { db } from "../db";
import { 
  vehicles, 
  vehicleInspections, 
  vehiclePhotos,
  type NewVehicle,
  type NewVehicleInspection,
  type NewVehiclePhoto
} from "../db/schema";
import { publicProcedure, protectedProcedure } from "../lib/orpc";

export const vehiclesRouter = {
  // Get all vehicles with their latest inspection
  getAll: protectedProcedure
    .handler(async () => {
      const result = await db
        .select()
        .from(vehicles)
        .leftJoin(
          vehicleInspections,
          eq(vehicles.id, vehicleInspections.vehicleId)
        )
        .orderBy(desc(vehicles.createdAt));

      // Group vehicles with their inspections
      const vehiclesMap = new Map();
      
      result.forEach(row => {
        const vehicleId = row.vehicles.id;
        
        if (!vehiclesMap.has(vehicleId)) {
          vehiclesMap.set(vehicleId, {
            ...row.vehicles,
            inspections: []
          });
        }
        
        if (row.vehicle_inspections) {
          vehiclesMap.get(vehicleId).inspections.push(row.vehicle_inspections);
        }
      });

      return Array.from(vehiclesMap.values());
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

      const photos = await db
        .select()
        .from(vehiclePhotos)
        .where(eq(vehiclePhotos.vehicleId, input.id))
        .orderBy(vehiclePhotos.category, vehiclePhotos.photoType);

      return {
        ...vehicle,
        inspections,
        photos
      };
    }),

  // Create new vehicle
  create: protectedProcedure
    .input(z.object({
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
      status: z.string().optional().default("pending")
    }))
    .handler(async ({ input }) => {
      const [newVehicle] = await db
        .insert(vehicles)
        .values(input as NewVehicle)
        .returning();

      return newVehicle;
    }),

  // Update vehicle
  update: protectedProcedure
    .input(z.object({
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
        status: z.string().optional()
      })
    }))
    .handler(async ({ input }) => {
      const [updated] = await db
        .update(vehicles)
        .set({
          ...input.data,
          updatedAt: new Date()
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
    .input(z.object({
      query: z.string().optional(),
      status: z.string().optional(),
      vehicleType: z.string().optional(),
      fuelType: z.string().optional()
    }))
    .handler(async ({ input }) => {
      let conditions = [];

      if (input.query) {
        conditions.push(
          or(
            ilike(vehicles.make, `%${input.query}%`),
            ilike(vehicles.model, `%${input.query}%`),
            ilike(vehicles.licensePlate, `%${input.query}%`),
            ilike(vehicles.vinNumber, `%${input.query}%`)
          )
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
    .input(z.object({
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
      alerts: z.array(z.string()).optional().default([])
    }))
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
            updatedAt: new Date()
          })
          .where(eq(vehicles.id, input.vehicleId));
      }

      return newInspection;
    }),

  // Update inspection
  updateInspection: protectedProcedure
    .input(z.object({
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
        status: z.string().optional(),
        alerts: z.array(z.string()).optional()
      })
    }))
    .handler(async ({ input }) => {
      const [updated] = await db
        .update(vehicleInspections)
        .set({
          ...input.data,
          updatedAt: new Date()
        })
        .where(eq(vehicleInspections.id, input.id))
        .returning();

      return updated;
    }),

  // Upload vehicle photo
  uploadPhoto: protectedProcedure
    .input(z.object({
      vehicleId: z.string(),
      inspectionId: z.string().nullable().optional(),
      category: z.string(),
      photoType: z.string(),
      title: z.string(),
      description: z.string().optional(),
      url: z.string()
    }))
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
        photos
      };
    }),

  // Get statistics
  getStatistics: protectedProcedure
    .handler(async () => {
      const allVehicles = await db.select().from(vehicles);
      const allInspections = await db.select().from(vehicleInspections);

      const stats = {
        totalVehicles: allVehicles.length,
        availableVehicles: allVehicles.filter(v => v.status === "available").length,
        pendingVehicles: allVehicles.filter(v => v.status === "pending").length,
        soldVehicles: allVehicles.filter(v => v.status === "sold").length,
        totalInspections: allInspections.length,
        approvedInspections: allInspections.filter(i => i.status === "approved").length,
        pendingInspections: allInspections.filter(i => i.status === "pending").length,
        rejectedInspections: allInspections.filter(i => i.status === "rejected").length,
        commercialVehicles: allInspections.filter(i => i.vehicleRating === "Comercial").length,
        nonCommercialVehicles: allInspections.filter(i => i.vehicleRating === "No comercial").length,
        vehiclesWithAlerts: allInspections.filter(i => i.alerts && (i.alerts as string[]).length > 0).length
      };

      return stats;
    })
};
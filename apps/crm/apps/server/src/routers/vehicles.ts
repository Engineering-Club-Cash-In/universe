import { z } from "zod";
import { eq, desc, and, or, ilike } from "drizzle-orm";
import { db } from "../db";
import { 
  vehicles, 
  vehicleInspections, 
  vehiclePhotos,
  inspectionChecklistItems,
  type NewVehicle,
  type NewVehicleInspection,
  type NewVehiclePhoto,
  type NewInspectionChecklistItem
} from "../db/schema";
import { contratosFinanciamiento, conveniosPago, casosCobros } from "../db/schema/cobros";
import { protectedProcedure, publicProcedure } from "../lib/orpc";

export const vehiclesRouter = {
  // Get all vehicles with their latest inspection and photos
  getAll: publicProcedure
    .handler(async () => {
      const result = await db
        .select()
        .from(vehicles)
        .leftJoin(
          vehicleInspections,
          eq(vehicles.id, vehicleInspections.vehicleId)
        )
        .orderBy(desc(vehicles.createdAt));

      // Get all photos for all vehicles
      const allPhotos = await db
        .select()
        .from(vehiclePhotos)
        .orderBy(vehiclePhotos.category, vehiclePhotos.photoType);

      // Group photos by vehicle ID
      const photosByVehicle = new Map();
      allPhotos.forEach(photo => {
        if (!photosByVehicle.has(photo.vehicleId)) {
          photosByVehicle.set(photo.vehicleId, []);
        }
        photosByVehicle.get(photo.vehicleId).push(photo);
      });

      // Get all checklist items for all inspections
      const allInspectionIds = result
        .filter(row => row.vehicle_inspections)
        .map(row => row.vehicle_inspections!.id);
      
      const allChecklistItems = allInspectionIds.length > 0 
        ? await db
            .select()
            .from(inspectionChecklistItems)
            .orderBy(inspectionChecklistItems.category)
        : [];

      // Group checklist items by inspection ID
      const checklistByInspection = new Map();
      allChecklistItems.forEach(item => {
        if (!checklistByInspection.has(item.inspectionId)) {
          checklistByInspection.set(item.inspectionId, []);
        }
        checklistByInspection.get(item.inspectionId).push(item);
      });

      // Group vehicles with their inspections and photos
      const vehiclesMap = new Map();
      
      result.forEach(row => {
        const vehicleId = row.vehicles.id;
        
        if (!vehiclesMap.has(vehicleId)) {
          vehiclesMap.set(vehicleId, {
            ...row.vehicles,
            inspections: [],
            photos: photosByVehicle.get(vehicleId) || []
          });
        }
        
        if (row.vehicle_inspections) {
          const inspectionWithChecklist = {
            ...row.vehicle_inspections,
            checklistItems: checklistByInspection.get(row.vehicle_inspections.id) || []
          };
          vehiclesMap.get(vehicleId).inspections.push(inspectionWithChecklist);
        }
      });

      // Get payment agreements for vehicles
      const allVehicleIds = Array.from(vehiclesMap.keys());
      const vehicleConvenios = allVehicleIds.length > 0 ? await db
        .select({
          vehicleId: contratosFinanciamiento.vehicleId,
          hasActiveConvenio: conveniosPago.activo,
        })
        .from(contratosFinanciamiento)
        .leftJoin(casosCobros, eq(contratosFinanciamiento.id, casosCobros.contratoId))
        .leftJoin(conveniosPago, eq(casosCobros.id, conveniosPago.casoCobroId))
        .where(and(
          or(...allVehicleIds.map(id => eq(contratosFinanciamiento.vehicleId, id))),
          eq(conveniosPago.activo, true)
        )) : [];

      // Add convenio info to vehicles
      const vehiclesWithConvenios = Array.from(vehiclesMap.values()).map(vehicle => ({
        ...vehicle,
        hasPaymentAgreement: vehicleConvenios.some(c => c.vehicleId === vehicle.id && c.hasActiveConvenio)
      }));

      return vehiclesWithConvenios;
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
            checklistItems
          };
        })
      );

      const photos = await db
        .select()
        .from(vehiclePhotos)
        .where(eq(vehiclePhotos.vehicleId, input.id))
        .orderBy(vehiclePhotos.category, vehiclePhotos.photoType);

      return {
        ...vehicle,
        inspections: inspectionsWithChecklist,
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
  getStatistics: publicProcedure
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
    }),

  // Create full inspection with all data (vehicle + inspection + checklist)
  createFullInspection: publicProcedure
    .input(z.object({
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
      checklistItems: z.array(z.object({
        category: z.string(),
        item: z.string(),
        checked: z.boolean(),
        severity: z.string().optional().default("critical"),
      })),
      // Photo URLs (optional, can be added later)
      photos: z.array(z.object({
        category: z.string(),
        photoType: z.string(),
        title: z.string(),
        description: z.string().optional(),
        url: z.string(),
      })).optional(),
    }))
    .handler(async ({ input }) => {
      // Log incoming data for debugging
      console.log('=== createFullInspection DEBUG ===');
      console.log('Vehicle data:', JSON.stringify(input.vehicle, null, 2));
      console.log('Inspection data:', JSON.stringify(input.inspection, null, 2));
      console.log('Checklist items count:', input.checklistItems?.length || 0);
      console.log('Photos count:', input.photos?.length || 0);
      
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
          return parseFloat(value.replace(/[,_\s]/g, '')).toString();
        };
        
        const [newInspection] = await tx
          .insert(vehicleInspections)
          .values({
            vehicleId,
            ...input.inspection,
            marketValue: cleanValue(input.inspection.marketValue),
            suggestedCommercialValue: cleanValue(input.inspection.suggestedCommercialValue),
            bankValue: cleanValue(input.inspection.bankValue),
            currentConditionValue: cleanValue(input.inspection.currentConditionValue),
            status: "pending",
            alerts: [],
          } as NewVehicleInspection)
          .returning();

        // 3. Create checklist items
        if (input.checklistItems.length > 0) {
          await tx
            .insert(inspectionChecklistItems)
            .values(
              input.checklistItems.map(item => ({
                inspectionId: newInspection.id,
                ...item,
              } as NewInspectionChecklistItem))
            );
        }

        // 4. Create photos if provided
        if (input.photos && input.photos.length > 0) {
          await tx
            .insert(vehiclePhotos)
            .values(
              input.photos.map(photo => ({
                vehicleId,
                inspectionId: newInspection.id,
                ...photo,
              } as NewVehiclePhoto))
            );
        }

        // 5. Update vehicle status based on checklist
        const criticalIssues = input.checklistItems.filter(
          item => item.checked && item.severity === "critical"
        );
        
        if (criticalIssues.length > 0) {
          await tx
            .update(vehicles)
            .set({ 
              status: "maintenance",
              updatedAt: new Date()
            })
            .where(eq(vehicles.id, vehicleId));
            
          // Safely handle alerts array - ensure proper JSON serialization
          const alertsArray = criticalIssues.map(item => item.item);
          
          await tx
            .update(vehicleInspections)
            .set({
              status: "rejected",
              alerts: alertsArray,
              updatedAt: new Date()
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
        console.error('Error in createFullInspection:', error);
        throw new Error(`Error al guardar la inspección: ${error instanceof Error ? error.message : 'Error desconocido'}`);
      }
    })
};
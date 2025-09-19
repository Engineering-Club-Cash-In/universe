import { z } from "zod";
import { eq, desc, and, or, ilike } from "drizzle-orm";
import { db } from "../db";
import { 
  vehicleVendors,
  type NewVehicleVendor
} from "../db/schema/vehicles";
import { protectedProcedure, crmProcedure } from "../lib/orpc";

export const vendorsRouter = {
  // Get all vendors
  getAll: crmProcedure
    .handler(async () => {
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
        throw new Error("Vendedor no encontrado");
      }

      return vendor;
    }),

  // Create new vendor
  create: crmProcedure
    .input(z.object({
      name: z.string().min(1, "El nombre es requerido"),
      phone: z.string().min(1, "El teléfono es requerido"),
      dpi: z.string().min(13, "DPI debe tener 13 dígitos").max(13, "DPI debe tener 13 dígitos"),
      vendorType: z.enum(["individual", "empresa"], { message: "Tipo de vendedor requerido" }),
      companyName: z.string().optional(),
      email: z.string().email().optional().or(z.literal("")),
      address: z.string().optional(),
    }))
    .handler(async ({ input }) => {
      // Check if DPI already exists
      const existingVendor = await db
        .select()
        .from(vehicleVendors)
        .where(eq(vehicleVendors.dpi, input.dpi))
        .limit(1);

      if (existingVendor.length > 0) {
        throw new Error("Ya existe un vendedor con este DPI");
      }

      const [newVendor] = await db
        .insert(vehicleVendors)
        .values({
          ...input,
          email: input.email || null,
        } as NewVehicleVendor)
        .returning();

      return newVendor;
    }),

  // Update vendor
  update: crmProcedure
    .input(z.object({
      id: z.string(),
      data: z.object({
        name: z.string().min(1, "El nombre es requerido"),
        phone: z.string().min(1, "El teléfono es requerido"),
        dpi: z.string().min(13, "DPI debe tener 13 dígitos").max(13, "DPI debe tener 13 dígitos"),
        vendorType: z.enum(["individual", "empresa"]),
        companyName: z.string().optional(),
        email: z.string().email().optional().or(z.literal("")),
        address: z.string().optional(),
      })
    }))
    .handler(async ({ input }) => {
      // Check if DPI exists for another vendor
      const existingVendor = await db
        .select()
        .from(vehicleVendors)
        .where(and(
          eq(vehicleVendors.dpi, input.data.dpi),
          eq(vehicleVendors.id, input.id)
        ))
        .limit(1);

      const [updated] = await db
        .update(vehicleVendors)
        .set({
          ...input.data,
          email: input.data.email || null,
          updatedAt: new Date()
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

  // Search vendors
  search: crmProcedure
    .input(z.object({
      query: z.string().optional(),
      vendorType: z.string().optional(),
    }))
    .handler(async ({ input }) => {
      let conditions = [];

      if (input.query) {
        conditions.push(
          or(
            ilike(vehicleVendors.name, `%${input.query}%`),
            ilike(vehicleVendors.dpi, `%${input.query}%`),
            ilike(vehicleVendors.phone, `%${input.query}%`),
            ilike(vehicleVendors.companyName, `%${input.query}%`)
          )
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
};
import type { Context } from "hono";
import { eq, ne, or, and } from "drizzle-orm";
import { db } from "../db";
import { leads, opportunities } from "../db/schema/crm";

/**
 * Middleware to validate portal token (Better Auth session token)
 */
export async function validatePortalToken(c: Context, next: () => Promise<void>) {
  try {
    const authHeader = c.req.header("Authorization");
    
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return c.json(
        {
          success: false,
          error: "Token de autorización no proporcionado",
        },
        401
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const secret = process.env.BETTER_SECRET_PORTAL_WEB;

    if (!secret) {
      console.error("[ERROR] BETTER_SECRET_PORTAL_WEB not configured");
      return c.json(
        {
          success: false,
          error: "Configuración de autorización no disponible",
        },
        500
      );
    }

    await next();
  } catch (error: any) {
    console.error("[ERROR] validatePortalToken:", error);
    return c.json(
      {
        success: false,
        error: "Error al validar token",
      },
      500
    );
  }
}

/**
 * Get lead information by email
 */
export async function getLeadByEmail(c: Context) {
  try {
    const { email } = c.req.query();

    if (!email) {
      return c.json(
        {
          success: false,
          error: "El correo es requerido",
        },
        400
      );
    }

    const [lead] = await db
      .select({
        id: leads.id,
        firstName: leads.firstName,
        lastName: leads.lastName,
        email: leads.email,
        phone: leads.phone,
        dpi: leads.dpi,
        direccion: leads.direccion,
        age: leads.age,
        clientType: leads.clientType,
        maritalStatus: leads.maritalStatus,
        dependents: leads.dependents,
        monthlyIncome: leads.monthlyIncome,
        loanAmount: leads.loanAmount,
        occupation: leads.occupation,
        workTime: leads.workTime,
        loanPurpose: leads.loanPurpose,
        ownsHome: leads.ownsHome,
        ownsVehicle: leads.ownsVehicle,
        hasCreditCard: leads.hasCreditCard,
        jobTitle: leads.jobTitle,
        status: leads.status,
        source: leads.source,
        createdAt: leads.createdAt,
        updatedAt: leads.updatedAt,
      })
      .from(leads)
      .where(eq(leads.email, email))
      .limit(1);

    if (!lead) {
      return c.json(
        {
          success: false,
          error: "Lead no encontrado",
        },
        404
      );
    }

    return c.json({
      success: true,
      data: lead,
    });
  } catch (error: any) {
    console.error("[ERROR] getLeadByEmail:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Error al obtener el lead",
      },
      500
    );
  }
}

/**
 * Update lead information by email
 */
export async function updateLeadByEmail(c: Context) {
  try {
    const body = await c.req.json();
    const { email, address, dpi, phone } = body;

    if (!email) {
      return c.json(
        {
          success: false,
          error: "El correo es requerido",
        },
        400
      );
    }

    // Check if lead exists
    const [existingLead] = await db
      .select()
      .from(leads)
      .where(eq(leads.email, email))
      .limit(1);

    if (!existingLead) {
      return c.json(
        {
          success: false,
          error: "Lead no encontrado",
        },
        404
      );
    }

    // Check if new DPI or phone already exists in another lead
    if (dpi !== undefined || phone !== undefined) {
      const conditions = [ne(leads.email, email)];
      const orConditions = [];

      if (dpi !== undefined) {
        orConditions.push(eq(leads.dpi, dpi));
      }

      if (phone !== undefined) {
        orConditions.push(eq(leads.phone, phone));
      }

      const [conflict] = await db
        .select()
        .from(leads)
        .where(and(...conditions, or(...orConditions)))
        .limit(1);

      if (conflict) {
        if (dpi !== undefined && conflict.dpi === dpi) {
          return c.json(
            {
              success: false,
              error: "El DPI ya está registrado en otro lead",
            },
            409
          );
        }
        if (phone !== undefined && conflict.phone === phone) {
          return c.json(
            {
              success: false,
              error: "El teléfono ya está registrado en otro lead",
            },
            409
          );
        }
      }
    }

    // Build update object with only provided fields
    const updateData: any = {
      updatedAt: new Date(),
    };

    if (address !== undefined) {
      updateData.direccion = address;
    }

    if (dpi !== undefined) {
      updateData.dpi = dpi;
    }

    if (phone !== undefined) {
      updateData.phone = phone;
    }

    // Update the lead
    const [updatedLead] = await db
      .update(leads)
      .set(updateData)
      .where(eq(leads.email, email))
      .returning({
        id: leads.id,
        firstName: leads.firstName,
        lastName: leads.lastName,
        email: leads.email,
        phone: leads.phone,
        dpi: leads.dpi,
        direccion: leads.direccion,
        updatedAt: leads.updatedAt,
      });

    // If address was updated, also update all opportunities associated with this lead
    if (address !== undefined && updatedLead) {
      await db
        .update(opportunities)
        .set({ 
          direccion: address,
          updatedAt: new Date(),
        })
        .where(eq(opportunities.leadId, updatedLead.id));
    }

    return c.json({
      success: true,
      data: updatedLead,
    });
  } catch (error: any) {
    console.error("[ERROR] updateLeadByEmail:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Error al actualizar el lead",
      },
      500
    );
  }
}

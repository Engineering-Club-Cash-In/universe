import type { Context } from "hono";
import { eq, ne, or, and, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { leads, opportunities } from "../db/schema/crm";
import { opportunityDocuments } from "../db/schema/documents";
import { generatedLegalContracts } from "../db/schema/legal-contracts";
import { vehicles, vehiclePhotos } from "../db/schema/vehicles";
import { user } from "../db/schema/auth";
import { getRenapInfoController } from "./bot";
import { getFileUrl } from "../lib/storage";

/**
 * Función auxiliar para encontrar un lead por email o DPI
 * Retorna el lead completo si lo encuentra, null si no
 */
async function findLeadByEmailOrDpi(email?: string, dpi?: string) {
	// Validar que se proporcione al menos uno
	if (!email && !dpi) {
		return { error: "Se debe proporcionar email o DPI", status: 400 as const };
	}

	// Construir condiciones de búsqueda
	const conditions = [];
	if (email && email.trim() !== "") {
		conditions.push(eq(leads.email, email));
	}
	if (dpi && dpi.trim() !== "") {
		conditions.push(eq(leads.dpi, dpi));
	}

	// Buscar el lead
	const [lead] = await db
		.select()
		.from(leads)
		.where(or(...conditions))
		.limit(1);

	if (!lead) {
		return { error: "Lead no encontrado", status: 404 as const };
	}

	return { lead };
}

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
 * Get lead information by email or DPI
 */
export async function getLeadByEmail(c: Context) {
  try {
    const { email, dpi } = c.req.query();

    // Buscar el lead usando la función auxiliar
    const result = await findLeadByEmailOrDpi(email, dpi);

    // Si hay error, retornar
    if ("error" in result) {
      return c.json(
        {
          success: false,
          error: result.error,
        },
        result.status
      );
    }

    // Seleccionar solo los campos necesarios
    const lead = {
      id: result.lead.id,
      firstName: result.lead.firstName,
      lastName: result.lead.lastName,
      email: result.lead.email,
      phone: result.lead.phone,
      dpi: result.lead.dpi,
      direccion: result.lead.direccion,
      age: result.lead.age,
      clientType: result.lead.clientType,
      maritalStatus: result.lead.maritalStatus,
      dependents: result.lead.dependents,
      monthlyIncome: result.lead.monthlyIncome,
      loanAmount: result.lead.loanAmount,
      occupation: result.lead.occupation,
      workTime: result.lead.workTime,
      loanPurpose: result.lead.loanPurpose,
      ownsHome: result.lead.ownsHome,
      ownsVehicle: result.lead.ownsVehicle,
      hasCreditCard: result.lead.hasCreditCard,
      jobTitle: result.lead.jobTitle,
      status: result.lead.status,
      source: result.lead.source,
      createdAt: result.lead.createdAt,
      updatedAt: result.lead.updatedAt,
    };

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
 * Update lead information by email or DPI
 */
export async function updateLeadByEmail(c: Context) {
  try {
    const body = await c.req.json();
    const { email, dpi, address, phone } = body;

    // Buscar el lead usando la función auxiliar (email o dpi como identificadores)
    const result = await findLeadByEmailOrDpi(email);

    // Si hay error, retornar
    if ("error" in result) {
      return c.json(
        {
          success: false,
          error: result.error,
        },
        result.status
      );
    }

    const existingLead = result.lead;

    // Check if new DPI or phone already exists in another lead
    if (dpi !== undefined || phone !== undefined) {
      const conditions = [ne(leads.id, existingLead.id)];
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
      .where(eq(leads.id, existingLead.id))
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

    // If DPI was updated, call RENAP to get information
    let renapInfo = null;
    if (dpi !== undefined && dpi.trim() !== "" && updatedLead) {
      const phoneToUse = phone ?? existingLead.phone ?? "";
      renapInfo = await getRenapInfoController(dpi, phoneToUse);
    }

    return c.json({
      success: true,
      data: updatedLead,
      renapInfo,
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

/**
 * Get all opportunity documents for a lead by email or DPI
 */
export async function getLeadOpportunityDocuments(c: Context) {
  try {
    const { email, dpi } = c.req.query();

    // Buscar el lead usando la función auxiliar
    const result = await findLeadByEmailOrDpi(email, dpi);

    // Si hay error, retornar
    if ("error" in result) {
      return c.json(
        {
          success: false,
          error: result.error,
        },
        result.status
      );
    }

    const lead = result.lead;

    // Get all opportunities for this lead
    const leadOpportunities = await db
      .select({ id: opportunities.id, title: opportunities.title })
      .from(opportunities)
      .where(eq(opportunities.leadId, lead.id));

    if (leadOpportunities.length === 0) {
      return c.json({
        success: true,
        data: [],
      });
    }

    const opportunityIds = leadOpportunities.map((opp) => opp.id);

    // Get all documents for these opportunities
    // Using DISTINCT ON to get only one document per documentType (the most recent one)
    const documents = await db
      .selectDistinctOn([opportunityDocuments.documentType], {
        id: opportunityDocuments.id,
        filename: opportunityDocuments.filename,
        originalName: opportunityDocuments.originalName,
        mimeType: opportunityDocuments.mimeType,
        size: opportunityDocuments.size,
        documentType: opportunityDocuments.documentType,
        description: opportunityDocuments.description,
        uploadedAt: opportunityDocuments.uploadedAt,
        filePath: opportunityDocuments.filePath,
        opportunityId: opportunityDocuments.opportunityId,
        uploadedBy: {
          id: user.id,
          name: user.name,
        },
      })
      .from(opportunityDocuments)
      .leftJoin(user, eq(opportunityDocuments.uploadedBy, user.id))
      .where(inArray(opportunityDocuments.opportunityId, opportunityIds))
      .orderBy(opportunityDocuments.documentType, sql`${opportunityDocuments.uploadedAt} DESC`);

    // Generate signed URLs for each document
    const documentsWithUrls = await Promise.all(
      documents.map(async (doc) => {
        const url = await getFileUrl(doc.filePath);
        const opportunity = leadOpportunities.find(
          (opp) => opp.id === doc.opportunityId
        );
        return {
          ...doc,
          url,
          opportunity: {
            id: opportunity?.id,
            title: opportunity?.title,
          },
        };
      })
    );

    return c.json({
      success: true,
      data: documentsWithUrls,
    });
  } catch (error: any) {
    console.error("[ERROR] getLeadOpportunityDocuments:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Error al obtener los documentos",
      },
      500
    );
  }
}

/**
 * Get all legal contracts for a lead by email or DPI
 */
export async function getLeadLegalContracts(c: Context) {
  try {
    const { email, dpi } = c.req.query();

    // Buscar el lead usando la función auxiliar
    const result = await findLeadByEmailOrDpi(email, dpi);

    // Si hay error, retornar
    if ("error" in result) {
      return c.json(
        {
          success: false,
          error: result.error,
        },
        result.status
      );
    }

    const lead = result.lead;

    // Get all contracts for this lead
    const contracts = await db
      .select({
        contract: generatedLegalContracts,
        lead: {
          id: leads.id,
          firstName: leads.firstName,
          lastName: leads.lastName,
          dpi: leads.dpi,
          email: leads.email,
          phone: leads.phone,
        },
        opportunity: {
          id: opportunities.id,
          title: opportunities.title,
          value: opportunities.value,
        },
      })
      .from(generatedLegalContracts)
      .innerJoin(leads, eq(generatedLegalContracts.leadId, leads.id))
      .leftJoin(
        opportunities,
        eq(generatedLegalContracts.opportunityId, opportunities.id),
      )
      .where(eq(generatedLegalContracts.leadId, lead.id))
      .orderBy(generatedLegalContracts.generatedAt);

    return c.json({
      success: true,
      data: contracts,
    });
  } catch (error: any) {
    console.error("[ERROR] getLeadLegalContracts:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Error al obtener los contratos",
      },
      500
    );
  }
}

/**
 * Get SIFCO numbers for a lead by email or DPI
 */
export async function getSifcoNumbersByDpi(c: Context) {
  try {
    const { email, dpi } = c.req.query();

    // Buscar el lead usando la función auxiliar
    const result = await findLeadByEmailOrDpi(email, dpi);

    // Si hay error y es 404, retornar array vacío (comportamiento original)
    if ("error" in result) {
      if (result.status === 404) {
        return c.json({
          success: true,
          data: [],
        });
      }
      return c.json(
        {
          success: false,
          error: result.error,
        },
        result.status
      );
    }

    const lead = result.lead;

    console.log("Lead found:", lead.id);

    // Get all opportunities with SIFCO numbers for this lead
    const opportunitiesWithSifco = await db
      .select({
        id: opportunities.id,
        title: opportunities.title,
        numeroSifco: opportunities.numeroSifco,
        vehicleId: opportunities.vehicleId,
      })
      .from(opportunities)
      .where(eq(opportunities.leadId, lead.id));

    // Get vehicle information and photos for opportunities that have vehicles
    const opportunitiesWithVehicleData = await Promise.all(
      opportunitiesWithSifco.map(async (opp) => {
        let vehicleData = null;
        
        if (opp.vehicleId) {
          // Get vehicle information
          const [vehicle] = await db
            .select()
            .from(vehicles)
            .where(eq(vehicles.id, opp.vehicleId))
            .limit(1);

          if (vehicle) {
            // Get vehicle photos
            const photos = await db
              .select()
              .from(vehiclePhotos)
              .where(eq(vehiclePhotos.vehicleId, opp.vehicleId));


            vehicleData = {
              id: vehicle.id,
              make: vehicle.make,
              model: vehicle.model,
              year: vehicle.year,
              licensePlate: vehicle.licensePlate,
              color: vehicle.color,
              status: vehicle.status,
              vin: vehicle.vinNumber,
              type: vehicle.vehicleType,
              origin: vehicle.origin,
              engine: vehicle.engineCC,
              photos
            };
          }
        }

        return {
          opportunityId: opp.id,
          opportunityTitle: opp.title,
          numeroSifco: opp.numeroSifco,
          vehicle: vehicleData,
        };
      })
    );

    // Filter only opportunities that have SIFCO numbers
    const sifcoNumbers = opportunitiesWithVehicleData.filter(
      (opp) => opp.numeroSifco && opp.numeroSifco.trim() !== ""
    );

    return c.json({
      success: true,
      data: sifcoNumbers,
    });
  } catch (error: any) {
    console.error("[ERROR] getSifcoNumbersByDpi:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Error al obtener los números SIFCO",
      },
      500
    );
  }
}

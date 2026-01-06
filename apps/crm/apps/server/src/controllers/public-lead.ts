import type { Context } from "hono";
import { asc, eq, or } from "drizzle-orm";
import { db } from "../db";
import { leads, opportunities, salesStages } from "../db/schema/crm";
import { user } from "../db/schema/auth";
import { getRenapInfoController } from "./bot";

export async function createPublicLead(c: Context) {
  try {
    const body = await c.req.json();

    // Validate required fields
    if (
      !body.firstName ||
      !body.lastName ||
      !body.email ||
      !body.dpi ||
      body.dpi.trim() === ""
    ) {
      return c.json(
        {
          success: false,
          error: "Faltan campos requeridos: Nombre, Apellido o Email o DPI",
        },
        400
      );
    }

    // Check if lead already exists with same email or DPI
    const existingLead = await db
      .select()
      .from(leads)
      .where(or(eq(leads.email, body.email), eq(leads.dpi, body.dpi)))
      .limit(1);

    if (existingLead.length > 0) {
      const lead = existingLead[0];

      // Si encontró el lead por DPI y no tiene email (o tiene un email diferente al enviado)
      if (lead.dpi === body.dpi && lead.email !== body.email) {
        // Actualizar el email del lead existente
        const [updatedLead] = await db
          .update(leads)
          .set({
            email: body.email,
            updatedAt: new Date(),
          })
          .where(eq(leads.id, lead.id))
          .returning();

        return c.json(
          {
            success: true,
            data: updatedLead,
            message: "Lead encontrado por DPI, email actualizado",
          },
          200
        );
      }

      // Si encontró el lead por email (o por DPI con el mismo email), solo retornar
      return c.json(
        {
          success: true,
          data: lead,
          message: "Lead ya existe con el mismo email o DPI",
        },
        200
      );
    }

    // Get first admin user to assign the lead
    const [systemUser] = await db
      .select()
      .from(user)
      .where(eq(user.role, "admin"))
      .limit(1);

    if (!systemUser) {
      return c.json(
        {
          success: false,
          error: "No hay usuario administrador disponible",
        },
        500
      );
    }

    // Create the lead
    const [newLead] = await db
      .insert(leads)
      .values({
        firstName: body.firstName,
        lastName: body.lastName,
        email: body.email,
        phone: body.phone,
        age: body.age,
        dpi: body.dpi,
        clientType: body.clientType || "individual",
        maritalStatus: body.maritalStatus,
        dependents: body.dependents ?? 0,
        monthlyIncome: body.monthlyIncome?.toString(),
        loanAmount: body.loanAmount?.toString(),
        occupation: body.occupation,
        workTime: body.workTime,
        loanPurpose: body.loanPurpose,
        ownsHome: body.ownsHome ?? false,
        ownsVehicle: body.ownsVehicle ?? false,
        hasCreditCard: body.hasCreditCard ?? false,
        jobTitle: body.jobTitle,
        notes: body.notes,
        source: body.source || "website",
        status: "new",
        assignedTo: systemUser.id,
        createdBy: systemUser.id,
        updatedAt: new Date(),
      })
      .returning();

    // INSERT RENAP INFO IF DPI AND PHONE ARE PROVIDED
    let renapInfo = null;
    if (body.dpi && body.dpi.trim() !== "" && body.phone) {
      renapInfo = await getRenapInfoController(body.dpi, body.phone);
    }

    // 2. Crear oportunidad vinculada al lead
    const [firstStage] = await db
      .select()
      .from(salesStages)
      .orderBy(asc(salesStages.order))
      .limit(1);

    if (!firstStage) {
      throw new Error("[ERROR] No sales stage found");
    }

    const [newOpportunity] = await db
      .insert(opportunities)
      .values({
        leadId: newLead.id,
        status: "open",
        probability: 0,
        stageId: firstStage.id, // Etapa inicial
        title: `Oportunidad de crédito para  ${newLead.firstName} ${newLead.lastName}`,
        companyId: undefined,
        assignedTo: systemUser.id,
        createdBy: systemUser.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return c.json({
      success: true,
      data: newLead,
      renapInfo,
      opportunity: newOpportunity,
    });
  } catch (error: any) {
    console.error("[ERROR] createPublicLead:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Error al crear el lead",
      },
      500
    );
  }
}

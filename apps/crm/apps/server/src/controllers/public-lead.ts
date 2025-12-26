import type { Context } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { leads } from "../db/schema/crm";
import { user } from "../db/schema/auth";
import { getRenapInfoController } from "./bot";

export async function createPublicLead(c: Context) {
  try {
    const body = await c.req.json();

    // Validate required fields
    if (!body.firstName || !body.lastName || !body.email || !body.phone) {
      return c.json(
        {
          success: false,
          error: "Faltan campos requeridos: firstName, lastName, email, phone",
        },
        400
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
    const renapInfo = await getRenapInfoController(body.dpi, body.phone);

    return c.json({
      success: true,
      data: newLead,
      renapInfo,
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

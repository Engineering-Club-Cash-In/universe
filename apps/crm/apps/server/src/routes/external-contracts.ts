import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db";
import { leads, opportunities } from "../db/schema/crm";
import { generatedLegalContracts } from "../db/schema/legal-contracts";
import { auth } from "../lib/auth";
import { eqDpi } from "../lib/dpi-lookup";
import { normalizarDpi } from "../utils/cui-validation";

const app = new Hono();

/**
 * Endpoint para crear contratos legales desde servicios externos (legal-docs-blueprints)
 * POST /api/contracts/external
 *
 * Requiere autenticación con cuenta de servicio
 */
app.post("/", async (c) => {
	try {
		// 1. Autenticar usando Better Auth
		const session = await auth.api.getSession({ headers: c.req.raw.headers });

		if (!session?.user) {
			return c.json(
				{
					success: false,
					error: "No autorizado - se requiere autenticación",
				},
				401,
			);
		}

		// 2. Verificar que el usuario sea la cuenta de servicio
		const serviceAccountEmail = "legaldocs@clubcashin.com";
		if (session.user.email !== serviceAccountEmail) {
			return c.json(
				{
					success: false,
					error: "No autorizado - se requiere cuenta de servicio",
				},
				403,
			);
		}

		// 3. Parsear body
		const body = await c.req.json();
		const {
			dpi,
			contractType,
			contractName,
			signingLinks,
			templateId,
			apiResponse,
			opportunityId,
		} = body;

		// 4. Validar campos requeridos
		if (!dpi || !contractType || !contractName) {
			return c.json(
				{
					success: false,
					error: "Faltan campos requeridos: dpi, contractType, contractName",
				},
				400,
			);
		}

		// 5. Resolver el lead.
		// Si el callback trae la oportunidad, ella manda: el contrato se guarda
		// contra ese `opportunityId`, así que el lead tiene que ser su dueño. Con
		// duplicados por DPI todavía en la base, buscar por DPI podía devolver
		// otra fila y dejar el contrato colgado de un lead que no posee esa
		// oportunidad, invisible para las consultas por lead y para el portal.
		let lead: typeof leads.$inferSelect | undefined;

		if (opportunityId) {
			const [owner] = await db
				.select({ lead: leads })
				.from(opportunities)
				.innerJoin(leads, eq(opportunities.leadId, leads.id))
				.where(eq(opportunities.id, opportunityId))
				.limit(1);

			lead = owner?.lead;

			if (lead && normalizarDpi(lead.dpi ?? "") !== normalizarDpi(dpi)) {
				console.warn(
					`[WARN] external-contracts: la oportunidad ${opportunityId} pertenece al lead ${lead.id}, cuyo DPI no coincide con el recibido (${dpi}). Se respeta el dueño de la oportunidad.`,
				);
			}
		}

		// Sin oportunidad en el callback (o inexistente), se cae al DPI y se usa
		// el lead más reciente, como antes.
		if (!lead) {
			const [foundByDpi] = await db
				.select()
				.from(leads)
				.where(eqDpi(leads.dpi, dpi))
				.orderBy(desc(leads.createdAt))
				.limit(1);

			lead = foundByDpi;
		}

		if (!lead) {
			return c.json(
				{
					success: false,
					error: `No se encontró lead con DPI: ${dpi}`,
				},
				404,
			);
		}

		// 6. Extraer signing links del array
		const [clientLink, representativeLink, ...additionalLinks] =
			signingLinks || [];

		// 7. Crear contrato en la base de datos
		const [newContract] = await db
			.insert(generatedLegalContracts)
			.values({
				leadId: lead.id,
				opportunityId: opportunityId || null,
				contractType,
				contractName,
				clientSigningLink: clientLink || null,
				representativeSigningLink: representativeLink || null,
				additionalSigningLinks:
					additionalLinks.length > 0 ? additionalLinks : null,
				templateId: templateId || null,
				apiResponse: apiResponse || null,
				status: "pending",
				generatedBy: session.user.id, // ID del usuario de servicio
				generatedAt: new Date(),
			})
			.returning();

		// 8. Retornar éxito
		return c.json(
			{
				success: true,
				data: {
					contractId: newContract.id,
					leadId: lead.id,
					leadName: `${lead.firstName} ${lead.lastName}`,
					contractType: newContract.contractType,
					contractName: newContract.contractName,
					status: newContract.status,
				},
			},
			201,
		);
	} catch (error) {
		console.error("[ERROR] /api/contracts/external:", error);
		return c.json(
			{
				success: false,
				error:
					error instanceof Error ? error.message : "Error interno del servidor",
			},
			500,
		);
	}
});

export default app;

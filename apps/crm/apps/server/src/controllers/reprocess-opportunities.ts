import { and, eq, isNull } from "drizzle-orm";
import type { Context } from "hono";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { opportunities } from "../db/schema/crm";
import { closeOpportunity } from "../services/close-opportunity";

const INTERVAL_MS = 6000;

export async function reprocessWonOpportunities(c: Context) {
	// Buscar un usuario admin
	const [adminUser] = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.role, "admin"))
		.limit(1);

	if (!adminUser) {
		return c.json({ error: "No se encontró un usuario admin" }, 500);
	}

	// Oportunidades ganadas sin número SIFCO
	const wonOpps = await db
		.select({ id: opportunities.id, title: opportunities.title })
		.from(opportunities)
		.where(
			and(
				eq(opportunities.status, "won"),
				isNull(opportunities.numeroSifco),
			),
		);

	if (wonOpps.length === 0) {
		return c.json({
			message: "No hay oportunidades ganadas sin número SIFCO",
			processed: 0,
			results: [],
		});
	}

	const results: Array<{
		opportunityId: string;
		title: string;
		success: boolean;
		numeroSifco?: string;
		error?: string;
	}> = [];

	for (const opp of wonOpps) {
		try {
			const result = await closeOpportunity({
				opportunityId: opp.id,
				userId: adminUser.id,
			});

			results.push({
				opportunityId: opp.id,
				title: opp.title,
				success: result.success,
				numeroSifco: result.numeroSifco,
				error: result.error,
			});
		} catch (error) {
			results.push({
				opportunityId: opp.id,
				title: opp.title,
				success: false,
				error: error instanceof Error ? error.message : String(error),
			});
		}

		// Intervalo para no saturar cartera-back
		if (wonOpps.indexOf(opp) < wonOpps.length - 1) {
			await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
		}
	}

	const successCount = results.filter((r) => r.success).length;

	return c.json({
		message: `Procesadas ${successCount}/${wonOpps.length} oportunidades`,
		processed: wonOpps.length,
		successCount,
		errorCount: wonOpps.length - successCount,
		results,
	});
}

import { eq } from "drizzle-orm";
import { db } from "../db";
import { juridicoDashboardSnapshots } from "../db/schema/juridico-dashboard";
import { updateJuridicoDashboardSnapshotInputSchema } from "../lib/juridico-dashboard-schema";
import { juridicoProcedure } from "../lib/orpc";

export const juridicoDashboardRouter = {
	getSnapshot: juridicoProcedure.handler(async ({ context: _ }) => {
		const [snapshot] = await db
			.select()
			.from(juridicoDashboardSnapshots)
			.where(eq(juridicoDashboardSnapshots.scope, "default"))
			.limit(1);

		return snapshot ?? null;
	}),

	updateSnapshot: juridicoProcedure
		.input(updateJuridicoDashboardSnapshotInputSchema)
		.handler(async ({ input, context }) => {
			const normalizedNotes = input.notes ?? null;

			const [snapshot] = await db
				.insert(juridicoDashboardSnapshots)
				.values({
					scope: "default",
					periodLabel: input.periodLabel,
					notes: normalizedNotes,
					payload: input.payload,
					updatedBy: context.userId,
					publishedAt: new Date(),
					updatedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: juridicoDashboardSnapshots.scope,
					set: {
						periodLabel: input.periodLabel,
						notes: normalizedNotes,
						payload: input.payload,
						updatedBy: context.userId,
						publishedAt: new Date(),
						updatedAt: new Date(),
					},
				})
				.returning();

			return snapshot;
		}),
};

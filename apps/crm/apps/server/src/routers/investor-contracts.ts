import { ORPCError } from "@orpc/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { investorContractBatches } from "../db/schema/investor-contracts";
import { juridicoProcedure } from "../lib/orpc";

/**
 * Las baterías de contratos de inversionistas: el trabajo que le abre a
 * jurídico cada compra de cartera aceptada.
 *
 * La fila la crea cartera (`routes/cartera-compra-aceptada.ts`). Acá se lee y se
 * mueve de estado; los contratos en sí cuelgan de ella y viven en
 * `generated_legal_contracts`.
 */

const ESTADOS = [
	"pendiente",
	"en_proceso",
	"completada",
	"descartada",
] as const;

/** Estados en los que la batería todavía es trabajo por hacer. */
const ABIERTAS = ["pendiente", "en_proceso"] as const;

export const investorContractsRouter = {
	listInvestorContractBatches: juridicoProcedure
		.input(
			z.object({
				/** Sin esto se devuelven sólo las que siguen abiertas. */
				status: z.array(z.enum(ESTADOS)).optional(),
				investorId: z.number().int().positive().optional(),
				limit: z.number().int().min(1).max(200).default(50),
			}),
		)
		.handler(async ({ input }) => {
			const estados = input.status?.length ? input.status : [...ABIERTAS];

			const filas = await db
				.select()
				.from(investorContractBatches)
				.where(
					and(
						inArray(investorContractBatches.status, estados),
						...(input.investorId
							? [eq(investorContractBatches.investorId, input.investorId)]
							: []),
					),
				)
				// Las más viejas primero: son las que llevan más tiempo esperando.
				.orderBy(investorContractBatches.acceptedAt)
				.limit(input.limit);

			return filas;
		}),

	getInvestorContractBatch: juridicoProcedure
		.input(z.object({ batchId: z.string().uuid() }))
		.handler(async ({ input }) => {
			const [fila] = await db
				.select()
				.from(investorContractBatches)
				.where(eq(investorContractBatches.id, input.batchId))
				.limit(1);

			if (!fila) {
				throw new ORPCError("NOT_FOUND", {
					message: "Esa batería de contratos no existe",
				});
			}

			return fila;
		}),

	/**
	 * Últimas baterías de un inversionista, abiertas o no.
	 *
	 * La ficha del inversionista la usa para mostrar de qué compra salió cada
	 * contrato.
	 */
	listInvestorContractBatchesByInvestor: juridicoProcedure
		.input(
			z.object({
				investorId: z.number().int().positive(),
				limit: z.number().int().min(1).max(50).default(10),
			}),
		)
		.handler(async ({ input }) => {
			return db
				.select()
				.from(investorContractBatches)
				.where(eq(investorContractBatches.investorId, input.investorId))
				.orderBy(desc(investorContractBatches.acceptedAt))
				.limit(input.limit);
		}),

	/**
	 * Jurídico toma la batería.
	 *
	 * Deja dicho quién la está trabajando, para que dos personas no emitan los
	 * mismos contratos en paralelo. No bloquea: avisa.
	 */
	startInvestorContractBatch: juridicoProcedure
		.input(z.object({ batchId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			const [actualizada] = await db
				.update(investorContractBatches)
				.set({
					status: "en_proceso",
					startedAt: new Date(),
					startedBy: context.session.user.id,
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(investorContractBatches.id, input.batchId),
						// Sólo desde pendiente: volver a "en_proceso" una completada
						// reabriría trabajo que alguien ya dio por terminado.
						eq(investorContractBatches.status, "pendiente"),
					),
				)
				.returning();

			if (!actualizada) {
				throw new ORPCError("BAD_REQUEST", {
					message:
						"Esa batería ya fue tomada, completada o descartada. Recargá la pantalla.",
				});
			}

			return actualizada;
		}),

	/**
	 * Cierra la batería: completada cuando la papelería quedó hecha, descartada
	 * cuando no había que hacerla.
	 *
	 * Descartar exige motivo escrito. Una batería que desaparece sin explicación
	 * no se distingue de una que se olvidó.
	 */
	closeInvestorContractBatch: juridicoProcedure
		.input(
			z.object({
				batchId: z.string().uuid(),
				resultado: z.enum(["completada", "descartada"]),
				motivo: z.string().trim().min(3).optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			if (input.resultado === "descartada" && !input.motivo) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Hay que decir por qué se descarta la batería.",
				});
			}

			const ahora = new Date();
			const [actualizada] = await db
				.update(investorContractBatches)
				.set(
					input.resultado === "completada"
						? {
								status: "completada",
								completedAt: ahora,
								completedBy: context.session.user.id,
								updatedAt: ahora,
							}
						: {
								status: "descartada",
								discardedAt: ahora,
								discardedBy: context.session.user.id,
								discardReason: input.motivo,
								updatedAt: ahora,
							},
				)
				.where(
					and(
						eq(investorContractBatches.id, input.batchId),
						inArray(investorContractBatches.status, [...ABIERTAS]),
					),
				)
				.returning();

			if (!actualizada) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Esa batería ya estaba cerrada. Recargá la pantalla.",
				});
			}

			return actualizada;
		}),

	/** Cuántas baterías esperan, para el contador de la pantalla de jurídico. */
	countOpenInvestorContractBatches: juridicoProcedure.handler(async () => {
		const [fila] = await db
			.select({ total: sql<number>`count(*)::int` })
			.from(investorContractBatches)
			.where(inArray(investorContractBatches.status, [...ABIERTAS]));

		return { total: fila?.total ?? 0 };
	}),
};

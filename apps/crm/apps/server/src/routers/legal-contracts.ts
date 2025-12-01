import { ORPCError } from "@orpc/server";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { leads, opportunities } from "../db/schema/crm";
import {
	generatedLegalContracts,
} from "../db/schema/legal-contracts";
import { adminProcedure, juridicoProcedure } from "../lib/orpc";
import { PERMISSIONS } from "../lib/roles";

export const legalContractsRouter = {
	// Crear nuevo contrato legal
	createLegalContract: juridicoProcedure
		.input(
			z.object({
				leadId: z.string().uuid(),
				contractType: z.string().min(1),
				contractName: z.string().min(1),
				clientSigningLink: z.string().url().optional(),
				representativeSigningLink: z.string().url().optional(),
				additionalSigningLinks: z.array(z.string().url()).optional(),
				templateId: z.number().optional(),
				apiResponse: z.any().optional(),
				opportunityId: z.string().uuid().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			// Verificar permisos
			if (!context.canCreateLegalContracts) {
				throw new ORPCError("FORBIDDEN", {
					message: "No tienes permisos para crear contratos",
				});
			}

			// Verificar que el lead existe
			const [lead] = await db
				.select()
				.from(leads)
				.where(eq(leads.id, input.leadId))
				.limit(1);

			if (!lead) {
				throw new ORPCError("NOT_FOUND", { message: "Lead no encontrado" });
			}

			// Si se proporciona opportunityId, verificar que pertenece al lead
			if (input.opportunityId) {
				const [opportunity] = await db
					.select()
					.from(opportunities)
					.where(
						and(
							eq(opportunities.id, input.opportunityId),
							eq(opportunities.leadId, input.leadId),
						),
					)
					.limit(1);

				if (!opportunity) {
					throw new ORPCError("BAD_REQUEST", {
						message: "La oportunidad no pertenece a este lead",
					});
				}
			}

			// Crear el contrato
			const [newContract] = await db
				.insert(generatedLegalContracts)
				.values({
					...input,
					generatedBy: context.userId,
					generatedAt: new Date(),
				})
				.returning();

			return newContract;
		}),

	// Listar contratos por lead
	listLegalContractsByLead: juridicoProcedure
		.input(
			z.object({
				leadId: z.string().uuid(),
			}),
		)
		.handler(async ({ input, context: _ }) => {
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
				.where(eq(generatedLegalContracts.leadId, input.leadId))
				.orderBy(generatedLegalContracts.generatedAt);

			return contracts;
		}),

	// Listar contratos por oportunidad
	listLegalContractsByOpportunity: juridicoProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
			}),
		)
		.handler(async ({ input, context: _ }) => {
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
				})
				.from(generatedLegalContracts)
				.innerJoin(leads, eq(generatedLegalContracts.leadId, leads.id))
				.where(eq(generatedLegalContracts.opportunityId, input.opportunityId))
				.orderBy(generatedLegalContracts.generatedAt);

			return contracts;
		}),

	// Obtener detalle de un contrato
	getLegalContract: juridicoProcedure
		.input(
			z.object({
				id: z.string().uuid(),
			}),
		)
		.handler(async ({ input, context: _ }) => {
			const [contractData] = await db
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
						status: opportunities.status,
					},
				})
				.from(generatedLegalContracts)
				.innerJoin(leads, eq(generatedLegalContracts.leadId, leads.id))
				.leftJoin(
					opportunities,
					eq(generatedLegalContracts.opportunityId, opportunities.id),
				)
				.where(eq(generatedLegalContracts.id, input.id))
				.limit(1);

			if (!contractData) {
				throw new ORPCError("NOT_FOUND", {
					message: "Contrato no encontrado",
				});
			}

			return contractData;
		}),

	// Asignar o cambiar oportunidad a un contrato
	assignOpportunityToContract: juridicoProcedure
		.input(
			z.object({
				contractId: z.string().uuid(),
				opportunityId: z.string().uuid().nullable(),
			}),
		)
		.handler(async ({ input, context }) => {
			// Verificar permisos
			if (!context.canAssignLegalContracts) {
				throw new ORPCError("FORBIDDEN", {
					message: "No tienes permisos para asignar contratos",
				});
			}

			// Obtener el contrato
			const [contract] = await db
				.select()
				.from(generatedLegalContracts)
				.where(eq(generatedLegalContracts.id, input.contractId))
				.limit(1);

			if (!contract) {
				throw new ORPCError("NOT_FOUND", {
					message: "Contrato no encontrado",
				});
			}

			// Si se proporciona opportunityId, verificar que pertenece al lead del contrato
			if (input.opportunityId) {
				const [opportunity] = await db
					.select()
					.from(opportunities)
					.where(
						and(
							eq(opportunities.id, input.opportunityId),
							eq(opportunities.leadId, contract.leadId),
						),
					)
					.limit(1);

				if (!opportunity) {
					throw new ORPCError("BAD_REQUEST", {
						message: "La oportunidad no pertenece al lead de este contrato",
					});
				}
			}

			// Actualizar el contrato
			const [updatedContract] = await db
				.update(generatedLegalContracts)
				.set({
					opportunityId: input.opportunityId,
					updatedAt: new Date(),
				})
				.where(eq(generatedLegalContracts.id, input.contractId))
				.returning();

			return updatedContract;
		}),

	// Actualizar estado del contrato
	updateContractStatus: juridicoProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				status: z.enum(["pending", "signed", "cancelled"]),
			}),
		)
		.handler(async ({ input, context }) => {
			// Verificar permisos
			if (!context.canAssignLegalContracts) {
				throw new ORPCError("FORBIDDEN", {
					message: "No tienes permisos para actualizar el estado",
				});
			}

			const [updatedContract] = await db
				.update(generatedLegalContracts)
				.set({
					status: input.status,
					updatedAt: new Date(),
				})
				.where(eq(generatedLegalContracts.id, input.id))
				.returning();

			if (!updatedContract) {
				throw new ORPCError("NOT_FOUND", {
					message: "Contrato no encontrado",
				});
			}

			return updatedContract;
		}),

	// Eliminar contrato (solo admin)
	deleteContract: adminProcedure
		.input(
			z.object({
				id: z.string().uuid(),
			}),
		)
		.handler(async ({ input, context: _ }) => {
			const [deletedContract] = await db
				.delete(generatedLegalContracts)
				.where(eq(generatedLegalContracts.id, input.id))
				.returning();

			if (!deletedContract) {
				throw new ORPCError("NOT_FOUND", {
					message: "Contrato no encontrado",
				});
			}

			return { success: true, deletedContract };
		}),

	// Obtener oportunidades de un lead (para el combobox)
	getOpportunitiesByLead: juridicoProcedure
		.input(
			z.object({
				leadId: z.string().uuid(),
			}),
		)
		.handler(async ({ input, context: _ }) => {
			const opportunitiesList = await db
				.select({
					id: opportunities.id,
					title: opportunities.title,
					value: opportunities.value,
					status: opportunities.status,
					creditType: opportunities.creditType,
				})
				.from(opportunities)
				.where(eq(opportunities.leadId, input.leadId))
				.orderBy(opportunities.createdAt);

			return opportunitiesList;
		}),

	// Obtener permisos del usuario actual
	getUserPermissions: juridicoProcedure.handler(async ({ context }) => {
		return {
			canView: PERMISSIONS.canAccessJuridico(context.userRole),
			canCreate: PERMISSIONS.canCreateLegalContracts(context.userRole),
			canAssign: PERMISSIONS.canAssignLegalContracts(context.userRole),
			canDelete: PERMISSIONS.canDeleteLegalContracts(context.userRole),
		};
	}),

	// Listar todos los leads que tienen contratos (para vista principal)
	getLeadsWithContracts: juridicoProcedure.handler(async ({ context: _ }) => {
		// Obtener leads únicos que tienen al menos un contrato
		const leadsWithContracts = await db
			.selectDistinct({
				id: leads.id,
				firstName: leads.firstName,
				lastName: leads.lastName,
				dpi: leads.dpi,
				email: leads.email,
				phone: leads.phone,
			})
			.from(leads)
			.innerJoin(
				generatedLegalContracts,
				eq(leads.id, generatedLegalContracts.leadId),
			)
			.orderBy(leads.firstName);

		// Para cada lead, contar sus contratos
		const leadsWithCounts = await Promise.all(
			leadsWithContracts.map(async (lead) => {
				const [{ count: contractCount }] = await db
					.select({ count: count() })
					.from(generatedLegalContracts)
					.where(eq(generatedLegalContracts.leadId, lead.id));

				// Obtener el contrato más reciente
				const [latestContract] = await db
					.select({
						generatedAt: generatedLegalContracts.generatedAt,
						contractName: generatedLegalContracts.contractName,
					})
					.from(generatedLegalContracts)
					.where(eq(generatedLegalContracts.leadId, lead.id))
					.orderBy(generatedLegalContracts.generatedAt)
					.limit(1);

				return {
					...lead,
					contractCount: Number(contractCount),
					latestContractDate: latestContract?.generatedAt,
					latestContractName: latestContract?.contractName,
				};
			}),
		);

		return leadsWithCounts;
	}),
};

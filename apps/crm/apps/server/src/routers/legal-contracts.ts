import { ORPCError } from "@orpc/server";
import { and, count, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
	generateUniqueFilename,
	getFileUrl,
	uploadFileToR2,
	validateFile,
} from "../lib/storage";
import { user } from "../db/schema/auth";
import {
	leads,
	opportunities,
	opportunityStageHistory,
	salesStages,
} from "../db/schema/crm";
import { generatedLegalContracts } from "../db/schema/legal-contracts";
import { vehicles } from "../db/schema/vehicles";
import {
	adminProcedure,
	juridicoProcedure,
	viewOpportunityContractsProcedure,
} from "../lib/orpc";
import { PERMISSIONS } from "../lib/roles";
import { checkDocumensoSigningStatus } from "../services/documenso-signing";
import { closeOpportunity } from "@/services/close-opportunity";

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
				pdfFile: z
					.object({
						name: z.string(),
						type: z.string(),
						size: z.number(),
						data: z.string(), // Base64
					})
					.optional(),
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

			// Subir PDF si se proporciona
			let pdfLink: string | undefined;
			if (input.pdfFile) {
				const validation = validateFile({
					type: input.pdfFile.type,
					size: input.pdfFile.size,
				} as File);

				if (!validation.valid) {
					throw new ORPCError("BAD_REQUEST", {
						message: validation.error || "Archivo inválido",
					});
				}

				const fileBuffer = Buffer.from(input.pdfFile.data, "base64");
				const fileBlob = new Blob([fileBuffer], { type: input.pdfFile.type });
				const uniqueFilename = generateUniqueFilename(input.pdfFile.name);

				const { key } = await uploadFileToR2(
					fileBlob,
					uniqueFilename,
					`legal-contracts/${input.leadId}`,
				);

				pdfLink = await getFileUrl(key);
			}

			// Crear el contrato (sin incluir pdfFile en los valores)
			const { pdfFile: _, ...contractData } = input;
			const [newContract] = await db
				.insert(generatedLegalContracts)
				.values({
					...contractData,
					pdfLink,
					generatedBy: context.userId,
					generatedAt: new Date(),
				})
				.returning();

			return newContract;
		}),

	// Actualizar contrato legal existente
	updateLegalContract: juridicoProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				contractType: z.string().min(1),
				contractName: z.string().min(1),
				clientSigningLink: z.string().url().optional().nullable(),
				representativeSigningLink: z.string().url().optional().nullable(),
				additionalSigningLinks: z.array(z.string().url()).optional().nullable(),
				pdfFile: z
					.object({
						name: z.string(),
						type: z.string(),
						size: z.number(),
						data: z.string(), // Base64
					})
					.optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			// Verificar permisos
			if (!context.canCreateLegalContracts) {
				throw new ORPCError("FORBIDDEN", {
					message: "No tienes permisos para editar contratos",
				});
			}

			// Verificar que el contrato existe
			const [existingContract] = await db
				.select()
				.from(generatedLegalContracts)
				.where(eq(generatedLegalContracts.id, input.id))
				.limit(1);

			if (!existingContract) {
				throw new ORPCError("NOT_FOUND", {
					message: "Contrato no encontrado",
				});
			}

			// Subir PDF si se proporciona
			let pdfLink: string | undefined;
			if (input.pdfFile) {
				const validation = validateFile({
					type: input.pdfFile.type,
					size: input.pdfFile.size,
				} as File);

				if (!validation.valid) {
					throw new ORPCError("BAD_REQUEST", {
						message: validation.error || "Archivo inválido",
					});
				}

				const fileBuffer = Buffer.from(input.pdfFile.data, "base64");
				const fileBlob = new Blob([fileBuffer], { type: input.pdfFile.type });
				const uniqueFilename = generateUniqueFilename(input.pdfFile.name);

				const { key } = await uploadFileToR2(
					fileBlob,
					uniqueFilename,
					`legal-contracts/${existingContract.leadId}`,
				);

				pdfLink = await getFileUrl(key);
			}

			// Actualizar el contrato
			const [updatedContract] = await db
				.update(generatedLegalContracts)
				.set({
					contractType: input.contractType,
					contractName: input.contractName,
					clientSigningLink: input.clientSigningLink,
					representativeSigningLink: input.representativeSigningLink,
					additionalSigningLinks: input.additionalSigningLinks,
					...(pdfLink && { pdfLink }),
					updatedAt: new Date(),
				})
				.where(eq(generatedLegalContracts.id, input.id))
				.returning();

			return updatedContract;
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
				.leftJoin(leads, eq(generatedLegalContracts.leadId, leads.id))
				.leftJoin(
					opportunities,
					eq(generatedLegalContracts.opportunityId, opportunities.id),
				)
				.where(eq(generatedLegalContracts.leadId, input.leadId))
				.orderBy(generatedLegalContracts.generatedAt);

			return contracts;
		}),

	// Listar contratos por oportunidad (accesible por CRM y Juridico)
	listLegalContractsByOpportunity: viewOpportunityContractsProcedure
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
				.where(eq(generatedLegalContracts.opportunityId, input.opportunityId))
				.orderBy(generatedLegalContracts.generatedAt);

			// Verificar estado de firma en Documenso para contratos pendientes
			const contractsWithUpdatedStatus = await Promise.all(
				contracts.map(async (contractData) => {
					// Solo verificar si el contrato está pendiente y tiene link de firma del cliente
					if (
						contractData.contract.status === "pending" &&
						contractData.contract.clientSigningLink
					) {
						const signingStatus = await checkDocumensoSigningStatus(
							contractData.contract.clientSigningLink,
						);

						// Si está firmado, actualizar en la base de datos
						if (signingStatus.isSigned) {
							const [updatedContract] = await db
								.update(generatedLegalContracts)
								.set({
									status: "signed",
									updatedAt: new Date(),
								})
								.where(eq(generatedLegalContracts.id, contractData.contract.id))
								.returning();

							return {
								...contractData,
								contract: updatedContract,
							};
						}
					}

					return contractData;
				}),
			);

			return contractsWithUpdatedStatus;
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

	// Get opportunities ready for contracts (at specified percentages - pending legal approval)
	getOpportunitiesForContracts: juridicoProcedure
		.input(
			z
				.object({
					closurePercentages: z.array(z.number().min(0).max(100)).optional(),
				})
				.optional(),
		)
		.handler(async ({ input, context: _ }) => {
			const targetPercentages = input?.closurePercentages ?? [80];

			const opportunitiesList = await db
				.select({
					id: opportunities.id,
					title: opportunities.title,
					value: opportunities.value,
					creditType: opportunities.creditType,
					status: opportunities.status,
					expectedCloseDate: opportunities.expectedCloseDate,
					createdAt: opportunities.createdAt,
					lead: {
						id: leads.id,
						firstName: leads.firstName,
						lastName: leads.lastName,
						dpi: leads.dpi,
						email: leads.email,
						phone: leads.phone,
					},
					stage: {
						id: salesStages.id,
						name: salesStages.name,
						order: salesStages.order,
						closurePercentage: salesStages.closurePercentage,
						color: salesStages.color,
					},
					assignedUser: {
						id: user.id,
						name: user.name,
					},
					vehicle: {
						id: vehicles.id,
						make: vehicles.make,
						model: vehicles.model,
						year: vehicles.year,
						licensePlate: vehicles.licensePlate,
						color: vehicles.color,
						isNew: vehicles.isNew,
					},
				})
				.from(opportunities)
				.innerJoin(leads, eq(opportunities.leadId, leads.id))
				.innerJoin(salesStages, eq(opportunities.stageId, salesStages.id))
				.leftJoin(user, eq(opportunities.assignedTo, user.id))
				.leftJoin(vehicles, eq(opportunities.vehicleId, vehicles.id))
				.where(
					and(
						inArray(salesStages.closurePercentage, targetPercentages),
						ne(opportunities.status, "won"),
						ne(opportunities.status, "lost"),
					),
				)
				.orderBy(opportunities.createdAt);

			// For each opportunity, get the contract count
			const opportunitiesWithContractCount = await Promise.all(
				opportunitiesList.map(async (opp) => {
					const [{ count: contractCount }] = await db
						.select({ count: count() })
						.from(generatedLegalContracts)
						.where(eq(generatedLegalContracts.opportunityId, opp.id));

					// Obtener el contrato más reciente
					const [latestContract] = await db
						.select({
							generatedAt: generatedLegalContracts.generatedAt,
							contractName: generatedLegalContracts.contractName,
						})
						.from(generatedLegalContracts)
						.where(eq(generatedLegalContracts.opportunityId, opp.id))
						.orderBy(generatedLegalContracts.generatedAt)
						.limit(1);

					return {
						...opp,
						latestContractDate: latestContract?.generatedAt,
						latestContractName: latestContract?.contractName,
						contractCount: Number(contractCount),
					};
				}),
			);

			return opportunitiesWithContractCount;
		}),

	// Aprobar oportunidad desde jurídico (mover a 90%)
	approveOpportunityLegal: juridicoProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
			}),
		)
		.handler(async ({ input, context }) => {
			// Verificar permisos
			if (!PERMISSIONS.canApproveLegalStage(context.userRole)) {
				throw new ORPCError("FORBIDDEN", {
					message: "No tienes permisos para aprobar oportunidades",
				});
			}

			// Obtener la oportunidad con su etapa actual
			const [opportunity] = await db
				.select({
					id: opportunities.id,
					stageId: opportunities.stageId,
					leadId: opportunities.leadId,
					title: opportunities.title,
				})
				.from(opportunities)
				.where(eq(opportunities.id, input.opportunityId))
				.limit(1);

			if (!opportunity) {
				throw new ORPCError("NOT_FOUND", {
					message: "Oportunidad no encontrada",
				});
			}

			// Verificar que la oportunidad está en 80%
			const [currentStage] = await db
				.select()
				.from(salesStages)
				.where(eq(salesStages.id, opportunity.stageId))
				.limit(1);

			if (!currentStage || currentStage.closurePercentage !== 80) {
				throw new ORPCError("BAD_REQUEST", {
					message: `La oportunidad debe estar en la etapa del 80% para ser aprobada. Actualmente está en ${currentStage?.closurePercentage || 0}%`,
				});
			}

			// Verificar que hay al menos un contrato asociado a la oportunidad
			const [{ count: contractCount }] = await db
				.select({ count: count() })
				.from(generatedLegalContracts)
				.where(eq(generatedLegalContracts.opportunityId, input.opportunityId));

			if (Number(contractCount) === 0) {
				throw new ORPCError("BAD_REQUEST", {
					message:
						"Debe haber al menos un contrato asociado a la oportunidad para aprobarla",
				});
			}

			// Close the opportunity (create credit, client, contract)
			const closeResult = await closeOpportunity({
				opportunityId: input.opportunityId,
				userId: context.userId,
			});

			if (!closeResult.success) {
				throw new ORPCError("BAD_REQUEST", {
					message: closeResult.error || "Error al cerrar la oportunidad",
				});
			}
			

			// Obtener la etapa del 90%
			const [targetStage] = await db
				.select()
				.from(salesStages)
				.where(eq(salesStages.closurePercentage, 90))
				.limit(1);

			if (!targetStage) {
				throw new ORPCError("NOT_FOUND", {
					message: "No se encontró la etapa del 90%",
				});
			}

			// Actualizar la oportunidad y registrar historial en una transacción
			await db.transaction(async (tx) => {
				// Actualizar la oportunidad a 90%
				await tx
					.update(opportunities)
					.set({
						stageId: targetStage.id,
						updatedAt: new Date(),
					})
					.where(eq(opportunities.id, input.opportunityId));

				// Registrar en el historial de etapas
				await tx.insert(opportunityStageHistory).values({
					opportunityId: input.opportunityId,
					fromStageId: opportunity.stageId,
					toStageId: targetStage.id,
					changedBy: context.userId,
					reason: "Aprobación legal - Contratos adjuntados",
				});
			});

			return {
				success: true,
				message: "Oportunidad aprobada y movida a la etapa del 90%",
				newStageId: targetStage.id,
				newStageName: targetStage.name,
			};
		}),
};

import { ORPCError } from "@orpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
	investmentAuditLog,
	investmentDocuments,
	investmentInteractions,
	investmentLeads,
	investmentNonAdvanceSurvey,
	investmentOpportunities,
	investmentScenarios,
	investmentStageHistory,
	investors,
} from "../db/schema/investments";
import {
	calculateGoal,
	calculateInvestment,
} from "../lib/investment-calculator";
import {
	analystProcedure,
	investmentManagerProcedure,
	investmentProcedure,
} from "../lib/orpc";
import { ROLES } from "../lib/roles";
import { createNotification } from "./notifications";

export const investmentsRouter = {
	// ============ LEADS ============

	getInvestmentLeads: investmentProcedure
		.input(
			z
				.object({
					limit: z.number().int().positive().default(50),
					offset: z.number().int().min(0).default(0),
				})
				.optional(),
		)
		.handler(async ({ input, context }) => {
			const limit = input?.limit ?? 50;
			const offset = input?.offset ?? 0;

			const conditions =
				context.userRole === ROLES.INVESTMENT_ADVISOR_JR
					? [eq(investmentLeads.assignedTo, context.userId)]
					: [];

			return await db
				.select()
				.from(investmentLeads)
				.where(conditions.length > 0 ? and(...conditions) : undefined)
				.orderBy(desc(investmentLeads.createdAt))
				.limit(limit)
				.offset(offset);
		}),

	createInvestmentLead: investmentProcedure
		.input(
			z.object({
				name: z.string().min(1),
				email: z.string().email().optional(),
				phones: z.array(z.string()).optional(),
				source: z
					.enum([
						"website",
						"referral",
						"cold_call",
						"email",
						"social_media",
						"event",
						"whatsapp",
					])
					.optional(),
				proposedAmount: z.number().positive().optional(),
				assignedTo: z.string().optional(),
				userId: z.string().optional(),
				notes: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const { proposedAmount, assignedTo: inputAssignedTo, ...rest } = input;
			const assignedTo = inputAssignedTo ?? context.userId;

			const [lead] = await db
				.insert(investmentLeads)
				.values({
					...rest,
					assignedTo,
					proposedAmount: proposedAmount?.toString(),
				})
				.returning();

			// Crear oportunidad automaticamente en etapa Prospeccion
			const [opportunity] = await db
				.insert(investmentOpportunities)
				.values({
					investmentLeadId: lead.id,
					assignedAdvisorId: assignedTo,
					stage: "prospecting",
					status: "open",
				})
				.returning();

			// Registrar en auditoria
			await db.insert(investmentAuditLog).values({
				investmentOpportunityId: opportunity.id,
				action: "lead_created",
				details: { leadId: lead.id, source: input.source },
				performedBy: context.userId,
			});

			// Registrar stage history
			await db.insert(investmentStageHistory).values({
				investmentOpportunityId: opportunity.id,
				toStage: "prospecting",
				changedBy: context.userId,
			});

			return { lead, opportunity };
		}),

	updateInvestmentLead: investmentProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				name: z.string().min(1).optional(),
				email: z.string().email().optional(),
				phones: z.array(z.string()).optional(),
				proposedAmount: z.number().positive().optional(),
				assignedTo: z.string().optional(),
				notes: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const { id, ...data } = input;
			const [updated] = await db
				.update(investmentLeads)
				.set({
					...data,
					proposedAmount: data.proposedAmount?.toString(),
					updatedAt: new Date(),
				})
				.where(eq(investmentLeads.id, id))
				.returning();

			if (!updated) {
				throw new ORPCError("NOT_FOUND", {
					message: "Lead de inversion no encontrado",
				});
			}

			return updated;
		}),

	// ============ PIPELINE ============

	getInvestmentOpportunities: investmentProcedure
		.input(
			z
				.object({
					stage: z
						.enum([
							"prospecting",
							"contacted",
							"negotiation",
							"acceptance_signatures",
							"welcome",
							"closed",
							"lost",
						])
						.optional(),
				})
				.optional(),
		)
		.handler(async ({ input, context }) => {
			const conditions = [eq(investmentOpportunities.status, "open")];

			if (input?.stage) {
				conditions.push(eq(investmentOpportunities.stage, input.stage));
			}

			// Advisors Jr solo ven sus oportunidades
			if (context.userRole === ROLES.INVESTMENT_ADVISOR_JR) {
				conditions.push(
					eq(investmentOpportunities.assignedAdvisorId, context.userId),
				);
			}

			const results = await db
				.select({
					opportunity: investmentOpportunities,
					lead: investmentLeads,
					investor: investors,
				})
				.from(investmentOpportunities)
				.leftJoin(
					investmentLeads,
					eq(investmentOpportunities.investmentLeadId, investmentLeads.id),
				)
				.leftJoin(
					investors,
					eq(investmentOpportunities.investorId, investors.id),
				)
				.where(and(...conditions))
				.orderBy(desc(investmentOpportunities.createdAt));

			return results;
		}),

	getInvestmentOpportunityById: investmentProcedure
		.input(z.object({ id: z.string().uuid() }))
		.handler(async ({ input }) => {
			const [result] = await db
				.select({
					opportunity: investmentOpportunities,
					lead: investmentLeads,
					investor: investors,
				})
				.from(investmentOpportunities)
				.leftJoin(
					investmentLeads,
					eq(investmentOpportunities.investmentLeadId, investmentLeads.id),
				)
				.leftJoin(
					investors,
					eq(investmentOpportunities.investorId, investors.id),
				)
				.where(eq(investmentOpportunities.id, input.id))
				.limit(1);

			if (!result) {
				throw new ORPCError("NOT_FOUND", {
					message: "Oportunidad de inversion no encontrada",
				});
			}

			// Traer datos relacionados
			const [scenarios, documents, interactions, stageHistory] =
				await Promise.all([
					db
						.select()
						.from(investmentScenarios)
						.where(eq(investmentScenarios.investmentOpportunityId, input.id))
						.orderBy(desc(investmentScenarios.createdAt)),
					db
						.select()
						.from(investmentDocuments)
						.where(eq(investmentDocuments.investmentOpportunityId, input.id))
						.orderBy(desc(investmentDocuments.createdAt)),
					db
						.select()
						.from(investmentInteractions)
						.where(eq(investmentInteractions.investmentOpportunityId, input.id))
						.orderBy(desc(investmentInteractions.createdAt)),
					db
						.select()
						.from(investmentStageHistory)
						.where(eq(investmentStageHistory.investmentOpportunityId, input.id))
						.orderBy(desc(investmentStageHistory.createdAt)),
				]);

			return {
				...result,
				scenarios,
				documents,
				interactions,
				stageHistory,
			};
		}),

	// ============ STAGE TRANSITIONS ============

	advanceInvestmentStage: investmentProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
				reason: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const [opp] = await db
				.select()
				.from(investmentOpportunities)
				.where(eq(investmentOpportunities.id, input.opportunityId))
				.limit(1);

			if (!opp) {
				throw new ORPCError("NOT_FOUND", {
					message: "Oportunidad no encontrada",
				});
			}

			// Definir orden de etapas y gates
			const stageOrder = [
				"prospecting",
				"contacted",
				"negotiation",
				"acceptance_signatures",
				"welcome",
				"closed",
			] as const;

			const currentIndex = stageOrder.indexOf(
				opp.stage as (typeof stageOrder)[number],
			);
			if (currentIndex === -1 || currentIndex >= stageOrder.length - 1) {
				throw new ORPCError("BAD_REQUEST", {
					message: "No se puede avanzar desde esta etapa",
				});
			}

			const nextStage = stageOrder[currentIndex + 1];

			// Validar gates segun etapa actual
			switch (opp.stage) {
				case "prospecting": {
					// Gate: al menos una interaccion registrada
					const [interaction] = await db
						.select()
						.from(investmentInteractions)
						.where(eq(investmentInteractions.investmentOpportunityId, opp.id))
						.limit(1);
					if (!interaction) {
						throw new ORPCError("BAD_REQUEST", {
							message:
								"Debe registrar al menos una interaccion antes de avanzar",
						});
					}
					break;
				}
				case "contacted": {
					// Gate: al menos una interaccion
					const [interaction] = await db
						.select()
						.from(investmentInteractions)
						.where(eq(investmentInteractions.investmentOpportunityId, opp.id))
						.limit(1);
					if (!interaction) {
						throw new ORPCError("BAD_REQUEST", {
							message:
								"Debe registrar al menos una interaccion antes de avanzar",
						});
					}
					break;
				}
				case "negotiation": {
					// Gate: todos los checklist completados
					if (
						!opp.scenariosCompleted ||
						!opp.documentsApproved ||
						!opp.kycCompleted ||
						!opp.profileCompleted ||
						!opp.webappProfileCreated
					) {
						const missing = [];
						if (!opp.scenariosCompleted)
							missing.push("escenarios de inversion");
						if (!opp.documentsApproved) missing.push("documentacion aprobada");
						if (!opp.kycCompleted) missing.push("KYC completado");
						if (!opp.profileCompleted) missing.push("perfil del inversionista");
						if (!opp.webappProfileCreated) missing.push("perfil en webapp CCI");
						throw new ORPCError("BAD_REQUEST", {
							message: `Faltan requisitos: ${missing.join(", ")}`,
						});
					}
					// Notificar a juridico, contabilidad, gerencia
					const [lead] = await db
						.select()
						.from(investmentLeads)
						.where(eq(investmentLeads.id, opp.investmentLeadId))
						.limit(1);

					await createNotification({
						titulo: `Nueva inversion en etapa de firmas - ${lead?.name}`,
						descripcion: `La inversion de ${lead?.name} esta lista para generacion de contratos`,
						type: "action_required",
						createdBy: context.userId,
						createdByRole: context.userRole,
						assignedToRole: "juridico",
						relatedEntityType: "opportunity",
						relatedEntityId: opp.id,
					});
					await createNotification({
						titulo: `Nueva inversion aprobada - ${lead?.name}`,
						descripcion: `La inversion de ${lead?.name} paso a etapa de firmas`,
						type: "aviso",
						createdBy: context.userId,
						createdByRole: context.userRole,
						assignedToRole: "accounting",
						relatedEntityType: "opportunity",
						relatedEntityId: opp.id,
					});
					break;
				}
				case "acceptance_signatures": {
					// Gate: todas las firmas completadas
					if (opp.signaturesCompleted < opp.signaturesTotal) {
						throw new ORPCError("BAD_REQUEST", {
							message: `Faltan firmas: ${opp.signaturesCompleted}/${opp.signaturesTotal}`,
						});
					}
					break;
				}
				case "welcome": {
					// Gate: fondos validados por gerente
					if (!opp.fundsValidated) {
						throw new ORPCError("BAD_REQUEST", {
							message:
								"Los fondos deben ser validados por el gerente de inversiones",
						});
					}
					break;
				}
			}

			// Actualizar etapa (con condicion de stage actual para evitar race condition)
			const [updated] = await db
				.update(investmentOpportunities)
				.set({
					stage: nextStage,
					status: nextStage === "closed" ? "won" : "open",
					stageEnteredAt: new Date(),
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(investmentOpportunities.id, opp.id),
						eq(investmentOpportunities.stage, opp.stage),
					),
				)
				.returning();

			if (!updated) {
				throw new ORPCError("CONFLICT", {
					message:
						"La etapa fue modificada por otro usuario. Recargue la pagina.",
				});
			}

			// Registrar en stage history
			await db.insert(investmentStageHistory).values({
				investmentOpportunityId: opp.id,
				fromStage: opp.stage,
				toStage: nextStage,
				changedBy: context.userId,
				reason: input.reason,
			});

			// Registrar en auditoria
			await db.insert(investmentAuditLog).values({
				investmentOpportunityId: opp.id,
				action: "stage_advanced",
				details: { from: opp.stage, to: nextStage },
				performedBy: context.userId,
			});

			return updated;
		}),

	markAsLost: investmentProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
				reason: z.string().min(1),
			}),
		)
		.handler(async ({ input, context }) => {
			const [opp] = await db
				.select()
				.from(investmentOpportunities)
				.where(eq(investmentOpportunities.id, input.opportunityId))
				.limit(1);

			if (!opp) {
				throw new ORPCError("NOT_FOUND", {
					message: "Oportunidad no encontrada",
				});
			}

			const [updated] = await db
				.update(investmentOpportunities)
				.set({
					stage: "lost",
					status: "lost",
					lostReason: input.reason,
					lastStageBeforeLost: opp.stage,
					updatedAt: new Date(),
				})
				.where(eq(investmentOpportunities.id, opp.id))
				.returning();

			await db.insert(investmentStageHistory).values({
				investmentOpportunityId: opp.id,
				fromStage: opp.stage,
				toStage: "lost",
				changedBy: context.userId,
				reason: input.reason,
			});

			await db.insert(investmentAuditLog).values({
				investmentOpportunityId: opp.id,
				action: "marked_as_lost",
				details: {
					previousStage: opp.stage,
					reason: input.reason,
				},
				performedBy: context.userId,
			});

			return updated;
		}),

	// ============ SCENARIOS (Calculadora) ============

	calculateInvestmentScenario: investmentProcedure
		.input(
			z.object({
				amount: z.number().positive(),
				monthlyRate: z.number().positive(),
				termMonths: z.number().int().positive(),
				modality: z.enum(["traditional", "maturity", "compound"]),
				isSmallTaxpayer: z.boolean().default(false),
			}),
		)
		.handler(async ({ input }) => {
			return calculateInvestment(
				input.amount,
				input.monthlyRate,
				input.termMonths,
				input.modality,
				input.isSmallTaxpayer,
			);
		}),

	calculateInvestmentGoal: investmentProcedure
		.input(
			z.object({
				desiredMonthlyAmount: z.number().positive(),
				termMonths: z.number().int().positive(),
				monthlyRate: z.number().positive().default(1.5),
				isSmallTaxpayer: z.boolean().default(false),
			}),
		)
		.handler(async ({ input }) => {
			return calculateGoal(
				input.desiredMonthlyAmount,
				input.termMonths,
				input.monthlyRate,
				input.isSmallTaxpayer,
			);
		}),

	createInvestmentScenario: investmentProcedure
		.input(
			z.object({
				investmentOpportunityId: z.string().uuid(),
				amount: z.number().positive(),
				monthlyRate: z.number().positive(),
				termMonths: z.number().int().positive(),
				modality: z.enum(["traditional", "maturity", "compound"]),
				isSmallTaxpayer: z.boolean().default(false),
			}),
		)
		.handler(async ({ input, context }) => {
			const result = calculateInvestment(
				input.amount,
				input.monthlyRate,
				input.termMonths,
				input.modality,
				input.isSmallTaxpayer,
			);

			const [scenario] = await db
				.insert(investmentScenarios)
				.values({
					investmentOpportunityId: input.investmentOpportunityId,
					amount: input.amount.toString(),
					monthlyRate: input.monthlyRate.toString(),
					termMonths: input.termMonths,
					modality: input.modality,
					isSmallTaxpayer: input.isSmallTaxpayer,
					totalInterest: result.totalInterest.toString(),
					totalToReceive: result.totalToReceive.toString(),
					amortizationTable: result.amortizationTable,
				})
				.returning();

			await db.insert(investmentAuditLog).values({
				investmentOpportunityId: input.investmentOpportunityId,
				action: "scenario_created",
				details: {
					scenarioId: scenario.id,
					modality: input.modality,
					amount: input.amount,
				},
				performedBy: context.userId,
			});

			return scenario;
		}),

	acceptInvestmentScenario: investmentProcedure
		.input(
			z.object({
				scenarioId: z.string().uuid(),
				opportunityId: z.string().uuid(),
			}),
		)
		.handler(async ({ input, context }) => {
			const accepted = await db.transaction(async (tx) => {
				// Desmarcar todos los escenarios aceptados de esta oportunidad
				await tx
					.update(investmentScenarios)
					.set({ isAccepted: false })
					.where(
						eq(
							investmentScenarios.investmentOpportunityId,
							input.opportunityId,
						),
					);

				// Marcar el seleccionado
				const [result] = await tx
					.update(investmentScenarios)
					.set({ isAccepted: true })
					.where(eq(investmentScenarios.id, input.scenarioId))
					.returning();

				// Actualizar checklist
				await tx
					.update(investmentOpportunities)
					.set({
						scenariosCompleted: true,
						updatedAt: new Date(),
					})
					.where(eq(investmentOpportunities.id, input.opportunityId));

				await tx.insert(investmentAuditLog).values({
					investmentOpportunityId: input.opportunityId,
					action: "scenario_accepted",
					details: { scenarioId: input.scenarioId },
					performedBy: context.userId,
				});

				return result;
			});

			return accepted;
		}),

	// ============ INVESTORS (Perfil) ============

	createInvestor: investmentProcedure
		.input(
			z.object({
				investmentLeadId: z.string().uuid().optional(),
				clientType: z
					.enum(["individual", "empresa_individual", "sociedad_anonima"])
					.default("individual"),
				firstName: z.string().min(1),
				lastName: z.string().min(1),
				nit: z.string().optional(),
				billingName: z.string().optional(),
				corporation: z.string().optional(),
				legalRepresentative: z.string().optional(),
				paymentChannel: z.string().optional(),
				phones: z.array(z.string()).optional(),
				email: z.string().email().optional(),
				website: z.string().optional(),
				address: z.string().optional(),
				notes: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const [investor] = await db.insert(investors).values(input).returning();

			return investor;
		}),

	updateInvestor: investmentProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				clientType: z
					.enum(["individual", "empresa_individual", "sociedad_anonima"])
					.optional(),
				firstName: z.string().min(1).optional(),
				lastName: z.string().min(1).optional(),
				nit: z.string().optional(),
				billingName: z.string().optional(),
				corporation: z.string().optional(),
				legalRepresentative: z.string().optional(),
				paymentChannel: z.string().optional(),
				phones: z.array(z.string()).optional(),
				email: z.string().email().optional(),
				website: z.string().optional(),
				address: z.string().optional(),
				notes: z.string().optional(),
			}),
		)
		.handler(async ({ input }) => {
			const { id, ...data } = input;
			const [updated] = await db
				.update(investors)
				.set({ ...data, updatedAt: new Date() })
				.where(eq(investors.id, id))
				.returning();

			if (!updated) {
				throw new ORPCError("NOT_FOUND", {
					message: "Inversionista no encontrado",
				});
			}

			return updated;
		}),

	getInvestorById: investmentProcedure
		.input(z.object({ id: z.string().uuid() }))
		.handler(async ({ input }) => {
			const [investor] = await db
				.select()
				.from(investors)
				.where(eq(investors.id, input.id))
				.limit(1);

			if (!investor) {
				throw new ORPCError("NOT_FOUND", {
					message: "Inversionista no encontrado",
				});
			}

			return investor;
		}),

	// ============ DOCUMENTS ============

	uploadInvestmentDocument: investmentProcedure
		.input(
			z.object({
				investorId: z.string().uuid(),
				investmentOpportunityId: z.string().uuid(),
				documentType: z.enum([
					"dpi_front",
					"dpi_back",
					"income_form",
					"fund_declaration",
					"utility_bill",
					"bank_statement",
					"investment_receipt",
					"other",
				]),
				fileUrl: z.string().url(),
				fileName: z.string().optional(),
				mimeType: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const [doc] = await db
				.insert(investmentDocuments)
				.values({
					...input,
					status: "pending",
				})
				.returning();

			await db.insert(investmentAuditLog).values({
				investmentOpportunityId: input.investmentOpportunityId,
				investorId: input.investorId,
				action: "document_uploaded",
				details: {
					documentType: input.documentType,
					fileName: input.fileName,
				},
				performedBy: context.userId,
			});

			return doc;
		}),

	reviewInvestmentDocument: analystProcedure
		.input(
			z.object({
				documentId: z.string().uuid(),
				status: z.enum(["approved", "rejected"]),
				rejectionReason: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const [updated] = await db
				.update(investmentDocuments)
				.set({
					status: input.status,
					reviewedBy: context.userId,
					reviewedAt: new Date(),
					rejectionReason: input.rejectionReason,
				})
				.where(eq(investmentDocuments.id, input.documentId))
				.returning();

			if (!updated) {
				throw new ORPCError("NOT_FOUND", {
					message: "Documento no encontrado",
				});
			}

			// Verificar si todos los docs de esta oportunidad estan aprobados
			const allDocs = await db
				.select()
				.from(investmentDocuments)
				.where(
					eq(
						investmentDocuments.investmentOpportunityId,
						updated.investmentOpportunityId,
					),
				);

			const allApproved =
				allDocs.length > 0 && allDocs.every((d) => d.status === "approved");

			if (allApproved) {
				await db
					.update(investmentOpportunities)
					.set({
						documentsApproved: true,
						updatedAt: new Date(),
					})
					.where(
						eq(investmentOpportunities.id, updated.investmentOpportunityId),
					);
			}

			await db.insert(investmentAuditLog).values({
				investmentOpportunityId: updated.investmentOpportunityId,
				investorId: updated.investorId,
				action: `document_${input.status}`,
				details: {
					documentId: input.documentId,
					rejectionReason: input.rejectionReason,
				},
				performedBy: context.userId,
			});

			return updated;
		}),

	// ============ INTERACTIONS ============

	createInvestmentInteraction: investmentProcedure
		.input(
			z.object({
				investmentOpportunityId: z.string().uuid(),
				interactionType: z.enum(["call", "email", "whatsapp", "meeting"]),
				date: z.string(),
				time: z.string().optional(),
				description: z.string().min(1),
				nextFollowupDate: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const [interaction] = await db
				.insert(investmentInteractions)
				.values({
					...input,
					nextFollowupDate: input.nextFollowupDate
						? new Date(input.nextFollowupDate)
						: null,
					createdBy: context.userId,
				})
				.returning();

			await db.insert(investmentAuditLog).values({
				investmentOpportunityId: input.investmentOpportunityId,
				action: "interaction_created",
				details: {
					type: input.interactionType,
					date: input.date,
				},
				performedBy: context.userId,
			});

			return interaction;
		}),

	// ============ FUND VALIDATION (Gerente) ============

	validateInvestmentFunds: investmentManagerProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
			}),
		)
		.handler(async ({ input, context }) => {
			const [updated] = await db
				.update(investmentOpportunities)
				.set({
					fundsValidated: true,
					fundsValidatedBy: context.userId,
					fundsValidatedAt: new Date(),
					updatedAt: new Date(),
				})
				.where(eq(investmentOpportunities.id, input.opportunityId))
				.returning();

			if (!updated) {
				throw new ORPCError("NOT_FOUND", {
					message: "Oportunidad no encontrada",
				});
			}

			await db.insert(investmentAuditLog).values({
				investmentOpportunityId: input.opportunityId,
				action: "funds_validated",
				performedBy: context.userId,
			});

			return updated;
		}),

	// ============ SIGNATURES TRACKING ============

	updateSignatureStatus: investmentProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
				signaturesCompleted: z.number().int().min(0).max(4),
			}),
		)
		.handler(async ({ input, context }) => {
			const [updated] = await db
				.update(investmentOpportunities)
				.set({
					signaturesCompleted: input.signaturesCompleted,
					updatedAt: new Date(),
				})
				.where(eq(investmentOpportunities.id, input.opportunityId))
				.returning();

			if (!updated) {
				throw new ORPCError("NOT_FOUND", {
					message: "Oportunidad no encontrada",
				});
			}

			// Notificar progreso de firmas
			const [lead] = await db
				.select()
				.from(investmentLeads)
				.where(eq(investmentLeads.id, updated.investmentLeadId))
				.limit(1);

			await createNotification({
				titulo: `Firma ${input.signaturesCompleted}/${updated.signaturesTotal} - ${lead?.name}`,
				descripcion: `Se completo la firma ${input.signaturesCompleted} de ${updated.signaturesTotal}`,
				type: "aviso",
				createdBy: context.userId,
				createdByRole: context.userRole,
				assignedToRole: context.userRole,
				assignedTo: updated.assignedAdvisorId,
				relatedEntityType: "opportunity",
				relatedEntityId: updated.id,
			});

			await db.insert(investmentAuditLog).values({
				investmentOpportunityId: input.opportunityId,
				action: "signature_updated",
				details: {
					completed: input.signaturesCompleted,
					total: updated.signaturesTotal,
				},
				performedBy: context.userId,
			});

			return updated;
		}),

	// ============ NON-ADVANCE SURVEY ============

	submitNonAdvanceSurvey: investmentProcedure
		.input(
			z.object({
				investmentOpportunityId: z.string().uuid(),
				reason: z.string().min(1),
				additionalComments: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const [survey] = await db
				.insert(investmentNonAdvanceSurvey)
				.values({
					...input,
					createdBy: context.userId,
				})
				.returning();

			await db.insert(investmentAuditLog).values({
				investmentOpportunityId: input.investmentOpportunityId,
				action: "non_advance_survey_submitted",
				details: { reason: input.reason },
				performedBy: context.userId,
			});

			return survey;
		}),

	// ============ CHECKLIST UPDATES ============

	updateNegotiationChecklist: investmentProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
				kycCompleted: z.boolean().optional(),
				profileCompleted: z.boolean().optional(),
				webappProfileCreated: z.boolean().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const { opportunityId, ...data } = input;
			const updateData: Record<string, unknown> = { updatedAt: new Date() };

			if (data.kycCompleted !== undefined)
				updateData.kycCompleted = data.kycCompleted;
			if (data.profileCompleted !== undefined)
				updateData.profileCompleted = data.profileCompleted;
			if (data.webappProfileCreated !== undefined)
				updateData.webappProfileCreated = data.webappProfileCreated;

			const [updated] = await db
				.update(investmentOpportunities)
				.set(updateData)
				.where(eq(investmentOpportunities.id, opportunityId))
				.returning();

			if (!updated) {
				throw new ORPCError("NOT_FOUND", {
					message: "Oportunidad no encontrada",
				});
			}

			return updated;
		}),

	// ============ AUDIT LOG ============

	getInvestmentAuditLog: investmentProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
			}),
		)
		.handler(async ({ input }) => {
			return await db
				.select()
				.from(investmentAuditLog)
				.where(
					eq(investmentAuditLog.investmentOpportunityId, input.opportunityId),
				)
				.orderBy(desc(investmentAuditLog.createdAt));
		}),

	// ============ DASHBOARD STATS ============

	getInvestmentDashboardStats: investmentProcedure.handler(
		async ({ context }) => {
			const conditions =
				context.userRole === ROLES.INVESTMENT_ADVISOR_JR
					? [eq(investmentOpportunities.assignedAdvisorId, context.userId)]
					: [];

			const allOpps = await db
				.select()
				.from(investmentOpportunities)
				.where(conditions.length > 0 ? and(...conditions) : undefined);

			const byStage = allOpps.reduce(
				(acc, opp) => {
					acc[opp.stage] = (acc[opp.stage] || 0) + 1;
					return acc;
				},
				{} as Record<string, number>,
			);

			return {
				totalOpportunities: allOpps.length,
				byStage,
				openOpportunities: allOpps.filter((o) => o.status === "open").length,
				wonOpportunities: allOpps.filter((o) => o.status === "won").length,
				lostOpportunities: allOpps.filter((o) => o.status === "lost").length,
			};
		},
	),
};

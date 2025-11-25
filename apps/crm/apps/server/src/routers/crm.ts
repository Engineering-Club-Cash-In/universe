import { and, count, eq, or } from "drizzle-orm";
import { z } from "zod";
import { vehicleInspections } from "../db/schema";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { contratosFinanciamiento, cuotasPago } from "../db/schema/cobros";
import {
	clients,
	companies,
	creditAnalysis,
	leads,
	opportunities,
	opportunityStageHistory,
	salesStages,
} from "../db/schema/crm";
import {
	documentRequirements,
	documentValidations,
	opportunityDocuments,
} from "../db/schema/documents";
import { analystProcedure, crmProcedure } from "../lib/orpc";
import {
	deleteFileFromR2,
	generateUniqueFilename,
	getFileUrl,
	uploadFileToR2,
	validateFile,
} from "../lib/storage";

export const crmRouter = {
	// Sales Stages (read-only for all CRM users)
	getSalesStages: crmProcedure.handler(async ({ context: _ }) => {
		const stages = await db
			.select()
			.from(salesStages)
			.orderBy(salesStages.order);
		return stages;
	}),

	// Get sales users for assignment dropdown
	getCrmUsers: crmProcedure.handler(async () => {
		const users = await db
			.select({
				id: user.id,
				name: user.name,
				email: user.email,
				role: user.role,
			})
			.from(user)
			.where(eq(user.role, "sales"));

		return users;
	}),

	// Companies
	getCompanies: crmProcedure.handler(async ({ context }) => {
		// Admin can see all companies, sales can only see companies they created or are assigned to
		if (context.userRole === "admin") {
			return await db.select().from(companies).orderBy(companies.createdAt);
		}
		return await db
			.select()
			.from(companies)
			.where(eq(companies.createdBy, context.userId))
			.orderBy(companies.createdAt);
	}),

	createCompany: crmProcedure
		.input(
			z.object({
				name: z.string().min(1, "Company name is required"),
				industry: z.string().optional(),
				size: z.string().optional(),
				website: z.string().optional(),
				address: z.string().optional(),
				phone: z.string().optional(),
				email: z.string().email().optional(),
				notes: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const newCompany = await db
				.insert(companies)
				.values({
					...input,
					createdBy: context.userId,
					updatedAt: new Date(),
				})
				.returning();
			return newCompany[0];
		}),

	updateCompany: crmProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				name: z.string().min(1, "Company name is required").optional(),
				industry: z.string().optional(),
				size: z.string().optional(),
				website: z.string().optional(),
				address: z.string().optional(),
				phone: z.string().optional(),
				email: z.string().email().optional(),
				notes: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const { id, ...updateData } = input;

			// Sales users can only update companies they created
			const whereClause =
				context.userRole === "admin"
					? eq(companies.id, id)
					: and(eq(companies.id, id), eq(companies.createdBy, context.userId));

			const updatedCompany = await db
				.update(companies)
				.set({ ...updateData, updatedAt: new Date() })
				.where(whereClause)
				.returning();

			if (updatedCompany.length === 0) {
				throw new Error(
					"Company not found or you don't have permission to update it",
				);
			}

			return updatedCompany[0];
		}),

	// Leads
	getLeads: crmProcedure.handler(async ({ context }) => {
		// Admin can see all leads, sales can only see leads assigned to them
		if (context.userRole === "admin") {
			return await db
				.select({
					id: leads.id,
					firstName: leads.firstName,
					lastName: leads.lastName,
					email: leads.email,
					phone: leads.phone,
					age: leads.age,
					dpi: leads.dpi,
					maritalStatus: leads.maritalStatus,
					dependents: leads.dependents,
					monthlyIncome: leads.monthlyIncome,
					loanAmount: leads.loanAmount,
					occupation: leads.occupation,
					workTime: leads.workTime,
					loanPurpose: leads.loanPurpose,
					ownsHome: leads.ownsHome,
					ownsVehicle: leads.ownsVehicle,
					hasCreditCard: leads.hasCreditCard,
					jobTitle: leads.jobTitle,
					source: leads.source,
					status: leads.status,
					assignedTo: leads.assignedTo,
					notes: leads.notes,
					score: leads.score,
					fit: leads.fit,
					scoredAt: leads.scoredAt,
					createdAt: leads.createdAt,
					updatedAt: leads.updatedAt,
					company: {
						id: companies.id,
						name: companies.name,
					},
					assignedUser: {
						id: user.id,
						name: user.name,
					},
				})
				.from(leads)
				.leftJoin(companies, eq(leads.companyId, companies.id))
				.leftJoin(user, eq(leads.assignedTo, user.id))
				.orderBy(leads.createdAt);
		}
		return await db
			.select({
				id: leads.id,
				firstName: leads.firstName,
				lastName: leads.lastName,
				email: leads.email,
				phone: leads.phone,
				age: leads.age,
				dpi: leads.dpi,
				maritalStatus: leads.maritalStatus,
				dependents: leads.dependents,
				monthlyIncome: leads.monthlyIncome,
				loanAmount: leads.loanAmount,
				occupation: leads.occupation,
				workTime: leads.workTime,
				loanPurpose: leads.loanPurpose,
				ownsHome: leads.ownsHome,
				ownsVehicle: leads.ownsVehicle,
				hasCreditCard: leads.hasCreditCard,
				jobTitle: leads.jobTitle,
				source: leads.source,
				status: leads.status,
				assignedTo: leads.assignedTo,
				notes: leads.notes,
				score: leads.score,
				fit: leads.fit,
				scoredAt: leads.scoredAt,
				createdAt: leads.createdAt,
				updatedAt: leads.updatedAt,
				company: {
					id: companies.id,
					name: companies.name,
				},
				assignedUser: {
					id: user.id,
					name: user.name,
				},
			})
			.from(leads)
			.leftJoin(companies, eq(leads.companyId, companies.id))
			.leftJoin(user, eq(leads.assignedTo, user.id))
			.where(eq(leads.assignedTo, context.userId))
			.orderBy(leads.createdAt);
	}),

	createLead: crmProcedure
		.input(
			z.object({
				firstName: z.string().min(1, "First name is required"),
				lastName: z.string().min(1, "Last name is required"),
				email: z.string().email("Valid email is required"),
				phone: z.string().min(1, "Phone is required"),
				age: z.number().int().positive().optional(),
				dpi: z.string().optional(),
				maritalStatus: z
					.enum(["single", "married", "divorced", "widowed"])
					.optional(),
				dependents: z.number().int().min(0).default(0),
				monthlyIncome: z.number().positive().optional(),
				loanAmount: z.number().positive().optional(),
				occupation: z.enum(["owner", "employee"]).optional(),
				workTime: z
					.enum(["less_than_1", "1_to_5", "5_to_10", "10_plus"])
					.optional(),
				loanPurpose: z.enum(["personal", "business"]).optional(),
				ownsHome: z.boolean().default(false),
				ownsVehicle: z.boolean().default(false),
				hasCreditCard: z.boolean().default(false),
				jobTitle: z.string().optional(),
				companyId: z.string().uuid().optional(),
				source: z.enum([
					"website",
					"referral",
					"cold_call",
					"email",
					"social_media",
					"event",
					"other",
				]),
				assignedTo: z.string().optional(), // Better Auth user ID (text, not UUID)
				notes: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			// If no assignedTo specified, assign to current user
			// Admin can assign to anyone, sales can only assign to themselves
			const assignedTo = input.assignedTo || context.userId;

			if (context.userRole === "sales" && assignedTo !== context.userId) {
				throw new Error("Sales users can only assign leads to themselves");
			}

			const newLead = await db
				.insert(leads)
				.values({
					...input,
					monthlyIncome: input.monthlyIncome?.toString(),
					loanAmount: input.loanAmount?.toString(),
					assignedTo,
					createdBy: context.userId,
					updatedAt: new Date(),
				})
				.returning();
			return newLead[0];
		}),

	updateLead: crmProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				firstName: z.string().min(1, "First name is required").optional(),
				lastName: z.string().min(1, "Last name is required").optional(),
				email: z.string().email("Valid email is required").optional(),
				phone: z.string().optional(),
				age: z.number().int().positive().optional(),
				dpi: z.string().optional(),
				maritalStatus: z
					.enum(["single", "married", "divorced", "widowed"])
					.optional(),
				dependents: z.number().int().min(0).optional(),
				monthlyIncome: z.number().positive().optional(),
				loanAmount: z.number().positive().optional(),
				occupation: z.enum(["owner", "employee"]).optional(),
				workTime: z
					.enum(["less_than_1", "1_to_5", "5_to_10", "10_plus"])
					.optional(),
				loanPurpose: z.enum(["personal", "business"]).optional(),
				ownsHome: z.boolean().optional(),
				ownsVehicle: z.boolean().optional(),
				hasCreditCard: z.boolean().optional(),
				jobTitle: z.string().optional(),
				companyId: z.string().uuid().optional(),
				source: z
					.enum([
						"website",
						"referral",
						"cold_call",
						"email",
						"social_media",
						"event",
						"other",
					])
					.optional(),
				status: z
					.enum(["new", "contacted", "qualified", "unqualified", "converted"])
					.optional(),
				assignedTo: z.string().optional(), // Better Auth user ID (text, not UUID)
				notes: z.string().optional(),
				score: z.number().min(0).max(1).optional(),
				fit: z.boolean().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const { id, assignedTo, ...updateData } = input;

			// Sales users can only update leads assigned to them
			const whereClause =
				context.userRole === "admin"
					? eq(leads.id, id)
					: and(eq(leads.id, id), eq(leads.assignedTo, context.userId));

			// Sales users cannot reassign leads
			if (
				context.userRole === "sales" &&
				assignedTo &&
				assignedTo !== context.userId
			) {
				throw new Error("Sales users cannot reassign leads");
			}

			const updatedLead = await db
				.update(leads)
				.set({
					...updateData,
					monthlyIncome: updateData.monthlyIncome?.toString(),
					loanAmount: updateData.loanAmount?.toString(),
					score: updateData.score?.toString(),
					...(assignedTo && { assignedTo }),
					...(updateData.score !== undefined && { scoredAt: new Date() }),
					updatedAt: new Date(),
				})
				.where(whereClause)
				.returning();

			if (updatedLead.length === 0) {
				throw new Error(
					"Lead not found or you don't have permission to update it",
				);
			}

			return updatedLead[0];
		}),

	// Credit Analysis
	getCreditAnalysisByLeadId: crmProcedure
		.input(z.object({ leadId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			// Check if user has access to the lead
			const lead = await db
				.select()
				.from(leads)
				.where(eq(leads.id, input.leadId))
				.limit(1);

			if (lead.length === 0) {
				throw new Error("Lead not found");
			}

			// Sales users can only see analysis for their assigned leads
			if (
				context.userRole === "sales" &&
				lead[0].assignedTo !== context.userId
			) {
				throw new Error("You don't have permission to view this analysis");
			}

			const analysis = await db
				.select()
				.from(creditAnalysis)
				.where(eq(creditAnalysis.leadId, input.leadId))
				.limit(1);

			return analysis[0] || null;
		}),

	// Opportunities
	getOpportunities: crmProcedure.handler(async ({ context }) => {
		if (context.userRole === "admin") {
			return await db
				.select({
					id: opportunities.id,
					title: opportunities.title,
					vehicleId: opportunities.vehicleId,
					creditType: opportunities.creditType,
					value: opportunities.value,
					probability: opportunities.probability,
					expectedCloseDate: opportunities.expectedCloseDate,
					status: opportunities.status,
					assignedTo: opportunities.assignedTo,
					notes: opportunities.notes,
					createdAt: opportunities.createdAt,
					updatedAt: opportunities.updatedAt,
					company: {
						id: companies.id,
						name: companies.name,
					},
					lead: {
						id: leads.id,
						firstName: leads.firstName,
						lastName: leads.lastName,
						email: leads.email,
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
				})
				.from(opportunities)
				.leftJoin(companies, eq(opportunities.companyId, companies.id))
				.leftJoin(leads, eq(opportunities.leadId, leads.id))
				.leftJoin(salesStages, eq(opportunities.stageId, salesStages.id))
				.leftJoin(user, eq(opportunities.assignedTo, user.id))
				.orderBy(opportunities.createdAt);
		}
		return await db
			.select({
				id: opportunities.id,
				title: opportunities.title,
				vehicleId: opportunities.vehicleId,
				creditType: opportunities.creditType,
				value: opportunities.value,
				probability: opportunities.probability,
				expectedCloseDate: opportunities.expectedCloseDate,
				status: opportunities.status,
				assignedTo: opportunities.assignedTo,
				notes: opportunities.notes,
				createdAt: opportunities.createdAt,
				updatedAt: opportunities.updatedAt,
				company: {
					id: companies.id,
					name: companies.name,
				},
				lead: {
					id: leads.id,
					firstName: leads.firstName,
					lastName: leads.lastName,
					email: leads.email,
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
			})
			.from(opportunities)
			.leftJoin(companies, eq(opportunities.companyId, companies.id))
			.leftJoin(leads, eq(opportunities.leadId, leads.id))
			.leftJoin(salesStages, eq(opportunities.stageId, salesStages.id))
			.leftJoin(user, eq(opportunities.assignedTo, user.id))
			.where(eq(opportunities.assignedTo, context.userId))
			.orderBy(opportunities.createdAt);
	}),

	createOpportunity: crmProcedure
		.input(
			z.object({
				title: z.string().min(1, "Title is required"),
				leadId: z.string().uuid().optional(),
				companyId: z.string().uuid().optional(),
				vehicleId: z.string().uuid().optional(),
				creditType: z.enum(["autocompra", "sobre_vehiculo"]),
				value: z.string().optional(), // Will be converted to decimal
				stageId: z.string().uuid(),
				probability: z.number().min(0).max(100).optional(),
				expectedCloseDate: z.string().optional(), // ISO date string
				assignedTo: z.string().optional(), // Better Auth user ID (text, not UUID)
				vendorId: z.string().uuid().optional(), // Vehicle vendor
				notes: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const assignedTo = input.assignedTo || context.userId;

			if (context.userRole === "sales" && assignedTo !== context.userId) {
				throw new Error(
					"Sales users can only assign opportunities to themselves",
				);
			}

			// If a lead is provided, get the company from the lead
			let companyId = input.companyId;
			if (input.leadId) {
				const lead = await db
					.select()
					.from(leads)
					.where(eq(leads.id, input.leadId))
					.limit(1);
				if (lead.length > 0 && lead[0].companyId) {
					companyId = lead[0].companyId;
				}
			}

			const newOpportunity = await db
				.insert(opportunities)
				.values({
					...input,
					companyId,
					assignedTo,
					expectedCloseDate: input.expectedCloseDate
						? new Date(input.expectedCloseDate)
						: undefined,
					createdBy: context.userId,
					updatedAt: new Date(),
				})
				.returning();
			return newOpportunity[0];
		}),

	updateOpportunity: crmProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				title: z.string().min(1, "Title is required").optional(),
				leadId: z.string().uuid().optional(),
				companyId: z.string().uuid().optional(),
				vehicleId: z.string().uuid().nullable().optional(),
				creditType: z.enum(["autocompra", "sobre_vehiculo"]).optional(),
				value: z.string().optional(),
				stageId: z.string().uuid().optional(),
				probability: z.number().min(0).max(100).optional(),
				expectedCloseDate: z.string().optional(),
				status: z.enum(["open", "won", "lost", "on_hold"]).optional(),
				assignedTo: z.string().optional(), // Better Auth user ID (text, not UUID)
				notes: z.string().optional(),
				stageChangeReason: z.string().optional(),
				// Credit terms
				numeroCuotas: z.number().int().positive().optional(),
				tasaInteres: z.string().optional(),
				cuotaMensual: z.string().optional(),
				fechaInicio: z.string().optional(),
				diaPagoMensual: z.number().int().min(1).max(31).optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const { id, assignedTo, stageChangeReason, ...updateData } = input;

			// Get current opportunity to check for stage changes
			const currentOpportunity = await db
				.select()
				.from(opportunities)
				.where(eq(opportunities.id, id))
				.limit(1);

			if (!currentOpportunity[0]) {
				throw new Error("Opportunity not found");
			}

			// Validate credit terms if moving to 100% stage
			if (input.stageId) {
				const targetStage = await db
					.select()
					.from(salesStages)
					.where(eq(salesStages.id, input.stageId))
					.limit(1);

				if (targetStage[0]?.closurePercentage === 100) {
					// Check all required fields for contract creation
					const opp = currentOpportunity[0];
					const missingFields: string[] = [];

					if (!opp.vehicleId && !input.vehicleId)
						missingFields.push("vehículo");
					if (!opp.leadId) missingFields.push("lead/contacto");
					if (!opp.value && !input.value)
						missingFields.push("valor del crédito");

					// Credit terms
					const numeroCuotas = input.numeroCuotas ?? opp.numeroCuotas;
					const tasaInteres = input.tasaInteres ?? opp.tasaInteres;
					const cuotaMensual = input.cuotaMensual ?? opp.cuotaMensual;
					const fechaInicio = input.fechaInicio ?? opp.fechaInicio;
					const diaPagoMensual = input.diaPagoMensual ?? opp.diaPagoMensual;

					if (!numeroCuotas) missingFields.push("número de cuotas");
					if (!tasaInteres) missingFields.push("tasa de interés");
					if (!cuotaMensual) missingFields.push("cuota mensual");
					if (!fechaInicio) missingFields.push("fecha de inicio del contrato");
					if (!diaPagoMensual) missingFields.push("día de pago mensual");

					if (missingFields.length > 0) {
						throw new Error(
							`No se puede cerrar la oportunidad al 100%. Faltan los siguientes datos: ${missingFields.join(", ")}`,
						);
					}

					// If moving to 100%, create client and contract
					if (targetStage[0]?.closurePercentage === 100) {
						// All validations passed - create client and contract
						const opp = currentOpportunity[0];
						const finalVehicleId = input.vehicleId ?? opp.vehicleId;
						const finalValue = input.value ?? opp.value;
						const finalNumeroCuotas = input.numeroCuotas ?? opp.numeroCuotas;
						const finalTasaInteres = input.tasaInteres ?? opp.tasaInteres;
						const finalCuotaMensual = input.cuotaMensual ?? opp.cuotaMensual;
						const finalFechaInicio = input.fechaInicio ?? opp.fechaInicio;
						const finalDiaPagoMensual =
							input.diaPagoMensual ?? opp.diaPagoMensual;

						if (!opp.leadId) {
							throw new Error(
								"No se puede crear el contrato sin un lead asociado",
							);
						}

						// Get lead data to obtain companyId
						const leadData = await db
							.select()
							.from(leads)
							.where(eq(leads.id, opp.leadId))
							.limit(1);

						if (!leadData[0]) {
							throw new Error("Lead no encontrado");
						}

						const lead = leadData[0];
						const companyId = opp.companyId ?? lead.companyId;

						if (!companyId) {
							throw new Error(
								"El lead debe tener una empresa asociada para crear el contrato",
							);
						}

						// Check if client already exists for this lead/company
						const existingClient = await db
							.select()
							.from(clients)
							.where(
								and(
									eq(clients.companyId, companyId),
									eq(clients.opportunityId, opp.id),
								),
							)
							.limit(1);

						let clientId: string;

						if (existingClient.length > 0) {
							clientId = existingClient[0].id;
						} else {
							// Create new client
							const newClient = await db
								.insert(clients)
								.values({
									companyId,
									opportunityId: opp.id,
									contactPerson: `${lead.firstName} ${lead.lastName}`,
									contractValue: finalValue,
									startDate: new Date(finalFechaInicio as string),
									status: "active",
									assignedTo: opp.assignedTo,
									notes: `Cliente generado automáticamente desde oportunidad: ${opp.title}`,
									createdBy: context.userId,
								})
								.returning();

							clientId = newClient[0].id;
						}

						// Calculate contract end date
						const fechaInicioDate = new Date(finalFechaInicio as string);
						const fechaVencimiento = new Date(fechaInicioDate);
						fechaVencimiento.setMonth(
							fechaVencimiento.getMonth() + (finalNumeroCuotas as number),
						);

						// Create financing contract
						const newContract = await db
							.insert(contratosFinanciamiento)
							.values({
								clientId,
								vehicleId: finalVehicleId as string,
								montoFinanciado: finalValue as string,
								cuotaMensual: finalCuotaMensual as string,
								numeroCuotas: finalNumeroCuotas as number,
								tasaInteres: finalTasaInteres as string,
								fechaInicio: fechaInicioDate,
								fechaVencimiento,
								diaPagoMensual: finalDiaPagoMensual as number,
								estado: "activo",
								notes: `Contrato generado desde oportunidad: ${opp.title}`,
								createdBy: context.userId,
							})
							.returning();

						// Generate payment installments (cuotas)
						const cuotasValues = [];
						for (let i = 1; i <= (finalNumeroCuotas as number); i++) {
							const fechaVencimientoCuota = new Date(fechaInicioDate);
							fechaVencimientoCuota.setMonth(
								fechaVencimientoCuota.getMonth() + i,
							);
							// Set to the payment day of the month
							fechaVencimientoCuota.setDate(finalDiaPagoMensual as number);

							cuotasValues.push({
								contratoId: newContract[0].id,
								numeroCuota: i,
								fechaVencimiento: fechaVencimientoCuota,
								montoCuota: finalCuotaMensual as string,
								estadoMora: "al_dia" as const,
								diasMora: 0,
							});
						}

						await db.insert(cuotasPago).values(cuotasValues);

						// Update opportunity to mark as won and set close date
						updateData.status = "won";
					}
				}
			}

			// Sales users can only update opportunities assigned to them
			const whereClause =
				context.userRole === "admin"
					? eq(opportunities.id, id)
					: and(
							eq(opportunities.id, id),
							eq(opportunities.assignedTo, context.userId),
						);

			// Sales users cannot reassign opportunities
			if (
				context.userRole === "sales" &&
				assignedTo &&
				assignedTo !== context.userId
			) {
				throw new Error("Sales users cannot reassign opportunities");
			}

			// Check if this is a stage change
			const isStageChange =
				input.stageId && input.stageId !== currentOpportunity[0].stageId;

			// Check if this is an override (sales moving from analysis stage)
			let isOverride = false;
			if (isStageChange && context.userRole === "sales") {
				const analysisStage = await db
					.select()
					.from(salesStages)
					.where(
						eq(
							salesStages.name,
							"Recepción de documentación y traslado a análisis",
						),
					)
					.limit(1);

				if (
					analysisStage[0] &&
					currentOpportunity[0].stageId === analysisStage[0].id
				) {
					isOverride = true;
				}
			}

			const updatedOpportunity = await db
				.update(opportunities)
				.set({
					...updateData,
					...(assignedTo && { assignedTo }),
					expectedCloseDate: updateData.expectedCloseDate
						? new Date(updateData.expectedCloseDate)
						: undefined,
					fechaInicio: updateData.fechaInicio
						? new Date(updateData.fechaInicio)
						: undefined,
					...(updateData.status === "won" && { actualCloseDate: new Date() }),
					updatedAt: new Date(),
				})
				.where(whereClause)
				.returning();

			if (updatedOpportunity.length === 0) {
				throw new Error(
					"Opportunity not found or you don't have permission to update it",
				);
			}

			// Record stage history if stage changed
			if (isStageChange && input.stageId) {
				await db.insert(opportunityStageHistory).values({
					opportunityId: id,
					fromStageId: currentOpportunity[0].stageId,
					toStageId: input.stageId,
					changedBy: context.userId,
					reason:
						stageChangeReason ||
						(isOverride
							? "Ventas movió la oportunidad desde análisis"
							: "Cambio de etapa"),
					isOverride,
				});
			}

			return updatedOpportunity[0];
		}),

	// Analyst specific endpoints
	getOpportunitiesForAnalysis: analystProcedure.handler(
		async ({ context: _ }) => {
			// Get the stage ID for "Recepción de documentación y traslado a análisis"
			const analysisStage = await db
				.select()
				.from(salesStages)
				.where(
					eq(
						salesStages.name,
						"Recepción de documentación y traslado a análisis",
					),
				)
				.limit(1);

			if (!analysisStage[0]) {
				throw new Error("Analysis stage not found");
			}

			// Get all opportunities in the analysis stage
			return await db
				.select({
					id: opportunities.id,
					title: opportunities.title,
					value: opportunities.value,
					probability: opportunities.probability,
					expectedCloseDate: opportunities.expectedCloseDate,
					status: opportunities.status,
					notes: opportunities.notes,
					createdAt: opportunities.createdAt,
					updatedAt: opportunities.updatedAt,
					lead: {
						id: leads.id,
						firstName: leads.firstName,
						lastName: leads.lastName,
						email: leads.email,
						phone: leads.phone,
					},
					company: {
						id: companies.id,
						name: companies.name,
					},
				})
				.from(opportunities)
				.leftJoin(leads, eq(opportunities.leadId, leads.id))
				.leftJoin(companies, eq(opportunities.companyId, companies.id))
				.where(eq(opportunities.stageId, analysisStage[0].id))
				.orderBy(opportunities.createdAt);
		},
	),

	approveOpportunityAnalysis: analystProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
				approved: z.boolean(),
				reason: z.string().optional(),
				bypassValidation: z.boolean().optional(), // Solo admin puede usar bypass
			}),
		)
		.handler(async ({ input, context }) => {
			// Get current opportunity with stage info
			const opportunity = await db
				.select()
				.from(opportunities)
				.where(eq(opportunities.id, input.opportunityId))
				.limit(1);

			if (!opportunity[0]) {
				throw new Error("Opportunity not found");
			}

			// NUEVA VALIDACIÓN: Verificar documentos y vehículo antes de aprobar
			if (input.approved && !input.bypassValidation) {
				// Validar que tenga vehicleId y creditType
				if (!opportunity[0].vehicleId) {
					throw new Error("La oportunidad debe tener un vehículo asociado");
				}
				if (!opportunity[0].creditType) {
					throw new Error("La oportunidad debe tener un tipo de crédito");
				}

				// Validar inspección del vehículo
				const inspection = await db
					.select()
					.from(vehicleInspections)
					.where(
						and(
							eq(vehicleInspections.vehicleId, opportunity[0].vehicleId),
							eq(vehicleInspections.status, "approved"),
						),
					)
					.limit(1);

				if (!inspection || inspection.length === 0) {
					throw new Error("El vehículo debe tener una inspección aprobada");
				}

				// Validar documentos requeridos
				const requiredDocs = await db
					.select()
					.from(documentRequirements)
					.where(
						and(
							eq(documentRequirements.creditType, opportunity[0].creditType),
							eq(documentRequirements.required, true),
						),
					);

				const uploadedDocs = await db
					.select()
					.from(opportunityDocuments)
					.where(eq(opportunityDocuments.opportunityId, input.opportunityId));

				const uploadedTypes = new Set(uploadedDocs.map((d) => d.documentType));
				const requiredTypes = requiredDocs.map((r) => r.documentType);
				const missingDocs = requiredTypes.filter((t) => !uploadedTypes.has(t));

				if (missingDocs.length > 0) {
					const docLabels: Record<string, string> = {
						identification: "Identificación",
						income_proof: "Comprobante de Ingresos",
						bank_statement: "Estado de Cuenta",
						business_license: "Patente de Comercio",
						property_deed: "Escrituras",
						vehicle_title: "Tarjeta de Circulación",
						credit_report: "Reporte Crediticio",
						other: "Otros",
					};
					const missingLabels = missingDocs
						.map((d) => docLabels[d] || d)
						.join(", ");
					throw new Error(`Faltan documentos obligatorios: ${missingLabels}`);
				}

				// Registrar validación exitosa
				await db.insert(documentValidations).values({
					opportunityId: input.opportunityId,
					validatedBy: context.userId,
					allDocumentsPresent: true,
					vehicleInspected: true,
					missingDocuments: [],
					notes: "Validación automática al aprobar análisis",
				});
			}

			// Permitir bypass solo a admin
			if (input.bypassValidation && context.userRole !== "admin") {
				throw new Error("No tienes permisos para omitir la validación");
			}

			// Get the analysis stage
			const analysisStage = await db
				.select()
				.from(salesStages)
				.where(
					eq(
						salesStages.name,
						"Recepción de documentación y traslado a análisis",
					),
				)
				.limit(1);

			if (opportunity[0].stageId !== analysisStage[0].id) {
				throw new Error("Opportunity is not in analysis stage");
			}

			// Get the next stage
			const nextStage = await db
				.select()
				.from(salesStages)
				.where(eq(salesStages.order, 5)) // "Cierre de propuesta"
				.limit(1);

			if (!nextStage[0]) {
				throw new Error("Next stage not found");
			}

			// Update opportunity stage if approved
			const newStageId = input.approved
				? nextStage[0].id
				: opportunity[0].stageId;

			if (input.approved || input.reason) {
				// Update opportunity
				await db
					.update(opportunities)
					.set({
						stageId: newStageId,
						notes: input.reason
							? `${opportunity[0].notes || ""}\n\n[Análisis ${input.approved ? "Aprobado" : "Rechazado"}]: ${input.reason}`
							: opportunity[0].notes,
						updatedAt: new Date(),
					})
					.where(eq(opportunities.id, input.opportunityId));

				// Record stage history
				await db.insert(opportunityStageHistory).values({
					opportunityId: input.opportunityId,
					fromStageId: opportunity[0].stageId,
					toStageId: newStageId,
					changedBy: context.userId,
					reason:
						input.reason ||
						(input.approved
							? "Documentación aprobada"
							: "Documentación rechazada"),
					isOverride: false,
				});
			}

			return { success: true, approved: input.approved };
		}),

	getOpportunityHistory: crmProcedure
		.input(z.object({ opportunityId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			// Check if user has access to the opportunity
			const opportunity = await db
				.select()
				.from(opportunities)
				.where(eq(opportunities.id, input.opportunityId))
				.limit(1);

			if (!opportunity[0]) {
				throw new Error("Opportunity not found");
			}

			// For sales users, check if they are assigned to the opportunity
			if (
				context.userRole === "sales" &&
				opportunity[0].assignedTo !== context.userId
			) {
				throw new Error("You don't have permission to view this opportunity");
			}

			// Get stage history with user and stage details
			const history = await db
				.select({
					id: opportunityStageHistory.id,
					changedAt: opportunityStageHistory.changedAt,
					reason: opportunityStageHistory.reason,
					isOverride: opportunityStageHistory.isOverride,
					changedById: opportunityStageHistory.changedBy,
					fromStageId: opportunityStageHistory.fromStageId,
					toStageId: opportunityStageHistory.toStageId,
				})
				.from(opportunityStageHistory)
				.where(eq(opportunityStageHistory.opportunityId, input.opportunityId))
				.orderBy(opportunityStageHistory.changedAt);

			// Get all unique user IDs and stage IDs
			const userIds = [...new Set(history.map((h) => h.changedById))];
			const stageIds = [
				...new Set(
					history.flatMap((h) => [h.fromStageId, h.toStageId].filter(Boolean)),
				),
			];

			// Fetch users and stages
			const users =
				userIds.length > 0
					? await db
							.select()
							.from(user)
							.where(or(...userIds.map((id) => eq(user.id, id))))
					: [];
			const stages =
				stageIds.length > 0
					? await db
							.select()
							.from(salesStages)
							.where(
								or(
									...stageIds
										.filter((id): id is string => id !== null)
										.map((id) => eq(salesStages.id, id)),
								),
							)
					: [];

			// Map users and stages
			const userMap = new Map(users.map((u) => [u.id, u]));
			const stageMap = new Map(stages.map((s) => [s.id, s]));

			// Return formatted history
			return history.map((h) => ({
				id: h.id,
				changedAt: h.changedAt,
				reason: h.reason,
				isOverride: h.isOverride,
				changedBy: userMap.get(h.changedById)
					? {
							id: userMap.get(h.changedById)!.id,
							name: userMap.get(h.changedById)!.name,
							role: userMap.get(h.changedById)!.role,
						}
					: null,
				fromStage:
					h.fromStageId && stageMap.get(h.fromStageId)
						? {
								id: stageMap.get(h.fromStageId)!.id,
								name: stageMap.get(h.fromStageId)!.name,
							}
						: null,
				toStage: stageMap.get(h.toStageId)
					? {
							id: stageMap.get(h.toStageId)!.id,
							name: stageMap.get(h.toStageId)!.name,
						}
					: null,
			}));
		}),

	// Clients
	getClients: crmProcedure.handler(async ({ context }) => {
		if (context.userRole === "admin") {
			return await db
				.select({
					id: clients.id,
					contactPerson: clients.contactPerson,
					contractValue: clients.contractValue,
					startDate: clients.startDate,
					endDate: clients.endDate,
					status: clients.status,
					assignedTo: clients.assignedTo,
					notes: clients.notes,
					createdAt: clients.createdAt,
					updatedAt: clients.updatedAt,
					company: {
						id: companies.id,
						name: companies.name,
					},
				})
				.from(clients)
				.leftJoin(companies, eq(clients.companyId, companies.id))
				.orderBy(clients.createdAt);
		}
		return await db
			.select({
				id: clients.id,
				contactPerson: clients.contactPerson,
				contractValue: clients.contractValue,
				startDate: clients.startDate,
				endDate: clients.endDate,
				status: clients.status,
				assignedTo: clients.assignedTo,
				notes: clients.notes,
				createdAt: clients.createdAt,
				updatedAt: clients.updatedAt,
				company: {
					id: companies.id,
					name: companies.name,
				},
			})
			.from(clients)
			.leftJoin(companies, eq(clients.companyId, companies.id))
			.where(eq(clients.assignedTo, context.userId))
			.orderBy(clients.createdAt);
	}),

	createClient: crmProcedure
		.input(
			z.object({
				companyId: z.string().uuid(),
				contactPerson: z.string().min(1, "Contact person is required"),
				contractValue: z.string().optional(),
				startDate: z.string().optional(), // ISO date string
				endDate: z.string().optional(), // ISO date string
				assignedTo: z.string().optional(), // Better Auth user ID (text, not UUID)
				notes: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const assignedTo = input.assignedTo || context.userId;

			if (context.userRole === "sales" && assignedTo !== context.userId) {
				throw new Error("Sales users can only assign clients to themselves");
			}

			const newClient = await db
				.insert(clients)
				.values({
					...input,
					assignedTo,
					startDate: input.startDate ? new Date(input.startDate) : undefined,
					endDate: input.endDate ? new Date(input.endDate) : undefined,
					createdBy: context.userId,
					updatedAt: new Date(),
				})
				.returning();
			return newClient[0];
		}),

	updateClient: crmProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				companyId: z.string().uuid().optional(),
				contactPerson: z
					.string()
					.min(1, "Contact person is required")
					.optional(),
				contractValue: z.string().optional(),
				startDate: z.string().optional(),
				endDate: z.string().optional(),
				status: z.enum(["active", "inactive", "churned"]).optional(),
				assignedTo: z.string().optional(), // Better Auth user ID (text, not UUID)
				notes: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const { id, ...updateData } = input;

			// Sales users can only update clients assigned to them
			const whereClause =
				context.userRole === "admin"
					? eq(clients.id, id)
					: and(eq(clients.id, id), eq(clients.assignedTo, context.userId));

			const updatedClient = await db
				.update(clients)
				.set({
					...updateData,
					startDate: updateData.startDate
						? new Date(updateData.startDate)
						: undefined,
					endDate: updateData.endDate
						? new Date(updateData.endDate)
						: undefined,
					updatedAt: new Date(),
				})
				.where(whereClause)
				.returning();

			if (updatedClient.length === 0) {
				throw new Error(
					"Client not found or you don't have permission to update it",
				);
			}

			return updatedClient[0];
		}),

	// Dashboard stats
	getDashboardStats: crmProcedure.handler(async ({ context }) => {
		if (context.userRole === "admin") {
			// Admin gets global stats
			const [totalLeads] = await db.select({ count: count() }).from(leads);
			const [totalOpportunities] = await db
				.select({ count: count() })
				.from(opportunities);
			const [totalClients] = await db.select({ count: count() }).from(clients);

			return {
				totalLeads: totalLeads?.count || 0,
				totalOpportunities: totalOpportunities?.count || 0,
				totalClients: totalClients?.count || 0,
			};
		}
		// Sales users get their own stats
		const [myLeads] = await db
			.select({ count: count() })
			.from(leads)
			.where(eq(leads.assignedTo, context.userId));
		const [myOpportunities] = await db
			.select({ count: count() })
			.from(opportunities)
			.where(eq(opportunities.assignedTo, context.userId));
		const [myClients] = await db
			.select({ count: count() })
			.from(clients)
			.where(eq(clients.assignedTo, context.userId));

		return {
			myLeads: myLeads?.count || 0,
			myOpportunities: myOpportunities?.count || 0,
			myClients: myClients?.count || 0,
		};
	}),

	// Document Management
	getOpportunityDocuments: crmProcedure
		.input(z.object({ opportunityId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			// Verificar que el usuario tenga acceso a la oportunidad
			const opportunity = await db
				.select()
				.from(opportunities)
				.where(eq(opportunities.id, input.opportunityId))
				.limit(1);

			if (!opportunity[0]) {
				throw new Error("Oportunidad no encontrada");
			}

			// Para ventas, verificar que sea su oportunidad
			if (
				context.userRole === "sales" &&
				opportunity[0].assignedTo !== context.userId
			) {
				throw new Error("No tienes permiso para ver estos documentos");
			}

			// Obtener documentos con información del usuario que los subió
			const documents = await db
				.select({
					id: opportunityDocuments.id,
					filename: opportunityDocuments.filename,
					originalName: opportunityDocuments.originalName,
					mimeType: opportunityDocuments.mimeType,
					size: opportunityDocuments.size,
					documentType: opportunityDocuments.documentType,
					description: opportunityDocuments.description,
					uploadedAt: opportunityDocuments.uploadedAt,
					filePath: opportunityDocuments.filePath,
					uploadedBy: {
						id: user.id,
						name: user.name,
					},
				})
				.from(opportunityDocuments)
				.leftJoin(user, eq(opportunityDocuments.uploadedBy, user.id))
				.where(eq(opportunityDocuments.opportunityId, input.opportunityId))
				.orderBy(opportunityDocuments.uploadedAt);

			// Generar URLs firmadas para cada documento
			const documentsWithUrls = await Promise.all(
				documents.map(async (doc) => {
					const url = await getFileUrl(doc.filePath);
					return {
						...doc,
						url,
					};
				}),
			);

			return documentsWithUrls;
		}),

	uploadOpportunityDocument: crmProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
				documentType: z.enum([
					"identification",
					"income_proof",
					"bank_statement",
					"business_license",
					"property_deed",
					"vehicle_title",
					"credit_report",
					"other",
				]),
				description: z.string().optional(),
				// En un endpoint real, el archivo vendría como multipart/form-data
				// Aquí asumimos que ya tenemos los datos del archivo
				file: z.object({
					name: z.string(),
					type: z.string(),
					size: z.number(),
					data: z.string(), // Base64 o Buffer
				}),
			}),
		)
		.handler(async ({ input, context }) => {
			// Verificar acceso a la oportunidad
			const opportunity = await db
				.select()
				.from(opportunities)
				.where(eq(opportunities.id, input.opportunityId))
				.limit(1);

			if (!opportunity[0]) {
				throw new Error("Oportunidad no encontrada");
			}

			// Solo admin y sales pueden subir documentos
			if (!["admin", "sales"].includes(context.userRole)) {
				throw new Error("No tienes permiso para subir documentos");
			}

			// Para sales, verificar que sea su oportunidad
			if (
				context.userRole === "sales" &&
				opportunity[0].assignedTo !== context.userId
			) {
				throw new Error(
					"No tienes permiso para subir documentos a esta oportunidad",
				);
			}

			// Crear un File/Blob desde los datos
			const fileBuffer = Buffer.from(input.file.data, "base64");
			const fileBlob = new Blob([fileBuffer], { type: input.file.type });

			// Validar archivo
			const validation = validateFile({
				type: input.file.type,
				size: input.file.size,
			} as File);

			if (!validation.valid) {
				throw new Error(validation.error);
			}

			// Generar nombre único
			const uniqueFilename = generateUniqueFilename(input.file.name);

			// Subir a R2
			const { key } = await uploadFileToR2(
				fileBlob,
				uniqueFilename,
				input.opportunityId,
			);

			// Guardar en base de datos
			const [newDocument] = await db
				.insert(opportunityDocuments)
				.values({
					opportunityId: input.opportunityId,
					filename: uniqueFilename,
					originalName: input.file.name,
					mimeType: input.file.type,
					size: input.file.size,
					documentType: input.documentType,
					description: input.description,
					uploadedBy: context.userId,
					filePath: key,
				})
				.returning();

			return newDocument;
		}),

	deleteOpportunityDocument: crmProcedure
		.input(
			z.object({
				documentId: z.string().uuid(),
			}),
		)
		.handler(async ({ input, context }) => {
			// Obtener el documento
			const [document] = await db
				.select()
				.from(opportunityDocuments)
				.where(eq(opportunityDocuments.id, input.documentId))
				.limit(1);

			if (!document) {
				throw new Error("Documento no encontrado");
			}

			// Verificar permisos
			if (
				context.userRole === "admin" ||
				document.uploadedBy === context.userId
			) {
				// Eliminar de R2
				await deleteFileFromR2(document.filePath);

				// Eliminar de la base de datos
				await db
					.delete(opportunityDocuments)
					.where(eq(opportunityDocuments.id, input.documentId));

				return { success: true };
			}
			throw new Error("No tienes permiso para eliminar este documento");
		}),

	// Validate opportunity documents - Para analistas
	validateOpportunityDocuments: analystProcedure
		.input(z.object({ opportunityId: z.string().uuid() }))
		.handler(async ({ input }) => {
			try {
				// 1. Obtener oportunidad con vehículo
				const [opp] = await db
					.select()
					.from(opportunities)
					.where(eq(opportunities.id, input.opportunityId))
					.limit(1);

				if (!opp) {
					throw new Error("Oportunidad no encontrada");
				}

				// Si falta creditType, no podemos determinar requisitos
				if (!opp.creditType) {
					return {
						creditType: "unknown",
						vehicleInspected: false,
						allDocumentsPresent: false,
						canApprove: false,
						requiredDocuments: [],
						uploadedDocuments: [],
						missingDocuments: [],
						vehicleInfo: {
							id: opp.vehicleId || null,
							inspectionStatus: "pending",
						},
					};
				}

				// 2. Validar inspección del vehículo (solo si hay vehículo asociado)
				let vehicleInspected = false;
				let inspectionStatus = "pending";
				if (opp.vehicleId) {
					const inspection = await db
						.select()
						.from(vehicleInspections)
						.where(
							and(
								eq(vehicleInspections.vehicleId, opp.vehicleId),
								eq(vehicleInspections.status, "approved"),
							),
						)
						.limit(1);

					vehicleInspected = inspection.length > 0;
					if (inspection.length > 0) {
						inspectionStatus = inspection[0].status;
					}
				}

				// 3. Obtener documentos requeridos según tipo de crédito
				const requiredDocs = await db
					.select()
					.from(documentRequirements)
					.where(
						and(
							eq(documentRequirements.creditType, opp.creditType),
							eq(documentRequirements.required, true),
						),
					);

				// 4. Obtener documentos subidos
				const uploadedDocs = await db
					.select()
					.from(opportunityDocuments)
					.where(eq(opportunityDocuments.opportunityId, input.opportunityId));

				// 5. Calcular documentos faltantes
				const uploadedTypes = new Set(uploadedDocs.map((d) => d.documentType));
				const requiredTypes = requiredDocs.map((r) => r.documentType);
				const missingDocs = requiredTypes.filter((t) => !uploadedTypes.has(t));

				const allDocumentsPresent = missingDocs.length === 0;
				const canApprove = allDocumentsPresent && vehicleInspected;

				return {
					creditType: opp.creditType,
					vehicleInspected,
					allDocumentsPresent,
					canApprove,
					requiredDocuments: requiredDocs,
					uploadedDocuments: uploadedDocs,
					missingDocuments: missingDocs,
					vehicleInfo: {
						id: opp.vehicleId,
						inspectionStatus,
					},
				};
			} catch (error) {
				console.error("[validateOpportunityDocuments] ERROR:", error);
				throw error;
			}
		}),
};

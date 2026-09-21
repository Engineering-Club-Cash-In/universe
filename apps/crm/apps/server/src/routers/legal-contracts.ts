import { ORPCError } from "@orpc/server";
import { and, count, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { user } from "../db/schema/auth";
import {
	leads,
	opportunities,
	opportunityStageHistory,
	salesStages,
} from "../db/schema/crm";
import {
	contractSignatories,
	generatedLegalContracts,
} from "../db/schema/legal-contracts";
import { vehicles } from "../db/schema/vehicles";
import { auditedTransaction, auditRecord } from "../lib/audit";
import { documentIdDesdeLink } from "../lib/contract-signatories";
import {
	adminProcedure,
	juridicoProcedure,
	viewOpportunityContractsProcedure,
} from "../lib/orpc";
import { PERMISSIONS } from "../lib/roles";
import {
	buildUploadPrefix,
	getFileUrl,
	getFileUrlWithBucketInKey,
	verifyUploadedDocumentInR2,
} from "../lib/storage";
import { closeOpportunity } from "../services/close-opportunity";
import {
	consultarEstadoFirma,
	type EstadoDocumentoFirma,
	reenviarCorreoDeFirma,
	regenerarEnlacesDeFirma,
} from "../services/legal-docs-api";
import { sendContractLinksToLead } from "./messaging";
import { createNotification } from "./notifications";

// Standardized env var naming: R2_BUCKET_* pattern
const R2_LEGAL_DOCS_BUCKET_NAME =
	process.env.R2_BUCKET_LEGAL_DOCS ||
	process.env.R2_BUCKET_NAME_LEGAL_DOCS ||
	"legal-documents";

/**
 * Los firmantes de cada contrato, con su rol y su link.
 *
 * Los contratos generados antes de que se guardaran los roles no tienen filas
 * acá: para esos siguen valiendo las columnas por posición del contrato, que es
 * lo único que quedó registrado.
 */
async function firmantesPorContrato(
	contractIds: string[],
): Promise<Map<string, (typeof contractSignatories.$inferSelect)[]>> {
	const porContrato = new Map<
		string,
		(typeof contractSignatories.$inferSelect)[]
	>();
	if (contractIds.length === 0) return porContrato;

	const filas = await db
		.select()
		.from(contractSignatories)
		.where(inArray(contractSignatories.contractId, contractIds))
		.orderBy(contractSignatories.position);

	for (const fila of filas) {
		const lista = porContrato.get(fila.contractId) ?? [];
		lista.push(fila);
		porContrato.set(fila.contractId, lista);
	}
	return porContrato;
}

/**
 * Un contrato listo para hablar con WeeTrust, o el motivo por el que no se
 * puede.
 *
 * El `documentID` de los contratos viejos no se guardó, pero viaja dentro del
 * link de firma, así que se recupera de ahí antes de darse por vencido.
 */
async function contratoConDocumentID(contractId: string): Promise<{
	contract: typeof generatedLegalContracts.$inferSelect;
	documentID: string;
}> {
	const [contract] = await db
		.select()
		.from(generatedLegalContracts)
		.where(eq(generatedLegalContracts.id, contractId));

	if (!contract) {
		throw new ORPCError("NOT_FOUND", { message: "Contrato no encontrado" });
	}

	if (contract.signatureMode === "fisica") {
		throw new ORPCError("BAD_REQUEST", {
			message:
				"Este contrato se firma en papel: no tiene firma electrónica que consultar.",
		});
	}

	const documentID =
		contract.weetrustDocumentId ??
		documentIdDesdeLink(contract.clientSigningLink) ??
		documentIdDesdeLink(contract.representativeSigningLink) ??
		documentIdDesdeLink(contract.additionalSigningLinks?.[0] ?? null);

	if (!documentID) {
		throw new ORPCError("BAD_REQUEST", {
			message:
				"Este contrato no tiene documento en WeeTrust. Hay que regenerarlo.",
		});
	}

	return { contract, documentID };
}

/**
 * Baja a la base lo que WeeTrust dice del documento.
 *
 * Actualiza el link y el estado de cada firmante, y marca el contrato como
 * firmado cuando WeeTrust lo da por completado. Los firmantes se emparejan por
 * correo, que es la llave que usa WeeTrust.
 */
async function sincronizarEstadoDeFirma(
	contractId: string,
	estado: EstadoDocumentoFirma,
): Promise<void> {
	const ahora = new Date();

	for (const firmante of estado.signatories) {
		await db
			.update(contractSignatories)
			.set({
				status: firmante.isSigned ? "signed" : "pending",
				// Un link regenerado reemplaza al anterior; uno vacío no borra el
				// que ya teníamos, que puede seguir sirviendo.
				...(firmante.signingUrl ? { signingUrl: firmante.signingUrl } : {}),
				...(firmante.signatoryID
					? { weetrustSignatoryId: firmante.signatoryID }
					: {}),
				...(firmante.isSigned ? { signedAt: ahora } : { signedAt: null }),
				updatedAt: ahora,
			})
			.where(
				and(
					eq(contractSignatories.contractId, contractId),
					eq(contractSignatories.email, firmante.emailID),
				),
			);
	}

	const completado = estado.status === "COMPLETED";
	await db
		.update(generatedLegalContracts)
		.set({
			// Sólo se avanza a "firmado". Que WeeTrust reporte PENDING no es motivo
			// para revivir un contrato que alguien ya cerró o canceló a mano.
			...(completado ? { status: "signed" as const } : {}),
			weetrustDocumentId: estado.documentID,
			updatedAt: ahora,
		})
		.where(eq(generatedLegalContracts.id, contractId));
}

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
						key: z.string(), // R2 key from presigned upload
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

			// Guardar key del PDF si se proporciono (ya subido a R2 via presigned URL)
			let pdfLink: string | undefined;
			if (input.pdfFile) {
				const uploadedFile = await verifyUploadedDocumentInR2({
					key: input.pdfFile.key,
					expectedPrefix: buildUploadPrefix(
						"legal_contract_pdf",
						input.opportunityId || input.leadId,
					),
					filename: input.pdfFile.name,
					mimeType: input.pdfFile.type,
				});

				pdfLink = uploadedFile.key;
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
						key: z.string(), // R2 key from presigned upload
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

			// Guardar key del PDF si se proporciono (ya subido a R2 via presigned URL)
			let pdfLink: string | undefined;
			if (input.pdfFile) {
				const uploadedFile = await verifyUploadedDocumentInR2({
					key: input.pdfFile.key,
					expectedPrefix: buildUploadPrefix(
						"legal_contract_pdf",
						existingContract.opportunityId || existingContract.leadId,
					),
					filename: input.pdfFile.name,
					mimeType: input.pdfFile.type,
				});

				pdfLink = uploadedFile.key;
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

	// Eliminar contrato legal
	deleteLegalContract: juridicoProcedure
		.input(
			z.object({
				contractId: z.string().uuid(),
			}),
		)
		.handler(async ({ input, context }) => {
			// Verificar permisos
			if (!context.canCreateLegalContracts) {
				throw new ORPCError("FORBIDDEN", {
					message: "No tienes permisos para eliminar contratos",
				});
			}

			// Verificar que el contrato existe
			const [existingContract] = await db
				.select()
				.from(generatedLegalContracts)
				.where(eq(generatedLegalContracts.id, input.contractId))
				.limit(1);

			if (!existingContract) {
				throw new ORPCError("NOT_FOUND", {
					message: "Contrato no encontrado",
				});
			}

			// Eliminar el contrato
			await db
				.delete(generatedLegalContracts)
				.where(eq(generatedLegalContracts.id, input.contractId));

			return {
				success: true,
				message: "Contrato eliminado exitosamente",
			};
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

			const firmantes = await firmantesPorContrato(
				contracts.map((c) => c.contract.id),
			);

			return contracts.map((c) => ({
				...c,
				signatories: firmantes.get(c.contract.id) ?? [],
			}));
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

			// Verificar estado de firma en Documenso y generar URLs firmadas para PDFs
			const contractsWithUpdatedStatus = await Promise.all(
				contracts.map(async (contractData) => {
					const updatedContract = contractData.contract;
					// TODO: Aun nadie usa Documenso, deshabilitado por ahora
					// Solo verificar si el contrato está pendiente y tiene link de firma del cliente
					/*if (
						contractData.contract.status === "pending" &&
						contractData.contract.clientSigningLink
					) {
						const signingStatus = await checkDocumensoSigningStatus(
							contractData.contract.clientSigningLink,
						);

						// Si está firmado, actualizar en la base de datos
						if (signingStatus.isSigned) {
							const [dbUpdatedContract] = await db
								.update(generatedLegalContracts)
								.set({
									status: "signed",
									updatedAt: new Date(),
								})
								.where(eq(generatedLegalContracts.id, contractData.contract.id))
								.returning();

							updatedContract = dbUpdatedContract;
						}
					}*/

					// Generar URL firmada fresca si pdfLink es una key (no es URL de documenso)
					let pdfLinkUrl = updatedContract.pdfLink;
					if (
						updatedContract.pdfLink &&
						!updatedContract.pdfLink.includes("documenso")
					) {
						// Si es una key (no empieza con http), generar URL firmada
						if (!updatedContract.pdfLink.startsWith("http")) {
							try {
								if (
									updatedContract.pdfLink.includes(R2_LEGAL_DOCS_BUCKET_NAME)
								) {
									pdfLinkUrl = await getFileUrlWithBucketInKey(
										updatedContract.pdfLink,
									);
								} else {
									pdfLinkUrl = await getFileUrl(updatedContract.pdfLink);
								}
							} catch (error) {
								console.error(
									`Error generando URL para contrato ${updatedContract.id}:`,
									error,
								);
								// Mantener el valor original si hay error
							}
						}
					}

					return {
						...contractData,
						contract: {
							...updatedContract,
							pdfLink: pdfLinkUrl,
						},
					};
				}),
			);

			const firmantes = await firmantesPorContrato(
				contractsWithUpdatedStatus.map((c) => c.contract.id),
			);

			return contractsWithUpdatedStatus.map((c) => ({
				...c,
				signatories: firmantes.get(c.contract.id) ?? [],
			}));
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
						middleName: leads.middleName,
						lastName: leads.lastName,
						secondLastName: leads.secondLastName,
						dpi: leads.dpi,
						email: leads.email,
						phone: leads.phone,
						age: leads.age,
						direccion: leads.direccion,
						departamento: leads.departamento,
						municipio: leads.municipio,
						zona: leads.zona,
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
						ne(opportunities.status, "lost"), // en un futuro agregar el estado "migrate"
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
		.meta({ audit: { entity: "opportunity", action: "approve_legal" } })
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
					assignedTo: opportunities.assignedTo,
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

			// Obtener la etapa del 85%
			const [targetStage] = await db
				.select()
				.from(salesStages)
				.where(eq(salesStages.closurePercentage, 85))
				.limit(1);

			if (!targetStage) {
				throw new ORPCError("NOT_FOUND", {
					message: "No se encontró la etapa del 85%",
				});
			}

			// Actualizar la oportunidad y registrar historial en una transacción
			await auditedTransaction(async (tx) => {
				// Actualizar la oportunidad a 85%, sólo si sigue en la etapa que se
				// leyó. Dos aprobaciones a la vez pasaban las dos la validación del
				// 80% y cada una mandaba su WhatsApp: el cliente recibía todo doble.
				const movidas = await tx
					.update(opportunities)
					.set({
						stageId: targetStage.id,
						updatedAt: new Date(),
					})
					.where(
						and(
							eq(opportunities.id, input.opportunityId),
							eq(opportunities.stageId, opportunity.stageId),
						),
					)
					.returning({ id: opportunities.id });
				if (movidas.length === 0) {
					throw new ORPCError("CONFLICT", {
						message: "La oportunidad ya fue aprobada por otro usuario.",
					});
				}
				auditRecord({
					entity: "opportunity",
					id: input.opportunityId,
					action: "approve_legal",
				});

				// Registrar en el historial de etapas
				await tx.insert(opportunityStageHistory).values({
					opportunityId: input.opportunityId,
					fromStageId: opportunity.stageId,
					toStageId: targetStage.id,
					changedBy: context.userId,
					reason: "Aprobación legal - Contratos generados, pendientes de firma",
				});
			});

			// Notificar al asesor de ventas que debe confirmar firma de contratos
			if (opportunity.assignedTo) {
				await createNotification({
					titulo: `Contratos listos para firma - ${opportunity.title}`,
					descripcion: `Los contratos de la oportunidad "${opportunity.title}" fueron generados por jurídico. Confirma cuando estén firmados para avanzar al 90%.`,
					type: "aviso",
					createdBy: context.userId,
					createdByRole: context.userRole,
					assignedToRole: "sales",
					assignedTo: opportunity.assignedTo,
					relatedEntityType: "opportunity",
					relatedEntityId: input.opportunityId,
					redirectPage: "opportunity_details",
				});
			}

			// Enviar links de contratos por WhatsApp al cliente (si aplica)
			if (opportunity.leadId)
				sendContractLinksToLead({
					leadId: opportunity.leadId,
					opportunityId: input.opportunityId,
				}).catch((err) => {
					console.error(
						"[confirmContractsSigned] Error enviando WhatsApp:",
						err,
					);
				});

			return {
				success: true,
				message:
					"Oportunidad aprobada y movida a la etapa del 85% (Contratos en Firma)",
				newStageId: targetStage.id,
				newStageName: targetStage.name,
			};
		}),

	// Confirmar que los contratos fueron firmados (mover de 85% a 90%)
	confirmContractsSigned: viewOpportunityContractsProcedure
		.meta({
			audit: { entity: "opportunity", action: "confirm_contracts_signed" },
		})
		.input(
			z.object({
				opportunityId: z.string().uuid(),
			}),
		)
		.handler(async ({ input, context }) => {
			// Verificar permisos
			if (!PERMISSIONS.canConfirmContractsSigning(context.userRole)) {
				throw new ORPCError("FORBIDDEN", {
					message: "No tienes permisos para confirmar la firma de contratos",
				});
			}

			// Obtener la oportunidad con su etapa actual
			const [opportunity] = await db
				.select({
					id: opportunities.id,
					stageId: opportunities.stageId,
					leadId: opportunities.leadId,
					title: opportunities.title,
					assignedTo: opportunities.assignedTo,
				})
				.from(opportunities)
				.where(eq(opportunities.id, input.opportunityId))
				.limit(1);

			if (!opportunity) {
				throw new ORPCError("NOT_FOUND", {
					message: "Oportunidad no encontrada",
				});
			}

			// Verificar que la oportunidad está en 85%
			const [currentStage] = await db
				.select()
				.from(salesStages)
				.where(eq(salesStages.id, opportunity.stageId))
				.limit(1);

			if (!currentStage || currentStage.closurePercentage !== 85) {
				throw new ORPCError("BAD_REQUEST", {
					message: `La oportunidad debe estar en la etapa del 85% (Contratos en Firma) para confirmar. Actualmente está en ${currentStage?.closurePercentage || 0}%`,
				});
			}

			// Verificar que hay contratos asociados a la oportunidad
			const [{ count: contractCount }] = await db
				.select({ count: count() })
				.from(generatedLegalContracts)
				.where(eq(generatedLegalContracts.opportunityId, input.opportunityId));

			if (Number(contractCount) === 0) {
				throw new ORPCError("BAD_REQUEST", {
					message:
						"No hay contratos asociados a esta oportunidad. No se puede confirmar la firma.",
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

			// Primero: cerrar la oportunidad (crear crédito en cartera-back, cliente, contrato)
			// Si falla, la oportunidad se queda en 85% y no se mueve a 90%
			const closeResult = await closeOpportunity({
				opportunityId: input.opportunityId,
				userId: context.userId,
			});

			if (!closeResult.success) {
				throw new ORPCError("BAD_REQUEST", {
					message: closeResult.error || "Error al cerrar la oportunidad",
				});
			}

			// Solo si cartera-back respondió OK: marcar contratos + mover a 90%
			await auditedTransaction(async (tx) => {
				// Re-verificar que la oportunidad sigue en 85% (previene race condition)
				const [currentOpp] = await tx
					.select({ stageId: opportunities.stageId })
					.from(opportunities)
					.where(eq(opportunities.id, input.opportunityId))
					.limit(1);

				const [currentStageInTx] = await tx
					.select({ closurePercentage: salesStages.closurePercentage })
					.from(salesStages)
					.where(eq(salesStages.id, currentOpp.stageId))
					.limit(1);

				if (currentStageInTx.closurePercentage !== 85) {
					throw new ORPCError("BAD_REQUEST", {
						message: "La oportunidad ya fue procesada por otro usuario.",
					});
				}

				// Marcar todos los contratos pending como signed
				await tx
					.update(generatedLegalContracts)
					.set({
						status: "signed",
						updatedAt: new Date(),
					})
					.where(
						and(
							eq(generatedLegalContracts.opportunityId, input.opportunityId),
							eq(generatedLegalContracts.status, "pending"),
						),
					);

				// Mover oportunidad a 90% (closeOpportunity ya seteó status "won")
				await tx
					.update(opportunities)
					.set({
						stageId: targetStage.id,
						updatedAt: new Date(),
					})
					.where(eq(opportunities.id, input.opportunityId));
				auditRecord({
					entity: "opportunity",
					id: input.opportunityId,
					action: "confirm_contracts_signed",
				});

				// Registrar en historial
				await tx.insert(opportunityStageHistory).values({
					opportunityId: input.opportunityId,
					fromStageId: opportunity.stageId,
					toStageId: targetStage.id,
					changedBy: context.userId,
					reason: "Contratos firmados confirmados - Avanza a formalización",
				});
			});

			// Notificar a análisis que está lista para desembolso
			await createNotification({
				titulo: `Contratos firmados - ${opportunity.title}`,
				descripcion: `Los contratos de la oportunidad "${opportunity.title}" fueron firmados. La oportunidad pasó a la etapa del 90% y está lista para revisión de desembolso.`,
				type: "aviso",
				createdBy: context.userId,
				createdByRole: context.userRole,
				assignedToRole: "analyst",
				relatedEntityType: "opportunity",
				relatedEntityId: input.opportunityId,
				redirectPage: "analysis_90_details",
			});

			return {
				success: true,
				message:
					"Contratos confirmados como firmados. Oportunidad movida a la etapa del 90%",
				newStageId: targetStage.id,
				newStageName: targetStage.name,
			};
		}),

	/**
	 * Estado de firma de un contrato, firmante por firmante, preguntándole a
	 * WeeTrust en el momento.
	 *
	 * Es un pull a propósito: los webhooks de WeeTrust no están registrados, así
	 * que el estado guardado no se movía solo y jurídico tenía que entrar al
	 * portal de WeeTrust a ver quién firmó.
	 */
	getContractSigningStatus: juridicoProcedure
		.input(z.object({ contractId: z.string().uuid() }))
		.handler(async ({ input }) => {
			const { documentID } = await contratoConDocumentID(input.contractId);

			let estado: EstadoDocumentoFirma;
			try {
				estado = await consultarEstadoFirma(documentID);
			} catch (error) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message:
						error instanceof Error
							? error.message
							: "No se pudo consultar el estado de firma",
				});
			}

			await sincronizarEstadoDeFirma(input.contractId, estado);
			return estado;
		}),

	/**
	 * Regenera los enlaces de firma del contrato.
	 *
	 * Es la salida para los dos casos que pasan seguido: el link venció, o la
	 * persona falló la verificación y necesita volver a entrar. No regenera el
	 * documento: es el mismo PDF, con links nuevos, y quien ya firmó sigue
	 * firmado.
	 */
	refreshContractSigningLinks: juridicoProcedure
		.input(z.object({ contractId: z.string().uuid() }))
		.handler(async ({ input }) => {
			const { documentID } = await contratoConDocumentID(input.contractId);

			let estado: EstadoDocumentoFirma;
			try {
				estado = await regenerarEnlacesDeFirma(documentID);
			} catch (error) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message:
						error instanceof Error
							? error.message
							: "No se pudieron regenerar los enlaces de firma",
				});
			}

			await sincronizarEstadoDeFirma(input.contractId, estado);

			return {
				...estado,
				success: true,
				message: "Enlaces de firma regenerados",
			};
		}),

	/** Reenvía el correo de WeeTrust a los firmantes que todavía no firman. */
	resendContractSigningEmails: juridicoProcedure
		.input(z.object({ contractId: z.string().uuid() }))
		.handler(async ({ input }) => {
			const { documentID } = await contratoConDocumentID(input.contractId);

			try {
				await reenviarCorreoDeFirma(documentID);
			} catch (error) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message:
						error instanceof Error
							? error.message
							: "No se pudo reenviar el correo de firma",
				});
			}

			return {
				success: true,
				message: "Correo reenviado a los firmantes pendientes",
			};
		}),
};

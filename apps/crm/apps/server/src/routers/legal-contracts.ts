import { ORPCError } from "@orpc/server";
import { and, count, eq, inArray, isNull, ne, sql } from "drizzle-orm";
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
import {
	documentIdDesdeLink,
	filasDeFirmantes,
	linksPorRol,
} from "../lib/contract-signatories";
import { getSignatureMode } from "../lib/contract-signature-mode";
import {
	sincronizarEstadoDeFirma,
	tieneFirmas,
} from "../lib/contrato-estado-firma";
import {
	type AccionSobreContrato,
	ETAPAS_POR_ACCION,
	etiquetaDeMotivo,
	MOTIVOS_DE_ANULACION_KEYS,
} from "../lib/contratos-anulacion";
import {
	aplicarCorreosDePrueba,
	correoRepetido,
	correosDePruebaFaltantes,
} from "../lib/contratos-correos-prueba";
import { CONTRATOS_OBSERVADORES } from "../lib/contratos-rep-legal";
import { isTestModeEnabled } from "../lib/messaging-test-mode";
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
	borrarDocumentoDeWeeTrust,
	type ContractSigner,
	consultarEstadoFirma,
	type EstadoDocumentoFirma,
	motivoDeFalla,
	reemitirContratoEnWeeTrust,
	reenviarCorreoDeFirma,
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
 * Corta si la oportunidad ya no está en una etapa que permita esta acción.
 *
 * Reemplazar es de jurídico y sólo en 80%; regenerar lo hace análisis y va en
 * 80% u 85%. Del 90% en adelante los contratos ya son parte de una decisión
 * tomada y no se tocan.
 */
async function exigirEtapaDeFirma(
	opportunityId: string,
	accion: AccionSobreContrato,
): Promise<void> {
	const [etapa] = await db
		.select({ porcentaje: salesStages.closurePercentage })
		.from(opportunities)
		.leftJoin(salesStages, eq(opportunities.stageId, salesStages.id))
		.where(eq(opportunities.id, opportunityId))
		.limit(1);

	const porcentaje = etapa?.porcentaje ?? null;
	const permitidas = ETAPAS_POR_ACCION[accion];

	if (porcentaje === null || !permitidas.includes(porcentaje as never)) {
		throw new ORPCError("BAD_REQUEST", {
			message: `La oportunidad está en ${porcentaje ?? "una etapa desconocida"}%: no se puede ${accion}. Sólo se puede en ${permitidas.join("% u ")}%.`,
		});
	}
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
					signatureMode: getSignatureMode(input.contractType),
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
					signatureMode: getSignatureMode(input.contractType),
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
				const confirmados = await tx
					.update(generatedLegalContracts)
					.set({
						status: "signed",
						updatedAt: new Date(),
					})
					.where(
						and(
							eq(generatedLegalContracts.opportunityId, input.opportunityId),
							eq(generatedLegalContracts.status, "pending"),
							// Un original reclamado por un reemplazo ya no es el vigente:
							// confirmarlo le inventaba firmas a un documento descartado.
							isNull(generatedLegalContracts.replacedByContractId),
						),
					)
					.returning({ id: generatedLegalContracts.id });

				// Y a cada firmante: si no, la ficha mostraba el contrato firmado con
				// todas sus personas todavía "pendiente".
				if (confirmados.length > 0) {
					await tx
						.update(contractSignatories)
						.set({
							status: "signed",
							signedAt: sql`coalesce(${contractSignatories.signedAt}, now())`,
							updatedAt: new Date(),
						})
						.where(
							and(
								inArray(
									contractSignatories.contractId,
									confirmados.map((c) => c.id),
								),
								eq(contractSignatories.status, "pending"),
							),
						);
				}

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
	 * Si los mensajes salen a números reales o a los de prueba.
	 *
	 * Lo necesita la pantalla que aprueba y manda a firmar: ahí es donde se
	 * disparan los WhatsApp, y quien aprieta el botón tiene que saber si el
	 * cliente va a recibir algo o no. El navegador no puede leer `TEST_MESSAGE`.
	 */
	getMessagingMode: viewOpportunityContractsProcedure.handler(async () => ({
		modoPrueba: isTestModeEnabled(),
	})),

	/**
	 * Estado de firma de un contrato, firmante por firmante, preguntándole a
	 * WeeTrust en el momento.
	 *
	 * Va con el mismo permiso que ver los contratos, no con el de jurídico: la
	 * ficha de la oportunidad es la que miran el analista y el vendedor, y son
	 * ellos los que necesitan saber si el cliente ya firmó.
	 *
	 * Es un pull a propósito: los webhooks de WeeTrust no están registrados, así
	 * que el estado guardado no se movía solo y jurídico tenía que entrar al
	 * portal de WeeTrust a ver quién firmó.
	 */
	getContractSigningStatus: viewOpportunityContractsProcedure
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
	 * Regenera los enlaces de firma del contrato, sobre el MISMO documento.
	 *
	 * Es lo que hace el analista: no cambia el contrato, sólo emite enlaces
	 * nuevos para quien no firmó. Reemplazar el documento —que sí lo anula y
	 * sube otro— es de jurídico y vive en su ficha.
	 *
	 * Es la salida para los dos casos que pasan seguido: el link venció, o la
	 * persona falló la verificación y necesita volver a entrar. No regenera el
	 * documento: es el mismo PDF, con links nuevos, y quien ya firmó sigue
	 * firmado.
	 */
	refreshContractSigningLinks: viewOpportunityContractsProcedure
		.input(
			z.object({
				contractId: z.string().uuid(),
				motivo: z.enum(MOTIVOS_DE_ANULACION_KEYS),
			}),
		)
		.handler(async ({ input, context }) => {
			// Ver los contratos lo puede hacer ventas o contabilidad; regenerar no:
			// crea otro documento en WeeTrust y deja sin efecto los enlaces que la
			// gente ya tenía. Es de análisis.
			if (!PERMISSIONS.canRegenerateContractLinks(context.userRole)) {
				throw new ORPCError("FORBIDDEN", {
					message: "Sólo análisis puede regenerar los enlaces de firma",
				});
			}

			const [contract] = await db
				.select()
				.from(generatedLegalContracts)
				.where(eq(generatedLegalContracts.id, input.contractId));

			if (!contract) {
				throw new ORPCError("NOT_FOUND", { message: "Contrato no encontrado" });
			}

			if (contract.signatureMode === "fisica") {
				throw new ORPCError("BAD_REQUEST", {
					message: "Este contrato se firma en papel: no tiene enlaces.",
				});
			}

			// Un contrato anulado quedó reemplazado por otro. Reemitirlo lo
			// resucitaría con enlaces nuevos al lado del que lo reemplazó.
			if (contract.status === "cancelled") {
				throw new ORPCError("BAD_REQUEST", {
					message: "Este contrato está anulado: no se puede regenerar.",
				});
			}

			// La key de R2 del PDF. Hay contratos que guardaron en `pdfLink` una
			// URL firmada (la que se muestra, que vence) en vez de la key: para
			// esos se recupera de la respuesta del generador. Con una URL entera
			// como key, R2 no encuentra nada.
			const respuesta = contract.apiResponse as { r2Key?: unknown } | null;
			const r2KeyDelPdf =
				contract.pdfLink && !/^https?:\/\//i.test(contract.pdfLink)
					? contract.pdfLink
					: typeof respuesta?.r2Key === "string"
						? respuesta.r2Key
						: null;

			if (!r2KeyDelPdf) {
				throw new ORPCError("BAD_REQUEST", {
					message:
						"Este contrato no tiene el PDF guardado, así que no se puede reemitir. Hay que generarlo de nuevo.",
				});
			}

			if (contract.opportunityId) {
				await exigirEtapaDeFirma(contract.opportunityId, "regenerar");
			}

			// Los mismos firmantes, con su rol. No se recalculan desde la
			// oportunidad: el documento es el que es y tiene que salir con la misma
			// gente, aunque después alguien haya editado un contacto.
			const firmantes = await db
				.select()
				.from(contractSignatories)
				.where(eq(contractSignatories.contractId, input.contractId))
				.orderBy(contractSignatories.position);

			if (firmantes.length === 0) {
				throw new ORPCError("BAD_REQUEST", {
					message:
						"Este contrato no tiene firmantes guardados. Reemplazalo desde jurídico.",
				});
			}

			// Documento NUEVO con el mismo PDF. El `update-signatures` de WeeTrust
			// sólo renueva las URL de quienes no firmaron, y con todos firmados
			// devuelve "There are no url of signatures to update".
			const guardados: ContractSigner[] = firmantes.map((f) => ({
				role: f.role as ContractSigner["role"],
				email: f.email,
				name: f.name,
			}));

			// En modo prueba se redirige igual que al generar: un contrato emitido
			// con correos reales (por ejemplo, datos copiados de prod) le mandaría
			// la invitación de WeeTrust al cliente.
			let signers = guardados;
			if (isTestModeEnabled()) {
				const faltan = correosDePruebaFaltantes(guardados);
				if (faltan.length > 0) {
					throw new ORPCError("BAD_REQUEST", {
						message: `TEST_MESSAGE=true pero falta configurar ${faltan.join(" y ")}: los enlaces saldrían a los correos reales.`,
					});
				}
				signers = aplicarCorreosDePrueba(guardados);
				const repetido = correoRepetido(signers);
				if (repetido) {
					throw new ORPCError("BAD_REQUEST", {
						message: `TEST_MESSAGE=true: el correo de prueba ${repetido} quedaría para dos firmantes. Revisá los correos de prueba.`,
					});
				}
			}

			const resultado = await reemitirContratoEnWeeTrust({
				r2Key: r2KeyDelPdf,
				contractType: contract.contractType,
				filenamePrefix: contract.contractName,
				signers,
				observers: CONTRATOS_OBSERVADORES,
			});

			const falla = motivoDeFalla(resultado);
			if (falla) {
				throw new ORPCError("BAD_REQUEST", { message: falla });
			}

			const ahora = new Date();
			const motivo = etiquetaDeMotivo(input.motivo);

			// El reemitido va SIEMPRE en una fila nueva, y se guarda antes de tocar
			// el documento viejo: si el guardado fallara con el viejo ya borrado, el
			// CRM quedaba apuntando a un documento inexistente y el nuevo sin
			// registro. Si falla, se borra el nuevo en WeeTrust para que un
			// reintento no deje dos vivos.
			let nuevoId: string;
			try {
				nuevoId = await db.transaction(async (tx) => {
					// Dos regeneraciones a la vez del mismo contrato emitían dos
					// documentos y dejaban los dos vigentes. Se bloquea la fila y se
					// vuelve a mirar: si otra ya lo anuló, ésta pierde, y el catch de
					// abajo borra en WeeTrust el documento que acaba de emitir.
					// También si jurídico ya lo reclamó para reemplazarlo y todavía no
					// terminó de anularlo: si no, quedaban dos reemisiones vigentes.
					// La etapa se vuelve a mirar acá, con la oportunidad bloqueada: la
					// reemisión en WeeTrust tarda, y si mientras tanto alguien la pasó
					// a 90% se colaba un contrato pendiente en una oportunidad cerrada.
					if (contract.opportunityId) {
						const [etapa] = await tx
							.select({ porcentaje: salesStages.closurePercentage })
							.from(opportunities)
							.leftJoin(salesStages, eq(opportunities.stageId, salesStages.id))
							.where(eq(opportunities.id, contract.opportunityId))
							.for("update", { of: opportunities });
						if (
							!etapa?.porcentaje ||
							!ETAPAS_POR_ACCION.regenerar.includes(etapa.porcentaje as never)
						) {
							throw new ORPCError("CONFLICT", {
								message:
									"La oportunidad cambió de etapa mientras se regeneraba. Ya no se puede regenerar.",
							});
						}
					}

					const [original] = await tx
						.select({
							status: generatedLegalContracts.status,
							reemplazadoPor: generatedLegalContracts.replacedByContractId,
						})
						.from(generatedLegalContracts)
						.where(eq(generatedLegalContracts.id, input.contractId))
						.for("update");
					if (
						!original ||
						original.status === "cancelled" ||
						original.reemplazadoPor
					) {
						throw new ORPCError("CONFLICT", {
							message:
								"Otra persona acaba de regenerar este contrato. Recargá para ver el nuevo.",
						});
					}

					const [nuevo] = await tx
						.insert(generatedLegalContracts)
						.values({
							leadId: contract.leadId,
							opportunityId: contract.opportunityId,
							contractType: contract.contractType,
							contractName: contract.contractName,
							templateId: contract.templateId,
							apiResponse: resultado,
							pdfLink: r2KeyDelPdf,
							signingProvider: resultado.signingProvider ?? "weetrust",
							signatureMode: contract.signatureMode,
							generatedBy: context.userId,
							generatedAt: ahora,
							...linksPorRol(resultado.signatories, resultado.signing_links),
							weetrustDocumentId: resultado.documentID ?? null,
							observerUrl: resultado.observerUrl ?? null,
							status: "pending",
							lastRegenerationReason: motivo,
							lastRegeneratedAt: ahora,
							signingStatusCheckedAt: ahora,
							updatedAt: ahora,
						})
						.returning({ id: generatedLegalContracts.id });

					// Los firmantes en la misma transacción: sin ellos el contrato
					// nuevo no se puede sincronizar, regenerar ni mandar por WhatsApp,
					// y no tiene sentido retirar el viejo por uno así.
					const filas = filasDeFirmantes(nuevo.id, resultado.signatories);
					if (filas.length === 0) {
						throw new ORPCError("INTERNAL_SERVER_ERROR", {
							message:
								"WeeTrust no devolvió los firmantes del documento reemitido.",
						});
					}
					await tx.insert(contractSignatories).values(filas);

					await tx
						.update(generatedLegalContracts)
						.set({
							status: "cancelled",
							cancellationReason: `Regenerado: ${motivo}`,
							cancelledAt: ahora,
							replacedByContractId: nuevo.id,
							updatedAt: ahora,
						})
						.where(eq(generatedLegalContracts.id, input.contractId));

					return nuevo.id;
				});
			} catch (error) {
				if (resultado.documentID) {
					await borrarDocumentoDeWeeTrust(resultado.documentID).catch((e) =>
						console.error(
							`[refreshContractSigningLinks] no se pudo borrar el reemitido ${resultado.documentID}:`,
							e,
						),
					);
				}
				throw error;
			}

			// Recién ahora el documento viejo:
			// - Completo: WeeTrust no deja borrarlo; la fila queda anulada.
			// - Con firmas parciales: se borra en WeeTrust (si no, los que faltan
			//   seguirían firmando un documento reemplazado), pero la fila queda
			//   anulada con sus firmantes: es el registro de quién ya firmó.
			// - Sin firmas: se borra allá y la fila desaparece.
			// - Si el borrado falla: fila anulada, con el aviso de borrarlo a mano.
			const completo = contract.status === "signed";
			const conFirmasParciales =
				!completo &&
				(await tieneFirmas(input.contractId, contract.weetrustDocumentId));
			let conservado = completo;
			if (!completo) {
				try {
					if (contract.weetrustDocumentId) {
						await borrarDocumentoDeWeeTrust(contract.weetrustDocumentId);
					}
					if (conFirmasParciales) {
						conservado = true;
						await db
							.update(generatedLegalContracts)
							.set({
								cancellationReason: `Regenerado: ${motivo} (tenía firmas parciales; el documento se borró en WeeTrust)`,
							})
							.where(eq(generatedLegalContracts.id, input.contractId));
					} else {
						await db
							.delete(generatedLegalContracts)
							.where(eq(generatedLegalContracts.id, input.contractId));
					}
				} catch (error) {
					console.error(
						`[refreshContractSigningLinks] no se pudo borrar ${contract.weetrustDocumentId}:`,
						error,
					);
					conservado = true;
					await db
						.update(generatedLegalContracts)
						.set({
							cancellationReason: `Regenerado: ${motivo} (no se pudo borrar en WeeTrust: hay que borrarlo a mano)`,
						})
						.where(eq(generatedLegalContracts.id, input.contractId));
				}
			}

			return {
				success: true,
				message: conservado
					? "Documento reemitido con enlaces nuevos; el anterior queda anulado"
					: "Documento reemitido con enlaces nuevos",
				contractId: nuevoId,
				documentID: resultado.documentID,
				enlaces: resultado.signing_links?.length ?? 0,
			};
		}),

	/**
	 * Vuelve a mandar los enlaces de firma por WhatsApp.
	 *
	 * Después de reemplazar un contrato o regenerar sus enlaces, los que tenía la
	 * gente en el teléfono dejaron de servir. Sin esto habría que mover la
	 * oportunidad de etapa para que el envío automático se dispare otra vez.
	 */
	resendContractLinksWhatsapp: viewOpportunityContractsProcedure
		.input(z.object({ opportunityId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			// Ver los contratos no alcanza: esto le escribe al cliente.
			if (!PERMISSIONS.canResendContractLinks(context.userRole)) {
				throw new ORPCError("FORBIDDEN", {
					message: "No tenés permiso para reenviar los enlaces de firma",
				});
			}

			const [opportunity] = await db
				.select({ leadId: opportunities.leadId })
				.from(opportunities)
				.where(eq(opportunities.id, input.opportunityId))
				.limit(1);

			if (!opportunity?.leadId) {
				throw new ORPCError("NOT_FOUND", {
					message: "Oportunidad no encontrada",
				});
			}

			const resultado = await sendContractLinksToLead({
				leadId: opportunity.leadId,
				opportunityId: input.opportunityId,
			});

			return {
				success: resultado.sent,
				message: resultado.sent
					? "Enlaces reenviados por WhatsApp"
					: `No se envió: ${resultado.reason ?? "sin motivo"}`,
			};
		}),

	/** Reenvía el correo de WeeTrust a los firmantes que todavía no firman. */
	resendContractSigningEmails: viewOpportunityContractsProcedure
		.input(z.object({ contractId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			if (!PERMISSIONS.canResendContractLinks(context.userRole)) {
				throw new ORPCError("FORBIDDEN", {
					message: "No tenés permiso para reenviar los correos de firma",
				});
			}

			const { contract, documentID } = await contratoConDocumentID(
				input.contractId,
			);

			// Un anulado se conserva sólo como registro: reenviarle la invitación
			// sería pedirle al cliente que firme un documento reemplazado.
			// Tampoco uno ya reclamado por un reemplazo que todavía no terminó de
			// anularlo: su documento es el que se está dejando sin efecto.
			if (contract.status === "cancelled" || contract.replacedByContractId) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Este contrato está anulado: no se le reenvían correos.",
				});
			}

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

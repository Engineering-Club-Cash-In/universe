/**
 * Router para generación de contratos legales desde el CRM
 * Integra con legal-docs-blueprints API y API de documentos legales
 */
import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { leads, opportunities, salesStages } from "../db/schema/crm";
import { generatedLegalContracts } from "../db/schema/legal-contracts";
import { vehicles } from "../db/schema/vehicles";
import { juridicoProcedure } from "../lib/orpc";
import {
	enrichLeadFromRenap,
	mapOpportunityToContractData,
	transformToApiFormat,
	validateOpportunityForContracts,
} from "../services/contract-data-mapper";
import { getDocumentsByDpi, getDocumentTypes } from "../services/legal-docs-api";

// URL de la API de generación de contratos (legal-docs-blueprints)
const LEGAL_DOCS_API_URL =
	process.env.LEGAL_DOCS_API_URL ||
	"https://legal-docs-blueprints.s4.devteamatcci.site";

export const contractGenerationRouter = {
	/**
	 * Obtiene los tipos de contratos disponibles desde la API
	 */
	getContractTypes: juridicoProcedure.handler(async () => {
		try {
			const response = await getDocumentTypes();
			if (!response.success) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Error al obtener tipos de documentos",
				});
			}
			return {
				success: true,
				total: response.total,
				data: response.data,
			};
		} catch (error) {
			console.error("[getContractTypes] Error:", error);
			throw new ORPCError("INTERNAL_SERVER_ERROR", {
				message:
					error instanceof Error
						? error.message
						: "Error al obtener tipos de documentos",
			});
		}
	}),

	/**
	 * Obtiene documentos y campos por DPI y tipos seleccionados
	 */
	getDocumentsByDpi: juridicoProcedure
		.input(
			z.object({
				dpi: z.string().length(13),
				documentNames: z.array(z.string()).min(1),
			}),
		)
		.handler(async ({ input }) => {
			try {
				const response = await getDocumentsByDpi(
					input.dpi,
					input.documentNames,
				);
				if (!response.success) {
					throw new ORPCError("BAD_REQUEST", {
						message: response.message || "Error al obtener documentos",
					});
				}
				return {
					success: true,
					renapData: response.renapData,
					documents: response.documents,
					fields: response.campos,
				};
			} catch (error) {
				console.error("[getDocumentsByDpi] Error:", error);
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message:
						error instanceof Error
							? error.message
							: "Error al obtener documentos por DPI",
				});
			}
		}),

	/**
	 * Obtiene los datos de una oportunidad mapeados para preview de contrato
	 */
	getContractPreviewData: juridicoProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
				contractDate: z.date().optional(),
			}),
		)
		.handler(async ({ input }) => {
			const contractData = await mapOpportunityToContractData(
				input.opportunityId,
				input.contractDate,
			);

			if (!contractData) {
				throw new ORPCError("NOT_FOUND", {
					message: "Oportunidad no encontrada",
				});
			}

			return contractData;
		}),

	/**
	 * Valida si una oportunidad tiene todos los datos necesarios para generar contratos
	 */
	validateForContractGeneration: juridicoProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
			}),
		)
		.handler(async ({ input }) => {
			const validation = await validateOpportunityForContracts(
				input.opportunityId,
			);
			return validation;
		}),

	/**
	 * Intenta enriquecer los datos del lead desde RENAP
	 */
	enrichLeadFromRenap: juridicoProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
			}),
		)
		.handler(async ({ input }) => {
			// Obtener el leadId de la oportunidad
			const [opportunity] = await db
				.select({ leadId: opportunities.leadId })
				.from(opportunities)
				.where(eq(opportunities.id, input.opportunityId))
				.limit(1);

			if (!opportunity?.leadId) {
				throw new ORPCError("NOT_FOUND", {
					message: "Oportunidad no encontrada o sin lead asociado",
				});
			}

			const result = await enrichLeadFromRenap(opportunity.leadId);
			return result;
		}),

	/**
	 * Genera contratos para una oportunidad
	 */
	generateContracts: juridicoProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
				contractTypes: z.array(z.string()).min(1),
				contractDate: z.object({
					day: z.string(),
					month: z.string(),
					year: z.string(),
				}),
				beneficiarios: z
					.array(
						z.object({
							cuenta: z.string(),
							monto: z.string(),
						}),
					)
					.optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			// 1. Validar que la oportunidad esté en la etapa correcta (80%)
			const [opportunityData] = await db
				.select({
					opportunity: opportunities,
					stage: salesStages,
					lead: leads,
					vehicle: vehicles,
				})
				.from(opportunities)
				.innerJoin(salesStages, eq(opportunities.stageId, salesStages.id))
				.innerJoin(leads, eq(opportunities.leadId, leads.id))
				.leftJoin(vehicles, eq(opportunities.vehicleId, vehicles.id))
				.where(eq(opportunities.id, input.opportunityId))
				.limit(1);

			if (!opportunityData) {
				throw new ORPCError("NOT_FOUND", {
					message: "Oportunidad no encontrada",
				});
			}

			if (opportunityData.stage.closurePercentage !== 80) {
				throw new ORPCError("BAD_REQUEST", {
					message: `La oportunidad debe estar en la etapa del 80% para generar contratos. Actualmente está en ${opportunityData.stage.closurePercentage}%`,
				});
			}

			// 2. Validar datos completos
			const validation = await validateOpportunityForContracts(
				input.opportunityId,
			);
			if (!validation.isValid) {
				const allMissing = [
					...validation.missingVehicleFields,
					...validation.missingLeadFields,
					...validation.missingCreditFields,
				];
				throw new ORPCError("BAD_REQUEST", {
					message: `Faltan datos para generar contratos: ${allMissing.join(", ")}`,
				});
			}

			// 3. Construir fecha del contrato
			const contractDate = new Date(
				Number.parseInt(input.contractDate.year),
				getMonthNumber(input.contractDate.month) - 1,
				Number.parseInt(input.contractDate.day),
			);

			// 4. Obtener datos mapeados
			const contractData = await mapOpportunityToContractData(
				input.opportunityId,
				contractDate,
			);

			if (!contractData) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Error al mapear datos de la oportunidad",
				});
			}

			// 5. Agregar beneficiarios si se proporcionaron
			if (input.beneficiarios && input.beneficiarios.length > 0) {
				const { numberToWordsQuetzales } = await import(
					"../lib/contract-utils"
				);
				contractData.beneficiarios = input.beneficiarios.map((b) => ({
					cuenta: b.cuenta,
					monto: b.monto,
					montoEnLetras: numberToWordsQuetzales(Number.parseFloat(b.monto)),
				}));
			}

			// 6. Generar cada tipo de contrato solicitado
			const results: Array<{
				contractType: string;
				contractName: string;
				success: boolean;
				contractId?: string;
				signingLinks?: string[];
				error?: string;
			}> = [];

			for (const contractType of input.contractTypes) {
				try {
					// El nombre del contrato viene del tipo (ya es el enum de la API)
					const contractName = `Contrato ${contractType}`;

					// Llamar a la API de legal-docs-blueprints
					const apiResult = await callLegalDocsApi(contractType, contractData);

					if (apiResult.success) {
						// Guardar el contrato en la base de datos
						const [newContract] = await db
							.insert(generatedLegalContracts)
							.values({
								leadId: opportunityData.lead.id,
								opportunityId: input.opportunityId,
								contractType,
								contractName,
								clientSigningLink: apiResult.signingLinks?.[0] || null,
								representativeSigningLink: apiResult.signingLinks?.[1] || null,
								additionalSigningLinks:
									apiResult.signingLinks?.slice(2) || null,
								templateId: apiResult.templateId,
								apiResponse: apiResult.rawResponse,
								pdfLink: apiResult.pdfUrl || null,
								status: "pending",
								generatedBy: context.userId,
								generatedAt: new Date(),
							})
							.returning();

						results.push({
							contractType,
							contractName,
							success: true,
							contractId: newContract.id,
							signingLinks: apiResult.signingLinks,
						});
					} else {
						results.push({
							contractType,
							contractName,
							success: false,
							error: apiResult.error || "Error desconocido",
						});
					}
				} catch (error) {
					results.push({
						contractType,
						contractName: `Contrato ${contractType}`,
						success: false,
						error: error instanceof Error ? error.message : "Error desconocido",
					});
				}
			}

			// 7. Retornar resultados
			const successCount = results.filter((r) => r.success).length;
			const failCount = results.filter((r) => !r.success).length;

			return {
				success: failCount === 0,
				totalRequested: input.contractTypes.length,
				successCount,
				failCount,
				results,
				message:
					failCount === 0
						? `Se generaron ${successCount} contrato(s) exitosamente`
						: `Se generaron ${successCount} contrato(s), ${failCount} fallaron`,
			};
		}),

	/**
	 * Obtiene el estado de contratos generados para una oportunidad
	 */
	getGeneratedContracts: juridicoProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
			}),
		)
		.handler(async ({ input }) => {
			const contracts = await db
				.select()
				.from(generatedLegalContracts)
				.where(eq(generatedLegalContracts.opportunityId, input.opportunityId))
				.orderBy(generatedLegalContracts.generatedAt);

			return contracts;
		}),

	/**
	 * Genera contratos directamente con datos del formulario
	 * Similar al frontend antiguo, sin necesidad de oportunidad
	 */
	generateContractsDirect: juridicoProcedure
		.input(
			z.object({
				contracts: z.array(
					z.object({
						contractType: z.string(),
						data: z.record(z.string(), z.string()),
						emails: z.array(z.string()).optional(),
						options: z.object({
							gender: z.enum(["male", "female"]),
							generatePdf: z.boolean().default(true),
							filenamePrefix: z.string(),
						}),
					}),
				),
				// Opcional: vincular a una oportunidad/lead existente
				opportunityId: z.string().uuid().optional(),
				leadId: z.string().uuid().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const { generateContractsBatch } = await import(
				"../services/legal-docs-api"
			);

			try {
				// Llamar a la API de generación de contratos
				const apiResult = await generateContractsBatch({
					contracts: input.contracts,
				});

				// Transformar resultados al formato esperado por el frontend
				const results: Array<{
					contractType: string;
					contractName: string;
					success: boolean;
					documentLink?: string;
					signingLinks?: string[];
					error?: string;
				}> = [];

				let successCount = 0;
				let failCount = 0;

				if (apiResult.results) {
					for (let i = 0; i < apiResult.results.length; i++) {
						const contractResult = apiResult.results[i];
						const originalContract = input.contracts[i];

						if (contractResult.success) {
							successCount++;

							// Si hay leadId, guardar en la BD
							if (input.leadId) {
								await db.insert(generatedLegalContracts).values({
									leadId: input.leadId,
									opportunityId: input.opportunityId,
									contractType:
										contractResult.nameDocument?.[0]?.enum ||
										originalContract.contractType,
									contractName:
										contractResult.nameDocument?.[0]?.label || "Contrato",
									clientSigningLink: contractResult.signing_links?.[0],
									representativeSigningLink: contractResult.signing_links?.[1],
									additionalSigningLinks:
										contractResult.signing_links?.slice(2),
									templateId: contractResult.templateId,
									apiResponse: contractResult,
									pdfLink: contractResult.linkDocument,
									status: "pending",
									generatedBy: context.userId,
									generatedAt: new Date(),
								});
							}

							results.push({
								contractType: originalContract.contractType,
								contractName:
									contractResult.nameDocument?.[0]?.label || "Contrato",
								success: true,
								documentLink: contractResult.linkDocument,
								signingLinks: contractResult.signing_links,
							});
						} else {
							failCount++;
							results.push({
								contractType: originalContract.contractType,
								contractName:
									contractResult.nameDocument?.[0]?.label || "Contrato",
								success: false,
								error: "Error al generar el documento",
							});
						}
					}
				}

				return {
					success: failCount === 0,
					totalRequested: input.contracts.length,
					successCount,
					failCount,
					results,
					message:
						failCount === 0
							? `Se generaron ${successCount} documento(s) exitosamente`
							: `Se generaron ${successCount} documento(s), ${failCount} fallaron`,
				};
			} catch (error) {
				console.error("[generateContractsDirect] Error:", error);
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message:
						error instanceof Error
							? error.message
							: "Error al generar contratos",
				});
			}
		}),
};

/**
 * Convierte nombre del mes en español a número
 */
function getMonthNumber(monthName: string): number {
	const months: Record<string, number> = {
		enero: 1,
		febrero: 2,
		marzo: 3,
		abril: 4,
		mayo: 5,
		junio: 6,
		julio: 7,
		agosto: 8,
		septiembre: 9,
		octubre: 10,
		noviembre: 11,
		diciembre: 12,
	};
	return months[monthName.toLowerCase()] || 1;
}

/**
 * Interfaz para el resultado de la API de legal-docs
 */
interface LegalDocsApiResult {
	success: boolean;
	templateId?: number;
	signingLinks?: string[];
	pdfUrl?: string;
	rawResponse?: unknown;
	error?: string;
}

/**
 * Llama a la API de legal-docs-blueprints para generar un contrato
 */
async function callLegalDocsApi(
	contractType: string,
	data: Awaited<ReturnType<typeof mapOpportunityToContractData>>,
): Promise<LegalDocsApiResult> {
	try {
		if (!data) {
			return {
				success: false,
				error: "No hay datos para generar el contrato",
			};
		}

		// Mapear el tipo de contrato del CRM al tipo de legal-docs-blueprints
		// Valores tomados del enum ContractType en legal-docs-blueprints/types/contract.ts
		const contractTypeMap: Record<string, string> = {
			compraventa: "contrato_privado_uso_carro_usado",
			credito_prendario: "garantia_mobiliaria",
			pagare: "pagare_unico_libre_protesto",
			reconocimiento_deuda: "reconocimiento_deuda_feb_2025",
			contrato_gps: "carta_aceptacion_instalacion_gps",
			contrato_seguro: "cobertura_inrexsa",
			declaracion_jurada: "declaracion_vendedor",
			acta_entrega: "descargo_responsabilidades",
			carta_compromiso: "carta_carro_nuevo",
			autorizacion_desembolso: "carta_emision_cheques",
			// Tipos adicionales disponibles en el API:
			// carta_traspaso_vehiculo: "carta_traspaso_vehiculo_rdbe",
			// contrato_carro_nuevo: "contrato_privado_uso_carro_nuevo",
			// solicitud_compra_tercero: "solicitud_compra_vehiculo_tercero",
		};

		const apiContractType = contractTypeMap[contractType];
		if (!apiContractType) {
			return {
				success: false,
				error: `Tipo de contrato no soportado: ${contractType}`,
			};
		}

		// Transformar datos del CRM al formato plano que espera el API
		const flatData = transformToApiFormat(data, contractType);

		// Extraer email del cliente para los links de firma
		const clientEmail = data.cliente?.email;
		const emails = clientEmail ? [clientEmail] : undefined;

		// Determinar género para concordancia en documentos
		const gender =
			data.cliente?.genero === "femenino" ? "female" : ("male" as const);

		// Preparar payload para el endpoint /contracts/:type
		// El endpoint extrae emails y gender del body, el resto va a data
		const payload = {
			...flatData,
			emails,
			gender,
		};

		const endpoint = `/contracts/${apiContractType}`;
		console.log(`[LegalDocs] Llamando a ${LEGAL_DOCS_API_URL}${endpoint}`);
		console.log(
			`[LegalDocs] Payload keys: ${Object.keys(flatData).join(", ")}`,
		);

		const response = await fetch(`${LEGAL_DOCS_API_URL}${endpoint}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${process.env.LEGAL_DOCS_API_KEY || ""}`,
			},
			body: JSON.stringify(payload),
		});

		if (!response.ok) {
			const errorText = await response.text();
			console.error(`[LegalDocs] Error response: ${errorText}`);
			return {
				success: false,
				error: `Error de la API: ${response.status} - ${errorText}`,
			};
		}

		const result = await response.json();

		return {
			success: true,
			templateId: result.templateId,
			signingLinks: result.signing_links || result.signingLinks || [],
			pdfUrl: result.pdf_url || result.pdfUrl,
			rawResponse: result,
		};
	} catch (error) {
		console.error("[LegalDocs] Error llamando a la API:", error);
		return {
			success: false,
			error: error instanceof Error ? error.message : "Error de conexión",
		};
	}
}

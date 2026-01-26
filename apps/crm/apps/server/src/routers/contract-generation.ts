/**
 * Router para generación de contratos legales desde el CRM
 * Integra con legal-docs-blueprints API
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
	type Beneficiario,
	CONTRACT_TYPES,
	enrichLeadFromRenap,
	getContractTypes,
	mapOpportunityToContractData,
	validateOpportunityForContracts,
} from "../services/contract-data-mapper";

// URL de la API de legal-docs-blueprints (configurar en variables de entorno)
const LEGAL_DOCS_API_URL =
	process.env.LEGAL_DOCS_API_URL || "http://localhost:3002/api";

export const contractGenerationRouter = {
	/**
	 * Obtiene los tipos de contratos disponibles
	 */
	getContractTypes: juridicoProcedure.handler(async () => {
		return getContractTypes();
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
					const contractTypeInfo = CONTRACT_TYPES.find(
						(ct) => ct.id === contractType,
					);
					const contractName =
						contractTypeInfo?.name || `Contrato ${contractType}`;

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
					const contractTypeInfo = CONTRACT_TYPES.find(
						(ct) => ct.id === contractType,
					);
					results.push({
						contractType,
						contractName: contractTypeInfo?.name || contractType,
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
		// Mapear el tipo de contrato del CRM al endpoint de legal-docs-blueprints
		const endpointMap: Record<string, string> = {
			compraventa: "/contracts/compraventa",
			credito_prendario: "/contracts/credito-prendario",
			pagare: "/contracts/pagare",
			mandato_especial: "/contracts/mandato-especial",
			reconocimiento_deuda: "/contracts/reconocimiento-deuda",
			contrato_gps: "/contracts/gps",
			contrato_seguro: "/contracts/seguro",
			poder_especial: "/contracts/poder-especial",
			declaracion_jurada: "/contracts/declaracion-jurada",
			acta_entrega: "/contracts/acta-entrega",
			contrato_fianza: "/contracts/fianza",
			carta_compromiso: "/contracts/carta-compromiso",
			autorizacion_desembolso: "/contracts/autorizacion-desembolso",
		};

		const endpoint = endpointMap[contractType];
		if (!endpoint) {
			return {
				success: false,
				error: `Tipo de contrato no soportado: ${contractType}`,
			};
		}

		// Preparar payload para la API
		const payload = {
			// Datos del cliente
			cliente: data?.cliente,
			// Datos del vehículo
			vehiculo: data?.vehiculo,
			// Datos del crédito
			credito: data?.credito,
			// Datos del contrato
			contrato: data?.contrato,
			// Beneficiarios (si aplica)
			beneficiarios: data?.beneficiarios,
		};

		console.log(`[LegalDocs] Llamando a ${LEGAL_DOCS_API_URL}${endpoint}`);

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
			signingLinks: result.signingLinks || [],
			pdfUrl: result.pdfUrl,
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

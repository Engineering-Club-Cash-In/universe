/**
 * Router para generación de contratos legales desde el CRM
 * Integra con legal-docs-blueprints API y API de documentos legales
 */
import { ORPCError } from "@orpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { leads, opportunities, salesStages } from "../db/schema/crm";
import {
	contractGenerationSnapshots,
	generatedLegalContracts,
} from "../db/schema/legal-contracts";
import { quotations } from "../db/schema/quotations";
import { vehicles } from "../db/schema/vehicles";
import { juridicoProcedure } from "../lib/orpc";
import { getFileUrlWithBucketInKey } from "../lib/storage";
import {
	enrichLeadFromRenap,
	mapOpportunityToContractData,
	transformToApiFormat,
	validateOpportunityForContracts,
} from "../services/contract-data-mapper";
import {
	getDocumentsByDpi,
	getDocumentTypes,
} from "../services/legal-docs-api";

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
	 * NO enlaza los contratos a la oportunidad, solo los genera
	 */
	generateContractsDirect: juridicoProcedure
		.input(
			z.object({
				contracts: z.array(
					z.object({
						contractType: z.string(),
						data: z.record(z.string(), z.unknown()).and(
							z.object({
								deudoresAdicionales: z
									.array(
										z.object({
											nombreCompleto: z.string(),
											dpi: z.string(),
											dpiTexto: z.string(),
											edadTexto: z.string().optional(),
											estadoCivil: z.string().optional(),
											profesion: z.string().optional(),
											nacionalidad: z.string().optional(),
										}),
									)
									.optional(),
							}),
						),
						emails: z.array(z.string()).optional(),
						options: z.object({
							gender: z.enum(["male", "female"]),
							generatePdf: z.boolean().default(true),
							isPlural: z.boolean().optional(),
							filenamePrefix: z.string(),
						}),
					}),
				),
			}),
		)
		.handler(async ({ input }) => {
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
					templateId?: number;
					apiResponse?: unknown;
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

							// NO guardamos en BD aquí, solo retornamos los datos
							results.push({
								contractType: originalContract.contractType,
								contractName:
									contractResult.nameDocument?.[0]?.label || "Contrato",
								success: true,
								documentLink: contractResult.r2Key
									? await getFileUrlWithBucketInKey(contractResult.r2Key)
									: contractResult.linkDocument,
								signingLinks: contractResult.signing_links,
								templateId: contractResult.templateId,
								apiResponse: contractResult,
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

	/**
	 * Enlaza contratos generados previamente a una oportunidad/lead
	 * Este endpoint guarda los contratos en la base de datos
	 */
	linkContractsToOpportunity: juridicoProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
				leadId: z.string().uuid(),
				contracts: z.array(
					z.object({
						contractType: z.string(),
						contractName: z.string(),
						documentLink: z.string().optional(),
						signingLinks: z.array(z.string()).optional(),
						templateId: z.number().optional(),
						apiResponse: z.unknown().optional(),
					}),
				),
				// Datos opcionales para guardar snapshot de regeneración
				contractDate: z.date().optional(),
				generationData: z
					.array(
						z.object({
							contractType: z.string(),
							data: z.record(z.string(), z.unknown()).and(
								z.object({
									deudoresAdicionales: z
										.array(
											z.object({
												nombreCompleto: z.string(),
												dpi: z.string(),
												dpiTexto: z.string(),
												edadTexto: z.string().optional(),
												estadoCivil: z.string().optional(),
												profesion: z.string().optional(),
												nacionalidad: z.string().optional(),
											}),
										)
										.optional(),
								}),
							),
							emails: z.array(z.string()).optional(),
							options: z.object({
								gender: z.enum(["male", "female"]),
								generatePdf: z.boolean(),
								filenamePrefix: z.string(),
							}),
						}),
					)
					.optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			try {
				const savedContracts: Array<{ id: string; contractType: string }> = [];

				for (const contract of input.contracts) {
					const [saved] = await db
						.insert(generatedLegalContracts)
						.values({
							leadId: input.leadId,
							opportunityId: input.opportunityId,
							contractType: contract.contractType,
							contractName: contract.contractName,
							clientSigningLink: contract.signingLinks?.[0] || null,
							representativeSigningLink: contract.signingLinks?.[1] || null,
							additionalSigningLinks: contract.signingLinks?.slice(2) || null,
							templateId: contract.templateId,
							apiResponse: contract.apiResponse,
							pdfLink: contract.documentLink || null,
							status: "pending",
							generatedBy: context.userId,
							generatedAt: new Date(),
						})
						.returning({ id: generatedLegalContracts.id });

					if (saved) {
						savedContracts.push({
							id: saved.id,
							contractType: contract.contractType,
						});
					}
				}

				// Guardar snapshot si se proporcionaron los datos de generación
				if (input.generationData && input.contractDate) {
					await db.insert(contractGenerationSnapshots).values({
						opportunityId: input.opportunityId,
						contractDate: input.contractDate,
						data: input.generationData,
						createdBy: context.userId,
					});
				}

				return {
					success: true,
					linkedCount: savedContracts.length,
					contracts: savedContracts,
					message: `Se enlazaron ${savedContracts.length} contrato(s) a la oportunidad exitosamente`,
				};
			} catch (error) {
				console.error("[linkContractsToOpportunity] Error:", error);
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message:
						error instanceof Error
							? error.message
							: "Error al enlazar contratos a la oportunidad",
				});
			}
		}),

	/**
	 * Obtiene el último snapshot de generación para una oportunidad
	 */
	getGenerationSnapshot: juridicoProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
			}),
		)
		.handler(async ({ input }) => {
			const [snapshot] = await db
				.select()
				.from(contractGenerationSnapshots)
				.where(
					eq(contractGenerationSnapshots.opportunityId, input.opportunityId),
				)
				.orderBy(contractGenerationSnapshots.createdAt)
				.limit(1);

			return snapshot || null;
		}),

	/**
	 * Regenera contratos con una nueva fecha
	 * Borra los contratos del mismo tipo y genera nuevos
	 */
	regenerateContracts: juridicoProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
				leadId: z.string().uuid(),
				contractTypes: z.array(z.string()).min(1),
				newDate: z.date(),
				// Data de generación (contracts del snapshot)
				generationData: z.array(
					z.object({
						contractType: z.string(),
						data: z.record(z.string(), z.string()),
						emails: z.array(z.string()).optional(),
						options: z.object({
							gender: z.enum(["male", "female"]),
							generatePdf: z.boolean(),
							filenamePrefix: z.string(),
						}),
					}),
				),
			}),
		)
		.handler(async ({ input, context }) => {
			const { generateContractsBatch } = await import(
				"../services/legal-docs-api"
			);

			try {
				// 1. Filtrar solo los contratos de los tipos a regenerar
				const contractsToRegenerate = input.generationData.filter((c) =>
					input.contractTypes.includes(c.contractType),
				);

				if (contractsToRegenerate.length === 0) {
					throw new ORPCError("BAD_REQUEST", {
						message:
							"No hay contratos para regenerar con los tipos especificados",
					});
				}

				// 1.5 Obtener termMonths de la quotation más reciente asociada
				const [quotation] = await db
					.select({ termMonths: quotations.termMonths })
					.from(quotations)
					.where(eq(quotations.opportunityId, input.opportunityId))
					.orderBy(desc(quotations.createdAt))
					.limit(1);

				const termMonths = quotation?.termMonths || 60; // Default 60 meses si no hay quotation

				// 2. Actualizar la fecha en los datos de cada contrato
				const contractsWithNewDate = contractsToRegenerate.map((contract) => {
					const newData = { ...contract.data };

					// Datos de la nueva fecha
					const day = input.newDate.getDate();
					const monthIndex = input.newDate.getMonth();
					const year = input.newDate.getFullYear();
					const yearShort = year.toString().slice(-2); // "26" para 2026

					const monthNames = [
						"enero",
						"febrero",
						"marzo",
						"abril",
						"mayo",
						"junio",
						"julio",
						"agosto",
						"septiembre",
						"octubre",
						"noviembre",
						"diciembre",
					];
					const monthText = monthNames[monthIndex];

					// Convertir día a texto
					const dayText = numberToSpanishText(day);
					// Convertir año corto a texto (ej: 26 -> "veintiséis")
					const yearText = numberToSpanishText(Number.parseInt(yearShort));
					// Año completo en texto (ej: 2026 -> "dos mil veintiséis")
					const fullYearText = numberToSpanishText(year);

					// Fecha completa en texto
					const fullDateText = `${dayText} de ${monthText} de ${fullYearText}`;

					// Actualizar campos de fecha del contrato
					if ("dia" in newData) newData.dia = day.toString();
					if ("ano" in newData) newData.ano = yearShort;
					if ("diaTexto" in newData) newData.diaTexto = dayText;
					if ("mesTexto" in newData) newData.mesTexto = monthText;
					if ("anoTexto" in newData) newData.anoTexto = yearText;
					if ("fechaInicioContrato" in newData)
						newData.fechaInicioContrato = fullDateText;

					// === CALCULAR DÍA DE PAGO Y FECHA DE VENCIMIENTO ===
					// Regla: Del 1 al 20 -> día 15, Del 21 al 31 -> último día del mes
					let diaPago: string;
					let diaVenc: number;

					// Obtener mes original del contrato para detectar si cambió
					const mesContratoOriginalIndex = monthNames.findIndex(
						(m) => m === newData.mesTexto?.toLowerCase(),
					);
					const mesContratoCambio =
						mesContratoOriginalIndex !== -1 &&
						mesContratoOriginalIndex !== monthIndex;

					// Obtener mes y año de vencimiento original de los datos del contrato
					const mesVencOriginal = newData.mesVencimiento
						? Number.parseInt(newData.mesVencimiento) - 1
						: null;
					const anioVencOriginal = newData.anoVencimiento
						? 2000 + Number.parseInt(newData.anoVencimiento)
						: null;

					let mesVenc: number;
					let anioVenc: number;

					// Si el mes del contrato cambió, recalcular la fecha de vencimiento con termMonths
					// Si no cambió, mantener el mes/año original y solo ajustar el día
					if (
						mesContratoCambio ||
						mesVencOriginal === null ||
						anioVencOriginal === null
					) {
						// Recalcular fecha de vencimiento basándose en termMonths
						const fechaVenc = new Date(year, monthIndex + termMonths, 1);
						mesVenc = fechaVenc.getMonth();
						anioVenc = fechaVenc.getFullYear();
					} else {
						// Mantener mes/año original
						mesVenc = mesVencOriginal;
						anioVenc = anioVencOriginal;
					}

					if (day <= 20) {
						// Del 1 al 20: día de pago es "día quince"
						diaPago = "día quince";
						diaVenc = 15;
					} else {
						// Del 21 al 31: día de pago es "último día"
						diaPago = "último día";
						diaVenc = new Date(anioVenc, mesVenc + 1, 0).getDate();
					}

					// Actualizar campos de día de pago
					if ("diaPago" in newData) newData.diaPago = diaPago;

					// Actualizar campos de fecha de vencimiento
					const mesVencText = monthNames[mesVenc];
					const anioVencShort = anioVenc.toString().slice(-2);

					if ("diaVencimiento" in newData)
						newData.diaVencimiento = diaVenc.toString();
					if ("mesVencimiento" in newData)
						newData.mesVencimiento = String(mesVenc + 1).padStart(2, "0");
					if ("anoVencimiento" in newData)
						newData.anoVencimiento = anioVencShort;
					if ("diaTextoVencimiento" in newData)
						newData.diaTextoVencimiento = numberToSpanishText(diaVenc);
					if ("mesTextoVencimiento" in newData)
						newData.mesTextoVencimiento = mesVencText;
					if ("anoTextoVencimiento" in newData)
						newData.anoTextoVencimiento = numberToSpanishText(
							Number.parseInt(anioVencShort),
						);

					return {
						...contract,
						data: newData,
					};
				});

				// 3. Generar los nuevos contratos
				const apiResult = await generateContractsBatch({
					contracts: contractsWithNewDate,
				});

				if (!apiResult.results || apiResult.results.length === 0) {
					throw new ORPCError("INTERNAL_SERVER_ERROR", {
						message: "Error al generar los contratos",
					});
				}

				// 4. Procesar cada contrato: solo borrar e insertar si la generación fue exitosa
				const savedContracts: Array<{ id: string; contractType: string }> = [];
				const failedContracts: string[] = [];

				for (let i = 0; i < apiResult.results.length; i++) {
					const contractResult = apiResult.results[i];
					const originalContract = contractsWithNewDate[i];

					if (contractResult.success) {
						// Solo borrar el contrato anterior si la generación fue exitosa
						await db
							.delete(generatedLegalContracts)
							.where(
								and(
									eq(
										generatedLegalContracts.opportunityId,
										input.opportunityId,
									),
									eq(
										generatedLegalContracts.contractType,
										originalContract.contractType,
									),
								),
							);

						// Insertar el nuevo contrato
						const [saved] = await db
							.insert(generatedLegalContracts)
							.values({
								leadId: input.leadId,
								opportunityId: input.opportunityId,
								contractType: originalContract.contractType,
								contractName:
									contractResult.nameDocument?.[0]?.label || "Contrato",
								clientSigningLink: contractResult.signing_links?.[0] || null,
								representativeSigningLink:
									contractResult.signing_links?.[1] || null,
								additionalSigningLinks:
									contractResult.signing_links?.slice(2) || null,
								templateId: contractResult.templateId,
								apiResponse: contractResult,
								pdfLink:
									contractResult.r2Key || contractResult.linkDocument || null,
								status: "pending",
								generatedBy: context.userId,
								generatedAt: new Date(),
							})
							.returning({ id: generatedLegalContracts.id });

						if (saved) {
							savedContracts.push({
								id: saved.id,
								contractType: originalContract.contractType,
							});
						}
					} else {
						// Registrar contratos que fallaron (no se borran)
						failedContracts.push(originalContract.contractType);
					}
				}

				// Construir mensaje de resultado
				let message = `Se regeneraron ${savedContracts.length} contrato(s) exitosamente`;
				if (failedContracts.length > 0) {
					message += `. Fallaron: ${failedContracts.join(", ")} (no fueron borrados)`;
				}

				return {
					success: savedContracts.length > 0,
					regeneratedCount: savedContracts.length,
					failedCount: failedContracts.length,
					contracts: savedContracts,
					failedContracts,
					message,
				};
			} catch (error) {
				console.error("[regenerateContracts] Error:", error);
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message:
						error instanceof Error
							? error.message
							: "Error al regenerar contratos",
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
 * Convierte un número a texto en español
 */
function numberToSpanishText(num: number): string {
	const unidades = [
		"",
		"uno",
		"dos",
		"tres",
		"cuatro",
		"cinco",
		"seis",
		"siete",
		"ocho",
		"nueve",
		"diez",
		"once",
		"doce",
		"trece",
		"catorce",
		"quince",
		"dieciséis",
		"diecisiete",
		"dieciocho",
		"diecinueve",
		"veinte",
		"veintiuno",
		"veintidós",
		"veintitrés",
		"veinticuatro",
		"veinticinco",
		"veintiséis",
		"veintisiete",
		"veintiocho",
		"veintinueve",
	];

	const decenas = [
		"",
		"",
		"veinte",
		"treinta",
		"cuarenta",
		"cincuenta",
		"sesenta",
		"setenta",
		"ochenta",
		"noventa",
	];

	const centenas = [
		"",
		"ciento",
		"doscientos",
		"trescientos",
		"cuatrocientos",
		"quinientos",
		"seiscientos",
		"setecientos",
		"ochocientos",
		"novecientos",
	];

	if (num === 0) return "cero";
	if (num === 100) return "cien";
	if (num < 30) return unidades[num];

	if (num < 100) {
		const decena = Math.floor(num / 10);
		const unidad = num % 10;
		if (unidad === 0) return decenas[decena];
		return `${decenas[decena]} y ${unidades[unidad]}`;
	}

	if (num < 1000) {
		const centena = Math.floor(num / 100);
		const resto = num % 100;
		if (resto === 0) return num === 100 ? "cien" : centenas[centena];
		return `${centenas[centena]} ${numberToSpanishText(resto)}`;
	}

	if (num < 2000) {
		const resto = num % 1000;
		if (resto === 0) return "mil";
		return `mil ${numberToSpanishText(resto)}`;
	}

	if (num < 1000000) {
		const miles = Math.floor(num / 1000);
		const resto = num % 1000;
		const milesText = numberToSpanishText(miles);
		if (resto === 0) return `${milesText} mil`;
		return `${milesText} mil ${numberToSpanishText(resto)}`;
	}

	// Para años como 2026
	return num.toString();
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

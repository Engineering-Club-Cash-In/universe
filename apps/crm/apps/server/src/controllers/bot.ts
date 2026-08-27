// controllers/renapController.ts

import { and, asc, desc, eq, inArray, type SQL } from "drizzle-orm";
import {
	leads,
	type leadSourceEnum,
	magicUrls,
	opportunities,
	opportunityDocuments,
	renapInfo,
	salesStages,
	user,
} from "@/db/schema";
import type { documentTypeEnum } from "@/db/schema/documents";
import { getRenapData } from "@/functions/getRenapInfo";
import { eqDpi } from "@/lib/dpi-lookup";
import {
	findSalesUserWithLeastAutoAssignedLeads,
	resolveNewAutoLeadAssignment,
} from "@/lib/lead-assignment";
import { getOpenOpportunityBySource } from "@/lib/lead-opportunity";
import { generateUniqueFilename, uploadFileFromUrlToR2 } from "@/lib/storage";
import { db } from "../db";
import { logEntityAudit } from "../lib/audit";
import { validarDpi } from "../utils/cui-validation";
import { otpController } from "./otp";

// Type for document type enum
type DocumentType = (typeof documentTypeEnum.enumValues)[number];

/**
 * Mapping from bot document fields to document types
 */
const BOT_DOCUMENT_TYPE_MAP: Record<string, DocumentType> = {
	electricity_bill: "recibo_luz",
	bank_statements: "estados_cuenta_1",
	bank_statements_2: "estados_cuenta_2",
	bank_statements_3: "estados_cuenta_3",
};

/**
 * Estados en los que una oportunidad cuenta como proceso en curso.
 *
 * Va en una sola constante a propósito: el lead se elige por tener un proceso
 * activo, y si los documentos se buscaran con un criterio más angosto habría
 * leads elegidos a los que nunca se les podría adjuntar nada.
 */
const ACTIVE_OPPORTUNITY_STATUSES = ["open", "on_hold"] as const;

/**
 * Generic function to add or replace documents to active opportunities of a lead.
 *
 * Recibe el lead ya resuelto y no lo vuelve a buscar por DPI: mientras queden
 * duplicados sin depurar, repetir la búsqueda podía caer en otra fila y dejar
 * los documentos colgados del proceso equivocado.
 *
 * @param leadId - The lead whose active opportunities receive the documents
 * @param documents - Array of documents to add { type: DocumentType, url: string, filename?: string }
 * @param uploadedBy - User ID who uploads the documents
 * @returns Results of the operation
 */
export async function addDocumentsToActiveOpportunities(
	leadId: string,
	documents: Array<{
		type: DocumentType;
		url: string;
		filename?: string;
	}>,
	uploadedBy: string,
): Promise<{
	success: boolean;
	message: string;
	opportunitiesUpdated?: number;
	documentsAdded?: number;
}> {
	try {
		console.log(`[DEBUG] addDocumentsToActiveOpportunities for lead: ${leadId}`);

		// 1. Find active opportunities for this lead
		const activeOpportunities = await db
			.select()
			.from(opportunities)
			.where(
				and(
					eq(opportunities.leadId, leadId),
					inArray(opportunities.status, ACTIVE_OPPORTUNITY_STATUSES),
				),
			);

		if (activeOpportunities.length === 0) {
			return {
				success: false,
				message: `No active opportunities found for lead: ${leadId}`,
			};
		}

		console.log(
			`[DEBUG] Found ${activeOpportunities.length} active opportunities for lead ${leadId}`,
		);

		let totalDocumentsAdded = 0;

		// 2. For each active opportunity, add/replace documents
		for (const opportunity of activeOpportunities) {
			for (const doc of documents) {
				if (!doc.url) continue;

				try {
					// Generate unique filename
					const originalName = doc.filename || `${doc.type}_${Date.now()}.pdf`;
					const uniqueFilename = generateUniqueFilename(originalName);

					// Upload file from URL to R2 (returns size and mimeType)
					const { key, size, mimeType } = await uploadFileFromUrlToR2(
						doc.url,
						uniqueFilename,
						opportunity.id,
					);

					// Check if document of this type already exists for this opportunity
					const existingDoc = await db
						.select()
						.from(opportunityDocuments)
						.where(
							and(
								eq(opportunityDocuments.opportunityId, opportunity.id),
								eq(opportunityDocuments.documentType, doc.type),
							),
						)
						.limit(1)
						.then((results) => results[0] || null);

					if (existingDoc) {
						// Update existing document
						await db
							.update(opportunityDocuments)
							.set({
								filename: uniqueFilename,
								originalName: originalName,
								mimeType: mimeType,
								size: size,
								filePath: key,
								uploadedAt: new Date(),
								uploadedBy: uploadedBy,
							})
							.where(eq(opportunityDocuments.id, existingDoc.id));
						console.log(
							`[DEBUG] Updated document ${doc.type} for opportunity ${opportunity.id}`,
						);
					} else {
						// Insert new document
						await db.insert(opportunityDocuments).values({
							opportunityId: opportunity.id,
							filename: uniqueFilename,
							originalName: originalName,
							mimeType: mimeType,
							size: size,
							documentType: doc.type,
							filePath: key,
							uploadedBy: uploadedBy,
							uploadedAt: new Date(),
						});
						console.log(
							`[DEBUG] Inserted document ${doc.type} for opportunity ${opportunity.id}`,
						);
					}

					totalDocumentsAdded++;
				} catch (docError) {
					console.error(
						`[ERROR] Failed to process document ${doc.type} for opportunity ${opportunity.id}:`,
						docError,
					);
				}
			}
		}

		return {
			success: true,
			message: "Documents added/updated successfully",
			opportunitiesUpdated: activeOpportunities.length,
			documentsAdded: totalDocumentsAdded,
		};
	} catch (error: any) {
		console.error("[ERROR] addDocumentsToActiveOpportunities failed:", error);
		return {
			success: false,
			message: error?.message || "Failed to add documents to opportunities",
		};
	}
}

/**
 * Helper function to check if active opportunities have specific document types.
 *
 * Igual que `addDocumentsToActiveOpportunities`, recibe el lead ya resuelto para
 * no volver a buscarlo por DPI y arriesgarse a leer otro duplicado.
 */
export async function checkDocumentsInActiveOpportunities(
	leadId: string,
	documentTypes: DocumentType[],
): Promise<{
	success: boolean;
	hasDocuments: Record<DocumentType, boolean>;
	message?: string;
}> {
	try {
		// Find active opportunities
		const activeOpportunities = await db
			.select()
			.from(opportunities)
			.where(
				and(
					eq(opportunities.leadId, leadId),
					inArray(opportunities.status, ACTIVE_OPPORTUNITY_STATUSES),
				),
			);

		if (activeOpportunities.length === 0) {
			return {
				success: false,
				hasDocuments: {} as Record<DocumentType, boolean>,
				message: `No active opportunities found for lead: ${leadId}`,
			};
		}

		// Get all documents for the first active opportunity (most recent)
		const docs = await db
			.select()
			.from(opportunityDocuments)
			.where(eq(opportunityDocuments.opportunityId, activeOpportunities[0].id));

		const existingTypes = new Set(docs.map((d) => d.documentType));
		const hasDocuments = {} as Record<DocumentType, boolean>;

		for (const type of documentTypes) {
			hasDocuments[type] = existingTypes.has(type);
		}

		return {
			success: true,
			hasDocuments,
		};
	} catch (error: any) {
		console.error("[ERROR] checkDocumentsInActiveOpportunities failed:", error);
		return {
			success: false,
			hasDocuments: {} as Record<DocumentType, boolean>,
			message: error?.message || "Failed to check documents",
		};
	}
}

/**
 * Controller: getRenapInfoController
 *
 * This controller is responsible for:
 * 1. Fetching RENAP data for a given DPI.
 * 2. Inserting or updating data in the `renap_info` table.
 * 3. Inserting or updating related data in the `leads` table.
 *
 * @param dpi - The DPI (unique identifier for the person).
 * @returns An object with the RENAP data and the operation status.
 *//**
 * Utility: Normalize dates to ISO format (YYYY-MM-DD).
 */
// Mapeos desde los valores que recibes en el bot hacia los enums de la DB
const occupationMap: Record<string, "employee" | "owner" | null> = {
	EMPLOYEE: "employee",
	OWNER: "owner",
};

const workTimeMap: Record<string, "1_to_5" | "5_to_10" | "10_plus" | null> = {
	"1TO5": "1_to_5",
	"5TO10": "5_to_10",
	"10PLUS": "10_plus",
};

const loanPurposeMap: Record<string, "personal" | "business" | null> = {
	PERSONAL: "personal",
	BUSINESS: "business",
};
function normalizeDate(dateStr: string | null | undefined): string | null {
	if (!dateStr) return null;
	// Detect dd/mm/yyyy
	const parts = dateStr.split("/");
	if (parts.length === 3) {
		const [day, month, year] = parts;
		return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
	}
	return dateStr; // si ya viene ISO o válido, lo dejamos igual
}

/**
 * Busca el lead que corresponde a un DPI y el proceso que tenga en curso.
 *
 * Se traen TODOS los leads del DPI, no uno solo: mientras queden duplicados sin
 * depurar, la oportunidad activa puede estar colgada de cualquiera de ellos, y
 * quedarse con el más antiguo haría pasar por inactivo a un cliente que otro
 * asesor ya está atendiendo. Se devuelve el lead que sostiene ese proceso y, si
 * no hay ninguno, el más antiguo, que es el que arrastra el historial.
 *
 * No se filtra por estado: un cliente ya migrado o convertido sigue siendo la
 * misma persona, y tratarlo como inexistente lo parte en dos leads repartidos
 * entre dos asesores.
 */
async function findLeadWithActiveOpportunity(match: SQL): Promise<{
	// El tipo va explícito para que ambos campos queden independientes: si se
	// infiere, TypeScript los trata como unión correlacionada y descartar la
	// oportunidad activa termina descartando también el lead.
	lead: typeof leads.$inferSelect | null;
	activeOpportunity: {
		id: string;
		leadId: string | null;
		assignedTo: string;
	} | null;
}> {
	const matchingLeads = await db
		.select()
		.from(leads)
		.where(match)
		.orderBy(asc(leads.createdAt));

	if (matchingLeads.length === 0) {
		return { lead: null, activeOpportunity: null };
	}

	const [activeOpportunity] = await db
		.select({
			id: opportunities.id,
			leadId: opportunities.leadId,
			assignedTo: opportunities.assignedTo,
		})
		.from(opportunities)
		.where(
			and(
				inArray(
					opportunities.leadId,
					matchingLeads.map((lead) => lead.id),
				),
				inArray(opportunities.status, ACTIVE_OPPORTUNITY_STATUSES),
			),
		)
		.orderBy(desc(opportunities.createdAt))
		.limit(1);

	const lead =
		matchingLeads.find((item) => item.id === activeOpportunity?.leadId) ??
		matchingLeads[0];

	return { lead, activeOpportunity: activeOpportunity ?? null };
}

/** Resuelve el lead a partir del DPI, normalizando el formato. */
function findLeadWithActiveOpportunityByDpi(dpi: string) {
	return findLeadWithActiveOpportunity(eqDpi(leads.dpi, dpi));
}

/**
 * Resuelve el lead a partir del teléfono con el que escribe el cliente.
 * Comparte la selección con la búsqueda por DPI para que los pasos del bot no
 * terminen mirando leads distintos según con qué dato entren.
 */
function findLeadWithActiveOpportunityByPhone(phone: string) {
	return findLeadWithActiveOpportunity(eq(leads.phone, phone));
}

/**
 * @param dpi - The DPI (unique identifier for the person).
 * @returns An object with the RENAP data and the operation status.
 */
export const getRenapInfoController = async (
	dpiRecibido: string,
	phone: string,
) => {
	console.log(`[DEBUG] Starting RENAP process for DPI: ${dpiRecibido}`);

	// Validar DPI
	const resultadoDpi = validarDpi(dpiRecibido);
	if (!resultadoDpi.valid) {
		return {
			success: false,
			message: resultadoDpi.error,
		};
	}

	// A partir de aquí se trabaja siempre con el DPI normalizado: si entra con
	// espacios, guardarlo tal cual crea un registro que ya no empata con el resto.
	const dpi = resultadoDpi.dpiLimpio;

	// 1. Fetch data from RENAP API
	const renapResponse = await getRenapData(dpi);

	if (!renapResponse.success || !renapResponse.data) {
		console.error(`[ERROR] RENAP API failed for DPI: ${dpi}`, renapResponse);
		return {
			success: false,
			message: renapResponse.message || "No RENAP data found",
			error: renapResponse.error,
		};
	}

	const renapData = renapResponse.data;
	console.log(`[DEBUG] RENAP API response received for DPI: ${dpi}`, renapData);

	// ========================
	// 2. Insert or Update renap_info
	// ========================
	console.log(`[DEBUG] Checking if DPI exists in renap_info: ${dpi}`);
	const existingRenap = await db
		.select()
		.from(renapInfo)
		.where(eqDpi(renapInfo.dpi, dpi));

	if (existingRenap.length === 0) {
		console.log("[DEBUG] DPI not found in renap_info. Inserting new record.");
		await db.insert(renapInfo).values({
			dpi,
			firstName: renapData.firstName,
			secondName: renapData.secondName,
			thirdName: renapData.thirdName,
			firstLastName: renapData.firstLastName,
			secondLastName: renapData.secondLastName,
			marriedLastName: renapData.marriedLastName,
			picture: renapData.picture,
			birthDate: normalizeDate(renapData.birthDate),
			gender: renapData.gender,
			civilStatus: renapData.civil_status,
			nationality: renapData.nationality,
			bornedIn: renapData.borned_in,
			departmentBornedIn: renapData.department_borned_in,
			municipalityBornedIn: renapData.municipality_borned_in,
			deathDate: normalizeDate(renapData.deathDate),
			ocupation: renapData.ocupation,
			cedulaOrder: renapData.cedula_order,
			cedulaRegister: renapData.cedula_register,
			dpiExpiracyDate: normalizeDate(renapData.dpi_expiracy_date),
		});
	} else {
		console.log("[DEBUG] DPI found in renap_info. Updating record.");
		await db
			.update(renapInfo)
			.set({
				firstName: renapData.firstName,
				secondName: renapData.secondName,
				thirdName: renapData.thirdName,
				firstLastName: renapData.firstLastName,
				secondLastName: renapData.secondLastName,
				marriedLastName: renapData.marriedLastName,
				picture: renapData.picture,
				birthDate: normalizeDate(renapData.birthDate),
				gender: renapData.gender,
				civilStatus: renapData.civil_status,
				nationality: renapData.nationality,
				bornedIn: renapData.borned_in,
				departmentBornedIn: renapData.department_borned_in,
				municipalityBornedIn: renapData.municipality_borned_in,
				deathDate: normalizeDate(renapData.deathDate),
				ocupation: renapData.ocupation,
				cedulaOrder: renapData.cedula_order,
				cedulaRegister: renapData.cedula_register,
				dpiExpiracyDate: normalizeDate(renapData.dpi_expiracy_date),
			})
			.where(eqDpi(renapInfo.dpi, dpi));
	}

	// ========================
	// 3. Insert or Update leads
	// ========================
	const { lead: existingLead, activeOpportunity } =
		await findLeadWithActiveOpportunityByDpi(dpi);

	const age = calculateAge(renapData.birthDate);
	console.log(`[DEBUG] Calculated age for DPI ${dpi}: ${age}`);

	let leadId: string;
	let assignedUserId: string;
	let createdByUserId: string;
	// Canal del lead, para decidir si una oportunidad legacy (sin source) le
	// corresponde a WhatsApp. Este flujo no toca leads.source, así que el valor
	// que se lee aquí es el mismo con el que se creó el lead.
	let leadSource: (typeof leadSourceEnum.enumValues)[number];

	if (!existingLead) {
		console.log("[DEBUG] DPI not found in leads. Inserting new lead.");
		const newLeadAssignment = await resolveNewAutoLeadAssignment(
			findSalesUserWithLeastAutoAssignedLeads,
			"No sales user available to assign the WhatsApp lead",
		);

		if (!newLeadAssignment.success) {
			return newLeadAssignment;
		}

		const newLead = await db
			.insert(leads)
			.values({
				firstName: renapData.firstName,
				lastName: renapData.firstLastName,
				dpi,
				maritalStatus: mapCivilStatusToEnum(renapData.civil_status),
				assignedTo: newLeadAssignment.assignedTo,
				age: age ?? undefined,
				source: "Whatsapp",
				email: "",
				phone: phone,
				createdBy: newLeadAssignment.createdBy,
				status: "new",
				assignmentType: "auto",
			})
			.returning({ id: leads.id });
		await logEntityAudit(db, {
			entityType: "lead",
			entityId: newLead[0].id,
			action: "create",
			procedure: "bot.getRenapInfoController",
			source: "bot",
			performedBy: null,
			input: { dpi, phone },
		});
		leadId = newLead[0].id;
		assignedUserId = newLeadAssignment.assignedTo;
		createdByUserId = newLeadAssignment.createdBy;
		leadSource = "Whatsapp";
	} else {
		// El lead ya existía. Si hay un proceso activo se respeta al asesor que lo
		// está trabajando; si solo le quedan créditos ganados o migrados es un
		// cliente que regresa y vuelve a entrar a la ruleta.
		leadId = existingLead.id;
		createdByUserId = existingLead.createdBy;
		leadSource = existingLead.source;

		if (activeOpportunity) {
			console.log(
				`[DEBUG] Lead ${leadId} ya tiene proceso activo; se respeta su asesor.`,
			);
			assignedUserId = activeOpportunity.assignedTo;

			// Solo se refrescan los datos de RENAP. El estado del lead y su asesor
			// pertenecen a un proceso en curso y no se tocan.
			await db
				.update(leads)
				.set({
					firstName: renapData.firstName,
					lastName: renapData.firstLastName,
					maritalStatus: mapCivilStatusToEnum(renapData.civil_status),
					age: age ?? existingLead.age,
					updatedAt: new Date(),
				})
				.where(eq(leads.id, existingLead.id));
			await logEntityAudit(db, {
				entityType: "lead",
				entityId: existingLead.id,
				action: "update",
				procedure: "bot.getRenapInfoController",
				source: "bot",
				performedBy: null,
				input: { dpi, reason: "renap_refresh" },
			});
		} else {
			console.log(
				`[DEBUG] Lead ${leadId} sin proceso activo; se reasigna por ruleta.`,
			);
			const reassignment = await resolveNewAutoLeadAssignment(
				findSalesUserWithLeastAutoAssignedLeads,
				"No sales user available to assign the reactivated lead",
			);

			if (!reassignment.success) {
				return reassignment;
			}

			assignedUserId = reassignment.assignedTo;

			await db
				.update(leads)
				.set({
					firstName: renapData.firstName,
					lastName: renapData.firstLastName,
					maritalStatus: mapCivilStatusToEnum(renapData.civil_status),
					assignedTo: reassignment.assignedTo,
					assignmentType: "auto",
					status: "new",
					age: age ?? existingLead.age,
					updatedAt: new Date(),
					livenessValidated: false,
				})
				.where(eq(leads.id, existingLead.id));
			await logEntityAudit(db, {
				entityType: "lead",
				entityId: existingLead.id,
				action: "reassign",
				procedure: "bot.getRenapInfoController",
				source: "bot",
				performedBy: null,
				input: { dpi, assignedTo: reassignment.assignedTo },
			});
		}
	}

	// ========================
	// 4. Create or Update Magic URL
	// ========================
	const magicUrlValue = `${MAGIC_URL_BASE}${dpi}`;
	console.log(`[DEBUG] Checking magic URL for lead ${leadId}`);
	const [existingMagicUrl] = await db
		.select()
		.from(magicUrls)
		.where(eq(magicUrls.leadId, leadId))
		.limit(1);

	if (existingMagicUrl) {
		await db
			.update(magicUrls)
			.set({
				url: magicUrlValue,
				updatedAt: new Date(),
				used: false,
				expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
			})
			.where(eq(magicUrls.id, existingMagicUrl.id));
	} else {
		await db.insert(magicUrls).values({
			leadId: leadId,
			url: magicUrlValue,
			createdAt: new Date(),
			expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
			used: false,
		});
	}

	// ========================
	// 5. Crear oportunidad solo si no existe una abierta con mismo source
	// ========================
	const existingOpportunity = await getOpenOpportunityBySource(
		leadId,
		"Whatsapp",
		leadSource,
	);

	let opportunityId: string;

	if (existingOpportunity) {
		console.log(
			`[DEBUG] Lead ${leadId} already has open opportunity from Whatsapp: ${existingOpportunity.id}`,
		);
		if (existingOpportunity.assignedTo !== assignedUserId) {
			await db
				.update(opportunities)
				.set({ assignedTo: assignedUserId, updatedAt: new Date() })
				.where(eq(opportunities.id, existingOpportunity.id));
			await logEntityAudit(db, {
				entityType: "opportunity",
				entityId: existingOpportunity.id,
				action: "reassign",
				procedure: "bot.getRenapInfoController",
				source: "bot",
				performedBy: null,
				input: { dpi, assignedTo: assignedUserId },
			});
		}
		opportunityId = existingOpportunity.id;
	} else {
		const [firstStage] = await db
			.select()
			.from(salesStages)
			.orderBy(asc(salesStages.order))
			.limit(1);

		if (!firstStage) {
			throw new Error("[ERROR] No sales stage found");
		}

		console.log(`[DEBUG] Creating NEW opportunity for lead ${leadId}`);

		const [newOpportunity] = await db
			.insert(opportunities)
			.values({
				leadId: leadId,
				status: "open",
				probability: 0,
				createdAt: new Date(),
				updatedAt: new Date(),
				assignedTo: assignedUserId,
				createdBy: createdByUserId,
				title: `Oportunidad de crédito para ${renapData.firstName} ${renapData.firstLastName}`,
				stageId: firstStage.id,
				source: "Whatsapp",
			})
			.returning();
		await logEntityAudit(db, {
			entityType: "opportunity",
			entityId: newOpportunity.id,
			action: "create",
			procedure: "bot.getRenapInfoController",
			source: "bot",
			performedBy: null,
			input: { dpi, leadId, assignedTo: assignedUserId },
		});

		opportunityId = newOpportunity.id;
	}

	// ========================
	// 6. Response
	// ========================
	console.log(`[DEBUG] RENAP process completed successfully for DPI: ${dpi}`);

	return {
		success: true,
		message: existingOpportunity
			? "RENAP data processed, lead synced, existing opportunity reused"
			: "RENAP data processed, lead synced, and opportunity created successfully",
		data: renapData,
		leadId,
		opportunityId,
		magicUrl: magicUrlValue,
	};
};

/**
 * Utility: Calculate age from a birth date string.
 * @param birthDateStr - Date in string format (YYYY-MM-DD or ISO-like).
 * @returns Age in years (integer).
 */
export function calculateAge(birthDateStr: string): number | null {
	if (!birthDateStr) return null;

	const birthDate = new Date(normalizeDate(birthDateStr)!);
	if (isNaN(birthDate.getTime())) return null; // Invalid date

	const today = new Date();
	let age = today.getFullYear() - birthDate.getFullYear();
	const monthDiff = today.getMonth() - birthDate.getMonth();

	if (
		monthDiff < 0 ||
		(monthDiff === 0 && today.getDate() < birthDate.getDate())
	) {
		age--;
	}

	return age;
}
function mapCivilStatusToEnum(
	status: string | null,
): "single" | "married" | "divorced" | "widowed" | null {
	if (!status) return null;
	switch (status) {
		case "S":
			return "single"; // soltero
		case "C":
			return "married"; // casado
		default:
			return null; // fallback si RENAP manda algo raro
	}
}

// Define the base URL for magic links
const MAGIC_URL_BASE = process.env.MAGIC_URL_BASE;
/**
 * Controller: updateLeadAndCreateOpportunity
 *
 * - Busca el lead por DPI que tenga status = "new".
 * - Actualiza solo los campos enviados en `data`.
 * - Si se envía algún documento, lo inserta en opportunityDocuments de las oportunidades abiertas.
 * - Crea una oportunidad vinculada al lead.
 */
export const updateLeadAndCreateOpportunity = async (
	dpi: string,
	data: {
		dependents?: number;
		monthlyIncome?: string;
		loanAmount?: string;
		occupation?: string;
		workTime?: string;
		loanPurpose?: string;
		ownsHome?: boolean;
		ownsVehicle?: boolean;
		hasCreditCard?: boolean;
		electricityBill?: string;
		bankStatements?: string;
		bankStatements2?: string;
		bankStatements3?: string;
	},
) => {
	console.log(
		`[DEBUG] Starting updateLeadAndCreateOpportunity for DPI: ${dpi}`,
	);
	console.log("[DEBUG] Data received:", data);

	if (!dpi) {
		return { success: false, message: "DPI is required" };
	}

	// 1. Buscar el lead por DPI, con el mismo criterio que el paso de RENAP.
	// Antes se exigía `status = 'new'`, que funcionaba solo porque ese paso
	// siempre reseteaba el estado. Desde que respeta el proceso en curso, el
	// lead puede seguir en `contacted`, `qualified` o `migrate`, y filtrar por
	// `new` dejaba sin guardar los ingresos y documentos recién enviados.
	const { lead: existingLead } = await findLeadWithActiveOpportunityByDpi(dpi);

	if (!existingLead) {
		console.error(`[ERROR] Lead not found with DPI: ${dpi}`);
		return {
			success: false,
			message: "Lead not found with the provided DPI",
		};
	}

	// Normalizar enums
	const normalizedOccupation = data.occupation
		? (occupationMap[data.occupation.toUpperCase()] ?? null)
		: null;
	const normalizedWorkTime = data.workTime
		? (workTimeMap[data.workTime.toUpperCase()] ?? null)
		: null;

	// 2. Construir objeto de actualización dinámico
	const leadUpdates: Partial<typeof leads.$inferInsert> = {};
	if (data.dependents !== undefined) leadUpdates.dependents = data.dependents;
	if (data.monthlyIncome !== undefined)
		leadUpdates.monthlyIncome = data.monthlyIncome;
	if (data.loanAmount !== undefined) leadUpdates.loanAmount = data.loanAmount;
	if (normalizedOccupation !== null)
		leadUpdates.occupation = normalizedOccupation;
	if (normalizedWorkTime !== null) leadUpdates.workTime = normalizedWorkTime;
	if (data.ownsHome !== undefined) leadUpdates.ownsHome = data.ownsHome;
	if (data.ownsVehicle !== undefined)
		leadUpdates.ownsVehicle = data.ownsVehicle;
	if (data.hasCreditCard !== undefined)
		leadUpdates.hasCreditCard = data.hasCreditCard;

	if (Object.keys(leadUpdates).length > 0) {
		console.log(
			`[DEBUG] Updating lead ${existingLead.id} with fields: ${Object.keys(
				leadUpdates,
			).join(", ")}`,
		);
		await db
			.update(leads)
			.set(leadUpdates)
			.where(eq(leads.id, existingLead.id));
		await logEntityAudit(db, {
			entityType: "lead",
			entityId: existingLead.id,
			action: "update",
			procedure: "bot.updateLeadAndCreateOpportunity",
			source: "bot",
			performedBy: null,
			input: { dpi, ...leadUpdates },
		});
	}

	// 3. Agregar documentos a las oportunidades abiertas usando la función genérica
	if (
		data.electricityBill ||
		data.bankStatements ||
		data.bankStatements2 ||
		data.bankStatements3
	) {
		console.log(
			`[DEBUG] Adding documents to open opportunities for DPI ${dpi}`,
		);

		// Construir array de documentos a agregar
		const documentsToAdd: Array<{
			type: DocumentType;
			url: string;
			filename?: string;
		}> = [];

		if (data.electricityBill) {
			documentsToAdd.push({
				type: "recibo_luz",
				url: data.electricityBill,
				filename: "recibo_luz.pdf",
			});
		}
		if (data.bankStatements) {
			documentsToAdd.push({
				type: "estados_cuenta_1",
				url: data.bankStatements,
				filename: "estado_cuenta_1.pdf",
			});
		}
		if (data.bankStatements2) {
			documentsToAdd.push({
				type: "estados_cuenta_2",
				url: data.bankStatements2,
				filename: "estado_cuenta_2.pdf",
			});
		}
		if (data.bankStatements3) {
			documentsToAdd.push({
				type: "estados_cuenta_3",
				url: data.bankStatements3,
				filename: "estado_cuenta_3.pdf",
			});
		}

		if (documentsToAdd.length > 0) {
			// Usar el usuario asignado al lead como uploader
			const uploadedBy = existingLead.assignedTo;
			// Se pasa el lead ya resuelto arriba, no el DPI: volver a buscarlo podía
			// caer en otro duplicado y colgar los documentos del proceso equivocado.
			const documentsResult = await addDocumentsToActiveOpportunities(
				existingLead.id,
				documentsToAdd,
				uploadedBy,
			);

			// El cliente ya subió los archivos; si no quedaron pegados a ninguna
			// oportunidad hay que verlo en el log y no perderlo en silencio.
			if (!documentsResult.success) {
				console.error(
					`[ERROR] No se adjuntaron los documentos del lead ${existingLead.id}: ${documentsResult.message}`,
				);
			}
		}
	}

	// 4. Actualizar magic URL
	const magicUrlValue = `${MAGIC_URL_BASE}${existingLead.dpi}`;
	console.log(`[DEBUG] Checking magic URL for lead ${existingLead.id}`);
	const [existingMagicUrl] = await db
		.select()
		.from(magicUrls)
		.where(eq(magicUrls.leadId, existingLead.id))
		.limit(1);

	if (existingMagicUrl) {
		await db
			.update(magicUrls)
			.set({
				url: magicUrlValue,
				updatedAt: new Date(),
				used: false,
				expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
			})
			.where(eq(magicUrls.id, existingMagicUrl.id));
	} else {
		await db.insert(magicUrls).values({
			leadId: existingLead.id,
			url: magicUrlValue,
			createdAt: new Date(),
			expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
			used: false,
		});
	}

	console.log(`[DEBUG] Lead updated successfully for DPI: ${dpi}`);

	return {
		success: true,
		message: "Lead updated and documents saved successfully",
		leadId: existingLead.id,
		magicUrl: magicUrlValue,
	};
};
/**
 * Controller: getLeadProgress
 *
 * This controller:
 * 1. Finds a lead by DPI with status = "new".
 * 2. Determines the current step based on missing fields.
 * 3. Returns the step name (string).
 */
export const getLeadProgress = async (phone: string) => {
	try {
		console.log(`[DEBUG] Starting getLeadProgress for phone: ${phone}`);

		// 1. Find the lead by phone.
		// Sin filtrar por estado: el paso de RENAP ya no lo resetea cuando hay un
		// proceso en curso, así que exigir `new` dejaba al bot sin poder calcular
		// los pasos pendientes de los clientes activos.
		const { lead } = await findLeadWithActiveOpportunityByPhone(phone);

		if (!lead) {
			console.error("[ERROR] Lead not found");
			return {
				success: false,
				message: "Lead not found with the provided phone",
			};
		}

		console.log(`[DEBUG] Found lead ${lead.id} with status "${lead.status}"`);

		// 2. Get documents from open opportunities
		const documentCheck = await checkDocumentsInActiveOpportunities(lead.id, [
			"recibo_luz",
			"estados_cuenta_1",
		]);

		const steps: string[] = [];
		console.log("lead", lead);
		// Revisar cada condición y agregar los pasos que falten
		if (!lead.dependents || lead.dependents === 0) steps.push("dependents");
		if (!lead.monthlyIncome) steps.push("monthlyIncome");
		if (!lead.loanAmount) steps.push("loanAmount");
		if (!lead.occupation) steps.push("occupation");
		if (!lead.workTime) steps.push("workTime");
		if (!documentCheck.hasDocuments?.recibo_luz) steps.push("electricityBill");
		if (!documentCheck.hasDocuments?.estados_cuenta_1)
			steps.push("bankStatements");

		// El primer paso pendiente es donde está el usuario
		const currentStep = steps.length > 0 ? steps[0] : null;

		console.log("[DEBUG] Pending steps:", steps);
		console.log("[DEBUG] Current step:", currentStep);

		return {
			success: true,
			leadId: lead.id,
			dpi: lead.dpi,
			steps,
			currentStep,
		};
	} catch (err: any) {
		console.error("[ERROR] getLeadProgress failed:", err);
		return {
			success: false,
			message: err.message || "Internal server error",
		};
	}
};
/**
 * Controller: validateMagicUrlController
 *
 * Verifica si un link mágico asociado a un DPI es válido.
 *
 * @param dpi - DPI del usuario
 * @returns { success, message, url?, expiresAt? }
 */
export const validateMagicUrlController = async (dpi: string) => {
	if (!dpi) {
		return { success: false, message: "DPI is required" };
	}

	// Buscar magic URL asociado al lead con ese DPI.
	// La comparación va normalizada: los links ya enviados llevan el DPI con el
	// formato que tenía el lead al generarlos, y el backfill del 0028 se lo quita.
	const [magicUrl] = await db
		.select()
		.from(magicUrls)
		.innerJoin(leads, eq(magicUrls.leadId, leads.id))
		.where(eqDpi(leads.dpi, dpi))
		.orderBy(desc(leads.createdAt)) // Ordenar por el más reciente primero
		.limit(1);
	if (!magicUrl) {
		return { success: false, message: "No magic URL found for this DPI" };
	}

	if (magicUrl.magic_urls.used) {
		return { success: false, message: "Magic URL already used" };
	}

	if (magicUrl.magic_urls.expiresAt < new Date()) {
		return { success: false, message: "Magic URL expired" };
	}

	return {
		success: true,
		message: "Magic URL is valid",
		url: magicUrl.magic_urls.url,
		expiresAt: magicUrl.magic_urls.expiresAt,
	};
};
/**
 * Check if a lead has already passed liveness validation by DPI.
 *
 * @param dpi - The lead's DPI to search for.
 * @returns true if liveness_validated = true, otherwise false.
 */
export async function hasPassedLiveness(
	dpi: string,
	phoneNumber: string,
): Promise<{
	passed: boolean;
	otpResponse?: Awaited<ReturnType<typeof otpController.sendOTP>>;
}> {
	const result = await db
		.select({ livenessValidated: leads.livenessValidated })
		.from(leads)
		.where(and(eqDpi(leads.dpi, dpi), eq(leads.livenessValidated, true)))
		.limit(1);

	if (result.length === 0) {
		return { passed: false }; // No lead found with this DPI
	}

	if (!result[0].livenessValidated) {
		return { passed: false };
	}

	// 🔥 Si ya pasó liveness, generamos el OTP automáticamente
	const otpResponse = await otpController.sendOTP(dpi, phoneNumber);

	return {
		passed: true,
		otpResponse,
	};
}
/**
 * 📄 Controller: getOnlyRenapInfoController
 *
 * Fetches RENAP data by DPI, inserts or updates the `renap_info` table,
 * and returns the normalized RENAP data.
 *
 * ⚠️ This controller does NOT create or update leads.
 *
 * @param dpi - The citizen's DPI (unique identifier in RENAP).
 * @returns {Promise<{ success: boolean; message: string; data?: any; error?: any }>}
 * A standardized response object with success status, message, and optional data/error.
 */
export const getOnlyRenapInfoController = async (dpi: string) => {
	console.log(`[DEBUG] Starting RENAP-only process for DPI: ${dpi}`);

	try {
		// ========================================================
		// 1️⃣ Fetch data from RENAP API
		// ========================================================
		console.log(`[DEBUG] Requesting RENAP API data for DPI: ${dpi}`);
		const renapResponse = await getRenapData(dpi);

		if (!renapResponse.success || !renapResponse.data) {
			console.error(`[ERROR] RENAP API failed for DPI: ${dpi}`, renapResponse);
			return {
				success: false,
				message: renapResponse.message || "No RENAP data found.",
				error: renapResponse.error,
			};
		}

		const renapData = renapResponse.data;
		console.log(
			`[DEBUG] RENAP API response received for DPI: ${dpi}`,
			renapData,
		);

		// ========================================================
		// 2️⃣ Insert or Update record in renap_info
		// ========================================================
		console.log(`[DEBUG] Checking if DPI already exists in renap_info: ${dpi}`);
		const existingRenap = await db
			.select()
			.from(renapInfo)
			.where(eqDpi(renapInfo.dpi, dpi));

		if (existingRenap.length === 0) {
			// 🆕 Insert a new record if DPI not found
			console.log("[DEBUG] DPI not found in renap_info. Inserting new record.");
			await db.insert(renapInfo).values({
				dpi: renapData.dpi,
				firstName: renapData.firstName,
				secondName: renapData.secondName,
				thirdName: renapData.thirdName,
				firstLastName: renapData.firstLastName,
				secondLastName: renapData.secondLastName,
				marriedLastName: renapData.marriedLastName,
				picture: renapData.picture,
				birthDate: normalizeDate(renapData.birthDate),
				gender: renapData.gender,
				civilStatus: renapData.civil_status,
				nationality: renapData.nationality,
				bornedIn: renapData.borned_in,
				departmentBornedIn: renapData.department_borned_in,
				municipalityBornedIn: renapData.municipality_borned_in,
				deathDate: normalizeDate(renapData.deathDate),
				ocupation: renapData.ocupation,
				cedulaOrder: renapData.cedula_order,
				cedulaRegister: renapData.cedula_register,
				dpiExpiracyDate: normalizeDate(renapData.dpi_expiracy_date),
			});
		} else {
			// 🔁 Update existing record if DPI is found
			console.log("[DEBUG] DPI found in renap_info. Updating record.");
			await db
				.update(renapInfo)
				.set({
					firstName: renapData.firstName,
					secondName: renapData.secondName,
					thirdName: renapData.thirdName,
					firstLastName: renapData.firstLastName,
					secondLastName: renapData.secondLastName,
					marriedLastName: renapData.marriedLastName,
					picture: renapData.picture,
					birthDate: normalizeDate(renapData.birthDate),
					gender: renapData.gender,
					civilStatus: renapData.civil_status,
					nationality: renapData.nationality,
					bornedIn: renapData.borned_in,
					departmentBornedIn: renapData.department_borned_in,
					municipalityBornedIn: renapData.municipality_borned_in,
					deathDate: normalizeDate(renapData.deathDate),
					ocupation: renapData.ocupation,
					cedulaOrder: renapData.cedula_order,
					cedulaRegister: renapData.cedula_register,
					dpiExpiracyDate: normalizeDate(renapData.dpi_expiracy_date),
				})
				.where(eqDpi(renapInfo.dpi, dpi));
		}

		// ========================================================
		// 3️⃣ Return success response
		// ========================================================
		console.log(
			`[DEBUG] RENAP-only process completed successfully for DPI: ${dpi}`,
		);

		return {
			success: true,
			message:
				"RENAP data fetched and synchronized successfully (no lead created).",
			data: renapData,
		};
	} catch (error: any) {
		// ========================================================
		// ❌ Error handling and recovery
		// ========================================================
		console.error(
			`[ERROR] Unexpected error in RENAP-only controller for DPI: ${dpi}`,
			error,
		);

		return {
			success: false,
			message: "An unexpected error occurred while processing RENAP data.",
			error: error?.message || error,
		};
	}
};

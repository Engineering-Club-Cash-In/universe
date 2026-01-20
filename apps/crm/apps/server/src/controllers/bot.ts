// controllers/renapController.ts

import { and, asc, desc, eq } from "drizzle-orm";
import {
	leads,
	magicUrls,
	opportunities,
	opportunityDocuments,
	renapInfo,
	salesStages,
	user,
} from "@/db/schema";
import type { documentTypeEnum } from "@/db/schema/documents";
import { getRenapData } from "@/functions/getRenapInfo";
import { db } from "../db";
import { otpController } from "./otp";
import {
	generateUniqueFilename,
	uploadFileFromUrlToR2,
} from "@/lib/storage";

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
 * Generic function to add or replace documents to open opportunities by DPI
 *
 * @param dpi - The lead's DPI to find open opportunities
 * @param documents - Array of documents to add { type: DocumentType, url: string, filename?: string }
 * @param uploadedBy - User ID who uploads the documents
 * @returns Results of the operation
 */
export async function addDocumentsToOpenOpportunities(
	dpi: string,
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
		console.log(
			`[DEBUG] addDocumentsToOpenOpportunities for DPI: ${dpi}`,
		);

		// 1. Find lead by DPI
		const lead = await db
			.select()
			.from(leads)
			.where(eq(leads.dpi, dpi))
			.limit(1)
			.then((results) => results[0] || null);

		if (!lead) {
			return {
				success: false,
				message: `Lead not found with DPI: ${dpi}`,
			};
		}

		// 2. Find open opportunities for this lead
		const openOpportunities = await db
			.select()
			.from(opportunities)
			.where(
				and(
					eq(opportunities.leadId, lead.id),
					eq(opportunities.status, "open"),
				),
			);

		if (openOpportunities.length === 0) {
			return {
				success: false,
				message: `No open opportunities found for lead with DPI: ${dpi}`,
			};
		}

		console.log(
			`[DEBUG] Found ${openOpportunities.length} open opportunities for lead ${lead.id}`,
		);

		let totalDocumentsAdded = 0;

		// 3. For each open opportunity, add/replace documents
		for (const opportunity of openOpportunities) {
			for (const doc of documents) {
				if (!doc.url) continue;

				try {
					// Generate unique filename
					const originalName =
						doc.filename || `${doc.type}_${Date.now()}.pdf`;
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
			message: `Documents added/updated successfully`,
			opportunitiesUpdated: openOpportunities.length,
			documentsAdded: totalDocumentsAdded,
		};
	} catch (error: any) {
		console.error(`[ERROR] addDocumentsToOpenOpportunities failed:`, error);
		return {
			success: false,
			message: error?.message || "Failed to add documents to opportunities",
		};
	}
}

/**
 * Helper function to check if open opportunities have specific document types
 */
export async function checkDocumentsInOpenOpportunities(
	dpi: string,
	documentTypes: DocumentType[],
): Promise<{
	success: boolean;
	hasDocuments: Record<DocumentType, boolean>;
	message?: string;
}> {
	try {
		// Find lead by DPI
		const lead = await db
			.select()
			.from(leads)
			.where(eq(leads.dpi, dpi))
			.limit(1)
			.then((results) => results[0] || null);

		if (!lead) {
			return {
				success: false,
				hasDocuments: {} as Record<DocumentType, boolean>,
				message: `Lead not found with DPI: ${dpi}`,
			};
		}

		// Find open opportunities
		const openOpportunities = await db
			.select()
			.from(opportunities)
			.where(
				and(
					eq(opportunities.leadId, lead.id),
					eq(opportunities.status, "open"),
				),
			);

		if (openOpportunities.length === 0) {
			return {
				success: false,
				hasDocuments: {} as Record<DocumentType, boolean>,
				message: `No open opportunities found for lead with DPI: ${dpi}`,
			};
		}

		// Get all documents for the first open opportunity (most recent)
		const docs = await db
			.select()
			.from(opportunityDocuments)
			.where(eq(opportunityDocuments.opportunityId, openOpportunities[0].id));

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
		console.error(`[ERROR] checkDocumentsInOpenOpportunities failed:`, error);
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
 * @param dpi - The DPI (unique identifier for the person).
 * @returns An object with the RENAP data and the operation status.
 */
export const getRenapInfoController = async (dpi: string, phone: string) => {
	console.log(`[DEBUG] Starting RENAP process for DPI: ${dpi}`);

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
		.where(eq(renapInfo.dpi, dpi));

	if (existingRenap.length === 0) {
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
			.where(eq(renapInfo.dpi, dpi));
	}

	// ========================
	// 3. Insert or Update leads
	// ========================
	const salesUsers = await db.select().from(user).where(eq(user.role, "sales"));

	if (salesUsers.length === 0) {
		throw new Error("[ERROR] No hay usuarios con rol 'sales' disponibles.");
	}
	const randomUser = salesUsers[Math.floor(Math.random() * salesUsers.length)];
	const existingLead = await db
		.select()
		.from(leads)
		.where(and(eq(leads.dpi, dpi), eq(leads.status, "new")));

	const age = calculateAge(renapData.birthDate);
	console.log(`[DEBUG] Calculated age for DPI ${dpi}: ${age}`);

	let leadId: string;
	let assignedUserId: string;
	let createdByUserId: string;

	if (existingLead.length === 0) {
		console.log("[DEBUG] DPI not found in leads. Inserting new lead.");
		const newLead = await db
			.insert(leads)
			.values({
				firstName: renapData.firstName,
				lastName: renapData.firstLastName,
				dpi: renapData.dpi,
				maritalStatus: mapCivilStatusToEnum(renapData.civil_status),
				assignedTo: randomUser.id,
				age: age ?? undefined,
				source: "other",
				email: "",
				phone: phone,
				createdBy: randomUser.id,
				status: "new",
			})
			.returning({ id: leads.id });
		leadId = newLead[0].id;
		assignedUserId = randomUser.id;
		createdByUserId = randomUser.id;
	} else {
		console.log("[DEBUG] DPI found in leads. Updating existing lead.");
		await db
			.update(leads)
			.set({
				firstName: renapData.firstName,
				lastName: renapData.firstLastName,
				maritalStatus: mapCivilStatusToEnum(renapData.civil_status),
				assignedTo: existingLead[0].assignedTo,
				status: "new",
				age: age ?? existingLead[0].age,
				updatedAt: new Date(),
			})
			.where(eq(leads.dpi, dpi));
		leadId = existingLead[0].id;
		assignedUserId = existingLead[0].assignedTo;
		createdByUserId = existingLead[0].createdBy;
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
	// 5. 🔥 SIEMPRE crear nueva oportunidad
	// ========================
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
			source: "other", // Bot source
		})
		.returning();

	// ========================
	// 6. Response
	// ========================
	console.log(`[DEBUG] RENAP process completed successfully for DPI: ${dpi}`);

	return {
		success: true,
		message:
			"RENAP data processed, lead synced, and opportunity created successfully",
		data: renapData,
		leadId,
		opportunityId: newOpportunity.id,
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

	// 1. Buscar lead por DPI con status NEW
	const existingLead = await db
		.select()
		.from(leads)
		.where(and(eq(leads.dpi, dpi), eq(leads.status, "new")))
		.limit(1)
		.then((results) => results[0] || null);

	if (!existingLead) {
		console.error(`[ERROR] Lead not found with DPI: ${dpi} and status=new`);
		return {
			success: false,
			message: "Lead not found with the provided DPI and status 'new'",
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
			await addDocumentsToOpenOpportunities(dpi, documentsToAdd, uploadedBy);
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

		// 1. Find the lead by phone with status "new"
		const lead = await db
			.select()
			.from(leads)
			.where(and(eq(leads.phone, phone), eq(leads.status, "new")))
			.limit(1)
			.then((res) => res[0] || null);

		if (!lead) {
			console.error("[ERROR] Lead not found or not in status 'new'");
			return {
				success: false,
				message: "Lead not found with DPI or not in status 'new'",
			};
		}

		console.log(`[DEBUG] Found lead ${lead.id} with status "new"`);

		// 2. Get documents from open opportunities
		const documentCheck = await checkDocumentsInOpenOpportunities(lead.dpi!, [
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

	// Buscar magic URL asociado al lead con ese DPI
	const [magicUrl] = await db
		.select()
		.from(magicUrls)
		.innerJoin(leads, eq(magicUrls.leadId, leads.id))
		.where(eq(leads.dpi, dpi))
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
		.where(and(eq(leads.dpi, dpi), eq(leads.livenessValidated, true)))
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
			.where(eq(renapInfo.dpi, dpi));

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
				.where(eq(renapInfo.dpi, dpi));
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

// controllers/renapController.ts

import { and, asc, eq } from "drizzle-orm";
import {
	leads,
	legalDocuments,
	magicUrls,
	opportunities,
	renapInfo,
	salesStages,
	user,
} from "@/db/schema";
import { getRenapData } from "@/functions/getRenapInfo";
import { db } from "../db";

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

	let leadId: string;

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

	if (existingLead.length === 0) {
		console.log("[DEBUG] DPI not found in leads. Inserting new lead.");
		const newLead = await db
			.insert(leads)
			.values({
				firstName: renapData.firstName,
				lastName: renapData.firstLastName,
				dpi: renapData.dpi,
				maritalStatus: mapCivilStatusToEnum(renapData.civil_status),
				assignedTo: randomUser.id, // Assign to random sales user
				age: age ?? undefined, // Insert calculated age
				source: "other", // Valid enum value for your schema
				email: "", // Placeholder (required field in schema)
				phone: phone, // Provided externally
				createdBy: randomUser.id, // Assign creator as the same sales user
				status: "new", // Default status
			})
			.returning({ id: leads.id });
		// Note: You might want to capture the inserted lead's ID if needed later
		leadId = newLead[0].id;
	} else {
		console.log("[DEBUG] DPI found in leads. Updating existing lead.");
		await db
			.update(leads)
			.set({
				firstName: renapData.firstName,
				lastName: renapData.firstLastName,
				maritalStatus: mapCivilStatusToEnum(renapData.civil_status),
				assignedTo: existingLead[0].assignedTo,
				status: "new", // Reset status to 'new' on RENAP update
				age: age ?? existingLead[0].age, // Update age if valid
				updatedAt: new Date(),
			})
			.where(eq(leads.dpi, dpi));
		leadId = existingLead[0].id;
	}

	// ========================
	// 4. Response
	// ========================
	console.log(`[DEBUG] RENAP process completed successfully for DPI: ${dpi}`);

	return {
		success: true,
		message: "RENAP data processed and synced successfully",
		data: renapData,
		leadId,
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
 * - Si se envía algún documento legal, lo inserta en la tabla legal_documents.
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
	const normalizedLoanPurpose = data.loanPurpose
		? (loanPurposeMap[data.loanPurpose.toUpperCase()] ?? null)
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
	if (normalizedLoanPurpose !== null)
		leadUpdates.loanPurpose = normalizedLoanPurpose;
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

	const magicUrlValue = `${MAGIC_URL_BASE}${existingLead.dpi}`;

	let opportunityId: string | null = null;

	// 3. Insertar documentos legales si hay alguno
	if (
		data.electricityBill ||
		data.bankStatements2 ||
		data.bankStatements3 ||
		data.bankStatements
	) {
		console.log(
			`[DEBUG] Inserting legal documents for lead ${existingLead.id}`,
		);

		const existingDoc = await db
			.select()
			.from(legalDocuments)
			.where(eq(legalDocuments.leadId, existingLead.id))
			.limit(1)
			.then((results) => results[0] || null);

		if (existingDoc) {
			// 🔄 Update si ya existe
			await db
				.update(legalDocuments)
				.set({
					electricityBill: data.electricityBill ?? existingDoc.electricityBill,
					bankStatements: data.bankStatements ?? existingDoc.bankStatements,
					bankStatements2: data.bankStatements2 ?? existingDoc.bankStatements2,
					bankStatements3: data.bankStatements3 ?? existingDoc.bankStatements3,
					createdAt: new Date(),
				})
				.where(eq(legalDocuments.leadId, existingLead.id));
		} else {
			// 🆕 Insert si no existe
			await db.insert(legalDocuments).values({
				leadId: existingLead.id,
				electricityBill: data.electricityBill ?? null,
				bankStatements: data.bankStatements ?? null,
				bankStatements2: data.bankStatements2 ?? null,
				bankStatements3: data.bankStatements3 ?? null,
				createdAt: new Date(),
			});
		}

		// 4. Crear oportunidad vinculada al lead
		const [firstStage] = await db
			.select()
			.from(salesStages)
			.orderBy(asc(salesStages.order))
			.limit(1);

		if (!firstStage) {
			throw new Error("[ERROR] No sales stage found");
		}

		console.log(`[DEBUG] Creating opportunity for lead ${existingLead.id}`);

		// Verificar si ya existe una oportunidad abierta
		const [existingOpportunity] = await db
			.select()
			.from(opportunities)
			.where(
				and(
					eq(opportunities.leadId, existingLead.id),
					eq(opportunities.status, "open"),
				),
			)
			.limit(1);

		if (existingOpportunity) {
			console.log(
				`[DEBUG] Updating existing opportunity ${existingOpportunity.id} for lead ${existingLead.id}`,
			);

			await db
				.update(opportunities)
				.set({
					updatedAt: new Date(),
					assignedTo: existingLead.assignedTo,
					title: `Loan opportunity for ${existingLead.firstName} ${existingLead.lastName}`,
					status: "open",
				})
				.where(eq(opportunities.id, existingOpportunity.id));

			opportunityId = existingOpportunity.id;
		} else {
			console.log(
				`[DEBUG] Creating new opportunity for lead ${existingLead.id}`,
			);

			const [newOpportunity] = await db
				.insert(opportunities)
				.values({
					leadId: existingLead.id,
					status: "open",
					probability: 0,
					createdAt: new Date(),
					updatedAt: new Date(),
					assignedTo: existingLead.assignedTo,
					createdBy: existingLead.createdBy,
					title: `Loan opportunity for ${existingLead.firstName} ${existingLead.lastName}`,
					stageId: firstStage.id,
				})
				.returning();

			opportunityId = newOpportunity.id;
		}

		// 🔹 Crear o actualizar magic_url para este lead
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
					expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 días
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
	}

	console.log(
		`[DEBUG] Lead updated and opportunity created successfully for DPI: ${dpi}`,
	);

	return {
		success: true,
		message:
			"Lead updated, legal docs saved (if provided), and opportunity created successfully",
		leadId: existingLead.id,
		opportunityId, // ✅ siempre retorna el id de la oportunidad
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

		// 2. Get legal documents (if any)
		const docs = await db
			.select()
			.from(legalDocuments)
			.where(eq(legalDocuments.leadId, lead.id))
			.limit(1)
			.then((res) => res[0] || null);

		const steps: string[] = [];
		console.log("lead", lead);
		// Revisar cada condición y agregar los pasos que falten
		if (!lead.dependents || lead.dependents === 0) steps.push("dependents");
		if (!lead.monthlyIncome) steps.push("monthlyIncome");
		if (!lead.loanAmount) steps.push("loanAmount");
		if (!lead.occupation) steps.push("occupation");
		if (!lead.workTime) steps.push("workTime");
		if (!lead.loanPurpose) steps.push("loanPurpose");
		if (!docs || !docs.electricityBill) steps.push("electricityBill");
		if (!docs || !docs.bankStatements) steps.push("bankStatements");

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
export async function hasPassedLiveness(dpi: string): Promise<boolean> {
	const result = await db
		.select({ livenessValidated: leads.livenessValidated })
		.from(leads)
		.where(eq(leads.dpi, dpi))
		.limit(1);

	if (result.length === 0) {
		return false; // No lead found with this DPI
	}

	return result[0].livenessValidated;
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

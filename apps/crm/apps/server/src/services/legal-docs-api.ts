/**
 * Servicio para consumir la API de documentos legales
 * https://api.devteamatcci.site/
 */

// URL de la API de documentos legales (tipos y campos por DPI)
const LEGAL_API_URL =
	process.env.LEGAL_API_URL || "https://api.devteamatcci.site";

// URL de la API de generación de contratos (legal-docs-blueprints)
const LEGAL_DOCS_API_URL =
	process.env.LEGAL_DOCS_API_URL || "https://legal-docs-blueprints.s4.devteamatcci.site";

// ============ TIPOS ============

export interface DocumentType {
	enum: string;
	label: string;
}

export interface DocumentsResponse {
	success: boolean;
	total: number;
	data: DocumentType[];
}

export interface RenapData {
	dpi: string;
	firstName: string;
	secondName: string;
	thirdName: string;
	firstLastName: string;
	secondLastName: string;
	marriedLastName: string;
	picture: string;
	birthDate: string;
	gender: string;
	civil_status: string;
	nationality: string;
	borned_in: string;
	department_borned_in: string;
	municipality_borned_in: string;
	deathDate: string;
	ocupation: string;
	cedula_order: string;
	cedula_register: string;
	dpi_expiracy_date: string;
}

export interface Document {
	id: number;
	nombre_documento: string;
	descripcion: string;
	genero: string;
	serialid: string;
	url_insercion: string;
	large_spacing: boolean;
	count_doble_line: number;
}

export interface Field {
	name: string;
	key: string;
	regex: string;
	required: boolean;
	iddocuments: number[];
	relation: string;
	description: string | null;
	default: string | null;
	is_double_line: boolean;
}

export interface DocumentByDpiResponse {
	success: boolean;
	message: string;
	renapData: RenapData;
	documents: Document[];
	campos: Field[];
}

export interface GenerateContractPayload {
	contractType: string;
	data: Record<string, string>;
	emails?: string[];
	options: {
		gender: "male" | "female";
		generatePdf: boolean;
		filenamePrefix: string;
	};
}

export interface BatchGeneratePayload {
	contracts: GenerateContractPayload[];
}

export interface DocumentResult {
	templateId: number;
	success: boolean;
	nameDocument: DocumentType[];
	data: unknown[];
	linkDocument: string;
	signing_links?: string[];
}

export interface BatchGenerateResponse {
	success: boolean;
	message?: string;
	results?: DocumentResult[];
}

// ============ SERVICIOS ============

/**
 * Obtiene los tipos de documentos disponibles desde la API
 */
export async function getDocumentTypes(): Promise<DocumentsResponse> {
	const response = await fetch(`${LEGAL_API_URL}/docuSeal/documents`, {
		method: "GET",
		headers: {
			"Content-Type": "application/json",
		},
	});

	if (!response.ok) {
		throw new Error(
			`Error al obtener tipos de documentos: ${response.status} ${response.statusText}`,
		);
	}

	return response.json();
}

/**
 * Obtiene documentos y campos filtrados por DPI y tipos de documento
 */
export async function getDocumentsByDpi(
	dpi: string,
	documentNames: string[],
): Promise<DocumentByDpiResponse> {
	const response = await fetch(`${LEGAL_API_URL}/docuSeal/document-by-dpi`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ dpi, documentNames }),
	});

	if (!response.ok) {
		throw new Error(
			`Error al obtener documentos por DPI: ${response.status} ${response.statusText}`,
		);
	}

	return response.json();
}

/**
 * Genera múltiples contratos en batch
 */
export async function generateContractsBatch(
	payload: BatchGeneratePayload,
): Promise<BatchGenerateResponse> {
	const response = await fetch(`${LEGAL_DOCS_API_URL}/contracts/batch`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${process.env.LEGAL_DOCS_API_KEY || ""}`,
		},
		body: JSON.stringify(payload),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Error al generar contratos: ${response.status} - ${errorText}`);
	}

	return response.json();
}

/**
 * Genera un contrato individual
 */
export async function generateContract(
	contractType: string,
	data: Record<string, unknown>,
	options?: {
		emails?: string[];
		gender?: "male" | "female";
	},
): Promise<DocumentResult> {
	const payload = {
		...data,
		emails: options?.emails,
		gender: options?.gender || "male",
	};

	const response = await fetch(
		`${LEGAL_DOCS_API_URL}/contracts/${contractType}`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${process.env.LEGAL_DOCS_API_KEY || ""}`,
			},
			body: JSON.stringify(payload),
		},
	);

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(
			`Error al generar contrato ${contractType}: ${response.status} - ${errorText}`,
		);
	}

	return response.json();
}

// ============ UTILIDADES ============

/**
 * Mapea el género del formato de RENAP al formato del API
 */
export function mapGenderFromRenap(
	renapGender: string,
): "male" | "female" {
	return renapGender === "F" ? "female" : "male";
}

/**
 * Mapea el estado civil del formato de RENAP al formato del API
 */
export function mapCivilStatusFromRenap(status: string): string {
	const statusMap: Record<string, string> = {
		S: "single",
		C: "married",
		D: "divorced",
		V: "widowed",
		U: "married", // Unido se considera como casado para efectos legales
	};
	return statusMap[status] || "single";
}

/**
 * Formatea un nombre completo desde los datos de RENAP
 */
export function formatFullNameFromRenap(renapData: RenapData): string {
	const parts = [
		renapData.firstName,
		renapData.secondName,
		renapData.thirdName,
		renapData.firstLastName,
		renapData.secondLastName,
	].filter((part) => part && part.trim() !== "");

	return parts.join(" ");
}

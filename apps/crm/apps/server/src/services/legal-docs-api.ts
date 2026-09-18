/**
 * Servicio para consumir la API de documentos legales
 * https://api.devteamatcci.site/
 */

// URL de la API de documentos legales (tipos y campos por DPI)
const LEGAL_API_URL =
	process.env.LEGAL_API_URL || "https://api.devteamatcci.site";

// URL de la API de generación de contratos (legal-docs-blueprints)
const LEGAL_DOCS_API_URL =
	process.env.LEGAL_DOCS_API_URL ||
	"https://legal-docs-blueprints.s4.devteamatcci.site";

import type { SignatureMode } from "../lib/contract-signature-mode";

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
	/** null cuando RENAP no tiene a la persona: se usan los datos del CRM */
	renapData: RenapData | null;
	documents: Document[];
	campos: Field[];
	renapUnavailable?: boolean;
	renapError?: string | null;
}

// Datos de deudor adicional para contratos con múltiples deudores
export interface DeudorAdicional {
	nombreCompleto: string;
	dpi: string;
	dpiTexto: string;
	edadTexto?: string;
	estadoCivil?: string;
	profesion?: string;
	nacionalidad?: string;
}

/**
 * Rol de un firmante. Define en qué línea de firma del documento cae cada
 * persona: el generador conoce el layout de cada template y reparte por rol,
 * porque el orden no es el mismo en todos (en la garantía mobiliaria y el
 * reconocimiento de deuda el representante legal firma primero).
 */
export type SignerRole = "TITULAR" | "COFIRMANTE" | "REP_LEGAL" | "VENDEDOR";

export interface ContractSigner {
	role: SignerRole;
	email: string;
	/** Nombre real de la persona, tal como debe verse en el documento. */
	name: string;
	dpi?: string;
	phone?: string;
}

export interface GenerateContractPayload {
	contractType: string;
	data: Record<string, unknown> & {
		deudoresAdicionales?: DeudorAdicional[];
	};
	/** Firmantes con su rol. Es la forma preferida sobre `emails`. */
	signers?: ContractSigner[];
	/**
	 * Emails en orden posicional.
	 * @deprecated Usar `signers`: una lista plana se reparte por índice y con
	 * cofirmantes termina cruzando los links.
	 */
	emails?: string[];
	/** Reciben copia del flujo de firma sin firmar. */
	observers?: string[];
	options: {
		gender: "male" | "female";
		generatePdf: boolean;
		isPlural?: boolean;
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
	r2Key?: string;
	signing_links?: string[];
	/**
	 * Cómo se firma el documento. Los `fisica` (hoy sólo la declaración de
	 * vendedor) vuelven sin `signing_links` a propósito: se firman en papel.
	 */
	signatureMode?: SignatureMode;
	/** Proveedor de firma usado ("weetrust" | "documenso"). */
	signingProvider?: string;
	/**
	 * ID del documento en WeeTrust. Sin esto no se puede consultar el estado de
	 * firma ni reintentarle a un firmante sin regenerar todo.
	 */
	documentID?: string;
	/**
	 * Quiénes quedaron efectivamente enviados a firmar, con su rol y su link.
	 * Es lo que reemplaza al reparto por posición de `signing_links`.
	 */
	signatories?: Array<{
		role: SignerRole;
		email: string;
		name: string;
		signatoryID?: string;
		signingUrl?: string;
	}>;
	error?: string;
}

/**
 * Motivo por el que un resultado del generador no sirve, o null si está bien.
 *
 * No alcanza con mirar `success`: si la conversión a PDF se cae, el contrato puede
 * volver marcado como exitoso pero sin `r2Key` ni `linkDocument`, y entonces se
 * enlaza a la oportunidad un documento que no se puede abrir ni firmar. Se trata
 * como fallido para que jurídico lo vea y lo reintente en el momento.
 */
export function motivoDeFalla(result: DocumentResult): string | null {
	if (!result.success) {
		return result.error || "Error al generar el documento";
	}
	if (!result.r2Key && !result.linkDocument) {
		return "El documento se generó pero no quedó el PDF (falló la conversión). Reintenta este documento.";
	}
	// Un contrato electrónico sin links no está listo, por más que el PDF exista:
	// nadie lo puede firmar. Volvía marcado como éxito y jurídico se enteraba
	// recién al buscar el link que no estaba.
	if (
		result.signatureMode === "electronica" &&
		(!result.signing_links || result.signing_links.length === 0)
	) {
		return "El contrato se generó pero no salió a firma: no quedó ningún enlace. Revisa que el cliente y los cofirmantes tengan correo registrado.";
	}
	return null;
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
	genero?: "hombre" | "mujer",
): Promise<DocumentByDpiResponse> {
	const response = await fetch(`${LEGAL_API_URL}/docuSeal/document-by-dpi`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ dpi, documentNames, ...(genero ? { genero } : {}) }),
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
		throw new Error(
			`Error al generar contratos: ${response.status} - ${errorText}`,
		);
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
export function mapGenderFromRenap(renapGender: string): "male" | "female" {
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

// ============ ESTADO Y REINTENTOS DE FIRMA ============

export interface EstadoFirmante {
	emailID: string;
	name: string;
	signatoryID: string;
	isSigned: boolean;
	signingUrl: string | null;
	/** Epoch en milisegundos, o null si el link no vence. */
	expiry: number | null;
}

export interface EstadoDocumentoFirma {
	success: boolean;
	documentID: string;
	status: "DRAFT" | "PENDING" | "COMPLETED" | string;
	signatories: EstadoFirmante[];
	error?: string;
}

async function pedirAlGenerador<T>(
	ruta: string,
	method: "GET" | "PUT",
	queHace: string,
): Promise<T> {
	const response = await fetch(`${LEGAL_DOCS_API_URL}${ruta}`, {
		method,
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${process.env.LEGAL_DOCS_API_KEY || ""}`,
		},
	});

	const cuerpo = await response.text();
	if (!response.ok) {
		// El generador devuelve el mensaje de WeeTrust en el cuerpo; perderlo deja
		// a jurídico con un "falló" sin nada que hacer al respecto.
		throw new Error(`${queHace}: ${response.status} - ${cuerpo}`);
	}

	return JSON.parse(cuerpo) as T;
}

/**
 * Estado de firma de un documento, firmante por firmante.
 *
 * Se consulta a demanda contra WeeTrust en vez de esperar un webhook: hoy no
 * hay webhooks registrados, así que el estado guardado nunca se movía solo.
 */
export async function consultarEstadoFirma(
	documentID: string,
): Promise<EstadoDocumentoFirma> {
	return pedirAlGenerador<EstadoDocumentoFirma>(
		`/contracts/signing-status/${encodeURIComponent(documentID)}`,
		"GET",
		"No se pudo consultar el estado de firma",
	);
}

/**
 * Regenera los enlaces de firma de un documento.
 *
 * Sirve para los dos casos que pasan seguido: el link venció, o la persona
 * necesita volver a entrar porque falló la verificación. Los que ya firmaron no
 * se tocan.
 */
export async function regenerarEnlacesDeFirma(
	documentID: string,
): Promise<EstadoDocumentoFirma> {
	return pedirAlGenerador<EstadoDocumentoFirma>(
		`/contracts/refresh-signing-links/${encodeURIComponent(documentID)}`,
		"PUT",
		"No se pudieron regenerar los enlaces de firma",
	);
}

/** Reenvía el correo de invitación a los firmantes pendientes. */
export async function reenviarCorreoDeFirma(
	documentID: string,
): Promise<{ success: boolean; documentID: string }> {
	return pedirAlGenerador<{ success: boolean; documentID: string }>(
		`/contracts/resend-email/${encodeURIComponent(documentID)}`,
		"PUT",
		"No se pudo reenviar el correo de firma",
	);
}

/**
 * WeeTrust Service - Servicio de firma electrónica
 *
 * Documentación API: https://documenter.getpostman.com/view/31038543/2sA2xb5vNY
 *
 * Entornos:
 * - Sandbox: https://api-sandbox.weetrust.com.mx
 * - Producción: https://api.weetrust.mx
 */

import axios, { type AxiosInstance } from "axios";
import * as fs from "node:fs";
import * as path from "node:path";
import FormData from "form-data";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import {
	ContractType,
	SignerRole,
	type ContractSigner,
	type IdentificationMode,
} from "../types/contract";
import {
	SignatureLayoutError,
	getRubrica,
	getSignaturePattern,
	firmantesEnOrdenDeFirma,
	resolveSignerOrder,
} from "./signaturePatterns";

/**
 * País bajo el que se emiten los documentos. WeeTrust lo toma como header al
 * subir el PDF y, si falta, asume México.
 */
export const WEETRUST_COUNTRY = process.env.WEETRUST_COUNTRY || "Guatemala";

/**
 * Verificación de identidad por defecto para los firmantes: validación del
 * documento de identidad (DPI).
 */
export const WEETRUST_DEFAULT_IDENTIFICATION: IdentificationMode =
	(process.env.WEETRUST_IDENTIFICATION as IdentificationMode) || "id";

/**
 * Observadores fijos: reciben copia del flujo de firma pero no firman.
 * Se configuran por entorno para poder cambiarlos sin tocar código.
 */
export const WEETRUST_OBSERVERS: string[] = (process.env.WEETRUST_OBSERVERS || "")
	.split(",")
	.map((e) => e.trim())
	.filter(Boolean);

// ============================================================================
// INTERFACES
// ============================================================================

export interface WeeTrustConfig {
	apiUrl: string;
	userId: string;
	apiKey: string;
}

export interface WeeTrustAuthResponse {
	responseData: {
		accessToken: string;
	};
	message: string;
	success: boolean;
	responseCode: number;
}

export interface WeeTrustSignatory {
	emailID: string;
	name?: string;
	customerId?: string;
	identification?: "id" | "face" | "ocr" | "face_login";
	check?: boolean;
	order?: number;
	phone?: string;
	signatureType?: "ELECTRONIC_SIGNATURE" | "E_FIRMA";
}

export interface WeeTrustSignaturePosition {
	user: {
		email: string;
	};
	coordinates: {
		x: number;
		y: number;
	};
	page: number;
	pageY: number;
	pageYv2: number;
	color?: string;
	imageSize: {
		width: number;
		height: number;
	};
	parentImageSize: {
		width: number;
		height: number;
	};
	viewport: {
		width: number;
		height: number;
	};
}

export interface WeeTrustDocumentResponse {
	responseData: {
		documentID: string;
		documentType: string;
		status: "DRAFT" | "PENDING" | "COMPLETED";
		country: string;
		documentSignType: string;
		addedOn: number;
		documentFileObj: {
			url: string;
			size: string;
		};
		signatory: WeeTrustSignatoryResponse[];
		/** Observadores, con su propio link de sólo lectura al flujo de firma. */
		sharedWith: Array<{
			emailID: string;
			url?: string;
			sharedWithID?: string;
		}>;
		pscCertificate: string;
		blockchainCertificate: string;
	};
	message: string;
	success: boolean;
	responseCode: number;
}

export interface WeeTrustSignatoryResponse {
	emailID: string;
	name: string;
	isSigned: number;
	signatoryID: string;
	signing?: {
		url: string;
		expiry: number;
	};
	imageURL: string;
	emailTracking: unknown[];
}

export interface WeeTrustWebhookResponse {
	responseData: {
		webHookID: string;
		type: string;
		addedOn: number;
		webHookUrl: string;
		options: unknown[];
	};
	message: string;
	success: boolean;
	responseCode: number;
}

export type WeeTrustWebhookType =
	| "sendDocument"
	| "completedDocument"
	| "signDocument"
	| "pendingBiometric"
	| "failedBiometric";

// ============================================================================
// WEETRUST SERVICE
// ============================================================================

export class WeeTrustService {
	private config: WeeTrustConfig;
	private httpClient: AxiosInstance;
	private accessToken: string | null = null;
	private tokenExpiry: number = 0;

	constructor(config?: Partial<WeeTrustConfig>) {
		this.config = {
			apiUrl:
				config?.apiUrl ||
				process.env.WEETRUST_API_URL ||
				"https://api-sandbox.weetrust.com.mx",
			userId: config?.userId || process.env.WEETRUST_USER_ID || "",
			apiKey: config?.apiKey || process.env.WEETRUST_API_KEY || "",
		};

		if (!this.config.userId || !this.config.apiKey) {
			throw new Error(
				"WeeTrust: Missing required authentication credentials",
			);
		}

		this.httpClient = axios.create({
			baseURL: this.config.apiUrl,
			timeout: 30000,
		});

		// axios resume los errores HTTP como "Request failed with status code 400"
		// y se traga el cuerpo, que es donde WeeTrust explica qué campo rechazó.
		// Sin esto, un contrato que no se puede firmar no dice por qué.
		this.httpClient.interceptors.response.use(undefined, (error) => {
			const data = error?.response?.data;
			const detalle =
				typeof data === "string" ? data : data?.message ?? JSON.stringify(data);
			if (detalle) {
				error.message = `${error.message} — ${detalle}`;
			}
			return Promise.reject(error);
		});

		console.log(`[WeeTrust] Inicializado con API: ${this.config.apiUrl}`);
	}

	// ==========================================================================
	// AUTENTICACIÓN
	// ==========================================================================

	/**
	 * Obtiene un access token válido (5 minutos de vigencia)
	 * Reutiliza el token si aún es válido
	 */
	async getAccessToken(): Promise<string> {
		// Si el token aún es válido (con 30 segundos de margen), reutilizarlo
		if (this.accessToken && Date.now() < this.tokenExpiry - 30000) {
			return this.accessToken;
		}

		console.log("[WeeTrust] Obteniendo nuevo access token...");

		const response = await this.httpClient.post<WeeTrustAuthResponse>(
			"/access/token",
			{},
			{
				headers: {
					"user-id": this.config.userId,
					"api-key": this.config.apiKey,
				},
			},
		);

		if (!response.data.success) {
			throw new Error(
				`WeeTrust Auth Error: ${response.data.message}`,
			);
		}

		this.accessToken = response.data.responseData.accessToken;
		this.tokenExpiry = Date.now() + 5 * 60 * 1000; // 5 minutos

		console.log("[WeeTrust] Token obtenido exitosamente");
		return this.accessToken;
	}

	/**
	 * Obtiene los headers de autenticación
	 */
	private async getAuthHeaders(): Promise<Record<string, string>> {
		const token = await this.getAccessToken();
		return {
			"user-id": this.config.userId,
			token: token,
		};
	}

	// ==========================================================================
	// DOCUMENTOS
	// ==========================================================================

	/**
	 * Sube un documento PDF para firma
	 */
	async uploadDocument(
		pdfPath: string,
	): Promise<WeeTrustDocumentResponse["responseData"]> {
		console.log(`[WeeTrust] Subiendo documento: ${pdfPath}`);

		const headers = await this.getAuthHeaders();
		const formData = new FormData();

		// Leer el archivo y agregarlo al form
		const fileBuffer = fs.readFileSync(pdfPath);
		const fileName = path.basename(pdfPath);
		formData.append("document", fileBuffer, {
			filename: fileName,
			contentType: "application/pdf",
		});

		const response = await this.httpClient.post<WeeTrustDocumentResponse>(
			"/documents",
			formData,
			{
				headers: {
					...headers,
					...formData.getHeaders(),
				},
			},
		);

		if (!response.data.success) {
			throw new Error(
				`WeeTrust Upload Error: ${response.data.message}`,
			);
		}

		console.log(
			`[WeeTrust] Documento subido: ${response.data.responseData.documentID}`,
		);
		return response.data.responseData;
	}

	/**
	 * Sube un documento desde un Buffer
	 *
	 * `country` define el marco legal bajo el que WeeTrust emite el documento y
	 * viaja como header. Si no se manda, WeeTrust asume México — que es lo que
	 * veníamos haciendo sin querer en todos los contratos guatemaltecos. Ojo:
	 * la API no valida el valor, guarda tal cual lo que reciba.
	 */
	async uploadDocumentFromBuffer(
		pdfBuffer: Buffer,
		fileName: string,
		country: string = WEETRUST_COUNTRY,
	): Promise<WeeTrustDocumentResponse["responseData"]> {
		// Asegurar que el filename tenga extensión .pdf
		const pdfFileName = fileName.endsWith(".pdf") ? fileName : `${fileName}.pdf`;
		console.log(
			`[WeeTrust] Subiendo documento desde buffer: ${pdfFileName} (país: ${country})`,
		);

		const headers = await this.getAuthHeaders();
		const formData = new FormData();

		formData.append("document", pdfBuffer, {
			filename: pdfFileName,
			contentType: "application/pdf",
		});

		const response = await this.httpClient.post<WeeTrustDocumentResponse>(
			"/documents",
			formData,
			{
				headers: {
					...headers,
					country,
					...formData.getHeaders(),
				},
			},
		);

		if (!response.data.success) {
			throw new Error(
				`WeeTrust Upload Error: ${response.data.message}`,
			);
		}

		console.log(
			`[WeeTrust] Documento subido: ${response.data.responseData.documentID}`,
		);
		return response.data.responseData;
	}

	/**
	 * Fija las posiciones de firma en el documento
	 */
	async setSignaturePositions(
		documentID: string,
		positions: WeeTrustSignaturePosition[],
	): Promise<WeeTrustDocumentResponse["responseData"]> {
		console.log(
			`[WeeTrust] Fijando ${positions.length} posiciones de firma para documento ${documentID}`,
		);

		const headers = await this.getAuthHeaders();

		const response = await this.httpClient.put<WeeTrustDocumentResponse>(
			"/documents/fixed-signatory",
			{
				documentID,
				staticSignPositions: positions,
			},
			{
				headers: {
					...headers,
					"Content-Type": "application/json",
				},
			},
		);

		if (!response.data.success) {
			throw new Error(
				`WeeTrust Fixed Signatory Error: ${response.data.message}`,
			);
		}

		console.log("[WeeTrust] Posiciones de firma configuradas");
		return response.data.responseData;
	}

	/**
	 * Envía el documento a los firmantes
	 */
	async sendToSign(
		documentID: string,
		options: {
			title: string;
			message: string;
			signatory: WeeTrustSignatory[];
			hasOrder?: boolean;
			disableMailing?: boolean;
			/**
			 * Observadores: ven el flujo de firma sin firmar. Se reciben como
			 * correos y se mandan como objetos, que es lo único que acepta
			 * WeeTrust (una lista de strings devuelve "Some emails has invalid
			 * format or are empty").
			 */
			sharedWith?: string[];
		},
	): Promise<WeeTrustDocumentResponse["responseData"]> {
		console.log(
			`[WeeTrust] Enviando documento ${documentID} a ${options.signatory.length} firmante(s)` +
				(options.sharedWith?.length
					? ` y ${options.sharedWith.length} observador(es)`
					: ""),
		);

		const headers = await this.getAuthHeaders();

		const response = await this.httpClient.put<WeeTrustDocumentResponse>(
			"/documents/signatory",
			{
				documentID,
				title: options.title,
				message: options.message,
				signatory: options.signatory,
				hasOrder: options.hasOrder ?? false,
				disableMailing: options.disableMailing ?? false,
				...(options.sharedWith?.length
					? { sharedWith: options.sharedWith.map((emailID) => ({ emailID })) }
					: {}),
			},
			{
				headers: {
					...headers,
					"Content-Type": "application/json",
				},
			},
		);

		if (!response.data.success) {
			throw new Error(
				`WeeTrust Send to Sign Error: ${response.data.message}`,
			);
		}

		console.log(
			`[WeeTrust] Documento enviado. Status: ${response.data.responseData.status}`,
		);
		return response.data.responseData;
	}

	/**
	 * Obtiene la información de un documento
	 */
	async getDocument(
		documentID: string,
	): Promise<WeeTrustDocumentResponse["responseData"]> {
		const headers = await this.getAuthHeaders();

		const response = await this.httpClient.get<WeeTrustDocumentResponse>(
			`/documents/${documentID}`,
			{ headers },
		);

		if (!response.data.success) {
			throw new Error(
				`WeeTrust Get Document Error: ${response.data.message}`,
			);
		}

		return response.data.responseData;
	}

	/**
	 * Lista documentos con filtro de estado
	 */
	async listDocuments(
		status?: "DRAFT" | "PENDING" | "COMPLETED",
	): Promise<WeeTrustDocumentResponse["responseData"][]> {
		const headers = await this.getAuthHeaders();

		const url = status ? `/documents?status=${status}` : "/documents";
		const response = await this.httpClient.get(url, { headers });

		if (!response.data.success) {
			throw new Error(
				`WeeTrust List Documents Error: ${response.data.message}`,
			);
		}

		return response.data.responseData;
	}

	/**
	 * Elimina un documento
	 */
	async deleteDocument(documentID: string): Promise<void> {
		const headers = await this.getAuthHeaders();

		const response = await this.httpClient.delete(
			`/documents/?documentID=${documentID}`,
			{
				headers: {
					...headers,
					"Content-Type": "application/json",
				},
			},
		);

		if (!response.data.success) {
			throw new Error(
				`WeeTrust Delete Document Error: ${response.data.message}`,
			);
		}

		console.log(`[WeeTrust] Documento ${documentID} eliminado`);
	}

	// ==========================================================================
	// REINTENTOS
	// ==========================================================================

	/**
	 * Regenera los enlaces de firma de un documento.
	 *
	 * Es la salida cuando un link venció o cuando alguien necesita volver a
	 * entrar (por ejemplo, tecleó mal el DPI y quiere reintentar la
	 * verificación): WeeTrust emite URLs nuevas para los firmantes que todavía
	 * no firmaron. Los que ya firmaron no se tocan.
	 *
	 * `PUT /documents/update-signatures`, body `{ documentID }`.
	 */
	async refreshSignatureUrls(
		documentID: string,
	): Promise<WeeTrustSignatoryResponse[]> {
		console.log(`[WeeTrust] Regenerando enlaces de firma de ${documentID}`);

		const headers = await this.getAuthHeaders();

		const response = await this.httpClient.put<{
			responseData: WeeTrustSignatoryResponse[] | WeeTrustSignatoryResponse;
			message: string;
			success?: boolean;
			responseCode: number | string;
		}>(
			"/documents/update-signatures",
			{ documentID },
			{ headers: { ...headers, "Content-Type": "application/json" } },
		);

		if (response.data.success === false) {
			throw new Error(
				`WeeTrust Refresh Signatures Error: ${response.data.message}`,
			);
		}

		// La doc muestra un objeto, pero un documento tiene varios firmantes y la
		// API devuelve el arreglo. Se aceptan las dos formas.
		const data = response.data.responseData;
		const firmantes = Array.isArray(data) ? data : data ? [data] : [];

		console.log(
			`[WeeTrust] ${firmantes.length} enlace(s) regenerado(s) para ${documentID}`,
		);
		return firmantes;
	}

	/**
	 * Reenvía el correo de invitación a los firmantes que aún no firman.
	 *
	 * `PUT /documents/resend-email?documentID=...`, sin body.
	 */
	async resendEmailToSignatories(documentID: string): Promise<void> {
		console.log(`[WeeTrust] Reenviando correo del documento ${documentID}`);

		const headers = await this.getAuthHeaders();

		const response = await this.httpClient.put<{
			message: string;
			success?: boolean;
			responseCode: number | string;
		}>(
			`/documents/resend-email?documentID=${encodeURIComponent(documentID)}`,
			undefined,
			{ headers: { ...headers, "Content-Type": "application/json" } },
		);

		if (response.data.success === false) {
			throw new Error(
				`WeeTrust Resend Email Error: ${response.data.message}`,
			);
		}
	}

	/**
	 * Repite (o salta) la verificación facial de un intento fallido.
	 *
	 * OJO: necesita el `biometricLogID` del intento, que WeeTrust no expone en
	 * `GET /documents/{id}`: sólo llega en los webhooks `pendingBiometric` /
	 * `failedBiometric`. Sin webhooks registrados no hay de dónde sacarlo, y por
	 * eso el CRM no ofrece este botón todavía.
	 *
	 * `PUT /documents/retry-biometric`.
	 */
	async retryBiometric(
		documentID: string,
		biometricLogID: string,
		action: "biometricRetry" | "biometricSkipped" = "biometricRetry",
	): Promise<void> {
		console.log(
			`[WeeTrust] ${action} para el intento ${biometricLogID} del documento ${documentID}`,
		);

		const headers = await this.getAuthHeaders();

		const response = await this.httpClient.put<{
			message: string;
			success?: boolean;
			responseCode: number | string;
		}>(
			"/documents/retry-biometric",
			{ documentID, biometricLogID, action },
			{ headers: { ...headers, "Content-Type": "application/json" } },
		);

		if (response.data.success === false) {
			throw new Error(
				`WeeTrust Retry Biometric Error: ${response.data.message}`,
			);
		}
	}

	// ==========================================================================
	// WEBHOOKS
	// ==========================================================================

	/**
	 * Registra un webhook para eventos de documentos
	 */
	async addWebhook(
		url: string,
		type: WeeTrustWebhookType,
	): Promise<WeeTrustWebhookResponse["responseData"]> {
		console.log(`[WeeTrust] Registrando webhook ${type} → ${url}`);

		const headers = await this.getAuthHeaders();

		const response = await this.httpClient.post<WeeTrustWebhookResponse>(
			`/webhooks?url=${encodeURIComponent(url)}&type=${type}`,
			{ options: [] },
			{
				headers: {
					...headers,
					"Content-Type": "application/json",
				},
			},
		);

		if (!response.data.success) {
			throw new Error(
				`WeeTrust Add Webhook Error: ${response.data.message}`,
			);
		}

		console.log(
			`[WeeTrust] Webhook registrado: ${response.data.responseData.webHookID}`,
		);
		return response.data.responseData;
	}

	/**
	 * Lista los webhooks registrados
	 */
	async listWebhooks(): Promise<WeeTrustWebhookResponse["responseData"][]> {
		const headers = await this.getAuthHeaders();

		const response = await this.httpClient.get("/webhooks", { headers });

		if (!response.data.success) {
			throw new Error(
				`WeeTrust List Webhooks Error: ${response.data.message}`,
			);
		}

		return response.data.responseData;
	}

	/**
	 * Elimina un webhook
	 */
	async deleteWebhook(webHookID: string): Promise<void> {
		const headers = await this.getAuthHeaders();

		const response = await this.httpClient.delete(
			`/webhooks?webHookID=${webHookID}`,
			{
				headers: {
					...headers,
					"Content-Type": "application/json",
				},
			},
		);

		if (!response.data.success) {
			throw new Error(
				`WeeTrust Delete Webhook Error: ${response.data.message}`,
			);
		}

		console.log(`[WeeTrust] Webhook ${webHookID} eliminado`);
	}

	// ==========================================================================
	// FLUJO COMPLETO
	// ==========================================================================

	/**
	 * Flujo completo: sube documento, fija posiciones y envía a firma
	 * Similar a DocumensoService.createDocumentAndGetSigningLinks()
	 */
	async createDocumentAndGetSigningLinks(
		pdfBuffer: Buffer,
		fileName: string,
		options: {
			title: string;
			message: string;
			signatory: WeeTrustSignatory[];
			/**
			 * Firmantes ya ordenados según las líneas de firma del PDF. Cuando se
			 * pasa, el posicionamiento "auto" asigna cada widget a su dueño.
			 */
			signers?: ContractSigner[];
			/** false = reparto por orden de llegada, como antes de los roles. */
			repartoPorRol?: boolean;
			signaturePositions?: WeeTrustSignaturePosition[];
			hasOrder?: boolean;
			page?: number;
			contractType?: ContractType;
			sharedWith?: string[];
			/**
			 * Modo de posicionamiento de firma:
			 * - "auto": Detecta automáticamente las líneas de firma en el PDF (requiere contractType)
			 * - "fixed": Usa posiciones proporcionadas o genera por defecto
			 * - "free": El firmante elige dónde colocar su firma (más simple pero menos controlado)
			 */
			positioningMode?: "auto" | "fixed" | "free";
		},
	): Promise<{
		documentID: string;
		signingLinks: string[];
		signatoryIDs: string[];
		documentUrl: string;
		status: string;
	}> {
		const positioningMode = options.positioningMode ?? "fixed";

		// 1. Subir documento
		const uploadResult = await this.uploadDocumentFromBuffer(pdfBuffer, fileName);
		const documentID = uploadResult.documentID;

		// Si algo falla después de subirlo (el layout no calza, WeeTrust rechaza
		// el envío), el documento queda como borrador huérfano en la cuenta, uno
		// por cada reintento. Se borra antes de propagar el error.
		try {

			// 2. Manejar posiciones según el modo
			if (positioningMode === "free") {
				// Modo libre: el firmante elige dónde firmar
				console.log("[WeeTrust] Modo libre: el firmante elegirá dónde colocar su firma");
			} else {
				// Modos "auto" o "fixed": fijar posiciones
				let positions = options.signaturePositions;

				if (
					positioningMode === "auto" &&
					options.contractType &&
					options.repartoPorRol === false
				) {
					positions = await WeeTrustService.locateSignatureWidgetsLegacy(
						pdfBuffer,
						options.contractType,
						options.signatory.map((s) => s.emailID),
					);
				} else if (positioningMode === "auto" && options.contractType) {
					// Detectar las líneas de firma del PDF y repartirlas por rol
					positions = await WeeTrustService.locateSignatureWidgets(
						pdfBuffer,
						options.contractType,
						options.signers ??
							options.signatory.map((s) => ({
								role: SignerRole.TITULAR,
								email: s.emailID,
								name: s.name ?? s.emailID,
							})),
					);
				} else if (!positions || positions.length === 0) {
					// Generar posiciones por defecto
					const page = options.page ?? 1;
					const positionTypes: Array<"left" | "right" | "center"> = ["left", "right", "center", "left"];

					positions = options.signatory.map((signer, index) =>
						WeeTrustService.generateDefaultSignaturePosition(
							signer.emailID,
							page,
							positionTypes[index % positionTypes.length],
						)
					);
					console.log(`[WeeTrust] Generando ${positions.length} posiciones por defecto`);
				}

				await this.setSignaturePositions(documentID, positions);
			}

			// 3. Enviar a firma
			const signResult = await this.sendToSign(documentID, {
				title: options.title,
				message: options.message,
				signatory: options.signatory,
				hasOrder: options.hasOrder,
				sharedWith: options.sharedWith,
			});

			// 4. Extraer signing links respetando el orden en que mandamos los
			//    firmantes: WeeTrust devuelve su propio arreglo y los links se
			//    persisten por posición, así que reordenamos por email para no
			//    entregarle a cada quien el link de otro.
			const porEmail = new Map(
				signResult.signatory.map((s) => [s.emailID.toLowerCase(), s]),
			);
			const enOrden = options.signatory.map((s) =>
				porEmail.get(s.emailID.toLowerCase()),
			);

			const faltantes = options.signatory
				.filter((s) => !porEmail.has(s.emailID.toLowerCase()))
				.map((s) => s.emailID);
			if (faltantes.length > 0) {
				throw new Error(
					`WeeTrust no devolvió firmante para: ${faltantes.join(", ")}`,
				);
			}

			// Un firmante sin URL deja un contrato "exitoso" con un link vacío que
			// nadie puede usar. Se trata como envío incompleto.
			const sinUrl = options.signatory
				.filter((_, i) => !enOrden[i]?.signing?.url)
				.map((s) => s.emailID);
			if (sinUrl.length > 0) {
				throw new Error(
					`WeeTrust no devolvió enlace de firma para: ${sinUrl.join(", ")}`,
				);
			}

			return {
				documentID,
				signingLinks: enOrden.map((s) => s?.signing?.url ?? ""),
				signatoryIDs: enOrden.map((s) => s?.signatoryID ?? ""),
				documentUrl: signResult.documentFileObj.url,
				status: signResult.status,
			};
		} catch (error) {
			await this.deleteDocument(documentID).catch((e) =>
				console.warn(
					`[WeeTrust] No se pudo borrar el borrador ${documentID} tras el error:`,
					e,
				),
			);
			throw error;
		}
	}

	// ==========================================================================
	// ADAPTER: Interfaz compatible con Documenso
	// ==========================================================================

	/**
	 * Wrapper que usa la misma firma que DocumensoService.createDocumentAndGetSigningLinks
	 * para facilitar el reemplazo gradual.
	 *
	 * @param title - Nombre del documento
	 * @param pdfBuffer - Buffer del PDF
	 * @param contractType - Tipo de contrato (para auto-detección de firmas)
	 * @param signers - Firmantes con su rol, en cualquier orden
	 * @param observers - Correos que reciben copia del flujo sin firmar
	 * @returns { signs, linkDocument, documentID, signatories }
	 */
	async createDocumentForSigning(
		title: string,
		pdfBuffer: Buffer,
		contractType: ContractType,
		signers: ContractSigner[],
		observers: string[] = WEETRUST_OBSERVERS,
		/**
		 * `legado` es para quien sólo manda `emails`, sin rol (hoy la app
		 * legal-documents). Se comporta como antes de la firma por rol: los
		 * firmantes van en el orden en que llegaron, los widgets se reparten por
		 * orden de llegada y no se pide verificación de identidad. Sin esto, un
		 * contrato con línea de rep legal fallaba porque ese caller nunca lo manda.
		 */
		modo: "rol" | "legado" = "rol",
	): Promise<{
		signs: string[];
		linkDocument: string;
		documentID: string;
		/**
		 * Enlace de observador: muestra el documento y cómo va la firma sin dejar
		 * firmar. Es el único que se le puede pasar a alguien para que mire.
		 */
		observerUrl?: string;
		/** Un registro por firmante, en el mismo orden que `signs`. */
		signatories: Array<{
			role: SignerRole;
			email: string;
			name: string;
			signatoryID?: string;
			signingUrl?: string;
		}>;
	}> {
		console.log(`\n🔄 [WeeTrust] Iniciando flujo completo para: ${title}`);

		// Quiénes firman ESTE documento: no todo el roster aparece en todos los
		// contratos (la cobertura, por ejemplo, no lleva representante legal).
		// Mandar a alguien sin línea de firma asignada hace que WeeTrust rechace
		// el envío entero con "<email> undefined".
		const porEmail = new Map<string, ContractSigner>();
		const ordenados =
			modo === "rol" ? firmantesEnOrdenDeFirma(contractType, signers) : signers;
		for (const s of ordenados) {
			if (!porEmail.has(s.email)) porEmail.set(s.email, s);
		}

		const signatory: WeeTrustSignatory[] = [...porEmail.values()].map(
			(s, index) => ({
				emailID: s.email,
				name: nombreParaWeeTrust(s.name, index),
				...(modo === "rol" ? identificacionDe(s.role, contractType) : {}),
				...(s.phone ? { phone: s.phone } : {}),
			}),
		);

		const result = await this.createDocumentAndGetSigningLinks(pdfBuffer, title, {
			title,
			message: `Por favor firme el documento: ${title}`,
			signatory,
			signers,
			contractType,
			positioningMode: "auto",
			sharedWith: observers,
			repartoPorRol: modo === "rol",
		});

		console.log(`✓ [WeeTrust] ${result.signingLinks.length} link(s) de firma generados`);

		const signatories = [...porEmail.values()].map((s, i) => ({
			role: s.role,
			email: s.email,
			name: s.name,
			signatoryID: result.signatoryIDs[i],
			signingUrl: result.signingLinks[i],
		}));

		// Retornar en formato compatible con Documenso, más lo que hace falta
		// para consultar estado y reintentar después (documentID/signatoryID).
		// El link de observador sólo existe si se mandaron observadores. Se lee del
		// documento porque `sendToSign` no lo devuelve.
		let observerUrl: string | undefined;
		if (observers.length > 0) {
			try {
				const documento = await this.getDocument(result.documentID);
				observerUrl = documento.sharedWith?.find((o) => o.url)?.url;
			} catch (error) {
				// Que no se pueda leer el link de observador no invalida el documento,
				// que ya quedó creado y enviado a firmar.
				console.warn(
					"[WeeTrust] No se pudo leer el enlace de observador:",
					error,
				);
			}
		}

		return {
			signs: result.signingLinks,
			linkDocument: result.documentUrl,
			documentID: result.documentID,
			observerUrl,
			signatories,
		};
	}

	// ==========================================================================
	// UTILIDADES
	// ==========================================================================

	/**
	 * Verifica la conectividad con WeeTrust
	 */
	async checkHealth(): Promise<boolean> {
		try {
			await this.getAccessToken();
			return true;
		} catch (error) {
			console.error("[WeeTrust] Health check failed:", error);
			return false;
		}
	}

	/**
	 * Genera posiciones de firma por defecto para un documento
	 * Basado en las coordenadas típicas de un PDF Letter/A4
	 */
	static generateDefaultSignaturePosition(
		email: string,
		page: number,
		position: "left" | "right" | "center" = "center",
	): WeeTrustSignaturePosition {
		const xPositions = {
			left: 100,
			center: 250,
			right: 400,
		};

		return {
			user: { email },
			coordinates: {
				x: xPositions[position],
				y: 650,
			},
			page,
			pageY: 650,
			pageYv2: 650,
			color: "#FFD247",
			imageSize: {
				width: 100,
				height: 50,
			},
			parentImageSize: {
				width: 612,
				height: 792,
			},
			viewport: {
				width: 612,
				height: 792,
			},
		};
	}

	/**
	 * Ubica TODAS las líneas de firma del PDF y le asigna a cada una su firmante.
	 *
	 * El número de líneas no se puede sacar de la configuración: los templates
	 * plural generan la fila de deudores con un loop, así que un mismo contrato
	 * rinde 2, 3 o más widgets según cuántos cofirmantes haya. Por eso se leen
	 * todas y se contrastan contra el layout declarado del template.
	 *
	 * Si la cuenta no calza, se lanza `SignatureLayoutError` en lugar de recortar
	 * o de inventar coordenadas: una firma puesta en el lugar equivocado produce
	 * un contrato inválido que nadie nota hasta que es tarde.
	 */
	static async locateSignatureWidgets(
		pdfBuffer: Buffer,
		contractType: ContractType,
		signers: ContractSigner[],
	): Promise<WeeTrustSignaturePosition[]> {
		const config = getSignaturePattern(contractType);
		const { pattern } = config;

		// Los contratos que todavía no fueron auditados (inversiones, cartas
		// poder) siguen por el camino de siempre: reparto por orden de llegada.
		// Sólo los de venta tienen su layout verificado contra el PDF.
		if (!config.bloques || config.bloques.length === 0) {
			return WeeTrustService.locateSignatureWidgetsLegacy(
				pdfBuffer,
				contractType,
				signers.map((s) => s.email),
			);
		}

		const esperados = resolveSignerOrder(contractType, signers);

		console.log(
			`[WeeTrust] ${contractType}: se esperan ${esperados.length} firma(s) -> ` +
				esperados.map((s) => s.role).join(", "),
		);

		const lineas = await WeeTrustService.readSignatureLines(pdfBuffer, pattern);

		if (lineas.length !== esperados.length) {
			throw new SignatureLayoutError(
				`El contrato "${contractType}" tiene ${lineas.length} línea(s) de firma en el PDF ` +
					`pero se esperaban ${esperados.length} (${esperados.map((s) => s.role).join(", ")}). ` +
					`Revisar el layout declarado en signaturePatterns.ts con scripts/inventario-firmas.ts.`,
			);
		}

		// Donde el template imprime el DPI debajo de la línea, lo usamos para
		// confirmar que el widget le tocó a quien corresponde. No todos los
		// templates lo imprimen, así que es una verificación oportunista.
		lineas.forEach((linea, i) => {
			const esperado = esperados[i];
			const dpiEsperado = soloDigitos(esperado.dpi);
			if (!dpiEsperado) return;

			const dpisEnPdf = linea.debajo
				.flatMap((t) => t.match(/\d[\d\s-]{10,}/g) ?? [])
				.map(soloDigitos)
				.filter(Boolean);
			if (dpisEnPdf.length === 0) return;

			if (!dpisEnPdf.includes(dpiEsperado)) {
				throw new SignatureLayoutError(
					`En "${contractType}", la firma ${i + 1} corresponde al DPI ${dpisEnPdf.join("/")} ` +
						`según el documento, pero se le iba a asignar a ${esperado.name} (DPI ${dpiEsperado}). ` +
						`El orden declarado del template no calza con el PDF.`,
				);
			}
		});

		const SIGNATURE_HEIGHT = 50;
		const posiciones: WeeTrustSignaturePosition[] = lineas.map((linea, i) => {
			// WeeTrust mide Y desde arriba y el PDF desde abajo. Restamos la altura
			// de la firma para que quede SOBRE la línea y no a partir de ella.
			const x = linea.pdfX;
			const y = linea.pageHeight - linea.pdfY - SIGNATURE_HEIGHT;

			console.log(
				`[WeeTrust]   firma ${i + 1}: ${esperados[i].role} -> pág. ${linea.pageNum} (${x.toFixed(0)}, ${y.toFixed(0)})`,
			);

			return {
				user: { email: esperados[i].email },
				coordinates: { x, y },
				page: linea.pageNum,
				pageY: y,
				pageYv2: y,
				color: "#FFD247",
				imageSize: { width: 100, height: 50 },
				parentImageSize: { width: linea.pageWidth, height: linea.pageHeight },
				viewport: { width: linea.pageWidth, height: linea.pageHeight },
			};
		});

		// Las rúbricas van DESPUÉS del conteo de líneas: son widgets que se
		// agregan, no líneas que haya que encontrar en el PDF, así que no pueden
		// desbalancear la verificación de arriba.
		posiciones.push(
			...(await WeeTrustService.rubricasDePaginasImpares(
				pdfBuffer,
				contractType,
				esperados,
				posiciones,
			)),
		);

		return posiciones;
	}

	/**
	 * Una rúbrica de cada firmante en cada página impar.
	 *
	 * Gerencia lo pidió para los contratos: que ninguna hoja pueda cambiarse sin
	 * que se note. Las cartas no llevan (no declaran `rubrica`), que es lo
	 * correcto para un documento de una hoja cuyo final ya va firmado.
	 *
	 * Tres cosas que decide esta función:
	 *
	 * - **Quiénes.** Los mismos que firman el documento, una vez cada uno. Si el
	 *   bloque de deudores se expande a titular + dos codeudores, las tres
	 *   personas rubrican cada hoja impar.
	 * - **Dónde.** En fila, repartidas a lo ancho de la franja que declara el
	 *   tipo (el aire de abajo de la hoja, entre el pie y el texto). Cada
	 *   firmante tiene su parte del ancho y su rúbrica va centrada en ella: con
	 *   pocos firmantes quedan grandes y separadas, y con muchos se achican
	 *   hasta un mínimo legible; de ahí en más pasan a otra fila.
	 * - **Cuándo no.** Si en esa página ya hay un widget de esa persona donde
	 *   caería, no se agrega: quedaría la rúbrica encima de la firma real.
	 */
	private static async rubricasDePaginasImpares(
		pdfBuffer: Buffer,
		contractType: ContractType,
		firmantes: ContractSigner[],
		yaPuestas: WeeTrustSignaturePosition[],
	): Promise<WeeTrustSignaturePosition[]> {
		const rubrica = getRubrica(contractType);
		if (!rubrica) return [];

		// Una vez cada uno: el bloque de deudores repetido (cobertura) trae a la
		// misma persona varias veces, y no tiene que rubricar dos veces por hoja.
		const porEmail = new Map<string, ContractSigner>();
		for (const f of firmantes) if (!porEmail.has(f.email)) porEmail.set(f.email, f);
		const unicos = [...porEmail.values()];
		if (unicos.length === 0) return [];

		const { franja } = rubrica;
		const anchoDeLaFranja = franja.derecha - franja.izquierda;

		// Tamaño de cada rúbrica. Por debajo de 100×50, que es una firma, para
		// que se distingan; y nunca más chica que 60 de ancho, que ya cuesta
		// firmar ahí. El alto sigue al ancho para que la proporción sea siempre
		// la misma.
		const ANCHO_MAXIMO = 90;
		const ANCHO_MINIMO = 60;
		const PROPORCION = 0.4;
		const separacion = 12;

		const porFila = Math.max(
			1,
			Math.floor((anchoDeLaFranja + separacion) / (ANCHO_MINIMO + separacion)),
		);
		const enLaFilaMasLlena = Math.min(unicos.length, porFila);
		const ancho = Math.floor(
			Math.min(
				ANCHO_MAXIMO,
				(anchoDeLaFranja - (enLaFilaMasLlena - 1) * separacion) /
					enLaFilaMasLlena,
			),
		);
		const alto = Math.round(ancho * PROPORCION);
		const pasoY = alto + separacion;

		// Las filas van centradas en el alto de la franja. Si son tantas que no
		// entran, se cuelgan del borde de arriba de la franja y crecen hacia el
		// borde de la hoja, porque arriba está el texto del contrato: sin tope de
		// firmantes, pero sin salirse de la hoja (eso se verifica abajo).
		const filas = Math.ceil(unicos.length / porFila);
		const altoDelBloque = filas * alto + (filas - 1) * separacion;
		const sobra = franja.arriba - franja.abajo - altoDelBloque;
		const baseDelBloque =
			sobra >= 0 ? franja.abajo + sobra / 2 : franja.arriba - altoDelBloque;

		const paginas = await WeeTrustService.dimensionesDePaginas(pdfBuffer);
		const extra: WeeTrustSignaturePosition[] = [];

		for (const { pageNum, width, height } of paginas) {
			if (pageNum % 2 === 0) continue;

			// Dónde va cada rúbrica, con el grupo corrido `hacia` puntos para arriba.
			// Se leen en el orden declarado: de izquierda a derecha, y de la fila
			// de arriba a la de abajo.
			const ubicar = (hacia: number) =>
				unicos.map((firmante, i) => {
					const fila = Math.floor(i / porFila);
					const enLaFila = i % porFila;
					const cuantosEnLaFila = Math.min(porFila, unicos.length - fila * porFila);
					const lugar = anchoDeLaFranja / cuantosEnLaFila;

					const x = franja.izquierda + enLaFila * lugar + (lugar - ancho) / 2;
					// Base de la fila en el PDF (origen abajo), pasada al sistema de
					// WeeTrust (origen arriba, y la posición es la del borde de arriba).
					const baseEnPdf = baseDelBloque + (filas - 1 - fila) * pasoY;
					const y = height - baseEnPdf - alto;
					return { firmante, x, y: y - hacia };
				});

			// Si una rúbrica cae sobre la firma real de OTRA persona, el grupo
			// entero sube de a una fila hasta no pisar ninguna: saltearla dejaría
			// esa hoja sin la rúbrica de alguien, y encimarla deja dos widgets
			// obligatorios uno arriba del otro.
			let hacia = 0;
			let ubicadas = ubicar(hacia);
			while (
				ubicadas.some(({ firmante, x, y }) =>
					yaPuestas.some(
						(p) =>
							p.page === pageNum &&
							p.user.email !== firmante.email &&
							seSolapan({ x, y, ancho, alto }, p),
					),
				)
			) {
				hacia += pasoY;
				ubicadas = ubicar(hacia);
				if (ubicadas.some(({ y }) => y < 0)) {
					throw new SignatureLayoutError(
						`${contractType}: no hay lugar en la página ${pageNum} para las rúbricas sin pisar las firmas.`,
					);
				}
			}

			for (const { firmante, x, y } of ubicadas) {
				// Si aun así no entra (tantos firmantes que las filas se comen la
				// hoja, o una franja que no es de este tamaño de hoja), se corta:
				// mejor un error a la vista que una rúbrica obligatoria fuera de la
				// página.
				if (x < 0 || y < 0 || x + ancho > width || y + alto > height) {
					throw new SignatureLayoutError(
						`${contractType}: las rúbricas de ${unicos.length} firmantes no caben en la página ${pageNum} (${width}x${height}).`,
					);
				}

				// Sobre la firma real de la misma persona no va: su firma ya está en
				// esa hoja, y una rúbrica encima sería ilegible y ambigua.
				const pisaSuFirma = yaPuestas.some(
					(p) =>
						p.page === pageNum &&
						p.user.email === firmante.email &&
						seSolapan({ x, y, ancho, alto }, p),
				);
				if (pisaSuFirma) continue;

				extra.push({
					user: { email: firmante.email },
					coordinates: { x, y },
					page: pageNum,
					pageY: y,
					pageYv2: y,
					color: "#FFD247",
					imageSize: { width: ancho, height: alto },
					parentImageSize: { width, height },
					viewport: { width, height },
				});
			}
		}

		if (extra.length > 0) {
			console.log(
				`[WeeTrust] ${contractType}: ${extra.length} rúbrica(s) en páginas impares ` +
					`(${unicos.length} firmante(s), ${ancho}x${alto} en ${filas} fila(s))`,
			);
		}
		return extra;
	}

	/**
	 * Tamaño de cada página del PDF, en puntos.
	 *
	 * `readSignatureLines` sólo devuelve el tamaño de las páginas donde encontró
	 * una línea de firma, y las rúbricas van en todas las impares, tengan línea
	 * o no.
	 */
	static async dimensionesDePaginas(
		pdfBuffer: Buffer,
	): Promise<Array<{ pageNum: number; width: number; height: number }>> {
		const pdfDocument = await pdfjsLib.getDocument({
			data: new Uint8Array(pdfBuffer),
		}).promise;

		const paginas: Array<{ pageNum: number; width: number; height: number }> = [];
		for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
			const page = await pdfDocument.getPage(pageNum);
			const viewport = page.getViewport({ scale: 1.0 });
			paginas.push({
				pageNum,
				width: viewport.width,
				height: viewport.height,
			});
		}
		return paginas;
	}

	/**
	 * Reparto histórico de firmas: toma hasta `signatureFieldCount` líneas
	 * empezando por el final del documento y las asigna por posición.
	 *
	 * Se conserva para los contratos que todavía no tienen su layout auditado
	 * (inversiones, sociedad, cartas poder). No es confiable cuando hay
	 * cofirmantes —por eso existe `locateSignatureWidgets`—, pero es el
	 * comportamiento con el que esos contratos vienen funcionando y cambiarlo
	 * sin verificar el PDF sería peor.
	 */
	private static async locateSignatureWidgetsLegacy(
		pdfBuffer: Buffer,
		contractType: ContractType,
		signerEmails: string[],
	): Promise<WeeTrustSignaturePosition[]> {
		const config = getSignaturePattern(contractType);
		const fieldCount = config.signatureFieldCount ?? config.signerCount;

		const lineas = await WeeTrustService.readSignatureLines(
			pdfBuffer,
			config.pattern,
		);

		if (lineas.length === 0) {
			console.warn(
				`[WeeTrust] No se encontró el patrón "${config.pattern}" en ${contractType}, usando posiciones por defecto`,
			);
			return signerEmails.map((email, i) =>
				WeeTrustService.generateDefaultSignaturePosition(
					email,
					1,
					i === 0 ? "left" : "right",
				),
			);
		}

		// Se toman las últimas `fieldCount` líneas del documento, que es donde
		// viven los bloques de firma.
		const elegidas = lineas.slice(-fieldCount);
		const SIGNATURE_HEIGHT = 50;

		return elegidas.map((linea, i) => {
			const email = signerEmails[Math.min(i, signerEmails.length - 1)];
			const x = linea.pdfX;
			const y = linea.pageHeight - linea.pdfY - SIGNATURE_HEIGHT;
			return {
				user: { email },
				coordinates: { x, y },
				page: linea.pageNum,
				pageY: y,
				pageYv2: y,
				color: "#FFD247",
				imageSize: { width: 100, height: 50 },
				parentImageSize: { width: linea.pageWidth, height: linea.pageHeight },
				viewport: { width: linea.pageWidth, height: linea.pageHeight },
			};
		});
	}

	/**
	 * Cuántas páginas tiene el PDF. Lanza si el archivo no se puede abrir.
	 *
	 * Sirve para rechazar un archivo roto aunque no haya líneas de firma que
	 * revisar, como en los contratos que se firman en papel.
	 */
	static async contarPaginas(pdfBuffer: Buffer): Promise<number> {
		const pdfDocument = await pdfjsLib.getDocument({
			data: new Uint8Array(pdfBuffer),
		}).promise;
		return pdfDocument.numPages;
	}

	/**
	 * Lee las líneas de firma de un PDF en orden de lectura: página, luego de
	 * arriba hacia abajo, luego de izquierda a derecha. Junta además el texto
	 * inmediatamente debajo de cada una, que es donde los templates imprimen el
	 * nombre y el DPI del firmante cuando los imprimen.
	 */
	// Pública para que los scripts de auditoría (inventario-firmas.ts) lean las
	// líneas con el mismo criterio que producción.
	static async readSignatureLines(
		pdfBuffer: Buffer,
		pattern: string,
	): Promise<
		Array<{
			pageNum: number;
			pdfX: number;
			pdfY: number;
			pageWidth: number;
			pageHeight: number;
			debajo: string[];
		}>
	> {
		const pdfDocument = await pdfjsLib.getDocument({
			data: new Uint8Array(pdfBuffer),
		}).promise;

		// El patrón declarado se calibró con los templates singulares, pero la
		// variante plural dibuja la misma línea con otra caja y otro largo
		// ("F)_____...___" vs "f)______"). Comparar el literal dejaba fuera todas
		// las firmas de los contratos con cofirmante, así que reconocemos el
		// prefijo (F), f., Firma:) seguido de la línea, sin distinguir mayúsculas.
		// Además del largo y la caja, los templates alternan el separador: el
		// pagaré singular escribe "f." y el plural "f)". Los tratamos como
		// equivalentes para no depender de la variante que se haya renderizado.
		const prefijo = pattern.split("_")[0].trim();
		const escapado = prefijo
			.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
			.replace(/\\[).]/g, "[).]")
			.replace(/\s+/g, "\\s*");
		const reLineaDeFirma = new RegExp(`^${escapado}\\s*_{3,}`, "i");
		// Hay patrones que son sólo una etiqueta, sin línea (el anexo de
		// inversiones dice "Firma del Inversionista"). Esos se reconocen por el
		// texto, como antes: exigirles guiones bajos los dejaba sin ninguna firma.
		const soloEtiqueta = !pattern.includes("_");
		const esLineaDeFirma = (texto: string): boolean =>
			reLineaDeFirma.test(texto.trim()) ||
			(soloEtiqueta && texto.includes(pattern.trim()));

		const encontradas: Array<{
			pageNum: number;
			pdfX: number;
			pdfY: number;
			pageWidth: number;
			pageHeight: number;
			debajo: string[];
		}> = [];

		for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
			const page = await pdfDocument.getPage(pageNum);
			const textContent = await page.getTextContent();
			const viewport = page.getViewport({ scale: 1.0 });

			const items = (textContent.items as Array<{ str: string; transform: number[] }>)
				.map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5] }))
				.filter((it) => it.str.trim());

			for (const item of items) {
				if (!esLineaDeFirma(item.str)) continue;

				const debajo = items
					.filter(
						(otro) =>
							otro.y < item.y &&
							otro.y > item.y - 42 &&
							Math.abs(otro.x - item.x) < 130 &&
							!esLineaDeFirma(otro.str),
					)
					.sort((a, b) => b.y - a.y)
					.slice(0, 3)
					.map((otro) => otro.str.trim());

				encontradas.push({
					pageNum,
					pdfX: item.x,
					pdfY: item.y,
					pageWidth: viewport.width,
					pageHeight: viewport.height,
					debajo,
				});
			}
		}

		return encontradas.sort(
			(a, b) => a.pageNum - b.pageNum || b.pdfY - a.pdfY || a.pdfX - b.pdfX,
		);
	}
}

/** Deja sólo los dígitos de un DPI para poder compararlo. */
function soloDigitos(valor?: string): string {
	return (valor ?? "").replace(/\D/g, "");
}

/**
 * WeeTrust exige nombres de firmante de 4 a 100 caracteres. Antes se derivaba
 * del email ("Roseldacoc1999"), que quedaba a la vista en el documento legal.
 */
function nombreParaWeeTrust(nombre: string, index: number): string {
	const limpio = (nombre ?? "").trim().replace(/\s+/g, " ");
	if (limpio.length < 4) return `Firmante ${index + 1}`;
	return limpio.slice(0, 100);
}

/**
 * Verificación de identidad que le toca a cada firmante.
 *
 * Al cliente y a los codeudores se les valida el DPI, y en el reconocimiento de
 * deuda además se les pide biometría facial con prueba de vida.
 *
 * Al **representante legal no se le pide nada**: firma por la entidad, es
 * personal nuestro y su nombre y cargo ya vienen impresos en el template.
 * Pedirle DPI o selfie no agrega ninguna garantía y le pone un trámite encima a
 * alguien que firma decenas de contratos al día.
 *
 * `identification` es opcional en WeeTrust: omitirlo deja la firma electrónica
 * sin verificación de identidad.
 */
/**
 * Si un recuadro se solapa con un widget ya puesto (en el sistema de WeeTrust,
 * origen arriba a la izquierda). Tocarse en el borde no cuenta.
 */
function seSolapan(
	r: { x: number; y: number; ancho: number; alto: number },
	w: WeeTrustSignaturePosition,
): boolean {
	return (
		r.x < w.coordinates.x + w.imageSize.width &&
		w.coordinates.x < r.x + r.ancho &&
		r.y < w.coordinates.y + w.imageSize.height &&
		w.coordinates.y < r.y + r.alto
	);
}

function identificacionDe(
	role: SignerRole,
	contractType: ContractType,
): { identification?: IdentificationMode } {
	if (role === SignerRole.REP_LEGAL) return {};

	return {
		identification:
			contractType === ContractType.RECONOCIMIENTO_DEUDA
				? "face"
				: WEETRUST_DEFAULT_IDENTIFICATION,
	};
}

// Singleton para uso global
let weeTrustServiceInstance: WeeTrustService | null = null;

export function getWeeTrustService(): WeeTrustService {
	if (!weeTrustServiceInstance) {
		weeTrustServiceInstance = new WeeTrustService();
	}
	return weeTrustServiceInstance;
}

export default WeeTrustService;

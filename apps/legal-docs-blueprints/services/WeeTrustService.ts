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
import { ContractType } from "../types/contract";
import { getSignaturePattern } from "./signaturePatterns";

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
		sharedWith: string[];
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
	 */
	async uploadDocumentFromBuffer(
		pdfBuffer: Buffer,
		fileName: string,
	): Promise<WeeTrustDocumentResponse["responseData"]> {
		// Asegurar que el filename tenga extensión .pdf
		const pdfFileName = fileName.endsWith(".pdf") ? fileName : `${fileName}.pdf`;
		console.log(`[WeeTrust] Subiendo documento desde buffer: ${pdfFileName}`);

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
		},
	): Promise<WeeTrustDocumentResponse["responseData"]> {
		console.log(
			`[WeeTrust] Enviando documento ${documentID} a ${options.signatory.length} firmante(s)`,
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
			signaturePositions?: WeeTrustSignaturePosition[];
			hasOrder?: boolean;
			page?: number;
			contractType?: ContractType;
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
		documentUrl: string;
		status: string;
	}> {
		const positioningMode = options.positioningMode ?? "fixed";

		// 1. Subir documento
		const uploadResult = await this.uploadDocumentFromBuffer(pdfBuffer, fileName);
		const documentID = uploadResult.documentID;

		// 2. Manejar posiciones según el modo
		if (positioningMode === "free") {
			// Modo libre: el firmante elige dónde firmar
			console.log("[WeeTrust] Modo libre: el firmante elegirá dónde colocar su firma");
		} else {
			// Modos "auto" o "fixed": fijar posiciones
			let positions = options.signaturePositions;

			if (positioningMode === "auto" && options.contractType) {
				// Detectar automáticamente las líneas de firma en el PDF
				const signerEmails = options.signatory.map((s) => s.emailID);
				positions = await WeeTrustService.findSignatureLinesInPDF(
					pdfBuffer,
					options.contractType,
					signerEmails,
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
		});

		// 4. Extraer signing links
		const signingLinks = signResult.signatory
			.filter((s) => s.signing?.url)
			.map((s) => s.signing!.url);

		return {
			documentID,
			signingLinks,
			documentUrl: signResult.documentFileObj.url,
			status: signResult.status,
		};
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
	 * @param emails - Lista de emails de los firmantes
	 * @returns { signs: string[], linkDocument: string }
	 */
	async createDocumentForSigning(
		title: string,
		pdfBuffer: Buffer,
		contractType: ContractType,
		emails: string[],
	): Promise<{
		signs: string[];
		linkDocument: string;
	}> {
		console.log(`\n🔄 [WeeTrust] Iniciando flujo completo para: ${title}`);

		// Construir lista de firmantes
		// WeeTrust requiere nombres de 4-100 caracteres
		const signatory: WeeTrustSignatory[] = emails.map((email, index) => {
			let name = email.split("@")[0];
			// Asegurar mínimo 4 caracteres
			if (name.length < 4) {
				name = `Firmante ${index + 1}`;
			}
			return {
				emailID: email,
				name,
			};
		});

		// Llamar al método principal con auto-detección
		const result = await this.createDocumentAndGetSigningLinks(pdfBuffer, title, {
			title,
			message: `Por favor firme el documento: ${title}`,
			signatory,
			contractType,
			positioningMode: "auto",
		});

		console.log(`✓ [WeeTrust] ${result.signingLinks.length} link(s) de firma generados`);

		// Retornar en formato compatible con Documenso
		return {
			signs: result.signingLinks,
			linkDocument: result.documentUrl,
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
	 * Detecta las líneas de firma en un PDF buscando patrones como "f)___"
	 * y genera las posiciones para WeeTrust
	 */
	static async findSignatureLinesInPDF(
		pdfBuffer: Buffer,
		contractType: ContractType,
		signerEmails: string[],
	): Promise<WeeTrustSignaturePosition[]> {
		try {
			console.log(`[WeeTrust] Detectando líneas de firma para: ${contractType}`);

			const patternConfig = getSignaturePattern(contractType);
			console.log(`[WeeTrust] Patrón: "${patternConfig.pattern}" (${patternConfig.signerCount} firmante(s))`);

			const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer) });
			const pdfDocument = await loadingTask.promise;
			const pageCount = pdfDocument.numPages;

			const pattern = patternConfig.pattern;
			const foundPositions: Array<{
				pageNum: number;
				pdfX: number;
				pdfY: number;
				pageWidth: number;
				pageHeight: number;
			}> = [];

			// Buscar el patrón en cada página (de atrás hacia adelante)
			for (let pageNum = pageCount; pageNum >= 1; pageNum--) {
				const page = await pdfDocument.getPage(pageNum);
				const textContent = await page.getTextContent();
				const viewport = page.getViewport({ scale: 1.0 });

				for (const item of textContent.items) {
					const textItem = item as { str: string; transform: number[] };
					const itemText = textItem.str;

					const patternStart = pattern.split("_")[0];
					// Verificar que sea una línea de firma real (debe tener guiones bajos)
					const hasUnderscores = itemText.includes("_") || itemText.includes("__");
					const matchesPattern =
						itemText.includes(pattern) ||
						itemText.trim() === pattern.trim() ||
						(patternStart.length >= 2 && itemText.trim().startsWith(patternStart) && hasUnderscores);

					if (matchesPattern) {
						foundPositions.push({
							pageNum,
							pdfX: textItem.transform[4],
							pdfY: textItem.transform[5],
							pageWidth: viewport.width,
							pageHeight: viewport.height,
						});

						console.log(`[WeeTrust] Patrón encontrado en página ${pageNum} - (${textItem.transform[4].toFixed(1)}, ${textItem.transform[5].toFixed(1)})`);

						if (foundPositions.length >= patternConfig.signerCount) break;
					}
				}

				if (foundPositions.length >= patternConfig.signerCount) break;
			}

			if (foundPositions.length === 0) {
				console.warn(`[WeeTrust] No se encontró el patrón "${pattern}", usando posiciones por defecto`);
				return signerEmails.map((email, i) =>
					WeeTrustService.generateDefaultSignaturePosition(
						email,
						pageCount,
						i === 0 ? "left" : "right",
					)
				);
			}

			// Invertir orden: último encontrado = primer firmante
			foundPositions.reverse();

			// Convertir coordenadas PDF a coordenadas WeeTrust
			const positions: WeeTrustSignaturePosition[] = [];

			for (let i = 0; i < Math.min(foundPositions.length, signerEmails.length); i++) {
				const pos = foundPositions[i];
				const email = signerEmails[i];

				// WeeTrust usa coordenadas donde Y=0 está arriba
				// PDF usa coordenadas donde Y=0 está abajo
				// Convertir: weeTrustY = pageHeight - pdfY - alturaFirma
				// (restamos altura para que la firma quede SOBRE la línea, no a partir de ella)
				const SIGNATURE_HEIGHT = 50;
				const x = pos.pdfX;
				const y = pos.pageHeight - pos.pdfY - SIGNATURE_HEIGHT;

				// NOTA: Los yOffset/xOffset de signaturePatterns.ts eran calibrados para Documenso
				// y no aplican a WeeTrust. Solo usamos SIGNATURE_HEIGHT global.

				positions.push({
					user: { email },
					coordinates: { x, y },
					page: pos.pageNum,
					pageY: y,
					pageYv2: y,
					color: "#FFD247",
					imageSize: { width: 100, height: 50 },
					parentImageSize: { width: pos.pageWidth, height: pos.pageHeight },
					viewport: { width: pos.pageWidth, height: pos.pageHeight },
				});

				console.log(`[WeeTrust] Posición ${i + 1}: página ${pos.pageNum}, (${x.toFixed(1)}, ${y.toFixed(1)})`);
			}

			return positions;
		} catch (error) {
			console.error("[WeeTrust] Error detectando firmas:", error);
			// Fallback a posiciones por defecto
			return signerEmails.map((email, i) =>
				WeeTrustService.generateDefaultSignaturePosition(email, 1, i === 0 ? "left" : "right")
			);
		}
	}
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

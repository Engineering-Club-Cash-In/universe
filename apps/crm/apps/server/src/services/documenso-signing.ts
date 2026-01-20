/**
 * Servicio para verificar el estado de firma de documentos en Documenso
 */

type SigningStatus = "PENDING" | "COMPLETED" | "ERROR";

interface SigningStatusResult {
	isSigned: boolean;
	status: SigningStatus;
	message: string;
}

/**
 * Extrae el token de firma de una URL de Documenso
 * @param signingUrl - URL completa de firma (ej: https://documenso.example.com/sign/akyMR7PGgJuzddsu0dHsq)
 * @returns El token extraído o null si no se puede extraer
 */
function extractSigningToken(signingUrl: string): string | null {
	try {
		const url = new URL(signingUrl);
		const pathParts = url.pathname.split("/");
		const signIndex = pathParts.indexOf("sign");
		if (signIndex !== -1 && pathParts[signIndex + 1]) {
			return pathParts[signIndex + 1];
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * Verifica el estado de firma de un documento usando la URL de firma del cliente
 * @param clientSigningLink - URL completa de firma del cliente
 * @returns Información sobre el estado de la firma
 */
export async function checkDocumensoSigningStatus(
	clientSigningLink: string,
): Promise<SigningStatusResult> {
	try {
		const baseUrl = process.env.DOCUMENSO_API_URL;
		if (!baseUrl) {
			console.error("❌ DOCUMENSO_API_URL no está configurada");
			return {
				isSigned: false,
				status: "ERROR",
				message: "Configuración de Documenso no disponible",
			};
		}

		const signingToken = extractSigningToken(clientSigningLink);
		if (!signingToken) {
			console.error("❌ No se pudo extraer el token de firma de la URL");
			return {
				isSigned: false,
				status: "ERROR",
				message: "URL de firma inválida",
			};
		}

		// Construir la URL base de Documenso (sin /api/v1 o /api/v2-beta)
		const documensoBaseUrl = baseUrl
			.replace("/api/v1", "")
			.replace("/api/v2-beta", "");
		const signingUrl = `${documensoBaseUrl}/sign/${signingToken}`;

		console.log(
			`🔍 Verificando estado de firma para token: ${signingToken.substring(0, 10)}...`,
		);
		console.log(`🔗 Verificando: ${signingUrl}`);

		const response = await fetch(signingUrl, {
			method: "HEAD",
			redirect: "manual",
		});

		// Si hay redirect a /complete, el documento está firmado
		if (response.status === 302 || response.status === 301) {
			const location = response.headers.get("location");
			if (location?.includes("/complete")) {
				console.log(`✅ Documento firmado - Redirige a: ${location}`);
				return {
					isSigned: true,
					status: "COMPLETED",
					message: "Documento firmado exitosamente",
				};
			}
		}

		// Si retorna 200, está pendiente de firma
		if (response.status === 200) {
			return {
				isSigned: false,
				status: "PENDING",
				message: "Documento pendiente de firma",
			};
		}

		// Cualquier otro status es un error
		return {
			isSigned: false,
			status: "ERROR",
			message: "Token de firma no encontrado o inválido",
		};
	} catch (error: unknown) {
		const errorMessage =
			error instanceof Error ? error.message : "Error desconocido";
		console.error("❌ Error al verificar estado de firma:", errorMessage);
		return {
			isSigned: false,
			status: "ERROR",
			message: `Error al verificar: ${errorMessage}`,
		};
	}
}

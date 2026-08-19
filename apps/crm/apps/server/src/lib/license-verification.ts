import { readFileSync } from "node:fs";
import { rootCertificates } from "node:tls";
// El import con "type: file" hace que Bun empaque el .wasm dentro del binario
// compilado (bun build --compile, que es como se despliega el server — ver
// Dockerfile). Con require.resolve() a secas esto se rompe en producción
// porque el contenedor final no tiene node_modules, solo el binario.
// biome-ignore lint/style/useImportType: es un import de asset, no de tipos
import zxingWasmPath from "zxing-wasm/reader/zxing_reader.wasm" with { type: "file" };

// Umbral de similitud de nombre (0-100) para considerar que la licencia es de la
// persona registrada. Por debajo de esto, el resultado queda en revisión manual.
export const IDENTITY_MATCH_THRESHOLD = 85;

const TRANSITO_ORIGIN = "https://vl.transito.gob.gt";
const OFFICIAL_QR_HOST = "vl.transito.gob.gt";
const REQUEST_TIMEOUT_MS = 15_000;
const USER_AGENT = "Mozilla/5.0 (compatible; CCI-CRM-LicenseVerification/1.0)";

// =============================================================================
// Decodificación de QR + código de tarjeta (barcode Code128) de la foto
// =============================================================================

let zxingReady: Promise<void> | null = null;

function ensureZXingReady(): Promise<void> {
	if (!zxingReady) {
		zxingReady = (async () => {
			const { prepareZXingModule } = await import("zxing-wasm/reader");
			await prepareZXingModule({
				overrides: {
					wasmBinary: readFileSync(zxingWasmPath).buffer as ArrayBuffer,
				},
				fireImmediately: true,
			});
		})().catch((error) => {
			// Si falla, no dejar la promesa rechazada cacheada para siempre —
			// si no, toda petición futura falla hasta reiniciar el proceso.
			zxingReady = null;
			throw error;
		});
	}
	return zxingReady;
}

export interface DecodedLicenseBack {
	qrRawUrl?: string;
	cardCode?: string;
}

// Decodifica el QR (URL de trámite) y el barcode Code128 (código de tarjeta)
// del reverso de la licencia. Ambos son símbolos con corrección de errores
// integrada, así que esto es determinístico — no hay OCR ni IA involucrada.
export async function decodeLicenseBack(
	buffer: Buffer,
): Promise<DecodedLicenseBack> {
	await ensureZXingReady();
	const { readBarcodes } = await import("zxing-wasm/reader");

	const results = await readBarcodes(new Uint8Array(buffer), {
		tryHarder: true,
		formats: ["QRCode", "Code128"],
	});

	// zxing NO tira excepción si no puede ni cargar la imagen (formato no
	// soportado por su decodificador de imágenes interno — ej. WebP — o
	// archivo corrupto/truncado). En su lugar devuelve un resultado sintético
	// con format vacío y el error en el campo `error`. Si no se detecta esto
	// acá, ambos .find() de abajo no matchean y el caller reporta el mensaje
	// genérico de "mejor luz y enfoque" sobre un problema que no es de la
	// foto en sí, sino del formato/integridad del archivo.
	const loadFailure = results.find((r) => !r.format && r.error);
	if (loadFailure) {
		throw new Error(`No se pudo cargar la imagen: ${loadFailure.error}`);
	}

	return {
		// isValid: por si algún símbolo se detecta pero no pasa checksum —
		// no se debe tomar su texto como dato real.
		qrRawUrl: results.find((r) => r.isValid && r.format === "QRCode")?.text,
		cardCode: results.find((r) => r.isValid && r.format === "Code128")?.text,
	};
}

// =============================================================================
// Validación de dominio del QR
// =============================================================================

export function isOfficialTransitoUrl(rawUrl: string): boolean {
	try {
		const url = new URL(rawUrl);
		return url.protocol === "https:" && url.hostname === OFFICIAL_QR_HOST;
	} catch {
		return false;
	}
}

function extractTramite(rawUrl: string): string | undefined {
	try {
		const tramite = new URL(rawUrl).pathname.replace(/^\/+/, "");
		return tramite || undefined;
	} catch {
		return undefined;
	}
}

// =============================================================================
// Consulta a la API oficial de Tránsito (vl.transito.gob.gt)
// =============================================================================

interface CookieJar {
	cookies: Map<string, string>;
}

function newJar(): CookieJar {
	return { cookies: new Map() };
}

function storeCookies(jar: CookieJar, response: Response): void {
	const setCookies =
		typeof response.headers.getSetCookie === "function"
			? response.headers.getSetCookie()
			: response.headers.get("set-cookie")
				? [response.headers.get("set-cookie") as string]
				: [];

	for (const raw of setCookies) {
		const [pair] = raw.split(";");
		const eq = pair.indexOf("=");
		if (eq === -1) continue;
		jar.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
	}
}

function cookieHeader(jar: CookieJar): string {
	return [...jar.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

export interface TransitoApiResult {
	responseCode: number;
	errorMessage?: string;
	// Datos de la licencia (sin la foto, no la persistimos)
	data?: Record<string, unknown>;
}

// El servidor de vl.transito.gob.gt manda un certificado intermedio
// equivocado (uno que no corresponde a la cadena de su propio certificado),
// así que un cliente estricto lo rechaza con "unable to verify the first
// certificate". La verificación SÍ importa acá — es la única garantía de que
// estamos hablando con el servidor real, no con quien responda a ese dominio
// (DNS spoofing, MITM, etc.) — así que no se desactiva `rejectUnauthorized`.
// En su lugar se suple el intermedio correcto (descargado del propio CA,
// Sectigo, vía la URL "CA Issuers" del certificado hoja) para que la cadena
// cierre con verificación real. Importante: pasar `ca` REEMPLAZA el trust
// store por defecto, no lo extiende — por eso se combina con
// `tls.rootCertificates` (las ~145 raíces estándar). Así funciona con la
// cadena rota de hoy (gracias al intermedio agregado) y sigue funcionando si
// Tránsito la arregla o rota a otro intermedio bien encadenado (gracias a las
// raíces estándar), sin degradar la verificación real de hostname/cadena.
// Ver Sectigo "Public Server Authentication CA
// DV R36" en http://crt.sectigo.com/SectigoPublicServerAuthenticationCADVR36.crt
const TRANSITO_INTERMEDIATE_CA = `-----BEGIN CERTIFICATE-----
MIIGTDCCBDSgAwIBAgIQOXpmzCdWNi4NqofKbqvjsTANBgkqhkiG9w0BAQwFADBf
MQswCQYDVQQGEwJHQjEYMBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTYwNAYDVQQD
Ey1TZWN0aWdvIFB1YmxpYyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gUm9vdCBSNDYw
HhcNMjEwMzIyMDAwMDAwWhcNMzYwMzIxMjM1OTU5WjBgMQswCQYDVQQGEwJHQjEY
MBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTcwNQYDVQQDEy5TZWN0aWdvIFB1Ymxp
YyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gQ0EgRFYgUjM2MIIBojANBgkqhkiG9w0B
AQEFAAOCAY8AMIIBigKCAYEAljZf2HIz7+SPUPQCQObZYcrxLTHYdf1ZtMRe7Yeq
RPSwygz16qJ9cAWtWNTcuICc++p8Dct7zNGxCpqmEtqifO7NvuB5dEVexXn9RFFH
12Hm+NtPRQgXIFjx6MSJcNWuVO3XGE57L1mHlcQYj+g4hny90aFh2SCZCDEVkAja
EMMfYPKuCjHuuF+bzHFb/9gV8P9+ekcHENF2nR1efGWSKwnfG5RawlkaQDpRtZTm
M64TIsv/r7cyFO4nSjs1jLdXYdz5q3a4L0NoabZfbdxVb+CUEHfB0bpulZQtH1Rv
38e/lIdP7OTTIlZh6OYL6NhxP8So0/sht/4J9mqIGxRFc0/pC8suja+wcIUna0HB
pXKfXTKpzgis+zmXDL06ASJf5E4A2/m+Hp6b84sfPAwQ766rI65mh50S0Di9E3Pn
2WcaJc+PILsBmYpgtmgWTR9eV9otfKRUBfzHUHcVgarub/XluEpRlTtZudU5xbFN
xx/DgMrXLUAPaI60fZ6wA+PTAgMBAAGjggGBMIIBfTAfBgNVHSMEGDAWgBRWc1hk
lfmSGrASKgRieaFAFYghSTAdBgNVHQ4EFgQUaMASFhgOr872h6YyV6NGUV3LBycw
DgYDVR0PAQH/BAQDAgGGMBIGA1UdEwEB/wQIMAYBAf8CAQAwHQYDVR0lBBYwFAYI
KwYBBQUHAwEGCCsGAQUFBwMCMBsGA1UdIAQUMBIwBgYEVR0gADAIBgZngQwBAgEw
VAYDVR0fBE0wSzBJoEegRYZDaHR0cDovL2NybC5zZWN0aWdvLmNvbS9TZWN0aWdv
UHVibGljU2VydmVyQXV0aGVudGljYXRpb25Sb290UjQ2LmNybDCBhAYIKwYBBQUH
AQEEeDB2ME8GCCsGAQUFBzAChkNodHRwOi8vY3J0LnNlY3RpZ28uY29tL1NlY3Rp
Z29QdWJsaWNTZXJ2ZXJBdXRoZW50aWNhdGlvblJvb3RSNDYucDdjMCMGCCsGAQUF
BzABhhdodHRwOi8vb2NzcC5zZWN0aWdvLmNvbTANBgkqhkiG9w0BAQwFAAOCAgEA
YtOC9Fy+TqECFw40IospI92kLGgoSZGPOSQXMBqmsGWZUQ7rux7cj1du6d9rD6C8
ze1B2eQjkrGkIL/OF1s7vSmgYVafsRoZd/IHUrkoQvX8FZwUsmPu7amgBfaY3g+d
q1x0jNGKb6I6Bzdl6LgMD9qxp+3i7GQOnd9J8LFSietY6Z4jUBzVoOoz8iAU84OF
h2HhAuiPw1ai0VnY38RTI+8kepGWVfGxfBWzwH9uIjeooIeaosVFvE8cmYUB4TSH
5dUyD0jHct2+8ceKEtIoFU/FfHq/mDaVnvcDCZXtIgitdMFQdMZaVehmObyhRdDD
4NQCs0gaI9AAgFj4L9QtkARzhQLNyRf87Kln+YU0lgCGr9HLg3rGO8q+Y4ppLsOd
unQZ6ZxPNGIfOApbPVf5hCe58EZwiWdHIMn9lPP6+F404y8NNugbQixBber+x536
WrZhFZLjEkhp7fFXf9r32rNPfb74X/U90Bdy4lzp3+X1ukh1BuMxA/EEhDoTOS3l
7ABvc7BYSQubQ2490OcdkIzUh3ZwDrakMVrbaTxUM2p24N6dB+ns2zptWCva6jzW
r8IWKIMxzxLPv5Kt3ePKcUdvkBU/smqujSczTzzSjIoR5QqQA6lN1ZRSnuHIWCvh
JEltkYnTAH41QJ6SAWO66GrrUESwN/cgZzL4JLEqz1Y=
-----END CERTIFICATE-----`;
const TRANSITO_TLS: { ca: string[] } = {
	ca: [TRANSITO_INTERMEDIATE_CA, ...rootCertificates],
};

// Replica el flujo que hace el propio sitio en el navegador: carga la página
// del trámite (cookie de sesión) -> pide un challenge -> consulta la licencia
// con el código de tarjeta. Confirmado en vivo que funciona con HTTP plano,
// sin necesidad de un navegador headless.
export async function queryTransito(params: {
	tramite: string;
	cardCode: string;
}): Promise<TransitoApiResult> {
	const jar = newJar();
	const pageUrl = `${TRANSITO_ORIGIN}/${params.tramite}`;
	const signal = () => AbortSignal.timeout(REQUEST_TIMEOUT_MS);

	const pageResponse = await fetch(pageUrl, {
		headers: { "User-Agent": USER_AGENT },
		signal: signal(),
		tls: TRANSITO_TLS,
	});
	storeCookies(jar, pageResponse);
	await pageResponse.arrayBuffer();

	const challengeResponse = await fetch(`${TRANSITO_ORIGIN}/api/check/valida`, {
		headers: {
			Accept: "application/json",
			Referer: pageUrl,
			"User-Agent": USER_AGENT,
			Cookie: cookieHeader(jar),
		},
		signal: signal(),
		tls: TRANSITO_TLS,
	});
	storeCookies(jar, challengeResponse);

	if (!challengeResponse.ok) {
		throw new Error(
			`No se pudo obtener el challenge de Tránsito (HTTP ${challengeResponse.status})`,
		);
	}

	const challengeBody = (await challengeResponse.json()) as {
		codigo: number;
		valor?: string;
	};

	if (challengeBody.codigo !== 0 || !challengeBody.valor) {
		throw new Error("Tránsito no entregó un challenge válido");
	}

	const verifyResponse = await fetch(`${TRANSITO_ORIGIN}/api/licencia/valida`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json",
			Referer: pageUrl,
			Origin: TRANSITO_ORIGIN,
			"User-Agent": USER_AGENT,
			Cookie: cookieHeader(jar),
		},
		body: JSON.stringify({
			tramite: params.tramite,
			tarjeta: Number(params.cardCode),
			direccion: "",
			challenge: challengeBody.valor,
		}),
		signal: signal(),
		tls: TRANSITO_TLS,
	});

	if (!verifyResponse.ok) {
		throw new Error(
			`Tránsito respondió con error (HTTP ${verifyResponse.status})`,
		);
	}

	const verifyBody = (await verifyResponse.json()) as {
		codigo: number;
		errorMsg1?: string;
		errorMsg2?: string;
		valor?: Record<string, unknown> & { foto?: string };
	};

	if (verifyBody.codigo === 0 && verifyBody.valor) {
		const { foto: _foto, ...data } = verifyBody.valor;
		return { responseCode: verifyBody.codigo, data };
	}

	return {
		responseCode: verifyBody.codigo,
		errorMessage: verifyBody.errorMsg1 || verifyBody.errorMsg2 || undefined,
	};
}

// =============================================================================
// Comparación de nombre (nombreCiudadano de Tránsito vs. lead/co-deudor)
// =============================================================================

function normalizeNameTokens(name: string): string[] {
	return name
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "") // quitar acentos
		.toUpperCase()
		.replace(/[^A-Z\s]/g, " ")
		.split(/\s+/)
		.filter(Boolean);
}

// Similitud por coeficiente de Dice sobre los tokens del nombre (0-100).
// Robusto a nombres en distinto orden o con segundo nombre/apellido faltante,
// que es justo el tipo de variación que se ve entre el CRM y el dato oficial.
//
// Nota conocida: al ser insensible al orden, dos nombres con las mismas
// palabras en distinto orden (ej. hermanos con nombre/segundo nombre
// invertidos) pueden dar 100%. Es una limitación real, aceptada por ahora —
// resolverla bien requeriría comparar contra un identificador único (DPI/CUI)
// en vez de nombre, y el campo que devuelve Tránsito (idCiudadano) no tiene
// pinta de ser el CUI real (le faltan dígitos), así que no se implementa
// hasta confirmar qué es ese campo.
export function nameSimilarity(nameA: string, nameB: string): number {
	const tokensA = normalizeNameTokens(nameA);
	const tokensB = normalizeNameTokens(nameB);
	if (tokensA.length === 0 || tokensB.length === 0) return 0;

	// Conteo por token (multiset), no Set — si no, un nombre con una palabra
	// repetida ("JOSE JOSE") infla los matches contra el otro lado y el score
	// puede pasar de 100%.
	const remaining = new Map<string, number>();
	for (const token of tokensB) {
		remaining.set(token, (remaining.get(token) ?? 0) + 1);
	}
	let matches = 0;
	for (const token of tokensA) {
		const count = remaining.get(token) ?? 0;
		if (count > 0) {
			matches++;
			remaining.set(token, count - 1);
		}
	}
	const score = (2 * matches) / (tokensA.length + tokensB.length);

	return Math.round(score * 100 * 100) / 100;
}

// Guatemala es UTC-6 todo el año (sin horario de verano) — mismo criterio que
// lib/guatemala-month-window.ts. El contenedor corre en UTC, así que construir
// la fecha con el reloj local del proceso adelanta el vencimiento ~6 horas.
const GUATEMALA_UTC_OFFSET_HOURS = 6;

// "unknown" cuando la fecha no viene o no se pudo interpretar — un control de
// cumplimiento no debe asumir "no vencida" ante un dato que no entendió
// (fail-closed, no fail-open): eso se resuelve a revisión manual, no a válida.
function isExpired(dateStr: string | undefined): boolean | "unknown" {
	if (!dateStr) return "unknown";
	const match = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
	if (!match) return "unknown";
	const [, day, month, year] = match;
	const y = Number(year);
	const m = Number(month);
	const d = Number(day);

	// El regex solo valida forma (2-2-4 dígitos), no que sea una fecha real —
	// "31/02/2026" o "99/99/2026" pasan el regex. new Date() con esos valores
	// "rueda" hacia adelante en vez de fallar, así que se verifica con un
	// round-trip: si los componentes no vuelven a salir igual, no era una
	// fecha de calendario válida.
	const roundTrip = new Date(Date.UTC(y, m - 1, d));
	if (
		roundTrip.getUTCFullYear() !== y ||
		roundTrip.getUTCMonth() !== m - 1 ||
		roundTrip.getUTCDate() !== d
	) {
		return "unknown";
	}

	// Medianoche GT del día siguiente al de vencimiento = el momento exacto en
	// que la licencia deja de ser válida.
	const expiresAtUtcMs = Date.UTC(y, m - 1, d + 1, GUATEMALA_UTC_OFFSET_HOURS);
	return Date.now() >= expiresAtUtcMs;
}

// Whitelist estricta (no denylist): solo bloqueo=0+estadoLicencia=2+estadoFol=4 es "active", el resto va a "unknown" (revisión manual).
export function assessTransitoLicenseStatus(
	data: Record<string, unknown>,
): "active" | "blocked" | "unknown" {
	const { bloqueo, estadoLicencia, estadoFol } = data;
	if (
		typeof bloqueo !== "number" ||
		typeof estadoLicencia !== "number" ||
		typeof estadoFol !== "number"
	) {
		return "unknown";
	}
	if (bloqueo > 0 || estadoLicencia === 1 || estadoFol === 3) {
		return "blocked";
	}
	if (bloqueo === 0 && estadoLicencia === 2 && estadoFol === 4) {
		return "active";
	}
	return "unknown";
}

// =============================================================================
// Orquestador: decodifica, valida dominio, consulta Tránsito y compara nombre
// =============================================================================

export type LicenseVerificationResult =
	| "valida"
	| "invalida"
	| "ilegible"
	| "revision_manual";

export interface LicenseVerificationOutcome {
	qrRawUrl?: string;
	qrDomainValid: boolean;
	cardCode?: string;
	apiResponseCode?: number;
	licenseHolderName?: string;
	licenseNumber?: string;
	licenseExpiresAt?: string;
	rawResponse?: Record<string, unknown>;
	identityMatchScore?: number;
	result: LicenseVerificationResult;
	failureReason?: string;
}

// Fallos al DECODIFICAR la imagen (zxing/wasm) se capturan acá y se devuelven
// como "ilegible" — sí quedan con trazabilidad (criterio #5). Fallos al
// CONSULTAR a Tránsito (queryTransito) se dejan propagar sin capturar, para
// que el caller decida no persistir un resultado falso ante un problema de
// red transitorio. Son dos cosas distintas y no deben confundirse en un solo
// mensaje de error.
export async function runLicenseVerification(params: {
	imageBuffer: Buffer;
	registeredName: string;
}): Promise<LicenseVerificationOutcome> {
	let decoded: DecodedLicenseBack;
	try {
		decoded = await decodeLicenseBack(params.imageBuffer);
	} catch (error) {
		console.error("Error decodificando reverso de licencia:", {
			error: error instanceof Error ? error.message : String(error),
		});
		return {
			qrDomainValid: false,
			result: "ilegible",
			failureReason:
				"No se pudo procesar la imagen (archivo dañado o formato no soportado). Vuelve a tomar la foto.",
		};
	}
	const { qrRawUrl, cardCode } = decoded;

	if (!qrRawUrl || !cardCode) {
		const missing = [
			!qrRawUrl && "el código QR",
			!cardCode && "el código de tarjeta (barcode)",
		]
			.filter(Boolean)
			.join(" ni ");
		return {
			qrRawUrl,
			qrDomainValid: false,
			cardCode,
			result: "ilegible",
			failureReason: `No se pudo leer ${missing} de la imagen. Vuelve a tomar la foto con mejor luz y enfoque.`,
		};
	}

	// El barcode Code128 admite caracteres no numéricos; si la lectura no es
	// puramente numérica es una lectura incorrecta, no un dato real de
	// Tránsito — mandarlo igual produciría NaN -> null en el JSON y una
	// "invalida" que le echa la culpa a la licencia por un problema nuestro.
	if (!/^\d+$/.test(cardCode)) {
		return {
			qrRawUrl,
			qrDomainValid: false,
			cardCode,
			result: "ilegible",
			failureReason:
				"El código de tarjeta leído del código de barras no es numérico — lectura incorrecta. Vuelve a tomar la foto.",
		};
	}

	const qrDomainValid = isOfficialTransitoUrl(qrRawUrl);
	if (!qrDomainValid) {
		return {
			qrRawUrl,
			qrDomainValid,
			cardCode,
			result: "invalida",
			failureReason:
				"El QR no apunta al dominio oficial de Tránsito (vl.transito.gob.gt).",
		};
	}

	const tramite = extractTramite(qrRawUrl);
	if (!tramite) {
		return {
			qrRawUrl,
			qrDomainValid,
			cardCode,
			result: "ilegible",
			failureReason: "El QR no contiene un identificador de trámite válido.",
		};
	}

	const apiResult = await queryTransito({ tramite, cardCode });

	if (apiResult.responseCode !== 0 || !apiResult.data) {
		return {
			qrRawUrl,
			qrDomainValid,
			cardCode,
			apiResponseCode: apiResult.responseCode,
			result: "invalida",
			failureReason:
				apiResult.errorMessage ||
				"Tránsito rechazó la consulta (código de tarjeta incorrecto o licencia no encontrada).",
		};
	}

	const { data } = apiResult;
	const licenseHolderName =
		typeof data.nombreCiudadano === "string" ? data.nombreCiudadano : undefined;
	const licenseNumber =
		typeof data.numeroLicencia === "string" ? data.numeroLicencia : undefined;
	const licenseExpiresAt =
		typeof data.fechaVencimiento === "string" ? data.fechaVencimiento : undefined;

	const identityMatchScore = licenseHolderName
		? nameSimilarity(licenseHolderName, params.registeredName)
		: 0;

	const base = {
		qrRawUrl,
		qrDomainValid,
		cardCode,
		apiResponseCode: apiResult.responseCode,
		licenseHolderName,
		licenseNumber,
		licenseExpiresAt,
		rawResponse: data,
		identityMatchScore,
	};

	const licenseStatus = assessTransitoLicenseStatus(data);
	if (licenseStatus === "blocked") {
		return {
			...base,
			result: "invalida",
			failureReason:
				"Tránsito reporta la licencia como bloqueada, inactiva o con un folio inválido.",
		};
	}
	if (licenseStatus === "unknown") {
		return {
			...base,
			result: "revision_manual",
			failureReason:
				"No se pudo determinar el estado (bloqueo/estado de licencia/folio) que reportó Tránsito — requiere revisión manual.",
		};
	}

	const expiryStatus = isExpired(licenseExpiresAt);
	if (expiryStatus === "unknown") {
		return {
			...base,
			result: "revision_manual",
			failureReason: `No se pudo interpretar la fecha de vencimiento devuelta por Tránsito ("${licenseExpiresAt ?? "sin dato"}") — requiere revisión manual.`,
		};
	}
	if (expiryStatus) {
		return {
			...base,
			result: "invalida",
			failureReason: `La licencia está vencida (venció ${licenseExpiresAt}).`,
		};
	}

	if (identityMatchScore < IDENTITY_MATCH_THRESHOLD) {
		return {
			...base,
			result: "revision_manual",
			failureReason: `El nombre en Tránsito ("${licenseHolderName}") no coincide claramente con el registrado ("${params.registeredName}") — similitud ${identityMatchScore}%.`,
		};
	}

	return { ...base, result: "valida" };
}

/**
 * Cartera-Back Auth Service
 * Maneja login, verificación y refresh de JWT contra cartera-back.
 * Replica el patrón usado por apps/auth-google para que las llamadas
 * lleven un Bearer JWT real (cartera-back valida con jwt.verify).
 */

interface CarteraLoginResponse {
	success: boolean;
	message: string;
	data: {
		accessToken: string;
		refreshToken: string;
		user: Record<string, unknown>;
	};
}

interface CarteraVerifyResponse {
	success: boolean;
	message: string;
	data: Record<string, unknown>;
	accessToken: string;
}

interface CarteraRefreshResponse {
	success: boolean;
	message: string;
	accessToken: string;
	refreshToken: string;
}

interface TokenCache {
	accessToken: string | null;
	refreshToken: string | null;
	expiresAt: number;
}

let tokenCache: TokenCache = {
	accessToken: null,
	refreshToken: null,
	expiresAt: 0,
};

const TOKEN_EXPIRY_MS = 12 * 60 * 60 * 1000;
// Ninguno de los 3 fetches de este archivo tenía límite — si cartera-back
// acepta la conexión pero nunca responde, getCarteraAccessToken() (llamado
// antes de enviar()) cuelga indefinidamente, sin que el timeout de 10s del
// import client lo cubra: nunca se llega a ese fetch (hallazgo Codex). Mismo
// valor que ya usa pagalo-import-client.ts, por consistencia.
const AUTH_TIMEOUT_MS = 10_000;

function getBaseUrl(): string {
	return process.env.CARTERA_BACK_URL || "http://localhost:7000";
}

type RespuestaAuthLeida = { status: number; ok: boolean; raw: string };

/**
 * Lee headers Y body dentro de la misma ventana de abort. `fetch()` resuelve
 * en cuanto llegan los headers — si el caller leyera el body después (como
 * antes), cartera-back mandando headers y colgándose a mitad del body dejaba
 * el timeout sin efecto real: getCarteraAccessToken() y cada dispatcher de
 * pago que depende de él podían colgarse indefinidamente igual (hallazgo
 * Codex, tras el fix anterior que solo cubría el fetch en sí).
 */
async function fetchConTimeout(url: string, init: RequestInit): Promise<RespuestaAuthLeida> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);
	try {
		const response = await fetch(url, { ...init, signal: controller.signal });
		const raw = await response.text();
		return { status: response.status, ok: response.ok, raw };
	} finally {
		clearTimeout(timeout);
	}
}

function getCredentials(): { email: string; password: string } {
	const email = process.env.CARTERA_USER;
	const password = process.env.CARTERA_PASSWORD;
	if (!email || !password) {
		throw new Error(
			"CARTERA_USER y CARTERA_PASSWORD deben estar configurados en el .env del server",
		);
	}
	return { email, password };
}

export async function loginCartera(): Promise<string> {
	const { email, password } = getCredentials();
	const response = await fetchConTimeout(`${getBaseUrl()}/auth/login`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email, password }),
	});

	if (!response.ok) {
		throw new Error(`Cartera login falló (${response.status}): ${response.raw}`);
	}

	const data = JSON.parse(response.raw) as CarteraLoginResponse;
	tokenCache = {
		accessToken: data.data.accessToken,
		refreshToken: data.data.refreshToken,
		expiresAt: Date.now() + TOKEN_EXPIRY_MS,
	};
	return data.data.accessToken;
}

async function verifyCarteraToken(token: string): Promise<string | null> {
	try {
		const response = await fetchConTimeout(
			`${getBaseUrl()}/auth/verify?token=${encodeURIComponent(token)}`,
			{ method: "GET", headers: { "Content-Type": "application/json" } },
		);
		if (!response.ok) return null;
		const data = JSON.parse(response.raw) as CarteraVerifyResponse;
		if (data.success && data.accessToken) {
			tokenCache.accessToken = data.accessToken;
			tokenCache.expiresAt = Date.now() + TOKEN_EXPIRY_MS;
			return data.accessToken;
		}
		return null;
	} catch (error) {
		console.error("[CarteraAuth] Error verificando token:", error);
		return null;
	}
}

async function refreshCarteraToken(): Promise<string | null> {
	if (!tokenCache.refreshToken) return null;
	try {
		const response = await fetchConTimeout(`${getBaseUrl()}/auth/refresh`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ refreshToken: tokenCache.refreshToken }),
		});
		if (!response.ok) return null;
		const data = JSON.parse(response.raw) as CarteraRefreshResponse;
		if (data.success && data.accessToken) {
			tokenCache.accessToken = data.accessToken;
			if (data.refreshToken) tokenCache.refreshToken = data.refreshToken;
			tokenCache.expiresAt = Date.now() + TOKEN_EXPIRY_MS;
			return data.accessToken;
		}
		return null;
	} catch (error) {
		console.error("[CarteraAuth] Error refrescando token:", error);
		return null;
	}
}

export async function getCarteraAccessToken(): Promise<string> {
	if (tokenCache.accessToken && Date.now() < tokenCache.expiresAt) {
		const verified = await verifyCarteraToken(tokenCache.accessToken);
		if (verified) return verified;
	}

	if (tokenCache.refreshToken) {
		const refreshed = await refreshCarteraToken();
		if (refreshed) return refreshed;
	}

	return loginCartera();
}

export async function ensureCarteraAuth(): Promise<string> {
	return getCarteraAccessToken();
}

export function clearCarteraTokens(): void {
	tokenCache = { accessToken: null, refreshToken: null, expiresAt: 0 };
}

export async function invalidateAndReauth(): Promise<string> {
	clearCarteraTokens();
	return loginCartera();
}

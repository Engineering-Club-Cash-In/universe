/**
 * Comparación de secretos compartidos para llamadas servicio-a-servicio.
 *
 * Los endpoints `/api/portal/*` no los consume un usuario final: los llama
 * auth-google en nombre del portal. La autorización es, por lo tanto, un
 * secreto compartido entre ambos servicios.
 */

import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Compara el secreto recibido contra el configurado en tiempo constante.
 *
 * Ambos se reducen a un digest SHA-256 antes de comparar, así el buffer que
 * entra a `timingSafeEqual` siempre mide 32 bytes: secretos de longitudes
 * distintas se comparan igual que los de la misma y la función no lanza ni
 * distingue el caso por el tipo de error.
 *
 * Devuelve `false` si el secreto esperado no está configurado (fail closed).
 */
export function secretsMatch(
	provided: string | undefined | null,
	expected: string | undefined | null,
): boolean {
	const providedValue = provided?.trim() ?? "";
	const expectedValue = expected?.trim() ?? "";

	if (providedValue.length === 0 || expectedValue.length === 0) {
		return false;
	}

	const providedDigest = createHash("sha256")
		.update(providedValue, "utf8")
		.digest();
	const expectedDigest = createHash("sha256")
		.update(expectedValue, "utf8")
		.digest();

	return timingSafeEqual(providedDigest, expectedDigest);
}

/**
 * Devuelve el token de un header `Authorization: Bearer <token>`,
 * o `null` si el header falta, usa otro esquema o viene vacío.
 */
export function extractBearerToken(
	authorizationHeader: string | undefined | null,
): string | null {
	if (!authorizationHeader) {
		return null;
	}

	const [scheme, ...rest] = authorizationHeader.trim().split(/\s+/);

	if (!scheme || scheme.toLowerCase() !== "bearer") {
		return null;
	}

	const token = rest.join(" ").trim();

	return token.length > 0 ? token : null;
}

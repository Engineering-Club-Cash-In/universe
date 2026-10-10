/**
 * W2 (Workspace de cobros) · Reglas puras de la rebaja de mora. Sin base de
 * datos ni red: el servicio y el router las usan, y así se prueban aisladas.
 */

/**
 * Estados de cartera con régimen propio: su mora no se rebaja desde aquí.
 * Espejo de `STATUS_EXCLUIDOS_MORA` en cartera-back (constants/creditStatus.ts).
 * Si cambia allá, cambia aquí.
 */
export const ESTADOS_SIN_REBAJA = [
	"EN_CONVENIO",
	"INCOBRABLE",
	"CANCELADO",
	"PENDIENTE_CANCELACION",
	"CAIDO",
] as const;

/** Monto como centavos enteros: evita comparar flotantes. */
export function aCentavos(monto: string | number): number {
	return Math.round(Number(monto) * 100);
}

/** Q1,234.50 para el usuario. */
export function quetzalesRebaja(monto: string | number): string {
	return `Q${Number(monto).toLocaleString("en-US", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})}`;
}

/** Forma del error HTTP de cartera (`CarteraBackHttpError`), solo lo que se usa. */
export interface ErrorCarteraRebaja {
	status: number | null;
	payload?:
		| { kind?: string; message?: string; mora_actual?: string }
		| undefined;
}

export type ClasificacionErrorCartera =
	| { tipo: "definitivo"; motivo: string }
	| { tipo: "transitorio"; motivo: string };

function sinErrorPrefijo(texto: string | undefined): string | null {
	const limpio = texto?.replace(/^\[(ERROR|INFO)\]\s*/, "").trim();
	return limpio ? limpio : null;
}

/**
 * Decide si un fallo de cartera al aplicar la rebaja es definitivo (la solicitud
 * se rechaza, porque reintentar no cambia nada) o transitorio (se deja para
 * reintentar). Un error de configuración o de red nunca rechaza la rebaja.
 */
export function clasificarErrorCartera(
	error: ErrorCarteraRebaja,
): ClasificacionErrorCartera {
	const { status, payload } = error;
	const kind = payload?.kind;

	if (kind === "excede_mora") {
		return {
			tipo: "definitivo",
			motivo: `La mora ya no alcanza para esta rebaja (ahora es ${quetzalesRebaja(payload?.mora_actual ?? "0")}).`,
		};
	}
	if (kind === "excede_devengado" || kind === "estado_no_permitido") {
		return {
			tipo: "definitivo",
			motivo:
				sinErrorPrefijo(payload?.message) ?? "Cartera no permite esta rebaja.",
		};
	}
	if (kind === "not_found") {
		return {
			tipo: "definitivo",
			motivo: "El crédito ya no tiene mora activa que rebajar.",
		};
	}
	if (kind === "usuario_no_encontrado") {
		return {
			tipo: "transitorio",
			motivo:
				"El supervisor no tiene usuario en cartera. Avise a sistemas; la aprobación se puede repetir cuando se corrija.",
		};
	}
	if (status === null) {
		return {
			tipo: "transitorio",
			motivo: "No se pudo comunicar con cartera. Puede aprobarla de nuevo.",
		};
	}
	if (status === 401 || status === 403) {
		return {
			tipo: "transitorio",
			motivo:
				"Cartera no autorizó al CRM. Revise la cuenta de servicio (CRM_SERVICE_USER_ID); la aprobación se puede repetir cuando se corrija.",
		};
	}
	if (status === 404 && !kind) {
		return {
			tipo: "transitorio",
			motivo:
				"Cartera no tiene el endpoint de rebaja. Revise el despliegue; la aprobación se puede repetir.",
		};
	}
	if (status === 408 || status === 429 || status >= 500) {
		return {
			tipo: "transitorio",
			motivo: "Cartera no respondió. Puede aprobarla de nuevo.",
		};
	}
	return {
		tipo: "definitivo",
		motivo: sinErrorPrefijo(payload?.message) ?? "Cartera rechazó la rebaja.",
	};
}

/**
 * Una aprobación que quedó en `aprobada` más de `umbralMs` sin cerrarse: el
 * proceso se cayó entre el reclamo y la respuesta de cartera.
 */
export function esAprobacionColgada(
	resueltoEn: Date | null,
	ahora: Date,
	umbralMs: number,
): boolean {
	if (!resueltoEn) return false;
	return ahora.getTime() - resueltoEn.getTime() >= umbralMs;
}

export const UMBRAL_APROBACION_COLGADA_MS = 10 * 60 * 1000;

/**
 * Plazo de toda la llamada a cartera al aplicar una rebaja (token + POST). Tiene
 * que ser MUY menor que el umbral de colgada: el job solo puede devolver a
 * `error_aplicacion` una aprobación cuyo POST ya no puede despacharse.
 */
export const PLAZO_APLICACION_REBAJA_MS = 3 * 60 * 1000;

/**
 * Espera antes de poder rechazar una rebaja que quedó en `error_aplicacion`.
 * Un handler de cartera que sigue en la cola del lock puede escribir hasta que
 * vence su espera, y el CRM corta su llamada a los 3 min (después de eso el
 * handler ya no confirma). Pasado ese plazo más un margen, ningún intento vivo
 * puede aplicar la rebaja tras un rechazo, aunque la conciliación no la vea.
 */
export const ESPERA_RECHAZO_TRAS_ERROR_MS =
	PLAZO_APLICACION_REBAJA_MS + 60 * 1000;

/** `resueltoEn` es el instante del último intento de aplicación. */
export function puedeRechazarTrasError(
	resueltoEn: Date | null,
	ahora: Date,
): boolean {
	if (!resueltoEn) return true;
	return ahora.getTime() - resueltoEn.getTime() >= ESPERA_RECHAZO_TRAS_ERROR_MS;
}

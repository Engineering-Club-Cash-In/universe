export type DatosPersonaAutomaticaComparables = {
	activo: boolean;
	leadId: string | null;
	numeroCreditoSifco: string | null;
	nombres: string;
	apellidos: string;
	dpi: string | null;
	nit: string | null;
	telefono: string | null;
	direccion: string | null;
	categoria: string;
	motivo: string;
	desactivadoPor: string | null;
	desactivadoAt: Date | null;
	motivoDesactivacion: string | null;
};

const CAMPOS_PERSONA_AUTOMATICA = [
	"activo",
	"leadId",
	"numeroCreditoSifco",
	"nombres",
	"apellidos",
	"dpi",
	"nit",
	"telefono",
	"direccion",
	"categoria",
	"motivo",
	"desactivadoPor",
	"desactivadoAt",
	"motivoDesactivacion",
] as const satisfies ReadonlyArray<keyof DatosPersonaAutomaticaComparables>;

function mismoValor(a: unknown, b: unknown): boolean {
	if (a instanceof Date || b instanceof Date) {
		if (!(a instanceof Date) || !(b instanceof Date)) return false;
		return a.getTime() === b.getTime();
	}
	return a === b;
}

/** Evita mover `updated_at` cuando una sincronización no cambió la ficha. */
export function cambioPersonaAutomatica(
	actual: DatosPersonaAutomaticaComparables,
	deseada: DatosPersonaAutomaticaComparables,
): boolean {
	return CAMPOS_PERSONA_AUTOMATICA.some(
		(campo) => !mismoValor(actual[campo], deseada[campo]),
	);
}

export type DecisionPersistenciaAutomatica =
	| "crear"
	| "actualizar"
	| "reactivar";

/** Una ficha manual activa siempre tiene precedencia sobre la automática. */
export function esFichaManualActiva(
	persona: { activo: boolean; origen: string } | null,
): boolean {
	return persona?.activo === true && persona.origen === "manual";
}

export function decidirPersistenciaAutomatica(input: {
	automatica: { activo: boolean } | null;
}): DecisionPersistenciaAutomatica {
	if (!input.automatica) return "crear";
	return input.automatica.activo ? "actualizar" : "reactivar";
}

export type DatosFuenteCarteraComparables = {
	personaId: string;
	numeroCreditoSifco: string;
	estadoCredito: string;
	categoria: string;
	motivo: string;
	evidencia: Record<string, unknown>;
};

function mismoJson(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (Array.isArray(a) || Array.isArray(b)) {
		return (
			Array.isArray(a) &&
			Array.isArray(b) &&
			a.length === b.length &&
			a.every((valor, indice) => mismoJson(valor, b[indice]))
		);
	}
	if (
		typeof a !== "object" ||
		a === null ||
		typeof b !== "object" ||
		b === null
	) {
		return false;
	}
	const clavesA = Object.keys(a).sort();
	const clavesB = Object.keys(b).sort();
	return (
		clavesA.length === clavesB.length &&
		clavesA.every(
			(clave, indice) =>
				clave === clavesB[indice] &&
				mismoJson(
					(a as Record<string, unknown>)[clave],
					(b as Record<string, unknown>)[clave],
				),
		)
	);
}

/** Evita actualizar observado_at/updated_at cuando la fuente no cambió. */
export function cambioFuenteCartera(
	actual: DatosFuenteCarteraComparables,
	deseada: DatosFuenteCarteraComparables,
): boolean {
	return (
		actual.personaId !== deseada.personaId ||
		actual.numeroCreditoSifco !== deseada.numeroCreditoSifco ||
		actual.estadoCredito !== deseada.estadoCredito ||
		actual.categoria !== deseada.categoria ||
		actual.motivo !== deseada.motivo ||
		!mismoJson(actual.evidencia, deseada.evidencia)
	);
}

/**
 * Reconciliación perezosa: incluye las coincidencias actuales y, de las fichas
 * automáticas que coinciden con el candidato, solo sus usuarios aún riesgosos.
 */
export function usuariosParaSincronizacionAutomatica(input: {
	usuariosCoincidentes: Iterable<number>;
	personasCoincidentes: Iterable<string>;
	usuariosPorPersona: ReadonlyMap<string, Iterable<number>>;
	usuariosConRiesgo: Iterable<number>;
}): number[] {
	const resultado = new Set(input.usuariosCoincidentes);
	const usuariosConRiesgo = new Set(input.usuariosConRiesgo);
	for (const personaId of input.personasCoincidentes) {
		for (const usuarioId of input.usuariosPorPersona.get(personaId) ?? []) {
			if (usuariosConRiesgo.has(usuarioId)) resultado.add(usuarioId);
		}
	}
	return [...resultado].sort((a, b) => a - b);
}

export class EvaluacionBuroInternoInestableError extends Error {
	constructor() {
		super(
			"El buró interno cambió repetidamente durante la evaluación. Recarga la oportunidad e intenta de nuevo.",
		);
		this.name = "EvaluacionBuroInternoInestableError";
	}
}

/**
 * Obtiene una evaluación asociada a una huella estable. La primera pasada puede
 * crear o reactivar fichas automáticas; en ese caso se repite sobre la foto ya
 * sincronizada. Un cambio externo concurrente también obliga a reevaluar.
 */
export async function evaluarConHuellaEstable<T>(parametros: {
	huellaInicial: string;
	obtenerHuella: () => Promise<string>;
	evaluar: () => Promise<T>;
	maxIntentos?: number;
}): Promise<{ evaluacion: T; huella: string; intentos: number }> {
	let huellaAntes = parametros.huellaInicial;
	const maxIntentos = parametros.maxIntentos ?? 3;

	for (let intento = 1; intento <= maxIntentos; intento += 1) {
		const evaluacion = await parametros.evaluar();
		const huellaDespues = await parametros.obtenerHuella();
		if (huellaAntes === huellaDespues) {
			return { evaluacion, huella: huellaDespues, intentos: intento };
		}
		huellaAntes = huellaDespues;
	}

	throw new EvaluacionBuroInternoInestableError();
}

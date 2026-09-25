/**
 * Normalización compartida para placas provenientes de SAT, CRM y Cartera.
 */
export const PREFIJOS_PLACA_SAT = [
	"00",
	"A0",
	"C0",
	"CC",
	"CD",
	"DIS",
	"M0",
	"MI",
	"MT",
	"O0",
	"P0",
	"TC",
	"TE",
	"TRC",
	"U0",
] as const;

export function normalizarPlaca(value: string | null | undefined): string {
	return (value ?? "")
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, "");
}

function agregarClave(claves: string[], valor: string) {
	if (valor && !claves.includes(valor)) claves.push(valor);
}

function prefijoCanonico(prefijo: string) {
	const equivalencias: Record<string, string> = {
		0: "00",
		A: "A0",
		C: "C0",
		M: "M0",
		O: "O0",
		P: "P0",
		U: "U0",
	};
	return equivalencias[prefijo] ?? prefijo;
}

function componentesPlaca(value: string | null | undefined) {
	const original = value ?? "";
	const normalizada = normalizarPlaca(original);
	if (!normalizada) return [];

	const componentes: { prefijo: string; sufijo: string }[] = [];
	const indiceGuion = original.indexOf("-");
	if (indiceGuion >= 0) {
		const prefijo = normalizarPlaca(original.slice(0, indiceGuion));
		const sufijo = normalizarPlaca(original.slice(indiceGuion + 1));
		if (prefijo && sufijo) {
			componentes.push({ prefijo: prefijoCanonico(prefijo), sufijo });
		}
		return componentes;
	}

	const prefijos = [...PREFIJOS_PLACA_SAT].sort((a, b) => b.length - a.length);
	for (const prefijo of prefijos) {
		if (normalizada.startsWith(prefijo)) {
			componentes.push({
				prefijo: prefijoCanonico(prefijo),
				sufijo: normalizada.slice(prefijo.length),
			});
		}
		// Algunos códigos terminan en 0, pero el CRM puede guardar solo la
		// letra antes del correlativo: P272LVD, C661CDJ, etc.
		if (prefijo.endsWith("0")) {
			const prefijoCorto = prefijo.slice(0, -1);
			if (prefijoCorto && normalizada.startsWith(prefijoCorto)) {
				componentes.push({
					prefijo: prefijoCanonico(prefijoCorto),
					sufijo: normalizada.slice(prefijoCorto.length),
				});
			}
		}
	}

	return componentes;
}

/** Devuelve los correlativos compatibles de una placa. */
export function clavesSufijoPlaca(value: string | null | undefined): string[] {
	const normalizada = normalizarPlaca(value);
	if (!normalizada) return [];

	const claves: string[] = [];
	for (const componente of componentesPlaca(value)) {
		agregarClave(claves, componente.sufijo);
	}
	agregarClave(claves, normalizada);
	return claves;
}

/**
 * Conserva el prefijo cuando es reconocible. El correlativo desnudo se
 * expone únicamente mediante `clavesSufijoPlaca`; nunca debe ser una clave
 * de cruce porque P-123ABC y C-123ABC pueden pertenecer a vehículos distintos.
 */
export function clavesPlaca(value: string | null | undefined): string[] {
	const claves: string[] = [];
	for (const componente of componentesPlaca(value)) {
		agregarClave(
			claves,
			`prefijo:${componente.prefijo}|sufijo:${componente.sufijo}`,
		);
	}
	return claves;
}

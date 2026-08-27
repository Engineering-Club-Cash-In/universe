export type OtrosParseResult =
	| { valid: true; value: string }
	| { valid: false };

const MONTO_POSITIVO = /^(?:[1-9]\d*)(?:\.\d{1,2})?$|^0\.(?:0?[1-9]|[1-9]\d)$/;

export function parseOtrosGTQ(raw: string): OtrosParseResult {
	const value = raw.trim();
	if (!MONTO_POSITIVO.test(value)) return { valid: false };
	const [integer, decimal = ""] = value.split(".");
	return { valid: true, value: `${integer}.${decimal.padEnd(2, "0")}` };
}

const aCentavos = (value: string): bigint => {
	const [entero, decimal = ""] = value.split(".");
	return BigInt(entero) * 100n + BigInt(decimal.padEnd(2, "0").slice(0, 2));
};

/** El total facturable contiene Otros; historial lo desglosa por separado. */
export function facturableSinOtrosGTQ(
	facturableTotal: string,
	otrosTotal: string,
): string {
	const centavos = aCentavos(facturableTotal) - aCentavos(otrosTotal);
	const seguro = centavos > 0n ? centavos : 0n;
	return `${seguro / 100n}.${(seguro % 100n).toString().padStart(2, "0")}`;
}

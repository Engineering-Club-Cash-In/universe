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

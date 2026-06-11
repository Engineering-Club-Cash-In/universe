/**
 * Valida un CUI/DPI guatemalteco usando el algoritmo del complemento 11.
 * Verifica formato, departamento, municipio y dígito verificador.
 */
export function cuiValido(cui: string | null | undefined): boolean {
	if (!cui) {
		return false;
	}

	const cuiRegExp = /^[0-9]{4}\s?[0-9]{5}\s?[0-9]{4}$/;

	if (!cuiRegExp.test(cui)) {
		return false;
	}

	const cuiLimpio = cui.replace(/\s/g, "");
	const depto = Number.parseInt(cuiLimpio.substring(9, 11), 10);
	const muni = Number.parseInt(cuiLimpio.substring(11, 13), 10);
	const numero = cuiLimpio.substring(0, 8);
	const verificador = Number.parseInt(cuiLimpio.substring(8, 9), 10);

	const munisPorDepto = [
		17, // 01 - Guatemala
		8, // 02 - El Progreso
		16, // 03 - Sacatepéquez
		16, // 04 - Chimaltenango
		13, // 05 - Escuintla
		14, // 06 - Santa Rosa
		19, // 07 - Sololá
		8, // 08 - Totonicapán
		24, // 09 - Quetzaltenango
		21, // 10 - Suchitepéquez
		9, // 11 - Retalhuleu
		30, // 12 - San Marcos
		32, // 13 - Huehuetenango
		21, // 14 - Quiché
		8, // 15 - Baja Verapaz
		17, // 16 - Alta Verapaz
		14, // 17 - Petén
		5, // 18 - Izabal
		11, // 19 - Zacapa
		11, // 20 - Chiquimula
		7, // 21 - Jalapa
		17, // 22 - Jutiapa
	];

	if (depto === 0 || muni === 0) {
		return false;
	}

	if (depto > munisPorDepto.length) {
		return false;
	}

	if (muni > munisPorDepto[depto - 1]) {
		return false;
	}

	let total = 0;
	for (let i = 0; i < numero.length; i++) {
		total += Number.parseInt(numero[i], 10) * (i + 2);
	}

	const modulo = total % 11;

	return modulo === verificador;
}

/**
 * Normaliza un DPI: elimina espacios y valida.
 * Retorna el DPI limpio si es válido, o lanza el mensaje de error.
 */
export function normalizarYValidarDpi(dpi: string): string {
	const dpiLimpio = dpi.replace(/\s/g, "");

	if (dpiLimpio.length !== 13) {
		return "DPI inválido, debe tener 13 dígitos";
	}

	if (!cuiValido(dpiLimpio)) {
		return "DPI inválido, el número no corresponde a un CUI guatemalteco válido";
	}

	return dpiLimpio;
}

/**
 * Valida un DPI y retorna el resultado estructurado.
 * Útil para distinguir entre éxito y error.
 */
export function validarDpi(dpi: string): { valid: true; dpiLimpio: string } | { valid: false; error: string } {
	const dpiLimpio = dpi.replace(/\s/g, "");

	if (dpiLimpio.length !== 13) {
		return { valid: false, error: "DPI inválido, debe tener 13 dígitos" };
	}

	if (!cuiValido(dpiLimpio)) {
		return { valid: false, error: "DPI inválido, el número no corresponde a un CUI guatemalteco válido" };
	}

	return { valid: true, dpiLimpio };
}

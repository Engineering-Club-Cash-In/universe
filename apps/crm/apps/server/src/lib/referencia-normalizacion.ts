import { cuiValido } from "../utils/cui-validation";

/**
 * Reglas puras para reconocer a la misma persona como referencia de dos
 * clientes (EXTRAIT-267): normalización de DPI y teléfono, y la decisión de si
 * dos referencias son la misma. Sin base de datos; la búsqueda vive en
 * `referencia-duplicada.ts`.
 *
 * No reutiliza `normalizarDpiMatch` ni `normalizarTelefonoMatch` del buró
 * (`buro-interno-match.ts`): aceptan 13 dígitos sin verificador y toman los
 * últimos 8 de TODO el texto, sin separar números, quitar extensiones ni
 * descartar relleno. Ver «diferencias con el buró interno» en las pruebas.
 */

export type CoincidePor = "dpi" | "telefono";

type Valor = string | number | null | undefined;

export type ReferenciaComparable = {
	dpi?: Valor;
	telefono?: Valor;
};

/** Guatemala: el teléfono se compara por sus últimos 8 dígitos (ignora +502). */
const DIGITOS_TELEFONO = 8;
const DIGITOS_DPI = 13;

/** Solo dígitos y CUI válido (con verificador): 0000000000000 es «sin DPI», no decide nada. */
export function normalizarDpiReferencia(valor?: Valor): string | null {
	const digitos = String(valor ?? "").replace(/\D/g, "");
	return digitos.length === DIGITOS_DPI && cuiValido(digitos) ? digitos : null;
}

/**
 * Números de relleno (alertas falsas entre desconocidos): un dígito repetido
 * (00000000), secuencias (12345678, 87654321) y bloques de 2 o 4 (12121212).
 */
export function esTelefonoRelleno(telefono8: string): boolean {
	if (/^(\d)\1+$/.test(telefono8)) return true;
	if (/^(\d\d)\1+$/.test(telefono8) || /^(\d{4})\1$/.test(telefono8))
		return true;
	const pasos = [...telefono8]
		.map(Number)
		.map((d, i, a) => d - (a[i - 1] ?? d));
	const diferencias = new Set(pasos.slice(1));
	return diferencias.size === 1 && (diferencias.has(1) || diferencias.has(-1));
}

/** Extensión («ext 123», «extensión 4», «x45»): no es parte del número. */
const EXTENSION = /\b(?:ext(?:ensi[oó]n)?|x)\.?\s*:?\s*\d+/gi;
/** Prefijo internacional de Guatemala («+502», «00502», «(502)») como grupo de dígitos propio. */
const PREFIJO_PAIS = /^(?:00)?502$/;
/** Separadores entre varios números en un mismo campo: / , ; | salto de línea « y » « o ». */
const SEPARADOR_DE_NUMEROS = /[/,;|\n]|\s(?:y|o)\s/i;

/**
 * Los teléfonos comparables de un campo: sin extensiones, uno por cada número
 * (el campo puede traer varios), cada uno reducido a sus últimos 8 dígitos.
 *
 * Tras partir por los separadores, cada parte se lee por grupos de dígitos
 * (cualquier no-dígito corta un grupo) y se van sumando hasta juntar 8 o más:
 * ahí sale un número y se reinicia. Así «+502 5555 1234» es uno solo, y
 * «5555-1234 4444-5678» o «casa: 2298-7766 cel: 5432-1987» son dos. Lo que
 * sobre con menos de 8 dígitos se descarta, igual que los números de relleno.
 * Un grupo «502» o «00502» al inicio de un número es el código de país y se
 * ignora. Límite conocido: texto libre con dígitos sueltos antes del número
 * («desde 2019 5555 1234») no se puede separar.
 */
export function telefonosDeReferencia(valor?: Valor): string[] {
	const telefonos = new Set<string>();
	for (const trozo of String(valor ?? "")
		.replace(EXTENSION, " ")
		.split(SEPARADOR_DE_NUMEROS)) {
		let acumulado = "";
		const grupos = trozo.match(/\d+/g) ?? [];
		for (const [i, grupo] of grupos.entries()) {
			// Código de país de Guatemala al inicio de un número: no es parte de él.
			if (
				acumulado === "" &&
				PREFIJO_PAIS.test(grupo) &&
				i < grupos.length - 1
			) {
				continue;
			}
			acumulado += grupo;
			if (acumulado.length < DIGITOS_TELEFONO) continue;
			const telefono = acumulado.slice(-DIGITOS_TELEFONO);
			if (!esTelefonoRelleno(telefono)) telefonos.add(telefono);
			acumulado = "";
		}
	}
	return [...telefonos];
}

/**
 * Si ambos lados tienen DPI válido, manda el DPI: iguales coinciden y distintos
 * NO coinciden aunque compartan teléfono (un teléfono de casa lo comparte gente
 * distinta). Si alguno no tiene DPI válido, se respalda por teléfono.
 */
export function coincidenciaReferencia(
	a: ReferenciaComparable,
	b: ReferenciaComparable,
): CoincidePor | null {
	const dpiA = normalizarDpiReferencia(a.dpi);
	const dpiB = normalizarDpiReferencia(b.dpi);
	if (dpiA && dpiB) return dpiA === dpiB ? "dpi" : null;

	const telefonosB = new Set(telefonosDeReferencia(b.telefono));
	return telefonosDeReferencia(a.telefono).some((t) => telefonosB.has(t))
		? "telefono"
		: null;
}

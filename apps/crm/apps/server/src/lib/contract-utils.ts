/**
 * Utilidades para generación de contratos legales
 */

// Unidades en español
const UNIDADES = [
	"",
	"uno",
	"dos",
	"tres",
	"cuatro",
	"cinco",
	"seis",
	"siete",
	"ocho",
	"nueve",
];

const ESPECIALES = [
	"diez",
	"once",
	"doce",
	"trece",
	"catorce",
	"quince",
	"dieciséis",
	"diecisiete",
	"dieciocho",
	"diecinueve",
];

const DECENAS = [
	"",
	"diez",
	"veinte",
	"treinta",
	"cuarenta",
	"cincuenta",
	"sesenta",
	"setenta",
	"ochenta",
	"noventa",
];

const CENTENAS = [
	"",
	"ciento",
	"doscientos",
	"trescientos",
	"cuatrocientos",
	"quinientos",
	"seiscientos",
	"setecientos",
	"ochocientos",
	"novecientos",
];

const MESES = [
	"enero",
	"febrero",
	"marzo",
	"abril",
	"mayo",
	"junio",
	"julio",
	"agosto",
	"septiembre",
	"octubre",
	"noviembre",
	"diciembre",
];

/**
 * Convierte un número entre 0 y 99 a palabras
 */
function convertirDecenas(n: number): string {
	if (n < 10) return UNIDADES[n];
	if (n < 20) return ESPECIALES[n - 10];
	if (n === 20) return "veinte";
	if (n < 30) return `veinti${UNIDADES[n % 10]}`;

	const decena = Math.floor(n / 10);
	const unidad = n % 10;

	if (unidad === 0) return DECENAS[decena];
	return `${DECENAS[decena]} y ${UNIDADES[unidad]}`;
}

/**
 * Convierte un número entre 0 y 999 a palabras
 */
function convertirCentenas(n: number): string {
	if (n === 0) return "";
	if (n === 100) return "cien";
	if (n < 100) return convertirDecenas(n);

	const centena = Math.floor(n / 100);
	const resto = n % 100;

	if (resto === 0) return CENTENAS[centena];
	return `${CENTENAS[centena]} ${convertirDecenas(resto)}`;
}

/**
 * Convierte un número entero a palabras en español
 * Soporta números hasta 999,999,999
 */
export function numberToWords(num: number): string {
	if (num === 0) return "cero";
	if (num < 0) return `menos ${numberToWords(Math.abs(num))}`;
	if (num === 1) return "uno";

	let resultado = "";

	// Millones
	const millones = Math.floor(num / 1000000);
	if (millones > 0) {
		if (millones === 1) {
			resultado = "un millón";
		} else {
			resultado = `${convertirCentenas(millones)} millones`;
		}
		num %= 1000000;
		if (num > 0) resultado += " ";
	}

	// Miles
	const miles = Math.floor(num / 1000);
	if (miles > 0) {
		if (miles === 1) {
			resultado += "mil";
		} else {
			resultado += `${convertirCentenas(miles)} mil`;
		}
		num %= 1000;
		if (num > 0) resultado += " ";
	}

	// Centenas
	if (num > 0) {
		resultado += convertirCentenas(num);
	}

	return resultado.trim();
}

/**
 * Convierte un monto en quetzales a palabras en formato legal
 * Ejemplo: 150000.50 => "ciento cincuenta mil quetzales con cincuenta centavos"
 */
export function numberToWordsQuetzales(amount: number): string {
	const entero = Math.floor(amount);
	const centavos = Math.round((amount - entero) * 100);

	let resultado = `${numberToWords(entero)} quetzales`;

	if (centavos > 0) {
		resultado += ` con ${numberToWords(centavos)} centavos`;
	}

	return resultado;
}

/**
 * Formatea una fecha en formato legal para contratos
 * Ejemplo: "quince de enero del año dos mil veinticinco"
 */
export function formatDateInWords(date: Date): string {
	const day = date.getDate();
	const month = MESES[date.getMonth()];
	const year = date.getFullYear();

	return `${numberToWords(day)} de ${month} del año ${numberToWords(year)}`;
}

/**
 * Obtiene el nombre del mes en español
 */
export function getMonthName(date: Date): string {
	return MESES[date.getMonth()];
}

/**
 * Obtiene los componentes de la fecha para contratos
 */
export function getDateComponents(date: Date): {
	day: string;
	month: string;
	year: string;
	dayNumber: number;
	monthNumber: number;
	yearNumber: number;
} {
	return {
		day: numberToWords(date.getDate()),
		month: MESES[date.getMonth()],
		year: numberToWords(date.getFullYear()),
		dayNumber: date.getDate(),
		monthNumber: date.getMonth() + 1,
		yearNumber: date.getFullYear(),
	};
}

/**
 * Calcula la edad y la retorna en palabras
 */
export function calculateAgeInWords(birthDate: Date): string {
	const today = new Date();
	let age = today.getFullYear() - birthDate.getFullYear();
	const monthDiff = today.getMonth() - birthDate.getMonth();

	if (
		monthDiff < 0 ||
		(monthDiff === 0 && today.getDate() < birthDate.getDate())
	) {
		age--;
	}

	return numberToWords(age);
}

/**
 * Calcula la edad como número
 */
export function calculateAge(birthDate: Date): number {
	const today = new Date();
	let age = today.getFullYear() - birthDate.getFullYear();
	const monthDiff = today.getMonth() - birthDate.getMonth();

	if (
		monthDiff < 0 ||
		(monthDiff === 0 && today.getDate() < birthDate.getDate())
	) {
		age--;
	}

	return age;
}

/**
 * Formatea un DPI guatemalteco con espacios
 * Ejemplo: "1234567890123" => "1234 56789 0123"
 */
export function formatDpi(dpi: string): string {
	const cleanDpi = dpi.replace(/\D/g, "");
	if (cleanDpi.length !== 13) return dpi; // Retornar sin formato si no es válido

	return `${cleanDpi.slice(0, 4)} ${cleanDpi.slice(4, 9)} ${cleanDpi.slice(9)}`;
}

/**
 * Mapea estado civil del CRM al formato legal según género
 */
export function mapMaritalStatus(
	status: string | null,
	gender: string | null,
): string {
	const isFemale = gender === "female";

	switch (status) {
		case "single":
			return isFemale ? "soltera" : "soltero";
		case "married":
			return isFemale ? "casada" : "casado";
		case "divorced":
			return isFemale ? "divorciada" : "divorciado";
		case "widowed":
			return isFemale ? "viuda" : "viudo";
		default:
			return isFemale ? "soltera" : "soltero";
	}
}

/**
 * Mapea género del CRM al formato para contratos
 */
export function mapGender(gender: string | null): string {
	switch (gender) {
		case "male":
			return "masculino";
		case "female":
			return "femenino";
		default:
			return "masculino";
	}
}

/**
 * Formatea nacionalidad según género
 */
export function formatNationality(
	nationality: string | null,
	gender: string | null,
): string {
	if (!nationality) {
		return gender === "female" ? "guatemalteca" : "guatemalteco";
	}

	// Si ya termina en a/o, ajustar según género
	const base = nationality.toLowerCase().replace(/[ao]$/, "");
	return gender === "female" ? `${base}a` : `${base}o`;
}

/**
 * Capitaliza la primera letra de cada palabra
 */
export function capitalizeWords(text: string): string {
	return text
		.toLowerCase()
		.split(" ")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
}

/**
 * Convierte texto a mayúsculas para contratos
 */
export function toUpperCase(text: string | null | undefined): string {
	return (text ?? "").toUpperCase();
}

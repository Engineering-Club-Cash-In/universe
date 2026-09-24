const UNIDADES = [
	"cero",
	"uno",
	"dos",
	"tres",
	"cuatro",
	"cinco",
	"seis",
	"siete",
	"ocho",
	"nueve",
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
	"veinte",
	"veintiuno",
	"veintidós",
	"veintitrés",
	"veinticuatro",
	"veinticinco",
	"veintiséis",
	"veintisiete",
	"veintiocho",
	"veintinueve",
	"treinta",
	"treinta y uno",
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

const DECENAS = [
	"",
	"",
	"veinte",
	"treinta",
	"cuarenta",
	"cincuenta",
	"sesenta",
	"setenta",
	"ochenta",
	"noventa",
];

/** El año en palabras, para los años de contrato (2000–2099). */
function anioEnPalabras(anio: number): string {
	if (anio < 2000 || anio > 2099) return String(anio);

	const resto = anio - 2000;
	if (resto === 0) return "dos mil";
	if (resto < 30) return `dos mil ${UNIDADES[resto]}`;

	const decena = Math.floor(resto / 10);
	const unidad = resto % 10;
	return unidad === 0
		? `dos mil ${DECENAS[decena]}`
		: `dos mil ${DECENAS[decena]} y ${UNIDADES[unidad]}`;
}

/**
 * Una fecha como la escriben los contratos: "nueve de septiembre de dos mil
 * veintiséis".
 *
 * Los templates la meten en una oración ("firmado en esta ciudad el día …"),
 * así que va en minúsculas y sin el año en números.
 *
 * Recibe la fecha como la guarda la base (`YYYY-MM-DD`) y la lee en hora local
 * sin zona: `new Date("2026-09-09")` se interpreta en UTC y en Guatemala
 * devuelve el día anterior.
 */
export function fechaEnPalabras(fecha: string | null | undefined): string {
	if (!fecha) return "";

	const [anio, mes, dia] = fecha.slice(0, 10).split("-").map(Number);
	if (!anio || !mes || !dia) return "";

	return `${UNIDADES[dia] ?? dia} de ${MESES[mes - 1] ?? ""} de ${anioEnPalabras(anio)}`;
}

import type { FichaPrincipalPersona } from "../db/schema/buro";
import type { renapInfo } from "../db/schema/renap";

/**
 * Mientras RENAP no se consulta (`CONSULTAR_RENAP = false`), llena en
 * `renapinfo` solo los campos que RENAP ya traía y que Infornet también trae.
 * Nombres y apellidos van completos en el primer campo: Infornet los entrega
 * en un solo texto y partirlos rompería nombres como "DE LEON".
 */
export function mapearFichaInfornetARenap(
	dpi: string,
	ficha: FichaPrincipalPersona,
): typeof renapInfo.$inferInsert | null {
	const nombres = texto(ficha.nombres);
	const apellidos = texto(ficha.apellidos);
	if (!nombres || !apellidos) return null;

	const lugar = separarLugarNacimiento(ficha.lugarNacimiento);

	return {
		dpi,
		firstName: nombres,
		firstLastName: apellidos,
		gender: mapearSexo(ficha.sexo),
		birthDate: mapearFechaNacimiento(ficha.fechaNacimiento),
		municipalityBornedIn: lugar?.municipio ?? null,
		departmentBornedIn: lugar?.departamento ?? null,
		bornedIn: texto(ficha.pais),
		ocupation: texto(ficha.profesion),
	};
}

/** Recorta a 100, el largo de las columnas de texto de `renapinfo` */
function texto(valor: string | null | undefined): string | null {
	const limpio = valor?.trim();
	return limpio ? limpio.slice(0, 100) : null;
}

function mapearSexo(sexo: string | null | undefined): "M" | "F" | null {
	const valor = sexo?.trim().toUpperCase();
	if (valor === "MASCULINO") return "M";
	if (valor === "FEMENINO") return "F";
	return null;
}

/** `dd/mm/aaaa` → `aaaa-mm-dd`; fechas aproximadas ("APROX 12/1998") o inválidas quedan vacías */
function mapearFechaNacimiento(
	fecha: string | null | undefined,
): string | null {
	const partes = fecha?.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
	if (!partes) return null;

	const [, dia, mes, anio] = partes;
	const utc = new Date(Date.UTC(Number(anio), Number(mes) - 1, Number(dia)));
	const esValida =
		utc.getUTCFullYear() === Number(anio) &&
		utc.getUTCMonth() === Number(mes) - 1 &&
		utc.getUTCDate() === Number(dia);

	return esValida ? `${anio}-${mes}-${dia}` : null;
}

/** "MUNICIPIO, DEPTO"; valores sin coma ("-NA-", "EXTRANJEROS NATURALIZADOS") no se pueden separar */
function separarLugarNacimiento(
	lugar: string | null | undefined,
): { municipio: string; departamento: string } | null {
	const indiceComa = lugar?.indexOf(",") ?? -1;
	if (!lugar || indiceComa === -1) return null;

	const municipio = texto(lugar.slice(0, indiceComa));
	const departamento = texto(lugar.slice(indiceComa + 1));
	return municipio && departamento ? { municipio, departamento } : null;
}

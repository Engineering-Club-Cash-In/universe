import type {
	DocumentoIdentidad,
	FichaPrincipalPersona,
} from "../db/schema/buro";
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
	documentos: DocumentoIdentidad[] = [],
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
		civilStatus: mapearEstadoCivil(ficha.estadoCivil),
		birthDate: mapearFecha(ficha.fechaNacimiento),
		dpiExpiracyDate: mapearVencimientoDpi(dpi, documentos),
		municipalityBornedIn: lugar?.municipio ?? null,
		departmentBornedIn: lugar?.departamento ?? null,
		bornedIn: texto(ficha.pais),
		nationality: texto(ficha.nacionalidad),
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
	if (valor === "MASCULINO" || valor === "M") return "M";
	if (valor === "FEMENINO" || valor === "F") return "F";
	return null;
}

function mapearEstadoCivil(
	estadoCivil: string | null | undefined,
): "S" | "C" | null {
	const valor = estadoCivil?.trim().toUpperCase();
	if (valor === "CASADO" || valor === "CASADA" || valor === "C") return "C";
	if (valor === "SOLTERO" || valor === "SOLTERA" || valor === "S") return "S";
	return null;
}

/** `dd/mm/aaaa` → `aaaa-mm-dd`; fechas aproximadas o inválidas quedan vacías */
function mapearFecha(
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

function mapearVencimientoDpi(
	dpiSolicitado: string,
	documentos: DocumentoIdentidad[],
): string | null {
	const dpiNormalizado = soloDigitos(dpiSolicitado);
	const fechas = documentos
		.filter(
			(documento) =>
				documento.tipo.trim().toUpperCase() === "DPI" &&
				soloDigitos(documento.numero) === dpiNormalizado,
		)
		.map((documento) => mapearFecha(documento.fechaVencimiento))
		.filter((fecha): fecha is string => Boolean(fecha))
		.sort();

	return fechas[fechas.length - 1] ?? null;
}

function soloDigitos(valor: string | null | undefined): string {
	return valor?.replace(/\D/g, "") ?? "";
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

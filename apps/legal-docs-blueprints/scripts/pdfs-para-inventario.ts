/**
 * Genera en local los PDF de los contratos que haya que inspeccionar, para
 * poder declarar sus `bloques` de firma sin subir nada a R2 ni mandar nada a
 * WeeTrust.
 *
 * `inventario-firmas.ts` baja PDF que producción ya generó. Para los contratos
 * de inversión no sirve: se vienen generando por el camino viejo desde la app
 * legal-documents, y lo que hay en R2 son contratos de clientes reales. Esto
 * los rehace con datos de prueba, que para el layout da igual: las líneas de
 * firma son texto fijo del template, no dependen de los datos.
 *
 *   bun scripts/pdfs-para-inventario.ts <dirSalida> [tipo...]
 *
 * Sin tipos hace todos los de inversiones (individual y sociedad). Cada PDF
 * sale como `<contractType>.pdf`, que es el nombre que esperan
 * `inventario-firmas.ts --dir` y `verificar-layout-firmas.ts`.
 *
 * Sólo escribe en el directorio que se le pase.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import { contractGenerator } from "../services/ContractGeneratorService";
import type { ContractType } from "../types/contract";

const TEMPLATES_DIR = path.join(__dirname, "..", "templates");
const GOTENBERG_URL = process.env.GOTENBERG_URL || "http://localhost:3000";

/** Los contratos cuyo template vive bajo una de estas carpetas. */
const CARPETAS_DE_INVERSIONES = ["inversiones/", "inversiones_Sociedad/"];

/**
 * Datos de relleno. docxtemplater revienta si un tag no existe en el scope, así
 * que el generador le pone un `parser` que devuelve "- " para lo que falte;
 * acá se usa el mismo, de modo que un template con campos nuevos no rompe el
 * inventario. Lo único que hay que darle de verdad son los bucles (`{#...}`):
 * una sección sin arreglo se renderiza vacía y desaparecerían las filas que
 * llevan línea de firma.
 */
const DATOS_DE_PRUEBA: Record<string, unknown> = {
	nombreCompleto: "NOMBRE DE PRUEBA",
	beneficiarios: [
		{
			nombreCompleto: "BENEFICIARIO DE PRUEBA",
			parentesco: "HERMANO",
			porcentaje: "100",
		},
	],
	creditos: [{ numero: "0000000000", monto: "1.00" }],
	firmantesFilas: [
		{
			col1nombreCompleto: "NOMBRE DE PRUEBA",
			col1dpi: "0000000000000",
			tieneCol2: false,
		},
	],
};

/** Mismas opciones de renderizado que usa el generador en producción. */
function renderizar(templateContent: string): Buffer {
	const doc = new Docxtemplater(new PizZip(templateContent), {
		paragraphLoop: true,
		linebreaks: true,
		nullGetter: () => "-",
		parser: (tag: string) => ({
			get: (scope: Record<string, unknown>) => {
				const value = scope[tag];
				if (value === null || value === undefined || value === "") return "- ";
				return value;
			},
		}),
	});
	doc.render(DATOS_DE_PRUEBA);
	return doc.getZip().generate({
		type: "nodebuffer",
		compression: "DEFLATE",
		mimeType:
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	});
}

async function aPdf(docxBuffer: Buffer): Promise<Buffer> {
	const form = new FormData();
	form.append(
		"file",
		new Blob([new Uint8Array(docxBuffer)], {
			type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		}),
		"contract.docx",
	);

	const res = await fetch(`${GOTENBERG_URL}/forms/libreoffice/convert`, {
		method: "POST",
		body: form,
		signal: AbortSignal.timeout(120_000),
	});
	if (!res.ok) {
		throw new Error(`Gotenberg respondió ${res.status}: ${await res.text()}`);
	}
	return Buffer.from(await res.arrayBuffer());
}

async function main() {
	const [dirSalida, ...tipos] = process.argv.slice(2);
	if (!dirSalida) {
		console.error(
			"uso: bun scripts/pdfs-para-inventario.ts <dirSalida> [tipo...]",
		);
		process.exit(1);
	}

	const configs = contractGenerator.listAvailableContracts();
	const aGenerar = tipos.length
		? configs.filter((c) => tipos.includes(c.type))
		: configs.filter((c) =>
				CARPETAS_DE_INVERSIONES.some((carpeta) =>
					c.templateFilename.startsWith(carpeta),
				),
			);

	if (aGenerar.length === 0) {
		console.error("No hay contratos que generar con ese filtro.");
		process.exit(1);
	}

	await fs.mkdir(dirSalida, { recursive: true });
	console.log(`Generando ${aGenerar.length} PDF en ${dirSalida}\n`);

	const fallos: string[] = [];
	for (const config of aGenerar) {
		const tipo = config.type as ContractType;
		try {
			const templatePath = path.join(TEMPLATES_DIR, config.templateFilename);
			const templateContent = await fs.readFile(templatePath, "binary");
			const pdf = await aPdf(renderizar(templateContent));
			await fs.writeFile(path.join(dirSalida, `${tipo}.pdf`), pdf);
			console.log(`  ✓ ${tipo}`);
		} catch (error) {
			fallos.push(tipo);
			console.log(`  ✗ ${tipo}: ${(error as Error).message}`);
		}
	}

	if (fallos.length) {
		console.log(`\n${fallos.length} sin generar: ${fallos.join(", ")}`);
		process.exit(1);
	}
}

main();

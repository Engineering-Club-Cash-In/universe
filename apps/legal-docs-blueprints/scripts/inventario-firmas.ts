/**
 * Inventario de firmas: reporta, por contrato, cuántos widgets de firma tiene
 * el PDF **renderizado** y qué texto los acompaña.
 *
 * Existe porque el orden de los widgets no se puede deducir del DOCX: los
 * bloques de firma viven en tablas, y el texto plano del XML no refleja la
 * disposición visual. Sólo el PDF renderizado dice la verdad.
 *
 * Es sólo lectura: descarga (o lee) y analiza. No genera ni sube nada.
 *
 *   bun scripts/inventario-firmas.ts <claves.txt> [dirSalida]
 *   bun scripts/inventario-firmas.ts <dirConPdfs>
 *
 * En la primera forma, <claves.txt> tiene una línea por contrato con el formato
 * `contractType|bucket/key` y los PDF se bajan de R2. En la segunda se leen de
 * un directorio local, donde cada archivo se llama `<contractType>.pdf`: es lo
 * que deja `pdfs-para-inventario.ts` para los contratos que todavía no tienen
 * ningún PDF nuestro en R2.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignaturePattern } from "../services/signaturePatterns";
import { WeeTrustService } from "../services/WeeTrustService";
import type { ContractType } from "../types/contract";

/** Una línea de firma detectada, con el texto que la acompaña debajo. */
interface Widget {
	page: number;
	x: number;
	y: number;
	debajo: string[];
}


function r2(): S3Client {
	const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
	if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
		throw new Error("Faltan credenciales de R2 en el entorno");
	}
	return new S3Client({
		region: "auto",
		endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
		credentials: {
			accessKeyId: R2_ACCESS_KEY_ID,
			secretAccessKey: R2_SECRET_ACCESS_KEY,
		},
	});
}

async function descargar(client: S3Client, r2Key: string): Promise<Buffer> {
	// r2Key viene como "bucket/path/al/archivo.pdf"
	const slash = r2Key.indexOf("/");
	const Bucket = r2Key.slice(0, slash);
	const Key = r2Key.slice(slash + 1);
	const res = await client.send(new GetObjectCommand({ Bucket, Key }));
	return Buffer.from(await res.Body!.transformToByteArray());
}

/**
 * Las líneas de firma del PDF, reconocidas con el MISMO criterio que usa
 * producción para colocar los widgets. Una regex propia acá se desfasaba (no
 * veía "F_____", líneas sueltas ni etiquetas como "Firma del Inversionista") y
 * el inventario reportaba cero justo en los contratos que había que auditar.
 */
async function widgetsDelPdf(
	buffer: Buffer,
	contractType: ContractType,
): Promise<Widget[]> {
	const { pattern } = getSignaturePattern(contractType);
	const lineas = await WeeTrustService.readSignatureLines(buffer, pattern);
	return lineas.map((l) => ({
		page: l.pageNum,
		x: l.pdfX,
		y: l.pdfY,
		debajo: l.debajo,
	}));
}

/** Qué contratos inventariar y de dónde sacar el PDF de cada uno. */
type Fuente =
	| { contractType: ContractType; r2Key: string }
	| { contractType: ContractType; archivo: string };

/**
 * Lee el listado de R2 (`contractType|bucket/key` por línea) o, si lo que se
 * pasó es un directorio, toma sus `<contractType>.pdf`.
 */
async function fuentes(entrada: string): Promise<Fuente[]> {
	const stat = await fs.stat(entrada);

	if (stat.isDirectory()) {
		const archivos = (await fs.readdir(entrada))
			.filter((f) => f.toLowerCase().endsWith(".pdf"))
			.sort();
		return archivos.map((f) => ({
			contractType: path.basename(f, path.extname(f)) as ContractType,
			archivo: path.join(entrada, f),
		}));
	}

	return (await fs.readFile(entrada, "utf8"))
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean)
		.map((linea) => {
			const sep = linea.indexOf("|");
			return {
				contractType: linea.slice(0, sep) as ContractType,
				r2Key: linea.slice(sep + 1),
			};
		});
}

async function main() {
	const [entrada, outDir = "/tmp/inventario-firmas"] = process.argv.slice(2);
	if (!entrada) {
		console.error(
			"uso: bun scripts/inventario-firmas.ts <claves.txt|dirConPdfs> [dirSalida]",
		);
		process.exit(1);
	}

	const aInventariar = await fuentes(entrada);
	// El cliente de R2 sólo se arma si hace falta: en modo local no hay
	// credenciales que exigir.
	const client = aInventariar.some((f) => "r2Key" in f) ? r2() : undefined;
	const guardarCopia = aInventariar.some((f) => "r2Key" in f);
	if (guardarCopia) await fs.mkdir(outDir, { recursive: true });

	for (const fuente of aInventariar) {
		const { contractType } = fuente;

		console.log("=".repeat(80));
		console.log(contractType);

		try {
			const p = getSignaturePattern(contractType);
			console.log(
				`  declarado: bloques=${JSON.stringify(p.bloques ?? [])} repeticiones=${p.repeticiones ?? 1} patrón=${JSON.stringify(p.pattern)}`,
			);
		} catch {
			console.log("  declarado: (sin patrón)");
		}

		try {
			let buffer: Buffer;
			if ("r2Key" in fuente) {
				buffer = await descargar(client!, fuente.r2Key);
				await fs.writeFile(path.join(outDir, `${contractType}.pdf`), buffer);
			} else {
				buffer = await fs.readFile(fuente.archivo);
			}

			const widgets = await widgetsDelPdf(buffer, contractType);
			console.log(`  PDF real: ${widgets.length} widget(s)`);
			widgets.forEach((w, i) => {
				const etiqueta = w.debajo.length
					? w.debajo.join(" | ")
					: "(sin texto debajo)";
				console.log(
					`    ${i + 1}. p${w.page} x=${w.x.toFixed(0)} y=${w.y.toFixed(0)} -> ${etiqueta}`,
				);
			});
		} catch (err) {
			console.log(`  ERROR: ${(err as Error).message}`);
		}
	}

	if (guardarCopia) console.log(`\nPDFs en ${outDir}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});

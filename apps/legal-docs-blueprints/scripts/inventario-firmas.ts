/**
 * Inventario de firmas: descarga de R2 los PDFs ya generados de una oportunidad
 * y reporta, por contrato, cuántos widgets de firma tiene el PDF **renderizado**
 * y qué texto los acompaña.
 *
 * Existe porque el orden de los widgets no se puede deducir del DOCX: los
 * bloques de firma viven en tablas, y el texto plano del XML no refleja la
 * disposición visual. Sólo el PDF renderizado dice la verdad.
 *
 * Es sólo lectura: descarga de R2 y analiza. No genera ni sube nada.
 *
 *   bun scripts/inventario-firmas.ts <claves.txt> [dirSalida]
 *
 * donde <claves.txt> tiene una línea por contrato con el formato
 * `contractType|bucket/key`.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { getSignaturePattern } from "../services/signaturePatterns";
import type { ContractType } from "../types/contract";

/** Una línea de firma detectada, con el texto que la acompaña debajo. */
interface Widget {
	page: number;
	x: number;
	y: number;
	debajo: string[];
}

const ES_FIRMA = /([fF][).]\s*_{3,}|Firma:\s*_{3,})/;

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

async function widgetsDelPdf(buffer: Buffer): Promise<Widget[]> {
	const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
	const widgets: Widget[] = [];

	for (let p = 1; p <= doc.numPages; p++) {
		const page = await doc.getPage(p);
		const items = (await page.getTextContent()).items as Array<{
			str: string;
			transform: number[];
		}>;
		const pos = items
			.map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5] }))
			.filter((it) => it.str.trim());

		for (const it of pos) {
			if (!ES_FIRMA.test(it.str)) continue;
			// Texto inmediatamente debajo y en la misma columna: es lo que
			// identifica al firmante (nombre/DPI) cuando el template lo imprime.
			const debajo = pos
				.filter(
					(o) =>
						o.y < it.y &&
						o.y > it.y - 42 &&
						Math.abs(o.x - it.x) < 130 &&
						!ES_FIRMA.test(o.str),
				)
				.sort((a, b) => b.y - a.y)
				.slice(0, 3)
				.map((o) => o.str.trim());
			widgets.push({ page: p, x: it.x, y: it.y, debajo });
		}
	}

	// Orden de lectura: página, luego de arriba hacia abajo, luego izq. a der.
	return widgets.sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
}

async function main() {
	const [clavesPath, outDir = "/tmp/inventario-firmas"] = process.argv.slice(2);
	if (!clavesPath) {
		console.error("uso: bun scripts/inventario-firmas.ts <claves.txt> [dirSalida]");
		process.exit(1);
	}

	const lineas = (await fs.readFile(clavesPath, "utf8"))
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);

	await fs.mkdir(outDir, { recursive: true });
	const client = r2();

	for (const linea of lineas) {
		const sep = linea.indexOf("|");
		const contractType = linea.slice(0, sep) as ContractType;
		const r2Key = linea.slice(sep + 1);

		console.log("=".repeat(80));
		console.log(contractType);

		try {
			const p = getSignaturePattern(contractType);
			console.log(
				`  declarado: signerCount=${p.signerCount} fieldCount=${p.signatureFieldCount ?? "-"} signers=${JSON.stringify(p.signers ?? [])}`,
			);
		} catch {
			console.log("  declarado: (sin patrón)");
		}

		try {
			const buffer = await descargar(client, r2Key);
			await fs.writeFile(path.join(outDir, `${contractType}.pdf`), buffer);
			const widgets = await widgetsDelPdf(buffer);
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

	console.log(`\nPDFs en ${outDir}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});

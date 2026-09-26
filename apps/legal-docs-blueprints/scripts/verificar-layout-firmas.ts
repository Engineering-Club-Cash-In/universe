/**
 * Prueba en seco del reparto de firmas: corre `locateSignatureWidgets` sobre
 * PDFs ya generados y muestra a quién le tocaría cada línea de firma.
 *
 * No habla con WeeTrust ni con R2: sólo lee los PDFs de un directorio local.
 * Sirve para validar el layout declarado en `signaturePatterns.ts` antes de
 * mandar nada a firmar.
 *
 *   bun scripts/verificar-layout-firmas.ts <dirConPdfs>
 *
 * Cada PDF debe llamarse `<contractType>.pdf`.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { WeeTrustService } from "../services/WeeTrustService";
import { SignatureLayoutError } from "../services/signaturePatterns";
import { SignerRole, type ContractSigner, type ContractType } from "../types/contract";

/** Roster de prueba: un titular, un cofirmante y el representante legal. */
const FIRMANTES: ContractSigner[] = [
	{
		role: SignerRole.TITULAR,
		email: "titular@ejemplo.com",
		name: "TITULAR DE PRUEBA",
		// Sin DPI a propósito: no se versionan datos de clientes. Con DPI se
		// verifica además el calce contra el PDF; pasarlo por env.
		...(process.env.PRUEBA_DPI_TITULAR ? { dpi: process.env.PRUEBA_DPI_TITULAR } : {}),
	},
	{
		role: SignerRole.COFIRMANTE,
		email: "cofirmante@ejemplo.com",
		name: "COFIRMANTE DE PRUEBA",
		...(process.env.PRUEBA_DPI_COFIRMANTE ? { dpi: process.env.PRUEBA_DPI_COFIRMANTE } : {}),
	},
	{
		role: SignerRole.REP_LEGAL,
		email: "replegal@ejemplo.com",
		name: "REPRESENTANTE DE PRUEBA",
	},
];

async function main() {
	const [dir] = process.argv.slice(2);
	if (!dir) {
		console.error("uso: bun scripts/verificar-layout-firmas.ts <dirConPdfs>");
		process.exit(1);
	}

	const archivos = (await fs.readdir(dir)).filter((f) => f.endsWith(".pdf")).sort();
	let ok = 0;
	let fallo = 0;

	for (const archivo of archivos) {
		const contractType = path.basename(archivo, ".pdf") as ContractType;
		const buffer = await fs.readFile(path.join(dir, archivo));

		console.log("=".repeat(78));
		console.log(contractType);
		try {
			const posiciones = await WeeTrustService.locateSignatureWidgets(
				buffer,
				contractType,
				FIRMANTES,
			);
			console.log(`  OK — ${posiciones.length} firma(s) ubicadas`);
			ok++;
		} catch (err) {
			fallo++;
			if (err instanceof SignatureLayoutError) {
				console.log(`  LAYOUT INVÁLIDO: ${err.message}`);
			} else {
				console.log(`  ERROR: ${(err as Error).message}`);
			}
		}
	}

	console.log("=".repeat(78));
	console.log(`${ok} ok, ${fallo} con problema, de ${archivos.length} contratos`);
	if (fallo > 0) process.exitCode = 1;
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});

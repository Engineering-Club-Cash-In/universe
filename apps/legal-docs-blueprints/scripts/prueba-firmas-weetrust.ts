/**
 * Prueba de punta a punta contra WeeTrust: genera los contratos de un snapshot
 * con firmantes de prueba y los manda a firmar de verdad.
 *
 * CREA DOCUMENTOS REALES en la cuenta de WeeTrust y notifica a los correos que
 * se le pasen. Está pensado para correr con correos internos: todos los
 * documentos se titulan con el prefijo `[TEST]` para poder distinguirlos.
 *
 *   bun scripts/prueba-firmas-weetrust.ts <snapshot.json> [--solo=contractType]
 *
 * Los correos salen de las variables de entorno:
 *   PRUEBA_TITULAR, PRUEBA_COFIRMANTE, PRUEBA_REP_LEGAL, PRUEBA_OBSERVADOR
 */
import * as fs from "node:fs/promises";
import { contractGenerator } from "../services/ContractGeneratorService";
import { SignerRole, type ContractSigner, type ContractType } from "../types/contract";

interface SnapshotEntry {
	contractType: ContractType;
	data: Record<string, unknown>;
	options?: Record<string, unknown>;
}

function firmantes(): ContractSigner[] {
	const { PRUEBA_TITULAR, PRUEBA_COFIRMANTE, PRUEBA_REP_LEGAL } = process.env;
	if (!PRUEBA_TITULAR || !PRUEBA_COFIRMANTE || !PRUEBA_REP_LEGAL) {
		throw new Error(
			"Faltan PRUEBA_TITULAR / PRUEBA_COFIRMANTE / PRUEBA_REP_LEGAL en el entorno",
		);
	}
	return [
		{
			role: SignerRole.TITULAR,
			email: PRUEBA_TITULAR,
			name: "TITULAR DE PRUEBA",
			// El DPI sólo sirve para confirmar el calce contra el PDF del snapshot.
			// No se versiona: se pasa por env si se quiere esa verificación.
			...(process.env.PRUEBA_DPI_TITULAR ? { dpi: process.env.PRUEBA_DPI_TITULAR } : {}),
		},
		{
			role: SignerRole.COFIRMANTE,
			email: PRUEBA_COFIRMANTE,
			name: "COFIRMANTE DE PRUEBA",
			...(process.env.PRUEBA_DPI_COFIRMANTE ? { dpi: process.env.PRUEBA_DPI_COFIRMANTE } : {}),
		},
		{
			role: SignerRole.REP_LEGAL,
			email: PRUEBA_REP_LEGAL,
			name: "REPRESENTANTE DE PRUEBA",
		},
	];
}

async function main() {
	const args = process.argv.slice(2);
	const snapshotPath = args.find((a) => !a.startsWith("--"));
	const solo = args.find((a) => a.startsWith("--solo="))?.split("=")[1];

	if (!snapshotPath) {
		console.error("uso: bun scripts/prueba-firmas-weetrust.ts <snapshot.json> [--solo=tipo]");
		process.exit(1);
	}

	const signers = firmantes();
	const observers = (process.env.PRUEBA_OBSERVADOR || "")
		.split(",")
		.map((e) => e.trim())
		.filter(Boolean);

	let entries: SnapshotEntry[] = JSON.parse(await fs.readFile(snapshotPath, "utf8"));
	if (solo) entries = entries.filter((e) => e.contractType === solo);

	console.log(`\nFirmantes de prueba:`);
	for (const s of signers) console.log(`  ${s.role.padEnd(11)} ${s.email}`);
	console.log(`  OBSERVADOR  ${observers.join(", ") || "(ninguno)"}`);
	console.log(`\nGenerando ${entries.length} contrato(s)...\n`);

	const resumen: Array<{ tipo: string; ok: boolean; detalle: string }> = [];

	for (const entry of entries) {
		const res = await contractGenerator.generateContract(
			entry.contractType,
			// El título del documento en WeeTrust sale del nombre de archivo.
			{ ...entry.data },
			{
				...(entry.options as Record<string, never>),
				// El nombre de archivo es el título del documento en WeeTrust, y
				// WeeTrust es quisquilloso con los caracteres raros.
				filenamePrefix: `TEST-${entry.contractType}`,
				generatePdf: true,
				signers,
				observers,
			},
		);

		if (res.success && res.signatureMode === "fisica") {
			resumen.push({
				tipo: entry.contractType,
				ok: true,
				detalle: "firma en papel (no va a WeeTrust)",
			});
		} else if (res.success && res.signing_links?.length) {
			resumen.push({
				tipo: entry.contractType,
				ok: true,
				detalle: `doc=${res.documentID} links=${res.signing_links.length}`,
			});
		} else {
			resumen.push({
				tipo: entry.contractType,
				ok: false,
				detalle: res.error ?? "sin links",
			});
		}
	}

	console.log(`\n${"=".repeat(78)}\nRESUMEN\n${"=".repeat(78)}`);
	for (const r of resumen) {
		console.log(`  ${r.ok ? "OK  " : "FALLA"} ${r.tipo.padEnd(40)} ${r.detalle}`);
	}
	const ok = resumen.filter((r) => r.ok).length;
	console.log(`\n${ok} ok, ${resumen.length - ok} con problema`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});

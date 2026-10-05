/**
 * Previsualiza dónde van a caer las rúbricas de páginas impares.
 *
 * Toma un PDF ya generado, calcula las posiciones exactamente como lo hace
 * producción (`WeeTrustService.locateSignatureWidgets`) y escribe un PDF nuevo
 * con un recuadro dibujado en cada una: las firmas reales en amarillo y las
 * rúbricas en azul, cada una con el nombre de quien firma ahí.
 *
 * Es para calibrar. La franja donde van no es la misma en todos los
 * contratos —depende de dónde tenga aire cada template—, y la única forma de
 * saber si una rúbrica cae sobre el texto es verla puesta. Mandar un documento
 * a WeeTrust para averiguarlo cuesta un documento de la cuota y le manda
 * correos a alguien.
 *
 * No habla con WeeTrust ni con R2: entra un archivo local, sale otro.
 *
 *   bun scripts/previsualizar-rubricas.ts <tipo> <entrada.pdf> [salida.pdf]
 *
 * Ejemplo:
 *
 *   bun scripts/previsualizar-rubricas.ts garantia_mobiliaria \
 *     ~/Descargas/garantia.pdf /tmp/garantia-rubricas.pdf
 */
import * as fs from "node:fs/promises";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { WeeTrustService } from "../services/WeeTrustService";
import { ContractType, SignerRole, type ContractSigner } from "../types/contract";

/**
 * Firmantes de mentira, sólo para que el reparto por rol tenga a quién asignar.
 *
 * Tres personas es el caso que más aprieta: titular, un codeudor y el
 * representante legal. Si las rúbricas caben con tres, caben con menos.
 *
 * Con `--sin-cofirmante` quedan dos, que es lo que llevan los contratos de
 * inversión: el inversionista y el representante legal. Mandarle un codeudor a
 * un contrato que no tiene esa línea corta antes de dibujar nada.
 */
const FIRMANTES_DE_PRUEBA: ContractSigner[] = [
	{
		role: SignerRole.TITULAR,
		email: "titular@ejemplo.test",
		name: "TITULAR DE PRUEBA",
	},
	{
		role: SignerRole.COFIRMANTE,
		email: "codeudor@ejemplo.test",
		name: "CODEUDOR DE PRUEBA",
	},
	{
		role: SignerRole.REP_LEGAL,
		email: "replegal@ejemplo.test",
		name: "REP LEGAL DE PRUEBA",
	},
	// El contrato de servicios lleva una línea por sociedad: sin la segunda
	// entidad en el roster, ese contrato no se podía previsualizar.
	{
		role: SignerRole.REP_LEGAL_RDBE,
		email: "replegal-rdbe@ejemplo.test",
		name: "REP LEGAL RDBE DE PRUEBA",
	},
];

async function main() {
	const argumentos = process.argv.slice(2);
	const sinCofirmante = argumentos.includes("--sin-cofirmante");
	const [tipo, entrada, salida] = argumentos.filter(
		(a) => !a.startsWith("--"),
	);
	const firmantes = sinCofirmante
		? FIRMANTES_DE_PRUEBA.filter((f) => f.role !== SignerRole.COFIRMANTE)
		: FIRMANTES_DE_PRUEBA;

	if (!tipo || !entrada) {
		console.error(
			"Uso: bun scripts/previsualizar-rubricas.ts <tipo> <entrada.pdf> [salida.pdf] [--sin-cofirmante]",
		);
		console.error(`\nTipos: ${Object.values(ContractType).join(", ")}`);
		process.exit(1);
	}

	if (!Object.values(ContractType).includes(tipo as ContractType)) {
		console.error(`Tipo desconocido: ${tipo}`);
		process.exit(1);
	}

	const destino = salida ?? entrada.replace(/\.pdf$/i, "-rubricas.pdf");
	const pdfBuffer = await fs.readFile(entrada);

	const posiciones = await WeeTrustService.locateSignatureWidgets(
		pdfBuffer,
		tipo as ContractType,
		firmantes,
	);

	const porEmail = new Map(firmantes.map((f) => [f.email, f]));

	const doc = await PDFDocument.load(pdfBuffer);
	const fuente = await doc.embedFont(StandardFonts.Helvetica);
	const paginas = doc.getPages();

	for (const posicion of posiciones) {
		const pagina = paginas[posicion.page - 1];
		if (!pagina) {
			console.warn(
				`⚠ posición en página ${posicion.page}, pero el PDF tiene ${paginas.length}`,
			);
			continue;
		}

		const { height } = pagina.getSize();
		// WeeTrust mide Y desde arriba; pdf-lib desde abajo.
		const y = height - posicion.coordinates.y - posicion.imageSize.height;

		// Las rúbricas son más chicas que una firma (100×50): así se distinguen
		// sin tener que repetir acá el criterio de la configuración.
		const esRubrica = posicion.imageSize.width < 100;
		const color = esRubrica ? rgb(0.1, 0.3, 0.9) : rgb(0.9, 0.7, 0.1);

		pagina.drawRectangle({
			x: posicion.coordinates.x,
			y,
			width: posicion.imageSize.width,
			height: posicion.imageSize.height,
			borderColor: color,
			borderWidth: 1.2,
		});

		pagina.drawText(porEmail.get(posicion.user.email)?.role ?? "?", {
			x: posicion.coordinates.x + 2,
			y: y + 2,
			size: 6,
			font: fuente,
			color,
		});
	}

	await fs.writeFile(destino, await doc.save());

	const rubricas = posiciones.filter((p) => p.imageSize.width < 100).length;
	console.log(`\n✓ ${destino}`);
	console.log(
		`  ${posiciones.length - rubricas} firma(s) reales (amarillo) + ${rubricas} rúbrica(s) (azul)`,
	);
	console.log(`  ${paginas.length} página(s) en el documento\n`);

	for (const posicion of posiciones) {
		const quien = porEmail.get(posicion.user.email)?.role ?? posicion.user.email;
		const clase = posicion.imageSize.width < 100 ? "rúbrica" : "firma  ";
		console.log(
			`  pág. ${String(posicion.page).padStart(2)} | ${clase} | ${quien.padEnd(12)} | ` +
				`(${posicion.coordinates.x.toFixed(0)}, ${posicion.coordinates.y.toFixed(0)})`,
		);
	}
}

main().catch((error) => {
	console.error("\n✗", error instanceof Error ? error.message : error);
	process.exit(1);
});

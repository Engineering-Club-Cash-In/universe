import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Inventario de escrituras sobre las entidades auditadas.
 *
 * No prueba que la bitácora funcione — eso lo hacen los tests de `audit.ts`.
 * Prueba que ninguna escritura se quede afuera sin que alguien lo decida:
 *
 * 1. todo archivo que escriba las tres entidades está declarado acá;
 * 2. su cantidad de escrituras y de anotaciones sigue siendo la declarada;
 * 3. en los archivos marcados `listo`, cada escritura tiene un `auditRecord`
 *    cerca — que es lo que detecta que alguien saque una anotación o la mueva
 *    fuera de la rama que hace la escritura;
 * 4. los exentos no anotan y explican por qué.
 *
 * Es la red que faltó la vez pasada, cuando tres rondas de review encontraron
 * caminos de escritura que se habían quedado afuera en silencio.
 */

type Estado = "listo" | "exento";

const INVENTARIO: Record<
	string,
	{ escrituras: number; anotaciones: number; estado: Estado; nota?: string }
> = {
	"routers/crm.ts": { escrituras: 18, anotaciones: 18, estado: "listo" },
	"routers/vehicles.ts": { escrituras: 10, anotaciones: 10, estado: "listo" },
	// Anota una vez más de lo que escribe: el rollback descarta las anotaciones
	// de la transacción revertida y deja en su lugar el intento fallido.
	"controllers/migrate-creditos.ts": {
		escrituras: 8,
		anotaciones: 9,
		estado: "listo",
	},
	"controllers/public-lead.ts": {
		escrituras: 8,
		anotaciones: 8,
		estado: "listo",
	},
	"controllers/bot.ts": { escrituras: 6, anotaciones: 6, estado: "listo" },
	"controllers/portal-lead.ts": {
		escrituras: 3,
		anotaciones: 3,
		estado: "listo",
	},
	"routers/auctionVehicles.ts": {
		escrituras: 3,
		anotaciones: 3,
		estado: "listo",
	},
	"routers/cobros.ts": { escrituras: 3, anotaciones: 3, estado: "listo" },
	"services/close-opportunity.ts": {
		escrituras: 3,
		anotaciones: 3,
		estado: "listo",
	},
	"routers/legal-contracts.ts": {
		escrituras: 2,
		anotaciones: 2,
		estado: "listo",
	},
	"controllers/liveness.ts": { escrituras: 1, anotaciones: 1, estado: "listo" },
	"controllers/load-cars.ts": {
		escrituras: 1,
		anotaciones: 1,
		estado: "listo",
	},
	"routers/messaging.ts": { escrituras: 1, anotaciones: 1, estado: "listo" },
	// Anota más de lo que escribe: los fallos de RENAP se devuelven como valor
	// en vez de lanzarse, así que cada uno deja su propia fila `ok = false`.
	"services/contract-data-mapper.ts": {
		escrituras: 1,
		anotaciones: 4,
		estado: "listo",
	},
	"services/lead-scoring.ts": {
		escrituras: 1,
		anotaciones: 1,
		estado: "listo",
	},

	"db/seed.ts": {
		escrituras: 3,
		anotaciones: 0,
		estado: "exento",
		nota: "script de desarrollo, no es un endpoint",
	},
	"db/clear.ts": {
		escrituras: 3,
		anotaciones: 0,
		estado: "exento",
		nota: "script de desarrollo, no es un endpoint",
	},
};

const TABLAS = ["leads", "opportunities", "vehicles"];
const ESCRITURA = new RegExp(
	`\\.(insert|update|delete)\\(\\s*(${TABLAS.join("|")})\\s*\\)`,
);
const ANOTACION = /auditRecord\(/;

/**
 * Margen entre una escritura y su anotación. Hoy la distancia real máxima es
 * de 34 líneas (`crm.updateOpportunity`, que entre medio arma el `where` y
 * resuelve el conflicto de concurrencia).
 */
const LINEAS_DE_MARGEN = 45;

function archivosFuente(dir: string, out: string[] = []): string[] {
	for (const entrada of readdirSync(dir)) {
		const ruta = join(dir, entrada);
		if (statSync(ruta).isDirectory()) archivosFuente(ruta, out);
		else if (ruta.endsWith(".ts") && !ruta.includes(".test.")) out.push(ruta);
	}
	return out;
}

type Hallazgo = {
	escrituras: number;
	anotaciones: number;
	huerfanas: number[];
};

function escaneo(): Record<string, Hallazgo> {
	const encontrado: Record<string, Hallazgo> = {};
	for (const ruta of archivosFuente("src")) {
		const lineas = readFileSync(ruta, "utf8").split("\n");
		const escrituras: number[] = [];
		let anotaciones = 0;
		lineas.forEach((linea, i) => {
			if (ESCRITURA.test(linea)) escrituras.push(i);
			if (ANOTACION.test(linea)) anotaciones++;
		});
		if (escrituras.length === 0) continue;

		const huerfanas = escrituras.filter(
			(i) =>
				!lineas
					.slice(i, i + LINEAS_DE_MARGEN)
					.some((linea) => ANOTACION.test(linea)),
		);
		encontrado[ruta.replace(/^src\//, "")] = {
			escrituras: escrituras.length,
			anotaciones,
			huerfanas: huerfanas.map((i) => i + 1),
		};
	}
	return encontrado;
}

describe("inventario de escrituras auditadas", () => {
	const encontrado = escaneo();

	test("todo archivo que escribe entidades auditadas está declarado", () => {
		expect(
			Object.keys(encontrado).filter((archivo) => !(archivo in INVENTARIO)),
		).toEqual([]);
	});

	test("no quedan declaraciones de archivos que ya no escriben", () => {
		expect(
			Object.keys(INVENTARIO).filter((archivo) => !(archivo in encontrado)),
		).toEqual([]);
	});

	test("las cantidades declaradas siguen siendo las reales", () => {
		const desfasados = Object.entries(encontrado)
			.filter(([archivo]) => archivo in INVENTARIO)
			.filter(
				([archivo, real]) =>
					INVENTARIO[archivo].escrituras !== real.escrituras ||
					INVENTARIO[archivo].anotaciones !== real.anotaciones,
			)
			.map(([archivo, real]) => ({
				archivo,
				declarado: {
					escrituras: INVENTARIO[archivo].escrituras,
					anotaciones: INVENTARIO[archivo].anotaciones,
				},
				real: { escrituras: real.escrituras, anotaciones: real.anotaciones },
			}));
		expect(desfasados).toEqual([]);
	});

	test("en los archivos listos, ninguna escritura quedó sin anotar", () => {
		// Detecta la regresión directa: sacar un `auditRecord` o moverlo fuera de
		// la rama que hace la escritura.
		const huerfanas = Object.entries(encontrado)
			.filter(([archivo]) => INVENTARIO[archivo]?.estado === "listo")
			.filter(([, real]) => real.huerfanas.length > 0)
			.map(([archivo, real]) => ({ archivo, lineas: real.huerfanas }));
		expect(huerfanas).toEqual([]);
	});

	test("los exentos no anotan y explican por qué", () => {
		const mal = Object.entries(INVENTARIO)
			.filter(([, v]) => v.estado === "exento")
			.filter(([, v]) => !v.nota || v.anotaciones !== 0)
			.map(([archivo]) => archivo);
		expect(mal).toEqual([]);
	});
});

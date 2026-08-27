import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Inventario de escrituras sobre las entidades auditadas.
 *
 * No verifica que la bitácora funcione — eso lo hacen los tests de `audit.ts`.
 * Verifica que nadie agregue una escritura sin decidir qué hacer con ella: si
 * un archivo escribe leads, oportunidades o vehículos y no está declarado acá,
 * o cambió su cantidad de escrituras, este test falla y obliga a la decisión.
 *
 * Es la red que faltó la vez pasada, cuando tres rondas de review encontraron
 * caminos de escritura que se habían quedado afuera en silencio.
 *
 * Al migrar un archivo: pasarlo a `estado: "listo"` y ajustar `escrituras`.
 */

type Estado = "listo" | "pendiente" | "exento";

const INVENTARIO: Record<
	string,
	{ escrituras: number; estado: Estado; nota?: string }
> = {
	// --- migrados (escrituras anotadas con auditRecord)
	"routers/crm.ts": { escrituras: 18, estado: "listo" },
	"controllers/public-lead.ts": { escrituras: 8, estado: "listo" },

	"routers/vehicles.ts": { escrituras: 10, estado: "listo" },
	"controllers/migrate-creditos.ts": { escrituras: 8, estado: "listo" },
	"controllers/bot.ts": { escrituras: 6, estado: "listo" },
	"controllers/portal-lead.ts": { escrituras: 3, estado: "listo" },
	"routers/auctionVehicles.ts": { escrituras: 3, estado: "listo" },
	"routers/cobros.ts": { escrituras: 3, estado: "listo" },
	"services/close-opportunity.ts": { escrituras: 3, estado: "listo" },
	"routers/legal-contracts.ts": { escrituras: 2, estado: "listo" },
	"controllers/liveness.ts": { escrituras: 1, estado: "listo" },
	"controllers/load-cars.ts": { escrituras: 1, estado: "listo" },
	"routers/messaging.ts": { escrituras: 1, estado: "listo" },
	"services/contract-data-mapper.ts": { escrituras: 1, estado: "listo" },
	"services/lead-scoring.ts": { escrituras: 1, estado: "listo" },

	// --- exentos
	"db/seed.ts": {
		escrituras: 3,
		estado: "exento",
		nota: "script de desarrollo, no es un endpoint",
	},
	"db/clear.ts": {
		escrituras: 3,
		estado: "exento",
		nota: "script de desarrollo, no es un endpoint",
	},
};

const TABLAS = ["leads", "opportunities", "vehicles"];
const ESCRITURA = new RegExp(
	`\\.(insert|update|delete)\\(\\s*(${TABLAS.join("|")})\\s*\\)`,
	"g",
);

function archivosFuente(dir: string, out: string[] = []): string[] {
	for (const entrada of readdirSync(dir)) {
		const ruta = join(dir, entrada);
		if (statSync(ruta).isDirectory()) archivosFuente(ruta, out);
		else if (ruta.endsWith(".ts") && !ruta.includes(".test.")) out.push(ruta);
	}
	return out;
}

function escaneo() {
	const encontrado: Record<string, number> = {};
	for (const ruta of archivosFuente("src")) {
		const escrituras = [
			...readFileSync(ruta, "utf8").matchAll(ESCRITURA),
		].length;
		if (escrituras > 0) encontrado[ruta.replace(/^src\//, "")] = escrituras;
	}
	return encontrado;
}

describe("inventario de escrituras auditadas", () => {
	const encontrado = escaneo();

	test("todo archivo que escribe entidades auditadas está declarado", () => {
		const sinDeclarar = Object.keys(encontrado).filter(
			(archivo) => !(archivo in INVENTARIO),
		);
		expect(sinDeclarar).toEqual([]);
	});

	test("la cantidad de escrituras declarada sigue siendo la real", () => {
		const desfasados = Object.entries(encontrado)
			.filter(
				([archivo, escrituras]) =>
					archivo in INVENTARIO &&
					INVENTARIO[archivo].escrituras !== escrituras,
			)
			.map(([archivo, escrituras]) => ({
				archivo,
				declaradas: INVENTARIO[archivo].escrituras,
				reales: escrituras,
			}));
		expect(desfasados).toEqual([]);
	});

	test("no quedan declaraciones de archivos que ya no escriben", () => {
		const sobrantes = Object.keys(INVENTARIO).filter(
			(archivo) => !(archivo in encontrado),
		);
		expect(sobrantes).toEqual([]);
	});

	test("todo exento explica por qué", () => {
		const sinNota = Object.entries(INVENTARIO)
			.filter(([, v]) => v.estado === "exento" && !v.nota)
			.map(([archivo]) => archivo);
		expect(sinNota).toEqual([]);
	});
});

import { describe, expect, test } from "bun:test";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * El cableado del gate de mora, protegido por inspección de fuente.
 *
 * 🔴 Por qué existe. `gate-mora-dpi.test.ts` prueba la REGLA con dependencias
 * inyectadas, así que pasa entera aunque nadie llame al gate: se pueden borrar
 * las seis llamadas y la suite sigue verde. Este archivo prueba lo otro —que el
 * gate esté efectivamente enchufado— leyendo los archivos como texto.
 *
 * Es deliberadamente tonto y frágil a propósito: si alguien mueve una llamada,
 * tiene que venir acá y declarar el movimiento. Ese trámite es el punto — obliga
 * a que agregar o quitar un punto de control sea una decisión visible en el
 * diff, no un efecto colateral.
 *
 * Sin `mock.module` ni base: solo `Bun.file`.
 */

const SRC = new URL("..", import.meta.url).pathname;

/**
 * Dónde corre el gate y cuántas veces. Los cuatro de `crm.ts` son createLead,
 * updateLead, el alta del co-deudor y la edición del co-deudor; los dos de
 * `portal-lead.ts` son las dos entradas del portal.
 */
const LLAMADAS_DECLARADAS: Record<string, number> = {
	"routers/crm.ts": 4,
	"controllers/portal-lead.ts": 2,
};

/**
 * Dónde el gate NO va, a propósito. Son rutas anónimas: consultar la mora ahí
 * las convertiría en un oráculo público de situación crediticia (cualquiera
 * manda el DPI de un tercero y la respuesta le dice si está en mora). Está
 * razonado en cada archivo.
 *
 * La ausencia se protege igual que la presencia: agregar el gate acá "para
 * cerrar el hueco" abriría uno peor, y sin este test parecería una mejora.
 */
const SIN_GATE_A_PROPOSITO = [
	"controllers/public-lead.ts",
	"controllers/bot.ts",
];

async function fuente(relativo: string): Promise<string> {
	return await Bun.file(join(SRC, relativo)).text();
}

function contar(fuente: string, aguja: string): number {
	return fuente.split(aguja).length - 1;
}

/**
 * Inventario de TODO lo que muta `leads` o `co_debtors`, con por qué cada uno
 * está o no detrás del gate.
 *
 * 🔴 Es un inventario y no un detector de `dpi:` por una razón que costó
 * descubrir: el DPI no se escribe con una propiedad literal. `updateLead` hace
 * `.set({ ...updateData })`, así que buscar el texto `dpi:` dentro del `.set()`
 * NO encuentra el único sitio que de verdad escribe el DPI — un test así pasa
 * siempre y no protege nada. (Y buscando `dpi` en una ventana de texto alrededor
 * marcaba `liveness.ts`, que solo lo menciona en un `auditRecord`.)
 *
 * Lo que sí se puede afirmar con el texto es esto: estos ocho archivos y no
 * otros tocan esas tablas. Cuando aparezca un noveno, este test falla y obliga a
 * decidir explícitamente si ese camino nuevo mete un DPI al sistema y necesita
 * gate. Esa decisión consciente es la protección.
 */
const MUTAN_LEADS_O_CODEUDORES: Record<string, string> = {
	"routers/crm.ts":
		"updateLead escribe el DPI vía `...updateData` — GATEADO (4 llamadas)",
	"controllers/portal-lead.ts":
		"el portal actualiza el lead — GATEADO (2 llamadas)",
	"controllers/public-lead.ts":
		"ruta anónima sin gate a propósito; sus `.set()` son campaign/email/source/assignedTo, nunca dpi",
	"controllers/bot.ts":
		"ruta anónima sin gate a propósito; `leadUpdates` se arma campo por campo y no incluye dpi",
	"controllers/liveness.ts": "solo `livenessValidated`",
	"routers/messaging.ts": "solo `phone`",
	"services/contract-data-mapper.ts":
		"enriquecimiento RENAP: nombres, género, nacionalidad — no dpi",
	"services/lead-scoring.ts": "solo `score`/`fit`/`scoredAt`",
};

/** Todos los .ts de src/, sin tests ni node_modules. */
function archivosTs(dir: string, acumulado: string[] = []): string[] {
	for (const entrada of readdirSync(dir)) {
		if (entrada === "node_modules") continue;
		const completo = join(dir, entrada);
		if (statSync(completo).isDirectory()) {
			archivosTs(completo, acumulado);
		} else if (
			entrada.endsWith(".ts") &&
			!entrada.endsWith(".test.ts") &&
			!entrada.endsWith(".d.ts")
		) {
			acumulado.push(completo);
		}
	}
	return acumulado;
}

describe("cableado del gate de mora por DPI", () => {
	test("el gate se llama exactamente donde y cuantas veces está declarado", async () => {
		for (const [relativo, esperadas] of Object.entries(LLAMADAS_DECLARADAS)) {
			const texto = await fuente(relativo);
			const llamadas = contar(texto, "evaluarGateMoraDpi(");

			expect(
				llamadas,
				`${relativo} debería llamar a evaluarGateMoraDpi ${esperadas} vez/veces y llama ${llamadas}. ` +
					"Si agregaste o quitaste un punto de control a propósito, actualizá LLAMADAS_DECLARADAS acá.",
			).toBe(esperadas);
		}
	});

	test("las rutas anónimas siguen SIN gate, que es la decisión tomada", async () => {
		for (const relativo of SIN_GATE_A_PROPOSITO) {
			const texto = await fuente(relativo);

			expect(
				contar(texto, "evaluarGateMoraDpi("),
				`${relativo} es una ruta anónima y NO debe consultar la mora: la convertiría en un ` +
					"oráculo público de situación crediticia. Si de verdad hay que cambiarlo, es una " +
					"decisión de producto, no un arreglo.",
			).toBe(0);
		}
	});

	test("🔴 ningún archivo NUEVO muta leads/coDebtors sin declarar si necesita gate", async () => {
		// El agujero que ataja: alguien agrega otro procedure que escribe el DPI de
		// un lead, y ese DPI entra al sistema sin que su mora se haya mirado nunca.
		// Los tests de la regla no lo notarían: pasan con o sin llamadas al gate.
		const encontrados: string[] = [];

		for (const absoluto of archivosTs(SRC)) {
			const texto = await Bun.file(absoluto).text();
			if (
				texto.includes("update(leads)") ||
				texto.includes("update(coDebtors)")
			) {
				encontrados.push(absoluto.slice(SRC.length).replace(/^\/+/, ""));
			}
		}

		const declarados = Object.keys(MUTAN_LEADS_O_CODEUDORES);

		const nuevos = encontrados.filter((f) => !declarados.includes(f));
		expect(
			nuevos,
			"Estos archivos mutan leads/co_debtors y no están en el inventario. " +
				"Decidí si el camino escribe un DPI: si lo escribe, tiene que llamar a " +
				"evaluarGateMoraDpi (y sumarse a LLAMADAS_DECLARADAS); si no, agregalo a " +
				"MUTAN_LEADS_O_CODEUDORES diciendo qué campos toca.",
		).toEqual([]);

		// El inventario tampoco puede quedar con fantasmas: un archivo borrado o
		// que dejó de tocar esas tablas debe salir de la lista, o el próximo lector
		// creerá que hay un control donde ya no hay nada.
		const fantasmas = declarados.filter((f) => !encontrados.includes(f));
		expect(
			fantasmas,
			"Estos archivos están en el inventario pero ya no mutan leads/co_debtors. Sacalos.",
		).toEqual([]);
	});

	test("los dos puntos declarados importan el gate de verdad", async () => {
		// Contar `evaluarGateMoraDpi(` no distingue una llamada real de una mención
		// en un comentario; el import sí.
		for (const relativo of Object.keys(LLAMADAS_DECLARADAS)) {
			const texto = await fuente(relativo);
			expect(texto, `${relativo} debería importar el gate`).toContain(
				"gate-mora-dpi",
			);
		}
	});

	test("los dos puntos cablean la palanca de emergencia", async () => {
		// `habilitado` es opcional en `DependenciasGateMora` —un llamador que la
		// omita queda validando siempre, que es el default seguro—, y justamente
		// por eso perderla en producción no rompería ningún test de la regla: el
		// gate seguiría funcionando, solo que apagar
		// ENABLE_CARTERA_BACK_INTEGRATION ya no desbloquearía nada. La palanca se
		// usa el día que SIFCO lleva horas caído; descubrir ahí que no está
		// cableada es el peor momento posible.
		for (const relativo of Object.keys(LLAMADAS_DECLARADAS)) {
			const texto = await fuente(relativo);
			expect(
				texto,
				`${relativo} debería cablear habilitado: isCarteraBackEnabled en depsGateMora`,
			).toContain("habilitado: isCarteraBackEnabled");
		}
	});
});

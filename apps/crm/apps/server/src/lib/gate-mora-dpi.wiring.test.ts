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
 * Dónde se rechaza el DPI EN BLANCO, y cuántas veces. Son las ediciones que
 * pueden escribir el DPI de alguien que ya está adentro: `updateLead` y
 * `updateCoDebtor` en `crm.ts`, y el update del portal.
 *
 * 🔴 Va acá y no en los tests de la regla por la misma razón que el resto de
 * este archivo: `esDpiEnBlanco` es una función de tres líneas que pasa sola
 * aunque nadie la llame. Lo que hay que proteger es que esté ENCHUFADA en los
 * tres sitios, porque el `dpi: ""` se colaba justamente por los tres huecos
 * donde el `if (dpi)` la daba por ausente.
 */
const RECHAZAN_DPI_EN_BLANCO: Record<string, number> = {
	"routers/crm.ts": 2,
	"controllers/portal-lead.ts": 1,
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
 * Inventario de TODO lo que ESCRIBE en `leads` o `co_debtors` —altas incluidas—,
 * con por qué cada uno está o no detrás del gate.
 *
 * 🔴 Es un inventario y no un detector de `dpi:` por una razón que costó
 * descubrir: el DPI no se escribe con una propiedad literal. `updateLead` hace
 * `.set({ ...updateData })`, así que buscar el texto `dpi:` dentro del `.set()`
 * NO encuentra el único sitio que de verdad escribe el DPI — un test así pasa
 * siempre y no protege nada. (Y buscando `dpi` en una ventana de texto alrededor
 * marcaba `liveness.ts`, que solo lo menciona en un `auditRecord`.)
 *
 * Lo que sí se puede afirmar con el texto es esto: estos archivos y no otros
 * tocan esas tablas. Cuando aparezca uno nuevo, este test falla y obliga a
 * decidir explícitamente si ese camino mete un DPI al sistema y necesita gate.
 * Esa decisión consciente es la protección.
 *
 * 🔴 El escaneo mira `insert(` además de `update(`. Mirando solo el update, un
 * `insert(leads)` nuevo entraba sin inventariar — y el alta es justo la
 * operación que el gate existe para vigilar: es donde un DPI aparece por primera
 * vez. Que `crm.ts` y `portal-lead.ts` ya estuvieran en la lista por sus updates
 * escondía el hueco, porque los archivos que faltaban eran otros.
 */
const ESCRIBEN_LEADS_O_CODEUDORES: Record<string, string> = {
	"routers/crm.ts":
		"createLead, updateLead y el alta/edición del co-deudor escriben dpi (updateLead vía `...updateData`) — GATEADO (4 llamadas)",
	"controllers/portal-lead.ts":
		"el portal da de alta y actualiza el lead con dpi — GATEADO (2 llamadas)",
	"controllers/public-lead.ts":
		"ruta anónima SIN GATE a propósito: su `insert(leads)` sí escribe dpi, pero consultar la mora ahí la volvería un oráculo público; sus `.set()` son campaign/email/source/assignedTo, nunca dpi",
	"controllers/bot.ts":
		"ruta anónima SIN GATE a propósito, misma razón: su `insert(leads)` escribe dpi; `leadUpdates` se arma campo por campo y no incluye dpi",
	"controllers/migrate-creditos.ts":
		"MIGRACIÓN desde el sistema anterior: crea el lead con nombre/correo/teléfono y `status: 'migrate'`, sin dpi — no es un alta comercial y no pasa por el gate",
	"routers/cobros.ts":
		"crea el lead espejo de un crédito que YA existe en cartera (`status: 'migrate'`, sin dpi): el cliente ya está adentro, el gate no tiene a quién frenar",
	"db/seed.ts": "semilla de desarrollo; no corre en producción",
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

	test("🔴 las ediciones siguen rechazando el DPI en blanco", async () => {
		// Blanquear el DPI de un moroso lo vuelve invisible PARA SIEMPRE: el CRM
		// llega a sus créditos `CRM-<uuid>` e `insoluto-N` por el DPI del lead, así
		// que sin ese dato el próximo lead que lo teclee no hereda nada y cartera
		// contesta CLIENTE_NO_ENCONTRADO. Era la puerta de atrás del gate.
		for (const [relativo, esperados] of Object.entries(
			RECHAZAN_DPI_EN_BLANCO,
		)) {
			const texto = await fuente(relativo);

			expect(
				contar(texto, "esDpiEnBlanco("),
				`${relativo} debería rechazar el DPI en blanco ${esperados} vez/veces y lo hace ${contar(
					texto,
					"esDpiEnBlanco(",
				)}. Si moviste una edición, actualizá RECHAZAN_DPI_EN_BLANCO acá.`,
			).toBe(esperados);
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

	test("🔴 ningún archivo NUEVO escribe leads/coDebtors sin declarar si necesita gate", async () => {
		// El agujero que ataja: alguien agrega otro procedure que escribe el DPI de
		// un lead, y ese DPI entra al sistema sin que su mora se haya mirado nunca.
		// Los tests de la regla no lo notarían: pasan con o sin llamadas al gate.
		const ESCRITURAS = [
			"insert(leads)",
			"insert(coDebtors)",
			"update(leads)",
			"update(coDebtors)",
		];
		const encontrados: string[] = [];

		for (const absoluto of archivosTs(SRC)) {
			const texto = await Bun.file(absoluto).text();
			if (ESCRITURAS.some((escritura) => texto.includes(escritura))) {
				encontrados.push(absoluto.slice(SRC.length).replace(/^\/+/, ""));
			}
		}

		const declarados = Object.keys(ESCRIBEN_LEADS_O_CODEUDORES);

		const nuevos = encontrados.filter((f) => !declarados.includes(f));
		expect(
			nuevos,
			"Estos archivos escriben leads/co_debtors (alta o edición) y no están en el inventario. " +
				"Decidí si el camino escribe un DPI: si lo escribe, tiene que llamar a " +
				"evaluarGateMoraDpi (y sumarse a LLAMADAS_DECLARADAS); si no, agregalo a " +
				"ESCRIBEN_LEADS_O_CODEUDORES diciendo qué campos toca.",
		).toEqual([]);

		// El inventario tampoco puede quedar con fantasmas: un archivo borrado o
		// que dejó de tocar esas tablas debe salir de la lista, o el próximo lector
		// creerá que hay un control donde ya no hay nada.
		const fantasmas = declarados.filter((f) => !encontrados.includes(f));
		expect(
			fantasmas,
			"Estos archivos están en el inventario pero ya no escriben leads/co_debtors. Sacalos.",
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

	/**
	 * 🔴 El preflight informativo (`validarMoraPorDpi`) tiene que contestar lo
	 * mismo que va a contestar el gate. Desalineado es peor que ausente: decía
	 * "seguí" al deudor que solo existe en el CRM —porque preguntaba solo por
	 * DPI, sin los números que el gate sí manda— y anunciaba un bloqueo cuando el
	 * kill switch estaba abajo y el gate dejaba pasar. Las dos cosas se ven en la
	 * fuente.
	 */
	test("el preflight pregunta con los mismos datos que el gate", async () => {
		const texto = await fuente("routers/crm.ts");

		expect(
			contar(texto, "numerosSifcoConocidosPorDpi"),
			"crm.ts debería usar los números conocidos DOS veces: en depsGateMora y en el " +
				"preflight validarMoraPorDpi. Si el preflight pregunta solo por DPI, le dice " +
				"'podés continuar' a quien el gate va a rechazar después.",
		).toBeGreaterThanOrEqual(2);

		expect(
			texto,
			"validarMoraPorDpi debería respetar el kill switch: con la integración apagada " +
				"el gate deja pasar, así que anunciar un bloqueo en el preflight sería inventarlo.",
		).toContain("!isCarteraBackEnabled()");
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

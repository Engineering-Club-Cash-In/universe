import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	devengaMora,
	etapaCobrable,
	STATUS_CREDITO_COBRABLES,
	STATUS_SIN_MORA,
} from "./estados-cobranza";

/**
 * La lista de cobranza no muestra créditos a los que el sistema ya no les
 * devenga mora.
 *
 * Por qué existe este archivo: la rebanada anterior puso los días REALES de
 * atraso en el listado. Como a estos estados el job de mora no les asigna
 * nada, pasaron a salir con 0 días y se hundieron al fondo de la lista, pero
 * con la etiqueta "mora 90" pegada. La decisión de producto no fue ordenarlos
 * distinto sino sacarlos: si no hay mora que cobrar, no hay nada que gestionar.
 */

describe("devengaMora: los cinco estados que el job de mora excluye", () => {
	test("crédito en convenio: no se gestiona en cobranza", () => {
		expect(devengaMora("EN_CONVENIO")).toBe(false);
	});

	test("incobrable: no se gestiona en cobranza", () => {
		expect(devengaMora("INCOBRABLE")).toBe(false);
	});

	test("cancelado: no se gestiona en cobranza", () => {
		expect(devengaMora("CANCELADO")).toBe(false);
	});

	test("pendiente de cancelación: no se gestiona en cobranza", () => {
		expect(devengaMora("PENDIENTE_CANCELACION")).toBe(false);
	});

	test("caído: no se gestiona en cobranza", () => {
		expect(devengaMora("CAIDO")).toBe(false);
	});

	test("activo y moroso SÍ se gestionan", () => {
		expect(devengaMora("ACTIVO")).toBe(true);
		expect(devengaMora("MOROSO")).toBe(true);
	});

	test("estado desconocido o ausente: se gestiona (no se esconde en silencio)", () => {
		// Mismo criterio que cartera-back, que evalúa `statusCredit ?? ""`
		// contra la lista de exclusión. Un estado que no reconocemos puede
		// perfectamente tener mora viva: dejar de mostrarlo sería dejar de
		// cobrar sin que nadie se entere. Mostrarlo de más cuesta una fila.
		expect(devengaMora(null)).toBe(true);
		expect(devengaMora(undefined)).toBe(true);
		expect(devengaMora("")).toBe(true);
		expect(devengaMora("ESTADO_QUE_NO_EXISTE")).toBe(true);
	});
});

describe("STATUS_CREDITO_COBRABLES: lo que se le pide a cartera-back", () => {
	test("son exactamente activo y moroso", () => {
		expect([...STATUS_CREDITO_COBRABLES].sort()).toEqual(["ACTIVO", "MOROSO"]);
	});

	test("ningún estado excluido se cuela en la lista blanca", () => {
		for (const status of STATUS_SIN_MORA) {
			expect(STATUS_CREDITO_COBRABLES).not.toContain(status);
		}
	});
});

describe("etapaCobrable: el filtro guardado en el navegador", () => {
	test("las etapas que apuntan a un estado sin mora ya no muestran nada", () => {
		expect(etapaCobrable("en_convenio")).toBe(false);
		expect(etapaCobrable("incobrable")).toBe(false);
		expect(etapaCobrable("completado")).toBe(false);
		expect(etapaCobrable("pendiente_cancelacion")).toBe(false);
	});

	test("las etapas de mora y al día siguen funcionando", () => {
		for (const etapa of [
			"al_dia",
			"mora_30",
			"mora_60",
			"mora_90",
			"mora_120",
		]) {
			expect(etapaCobrable(etapa)).toBe(true);
		}
	});

	test("sin filtro (o con uno desconocido) no se bloquea la lista", () => {
		expect(etapaCobrable(undefined)).toBe(true);
		expect(etapaCobrable(null)).toBe(true);
		expect(etapaCobrable("mora_120_plus")).toBe(true);
	});
});

describe("CONTRATO: la lista no se separa de la de cartera-back", () => {
	test("STATUS_SIN_MORA es la misma lista que STATUS_EXCLUIDOS_MORA", () => {
		// La copia existe porque el server del CRM no compila nada fuera de su
		// `src/`. Esta prueba es el candado: si alguien agrega o quita un estado
		// allá, acá se pone roja.
		// Se busca en los dos lugares donde la lista puede estar declarada: nació
		// en latefee.ts y hay una extracción en curso a constants/creditStatus.ts.
		// Así el candado sigue vivo después de la mudanza.
		const candidatos = [
			"../../../../../cartera-back/src/controllers/latefee.ts",
			"../../../../../cartera-back/src/constants/creditStatus.ts",
		];
		let bloque: RegExpMatchArray | null = null;
		for (const ruta of candidatos) {
			let fuente: string;
			try {
				fuente = readFileSync(new URL(ruta, import.meta.url), "utf8");
			} catch {
				continue;
			}
			const encontrado = fuente.match(
				/export const STATUS_EXCLUIDOS_MORA\s*=\s*\[([^\]]*)\]/,
			);
			if (encontrado) {
				bloque = encontrado;
				break;
			}
		}
		expect(bloque).not.toBeNull();
		const enCartera = [...(bloque?.[1] ?? "").matchAll(/"([A-Z_]+)"/g)].map(
			(m) => m[1],
		);
		expect(enCartera.length).toBe(5);
		expect([...enCartera].sort()).toEqual([...STATUS_SIN_MORA].sort());
	});
});

describe("CONTRATO: el router de cobranza filtra en origen", () => {
	const fuente = readFileSync(
		new URL("../routers/cobros.ts", import.meta.url),
		"utf8",
	);

	test("toda consulta de cobranza le manda la lista blanca a cartera-back", () => {
		// Va en el único helper por el que pasan listado, búsqueda por placa,
		// filtro por etiquetas y envío masivo. Si esto desaparece, el filtro se
		// tendría que hacer en memoria después de paginar: páginas de tamaño
		// irregular y total inflado.
		expect(fuente).toContain("estados_credito: STATUS_CREDITO_COBRABLES");
	});

	test("una etapa guardada que ya no se gestiona contesta vacío", () => {
		expect(fuente).toContain("if (!etapaCobrable(input.estadoMora))");
	});

	test("no se abre caso de cobranza a un crédito sin mora", () => {
		expect(fuente).toContain(
			"devengaMora(creditoCompleto.credito.statusCredit)",
		);
		// El corte viejo miraba sólo CANCELADO y le creaba caso a incobrables,
		// convenios, caídos y pendientes de cancelación.
		expect(fuente).not.toContain(
			'creditoCompleto.credito.statusCredit !== "CANCELADO"',
		);
	});

	test("el embudo no ofrece barras cuya lista quedó vacía", () => {
		expect(fuente).not.toContain('estadoMora: "completado"');
		expect(fuente).not.toContain('estadoMora: "incobrable"');
	});
});

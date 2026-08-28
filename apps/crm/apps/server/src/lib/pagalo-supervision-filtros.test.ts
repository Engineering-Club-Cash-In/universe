/**
 * CB-127 · No hay DB de test en el repo, así que en vez de ejecutar el SQL
 * contra Postgres, se afirma la ESTRUCTURA del predicado: qué ramas OR/AND
 * arma para cada combinación de input. Sirve para detectar que alguien
 * rompió una rama (por ejemplo, borró el caso LINKS_PENDING huérfano) sin
 * tener que levantar una base.
 */

import { describe, expect, test } from "bun:test";
import type { SQL } from "drizzle-orm";
import {
	condicionesFiltro,
	condicionGrupoProblematico,
	PENDING_PAYMENT_ESTANCADO_DIAS,
} from "./pagalo-supervision-filtros";

/**
 * El SQL de Drizzle tiene referencias circulares (columna → tabla → columna),
 * así que JSON.stringify no sirve. `.queryChunks` da las piezas planas sin
 * ciclo: nombres de columna, texto literal ("in", "and", "or", …) y
 * placeholders de parámetros — alcanza para afirmar qué ramas arma la
 * función sin acoplarse a la forma interna completa de drizzle-orm.
 */
function textoPlano(condicion: SQL): string {
	const piezas: string[] = [];
	const visitar = (valor: unknown) => {
		if (typeof valor === "string") {
			piezas.push(valor);
			return;
		}
		if (Array.isArray(valor)) {
			for (const v of valor) visitar(v);
			return;
		}
		if (!valor || typeof valor !== "object") return;
		// biome-ignore lint/suspicious/noExplicitAny: recorre estructura interna de drizzle-orm sin tipos públicos
		const obj = valor as any;
		// or()/and() anidan un SQL completo con su propio queryChunks — hay que
		// bajar un nivel más en vez de tratarlo como hoja.
		if (Array.isArray(obj.queryChunks)) {
			visitar(obj.queryChunks);
			return;
		}
		if (typeof obj.name === "string") piezas.push(obj.name);
		if (typeof obj.value === "string") piezas.push(obj.value);
	};
	// biome-ignore lint/suspicious/noExplicitAny: recorre estructura interna de drizzle-orm sin tipos públicos
	visitar((condicion as any).queryChunks);
	return piezas.join(" ");
}

describe("condicionGrupoProblematico", () => {
	test("arma una condición SQL sin tirar", () => {
		const condicion = condicionGrupoProblematico();
		expect(condicion).toBeDefined();
		// El SQL de Drizzle serializa a un objeto con .queryChunks; alcanza con
		// afirmar que menciona los tres estados/columnas que arma la función,
		// sin acoplarse a la forma exacta interna de drizzle-orm.
		const sql = textoPlano(condicion);
		expect(sql).toContain("REVIEW_REQUIRED");
		expect(sql).toContain("APPLICATION_FAILED");
		expect(sql).toContain("LINKS_PENDING");
		expect(sql).toContain("PENDING_PAYMENT");
	});
});

describe("condicionesFiltro", () => {
	test("sin filtros no arma ninguna condición", () => {
		expect(condicionesFiltro({})).toEqual([]);
	});

	test("estados explícitos arman una condición", () => {
		const condiciones = condicionesFiltro({
			estados: ["REVIEW_REQUIRED"],
		});
		expect(condiciones).toHaveLength(1);
		expect(textoPlano(condiciones[0] as SQL)).toContain("REVIEW_REQUIRED");
	});

	test("soloHuerfanos arma la condición LINKS_PENDING + antigüedad", () => {
		const condiciones = condicionesFiltro({ soloHuerfanos: true });
		expect(condiciones).toHaveLength(1);
		expect(textoPlano(condiciones[0] as SQL)).toContain("LINKS_PENDING");
	});

	test("antiguedadMinDias arma una condición de fecha", () => {
		const condiciones = condicionesFiltro({ antiguedadMinDias: 3 });
		expect(condiciones).toHaveLength(1);
	});

	test("antiguedadMinDias=0 no arma condición (no tiene sentido filtrar por 0 días)", () => {
		expect(condicionesFiltro({ antiguedadMinDias: 0 })).toEqual([]);
	});

	test("combina varios filtros en varias condiciones", () => {
		const condiciones = condicionesFiltro({
			estados: ["APPLICATION_FAILED"],
			antiguedadMinDias: 5,
		});
		expect(condiciones).toHaveLength(2);
	});
});

test("el umbral de PENDING_PAYMENT estancado es 7 días", () => {
	expect(PENDING_PAYMENT_ESTANCADO_DIAS).toBe(7);
});

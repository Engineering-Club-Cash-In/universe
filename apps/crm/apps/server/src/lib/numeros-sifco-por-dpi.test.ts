import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { ConsultaMoraNoDisponibleError } from "../types/cartera-back";
import {
	consultaNumerosSifcoDeLead,
	consultaNumerosSifcoPorDpi,
	exigirNumerosCompletos,
	SONDA_DESBORDE_NUMEROS,
	TOPE_NUMEROS_CREDITO_CONOCIDOS,
	unirNumerosSifco,
} from "./numeros-sifco-por-dpi";

const sqlDe = (dpi: string) =>
	consultaNumerosSifcoPorDpi(drizzle.mock(), dpi)
		.toSQL()
		.sql.replace(/\s+/g, " ")
		.toLowerCase();

const consultaDelLead = consultaNumerosSifcoDeLead(
	drizzle.mock(),
	"8f14e45f-ceea-467a-9f07-6c0b6e0a1c33",
);
const sqlDelLead = consultaDelLead
	.toSQL()
	.sql.replace(/\s+/g, " ")
	.toLowerCase();

describe("números de SIFCO que el CRM conoce para un DPI", () => {
	/**
	 * 🔴 El tope corta FILAS, no números distintos. Con el DISTINCT en JS, un
	 * lead con el mismo numeroSifco repetido en varias oportunidades llenaba las
	 * 50 filas con duplicados y el crédito que importaba se quedaba afuera: el
	 * gate armaba el veredicto sin él.
	 */
	test("deduplica en SQL, antes del tope", () => {
		const consulta = sqlDe("3460666380101");

		expect(consulta).toContain("select distinct");
		expect(consulta.indexOf("distinct")).toBeLessThan(
			consulta.indexOf("limit"),
		);
	});

	/**
	 * El mismo número guardado una vez con espacios y otra sin ellos son dos
	 * filas para el DISTINCT: si no se recortan en SQL, el dedup no los ve como
	 * uno solo y vuelve a gastar dos lugares del tope.
	 */
	test("recorta los espacios en SQL para que el dedup sirva de algo", () => {
		expect(sqlDe("3460666380101")).toContain("trim(");
	});

	/**
	 * Un "   " no es NULL ni '': sin recortarlo en el filtro se cuela como
	 * número válido y ocupa un lugar del tope sin aportar nada.
	 */
	test("descarta los vacíos y los espacios en blanco en el filtro", () => {
		const consulta = sqlDe("3460666380101");

		expect(consulta).toContain("is not null");
		expect(consulta).toContain('trim("opportunities"."numero_sifco") <>');
	});

	test("sigue acotado al tope que el contrato de cartera admite", () => {
		expect(sqlDe("3460666380101")).toContain("limit");
		expect(TOPE_NUMEROS_CREDITO_CONOCIDOS).toBe(50);
	});

	/**
	 * 🔴 Con `limit(50)` a secas el recorte era invisible: la fila 51 se quedaba
	 * en la base sin que nadie se enterara. Se pide una de más solo para poder
	 * VERLO.
	 */
	test("pide una fila de más para poder detectar el desborde", () => {
		expect(SONDA_DESBORDE_NUMEROS).toBe(TOPE_NUMEROS_CREDITO_CONOCIDOS + 1);
		expect(
			consultaNumerosSifcoPorDpi(drizzle.mock(), "3460666380101").toSQL()
				.params,
		).toContain(SONDA_DESBORDE_NUMEROS);
	});

	/**
	 * Los DPI viejos quedaron guardados con espacios: un `=` crudo no reconoce a
	 * esa persona y la consulta sale vacía (ver `eqDpi`).
	 */
	test("compara el DPI ignorando el formato con que quedó guardado", () => {
		expect(sqlDe("3460 66638 0101")).toContain("regexp_replace");
	});
});

describe("desborde de una fuente: fail-closed, no cobertura recortada", () => {
	const filas = (cuantas: number) =>
		Array.from({ length: cuantas }, (_, i) => ({ numeroSifco: `CRM-${i}` }));

	test("hasta el tope, la lista está completa y no molesta a nadie", () => {
		expect(() =>
			exigirNumerosCompletos(
				filas(TOPE_NUMEROS_CREDITO_CONOCIDOS),
				"3460666380101",
			),
		).not.toThrow();
		expect(() => exigirNumerosCompletos([], "3460666380101")).not.toThrow();
	});

	/**
	 * 🔴 Truncar en silencio dejaba pasar morosos: si el único número que mapeaba
	 * al crédito moroso era justo el que quedó afuera, cartera contestaba
	 * SIN_MORA sobre una cartera a medias. "No pude ver todo" tiene que frenar,
	 * igual que "cartera no contestó".
	 */
	test("con la fila sonda corta con el error que el gate lee como caída", () => {
		expect(() =>
			exigirNumerosCompletos(filas(SONDA_DESBORDE_NUMEROS), "3460666380101"),
		).toThrow(ConsultaMoraNoDisponibleError);
	});

	test("el mensaje manda a revisión manual, no a reintentar", () => {
		try {
			exigirNumerosCompletos(filas(SONDA_DESBORDE_NUMEROS), "3460666380101");
			throw new Error("debió lanzar");
		} catch (error) {
			expect(error).toBeInstanceOf(ConsultaMoraNoDisponibleError);
			expect((error as Error).message).toContain("revisión manual");
			expect((error as Error).message).toContain(
				String(TOPE_NUMEROS_CREDITO_CONOCIDOS),
			);
		}
	});
});

/**
 * 🔴 La consulta hermana. Buscando SOLO por el DPI nuevo, el lead que tiene su
 * propio crédito moroso —un `CRM-<uuid>` o un `insoluto-N`, que SIFCO nunca
 * devuelve— se sacaba el gate de encima tecleando un DPI virgen: cartera
 * contestaba CLIENTE_NO_ENCONTRADO y el cambio pasaba para un no-admin. Su
 * propia deuda quedaba fuera de su propia evaluación.
 */
describe("números de SIFCO del lead que se está editando", () => {
	test("busca por leadId y NO por dpi: el dpi es justo lo que está cambiando", () => {
		expect(sqlDelLead).toContain('"opportunities"."lead_id" =');
		expect(sqlDelLead).not.toContain("regexp_replace");
		// Sin join a `leads`: el lead ya viene identificado por id.
		expect(sqlDelLead).not.toContain("inner join");
	});

	test("reusa el MISMO saneo: distinct + trim antes del limit", () => {
		expect(sqlDelLead).toContain("select distinct");
		expect(sqlDelLead).toContain("trim(");
		expect(sqlDelLead).toContain("is not null");
		expect(sqlDelLead).toContain('trim("opportunities"."numero_sifco") <>');
		expect(sqlDelLead.indexOf("distinct")).toBeLessThan(
			sqlDelLead.indexOf("limit"),
		);
	});

	test("sigue acotada al mismo tope que el contrato de cartera admite", () => {
		expect(sqlDelLead).toContain(
			`limit $${consultaDelLead.toSQL().params.length}`,
		);
		expect(consultaDelLead.toSQL().params).toContain(
			TOPE_NUMEROS_CREDITO_CONOCIDOS,
		);
	});
});

describe("unión de las dos fuentes", () => {
	test("junta los del DPI nuevo con los del lead editado", () => {
		expect(unirNumerosSifco(["01010214124060"], ["insoluto-3"]).sort()).toEqual(
			["01010214124060", "insoluto-3"],
		);
	});

	test("no repite el número que ambas fuentes conocen", () => {
		expect(unirNumerosSifco(["01010214124060"], ["01010214124060"])).toEqual([
			"01010214124060",
		]);
	});

	test("descarta vacíos y espacios, y tolera una fuente vacía", () => {
		expect(unirNumerosSifco(["", "   "], [])).toEqual([]);
		expect(unirNumerosSifco([], [" insoluto-3 "])).toEqual(["insoluto-3"]);
	});

	/**
	 * 🔴 Cada consulta acota SU lado en 50, pero la unión de dos lados llenos
	 * llegaba a 100 y cartera rechaza el cuerpo por `maxItems: 50`. El CRM leía
	 * ese rechazo como una caída y el gate bloqueaba una corrección válida sin
	 * que nadie estuviera caído.
	 */
	test("la unión no puede pasarse del tope que cartera admite", () => {
		const cincuenta = Array.from({ length: 50 }, (_, i) => `entidad-${i}`);
		const otrosCincuenta = Array.from({ length: 50 }, (_, i) => `dpi-${i}`);

		expect(unirNumerosSifco(cincuenta, otrosCincuenta)).toHaveLength(
			TOPE_NUMEROS_CREDITO_CONOCIDOS,
		);
	});

	test("al cortar sobreviven los de la entidad editada, que van primero", () => {
		// Son los números que su propio expediente exige mirar: el DPI nuevo no
		// los puede aportar y son justo los que el editor intenta esquivar.
		const delLead = ["insoluto-3", "CRM-8f14e45f"];
		const porDpi = Array.from({ length: 60 }, (_, i) => `dpi-${i}`);

		const unidos = unirNumerosSifco(delLead, porDpi);

		expect(unidos).toHaveLength(TOPE_NUMEROS_CREDITO_CONOCIDOS);
		expect(unidos.slice(0, 2)).toEqual(delLead);
	});
});

import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import {
	consultaNumerosSifcoPorDpi,
	TOPE_NUMEROS_CREDITO_CONOCIDOS,
} from "./numeros-sifco-por-dpi";

const sqlDe = (dpi: string) =>
	consultaNumerosSifcoPorDpi(drizzle.mock(), dpi)
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
		expect(consulta).toContain("trim(\"opportunities\".\"numero_sifco\") <>");
	});

	test("sigue acotado al tope que el contrato de cartera admite", () => {
		expect(sqlDe("3460666380101")).toContain("limit");
		expect(TOPE_NUMEROS_CREDITO_CONOCIDOS).toBe(50);
	});

	/**
	 * Los DPI viejos quedaron guardados con espacios: un `=` crudo no reconoce a
	 * esa persona y la consulta sale vacía (ver `eqDpi`).
	 */
	test("compara el DPI ignorando el formato con que quedó guardado", () => {
		expect(sqlDe("3460 66638 0101")).toContain("regexp_replace");
	});
});

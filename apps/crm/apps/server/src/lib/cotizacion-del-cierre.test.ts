import { describe, expect, test } from "bun:test";
import { opportunityCloseQuotations } from "../db/schema/quotations";
import { guardarCotizacionDelCierre } from "./cotizacion-del-cierre";

function conexionFalsa(falla = false) {
	const llamadas: Array<{
		tabla: unknown;
		valores: unknown;
		conflicto: unknown;
	}> = [];
	const conexion = {
		insert: (tabla: unknown) => ({
			values: (valores: unknown) => ({
				onConflictDoUpdate: async (conflicto: unknown) => {
					if (falla) throw new Error("BD no disponible");
					llamadas.push({ tabla, valores, conflicto });
				},
			}),
		}),
	};
	return { conexion: conexion as never, llamadas };
}

describe("guardarCotizacionDelCierre", () => {
	test("guarda la cotización del cierre y, si se vuelve a cerrar, la reemplaza", async () => {
		const { conexion, llamadas } = conexionFalsa();
		await guardarCotizacionDelCierre("opp-1", "cot-1", conexion);
		expect(llamadas).toHaveLength(1);
		expect(llamadas[0]?.tabla).toBe(opportunityCloseQuotations);
		expect(llamadas[0]?.valores).toEqual({
			opportunityId: "opp-1",
			quotationId: "cot-1",
		});
		expect(llamadas[0]?.conflicto).toMatchObject({
			target: opportunityCloseQuotations.opportunityId,
			set: { quotationId: "cot-1" },
		});
	});

	test("si la BD falla no lanza: no puede tumbar el cierre", async () => {
		const { conexion } = conexionFalsa(true);
		await expect(
			guardarCotizacionDelCierre("opp-1", "cot-1", conexion),
		).resolves.toBeUndefined();
	});
});

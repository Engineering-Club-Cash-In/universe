import { expect, test } from "bun:test";
import { CarteraBackClient } from "./cartera-back-client";

const fetchTransport = (
	handler: (
		...args: Parameters<typeof globalThis.fetch>
	) => ReturnType<typeof globalThis.fetch>,
) => Object.assign(handler, { preconnect: globalThis.fetch.preconnect });

/**
 * El `data: null` de "este DPI no es de nadie" es una respuesta 200 como
 * cualquier otra: con la caché encendida se guarda cinco minutos.
 *
 * El alta puede pasar en otra instancia del CRM o directamente en cartera, y el
 * `invalidate` de `createInvestor` solo alcanza a la caché del proceso que
 * atendió. Entonces el negativo viejo sobrevive, la detección no encuentra a la
 * persona recién creada y —sin el interruptor "¿Es empresa?"— el alta de su
 * sociedad rebota como duplicada sin ninguna salida.
 */
test("la búsqueda de identidad no reusa el 'no existe' de hace un momento", async () => {
	let llamadas = 0;
	const client = new CarteraBackClient({
		baseUrl: "https://cartera.test",
		retryAttempts: 0,
		enableCache: true,
		accessTokenProvider: async () => "test-token",
		fetchTransport: fetchTransport(async () => {
			llamadas += 1;
			// Entre una consulta y la otra alguien más dio de alta a la persona.
			return llamadas === 1
				? Response.json({ success: true, data: null })
				: Response.json({
						success: true,
						data: {
							inversionista_id: 187,
							nombre: "Ana",
							email: null,
							dpi: "4036613",
							via: "directo",
							sociedad: null,
						},
					});
		}),
	});

	const primera = await client.buscarIdentidadInversionista({ dpi: "4036613" });
	expect(primera.data).toBeNull();

	const segunda = await client.buscarIdentidadInversionista({ dpi: "4036613" });

	expect(llamadas).toBe(2);
	expect(segunda.data).toMatchObject({ inversionista_id: 187, via: "directo" });
});

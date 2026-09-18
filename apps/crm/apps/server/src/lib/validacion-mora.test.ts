import { describe, expect, test } from "bun:test";
import {
	ConsultaMoraNoDisponibleError,
	type ConsultaMoraResponse,
} from "../types/cartera-back";
import type { AuditEntry } from "./audit";
import { resolverValidacionMora } from "./validacion-mora";

/**
 * El gate de mora por DPI.
 *
 * Lo que se prueba acá no es "llama a cartera", sino la regla que pidió el
 * dueño del producto: **fail-closed**. No saber nunca puede verse igual que
 * saber que no hay mora, y las tres salidas —bloqueado, limpio y no se pudo
 * consultar— tienen que quedar separadas en la bitácora.
 *
 * Sin `mock.module` a propósito: en bun reemplazar un módulo es global al
 * proceso y envenena a los otros setenta archivos de test (y ellos a este). Las
 * dependencias entran por parámetro, así que alcanzan funciones comunes.
 */

const DPI = "3460666380101";

const BASE: ConsultaMoraResponse = {
	encontrado: true,
	tieneMoraActiva: false,
	puedeContinuar: true,
	motivo: "SIN_MORA",
	cliente: { codigoClienteSifco: "CL-1", nombre: "Ana López" },
	creditos: [
		{ numeroCreditoSifco: "0101", estado: "ACTIVO", moraActiva: null },
	],
	historialMora: [],
	consultadoEn: "2026-09-17T10:00:00.000Z",
};

/** Banco de pruebas: registra a quién se consultó y qué quedó anotado. */
function banco(
	responder: (dpi: string) => Promise<ConsultaMoraResponse>,
	validar: (
		dpi: string,
	) => ReturnType<
		NonNullable<Parameters<typeof resolverValidacionMora>[1]>["validar"]
	> = (dpi) => ({ valid: true, dpiLimpio: dpi.replace(/\s/g, "") }),
) {
	const consultados: string[] = [];
	const anotaciones: AuditEntry[] = [];
	return {
		consultados,
		anotaciones,
		deps: {
			validar,
			consultar: (dpi: string) => {
				consultados.push(dpi);
				return responder(dpi);
			},
			anotar: (entrada: AuditEntry) => {
				anotaciones.push(entrada);
			},
		},
	};
}

const veredicto = async (
	resultado: Awaited<ReturnType<typeof resolverValidacionMora>>,
) => {
	if (resultado.tipo !== "veredicto") {
		throw new Error(`se esperaba un veredicto, vino ${resultado.tipo}`);
	}
	return resultado.veredicto;
};

describe("resolverValidacionMora", () => {
	test("con mora activa: bloquea y lo deja anotado como bloqueo", async () => {
		const { deps, anotaciones } = banco(async () => ({
			...BASE,
			tieneMoraActiva: true,
			puedeContinuar: false,
			motivo: "MORA_ACTIVA",
			creditos: [
				{
					numeroCreditoSifco: "0101",
					estado: "MOROSO",
					moraActiva: { monto: "1250.00", cuotasAtrasadas: 2 },
				},
			],
			historialMora: [
				{
					fecha: "2026-09-01",
					monto: "1250.00",
					numeroCreditoSifco: "0101",
					evento: "MORA_GENERADA",
				},
			],
		}));

		const res = await veredicto(await resolverValidacionMora(DPI, deps));

		expect(res.puedeContinuar).toBe(false);
		expect(res.motivo).toBe("MORA_ACTIVA");
		// El historial viaja: la pantalla lo necesita para mostrar la advertencia.
		expect(res.historialMora).toHaveLength(1);
		expect(res.mensaje).toBe("El cliente tiene mora activa en 1 crédito.");
		expect(anotaciones).toEqual([
			expect.objectContaining({ action: "validar_mora_dpi_bloqueado" }),
		]);
	});

	test("sin mora: pasa y queda anotado como paso limpio", async () => {
		const { deps, anotaciones } = banco(async () => BASE);

		const res = await veredicto(await resolverValidacionMora(DPI, deps));

		expect(res.puedeContinuar).toBe(true);
		expect(res.motivo).toBe("SIN_MORA");
		expect(res.mensaje).toBe("El cliente no tiene mora activa en cartera.");
		expect(anotaciones).toEqual([
			expect.objectContaining({ action: "validar_mora_dpi_sin_bloqueo" }),
		]);
	});

	/**
	 * Camino 1 del fail-closed: cartera no contesta (red, timeout, 5xx, circuit
	 * breaker). El cliente lanza y acá hay que convertirlo en un "no se puede
	 * continuar" — nunca dejar que suba como error genérico ni, peor, responder
	 * un optimista "sin mora".
	 */
	test("cartera caída: no deja pasar, y con motivo de servicio", async () => {
		const { deps } = banco(async () => {
			throw new ConsultaMoraNoDisponibleError("cartera no responde", null);
		});

		const res = await veredicto(await resolverValidacionMora(DPI, deps));

		expect(res.puedeContinuar).toBe(false);
		expect(res.motivo).toBe("SERVICIO_NO_DISPONIBLE");
		expect(res.tieneMoraActiva).toBe(false);
		expect(res.mensaje).toContain("no está disponible");
	});

	/**
	 * Camino 2, el traicionero: cartera responde **200** con el contrato completo
	 * y `motivo: "SERVICIO_NO_DISPONIBLE"`. No hay excepción, y `tieneMoraActiva`
	 * viene en `false` — que acá significa "no consta", no "está al día".
	 * El `puedeContinuar: true` del stub va a propósito: aunque cartera se
	 * contradiga, el motivo manda y no se deja pasar.
	 */
	test("200 con motivo SERVICIO_NO_DISPONIBLE tampoco deja pasar", async () => {
		const { deps } = banco(async () => ({
			...BASE,
			encontrado: false,
			tieneMoraActiva: false,
			puedeContinuar: true,
			motivo: "SERVICIO_NO_DISPONIBLE",
			cliente: null,
			creditos: [],
		}));

		const res = await veredicto(await resolverValidacionMora(DPI, deps));

		expect(res.puedeContinuar).toBe(false);
		expect(res.motivo).toBe("SERVICIO_NO_DISPONIBLE");
		expect(res.mensaje).toContain("no está disponible");
	});

	/**
	 * La distinción que se pidió para la auditoría: con fail-closed, media hora
	 * de SIFCO caído frena TODAS las solicitudes. Si esas filas se vieran como
	 * bloqueos por mora, la bitácora diría "hubo cuarenta morosos" cuando lo que
	 * hubo fue una caída.
	 */
	test.each([
		[
			"cartera no responde",
			async () => {
				throw new ConsultaMoraNoDisponibleError("cartera no responde", null);
			},
		],
		[
			"cartera responde 200 pero sin poder consultar",
			async () => ({
				...BASE,
				puedeContinuar: false,
				motivo: "SERVICIO_NO_DISPONIBLE" as const,
			}),
		],
	])("la bitácora distingue 'no se pudo consultar' del bloqueo por mora (%s)", async (_caso, responder) => {
		const { deps, anotaciones } = banco(
			responder as () => Promise<ConsultaMoraResponse>,
		);

		await resolverValidacionMora(DPI, deps);

		expect(anotaciones).toEqual([
			expect.objectContaining({
				action: "validar_mora_dpi_no_disponible",
				ok: false,
				errorCode: "SERVICIO_NO_DISPONIBLE",
			}),
		]);
	});

	test("un error que no es de disponibilidad sí se propaga", async () => {
		const { deps, anotaciones } = banco(async () => {
			throw new TypeError("bug de programación");
		});

		await expect(resolverValidacionMora(DPI, deps)).rejects.toBeInstanceOf(
			TypeError,
		);
		expect(anotaciones).toEqual([]);
	});

	test("DPI inválido: rebota sin molestar a cartera", async () => {
		const { deps, consultados, anotaciones } = banco(
			async () => BASE,
			() => ({ valid: false, error: "DPI inválido, debe tener 13 dígitos" }),
		);

		const res = await resolverValidacionMora("34606663", deps);

		expect(res).toEqual({
			tipo: "dpi_invalido",
			error: "DPI inválido, debe tener 13 dígitos",
		});
		expect(consultados).toEqual([]);
		expect(anotaciones).toEqual([]);
	});

	test("el DPI llega a cartera normalizado, sin los espacios del formato", async () => {
		const { deps, consultados } = banco(async () => BASE);

		await resolverValidacionMora("3460 66638 0101", deps);

		expect(consultados).toEqual([DPI]);
	});

	test("con un crédito CAIDO sin fila de mora, el mensaje NO dice '0 créditos'", async () => {
		// Cartera declara MORA_ACTIVA también por estado (MOROSO/CAIDO/INCOBRABLE)
		// aunque `moraActiva` venga en null. Contando solo las filas vivas, el
		// texto contradecía al veredicto que lo acompañaba.
		const { deps } = banco(async () => ({
			...BASE,
			tieneMoraActiva: true,
			puedeContinuar: false,
			motivo: "MORA_ACTIVA",
			creditos: [
				{ numeroCreditoSifco: "AAA", estado: "CAIDO", moraActiva: null },
			],
		}));

		const res = await veredicto(await resolverValidacionMora(DPI, deps));

		expect(res.mensaje).toBe("El cliente tiene mora activa en 1 crédito.");
	});

	test("cuenta los créditos por fila viva O por estado, sin duplicar", async () => {
		const { deps, anotaciones } = banco(async () => ({
			...BASE,
			tieneMoraActiva: true,
			puedeContinuar: false,
			motivo: "MORA_ACTIVA",
			creditos: [
				// Fila viva Y estado con mora: es UN crédito, no dos.
				{
					numeroCreditoSifco: "AAA",
					estado: "MOROSO",
					moraActiva: { monto: "1200.00", cuotasAtrasadas: 3 },
				},
				// Solo estado.
				{ numeroCreditoSifco: "BBB", estado: "INCOBRABLE", moraActiva: null },
				// Ninguno de los dos: no cuenta.
				{ numeroCreditoSifco: "CCC", estado: "ACTIVO", moraActiva: null },
			],
		}));

		const res = await veredicto(await resolverValidacionMora(DPI, deps));

		expect(res.mensaje).toBe("El cliente tiene mora activa en 2 créditos.");
		// La bitácora cuenta lo mismo que el texto, o el conteo se separa.
		expect(anotaciones[0]?.data).toMatchObject({ creditosConMora: 2 });
	});

	test("si el detalle no permite contar, el mensaje va sin número antes que mentir", async () => {
		const { deps } = banco(async () => ({
			...BASE,
			tieneMoraActiva: true,
			puedeContinuar: false,
			motivo: "MORA_ACTIVA",
			creditos: [],
		}));

		const res = await veredicto(await resolverValidacionMora(DPI, deps));

		expect(res.mensaje).toBe("El cliente tiene mora activa en cartera.");
		expect(res.mensaje).not.toContain("0 crédito");
	});

	test("el mensaje de servicio caído tutea, como el resto del server", async () => {
		const { deps } = banco(async () => ({
			...BASE,
			puedeContinuar: false,
			motivo: "SERVICIO_NO_DISPONIBLE",
		}));

		const res = await veredicto(await resolverValidacionMora(DPI, deps));

		expect(res.mensaje).toContain("Intenta de nuevo");
	});

	test("el motivo del veredicto se refleja en el mensaje de pantalla", async () => {
		const { deps } = banco(async () => ({
			...BASE,
			encontrado: false,
			puedeContinuar: false,
			motivo: "CLIENTE_NO_ENCONTRADO",
			cliente: null,
			creditos: [],
		}));

		const res = await veredicto(await resolverValidacionMora(DPI, deps));

		expect(res.mensaje).toBe(
			"El DPI no corresponde a ningún cliente registrado en cartera.",
		);
	});
});

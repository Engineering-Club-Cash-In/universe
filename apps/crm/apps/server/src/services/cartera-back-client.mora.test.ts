import { expect, test } from "bun:test";
import { ConsultaMoraNoDisponibleError } from "../types/cartera-back";
import {
	CarteraBackClient,
	conPresupuestoConsultaMora,
	leerTimeoutConsultaMora,
} from "./cartera-back-client";

const fetchTransport = (
	handler: (
		...args: Parameters<typeof globalThis.fetch>
	) => ReturnType<typeof globalThis.fetch>,
) => Object.assign(handler, { preconnect: globalThis.fetch.preconnect });

const cliente = (
	handler: (
		...args: Parameters<typeof globalThis.fetch>
	) => ReturnType<typeof globalThis.fetch>,
) =>
	new CarteraBackClient({
		baseUrl: "https://cartera.test",
		retryAttempts: 0,
		retryDelay: 0,
		enableCache: true,
		accessTokenProvider: async () => "test-token",
		fetchTransport: fetchTransport(handler),
	});

const RESPUESTA_SIN_MORA = {
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

test("con mora activa devuelve el veredicto de cartera tal cual", async () => {
	const client = cliente(async () =>
		Response.json({
			...RESPUESTA_SIN_MORA,
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
		}),
	);

	const res = await client.consultarMoraPorDpi("3460666380101");

	expect(res.puedeContinuar).toBe(false);
	expect(res.motivo).toBe("MORA_ACTIVA");
	expect(res.creditos[0].moraActiva).toEqual({
		monto: "1250.00",
		cuotasAtrasadas: 2,
	});
	expect(res.historialMora).toHaveLength(1);
});

test("manda el DPI en el body y va autenticado", async () => {
	let visto: { url: string; init?: RequestInit } | null = null;
	const client = cliente(async (url, init) => {
		visto = { url: String(url), init: init as RequestInit };
		return Response.json(RESPUESTA_SIN_MORA);
	});

	await client.consultarMoraPorDpi("3460666380101");

	expect(visto).not.toBeNull();
	const llamada = visto as unknown as { url: string; init: RequestInit };
	expect(llamada.url).toBe("https://cartera.test/clientes/consulta-mora");
	expect(llamada.init.method).toBe("POST");
	expect(JSON.parse(String(llamada.init.body))).toEqual({
		dpi: "3460666380101",
	});
	expect((llamada.init.headers as Record<string, string>).Authorization).toBe(
		"Bearer test-token",
	);
});

/**
 * Fail-closed, camino 1: cartera no contesta. El método NO puede devolver un
 * objeto —cualquier objeto se leería como veredicto— sino lanzar un error que
 * el llamador está obligado a mirar.
 */
test("cartera caída lanza un error distinguible, nunca un 'sin mora'", async () => {
	const client = cliente(async () =>
		Response.json({ error: "boom" }, { status: 503 }),
	);

	const promesa = client.consultarMoraPorDpi("3460666380101");

	await expect(promesa).rejects.toBeInstanceOf(ConsultaMoraNoDisponibleError);
});

test("un timeout de red también es 'no se pudo saber', no 'no tiene mora'", async () => {
	const client = cliente(async () => {
		throw new Error("network down");
	});

	await expect(
		client.consultarMoraPorDpi("3460666380101"),
	).rejects.toBeInstanceOf(ConsultaMoraNoDisponibleError);
});

/**
 * Un 200 con un cuerpo que no es el contrato es un fallo, no un permiso: sin
 * validar la forma, `{}` se leería como `tieneMoraActiva: undefined` y dejaría
 * pasar a cualquiera.
 */
test("un 200 con cuerpo incompleto no se toma como veredicto", async () => {
	const client = cliente(async () => Response.json({ encontrado: true }));

	await expect(
		client.consultarMoraPorDpi("3460666380101"),
	).rejects.toBeInstanceOf(ConsultaMoraNoDisponibleError);
});

/**
 * El estado de mora cambia solo (cron de cartera) y no hay invalidación posible
 * desde el CRM: una respuesta de hace cinco minutos dejaría pasar a quien acaba
 * de caer en mora. Cada consulta tiene que ir a preguntar de nuevo.
 */
test("no reusa la respuesta anterior aunque la caché esté encendida", async () => {
	let llamadas = 0;
	const client = cliente(async () => {
		llamadas += 1;
		return llamadas === 1
			? Response.json(RESPUESTA_SIN_MORA)
			: Response.json({
					...RESPUESTA_SIN_MORA,
					tieneMoraActiva: true,
					puedeContinuar: false,
					motivo: "MORA_ACTIVA",
				});
	});

	const primera = await client.consultarMoraPorDpi("3460666380101");
	expect(primera.puedeContinuar).toBe(true);

	const segunda = await client.consultarMoraPorDpi("3460666380101");

	expect(llamadas).toBe(2);
	expect(segunda.puedeContinuar).toBe(false);
	expect(segunda.motivo).toBe("MORA_ACTIVA");
});

/**
 * Cada intento puede costar los 25s de SIFCO. Reintentar tres veces deja al
 * asesor esperando más de un minuto y le carga la mano al core justo cuando
 * está sufriendo; bajo fail-closed el costo de no reintentar es un aviso que se
 * puede volver a pedir, no una respuesta equivocada.
 */
test("no reintenta: un solo golpe al core por consulta", async () => {
	let llamadas = 0;
	const client = new CarteraBackClient({
		baseUrl: "https://cartera.test",
		retryAttempts: 3,
		retryDelay: 0,
		accessTokenProvider: async () => "test-token",
		fetchTransport: fetchTransport(async () => {
			llamadas += 1;
			throw new Error("network down");
		}),
	});

	await expect(
		client.consultarMoraPorDpi("3460666380101"),
	).rejects.toBeInstanceOf(ConsultaMoraNoDisponibleError);
	expect(llamadas).toBe(1);
});

/**
 * El timeout sale de una variable de entorno y `AbortSignal.timeout(NaN)`
 * lanza: una errata en la configuración tumbaba los ocho puntos del gate a la
 * vez, y antes de llegar al fail-closed. Lo que se prueba es que cualquier
 * valor que no sea un número de milisegundos usable cae al default.
 */
test("un timeout mal configurado cae al default en vez de dar NaN", () => {
	expect(leerTimeoutConsultaMora("20s")).toBe(12000);
	expect(leerTimeoutConsultaMora("")).toBe(12000);
	expect(leerTimeoutConsultaMora(undefined)).toBe(12000);
	expect(leerTimeoutConsultaMora("0")).toBe(12000);
	expect(leerTimeoutConsultaMora("-5000")).toBe(12000);
	expect(leerTimeoutConsultaMora("Infinity")).toBe(12000);
	expect(Number.isFinite(leerTimeoutConsultaMora("20s"))).toBe(true);
});

test("un timeout válido se respeta", () => {
	expect(leerTimeoutConsultaMora("8000")).toBe(8000);
	expect(leerTimeoutConsultaMora("  8000  ")).toBe(8000);
});

/**
 * "Finito y positivo" no alcanzaba: `AbortSignal.timeout` tiene un techo y
 * lanza `TypeError` por encima de él, así que un número absurdo pasaba la
 * validación y volvía a tumbar todas las llamadas del gate en runtime. Diez
 * minutos además ya no es un timeout para alguien esperando en pantalla.
 */
test("un timeout absurdamente grande también cae al default", () => {
	expect(leerTimeoutConsultaMora("1e30")).toBe(12000);
	expect(leerTimeoutConsultaMora("99999999999999999999")).toBe(12000);
	expect(leerTimeoutConsultaMora("600001")).toBe(12000);
	expect(leerTimeoutConsultaMora("600000")).toBe(600000);
});

/**
 * 🔴 Fail-closed, camino 3: el auth de cartera colgado. El `AbortSignal` de
 * `request()` se arma DESPUÉS de esperar el token, así que con la
 * autenticación pendiente el reloj del fetch no arrancaba nunca y la consulta
 * quedaba viva para siempre — sin veredicto y sin error que el gate pudiera
 * traducir. El presupuesto envuelve la llamada completa.
 */
test("el presupuesto corta aunque la tarea nunca resuelva (auth colgado)", async () => {
	const nuncaResuelve = () => new Promise<never>(() => {});

	await expect(
		conPresupuestoConsultaMora(20, nuncaResuelve),
	).rejects.toBeInstanceOf(ConsultaMoraNoDisponibleError);
});

test("el presupuesto no estorba a la tarea que responde a tiempo", async () => {
	await expect(
		conPresupuestoConsultaMora(1000, async () => "listo"),
	).resolves.toBe("listo");
});

/**
 * El vencimiento no solo suelta la espera: aborta la señal que viaja hasta el
 * fetch. La tarea perdedora que siga corriendo (el auth no es cancelable)
 * encuentra la señal abortada y no dispara el viaje a cartera cuando el token
 * por fin llegue — sin esto, cada intento vencido durante una caída del auth
 * descargaba una ráfaga de consultas inútiles sobre el core al recuperarse.
 */
test("al vencerse el presupuesto, la señal de la tarea queda abortada", async () => {
	let senal: AbortSignal | undefined;

	await expect(
		conPresupuestoConsultaMora(10, (senalVencimiento) => {
			senal = senalVencimiento;
			return new Promise<never>(() => {});
		}),
	).rejects.toBeInstanceOf(ConsultaMoraNoDisponibleError);

	expect(senal?.aborted).toBe(true);
});

test("la tarea que responde a tiempo nunca ve su señal abortada", async () => {
	let senal: AbortSignal | undefined;

	await conPresupuestoConsultaMora(1000, async (senalVencimiento) => {
		senal = senalVencimiento;
		return "listo";
	});

	expect(senal?.aborted).toBe(false);
});

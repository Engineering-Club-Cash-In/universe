/**
 * Cálculo puro del pago con link (CB-105, §4.1/§4.2 del contrato).
 *
 * Sin DB ni red: se prueban las reglas que un cambio descuidado rompería sin
 * que nadie lo note hasta que un cliente pague de más.
 */

import { describe, expect, test } from "bun:test";
import type { CarteraCuotaCredito } from "../../types/cartera-back";
import {
	aplanarLinksEstado,
	aplanarOpciones,
	banderasEstadoLinks,
	buscarOpcionPorMonto,
	calcularOpciones,
	cuotasPagables,
	cuotasVencidasSinSaldo,
	MAXIMO_OPCIONES,
	mensajeEstadoLinks,
	normalizarMonto,
	resumirEstadoLinks,
} from "./pago-link";

function fila(
	numero: number,
	extra: Partial<CarteraCuotaCredito> = {},
): CarteraCuotaCredito {
	return {
		cuota_id: 1000 + numero,
		credito_id: 9350,
		numero_cuota: numero,
		fecha_vencimiento: `2026-${String(numero).padStart(2, "0")}-15`,
		pagado: false,
		createdAt: "2026-01-01T00:00:00Z",
		capital_restante: "800.00",
		interes_restante: "2000.00",
		iva_12_restante: "240.00",
		seguro_restante: "447.62",
		gps_restante: "0.00",
		membresias_restante: "0.00",
		...extra,
	};
}

const EN_CERO = {
	capital_restante: "0.00",
	interes_restante: "0.00",
	iva_12_restante: "0.00",
	seguro_restante: "0.00",
	gps_restante: "0.00",
	membresias_restante: "0.00",
};

describe("cuotasVencidasSinSaldo", () => {
	test("detecta la cuota vencida impaga que quedó sin nada que cobrar", () => {
		// El estado que dejó la reversa en el crédito 9266: cuota 1 vencida, sin
		// pagar y con todos los restantes en cero → el crédito se veía "al día".
		expect(
			cuotasVencidasSinSaldo({
				cuotasAtrasadas: [fila(1, EN_CERO)],
				cuotasPendientes: [fila(2)],
			}),
		).toEqual([1]);
	});

	test("una cuota con saldo en CUALQUIER fila no es un hueco", () => {
		// Pago parcial: la fila sembrada quedó en cero pero la del pago conserva
		// el saldo real (caso Oscar, crédito 624 · cuota 20).
		expect(
			cuotasVencidasSinSaldo({
				cuotasAtrasadas: [
					fila(1, EN_CERO),
					fila(1, { pago_id: 7, capital_restante: "557.12" }),
				],
				cuotasPendientes: [],
			}),
		).toEqual([]);
	});

	test("un pago esperando validación NO es un hueco", () => {
		// Sus restantes están en cero legítimamente hasta que conta valide: era
		// el 90% de los casos al revisar prod.
		expect(
			cuotasVencidasSinSaldo({
				cuotasAtrasadas: [fila(1, { ...EN_CERO, validationStatus: "pending" })],
				cuotasPendientes: [],
			}),
		).toEqual([]);
	});

	test("las cuotas pagadas y la cuota 0 no cuentan", () => {
		expect(
			cuotasVencidasSinSaldo({
				cuotasAtrasadas: [
					fila(0, EN_CERO),
					fila(1, { ...EN_CERO, pagado: true }),
				],
				cuotasPendientes: [],
			}),
		).toEqual([]);
	});

	test("una cuota FUTURA en cero no bloquea (no se está cobrando)", () => {
		// Las colas de calendario en cero (créditos 803, 54 en prod) no impiden
		// cobrar lo vencido.
		expect(
			cuotasVencidasSinSaldo({
				cuotasAtrasadas: [fila(1)],
				cuotasPendientes: [fila(9, EN_CERO)],
			}),
		).toEqual([]);
	});
});

describe("cuotasPagables", () => {
	test("acumula las vencidas y agrega la próxima por vencer", () => {
		const pagables = cuotasPagables({
			cuotasAtrasadas: [fila(3), fila(2), fila(1)],
			cuotasPendientes: [fila(4), fila(5)],
		});
		expect(pagables.map((c) => c.numeroCuota)).toEqual([1, 2, 3, 4]);
		expect(pagables.map((c) => c.vencida)).toEqual([true, true, true, false]);
	});

	test("ignora la cuota 0 y las ya pagadas", () => {
		const pagables = cuotasPagables({
			cuotasAtrasadas: [fila(0), fila(1, { pagado: true })],
			cuotasPendientes: [fila(2)],
		});
		expect(pagables.map((c) => c.numeroCuota)).toEqual([2]);
	});

	test("por cuota toma la fila con MENOR saldo (la más actualizada)", () => {
		const pagables = cuotasPagables({
			cuotasAtrasadas: [
				fila(1),
				fila(1, {
					pago_id: 7,
					capital_restante: "300.00",
					interes_restante: "0.00",
				}),
			],
			cuotasPendientes: [],
		});
		expect(pagables).toHaveLength(1);
		expect(pagables[0]?.capital).toBe("300.00");
		expect(pagables[0]?.interes).toBe("0.00");
	});

	test("una cuota con pago esperando validación NO se ofrece (se cobraría dos veces)", () => {
		const pagables = cuotasPagables({
			cuotasAtrasadas: [
				fila(1),
				fila(1, { pago_id: 9, validationStatus: "pending" }),
			],
			cuotasPendientes: [
				fila(2),
				fila(2, { pago_id: 10, validationStatus: "pending" }),
				fila(3),
			],
		});
		expect(pagables.map((c) => c.numeroCuota)).toEqual([3]);
	});

	test("una cuota sin saldo no entra: dos opciones nunca comparten monto (Codex)", () => {
		const cero = {
			capital_restante: "0.00",
			interes_restante: "0.00",
			iva_12_restante: "0.00",
			seguro_restante: "0.00",
		};
		const pagables = cuotasPagables({
			cuotasAtrasadas: [fila(1, cero), fila(2), fila(3, cero)],
			cuotasPendientes: [fila(4)],
		});
		expect(pagables.map((c) => c.numeroCuota)).toEqual([2, 4]);
		const opciones = calcularOpciones(pagables, "0.00");
		expect(opciones.map((o) => o.etiqueta)).toEqual([
			"1 cuota — Q3,487.62",
			"1 cuota + la próxima — Q6,975.24",
		]);
	});

	test("la misma cuota en atrasadas y pendientes se cuenta una vez", () => {
		const pagables = cuotasPagables({
			cuotasAtrasadas: [fila(1)],
			cuotasPendientes: [fila(1), fila(2)],
		});
		expect(pagables.map((c) => c.numeroCuota)).toEqual([1, 2]);
	});
});

describe("calcularOpciones", () => {
	const tresAtrasadas = cuotasPagables({
		cuotasAtrasadas: [fila(1), fila(2), fila(3)],
		cuotasPendientes: [fila(4), fila(5)],
	});

	test("una opción por acumulado, la mora completa en todas, montos crecientes", () => {
		const opciones = calcularOpciones(tresAtrasadas, "1250.00");
		expect(opciones.map((o) => o.cuotas)).toEqual([1, 2, 3, 4]);
		// 800 + 2000 + 240 + 447.62 = 3487.62 por cuota, + 1250 de mora
		expect(opciones[0]?.montoTotal).toBe("4737.62");
		expect(opciones[0]?.desglose).toEqual({
			cuotas: "3487.62",
			mora: "1250.00",
		});
		expect(opciones[3]?.montoTotal).toBe("15200.48");
		for (const o of opciones) expect(o.desglose.mora).toBe("1250.00");
		const montos = opciones.map((o) => Number(o.montoTotal));
		expect([...montos].sort((a, b) => a - b)).toEqual(montos);
		expect(new Set(montos).size).toBe(montos.length);
	});

	test("capital en un link, todo lo demás en el otro (D-48)", () => {
		const [una] = calcularOpciones(tresAtrasadas, "1250.00");
		expect(una?.calculo.capitalTotal).toBe("800.00");
		// interés + IVA + seguro + mora
		expect(una?.calculo.facturableTotal).toBe("3937.62");
		expect(una?.calculo.allocations.some((a) => a.rubro === "MORA")).toBe(true);
	});

	test("etiquetas: 'N cuotas + mora' y 'N cuotas + la próxima + mora'", () => {
		const opciones = calcularOpciones(tresAtrasadas, "1250.00");
		expect(opciones[0]?.etiqueta).toBe("1 cuota + mora — Q4,737.62");
		expect(opciones[1]?.etiqueta).toBe("2 cuotas + mora — Q8,225.24");
		expect(opciones[3]?.etiqueta).toBe(
			"3 cuotas + la próxima + mora — Q15,200.48",
		);
	});

	test(`máximo ${MAXIMO_OPCIONES} opciones: con 5 atrasadas no se ofrece la próxima`, () => {
		const pagables = cuotasPagables({
			cuotasAtrasadas: [1, 2, 3, 4, 5].map((n) => fila(n)),
			cuotasPendientes: [fila(6)],
		});
		const opciones = calcularOpciones(pagables, "500.00");
		expect(opciones).toHaveLength(MAXIMO_OPCIONES);
		expect(opciones.at(-1)?.cuotas).toBe(4);
		expect(opciones.at(-1)?.etiqueta).toBe("4 cuotas + mora — Q14,450.48");
	});

	test("al día: una sola opción, sin mora aunque cartera traiga una foto vieja", () => {
		const pagables = cuotasPagables({
			cuotasAtrasadas: [],
			cuotasPendientes: [
				fila(9, { fecha_vencimiento: "2026-09-30" }),
				fila(10),
			],
		});
		const opciones = calcularOpciones(pagables, "999.00");
		expect(opciones).toHaveLength(1);
		expect(opciones[0]?.desglose.mora).toBe("0.00");
		expect(opciones[0]?.etiqueta).toBe(
			"Cuota del 30 de septiembre de 2026 — Q3,487.62",
		);
	});

	test("cuota con saldo solo de capital arma un grupo de un link (facturable Q0)", () => {
		const pagables = cuotasPagables({
			cuotasAtrasadas: [],
			cuotasPendientes: [
				fila(2, {
					capital_restante: "788.72",
					interes_restante: "0.00",
					iva_12_restante: "0.00",
					seguro_restante: "0.00",
				}),
			],
		});
		const [opcion] = calcularOpciones(pagables, "0.00");
		expect(opcion?.calculo.capitalTotal).toBe("788.72");
		expect(opcion?.calculo.facturableTotal).toBe("0.00");
	});

	test("sin cuotas no hay opciones", () => {
		expect(calcularOpciones([], "100.00")).toEqual([]);
	});
});

describe("monto como identificador de la opción (D-47)", () => {
	test("normaliza lo que mande el bot", () => {
		expect(normalizarMonto("6179.26")).toBe("6179.26");
		expect(normalizarMonto("Q6,179.26")).toBe("6179.26");
		expect(normalizarMonto(6179.26)).toBe("6179.26");
		expect(normalizarMonto("6179.2")).toBe("6179.20");
		expect(normalizarMonto("6179")).toBe("6179.00");
		expect(normalizarMonto("abc")).toBeNull();
		expect(normalizarMonto("")).toBeNull();
		expect(normalizarMonto("-5")).toBeNull();
	});

	test("encuentra la opción exacta y rechaza montos que ya no existen", () => {
		const opciones = calcularOpciones(
			cuotasPagables({
				cuotasAtrasadas: [fila(1), fila(2)],
				cuotasPendientes: [],
			}),
			"100.00",
		);
		expect(buscarOpcionPorMonto(opciones, "3587.62")?.cuotas).toBe(1);
		expect(buscarOpcionPorMonto(opciones, "7075.24")?.cuotas).toBe(2);
		expect(buscarOpcionPorMonto(opciones, "3587.63")).toBeUndefined();
	});
});

describe("aplanarOpciones", () => {
	test("cantidadOpciones + opcionNEtiqueta/opcionNMonto, como los créditos del paso 1", () => {
		const opciones = calcularOpciones(
			cuotasPagables({
				cuotasAtrasadas: [fila(1)],
				cuotasPendientes: [fila(2)],
			}),
			"0.00",
		);
		expect(aplanarOpciones(opciones)).toEqual({
			cantidadOpciones: 2,
			opcion1Etiqueta: "1 cuota — Q3,487.62",
			opcion1Monto: "3487.62",
			opcion2Etiqueta: "1 cuota + la próxima — Q6,975.24",
			opcion2Monto: "6975.24",
		});
	});
});

describe("estado de los links de la conversación (servicio 9)", () => {
	const link = (
		linkType: "CAPITAL" | "MORA_INTERES",
		status: string,
		extra: Record<string, unknown> = {},
	) =>
		({
			id: `${linkType}-1`,
			linkType,
			status,
			paymentUrl: `https://pagalo/${linkType}`,
			isApplicationSource: false,
			generation: 1,
			...extra,
		}) as never;
	const grupo = (status: string, links: unknown[]) =>
		({
			id: "g1",
			status,
			capitalTotal: "800.00",
			facturableTotal: "3937.62",
			links,
		}) as never;

	test("ninguno pagado: SIN_PAGO con las dos URLs", () => {
		const r = resumirEstadoLinks(
			grupo("PENDING_PAYMENT", [
				link("MORA_INTERES", "ACTIVE"),
				link("CAPITAL", "ACTIVE"),
			]),
		);
		expect(r.estado).toBe("SIN_PAGO");
		// Primero el de mora/interés: es el que cartera consume primero (D-52).
		expect(r.links.map((l) => [l.titulo, l.estado, l.url])).toEqual([
			["Pago 1 de 2", "PENDIENTE", "https://pagalo/MORA_INTERES"],
			["Pago 2 de 2", "PENDIENTE", "https://pagalo/CAPITAL"],
		]);
		expect(mensajeEstadoLinks(r.estado, r.links)).toContain(
			"Todavía no vemos ningún pago",
		);
	});

	test("uno pagado: PARCIAL, dice cuál falta y solo esa URL", () => {
		const r = resumirEstadoLinks(
			grupo("PARTIALLY_PAID", [
				link("CAPITAL", "PAID", { isApplicationSource: true }),
				link("MORA_INTERES", "ACTIVE"),
			]),
		);
		expect(r.estado).toBe("PARCIAL");
		expect(r.links[0]).toMatchObject({
			tipo: "MORA_INTERES",
			titulo: "Pago 1 de 2",
			estado: "PENDIENTE",
			url: "https://pagalo/MORA_INTERES",
		});
		expect(r.links[1]).toMatchObject({
			tipo: "CAPITAL",
			titulo: "Pago 2 de 2",
			estado: "PAGADO",
			url: null,
		});
		const m = mensajeEstadoLinks(r.estado, r.links);
		expect(m).toContain("Recibimos tu *Pago 2 de 2* ✅");
		expect(m).toContain(
			"*Pago 1 de 2* (Q3,937.62): https://pagalo/MORA_INTERES",
		);
	});

	test("grupo ya en aplicación cuenta como PAGADOS aunque un link diga ACTIVE", () => {
		const r = resumirEstadoLinks(
			grupo("READY_TO_APPLY", [
				link("CAPITAL", "PAID"),
				link("MORA_INTERES", "ACTIVE"),
			]),
		);
		expect(r.estado).toBe("PAGADOS");
		expect(r.links.every((l) => l.url === null)).toBe(true);
		expect(mensajeEstadoLinks(r.estado, r.links)).toContain("tus 2 pagos");
	});

	test("un solo link pagado: PAGADOS con mensaje en singular; los REPLACED no cuentan", () => {
		const r = resumirEstadoLinks(
			grupo("COMPLETED", [
				link("MORA_INTERES", "REPLACED"),
				link("MORA_INTERES", "PAID", { id: "m2", generation: 2 }),
			]),
		);
		expect(r.estado).toBe("PAGADOS");
		expect(r.links).toHaveLength(1);
		expect(r.links[0]?.titulo).toBe("Pago");
		expect(mensajeEstadoLinks(r.estado, r.links)).toContain(
			"Ya recibimos tu pago",
		);
	});

	test("un link REPLACED que se pagó después no cuenta: solo la generación vigente (Codex)", () => {
		const r = resumirEstadoLinks(
			grupo("PENDING_PAYMENT", [
				link("CAPITAL", "ACTIVE"),
				// generación 1, reemplazada y pagada tarde: PAID pero fuera de la aplicación
				link("MORA_INTERES", "PAID", {
					id: "m1",
					generation: 1,
					isApplicationSource: false,
				}),
				link("MORA_INTERES", "ACTIVE", { id: "m2", generation: 2 }),
			]),
		);
		expect(r.estado).toBe("SIN_PAGO");
		expect(r.links).toHaveLength(2);
		expect(r.links.map((l) => l.estado)).toEqual(["PENDIENTE", "PENDIENTE"]);
	});

	test("aplanado: totalLinks/linksPagados/linksPendientes + linkN*", () => {
		const r = resumirEstadoLinks(
			grupo("PARTIALLY_PAID", [
				link("CAPITAL", "PAID"),
				link("MORA_INTERES", "ACTIVE"),
			]),
		);
		expect(aplanarLinksEstado(r.links)).toEqual({
			totalLinks: 2,
			linksPagados: 1,
			linksPendientes: 1,
			link1Titulo: "Pago 1 de 2",
			link1Estado: "PENDIENTE",
			link1Pagado: false,
			link1Monto: "3937.62",
			link1Url: "https://pagalo/MORA_INTERES",
			link2Titulo: "Pago 2 de 2",
			link2Estado: "PAGADO",
			link2Pagado: true,
			link2Monto: "800.00",
			link2Url: null,
		});
	});

	test("el link de mora/interés va primero, sin importar cómo lleguen", () => {
		// Es el orden en que cartera aplica el dinero: la mora vigente se
		// consume primero y solo con el dinero del link MORA_INTERES (D-52).
		// Si esto se voltea, "Pago 1 de 2" pasa a significar otro link y los
		// mensajes del bot dejan de coincidir entre servicios.
		const r = resumirEstadoLinks(
			grupo("PENDING_PAYMENT", [
				link("CAPITAL", "ACTIVE"),
				link("MORA_INTERES", "ACTIVE"),
			]),
		);
		expect(r.links.map((l) => l.tipo)).toEqual(["MORA_INTERES", "CAPITAL"]);
		expect(r.links[0]?.titulo).toBe("Pago 1 de 2");
	});

	test("cada link trae su estado también en booleano (D-54)", () => {
		const r = resumirEstadoLinks(
			grupo("PARTIALLY_PAID", [
				link("CAPITAL", "PAID"),
				link("MORA_INTERES", "ACTIVE"),
			]),
		);
		expect(r.links.map((l) => l.pagado)).toEqual([false, true]);
		// el booleano nunca contradice al texto
		expect(r.links.every((l) => l.pagado === (l.estado === "PAGADO"))).toBe(
			true,
		);
	});

	test("las banderas del veredicto: exactamente una en true (D-54)", () => {
		expect(banderasEstadoLinks("PAGADOS")).toEqual({
			pagado: true,
			pagoParcial: false,
			sinPago: false,
		});
		expect(banderasEstadoLinks("PARCIAL")).toEqual({
			pagado: false,
			pagoParcial: true,
			sinPago: false,
		});
		expect(banderasEstadoLinks("SIN_PAGO")).toEqual({
			pagado: false,
			pagoParcial: false,
			sinPago: true,
		});
	});
});

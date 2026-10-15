import { describe, expect, test } from "bun:test";
import type { CreditoBuroInterno } from "../types/cartera-back";
import {
	categoriaRiesgoPrioritaria,
	clasificarMotivoExplicito,
	evidenciaRiesgoCredito,
	idsFuentesObsoletas,
	normalizarMotivoRiesgo,
	planificarVigenciaPersonaAutomatica,
	resumirFuentesRiesgo,
	separarIdentidadesClienteCartera,
	validarRespuestaCreditosBuroInterno,
} from "./buro-interno-cartera";

function credito(
	statusCredit: CreditoBuroInterno["creditos"]["statusCredit"],
	parcial: Partial<CreditoBuroInterno> = {},
): CreditoBuroInterno {
	return {
		creditos: {
			credito_id: 1,
			usuario_id: 2,
			numero_credito_sifco: "SIFCO-1",
			statusCredit,
		},
		usuarios: {
			usuario_id: 2,
			nombre: "Ana López",
			nit: "123",
			direccion: null,
		},
		cancelaciones: [],
		incobrables: [],
		caidos: [],
		...parcial,
	};
}

describe("clasificación de evidencia de Cartera", () => {
	test("clasifica incobrable con su categoría propia", () => {
		expect(
			clasificarMotivoExplicito("Cuenta declarada incobrable")?.categoria,
		).toBe("incobrable");
	});

	test.each([
		"demora administrativa",
		"Cliente Morales",
		"Familia Morataya",
	])("no confunde palabras que contienen mora: %s", (texto) =>
		expect(clasificarMotivoExplicito(texto)).toBeNull());

	test.each([
		"Cancelación anticipada, sin mora",
		"No presenta mora",
		"Libre de mora",
		"No hubo fraude",
		"No es incobrable",
		"Se descartó fraude",
		"Sin atrasos ni mora",
		"No hubo mora ni incumplimiento",
		"Nunca tuvo mora",
		"No presenta falta de pago",
		"No se detectó evidencia de fraude",
		"Sin indicios de fraude",
		"No existe evidencia de fraude",
		"No presenta evidencia de fraude",
		"No hay evidencia alguna de fraude",
		"No cuenta con reportes de fraude",
		"No cuenta con mora",
		"No se detectó fraude",
		"No se encontró mora",
		"No reporta mora",
		"No se reporta fraude",
		"No registra mora",
		"No detecta fraude",
		"No ha presentado mora",
		"No ha reportado fraude",
		"No ha habido fraude",
		"No ha detectado fraude",
		"No ha encontrado mora",
		"No ha registrado incumplimientos de pago",
		"Nunca ha tenido mora",
		"No tiene antecedentes de mora",
		"No existen antecedentes de fraude",
		"Sin historial de mora",
		"No tiene historial de mora",
		"Mora condonada",
		"Se condonó la mora",
		"Cliente al día, sin problemas de mora",
		"No tiene problemas de mora",
		"No presentó problemas de mora",
		"No hay problemas de fraude",
		"No tiene cuotas en mora",
		"No tiene deuda en mora",
		"Sin cuotas en mora",
		"No está en mora",
		"Nunca estuvo en mora",
		"No tiene cuotas atrasadas",
		"Sin cuotas atrasadas",
		"No tiene cuotas vencidas",
		"Sin cuotas vencidas",
		"0 cuotas en mora",
		"Cero cuotas en mora",
		"Ninguna cuota en mora",
		"Cancelado con 0 cuotas atrasadas",
		"Sin pagos atrasados",
		"No tiene pagos vencidos",
		"Sin atrasos de pago",
		"No se le cobró mora",
		"No aplica mora",
		"Descuento de mora autorizado",
		"Canceló pagando la mora pendiente",
		"Cliente víctima de estafa",
		"Fue víctima de una estafa",
		"Es víctima del fraude",
		"Fraude no detectado",
		"Mora no aplica",
		"No incurrió en mora",
		"Nunca cayó en mora",
		"No ha caído en mora",
		"Nunca entró en mora",
		"No estuvo en mora",
		"Fraude no fue comprobado",
		"Estafa no confirmada",
		"Mora no existe",
		"No se detectó el fraude",
		"No se pudo comprobar el fraude",
		"No tiene saldo en mora",
		"No presenta saldo en mora",
		"Sin saldo en mora",
		"Sin saldos en mora",
		"Sin pagos en mora",
		"No adeuda cuotas vencidas",
		"Sin registro de mora",
		"Sin riesgo de fraude",
		"No cometió fraude",
		"No se cometió fraude",
		"Sin cometer fraude",
		"Sin haber cometido fraude",
		"Sin haber cometido estafa",
		"Nunca cometió fraude",
		"No hay riesgo de fraude",
		"No existe riesgo de mora",
		"Sin riesgos de mora",
		"No existen registros de mora",
		"No se encontró registro de fraude",
		"Sin registros de fraude",
		"No posee mora",
		"No adeudaba cuotas atrasadas",
		"No tiene pagos en mora",
		"No hay pagos en mora",
		"No tiene ningún saldo en mora",
		"No presenta ninguna deuda en mora",
		"Sin ninguna cuota en mora",
		"No fue posible confirmar la mora",
		"No se logró detectar fraude",
		"No se pudo verificar la estafa",
		"No se confirmó la mora",
		"No se registró una estafa",
		"Sin el fraude reportado",
		"Fraude sin confirmar",
		"Fraude sin evidencia",
		"Estafa sin indicios",
		"Mora sin pruebas",
		"Fraude sin ningún indicio",
		"Estafa sin comprobar",
		"Mora sin confirmar",
		"Fraude aún sin verificar",
	])("ignora evidencia explícitamente negada: %s", (texto) => {
		expect(clasificarMotivoExplicito(texto)).toBeNull();
	});

	test.each([
		["Vehículo reposeído", "vehiculo_recuperado"],
		["El vehículo fue recuperado", "vehiculo_recuperado"],
		["Se recuperó el vehículo", "vehiculo_recuperado"],
		["Carro recuperado", "vehiculo_recuperado"],
		["Cliente moroso", "mala_paga"],
		["Morosidad reiterada", "mala_paga"],
		["Fraudes detectados", "fraude"],
		["Identidad falsa", "fraude"],
		["Créditos incobrables", "incobrable"],
		["Incumplimientos de pago", "mala_paga"],
		["Cuotas atrasadas", "mala_paga"],
		["Cuotas vencidas", "mala_paga"],
		["Cancelado con 2 cuotas vencidas", "mala_paga"],
		["Pago atrasado", "mala_paga"],
		["Pagos atrasados", "mala_paga"],
		["Pagos vencidos", "mala_paga"],
		["10 cuotas en mora", "mala_paga"],
		["2 cuotas atrasadas", "mala_paga"],
		["Atrasos de pago", "mala_paga"],
		["Cliente en mora, no aplica descuento", "mala_paga"],
		["Fraude no detectado, pero cayó en mora", "mala_paga"],
		["Cayó en mora", "mala_paga"],
		["No pudo pagar", "mala_paga"],
		["Saldo en mora", "mala_paga"],
		["Pagos en mora", "mala_paga"],
		["Adeuda cuotas vencidas", "mala_paga"],
		["Registro de mora", "mala_paga"],
		["Sin riesgo de fraude, pero cayó en mora", "mala_paga"],
		["Cometió fraude", "fraude"],
		["Sin haber cometido fraude, pero cayó en mora", "mala_paga"],
		["Fraude sin confirmar, pero cayó en mora", "mala_paga"],
		["Fraude sin evidencia, pero cayó en mora", "mala_paga"],
		["No cometió fraude, pero cayó en mora", "mala_paga"],
		["Sin registro de mora hasta 2024, luego cayó en mora", "mala_paga"],
		["No adeuda cuotas vencidas, pero luego cayó en mora", "mala_paga"],
		["Sin pagos en mora hasta 2024, luego cayó en mora", "mala_paga"],
		["No tiene ningún saldo en mora, luego cayó en mora", "mala_paga"],
		["Sin saldo en mora al cierre, luego cayó en mora", "mala_paga"],
		["No puede pagar", "mala_paga"],
		["No pudo seguir pagando", "mala_paga"],
		["El cliente no podía pagar las cuotas", "mala_paga"],
		["No se detectó el fraude, pero cayó en mora", "mala_paga"],
		["No se pudo comprobar el fraude, pero cayó en mora", "mala_paga"],
		["Se pudo comprobar el fraude", "fraude"],
		["Se confirmó el fraude", "fraude"],
		["Incurrió en mora", "mala_paga"],
		["No incurrió en mora hasta 2024, luego cayó en mora", "mala_paga"],
	] as const)("reconoce variantes explícitas: %s", (texto, categoria) => {
		expect(clasificarMotivoExplicito(texto)?.categoria).toBe(categoria);
	});

	test.each([
		["Camión recuperado y colocado en crédito.", "vehiculo_recuperado"],
		["recuperacion y venta por financiamiento", "vehiculo_recuperado"],
		["venta por recuperación", "vehiculo_recuperado"],
		[
			"Se recupero unidad y se coloco a la venta quedando un saldo insoluto",
			"vehiculo_recuperado",
		],
		[
			"Se recogio la unidad, se coloco a la venta quedando un pago pendiente",
			"vehiculo_recuperado",
		],
		[
			"Cliente no cuenta con el dinero para realizar los pagos , se pone a la venta la unidad",
			"mala_paga",
		],
		[
			"Cliente no tenia el dinero para pagar, se recolecto la unidad y se coloco a la venta, quedo un monto pendiente  para cubrir la deuda",
			"vehiculo_recuperado",
		],
		["Se realizó la recolección de la unidad", "vehiculo_recuperado"],
		[
			"Cliente no sin capacidad de pago, se realiza recoleccion y se pone a la venta unidad",
			"vehiculo_recuperado",
		],
		["Se realizó la recolección del vehículo", "vehiculo_recuperado"],
		["No quiere pagar su saldo insoluto", "mala_paga"],
		[
			"El pago del seguro no cubre la totalidad de la deuda cliente no quiso pagar el restante",
			"mala_paga",
		],
	] as const)("clasifica motivos reales de Cartera: %s", (texto, categoria) => {
		expect(clasificarMotivoExplicito(texto)?.categoria).toBe(categoria);
	});

	test.each([
		"cancelacion por pago total de vehiculo",
		"Cliente termino de pagar su credito",
		"PAGO TOTAL",
		"Por la demora que se tuvo al realizar desembolso el cliente indica que ya no desea el crédito,",
		"Listado de créditos para cancelar - Diego Esau Lara Morales",
		"Recolección de documentos pendiente",
		"En negociación para pagar.",
		"Se realizó la recolección de documentos",
		"Se realiza recolección de firmas pendientes",
		"Se hizo la recolección de los papeles del cliente",
		"Se realizó la recolección de información del cliente",
		"Se realizó la recolección de pagos",
	])("no marca motivos reales sin riesgo: %s", (texto) => {
		expect(clasificarMotivoExplicito(texto)).toBeNull();
	});

	test("conserva expresiones afirmativas con la palabra no", () => {
		expect(clasificarMotivoExplicito("El cliente no pagó")?.categoria).toBe(
			"mala_paga",
		);
	});

	test("conserva evidencia afirmativa aunque exista una negación previa", () => {
		expect(
			clasificarMotivoExplicito(
				"No se detectó evidencia de fraude inicialmente; luego se confirmó fraude",
			)?.categoria,
		).toBe("fraude");
	});

	test("no oculta fraude afirmativo posterior a un contexto de víctima", () => {
		expect(
			clasificarMotivoExplicito(
				"Fue víctima de una estafa; luego cometió fraude",
			)?.categoria,
		).toBe("fraude");
	});

	test("conserva riesgo posterior a una negacion con sustantivos intermedios", () => {
		expect(
			clasificarMotivoExplicito(
				"No tiene cuotas en mora; registra mora reiterada",
			)?.categoria,
		).toBe("mala_paga");
	});

	test("normaliza tildes y espacios antes de clasificar", () => {
		expect(normalizarMotivoRiesgo("  Recuperación   de vehículo  ")).toBe(
			"recuperacion de vehiculo",
		);
		expect(
			clasificarMotivoExplicito("  Recuperación   de vehículo  ")?.categoria,
		).toBe("vehiculo_recuperado");
	});

	test("mantiene el estado MOROSO como mala paga", () => {
		expect(evidenciaRiesgoCredito(credito("MOROSO"))).toContainEqual({
			categoria: "mala_paga",
			texto: "Crédito con estado MOROSO vigente",
		});
	});

	test("considera evidencia explícita aunque el estado actual sea ACTIVO", () => {
		const riesgos = evidenciaRiesgoCredito(
			credito("ACTIVO", {
				caidos: [{ motivo: "Fraude confirmado", observaciones: null }],
			}),
		);
		expect(riesgos.map((riesgo) => riesgo.categoria)).toContain("fraude");
	});

	test("conserva el fraude de una caída histórica aunque la caída más reciente sea neutral", () => {
		const riesgos = evidenciaRiesgoCredito(
			credito("CAIDO", {
				caidos: [
					{ motivo: "Reasignación operativa", observaciones: null },
					{ motivo: "Fraude confirmado", observaciones: null },
				],
			}),
		);
		expect(riesgos).toContainEqual({
			categoria: "fraude",
			texto: "Fraude confirmado",
		});
	});

	test("considera evidencia histórica de incobrabilidad aunque el crédito vuelva a ACTIVO", () => {
		const riesgos = evidenciaRiesgoCredito(
			credito("ACTIVO", {
				incobrables: [
					{
						motivo: "Fraude confirmado",
						observaciones: null,
					},
				],
			}),
		);
		expect(riesgos).toContainEqual({
			categoria: "fraude",
			texto: "Fraude confirmado",
		});
	});

	test("no interpreta cuotas restantes de una cancelación como mora", () => {
		const riesgos = evidenciaRiesgoCredito(
			credito("CANCELADO", {
				cancelaciones: [
					{
						cuotas_atrasadas: 12,
						motivo: "Cancelación anticipada",
						observaciones: "Cliente al día, sin problemas de mora",
					},
				],
			}),
		);
		expect(riesgos).toEqual([]);
	});

	test("prioriza fraude explícito en el motivo de un crédito INCOBRABLE", () => {
		const riesgos = evidenciaRiesgoCredito(
			credito("INCOBRABLE", {
				incobrables: [
					{
						motivo: "Incobrable por fraude confirmado",
						observaciones: null,
					},
				],
			}),
		);
		expect(riesgos.map((riesgo) => riesgo.categoria)).toContain("fraude");
		expect(
			categoriaRiesgoPrioritaria(riesgos.map((riesgo) => riesgo.categoria)),
		).toBe("fraude");
		expect(riesgos).toContainEqual({
			categoria: "incobrable",
			texto: "Crédito con estado INCOBRABLE",
		});
		expect(riesgos).toHaveLength(2);
	});

	test("no repite el mismo motivo de un crédito INCOBRABLE", () => {
		const riesgos = evidenciaRiesgoCredito(
			credito("INCOBRABLE", {
				incobrables: [
					{
						motivo: "Crédito incobrable",
						observaciones: "Seguimiento de cobros",
					},
				],
			}),
		);
		expect(
			riesgos.filter((riesgo) => riesgo.texto === "Crédito incobrable"),
		).toHaveLength(1);
		expect(riesgos).toContainEqual({
			categoria: "incobrable",
			texto: "Seguimiento de cobros",
		});
	});
});

describe("identidades compuestas de clientes históricos", () => {
	test("empareja cada nombre con el NIT de la misma posición", () => {
		expect(
			separarIdentidadesClienteCartera(
				"Ana López Pérez / Marta Díaz Ruiz",
				"1234567/7654321",
			),
		).toEqual([
			{ nombreCompleto: "Ana López Pérez", nit: "1234567" },
			{ nombreCompleto: "Marta Díaz Ruiz", nit: "7654321" },
		]);
	});

	test("no asigna el NIT único de la primera persona a los demás nombres", () => {
		expect(
			separarIdentidadesClienteCartera(
				"Ana López Pérez / Marta Díaz Ruiz",
				"1234567",
			),
		).toEqual([
			{ nombreCompleto: "Ana López Pérez", nit: "1234567" },
			{ nombreCompleto: "Marta Díaz Ruiz", nit: null },
		]);
	});

	test("conserva las posiciones vacías de NIT en clientes compuestos", () => {
		expect(
			separarIdentidadesClienteCartera(
				"Ana López Pérez / Marta Díaz Ruiz",
				" / 7654321",
			),
		).toEqual([
			{ nombreCompleto: "Ana López Pérez", nit: null },
			{ nombreCompleto: "Marta Díaz Ruiz", nit: "7654321" },
		]);
	});

	test("mantiene sin cambios a un cliente individual", () => {
		expect(
			separarIdentidadesClienteCartera("Ana López Pérez", "1234567"),
		).toEqual([{ nombreCompleto: "Ana López Pérez", nit: "1234567" }]);
	});
});

describe("reconciliación de fuentes automáticas", () => {
	test("identifica las fuentes que ya no tienen evidencia vigente", () => {
		expect(idsFuentesObsoletas([10, 11, 12, 12], [10, 12])).toEqual([11]);
	});

	test("resume varias fuentes con orden estable y la categoría más crítica", () => {
		expect(
			resumirFuentesRiesgo([
				{
					numeroCreditoSifco: "B-2",
					categoria: "mala_paga",
					motivo: "Mora vigente",
				},
				{
					numeroCreditoSifco: "A-1",
					categoria: "fraude",
					motivo: "Fraude confirmado",
				},
			]),
		).toEqual({
			categoria: "fraude",
			motivo:
				"Registro automático desde Cartera. Evidencia: A-1: Fraude confirmado; B-2: Mora vigente",
		});
		expect(categoriaRiesgoPrioritaria([])).toBe("otro");
	});

	test("conserva la ficha si uno de varios usuarios vinculados sigue en riesgo", () => {
		expect(planificarVigenciaPersonaAutomatica([20, 21], [21])).toEqual({
			desactivar: false,
			usuariosSinRiesgo: [20],
		});
	});

	test("retira la ficha cuando ninguno de sus usuarios conserva riesgo", () => {
		expect(planificarVigenciaPersonaAutomatica([20, 21], [])).toEqual({
			desactivar: true,
			usuariosSinRiesgo: [20, 21],
		});
	});
});

describe("contrato de la respuesta de Cartera", () => {
	test("acepta una respuesta válida", () => {
		expect(() =>
			validarRespuestaCreditosBuroInterno({ data: [credito("ACTIVO")] }),
		).not.toThrow();
	});

	test("rechaza un 200 con créditos incompletos", () => {
		expect(() =>
			validarRespuestaCreditosBuroInterno({
				data: [{}],
			}),
		).toThrow("crédito inválido");
	});

	test("rechaza evidencia anidada inválida", () => {
		const invalido = credito("CANCELADO", {
			cancelaciones: [
				{
					motivo: "Mora",
					observaciones: null,
					cuotas_atrasadas: -1,
				},
			],
		});
		expect(() =>
			validarRespuestaCreditosBuroInterno({
				data: [invalido],
			}),
		).toThrow("crédito inválido");
	});

	test("rechaza una respuesta sin arreglo de créditos", () => {
		expect(() => validarRespuestaCreditosBuroInterno({ data: null })).toThrow(
			"página inválida",
		);
	});
});

import { describe, expect, test } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import {
	BUCKET_SIN_ASIGNAR,
	calcularTotalPaginas,
	construirCondiciones,
	DIAS_VENTANA_DEFAULT,
	interpretarConteo,
	LIMITE_CONTEO,
	normalizarRango,
	origenDeComentario,
	whereHistorial,
} from "./historial-agendas";

/** 12 de agosto de 2026, 18:00 GT (= 2026-08-13T00:00Z). */
const AHORA = new Date("2026-08-13T00:00:00.000Z");

const dialect = new PgDialect();
function compilar(sql: Parameters<PgDialect["sqlToQuery"]>[0]) {
	const query = dialect.sqlToQuery(sql);
	return { sql: query.sql.toLowerCase(), params: query.params };
}

const ASESOR = { userId: "user-asesor", puedeVerTodos: false };
const SUPERVISOR = { userId: "user-super", puedeVerTodos: true };

describe("normalizarRango", () => {
	test("sin fechas aplica la ventana default hacia atrás desde hoy", () => {
		const rango = normalizarRango({}, AHORA);

		expect(rango.esDefault).toBe(true);
		// Hoy GT es el 12 (18:00 GT del 12 = 00:00Z del 13).
		expect(rango.hasta.toISOString()).toBe("2026-08-13T06:00:00.000Z");
		const dias =
			(rango.hasta.getTime() - rango.desde.getTime()) / (24 * 60 * 60 * 1000);
		expect(dias).toBe(DIAS_VENTANA_DEFAULT);
	});

	test("la cota superior es EXCLUSIVA: una gestión a las 15:00 del último día entra", () => {
		const rango = normalizarRango(
			{ desde: "2026-08-01", hasta: "2026-08-10" },
			AHORA,
		);

		// La cota es medianoche GT del 11, no del 10 — si fuera del 10, todo lo
		// registrado durante el día 10 quedaría fuera del rango.
		expect(rango.hasta.toISOString()).toBe("2026-08-11T06:00:00.000Z");

		const gestionTarde = new Date("2026-08-10T21:00:00.000Z"); // 15:00 GT del 10
		expect(gestionTarde.getTime()).toBeLessThan(rango.hasta.getTime());
		expect(gestionTarde.getTime()).toBeGreaterThanOrEqual(
			rango.desde.getTime(),
		);
	});

	test("la cota inferior es INCLUSIVA: medianoche GT del primer día", () => {
		const rango = normalizarRango(
			{ desde: "2026-08-01", hasta: "2026-08-10" },
			AHORA,
		);

		expect(rango.desde.toISOString()).toBe("2026-08-01T06:00:00.000Z");

		// Una gestión a las 00:30 GT del día 1 debe entrar.
		const gestionTemprana = new Date("2026-08-01T06:30:00.000Z");
		expect(gestionTemprana.getTime()).toBeGreaterThanOrEqual(
			rango.desde.getTime(),
		);
	});

	test("una gestión a las 23:30 GT cae en SU día, no en el siguiente", () => {
		// 23:30 GT del 10 de agosto = 05:30Z del 11.
		const gestion = new Date("2026-08-11T05:30:00.000Z");
		const rangoDelDiez = normalizarRango(
			{ desde: "2026-08-10", hasta: "2026-08-10" },
			AHORA,
		);

		expect(gestion.getTime()).toBeGreaterThanOrEqual(
			rangoDelDiez.desde.getTime(),
		);
		expect(gestion.getTime()).toBeLessThan(rangoDelDiez.hasta.getTime());

		// Y NO cae en el día 11.
		const rangoDelOnce = normalizarRango(
			{ desde: "2026-08-11", hasta: "2026-08-11" },
			AHORA,
		);
		expect(gestion.getTime()).toBeLessThan(rangoDelOnce.desde.getTime());
	});

	test("un solo día produce una ventana de 24 horas", () => {
		const rango = normalizarRango(
			{ desde: "2026-08-05", hasta: "2026-08-05" },
			AHORA,
		);

		const horas =
			(rango.hasta.getTime() - rango.desde.getTime()) / (60 * 60 * 1000);
		expect(horas).toBe(24);
	});

	test("solo 'desde' ancla el fin a hoy", () => {
		const rango = normalizarRango({ desde: "2026-08-01" }, AHORA);

		expect(rango.esDefault).toBe(false);
		expect(rango.desde.toISOString()).toBe("2026-08-01T06:00:00.000Z");
		expect(rango.hasta.toISOString()).toBe("2026-08-13T06:00:00.000Z");
	});

	test("solo 'hasta' retrocede la ventana default, no abre el rango", () => {
		const rango = normalizarRango({ hasta: "2026-08-10" }, AHORA);

		const dias =
			(rango.hasta.getTime() - rango.desde.getTime()) / (24 * 60 * 60 * 1000);
		expect(dias).toBe(DIAS_VENTANA_DEFAULT);
		expect(rango.hasta.toISOString()).toBe("2026-08-11T06:00:00.000Z");
	});

	test("un rango invertido se corrige intercambiando, no devuelve vacío", () => {
		// Sin la corrección esto arma un WHERE contradictorio: la tabla y los 6
		// KPIs quedan en cero y el usuario lo lee como "el job no corrió".
		const invertido = normalizarRango(
			{ desde: "2026-08-10", hasta: "2026-08-01" },
			AHORA,
		);
		const correcto = normalizarRango(
			{ desde: "2026-08-01", hasta: "2026-08-10" },
			AHORA,
		);

		expect(invertido.desde.toISOString()).toBe(correcto.desde.toISOString());
		expect(invertido.hasta.toISOString()).toBe(correcto.hasta.toISOString());
		// Y el rango resultante es válido: desde < hasta.
		expect(invertido.desde.getTime()).toBeLessThan(invertido.hasta.getTime());
	});

	test("desde == hasta no se toca (es el día único, ya válido)", () => {
		const rango = normalizarRango(
			{ desde: "2026-08-05", hasta: "2026-08-05" },
			AHORA,
		);
		expect(rango.desde.toISOString()).toBe("2026-08-05T06:00:00.000Z");
		expect(rango.hasta.toISOString()).toBe("2026-08-06T06:00:00.000Z");
	});
});

describe("construirCondiciones — scoping (AC-3)", () => {
	test("el asesor SIEMPRE queda atado a su realizado_por", () => {
		const { condiciones } = construirCondiciones({}, ASESOR, AHORA);
		const { sql, params } = compilar(condiciones[0]);

		expect(sql).toContain("realizado_por");
		expect(params).toContain("user-asesor");
	});

	test("el asesor no puede ampliar su alcance mandando usuarioIds de otros", () => {
		const { where } = whereHistorial(
			{ usuarioIds: ["otro-1", "otro-2"] },
			ASESOR,
			AHORA,
		);
		const { params } = compilar(where);

		// Su propio id sigue en el WHERE: el filtro por otros usuarios se suma
		// con AND, no lo reemplaza. El resultado es la intersección (vacía).
		expect(params).toContain("user-asesor");
	});

	test("el supervisor no lleva condición de usuario", () => {
		const { condiciones } = construirCondiciones({}, SUPERVISOR, AHORA);
		const { params } = compilar(condiciones[0]);

		// La primera condición ya es la de fecha, no la de scoping.
		expect(params).not.toContain("user-super");
	});

	test("el supervisor sí puede filtrar por usuarios concretos", () => {
		const { where } = whereHistorial(
			{ usuarioIds: ["a", "b"] },
			SUPERVISOR,
			AHORA,
		);
		const { params } = compilar(where);

		expect(params).toContain("a");
		expect(params).toContain("b");
	});
});

describe("construirCondiciones — filtros", () => {
	test("por defecto excluye las gestiones automáticas del sistema", () => {
		const { where } = whereHistorial({}, SUPERVISOR, AHORA);
		const { sql, params } = compilar(where);

		expect(sql).toContain("not");
		expect(params).toContain("Recordatorio automático%");
		expect(params).toContain("Envío masivo de WhatsApp%");
	});

	test("incluirAutomaticos las deja pasar", () => {
		const { where } = whereHistorial(
			{ incluirAutomaticos: true },
			SUPERVISOR,
			AHORA,
		);
		const { params } = compilar(where);

		expect(params).not.toContain("Recordatorio automático%");
	});

	test("filtra por bucket_snapshot, no por el bucket actual del crédito", () => {
		const { where } = whereHistorial({ buckets: [1, 3] }, SUPERVISOR, AHORA);
		const { sql, params } = compilar(where);

		expect(sql).toContain("bucket_snapshot");
		expect(params).toContain(1);
		expect(params).toContain(3);
	});

	test("BUCKET_SIN_ASIGNAR se traduce a IS NULL, no a un bucket -1", () => {
		// -1 no existe como bucket: es el sentinela del chip "Sin bucket". Si
		// viajara como valor al IN, el filtro no devolvería nada en vez de las
		// filas sin snapshot.
		const { where } = whereHistorial(
			{ buckets: [BUCKET_SIN_ASIGNAR] },
			SUPERVISOR,
			AHORA,
		);
		const { sql, params } = compilar(where);

		expect(sql).toContain("bucket_snapshot");
		expect(sql).toContain("is null");
		expect(params).not.toContain(-1);
	});

	test("combina buckets numéricos con el sentinela usando OR", () => {
		// "B2 o sin bucket" es una selección legítima: si las dos condiciones se
		// unieran con AND, el resultado sería siempre vacío.
		const { where } = whereHistorial(
			{ buckets: [2, BUCKET_SIN_ASIGNAR] },
			SUPERVISOR,
			AHORA,
		);
		const { sql, params } = compilar(where);

		expect(sql).toContain("is null");
		expect(sql).toContain(" or ");
		expect(params).toContain(2);
		expect(params).not.toContain(-1);
	});

	test("solo buckets numéricos no genera IS NULL sobre bucket_snapshot", () => {
		// El complemento del test anterior: sin el sentinela, las filas sin
		// snapshot NO deben colarse en un filtro por bucket concreto.
		const { where } = whereHistorial({ buckets: [2] }, SUPERVISOR, AHORA);
		const { sql } = compilar(where);

		expect(sql).toContain("bucket_snapshot");
		expect(sql).not.toMatch(/bucket_snapshot"?\s+is null/i);
	});

	test("recorta el número de crédito antes de comparar", () => {
		const { where } = whereHistorial(
			{ numeroCreditoSifco: "  12345  " },
			SUPERVISOR,
			AHORA,
		);
		const { params } = compilar(where);

		expect(params).toContain("12345");
	});

	test("un número de crédito en blanco no agrega condición", () => {
		const conBlanco = compilar(
			whereHistorial({ numeroCreditoSifco: "   " }, SUPERVISOR, AHORA).where,
		);
		const sinNada = compilar(whereHistorial({}, SUPERVISOR, AHORA).where);

		expect(conBlanco.params.length).toBe(sinNada.params.length);
	});

	test("los arrays vacíos no agregan condiciones", () => {
		const vacios = compilar(
			whereHistorial(
				{ usuarioIds: [], buckets: [], estadoContacto: [] },
				SUPERVISOR,
				AHORA,
			).where,
		);
		const sinNada = compilar(whereHistorial({}, SUPERVISOR, AHORA).where);

		expect(vacios.params.length).toBe(sinNada.params.length);
	});

	test("combina varios filtros con AND", () => {
		const { where } = whereHistorial(
			{
				desde: "2026-08-01",
				hasta: "2026-08-10",
				buckets: [2],
				estadoPromesa: "incumplida",
				soloConProximaAccion: true,
			},
			ASESOR,
			AHORA,
		);
		const { sql, params } = compilar(where);

		expect(params).toContain("user-asesor");
		expect(params).toContain(2);
		expect(params).toContain("incumplida");
		expect(sql).toContain("is not null");
	});
});

describe("origenDeComentario", () => {
	test("reconoce los recordatorios de premora", () => {
		expect(
			origenDeComentario("Recordatorio automático D-3 enviado por WhatsApp"),
		).toBe("premora");
	});

	test("reconoce los envíos masivos", () => {
		expect(
			origenDeComentario("Envío masivo de WhatsApp — campaña de agosto"),
		).toBe("wsp_masivo");
	});

	test("todo lo demás es gestión manual", () => {
		expect(origenDeComentario("Llamé al cliente, prometió pagar")).toBe(
			"manual",
		);
	});

	test("comentario nulo o vacío cuenta como manual", () => {
		expect(origenDeComentario(null)).toBe("manual");
		expect(origenDeComentario("")).toBe("manual");
	});

	test("el prefijo tiene que estar al INICIO, no en medio", () => {
		expect(
			origenDeComentario(
				"El cliente pidió que no le llegue Recordatorio automático",
			),
		).toBe("manual");
	});
});

describe("interpretarConteo", () => {
	test("bajo el techo devuelve el total exacto", () => {
		expect(interpretarConteo(347)).toEqual({
			total: 347,
			esAproximado: false,
		});
	});

	test("al tocar el techo reporta el piso y marca aproximado", () => {
		expect(interpretarConteo(LIMITE_CONTEO)).toEqual({
			total: LIMITE_CONTEO - 1,
			esAproximado: true,
		});
	});

	test("justo debajo del techo todavía es exacto", () => {
		expect(interpretarConteo(LIMITE_CONTEO - 1)).toEqual({
			total: LIMITE_CONTEO - 1,
			esAproximado: false,
		});
	});

	test("cero es exacto, no aproximado", () => {
		expect(interpretarConteo(0)).toEqual({ total: 0, esAproximado: false });
	});
});

describe("calcularTotalPaginas", () => {
	test("redondea hacia arriba", () => {
		expect(calcularTotalPaginas(101, 50)).toBe(3);
		expect(calcularTotalPaginas(100, 50)).toBe(2);
	});

	test("sin resultados devuelve 1, no 0 — la UI no muestra 'página 1 de 0'", () => {
		expect(calcularTotalPaginas(0, 50)).toBe(1);
	});
});

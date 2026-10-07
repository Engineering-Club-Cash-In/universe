import { describe, expect, test } from "bun:test";
import {
	celdaCsv,
	diagnosticar,
	metodoVigente,
	normalizarVin,
	type UnidadWialon,
	type VehiculoCrm,
	vinsEnNombre,
} from "./vincular-flota-wialon.logic";

const u = (
	id: number,
	nm: string,
	campos: Record<string, string> = {},
): UnidadWialon => ({ id, nm, campos });
const v = (id: string, datos: Partial<VehiculoCrm> = {}): VehiculoCrm => ({
	id,
	placa: null,
	vin: null,
	wialonUnitId: null,
	vinculadoPor: null,
	conCredito: false,
	...datos,
});
const estadoDe = (
	unidades: UnidadWialon[],
	vehiculos: VehiculoCrm[],
	id: string,
) =>
	diagnosticar(unidades, vehiculos).vehiculos.find((r) => r.vehiculo.id === id);

describe("normalizarVin", () => {
	test("limpia separadores y pasa a mayúsculas", () => {
		expect(normalizarVin(" 3n6cd33b0-zl450292 ")).toBe("3N6CD33B0ZL450292");
	});
	test("O/I/Q (letras que un VIN no usa) se corrigen a 0/1/0", () => {
		expect(normalizarVin("LVAV2MABOVC735128")).toBe("LVAV2MAB0VC735128");
		expect(normalizarVin("1FUJAHCGI1LJ24084")).toBe("1FUJAHCG11LJ24084");
	});
	test("sin 17 caracteres no es VIN", () => {
		expect(normalizarVin("MMBJJC10TH011349")).toBeNull();
		expect(normalizarVin(null)).toBeNull();
		expect(normalizarVin("")).toBeNull();
	});
	test("17 caracteres de relleno (sin dígitos o sin letras) no son VIN", () => {
		expect(normalizarVin("00000000000000000")).toBeNull();
		expect(normalizarVin("12345678901234567")).toBeNull();
		expect(normalizarVin("SINVINSINVINSINVI")).toBeNull();
	});
});

describe("vinsEnNombre", () => {
	test("encuentra el VIN aunque venga pegado al guion", () => {
		expect(vinsEnNombre("3N6CD33B0ZL450292- CON APAGADO").completos).toEqual([
			"3N6CD33B0ZL450292",
		]);
	});
	test("un nombre con placa no tiene VIN", () => {
		expect(vinsEnNombre("P-420CDP - CON APAGADO")).toEqual({
			completos: [],
			incompletos: [],
		});
	});
	test("16 caracteres va como incompleto (solo para sugerir)", () => {
		expect(vinsEnNombre("MMBJJC10TH011349 - CON APAGADO")).toEqual({
			completos: [],
			incompletos: ["MMBJJC10TH011349"],
		});
	});
	test("solo letras o solo dígitos no cuentan", () => {
		expect(
			vinsEnNombre("PENDIENTEVERIFICAC 12345678901234567").completos,
		).toEqual([]);
	});
});

describe("diagnosticar — vehículos sin vínculo", () => {
	test("placa dentro del nombre, con sufijo y prefijo distinto", () => {
		const r = estadoDe(
			[u(1, "C-420CDP - CON APAGADO")],
			[v("a", { placa: "P0-420CDP" })],
			"a",
		);
		expect(r?.estado).toBe("propuesto");
		expect(r?.metodo).toBe("placa");
		expect(r?.unidad?.id).toBe(1);
	});
	test("VIN en el nombre (unidad sin placa)", () => {
		const r = estadoDe(
			[u(2, "3N6CD33B0ZL450292 - CON APAGADO")],
			[v("a", { vin: "3N6CD33B0ZL450292" })],
			"a",
		);
		expect(r?.estado).toBe("propuesto");
		expect(r?.metodo).toBe("vin");
	});
	test("VIN con O en vez de 0 en el nombre igual cruza", () => {
		const r = estadoDe(
			[u(2, "LVAV2MABOVC735128 - SIN APAGADO")],
			[v("a", { vin: "LVAV2MAB0VC735128" })],
			"a",
		);
		expect(r?.estado).toBe("propuesto");
	});
	test("VIN solo en el campo vin de la unidad", () => {
		const r = estadoDe(
			[u(3, "A-04", { vin: "JTFRS12P9H0046026" })],
			[v("a", { vin: "jtfrs12p9h0046026" })],
			"a",
		);
		expect(r?.metodo).toBe("vin_campo");
	});
	test("placa solo en registration_plate", () => {
		const r = estadoDe(
			[u(4, "Camión de Pedro", { registration_plate: "P-567GKC" })],
			[v("a", { placa: "P-567GKC" })],
			"a",
		);
		expect(r?.metodo).toBe("placa_registration");
	});
	test("placa y VIN coinciden en la misma unidad", () => {
		const r = estadoDe(
			[u(5, "P-287JZY CON APAGADO", { vin: "JM3KE4CY2G0887993" })],
			[v("a", { placa: "P0-287JZY", vin: "JM3KE4CY2G0887993" })],
			"a",
		);
		expect(r?.metodo).toBe("placa+vin");
	});
	test("placa con unidad y VIN sin unidad → se usa la placa", () => {
		const r = estadoDe(
			[u(1, "P-420CDP CON APAGADO")],
			[v("a", { placa: "P-420CDP", vin: "3N6CD33B0ZL450292" })],
			"a",
		);
		expect(r?.estado).toBe("propuesto");
		expect(r?.metodo).toBe("placa");
	});
	test("placa y VIN apuntan a unidades distintas → conflicto", () => {
		const r = estadoDe(
			[u(1, "P-420CDP CON APAGADO"), u(2, "3N6CD33B0ZL450292 - CON APAGADO")],
			[v("a", { placa: "P-420CDP", vin: "3N6CD33B0ZL450292" })],
			"a",
		);
		expect(r?.estado).toBe("conflicto_placa_vin");
		expect(r?.otras.map((x) => x.id).sort()).toEqual([1, 2]);
	});
	test("una unidad que reclama un vehículo en conflicto no se propone a otro", () => {
		const d = diagnosticar(
			[
				u(1, "P-420CDP CON APAGADO"),
				u(2, "3N6CD33B0ZL450292 - CON APAGADO"),
				u(3, "P-555XYZ CON APAGADO"),
			],
			[
				v("conflicto", { placa: "P-420CDP", vin: "3N6CD33B0ZL450292" }),
				// Duplicado con la misma placa: antes se quedaba la unidad 1 solo.
				v("duplicado", { placa: "P0-420CDP" }),
				v("ajeno", { placa: "P-555XYZ" }),
			],
		);
		const de = (id: string) => d.vehiculos.find((r) => r.vehiculo.id === id);
		expect(de("conflicto")?.estado).toBe("conflicto_placa_vin");
		expect(de("duplicado")?.estado).toBe("unidad_disputada");
		expect(de("duplicado")?.detalle).toContain("conflicto");
		// Lo que el conflicto no toca sigue igual.
		expect(de("ajeno")?.estado).toBe("propuesto");
		expect(d.unidades.find((x) => x.unidad.id === 1)?.estado).toBe(
			"en_revision",
		);
	});
	test("una unidad que reclama un vehículo ambiguo no se propone a otro", () => {
		const d = diagnosticar(
			[
				u(1, "P-123ABC - CON APAGADO", { vin: "3N6CD33B0ZL450292" }),
				u(2, "C-123ABC - SIN APAGADO"),
			],
			[
				// Su placa está en dos unidades: ambiguo.
				v("ambiguo", { placa: "P-123ABC", conCredito: true }),
				// Duplicado viejo cuyo VIN coincide con la unidad 1.
				v("viejo", { vin: "3N6CD33B0ZL450292" }),
			],
		);
		const de = (id: string) => d.vehiculos.find((r) => r.vehiculo.id === id);
		expect(de("ambiguo")?.estado).toBe("ambiguo");
		expect(de("viejo")?.estado).toBe("unidad_disputada");
		expect(de("viejo")?.detalle).toContain("ambiguos");
	});
	test("un vehículo ambiguo sin crédito no le quita la unidad a uno con crédito vigente", () => {
		// Datos basura en Wialon: el ambiguo reclama varias unidades.
		const d = diagnosticar(
			[
				u(1, "3N6CD33B0ZL450292 - CON APAGADO", {
					registration_plate: "P-124LKF",
				}),
				u(2, "P-124LKF - SIN APAGADO"),
			],
			[
				v("ambiguo-sin-credito", { placa: "P0-124LKF" }),
				v("con-credito", {
					vin: "3N6CD33B0ZL450292",
					conCredito: true,
					creditos: [
						{ sifco: "CRM-a", estado: "ACTIVO", fechaCreacion: "2026-05-01" },
					],
				}),
			],
		);
		const de = (id: string) => d.vehiculos.find((r) => r.vehiculo.id === id);
		expect(de("ambiguo-sin-credito")?.estado).toBe("ambiguo");
		expect(de("con-credito")?.estado).toBe("propuesto");
		expect(de("con-credito")?.confirmar).toBeFalsy();
	});
	test("un vehículo en conflicto sin crédito no le quita la unidad a uno con crédito vigente", () => {
		const d = diagnosticar(
			[u(1, "P-420CDP CON APAGADO"), u(2, "3N6CD33B0ZL450292 - CON APAGADO")],
			[
				v("conflicto-sin-credito", {
					placa: "P0-420CDP",
					vin: "3N6CD33B0ZL450292",
				}),
				v("con-credito", {
					placa: "P-420CDP",
					conCredito: true,
					creditos: [
						{ sifco: "0101-x", estado: "MOROSO", fechaCreacion: "2026-01-18" },
					],
				}),
			],
		);
		const de = (id: string) => d.vehiculos.find((r) => r.vehiculo.id === id);
		expect(de("conflicto-sin-credito")?.estado).toBe("conflicto_placa_vin");
		expect(de("con-credito")?.estado).toBe("propuesto");
	});
	test("la placa en dos unidades → ambiguo", () => {
		const r = estadoDe(
			[u(1, "P-720GVH CON APAGADO"), u(2, "C-720GVH SIN APAGADO")],
			[v("a", { placa: "P-720GVH" })],
			"a",
		);
		expect(r?.estado).toBe("ambiguo");
	});
	test("dos unidades con la placa pero el VIN desempata", () => {
		const r = estadoDe(
			[
				u(1, "P-720GVH CON APAGADO", { vin: "JTFRS12P9H0046026" }),
				u(2, "C-720GVH SIN APAGADO"),
			],
			[v("a", { placa: "P-720GVH", vin: "JTFRS12P9H0046026" })],
			"a",
		);
		expect(r?.estado).toBe("propuesto");
		expect(r?.unidad?.id).toBe(1);
	});
	test("la unidad ya está guardada en otro vehículo", () => {
		const r = estadoDe(
			[u(1, "P-420CDP CON APAGADO")],
			[
				v("a", { placa: "P-420CDP" }),
				v("b", { placa: "P-999ZZZ", wialonUnitId: 1, vinculadoPor: "sup@x" }),
			],
			"a",
		);
		expect(r?.estado).toBe("unidad_ya_asignada");
	});
	test("sin placa ni VIN válidos", () => {
		expect(
			estadoDe(
				[u(1, "P-420CDP")],
				[v("a", { placa: "NUEVO", vin: "N/A" })],
				"a",
			)?.estado,
		).toBe("sin_placa_ni_vin");
	});
	test("sin coincidencia: sugiere VIN parcial (serie) cuando el nombre trae un VIN incompleto", () => {
		const r = estadoDe(
			[u(9, "MMBJJC10TH011349 - CON APAGADO")],
			[v("a", { vin: "MMBJJC10ATH011349" })],
			"a",
		);
		expect(r?.estado).toBe("sin_coincidencia");
		expect(r?.sugerencia).toContain("VIN parcial");
		expect(r?.otras[0]?.id).toBe(9);
	});
	test("sin coincidencia: sugiere placa con una letra distinta", () => {
		const r = estadoDe(
			[u(9, "P-420CDB CON APAGADO")],
			[v("a", { placa: "P-420CDP" })],
			"a",
		);
		expect(r?.estado).toBe("sin_coincidencia");
		expect(r?.sugerencia).toBe("Placa con un carácter distinto");
	});
	test("placa parecida en dos unidades → no sugiere nada", () => {
		const r = estadoDe(
			[u(8, "P-420CDB"), u(9, "P-421CDP")],
			[v("a", { placa: "P-420CDP" })],
			"a",
		);
		expect(r?.sugerencia).toBeNull();
	});
});

describe("diagnosticar — datos mal cargados en el CRM", () => {
	test("VIN guardado en el campo de placa", () => {
		const r = estadoDe(
			[u(2, "LVBV3JBB4TY001234 - CON APAGADO")],
			[v("a", { placa: "LVBV3JBB4TY001234" })],
			"a",
		);
		expect(r?.estado).toBe("propuesto");
		expect(r?.metodo).toBe("vin");
	});
	test("VIN incompleto en el CRM: no vincula, pero sugiere por la serie", () => {
		const r = estadoDe(
			[u(2, "LJ11PABD0VC002001 - CON APAGADO")],
			[v("a", { vin: "LJ11PABD0V002001" })],
			"a",
		);
		expect(r?.estado).toBe("sin_coincidencia");
		expect(r?.sugerencia).toContain("VIN parcial");
		expect(r?.otras[0]?.id).toBe(2);
	});
	test("VIN incompleto sin unidad con esa serie → sin coincidencia, sin sugerencia", () => {
		const r = estadoDe(
			[u(2, "P-420CDP")],
			[v("a", { vin: "LJ11PABD0V002001" })],
			"a",
		);
		expect(r?.estado).toBe("sin_coincidencia");
		expect(r?.sugerencia).toBeNull();
	});
});

describe("diagnosticar — vehículos duplicados que reclaman la misma unidad", () => {
	const cr = (sifco: string, estado: string | null, fecha = "2026-01-18") => ({
		sifco,
		estado,
		fechaCreacion: fecha,
	});
	const de = (d: ReturnType<typeof diagnosticar>, id: string) =>
		d.vehiculos.find((r) => r.vehiculo.id === id);

	test("gana el único con crédito vigente; el migrado incobrable queda como duplicado", () => {
		const d = diagnosticar(
			[u(1, "P-629KNS CON APAGADO")],
			[
				v("viejo", {
					placa: "P-629KNS",
					conCredito: true,
					creditos: [cr("01010214115210", "INCOBRABLE")],
				}),
				v("nuevo", {
					placa: "P0-629KNS",
					conCredito: true,
					creditos: [cr("CRM-b3cf", "ACTIVO", "2026-03-30")],
				}),
			],
		);
		expect(de(d, "nuevo")?.estado).toBe("propuesto");
		expect(de(d, "nuevo")?.confirmar).toBe(false);
		expect(de(d, "nuevo")?.sugerencia).toContain("único con crédito vigente");
		expect(de(d, "viejo")?.estado).toBe("duplicado_descartado");
		expect(de(d, "viejo")?.detalle).toContain("nuevo");
		expect(d.unidades[0]?.estado).toBe("propuesta");
	});
	test("PENDIENTE_CANCELACION no cuenta como vigente: gana el ACTIVO aunque sea más viejo", () => {
		const d = diagnosticar(
			[u(1, "P-123ABC")],
			[
				v("activo", {
					placa: "P-123ABC",
					conCredito: true,
					creditos: [cr("01010214000001", "ACTIVO")],
				}),
				v("cerrando", {
					placa: "P0-123ABC",
					conCredito: true,
					creditos: [cr("CRM-nuevo", "PENDIENTE_CANCELACION", "2026-05-01")],
				}),
			],
		);
		expect(de(d, "activo")?.estado).toBe("propuesto");
		expect(de(d, "activo")?.confirmar).toBe(false);
		expect(de(d, "cerrando")?.estado).toBe("duplicado_descartado");
	});
	test("MOROSO cuenta como vigente y le gana a un vehículo sin crédito", () => {
		const d = diagnosticar(
			[u(1, "P-287JZY CON APAGADO")],
			[
				v("sinCredito", { placa: "P0-287JZY", vin: "JM3KE4CY2G0887993" }),
				v("migrado", {
					placa: "P-287JZY",
					conCredito: true,
					creditos: [cr("01010214122150", "MOROSO")],
				}),
			],
		);
		expect(de(d, "migrado")?.estado).toBe("propuesto");
		expect(de(d, "sinCredito")?.estado).toBe("duplicado_descartado");
	});
	test("un SIFCO que no existe en cartera no cuenta como vigente", () => {
		const d = diagnosticar(
			[u(1, "P-621FWF - SIN APAGADO")],
			[
				v("a", {
					placa: "P-621FWF",
					conCredito: true,
					creditos: [cr("01010214113090", null)],
				}),
				v("b", {
					placa: "p-621fwf",
					conCredito: true,
					creditos: [cr("CRM-0c2d", "ACTIVO")],
				}),
			],
		);
		expect(de(d, "b")?.estado).toBe("propuesto");
		expect(de(d, "a")?.estado).toBe("duplicado_descartado");
	});
	test("mismo crédito vigente en los dos: desempata el prefijo de la placa contra la unidad", () => {
		const d = diagnosticar(
			[u(1, "C-558CBP - CON APAGADO")],
			[
				v("conC", {
					placa: "C-558CBP",
					conCredito: true,
					creditos: [cr("01010214118900", "ACTIVO")],
				}),
				v("conP", {
					placa: "P-558CBP",
					conCredito: true,
					creditos: [cr("01010214118900", "ACTIVO")],
				}),
			],
		);
		expect(de(d, "conC")?.estado).toBe("propuesto");
		expect(de(d, "conP")?.estado).toBe("duplicado_descartado");
	});
	test("mismo crédito y el prefijo no desempata → revisión manual", () => {
		const d = diagnosticar(
			[u(1, "P-558CBP - CON APAGADO")],
			[
				v("a", {
					placa: "P-558CBP",
					conCredito: true,
					creditos: [cr("X", "ACTIVO")],
				}),
				v("b", {
					placa: "P0-558CBP",
					conCredito: true,
					creditos: [cr("X", "ACTIVO")],
				}),
			],
		);
		expect(de(d, "a")?.estado).toBe("unidad_disputada");
		expect(de(d, "b")?.estado).toBe("unidad_disputada");
	});
	test("dos créditos vigentes distintos: gana el originado en el CRM sobre el migrado de SIFCO", () => {
		const d = diagnosticar(
			[u(1, "P-313JKF CON APAGADO")],
			[
				v("viejo", {
					placa: "P-313JKF",
					conCredito: true,
					// La fecha de un migrado es la de la migración: no cuenta.
					creditos: [cr("01010214116080", "MOROSO", "2026-08-19")],
				}),
				v("nuevo", {
					placa: "P0-313JKF",
					conCredito: true,
					creditos: [cr("CRM-d9f5", "MOROSO", "2026-03-21")],
				}),
			],
		);
		expect(de(d, "nuevo")?.estado).toBe("propuesto");
		expect(de(d, "nuevo")?.confirmar).toBe(false);
		expect(de(d, "viejo")?.estado).toBe("duplicado_descartado");
	});
	test("compartir un crédito viejo cancelado no los hace el mismo crédito: decide el vigente más nuevo", () => {
		const d = diagnosticar(
			[u(1, "C-123ABC - CON APAGADO")],
			[
				v("viejo", {
					// El prefijo coincide con la unidad: antes ganaba por eso.
					placa: "C-123ABC",
					conCredito: true,
					creditos: [
						cr("01010214000001", "CANCELADO"),
						cr("01010214000002", "ACTIVO"),
					],
				}),
				v("nuevo", {
					placa: "P-123ABC",
					conCredito: true,
					creditos: [
						cr("01010214000001", "CANCELADO"),
						cr("CRM-nuevo", "ACTIVO", "2026-05-01"),
					],
				}),
			],
		);
		expect(de(d, "nuevo")?.estado).toBe("propuesto");
		expect(de(d, "nuevo")?.sugerencia).toContain("el más nuevo");
		expect(de(d, "viejo")?.estado).toBe("duplicado_descartado");
	});
	test("comparten el crédito vigente pero uno tiene además un refinanciamiento: gana el más nuevo, no el prefijo", () => {
		const d = diagnosticar(
			[u(1, "C-123ABC - CON APAGADO")],
			[
				v("solo-viejo", {
					placa: "C-123ABC",
					conCredito: true,
					creditos: [cr("01010214000001", "MOROSO")],
				}),
				v("con-refinanciamiento", {
					placa: "P-123ABC",
					conCredito: true,
					creditos: [
						cr("01010214000001", "MOROSO"),
						cr("CRM-nuevo", "ACTIVO", "2026-05-01"),
					],
				}),
			],
		);
		expect(de(d, "con-refinanciamiento")?.estado).toBe("propuesto");
		expect(de(d, "solo-viejo")?.estado).toBe("duplicado_descartado");
	});
	test("dos créditos vigentes distintos del mismo origen: gana el de fecha más reciente", () => {
		const d = diagnosticar(
			[u(1, "P-111AAA")],
			[
				v("a", {
					placa: "P-111AAA",
					conCredito: true,
					creditos: [cr("CRM-a", "ACTIVO", "2026-02-01")],
				}),
				v("b", {
					placa: "P0-111AAA",
					conCredito: true,
					creditos: [cr("CRM-b", "MOROSO", "2026-05-01")],
				}),
			],
		);
		expect(de(d, "b")?.estado).toBe("propuesto");
		expect(de(d, "a")?.estado).toBe("duplicado_descartado");
	});
	test("dos créditos vigentes distintos con la misma fecha → revisión manual", () => {
		const d = diagnosticar(
			[u(1, "P-111AAA")],
			[
				v("a", {
					placa: "P-111AAA",
					conCredito: true,
					creditos: [cr("X", "ACTIVO")],
				}),
				v("b", {
					placa: "P0-111AAA",
					conCredito: true,
					creditos: [cr("Y", "MOROSO")],
				}),
			],
		);
		expect(de(d, "a")?.estado).toBe("unidad_disputada");
		expect(de(d, "a")?.detalle).toContain("créditos vigentes distintos");
	});
	test("ninguno vigente: gana el crédito más reciente y queda para confirmar", () => {
		const d = diagnosticar(
			[u(1, "P-277LGY SIN APAGADO")],
			[
				v("viejo", {
					placa: "P-277LGY",
					conCredito: true,
					creditos: [cr("01010214120770", "CANCELADO", "2026-01-18")],
				}),
				v("nuevo", {
					placa: "P0-277LGY",
					conCredito: true,
					creditos: [cr("CRM-ba17", "INCOBRABLE", "2026-02-05")],
				}),
			],
		);
		expect(de(d, "nuevo")?.estado).toBe("propuesto");
		expect(de(d, "nuevo")?.confirmar).toBe(true);
		expect(de(d, "nuevo")?.sugerencia).toContain("confirmar");
		expect(de(d, "viejo")?.estado).toBe("duplicado_descartado");
	});
	test("ninguno vigente: el CRM- le gana al migrado aunque la fecha de migración sea posterior", () => {
		const d = diagnosticar(
			[u(1, "P-111AAA")],
			[
				v("migrado", {
					placa: "P-111AAA",
					conCredito: true,
					// Fecha de la migración, no la del préstamo.
					creditos: [cr("01010214000001", "INCOBRABLE", "2026-08-19")],
				}),
				v("crm", {
					placa: "P0-111AAA",
					conCredito: true,
					creditos: [cr("CRM-a", "CANCELADO", "2026-03-01")],
				}),
			],
		);
		expect(de(d, "crm")?.estado).toBe("propuesto");
		expect(de(d, "crm")?.confirmar).toBe(true);
		expect(de(d, "migrado")?.estado).toBe("duplicado_descartado");
	});
	test("ninguno vigente: una fecha ilegible no elige ganador al azar", () => {
		const d = diagnosticar(
			[u(1, "P-111AAA")],
			[
				v("a", {
					placa: "P-111AAA",
					conCredito: true,
					creditos: [cr("CRM-a", "CANCELADO", "no es fecha")],
				}),
				v("b", {
					placa: "P0-111AAA",
					conCredito: true,
					creditos: [cr("CRM-b", "CANCELADO", "2026-03-01")],
				}),
				v("c", {
					placa: "P 111AAA",
					conCredito: true,
					creditos: [cr("CRM-c", "CANCELADO", "2026-05-01")],
				}),
			],
		);
		expect(de(d, "c")?.estado).toBe("propuesto");
		expect(de(d, "a")?.estado).toBe("duplicado_descartado");
		expect(de(d, "b")?.estado).toBe("duplicado_descartado");
	});
	test("ninguno vigente y misma fecha → revisión manual", () => {
		const d = diagnosticar(
			[u(1, "P-111AAA")],
			[
				v("a", {
					placa: "P-111AAA",
					conCredito: true,
					creditos: [cr("X", "CANCELADO")],
				}),
				v("b", {
					placa: "P0-111AAA",
					conCredito: true,
					creditos: [cr("Y", "INCOBRABLE")],
				}),
			],
		);
		expect(de(d, "a")?.estado).toBe("unidad_disputada");
	});
	test("ninguno tiene crédito → revisión manual", () => {
		const d = diagnosticar(
			[u(1, "P-111AAA")],
			[v("a", { placa: "P-111AAA" }), v("b", { placa: "P0-111AAA" })],
		);
		expect(de(d, "a")?.estado).toBe("unidad_disputada");
		expect(de(d, "a")?.detalle).toContain("Ningún vehículo tiene crédito");
		expect(d.unidades[0]?.estado).toBe("en_revision");
	});
	test("sin datos de cartera (creditos vacío) nunca elige ganador entre vehículos con crédito", () => {
		const d = diagnosticar(
			[u(1, "P-111AAA")],
			[
				v("a", { placa: "P-111AAA", conCredito: true }),
				v("b", { placa: "P0-111AAA", conCredito: true }),
			],
		);
		expect(de(d, "a")?.estado).toBe("unidad_disputada");
	});
});

describe("diagnosticar — sugerencias", () => {
	test("no sugiere una unidad que ya tiene coincidencia exacta con otro vehículo", () => {
		const d = diagnosticar(
			[u(2, "LVBV3JBB4TY004921 - CON APAGADO")],
			[
				v("a", { placa: "LVBV3JBB4TY004921" }),
				v("b", { vin: "LJ11PABE7VC004921" }),
			],
		);
		const b = d.vehiculos.find((r) => r.vehiculo.id === "b");
		expect(b?.estado).toBe("sin_coincidencia");
		expect(b?.sugerencia).toBeNull();
	});
	test("VIN completo con la misma serie pero muy distinto → no sugiere", () => {
		const r = estadoDe(
			[u(2, "LJ11PABD2VC028202 - CON APAGADO")],
			[v("a", { vin: "KNAPP813BPK028202" })],
			"a",
		);
		expect(r?.sugerencia).toBeNull();
	});
	test("VIN completo con 2 caracteres distintos (tipeo) → sugiere", () => {
		const r = estadoDe(
			[u(2, "LGDWB1LT4TA605637 - CON APAGADO")],
			[v("a", { vin: "LGDWB1LX4TA605637" })],
			"a",
		);
		expect(r?.sugerencia).toContain("VIN parcial");
	});
	test("no sugiere por placa parecida una unidad ya guardada en otro vehículo", () => {
		const r = estadoDe(
			[u(9, "P-420CDB CON APAGADO")],
			[
				v("a", { placa: "P-420CDP" }),
				v("b", { placa: "P-999ZZZ", wialonUnitId: 9 }),
			],
			"a",
		);
		expect(r?.sugerencia).toBeNull();
	});
});

describe("diagnosticar — vehículos ya vinculados", () => {
	const unidades = [u(1, "P-420CDP CON APAGADO"), u(2, "P-111AAA CON APAGADO")];
	test("la evidencia confirma la unidad guardada", () => {
		expect(
			estadoDe(
				unidades,
				[
					v("a", {
						placa: "P-420CDP",
						wialonUnitId: 1,
						vinculadoPor: "auto:placa",
					}),
				],
				"a",
			)?.estado,
		).toBe("vinculado_confirmado");
	});
	test("la evidencia apunta a otra unidad", () => {
		const r = estadoDe(
			unidades,
			[v("a", { placa: "P-111AAA", wialonUnitId: 1, vinculadoPor: "sup@x" })],
			"a",
		);
		expect(r?.estado).toBe("vinculado_contradice");
		expect(r?.otras[0]?.id).toBe(2);
	});
	test("fijado a mano sin placa que lo respalde", () => {
		expect(
			estadoDe(
				unidades,
				[v("a", { placa: "NUEVO", wialonUnitId: 1, vinculadoPor: "sup@x" })],
				"a",
			)?.estado,
		).toBe("vinculado_sin_evidencia");
	});
	test("la unidad guardada ya no existe en Wialon", () => {
		expect(
			estadoDe(
				unidades,
				[v("a", { placa: "P-420CDP", wialonUnitId: 777 })],
				"a",
			)?.estado,
		).toBe("vinculado_unidad_inexistente");
	});
});

describe("diagnosticar — soloConCredito", () => {
	test("una unidad guardada en un vehículo sin crédito sigue ocupada", () => {
		const unidades = [u(1, "P-123ABC - CON APAGADO")];
		const vehiculos = [
			v("sin", {
				placa: "P-123ABC",
				wialonUnitId: 1,
				vinculadoPor: "auto:placa",
			}),
			v("con", { placa: "P0-123ABC", conCredito: true }),
		];
		const d = diagnosticar(unidades, vehiculos, { soloConCredito: true });
		expect(d.vehiculos.map((r) => r.vehiculo.id)).toEqual(["con"]);
		expect(d.vehiculos[0].estado).toBe("unidad_ya_asignada");
		expect(d.unidades[0].estado).toBe("vinculada");
	});
	test("el duplicado sin crédito pierde la disputa y no se reporta", () => {
		const unidades = [u(1, "P-123ABC")];
		const vehiculos = [
			v("sin", { placa: "P-123ABC" }),
			v("con", {
				placa: "P0-123ABC",
				conCredito: true,
				creditos: [
					{ sifco: "CRM-a", estado: "ACTIVO", fechaCreacion: "2026-03-01" },
				],
			}),
		];
		const d = diagnosticar(unidades, vehiculos, { soloConCredito: true });
		expect(d.vehiculos.map((r) => [r.vehiculo.id, r.estado])).toEqual([
			["con", "propuesto"],
		]);
	});
	test("una unidad que solo propone un vehículo sin crédito no sale como propuesta", () => {
		const d = diagnosticar(
			[u(1, "P-123ABC")],
			[v("sin", { placa: "P-123ABC" })],
			{
				soloConCredito: true,
			},
		);
		expect(d.vehiculos).toEqual([]);
		expect(d.unidades[0].estado).toBe("sin_vehiculo");
	});
});

describe("diagnosticar — vista por unidad", () => {
	test("clasifica vinculada, propuesta, en revisión y sin vehículo", () => {
		const d = diagnosticar(
			[
				u(1, "P-111AAA"),
				u(2, "P-222BBB"),
				u(3, "P-333CCC"),
				u(4, "C-333CCC"),
				u(5, "Prueba VT100L2"),
			],
			[
				v("a", { placa: "P-111AAA", wialonUnitId: 1 }),
				v("b", { placa: "P-222BBB" }),
				v("c", { placa: "P-333CCC" }),
			],
		);
		const estado = (id: number) =>
			d.unidades.find((r) => r.unidad.id === id)?.estado;
		expect(estado(1)).toBe("vinculada");
		expect(estado(2)).toBe("propuesta");
		expect(estado(3)).toBe("en_revision");
		expect(estado(4)).toBe("en_revision");
		expect(estado(5)).toBe("sin_vehiculo");
		expect(d.unidades.find((r) => r.unidad.id === 5)?.detalle).toBe(
			"Nombre sin placa ni VIN reconocible",
		);
	});
});

describe("metodoVigente (revalidar la unidad justo antes de escribir)", () => {
	const VIN = "3N6CD33B0ZL450292";
	test("la unidad sigue igual: mismo método", () => {
		expect(
			metodoVigente(
				{ placa: "P0-420CDP", vin: null },
				u(1, "P-420CDP CON APAGADO"),
			),
		).toBe("placa");
		expect(
			metodoVigente({ placa: null, vin: VIN }, u(1, `${VIN} - CON APAGADO`)),
		).toBe("vin");
	});
	test("solo cambió el sufijo del nombre: sigue valiendo", () => {
		expect(
			metodoVigente(
				{ placa: "P-420CDP", vin: null },
				u(1, "P-420CDP - SIN APAGADO"),
			),
		).toBe("placa");
	});
	test("la unidad se pasó a otro carro (otra placa u otro VIN): ya no coincide", () => {
		expect(
			metodoVigente(
				{ placa: "P-420CDP", vin: null },
				u(1, "P-999XYZ CON APAGADO"),
			),
		).toBeNull();
		expect(
			metodoVigente(
				{ placa: null, vin: VIN },
				u(1, "1HGBH41JXMN109186 - CON APAGADO"),
			),
		).toBeNull();
	});
	test("el VIN que solo estaba en el campo vin de la unidad se borró: ya no coincide", () => {
		expect(
			metodoVigente({ placa: null, vin: VIN }, u(1, "Unidad 1", { vin: VIN })),
		).toBe("vin_campo");
		expect(
			metodoVigente({ placa: null, vin: VIN }, u(1, "Unidad 1")),
		).toBeNull();
	});
	test("placa y VIN del vehículo ahora apuntan a cosas distintas en la unidad: el método cambia", () => {
		// Antes coincidía solo por placa; ahora la unidad trae además el VIN.
		expect(
			metodoVigente(
				{ placa: "P-420CDP", vin: VIN },
				u(1, `P-420CDP ${VIN} CON APAGADO`),
			),
		).toBe("placa+vin");
	});
});

describe("celdaCsv", () => {
	test("escapa comas y comillas", () => {
		expect(celdaCsv('a,"b"')).toBe('"a,""b"""');
		expect(celdaCsv(null)).toBe("");
		expect(celdaCsv(5)).toBe("5");
	});
});

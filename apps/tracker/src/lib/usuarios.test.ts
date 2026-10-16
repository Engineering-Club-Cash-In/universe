import { describe, expect, test } from "bun:test";
import {
	filtrarUsuarios,
	insigniasEn,
	opcionesDeAgencia,
	paginarUsuarios,
	rolDeUsuario,
	type UsuarioFila,
} from "./usuarios";

function fila(sobre: Partial<UsuarioFila> & { id: string }): UsuarioFila {
	return {
		nombre: "Ana López",
		correo: "ana@agencia.com",
		cuentaSuspendida: false,
		creadoEn: new Date("2026-01-01"),
		esYo: false,
		membresias: [
			{
				companyId: "a1",
				companyNombre: "Agencia Uno",
				rol: "usuario",
				telefono: null,
				activa: true,
			},
		],
		...sobre,
	};
}

const ANA = fila({ id: "1" });
const LUIS = fila({
	id: "2",
	nombre: "Luis Pérez",
	correo: "luis@otra.com",
	membresias: [
		{ companyId: "a2", companyNombre: "Agencia Dos", rol: "gerente", telefono: null, activa: true },
	],
});
const MARTA = fila({
	id: "3",
	nombre: "Marta Díaz",
	correo: "marta@agencia.com",
	membresias: [
		{ companyId: "a1", companyNombre: "Agencia Uno", rol: "usuario", telefono: null, activa: false },
		{ companyId: "a2", companyNombre: "Agencia Dos", rol: "usuario", telefono: null, activa: false },
	],
});
const SUSPENDIDO = fila({ id: "4", nombre: "Zoe", correo: "zoe@x.com", cuentaSuspendida: true });
const TODOS = [ANA, LUIS, MARTA, SUSPENDIDO];
const SIN_FILTROS = { busqueda: "", estado: "todos", rol: "todos", agencia: "todas" } as const;

describe("filtrarUsuarios", () => {
	test("sin filtros devuelve todos", () => {
		expect(filtrarUsuarios(TODOS, SIN_FILTROS)).toHaveLength(4);
	});
	test("busca por nombre o correo sin importar mayúsculas ni acentos", () => {
		expect(filtrarUsuarios(TODOS, { ...SIN_FILTROS, busqueda: "perez" }).map((u) => u.id)).toEqual(["2"]);
		expect(filtrarUsuarios(TODOS, { ...SIN_FILTROS, busqueda: "MARTA@" }).map((u) => u.id)).toEqual(["3"]);
		expect(filtrarUsuarios(TODOS, { ...SIN_FILTROS, busqueda: "  ana " }).map((u) => u.id)).toEqual(["1"]);
	});
	test("estado: activo requiere cuenta sin suspender y alguna agencia activa", () => {
		expect(filtrarUsuarios(TODOS, { ...SIN_FILTROS, estado: "activo" }).map((u) => u.id)).toEqual(["1", "2"]);
		expect(filtrarUsuarios(TODOS, { ...SIN_FILTROS, estado: "inactivo" }).map((u) => u.id)).toEqual(["3", "4"]);
	});
	test("rol y agencia", () => {
		expect(filtrarUsuarios(TODOS, { ...SIN_FILTROS, rol: "gerente" }).map((u) => u.id)).toEqual(["2"]);
		expect(filtrarUsuarios(TODOS, { ...SIN_FILTROS, agencia: "a1" }).map((u) => u.id)).toEqual(["1", "3", "4"]);
	});
	test("los filtros se combinan", () => {
		expect(filtrarUsuarios(TODOS, { ...SIN_FILTROS, agencia: "a1", estado: "activo" }).map((u) => u.id)).toEqual(["1"]);
	});
});

describe("filtrarUsuarios con una agencia elegida", () => {
	// Gerente en A (activo) y usuario en B (inactivo)
	const MIXTO = fila({
		id: "9",
		nombre: "Mixto",
		correo: "mixto@x.com",
		membresias: [
			{ companyId: "A", companyNombre: "A", rol: "gerente", telefono: null, activa: true },
			{ companyId: "B", companyNombre: "B", rol: "usuario", telefono: null, activa: false },
		],
	});
	const ids = (f: Partial<Parameters<typeof filtrarUsuarios>[1]>) =>
		filtrarUsuarios([MIXTO], { ...SIN_FILTROS, ...f }).map((u) => u.id);

	test("el rol se evalúa en esa agencia", () => {
		expect(ids({ agencia: "B", rol: "gerente" })).toEqual([]);
		expect(ids({ agencia: "A", rol: "gerente" })).toEqual(["9"]);
		expect(ids({ agencia: "B", rol: "usuario" })).toEqual(["9"]);
		expect(ids({ agencia: "A", rol: "usuario" })).toEqual([]);
	});
	test("el estado se evalúa en esa agencia", () => {
		expect(ids({ agencia: "B", estado: "activo" })).toEqual([]);
		expect(ids({ agencia: "B", estado: "inactivo" })).toEqual(["9"]);
		expect(ids({ agencia: "A", estado: "activo" })).toEqual(["9"]);
		expect(ids({ agencia: "A", estado: "inactivo" })).toEqual([]);
	});
	test("una cuenta suspendida no está activa en ninguna agencia", () => {
		const s = { ...MIXTO, cuentaSuspendida: true };
		expect(filtrarUsuarios([s], { ...SIN_FILTROS, agencia: "A", estado: "activo" })).toEqual([]);
		expect(filtrarUsuarios([s], { ...SIN_FILTROS, agencia: "A", estado: "inactivo" })).toHaveLength(1);
	});
	test("con todas las agencias el rol y el estado siguen siendo los globales", () => {
		expect(ids({ rol: "gerente" })).toEqual(["9"]);
		expect(ids({ estado: "activo" })).toEqual(["9"]);
	});
	test("una agencia donde no tiene membresía lo excluye", () => {
		expect(ids({ agencia: "C" })).toEqual([]);
	});
});

describe("rolDeUsuario", () => {
	test("gerente si lo es en alguna agencia visible", () => {
		expect(rolDeUsuario(LUIS)).toBe("gerente");
		expect(rolDeUsuario(ANA)).toBe("usuario");
	});
});

describe("opcionesDeAgencia", () => {
	test("agencias únicas ordenadas por nombre", () => {
		expect(opcionesDeAgencia(TODOS)).toEqual([
			{ id: "a1", nombre: "Agencia Uno" },
			{ id: "a2", nombre: "Agencia Dos" },
		].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")));
	});
});

describe("paginarUsuarios", () => {
	const muchos = Array.from({ length: 25 }, (_, i) => fila({ id: String(i) }));
	test("recorta la página y la mantiene dentro de rango", () => {
		const p = paginarUsuarios(muchos, 3, 10);
		expect(p.paginaActual).toBe(3);
		expect(p.visibles).toHaveLength(5);
		expect(p.totalPaginas).toBe(3);
		expect(paginarUsuarios(muchos, 9, 10).paginaActual).toBe(3);
		expect(paginarUsuarios([], 4, 10)).toMatchObject({ paginaActual: 1, totalPaginas: 1, visibles: [] });
	});
});

describe("insigniasEn", () => {
	const MIX = fila({
		id: "9",
		membresias: [
			{ companyId: "A", companyNombre: "A", rol: "gerente", telefono: null, activa: true },
			{ companyId: "B", companyNombre: "B", rol: "usuario", telefono: null, activa: false },
		],
	});
	test("en A y en todas: gerente activo", () => {
		expect(insigniasEn(MIX, "A")).toEqual({ rol: "gerente", activo: true });
		expect(insigniasEn(MIX, "todas")).toEqual({ rol: "gerente", activo: true });
	});
	test("en B: usuario inactivo", () => {
		expect(insigniasEn(MIX, "B")).toEqual({ rol: "usuario", activo: false });
	});
	test("cuenta suspendida: inactiva en cualquier vista", () => {
		const s = { ...MIX, cuentaSuspendida: true };
		expect(insigniasEn(s, "A")?.activo).toBe(false);
		expect(insigniasEn(s, "todas")?.activo).toBe(false);
	});
	test("agencia ajena: null", () => {
		expect(insigniasEn(MIX, "Z")).toBeNull();
	});
});

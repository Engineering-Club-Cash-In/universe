import { describe, expect, test } from "bun:test";
import {
	cambiosDeEdicion,
	agenciaDeAlta,
	altaProtegida,
	nombreConfirmado,
	puedeCerrarAlta,
	agenciasConAcciones,
	filtrarUsuarios,
	insigniasEn,
	textoCambioEstado,
	opcionesDeAgencia,
	paginarUsuarios,
	rolDeUsuario,
	type UsuarioFila,
	LIMITES,
	validarAlta,
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

describe("validarAlta", () => {
	test("acepta un alta completa y limpia espacios", () => {
		expect(
			validarAlta({ nombre: " Ana ", correo: " Ana@Agencia.com ", telefono: "" }),
		).toEqual({ ok: true, valor: { nombre: "Ana", correo: "ana@agencia.com", telefono: undefined } });
	});
	test("pide nombre y correo válido", () => {
		const r = validarAlta({ nombre: " ", correo: "ana", telefono: "" });
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.errores.nombre).toBeTruthy();
			expect(r.errores.correo).toBeTruthy();
		}
	});
	test("rechaza los correos que el server también rechaza", () => {
		for (const correo of [
			"ana@agencia.c",
			"josé@agencia.com",
			"ana@agencia..com",
			"ana@-x.com",
			".ana@agencia.com",
		]) {
			const r = validarAlta({ nombre: "Ana", correo, telefono: "" });
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.errores.correo).toBeTruthy();
		}
	});
	test("acepta correos comunes con punto, más y guion", () => {
		for (const correo of ["ana.lopez@agencia.com", "ana+x@sub.agencia.com.gt", "a-b_c@mi-agencia.org"]) {
			expect(validarAlta({ nombre: "Ana", correo, telefono: "" }).ok).toBe(true);
		}
	});
	test("respeta los máximos del server", () => {
		const justo = validarAlta({
			nombre: "n".repeat(LIMITES.nombre),
			correo: "ana@agencia.com",
			telefono: "1".repeat(LIMITES.telefono),
		});
		expect(justo.ok).toBe(true);
		const r = validarAlta({
			nombre: "n".repeat(LIMITES.nombre + 1),
			correo: `${"a".repeat(LIMITES.correo)}@agencia.com`,
			telefono: "1".repeat(LIMITES.telefono + 1),
		});
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.errores.nombre).toBeTruthy();
			expect(r.errores.correo).toBeTruthy();
			expect(r.errores.telefono).toBeTruthy();
		}
	});
	test("rechaza correos de Club Cash In", () => {
		const r = validarAlta({ nombre: "Ana", correo: "ana@clubcashin.com", telefono: "" });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.errores.correo).toContain("Club Cash In");
	});
});

describe("agenciasConAcciones", () => {
	const permisos = {
		puedeEditarNombre: false,
		porAgencia: {
			a1: { puedeActivar: true, puedeEditarTelefono: true },
			a2: { puedeActivar: false, puedeEditarTelefono: false, motivo: "Es gerente" },
		},
	};
	test("une cada membresía con sus permisos", () => {
		const u = fila({
			id: "9",
			membresias: [
				{ companyId: "a1", companyNombre: "Uno", rol: "usuario", telefono: null, activa: true },
				{ companyId: "a2", companyNombre: "Dos", rol: "gerente", telefono: null, activa: true },
			],
		});
		const r = agenciasConAcciones(u, permisos);
		expect(r[0].puedeActivar).toBe(true);
		expect(r[1].puedeActivar).toBe(false);
		expect(r[1].motivo).toBe("Es gerente");
	});
	test("sin permiso para la agencia, todo cerrado", () => {
		const r = agenciasConAcciones(fila({ id: "9" }), { puedeEditarNombre: false, porAgencia: {} });
		expect(r[0].puedeActivar).toBe(false);
		expect(r[0].puedeEditarTelefono).toBe(false);
	});
});

describe("cierre del alta", () => {
	test("no se puede cerrar mientras se crea", () => {
		expect(puedeCerrarAlta(true)).toBe(false);
		expect(puedeCerrarAlta(false)).toBe(true);
	});
	test("está protegida mientras se crea y mientras muestra la contraseña", () => {
		expect(altaProtegida(true, null)).toBe(true);
		expect(altaProtegida(false, "abc")).toBe(true);
		expect(altaProtegida(false, null)).toBe(false);
	});
});

describe("agenciaDeAlta", () => {
	const lista = [{ id: "a1" }, { id: "a2" }];
	test("respeta la elegida si está en la lista", () => {
		expect(agenciaDeAlta(lista, "a2")).toBe("a2");
	});
	test("si la elegida no está en la lista usa la primera", () => {
		expect(agenciaDeAlta(lista, "")).toBe("a1");
		expect(agenciaDeAlta(lista, "ya-no-existe")).toBe("a1");
	});
	test("sin agencias devuelve vacío", () => {
		expect(agenciaDeAlta([], "a1")).toBe("");
	});
});

describe("nombreConfirmado", () => {
	test("usa el nombre enviado, no el del formulario", () => {
		expect(
			nombreConfirmado({ nombre: "Ana López" }, { nombre: "Otro editado" }),
		).toBe("Ana López");
	});
	test("sin variables cae al formulario, sin espacios", () => {
		expect(nombreConfirmado(undefined, { nombre: "  Ana  " })).toBe("Ana");
	});
});

describe("textoCambioEstado", () => {
	const ok = { nombre: "Ana", cuentaSuspendida: false };
	test("activar con cuenta suspendida avisa y cambia el toast", () => {
		expect(textoCambioEstado({ ...ok, cuentaSuspendida: true }, "Uno", true)).toEqual({
			descripcion:
				"Se activa en Uno, pero su cuenta está suspendida por Club Cash In: no podrá ver casos hasta que la reactiven.",
			toast: "Activado en la agencia (cuenta suspendida)",
		});
	});
	test("activar normal", () => {
		expect(textoCambioEstado(ok, "Uno", true)).toEqual({
			descripcion: "Ana volverá a ver los casos de Uno.",
			toast: "Usuario activado",
		});
	});
	test("desactivar no cambia, suspendida o no", () => {
		const r = textoCambioEstado({ ...ok, cuentaSuspendida: true }, "Uno", false);
		expect(r.toast).toBe("Usuario desactivado");
		expect(r.descripcion).toBe("Ana dejará de ver los casos de Uno. Sus otras agencias no cambian.");
	});
});

describe("cambiosDeEdicion", () => {
	const original = { agenciaId: "a1", nombre: "Ana", telefono: "5555" };
	const todo = { puedeEditarNombre: true, puedeEditarTelefono: true };

	test("editar solo el teléfono no manda el nombre, aunque un refetch lo haya cambiado", () => {
		// El formulario conserva "Ana" (lo que había al abrir); la consulta ya dice "Ana María".
		expect(cambiosDeEdicion(original, { nombre: "Ana", telefono: "7777" }, todo)).toEqual({
			agenciaId: "a1",
			telefono: "7777",
		});
	});

	test("un nombre cambiado por el gerente sí se manda", () => {
		expect(cambiosDeEdicion(original, { nombre: " Ana Luisa ", telefono: "5555" }, todo)).toEqual({
			agenciaId: "a1",
			nombre: "Ana Luisa",
		});
	});

	test("sin cambios o sin permiso no hay nada que guardar", () => {
		expect(cambiosDeEdicion(original, { nombre: "Ana", telefono: "5555" }, todo)).toBeNull();
		expect(
			cambiosDeEdicion(original, { nombre: "Otra", telefono: "1" }, { puedeEditarNombre: false, puedeEditarTelefono: false }),
		).toBeNull();
	});
});

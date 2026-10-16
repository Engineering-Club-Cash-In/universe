// Filtros puros de la lista de usuarios de la agencia (la búsqueda y los
// filtros viven en el front, igual que en el listado de casos).

export type UsuarioFila = {
	id: string;
	nombre: string;
	correo: string;
	cuentaSuspendida: boolean;
	creadoEn: Date;
	esYo: boolean;
	membresias: {
		companyId: string;
		companyNombre: string;
		rol: "gerente" | "usuario";
		telefono: string | null;
		activa: boolean;
	}[];
};

export type FiltrosUsuarios = {
	busqueda: string;
	estado: "todos" | "activo" | "inactivo";
	rol: "todos" | "gerente" | "usuario";
	agencia: string; // "todas" o id de agencia
};

export const FILTROS_INICIALES: FiltrosUsuarios = {
	busqueda: "",
	estado: "todos",
	rol: "todos",
	agencia: "todas",
};

export function normalizar(texto: string) {
	return texto
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase()
		.trim();
}

export function rolDeUsuario(u: UsuarioFila): "gerente" | "usuario" {
	return u.membresias.some((m) => m.rol === "gerente") ? "gerente" : "usuario";
}

// Activo = cuenta sin suspender y al menos una agencia activa.
export function estaActivo(u: UsuarioFila) {
	return !u.cuentaSuspendida && u.membresias.some((m) => m.activa);
}

// Rol y estado que se muestran (y se filtran): con "todas" son los globales;
// con una agencia, los que tiene EN ESA agencia (un gerente de A que es usuario
// en B no sale como gerente de B). null = no pertenece a esa agencia.
export function insigniasEn(
	u: UsuarioFila,
	agencia: string,
): { rol: "gerente" | "usuario"; activo: boolean } | null {
	if (agencia === "todas") return { rol: rolDeUsuario(u), activo: estaActivo(u) };
	const m = u.membresias.find((x) => x.companyId === agencia);
	if (!m) return null;
	return { rol: m.rol, activo: !u.cuentaSuspendida && m.activa };
}

export function filtrarUsuarios(
	usuarios: UsuarioFila[],
	f: FiltrosUsuarios,
): UsuarioFila[] {
	const q = normalizar(f.busqueda);
	return usuarios.filter((u) => {
		if (q && !normalizar(u.nombre).includes(q) && !normalizar(u.correo).includes(q)) {
			return false;
		}
		const insignias = insigniasEn(u, f.agencia);
		if (!insignias) return false;
		if (f.rol !== "todos" && insignias.rol !== f.rol) return false;
		if (f.estado !== "todos" && insignias.activo !== (f.estado === "activo")) {
			return false;
		}
		return true;
	});
}

export function opcionesDeAgencia(usuarios: UsuarioFila[]) {
	const porId = new Map<string, string>();
	for (const u of usuarios) {
		for (const m of u.membresias) porId.set(m.companyId, m.companyNombre);
	}
	return [...porId.entries()]
		.map(([id, nombre]) => ({ id, nombre }))
		.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

export function paginarUsuarios(
	usuarios: UsuarioFila[],
	pagina: number,
	porPagina: number,
) {
	const totalPaginas = Math.max(1, Math.ceil(usuarios.length / porPagina));
	const paginaActual = Math.min(Math.max(1, pagina), totalPaginas);
	return {
		paginaActual,
		totalPaginas,
		visibles: usuarios.slice(
			(paginaActual - 1) * porPagina,
			paginaActual * porPagina,
		),
	};
}

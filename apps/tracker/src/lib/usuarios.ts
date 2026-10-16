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

// ---- Alta y detalle ----

export type FormularioAlta = { nombre: string; correo: string; telefono: string };

export type ResultadoAlta =
	| {
			ok: true;
			valor: { nombre: string; correo: string; telefono: string | undefined };
	  }
	| {
			ok: false;
			errores: { nombre?: string; correo?: string; telefono?: string };
	  };

// Mismos máximos que el server (tracker-usuarios.ts).
export const LIMITES = { nombre: 200, correo: 320, telefono: 30 } as const;

// Misma regla que `.email()` de zod en el server: si aquí pasa, allá también.
// El server responde "Input validation failed" (en inglés) cuando no.
const REGEX_CORREO =
	/^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9-]*\.)+[A-Z]{2,}$/i;

export const correoValido = (correo: string) => REGEX_CORREO.test(correo);

// El server vuelve a validar todo; esto solo evita un viaje de ida y vuelta.
export function validarAlta(f: FormularioAlta): ResultadoAlta {
	const nombre = f.nombre.trim();
	const correo = f.correo.trim().toLowerCase();
	const telefono = f.telefono.trim();
	const errores: { nombre?: string; correo?: string; telefono?: string } = {};
	if (!nombre) errores.nombre = "Escribe el nombre";
	else if (nombre.length > LIMITES.nombre) {
		errores.nombre = `El nombre no puede pasar de ${LIMITES.nombre} letras`;
	}
	if (correo.length > LIMITES.correo || !correoValido(correo)) {
		errores.correo = "Escribe un correo válido";
	} else if (correo.endsWith("@clubcashin.com")) {
		errores.correo = "No se puede usar un correo de Club Cash In";
	}
	if (telefono.length > LIMITES.telefono) {
		errores.telefono = `El teléfono no puede pasar de ${LIMITES.telefono} dígitos`;
	}
	if (errores.nombre || errores.correo || errores.telefono) {
		return { ok: false, errores };
	}
	return { ok: true, valor: { nombre, correo, telefono: telefono || undefined } };
}

export type PermisosUsuario = {
	puedeEditarNombre: boolean;
	motivoNombre?: string;
	porAgencia: Record<
		string,
		{ puedeActivar: boolean; puedeEditarTelefono: boolean; motivo?: string }
	>;
};

// Cada agencia del usuario con lo que el gerente puede hacerle ahí.
export function agenciasConAcciones(u: UsuarioFila, p: PermisosUsuario) {
	return u.membresias.map((m) => {
		const permiso = p.porAgencia[m.companyId];
		return {
			...m,
			puedeActivar: permiso?.puedeActivar ?? false,
			puedeEditarTelefono: permiso?.puedeEditarTelefono ?? false,
			motivo: permiso?.motivo,
		};
	});
}

// Mientras el alta viaja al servidor la ventana no se puede cerrar: si se
// cerrara, la contraseña temporal llegaría a una ventana ya reiniciada y se
// perdería. Una vez creada, solo se cierra con sus botones (no con Escape ni
// el fondo) para no perderla por accidente.
export const puedeCerrarAlta = (pendiente: boolean): boolean => !pendiente;
export const altaProtegida = (
	pendiente: boolean,
	contrasena: string | null,
): boolean => pendiente || contrasena !== null;

/**
 * La agencia del alta se deriva en cada render, sin efecto: si la elegida sigue
 * en la lista se respeta; si no (la lista cambió o nunca eligió), la primera.
 */
export function agenciaDeAlta(
	agencias: { id: string }[],
	elegida: string,
): string {
	if (agencias.some((a) => a.id === elegida)) return elegida;
	return agencias[0]?.id ?? "";
}

/**
 * Nombre que se muestra en la confirmación: el que se envió, no lo que haya
 * en el formulario ahora (se puede seguir editando mientras la petición vuela).
 */
export function nombreConfirmado(
	variables: { nombre: string } | undefined,
	form: { nombre: string },
): string {
	return (variables?.nombre ?? form.nombre).trim();
}

/** Texto de la confirmación de Activar/Desactivar y aviso al terminar. Activar
 * en una agencia no levanta la suspensión de la cuenta (es de Club Cash In). */
export function textoCambioEstado(
	u: { nombre: string; cuentaSuspendida: boolean },
	agencia: string,
	activar: boolean,
): { descripcion: string; toast: string } {
	if (!activar) {
		return {
			descripcion: `${u.nombre} dejará de ver los casos de ${agencia}. Sus otras agencias no cambian.`,
			toast: "Usuario desactivado",
		};
	}
	if (u.cuentaSuspendida) {
		return {
			descripcion: `Se activa en ${agencia}, pero su cuenta está suspendida por Club Cash In: no podrá ver casos hasta que la reactiven.`,
			toast: "Activado en la agencia (cuenta suspendida)",
		};
	}
	return {
		descripcion: `${u.nombre} volverá a ver los casos de ${agencia}.`,
		toast: "Usuario activado",
	};
}

/**
 * Qué mandar al guardar una edición. Se compara contra lo que había al abrir
 * la ventana (`original`), no contra la consulta: si un refetch trae el nombre
 * que cambió otro gerente, mandar el viejo lo revertiría sin que nadie lo tocara.
 * Devuelve null si no hay nada que guardar.
 */
export function cambiosDeEdicion(
	original: { agenciaId: string; nombre: string; telefono: string },
	form: { nombre: string; telefono: string },
	permisos: { puedeEditarNombre: boolean; puedeEditarTelefono: boolean },
): { agenciaId: string; nombre?: string; telefono?: string } | null {
	const cambios: { agenciaId: string; nombre?: string; telefono?: string } = {
		agenciaId: original.agenciaId,
	};
	const nombre = form.nombre.trim();
	if (permisos.puedeEditarNombre && nombre !== original.nombre.trim()) {
		cambios.nombre = nombre;
	}
	const telefono = form.telefono.trim();
	if (permisos.puedeEditarTelefono && telefono !== original.telefono) {
		cambios.telefono = telefono;
	}
	return cambios.nombre === undefined && cambios.telefono === undefined
		? null
		: cambios;
}

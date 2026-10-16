/** Desactivar al único gerente activo deja la agencia sin quien la administre.
 * Uno con la cuenta suspendida no entra, así que tampoco cuenta como activo. */
export function esUltimoGerenteActivo(
	gerentes: { id: string; activa: boolean; cuentaSuspendida: boolean }[],
	id: string,
): boolean {
	const activos = gerentes.filter((g) => g.activa && !g.cuentaSuspendida);
	return activos.length === 1 && activos[0]?.id === id;
}

/** Línea extra de la confirmación de Activar: reactivar la agencia no levanta
 * la suspensión de la cuenta, que es de Club Cash In. */
export function avisoCuentaSuspendida(g: { cuentaSuspendida: boolean }): string | null {
	return g.cuentaSuspendida
		? "Su cuenta sigue suspendida: no podrá entrar al tracker hasta que un administrador la reactive en Usuarios."
		: null;
}

/** Mientras una mutación está en vuelo ningún diálogo se cierra, por ninguna
 * vía: se perdería el resultado (incluida la contraseña temporal, que no se
 * puede recuperar) o se cerraría sobre una escritura que sigue corriendo. */
export function puedeCerrar(pendiente: boolean): boolean {
	return !pendiente;
}

/** Cierra solo si no hay nada en vuelo: corre `alCerrar` en orden (primero el
 * padre, luego limpiar el formulario). Devuelve si cerró. */
export function cerrarSiSePuede(
	pendiente: boolean,
	...alCerrar: Array<() => void>
): boolean {
	if (!puedeCerrar(pendiente)) return false;
	for (const accion of alCerrar) accion();
	return true;
}

/** El servidor responde CONFLICT con `requiereConfirmacion` cuando el correo
 * ya es vendedor (o gerente inactivo) de la agencia. */
export function requiereConfirmacionPromocion(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false;
	const e = error as { code?: unknown; data?: { requiereConfirmacion?: unknown } };
	return e.code === "CONFLICT" && e.data?.requiereConfirmacion === true;
}

export type DatosCrearGerente = {
	nombre: string;
	correo: string;
	confirmarPromocion: boolean;
};

/** Reintento tras la advertencia de promoción: reenvía EXACTAMENTE lo que se
 * envió (no lo que el formulario diga ahora) y solo cambia la confirmación. */
export function reintentoConfirmado(enviado: DatosCrearGerente): DatosCrearGerente {
	return { nombre: enviado.nombre, correo: enviado.correo, confirmarPromocion: true };
}

/** Misma regla de correo que el formulario de empresa. */
export function correoValido(correo: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo.trim());
}

/** Cuando zod rechaza el input, oRPC deja el mensaje en español en
 * `data.issues` y el `message` genérico en inglés. */
export function mensajeDeError(error: unknown): string {
	if (typeof error !== "object" || error === null) return "Error desconocido";
	const e = error as {
		message?: unknown;
		data?: { issues?: { message?: unknown }[] };
	};
	const detalle = e.data?.issues?.[0]?.message;
	if (typeof detalle === "string" && detalle) return detalle;
	return typeof e.message === "string" && e.message ? e.message : "Error desconocido";
}

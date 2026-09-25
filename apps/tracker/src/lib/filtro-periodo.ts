// Período que el socio eligió a mano, namespaced por socio (localStorage).
// Se limpia en cerrarSesion() en auth-client.ts.

type AlmacenamientoClaveValor = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type FiltroPeriodoPersistido = { periodo: string; anio: number };

export const TODO_EL_TIEMPO = "todo";

const PREFIJO_CLAVE = "tracker:filtro-periodo:v1:";

function claveDe(identificadorSocio: string): string {
	return `${PREFIJO_CLAVE}${identificadorSocio}`;
}

function almacenamiento(): AlmacenamientoClaveValor | null {
	try {
		if (typeof window === "undefined" || !window.localStorage) return null;
		return window.localStorage;
	} catch {
		return null;
	}
}

function esPeriodoValido(periodo: string): boolean {
	if (periodo === TODO_EL_TIEMPO) return true;
	const mes = Number(periodo);
	return Number.isInteger(mes) && mes >= 1 && mes <= 12;
}

function esFiltroPeriodoValido(valor: unknown): valor is FiltroPeriodoPersistido {
	if (typeof valor !== "object" || valor === null) return false;
	const { periodo, anio } = valor as FiltroPeriodoPersistido;
	return (
		typeof periodo === "string" &&
		esPeriodoValido(periodo) &&
		typeof anio === "number" &&
		Number.isInteger(anio)
	);
}

export function leerFiltroPeriodo(
	identificadorSocio: string | null,
	storage: AlmacenamientoClaveValor | null = almacenamiento(),
): FiltroPeriodoPersistido | null {
	if (!identificadorSocio || !storage) return null;
	try {
		const crudo = storage.getItem(claveDe(identificadorSocio));
		if (!crudo) return null;
		const parseado = JSON.parse(crudo);
		return esFiltroPeriodoValido(parseado) ? parseado : null;
	} catch {
		return null;
	}
}

export function guardarFiltroPeriodo(
	identificadorSocio: string | null,
	filtro: FiltroPeriodoPersistido,
	storage: AlmacenamientoClaveValor | null = almacenamiento(),
): void {
	if (!identificadorSocio || !storage) return;
	try {
		storage.setItem(claveDe(identificadorSocio), JSON.stringify(filtro));
	} catch {
		// Cuota llena o modo privado: el filtro simplemente no persiste.
	}
}

export function limpiarFiltroPeriodo(
	identificadorSocio: string | null,
	storage: AlmacenamientoClaveValor | null = almacenamiento(),
): void {
	if (!identificadorSocio || !storage) return;
	try {
		storage.removeItem(claveDe(identificadorSocio));
	} catch {}
}

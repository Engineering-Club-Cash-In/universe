// Recuerda el período (mes/año) que el socio eligió a mano en el listado,
// namespaced por socio para que compartir dispositivo en el predio no filtre
// el filtro de uno al otro. Se limpia en cerrarSesion() (ver auth-client.ts),
// así que el default de "mes en curso" siempre gana tras un logout real; solo
// sobrevive mientras la sesión sigue activa (ej. entrar a un caso y volver).

type AlmacenamientoClaveValor = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type FiltroPeriodoPersistido = { periodo: string; anio: number };

const PREFIJO_CLAVE = "tracker:filtro-periodo:v1:";

function claveDe(identificadorSocio: string): string {
	return `${PREFIJO_CLAVE}${identificadorSocio}`;
}

function almacenamiento(): AlmacenamientoClaveValor | null {
	if (typeof window === "undefined" || !window.localStorage) return null;
	return window.localStorage;
}

function esFiltroPeriodoValido(valor: unknown): valor is FiltroPeriodoPersistido {
	return (
		typeof valor === "object" &&
		valor !== null &&
		typeof (valor as FiltroPeriodoPersistido).periodo === "string" &&
		typeof (valor as FiltroPeriodoPersistido).anio === "number"
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
	} catch {
		// No hay nada razonable que hacer si removeItem falla.
	}
}

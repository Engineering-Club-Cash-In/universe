import { useEffect, useState } from "react";

/**
 * Todo lo que cobros guarda en sessionStorage empieza con "cobros"
 * (`cobros/cartera/*`, `cobros-historial-*`, `cobros-detalle-asesor-*`,
 * `cobros-pagalo-*`, `cobros.mora.*`). Un prefijo único evita que una pantalla
 * nueva quede fuera de la limpieza.
 */
const PREFIJO_COBROS = "cobros";

/**
 * Borra los filtros persistidos de cobros. sessionStorage sobrevive al logout
 * en la misma pestaña, así que el siguiente usuario heredaría los filtros.
 */
export function limpiarFiltrosPersistidos() {
	try {
		const claves: string[] = [];
		for (let i = 0; i < sessionStorage.length; i++) {
			const k = sessionStorage.key(i);
			if (k?.startsWith(PREFIJO_COBROS)) {
				claves.push(k);
			}
		}
		for (const k of claves) sessionStorage.removeItem(k);
	} catch {
		// sessionStorage puede no estar disponible en algunos contextos
	}
}

const CLAVE_DUENO_FILTROS = "cobros/dueno-filtros";

/**
 * Si los filtros guardados son de otro usuario, los limpia. Debe correr antes
 * de los usePersistedState que leen esas claves.
 */
export function asegurarFiltrosDelUsuario(userId: string) {
	try {
		const dueno = sessionStorage.getItem(CLAVE_DUENO_FILTROS);
		if (dueno !== userId) {
			limpiarFiltrosPersistidos();
			sessionStorage.setItem(CLAVE_DUENO_FILTROS, userId);
		}
	} catch {
		// sessionStorage puede no estar disponible en algunos contextos
	}
}

export function usePersistedState<T>(key: string, defaultValue: T) {
	const [state, setState] = useState<T>(() => {
		try {
			const saved = sessionStorage.getItem(key);
			return saved !== null ? (JSON.parse(saved) as T) : defaultValue;
		} catch {
			return defaultValue;
		}
	});

	useEffect(() => {
		try {
			if (state === undefined || state === null) {
				sessionStorage.removeItem(key);
			} else {
				sessionStorage.setItem(key, JSON.stringify(state));
			}
		} catch {
			// sessionStorage puede no estar disponible en algunos contextos
		}
	}, [key, state]);

	return [state, setState] as const;
}

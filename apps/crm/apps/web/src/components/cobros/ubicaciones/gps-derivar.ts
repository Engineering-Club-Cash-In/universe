import type { client } from "@/utils/orpc";

/**
 * Qué muestra la pestaña GPS / Wialon sin consultar de nuevo: la última
 * ubicación registrada, un aviso si la consulta más reciente no trajo
 * ubicación (sin unidad vinculada, Wialon caído) y el resto como consultas
 * anteriores. Puro (sin React) para poder probarlo.
 *
 * Cada consulta guarda en `gps_consulta_logs.snapshot` lo que respondió Wialon
 * (CB-118, 0070), así que la última ubicación sale del historial: no hace
 * falta otra consulta auditada para verla.
 */

export type ConsultaGps = Awaited<
	ReturnType<typeof client.getGpsConsultasCaso>
>[number];
export type GpsVehiculoOutput = Awaited<
	ReturnType<typeof client.getGpsVehiculo>
>;
export type GpsVinculado = Extract<GpsVehiculoOutput, { estado: "vinculado" }>;
export type GpsSinVinculo = Extract<
	GpsVehiculoOutput,
	{ estado: "sin_vinculo" }
>;
export type GpsNoDisponible = Extract<
	GpsVehiculoOutput,
	{ estado: "no_disponible" }
>;

/** La consulta de esta sesión (la que el asesor acaba de pedir). */
export type EnVivoGps =
	| { estado: "cargando"; motivo: string }
	| { estado: "listo"; motivo: string; datos: GpsVehiculoOutput; at: Date }
	| { estado: "error"; motivo: string; mensaje: string };

export type UbicacionGps =
	| { tipo: "en-vivo"; datos: GpsVinculado; motivo: string; at: Date }
	| {
			tipo: "historial";
			entrada: ConsultaGps & { snapshot: GpsVinculado };
			/** Es la consulta de esta sesión, ya leída del historial. */
			esEnVivo: boolean;
	  };

export type AvisoGps =
	| {
			tipo: "en-vivo";
			datos: GpsSinVinculo | GpsNoDisponible | null;
			/** Solo si la petición falló (sin respuesta del servidor). */
			mensaje?: string;
			motivo: string;
			at: Date | null;
	  }
	| {
			tipo: "historial";
			entrada: ConsultaGps & { snapshot: GpsSinVinculo | GpsNoDisponible };
			esEnVivo: boolean;
	  };

export type VistaGps = {
	/** La consulta de esta sesión está en curso. */
	cargandoEnVivo: boolean;
	ubicacion: UbicacionGps | null;
	aviso: AvisoGps | null;
	anteriores: ConsultaGps[];
};

// Las consultas de ubicaciones clave también quedan en la bitácora, pero no
// traen telemetría: no cuentan como «la última ubicación».
const esTelemetria = (e: ConsultaGps) => e.origen !== "ubicaciones_clave";

function conUbicacion(
	e: ConsultaGps,
): e is ConsultaGps & { snapshot: GpsVinculado } {
	return e.snapshot?.estado === "vinculado";
}

function sinUbicacion(
	e: ConsultaGps,
): e is ConsultaGps & { snapshot: GpsSinVinculo | GpsNoDisponible } {
	return (
		e.snapshot?.estado === "sin_vinculo" ||
		e.snapshot?.estado === "no_disponible"
	);
}

export function derivarVistaGps({
	entradas,
	enVivo,
	historialActualizado,
}: {
	/** Historial agrupado, la más reciente primero (getGpsConsultasCaso). */
	entradas: ConsultaGps[];
	enVivo: EnVivoGps | null;
	/**
	 * El historial se volvió a leer DESPUÉS de que respondió la consulta de
	 * esta sesión: su fila ya está ahí y se usa esa (trae el agrupado).
	 */
	historialActualizado: boolean;
}): VistaGps {
	const telemetria = entradas.filter(esTelemetria);
	const ultimaConUbicacion = telemetria.find(conUbicacion) ?? null;

	// La fila de la consulta de esta sesión, si ya está en el historial. Solo
	// si quedó registrada (auditada): una consulta rechazada no deja fila.
	const filaEnVivo =
		enVivo?.estado === "listo" && enVivo.datos.auditada && historialActualizado
			? (telemetria.find((e) => e.origen === "telemetria") ?? null)
			: null;

	if (enVivo && !filaEnVivo) {
		if (enVivo.estado === "cargando") {
			return {
				cargandoEnVivo: true,
				ubicacion: null,
				aviso: null,
				anteriores: entradas,
			};
		}
		if (enVivo.estado === "listo" && enVivo.datos.estado === "vinculado") {
			return {
				cargandoEnVivo: false,
				ubicacion: {
					tipo: "en-vivo",
					datos: enVivo.datos,
					motivo: enVivo.motivo,
					at: enVivo.at,
				},
				aviso: null,
				anteriores: entradas,
			};
		}
		// La consulta de ahora no trajo ubicación: se avisa y debajo queda la
		// última ubicación conocida del historial.
		return {
			cargandoEnVivo: false,
			aviso:
				enVivo.estado === "listo"
					? {
							tipo: "en-vivo",
							datos: enVivo.datos as GpsSinVinculo | GpsNoDisponible,
							motivo: enVivo.motivo,
							at: enVivo.at,
						}
					: {
							tipo: "en-vivo",
							datos: null,
							mensaje: enVivo.mensaje,
							motivo: enVivo.motivo,
							at: null,
						},
			ubicacion: ultimaConUbicacion
				? { tipo: "historial", entrada: ultimaConUbicacion, esEnVivo: false }
				: null,
			anteriores: entradas.filter((e) => e !== ultimaConUbicacion),
		};
	}

	// Desde el historial. Si la consulta más reciente no trajo ubicación (y es
	// posterior a la última que sí), va como aviso arriba de la ubicación.
	const masReciente = telemetria[0] ?? null;
	const avisoEntrada =
		masReciente &&
		masReciente !== ultimaConUbicacion &&
		sinUbicacion(masReciente)
			? masReciente
			: null;

	return {
		cargandoEnVivo: false,
		ubicacion: ultimaConUbicacion
			? {
					tipo: "historial",
					entrada: ultimaConUbicacion,
					esEnVivo: ultimaConUbicacion === filaEnVivo,
				}
			: null,
		aviso: avisoEntrada
			? {
					tipo: "historial",
					entrada: avisoEntrada,
					esEnVivo: avisoEntrada === filaEnVivo,
				}
			: null,
		anteriores: entradas.filter(
			(e) => e !== ultimaConUbicacion && e !== avisoEntrada,
		),
	};
}

/** La consulta tiene una ubicación que se puede ver en el mapa. */
export const tieneUbicacion = conUbicacion;

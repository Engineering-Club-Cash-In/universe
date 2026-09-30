import { useMutation } from "@tanstack/react-query";
import { Loader2, MapPin, Navigation } from "lucide-react";
import { useEffect, useRef } from "react";
import {
	advertenciaEnMarcha,
	type UbicacionInmovilizacion,
} from "server/src/lib/inmovilizacion-unidad";
import { Button } from "@/components/ui/button";
import {
	formatUltimaSenal,
	googleMapsUrl,
	resolveEstadoSenal,
} from "@/routes/cobros/-gps-ficha";
import { orpc } from "@/utils/orpc";
import { GpsMapaPreview } from "./gps-mapa-preview";

export type MomentoUbicacion = "solicitud" | "ejecucion";

/**
 * CB-041 — Consulta la ubicación del vehículo a inmovilizar en Wialon, una vez
 * al montar el modal (los modales se montan solo al abrirse). Cada consulta
 * queda auditada en el server; `actualizar` hace otra. `mutate` y no un
 * `useQuery`: cada llamada deja una fila de auditoría, así que no debe
 * repetirse sola (foco de la ventana, reconexión, remontado).
 */
export function useUbicacionInmovilizacion(
	casoCobroId: string,
	momento: MomentoUbicacion,
	/** Falso = no consultar (la reactivación no pide ubicación). */
	habilitado = true,
) {
	const consulta = useMutation(
		orpc.getUbicacionInmovilizacion.mutationOptions(),
	);
	const { mutate } = consulta;
	// Un remontado en desarrollo (StrictMode) no debe duplicar la consulta.
	const pedidaRef = useRef(false);
	useEffect(() => {
		if (!habilitado || pedidaRef.current) return;
		pedidaRef.current = true;
		mutate({ casoCobroId, momento });
	}, [habilitado, mutate, casoCobroId, momento]);

	return {
		resultado: consulta.data ?? null,
		cargando: consulta.isPending,
		errorRed: consulta.error?.message ?? null,
		actualizar: () => mutate({ casoCobroId, momento }),
	};
}

export type UbicacionConsultada = ReturnType<
	typeof useUbicacionInmovilizacion
>["resultado"];

/** La posición GPS en una línea: unidad, coordenadas, qué tan vieja es y el mapa. */
function LineaGps({
	ubicacion,
	conMapa = false,
	historico = false,
}: {
	ubicacion: UbicacionInmovilizacion;
	/** Mapa chico debajo de la línea, para ver dónde está sin salir de la ficha. */
	conMapa?: boolean;
	/**
	 * Ubicación ya guardada en el historial: la señal se muestra con su fecha y
	 * hora (un "hace 2 horas" relativo a hoy engaña) y no se advierte que es vieja.
	 */
	historico?: boolean;
}) {
	const mapa = googleMapsUrl(
		ubicacion.lat ?? undefined,
		ubicacion.lng ?? undefined,
	);
	const vieja = !historico && resolveEstadoSenal(ubicacion.senalAt) === "vieja";
	const enMarcha = advertenciaEnMarcha(ubicacion);
	return (
		<div className="space-y-1">
			<p className="flex flex-wrap items-center gap-1.5 text-muted-foreground text-xs">
				<MapPin className="h-3.5 w-3.5 text-emerald-600" />
				GPS{ubicacion.unidad ? ` · ${ubicacion.unidad}` : ""}
				{ubicacion.lat != null && ubicacion.lng != null
					? ` · ${ubicacion.lat.toFixed(5)}, ${ubicacion.lng.toFixed(5)}`
					: ""}{" "}
				·{" "}
				{historico && ubicacion.senalAt
					? `señal del ${new Date(ubicacion.senalAt).toLocaleString("es-GT", { timeZone: "America/Guatemala", dateStyle: "short", timeStyle: "short" })}`
					: formatUltimaSenal(ubicacion.senalAt).toLowerCase()}
				{mapa && (
					<a
						className="ml-1 text-primary hover:underline"
						href={mapa}
						rel="noreferrer"
						target="_blank"
					>
						Ver en mapa
					</a>
				)}
			</p>
			{vieja && (
				<p className="text-amber-700 text-xs dark:text-amber-400">
					Ojo: la última posición es de{" "}
					{formatUltimaSenal(ubicacion.senalAt).toLowerCase()}; puede que el
					vehículo ya no esté ahí.
				</p>
			)}
			{enMarcha && (
				<p className="text-amber-700 text-xs dark:text-amber-400">{enMarcha}</p>
			)}
			{conMapa && (
				<GpsMapaPreview
					className="h-36"
					latitude={ubicacion.lat ?? undefined}
					longitude={ubicacion.lng ?? undefined}
				/>
			)}
		</div>
	);
}

/**
 * Bloque "dónde está el vehículo" de los modales de solicitud y ejecución: el
 * estado de la consulta a Wialon y el botón para repetirla. Los campos
 * manuales (dirección, enlace) los pone quien lo usa.
 */
export function UbicacionGpsBloque({
	titulo,
	resultado,
	cargando,
	errorRed,
	onActualizar,
}: {
	titulo: string;
	resultado: UbicacionConsultada;
	cargando: boolean;
	errorRed: string | null;
	onActualizar: () => void;
}) {
	const gps =
		resultado?.ubicacion?.fuente === "gps" ? resultado.ubicacion : null;
	const mensaje = errorRed ?? (resultado && !gps ? resultado.mensaje : null);
	return (
		<div className="space-y-1.5">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 className="font-medium text-sm">{titulo}</h3>
				<Button
					disabled={cargando}
					onClick={onActualizar}
					size="sm"
					type="button"
					variant="outline"
				>
					{cargando ? (
						<Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
					) : (
						<Navigation className="mr-1.5 h-3.5 w-3.5" />
					)}
					{gps ? "Actualizar del GPS" : "Tomar del GPS"}
				</Button>
			</div>
			{cargando && (
				<p className="text-muted-foreground text-xs">
					Consultando la ubicación en Wialon…
				</p>
			)}
			{!cargando && gps && <LineaGps conMapa ubicacion={gps} />}
			{!cargando && mensaje && (
				<p className="text-amber-700 text-xs dark:text-amber-400">{mensaje}</p>
			)}
		</div>
	);
}

/**
 * Ubicación ya guardada en una solicitud o ejecución (solo lectura): la del
 * GPS, la que escribió el asesor, o la constancia de que no hubo.
 */
export function UbicacionGuardada({
	ubicacion,
	etiqueta,
	conMapa = false,
	historico = false,
}: {
	ubicacion: UbicacionInmovilizacion | null | undefined;
	/** Sin etiqueta no se pinta el título (cuando quien lo usa ya lo rotula). */
	etiqueta?: string;
	/** Ver `LineaGps`: para ubicaciones del historial. */
	historico?: boolean;
	/** Con ubicación GPS, agrega el mapa chico. Apagado por defecto: en listas
	    largas (historial, cola) un iframe por fila pesaría mucho. */
	conMapa?: boolean;
}) {
	if (!ubicacion) return null;
	return (
		<div className="space-y-0.5 text-xs">
			{etiqueta && (
				<p className="font-medium text-muted-foreground">{etiqueta}</p>
			)}
			{ubicacion.fuente === "gps" && (
				<LineaGps
					conMapa={conMapa}
					historico={historico}
					ubicacion={ubicacion}
				/>
			)}
			{ubicacion.fuente === "manual" && (
				<p className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
					<MapPin className="h-3.5 w-3.5" />
					{ubicacion.direccion || "Ubicación escrita por el asesor"}
					{ubicacion.enlace && (
						<a
							className="ml-1 text-primary hover:underline"
							href={ubicacion.enlace}
							rel="noreferrer"
							target="_blank"
						>
							Ver enlace
						</a>
					)}
				</p>
			)}
			{ubicacion.fuente === "sin_ubicacion" && (
				<p className="text-amber-700 dark:text-amber-400">
					Sin ubicación GPS{ubicacion.aviso ? `: ${ubicacion.aviso}` : "."}
				</p>
			)}
			{ubicacion.fuente === "manual" && ubicacion.aviso && (
				<p className="text-amber-700 dark:text-amber-400">
					El GPS no respondió: {ubicacion.aviso}
				</p>
			)}
		</div>
	);
}

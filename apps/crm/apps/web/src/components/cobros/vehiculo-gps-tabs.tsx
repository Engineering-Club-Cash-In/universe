import { useQuery } from "@tanstack/react-query";
import { Bell, LockOpen, MapPin, MapPinCheck, MapPinned } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import {
	GpsEventosHistorial,
	useEventosGpsCaso,
} from "@/components/cobros/gps-eventos-historial";
import { GpsUbicacionesClaveCard } from "@/components/cobros/gps-ubicaciones-clave-card";
import { GpsVehiculoCard } from "@/components/cobros/gps-vehiculo-card";
import { InmovilizacionCard } from "@/components/cobros/inmovilizacion-card";
import { CrmCard, CrmPill } from "@/components/ds/cards-credito";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { orpc } from "@/utils/orpc";

export type PestanaUbicacion =
	| "gps"
	| "ubicaciones"
	| "visitas"
	| "notificaciones"
	| "inmovilizacion";

const trigger = "h-10 px-3 text-[13px]";
// Las pestañas quedan montadas (forceMount) y solo se ocultan.
const contenido = "data-[state=inactive]:hidden";

/**
 * Marco de las pestañas de Ubicaciones (solo presentación): una tarjeta con
 * la barra de pestañas arriba y el contenido debajo. Todas comparten estilo y
 * espaciado. GPS y Ubicaciones frecuentes solo existen si hay vehículo.
 */
export function PestanasUbicacion({
	value,
	onValueChange,
	gps,
	frecuentes,
	visitas,
	notificaciones,
	apagado,
	conteoNotificaciones,
}: {
	value: PestanaUbicacion;
	onValueChange: (value: PestanaUbicacion) => void;
	gps?: ReactNode;
	frecuentes?: ReactNode;
	visitas: ReactNode;
	notificaciones: ReactNode;
	apagado: ReactNode;
	conteoNotificaciones?: number;
}) {
	return (
		<CrmCard className="gap-0 p-0" superficie="outline">
			<Tabs
				className="gap-0"
				onValueChange={(v) => onValueChange(v as PestanaUbicacion)}
				value={value}
			>
				<TabsList className="overflow-x-auto px-2 [scrollbar-width:none] sm:px-3 [&::-webkit-scrollbar]:hidden">
					{gps ? (
						<TabsTrigger className={trigger} value="gps">
							<MapPin />
							GPS / Wialon
						</TabsTrigger>
					) : null}
					{frecuentes ? (
						<TabsTrigger className={trigger} value="ubicaciones">
							<MapPinned />
							Ubicaciones frecuentes
						</TabsTrigger>
					) : null}
					<TabsTrigger className={trigger} value="visitas">
						<MapPinCheck />
						Visitas
					</TabsTrigger>
					<TabsTrigger
						className={trigger}
						count={conteoNotificaciones || undefined}
						value="notificaciones"
					>
						<Bell />
						Notificaciones
					</TabsTrigger>
					<TabsTrigger className={trigger} value="inmovilizacion">
						<LockOpen />
						Apagado y reactivación
					</TabsTrigger>
				</TabsList>
				<div className="p-4 sm:p-5">
					{gps ? (
						<TabsContent className={contenido} forceMount value="gps">
							{gps}
						</TabsContent>
					) : null}
					{frecuentes ? (
						<TabsContent className={contenido} forceMount value="ubicaciones">
							{frecuentes}
						</TabsContent>
					) : null}
					<TabsContent className={contenido} forceMount value="visitas">
						{visitas}
					</TabsContent>
					<TabsContent className={contenido} forceMount value="notificaciones">
						{notificaciones}
					</TabsContent>
					<TabsContent className={contenido} forceMount value="inmovilizacion">
						{apagado}
					</TabsContent>
				</div>
			</Tabs>
		</CrmCard>
	);
}

/**
 * Estado del GPS de la unidad para la cabecera del vehículo. Sale de
 * getInmovilizacionesCaso (`tieneGps` = unidad Wialon guardada en el
 * vehículo): no consulta Wialon ni audita. Misma clave y opciones que la
 * pestaña de apagado, así que React Query hace una sola petición.
 */
export function EstadoGpsUnidad({ casoCobroId }: { casoCobroId: string }) {
	const inmov = useQuery({
		...orpc.getInmovilizacionesCaso.queryOptions({ input: { casoCobroId } }),
		staleTime: 30_000,
		refetchOnWindowFocus: false,
	});
	if (!inmov.data) return null;
	if (inmov.data.estadoUnidad === "inmovilizada") {
		return (
			<CrmPill kind="chip" tone="danger">
				Unidad apagada
			</CrmPill>
		);
	}
	return inmov.data.tieneGps ? (
		<CrmPill kind="chip" tone="success">
			GPS vinculado
		</CrmPill>
	) : (
		<CrmPill kind="chip" tone="warning">
			Sin GPS vinculado
		</CrmPill>
	);
}

/**
 * Las herramientas de ubicación del caso en una sola tarjeta con pestañas:
 * GPS / Wialon, ubicaciones frecuentes, visitas (antes «Ubicaciones
 * verificadas»), notificaciones GPS y apagado/reactivación.
 *
 * Las pestañas quedan montadas (forceMount) y solo se ocultan: la consulta en
 * vivo de GPS y de ubicaciones descarta su respuesta al desmontar (gcTime 0),
 * así que desmontar al cambiar de pestaña obligaría a consultar otra vez.
 */
export function VehiculoGpsTabs({
	bucketNumero,
	casoCobroId,
	esSupervisor,
	onRegistrarLlamada,
	convenioBloqueo,
	onCrearConvenio,
	onReactivacionReabierta,
	onRegistrarPromesa,
	pestanaInicial,
	abrirInmovilizacion = false,
	onInmovilizacionAbierta,
	reabrirReactivacion,
	vehicleId,
	visitas,
}: {
	bucketNumero: number | null;
	casoCobroId: string;
	esSupervisor: boolean;
	onRegistrarLlamada: (
		inmovilizacionId: string,
		accion: "apagado" | "reactivacion",
	) => void;
	onRegistrarPromesa: () => void;
	onCrearConvenio: () => void;
	/** Por qué hoy no se puede crear un convenio; null si se puede. */
	convenioBloqueo: string | null;
	/** Señal para volver a abrir "Solicitar reactivación" tras crear la promesa. */
	reabrirReactivacion: boolean;
	onReactivacionReabierta: () => void;
	/** Pestaña con la que abre (deep link de una notificación). */
	pestanaInicial?: "inmovilizacion";
	/**
	 * Señal de un solo uso: abre la pestaña de apagado/reactivación y avisa con
	 * `onInmovilizacionAbierta` para que el padre la apague. Es una señal y no un
	 * `key` para no desmontar las pestañas de GPS (perderían la consulta en vivo).
	 */
	abrirInmovilizacion?: boolean;
	onInmovilizacionAbierta?: () => void;
	// GPS y ubicaciones requieren vehículo; visitas, notificaciones e
	// inmovilización solo el caso (el servidor resuelve la unidad, CB-041).
	vehicleId: string | null;
	/** Contenido de la pestaña Visitas (lo arma la ficha: tiene las visitas). */
	visitas: ReactNode;
}) {
	// Controlada: un deep link que llega con el caso ya abierto también cambia de pestaña.
	const [pestana, setPestana] = useState<PestanaUbicacion>(
		pestanaInicial ?? (vehicleId ? "gps" : "visitas"),
	);
	useEffect(() => {
		if (pestanaInicial) setPestana(pestanaInicial);
	}, [pestanaInicial]);
	useEffect(() => {
		if (!abrirInmovilizacion) return;
		setPestana("inmovilizacion");
		onInmovilizacionAbierta?.();
	}, [abrirInmovilizacion, onInmovilizacionAbierta]);

	const eventos = useEventosGpsCaso(casoCobroId);

	return (
		<PestanasUbicacion
			apagado={
				<InmovilizacionCard
					bucketNumero={bucketNumero}
					casoCobroId={casoCobroId}
					convenioBloqueo={convenioBloqueo}
					embedded
					esSupervisor={esSupervisor}
					onCrearConvenio={onCrearConvenio}
					onReactivacionReabierta={onReactivacionReabierta}
					onRegistrarLlamada={onRegistrarLlamada}
					onRegistrarPromesa={onRegistrarPromesa}
					reabrirReactivacion={reabrirReactivacion}
				/>
			}
			conteoNotificaciones={eventos.data?.length}
			frecuentes={
				vehicleId ? (
					<GpsUbicacionesClaveCard
						activo={pestana === "ubicaciones"}
						casoCobroId={casoCobroId}
						embedded
						vehicleId={vehicleId}
					/>
				) : undefined
			}
			gps={
				vehicleId ? (
					<GpsVehiculoCard
						activo={pestana === "gps"}
						casoCobroId={casoCobroId}
						embedded
						esSupervisor={esSupervisor}
						vehicleId={vehicleId}
					/>
				) : undefined
			}
			notificaciones={
				<GpsEventosHistorial casoCobroId={casoCobroId} embedded />
			}
			onValueChange={setPestana}
			value={pestana}
			visitas={visitas}
		/>
	);
}

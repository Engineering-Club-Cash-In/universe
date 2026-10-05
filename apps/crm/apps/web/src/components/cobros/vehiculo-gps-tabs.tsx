import { Bell, LockOpen, MapPin, MapPinned } from "lucide-react";
import { useEffect, useState } from "react";
import { GpsEventosHistorial } from "@/components/cobros/gps-eventos-historial";
import { GpsUbicacionesClaveCard } from "@/components/cobros/gps-ubicaciones-clave-card";
import { GpsVehiculoCard } from "@/components/cobros/gps-vehiculo-card";
import { InmovilizacionCard } from "@/components/cobros/inmovilizacion-card";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Una sola tarjeta con las herramientas de la unidad en pestañas: GPS /
 * Wialon, ubicaciones frecuentes, notificaciones GPS e inmovilización.
 *
 * Las pestañas quedan montadas (forceMount) y solo se ocultan: GPS y
 * ubicaciones exigen un motivo auditado y descartan la respuesta al
 * desmontar (gcTime 0), así que desmontar al cambiar de pestaña obligaría
 * a confirmar el motivo otra vez y registrar otra consulta.
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
	 * `key` para no desmontar las pestañas de GPS (perderían el motivo auditado).
	 */
	abrirInmovilizacion?: boolean;
	onInmovilizacionAbierta?: () => void;
	// GPS y ubicaciones requieren vehículo; notificaciones e inmovilización
	// solo el caso (el servidor resuelve la unidad, CB-041).
	vehicleId: string | null;
}) {
	const contenido = "mt-4 data-[state=inactive]:hidden";
	// Controlada: un deep link que llega con el caso ya abierto también cambia de pestaña.
	const [pestana, setPestana] = useState(
		pestanaInicial ?? (vehicleId ? "gps" : "notificaciones"),
	);
	useEffect(() => {
		if (pestanaInicial) setPestana(pestanaInicial);
	}, [pestanaInicial]);
	useEffect(() => {
		if (!abrirInmovilizacion) return;
		setPestana("inmovilizacion");
		onInmovilizacionAbierta?.();
	}, [abrirInmovilizacion, onInmovilizacionAbierta]);

	return (
		<Card>
			<CardContent>
				<Tabs onValueChange={setPestana} value={pestana}>
					<TabsList className="h-auto max-w-full flex-wrap justify-start">
						{vehicleId && (
							<TabsTrigger value="gps">
								<MapPin />
								GPS / Wialon
							</TabsTrigger>
						)}
						{vehicleId && (
							<TabsTrigger value="ubicaciones">
								<MapPinned />
								Ubicaciones frecuentes
							</TabsTrigger>
						)}
						<TabsTrigger value="notificaciones">
							<Bell />
							Notificaciones
						</TabsTrigger>
						<TabsTrigger value="inmovilizacion">
							<LockOpen />
							Apagado y reactivación
						</TabsTrigger>
					</TabsList>

					{vehicleId && (
						<TabsContent className={contenido} forceMount value="gps">
							<GpsVehiculoCard
								casoCobroId={casoCobroId}
								embedded
								esSupervisor={esSupervisor}
								vehicleId={vehicleId}
							/>
						</TabsContent>
					)}
					{vehicleId && (
						<TabsContent className={contenido} forceMount value="ubicaciones">
							<GpsUbicacionesClaveCard
								casoCobroId={casoCobroId}
								embedded
								vehicleId={vehicleId}
							/>
						</TabsContent>
					)}
					<TabsContent className={contenido} forceMount value="notificaciones">
						<GpsEventosHistorial casoCobroId={casoCobroId} embedded />
					</TabsContent>
					<TabsContent className={contenido} forceMount value="inmovilizacion">
						<InmovilizacionCard
							bucketNumero={bucketNumero}
							casoCobroId={casoCobroId}
							embedded
							esSupervisor={esSupervisor}
							onRegistrarLlamada={onRegistrarLlamada}
							convenioBloqueo={convenioBloqueo}
							onCrearConvenio={onCrearConvenio}
							onReactivacionReabierta={onReactivacionReabierta}
							onRegistrarPromesa={onRegistrarPromesa}
							reabrirReactivacion={reabrirReactivacion}
						/>
					</TabsContent>
				</Tabs>
			</CardContent>
		</Card>
	);
}

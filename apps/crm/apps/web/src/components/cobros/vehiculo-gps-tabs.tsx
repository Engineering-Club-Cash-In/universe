import { Bell, LockOpen, MapPin, MapPinned } from "lucide-react";
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
	vehicleId,
}: {
	bucketNumero: number | null;
	casoCobroId: string;
	esSupervisor: boolean;
	onRegistrarLlamada: (
		inmovilizacionId: string,
		accion: "apagado" | "reactivacion",
	) => void;
	// GPS y ubicaciones requieren vehículo; notificaciones e inmovilización
	// solo el caso (el servidor resuelve la unidad, CB-041).
	vehicleId: string | null;
}) {
	const contenido = "mt-4 data-[state=inactive]:hidden";

	return (
		<Card>
			<CardContent>
				<Tabs defaultValue={vehicleId ? "gps" : "notificaciones"}>
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
							Inmovilizar / Reactivar
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
						/>
					</TabsContent>
				</Tabs>
			</CardContent>
		</Card>
	);
}

import { skipToken, useQuery } from "@tanstack/react-query";
import { Briefcase, Home, Loader2, MapPin, Repeat } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatFechaSenal, googleMapsUrl } from "@/routes/cobros/-gps-ficha";
import { orpc } from "@/utils/orpc";

const MOTIVO_MIN_LENGTH = 5;

type TipoUbicacionClave =
	| "probable_casa"
	| "probable_trabajo"
	| "recurrente"
	| "frecuente";

const TIPO_CONFIG: Record<
	TipoUbicacionClave,
	{ label: string; icon: typeof Home; badgeClass: string }
> = {
	probable_casa: {
		label: "Probable casa",
		icon: Home,
		badgeClass:
			"bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
	},
	probable_trabajo: {
		label: "Probable trabajo",
		icon: Briefcase,
		badgeClass:
			"bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
	},
	recurrente: {
		label: "Lugar recurrente",
		icon: Repeat,
		badgeClass:
			"bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
	},
	frecuente: {
		label: "Visitado con frecuencia",
		icon: MapPin,
		badgeClass: "bg-muted text-muted-foreground",
	},
};

// Días de la semana en el orden que devuelve patron.visitasPorDiaSemana
// (0=domingo..6=sábado, mismo criterio que Date.getUTCDay en el servidor).
const DIAS_SEMANA = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

function describirPatron(patron: unknown): string | null {
	if (!patron || typeof patron !== "object") return null;
	const p = patron as {
		nocturna?: number;
		laboral?: number;
		finDeSemana?: number;
		visitasPorDiaSemana?: number[];
	};

	if (Array.isArray(p.visitasPorDiaSemana)) {
		const max = Math.max(...p.visitasPorDiaSemana);
		const total = p.visitasPorDiaSemana.reduce((a, b) => a + b, 0);
		if (total > 0 && max / total >= 0.6) {
			const dia = p.visitasPorDiaSemana.indexOf(max);
			return `Sobre todo los ${DIAS_SEMANA[dia]}`;
		}
	}

	const total = (p.nocturna ?? 0) + (p.laboral ?? 0) + (p.finDeSemana ?? 0);
	if (total === 0) return null;
	if ((p.nocturna ?? 0) / total >= 0.6) return "Sobre todo de noche";
	if ((p.laboral ?? 0) / total >= 0.6) return "Sobre todo en horario laboral";
	if ((p.finDeSemana ?? 0) / total >= 0.6) return "Sobre todo fin de semana";
	return null;
}

/**
 * Tarjeta de "ubicaciones clave" en el tab Vehículo de la Ficha 360 (CB-119,
 * D-15): casa, trabajo y lugares recurrentes del vehículo, calculados por el
 * job nocturno contra el historial de Wialon de los últimos 60 días.
 *
 * Mismo gate de motivo auditado que GpsVehiculoCard (CB-118): esto revela
 * dónde vive/trabaja el cliente, así que exige el mismo criterio que la
 * ubicación en vivo — no se muestra nada hasta que el asesor escribe por qué
 * lo necesita, y cada consulta queda en gps_consulta_logs.
 */
export function GpsUbicacionesClaveCard({
	casoCobroId,
	vehicleId,
}: {
	casoCobroId: string;
	vehicleId: string;
}) {
	const [motivo, setMotivo] = useState("");
	const [motivoConfirmado, setMotivoConfirmado] = useState<string | null>(null);

	const ubicaciones = useQuery({
		...orpc.getUbicacionesClaveCaso.queryOptions({
			input:
				motivoConfirmado == null
					? skipToken
					: { casoCobroId, vehicleId, motivo: motivoConfirmado },
		}),
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: 0,
		meta: { auditada: true },
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		refetchOnMount: false,
		retry: false,
	});

	const motivoValido = motivo.trim().length >= MOTIVO_MIN_LENGTH;

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<MapPin className="h-5 w-5" />
					Ubicaciones clave
				</CardTitle>
				<CardDescription>
					Lugares donde el vehículo pasa más tiempo (casa, trabajo, lugares
					recurrentes), calculados automáticamente contra los últimos 60 días de
					historial GPS. Orienta la búsqueda si el vehículo hay que recuperarlo.
				</CardDescription>
			</CardHeader>
			<CardContent>
				{motivoConfirmado == null ? (
					<form
						className="space-y-3"
						onSubmit={(e) => {
							e.preventDefault();
							if (motivoValido) setMotivoConfirmado(motivo.trim());
						}}
					>
						<p className="text-muted-foreground text-sm">
							Esta información revela dónde vive o trabaja el cliente. Cada
							consulta queda registrada con su motivo.
						</p>
						<div>
							<Label htmlFor={`motivo-ubicaciones-${vehicleId}`}>Motivo</Label>
							<Input
								id={`motivo-ubicaciones-${vehicleId}`}
								onChange={(e) => setMotivo(e.target.value)}
								placeholder="Ej: Crédito en B4, preparar visita de recuperación"
								value={motivo}
							/>
						</div>
						<Button disabled={!motivoValido} type="submit">
							<MapPin className="mr-2 h-4 w-4" />
							Ver ubicaciones clave
						</Button>
					</form>
				) : ubicaciones.isLoading ? (
					<div className="flex justify-center py-4">
						<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
					</div>
				) : ubicaciones.isError ? (
					<p className="text-destructive text-sm">
						No se pudieron cargar las ubicaciones clave:{" "}
						{ubicaciones.error?.message ?? "Error inesperado"}
					</p>
				) : ubicaciones.data?.auditada === false ? (
					<p className="text-destructive text-sm">
						No se pudo registrar la auditoría de la consulta. Por seguridad no se
						muestran las ubicaciones.
					</p>
				) : ubicaciones.data && ubicaciones.data.ubicaciones.length > 0 ? (
					<ul className="space-y-2">
						{ubicaciones.data.ubicaciones.map((u) => {
							const config = TIPO_CONFIG[u.tipo as TipoUbicacionClave];
							const Icon = config.icon;
							const mapsUrl = googleMapsUrl(u.lat, u.lon);
							const patronTexto = describirPatron(u.patron);
							return (
								<li
									className="flex items-start justify-between gap-3 rounded-md border p-3"
									key={u.id}
								>
									<div className="flex items-start gap-3">
										<Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
										<div>
											<Badge className={config.badgeClass} variant="secondary">
												{config.label}
											</Badge>
											<p className="mt-1 text-muted-foreground text-xs">
												{Math.round(u.horasTotales)} h en total · {u.visitas}{" "}
												visitas en {u.diasDistintos} días
												{patronTexto ? ` · ${patronTexto}` : ""}
											</p>
											<p className="text-muted-foreground text-xs">
												Última vez: {formatFechaSenal(u.ultimaVisita)}
											</p>
										</div>
									</div>
									{mapsUrl && (
										<a
											className="shrink-0 text-primary text-xs hover:underline"
											href={mapsUrl}
											rel="noreferrer"
											target="_blank"
										>
											Ver en mapa
										</a>
									)}
								</li>
							);
						})}
					</ul>
				) : (
					<p className="text-muted-foreground text-sm italic">
						No hay suficientes datos todavía para identificar ubicaciones clave
						de este vehículo.
					</p>
				)}
				{motivoConfirmado != null && (
					<div className="mt-4 flex items-center justify-between border-t pt-3">
						<p className="text-muted-foreground text-xs">
							{ubicaciones.isLoading
								? "Registrando consulta"
								: ubicaciones.data?.auditada
									? "Consulta registrada"
									: "Consulta no registrada"}{" "}
							— motivo: "{motivoConfirmado}"
						</p>
						<Button
							onClick={() => {
								setMotivoConfirmado(null);
								setMotivo("");
							}}
							size="sm"
							variant="ghost"
						>
							Consultar de nuevo
						</Button>
					</div>
				)}
			</CardContent>
		</Card>
	);
}

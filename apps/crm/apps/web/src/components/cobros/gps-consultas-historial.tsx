import { keepPreviousData, skipToken, useQuery } from "@tanstack/react-query";
import { ChevronDown, History, Loader2 } from "lucide-react";
import { useState } from "react";
import { DatosTelemetria } from "@/components/cobros/gps-telemetria-datos";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
	formatFechaSenal,
	MOTIVO_SIN_VINCULO,
} from "@/routes/cobros/-gps-ficha";
import { type client, orpc } from "@/utils/orpc";

type ConsultaGps = Awaited<
	ReturnType<typeof client.getGpsConsultasCaso>
>[number];

const POR_PAGINA = 20;
const MAX_CONSULTAS = 100;

const ORIGEN_LABEL: Record<string, string> = {
	telemetria: "Ubicación actual",
	ubicaciones_clave: "Ubicaciones clave",
};

function DatosDeLaConsulta({ consulta }: { consulta: ConsultaGps }) {
	const snap = consulta.snapshot;
	if (!snap) return null;

	if (snap.estado === "vinculado") {
		return (
			<DatosTelemetria
				// Fecha de ESA consulta: "hace 1 hora" y "Señal con retraso" se
				// miden contra cuando se consultó, no contra hoy.
				consultadaAt={consulta.createdAt}
				telemetria={snap.telemetria}
				unitName={snap.unitName}
			/>
		);
	}
	if (snap.estado === "sin_vinculo") {
		return (
			<p className="text-muted-foreground text-sm italic">
				{MOTIVO_SIN_VINCULO[snap.motivo]}
			</p>
		);
	}
	return (
		<p className="text-muted-foreground text-sm italic">
			Wialon no estaba disponible en esa consulta: {snap.error.message}
		</p>
	);
}

function FilaConsulta({ consulta }: { consulta: ConsultaGps }) {
	const [verDatos, setVerDatos] = useState(false);
	const [verConsultas, setVerConsultas] = useState(false);
	const total = consulta.consultas.length;

	return (
		<li className="rounded-md border p-3">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<Badge variant="secondary">
					{ORIGEN_LABEL[consulta.origen ?? ""] ?? "Consulta GPS"}
				</Badge>
				<span className="text-muted-foreground text-xs">
					{formatFechaSenal(consulta.createdAt)}
				</span>
			</div>
			<p className="mt-1 text-sm">{consulta.motivo}</p>
			<p className="text-muted-foreground text-xs">
				{consulta.userNombre ?? "Usuario desconocido"}
				{consulta.unitName ? ` · ${consulta.unitName}` : ""}
			</p>
			{total > 1 && (
				// Misma ubicación en varias consultas: una sola entrada, con los datos
				// de la más reciente. Las demás siguen registradas y se pueden ver.
				<Collapsible onOpenChange={setVerConsultas} open={verConsultas}>
					<CollapsibleTrigger asChild>
						<Button className="mt-1 -ml-3" size="sm" variant="ghost">
							Consultada {total} veces en esta ubicación
							<ChevronDown
								className={`ml-2 h-4 w-4 transition-transform ${verConsultas ? "rotate-180" : ""}`}
							/>
						</Button>
					</CollapsibleTrigger>
					<CollapsibleContent className="pt-1">
						<ul className="space-y-1 border-l pl-3">
							{consulta.consultas.map((c) => (
								<li className="text-xs" key={c.id}>
									<span className="text-muted-foreground">
										{formatFechaSenal(c.createdAt)} ·{" "}
										{c.userNombre ?? "Usuario desconocido"}
										{" — "}
									</span>
									{c.motivo}
								</li>
							))}
						</ul>
					</CollapsibleContent>
				</Collapsible>
			)}
			{consulta.snapshot && (
				<Collapsible onOpenChange={setVerDatos} open={verDatos}>
					<CollapsibleTrigger asChild>
						<Button className="mt-1 -ml-3" size="sm" variant="ghost">
							{verDatos ? "Ocultar datos" : "Ver datos de esta consulta"}
							<ChevronDown
								className={`ml-2 h-4 w-4 transition-transform ${verDatos ? "rotate-180" : ""}`}
							/>
						</Button>
					</CollapsibleTrigger>
					<CollapsibleContent className="pt-2">
						<DatosDeLaConsulta consulta={consulta} />
					</CollapsibleContent>
				</Collapsible>
			)}
		</li>
	);
}

/**
 * Consultas GPS anteriores de este vehículo (quién, cuándo y con qué motivo),
 * dentro de la carta GPS / Wialon de la Ficha 360.
 *
 * Lee `gps_consulta_logs`. Cada consulta de telemetría guarda lo que respondió
 * Wialon, así que se puede ver sin volver a consultar. Mismo acceso que la
 * consulta en vivo (caso + vehículo + cartera), pero ver una consulta anterior
 * no genera una consulta nueva: por eso no pide motivo ni audita. Se carga al abrir el
 * desplegable, y la carta lo invalida cuando una consulta nueva termina.
 */
export function GpsConsultasHistorial({
	casoCobroId,
	vehicleId,
}: {
	casoCobroId: string;
	vehicleId: string;
}) {
	const [abierto, setAbierto] = useState(false);
	const [limite, setLimite] = useState(POR_PAGINA);

	const consultas = useQuery(
		orpc.getGpsConsultasCaso.queryOptions({
			input: abierto ? { casoCobroId, vehicleId, limit: limite } : skipToken,
			// Al pedir más, se queda la lista actual en pantalla en vez de parpadear.
			placeholderData: keepPreviousData,
		}),
	);

	// El límite cuenta consultas (filas), no entradas: una entrada puede agrupar
	// varias. Para saber si puede haber más se suman las de cada entrada.
	const totalConsultas =
		consultas.data?.reduce((n, e) => n + e.consultas.length, 0) ?? 0;

	return (
		<Collapsible onOpenChange={setAbierto} open={abierto}>
			<CollapsibleTrigger asChild>
				<Button className="-ml-3" size="sm" variant="ghost">
					<History className="mr-2 h-4 w-4" />
					Consultas anteriores
					<ChevronDown
						className={`ml-2 h-4 w-4 transition-transform ${abierto ? "rotate-180" : ""}`}
					/>
				</Button>
			</CollapsibleTrigger>
			<CollapsibleContent className="pt-2">
				{consultas.isLoading ? (
					<div className="flex justify-center py-3">
						<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
					</div>
				) : consultas.isError ? (
					<p className="text-destructive text-sm">
						No se pudo cargar el historial de consultas.
					</p>
				) : consultas.data && consultas.data.length > 0 ? (
					<div className="space-y-2">
						<ul className="space-y-2">
							{consultas.data.map((c) => (
								<FilaConsulta consulta={c} key={c.id} />
							))}
						</ul>
						{/* Si llegó justo al límite pedido, puede haber más. */}
						{totalConsultas >= limite && limite < MAX_CONSULTAS && (
							<Button
								disabled={consultas.isPlaceholderData}
								onClick={() =>
									setLimite((l) => Math.min(l + POR_PAGINA, MAX_CONSULTAS))
								}
								size="sm"
								variant="outline"
							>
								Ver más consultas
							</Button>
						)}
						{totalConsultas >= MAX_CONSULTAS && (
							<p className="text-muted-foreground text-xs">
								Mostrando las {MAX_CONSULTAS} consultas más recientes.
							</p>
						)}
					</div>
				) : (
					<p className="text-muted-foreground text-sm italic">
						Este vehículo todavía no tiene consultas GPS registradas.
					</p>
				)}
			</CollapsibleContent>
		</Collapsible>
	);
}

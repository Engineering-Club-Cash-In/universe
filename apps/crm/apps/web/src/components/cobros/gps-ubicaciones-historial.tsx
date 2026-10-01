import { keepPreviousData, skipToken, useQuery } from "@tanstack/react-query";
import { ChevronDown, History, Loader2 } from "lucide-react";
import { useState } from "react";
import { UbicacionesClaveLista } from "@/components/cobros/gps-ubicaciones-clave-card";
import { Button } from "@/components/ui/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { formatFechaSenal } from "@/routes/cobros/-gps-ficha";
import { type client, orpc } from "@/utils/orpc";

type ConsultaUbicaciones = Awaited<
	ReturnType<typeof client.getUbicacionesConsultasCaso>
>[number];

const POR_PAGINA = 20;
const MAX_CONSULTAS = 100;

function FilaConsulta({ consulta }: { consulta: ConsultaUbicaciones }) {
	const [verDatos, setVerDatos] = useState(false);

	return (
		<li className="rounded-md border p-3">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<span className="text-sm">{consulta.motivo}</span>
				<span className="text-muted-foreground text-xs">
					{formatFechaSenal(consulta.createdAt)}
				</span>
			</div>
			<p className="text-muted-foreground text-xs">
				{consulta.userNombre ?? "Usuario desconocido"}
			</p>
			{consulta.snapshot ? (
				// Resultados tal como se mostraron en esa solicitud, sin volver a
				// consultar. Cerrados hasta que el usuario los pide.
				<Collapsible onOpenChange={setVerDatos} open={verDatos}>
					<CollapsibleTrigger asChild>
						<Button className="mt-1 -ml-3" size="sm" variant="ghost">
							{verDatos ? "Ocultar datos" : "Ver ubicaciones de esta consulta"}
							<ChevronDown
								className={`ml-2 h-4 w-4 transition-transform ${verDatos ? "rotate-180" : ""}`}
							/>
						</Button>
					</CollapsibleTrigger>
					<CollapsibleContent className="pt-2">
						{consulta.snapshot.ubicaciones.length > 0 ? (
							<UbicacionesClaveLista
								ubicaciones={consulta.snapshot.ubicaciones}
							/>
						) : (
							<p className="text-muted-foreground text-sm italic">
								En esa consulta no había ubicaciones clave.
							</p>
						)}
					</CollapsibleContent>
				</Collapsible>
			) : (
				<p className="mt-1 text-muted-foreground text-xs italic">
					Sin datos guardados de esta consulta.
				</p>
			)}
		</li>
	);
}

/**
 * Consultas anteriores de ubicaciones clave de este vehículo (quién, cuándo,
 * con qué motivo y lo que se mostró), para verlas sin volver a pedirlas con un
 * motivo. Ver una consulta anterior no es una consulta nueva: no pide motivo ni
 * audita. Se carga al abrir el desplegable; la consulta en vivo lo invalida al
 * terminar.
 */
export function GpsUbicacionesHistorial({
	casoCobroId,
	vehicleId,
}: {
	casoCobroId: string;
	vehicleId: string;
}) {
	const [abierto, setAbierto] = useState(false);
	const [limite, setLimite] = useState(POR_PAGINA);

	const consultas = useQuery(
		orpc.getUbicacionesConsultasCaso.queryOptions({
			input: abierto ? { casoCobroId, vehicleId, limit: limite } : skipToken,
			placeholderData: keepPreviousData,
		}),
	);

	const total = consultas.data?.length ?? 0;

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
						{total >= limite && limite < MAX_CONSULTAS && (
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
						{total >= MAX_CONSULTAS && (
							<p className="text-muted-foreground text-xs">
								Mostrando las {MAX_CONSULTAS} consultas más recientes.
							</p>
						)}
					</div>
				) : (
					<p className="text-muted-foreground text-sm italic">
						Este vehículo todavía no tiene consultas de ubicaciones registradas.
					</p>
				)}
			</CollapsibleContent>
		</Collapsible>
	);
}

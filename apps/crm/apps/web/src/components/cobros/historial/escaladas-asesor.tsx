import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { orpcAparte } from "@/utils/orpc";

/**
 * «Escaladas» del Historial de actividad del asesor (tarea M3): los casos que
 * escaló con una solicitud a Jurídico o una de recuperación del vehículo
 * (`getEscaladasAsesor`). El apagado del GPS no cuenta como escalar. La fecha
 * es la de la solicitud, con su estado actual.
 */

const TIPO: Record<string, string> = {
	juridico: "Jurídico",
	recuperacion: "Recuperación del vehículo",
};

const ESTADO: Record<string, string> = {
	pendiente: "Pendiente",
	aprobada: "Aprobada",
	aplicada: "Aprobada",
	error_aplicacion: "Aprobada · con error al aplicar",
	rechazada: "Rechazada",
	cancelada: "Cancelada",
	sin_efecto: "Sin efecto",
};

const fecha = (iso: string) =>
	new Date(iso).toLocaleDateString("es-GT", {
		day: "numeric",
		month: "short",
		year: "numeric",
		timeZone: "America/Guatemala",
	});

export function EscaladasAsesor({
	userId,
	desde,
	hasta,
}: {
	/** `user.id` del CRM del asesor. */
	userId: string;
	desde: string;
	hasta: string;
}) {
	const query = useQuery({
		...orpcAparte.getEscaladasAsesor.queryOptions({
			input: { userId, desde, hasta, limite: 100 },
		}),
		staleTime: 60_000,
	});

	if (query.isPending) {
		return (
			<div className="flex items-center justify-center gap-2 py-16 text-fg-secondary text-sm">
				<Loader2 className="size-4 animate-spin" />
				Cargando casos escalados…
			</div>
		);
	}
	if (query.isError) {
		return (
			<EmptyState
				variant="error"
				size="sm"
				title="No se pudieron cargar los casos escalados"
				description="Intente de nuevo en unos segundos."
				action={
					<Button
						variant="outline"
						size="sm"
						onClick={() => void query.refetch()}
					>
						Reintentar
					</Button>
				}
			/>
		);
	}
	const { items, total } = query.data;
	if (items.length === 0) {
		return (
			<EmptyState
				variant="no-data"
				size="sm"
				title="Sin casos escalados"
				description="El asesor no pidió escalar ningún caso a Jurídico ni a recuperación del vehículo en este rango."
			/>
		);
	}
	return (
		<div className="flex flex-col gap-2">
			<div className="overflow-x-auto rounded-xl border border-line-subtle contain-inline-size">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Fecha</TableHead>
							<TableHead>Escaló a</TableHead>
							<TableHead>Crédito</TableHead>
							<TableHead>Cliente</TableHead>
							<TableHead>Estado</TableHead>
							<TableHead>Motivo</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{items.map((i) => (
							<TableRow key={i.id}>
								<TableCell className="text-fg-secondary">
									{fecha(i.fecha)}
								</TableCell>
								<TableCell>{TIPO[i.tipo] ?? i.tipo}</TableCell>
								<TableCell>
									{i.sifco ? (
										<Link
											to="/cobros/$id"
											params={{ id: i.sifco }}
											search={{ tipo: "caso" as const }}
											className="font-medium text-brand hover:underline"
										>
											{i.sifco}
										</Link>
									) : (
										"—"
									)}
								</TableCell>
								<TableCell className="text-fg-secondary">
									{i.cliente ?? "—"}
								</TableCell>
								<TableCell>{ESTADO[i.estado] ?? i.estado}</TableCell>
								<TableCell className="max-w-64 truncate text-fg-secondary">
									{i.motivo ?? "—"}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
			{total > items.length ? (
				<p className="type-caption text-fg-tertiary">
					Se muestran los {items.length} más recientes de {total}.
				</p>
			) : null}
		</div>
	);
}

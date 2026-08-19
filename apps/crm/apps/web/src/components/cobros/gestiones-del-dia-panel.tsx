import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import {
	EncabezadoHistorial,
	FilaHistorial,
} from "@/components/cobros/historial/fila-historial";
import type { RespuestaHistorial } from "@/components/cobros/historial/tipos";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { BucketsCatalogoQueryData } from "@/lib/cobros/buckets-catalogo";
import { useBucketsCatalogo } from "@/lib/cobros/buckets-catalogo";
import { orpc } from "@/utils/orpc";

const PAGE_SIZE = 50;

/**
 * Todas las gestiones que un asesor registró en un día, estuvieran o no en su
 * agenda planificada — complemento de la tarjeta de agenda de
 * `CumplimientoAgendaPanel`, que solo muestra lo PLANIFICADO.
 *
 * Reusa `getHistorialAgendas` (el mismo endpoint del tab "Historial de
 * gestiones") con `marcarEnAgenda` para traer, además, si el crédito de cada
 * fila estaba en el snapshot de agenda de ese asesor ese día.
 */
export function GestionesDelDiaPanel({
	fecha,
	asesorId,
	asesorNombre,
	esSupervisor,
}: {
	fecha: string;
	asesorId: string;
	asesorNombre: string;
	esSupervisor: boolean;
}) {
	const [page, setPage] = useState(1);
	// biome-ignore lint/suspicious/noExplicitAny: contrato manual por TS7056 del router raíz.
	const orpcAny = orpc as any;

	const query = useQuery({
		...orpcAny.getHistorialAgendas.queryOptions({
			input: {
				desde: fecha,
				hasta: fecha,
				usuarioIds: [asesorId],
				// El supervisor está auditando la gestión de una persona: los envíos
				// del sistema no son gestión suya, y por default el backend ya los
				// excluye. Se deja explícito para que el criterio se lea acá.
				incluirAutomaticos: false,
				marcarEnAgenda: { fecha, asesorId },
				page,
				pageSize: PAGE_SIZE,
			},
		}),
		enabled: !!fecha && !!asesorId,
	});
	const datos = query.data as RespuestaHistorial | undefined;
	const items = datos?.items ?? [];
	const totalPaginas = datos?.totalPaginas ?? 1;

	const catalogoQuery = useBucketsCatalogo(true);
	const catalogo = catalogoQuery.data as BucketsCatalogoQueryData | undefined;

	return (
		<Card className="overflow-hidden">
			<div className="border-b px-4 py-3">
				<h2 className="font-semibold">
					Gestiones registradas por {asesorNombre}
				</h2>
				<p className="text-gray-500 text-sm">
					Todas las gestiones que registró ese día, estuvieran o no en su agenda
					planificada.
				</p>
			</div>

			{query.isPending ? (
				<div className="flex items-center gap-2 px-4 py-6 text-gray-500 text-sm">
					<Loader2 className="h-4 w-4 animate-spin" />
					Cargando gestiones…
				</div>
			) : query.isError ? (
				<div className="px-4 py-6 text-red-600 text-sm">
					No se pudieron cargar las gestiones.
				</div>
			) : items.length === 0 ? (
				<div className="px-4 py-6 text-gray-500 text-sm">
					{asesorNombre} no registró gestiones el {fecha}.
				</div>
			) : (
				<>
					<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<thead className="sticky top-0 bg-gray-50 dark:bg-gray-800">
								<EncabezadoHistorial mostrarEnAgenda />
							</thead>
							<tbody>
								{items.map((fila) => (
									<FilaHistorial
										key={fila.id}
										fila={fila}
										catalogo={catalogo}
										esSupervisor={esSupervisor}
										mostrarEnAgenda
									/>
								))}
							</tbody>
						</table>
					</div>
					{totalPaginas > 1 && (
						<div className="flex items-center justify-end gap-3 border-t px-4 py-2 text-sm">
							<Button
								variant="outline"
								size="sm"
								disabled={page <= 1}
								onClick={() => setPage((p) => Math.max(1, p - 1))}
							>
								Anterior
							</Button>
							<span className="text-gray-500">
								Página {page} de {totalPaginas}
							</span>
							<Button
								variant="outline"
								size="sm"
								disabled={page >= totalPaginas}
								onClick={() => setPage((p) => p + 1)}
							>
								Siguiente
							</Button>
						</div>
					)}
				</>
			)}
		</Card>
	);
}

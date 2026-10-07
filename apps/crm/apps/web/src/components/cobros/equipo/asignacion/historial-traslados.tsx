import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { orpc } from "@/utils/orpc";
import { AvatarMini } from "./carga-resumen-vista";
import {
	CeldaFecha,
	EstadoTabla,
	MarcoHistorial,
	PieHistorial,
} from "./marco-historial";

/**
 * «Traslados» del historial de «Mi equipo» › Carga y asignación: las
 * operaciones de traslado masivo (`listarTraslados`, de 20 en 20) con fecha en
 * Guatemala, asesor de origen, cuentas, motivo, usuario y el id de la
 * operación. cartera-back no devuelve el total: la página siguiente existe
 * mientras la actual venga llena.
 */

export type FilaTraslado = {
	id: string;
	created_at: string;
	asesor_origen_id: number;
	cuentas: number;
	motivo: string;
	actor_email: string;
};

const POR_PAGINA = 20;

export type HistorialTrasladosVistaProps = {
	filas: FilaTraslado[] | undefined;
	/** Nombre del asesor de origen (catálogo `getAsesoresTraslados`). */
	nombre: (asesorId: number) => string;
	cargando: boolean;
	error: boolean;
	onReintentar?: () => void;
	pagina: number;
	onPagina: (pagina: number) => void;
	/** Mientras se trae otra página, la paginación se bloquea. */
	recargando?: boolean;
};

export function HistorialTrasladosVista(p: HistorialTrasladosVistaProps) {
	const llena = (p.filas?.length ?? 0) >= POR_PAGINA;
	// Sin total: se ofrecen las páginas vistas y, si esta viene llena, la
	// siguiente (lo mismo que hacían «Anterior» / «Siguiente»).
	const paginas = p.pagina + (llena && !p.error ? 1 : 0);
	return (
		<MarcoHistorial
			pie={
				<PieHistorial
					page={p.pagina}
					pageCount={paginas}
					onPageChange={p.onPagina}
					disabled={p.recargando}
					summary={`Página ${p.pagina}`}
				/>
			}
		>
			{p.cargando || (p.error && !p.filas) ? (
				<EstadoTabla
					estado={p.cargando ? "cargando" : "error"}
					onReintentar={p.onReintentar}
				>
					No se pudieron cargar las operaciones de traslado. Intente de nuevo.
				</EstadoTabla>
			) : !p.filas?.length ? (
				<EstadoTabla estado="vacio">
					Sin operaciones en esta página.
				</EstadoTabla>
			) : (
				<Table>
					<TableHeader>
						<TableRow className="hover:bg-transparent">
							<TableHead>Fecha (Guatemala)</TableHead>
							<TableHead>Origen</TableHead>
							<TableHead className="text-right">Cuentas</TableHead>
							<TableHead>Motivo</TableHead>
							<TableHead>Usuario</TableHead>
							<TableHead>Operación</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{p.filas.map((r) => {
							const nombre = p.nombre(r.asesor_origen_id);
							return (
								<TableRow key={r.id}>
									<TableCell>
										<CeldaFecha valor={r.created_at} />
									</TableCell>
									<TableCell>
										<span className="flex items-center gap-2">
											<AvatarMini nombre={nombre} />
											<span className="font-semibold text-[13px] text-fg leading-[1.26]">
												{nombre}
											</span>
										</span>
									</TableCell>
									<TableCell className="text-right font-bold tabular-nums">
										{r.cuentas.toLocaleString("es-GT")}
									</TableCell>
									<TableCell
										className="max-w-64 truncate text-fg-secondary"
										title={r.motivo}
									>
										{r.motivo}
									</TableCell>
									<TableCell
										className="max-w-48 truncate text-[11px] text-fg-tertiary"
										title={r.actor_email}
									>
										{r.actor_email}
									</TableCell>
									<TableCell className="min-w-56 whitespace-normal break-all font-mono text-[11px] text-fg-tertiary">
										{r.id}
									</TableCell>
								</TableRow>
							);
						})}
					</TableBody>
				</Table>
			)}
		</MarcoHistorial>
	);
}

/** Contenedor: `listarTraslados` paginado y el catálogo para los nombres. */
export function HistorialTrasladosPanel() {
	const [page, setPage] = useState(1);
	const query = useQuery(
		orpc.listarTraslados.queryOptions({ input: { page } }),
	);
	const asesores = useQuery(orpc.getAsesoresTraslados.queryOptions());
	return (
		<HistorialTrasladosVista
			filas={query.data}
			nombre={(id) =>
				asesores.data?.find((a) => a.asesor_id === id)?.nombre ?? String(id)
			}
			cargando={query.isPending}
			error={query.isError}
			onReintentar={() => void query.refetch()}
			pagina={page}
			onPagina={setPage}
			recargando={query.isFetching}
		/>
	);
}

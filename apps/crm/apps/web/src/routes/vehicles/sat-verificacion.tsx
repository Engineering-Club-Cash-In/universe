import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	AlertTriangle,
	CheckCircle2,
	ChevronLeft,
	ChevronRight,
	Clock3,
	RefreshCw,
	Search,
	ShieldCheck,
	XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { orpc } from "@/utils/orpc";

const PAGE_SIZE = 10;
type EstadoSatFiltro = "todos" | "activo" | "inactivo" | "no_encontrado";
type CruceCrmFiltro =
	| "todos"
	| "propio"
	| "registrado_no_propio"
	| "sin_registro";

export const Route = createFileRoute("/vehicles/sat-verificacion")({
	component: SatVerificationPage,
});

function formatDate(value: Date | string | null | undefined) {
	if (!value) return "Sin consultas registradas";
	return new Date(value).toLocaleString("es-GT", {
		dateStyle: "medium",
		timeStyle: "short",
	});
}

function formatRunStatus(status: string | null | undefined) {
	if (status === "en_proceso") return "En proceso";
	if (status === "ok") return "Completado";
	if (status) return "Error";
	return "Sin datos";
}

function EstadoSatBadge({
	estadoSat,
	resultado,
}: {
	estadoSat: string | null;
	resultado: string;
}) {
	if (resultado === "no_aparece_en_sat") {
		return (
			<Badge className="border-red-300 bg-red-100 text-red-800">
				<XCircle /> No se encontró en SAT
			</Badge>
		);
	}
	if (estadoSat?.trim().toLowerCase() === "activo") {
		return (
			<Badge className="border-green-300 bg-green-100 text-green-800">
				<CheckCircle2 /> Activo
			</Badge>
		);
	}
	if (estadoSat?.trim().toLowerCase() === "inactivo") {
		return (
			<Badge className="border-red-300 bg-red-100 text-red-800">
				<XCircle /> Inactivo
			</Badge>
		);
	}
	return (
		<Badge className="border-slate-300 bg-slate-100 text-slate-800">
			{estadoSat || "Sin dato SAT"}
		</Badge>
	);
}

function CruceCrmBadge({ cruce }: { cruce: Exclude<CruceCrmFiltro, "todos"> }) {
	if (cruce === "propio") {
		return (
			<Badge className="border-blue-300 bg-blue-100 text-blue-800">
				<CheckCircle2 /> Propio
			</Badge>
		);
	}
	if (cruce === "registrado_no_propio") {
		return (
			<Badge className="border-amber-300 bg-amber-100 text-amber-800">
				<AlertTriangle /> Registrado, no propio
			</Badge>
		);
	}
	return (
		<Badge className="border-red-300 bg-red-100 text-red-800">
			<XCircle /> Sin registro
		</Badge>
	);
}

function Senal({ valor }: { valor: boolean | null }) {
	if (valor === true) {
		return <span className="font-medium text-green-600">Sí</span>;
	}
	if (valor === false) {
		return <span className="font-medium text-red-600">No</span>;
	}
	return <span className="text-muted-foreground">No disponible</span>;
}

function normalizeSearch(value: string | null | undefined) {
	return (value ?? "")
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.trim();
}

function SatVerificationPage() {
	const [vehicleSearch, setVehicleSearch] = useState("");
	const [estadoSatFiltro, setEstadoSatFiltro] =
		useState<EstadoSatFiltro>("todos");
	const [cruceCrmFiltro, setCruceCrmFiltro] = useState<CruceCrmFiltro>("todos");
	const [soloNoPagado, setSoloNoPagado] = useState(false);
	const [pagina, setPagina] = useState(1);
	const queryClient = useQueryClient();
	const verificationQuery = useQuery(
		orpc.obtenerUltimaVerificacionSat.queryOptions(),
	);
	const statusQuery = useQuery({
		...orpc.obtenerEstadoVerificacionSat.queryOptions(),
		// Al volver a la pantalla, el estado persistido debe prevalecer sobre
		// cualquier valor que React Query conserve en memoria.
		refetchOnMount: "always",
		refetchInterval: (query) =>
			query.state.data?.estado === "en_proceso" ? 5000 : false,
		refetchIntervalInBackground: true,
	});
	const verificationMutation = useMutation(
		orpc.ejecutarVerificacionSat.mutationOptions({
			onSuccess: (resultado) => {
				queryClient.invalidateQueries({
					queryKey: orpc.obtenerUltimaVerificacionSat.queryKey(),
				});
				queryClient.invalidateQueries({
					queryKey: orpc.obtenerEstadoVerificacionSat.queryKey(),
				});
				if (resultado.estado === "en_proceso") {
					toast.info(
						"La verificación SAT inició y continuará en segundo plano.",
					);
				} else if (resultado.estado === "ok") {
					toast.success("Verificación SAT completada.");
				} else if (resultado.estado === "omitida") {
					toast.info(
						resultado.omitida ?? "Ya hay una verificación SAT en proceso.",
					);
				} else {
					toast.error("La verificación SAT no se completó.");
				}
			},
			onError: () => toast.error("No se pudo ejecutar la verificación SAT."),
		}),
	);

	const data = verificationQuery.data;
	const lote = data?.lote;
	const estadoLote = statusQuery.data?.estado ?? lote?.estado ?? null;
	const consultaEnProceso =
		estadoLote === "en_proceso" ||
		statusQuery.isPending ||
		statusQuery.isFetching;
	const estadoAnterior = useRef<string | null>(null);
	useEffect(() => {
		if (estadoAnterior.current === "en_proceso" && estadoLote === "ok") {
			toast.success("Verificación SAT completada.");
			queryClient.invalidateQueries({
				queryKey: orpc.obtenerUltimaVerificacionSat.queryKey(),
			});
		} else if (
			estadoAnterior.current === "en_proceso" &&
			estadoLote === "error"
		) {
			toast.error("La verificación SAT terminó con error.");
			queryClient.invalidateQueries({
				queryKey: orpc.obtenerUltimaVerificacionSat.queryKey(),
			});
		}
		estadoAnterior.current = estadoLote;
	}, [estadoLote, queryClient]);
	const resultados = data?.resultados ?? [];
	const resultadosFiltrados = useMemo(() => {
		const vehicleTerm = normalizeSearch(vehicleSearch);

		return resultados.filter((vehiculo) => {
			const vehicleText = normalizeSearch(
				[vehiculo.marca, vehiculo.modelo, vehiculo.tipo, vehiculo.color]
					.filter(Boolean)
					.join(" "),
			);
			const searchableText = `${vehicleText} ${normalizeSearch(vehiculo.placa)}`;
			const matchesSearch =
				!vehicleTerm || searchableText.includes(vehicleTerm);
			const estadoSat = vehiculo.estadoSat?.trim().toLowerCase();
			const matchesEstadoSat =
				estadoSatFiltro === "todos" ||
				(estadoSatFiltro === "activo" && estadoSat === "activo") ||
				(estadoSatFiltro === "inactivo" && estadoSat === "inactivo") ||
				(estadoSatFiltro === "no_encontrado" &&
					vehiculo.resultado === "no_aparece_en_sat");
			const matchesCruceCrm =
				cruceCrmFiltro === "todos" || vehiculo.cruceCrm === cruceCrmFiltro;
			const matchesTax =
				!soloNoPagado || vehiculo.impuestoCirculacionPagado === false;

			return matchesSearch && matchesEstadoSat && matchesCruceCrm && matchesTax;
		});
	}, [
		cruceCrmFiltro,
		estadoSatFiltro,
		resultados,
		soloNoPagado,
		vehicleSearch,
	]);

	const totalPaginas = Math.max(
		1,
		Math.ceil(resultadosFiltrados.length / PAGE_SIZE),
	);
	const paginaActual = Math.min(pagina, totalPaginas);
	const resultadosVisibles = resultadosFiltrados.slice(
		(paginaActual - 1) * PAGE_SIZE,
		paginaActual * PAGE_SIZE,
	);
	const hayFiltros =
		vehicleSearch.trim() ||
		estadoSatFiltro !== "todos" ||
		cruceCrmFiltro !== "todos" ||
		soloNoPagado;

	const resetearFiltros = () => {
		setVehicleSearch("");
		setEstadoSatFiltro("todos");
		setCruceCrmFiltro("todos");
		setSoloNoPagado(false);
		setPagina(1);
	};

	return (
		<main className="container mx-auto space-y-6 p-6">
			<div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
				<div>
					<h1 className="font-bold text-3xl tracking-tight">
						Verificación en SAT
					</h1>
					<p className="text-muted-foreground">
						Consulta el estado de los vehículos propios y sus documentos en
						Agencia Virtual.
					</p>
				</div>
				<Button
					onClick={() => verificationMutation.mutate({ forzar: true })}
					disabled={verificationMutation.isPending || consultaEnProceso}
				>
					<RefreshCw
						className={
							verificationMutation.isPending || consultaEnProceso
								? "animate-spin"
								: ""
						}
					/>
					{verificationMutation.isPending
						? "Iniciando consulta..."
						: consultaEnProceso
							? "Consultando SAT..."
							: "Consultar vehículos"}
				</Button>
			</div>

			<div className="grid gap-4 md:grid-cols-3">
				<Card>
					<CardHeader className="pb-2">
						<CardDescription>Último intento</CardDescription>
						<CardTitle className="flex items-center gap-2 text-lg">
							<Clock3 className="h-4 w-4" />
							{formatDate(
								statusQuery.data?.finalizadaAt ??
									statusQuery.data?.iniciadaAt ??
									lote?.finalizadaAt ??
									lote?.iniciadaAt,
							)}
						</CardTitle>
					</CardHeader>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardDescription>Estado del lote</CardDescription>
						<CardTitle className="text-lg">
							{formatRunStatus(estadoLote)}
						</CardTitle>
					</CardHeader>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardDescription>Resultados</CardDescription>
						<CardTitle className="text-lg">
							{resultados.length} vehículos
						</CardTitle>
						{data?.estadoActual && (
							<CardDescription>
								Consulta completa: {formatDate(data.estadoActual.consultadoAt)}
							</CardDescription>
						)}
					</CardHeader>
				</Card>
			</div>

			{verificationQuery.isError && (
				<Card className="border-red-200">
					<CardContent className="pt-6 text-red-700">
						No se pudo cargar la última verificación SAT.
					</CardContent>
				</Card>
			)}
			{consultaEnProceso && (
				<p className="text-muted-foreground text-sm">
					La consulta continúa en segundo plano. Mientras termina, se muestran
					los resultados de la última consulta completa disponible.
				</p>
			)}
			{estadoLote === "error" && (
				<p className="text-red-700 text-sm">
					La última consulta terminó con error y no actualizó ningún resultado.
					{resultados.length > 0
						? " Se mantiene la última consulta completa."
						: " Todavía no existe una consulta completa anterior."}
				</p>
			)}

			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<ShieldCheck className="h-5 w-5" />
						Resultados por vehículo
					</CardTitle>
					<CardDescription>
						Estado del impuesto de circulación según la información obtenida de
						SAT.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
						<div className="space-y-1.5">
							<label
								className="font-medium text-sm"
								htmlFor="sat-vehicle-search"
							>
								Buscar vehículo o placa
							</label>
							<div className="relative">
								<Search className="absolute top-2.5 left-3 h-4 w-4 text-muted-foreground" />
								<Input
									id="sat-vehicle-search"
									className="pl-9"
									placeholder="Marca, modelo, tipo o placa"
									value={vehicleSearch}
									onChange={(event) => {
										setVehicleSearch(event.target.value);
										setPagina(1);
									}}
								/>
							</div>
						</div>
						<div className="space-y-1.5">
							<label
								className="font-medium text-sm"
								htmlFor="sat-status-filter"
							>
								Estado SAT
							</label>
							<Select
								value={estadoSatFiltro}
								onValueChange={(value) => {
									setEstadoSatFiltro(value as EstadoSatFiltro);
									setPagina(1);
								}}
							>
								<SelectTrigger id="sat-status-filter">
									<SelectValue placeholder="Todos los estados SAT" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="todos">Todos</SelectItem>
									<SelectItem value="activo">Activo</SelectItem>
									<SelectItem value="inactivo">Inactivo</SelectItem>
									<SelectItem value="no_encontrado">
										No se encontró en SAT
									</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-1.5">
							<label
								className="font-medium text-sm"
								htmlFor="sat-crm-match-filter"
							>
								Cruce CRM
							</label>
							<Select
								value={cruceCrmFiltro}
								onValueChange={(value) => {
									setCruceCrmFiltro(value as CruceCrmFiltro);
									setPagina(1);
								}}
							>
								<SelectTrigger id="sat-crm-match-filter">
									<SelectValue placeholder="Todos los cruces" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="todos">Todos</SelectItem>
									<SelectItem value="propio">Propio</SelectItem>
									<SelectItem value="registrado_no_propio">
										Registrado, no propio
									</SelectItem>
									<SelectItem value="sin_registro">Sin registro</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="flex flex-col justify-end gap-2">
							<label className="flex min-h-9 cursor-pointer items-center gap-2 text-sm">
								<input
									checked={soloNoPagado}
									className="h-4 w-4 accent-primary"
									type="checkbox"
									onChange={(event) => {
										setSoloNoPagado(event.target.checked);
										setPagina(1);
									}}
								/>
								<span>No ha pagado impuesto</span>
							</label>
							{hayFiltros && (
								<Button
									className="w-fit"
									variant="outline"
									onClick={resetearFiltros}
								>
									Limpiar filtros
								</Button>
							)}
						</div>
					</div>

					<div className="mb-3 flex flex-col justify-between gap-2 text-muted-foreground text-sm sm:flex-row sm:items-center">
						<span>
							{resultadosFiltrados.length === 0
								? "0 resultados"
								: `Mostrando ${(paginaActual - 1) * PAGE_SIZE + 1}-${Math.min(paginaActual * PAGE_SIZE, resultadosFiltrados.length)} de ${resultadosFiltrados.length} resultados`}
						</span>
						{hayFiltros && <span>Filtros aplicados</span>}
					</div>

					{verificationQuery.isLoading ? (
						<p className="py-8 text-center text-muted-foreground">
							Cargando resultados...
						</p>
					) : resultados.length === 0 ? (
						<p className="py-8 text-center text-muted-foreground">
							{consultaEnProceso
								? "La consulta está en proceso. Los resultados aparecerán al completarse."
								: "Todavía no hay resultados. Ejecuta una consulta para comenzar."}
						</p>
					) : resultadosFiltrados.length === 0 ? (
						<p className="py-8 text-center text-muted-foreground">
							No hay vehículos que coincidan con los filtros seleccionados.
						</p>
					) : (
						<div className="overflow-x-auto">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Titular SAT</TableHead>
										<TableHead>Placa</TableHead>
										<TableHead>Vehículo SAT</TableHead>
										<TableHead>Estado SAT</TableHead>
										<TableHead>Cruce CRM</TableHead>
										<TableHead>Impuesto pagado</TableHead>
										<TableHead>Consultado</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{resultadosVisibles.map((vehiculo) => (
										<TableRow key={vehiculo.id}>
											<TableCell>
												<div className="font-medium">
													{vehiculo.titularNombre ?? "Sin titular"}
												</div>
												<div className="text-muted-foreground text-xs">
													{vehiculo.titularNit ?? ""}
												</div>
											</TableCell>
											<TableCell className="font-medium">
												{vehiculo.placa}
											</TableCell>
											<TableCell>
												<div>
													{[vehiculo.marca, vehiculo.modelo]
														.filter(Boolean)
														.join(" ") || "-"}
												</div>
												<div className="text-muted-foreground text-xs">
													{[vehiculo.tipo, vehiculo.color]
														.filter(Boolean)
														.join(" · ") || "Sin datos"}
												</div>
											</TableCell>
											<TableCell>
												<EstadoSatBadge
													estadoSat={vehiculo.estadoSat}
													resultado={vehiculo.resultado}
												/>
											</TableCell>
											<TableCell>
												<CruceCrmBadge cruce={vehiculo.cruceCrm} />
											</TableCell>
											<TableCell>
												<Senal valor={vehiculo.impuestoCirculacionPagado} />
											</TableCell>
											<TableCell>{formatDate(vehiculo.consultadoAt)}</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
							<div className="mt-4 flex items-center justify-between gap-3 border-t pt-4">
								<span className="text-muted-foreground text-sm">
									Página {paginaActual} de {totalPaginas}
								</span>
								<div className="flex items-center gap-2">
									<Button
										aria-label="Página anterior"
										disabled={paginaActual === 1}
										variant="outline"
										onClick={() =>
											setPagina((current) => Math.max(1, current - 1))
										}
									>
										<ChevronLeft />
										Anterior
									</Button>
									<Button
										aria-label="Página siguiente"
										disabled={paginaActual >= totalPaginas}
										variant="outline"
										onClick={() =>
											setPagina((current) =>
												Math.min(totalPaginas, current + 1),
											)
										}
									>
										Siguiente
										<ChevronRight />
									</Button>
								</div>
							</div>
						</div>
					)}
				</CardContent>
			</Card>
		</main>
	);
}

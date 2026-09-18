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
import { useMemo, useState } from "react";
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
type EstadoFiltro = "todos" | "activo" | "inactivo";

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

function resultadoLabel(resultado: string) {
	return (
		{
			activo_ok: "Activo",
			inactivo: "Inactivo",
			no_aparece_en_sat: "No aparece en SAT",
			no_registrado_interno: "No registrado en CRM",
		}[resultado] ?? resultado
	);
}

function ResultadoBadge({ resultado }: { resultado: string }) {
	if (resultado === "activo_ok") {
		return (
			<Badge className="border-green-300 bg-green-100 text-green-800">
				<CheckCircle2 /> Activo
			</Badge>
		);
	}
	if (resultado === "no_registrado_interno") {
		return (
			<Badge className="border-blue-300 bg-blue-100 text-blue-800">
				<AlertTriangle /> No registrado en CRM
			</Badge>
		);
	}
	return (
		<Badge className="border-red-300 bg-red-100 text-red-800">
			<XCircle /> {resultadoLabel(resultado)}
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
	const [estadoFiltro, setEstadoFiltro] = useState<EstadoFiltro>("todos");
	const [soloNoPagado, setSoloNoPagado] = useState(false);
	const [pagina, setPagina] = useState(1);
	const queryClient = useQueryClient();
	const verificationQuery = useQuery(
		orpc.obtenerUltimaVerificacionSat.queryOptions(),
	);
	const verificationMutation = useMutation(
		orpc.ejecutarVerificacionSat.mutationOptions({
			onSuccess: (resultado) => {
				queryClient.invalidateQueries({
					queryKey: orpc.obtenerUltimaVerificacionSat.queryKey(),
				});
				if (resultado.estado === "ok") {
					toast.success("Verificación SAT completada.");
				} else {
					toast.error("La verificación SAT no se completó.");
				}
			},
			onError: () => toast.error("No se pudo ejecutar la verificación SAT."),
		}),
	);

	const data = verificationQuery.data;
	const corrida = data?.corrida;
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
			const matchesEstado =
				estadoFiltro === "todos" ||
				(estadoFiltro === "activo" && vehiculo.resultado === "activo_ok") ||
				(estadoFiltro === "inactivo" && vehiculo.resultado === "inactivo");
			const matchesTax =
				!soloNoPagado || vehiculo.impuestoCirculacionPagado === false;

			return matchesSearch && matchesEstado && matchesTax;
		});
	}, [estadoFiltro, resultados, soloNoPagado, vehicleSearch]);

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
		vehicleSearch.trim() || estadoFiltro !== "todos" || soloNoPagado;

	const resetearFiltros = () => {
		setVehicleSearch("");
		setEstadoFiltro("todos");
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
					disabled={verificationMutation.isPending}
				>
					<RefreshCw
						className={verificationMutation.isPending ? "animate-spin" : ""}
					/>
					{verificationMutation.isPending
						? "Consultando SAT..."
						: "Consultar vehículos"}
				</Button>
			</div>

			<div className="grid gap-4 md:grid-cols-3">
				<Card>
					<CardHeader className="pb-2">
						<CardDescription>Última consulta</CardDescription>
						<CardTitle className="flex items-center gap-2 text-lg">
							<Clock3 className="h-4 w-4" />
							{formatDate(corrida?.finalizadaAt ?? corrida?.iniciadaAt)}
						</CardTitle>
					</CardHeader>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardDescription>Estado de la corrida</CardDescription>
						<CardTitle className="text-lg capitalize">
							{corrida?.estado ?? "Sin datos"}
						</CardTitle>
					</CardHeader>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardDescription>Resultados</CardDescription>
						<CardTitle className="text-lg">
							{resultados.length} vehículos
						</CardTitle>
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
					<div className="mb-6 grid gap-3 md:grid-cols-3">
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
								Estado
							</label>
							<Select
								value={estadoFiltro}
								onValueChange={(value) => {
									setEstadoFiltro(value as EstadoFiltro);
									setPagina(1);
								}}
							>
								<SelectTrigger id="sat-status-filter">
									<SelectValue placeholder="Todos los estados" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="todos">Todos</SelectItem>
									<SelectItem value="activo">Activo</SelectItem>
									<SelectItem value="inactivo">Inactivo</SelectItem>
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
							Todavía no hay resultados. Ejecuta una consulta para comenzar.
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
										<TableHead>Placa</TableHead>
										<TableHead>Vehículo SAT</TableHead>
										<TableHead>Veredicto</TableHead>
										<TableHead>Impuesto pagado</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{resultadosVisibles.map((vehiculo) => (
										<TableRow key={vehiculo.id}>
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
												<ResultadoBadge resultado={vehiculo.resultado} />
											</TableCell>
											<TableCell>
												<Senal valor={vehiculo.impuestoCirculacionPagado} />
											</TableCell>
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

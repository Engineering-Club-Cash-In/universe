import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { differenceInDays } from "date-fns";
import {
	Banknote,
	CalendarDays,
	CalendarRange,
	Loader2,
	Phone,
	TrendingDown,
	TrendingUp,
	Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PERMISSIONS } from "server/src/types/roles";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";
import { type ContratoCobranza, columns } from "@/lib/cobros/columns";
import { ROLES } from "@/lib/roles";
import { orpc } from "@/utils/orpc";

// Función para calcular días restantes hasta la fecha de próximo pago
function calcularDiasHastaPago(fechaProximoPago: string | null) {
	if (!fechaProximoPago) return null;

	const ahora = new Date();
	const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
	const fechaPago = new Date(fechaProximoPago);

	const diasRestantes = differenceInDays(fechaPago, hoy);

	return {
		fechaPago,
		diasRestantes,
	};
}

type FiltroTemporal = "hoy" | "semana" | "quincena" | "mes" | "todos";

export const Route = createFileRoute("/cobros/")({
	component: RouteComponent,
});

function RouteComponent() {
	const { data: session } = authClient.useSession();
	const [filtroTemporal, setFiltroTemporal] = useState<FiltroTemporal>("todos");
	const [mostrarCompletadosIncobrables, setMostrarCompletadosIncobrables] =
		useState(false);
	const [filtroEtapa, setFiltroEtapa] = useState<string | null>(null);
	const [page, setPage] = useState(1);
	const [filterValue, setFilterValue] = useState("");
	const [debouncedFilterValue, setDebouncedFilterValue] = useState("");
	const [pageSize, setPageSize] = useState(10);

	// Debounce para el filtro de búsqueda (1 segundos)
	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedFilterValue(filterValue);
			setPage(1); // Reset a la primera página cuando cambia el filtro
		}, 1000);

		return () => clearTimeout(timer);
	}, [filterValue]);

	const userRole = session?.user.role;

	const dashboardStats = useQuery({
		...orpc.getCobrosDashboardStats.queryOptions({
			input: {
				emailCobrador:
					userRole !== ROLES.ADMIN ? session?.user?.email : undefined,
			},
		}),
		enabled: !!session,
	});

	// Mapear filtroTemporal al enum time
	const timeParam = useMemo(():
		| "WEEK"
		| "MONTH"
		| "DUEMONTH"
		| "TODAY"
		| undefined => {
		switch (filtroTemporal) {
			case "hoy":
				return "TODAY";
			case "semana":
				return "WEEK";
			case "quincena":
				return "DUEMONTH";
			case "mes":
				return "MONTH";
			case "todos":
				return undefined; // No enviar time cuando es "todos"
			default:
				return undefined;
		}
	}, [filtroTemporal]);

	const todosLosCreditos = useQuery({
		...orpc.getTodosLosCreditos.queryOptions({
			input: {
				limit: pageSize,
				offset: (page - 1) * pageSize,
				estadoMora: filtroEtapa || undefined,
				nombreUsuario: debouncedFilterValue || undefined,
				time: timeParam,
				emailCobrador:
					userRole !== ROLES.ADMIN ? session?.user?.email : undefined,
			},
		}),
		enabled: !!session,
	});

	const stats = dashboardStats.data?.estatusStats || [];
	const creditosData = todosLosCreditos.data;
	const creditos = creditosData?.data || [];
	const totalCreditos = creditosData?.total || 0;
	const totalPages = creditosData?.totalPages || 1;

	// Procesar creditos y calcular días hasta pago
	const creditosConDias = useMemo(() => {
		return creditos
			.map((contrato) => {
				const infoPago = calcularDiasHastaPago(contrato.fechaProximoPago);
				// Si hay fecha de pago, usar los días calculados
				// Si NO hay fecha de pago pero HAY mora, usar días de mora negativos
				// Si NO hay fecha de pago y NO hay mora, usar null (sin fecha definida)
				let diasHastaPago: number | null;

				if (infoPago?.diasRestantes !== undefined) {
					diasHastaPago = infoPago.diasRestantes;
				} else if (contrato.diasMoraMaximo && contrato.diasMoraMaximo > 0) {
					// Hay mora pero no hay fecha de próximo pago
					diasHastaPago = -contrato.diasMoraMaximo;
				} else {
					// No hay fecha de pago ni mora
					diasHastaPago = null;
				}

				return {
					...contrato,
					diasHastaPago,
				} as ContratoCobranza;
			})
			.sort((a, b) => {
				// Ordenar: primero los que tienen fecha (por días), luego los que no tienen
				if (a.diasHastaPago === null && b.diasHastaPago === null) return 0;
				if (a.diasHastaPago === null) return 1;
				if (b.diasHastaPago === null) return 1;
				return a.diasHastaPago - b.diasHastaPago;
			});
	}, [creditos]);

	// Filtrar según el rango temporal seleccionado
	const creditosFiltrados = useMemo(() => {
		let filtrados = creditosConDias;

		// Excluir completados e incobrables si el filtro está desactivado
		// NOTA: El filtro por etapa ahora se hace en el servidor mediante estadoMora
		if (!mostrarCompletadosIncobrables && !filtroEtapa) {
			filtrados = filtrados.filter(
				(c) =>
					c.estadoContrato !== "completado" &&
					c.estadoContrato !== "incobrable",
			);
		}

		// Filtrar por rango temporal
		if (filtroTemporal === "todos") return filtrados;

		const limitesDias: Record<FiltroTemporal, number> = {
			hoy: 0,
			semana: 7,
			quincena: 15,
			mes: 30,
			todos: Number.POSITIVE_INFINITY,
		};

		const limite = limitesDias[filtroTemporal];

		return filtrados.filter((c) => {
			// Incluir casos en mora (días negativos) y casos próximos a vencer
			return c?.diasHastaPago !== null && c?.diasHastaPago <= limite;
		});
	}, [creditosConDias, filtroTemporal, mostrarCompletadosIncobrables]);

	// Check permissions after all hooks
	if (!userRole || !PERMISSIONS.canAccessCobros(userRole)) {
		return (
			<div className="flex min-h-screen items-center justify-center">
				<div className="text-center">
					<h1 className="mb-4 font-bold text-2xl text-gray-800">
						Acceso Denegado
					</h1>
					<p className="text-gray-600">
						No tienes permisos para acceder a la sección de cobros.
					</p>
				</div>
			</div>
		);
	}

	const filtros = [
		{ key: "hoy" as const, label: "Hoy", icon: CalendarDays },
		{ key: "semana" as const, label: "Esta Semana", icon: CalendarRange },
		{ key: "quincena" as const, label: "Esta Quincena", icon: CalendarRange },
		{ key: "mes" as const, label: "Este Mes", icon: CalendarRange },
		{ key: "todos" as const, label: "Todos", icon: Users },
	];

	const filtrosEtapa = [
		{ key: "al_dia", label: "Al Día", color: "bg-green-100 text-green-800" },
		{
			key: "mora_30",
			label: "Mora 30",
			color: "bg-yellow-100 text-yellow-800",
		},
		{
			key: "mora_60",
			label: "Mora 60",
			color: "bg-orange-100 text-orange-800",
		},
		{ key: "mora_90", label: "Mora 90", color: "bg-red-100 text-red-800" },
		{
			key: "mora_120",
			label: "Mora 120+",
			color: "bg-red-200 text-red-900",
		},
		{
			key: "incobrable",
			label: "Incobrable",
			color: "bg-gray-100 text-gray-800",
		},
		{
			key: "completado",
			label: "Completado",
			color: "bg-blue-100 text-blue-800",
		},
	];

	if (dashboardStats.isLoading) {
		return (
			<div className="container mx-auto space-y-6 p-6">
				<div>
					<h1 className="font-bold text-3xl">Dashboard de Cobros</h1>
					<p className="text-muted-foreground">
						Gestión y seguimiento de cobranza - Enfoque preventivo
					</p>
				</div>
				<Card className="border-blue-200 bg-blue-50">
					<CardContent className="flex items-center gap-3 py-4">
						<Loader2 className="h-5 w-5 animate-spin text-blue-600" />
						<div>
							<p className="font-medium text-blue-900">
								Cargando información de cobros...
							</p>
							<p className="text-blue-700 text-sm">Cartera</p>
						</div>
					</CardContent>
				</Card>
			</div>
		);
	}

	return (
		<div className="container mx-auto space-y-6 p-6">
			<div>
				<h1 className="font-bold text-3xl">Dashboard de Cobros</h1>
				<p className="text-muted-foreground">
					Gestión y seguimiento de cobranza - Enfoque preventivo
				</p>
			</div>

			{/* Estadísticas Generales */}
			<div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="font-medium text-sm">
							Total Casos Asignados
						</CardTitle>
						<Users className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						{dashboardStats.isLoading ? (
							<div className="flex items-center gap-2">
								<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
								<span className="text-muted-foreground text-sm">
									Cargando...
								</span>
							</div>
						) : (
							<>
								<div className="font-bold text-2xl">
									{dashboardStats.data?.totalCasosAsignados || 0}
								</div>
								<p className="text-muted-foreground text-xs">
									Casos bajo tu responsabilidad
								</p>
							</>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="font-medium text-sm">Contactos Hoy</CardTitle>
						<Phone className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="font-bold text-2xl">
							{dashboardStats.data?.contactosHoy || 0}
						</div>
						<p className="text-muted-foreground text-xs">
							Interacciones realizadas hoy
						</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="font-medium text-sm">
							Monto Total en Mora
						</CardTitle>
						<Banknote className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="font-bold text-2xl">
							Q
							{stats
								.reduce((sum, s) => sum + Number(s.montoTotal || 0), 0)
								.toLocaleString()}
						</div>
						<p className="text-muted-foreground text-xs">
							Suma de todos los montos en mora
						</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="font-medium text-sm">Efectividad</CardTitle>
						<TrendingUp className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="font-bold text-2xl">
							{dashboardStats.data?.efectividad
								? `${Number.parseFloat(dashboardStats.data.efectividad).toFixed(2)}%`
								: "0%"}
						</div>
						<p className="text-muted-foreground text-xs">
							Tasa de recuperación
						</p>
					</CardContent>
				</Card>
			</div>

			{/* Embudo Visual de Estados */}
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<TrendingDown className="h-5 w-5" />
						Embudo de Cobranza
					</CardTitle>
					<CardDescription>
						Distribución de casos por estado de mora
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="space-y-3">
						{[
							{
								key: "al_dia",
								label: "Al Día",
								color: "bg-green-100 text-green-800",
							},
							{
								key: "mora_30",
								label: "Mora 30",
								color: "bg-yellow-100 text-yellow-800",
							},
							{
								key: "mora_60",
								label: "Mora 60",
								color: "bg-orange-100 text-orange-800",
							},
							{
								key: "mora_90",
								label: "Mora 90",
								color: "bg-red-100 text-red-800",
							},
							{
								key: "mora_120",
								label: "Mora 120",
								color: "bg-red-200 text-red-900",
							},
							{
								key: "incobrable",
								label: "Incobrable",
								color: "bg-gray-100 text-gray-800",
							},
							{
								key: "completado",
								label: "Completado",
								color: "bg-blue-100 text-blue-800",
							},
						].map((estado) => {
							const estadoStats = stats.find(
								(s) => s.estadoMora === estado.key,
							) || {
								totalCases: 0,
								montoTotal: "0",
								sumaCapital: "0",
								porcentaje: "0",
							};
							const maxCasos = Math.max(...stats.map((s) => s.totalCases), 1);
							const porcentaje = (estadoStats.totalCases / maxCasos) * 100;

							return (
								<div
									key={estado.key}
									className="group flex items-center gap-3 rounded-lg p-3 transition-all hover:bg-muted/50"
								>
									<div className="flex w-32 shrink-0 items-center gap-2">
										<Badge
											className={`${estado.color} whitespace-nowrap text-xs`}
										>
											{estado.label}
										</Badge>
									</div>
									<div className="relative flex-1">
										<div className="h-10 w-full overflow-hidden rounded-md bg-muted">
											{porcentaje >= 15 ? (
												// Barra suficientemente ancha - texto dentro
												<div
													className="flex h-full items-center justify-between px-3 transition-all duration-300 group-hover:opacity-80"
													style={{
														width: `${porcentaje}%`,
														backgroundColor: `hsl(220, 15%, ${Math.max(30, 90 - porcentaje * 0.5)}%)`,
													}}
												>
													<span
														className="whitespace-nowrap font-semibold text-sm"
														style={{
															color: porcentaje > 60 ? "white" : "#1f2937",
														}}
													>
														{estadoStats.totalCases} casos - {Number.parseFloat(estadoStats.porcentaje || "0").toFixed(2)}% del total
													</span>
												</div>
											) : (
												// Barra estrecha - texto fuera
												<div className="flex h-full items-center">
													<div
														className="h-full transition-all duration-300 group-hover:opacity-80"
														style={{
															width: `${Math.max(porcentaje, 3)}%`,
															backgroundColor: `hsl(220, 15%, ${Math.max(30, 90 - porcentaje * 0.5)}%)`,
														}}
													/>
													<span className="ml-2 whitespace-nowrap font-semibold text-muted-foreground text-sm">
														{estadoStats.totalCases} casos - {Number.parseFloat(estadoStats.porcentaje || "0").toFixed(2)}% del total
													</span>
												</div>
											)}
										</div>
									</div>
									<div className="flex w-52 shrink-0 flex-col gap-1 text-right text-sm">
										<div className="flex items-center justify-end gap-2">
											<span className="text-muted-foreground text-xs">
												Mora:
											</span>
											<span className="font-medium">
												Q{Number(estadoStats.montoTotal || 0).toLocaleString()}
											</span>
										</div>
										<div className="flex items-center justify-end gap-2">
											<span className="text-muted-foreground text-xs">
												Capital:
											</span>
											<span className="font-medium">
												Q{Number(estadoStats.sumaCapital || 0).toLocaleString()}
											</span>
										</div>
									</div>
								</div>
							);
						})}
					</div>
				</CardContent>
			</Card>

			{/* Filtros Temporales y Tabla */}
			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<CardTitle>Casos de Cobranza</CardTitle>
							<CardDescription>
								Enfocado en prevenir mora - Ordenado por proximidad de pago
							</CardDescription>
						</div>
						<Badge variant="outline" className="text-sm">
							{creditosFiltrados.length} casos mostrados
						</Badge>
					</div>
				</CardHeader>
				<CardContent className="space-y-4">
					{/* Filtros Temporales */}
					<div className="flex flex-wrap items-center gap-4">
						<div className="flex flex-wrap gap-2">
							{filtros.map((filtro) => {
								const Icon = filtro.icon;
								const isActive = filtroTemporal === filtro.key;

								return (
									<Button
										key={filtro.key}
										variant={isActive ? "default" : "outline"}
										size="sm"
										onClick={() => setFiltroTemporal(filtro.key)}
									>
										<Icon className="mr-2 h-4 w-4" />
										{filtro.label}
									</Button>
								);
							})}
						</div>
					</div>

					{/* Data Table */}
					<DataTable
						columns={columns}
						data={creditosFiltrados}
						isLoading={todosLosCreditos.isLoading}
						setGlobalFilterParam={setFilterValue}
						searchPlaceholder="Buscar por cliente"
						filterContent={
							<>
								<span className="font-medium text-muted-foreground text-sm">
									Filtrar por etapa:
								</span>
								<Button
									variant={filtroEtapa === null ? "default" : "outline"}
									size="sm"
									onClick={() => {
										setFiltroEtapa(null);
										setPage(1);
									}}
								>
									Todas
								</Button>
								{filtrosEtapa.map((filtro) => (
									<Badge
										key={filtro.key}
										className={`cursor-pointer ${filtroEtapa === filtro.key ? filtro.color : "bg-gray-50 text-gray-600 hover:bg-gray-100"}`}
										onClick={() => {
											setFiltroEtapa(
												filtroEtapa === filtro.key ? null : filtro.key,
											);
											setPage(1);
										}}
									>
										{filtro.label}
									</Badge>
								))}
							</>
						}
						serverPagination={{
							page: page,
							pageSize: pageSize,
							totalPages: totalPages,
							totalItems: totalCreditos,
							onPageChange: (newPage) => setPage(newPage),
						}}
					/>
				</CardContent>
			</Card>
		</div>
	);
}

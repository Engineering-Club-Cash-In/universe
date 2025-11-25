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
import { useMemo, useState } from "react";
import { PERMISSIONS } from "server/src/types/roles";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable } from "@/components/data-table";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";
import { type ContratoCobranza, columns } from "@/lib/cobros/columns";

// Función para calcular la próxima fecha de pago y días restantes
function calcularProximaFechaPago(diaPagoMensual: number | null) {
	if (!diaPagoMensual) return null;

	const ahora = new Date();
	const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
	const diaActual = hoy.getDate();
	const mesActual = hoy.getMonth();
	const añoActual = hoy.getFullYear();

	let fechaPago: Date;
	if (diaActual <= diaPagoMensual) {
		fechaPago = new Date(añoActual, mesActual, diaPagoMensual);
	} else {
		fechaPago = new Date(añoActual, mesActual + 1, diaPagoMensual);
	}

	if (fechaPago.getDate() !== diaPagoMensual) {
		fechaPago = new Date(fechaPago.getFullYear(), fechaPago.getMonth() + 1, 0);
	}

	const diasRestantes = differenceInDays(fechaPago, hoy);

	console.log("[calcularProximaFechaPago]", {
		diaPagoMensual,
		diaActual,
		hoy: hoy.toISOString(),
		fechaPago: fechaPago.toISOString(),
		diasRestantes,
	});

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
	const [filtroTemporal, setFiltroTemporal] = useState<FiltroTemporal>("semana");
	const [mostrarCompletadosIncobrables, setMostrarCompletadosIncobrables] =
		useState(false);
	const [filtroEtapa, setFiltroEtapa] = useState<string | null>(null);

	const dashboardStats = useQuery({
		...orpc.getCobrosDashboardStats.queryOptions(),
		enabled: !!session,
	});

	const todosLosContratos = useQuery({
		...orpc.getTodosLosContratos.queryOptions({
			input: {
				limit: 1000, // Aumentar límite para ver todos
				offset: 0,
			},
		}),
		enabled: !!session,
	});

	const userProfile = useQuery({
		...orpc.getUserProfile.queryOptions(),
		enabled: !!session,
	});

	const userRole = userProfile.data?.role;
	const stats = dashboardStats.data?.estatusStats || [];
	const contratos = todosLosContratos.data || [];

	// Procesar contratos y calcular días hasta pago
	const contratosConDias = useMemo(() => {
		return contratos
			.map((contrato) => {
				const infoPago = calcularProximaFechaPago(contrato.diaPagoMensual);
				// Si no hay día de pago, usar días de mora negativos para priorizar
				// Casos con más mora aparecen primero (más negativos)
				const diasHastaPago =
					infoPago?.diasRestantes ?? -(contrato.diasMoraMaximo || 0);

				console.log("[contratoConDias]", {
					clienteNombre: contrato.clienteNombre,
					diaPagoMensual: contrato.diaPagoMensual,
					diasMoraMaximo: contrato.diasMoraMaximo,
					infoPago,
					diasHastaPago,
				});

				return {
					...contrato,
					diasHastaPago,
				} as ContratoCobranza;
			})
			.sort((a, b) => a.diasHastaPago - b.diasHastaPago);
	}, [contratos]);

	// Filtrar según el rango temporal seleccionado
	const contratosFiltrados = useMemo(() => {
		let filtrados = contratosConDias;

		// Excluir completados e incobrables si el filtro está desactivado
		if (!mostrarCompletadosIncobrables) {
			filtrados = filtrados.filter(
				(c) => c.estadoContrato !== "completado" && c.estadoContrato !== "incobrable",
			);
		}

		// Filtrar por etapa de mora si hay filtro activo
		if (filtroEtapa) {
			filtrados = filtrados.filter((c) => {
				const estadoVisual =
					c.estadoContrato === "activo"
						? c.estadoMora || "al_dia"
						: c.estadoContrato;
				return estadoVisual === filtroEtapa;
			});
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
			return c.diasHastaPago <= limite;
		});
	}, [contratosConDias, filtroTemporal, mostrarCompletadosIncobrables, filtroEtapa]);

	// Check permissions after all hooks
	if (!userRole || !PERMISSIONS.canAccessCobros(userRole)) {
		return (
			<div className="container mx-auto p-6">
				<div className="text-center">
					<h1 className="mb-4 font-bold text-2xl text-gray-900">
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
		{ key: "mora_30", label: "Mora 30", color: "bg-yellow-100 text-yellow-800" },
		{ key: "mora_60", label: "Mora 60", color: "bg-orange-100 text-orange-800" },
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

	return (
		<div className="container mx-auto space-y-6 p-6">
			<div>
				<h1 className="font-bold text-3xl">Dashboard de Cobros</h1>
				<p className="text-muted-foreground">
					Gestión y seguimiento de cobranza - Enfoque preventivo
				</p>
			</div>

			{/* Loading indicator */}
			{(dashboardStats.isLoading || todosLosContratos.isLoading) && (
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
			)}

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
								<span className="text-muted-foreground text-sm">Cargando...</span>
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
							{(() => {
								const totalCasos = stats.reduce((sum, s) => sum + s.totalCases, 0);
								const casosRecuperados =
									(stats.find((s) => s.estadoMora === "pagado")?.totalCases || 0) +
									(stats.find((s) => s.estadoMora === "completado")?.totalCases ||
										0);
								const efectividad =
									totalCasos > 0
										? Math.round((casosRecuperados / totalCasos) * 100)
										: 0;
								return `${efectividad}%`;
							})()}
						</div>
						<p className="text-muted-foreground text-xs">
							Tasa de recuperación mensual
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
							const estadoStats =
								stats.find((s) => s.estadoMora === estado.key) || {
									totalCases: 0,
									montoTotal: "0",
								};
							const maxCasos = Math.max(...stats.map((s) => s.totalCases), 1);
							const porcentaje = (estadoStats.totalCases / maxCasos) * 100;

							return (
								<div
									key={estado.key}
									className="group flex items-center gap-3 rounded-lg p-3 transition-all hover:bg-muted/50"
								>
									<div className="flex w-32 shrink-0 items-center gap-2">
										<Badge className={`${estado.color} whitespace-nowrap text-xs`}>
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
														className="font-semibold text-sm whitespace-nowrap"
														style={{
															color: porcentaje > 60 ? "white" : "#1f2937",
														}}
													>
														{estadoStats.totalCases} casos
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
													<span className="ml-2 font-semibold text-sm text-muted-foreground whitespace-nowrap">
														{estadoStats.totalCases} casos
													</span>
												</div>
											)}
										</div>
									</div>
									<div className="w-32 shrink-0 text-right font-medium text-sm">
										Q{Number(estadoStats.montoTotal || 0).toLocaleString()}
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
							{contratosFiltrados.length} casos mostrados
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
						<div className="flex items-center space-x-2 rounded-md border px-3 py-2">
							<Checkbox
								id="completados-incobrables"
								checked={mostrarCompletadosIncobrables}
								onCheckedChange={(checked) =>
									setMostrarCompletadosIncobrables(checked === true)
								}
							/>
							<label
								htmlFor="completados-incobrables"
								className="cursor-pointer text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
							>
								Mostrar completados e incobrables
							</label>
						</div>
					</div>

					{/* Data Table */}
					<DataTable
						columns={columns}
						data={contratosFiltrados}
						searchPlaceholder="Buscar por cliente, vehículo o placa..."
						filterContent={
							<>
								<span className="text-muted-foreground text-sm font-medium">
									Filtrar por etapa:
								</span>
								<Button
									variant={filtroEtapa === null ? "default" : "outline"}
									size="sm"
									onClick={() => setFiltroEtapa(null)}
								>
									Todas
								</Button>
								{filtrosEtapa.map((filtro) => (
									<Badge
										key={filtro.key}
										className={`cursor-pointer ${filtroEtapa === filtro.key ? filtro.color : "bg-gray-50 text-gray-600 hover:bg-gray-100"}`}
										onClick={() =>
											setFiltroEtapa(
												filtroEtapa === filtro.key ? null : filtro.key,
											)
										}
									>
										{filtro.label}
									</Badge>
								))}
							</>
						}
					/>
				</CardContent>
			</Card>
		</div>
	);
}

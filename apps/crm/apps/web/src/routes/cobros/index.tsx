import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { differenceInDays } from "date-fns";
import {
	Banknote,
	CalendarClock,
	CalendarDays,
	CalendarRange,
	ChevronDown,
	Loader2,
	MessageCircle,
	Phone,
	Target,
	TrendingDown,
	TrendingUp,
	Users,
	X,
} from "lucide-react";
import { usePersistedDateRange } from "@/hooks/usePersistedDateRange";
import { usePersistedState } from "@/hooks/usePersistedState";
import { useEffect, useMemo, useState } from "react";
import type { DateRange } from "react-day-picker";
import { MassWhatsappModal } from "@/components/cobros/mass-whatsapp-modal";
import { DateRangeFilter } from "@/components/reports/date-range-filter";
import { CapitalRangeFilter } from "@/components/cobros/capital-range-filter";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { authClient } from "@/lib/auth-client";
import { getCobrosColumns } from "@/lib/cobros/columns";
import { getPaymentDateRangeFilter } from "@/lib/cobros/payment-date-range-filter";
import { parseFechaLocal } from "@/lib/date-utils";
import { PERMISSIONS, ROLES } from "@/lib/roles";
import { orpc } from "@/utils/orpc";

// Función para calcular días restantes hasta la fecha de próximo pago
function calcularDiasHastaPago(fechaProximoPago: string | null) {
	if (!fechaProximoPago) return null;

	const ahora = new Date();
	const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
	const fechaPago = parseFechaLocal(fechaProximoPago);

	const diasRestantes = differenceInDays(fechaPago, hoy);

	return {
		fechaPago,
		diasRestantes,
	};
}

type FiltroTemporal = "hoy" | "semana" | "quincena" | "mes" | "todos";

interface EmbudoEstado {
	key: string;
	label: string;
	color: string;
	barColor: string;
}

interface EmbudoStats {
	totalCases: number;
	montoTotal: string;
	sumaCapital: string;
	porcentaje: string;
}

function EmbudoRow({
	estado,
	estadoStats,
	maxCasos,
	emailCobrador,
	onNavigate,
}: {
	estado: EmbudoEstado;
	estadoStats: EmbudoStats;
	maxCasos: number;
	emailCobrador: string | undefined;
	onNavigate: (id: string, tipo: string) => void;
}) {
	const [isOpen, setIsOpen] = useState(false);
	const porcentaje = (estadoStats.totalCases / maxCasos) * 100;

	const topCasos = useQuery({
		...orpc.getTodosLosCreditos.queryOptions({
			input: {
				limit: 5,
				offset: 0,
				estadoMora: estado.key,
				emailCobrador,
			},
		}),
		enabled: isOpen && estadoStats.totalCases > 0,
	});

	const casosOrdenados = useMemo(() => {
		if (!topCasos.data?.data) return [];
		return [...topCasos.data.data].sort(
			(a, b) => Number(b.montoFinanciado || 0) - Number(a.montoFinanciado || 0),
		);
	}, [topCasos.data]);

	return (
		<Collapsible
			open={isOpen}
			onOpenChange={setIsOpen}
			className="rounded-lg border border-border"
		>
			<CollapsibleTrigger asChild>
				<button
					type="button"
					className="group flex w-full cursor-pointer items-center gap-3 p-3 text-left transition-all hover:bg-muted/50"
				>
					<div className="flex w-32 shrink-0 items-center gap-2">
						<Badge className={`${estado.color} whitespace-nowrap text-xs`}>
							{estado.label}
						</Badge>
					</div>
					<div className="relative flex-1">
						<div className="h-10 w-full overflow-hidden rounded-md bg-muted">
							{porcentaje >= 15 ? (
								<div
									className="flex h-full items-center justify-between px-3 transition-all duration-300 group-hover:opacity-80"
									style={{
										width: `${porcentaje}%`,
										backgroundColor: estado.barColor,
									}}
								>
									<span
										className="whitespace-nowrap font-semibold text-sm"
										style={{
											color: porcentaje > 60 ? "white" : "#1f2937",
										}}
									>
										{estadoStats.totalCases} casos -{" "}
										{Number.parseFloat(estadoStats.porcentaje || "0").toFixed(
											1,
										)}
										%
									</span>
								</div>
							) : (
								<div className="flex h-full items-center">
									<div
										className="h-full transition-all duration-300 group-hover:opacity-80"
										style={{
											width: `${Math.max(porcentaje, 3)}%`,
											backgroundColor: estado.barColor,
										}}
									/>
									<span className="ml-2 whitespace-nowrap font-semibold text-muted-foreground text-sm">
										{estadoStats.totalCases} casos -{" "}
										{Number.parseFloat(estadoStats.porcentaje || "0").toFixed(
											1,
										)}
										%
									</span>
								</div>
							)}
						</div>
					</div>
					<div className="flex w-52 shrink-0 flex-col gap-1 text-right text-sm">
						<div className="flex items-center justify-end gap-2">
							<span className="text-muted-foreground text-xs">Mora:</span>
							<span className="font-medium">
								Q{Number(estadoStats.montoTotal || 0).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
							</span>
						</div>
						<div className="flex items-center justify-end gap-2">
							<span className="text-muted-foreground text-xs">Capital:</span>
							<span className="font-medium">
								Q{Number(estadoStats.sumaCapital || 0).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
							</span>
						</div>
					</div>
					<ChevronDown
						className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
					/>
				</button>
			</CollapsibleTrigger>
			<CollapsibleContent>
				<div className="overflow-hidden border-t bg-card">
					{topCasos.isLoading ? (
						<div className="flex items-center justify-center gap-2 py-4">
							<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
							<span className="text-muted-foreground text-sm">
								Cargando casos...
							</span>
						</div>
					) : casosOrdenados.length === 0 ? (
						<div className="py-4 text-center text-muted-foreground text-sm">
							Sin casos en esta etapa
						</div>
					) : (
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b bg-muted/30">
									<th className="py-2 pl-3 text-left font-medium text-muted-foreground">
										Cliente
									</th>
									<th className="py-2 text-left font-medium text-muted-foreground">
										No. Crédito
									</th>
									<th className="py-2 text-right font-medium text-muted-foreground">
										Capital Activo
									</th>
									<th className="py-2 text-right font-medium text-muted-foreground">
										Mora
									</th>
									<th className="py-2 pr-3 text-right font-medium text-muted-foreground">
										Cuota
									</th>
								</tr>
							</thead>
							<tbody>
								{casosOrdenados.map((caso) => (
									<tr
										key={caso.numeroCredito || caso.contratoId}
										className="cursor-pointer border-b transition-colors last:border-b-0 hover:bg-muted/40"
										onClick={() => {
											const linkId = caso.numeroCredito || caso.contratoId;
											const tipoLink = caso.casoCobroId ? "caso" : "contrato";
											onNavigate(linkId, tipoLink);
										}}
									>
										<td className="py-2 pl-3 font-medium">
											{caso.clienteNombre}
										</td>
										<td className="py-2 font-mono text-muted-foreground text-xs">
											{caso.numeroCredito || "-"}
										</td>
										<td className="py-2 text-right tabular-nums">
											Q{Number(caso.montoFinanciado || 0).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
										</td>
										<td className="py-2 text-right text-red-600 tabular-nums">
											{Number(caso.montoEnMora || 0) > 0
												? `Q${Number(caso.montoEnMora).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
												: "-"}
										</td>
										<td className="py-2 pr-3 text-right tabular-nums">
											Q{Number(caso.cuotaMensual || 0).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
					{estadoStats.totalCases > 5 && (
						<div className="border-t px-3 py-2 text-center">
							<span className="text-muted-foreground text-xs">
								Mostrando top 5 de {estadoStats.totalCases} casos
							</span>
						</div>
					)}
				</div>
			</CollapsibleContent>
		</Collapsible>
	);
}

export const Route = createFileRoute("/cobros/")({
	component: RouteComponent,
});

const ETIQUETA_LABELS_FILTRO: Record<string, string> = {
	juridico: "Jurídico",
	convenio: "Convenio",
	cobro: "Cobro",
	no_localizable: "No Localizable",
	unidad_a_recuperar: "Unidad a Recuperar",
	unidad_recuperada: "Unidad Recuperada",
	moras_pendientes: "Moras Pendientes",
	compromiso_de_pago: "Compromiso de Pago",
	cancelado: "Cancelado",
	reclamo: "Reclamo",
};


function RouteComponent() {
	const { data: session } = authClient.useSession();
	const navigate = useNavigate();
	const [filtroTemporal, setFiltroTemporal] = usePersistedState<FiltroTemporal>("cobros/filtroTemporal", "hoy");
	const [mostrarCompletadosIncobrables, setMostrarCompletadosIncobrables] =
		useState(false);
	const [filtroEtapa, setFiltroEtapa] = usePersistedState<string | null>("cobros/filtroEtapa", null);
	const [filtroEtiquetas, setFiltroEtiquetas] = usePersistedState<string[]>("cobros/filtroEtiquetas", []);
	const [page, setPage] = usePersistedState<number>("cobros/page", 1);
	const [filterValue, setFilterValue] = usePersistedState<string>("cobros/filterValue", "");
	const [debouncedFilterValue, setDebouncedFilterValue] = useState(filterValue);
	const [sifcoFilterValue, setSifcoFilterValue] = usePersistedState<string>("cobros/sifcoFilterValue", "");
	const [debouncedSifcoFilterValue, setDebouncedSifcoFilterValue] = useState(sifcoFilterValue);
	const [pageSize, setPageSize] = usePersistedState<number>("cobros/pageSize", 25);
	const [dateRange, setDateRange] = usePersistedDateRange("cobros/dateRange");
	const [pickerRange, setPickerRange] = useState<DateRange | undefined>(dateRange);
	const fechaDesde = dateRange?.from && dateRange?.to ? dateRange.from.toISOString().slice(0, 10) : undefined;
	const fechaHasta = dateRange?.from && dateRange?.to ? dateRange.to.toISOString().slice(0, 10) : undefined;
	const [fechaError, setFechaError] = useState<string | null>(null);
	const [capitalMin, setCapitalMin] = usePersistedState<number | undefined>("cobros/capitalMin", undefined);
	const [capitalMax, setCapitalMax] = usePersistedState<number | undefined>("cobros/capitalMax", undefined);
	const [excluirPagados, setExcluirPagados] = usePersistedState<boolean>("cobros/excluirPagados", false);

	const hasActiveFilters =
		filtroTemporal !== "hoy" ||
		filtroEtapa !== null ||
		filtroEtiquetas.length > 0 ||
		filterValue !== "" ||
		sifcoFilterValue !== "" ||
		capitalMin !== undefined ||
		capitalMax !== undefined ||
		dateRange !== undefined ||
		excluirPagados;
	const resetFilters = () => {
		setFiltroTemporal("hoy");
		setFiltroEtapa(null);
		setFiltroEtiquetas([]);
		setFilterValue("");
		setSifcoFilterValue("");
		setCapitalMin(undefined);
		setCapitalMax(undefined);
		setExcluirPagados(false);
		setDateRange(undefined);
		setPickerRange(undefined);
		setFechaError(null);
		setPage(1);
	};

	// Debounce para el filtro de búsqueda (1 segundos)
	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedFilterValue(filterValue);
			setPage(1); // Reset a la primera página cuando cambia el filtro
		}, 1000);

		return () => clearTimeout(timer);
	}, [filterValue]);

	// Debounce para el filtro por número SIFCO (1 segundo)
	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedSifcoFilterValue(sifcoFilterValue);
			setPage(1);
		}, 1000);

		return () => clearTimeout(timer);
	}, [sifcoFilterValue]);

	const userRole = session?.user.role;

	const dashboardStats = useQuery({
		...orpc.getCobrosDashboardStats.queryOptions({
			input: {
				emailCobrador: !PERMISSIONS.canAssignCobros(userRole ?? "")
					? session?.user?.email
					: undefined,
			},
		}),
		enabled: !!session,
	});

	// Query para seguimientos pendientes (casos con proximoContacto)
	const seguimientosQuery = useQuery({
		...orpc.getCasosCobros.queryOptions({
			input: {
				limit: 100,
				offset: 0,
			},
		}),
		enabled: !!session,
		select: (data) => {
			const hoy = new Date();
			hoy.setHours(0, 0, 0, 0);
			const en7Dias = new Date(hoy);
			en7Dias.setDate(en7Dias.getDate() + 7);

			return data
				.filter((caso) => {
					if (!caso.proximoContacto) return false;
					const fecha = new Date(caso.proximoContacto);
					return fecha <= en7Dias;
				})
				.sort((a, b) => {
					const fechaA = new Date(a.proximoContacto!);
					const fechaB = new Date(b.proximoContacto!);
					return fechaA.getTime() - fechaB.getTime();
				});
		},
	});

	// Query para metas de mora del mes actual
	const now = new Date();
	const metasMoraQuery = useQuery({
		...orpc.getMetasMora.queryOptions({
			input: {
				mes: now.getMonth() + 1,
				anio: now.getFullYear(),
			},
		}),
		enabled: !!session,
	});

	// Categorías visibles según rol
	const categoriasVisibles = useMemo(() => {
		if (userRole === "cobros") {
			return ["mora_total", "mora_30", "mora_60", "mora_90", "mora_120"];
		}
		if (userRole === "cobros_supervisor") {
			return ["mora_total", "mora_30"];
		}
		// admin / gerencia
		return ["mora_total"];
	}, [userRole]);

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
				searchTerm: debouncedFilterValue || undefined,
				numeroSifco: debouncedSifcoFilterValue || undefined,
				time: fechaDesde || fechaHasta ? undefined : timeParam,
				emailCobrador: !PERMISSIONS.canAssignCobros(userRole ?? "")
					? session?.user?.email
					: undefined,
				fechaDesde,
				fechaHasta,
				etiquetas: filtroEtiquetas.length > 0 ? filtroEtiquetas : undefined,
				capitalMin,
				capitalMax,
				excluirPagadosMes: excluirPagados || undefined,
			},
		}),
		enabled: !!session,
	});

	const stats = dashboardStats.data?.estatusStats || [];
	const creditosData = todosLosCreditos.data;
	const creditos = creditosData?.data || [];
	const totalCreditos = creditosData?.total || 0;
	const totalPages = creditosData?.totalPages || 1;

	// Recalcular columnas cuando cambia el filtro de etapa: el CTA de contacto
	// rápido sólo aparece para estados de mora activa.
	const columns = useMemo(
		() => getCobrosColumns({ filtroEtapa }),
		[filtroEtapa],
	);

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
				};
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
	}, [creditosConDias, filtroTemporal, mostrarCompletadosIncobrables, filtroEtiquetas, filtroEtapa]);

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
			key: "en_convenio",
			label: "En Convenio",
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
			<div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
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
								.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
						</div>
						<p className="text-muted-foreground text-xs">
							Suma de todos los montos en mora
						</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="font-medium text-sm">
							Suma Total de Capital
						</CardTitle>
						<Banknote className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="font-bold text-2xl">
							Q
							{stats
								.reduce((sum, s) => sum + Number(s.sumaCapital || 0), 0)
								.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
						</div>
						<p className="text-muted-foreground text-xs">
							Suma de todos los capitales
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

			{/* Embudo Visual de Estados - Acordeón */}
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<TrendingDown className="h-5 w-5" />
						Embudo de Cobranza
					</CardTitle>
					<CardDescription>
						Distribución de casos por estado de mora — click en una etapa para
						ver los casos de mayor capital
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="space-y-1">
						{(
							[
								{
									key: "al_dia",
									label: "Al Día",
									color: "bg-green-100 text-green-800",
									barColor: "#22c55e",
								},
								{
									key: "mora_30",
									label: "Mora 30",
									color: "bg-yellow-100 text-yellow-800",
									barColor: "#eab308",
								},
								{
									key: "mora_60",
									label: "Mora 60",
									color: "bg-orange-100 text-orange-800",
									barColor: "#f97316",
								},
								{
									key: "mora_90",
									label: "Mora 90",
									color: "bg-red-100 text-red-800",
									barColor: "#ef4444",
								},
								{
									key: "mora_120",
									label: "Mora 120+",
									color: "bg-red-200 text-red-900",
									barColor: "#b91c1c",
								},
								{
									key: "incobrable",
									label: "Incobrable",
									color: "bg-gray-100 text-gray-800",
									barColor: "#6b7280",
								},
								{
									key: "completado",
									label: "Completado",
									color: "bg-blue-100 text-blue-800",
									barColor: "#3b82f6",
								},
							] satisfies EmbudoEstado[]
						).map((estado) => {
							const estadoStat = stats.find(
								(s) => s.estadoMora === estado.key,
							) || {
								totalCases: 0,
								montoTotal: "0",
								sumaCapital: "0",
								porcentaje: "0",
							};
							const maxCasos = Math.max(...stats.map((s) => s.totalCases), 1);

							return (
								<EmbudoRow
									key={estado.key}
									estado={estado}
									estadoStats={estadoStat}
									maxCasos={maxCasos}
									emailCobrador={
										!PERMISSIONS.canAssignCobros(userRole ?? "")
											? (session?.user?.email ?? undefined)
											: undefined
									}
									onNavigate={(id, tipo) => {
										navigate({
											to: "/cobros/$id",
											params: { id },
											search: {
												tipo: tipo as "caso" | "contrato",
											},
										});
									}}
								/>
							);
						})}
					</div>
				</CardContent>
			</Card>

			{/* Seguimientos Pendientes */}
			{seguimientosQuery.data && seguimientosQuery.data.length > 0 && (
				<Card className="border-amber-200">
					<CardHeader className="pb-3">
						<CardTitle className="flex items-center gap-2">
							<CalendarClock className="h-5 w-5 text-amber-600" />
							Seguimientos Pendientes
						</CardTitle>
						<CardDescription>
							Casos con seguimiento programado para hoy o los próximos 7 días
						</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="space-y-2">
							{seguimientosQuery.data.map((caso) => {
								const fecha = new Date(caso.proximoContacto!);
								const hoy = new Date();
								hoy.setHours(0, 0, 0, 0);
								const esHoy = fecha.toDateString() === hoy.toDateString();
								const esPasado = fecha < hoy;

								return (
									<Link
										key={caso.id}
										to="/cobros/$id"
										params={{ id: caso.contratoId || caso.id }}
										search={{ tipo: "caso" as const }}
										className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted/50"
									>
										<div className="flex items-center gap-3">
											<div
												className={`h-2 w-2 rounded-full ${esPasado ? "bg-red-500" : esHoy ? "bg-amber-500" : "bg-green-500"}`}
											/>
											<div>
												<p className="font-medium text-sm">
													{caso.clienteNombre || "Sin nombre"}
												</p>
												<p className="text-muted-foreground text-xs">
													{caso.vehiculoMarca} {caso.vehiculoModelo}{" "}
													{caso.vehiculoYear}
												</p>
											</div>
										</div>
										<div className="text-right">
											<p
												className={`font-medium text-sm ${esPasado ? "text-red-600" : esHoy ? "text-amber-600" : "text-muted-foreground"}`}
											>
												{esHoy
													? "Hoy"
													: esPasado
														? "Vencido"
														: fecha.toLocaleDateString("es-GT")}
											</p>
											{esPasado && (
												<p className="text-red-500 text-xs">
													{fecha.toLocaleDateString("es-GT")}
												</p>
											)}
										</div>
									</Link>
								);
							})}
						</div>
					</CardContent>
				</Card>
			)}

			{/* Metas de Mora del Mes */}
			{metasMoraQuery.data && metasMoraQuery.data.length > 0 && (
				<Card>
					<CardHeader className="pb-3">
						<CardTitle className="flex items-center gap-2">
							<Target className="h-5 w-5 text-blue-600" />
							Metas de Mora —{" "}
							{now.toLocaleDateString("es-GT", {
								month: "long",
								year: "numeric",
							})}
						</CardTitle>
						<CardDescription>
							Porcentajes objetivo de mora para este mes
						</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
							{metasMoraQuery.data
								.filter((m) => categoriasVisibles.includes(m.categoria))
								.sort((a, b) => {
									const orden = [
										"mora_total",
										"mora_30",
										"mora_60",
										"mora_90",
										"mora_120",
									];
									return (
										orden.indexOf(a.categoria) - orden.indexOf(b.categoria)
									);
								})
								.map((meta) => {
									const label: Record<string, string> = {
										mora_total: "Mora Total",
										mora_30: "Mora 30",
										mora_60: "Mora 60",
										mora_90: "Mora 90",
										mora_120: "Mora 120+",
									};
									const color: Record<string, string> = {
										mora_total: "border-blue-200 bg-blue-50",
										mora_30: "border-yellow-200 bg-yellow-50",
										mora_60: "border-orange-200 bg-orange-50",
										mora_90: "border-red-200 bg-red-50",
										mora_120: "border-red-300 bg-red-100",
									};
									const textColor: Record<string, string> = {
										mora_total: "text-blue-700",
										mora_30: "text-yellow-700",
										mora_60: "text-orange-700",
										mora_90: "text-red-700",
										mora_120: "text-red-800",
									};

									// Buscar el % real del embudo
									const statReal = stats.find((s) => {
										if (meta.categoria === "mora_total") return false;
										return s.estadoMora === meta.categoria;
									});
									const porcentajeReal = statReal
										? Number.parseFloat(statReal.porcentaje)
										: undefined;

									// Para mora_total, sumar sólo moras activas
									const porcentajeMoraTotal =
										meta.categoria === "mora_total"
											? stats
													.filter(
														(s) =>
															s.estadoMora !== "al_dia" &&
															s.estadoMora !== "completado" &&
															s.estadoMora !== "incobrable",
													)
													.reduce(
														(sum, s) =>
															sum + Number.parseFloat(s.porcentaje || "0"),
														0,
													)
											: undefined;

									const actual =
										meta.categoria === "mora_total"
											? porcentajeMoraTotal
											: porcentajeReal;
									const objetivo = Number.parseFloat(meta.valorObjetivo);
									const cumplida =
										actual !== undefined ? actual <= objetivo : undefined;

									return (
										<div
											key={meta.id}
											className={`rounded-lg border p-3 ${color[meta.categoria] || ""}`}
										>
											<p className="font-medium text-muted-foreground text-xs">
												{label[meta.categoria] || meta.categoria}
											</p>
											<p
												className={`font-bold text-2xl ${actual !== undefined ? (cumplida ? "text-green-600" : "text-red-600") : textColor[meta.categoria] || ""}`}
											>
												{actual !== undefined ? `${actual.toFixed(2)}%` : "—"}
											</p>
											<p className="text-muted-foreground text-xs">
												Meta: {objetivo.toFixed(2)}%
												{actual !== undefined &&
													(cumplida ? (
														<span className="ml-1 font-semibold text-green-600">
															✓
														</span>
													) : (
														<span className="ml-1 font-semibold text-red-600">
															↑ {(actual - objetivo).toFixed(2)}%
														</span>
													))}
											</p>
										</div>
									);
								})}
						</div>
					</CardContent>
				</Card>
			)}

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
						<div className="flex items-center gap-2">
							<MassWhatsappModal
								filtros={{
									estadoMora: filtroEtapa || undefined,
									searchTerm: debouncedFilterValue || undefined,
									numeroSifco: debouncedSifcoFilterValue || undefined,
									time: fechaDesde || fechaHasta ? undefined : timeParam,
									etiquetas:
										filtroEtiquetas.length > 0 ? filtroEtiquetas : undefined,
									fechaDesde,
									fechaHasta,
									excluirPagadosMes: excluirPagados || undefined,
								}}
								etiquetaLabels={ETIQUETA_LABELS_FILTRO}
								totalDestinatarios={totalCreditos}
							>
								<Button
									variant="outline"
									size="sm"
									className="flex items-center gap-2"
								>
									<MessageCircle className="h-4 w-4" />
									Enviar WhatsApp masivo
								</Button>
							</MassWhatsappModal>
							<Badge variant="outline" className="text-sm">
								{totalCreditos} casos
							</Badge>
						</div>
					</div>
				</CardHeader>
				<CardContent className="space-y-4">
					{/* Data Table */}
					<DataTable
						columns={columns}
						data={creditosFiltrados}
						isLoading={todosLosCreditos.isLoading}
						setGlobalFilterParam={setFilterValue}
						searchPlaceholder="Buscar por cliente o placa"
						extraSearch={
							<Input
								placeholder="Buscar por No. SIFCO (exacto)"
								value={sifcoFilterValue}
								onChange={(e) => setSifcoFilterValue(e.target.value)}
								className="max-w-xs"
							/>
						}
						onRowClick={(row) => {
							const linkId = row.numeroCredito || row.contratoId;
							const tipoLink = row.casoCobroId ? "caso" : "contrato";
							navigate({
								to: "/cobros/$id",
								params: { id: linkId },
								search: { tipo: tipoLink },
							});
						}}
						filterContent={
							<div className="flex w-full flex-col gap-3">
								{/* Período: presets rápidos + rango personalizado */}
								<div className="flex flex-col gap-2">
									<span className="font-semibold text-muted-foreground text-xs uppercase tracking-wide">
										Período de pago
									</span>
									<div className="flex flex-wrap items-center gap-2">
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
										<Separator orientation="vertical" className="mx-1 h-6" />
										<DateRangeFilter
											dateRange={pickerRange}
											required
											onDateRangeChange={(range) => {
												if (!range) {
													setDateRange(undefined);
													setPickerRange(undefined);
													setFechaError(null);
													setPage(1);
													return;
												}
												setFechaError(null);
												setDateRange(range);    // persiste y afecta la query
												setPickerRange(range);  // actualiza display
												if (!range.from || !range.to) return;
												setFiltroTemporal("todos");
												setPage(1);
											}}
										/>
										{fechaError && (
											<span className="text-destructive text-xs">
												{fechaError}
											</span>
										)}
									</div>
								</div>

								{/* Etapa de mora */}
								<div className="flex flex-col gap-2">
									<span className="font-semibold text-muted-foreground text-xs uppercase tracking-wide">
										Etapa de mora
									</span>
									<div className="flex flex-wrap items-center gap-2">
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
									</div>
								</div>

								{/* Cuota actual */}
								<div className="flex flex-col gap-2">
									<span className="font-semibold text-muted-foreground text-xs uppercase tracking-wide">
										Cuota actual
									</span>
									<div className="flex flex-wrap items-center gap-2">
										<Button
											variant={excluirPagados ? "default" : "outline"}
											size="sm"
											onClick={() => {
												setExcluirPagados(!excluirPagados);
												setPage(1);
											}}
										>
											Ocultar los que ya pagaron su cuota
										</Button>
									</div>
								</div>

								{/* Etiquetas */}
								<div className="flex flex-col gap-2">
									<span className="font-semibold text-muted-foreground text-xs uppercase tracking-wide">
										Etiquetas
									</span>
									<div className="flex flex-wrap items-center gap-2">
										<Button
											variant={
												filtroEtiquetas.length === 0 ? "default" : "outline"
											}
											size="sm"
											onClick={() => {
												setFiltroEtiquetas([]);
												setPage(1);
											}}
										>
											Todas
										</Button>
										{Object.entries(ETIQUETA_LABELS_FILTRO).map(
											([key, label]) => (
												<Badge
													key={key}
													className={`cursor-pointer ${filtroEtiquetas.includes(key) ? "bg-primary text-primary-foreground" : "bg-gray-50 text-gray-600 hover:bg-gray-100"}`}
													onClick={() => {
														setFiltroEtiquetas((prev) =>
															prev.includes(key)
																? prev.filter((e) => e !== key)
																: [...prev, key],
														);
														setPage(1);
													}}
												>
													{label}
												</Badge>
											),
										)}
									</div>
								</div>

								{/* Capital */}
								<div className="flex flex-col gap-2">
									<span className="font-semibold text-muted-foreground text-xs uppercase tracking-wide">
										Capital
									</span>
									<CapitalRangeFilter
										capitalMin={capitalMin}
										capitalMax={capitalMax}
										onCapitalRangeChange={(min, max) => {
											setCapitalMin(min);
											setCapitalMax(max);
											setPage(1);
										}}
									/>
								</div>
								{hasActiveFilters && (
									<div className="border-t pt-2">
										<Button variant="ghost" size="sm" onClick={resetFilters} className="w-full text-muted-foreground">
											<X className="mr-1 h-3 w-3" />
											Limpiar filtros
											<Badge variant="secondary" className="ml-1 h-4 px-1 text-xs">
												{[filtroTemporal !== "hoy", filtroEtapa !== null, filtroEtiquetas.length > 0, filterValue !== "", sifcoFilterValue !== "", capitalMin !== undefined, capitalMax !== undefined, dateRange !== undefined, excluirPagados].filter(Boolean).length}
											</Badge>
										</Button>
									</div>
								)}
							</div>
						}
						tableContainerClass="max-h-[600px] overflow-y-auto"
						pageSizeOptions={[25, 50, 75, 100, 200]}
						serverPagination={{
							page: page,
							pageSize: pageSize,
							totalPages: totalPages,
							totalItems: totalCreditos,
							onPageChange: (newPage) => setPage(newPage),
							onPageSizeChange: (newSize) => {
								setPageSize(newSize);
								setPage(1);
							},
						}}
					/>
				</CardContent>
			</Card>
		</div>
	);
}

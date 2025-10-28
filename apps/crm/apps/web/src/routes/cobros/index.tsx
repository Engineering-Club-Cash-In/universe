import {
	draggable,
	dropTargetForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { differenceInDays, format } from "date-fns";
import { es } from "date-fns/locale";
import {
	AlertCircle,
	Banknote,
	Calendar,
	CalendarClock,
	Car,
	CheckCircle2,
	Eye,
	EyeOff,
	FileText,
	Mail,
	MapPin,
	MessageCircle,
	Phone,
	Shield,
	Target,
	TrendingDown,
	TrendingUp,
	Users,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PERMISSIONS } from "server/src/types/roles";
import { toast } from "sonner";
import invariant from "tiny-invariant";
import { ContactoModal } from "@/components/contacto-modal";
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
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { client, orpc } from "@/utils/orpc";

// Función para calcular la próxima fecha de pago y días restantes
function calcularProximaFechaPago(diaPagoMensual: number | null) {
	if (!diaPagoMensual) return null;

	// Normalizar fecha actual a medianoche para comparación correcta
	const ahora = new Date();
	const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
	const diaActual = hoy.getDate();
	const mesActual = hoy.getMonth();
	const añoActual = hoy.getFullYear();

	// Determinar si el pago es este mes o el siguiente
	let fechaPago: Date;
	if (diaActual <= diaPagoMensual) {
		// El día de pago no ha pasado este mes
		fechaPago = new Date(añoActual, mesActual, diaPagoMensual);
	} else {
		// El día de pago ya pasó, usar el mes siguiente
		fechaPago = new Date(añoActual, mesActual + 1, diaPagoMensual);
	}

	// Manejar casos donde el mes no tiene suficientes días (ej: 31 en febrero)
	if (fechaPago.getDate() !== diaPagoMensual) {
		// Si el día no coincide, usar el último día del mes
		fechaPago = new Date(fechaPago.getFullYear(), fechaPago.getMonth() + 1, 0);
	}

	// Calcular días restantes
	const diasRestantes = differenceInDays(fechaPago, hoy);

	return {
		fechaPago,
		diasRestantes: Math.max(0, diasRestantes),
	};
}

// Draggable contract card component
function DraggableContractCard({
	contrato,
	getEstadoBadgeColor,
	onContratoClick,
}: {
	contrato: any;
	getEstadoBadgeColor: (estado: string) => string;
	onContratoClick: (contrato: any) => void;
}) {
	const ref = useRef<HTMLDivElement | null>(null);
	const [isDragging, setIsDragging] = useState(false);

	const estadoVisual =
		contrato.estadoContrato === "activo"
			? contrato.estadoMora || "al_dia"
			: contrato.estadoContrato;

	useEffect(() => {
		const element = ref.current;
		invariant(element);

		return draggable({
			element,
			getInitialData: () => ({
				type: "contrato",
				contratoId: contrato.contratoId,
				casoCobroId: contrato.casoCobroId,
				currentEstado: estadoVisual,
			}),
			onDragStart: () => setIsDragging(true),
			onDrop: () => setIsDragging(false),
		});
	}, [contrato.contratoId, contrato.casoCobroId, estadoVisual]);

	const esAlDia =
		estadoVisual === "al_dia" ||
		(!contrato.casoCobroId && contrato.estadoContrato === "activo");
	const linkId = contrato.casoCobroId || contrato.contratoId;
	const tipoLink = contrato.casoCobroId ? "caso" : "contrato";

	return (
		<Card
			ref={ref}
			className={`cursor-pointer p-3 transition-shadow hover:shadow-md ${isDragging ? "opacity-50" : ""}`}
			onClick={() => onContratoClick(contrato)}
		>
			<div className="space-y-2">
				<div className="flex items-start justify-between gap-2">
					<div className="flex min-w-0 flex-1 items-center gap-2">
						<Car className="h-4 w-4 shrink-0 text-muted-foreground" />
						<span className="min-w-0 truncate font-medium text-sm">
							{contrato.vehiculoMarca} {contrato.vehiculoModelo}{" "}
							{contrato.vehiculoYear}
						</span>
					</div>
					<Badge variant="outline" className="shrink-0">
						{contrato.vehiculoPlaca}
					</Badge>
				</div>

				<Badge className={`${getEstadoBadgeColor(estadoVisual)}`}>
					{esAlDia
						? "AL DÍA"
						: estadoVisual?.replace("_", " ")?.toUpperCase()}
				</Badge>

				<div className="flex items-center gap-1 text-muted-foreground text-xs">
					<Users className="h-3 w-3" />
					{contrato.clienteNombre}
				</div>

				<div className="flex items-center gap-1 font-medium text-green-600 text-xs">
					<Banknote className="h-3 w-3" />Q
					{Number(contrato.montoEnMora).toLocaleString()}
				</div>

				<div className="flex items-center gap-1 text-muted-foreground text-xs">
					<CalendarClock className="h-3 w-3" />
					{contrato.diasMoraMaximo} días de mora
				</div>

				{(() => {
					const infoPago = calcularProximaFechaPago(contrato.diaPagoMensual);
					if (!infoPago) return null;

					return (
						<div className="space-y-1 border-t pt-2">
							<div className="flex items-center gap-1 text-blue-600 text-xs">
								<Calendar className="h-3 w-3" />
								<span className="font-medium">
									Fecha de pago:{" "}
									{format(infoPago.fechaPago, "dd/MM/yyyy", { locale: es })}
								</span>
							</div>
							<div className="text-muted-foreground text-xs">
								{infoPago.diasRestantes === 0 ? (
									<span className="font-medium text-red-600">¡Hoy es el día de pago!</span>
								) : infoPago.diasRestantes === 1 ? (
									<span className="font-medium text-orange-600">Queda 1 día</span>
								) : (
									<span>Quedan {infoPago.diasRestantes} días</span>
								)}
							</div>
						</div>
					);
				})()}
			</div>
		</Card>
	);
}

// Droppable status column component
function DroppableStatusColumn({
	estado,
	contratos,
	totalMonto,
	count,
	getEstadoBadgeColor,
	onDropContrato,
	onContratoClick,
}: {
	estado: any;
	contratos: any[];
	totalMonto: number;
	count: number;
	getEstadoBadgeColor: (estado: string) => string;
	onDropContrato: (contratoId: string, casoCobroId: string | null, newEstado: string) => void;
	onContratoClick: (contrato: any) => void;
}) {
	const ref = useRef<HTMLDivElement | null>(null);
	const [isDraggedOver, setIsDraggedOver] = useState(false);

	useEffect(() => {
		const element = ref.current;
		invariant(element);

		return dropTargetForElements({
			element,
			getData: () => ({ type: "estado", estadoKey: estado.key }),
			canDrop: ({ source }) => source.data.type === "contrato",
			onDragEnter: () => setIsDraggedOver(true),
			onDragLeave: () => setIsDraggedOver(false),
			onDrop: ({ source }) => {
				setIsDraggedOver(false);
				const contratoId = source.data.contratoId as string;
				const casoCobroId = source.data.casoCobroId as string | null;
				const currentEstado = source.data.currentEstado as string;

				if (contratoId && currentEstado !== estado.key) {
					onDropContrato(contratoId, casoCobroId, estado.key);
				}
			},
		});
	}, [estado.key, onDropContrato]);

	const Icon = estado.icon;

	return (
		<Card
			className={`h-fit min-w-80 shrink-0 ${isDraggedOver ? "ring-2 ring-blue-500" : ""}`}
		>
			<CardHeader className="pb-3">
				<div className="flex items-center justify-between">
					<Badge className={estado.color}>{estado.label}</Badge>
					<span className="text-muted-foreground text-xs">{count} casos</span>
				</div>
				<CardTitle className="font-medium text-sm">
					<div className="flex items-center gap-2">
						<Icon className="h-4 w-4" />
						{estado.label}
					</div>
				</CardTitle>
				<CardDescription className="text-xs">
					Q{totalMonto.toLocaleString()} en mora
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3" ref={ref}>
				{contratos.length === 0 ? (
					<div className="py-8 text-center text-muted-foreground">
						<Target className="mx-auto mb-2 h-8 w-8 opacity-50" />
						<p className="text-sm">No hay casos</p>
					</div>
				) : (
					contratos.map((contrato) => (
						<DraggableContractCard
							key={contrato.contratoId}
							contrato={contrato}
							getEstadoBadgeColor={getEstadoBadgeColor}
							onContratoClick={onContratoClick}
						/>
					))
				)}
			</CardContent>
		</Card>
	);
}

export const Route = createFileRoute("/cobros/")({
	component: RouteComponent,
});

function RouteComponent() {
	const { data: session } = authClient.useSession();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [showHiddenColumns, setShowHiddenColumns] = useState(false);

	// Obtener estadísticas del dashboard
	const dashboardStats = useQuery({
		...orpc.getCobrosDashboardStats.queryOptions(),
		enabled: !!session,
	});

	// Obtener todos los contratos (al día, en mora, incobrables)
	const todosLosContratos = useQuery({
		...orpc.getTodosLosContratos.queryOptions({
			input: {
				limit: 20,
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

	// Verificar permisos
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

	const stats = dashboardStats.data?.estatusStats || [];
	const contratos = todosLosContratos.data || [];

	// Helper function to get badge color for estado
	const getEstadoBadgeColor = (estado: string) => {
		switch (estado) {
			case "al_dia":
				return "bg-green-100 text-green-800";
			case "mora_30":
				return "bg-yellow-100 text-yellow-800";
			case "mora_60":
				return "bg-orange-100 text-orange-800";
			case "mora_90":
				return "bg-red-100 text-red-800";
			case "mora_120":
				return "bg-red-200 text-red-900";
			case "incobrable":
				return "bg-gray-100 text-gray-800";
			case "completado":
				return "bg-blue-100 text-blue-800";
			default:
				return "bg-gray-100 text-gray-800";
		}
	};

	// Handler for dropping contracts into new columns
	const handleDropContrato = (
		contratoId: string,
		casoCobroId: string | null,
		newEstado: string,
	) => {
		// TODO: Implement API call to update contract status
		toast.info(`Mover contrato ${contratoId} a ${newEstado}`);
	};

	// Handler for clicking on a contract card
	const handleContratoClick = (contrato: any) => {
		const linkId = contrato.casoCobroId || contrato.contratoId;
		const tipoLink = contrato.casoCobroId ? "caso" : "contrato";
		navigate({
			to: "/cobros/$id",
			params: { id: linkId },
			search: { tipo: tipoLink },
		});
	};

	// Crear embudo visual de estados
	const embudoEstados = [
		{
			key: "al_dia",
			label: "Al Día",
			color: "bg-green-100 text-green-800",
			icon: CheckCircle2,
		},
		{
			key: "mora_30",
			label: "Mora 30",
			color: "bg-yellow-100 text-yellow-800",
			icon: AlertCircle,
		},
		{
			key: "mora_60",
			label: "Mora 60",
			color: "bg-orange-100 text-orange-800",
			icon: AlertCircle,
		},
		{
			key: "mora_90",
			label: "Mora 90",
			color: "bg-red-100 text-red-800",
			icon: AlertCircle,
		},
		{
			key: "mora_120",
			label: "Mora 120",
			color: "bg-red-200 text-red-900",
			icon: AlertCircle,
		},
		{
			key: "incobrable",
			label: "Incobrable",
			color: "bg-gray-100 text-gray-800",
			icon: FileText,
		},
		{
			key: "completado",
			label: "Completado",
			color: "bg-blue-100 text-blue-800",
			icon: CheckCircle2,
		},
	];

	const getEstadoStats = (estado: string) => {
		return (
			stats.find((s) => s.estadoMora === estado) || {
				totalCases: 0,
				montoTotal: "0",
			}
		);
	};

	// Filter estados based on visibility setting
	const estadosVisibles = showHiddenColumns
		? embudoEstados
		: embudoEstados.filter(
				(estado) => estado.key !== "incobrable" && estado.key !== "completado",
			);

	// Group contracts by estado
	const contratosPorEstado = estadosVisibles.map((estado) => {
		const estadoContratos = contratos.filter((contrato) => {
			const estadoVisual =
				contrato.estadoContrato === "activo"
					? contrato.estadoMora || "al_dia"
					: contrato.estadoContrato;
			return estadoVisual === estado.key;
		});

		const totalMonto = estadoContratos.reduce(
			(sum, contrato) => sum + Number(contrato.montoEnMora || 0),
			0,
		);

		return {
			estado,
			contratos: estadoContratos,
			totalMonto,
			count: estadoContratos.length,
		};
	});

	return (
		<div className="container mx-auto space-y-6 p-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="font-bold text-3xl">Dashboard de Cobros</h1>
					<p className="text-muted-foreground">
						Gestión y seguimiento de cobranza
					</p>
				</div>
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
						<div className="font-bold text-2xl">
							{dashboardStats.data?.totalCasosAsignados || 0}
						</div>
						<p className="text-muted-foreground text-xs">
							Casos bajo tu responsabilidad
						</p>
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
						<div className="font-bold text-2xl">85%</div>
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
						{(() => {
							// Calcular el máximo de casos para barras proporcionales
							const maxCasos = Math.max(
								...embudoEstados.map(
									(estado) => getEstadoStats(estado.key).totalCases,
								),
								1,
							);

							return embudoEstados.map((estado) => {
								const stats = getEstadoStats(estado.key);
								const Icon = estado.icon;
								const porcentaje = (stats.totalCases / maxCasos) * 100;

								return (
									<div
										key={estado.key}
										className="group flex items-center gap-3 rounded-lg p-3 transition-all hover:bg-muted/50"
									>
										{/* Ícono y Badge */}
										<div className="flex w-32 shrink-0 items-center gap-2">
											<Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
											<Badge className={`${estado.color} whitespace-nowrap text-xs`}>
												{estado.label}
											</Badge>
										</div>

										{/* Barra de progreso */}
										<div className="relative flex-1">
											<div className="h-10 w-full overflow-hidden rounded-md bg-muted">
												<div
													className="flex h-full items-center justify-between px-3 transition-all duration-300 group-hover:opacity-80"
													style={{
														width: `${Math.max(porcentaje, 8)}%`,
														backgroundColor: `hsl(0, 0%, ${100 - porcentaje * 0.7}%)`,
													}}
												>
													<span
														className="font-semibold text-sm"
														style={{
															color: porcentaje > 50 ? "white" : "#1f2937",
														}}
													>
														{stats.totalCases} casos
													</span>
												</div>
											</div>
										</div>

										{/* Monto */}
										<div className="w-32 shrink-0 text-right font-medium text-sm">
											Q{Number(stats.montoTotal || 0).toLocaleString()}
										</div>
									</div>
								);
							});
						})()}
					</div>
				</CardContent>
			</Card>

		{/* Kanban Board de Cobranza */}
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<div>
					<h2 className="font-bold text-2xl">Tablero de Cobranza</h2>
					<p className="text-muted-foreground">
						Arrastra los casos entre columnas para actualizar su estado
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Checkbox
						id="showHiddenColumns"
						checked={showHiddenColumns}
						onCheckedChange={(checked) =>
							setShowHiddenColumns(checked === true)
						}
					/>
					<Label
						htmlFor="showHiddenColumns"
						className="cursor-pointer text-sm font-medium"
					>
						{showHiddenColumns ? (
							<span className="flex items-center gap-2">
								<Eye className="h-4 w-4" />
								Ocultar columnas finales
							</span>
						) : (
							<span className="flex items-center gap-2">
								<EyeOff className="h-4 w-4" />
								Mostrar columnas finales
							</span>
						)}
					</Label>
				</div>
			</div>

			<div className="flex gap-6 overflow-x-auto pb-4">
				{contratosPorEstado.map(({ estado, contratos, totalMonto, count }) => (
					<DroppableStatusColumn
						key={estado.key}
						estado={estado}
						contratos={contratos}
						totalMonto={totalMonto}
						count={count}
						getEstadoBadgeColor={getEstadoBadgeColor}
						onDropContrato={handleDropContrato}
						onContratoClick={handleContratoClick}
					/>
				))}
			</div>
		</div>
		</div>
	);
}

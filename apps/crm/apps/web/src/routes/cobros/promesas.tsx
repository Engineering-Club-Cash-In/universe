import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	CalendarClock,
	CalendarDays,
	ChevronRight,
	Clock,
	Loader2,
	Target,
	TriangleAlert,
	UserRound,
} from "lucide-react";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";
import { PERMISSIONS } from "@/lib/roles";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/cobros/promesas")({
	component: RouteComponent,
});

type Categoria = "vencida" | "vence_hoy" | "por_vencer" | "programada";

type AlertaPromesa = {
	id: string;
	casoCobroId: string;
	numeroCreditoSifco: string | null;
	clienteNombre: string | null;
	asesorNombre: string | null;
	fechaPrometida: string | Date | null;
	fechaAlerta: string | Date | null;
	montoComprometido: string | null;
	cuotaInicio: number | null;
	cuotaFin: number | null;
	incluyeMora: boolean;
	estadoPromesa: string | null;
	categoria: Categoria;
};

// Config visual por categoría. Las vencidas son "prioridad alta" (CB-031).
const CATEGORIA_CONFIG: Record<
	Categoria,
	{
		label: string;
		descripcion: string;
		icon: typeof Clock;
		card: string;
		iconWrap: string;
		iconColor: string;
		badge: string;
		fechaColor: string;
	}
> = {
	vencida: {
		label: "Vencidas",
		descripcion: "La fecha comprometida ya pasó — prioridad alta",
		icon: TriangleAlert,
		card: "border-red-200 dark:border-red-900/50",
		iconWrap: "bg-red-100 dark:bg-red-900/40",
		iconColor: "text-red-600 dark:text-red-400",
		badge: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
		fechaColor: "text-red-600 dark:text-red-400",
	},
	vence_hoy: {
		label: "Vencen hoy",
		descripcion: "El cliente prometió pagar hoy",
		icon: CalendarClock,
		card: "border-amber-200 dark:border-amber-900/50",
		iconWrap: "bg-amber-100 dark:bg-amber-900/40",
		iconColor: "text-amber-600 dark:text-amber-400",
		badge:
			"bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
		fechaColor: "text-amber-600 dark:text-amber-400",
	},
	por_vencer: {
		label: "Por vencer",
		descripcion: "Se acerca la fecha comprometida — dales seguimiento",
		icon: Clock,
		card: "border-sky-200 dark:border-sky-900/50",
		iconWrap: "bg-sky-100 dark:bg-sky-900/40",
		iconColor: "text-sky-600 dark:text-sky-400",
		badge: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-400",
		fechaColor: "text-sky-600 dark:text-sky-400",
	},
	programada: {
		label: "Próximas",
		descripcion: "Aún dentro de plazo — sin acción pendiente todavía",
		icon: CalendarDays,
		card: "border-border",
		iconWrap: "bg-muted",
		iconColor: "text-muted-foreground",
		badge: "bg-muted text-muted-foreground",
		fechaColor: "text-muted-foreground",
	},
};

const ORDEN_CATEGORIAS: Categoria[] = [
	"vencida",
	"vence_hoy",
	"por_vencer",
	"programada",
];

function formatFechaGT(fecha: string | Date | null): string {
	if (!fecha) return "Sin fecha";
	return new Date(fecha).toLocaleDateString("es-GT", {
		day: "2-digit",
		month: "short",
		year: "numeric",
		timeZone: "America/Guatemala",
	});
}

function formatMonto(monto: string | null): string | null {
	if (monto == null || monto === "") return null;
	const n = Number(monto);
	if (!Number.isFinite(n) || n <= 0) return null;
	return `Q${n.toLocaleString("es-GT", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})}`;
}

function rangoCuotas(a: AlertaPromesa): string | null {
	if (a.cuotaInicio == null && a.cuotaFin == null) {
		return a.incluyeMora ? "Solo mora" : null;
	}
	const rango =
		a.cuotaInicio === a.cuotaFin
			? `Cuota ${a.cuotaInicio}`
			: `Cuotas ${a.cuotaInicio}–${a.cuotaFin}`;
	return a.incluyeMora ? `${rango} + mora` : rango;
}

function AlertaCard({
	alerta,
	mostrarAsesor,
}: {
	alerta: AlertaPromesa;
	mostrarAsesor: boolean;
}) {
	const config = CATEGORIA_CONFIG[alerta.categoria];
	const Icon = config.icon;
	const monto = formatMonto(alerta.montoComprometido);
	const cuotas = rangoCuotas(alerta);

	return (
		<Link
			to="/cobros/$id"
			params={{ id: alerta.casoCobroId }}
			search={{ tipo: "caso" as const }}
			className={`flex items-start justify-between gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50 ${config.card}`}
		>
			<div className="flex min-w-0 items-start gap-3">
				<div
					className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${config.iconWrap}`}
				>
					<Icon className={`h-4 w-4 ${config.iconColor}`} />
				</div>
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
						<span className="font-medium text-sm">
							{alerta.clienteNombre || "Cliente sin nombre"}
						</span>
						{alerta.numeroCreditoSifco && (
							<span className="font-mono text-muted-foreground text-xs">
								{alerta.numeroCreditoSifco}
							</span>
						)}
						{alerta.categoria === "vencida" && (
							<Badge
								variant="outline"
								className={`text-[11px] ${config.badge}`}
							>
								Prioridad alta
							</Badge>
						)}
					</div>
					<div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
						<span className={`font-medium ${config.fechaColor}`}>
							{alerta.categoria === "vencida" ? "Venció" : "Vence"}{" "}
							{formatFechaGT(alerta.fechaPrometida)}
						</span>
						{monto && (
							<span>
								Comprometido:{" "}
								<span className="font-medium text-foreground">{monto}</span>
							</span>
						)}
						{cuotas && <span>{cuotas}</span>}
						{mostrarAsesor && alerta.asesorNombre && (
							<span className="inline-flex items-center gap-1">
								<UserRound className="h-3 w-3" />
								{alerta.asesorNombre}
							</span>
						)}
					</div>
				</div>
			</div>
			<ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
		</Link>
	);
}

function RouteComponent() {
	const { data: session } = authClient.useSession();
	const userRole = session?.user?.role;
	const esSupervisor = PERMISSIONS.canAssignCobros(userRole ?? "");

	const alertasQuery = useQuery({
		...orpc.getAlertasPromesas.queryOptions({ input: {} }),
		enabled: !!session,
	});
	// El cliente ORPC infiere `{}` para las queries de cobros; casteo al shape
	// real del endpoint para tipar la lista.
	const alertas = (alertasQuery.data as AlertaPromesa[] | undefined) ?? [];

	const grupos = useMemo(() => {
		const map: Record<Categoria, AlertaPromesa[]> = {
			vencida: [],
			vence_hoy: [],
			por_vencer: [],
			programada: [],
		};
		for (const a of alertas) map[a.categoria].push(a);
		return map;
	}, [alertas]);

	if (userRole && !PERMISSIONS.canAccessCobros(userRole)) {
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

	const total = alertas.length;

	return (
		<div className="container mx-auto space-y-6 p-6">
			<div>
				<h1 className="flex items-center gap-2 font-bold text-3xl">
					<Target className="h-7 w-7 text-primary" />
					Alertas de Promesas
				</h1>
				<p className="text-muted-foreground">
					{esSupervisor
						? "Promesas del equipo que requieren seguimiento — vencidas, de hoy y próximas a vencer"
						: "Tus promesas que requieren seguimiento — vencidas, de hoy y próximas a vencer"}
				</p>
			</div>

			{/* Resumen por categoría */}
			<div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
				{ORDEN_CATEGORIAS.map((cat) => {
					const config = CATEGORIA_CONFIG[cat];
					const Icon = config.icon;
					return (
						<Card key={cat} className={config.card}>
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="font-medium text-sm">
									{config.label}
								</CardTitle>
								<Icon className={`h-4 w-4 ${config.iconColor}`} />
							</CardHeader>
							<CardContent>
								<div className={`font-bold text-2xl ${config.iconColor}`}>
									{grupos[cat].length}
								</div>
								<p className="text-muted-foreground text-xs">
									{config.descripcion}
								</p>
							</CardContent>
						</Card>
					);
				})}
			</div>

			{alertasQuery.isLoading ? (
				<Card>
					<CardContent className="flex items-center justify-center gap-2 py-12">
						<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
						<span className="text-muted-foreground text-sm">
							Cargando promesas...
						</span>
					</CardContent>
				</Card>
			) : total === 0 ? (
				<Card>
					<CardContent className="flex flex-col items-center justify-center py-12">
						<Target className="mb-4 h-12 w-12 text-muted-foreground/40" />
						<p className="font-medium text-lg text-muted-foreground">
							No hay promesas por atender
						</p>
						<p className="text-muted-foreground text-sm">
							Cuando registres una promesa de pago aparecerá aquí antes de que
							venza.
						</p>
					</CardContent>
				</Card>
			) : (
				<div className="space-y-6">
					{ORDEN_CATEGORIAS.map((cat) => {
						const items = grupos[cat];
						if (items.length === 0) return null;
						const config = CATEGORIA_CONFIG[cat];
						const Icon = config.icon;
						return (
							<Card key={cat}>
								<CardHeader className="pb-3">
									<CardTitle className="flex items-center gap-2 text-lg">
										<Icon className={`h-5 w-5 ${config.iconColor}`} />
										{config.label}
										<Badge variant="secondary" className="ml-1">
											{items.length}
										</Badge>
									</CardTitle>
									<CardDescription>{config.descripcion}</CardDescription>
								</CardHeader>
								<CardContent>
									<div className="space-y-2">
										{items.map((alerta) => (
											<AlertaCard
												key={alerta.id}
												alerta={alerta}
												mostrarAsesor={esSupervisor}
											/>
										))}
									</div>
								</CardContent>
							</Card>
						);
					})}
				</div>
			)}
		</div>
	);
}

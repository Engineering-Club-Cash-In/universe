import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	CalendarClock,
	CalendarDays,
	ChevronRight,
	Clock,
	Handshake,
	Loader2,
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

export const Route = createFileRoute("/cobros/alertas-convenios")({
	component: RouteComponent,
});

// Las mismas cuatro categorías que Alertas de Promesas, con la misma lectura:
// vencida = prioridad alta. Las clasifica cartera-back, que es quien sabe qué
// cuota del convenio sigue impaga (ver convenioAlertas.ts).
type Categoria = "vencida" | "vence_hoy" | "por_vencer" | "proxima";

type AlertaConvenio = {
	convenio_id: number;
	credito_id: number;
	numero_credito_sifco: string;
	cliente: string | null;
	asesor: string | null;
	fecha_vencimiento: string;
	dias_para_vencer: number;
	cuotas_vencidas: number;
	cuotas_pendientes: number;
	monto_vencido: string;
	monto_pendiente_convenio: string;
	cuota_convenio: string;
	monto_cuota: string;
	fecha_convenio: string;
	bucket: number | null;
	categoria: Categoria;
	casoCobroId: string | null;
};

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
		label: "Incumplidos",
		descripcion: "Cuota del convenio vencida e impaga — prioridad alta",
		icon: TriangleAlert,
		card: "border-red-200 dark:border-red-900/50",
		iconWrap: "bg-red-100 dark:bg-red-900/40",
		iconColor: "text-red-600 dark:text-red-400",
		badge: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
		fechaColor: "text-red-600 dark:text-red-400",
	},
	vence_hoy: {
		label: "Vencen hoy",
		descripcion: "La cuota del convenio se paga hoy",
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
		descripcion: "Se acerca la fecha — confirmá que va a pagar",
		icon: Clock,
		card: "border-sky-200 dark:border-sky-900/50",
		iconWrap: "bg-sky-100 dark:bg-sky-900/40",
		iconColor: "text-sky-600 dark:text-sky-400",
		badge: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-400",
		fechaColor: "text-sky-600 dark:text-sky-400",
	},
	proxima: {
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
	"proxima",
];

/** `fecha_vencimiento` viene como "YYYY-MM-DD" (día GT, ya calculado allá). */
function formatFechaGT(fecha: string | null): string {
	if (!fecha) return "Sin fecha";
	const [y, m, d] = fecha.split("-");
	if (!y || !m || !d) return fecha;
	return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString(
		"es-GT",
		{ day: "2-digit", month: "short", year: "numeric" },
	);
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

function AlertaCard({
	alerta,
	mostrarAsesor,
}: {
	alerta: AlertaConvenio;
	mostrarAsesor: boolean;
}) {
	const config = CATEGORIA_CONFIG[alerta.categoria];
	const Icon = config.icon;
	// En incumplimiento interesa lo VENCIDO; en el resto, lo que toca pagar.
	const monto =
		alerta.categoria === "vencida"
			? formatMonto(alerta.monto_vencido)
			: formatMonto(alerta.monto_cuota);
	const saldo = formatMonto(alerta.monto_pendiente_convenio);

	const contenido = (
		<>
			<div className="flex min-w-0 items-start gap-3">
				<div
					className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${config.iconWrap}`}
				>
					<Icon className={`h-4 w-4 ${config.iconColor}`} />
				</div>
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
						<span className="font-medium text-sm">
							{alerta.cliente || "Cliente sin nombre"}
						</span>
						<span className="font-mono text-muted-foreground text-xs">
							{alerta.numero_credito_sifco}
						</span>
						{alerta.categoria === "vencida" && (
							<Badge
								variant="outline"
								className={`text-[11px] ${config.badge}`}
							>
								{alerta.cuotas_vencidas > 1
									? `${alerta.cuotas_vencidas} cuotas vencidas`
									: "Prioridad alta"}
							</Badge>
						)}
					</div>
					<div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
						<span className={`font-medium ${config.fechaColor}`}>
							{alerta.categoria === "vencida" ? "Venció" : "Vence"}{" "}
							{formatFechaGT(alerta.fecha_vencimiento)}
						</span>
						{monto && (
							<span>
								{alerta.categoria === "vencida" ? "Debe" : "A pagar"}:{" "}
								<span className="font-medium text-foreground">{monto}</span>
							</span>
						)}
						{saldo && <span>Saldo del convenio: {saldo}</span>}
						<span>
							{alerta.cuotas_pendientes} cuota
							{alerta.cuotas_pendientes === 1 ? "" : "s"} por pagar
						</span>
						{mostrarAsesor && alerta.asesor && (
							<span className="inline-flex items-center gap-1">
								<UserRound className="h-3 w-3" />
								{alerta.asesor}
							</span>
						)}
					</div>
				</div>
			</div>
			<ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
		</>
	);

	const clases = `flex items-start justify-between gap-3 rounded-lg border p-3 transition-colors ${config.card}`;

	// Sin caso de cobros no hay ficha a la que navegar. No debería pasar (el
	// backend ya filtra los que no tienen), pero la fila se pinta igual en vez
	// de romper el Link.
	if (!alerta.casoCobroId) {
		return <div className={clases}>{contenido}</div>;
	}

	return (
		<Link
			to="/cobros/$id"
			params={{ id: alerta.casoCobroId }}
			search={{ tipo: "caso" as const }}
			className={`${clases} hover:bg-muted/50`}
		>
			{contenido}
		</Link>
	);
}

function RouteComponent() {
	const { data: session } = authClient.useSession();
	const userRole = session?.user?.role;
	const esSupervisor = PERMISSIONS.canAssignCobros(userRole ?? "");

	const alertasQuery = useQuery({
		...orpc.getAlertasConvenios.queryOptions({ input: {} }),
		enabled: !!session,
	});
	// Mismo casteo que /cobros/promesas: el cliente ORPC infiere `{}` para las
	// queries de cobros.
	const alertas = (alertasQuery.data as AlertaConvenio[] | undefined) ?? [];

	const grupos = useMemo(() => {
		const map: Record<Categoria, AlertaConvenio[]> = {
			vencida: [],
			vence_hoy: [],
			por_vencer: [],
			proxima: [],
		};
		for (const a of alertas) map[a.categoria]?.push(a);
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
					<Handshake className="h-7 w-7 text-primary" />
					Alertas de Convenios
				</h1>
				<p className="text-muted-foreground">
					{esSupervisor
						? "Convenios del equipo que requieren seguimiento — incumplidos, de hoy y próximos a vencer"
						: "Tus convenios que requieren seguimiento — incumplidos, de hoy y próximos a vencer"}
				</p>
			</div>

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
							Cargando convenios...
						</span>
					</CardContent>
				</Card>
			) : total === 0 ? (
				<Card>
					<CardContent className="flex flex-col items-center justify-center py-12">
						<Handshake className="mb-4 h-12 w-12 text-muted-foreground/40" />
						<p className="font-medium text-lg text-muted-foreground">
							No hay convenios por atender
						</p>
						<p className="text-muted-foreground text-sm">
							Cuando un convenio se acerque a su fecha de pago —o se
							incumpla— aparecerá aquí.
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
												key={alerta.convenio_id}
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

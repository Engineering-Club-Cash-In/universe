import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	CalendarClock,
	CheckCircle2,
	Loader2,
	MessageCircle,
	Phone,
	UserRound,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
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
import { authClient } from "@/lib/auth-client";
import {
	type BucketsCatalogoQueryData,
	bucketDeEstado,
	estiloBucket,
	useBucketsCatalogo,
} from "@/lib/cobros/buckets-catalogo";
import { PERMISSIONS } from "@/lib/roles";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/cobros/agenda")({
	component: AgendaDiaPage,
});

interface AgendaRecordatorio {
	tipo: string;
	enviadoAt: string | Date;
}

interface AgendaItem {
	cuotaId: number;
	creditoId: number;
	numeroCuota: number;
	fechaVencimiento: string;
	diasParaVencer: number;
	numeroCreditoSifco: string;
	statusCredit: string;
	bucket: number | null;
	montoCuota: string;
	cliente: string | null;
	telefono: string | null;
	casoId: string | null;
	asesorId: number | null;
	asesor: string | null;
	recordatorios: AgendaRecordatorio[];
}

interface AgendaResponse {
	success: boolean;
	sinAsesor: boolean;
	asesorForzado: { asesorId: number; nombre: string } | null;
	items: AgendaItem[];
}

interface AsesorOption {
	asesorId: number;
	nombre: string;
	activo: boolean;
	email: string;
	isActive: boolean;
}

/** Bucket numérico del motor (0-5) → key de estadoMora del catálogo de UI. */
const KEY_POR_NUMERO = [
	"al_dia",
	"mora_30",
	"mora_60",
	"mora_90",
	"mora_120",
	"mora_120_plus",
] as const;

/** Badge de bucket con label/color del catálogo dinámico (igual que /cobros/buckets). */
function BucketBadge({
	numero,
	catalogo,
}: {
	numero: number | null;
	catalogo: BucketsCatalogoQueryData | undefined;
}) {
	if (numero === null || numero === undefined) {
		return <span className="text-muted-foreground text-xs">—</span>;
	}
	const ui = bucketDeEstado(KEY_POR_NUMERO[numero], catalogo);
	return (
		<Badge
			variant="outline"
			className="whitespace-nowrap text-[10px]"
			style={estiloBucket(ui.colorHex)}
			title={ui.label}
		>
			B{numero}
		</Badge>
	);
}

/** Urgencia visual por días para vencer: hoy = rojo → D-5 = neutro. */
const URGENCIA: Record<number, { titulo: string; chip: string; dot: string }> =
	{
		0: {
			titulo: "Pagan HOY",
			chip: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
			dot: "bg-red-500",
		},
		1: {
			titulo: "Pagan mañana",
			chip: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
			dot: "bg-amber-500",
		},
		2: {
			titulo: "En 2 días",
			chip: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
			dot: "bg-yellow-500",
		},
		3: {
			titulo: "En 3 días",
			chip: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
			dot: "bg-sky-500",
		},
		4: {
			titulo: "En 4 días",
			chip: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
			dot: "bg-slate-400",
		},
		5: {
			titulo: "En 5 días",
			chip: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
			dot: "bg-slate-400",
		},
	};

/** "premora_5" → "D-5" (badge de recordatorio enviado). */
const etiquetaRecordatorio = (tipo: string) => tipo.replace("premora_", "D-");

/** "YYYY-MM-DD" → "dd/mm/aaaa" sin pasar por Date (evita corrimiento por TZ). */
function fechaLegible(iso: string) {
	const [y, m, d] = String(iso ?? "").split("-");
	return y && m && d ? `${d}/${m}/${y}` : String(iso ?? "");
}

function montoQ(v: string) {
	const n = Number(v);
	return Number.isFinite(n)
		? `Q${n.toLocaleString("es-GT", {
				minimumFractionDigits: 2,
				maximumFractionDigits: 2,
			})}`
		: String(v ?? "");
}

function AgendaDiaPage() {
	const navigate = useNavigate();
	const { data: session } = authClient.useSession();
	const userRole = session?.user?.role;
	const esSupervisor = !!userRole && PERMISSIONS.canAssignCobros(userRole);
	const bucketsCatalogo = useBucketsCatalogo();

	// "todos" | asesorId como string (Select de shadcn trabaja con strings).
	const [asesorSel, setAsesorSel] = useState("todos");

	const agendaQuery = useQuery({
		...orpc.getAgendaDia.queryOptions({
			input: {
				asesorId:
					esSupervisor && asesorSel !== "todos" ? Number(asesorSel) : undefined,
			},
		}),
		enabled: !!session,
	});

	const asesoresQuery = useQuery({
		...orpc.getAsesores.queryOptions({
			input: { page: 1, perPage: 100 },
		}),
		enabled: !!session && esSupervisor,
	});

	if (!userRole || !PERMISSIONS.canAccessCobros(userRole)) {
		return (
			<div className="flex min-h-screen items-center justify-center">
				<div className="text-center">
					<h1 className="mb-4 font-bold text-2xl text-gray-800">
						Acceso Denegado
					</h1>
					<p className="text-gray-600">
						Solo el equipo de cobros puede ver la agenda del día.
					</p>
				</div>
			</div>
		);
	}

	const agenda = agendaQuery.data as AgendaResponse | undefined;
	const items = agenda?.items ?? [];
	const asesores = (
		(asesoresQuery.data as { asesores?: AsesorOption[] } | undefined)
			?.asesores ?? []
	).filter((a) => a.activo);

	// Agrupar por urgencia manteniendo el orden D-0 → D-5 del server.
	const grupos = [0, 1, 2, 3, 4, 5]
		.map((dias) => ({
			dias,
			items: items.filter((i) => i.diasParaVencer === dias),
		}))
		.filter((g) => g.items.length > 0);

	const totalHoy = items.filter((i) => i.diasParaVencer === 0).length;

	// Con "todos" el bucket va por FILA (varía); con UN asesor (elegido o
	// forzado por rol) va GENERAL en el header — sus buckets, sin repetirse.
	const mostrandoTodos = esSupervisor && asesorSel === "todos";
	const bucketsDelAsesor = mostrandoTodos
		? []
		: [
				...new Set(
					items
						.map((i) => i.bucket)
						.filter((b): b is number => b !== null && b !== undefined),
				),
			].sort((a, b) => a - b);

	const irAlDetalle = (sifco: string) => {
		navigate({
			to: "/cobros/$id",
			params: { id: sifco },
			search: { tipo: "caso" },
		});
	};

	return (
		<div className="container mx-auto space-y-4 p-4 lg:p-6">
			{/* Header */}
			<Card>
				<CardHeader className="pb-4">
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div className="flex items-center gap-3">
							<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
								<CalendarClock className="h-5 w-5" />
							</div>
							<div>
								<CardTitle className="text-xl">Agenda del día</CardTitle>
								<CardDescription>
									Cuentas con cuota próxima a vencer — de hoy (D-0) a 5 días
									(D-5), de todo el funnel
									{agenda?.asesorForzado
										? ` · Agenda de ${agenda.asesorForzado.nombre}`
										: ""}
								</CardDescription>
							</div>
						</div>
						<div className="flex items-center gap-2">
							{totalHoy > 0 && (
								<Badge
									variant="outline"
									className={`border-transparent ${URGENCIA[0].chip}`}
								>
									{totalHoy} pagan hoy
								</Badge>
							)}
							<Badge variant="secondary">{items.length} cuentas</Badge>
							{bucketsDelAsesor.length > 0 && (
								<span className="inline-flex items-center gap-1">
									{bucketsDelAsesor.map((b) => (
										<BucketBadge
											key={b}
											numero={b}
											catalogo={bucketsCatalogo.data}
										/>
									))}
								</span>
							)}
							{esSupervisor && (
								<Select value={asesorSel} onValueChange={setAsesorSel}>
									<SelectTrigger className="h-8 w-52">
										<UserRound className="mr-1 h-3.5 w-3.5 text-muted-foreground" />
										<SelectValue placeholder="Asesor" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="todos">Todos los asesores</SelectItem>
										{asesores.map((a) => (
											<SelectItem key={a.asesorId} value={String(a.asesorId)}>
												{a.nombre}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							)}
						</div>
					</div>
				</CardHeader>
			</Card>

			{/* Estados */}
			{agendaQuery.isLoading && (
				<div className="flex items-center justify-center py-16">
					<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
				</div>
			)}

			{!agendaQuery.isLoading && agenda?.sinAsesor && (
				<Card>
					<CardContent className="py-10 text-center text-muted-foreground">
						Tu usuario no está vinculado a un asesor de cartera (por correo).
						Pedile al supervisor que revise tu correo de asesor.
					</CardContent>
				</Card>
			)}

			{!agendaQuery.isLoading && !agenda?.sinAsesor && items.length === 0 && (
				<Card>
					<CardContent className="py-10 text-center text-muted-foreground">
						Sin cuotas próximas a vencer en los próximos 5 días. 🎉
					</CardContent>
				</Card>
			)}

			{/* Grupos por urgencia */}
			{grupos.map((grupo) => {
				const urgencia = URGENCIA[grupo.dias];
				const fecha = grupo.items[0]?.fechaVencimiento;
				return (
					<Card key={grupo.dias}>
						<CardHeader className="pb-2">
							<div className="flex items-center gap-2">
								<span className={`h-2.5 w-2.5 rounded-full ${urgencia.dot}`} />
								<CardTitle className="text-base">{urgencia.titulo}</CardTitle>
								<Badge
									variant="outline"
									className={`border-transparent text-[10px] ${urgencia.chip}`}
								>
									{grupo.items.length}
								</Badge>
								{fecha && (
									<span className="text-muted-foreground text-xs">
										vencen el {fechaLegible(fecha)}
									</span>
								)}
							</div>
						</CardHeader>
						<CardContent className="pt-0">
							<div className="overflow-x-auto">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Cliente</TableHead>
											{mostrandoTodos && <TableHead>Bucket</TableHead>}
											<TableHead>Crédito</TableHead>
											<TableHead className="text-center">Cuota</TableHead>
											<TableHead className="text-right">Monto</TableHead>
											<TableHead>Teléfono</TableHead>
											{esSupervisor && asesorSel === "todos" && (
												<TableHead>Asesor</TableHead>
											)}
											<TableHead>Recordatorios</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{grupo.items.map((item) => (
											<TableRow
												key={item.cuotaId}
												className="cursor-pointer"
												onClick={() => irAlDetalle(item.numeroCreditoSifco)}
											>
												<TableCell className="font-medium">
													{item.cliente ?? "—"}
												</TableCell>
												{mostrandoTodos && (
													<TableCell>
														<BucketBadge
															numero={item.bucket}
															catalogo={bucketsCatalogo.data}
														/>
													</TableCell>
												)}
												<TableCell className="max-w-45 truncate font-mono text-muted-foreground text-xs">
													{item.numeroCreditoSifco}
												</TableCell>
												<TableCell className="text-center tabular-nums">
													#{item.numeroCuota}
												</TableCell>
												<TableCell className="text-right font-medium tabular-nums">
													{montoQ(item.montoCuota)}
												</TableCell>
												<TableCell>
													{item.telefono ? (
														<span className="inline-flex items-center gap-1 text-sm">
															<Phone className="h-3 w-3 text-muted-foreground" />
															{item.telefono}
														</span>
													) : (
														<span className="text-muted-foreground text-xs">
															Sin teléfono
														</span>
													)}
												</TableCell>
												{esSupervisor && asesorSel === "todos" && (
													<TableCell className="text-sm">
														{item.asesor ?? "—"}
													</TableCell>
												)}
												<TableCell>
													{item.recordatorios.length > 0 ? (
														<span className="inline-flex flex-wrap items-center gap-1">
															{item.recordatorios.map((r) => (
																<Badge
																	key={r.tipo}
																	variant="outline"
																	className="gap-0.5 border-transparent bg-emerald-100 text-[10px] text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
																	title={`Recordatorio ${etiquetaRecordatorio(r.tipo)} enviado`}
																>
																	<MessageCircle className="h-2.5 w-2.5" />
																	{etiquetaRecordatorio(r.tipo)}
																	<CheckCircle2 className="h-2.5 w-2.5" />
																</Badge>
															))}
														</span>
													) : (
														<span className="text-muted-foreground text-xs">
															—
														</span>
													)}
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</div>
						</CardContent>
					</Card>
				);
			})}
		</div>
	);
}

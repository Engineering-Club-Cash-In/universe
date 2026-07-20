import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	CalendarClock,
	CheckCircle2,
	ChevronLeft,
	ChevronRight,
	Loader2,
	MessageCircle,
	Phone,
	UserRound,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
	modoPrueba?: boolean;
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
	dia: number;
	items: AgendaItem[];
	total: number;
	page: number;
	perPage: number;
	totalPages: number;
}

const DIAS_AGENDA = [0, 1, 2, 3, 4, 5] as const;
const PER_PAGE_AGENDA = 50;

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
	// Página por día (cada sección pagina sola). Sin entrada = página 1.
	const [pagPorDia, setPagPorDia] = useState<Record<number, number>>({});

	const asesorIdInput =
		esSupervisor && asesorSel !== "todos" ? Number(asesorSel) : undefined;

	// Una query POR DÍA (D-0..D-5). Cada sección pagina sola: el día 15/30
	// (~600 cuentas) llega de a PER_PAGE, no de un jalón. keepPreviousData deja
	// la tabla visible mientras cambia de página (no parpadea a vacío).
	const dayQueries = useQueries({
		queries: DIAS_AGENDA.map((dia) => ({
			...orpc.getAgendaDia.queryOptions({
				input: {
					dia,
					asesorId: asesorIdInput,
					page: pagPorDia[dia] ?? 1,
					perPage: PER_PAGE_AGENDA,
				},
			}),
			enabled: !!session,
			placeholderData: keepPreviousData,
		})),
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

	const secciones = DIAS_AGENDA.map((dia, idx) => ({
		dia,
		query: dayQueries[idx],
		data: dayQueries[idx]?.data as AgendaResponse | undefined,
	}));

	const asesores = (
		(asesoresQuery.data as { asesores?: AsesorOption[] } | undefined)
			?.asesores ?? []
	).filter((a) => a.activo);

	const sinAsesor = secciones.some((s) => s.data?.sinAsesor);
	const asesorForzado =
		secciones.find((s) => s.data?.asesorForzado)?.data?.asesorForzado ?? null;
	// Total real (no limitado por la página): suma del `total` de cada día.
	const totalCuentas = secciones.reduce(
		(acc, s) => acc + (s.data?.total ?? 0),
		0,
	);
	const totalHoy = secciones[0]?.data?.total ?? 0;

	const primeraCarga = dayQueries.every((q) => q.isPending);
	const sinCuotas =
		!sinAsesor && dayQueries.every((q) => !q.isPending) && totalCuentas === 0;

	// Con "todos" el bucket va por FILA (varía); con UN asesor (elegido o
	// forzado por rol) va GENERAL en el header — sus buckets, sin repetirse.
	// Se calcula sobre las filas cargadas (asesor→bucket es estable, así que la
	// unión de las páginas visibles ya cubre sus buckets).
	const mostrandoTodos = esSupervisor && asesorSel === "todos";
	const bucketsDelAsesor = mostrandoTodos
		? []
		: [
				...new Set(
					secciones
						.flatMap((s) => s.data?.items ?? [])
						.map((i) => i.bucket)
						.filter((b): b is number => b !== null && b !== undefined),
				),
			].sort((a, b) => a - b);

	const cambiarAsesor = (v: string) => {
		setAsesorSel(v);
		setPagPorDia({}); // reset de todas las secciones a la página 1
	};

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
									{asesorForzado ? ` · Agenda de ${asesorForzado.nombre}` : ""}
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
							<Badge variant="secondary">{totalCuentas} cuentas</Badge>
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
								<Select value={asesorSel} onValueChange={cambiarAsesor}>
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
			{primeraCarga && (
				<div className="flex items-center justify-center py-16">
					<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
				</div>
			)}

			{sinAsesor && (
				<Card>
					<CardContent className="py-10 text-center text-muted-foreground">
						Tu usuario no está vinculado a un asesor de cartera (por correo).
						Pedile al supervisor que revise tu correo de asesor.
					</CardContent>
				</Card>
			)}

			{sinCuotas && (
				<Card>
					<CardContent className="py-10 text-center text-muted-foreground">
						Sin cuotas próximas a vencer en los próximos 5 días. 🎉
					</CardContent>
				</Card>
			)}

			{/* Una sección (card) por día, cada una paginada de forma independiente */}
			{secciones.map(({ dia, query, data }) => {
				const dayTotal = data?.total ?? 0;
				// La sección solo aparece cuando ya cargó y tiene cuentas.
				if (query.isPending || dayTotal === 0) return null;
				const dayItems = data?.items ?? [];
				const dayTotalPages = data?.totalPages ?? 1;
				const dayPage = pagPorDia[dia] ?? 1;
				const urgencia = URGENCIA[dia];
				const fecha = dayItems[0]?.fechaVencimiento;
				return (
					<Card key={dia}>
						<CardHeader className="pb-2">
							<div className="flex items-center gap-2">
								<span className={`h-2.5 w-2.5 rounded-full ${urgencia.dot}`} />
								<CardTitle className="text-base">{urgencia.titulo}</CardTitle>
								<Badge
									variant="outline"
									className={`border-transparent text-[10px] ${urgencia.chip}`}
								>
									{dayTotal}
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
										{dayItems.map((item) => (
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
																	className={`gap-0.5 border-transparent text-[10px] ${
																		r.modoPrueba
																			? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
																			: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
																	}`}
																	title={`Recordatorio ${etiquetaRecordatorio(r.tipo)} enviado${r.modoPrueba ? " (modo prueba)" : ""}`}
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

							{/* Paginador de la sección (solo si hay más de una página) */}
							{dayTotalPages > 1 && (
								<div className="flex items-center justify-between pt-3">
									<span className="text-muted-foreground text-xs">
										Mostrando {dayItems.length} de {dayTotal} · página {dayPage}{" "}
										de {dayTotalPages}
									</span>
									<div className="flex items-center gap-1">
										<Button
											variant="outline"
											size="sm"
											className="h-8"
											disabled={dayPage <= 1 || query.isFetching}
											onClick={() =>
												setPagPorDia((p) => ({ ...p, [dia]: dayPage - 1 }))
											}
										>
											<ChevronLeft className="h-4 w-4" />
											Anterior
										</Button>
										<Button
											variant="outline"
											size="sm"
											className="h-8"
											disabled={dayPage >= dayTotalPages || query.isFetching}
											onClick={() =>
												setPagPorDia((p) => ({ ...p, [dia]: dayPage + 1 }))
											}
										>
											Siguiente
											<ChevronRight className="h-4 w-4" />
										</Button>
									</div>
								</div>
							)}
						</CardContent>
					</Card>
				);
			})}
		</div>
	);
}

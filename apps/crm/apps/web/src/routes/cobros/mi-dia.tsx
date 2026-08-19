import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { differenceInDays } from "date-fns";
import {
	ChevronRight as ArrowRight,
	CalendarClock,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	Clock,
	Loader2,
	Phone,
	PhoneOff,
	TriangleAlert,
} from "lucide-react";
import { useRef, useState } from "react";
import { PanelGestionRapida } from "@/components/cobros/panel-gestion-rapida";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
	labelBucketConCodigo,
	useBucketsCatalogo,
} from "@/lib/cobros/buckets-catalogo";
import { resumirVencimientosAgenda } from "@/lib/cobros/mi-agenda";
import { parseFechaLocal } from "@/lib/date-utils";
import { PERMISSIONS } from "@/lib/roles";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/cobros/mi-dia")({
	component: MiDiaPage,
});

type Categoria =
	| "sla_hoy"
	| "promesa_hoy"
	| "vence_hoy"
	| "incumplida"
	| "promesa_proxima"
	| "sin_contacto";

/** Qué lista se está viendo: lo urgente de hoy, o la cartera completa. */
type Alcance = "prioritarios" | "cartera";

interface ColaItem {
	creditoId: number;
	numeroCreditoSifco: string;
	cliente: string;
	asesorId: number;
	asesor: string;
	bucket: number;
	bucketPrefijo: string;
	bucketNombre: string;
	fechaLimiteSla: string | null;
	fechaPromesa: string | Date | null;
	telefono: string | null;
	casoId: string | null;
	vehiculoMarca: string | null;
	vehiculoModelo: string | null;
	vehiculoYear: number | null;
	vehiculoPlaca: string | null;
	slaHoy: boolean;
	promesaHoy: boolean;
	venceHoy: boolean;
	montoCuotaHoy: string | null;
	incumplida: boolean;
	promesaProxima: boolean;
	sinContacto: boolean;
	diasSinContacto: number | null;
}

interface ColaResponse {
	success: boolean;
	sinAsesor: boolean;
	asesorForzado: { asesorId: number; nombre: string } | null;
	items: ColaItem[];
	total: number;
	page: number;
	perPage: number;
	totalPages: number;
	conteos?: Record<Categoria, number>;
}

interface AgendaItem {
	cuotaId: number;
	creditoId: number;
	numeroCreditoSifco: string;
	cliente: string | null;
	bucket: number | null;
	montoCuota: string;
}

interface AgendaResponse {
	items: AgendaItem[];
	total: number;
}

/** Fila de la cartera completa (getTodosLosCreditos), NO de la cola. */
interface CarteraItem {
	contratoId: string;
	numeroCredito: string | null;
	clienteNombre: string;
	estadoMora: string | null;
	estadoContrato: string;
	montoEnMora: string;
	montoFinanciado: string;
	cuotaMensual: string | null;
	fechaProximoPago: string | null;
	diasMoraMaximo: number;
	vehiculoMarca: string | null;
	vehiculoModelo: string | null;
	vehiculoYear: number | null;
	vehiculoPlaca: string | null;
}

/** "MAZDA CX-5 2015" + placa debajo — mismo formato que la tabla del dashboard. */
function Vehiculo({
	marca,
	modelo,
	year,
	placa,
}: {
	marca: string | null;
	modelo: string | null;
	year: number | null;
	placa: string | null;
}) {
	const desc = [marca, modelo, year].filter(Boolean).join(" ");
	if (!desc && !placa) {
		return <span className="text-muted-foreground text-xs">—</span>;
	}
	return (
		<div className="max-w-52">
			<div className="truncate text-sm">{desc || "—"}</div>
			{placa && (
				<div className="truncate font-mono text-muted-foreground text-xs">
					{placa}
				</div>
			)}
		</div>
	);
}

/**
 * Lo mínimo que el drawer necesita, venga de la cola o de la cartera — así
 * "Gestión rápida" es uno solo para las dos listas.
 */
interface FilaCaso {
	cliente: string;
	numeroCreditoSifco: string;
	/** key de estadoMora, para el badge de bucket. */
	bucketKey: string;
	cola: ColaItem | null;
}

const PER_PAGE = 25;
// D-0 ya no se pide acá: "vence hoy" viene fusionado en getColaDia (conteos.vence_hoy).
const DIAS_AGENDA = [1, 2, 3, 4, 5] as const;
const PER_PAGE_AGENDA = 200;

function etiquetaDiaProximo(dia: number) {
	if (dia === 1) return "Mañana";
	return `En ${dia} días`;
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

// Chips de la barra "Agenda de hoy" — cada uno mapea a una categoría de la cola
// del día (mismo dato que la tabla) y al hacer click la filtra. Solo los que ya
// tienen fuente real; los pendientes van aparte como "próximamente".
const CHIPS: Array<{
	key: Categoria;
	label: string;
	icon: typeof Clock;
	activo: string;
}> = [
	{
		key: "sla_hoy",
		label: "SLA por gestionar hoy",
		icon: Phone,
		activo:
			"border-rose-300 bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200",
	},
	{
		key: "promesa_hoy",
		label: "Promesas vencen hoy",
		icon: CalendarClock,
		activo:
			"border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
	},
	{
		key: "vence_hoy",
		label: "Cuota vence hoy",
		icon: CalendarClock,
		activo:
			"border-orange-300 bg-orange-50 text-orange-800 dark:bg-orange-950/40 dark:text-orange-200",
	},
	{
		key: "incumplida",
		label: "Promesas vencidas",
		icon: TriangleAlert,
		activo:
			"border-red-300 bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200",
	},
	{
		key: "promesa_proxima",
		label: "Promesas próximas",
		icon: Clock,
		activo:
			"border-sky-300 bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200",
	},
	{
		key: "sin_contacto",
		label: "Sin intento de contacto",
		icon: PhoneOff,
		activo:
			"border-purple-300 bg-purple-50 text-purple-800 dark:bg-purple-950/40 dark:text-purple-200",
	},
];

// Aún sin fuente en el sistema — se muestran deshabilitados para no prometer un
// número que no podemos calcular todavía (se definen en otra iteración).
const CHIPS_PROXIMAMENTE = ["Pagos por confirmar", "Referencias por contactar"];

function fechaLegible(v: string | Date | null) {
	if (!v) return "—";
	if (typeof v === "string") {
		// "YYYY-MM-DD" → dd/mm/aaaa sin pasar por Date (evita corrimiento por TZ).
		const [y, m, d] = v.split("-");
		return y && m && d ? `${d}/${m}/${y}` : v;
	}
	return new Date(v).toLocaleDateString("es-GT", {
		timeZone: "America/Guatemala",
	});
}

function montoQ(v: string | null) {
	const n = Number(v ?? 0);
	if (!Number.isFinite(n)) return "—";
	return `Q${n.toLocaleString("es-GT", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})}`;
}

/** Fecha de pago + cuán lejos está ("Hoy", "en 11 días", "hace 3 días"). */
function ProximoPago({ fecha }: { fecha: string | null }) {
	if (!fecha) {
		return (
			<span className="text-muted-foreground text-xs">Sin fecha definida</span>
		);
	}
	const hoy = new Date();
	hoy.setHours(0, 0, 0, 0);
	const dias = differenceInDays(parseFechaLocal(fecha), hoy);
	const etiqueta =
		dias === 0
			? "Hoy"
			: dias > 0
				? `en ${dias} día${dias === 1 ? "" : "s"}`
				: `hace ${Math.abs(dias)} día${Math.abs(dias) === 1 ? "" : "s"}`;
	const color =
		dias < 0
			? "text-red-600 dark:text-red-400"
			: dias === 0
				? "text-amber-600 dark:text-amber-400"
				: "text-muted-foreground";
	return (
		<div>
			<div>{fechaLegible(fecha)}</div>
			<div className={`text-xs ${color}`}>{etiqueta}</div>
		</div>
	);
}

function Paginacion({
	mostrando,
	total,
	page,
	totalPages,
	cargando,
	onPage,
}: {
	mostrando: number;
	total: number;
	page: number;
	totalPages: number;
	cargando: boolean;
	onPage: (fn: (p: number) => number) => void;
}) {
	if (totalPages <= 1) return null;
	return (
		<div className="flex items-center justify-between pt-3">
			<span className="text-muted-foreground text-xs">
				Mostrando {mostrando} de {total} · página {page} de {totalPages}
			</span>
			<div className="flex items-center gap-1">
				<Button
					variant="outline"
					size="sm"
					className="h-8"
					disabled={page <= 1 || cargando}
					onClick={() => onPage((p) => p - 1)}
				>
					<ChevronLeft className="h-4 w-4" />
					Anterior
				</Button>
				<Button
					variant="outline"
					size="sm"
					className="h-8"
					disabled={page >= totalPages || cargando}
					onClick={() => onPage((p) => p + 1)}
				>
					Siguiente
					<ChevronRight className="h-4 w-4" />
				</Button>
			</div>
		</div>
	);
}

/**
 * Badge de bucket a partir de la key de estadoMora — sirve para la cola
 * (numero → key) y para la cartera (que ya trae estadoMora).
 */
function BucketBadge({
	estadoKey,
	catalogo,
}: {
	estadoKey: string;
	catalogo: BucketsCatalogoQueryData | undefined;
}) {
	const ui = bucketDeEstado(estadoKey, catalogo);
	return (
		<Badge
			variant="outline"
			className="whitespace-nowrap text-[10px]"
			style={estiloBucket(ui.colorHex)}
			title={ui.label}
		>
			{labelBucketConCodigo(ui)}
		</Badge>
	);
}

function CategoriaBadges({ item }: { item: ColaItem }) {
	return (
		<span className="inline-flex flex-wrap items-center gap-1">
			{item.slaHoy && (
				<Badge
					variant="outline"
					className="border-transparent bg-rose-100 text-[10px] text-rose-800 dark:bg-rose-900/40 dark:text-rose-300"
				>
					Gestionar hoy
				</Badge>
			)}
			{item.promesaHoy && (
				<Badge
					variant="outline"
					className="border-transparent bg-amber-100 text-[10px] text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
				>
					Promesa hoy
				</Badge>
			)}
			{item.venceHoy && (
				<Badge
					variant="outline"
					className="border-transparent bg-orange-100 text-[10px] text-orange-800 dark:bg-orange-900/40 dark:text-orange-300"
				>
					Cuota vence hoy
				</Badge>
			)}
			{item.incumplida && (
				<Badge
					variant="outline"
					className="border-transparent bg-red-100 text-[10px] text-red-800 dark:bg-red-900/40 dark:text-red-300"
				>
					Promesa vencida
				</Badge>
			)}
			{item.promesaProxima && (
				<Badge
					variant="outline"
					className="border-transparent bg-sky-100 text-[10px] text-sky-800 dark:bg-sky-900/40 dark:text-sky-300"
				>
					Promesa próxima
				</Badge>
			)}
			{item.sinContacto && (
				<Badge
					variant="outline"
					className="border-transparent bg-purple-100 text-[10px] text-purple-800 dark:bg-purple-900/40 dark:text-purple-300"
				>
					{item.diasSinContacto} días sin contacto
				</Badge>
			)}
		</span>
	);
}

function MiDiaPage() {
	const navigate = useNavigate();
	const { data: session } = authClient.useSession();
	const userRole = session?.user?.role;
	const bucketsCatalogo = useBucketsCatalogo();
	// El cliente ORPC infiere `unknown` para esta query; casteo al shape real.
	const catalogo = bucketsCatalogo.data as BucketsCatalogoQueryData | undefined;

	const [filtro, setFiltro] = useState<Categoria | null>(null);
	const [page, setPage] = useState(1);
	const [proximosDiasAbiertos, setProximosDiasAbiertos] = useState(false);
	const [detalle, setDetalle] = useState<FilaCaso | null>(null);
	const tablaRef = useRef<HTMLDivElement>(null);
	// null = automático (prioritarios si hay algo urgente, si no toda la
	// cartera); al tocar el toggle manda la elección del asesor.
	const [alcanceManual, setAlcanceManual] = useState<Alcance | null>(null);

	// "Mi día" es la agenda PERSONAL del asesor logueado. Un rol que puede ver
	// todos (admin/supervisor, canAssignCobros) no manda asesorId acá — el
	// servidor entonces no filtra por asesor y devolvería la cartera de TODOS
	// los asesores mezclada, bajo un copy en primera persona ("tu cartera").
	// Se corta antes de disparar esas queries: esta pantalla no es para elegir
	// un asesor a mirar (para eso está /cobros/cola).
	const esVistaPersonal = !!userRole && !PERMISSIONS.canAssignCobros(userRole);

	const colaQuery = useQuery({
		...orpc.getColaDia.queryOptions({
			input: {
				// Cast puntual: con exactamente 6 miembros el union local `Categoria`
				// iguala en forma al del servidor y dispara el problema de ORPC
				// descrito en utils/orpc.ts ("exceeds the maximum length problem") —
				// colapsa a `unique symbol` en vez de resolver. Con 5 o menos
				// miembros (subconjunto) no ocurre; ver cola.tsx.
				filtro: (filtro ?? undefined) as never,
				page,
				perPage: PER_PAGE,
			},
		}),
		enabled: !!session && esVistaPersonal,
		placeholderData: keepPreviousData,
	});
	// Cartera COMPLETA del asesor. La cola sale del pool de buckets y excluye
	// B0 (Cartera Sana no tiene SLA), así que un asesor con toda su cartera al
	// día veía la pantalla vacía. Esta query es la del dashboard (filtra por
	// asesores.email_cash_in) y siempre trae sus créditos.
	const carteraQuery = useQuery({
		...orpc.getTodosLosCreditos.queryOptions({
			input: {
				limit: PER_PAGE,
				offset: (page - 1) * PER_PAGE,
				emailCobrador: session?.user?.email,
			},
		}),
		enabled: !!session && esVistaPersonal,
		placeholderData: keepPreviousData,
	});

	const agendaQueries = useQueries({
		queries: DIAS_AGENDA.map((dia) => ({
			...orpc.getAgendaDia.queryOptions({
				input: { dia, page: 1, perPage: PER_PAGE_AGENDA },
			}),
			enabled: !!session && esVistaPersonal,
			placeholderData: keepPreviousData,
		})),
	});

	if (userRole && !PERMISSIONS.canAccessCobros(userRole)) {
		return (
			<div className="flex min-h-screen items-center justify-center">
				<div className="text-center">
					<h1 className="mb-4 font-bold text-2xl text-gray-800">
						Acceso Denegado
					</h1>
					<p className="text-gray-600">
						Solo el equipo de cobros puede ver esta pantalla.
					</p>
				</div>
			</div>
		);
	}

	if (userRole && !esVistaPersonal) {
		return (
			<div className="flex min-h-screen items-center justify-center">
				<div className="max-w-md text-center">
					<h1 className="mb-4 font-bold text-2xl text-gray-800">
						Esta pantalla es personal
					</h1>
					<p className="text-gray-600">
						"Mi día" muestra la agenda de un asesor específico y tu rol puede
						ver la cartera de todos, así que no aplica. Para revisar la cola de
						un asesor puntual, usá{" "}
						<button
							type="button"
							className="text-indigo-600 underline hover:text-indigo-700"
							onClick={() => navigate({ to: "/cobros/cola" })}
						>
							Cola del día
						</button>
						.
					</p>
				</div>
			</div>
		);
	}

	const data = colaQuery.data as ColaResponse | undefined;
	const items = data?.items ?? [];
	const total = data?.total ?? 0;
	const totalPages = data?.totalPages ?? 1;
	const sinAsesor = !!data?.sinAsesor;
	const conteos = data?.conteos;
	const proximosDias = DIAS_AGENDA.map((dia, index) => ({
		dia,
		data: agendaQueries[index]?.data as AgendaResponse | undefined,
	}));
	const resumenProximosDias = resumirVencimientosAgenda(
		proximosDias.map(({ dia, data }) => ({ dia, total: data?.total ?? 0 })),
	);
	const cargandoAgenda = agendaQueries.some((query) => query.isPending);
	// Si una query D-1..D-5 falla (no solo está pending), su `data` queda
	// undefined y el fallback `?? 0` de arriba la convierte silenciosamente en
	// "0 vencimientos ese día" — el resumen puede mostrar "no tenés
	// vencimientos" aunque en realidad uno de los días nunca se pudo consultar
	// (Codex PR #1334).
	const errorAgenda = agendaQueries.some((query) => query.isError);

	const cartera = carteraQuery.data as
		| { data: CarteraItem[]; total: number; totalPages: number }
		| undefined;
	const carteraItems = cartera?.data ?? [];
	const carteraTotal = cartera?.total ?? 0;
	const carteraTotalPages = cartera?.totalPages ?? 1;

	// Sin nada urgente, la pantalla cae sola a la cartera completa: esta vista
	// vive abierta todo el día, nunca debe quedar en blanco.
	const alcance: Alcance =
		alcanceManual ?? (total > 0 || filtro ? "prioritarios" : "cartera");
	const enCartera = alcance === "cartera";

	const primerNombre = (session?.user?.name ?? "").trim().split(/\s+/)[0] || "";

	const cambiarFiltro = (cat: Categoria) => {
		setFiltro((prev) => (prev === cat ? null : cat));
		setAlcanceManual("prioritarios");
		setPage(1);
		tablaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
	};

	const cambiarAlcance = (a: Alcance) => {
		setAlcanceManual(a);
		if (a === "cartera") setFiltro(null);
		setPage(1);
	};

	const filaDeCola = (item: ColaItem): FilaCaso => ({
		cliente: item.cliente,
		numeroCreditoSifco: item.numeroCreditoSifco,
		bucketKey: KEY_POR_NUMERO[item.bucket] ?? "al_dia",
		cola: item,
	});

	const filaDeCartera = (item: CarteraItem): FilaCaso => ({
		cliente: item.clienteNombre,
		numeroCreditoSifco: item.numeroCredito ?? "",
		bucketKey:
			item.estadoContrato === "activo"
				? (item.estadoMora ?? "al_dia")
				: item.estadoContrato,
		cola: null,
	});

	return (
		<div className="container mx-auto space-y-5 p-4 lg:p-6">
			{/* Header */}
			<div>
				<p className="text-muted-foreground text-xs uppercase tracking-wide">
					Dashboard de cobros
				</p>
				<h1 className="font-bold text-3xl">
					Buen día{primerNombre ? `, ${primerNombre}` : ""}
				</h1>
				<p className="text-muted-foreground">
					Este es el estado de tu cartera hoy. Prioriza la mora temprana y
					protege tu recuperación.
				</p>
			</div>

			{/* Agenda de hoy — resumen en vivo; click en un chip filtra y lleva a
			    la tabla "Casos que requieren atención hoy" más abajo. */}
			<Card className="border-emerald-200 bg-emerald-50/40 dark:border-emerald-900/40 dark:bg-emerald-950/20">
				<CardContent className="p-4">
					<div className="mb-3 flex items-center gap-2">
						<CalendarClock className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
						<span className="font-semibold text-sm">Agenda de hoy</span>
						{colaQuery.isFetching && (
							<Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
						)}
					</div>

					<div className="flex flex-wrap items-center gap-2">
						{CHIPS.map((chip) => {
							const Icon = chip.icon;
							const count = conteos?.[chip.key] ?? 0;
							const activo = filtro === chip.key;
							return (
								<button
									key={chip.key}
									type="button"
									onClick={() => cambiarFiltro(chip.key)}
									className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors ${
										activo
											? chip.activo
											: "border-border bg-background hover:bg-muted/60"
									}`}
								>
									<Icon className="h-3.5 w-3.5 text-muted-foreground" />
									<span className="font-bold text-sm tabular-nums">
										{count}
									</span>
									<span>{chip.label}</span>
								</button>
							);
						})}
						{CHIPS_PROXIMAMENTE.map((label) => (
							<span
								key={label}
								title="Próximamente"
								className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-full border border-border border-dashed px-3 py-1.5 text-muted-foreground/60 text-xs"
							>
								{label}
								<Badge
									variant="secondary"
									className="h-4 px-1 text-[9px] uppercase"
								>
									pronto
								</Badge>
							</span>
						))}
					</div>
				</CardContent>
			</Card>

			<Card className="border-sky-200 bg-sky-50/30 dark:border-sky-900/40 dark:bg-sky-950/20">
				<CardContent className="p-4">
					<button
						type="button"
						onClick={() => setProximosDiasAbiertos((v) => !v)}
						className="flex w-full items-center justify-between gap-3 text-left"
					>
						<div className="flex items-center gap-2">
							<CalendarClock className="h-4 w-4 text-sky-600 dark:text-sky-400" />
							<div>
								<div className="font-semibold text-sm">Próximos días</div>
								<p className="text-muted-foreground text-xs">
									Vencimientos de mañana a D-5.
								</p>
							</div>
							{cargandoAgenda && (
								<Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
							)}
							{!cargandoAgenda && errorAgenda && (
								<TriangleAlert className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
							)}
						</div>
						<div className="flex items-center gap-2">
							<Badge variant="secondary" className="tabular-nums">
								{resumenProximosDias.total}
							</Badge>
							<ChevronDown
								className={`h-4 w-4 transition-transform ${proximosDiasAbiertos ? "rotate-180" : ""}`}
							/>
						</div>
					</button>

					{proximosDiasAbiertos && (
						<div className="mt-4 space-y-3 border-sky-200/60 border-t pt-3 dark:border-sky-900/40">
							{errorAgenda && (
								<p className="flex items-center gap-1.5 text-amber-600 text-sm dark:text-amber-400">
									<TriangleAlert className="h-4 w-4 shrink-0" />
									No se pudieron cargar todos los días — el total puede estar
									incompleto.
								</p>
							)}
							{cargandoAgenda ? (
								<div className="flex items-center gap-2 text-muted-foreground text-sm">
									<Loader2 className="h-4 w-4 animate-spin" />
									Cargando vencimientos…
								</div>
							) : resumenProximosDias.total === 0 && !errorAgenda ? (
								<p className="text-muted-foreground text-sm">
									No tenés vencimientos durante próximos cinco días.
								</p>
							) : (
								proximosDias
									.filter(({ data }) => (data?.total ?? 0) > 0)
									.map(({ dia, data }) => (
										<div key={dia} className="space-y-1.5">
											<div className="flex items-center justify-between text-sm">
												<span className="font-medium">
													{etiquetaDiaProximo(dia)}
												</span>
												<span className="text-muted-foreground text-xs">
													{data?.total} crédito{data?.total === 1 ? "" : "s"}
												</span>
											</div>
											{data?.items.map((item) => (
												<button
													key={item.cuotaId}
													type="button"
													onClick={() =>
														navigate({
															to: "/cobros/$id",
															params: { id: item.numeroCreditoSifco },
															search: { tipo: "caso" },
														})
													}
													className="flex w-full items-center justify-between gap-3 rounded-lg border bg-background p-2.5 text-left transition-colors hover:bg-muted/50"
												>
													<div className="flex min-w-0 items-center gap-2">
														<BucketBadge
															estadoKey={
																KEY_POR_NUMERO[item.bucket ?? 0] ?? "al_dia"
															}
															catalogo={catalogo}
														/>
														<div className="min-w-0">
															<div className="truncate font-medium text-sm">
																{item.cliente ?? "Cliente sin nombre"}
															</div>
															<div className="text-muted-foreground text-xs">
																SIFCO {item.numeroCreditoSifco} ·{" "}
																{montoQ(item.montoCuota)}
															</div>
														</div>
													</div>
													<ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
												</button>
											))}
											{(data?.total ?? 0) > (data?.items.length ?? 0) && (
												<p className="text-muted-foreground text-xs">
													Mostrando primeros {data?.items.length} de{" "}
													{data?.total} créditos.
												</p>
											)}
										</div>
									))
							)}
						</div>
					)}
				</CardContent>
			</Card>

			{/* Una sola lista, dos alcances */}
			<Card ref={tablaRef}>
				<CardContent className="pt-6">
					<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
						<div>
							<h2 className="font-semibold text-lg">
								{enCartera
									? "Toda mi cartera"
									: "Casos que requieren atención hoy"}
							</h2>
							<p className="text-muted-foreground text-xs">
								{enCartera
									? "Todos tus créditos, ordenados por proximidad de pago."
									: "Ordenados por prioridad de bucket y días de mora."}
							</p>
						</div>
						<div className="flex items-center gap-2">
							{filtro && !enCartera && (
								<Button
									variant="ghost"
									size="sm"
									className="h-7 text-muted-foreground text-xs"
									onClick={() => {
										setFiltro(null);
										setPage(1);
									}}
								>
									Quitar filtro
								</Button>
							)}
							{/* Un solo lugar, dos alcances: lo urgente de hoy y la cartera
							    completa (que nunca está vacía). */}
							<div className="inline-flex rounded-lg border p-0.5">
								<Button
									type="button"
									size="sm"
									variant={enCartera ? "ghost" : "default"}
									className="h-7 rounded-md px-3 text-xs"
									onClick={() => cambiarAlcance("prioritarios")}
								>
									Prioritarios ({total})
								</Button>
								<Button
									type="button"
									size="sm"
									variant={enCartera ? "default" : "ghost"}
									className="h-7 rounded-md px-3 text-xs"
									onClick={() => cambiarAlcance("cartera")}
								>
									Toda mi cartera ({carteraTotal})
								</Button>
							</div>
						</div>
					</div>

					{(enCartera ? carteraQuery : colaQuery).isPending ? (
						<div className="flex items-center justify-center py-16">
							<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
						</div>
					) : (enCartera ? carteraQuery : colaQuery).isError ? (
						<div className="py-10 text-center text-destructive text-sm">
							Error al cargar la cartera. Intentá recargar la página.
						</div>
					) : !enCartera && sinAsesor ? (
						<div className="py-10 text-center text-muted-foreground text-sm">
							Tu usuario no está vinculado a un asesor de cartera (por correo).
							Pedile al supervisor que revise tu correo de asesor.
						</div>
					) : enCartera ? (
						carteraTotal === 0 ? (
							<div className="py-10 text-center text-muted-foreground text-sm">
								No tienes créditos asignados todavía.
							</div>
						) : (
							<>
								<div className="overflow-x-auto">
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Cliente / Crédito</TableHead>
												<TableHead>Vehículo</TableHead>
												<TableHead>Bucket</TableHead>
												<TableHead>Próximo pago</TableHead>
												<TableHead className="text-right">Cuota</TableHead>
												<TableHead className="text-right">Mora</TableHead>
												<TableHead className="text-right">Capital</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{carteraItems.map((item) => (
												<TableRow
													key={item.contratoId}
													className="cursor-pointer"
													onClick={() => setDetalle(filaDeCartera(item))}
												>
													<TableCell className="max-w-64">
														<div className="truncate font-medium">
															{item.clienteNombre}
														</div>
														<div className="truncate font-mono text-muted-foreground text-xs">
															{item.numeroCredito ?? "Sin número"}
														</div>
													</TableCell>
													<TableCell>
														<Vehiculo
															marca={item.vehiculoMarca}
															modelo={item.vehiculoModelo}
															year={item.vehiculoYear}
															placa={item.vehiculoPlaca}
														/>
													</TableCell>
													<TableCell>
														<BucketBadge
															estadoKey={
																item.estadoContrato === "activo"
																	? (item.estadoMora ?? "al_dia")
																	: item.estadoContrato
															}
															catalogo={catalogo}
														/>
													</TableCell>
													<TableCell className="text-sm">
														<ProximoPago fecha={item.fechaProximoPago} />
													</TableCell>
													<TableCell className="text-right text-sm tabular-nums">
														{montoQ(item.cuotaMensual)}
													</TableCell>
													<TableCell className="text-right text-sm tabular-nums">
														{Number(item.montoEnMora ?? 0) > 0 ? (
															<span className="text-red-600">
																{montoQ(item.montoEnMora)}
															</span>
														) : (
															"—"
														)}
													</TableCell>
													<TableCell className="text-right text-sm tabular-nums">
														{montoQ(item.montoFinanciado)}
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								</div>
								<Paginacion
									mostrando={carteraItems.length}
									total={carteraTotal}
									page={page}
									totalPages={carteraTotalPages}
									cargando={carteraQuery.isFetching}
									onPage={setPage}
								/>
							</>
						)
					) : total === 0 ? (
						<div className="py-10 text-center text-muted-foreground text-sm">
							{filtro
								? "Sin casos en esta categoría hoy."
								: "Sin casos pendientes por hoy. 🎉"}
							<div className="mt-3">
								<Button
									variant="outline"
									size="sm"
									onClick={() => cambiarAlcance("cartera")}
								>
									Ver toda mi cartera ({carteraTotal})
								</Button>
							</div>
						</div>
					) : (
						<>
							<div className="overflow-x-auto">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Cliente / Crédito</TableHead>
											<TableHead>Vehículo</TableHead>
											<TableHead>Bucket</TableHead>
											<TableHead>Categoría</TableHead>
											<TableHead>Límite SLA</TableHead>
											<TableHead>Promesa</TableHead>
											<TableHead>Teléfono</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{items.map((item) => (
											<TableRow
												key={item.creditoId}
												className="cursor-pointer"
												onClick={() => setDetalle(filaDeCola(item))}
											>
												<TableCell className="max-w-64">
													<div className="truncate font-medium">
														{item.cliente}
													</div>
													<div className="truncate font-mono text-muted-foreground text-xs">
														{item.numeroCreditoSifco}
													</div>
												</TableCell>
												<TableCell>
													<Vehiculo
														marca={item.vehiculoMarca}
														modelo={item.vehiculoModelo}
														year={item.vehiculoYear}
														placa={item.vehiculoPlaca}
													/>
												</TableCell>
												<TableCell>
													<BucketBadge
														estadoKey={KEY_POR_NUMERO[item.bucket] ?? "al_dia"}
														catalogo={catalogo}
													/>
												</TableCell>
												<TableCell>
													<CategoriaBadges item={item} />
												</TableCell>
												<TableCell className="text-sm">
													{fechaLegible(item.fechaLimiteSla)}
												</TableCell>
												<TableCell className="text-sm">
													{fechaLegible(item.fechaPromesa)}
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
											</TableRow>
										))}
									</TableBody>
								</Table>
							</div>
							<Paginacion
								mostrando={items.length}
								total={total}
								page={page}
								totalPages={totalPages}
								cargando={colaQuery.isFetching}
								onPage={setPage}
							/>
						</>
					)}
				</CardContent>
			</Card>

			{/* Mismo panel que usa el dashboard: se decide acá, se gestiona en la
			    Ficha 360. */}
			<PanelGestionRapida
				creditoId={detalle?.numeroCreditoSifco ?? null}
				open={!!detalle}
				onClose={() => setDetalle(null)}
			/>
		</div>
	);
}

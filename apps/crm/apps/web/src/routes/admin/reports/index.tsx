import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	Activity,
	AlertTriangle,
	CalendarDays,
	ChevronLeft,
	ChevronRight,
	Download,
	FileText,
	Loader2,
	Sparkles,
	Target,
	TrendingDown,
	TrendingUp,
	Wallet,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import {
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	Legend,
	Line,
	LineChart,
	Pie,
	PieChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { PeriodDatePicker } from "@/components/reports/period-date-picker";
import { ReportCard } from "@/components/reports/report-card";
import { ReinvestmentReport } from "@/components/reports/reinvestment-report";
import { ScenarioModal } from "@/components/reports/scenario-modal";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { authClient } from "@/lib/auth-client";
import { shouldRedirectToLogin } from "@/lib/auth-session";
import {
	fillMissingMontoACobrarPeriods,
	getMontoACobrarParticipacionTotals,
	getMontoACobrarViewRow,
} from "@/lib/reports/monto-a-cobrar";
import { buildAdminReportsWorkbook } from "@/lib/reports/report-workbook";
import type {
	ComparativoHistoricoRow,
	FacturacionMesResponse,
	FacturacionMesRubro,
	MontoACobrarPeriodoRow,
	MontoACobrarRow,
	PuntoEquilibrioRow,
	ReinversionLiquidacionesResponse,
} from "@/lib/reports/scenario";
import {
	coberturaConfig,
	comparativoConfig,
	facturacionConfig,
	montoACobrarConfig,
} from "@/lib/reports/scenario-configs";
import { PERMISSIONS } from "@/lib/roles";
import { client, orpc, queryClient } from "@/utils/orpc";
import { getReportTabs } from "./-tabs";
type SimulacionInversionistaResult = {
	success: boolean;
	data: {
		inversionista_id: number;
		nombre: string;
		tipo_reinversion: string | null;
		moneda: string | null;
		emite_factura: boolean;
		monto_reinversion_mensual: number;
		total_monto_aportado: number;
		total_capital_actual: number;
		capital_restante_global: number;
		desglose_acumulado: {
			total_creditos: number;
			total_reinversion: number;
			total_acumulado: number;
			meses: Array<{
				mes: string;
				total_sin_reinversion: number;
				total_con_reinversion: number;
				total_reinversion: number;
				total_capital_restante: number;
			}>;
		};
	};
};

type InversionistaItem = { inversionista_id: number; nombre: string };

export const Route = createFileRoute("/admin/reports/")({
	component: RouteComponent,
});

const COLORS = {
	al_dia: "#22c55e",
	mora_30: "#eab308",
	mora_60: "#f97316",
	mora_90: "#ef4444",
	mora_120: "#dc2626",
	mora_120_plus: "#991b1b",
	pagado: "#10b981",
	incobrable: "#7f1d1d",
};

/** Mes por defecto (actual) en formato "YYYY-MM" para el <input type="month">. */
function getDefaultFlujoMes(): string {
	const todayGt = formatDateInput(new Date());
	const [year, month] = todayGt.split("-");
	return `${year}-${month}`;
}

const MESES = [
	"Enero",
	"Febrero",
	"Marzo",
	"Abril",
	"Mayo",
	"Junio",
	"Julio",
	"Agosto",
	"Septiembre",
	"Octubre",
	"Noviembre",
	"Diciembre",
];

function coberturaColor(cobertura: string | null): string {
	if (!cobertura) return "#6b7280";
	const pct = Number(cobertura);
	if (pct >= 100) return "#22c55e";
	if (pct >= 70) return "#eab308";
	return "#ef4444";
}

function coberturaLabel(cobertura: string | null): string {
	if (!cobertura) return "Sin meta";
	return `${cobertura}%`;
}

const FACTURACION_RUBROS: { key: keyof FacturacionMesRubro; label: string }[] =
	[
		{ key: "interes", label: "Interés" },
		{ key: "membresias", label: "Membresías" },
		{ key: "seguro_gps", label: "Seguro + GPS" },
		{ key: "royalti", label: "Royaltí" },
		{ key: "mora", label: "Mora" },
		{ key: "otros", label: "Otros" },
	];

const MONTO_COBRAR_COLORS = {
	capital: "#3b82f6",
	interesIva: "#10b981",
	servicios: "#f97316",
	membresias: "#ec4899",
} as const;

const MONTO_COBRAR_LABELS: Record<keyof typeof MONTO_COBRAR_COLORS, string> = {
	capital: "Capital",
	interesIva: "Interés + IVA",
	servicios: "Servicios (Seguro + GPS)",
	membresias: "Membresías",
};

const GUATEMALA_TIME_ZONE = "America/Guatemala";

function formatDateInput(date: Date) {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: GUATEMALA_TIME_ZONE,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(date);
}

// Fecha legible en zona Guatemala, p.ej. "17 jun 2026".
function formatFechaCorta(value: string | Date | null | undefined): string {
	if (!value) return "-";
	const date = typeof value === "string" ? new Date(value) : value;
	return new Intl.DateTimeFormat("es-GT", {
		timeZone: GUATEMALA_TIME_ZONE,
		day: "2-digit",
		month: "short",
		year: "numeric",
	}).format(date);
}

function getDefaultMontoCobrarRange(): {
	fechaInicio: string;
	fechaFin: string;
} {
	const today = formatDateInput(new Date());
	const fin = new Date();
	fin.setFullYear(fin.getFullYear() + 1);
	return { fechaInicio: today, fechaFin: formatDateInput(fin) };
}

function getDefaultRangeForPeriodo(
	periodo: "anio" | "trimestre" | "mes" | "semana" | "dia",
): { fechaInicio: string; fechaFin: string } {
	const now = new Date();
	const year = now.getFullYear();
	const month = now.getMonth() + 1;
	const pad = (n: number) => String(n).padStart(2, "0");
	const lastDay = (y: number, m: number) => new Date(y, m, 0).getDate();
	if (periodo === "anio") {
		return { fechaInicio: `${year}-01-01`, fechaFin: `${year}-12-31` };
	}
	if (periodo === "trimestre") {
		const q = Math.ceil(month / 3);
		const startMonth = (q - 1) * 3 + 1;
		const endMonth = startMonth + 2;
		return {
			fechaInicio: `${year}-${pad(startMonth)}-01`,
			fechaFin: `${year}-${pad(endMonth)}-${pad(lastDay(year, endMonth))}`,
		};
	}
	return {
		fechaInicio: `${year}-${pad(month)}-01`,
		fechaFin: `${year}-${pad(month)}-${pad(lastDay(year, month))}`,
	};
}

function formatBucket(bucket: string, periodo: string): string {
	const date = new Date(bucket.length === 10 ? `${bucket}T12:00:00` : bucket);
	if (periodo === "dia") {
		return new Intl.DateTimeFormat("es-GT", {
			day: "2-digit",
			month: "short",
		}).format(date);
	}
	if (periodo === "semana") {
		return `Sem ${new Intl.DateTimeFormat("es-GT", {
			day: "2-digit",
			month: "short",
		}).format(date)}`;
	}
	if (periodo === "trimestre") {
		const q = Math.ceil((date.getMonth() + 1) / 3);
		return `T${q} ${date.getFullYear()}`;
	}
	if (periodo === "anio") {
		return String(date.getFullYear());
	}
	return new Intl.DateTimeFormat("es-GT", {
		month: "short",
		year: "numeric",
	}).format(date);
}

// Filas por página del reporte "Créditos cerrados" (paginado del lado servidor).
const CLOSED_CREDITS_PAGE_SIZE = 25;

function SimularButton({ onClick }: { onClick: () => void }) {
	return (
		<Button variant="outline" size="sm" className="gap-1.5" onClick={onClick}>
			<Sparkles className="h-3.5 w-3.5 text-purple-500" />
			Simular
		</Button>
	);
}

// Un control de filtro con su etiqueta encima. Da jerarquía a las barras de
// filtros: cada control dice qué controla, agrupados visualmente.
function FilterField({
	label,
	className,
	children,
}: {
	label: string;
	className?: string;
	children: ReactNode;
}) {
	return (
		<div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
			<span className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
				{label}
			</span>
			{children}
		</div>
	);
}

function ProgressBar({ value, max }: { value: number; max: number }) {
	const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
	const color = pct >= 100 ? "#22c55e" : pct >= 80 ? "#eab308" : "#ef4444";
	return (
		<div className="flex items-center gap-2">
			<div className="h-2 flex-1 overflow-hidden rounded-full bg-primary/20">
				<div
					className="h-full rounded-full transition-all"
					style={{ width: `${pct}%`, backgroundColor: color }}
				/>
			</div>
			<span className="w-10 text-right text-xs">{pct.toFixed(0)}%</span>
		</div>
	);
}

function RouteComponent() {
	const {
		data: session,
		error: sessionError,
		isPending,
	} = authClient.useSession();
	const navigate = Route.useNavigate();
	const [closedCreditsMes, setClosedCreditsMes] = useState(() => ({
		mes: new Date().getMonth() + 1,
		anio: new Date().getFullYear(),
	}));
	const [closedCreditsPage, setClosedCreditsPage] = useState(1);
	const [isExportingCerrados, setIsExportingCerrados] = useState(false);
	const [montoCobrarPeriodo, setMontoCobrarPeriodo] = useState<
		"anio" | "trimestre" | "mes" | "semana" | "dia"
	>("mes");
	const [montoCobrarRange, setMontoCobrarRange] = useState(() =>
		getDefaultRangeForPeriodo("mes"),
	);
	const [montoCobrarAcumulado, setMontoCobrarAcumulado] = useState(false);
	const [facturacionMes, setFacturacionMes] = useState(() => ({
		mes: new Date().getMonth() + 1,
		anio: new Date().getFullYear(),
	}));
	const [flujoMes, setFlujoMes] = useState(getDefaultFlujoMes);
	const [flujoAnioStr, flujoMesStr] = flujoMes.split("-");
	const flujoMesNum = Number(flujoMesStr);
	const flujoAnioNum = Number(flujoAnioStr);
	// Selectores de mes/año: últimos 3 años y sin meses a futuro.
	const flujoHoy = new Date();
	const flujoAnioActual = flujoHoy.getFullYear();
	const flujoMesActual = flujoHoy.getMonth() + 1;
	const aniosDisponibles = [
		flujoAnioActual,
		flujoAnioActual - 1,
		flujoAnioActual - 2,
	];
	const mesesDisponibles = MESES.map((nombre, i) => ({
		num: i + 1,
		nombre,
	})).filter((m) => flujoAnioNum < flujoAnioActual || m.num <= flujoMesActual);
	const setFlujoMesAnio = (anio: number, mes: number) => {
		// No permitir meses a futuro en el año actual.
		const m =
			anio === flujoAnioActual && mes > flujoMesActual ? flujoMesActual : mes;
		setFlujoMes(`${anio}-${String(m).padStart(2, "0")}`);
	};
	const [comparativoAnio, setComparativoAnio] = useState(() =>
		new Date().getFullYear(),
	);
	const [metasAnio, setMetasAnio] = useState(new Date().getFullYear());
	const [editMetas, setEditMetas] = useState<Record<number, string>>({});
	const [metasModalOpen, setMetasModalOpen] = useState(false);
	const [scenarioOpen, setScenarioOpen] = useState<
		null | "monto" | "facturacion" | "flujo" | "cobertura" | "comparativo"
	>(null);
	const [isSavingMetas, setIsSavingMetas] = useState(false);
	const [focusedMes, setFocusedMes] = useState<number | null>(null);
	const [equilibrioPeriodo, setEquilibrioPeriodo] = useState<
		"anio" | "trimestre" | "mes" | "semana" | "dia"
	>("mes");
	// Alineado al período por defecto ("mes") y a un solo año: el PeriodDatePicker
	// en modo mes tiene un único selector de año, así que un rango que cruce de año
	// (p.ej. "últimos 6 meses" en enero) se renderizaría/editaría mal.
	const [equilibrioRange, setEquilibrioRange] = useState(() =>
		getDefaultRangeForPeriodo("mes"),
	);

	const [proyeccionInvId, setProyeccionInvId] = useState<number | null>(null);
	const [proyeccionAnio, setProyeccionAnio] = useState<number>(
		new Date().getFullYear(),
	);
	const [proyeccionMes, setProyeccionMes] = useState<number | null>(null);
	const [proyeccionEnabled, setProyeccionEnabled] = useState(false);

	const userProfile = useQuery(orpc.getUserProfile.queryOptions());
	const userRole = userProfile.data?.role;
	const isAdmin = userRole ? PERMISSIONS.canAccessAdmin(userRole) : false;
	const canAccessClosedCreditsReport = userRole
		? PERMISSIONS.canAccessClosedCreditsReport(userRole)
		: false;
	const canAccessCobranzaReport = userRole
		? PERMISSIONS.canAccessCobranzaReport(userRole)
		: false;
	const canAccessReports =
		isAdmin || canAccessClosedCreditsReport || canAccessCobranzaReport;
	const reportTabs = getReportTabs({
		canAccessClosedCreditsReport,
		canAccessCobranzaReport,
		isAdmin,
	});

	const dashboardData = useQuery({
		...orpc.getDashboardExecutivo.queryOptions({
			input: {},
		}),
		enabled: isAdmin,
	});

	const closedCreditsReport = useQuery({
		...orpc.getReporteCreditosCerrados.queryOptions({
			input: {
				anio: closedCreditsMes.anio,
				mes: closedCreditsMes.mes,
				page: closedCreditsPage,
				pageSize: CLOSED_CREDITS_PAGE_SIZE,
			},
		}),
		enabled: canAccessClosedCreditsReport,
	});

	// Si la página quedó fuera de rango (datos borrados / page stale), el total
	// del server sigue siendo correcto: volvemos a la última página válida en vez
	// de mostrar el mes vacío.
	useEffect(() => {
		const total = closedCreditsReport.data?.total ?? 0;
		const totalPages = Math.max(1, Math.ceil(total / CLOSED_CREDITS_PAGE_SIZE));
		if (closedCreditsPage > totalPages) {
			setClosedCreditsPage(totalPages);
		}
	}, [closedCreditsReport.data?.total, closedCreditsPage]);

	const montoCobrarQuery = useQuery({
		...orpc.getMontoACobrarPeriodo.queryOptions({
			input: {
				periodo: montoCobrarPeriodo,
				fechaInicio: montoCobrarRange.fechaInicio,
				fechaFin: montoCobrarRange.fechaFin,
			},
		}),
		enabled: canAccessCobranzaReport,
	});
	const montoCobrarData = montoCobrarQuery.data as
		| { data: MontoACobrarPeriodoRow[] }
		| undefined;
	const montoCobrarRows = fillMissingMontoACobrarPeriods(
		montoCobrarData?.data ?? [],
		montoCobrarPeriodo,
		montoCobrarRange.fechaInicio,
		montoCobrarRange.fechaFin,
	);

	const facturacionMesQuery = useQuery({
		...orpc.getFacturacionMes.queryOptions({
			input: { mes: facturacionMes.mes, anio: facturacionMes.anio },
		}),
		enabled: canAccessCobranzaReport,
	});
	const facturacionMesData = facturacionMesQuery.data as
		| FacturacionMesResponse
		| undefined;

	// Reporte mensual final de inversión y reinversión.
	const reinversionLiquidacionesQuery = useQuery({
		...orpc.getReinversionLiquidaciones.queryOptions({
			input: { mes: flujoMesNum, anio: flujoAnioNum },
		}),
		enabled: isAdmin,
	});
	const reinversionData = reinversionLiquidacionesQuery.data as
		| ReinversionLiquidacionesResponse
		| undefined;

	const investorsCarteraQuery = useQuery({
		...orpc.getInvestorsCartera.queryOptions({ input: {} }),
		enabled: isAdmin,
		staleTime: 1000 * 60 * 10,
	});

	const simulacionQuery = useQuery({
		...orpc.getSimulacionInversionista.queryOptions({
			input: { inversionistaId: proyeccionInvId ?? 0, anio: proyeccionAnio },
		}),
		enabled: isAdmin && proyeccionEnabled && proyeccionInvId !== null,
		staleTime: 1000 * 60 * 10,
		placeholderData: undefined,
	});

	const comparativoQuery = useQuery({
		...orpc.getComparativoHistorico.queryOptions({
			input: { anio: comparativoAnio },
		}),
		enabled: isAdmin,
	});
	const comparativoData = comparativoQuery.data as
		| { data: ComparativoHistoricoRow[] }
		| undefined;

	const metasQuery = useQuery({
		...orpc.getMetas.queryOptions({
			input: { anio: metasAnio, tipo: "colocacion" },
		}),
		enabled: isAdmin,
	});

	const upsertMetaMutation = useMutation({
		mutationFn: async (vars: {
			tipo: "colocacion" | "cobros" | "mora_maxima" | "captacion";
			anio: number;
			mes: number;
			monto: string;
		}) => client.upsertMeta(vars),
		onSuccess: () => {
			queryClient.invalidateQueries(
				orpc.getMetas.queryOptions({
					input: { anio: metasAnio, tipo: "colocacion" },
				}),
			);
		},
		onError: (error: Error) => {
			toast.error(error.message);
		},
	});

	const puntoEquilibrioQuery = useQuery({
		...orpc.getPuntoEquilibrio.queryOptions({
			input: {
				periodo: equilibrioPeriodo,
				fechaInicio: equilibrioRange.fechaInicio,
				fechaFin: equilibrioRange.fechaFin,
			},
		}),
		enabled: isAdmin,
	});
	const puntoEquilibrioData = puntoEquilibrioQuery.data as
		| { data: PuntoEquilibrioRow[] }
		| undefined;

	const handleGuardarTodo = useCallback(async () => {
		const saves = MESES.map((_, idx) => {
			const mes = idx + 1;
			const monto = editMetas[mes];
			const montoNum = Number(monto ?? "0");
			if (Number.isNaN(montoNum)) return null;
			return client.upsertMeta({
				tipo: "colocacion",
				anio: metasAnio,
				mes,
				monto: montoNum.toFixed(2),
			});
		}).filter(Boolean);
		if (saves.length === 0) return;
		setIsSavingMetas(true);
		try {
			await Promise.all(saves);
			await Promise.all([
				queryClient.invalidateQueries(
					orpc.getMetas.queryOptions({
						input: { anio: metasAnio, tipo: "colocacion" },
					}),
				),
				queryClient.invalidateQueries(
					orpc.getPuntoEquilibrio.queryOptions({
						input: {
							periodo: equilibrioPeriodo,
							fechaInicio: equilibrioRange.fechaInicio,
							fechaFin: equilibrioRange.fechaFin,
						},
					}),
				),
			]);
			toast.success(`${saves.length} metas guardadas`);
			setMetasModalOpen(false);
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : "Error al guardar metas",
			);
		} finally {
			setIsSavingMetas(false);
		}
	}, [editMetas, metasAnio, equilibrioPeriodo, equilibrioRange]);

	useEffect(() => {
		if (Array.isArray(metasQuery.data)) {
			const map: Record<number, string> = {};
			for (const row of metasQuery.data as { mes: number; monto: string }[]) {
				map[row.mes] = String(Number(row.monto));
			}
			setEditMetas(map);
		}
	}, [metasQuery.data]);

	useEffect(() => {
		if (shouldRedirectToLogin({ error: sessionError, isPending, session })) {
			navigate({ to: "/login" });
		} else if (session && !userProfile.isPending && !canAccessReports) {
			navigate({ to: "/dashboard" });
			toast.error("Acceso denegado: no tienes permiso para ver reportes");
		}
	}, [
		session,
		sessionError,
		isPending,
		userProfile.isPending,
		canAccessReports,
		navigate,
	]);

	if (isPending || userProfile.isPending) {
		return <div>Cargando...</div>;
	}

	if (!canAccessReports) {
		return null;
	}

	const formatCurrency = (value: string | number | null | undefined) => {
		if (!value) return "Q0.00";
		const num = typeof value === "string" ? Number.parseFloat(value) : value;
		return new Intl.NumberFormat("es-GT", {
			style: "currency",
			currency: "GTQ",
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		}).format(num);
	};

	// Igual que formatCurrency pero muestra "—" cuando el monto es 0.
	const dash = (value: string | number | null | undefined) =>
		Number(value ?? 0) === 0 ? "—" : formatCurrency(value);

	const moraData = dashboardData.data?.morosidad || [];
	const totalEnMora = moraData
		.filter((m) => m.estadoMora !== "pagado" && m.estadoMora !== "al_dia")
		.reduce((acc, m) => acc + Number(m.montoTotal || 0), 0);

	const totalPagado = moraData
		.filter((m) => m.estadoMora === "pagado")
		.reduce((acc, m) => acc + Number(m.montoTotal || 0), 0);

	// Preparar datos para gráficas
	const pieData = moraData
		.filter((m) => m.estadoMora !== "al_dia")
		.map((m) => ({
			name:
				m.estadoMora === "pagado"
					? "Pagado"
					: m.estadoMora === "mora_30"
						? "Mora 30"
						: m.estadoMora === "mora_60"
							? "Mora 60"
							: m.estadoMora === "mora_90"
								? "Mora 90"
								: m.estadoMora === "mora_120"
									? "Mora 120"
									: m.estadoMora === "mora_120_plus"
										? "Mora 120+"
										: "Incobrable",
			value: Number(m.montoTotal || 0),
			count: m.totalCuotas,
		}));

	const pipelineData = (dashboardData.data?.pipeline || []).map((p) => ({
		etapa: p.etapa,
		oportunidades: p.totalOportunidades,
		valor: Number(p.valorTotal || 0),
	}));

	const contratosData = (dashboardData.data?.nuevosContratos || []).map(
		(c) => ({
			mes: c.mes,
			contratos: c.total,
			monto: Number(c.monto || 0),
		}),
	);

	// Exporta TODO el mes (sin paginar): se pide al server sin `pageSize`.
	const exportClosedCreditsExcel = async () => {
		setIsExportingCerrados(true);
		try {
			const res = await client.getReporteCreditosCerrados({
				anio: closedCreditsMes.anio,
				mes: closedCreditsMes.mes,
			});
			const headers = [
				"Fecha de Cierre",
				"Nombre del Cliente",
				"SIFCO",
				"Cuota de Seguro",
				"Monto del Crédito",
				"Cuota del Crédito",
				"Día de Pago",
			];
			const data = res.rows.map((row) => [
				row.fechaCierre ? formatFechaCorta(row.fechaCierre) : "",
				row.clienteNombre || "",
				row.numeroSifco || "",
				Number(row.cuotaSeguro ?? 0),
				Number(row.montoCredito ?? 0),
				Number(row.cuotaCredito ?? 0),
				row.diaPago ?? "",
			]);
			const worksheet = XLSX.utils.aoa_to_sheet([headers, ...data]);
			const workbook = XLSX.utils.book_new();
			XLSX.utils.book_append_sheet(workbook, worksheet, "Créditos cerrados");
			XLSX.writeFile(
				workbook,
				`creditos-cerrados-${closedCreditsMes.anio}-${String(
					closedCreditsMes.mes,
				).padStart(2, "0")}.xlsx`,
			);
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : "Error al exportar el reporte",
			);
		} finally {
			setIsExportingCerrados(false);
		}
	};
	const exportAdminReportsExcel = () => {
		if (!montoCobrarData || !reinversionData) {
			toast.error("Espera a que Cobranza e Inversión terminen de cargar.");
			return;
		}
		try {
			const workbook = buildAdminReportsWorkbook({
				cobranza: {
					rows: montoCobrarRows,
					acumulado: montoCobrarAcumulado,
				},
				reinvestment: reinversionData,
				metadata: {
					cobranzaPeriodo: `${montoCobrarRange.fechaInicio} a ${montoCobrarRange.fechaFin}`,
					inversionPeriodo: `${MESES[flujoMesNum - 1]} de ${flujoAnioNum}`,
					generatedAt: new Date().toISOString(),
				},
			});
			XLSX.writeFile(
				workbook,
				`reportes-admin-${flujoAnioNum}-${String(flujoMesNum).padStart(2, "0")}.xlsx`,
			);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "No fue posible exportar.",
			);
		}
	};

	const closedCreditsRows = closedCreditsReport.data?.rows ?? [];
	const closedCreditsTotal = closedCreditsReport.data?.total ?? 0;
	const closedCreditsTotalPages = Math.max(
		1,
		Math.ceil(closedCreditsTotal / CLOSED_CREDITS_PAGE_SIZE),
	);

	const creditosCerradosCard = (
		<Card>
			<CardHeader>
				<div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
					<div>
						<CardTitle>Créditos cerrados</CardTitle>
						<CardDescription>
							Oportunidades ganadas, según el mes en que se cerraron.
						</CardDescription>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<Select
							value={String(closedCreditsMes.mes)}
							onValueChange={(v) => {
								setClosedCreditsMes((prev) => ({ ...prev, mes: Number(v) }));
								setClosedCreditsPage(1);
							}}
						>
							<SelectTrigger className="w-36">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{MESES.map((label, i) => (
									<SelectItem key={label} value={String(i + 1)}>
										{label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<Input
							type="number"
							className="w-24"
							value={closedCreditsMes.anio}
							min={2020}
							max={2100}
							onChange={(e) => {
								setClosedCreditsMes((prev) => ({
									...prev,
									anio: Number(e.target.value),
								}));
								setClosedCreditsPage(1);
							}}
						/>
						<Button
							onClick={exportClosedCreditsExcel}
							disabled={isExportingCerrados || closedCreditsTotal === 0}
						>
							{isExportingCerrados ? (
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							) : (
								<Download className="mr-2 h-4 w-4" />
							)}
							Exportar Excel
						</Button>
					</div>
				</div>
			</CardHeader>
			<CardContent>
				{closedCreditsReport.isPending && <p>Cargando...</p>}
				{closedCreditsReport.isError && (
					<p className="text-destructive">Error al cargar el reporte.</p>
				)}
				{closedCreditsReport.data && closedCreditsTotal === 0 && (
					<p className="text-muted-foreground">
						No hay créditos cerrados para el mes seleccionado.
					</p>
				)}
				{closedCreditsRows.length > 0 && (
					<div className="space-y-4">
						<div className="overflow-x-auto [&_td]:px-5 [&_th]:px-5">
							<Table className="tabular-nums">
								<TableHeader>
									<TableRow>
										<TableHead>Fecha de Cierre</TableHead>
										<TableHead>Cliente / SIFCO</TableHead>
										<TableHead className="text-right">
											Cuota de Seguro
										</TableHead>
										<TableHead className="text-right">
											Monto del Crédito
										</TableHead>
										<TableHead className="text-right">
											Cuota del Crédito
										</TableHead>
										<TableHead className="text-right">Día de Pago</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{closedCreditsRows.map((row) => (
										<TableRow key={row.id}>
											<TableCell>{formatFechaCorta(row.fechaCierre)}</TableCell>
											<TableCell>
												<div className="font-medium">
													{row.clienteNombre || "-"}
												</div>
												<div className="text-muted-foreground text-xs">
													{row.numeroSifco || "Sin SIFCO"}
												</div>
											</TableCell>
											<TableCell className="text-right">
												{formatCurrency(row.cuotaSeguro)}
											</TableCell>
											<TableCell className="text-right">
												{formatCurrency(row.montoCredito)}
											</TableCell>
											<TableCell className="text-right">
												{row.cuotaCredito
													? formatCurrency(row.cuotaCredito)
													: "-"}
											</TableCell>
											<TableCell className="text-right">
												{row.diaPago ?? "-"}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
						<div className="flex items-center justify-between">
							<p className="text-muted-foreground text-sm">
								{closedCreditsTotal}{" "}
								{closedCreditsTotal === 1 ? "crédito" : "créditos"} · Página{" "}
								{closedCreditsPage} de {closedCreditsTotalPages}
							</p>
							<div className="flex items-center gap-2">
								<Button
									variant="outline"
									size="sm"
									onClick={() =>
										setClosedCreditsPage((p) => Math.max(1, p - 1))
									}
									disabled={closedCreditsPage <= 1}
								>
									<ChevronLeft className="h-4 w-4" />
									Anterior
								</Button>
								<Button
									variant="outline"
									size="sm"
									onClick={() =>
										setClosedCreditsPage((p) =>
											Math.min(closedCreditsTotalPages, p + 1),
										)
									}
									disabled={closedCreditsPage >= closedCreditsTotalPages}
								>
									Siguiente
									<ChevronRight className="h-4 w-4" />
								</Button>
							</div>
						</div>
					</div>
				)}
			</CardContent>
		</Card>
	);

	return (
		<div className="container mx-auto space-y-6 p-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="font-bold text-3xl">
						{isAdmin ? "Dashboard Ejecutivo" : "Reportes"}
					</h1>
					<p className="text-muted-foreground">
						{isAdmin
							? "Vista general del negocio y métricas clave"
							: "Reportes disponibles para el área de cobros"}
					</p>
				</div>
			</div>

			<Tabs defaultValue={reportTabs.defaultTab} className="space-y-6">
						<TabsList>
							{canAccessClosedCreditsReport && (
								<TabsTrigger value="creditos">Créditos cerrados</TabsTrigger>
							)}
							{/* Tabs "Resumen" y "Gráficas" ocultos a propósito. Las
							    secciones (TabsContent value="resumen" / "graficas") se
							    conservan más abajo por si se quieren reutilizar; para
							    volver a mostrarlas, reañadir aquí sus TabsTrigger. */}
							{canAccessCobranzaReport && (
								<TabsTrigger value="cobranza">Cobranza</TabsTrigger>
							)}
							{isAdmin && (
								<>
									<TabsTrigger value="inversiones">Inversiones</TabsTrigger>
									<TabsTrigger value="colocacion">Colocación</TabsTrigger>
									<TabsTrigger value="proyeccion-liquidaciones">
										Proyección Liquidaciones
									</TabsTrigger>
								</>
							)}
						</TabsList>
						{canAccessCobranzaReport && (
							<>
								<ScenarioModal
									open={scenarioOpen === "monto"}
									onOpenChange={(o) => setScenarioOpen(o ? "monto" : null)}
									config={montoACobrarConfig}
									baseData={montoCobrarData?.data}
								/>
								<ScenarioModal
									open={scenarioOpen === "facturacion"}
									onOpenChange={(o) => setScenarioOpen(o ? "facturacion" : null)}
									config={facturacionConfig}
									baseData={facturacionMesData}
								/>
							</>
						)}
						{canAccessClosedCreditsReport && (
							<TabsContent value="creditos" className="space-y-6">
								{creditosCerradosCard}
							</TabsContent>
						)}
						{isAdmin && (
							<>
						<TabsContent value="resumen" className="space-y-6">
							{/* Enlaces a otros reportes - TODO: Implementar rutas */}
							<div className="grid gap-4 md:grid-cols-4">
								<div className="rounded-lg border bg-card p-4 text-card-foreground opacity-50 shadow-sm">
									<div className="flex items-center gap-2">
										<AlertTriangle className="h-5 w-5 text-orange-500" />
										<span className="font-semibold">Cobranza</span>
									</div>
									<p className="mt-1 text-muted-foreground text-sm">
										Gestión de mora y recuperación (Próximamente)
									</p>
								</div>
								<div className="rounded-lg border bg-card p-4 text-card-foreground opacity-50 shadow-sm">
									<div className="flex items-center gap-2">
										<Wallet className="h-5 w-5 text-blue-500" />
										<span className="font-semibold">Cartera</span>
									</div>
									<p className="mt-1 text-muted-foreground text-sm">
										Análisis de créditos activos (Próximamente)
									</p>
								</div>
								<div className="rounded-lg border bg-card p-4 text-card-foreground opacity-50 shadow-sm">
									<div className="flex items-center gap-2">
										<Activity className="h-5 w-5 text-green-500" />
										<span className="font-semibold">Inventario</span>
									</div>
									<p className="mt-1 text-muted-foreground text-sm">
										Estado de vehículos (Próximamente)
									</p>
								</div>
								<div className="rounded-lg border bg-card p-4 text-card-foreground opacity-50 shadow-sm">
									<div className="flex items-center gap-2">
										<TrendingDown className="h-5 w-5 text-red-500" />
										<span className="font-semibold">Subastas</span>
									</div>
									<p className="mt-1 text-muted-foreground text-sm">
										Análisis de pérdidas (Próximamente)
									</p>
								</div>
							</div>

							{/* KPIs principales */}
							<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
								<ReportCard
									title="Capital Activo"
									value={formatCurrency(
										dashboardData.data?.carteraActiva.montoTotal || 0,
									)}
									description={`${
										dashboardData.data?.carteraActiva.totalContratos || 0
									} contratos activos`}
									icon={Wallet}
								/>
								<ReportCard
									title="Total en Mora"
									value={formatCurrency(totalEnMora)}
									description="Cuotas pendientes de pago"
									icon={AlertTriangle}
									className="border-orange-200 dark:border-orange-900"
								/>
								<ReportCard
									title="Total Recuperado"
									value={formatCurrency(totalPagado)}
									description="Monto recuperado en cobros"
									icon={TrendingUp}
									className="border-green-200 dark:border-green-900"
								/>
								<ReportCard
									title="Casos Activos"
									value={
										dashboardData.data?.casosActivos.reduce(
											(acc, c) => acc + c.totalCasos,
											0,
										) || 0
									}
									description="Casos en gestión de cobros"
									icon={FileText}
								/>
							</div>
						</TabsContent>
						<TabsContent value="graficas" className="space-y-6">
							{/* Gráficas */}
							<div className="grid gap-6 md:grid-cols-2">
								<Card>
									<CardHeader>
										<CardTitle>Distribución de Cuotas por Estado</CardTitle>
										<CardDescription>
											Análisis del estado de pago de las cuotas
										</CardDescription>
									</CardHeader>
									<CardContent>
										<ResponsiveContainer width="100%" height={300}>
											<PieChart>
												<Pie
													data={pieData}
													dataKey="value"
													nameKey="name"
													cx="50%"
													cy="50%"
													outerRadius={100}
													label
												>
													{pieData.map((entry, index) => (
														<Cell
															key={entry.name}
															fill={
																COLORS[
																	moraData[index]
																		?.estadoMora as keyof typeof COLORS
																]
															}
														/>
													))}
												</Pie>
												<Tooltip
													formatter={(value) => formatCurrency(Number(value))}
												/>
											</PieChart>
										</ResponsiveContainer>
									</CardContent>
								</Card>

								<Card>
									<CardHeader>
										<CardTitle>Pipeline de Ventas</CardTitle>
										<CardDescription>
											Oportunidades por etapa del proceso
										</CardDescription>
									</CardHeader>
									<CardContent>
										<ResponsiveContainer width="100%" height={300}>
											<BarChart data={pipelineData}>
												<CartesianGrid strokeDasharray="3 3" />
												<XAxis
													dataKey="etapa"
													angle={-45}
													textAnchor="end"
													height={100}
												/>
												<YAxis />
												<Tooltip />
												<Legend />
												<Bar
													dataKey="oportunidades"
													fill="#3b82f6"
													name="Oportunidades"
												/>
											</BarChart>
										</ResponsiveContainer>
									</CardContent>
								</Card>

								<Card className="md:col-span-2">
									<CardHeader>
										<CardTitle>Tendencia de Nuevos Contratos</CardTitle>
										<CardDescription>
											Últimos 6 meses de actividad
										</CardDescription>
									</CardHeader>
									<CardContent>
										<ResponsiveContainer width="100%" height={300}>
											<LineChart data={contratosData}>
												<CartesianGrid strokeDasharray="3 3" />
												<XAxis dataKey="mes" />
												<YAxis yAxisId="left" />
												<YAxis yAxisId="right" orientation="right" />
												<Tooltip
													formatter={(value, name) =>
														name === "monto"
															? formatCurrency(Number(value))
															: value
													}
												/>
												<Legend />
												<Line
													yAxisId="left"
													type="monotone"
													dataKey="contratos"
													stroke="#3b82f6"
													name="Contratos"
												/>
												<Line
													yAxisId="right"
													type="monotone"
													dataKey="monto"
													stroke="#10b981"
													name="Capital Activo"
												/>
											</LineChart>
										</ResponsiveContainer>
									</CardContent>
								</Card>
							</div>

							{/* Estadísticas de Leads */}
							<Card>
								<CardHeader>
									<CardTitle>Conversión de Leads</CardTitle>
									<CardDescription>
										Estado de los leads en el sistema
									</CardDescription>
								</CardHeader>
								<CardContent>
									<div className="grid gap-4 md:grid-cols-5">
										{dashboardData.data?.leadsStats.map((stat) => (
											<div key={stat.status} className="rounded-lg border p-4">
												<div className="text-muted-foreground text-sm">
													{stat.status === "new"
														? "Nuevos"
														: stat.status === "contacted"
															? "Contactados"
															: stat.status === "qualified"
																? "Calificados"
																: stat.status === "unqualified"
																	? "No calificados"
																	: "Convertidos"}
												</div>
												<div className="mt-1 font-bold text-2xl">
													{stat.total}
												</div>
											</div>
										))}
									</div>
								</CardContent>
							</Card>
						</TabsContent>
							</>
						)}
						{canAccessCobranzaReport && (
						<TabsContent value="cobranza" className="space-y-6">
							{/* Reporte: Monto a Cobrarse por Período */}
							<Card>
								<CardHeader>
									<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
										<div className="flex items-center gap-2">
											<CalendarDays className="h-5 w-5 text-blue-500" />
											<div>
												<CardTitle>Monto a Cobrarse por Período</CardTitle>
													<CardDescription>
														Cuotas pendientes desglosadas por rubro (capital,
														interés, seguro, etc.). Según participación actual.
												</CardDescription>
											</div>
										</div>
									<div className="flex flex-wrap gap-2">
										{isAdmin && (
											<Button variant="outline" onClick={exportAdminReportsExcel}>
												<Download className="mr-2 h-4 w-4" />
												Exportar Excel
											</Button>
										)}
										<SimularButton onClick={() => setScenarioOpen("monto")} />
									</div>
								</div>

									<div className="mt-4 flex flex-wrap items-end gap-x-5 gap-y-3 rounded-lg border bg-muted/30 px-4 py-3">
										<FilterField label="Período">
											<Select
												value={montoCobrarPeriodo}
												onValueChange={(v) => {
													const p = v as
														| "anio"
														| "trimestre"
														| "mes"
														| "semana"
														| "dia";
													setMontoCobrarPeriodo(p);
													setMontoCobrarRange(getDefaultRangeForPeriodo(p));
												}}
											>
												<SelectTrigger className="w-[140px]">
													<SelectValue placeholder="Período" />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="dia">Día</SelectItem>
													<SelectItem value="semana">Semana</SelectItem>
													<SelectItem value="mes">Mes</SelectItem>
													<SelectItem value="trimestre">Trimestre</SelectItem>
													<SelectItem value="anio">Año</SelectItem>
												</SelectContent>
											</Select>
										</FilterField>

										<FilterField label="Rango">
											<PeriodDatePicker
												periodo={montoCobrarPeriodo}
												fechaInicio={montoCobrarRange.fechaInicio}
												fechaFin={montoCobrarRange.fechaFin}
												onChange={(fechaInicio, fechaFin) =>
													setMontoCobrarRange({ fechaInicio, fechaFin })
												}
											/>
										</FilterField>

										<FilterField label="Vista" className="sm:ml-auto">
											<Select
												value={montoCobrarAcumulado ? "acumulado" : "periodo"}
												onValueChange={(v) =>
													setMontoCobrarAcumulado(v === "acumulado")
												}
											>
												<SelectTrigger className="w-[150px]">
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="periodo">Por período</SelectItem>
													<SelectItem value="acumulado">Acumulado</SelectItem>
												</SelectContent>
											</Select>
										</FilterField>
									</div>
								</CardHeader>
								<CardContent className="space-y-6">
									{montoCobrarQuery.isPending && <p>Cargando...</p>}
									{montoCobrarQuery.isError && (
										<p className="text-destructive">
											Error al cargar el reporte de monto a cobrarse.
										</p>
									)}
									{montoCobrarData && montoCobrarData.data.length === 0 && (
										<p className="text-muted-foreground">
											No hay cuotas pendientes para el rango seleccionado.
										</p>
									)}
									{!!montoCobrarData?.data.length && (
										<>
											{(() => {
											const totals = getMontoACobrarParticipacionTotals(
												montoCobrarRows,
													false,
												);
												return totals.creditosInvalidos > 0 ? (
													<p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 text-sm dark:bg-amber-950/30 dark:text-amber-200">
													Participación actual inválida en{" "}
													{totals.creditosInvalidos} crédito(s) y{" "}
													{totals.cuotasInvalidas} cuota(s); sus montos no se
													incluyen en el desglose Inv./CUBE.
													</p>
												) : null;
											})()}
											{/* Gráfica de barras apiladas */}
											<ResponsiveContainer width="100%" height={350}>
												<BarChart
											data={montoCobrarRows.map((row) => {
														const view = getMontoACobrarViewRow(
															row,
															montoCobrarAcumulado,
														);
														return {
															bucket: formatBucket(
																row.bucket,
																montoCobrarPeriodo,
															),
															capital: view.capital,
															interesIva: view.interesIva,
															servicios: view.servicios,
															membresias: view.membresias,
														};
													})}
												>
													<CartesianGrid strokeDasharray="3 3" />
													<XAxis
														dataKey="bucket"
														tick={{ fontSize: 11 }}
														interval={0}
														height={36}
													/>
													<YAxis
														tickFormatter={(v) =>
															`Q${(Number(v) / 1000).toFixed(0)}k`
														}
													/>
													<Tooltip
														formatter={(value, name) => [
															formatCurrency(Number(value)),
															MONTO_COBRAR_LABELS[
																name as keyof typeof MONTO_COBRAR_LABELS
															] ?? name,
														]}
													/>
													<Legend
														formatter={(value) =>
															MONTO_COBRAR_LABELS[
																value as keyof typeof MONTO_COBRAR_LABELS
															] ?? value
														}
													/>
													{(
														Object.keys(
															MONTO_COBRAR_COLORS,
														) as (keyof typeof MONTO_COBRAR_COLORS)[]
													).map((key) => (
														<Bar
															key={key}
															dataKey={key}
															stackId="a"
															fill={MONTO_COBRAR_COLORS[key]}
														/>
													))}
												</BarChart>
											</ResponsiveContainer>

											{/* Tabla detallada */}
										<div className="overflow-x-auto rounded-md border">
											<Table className="min-w-[1320px] border-collapse tabular-nums [&_td]:border [&_td]:text-center [&_th]:border [&_th]:text-center">
												<TableHeader className="sticky top-0 z-10 bg-background">
														<TableRow>
														<TableHead className="sticky left-0 z-20 bg-background">
															Período
															</TableHead>
														<TableHead>Cantidad de Cuotas</TableHead>
														<TableHead>Capital</TableHead>
														<TableHead>Interés + IVA</TableHead>
														<TableHead>Servicios (Seguro + GPS)</TableHead>
														<TableHead>Membresías</TableHead>
														<TableHead>Total Mora</TableHead>
														<TableHead className="font-bold">Total</TableHead>
														<TableHead className="bg-muted/30">
															Capital CUBE
															</TableHead>
														<TableHead className="bg-muted/30">
															Interés + IVA CUBE
													</TableHead>
														<TableHead className="bg-muted/30 font-bold">
															Facturación
													</TableHead>
														</TableRow>
													</TableHeader>
													<TableBody>
												{montoCobrarRows.map((row) => {
														const view = getMontoACobrarViewRow(
															row,
															montoCobrarAcumulado,
														);
															return (
																<TableRow key={row.bucket}>
																<TableCell className="sticky left-0 z-[1] bg-background">
																	{formatBucket(row.bucket, montoCobrarPeriodo)}
																	</TableCell>
																<TableCell>{row.cuotas_count}</TableCell>
																<TableCell>
																{formatCurrency(view.capital)}
															</TableCell>
																<TableCell>
																{formatCurrency(view.interesIva)}
															</TableCell>
																<TableCell>
																{formatCurrency(view.servicios)}
															</TableCell>
																<TableCell>
																{formatCurrency(view.membresias)}
															</TableCell>
																<TableCell>
																<div>{formatCurrency(view.totalMora)}</div>
																		<div
																			className="text-muted-foreground text-xs"
																			title="% de créditos del período con mora activa"
																		>
																			{row.total_credits > 0
																				? (
																						(row.credits_con_mora /
																							row.total_credits) *
																						100
																					).toFixed(1)
																				: "0.0"}
																			%
																		</div>
																	</TableCell>
																<TableCell className="font-bold">
																{formatCurrency(view.total)}
															</TableCell>
																<TableCell className="bg-muted/10">
																{formatCurrency(view.capitalCube)}
															</TableCell>
																<TableCell className="bg-muted/10">
																{formatCurrency(view.interesIvaCube)}
															</TableCell>
																<TableCell className="bg-muted/10 font-bold">
																	{formatCurrency(view.facturacion)}
																</TableCell>
																</TableRow>
															);
														})}
														{(() => {
													const rows = montoCobrarRows;
													const a = montoCobrarAcumulado;
													const lastRow = rows.findLast(
														(row) => row.cuotas_count > 0,
													);
															const sum = (key: keyof MontoACobrarPeriodoRow) =>
																rows.reduce(
																	(acc: number, r: MontoACobrarPeriodoRow) =>
																		acc +
																	Number.parseFloat((r[key] as string) || "0"),
																	0,
																);
														const val = (key: keyof MontoACobrarPeriodoRow) =>
																a && lastRow
																	? Number.parseFloat(
																			(lastRow[key] as string) || "0",
																		)
																	: sum(key);
														const capitalTotal = val(
															a ? "acum_total_cuota" : "total_cuota",
														);
														const interesIvaTotal =
															val(a ? "acum_total_interes" : "total_interes") +
															val(a ? "acum_total_iva" : "total_iva");
														const serviciosTotal =
															val(a ? "acum_total_seguro" : "total_seguro") +
															val(a ? "acum_total_gps" : "total_gps");
														const membresiasTotal = val(
															a ? "acum_total_membresias" : "total_membresias",
														);
														const grandTotal =
															capitalTotal +
															interesIvaTotal +
															serviciosTotal +
															membresiasTotal;
																	const totalCred =
																		a && lastRow
																			? lastRow.cuotas_count
																			: rows.reduce(
																					(acc, r) => acc + r.cuotas_count,
																					0,
																				);
														const splitTotals =
															getMontoACobrarParticipacionTotals(
																		rows.map((row) => ({
																			cuotas_count: row.cuotas_count,
																	capital_inv_participacion_actual: a
																		? row.acum_capital_inv_participacion_actual
																		: row.capital_inv_participacion_actual,
																	capital_cube_participacion_actual: a
																		? row.acum_capital_cube_participacion_actual
																		: row.capital_cube_participacion_actual,
																	interes_iva_inv_participacion_actual: a
																		? row.acum_interes_iva_inv_participacion_actual
																		: row.interes_iva_inv_participacion_actual,
																	interes_iva_cube_participacion_actual: a
																		? row.acum_interes_iva_cube_participacion_actual
																		: row.interes_iva_cube_participacion_actual,
																	creditos_participacion_invalida:
																		row.creditos_participacion_invalida,
																	creditos_participacion_invalida_rango:
																		row.creditos_participacion_invalida_rango,
																	cuotas_participacion_invalida:
																		row.cuotas_participacion_invalida,
																		})),
																		a,
																	);
														const facturacionTotal =
															splitTotals.interesIvaCube +
															membresiasTotal +
															serviciosTotal;
															return (
																<TableRow className="border-t-2 bg-muted/50 font-bold">
																<TableCell className="sticky left-0 z-[1] bg-muted">
																	Total
																	</TableCell>
																<TableCell>{totalCred}</TableCell>
																<TableCell>
																{formatCurrency(capitalTotal)}
															</TableCell>
																<TableCell>
																{formatCurrency(interesIvaTotal)}
															</TableCell>
																<TableCell>
																{formatCurrency(serviciosTotal)}
															</TableCell>
																<TableCell>
																{formatCurrency(membresiasTotal)}
															</TableCell>
																<TableCell>
																{formatCurrency(val("total_mora"))}
															</TableCell>
																<TableCell>
																{formatCurrency(grandTotal)}
															</TableCell>
																<TableCell className="bg-muted/10">
																	{formatCurrency(splitTotals.capitalCube)}
																</TableCell>
																<TableCell className="bg-muted/10">
																	{formatCurrency(splitTotals.interesIvaCube)}
																</TableCell>
																<TableCell className="bg-muted/10">
																	{formatCurrency(facturacionTotal)}
																				</TableCell>
																</TableRow>
															);
														})()}
													</TableBody>
												</Table>
											</div>
										</>
									)}
								</CardContent>
							</Card>

							{/* Reporte: Facturado del Mes vs Esperado */}
							<Card>
								<CardHeader>
									<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
										<div>
											<CardTitle className="flex items-center gap-2">
												<CalendarDays className="h-5 w-5" />
												Cobrado del Mes vs Esperado
											</CardTitle>
											<CardDescription>
												Compara lo cobrado en el mes contra lo esperado según
												fecha de vencimiento
											</CardDescription>
										</div>
										<div className="flex items-center gap-2">
											<SimularButton
												onClick={() => setScenarioOpen("facturacion")}
											/>
											<Select
												value={String(facturacionMes.mes)}
												onValueChange={(v) =>
													setFacturacionMes((prev) => ({
														...prev,
														mes: Number(v),
													}))
												}
											>
												<SelectTrigger className="w-36">
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													{[
														"Enero",
														"Febrero",
														"Marzo",
														"Abril",
														"Mayo",
														"Junio",
														"Julio",
														"Agosto",
														"Septiembre",
														"Octubre",
														"Noviembre",
														"Diciembre",
													].map((label, i) => (
														<SelectItem key={i + 1} value={String(i + 1)}>
															{label}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
											<Input
												type="number"
												className="w-24"
												value={facturacionMes.anio}
												min={2020}
												max={2100}
												onChange={(e) =>
													setFacturacionMes((prev) => ({
														...prev,
														anio: Number(e.target.value),
													}))
												}
											/>
										</div>
									</div>
								</CardHeader>
								<CardContent>
									{facturacionMesQuery.isPending && (
										<div className="py-4 text-center text-muted-foreground text-sm">
											Cargando...
										</div>
									)}
									{facturacionMesQuery.isError && (
										<div className="py-4 text-center text-destructive text-sm">
											Error al cargar datos.
										</div>
									)}
									{facturacionMesData &&
										(() => {
											const { cobrado, esperado } = facturacionMesData;
											const totalCobrado = FACTURACION_RUBROS.reduce(
												(acc, r) => acc + Number(cobrado[r.key] || 0),
												0,
											);
											const totalEsperado = Number(esperado.meta_mensual || 0);
											const pct =
												totalEsperado > 0
													? Math.min((totalCobrado / totalEsperado) * 100, 100)
													: 0;
											return (
												<div className="space-y-6">
													{/* Resumen total vs meta */}
													<div className="space-y-3">
														<div className="grid grid-cols-3 gap-4">
															<div>
																<p className="text-muted-foreground text-sm">
																	Total Cobrado
																</p>
																<p className="font-bold text-2xl">
																	{formatCurrency(totalCobrado)}
																</p>
															</div>
															<div>
																<p className="text-muted-foreground text-sm">
																	Meta del Mes
																</p>
																<p className="font-bold text-2xl">
																	{totalEsperado > 0 ? (
																		formatCurrency(totalEsperado)
																	) : (
																		<span className="text-base text-muted-foreground">
																			Por definir
																		</span>
																	)}
																</p>
															</div>
															<div>
																<p className="text-muted-foreground text-sm">
																	Avance
																</p>
																<p className="font-bold text-2xl">
																	{totalEsperado > 0 ? (
																		`${pct.toFixed(1)}%`
																	) : (
																		<span className="text-base text-muted-foreground">
																			—
																		</span>
																	)}
																</p>
															</div>
														</div>
														{totalEsperado > 0 && (
															<ProgressBar
																value={totalCobrado}
																max={totalEsperado}
															/>
														)}
													</div>

													{/* Desglose por rubro */}
													<div>
														<p className="mb-2 font-medium text-muted-foreground text-sm">
															Desglose por rubro
														</p>
														<Table>
															<TableBody>
																{FACTURACION_RUBROS.map(({ key, label }) => (
																	<TableRow key={key}>
																		<TableCell className="text-muted-foreground">
																			{label}
																		</TableCell>
																		<TableCell className="text-right font-medium">
																		{formatCurrency(Number(cobrado[key] || 0))}
																		</TableCell>
																	</TableRow>
																))}
															</TableBody>
														</Table>
													</div>
												</div>
											);
										})()}
								</CardContent>
							</Card>
						</TabsContent>
						)}
						{isAdmin && (
							<>
						<TabsContent value="inversiones" className="space-y-6">
							<Card>
								<CardHeader>
									<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
										<div>
											<CardTitle>Inversión y reinversión</CardTitle>
											<CardDescription>
												Capital liquidado, distribución y posición activa.
											</CardDescription>
										</div>
										<div className="flex items-center gap-2">
											<Select
												value={String(flujoMesNum)}
												onValueChange={(value) =>
													setFlujoMesAnio(flujoAnioNum, Number(value))
												}
											>
												<SelectTrigger className="w-36" aria-label="Mes">
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													{mesesDisponibles.map((month) => (
														<SelectItem
															key={month.num}
															value={String(month.num)}
														>
															{month.nombre}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
											<Select
												value={String(flujoAnioNum)}
												onValueChange={(value) =>
													setFlujoMesAnio(Number(value), flujoMesNum)
												}
											>
												<SelectTrigger className="w-24" aria-label="Año">
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													{aniosDisponibles.map((year) => (
														<SelectItem key={year} value={String(year)}>
															{year}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</div>
									</div>
								</CardHeader>
								<CardContent className="pt-6">
									<ReinvestmentReport
										data={reinversionData}
										isPending={reinversionLiquidacionesQuery.isPending}
										isError={reinversionLiquidacionesQuery.isError}
										periodLabel={`${MESES[flujoMesNum - 1]} de ${flujoAnioNum}`}
										onRetry={() => reinversionLiquidacionesQuery.refetch()}
										onExportInvestors={exportAdminReportsExcel}
									/>
								</CardContent>
							</Card>
						</TabsContent>
						{/* Modal: Metas Mensuales */}
						<Dialog open={metasModalOpen} onOpenChange={setMetasModalOpen}>
							<DialogContent className="sm:max-w-[860px]">
								<DialogHeader>
									<DialogTitle className="flex items-center gap-2">
										<Target className="h-4 w-4 text-purple-500" />
										Metas de Colocación
									</DialogTitle>
								</DialogHeader>
								<div className="flex items-center justify-center gap-3 pb-2">
									<Button
										variant="outline"
										size="sm"
										onClick={() => setMetasAnio((y) => y - 1)}
									>
										‹
									</Button>
									<span className="w-16 text-center font-semibold">
										{metasAnio}
									</span>
									<Button
										variant="outline"
										size="sm"
										onClick={() => setMetasAnio((y) => y + 1)}
									>
										›
									</Button>
								</div>
								{metasQuery.isPending ? (
									<p className="py-4 text-center text-muted-foreground text-sm">
										Cargando...
									</p>
								) : (
									<div className="grid grid-cols-2 gap-x-10 gap-y-4">
										{MESES.map((nombreMes, idx) => {
											const mes = idx + 1;
											return (
												<div key={mes} className="flex items-center gap-3">
													<span className="w-20 shrink-0 font-medium text-sm">
														{nombreMes}
													</span>
													<div className="relative min-w-0 flex-1">
														<span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 font-medium text-muted-foreground text-sm">
															Q
														</span>
														<Input
															type="text"
															inputMode="decimal"
															className="h-10 pl-7 text-right text-base"
															placeholder="0"
															value={
																focusedMes === mes
																	? (editMetas[mes] ?? "")
																	: editMetas[mes] && Number(editMetas[mes]) > 0
																		? Number(editMetas[mes]).toLocaleString(
																				"es-GT",
																				{
																					minimumFractionDigits: 2,
																					maximumFractionDigits: 2,
																				},
																			)
																		: ""
															}
															onFocus={() => setFocusedMes(mes)}
															onBlur={() => setFocusedMes(null)}
															onChange={(e) => {
																const raw = e.target.value.replace(
																	/[^0-9.]/g,
																	"",
																);
																setEditMetas((prev) => ({
																	...prev,
																	[mes]: raw,
																}));
															}}
														/>
													</div>
												</div>
											);
										})}
									</div>
								)}
								<div className="flex justify-end gap-2 pt-2">
									<Button
										variant="outline"
										onClick={() => setMetasModalOpen(false)}
									>
										Cancelar
									</Button>
									<Button onClick={handleGuardarTodo} disabled={isSavingMetas}>
										{isSavingMetas && (
											<Loader2 className="mr-2 h-4 w-4 animate-spin" />
										)}
										Guardar todo
									</Button>
								</div>
							</DialogContent>
						</Dialog>

						{/* Modales de simulación de escenarios */}
						<ScenarioModal
							open={scenarioOpen === "cobertura"}
							onOpenChange={(o) => setScenarioOpen(o ? "cobertura" : null)}
							config={coberturaConfig}
							baseData={puntoEquilibrioData?.data}
						/>
						<ScenarioModal
							open={scenarioOpen === "comparativo"}
							onOpenChange={(o) => setScenarioOpen(o ? "comparativo" : null)}
							config={comparativoConfig}
							baseData={comparativoData?.data}
						/>

						<TabsContent value="colocacion" className="space-y-6">
							{/* Cobertura de Colocación vs Meta */}
							<Card>
								<CardHeader>
									<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
										<div className="flex items-center gap-2">
											<TrendingUp className="h-5 w-5 text-green-500" />
											<div>
												<CardTitle>Cobertura de Colocación vs Meta</CardTitle>
												<CardDescription>
													Compara el capital colocado en cada período contra la
													meta mensual definida
												</CardDescription>
											</div>
										</div>
										<div className="flex items-center gap-2">
											<SimularButton
												onClick={() => setScenarioOpen("cobertura")}
											/>
											<Button
												variant="outline"
												size="sm"
												className="gap-1.5"
												onClick={() => setMetasModalOpen(true)}
											>
												<Target className="h-3.5 w-3.5" />
												Configurar metas
											</Button>
										</div>
									</div>

									<div className="mt-4 flex flex-wrap items-end gap-x-5 gap-y-3 rounded-lg border bg-muted/30 px-4 py-3">
										<FilterField label="Período">
											<Select
												value={equilibrioPeriodo}
												onValueChange={(v) => {
													const p = v as
														| "anio"
														| "trimestre"
														| "mes"
														| "semana"
														| "dia";
													setEquilibrioPeriodo(p);
													setEquilibrioRange(getDefaultRangeForPeriodo(p));
												}}
											>
												<SelectTrigger className="w-[140px]">
													<SelectValue placeholder="Período" />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="dia">Día</SelectItem>
													<SelectItem value="semana">Semana</SelectItem>
													<SelectItem value="mes">Mes</SelectItem>
													<SelectItem value="trimestre">Trimestre</SelectItem>
													<SelectItem value="anio">Año</SelectItem>
												</SelectContent>
											</Select>
										</FilterField>

										<FilterField label="Rango">
											<PeriodDatePicker
												periodo={equilibrioPeriodo}
												fechaInicio={equilibrioRange.fechaInicio}
												fechaFin={equilibrioRange.fechaFin}
												onChange={(fechaInicio, fechaFin) =>
													setEquilibrioRange({ fechaInicio, fechaFin })
												}
											/>
										</FilterField>
									</div>
								</CardHeader>
								<CardContent className="space-y-4">
									{puntoEquilibrioQuery.isPending && (
										<p className="text-muted-foreground text-sm">Cargando...</p>
									)}
									{puntoEquilibrioQuery.isError && (
										<p className="text-destructive text-sm">
											Error al cargar reporte de cobertura.
										</p>
									)}
									{puntoEquilibrioData &&
										puntoEquilibrioData.data.length === 0 && (
											<p className="text-muted-foreground text-sm">
												No hay datos de colocación para el rango seleccionado.
											</p>
										)}
									{!!puntoEquilibrioData?.data.length &&
										(() => {
											const rows = puntoEquilibrioData.data;
											const totalColocado = rows.reduce(
												(acc, r) => acc + Number(r.colocado),
												0,
											);
											const totalMeta = rows.reduce(
												(acc, r) => acc + Number(r.meta),
												0,
											);
											const totalCreditos = rows.reduce(
												(acc, r) => acc + r.cantidad_creditos,
												0,
											);
											const totalCobertura =
												totalMeta > 0
													? ((totalColocado / totalMeta) * 100).toFixed(1)
													: null;
											return (
												<>
													<ResponsiveContainer width="100%" height={300}>
														<BarChart
															data={rows.map((row) => ({
																bucket: formatBucket(
																	row.bucket,
																	equilibrioPeriodo,
																),
																colocado: Number(row.colocado),
																meta: Number(row.meta),
															}))}
														>
															<CartesianGrid strokeDasharray="3 3" />
															<XAxis
																dataKey="bucket"
																tick={{ fontSize: 11 }}
																interval={0}
																height={36}
															/>
															<YAxis
																tickFormatter={(v) =>
																	`Q${(Number(v) / 1000).toFixed(0)}k`
																}
															/>
															<Tooltip
																formatter={(value, name) => [
																	formatCurrency(Number(value)),
																	name === "colocado" ? "Colocado" : "Meta",
																]}
															/>
															<Legend
																formatter={(v) =>
																	v === "colocado" ? "Colocado" : "Meta"
																}
															/>
															<Bar
																dataKey="colocado"
																fill="#3b82f6"
																name="colocado"
															/>
															<Bar dataKey="meta" fill="#d1d5db" name="meta" />
														</BarChart>
													</ResponsiveContainer>

													<div className="overflow-x-auto">
														<Table>
															<TableHeader>
																<TableRow>
																	<TableHead>Período</TableHead>
																	<TableHead className="text-right">
																		Créditos
																	</TableHead>
																	<TableHead className="text-right">
																		Colocado
																	</TableHead>
																	<TableHead className="text-right">
																		Meta
																	</TableHead>
																	<TableHead className="text-right">
																		Cobertura
																	</TableHead>
																	<TableHead className="text-right">
																		Faltante
																	</TableHead>
																</TableRow>
															</TableHeader>
															<TableBody>
																{rows.map((row) => (
																	<TableRow key={row.bucket}>
																		<TableCell>
																			{formatBucket(
																				row.bucket,
																				equilibrioPeriodo,
																			)}
																		</TableCell>
																		<TableCell className="text-right">
																			{row.cantidad_creditos}
																		</TableCell>
																		<TableCell className="text-right">
																			{formatCurrency(row.colocado)}
																		</TableCell>
																		<TableCell className="text-right">
																			{Number(row.meta) > 0 ? (
																				formatCurrency(row.meta)
																			) : (
																				<span className="text-muted-foreground">
																					Sin meta
																				</span>
																			)}
																		</TableCell>
																		<TableCell className="text-right">
																			<span
																				className="font-semibold"
																				style={{
																					color: coberturaColor(row.cobertura),
																				}}
																			>
																				{coberturaLabel(row.cobertura)}
																			</span>
																		</TableCell>
																		<TableCell className="text-right">
																			{row.faltante
																				? formatCurrency(row.faltante)
																				: "—"}
																		</TableCell>
																	</TableRow>
																))}
																<TableRow className="border-t-2 bg-muted/50 font-bold">
																	<TableCell>Total</TableCell>
																	<TableCell className="text-right">
																		{totalCreditos}
																	</TableCell>
																	<TableCell className="text-right">
																		{formatCurrency(totalColocado)}
																	</TableCell>
																	<TableCell className="text-right">
																		{totalMeta > 0
																			? formatCurrency(totalMeta)
																			: "—"}
																	</TableCell>
																	<TableCell className="text-right">
																		<span
																			className="font-semibold"
																			style={{
																				color: coberturaColor(totalCobertura),
																			}}
																		>
																			{coberturaLabel(totalCobertura)}
																		</span>
																	</TableCell>
																	<TableCell className="text-right">
																		{totalMeta > 0
																			? formatCurrency(
																					Math.max(
																						0,
																						totalMeta - totalColocado,
																					),
																				)
																			: "—"}
																	</TableCell>
																</TableRow>
															</TableBody>
														</Table>
													</div>
												</>
											);
										})()}
								</CardContent>
							</Card>

							{/* ============================================================ */}
							{/* REPORTE: COMPARATIVO HISTÓRICO MENSUAL                        */}
							{/* ============================================================ */}
							<Card>
								<CardHeader>
									<div className="flex items-center justify-between">
										<CardTitle className="flex items-center gap-2">
											<CalendarDays className="h-5 w-5" />
											Comparativo Histórico Mensual
										</CardTitle>
										<div className="flex items-center gap-2">
											<SimularButton
												onClick={() => setScenarioOpen("comparativo")}
											/>
											<button
												type="button"
												className="rounded p-1 hover:bg-muted"
												onClick={() => setComparativoAnio((y) => y - 1)}
											>
												<ChevronLeft className="h-4 w-4" />
											</button>
											<span className="w-12 text-center font-semibold text-sm">
												{comparativoAnio}
											</span>
											<button
												type="button"
												className="rounded p-1 hover:bg-muted"
												onClick={() =>
													setComparativoAnio((y) =>
														y < new Date().getFullYear() ? y + 1 : y,
													)
												}
											>
												<ChevronRight className="h-4 w-4" />
											</button>
										</div>
									</div>
								</CardHeader>
								<CardContent>
									{comparativoQuery.isPending && (
										<p className="py-4 text-center text-muted-foreground text-sm">
											Cargando...
										</p>
									)}
									{comparativoQuery.isError && (
										<p className="py-4 text-center text-red-500 text-sm">
											Error al cargar comparativo histórico.
										</p>
									)}
									{comparativoData &&
										(() => {
											const rows = comparativoData.data;
											const sumColoc = rows.reduce(
												(acc, r) =>
													acc +
													(r.colocacion_monto ? Number(r.colocacion_monto) : 0),
												0,
											);
											const sumFacturacion = rows.reduce(
												(acc, r) =>
													acc + (r.facturacion ? Number(r.facturacion) : 0),
												0,
											);
											const sumCreditosColoc = rows.reduce(
												(acc, r) => acc + (r.colocacion_creditos ?? 0),
												0,
											);
											return (
												<div className="overflow-x-auto">
													<Table>
														<TableHeader>
															<TableRow>
																<TableHead>Mes</TableHead>
																<TableHead className="text-right">
																	Colocación (Q)
																</TableHead>
																<TableHead className="text-right">
																	Colocados
																</TableHead>
																<TableHead className="text-right">
																	Facturación (Q)
																</TableHead>
																<TableHead className="text-right">
																	Cartera Activa (Q)
																</TableHead>
																<TableHead className="text-right">
																	Activos
																</TableHead>
																<TableHead className="text-right">
																	Mora 30 (Q)
																</TableHead>
																<TableHead className="text-right">
																	Mora 60 (Q)
																</TableHead>
																<TableHead className="text-right">
																	Mora 90 (Q)
																</TableHead>
																<TableHead className="text-right">
																	Mora 120+ (Q)
																</TableHead>
															</TableRow>
														</TableHeader>
														<TableBody>
															{rows.map((row) => {
																const esFuturo =
																	row.colocacion_monto === null &&
																	row.facturacion === null &&
																	row.cartera_activa === null;
																const totalMoraFila =
																	Number(row.mora_30 ?? 0) +
																	Number(row.mora_60 ?? 0) +
																	Number(row.mora_90 ?? 0) +
																	Number(row.mora_120 ?? 0);
																const pctMora = (val: string | null) =>
																	totalMoraFila > 0 && val
																		? (
																				(Number(val) / totalMoraFila) *
																				100
																			).toFixed(1)
																		: null;
																return (
																	<TableRow
																		key={row.mes}
																		className={
																			esFuturo ? "opacity-40" : undefined
																		}
																	>
																		<TableCell className="font-medium">
																			{MESES[row.mes - 1]}
																		</TableCell>
																		<TableCell className="text-right">
																			{row.colocacion_monto
																				? formatCurrency(
																						Number(row.colocacion_monto),
																					)
																				: "—"}
																		</TableCell>
																		<TableCell className="text-right">
																			{row.colocacion_creditos ?? "—"}
																		</TableCell>
																		<TableCell className="text-right">
																			{row.facturacion
																				? formatCurrency(
																						Number(row.facturacion),
																					)
																				: "—"}
																		</TableCell>
																		<TableCell className="text-right">
																			{row.cartera_activa
																				? formatCurrency(
																						Number(row.cartera_activa),
																					)
																				: "—"}
																		</TableCell>
																		<TableCell className="text-right">
																			{row.creditos_activos ?? "—"}
																		</TableCell>
																		<TableCell className="text-right">
																			{row.mora_30 ? (
																				<div>
																					<span>
																						{formatCurrency(
																							Number(row.mora_30),
																						)}
																						<span className="ml-1 text-muted-foreground text-xs">
																							({row.creditos_30 ?? 0})
																						</span>
																					</span>
																					{pctMora(row.mora_30) && (
																						<div className="text-muted-foreground text-xs">
																							{pctMora(row.mora_30)}%
																						</div>
																					)}
																				</div>
																			) : (
																				"—"
																			)}
																		</TableCell>
																		<TableCell className="text-right">
																			{row.mora_60 ? (
																				<div>
																					<span>
																						{formatCurrency(
																							Number(row.mora_60),
																						)}
																						<span className="ml-1 text-muted-foreground text-xs">
																							({row.creditos_60 ?? 0})
																						</span>
																					</span>
																					{pctMora(row.mora_60) && (
																						<div className="text-muted-foreground text-xs">
																							{pctMora(row.mora_60)}%
																						</div>
																					)}
																				</div>
																			) : (
																				"—"
																			)}
																		</TableCell>
																		<TableCell className="text-right">
																			{row.mora_90 ? (
																				<div>
																					<span>
																						{formatCurrency(
																							Number(row.mora_90),
																						)}
																						<span className="ml-1 text-muted-foreground text-xs">
																							({row.creditos_90 ?? 0})
																						</span>
																					</span>
																					{pctMora(row.mora_90) && (
																						<div className="text-muted-foreground text-xs">
																							{pctMora(row.mora_90)}%
																						</div>
																					)}
																				</div>
																			) : (
																				"—"
																			)}
																		</TableCell>
																		<TableCell className="text-right">
																			{row.mora_120 ? (
																				<div>
																					<span>
																						{formatCurrency(
																							Number(row.mora_120),
																						)}
																						<span className="ml-1 text-muted-foreground text-xs">
																							({row.creditos_120 ?? 0})
																						</span>
																					</span>
																					{pctMora(row.mora_120) && (
																						<div className="text-muted-foreground text-xs">
																							{pctMora(row.mora_120)}%
																						</div>
																					)}
																				</div>
																			) : (
																				"—"
																			)}
																		</TableCell>
																	</TableRow>
																);
															})}
															<TableRow className="border-t-2 bg-muted/50 font-bold">
																<TableCell>Total</TableCell>
																<TableCell className="text-right">
																	{formatCurrency(sumColoc)}
																</TableCell>
																<TableCell className="text-right">
																	{sumCreditosColoc}
																</TableCell>
																<TableCell className="text-right">
																	{formatCurrency(sumFacturacion)}
																</TableCell>
																<TableCell className="text-right">—</TableCell>
																<TableCell className="text-right">—</TableCell>
																<TableCell className="text-right">—</TableCell>
																<TableCell className="text-right">—</TableCell>
																<TableCell className="text-right">—</TableCell>
																<TableCell className="text-right">—</TableCell>
															</TableRow>
														</TableBody>
													</Table>
												</div>
											);
										})()}
								</CardContent>
							</Card>
						</TabsContent>

						{/* ── PROYECCIÓN LIQUIDACIONES ── */}
						<TabsContent value="proyeccion-liquidaciones" className="space-y-6">
							<div className="flex flex-wrap items-end gap-3">
								<div className="flex flex-col gap-1">
									<label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
										Inversionista
									</label>
									<Combobox
										width="288px"
										placeholder="Buscar inversionista..."
										value={proyeccionInvId ? String(proyeccionInvId) : null}
										options={(
											(investorsCarteraQuery.data ?? []) as InversionistaItem[]
										).map((inv) => ({
												value: String(inv.inversionista_id),
												label: inv.nombre,
										}))}
										onChange={(v) => {
											setProyeccionInvId(v ? Number(v) : null);
											setProyeccionEnabled(false);
										}}
										isLoading={investorsCarteraQuery.isPending}
									/>
								</div>
								<div className="flex flex-col gap-1">
									<label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
										Hasta mes
									</label>
									<Select
										value={proyeccionMes ? String(proyeccionMes) : "todos"}
										onValueChange={(v) => {
											setProyeccionMes(v === "todos" ? null : Number(v));
											setProyeccionEnabled(false);
										}}
									>
										<SelectTrigger className="w-36">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="todos">Todos los meses</SelectItem>
											{MESES.map((label, i) => (
												<SelectItem key={label} value={String(i + 1)}>
													{label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
								<div className="flex flex-col gap-1">
									<label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
										Año
									</label>
									<Select
										value={String(proyeccionAnio)}
										onValueChange={(v) => {
											setProyeccionAnio(Number(v));
											setProyeccionEnabled(false);
										}}
									>
										<SelectTrigger className="w-28">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{Array.from(
												{ length: 7 },
												(_, i) => new Date().getFullYear() - 1 + i,
											).map((y) => (
												<SelectItem key={y} value={String(y)}>
													{y}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
								<Button
									onClick={() => {
										if (proyeccionEnabled) {
											simulacionQuery.refetch();
										} else {
											setProyeccionEnabled(true);
										}
									}}
									disabled={!proyeccionInvId || simulacionQuery.isFetching}
								>
									{simulacionQuery.isFetching
										? "Generando..."
										: "Generar proyección"}
								</Button>
							</div>

							{simulacionQuery.isError && (
								<p className="text-sm text-destructive">
									Error al cargar la proyección. Intenta de nuevo.
								</p>
							)}

							{(
								simulacionQuery.data as
									| SimulacionInversionistaResult
									| undefined
							)?.data &&
								(() => {
									const sim = (
										simulacionQuery.data as SimulacionInversionistaResult
									).data;
								const fmtProyeccion = (v: number) =>
									new Intl.NumberFormat("es-GT", {
										style: "currency",
										currency: sim.moneda === "dolares" ? "USD" : "GTQ",
										minimumFractionDigits: 2,
										maximumFractionDigits: 2,
									}).format(v);
								const limitKey = proyeccionMes
									? `${proyeccionAnio}-${String(proyeccionMes).padStart(2, "0")}`
									: `${proyeccionAnio}-12`;
								const meses = sim.desglose_acumulado.meses.filter(
									(m) => m.mes <= limitKey,
								);

								if (meses.length === 0) {
									return (
										<p className="text-sm text-muted-foreground py-4 text-center">
											No hay meses proyectados para el período seleccionado.
										</p>
									);
								}

								const ultimoMes = meses.at(-1);
								const totales = meses.reduce(
									(acc, m) => ({
											sin_reinversion:
												acc.sin_reinversion + Number(m.total_sin_reinversion),
											con_reinversion:
												acc.con_reinversion + Number(m.total_con_reinversion),
											reinversion:
												acc.reinversion + Number(m.total_reinversion),
									}),
									{ sin_reinversion: 0, con_reinversion: 0, reinversion: 0 },
								);

								return (
									<div className="space-y-6">
										{/* Tarjetas resumen */}
										<div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
											<Card>
												<CardHeader className="pb-2">
													<CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
														Cuota Sin Reinversión
													</CardTitle>
												</CardHeader>
												<CardContent>
													<p className="text-xl font-bold font-mono">
														{fmtProyeccion(totales.sin_reinversion)}
													</p>
												</CardContent>
											</Card>
											<Card>
												<CardHeader className="pb-2">
													<CardTitle className="text-xs font-medium text-amber-600 uppercase tracking-wide">
														Reinversión
													</CardTitle>
												</CardHeader>
												<CardContent>
													<p className="text-xl font-bold font-mono text-amber-600">
														{fmtProyeccion(totales.reinversion)}
													</p>
												</CardContent>
											</Card>
											<Card>
												<CardHeader className="pb-2">
													<CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
														Cuota Con Reinversión
													</CardTitle>
												</CardHeader>
												<CardContent>
													<p className="text-xl font-bold font-mono">
														{fmtProyeccion(totales.con_reinversion)}
													</p>
												</CardContent>
											</Card>
											<Card>
												<CardHeader className="pb-2">
													<CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
														Capital Restante
													</CardTitle>
												</CardHeader>
												<CardContent>
													<p className="text-xl font-bold font-mono">
															{fmtProyeccion(
																ultimoMes?.total_capital_restante ?? 0,
															)}
													</p>
												</CardContent>
											</Card>
										</div>

										{/* Tabla por mes */}
										<Card>
											<CardHeader>
													<CardTitle className="text-sm">
														Desglose mensual
													</CardTitle>
											</CardHeader>
											<CardContent className="p-0">
												<table className="w-full text-sm">
													<thead>
														<tr className="border-b bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
															<th className="px-4 py-2 text-left">Mes</th>
																<th className="px-4 py-2 text-right">
																	Sin reinversión
																</th>
																<th className="px-4 py-2 text-right text-amber-600">
																	Reinversión
																</th>
																<th className="px-4 py-2 text-right">
																	Con reinversión
																</th>
																<th className="px-4 py-2 text-right">
																	Capital restante
																</th>
														</tr>
													</thead>
													<tbody>
														{meses.map((m) => {
															const fecha = new Date(`${m.mes}-01T00:00:00Z`);
																const label = fecha.toLocaleDateString(
																	"es-GT",
																	{
																month: "long",
																year: "numeric",
																timeZone: "UTC",
																	},
																);
															return (
																	<tr
																		key={m.mes}
																		className="border-b last:border-0 hover:bg-muted/30"
																	>
																		<td className="px-4 py-2 capitalize">
																			{label}
																		</td>
																	<td className="px-4 py-2 text-right font-mono">
																		{fmtProyeccion(m.total_sin_reinversion)}
																	</td>
																	<td className="px-4 py-2 text-right font-mono text-amber-600">
																		{fmtProyeccion(m.total_reinversion)}
																	</td>
																	<td className="px-4 py-2 text-right font-mono">
																		{fmtProyeccion(m.total_con_reinversion)}
																	</td>
																	<td className="px-4 py-2 text-right font-mono">
																		{fmtProyeccion(m.total_capital_restante)}
																	</td>
																</tr>
															);
														})}
													</tbody>
												</table>
											</CardContent>
										</Card>
									</div>
								);
							})()}
						</TabsContent>
							</>
						)}
					</Tabs>
		</div>
	);
}

import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	ArrowLeft,
	Banknote,
	CalendarDays,
	ChevronLeft,
	ChevronRight,
	CreditCard,
	Download,
	FileText,
	Filter,
	Landmark,
	Loader2,
	Mail,
	RefreshCw,
	Shield,
	Users,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute(
	"/inversiones/liquidaciones/$inversionistaId",
)({
	component: InvestorLiquidacionesPage,
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MESES = [
	{ value: 1, label: "Enero" },
	{ value: 2, label: "Febrero" },
	{ value: 3, label: "Marzo" },
	{ value: 4, label: "Abril" },
	{ value: 5, label: "Mayo" },
	{ value: 6, label: "Junio" },
	{ value: 7, label: "Julio" },
	{ value: 8, label: "Agosto" },
	{ value: 9, label: "Septiembre" },
	{ value: 10, label: "Octubre" },
	{ value: 11, label: "Noviembre" },
	{ value: 12, label: "Diciembre" },
] as const;

function formatQ(value: number | string | null | undefined): string {
	const num = Number(value ?? 0);
	return `Q${num.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getMesLabel(mes: number): string {
	return MESES.find((m) => m.value === mes)?.label ?? "";
}

// ─── Liquidacion Card ────────────────────────────────────────────────────────

function LiquidacionCard({ item }: { item: any }) {
	const boleta = item.boleta_liquidacion ?? null;
	const mesLiq = item.mes_liquidacion as number | undefined;
	const anioLiq = item.anio_liquidacion as number | undefined;

	return (
		<div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 pb-4 shadow-sm transition-shadow hover:shadow-md">
			{/* Header — mes como título */}
			<div className="flex items-center justify-between gap-3">
				{mesLiq && anioLiq ? (
					<div className="flex items-center gap-2">
						<CalendarDays className="h-4 w-4 text-primary" />
						<h3 className="font-bold text-foreground text-sm">
							{getMesLabel(mesLiq)} {anioLiq}
						</h3>
					</div>
				) : (
					<h3 className="font-bold text-foreground text-sm">Liquidación</h3>
				)}
				<div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
					{item.emite_factura && (
						<Badge
							variant="outline"
							className="border-blue-300 bg-blue-50 text-[10px] text-blue-700 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-300"
						>
							Factura
						</Badge>
					)}
					{item.reinversion !== "sin_reinversion" && (
						<Badge
							variant="outline"
							className="border-purple-300 bg-purple-50 text-[10px] text-purple-700 dark:border-purple-700 dark:bg-purple-950 dark:text-purple-300"
						>
							Reinversión
						</Badge>
					)}
				</div>
			</div>

			{/* Montos Grid */}
			<div className="grid grid-cols-3 gap-1.5">
				<div className="rounded-lg bg-blue-50 px-2.5 py-1.5 dark:bg-blue-950/50">
					<p className="font-medium text-[10px] text-blue-600 uppercase tracking-wide dark:text-blue-400">
						Capital
					</p>
					<p className="font-bold text-[13px] text-blue-900 dark:text-blue-100">
						{formatQ(item.total_abono_capital)}
					</p>
				</div>
				<div className="rounded-lg bg-indigo-50 px-2.5 py-1.5 dark:bg-indigo-950/50">
					<p className="font-medium text-[10px] text-indigo-600 uppercase tracking-wide dark:text-indigo-400">
						Interés
					</p>
					<p className="font-bold text-[13px] text-indigo-900 dark:text-indigo-100">
						{formatQ(item.total_abono_interes)}
					</p>
				</div>
				<div className="rounded-lg bg-purple-50 px-2.5 py-1.5 dark:bg-purple-950/50">
					<p className="font-medium text-[10px] text-purple-600 uppercase tracking-wide dark:text-purple-400">
						IVA
					</p>
					<p className="font-bold text-[13px] text-purple-900 dark:text-purple-100">
						{formatQ(item.total_abono_iva)}
					</p>
				</div>
				<div className="rounded-lg bg-orange-50 px-2.5 py-1.5 dark:bg-orange-950/50">
					<p className="font-medium text-[10px] text-orange-600 uppercase tracking-wide dark:text-orange-400">
						ISR
					</p>
					<p className="font-bold text-[13px] text-orange-900 dark:text-orange-100">
						{formatQ(item.total_isr)}
					</p>
				</div>
				<div className="rounded-lg bg-teal-50 px-2.5 py-1.5 dark:bg-teal-950/50">
					<p className="font-medium text-[10px] text-teal-600 uppercase tracking-wide dark:text-teal-400">
						Reinversión
					</p>
					<p className="font-bold text-[13px] text-teal-900 dark:text-teal-100">
						{formatQ(item.total_reinversion)}
					</p>
				</div>
				<div className="rounded-lg border border-border bg-muted px-2.5 py-1.5">
					<p className="font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
						Total c/Reinv.
					</p>
					<p className="font-extrabold text-[13px] text-foreground">
						{formatQ(item.total_a_recibir_con_reinversion)}
					</p>
				</div>
			</div>

			{/* Boleta + Reporte */}
			<div className="flex flex-wrap gap-2 border-t pt-2">
				{boleta?.boleta_url && (
					<a
						href={boleta.boleta_url}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 font-semibold text-primary-foreground text-xs shadow-sm transition-colors hover:bg-primary/90"
					>
						<Download className="h-3.5 w-3.5" />
						Boleta
					</a>
				)}
				{item.reporte_liquidacion_url && (
					<a
						href={item.reporte_liquidacion_url}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex items-center gap-1.5 rounded-lg border bg-background px-3.5 py-2 font-semibold text-foreground text-xs shadow-sm transition-colors hover:bg-muted"
					>
						<FileText className="h-3.5 w-3.5" />
						Reporte
					</a>
				)}
				{!boleta?.boleta_url && !item.reporte_liquidacion_url && (
					<span className="text-muted-foreground text-xs italic">
						Sin documentos adjuntos
					</span>
				)}
			</div>
		</div>
	);
}

// ─── Main Page ───────────────────────────────────────────────────────────────

function InvestorLiquidacionesPage() {
	const { inversionistaId } = Route.useParams();
	const investorIdNum = Number(inversionistaId);

	const now = new Date();
	const [filterByMonth, setFilterByMonth] = useState(false);
	const [mes, setMes] = useState(now.getMonth() + 1);
	const [anio, setAnio] = useState(now.getFullYear());
	const [page, setPage] = useState(1);
	const PER_PAGE = 25;

	// Fetch investor info from list
	const investorsQuery = useQuery({
		...orpc.getInversionistas.queryOptions({
			input: { page: 1, perPage: 100 },
		}),
	});
	const investor = useMemo(() => {
		const list = investorsQuery.data?.inversionistas ?? [];
		return (list as any[]).find(
			(inv: any) => inv.inversionistaId === investorIdNum,
		);
	}, [investorsQuery.data, investorIdNum]);

	// Fetch liquidaciones
	const { data, isLoading, isError, refetch } = useQuery({
		...orpc.getResumenGlobalInversionistas.queryOptions({
			input: {
				inversionistaId: investorIdNum,
				estado: "liquidated" as const,
				...(filterByMonth ? { mes, anio } : {}),
			},
		}),
	});

	const items = useMemo(() => {
		if (!data) return [];
		return Array.isArray(data) ? (data as any[]) : [];
	}, [data]);

	const totalPages = Math.max(1, Math.ceil(items.length / PER_PAGE));
	const paginated = useMemo(
		() => items.slice((page - 1) * PER_PAGE, page * PER_PAGE),
		[items, page],
	);

	const goToPrevMonth = useCallback(() => {
		setPage(1);
		if (mes === 1) {
			setMes(12);
			setAnio((a) => a - 1);
		} else {
			setMes((m) => m - 1);
		}
	}, [mes]);

	const goToNextMonth = useCallback(() => {
		setPage(1);
		if (mes === 12) {
			setMes(1);
			setAnio((a) => a + 1);
		} else {
			setMes((m) => m + 1);
		}
	}, [mes]);

	return (
		<div className="flex h-full flex-col">
			{/* Header */}
			<div className="shrink-0 border-b bg-background px-6 py-5">
				{/* Back + Name */}
				<div className="flex items-center gap-3">
					<Button variant="ghost" size="icon" className="shrink-0" asChild>
						<Link to="/inversiones/liquidaciones">
							<ArrowLeft className="h-5 w-5" />
						</Link>
					</Button>
					<div className="flex items-center gap-3">
						<div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
							<Users className="h-5 w-5" />
						</div>
						<div>
							<h1 className="font-bold text-lg leading-tight">
								{investor?.nombre ?? "Inversionista"}
							</h1>
							{investor?.dpi && (
								<p className="flex items-center gap-1 text-muted-foreground text-xs">
									<Shield className="h-3 w-3" />
									{investor.dpi}
								</p>
							)}
						</div>
					</div>
				</div>

				{/* Info cards */}
				{investor && (
					<div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
						{investor.email && (
							<div className="flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2">
								<Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
								<div className="min-w-0">
									<p className="text-[10px] text-muted-foreground uppercase tracking-wide">
										Correo
									</p>
									<p className="truncate font-medium text-xs">
										{investor.email}
									</p>
								</div>
							</div>
						)}
						{investor.banco && (
							<div className="flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2">
								<Landmark className="h-4 w-4 shrink-0 text-muted-foreground" />
								<div className="min-w-0">
									<p className="text-[10px] text-muted-foreground uppercase tracking-wide">
										Banco
									</p>
									<p className="truncate font-medium text-xs">
										{investor.banco} · {investor.tipoCuenta}
									</p>
								</div>
							</div>
						)}
						{investor.numeroCuenta && (
							<div className="flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2">
								<CreditCard className="h-4 w-4 shrink-0 text-muted-foreground" />
								<div className="min-w-0">
									<p className="text-[10px] text-muted-foreground uppercase tracking-wide">
										No. Cuenta
									</p>
									<p className="truncate font-medium font-mono text-xs">
										{investor.numeroCuenta}
									</p>
								</div>
							</div>
						)}
						<div className="flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2">
							<Banknote className="h-4 w-4 shrink-0 text-muted-foreground" />
							<div className="min-w-0">
								<p className="text-[10px] text-muted-foreground uppercase tracking-wide">
									Moneda
								</p>
								<p className="font-medium text-xs">
									{investor.moneda === "dolares"
										? "Dólares (USD)"
										: "Quetzales (GTQ)"}
								</p>
							</div>
						</div>
					</div>
				)}

				{/* Badges */}
				{investor && (
					<div className="mt-3 flex flex-wrap gap-1.5">
						{investor.emiteFactura && (
							<Badge
								variant="outline"
								className="border-blue-300 bg-blue-50 text-[10px] text-blue-700 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-300"
							>
								Factura
							</Badge>
						)}
						{investor.reinversion && (
							<Badge
								variant="outline"
								className="border-purple-300 bg-purple-50 text-[10px] text-purple-700 dark:border-purple-700 dark:bg-purple-950 dark:text-purple-300"
							>
								Reinversión
							</Badge>
						)}
					</div>
				)}

				{/* Filtros */}
				<div className="mt-4 flex flex-wrap items-center justify-between gap-4">
					<div className="flex items-center gap-2">
						<Button
							variant={filterByMonth ? "secondary" : "outline"}
							size="sm"
							className="h-9 gap-2"
							onClick={() => {
								setFilterByMonth((v) => !v);
								setPage(1);
							}}
						>
							<Filter className="h-4 w-4" />
							{filterByMonth ? "Quitar filtro" : "Filtrar por mes"}
						</Button>

						{filterByMonth && (
							<>
								<Button
									variant="outline"
									size="icon"
									className="h-9 w-9"
									onClick={goToPrevMonth}
								>
									<ChevronLeft className="h-4 w-4" />
								</Button>

								<Select
									value={String(mes)}
									onValueChange={(v) => {
										setMes(Number(v));
										setPage(1);
									}}
								>
									<SelectTrigger className="h-9 w-[150px]">
										<CalendarDays className="mr-2 h-4 w-4" />
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{MESES.map((m) => (
											<SelectItem key={m.value} value={String(m.value)}>
												{m.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>

								<Select
									value={String(anio)}
									onValueChange={(v) => {
										setAnio(Number(v));
										setPage(1);
									}}
								>
									<SelectTrigger className="h-9 w-[100px]">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{Array.from({ length: 6 }, (_, i) => {
											const y = new Date().getFullYear() - i;
											return (
												<SelectItem key={y} value={String(y)}>
													{y}
												</SelectItem>
											);
										})}
									</SelectContent>
								</Select>

								<Button
									variant="outline"
									size="icon"
									className="h-9 w-9"
									onClick={goToNextMonth}
								>
									<ChevronRight className="h-4 w-4" />
								</Button>
							</>
						)}
					</div>

					<Button
						variant="outline"
						size="icon"
						className="h-9 w-9"
						onClick={() => refetch()}
						disabled={isLoading}
						title="Refrescar"
					>
						{isLoading ? (
							<Loader2 className="h-4 w-4 animate-spin" />
						) : (
							<RefreshCw className="h-4 w-4" />
						)}
					</Button>
				</div>

				<div className="mt-3 flex items-center justify-between">
					<span className="text-muted-foreground text-sm">
						{items.length} resultado
						{items.length !== 1 ? "s" : ""}
						{filterByMonth && (
							<>
								{" — "}
								<span className="font-medium text-foreground">
									{getMesLabel(mes)} {anio}
								</span>
							</>
						)}
						{!filterByMonth && " — Todas las liquidaciones"}
					</span>
					{totalPages > 1 && (
						<span className="text-muted-foreground text-sm">
							Página {page} de {totalPages}
						</span>
					)}
				</div>
			</div>

			{/* Content */}
			<div className="flex-1 overflow-y-auto p-6">
				{isLoading && (
					<div className="flex items-center justify-center py-20">
						<Loader2 className="h-8 w-8 animate-spin text-primary" />
						<span className="ml-3 text-muted-foreground">
							Cargando liquidaciones...
						</span>
					</div>
				)}

				{isError && (
					<div className="py-20 text-center">
						<p className="font-medium text-destructive">
							Error al cargar las liquidaciones.
						</p>
						<Button
							variant="outline"
							onClick={() => refetch()}
							className="mt-3"
						>
							Reintentar
						</Button>
					</div>
				)}

				{!isLoading && !isError && items.length === 0 && (
					<div className="py-20 text-center">
						<p className="text-muted-foreground">
							{filterByMonth
								? "No se encontraron liquidaciones para este período."
								: "No hay liquidaciones."}
						</p>
					</div>
				)}

				{!isLoading && !isError && paginated.length > 0 && (
					<div className="grid w-full grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
						{paginated.map((item: any, idx: number) => (
							<LiquidacionCard
								key={`${item.inversionista_id}-${item.mes_liquidacion ?? idx}`}
								item={item}
							/>
						))}
					</div>
				)}
			</div>

			{/* Pagination */}
			{totalPages > 1 && (
				<div className="flex items-center justify-center gap-1.5 border-t bg-background px-6 py-3">
					<Button
						variant="outline"
						size="icon"
						className="h-8 w-8"
						onClick={() => setPage((p) => Math.max(1, p - 1))}
						disabled={page === 1}
					>
						<ChevronLeft className="h-4 w-4" />
					</Button>
					{Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
						let pageNum: number;
						if (totalPages <= 5) {
							pageNum = i + 1;
						} else if (page <= 3) {
							pageNum = i + 1;
						} else if (page >= totalPages - 2) {
							pageNum = totalPages - 4 + i;
						} else {
							pageNum = page - 2 + i;
						}
						return (
							<Button
								key={pageNum}
								variant={pageNum === page ? "default" : "outline"}
								size="sm"
								className="h-8 w-9"
								onClick={() => setPage(pageNum)}
							>
								{pageNum}
							</Button>
						);
					})}
					<Button
						variant="outline"
						size="icon"
						className="h-8 w-8"
						onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
						disabled={page === totalPages}
					>
						<ChevronRight className="h-4 w-4" />
					</Button>
				</div>
			)}
		</div>
	);
}

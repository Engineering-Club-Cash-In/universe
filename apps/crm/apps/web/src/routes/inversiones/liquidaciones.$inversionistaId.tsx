import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	ArrowLeft,
	Banknote,
	CalendarDays,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	Clock,
	CreditCard,
	DollarSign,
	Download,
	Eye,
	EyeOff,
	FileText,
	Filter,
	Landmark,
	Layers,
	Loader2,
	Mail,
	Phone,
	Plus,
	RefreshCw,
	Shield,
	Trash2,
	TrendingUp,
	Upload,
	Users,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { authClient } from "@/lib/auth-client";
import { PERMISSIONS } from "@/lib/roles";
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

// ─── Investor Documents ──────────────────────────────────────────────────────

function InvestorDocumentsSection({
	inversionistaId,
	isManager,
}: {
	inversionistaId: number;
	isManager: boolean;
}) {
	const queryClient = useQueryClient();
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [showUpload, setShowUpload] = useState(false);
	const [nombre, setNombre] = useState("");
	const [descripcion, setDescripcion] = useState("");
	const [visible, setVisible] = useState(false);
	const [selectedFile, setSelectedFile] = useState<File | null>(null);

	const docsQuery = useQuery({
		...orpc.getInvestorDocumentsAdmin.queryOptions({
			input: { inversionistaId },
		}),
	});

	const invalidateDocs = () => {
		queryClient.invalidateQueries({
			queryKey: orpc.getInvestorDocumentsAdmin.queryOptions({
				input: { inversionistaId },
			}).queryKey,
			refetchType: "all",
		});
		queryClient.invalidateQueries({
			queryKey: orpc.getInvestorActivityLog.queryOptions({
				input: { inversionistaId },
			}).queryKey,
			refetchType: "all",
		});
	};

	const createMutation = useMutation({
		...orpc.createInvestorDocument.mutationOptions(),
		onSuccess: () => {
			toast.success("Documento creado exitosamente");
			invalidateDocs();
			setShowUpload(false);
			setNombre("");
			setDescripcion("");
			setVisible(false);
			setSelectedFile(null);
		},
		onError: (err: any) => {
			toast.error(err?.message ?? "Error al crear documento");
		},
	});

	const toggleVisibilityMutation = useMutation({
		...orpc.toggleInvestorDocumentVisibility.mutationOptions(),
		onSuccess: () => {
			toast.success("Visibilidad actualizada");
			invalidateDocs();
		},
		onError: (err: any) => {
			toast.error(err?.message ?? "Error al actualizar visibilidad");
		},
	});

	const deleteMutation = useMutation({
		...orpc.deleteInvestorDocument.mutationOptions(),
		onSuccess: () => {
			toast.success("Documento eliminado");
			invalidateDocs();
		},
		onError: (err: any) => {
			toast.error(err?.message ?? "Error al eliminar documento");
		},
	});

	const handleUpload = async () => {
		if (!selectedFile) return;
		const arrayBuffer = await selectedFile.arrayBuffer();
		const base64 = btoa(
			new Uint8Array(arrayBuffer).reduce(
				(data, byte) => data + String.fromCharCode(byte),
				"",
			),
		);
		const finalNombre = nombre.trim() || selectedFile.name;
		createMutation.mutate({
			inversionistaId,
			nombre: finalNombre,
			descripcion: descripcion.trim() || undefined,
			visible,
			fileBase64: base64,
			fileMimeType: selectedFile.type || "application/octet-stream",
		});
	};

	const docs = (docsQuery.data as any)?.data ?? [];

	return (
		<div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
			<div className="mb-4 flex items-center justify-between">
				<h2 className="flex items-center gap-2 font-bold text-sm">
					<FileText className="h-4 w-4 text-primary" />
					Documentos
				</h2>
				<div className="flex items-center gap-2">
					<Button
						variant="outline"
						size="icon"
						className="h-8 w-8"
						onClick={() => docsQuery.refetch()}
						disabled={docsQuery.isLoading}
					>
						{docsQuery.isLoading ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
						) : (
							<RefreshCw className="h-3.5 w-3.5" />
						)}
					</Button>
					<Button
						variant={showUpload ? "secondary" : "outline"}
						size="sm"
						className="h-8 gap-1.5"
						onClick={() => setShowUpload((v) => !v)}
					>
						<Plus className="h-3.5 w-3.5" />
						Subir
					</Button>
				</div>
			</div>

			{/* Upload form */}
			{showUpload && (
				<div className="mb-4 space-y-3 rounded-lg border bg-muted/50 p-4">
					<div>
						<input
							ref={fileInputRef}
							type="file"
							onChange={(e) => {
								const file = e.target.files?.[0] ?? null;
								setSelectedFile(file);
								if (file && !nombre.trim()) {
									setNombre(file.name);
								}
							}}
							className="hidden"
						/>
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="gap-2"
							onClick={() => fileInputRef.current?.click()}
						>
							<FileText className="h-3.5 w-3.5" />
							{selectedFile ? selectedFile.name : "Seleccionar archivo"}
						</Button>
					</div>
					<div className="space-y-1">
						<Label htmlFor="doc-nombre" className="text-xs">
							Nombre (opcional)
						</Label>
						<Input
							id="doc-nombre"
							value={nombre}
							onChange={(e) => setNombre(e.target.value)}
							placeholder="Se usará el nombre del archivo si se deja vacío"
						/>
					</div>
					<div className="space-y-1">
						<Label htmlFor="doc-descripcion" className="text-xs">
							Descripción (opcional)
						</Label>
						<Input
							id="doc-descripcion"
							value={descripcion}
							onChange={(e) => setDescripcion(e.target.value)}
							placeholder="Descripción breve"
						/>
					</div>
					{isManager && (
						<div className="flex items-center gap-2">
							<Checkbox
								id="doc-visible"
								checked={visible}
								onCheckedChange={(checked) => setVisible(checked === true)}
							/>
							<Label htmlFor="doc-visible" className="text-xs">
								Visible para el inversionista
							</Label>
						</div>
					)}
					<div className="flex gap-2">
						<Button
							size="sm"
							disabled={!selectedFile || createMutation.isPending}
							onClick={handleUpload}
							className="gap-1.5"
						>
							{createMutation.isPending ? (
								<Loader2 className="h-3.5 w-3.5 animate-spin" />
							) : (
								<Upload className="h-3.5 w-3.5" />
							)}
							Subir documento
						</Button>
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setShowUpload(false)}
						>
							Cancelar
						</Button>
					</div>
				</div>
			)}

			{/* Documents list */}
			{docsQuery.isLoading && (
				<div className="flex items-center gap-2 py-4 text-muted-foreground text-xs">
					<Loader2 className="h-3.5 w-3.5 animate-spin" />
					Cargando documentos...
				</div>
			)}

			{!docsQuery.isLoading && docs.length === 0 && (
				<p className="py-2 text-muted-foreground text-xs italic">
					Sin documentos
				</p>
			)}

			{docs.length > 0 && (
				<div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
					{docs.map((doc: any) => (
						<div
							key={doc.documento_id}
							className="flex items-center justify-between gap-2 rounded-lg border bg-background px-3 py-2"
						>
							<div className="min-w-0 flex-1">
								<p className="truncate font-medium text-xs">{doc.nombre}</p>
								{doc.descripcion && (
									<p className="truncate text-[10px] text-muted-foreground">
										{doc.descripcion}
									</p>
								)}
								<div className="mt-0.5 flex items-center gap-2">
									<Badge
										variant="outline"
										className={
											doc.visible
												? "border-green-300 bg-green-50 text-[10px] text-green-700 dark:border-green-700 dark:bg-green-950 dark:text-green-300"
												: "text-[10px]"
										}
									>
										{doc.visible ? "Visible" : "Oculto"}
									</Badge>
								</div>
							</div>
							<div className="flex shrink-0 items-center gap-1">
								{doc.url && (
									<a href={doc.url} target="_blank" rel="noopener noreferrer">
										<Button variant="ghost" size="icon" className="h-7 w-7">
											<Download className="h-3.5 w-3.5" />
										</Button>
									</a>
								)}
								<Button
									variant="ghost"
									size="icon"
									className="h-7 w-7"
									onClick={() => {
										if (!isManager) return;
										toggleVisibilityMutation.mutate({
											inversionistaId,
											documentoId: doc.documento_id,
											visible: !doc.visible,
											documentoNombre: doc.nombre,
										});
									}}
									disabled={!isManager || toggleVisibilityMutation.isPending}
									title={
										!isManager
											? "Solo el gerente de inversiones puede cambiar la visibilidad"
											: doc.visible
												? "Ocultar"
												: "Hacer visible"
									}
								>
									{doc.visible ? (
										<EyeOff className="h-3.5 w-3.5" />
									) : (
										<Eye className="h-3.5 w-3.5" />
									)}
								</Button>
								<Button
									variant="ghost"
									size="icon"
									className="h-7 w-7 text-destructive hover:text-destructive"
									onClick={() => {
										if (confirm("¿Estás seguro de eliminar este documento?")) {
											deleteMutation.mutate({
												inversionistaId,
												documentoId: doc.documento_id,
												documentoNombre: doc.nombre,
											});
										}
									}}
									disabled={deleteMutation.isPending}
								>
									<Trash2 className="h-3.5 w-3.5" />
								</Button>
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

// ─── Activity Log ─────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
	document_created: "Documento creado",
	document_deleted: "Documento eliminado",
	document_visibility_toggled: "Visibilidad cambiada",
};

const ACTION_COLORS: Record<string, string> = {
	document_created:
		"border-green-300 bg-green-50 text-green-700 dark:border-green-700 dark:bg-green-950 dark:text-green-300",
	document_deleted:
		"border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-950 dark:text-red-300",
	document_visibility_toggled:
		"border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300",
};

function InvestorActivityLogSection({
	inversionistaId,
}: {
	inversionistaId: number;
}) {
	const [open, setOpen] = useState(false);
	const logsQuery = useQuery({
		...orpc.getInvestorActivityLog.queryOptions({
			input: { inversionistaId },
		}),
		enabled: open,
	});

	const logs = logsQuery.data ?? [];

	return (
		<div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
			<button
				type="button"
				className="flex w-full items-center justify-between"
				onClick={() => setOpen((v) => !v)}
			>
				<h2 className="flex items-center gap-2 font-bold text-sm">
					<Clock className="h-4 w-4 text-primary" />
					Historial de actividad
				</h2>
				<ChevronDown
					className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
				/>
			</button>

			{open && (
				<div className="mt-4">
					{logsQuery.isLoading && (
						<div className="flex items-center gap-2 py-4 text-muted-foreground text-xs">
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
							Cargando historial...
						</div>
					)}

					{!logsQuery.isLoading && logs.length === 0 && (
						<p className="py-2 text-muted-foreground text-xs italic">
							Sin actividad registrada
						</p>
					)}

					{logs.length > 0 && (
				<div className="space-y-2">
					{logs.map((log: any) => {
						const details = log.details as Record<string, any> | null;
						return (
							<div
								key={log.id}
								className="flex items-start gap-3 rounded-lg border bg-background px-3 py-2"
							>
								<div className="min-w-0 flex-1">
									<div className="flex flex-wrap items-center gap-2">
										<Badge
											variant="outline"
											className={`text-[10px] ${ACTION_COLORS[log.action] ?? ""}`}
										>
											{ACTION_LABELS[log.action] ?? log.action}
										</Badge>
										{details?.nombre || details?.documentoNombre ? (
											<span className="truncate font-medium text-xs">
												{details.nombre ?? details.documentoNombre}
											</span>
										) : null}
										{log.action === "document_visibility_toggled" &&
											details?.visible !== undefined && (
												<Badge variant="outline" className="text-[10px]">
													{details.visible ? "Visible" : "Oculto"}
												</Badge>
											)}
									</div>
									<p className="mt-0.5 text-[10px] text-muted-foreground">
										{log.performedByName} ·{" "}
										{new Date(log.createdAt).toLocaleString("es-GT", {
											day: "2-digit",
											month: "short",
											year: "numeric",
											hour: "2-digit",
											minute: "2-digit",
										})}
									</p>
								</div>
							</div>
						);
					})}
				</div>
			)}
				</div>
			)}
		</div>
	);
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
	const { data: session } = authClient.useSession();
	const userRole = (session?.user as any)?.role ?? "";
	const isManager = PERMISSIONS.canValidateInvestmentFunds(userRole);

	const now = new Date();
	const [filterByMonth, setFilterByMonth] = useState(false);
	const [mes, setMes] = useState(now.getMonth() + 1);
	const [anio, setAnio] = useState(now.getFullYear());
	const [page, setPage] = useState(1);
	const PER_PAGE = 25;

	// Fetch investor info by ID from cartera
	const investorsQuery = useQuery({
		...orpc.getInversionistas.queryOptions({
			input: { id: investorIdNum, page: 1, perPage: 1 },
		}),
	});
	const investor = (investorsQuery.data?.inversionistas as any[])?.[0] ?? null;

	// Fetch rendimiento/stats
	const rendimientoQuery = useQuery({
		...orpc.getInvestorRendimiento.queryOptions({
			input: { email: investor?.email ?? "" },
		}),
		enabled: !!investor?.email,
	});
	const stats = (rendimientoQuery.data as any)?.data ?? null;

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
			{/* Header — Nombre */}
			<div className="shrink-0 border-b bg-background px-6 py-5">
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
			</div>

			{/* Scrollable content */}
			<div className="flex-1 space-y-6 overflow-y-auto p-6">
				{/* Datos del inversionista */}
				{investor && (
					<div>
						<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
							{investor.celular && (
								<div className="flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2">
									<Phone className="h-4 w-4 shrink-0 text-muted-foreground" />
									<div className="min-w-0">
										<p className="text-[10px] text-muted-foreground uppercase tracking-wide">
											Celular
										</p>
										<div className="flex flex-wrap gap-1">
											{investor.celular.split(",").map((num: string) => (
												<span
													key={num.trim()}
													className="rounded bg-muted px-1.5 py-0.5 font-medium font-mono text-xs"
												>
													{num.trim()}
												</span>
											))}
										</div>
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
							{stats && (
								<>
									<div className="flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2">
										<DollarSign className="h-4 w-4 shrink-0 text-muted-foreground" />
										<div className="min-w-0">
											<p className="text-[10px] text-muted-foreground uppercase tracking-wide">
												Capital aportado
											</p>
											<p className="truncate font-medium text-xs">
												{formatQ(stats.capital_total_aportado)}
											</p>
										</div>
									</div>
									<div className="flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2">
										<Layers className="h-4 w-4 shrink-0 text-muted-foreground" />
										<div className="min-w-0">
											<p className="text-[10px] text-muted-foreground uppercase tracking-wide">
												Inversiones
											</p>
											<p className="font-medium text-xs">
												{stats.cantidad_inversiones}
											</p>
										</div>
									</div>
								</>
							)}
						</div>

						{/* Badges */}
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
					</div>
				)}

				{/* Historial de actividad — solo manager/admin */}
				{isManager && (
					<InvestorActivityLogSection inversionistaId={investorIdNum} />
				)}

				{/* Documentos */}
				<InvestorDocumentsSection
					inversionistaId={investorIdNum}
					isManager={isManager}
				/>

				

				{/* Filtro por mes */}
				<div>
					<div className="flex flex-wrap items-center justify-between gap-4">
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

				{/* Liquidaciones */}
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

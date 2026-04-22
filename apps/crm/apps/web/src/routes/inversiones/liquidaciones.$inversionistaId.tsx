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
	Pencil,
	Phone,
	Plus,
	RefreshCw,
	Shield,
	ShoppingCart,
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
import { CurrencyInput } from "@/components/ui/currency-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
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

function formatCurrency(value: number | string | null | undefined, symbol = "Q"): string {
	const num = Number(value ?? 0);
	return `${symbol}${num.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
	compra_cartera: "Compra de cartera",
	investor_created: "Inversionista creado",
	investor_updated: "Inversionista actualizado",
};

const ACTION_COLORS: Record<string, string> = {
	document_created:
		"border-green-300 bg-green-50 text-green-700 dark:border-green-700 dark:bg-green-950 dark:text-green-300",
	document_deleted:
		"border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-950 dark:text-red-300",
	document_visibility_toggled:
		"border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300",
	compra_cartera:
		"border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
	investor_created:
		"border-cyan-300 bg-cyan-50 text-cyan-700 dark:border-cyan-700 dark:bg-cyan-950 dark:text-cyan-300",
	investor_updated:
		"border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-300",
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
	const sym = item.currencySymbol ?? "Q";

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
						{formatCurrency(item.total_abono_capital, sym)}
					</p>
				</div>
				<div className="rounded-lg bg-indigo-50 px-2.5 py-1.5 dark:bg-indigo-950/50">
					<p className="font-medium text-[10px] text-indigo-600 uppercase tracking-wide dark:text-indigo-400">
						Interés
					</p>
					<p className="font-bold text-[13px] text-indigo-900 dark:text-indigo-100">
						{formatCurrency(item.total_abono_interes, sym)}
					</p>
				</div>
				<div className="rounded-lg bg-purple-50 px-2.5 py-1.5 dark:bg-purple-950/50">
					<p className="font-medium text-[10px] text-purple-600 uppercase tracking-wide dark:text-purple-400">
						IVA
					</p>
					<p className="font-bold text-[13px] text-purple-900 dark:text-purple-100">
						{formatCurrency(item.total_abono_iva, sym)}
					</p>
				</div>
				<div className="rounded-lg bg-orange-50 px-2.5 py-1.5 dark:bg-orange-950/50">
					<p className="font-medium text-[10px] text-orange-600 uppercase tracking-wide dark:text-orange-400">
						ISR
					</p>
					<p className="font-bold text-[13px] text-orange-900 dark:text-orange-100">
						{formatCurrency(item.total_isr, sym)}
					</p>
				</div>
				<div className="rounded-lg bg-teal-50 px-2.5 py-1.5 dark:bg-teal-950/50">
					<p className="font-medium text-[10px] text-teal-600 uppercase tracking-wide dark:text-teal-400">
						Reinversión
					</p>
					<p className="font-bold text-[13px] text-teal-900 dark:text-teal-100">
						{formatCurrency(item.total_reinversion, sym)}
					</p>
				</div>
				<div className="rounded-lg border border-border bg-muted px-2.5 py-1.5">
					<p className="font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
						Total c/Reinv.
					</p>
					<p className="font-extrabold text-[13px] text-foreground">
						{formatCurrency(item.total_a_recibir_con_reinversion, sym)}
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

	// Compra de cartera
	const [compraCarteraOpen, setCompraCarteraOpen] = useState(false);
	const [compraCarteraMonto, setCompraCarteraMonto] = useState("");
	const [compraCarteraPctInversion, setCompraCarteraPctInversion] = useState("70");
	const [compraCarteraPctCashIn, setCompraCarteraPctCashIn] = useState("30");
	const [compraCarteraFecha, setCompraCarteraFecha] = useState(
		new Date().toISOString().split("T")[0],
	);

	const queryClient = useQueryClient();
	const compraCarteraMutation = useMutation({
		...orpc.compraCartera.mutationOptions(),
		onSuccess: () => {
			toast.success("Compra de cartera registrada correctamente");
			setCompraCarteraOpen(false);
			setCompraCarteraMonto("");
			setCompraCarteraPctInversion("70");
			setCompraCarteraPctCashIn("30");
			queryClient.invalidateQueries({
				queryKey: orpc.getInvestorActivityLog.queryOptions({
					input: { inversionistaId: investorIdNum },
				}).queryKey,
			});
			queryClient.invalidateQueries({
				queryKey: orpc.getInversionistas.queryOptions({
					input: { id: investorIdNum, page: 1, perPage: 1 },
				}).queryKey,
			});
			queryClient.invalidateQueries({
				predicate: (query) =>
					JSON.stringify(query.queryKey).includes("getInvestorRendimiento"),
			});
			queryClient.invalidateQueries({
				predicate: (query) =>
					JSON.stringify(query.queryKey).includes("getInvestorDocumentsAdmin"),
			});
			refetch();
		},
		onError: (err: any) => {
			toast.error(err?.message ?? "Error al registrar compra de cartera");
		},
	});

	// Editar inversionista
	const [editOpen, setEditOpen] = useState(false);
	const [editNombre, setEditNombre] = useState("");
	const [editDpi, setEditDpi] = useState("");
	const [editEmail, setEditEmail] = useState("");
	const [editBanco, setEditBanco] = useState("");
	const [editTipoCuenta, setEditTipoCuenta] = useState("");
	const [editNumeroCuenta, setEditNumeroCuenta] = useState("");
	const [editMoneda, setEditMoneda] = useState("quetzales");
	const [editEmiteFactura, setEditEmiteFactura] = useState(false);
	const [editTipoReinversion, setEditTipoReinversion] = useState("sin_reinversion");
	const [editMontoReinversion, setEditMontoReinversion] = useState("");

	const bancosQuery = useQuery({
		...orpc.getBancosCartera.queryOptions({ input: undefined as never }),
		enabled: editOpen,
	});
	const bancos = (bancosQuery.data as any) ?? [];

	const openEditModal = (inv: any) => {
		setEditNombre(inv.nombre ?? inv.nombre_inversionista ?? "");
		setEditDpi(inv.dpi ? String(inv.dpi) : "");
		setEditEmail(inv.email ?? "");
		setEditBanco(inv.banco_id ? String(inv.banco_id) : "");
		setEditTipoCuenta(inv.tipoCuenta ?? inv.tipo_cuenta ?? "");
		setEditNumeroCuenta(inv.numeroCuenta ?? inv.numero_cuenta ?? "");
		setEditMoneda(inv.moneda ?? "quetzales");
		setEditEmiteFactura(inv.emiteFactura ?? inv.emite_factura ?? false);
		setEditTipoReinversion(inv.tipoReinversion ?? inv.tipo_reinversion ?? "sin_reinversion");
		setEditMontoReinversion(inv.monto_reinversion ? String(inv.monto_reinversion) : "");
		setEditOpen(true);
	};

	const editMutation = useMutation({
		...orpc.editarInversionista.mutationOptions(),
		onSuccess: () => {
			toast.success("Inversionista actualizado correctamente");
			setEditOpen(false);
			queryClient.invalidateQueries({
				queryKey: orpc.getInversionistas.queryOptions({
					input: { id: investorIdNum, page: 1, perPage: 1 },
				}).queryKey,
				refetchType: "all",
			});
			queryClient.invalidateQueries({
				queryKey: orpc.getInvestorActivityLog.queryOptions({
					input: { inversionistaId: investorIdNum },
				}).queryKey,
				refetchType: "all",
			});
		},
		onError: (err: any) => {
			toast.error(err?.message ?? "Error al actualizar inversionista");
		},
	});

	// Fetch investor info by ID from cartera
	const investorsQuery = useQuery({
		...orpc.getInversionistas.queryOptions({
			input: { id: investorIdNum, page: 1, perPage: 1 },
		}),
	});
	const investor = useMemo(() => {
		const raw = investorsQuery.data?.inversionistas;
		if (!raw) return null;
		// Con id cartera devuelve objeto directo, sin id devuelve array
		return Array.isArray(raw) ? raw[0] ?? null : raw;
	}, [investorsQuery.data]);

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
					<div className="flex flex-1 items-center justify-between">
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
						<div className="flex items-center gap-2">
							<Button
								variant="outline"
								size="sm"
								className="gap-2"
								onClick={() => {
									if (investor) openEditModal(investor);
								}}
							>
								<Pencil className="h-4 w-4" />
								Editar
							</Button>
							<Button
								variant="outline"
								size="sm"
								className="gap-2"
								onClick={() => setCompraCarteraOpen(true)}
							>
								<ShoppingCart className="h-4 w-4" />
								Compra de Cartera
							</Button>
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
												{formatCurrency(stats.capital_total_aportado, investor?.moneda === "dolares" ? "$" : "Q")}
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
							{investor.tipoReinversion && investor.tipoReinversion !== "sin_reinversion" && (
								<Badge
									variant="outline"
									className="border-purple-300 bg-purple-50 text-[10px] text-purple-700 dark:border-purple-700 dark:bg-purple-950 dark:text-purple-300"
								>
									{{
										reinversion_capital: "Reinversión Capital",
										reinversion_interes: "Reinversión Interés",
										reinversion_total: "Reinversión Total",
										reinversion_variable: "Reinversión Variable",
										reinversion_combinada: "Reinversión Combinada",
									}[investor.tipoReinversion as string] ?? "Reinversión"}
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

			{/* Modal Editar Inversionista */}
			<Dialog
				open={editOpen}
				onOpenChange={(open) => {
					setEditOpen(open);
				}}
			>
				<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
					<DialogHeader>
						<DialogTitle>Editar Inversionista</DialogTitle>
						<DialogDescription>
							Modificar los datos de{" "}
							<span className="font-semibold">
								{investor?.nombre ?? "este inversionista"}
							</span>
						</DialogDescription>
					</DialogHeader>

					<div className="space-y-4 py-2">
						<div className="space-y-1.5">
							<Label htmlFor="edit-nombre">Nombre *</Label>
							<Input
								id="edit-nombre"
								value={editNombre}
								onChange={(e) => setEditNombre(e.target.value)}
							/>
						</div>

						<div className="grid grid-cols-2 gap-3">
							<div className="space-y-1.5">
								<Label htmlFor="edit-dpi">DPI</Label>
								<Input
									id="edit-dpi"
									value={editDpi}
									onChange={(e) => setEditDpi(e.target.value)}
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="edit-email">Email</Label>
								<Input
									id="edit-email"
									type="email"
									value={editEmail}
									onChange={(e) => setEditEmail(e.target.value)}
								/>
							</div>
						</div>

						<div className="grid grid-cols-2 gap-3">
							<div className="space-y-1.5">
								<Label htmlFor="edit-banco">Banco</Label>
								<Select value={editBanco} onValueChange={setEditBanco}>
									<SelectTrigger id="edit-banco">
										<SelectValue placeholder="Seleccionar banco..." />
									</SelectTrigger>
									<SelectContent>
										{bancos.map((b: any) => (
											<SelectItem
												key={b.banco_id}
												value={String(b.banco_id)}
											>
												{b.nombre}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="edit-tipo-cuenta">Tipo de cuenta</Label>
								<Select
									value={editTipoCuenta}
									onValueChange={setEditTipoCuenta}
								>
									<SelectTrigger id="edit-tipo-cuenta">
										<SelectValue placeholder="Seleccionar..." />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="AHORRO Q">Ahorro Q</SelectItem>
										<SelectItem value="AHORRO $">Ahorro $</SelectItem>
										<SelectItem value="MONETARIA Q">Monetaria Q</SelectItem>
										<SelectItem value="MONETARIA $">Monetaria $</SelectItem>
									</SelectContent>
								</Select>
							</div>
						</div>

						<div className="space-y-1.5">
							<Label htmlFor="edit-numero-cuenta">Número de cuenta</Label>
							<Input
								id="edit-numero-cuenta"
								value={editNumeroCuenta}
								onChange={(e) => setEditNumeroCuenta(e.target.value)}
							/>
						</div>

						<div className="grid grid-cols-2 gap-3">
							<div className="space-y-1.5">
								<Label htmlFor="edit-moneda">Moneda</Label>
								<Select value={editMoneda} onValueChange={setEditMoneda}>
									<SelectTrigger id="edit-moneda">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="quetzales">Quetzales (GTQ)</SelectItem>
										<SelectItem value="dolares">Dólares (USD)</SelectItem>
									</SelectContent>
								</Select>
							</div>
							<div className="flex items-end pb-2">
								<div className="flex items-center gap-2">
									<Checkbox
										id="edit-factura"
										checked={editEmiteFactura}
										onCheckedChange={(v) => setEditEmiteFactura(v === true)}
									/>
									<Label htmlFor="edit-factura">Emite factura</Label>
								</div>
							</div>
						</div>

						<div className="grid grid-cols-2 gap-3">
							<div className="space-y-1.5">
								<Label htmlFor="edit-reinversion">Modelo de Inversión</Label>
								<Select
									value={editTipoReinversion}
									onValueChange={setEditTipoReinversion}
								>
									<SelectTrigger id="edit-reinversion">
										<SelectValue />
									</SelectTrigger>
									
									<SelectContent>
										<SelectItem value="sin_reinversion">
											Tradicional
										</SelectItem>
										<SelectItem value="reinversion_capital">Reinversión Capital</SelectItem>
										<SelectItem value="reinversion_total">Interés Compuesto</SelectItem>
									</SelectContent>
								</Select>
							</div>
							{editTipoReinversion === "reinversion_variable" && (
								<div className="space-y-1.5">
									<Label htmlFor="edit-monto-reinversion">
										Monto reinversión
									</Label>
									<Input
										id="edit-monto-reinversion"
										type="number"
										min="0"
										step="0.01"
										value={editMontoReinversion}
										onChange={(e) => setEditMontoReinversion(e.target.value)}
									/>
								</div>
							)}
						</div>
					</div>

					<DialogFooter className="gap-2 sm:justify-between">
						<Button
							variant="outline"
							onClick={() => setEditOpen(false)}
						>
							Cancelar
						</Button>
						<Button
							disabled={editMutation.isPending || !editNombre.trim()}
							onClick={() => {
								editMutation.mutate({
									inversionistaId: investorIdNum,
									nombre: editNombre.trim(),
									dpi: editDpi.trim() || undefined,
									email: editEmail.trim() || undefined,
									banco: editBanco ? Number(editBanco) : null,
									tipoCuenta: editTipoCuenta || undefined,
									numeroCuenta: editNumeroCuenta.trim() || undefined,
									moneda: editMoneda as "quetzales" | "dolares",
									emiteFactura: editEmiteFactura,
									tipoReinversion: editTipoReinversion,
									montoReinversion: editMontoReinversion
										? Number(editMontoReinversion)
										: undefined,
								});
							}}
						>
							{editMutation.isPending ? (
								<>
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									Guardando...
								</>
							) : (
								"Guardar cambios"
							)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Modal Compra de Cartera */}
			<Dialog
				open={compraCarteraOpen}
				onOpenChange={(open) => {
					setCompraCarteraOpen(open);
					if (!open) {
						setCompraCarteraMonto("");
						setCompraCarteraPctInversion("70");
						setCompraCarteraPctCashIn("30");
					}
				}}
			>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Compra de Cartera</DialogTitle>
						<DialogDescription>
							Registrar una compra de cartera para{" "}
							<span className="font-semibold">
								{investor?.nombre ?? "este inversionista"}
							</span>
						</DialogDescription>
					</DialogHeader>

					<div className="rounded-md border border-purple-200 bg-purple-50 p-3 dark:border-purple-800 dark:bg-purple-950/40">
						<div className="flex items-center justify-between gap-2">
							<span className="text-xs font-medium text-purple-900 dark:text-purple-200">
								Modelo de reinversión
							</span>
							<Badge
								variant="outline"
								className="border-purple-300 bg-white text-[11px] text-purple-700 dark:border-purple-700 dark:bg-purple-950 dark:text-purple-300"
							>
								{{
									reinversion_capital: "Reinversión Capital",
									reinversion_interes: "Reinversión Interés",
									reinversion_total: "Interés Compuesto",
									reinversion_variable: "Reinversión Variable",
									reinversion_combinada: "Reinversión Combinada",
									sin_reinversion: "Sin reinversión",
								}[
									(investor?.tipoReinversion as string) ?? "sin_reinversion"
								] ?? "Sin reinversión"}
							</Badge>
						</div>
					</div>

					<div className="space-y-4 py-2">
						<div className="space-y-1.5">
							<Label htmlFor="compra-monto">Monto aportado</Label>
							<CurrencyInput
								id="compra-monto"
								value={compraCarteraMonto}
								onChange={setCompraCarteraMonto}
							/>
						</div>
						<div className="grid grid-cols-2 gap-3">
							<div className="space-y-1.5">
								<Label htmlFor="compra-pct-inv">% Inversiónista</Label>
								<Input
									id="compra-pct-inv"
									type="number"
									min="0"
									max="100"
									value={compraCarteraPctInversion}
									onChange={(e) => {
										const val = e.target.value;
										setCompraCarteraPctInversion(val);
										const num = Number(val);
										if (!Number.isNaN(num)) {
											setCompraCarteraPctCashIn(String(100 - num));
										}
									}}
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="compra-pct-cci">% CCI</Label>
								<Input
									id="compra-pct-cci"
									type="number"
									min="0"
									max="100"
									value={compraCarteraPctCashIn}
									onChange={(e) => {
										const val = e.target.value;
										setCompraCarteraPctCashIn(val);
										const num = Number(val);
										if (!Number.isNaN(num)) {
											setCompraCarteraPctInversion(String(100 - num));
										}
									}}
								/>
							</div>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="compra-fecha">
								Fecha inicio participación
							</Label>
							<Input
								id="compra-fecha"
								type="date"
								value={compraCarteraFecha}
								onChange={(e) => setCompraCarteraFecha(e.target.value)}
							/>
						</div>
					</div>

					<DialogFooter className="gap-3 sm:gap-3">
						<Button
							variant="outline"
							onClick={() => {
								setCompraCarteraOpen(false);
								setCompraCarteraMonto("");
								setCompraCarteraPctInversion("70");
								setCompraCarteraPctCashIn("30");
							}}
						>
							Cancelar
						</Button>
						<Button
							disabled={
								compraCarteraMutation.isPending ||
								!compraCarteraMonto ||
								Number(compraCarteraMonto) <= 0
							}
							onClick={() => {
								compraCarteraMutation.mutate({
									inversionistaId: investorIdNum,
									montoAportado: Number(compraCarteraMonto),
									porcentajeInversion: Number(compraCarteraPctInversion),
									porcentajeCashIn: Number(compraCarteraPctCashIn),
									fechaInicioParticipacion: compraCarteraFecha || undefined,
								});
							}}
						>
							{compraCarteraMutation.isPending ? (
								<>
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									Guardando...
								</>
							) : (
								"Confirmar"
							)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}

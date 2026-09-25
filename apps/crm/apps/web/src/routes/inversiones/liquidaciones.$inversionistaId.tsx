import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	AlertCircle,
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
	KeyRound,
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { InvestorStatusBadge } from "@/components/investments/InvestorStatusBadge";
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
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { avisoAccesoPortal, valorDeTabla } from "@/lib/acceso-portal";
import { authClient } from "@/lib/auth-client";
import {
	errorRepLegal,
	esEmpresaInicial,
	requiereConfirmacionBorrado,
	valorRepLegalAlGuardar,
} from "@/lib/rep-legal-empresa";
import {
	MODALIDAD_FACTURACION_LABELS,
	type ModalidadFacturacion,
} from "@/lib/modalidad-facturacion";
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
								{/* Mismo caso que el botón de acceso al portal: sin el gerente
									de inversiones este botón queda gris, y un `title` sobre un
									botón deshabilitado no se ve nunca
									(`disabled:pointer-events-none` en components/ui/button.tsx).
									El <span> de afuera sí recibe el mouse, y es el único lugar
									donde se explica por qué está apagado. */}
								<Tooltip>
									<TooltipTrigger asChild>
										<span className="inline-flex">
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
												disabled={
													!isManager || toggleVisibilityMutation.isPending
												}
												// El botón es solo un ícono: su nombre lo daba el
												// `title` que acaba de mudarse al tooltip, y el
												// tooltip describe al <span>, no a él. Sin esto el
												// lector de pantalla se queda con un botón sin nombre.
												aria-label={
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
										</span>
									</TooltipTrigger>
									<TooltipContent side="bottom" className="max-w-xs">
										{!isManager
											? "Solo el gerente de inversiones puede cambiar la visibilidad"
											: doc.visible
												? "Ocultar"
												: "Hacer visible"}
									</TooltipContent>
								</Tooltip>
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
	acceso_portal: "Acceso al portal",
};

/**
 * Qué pasó con ese acceso, en palabras. Los estados los manda cartera dentro de
 * `details.estado` y son los mismos que traduce `@/lib/acceso-portal`; acá solo
 * se resumen en una etiqueta, porque la bitácora es una lista y no un aviso.
 *
 * NINGUNA fila de acceso se queda sin insignia. Antes el render iba guardado
 * por `ESTADOS_ACCESO_PORTAL[details.estado] &&`, así que un estado que la
 * tabla no conociera —o uno nulo— salía sin nada y quedaba INDISTINGUIBLE de
 * una fila normal. Justo el caso peor: `sin_respuesta_de_cartera` es la fila
 * que significa "puede que haya salido una contraseña y nadie sabe", y sin
 * insignia nadie la iba a mirar. La duda se VE.
 */
const ESTADOS_ACCESO_PORTAL: Record<
	string,
	{ etiqueta: string; clase: string }
> = {
	creada: { etiqueta: "Cuenta creada", clase: "" },
	ya_tenia: { etiqueta: "Ya tenía cuenta", clase: "" },
	avisada: { etiqueta: "Se avisó al representante", clase: "" },
	omitida: { etiqueta: "No se le abrió", clase: "" },
	fallo: { etiqueta: "No se pudo", clase: "" },
	// Este NO es de la enumeración de cartera: lo escribe el propio servidor del
	// CRM cuando cartera no contestó (`investor-documents.ts:735-737`, junto con
	// la advertencia `no_se_sabe_si_la_contrasena_salio`). El salto CRM→cartera
	// se abortó mientras cartera podía seguir dentro de su `fetch` a
	// auth-google, así que la contraseña PUDO salir. Va en rojo y nombrando la
	// duda, no el error: "no se pudo" sería afirmar que no pasó nada.
	sin_respuesta_de_cartera: {
		etiqueta: "No se sabe si salió la contraseña",
		clase:
			"border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-950 dark:text-red-300",
	},
};

/**
 * Un estado que esta tabla no conoce tampoco se calla. El código crudo no se
 * enseña —es jerga del backend— pero que hubo un desenlace que esta pantalla
 * no sabe leer sí se dice: callarlo lo pinta como una fila normal, y la fila
 * que no sabemos leer es justo la que hay que mirar.
 */
const ESTADO_ACCESO_DESCONOCIDO = {
	etiqueta: "Desenlace no reconocido",
	clase:
		"border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300",
};

/**
 * El tipo de reinversión, en palabras. Vive acá y no en línea dentro del JSX
 * por lo mismo que las otras tablas: la clave la manda cartera.
 */
const ETIQUETAS_REINVERSION: Record<string, string> = {
	reinversion_capital: "Reinversión Capital",
	reinversion_interes: "Reinversión Interés",
	reinversion_total: "Reinversión Total",
	reinversion_variable: "Reinversión Variable",
	reinversion_combinada: "Reinversión Combinada",
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
	acceso_portal:
		"border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-300",
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
											className={`text-[10px] ${valorDeTabla(ACTION_COLORS, log.action) ?? ""}`}
										>
											{valorDeTabla(ACTION_LABELS, log.action) ?? log.action}
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
										{/* El registro de acceso al portal guarda `estado`,
											`usuarioEmail`, `advertencias` y `motivo`. Sin esto la
											fila decía solo quién y cuándo: no si la persona quedó
											con acceso. El `motivo` y las `advertencias` NO se
											imprimen —son códigos del backend— pero que hubo
											advertencias sí se dice, porque es lo que manda a
											mirar. */}
										{log.action === "acceso_portal" && (
											<>
												{(() => {
													// Con `valorDeTabla` y no `TABLA[clave]`: `details`
													// es JSON que escribió el servidor, y un
													// `estado: "constructor"` devolvería la función
													// heredada de `Object.prototype` —truthy— para
													// terminar pintando `undefined` en la insignia.
													const estado =
														valorDeTabla(
															ESTADOS_ACCESO_PORTAL,
															details?.estado,
														) ?? ESTADO_ACCESO_DESCONOCIDO;
													return (
														<Badge
															variant="outline"
															className={`text-[10px] ${estado.clase}`}
														>
															{estado.etiqueta}
														</Badge>
													);
												})()}
												{details?.usuarioEmail ? (
													<span className="truncate text-muted-foreground text-xs">
														{details.usuarioEmail}
													</span>
												) : null}
												{Array.isArray(details?.advertencias) &&
												details.advertencias.length > 0 ? (
													<Badge
														variant="outline"
														className="border-amber-300 bg-amber-50 text-[10px] text-amber-700 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300"
													>
														Con advertencias
													</Badge>
												) : null}
											</>
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
				{item.total_neto_impuestos != null && (
					<div className="rounded-lg bg-rose-50 px-2.5 py-1.5 dark:bg-rose-950/50">
						<p className="font-medium text-[10px] text-rose-600 uppercase tracking-wide dark:text-rose-400">
							Neto de impuestos
						</p>
						<p className="font-bold text-[13px] text-rose-900 dark:text-rose-100">
							{formatCurrency(item.total_neto_impuestos, sym)}
						</p>
					</div>
				)}
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
						{/* Solo se rotula la moneda cuando hay dos reportes que distinguir. */}
						{item.reporte_liquidacion_url_gtq ? "Reporte $" : "Reporte"}
					</a>
				)}
				{item.reporte_liquidacion_url_gtq && (
					<a
						href={item.reporte_liquidacion_url_gtq}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex items-center gap-1.5 rounded-lg border bg-background px-3.5 py-2 font-semibold text-foreground text-xs shadow-sm transition-colors hover:bg-muted"
					>
						<FileText className="h-3.5 w-3.5" />
						Reporte Q
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

// ─── Cuenta del portal que EXISTE pero no sirve ──────────────────────────────
// Se dice DENTRO del diálogo, no en el botón: el botón sigue habilitado —es la
// única forma de intentar corregirlo desde la pantalla— y un botón activo sin
// explicación no le dice a nadie que la cuenta está rota.
//
// Los textos NO se reusan de `lib/acceso-portal.ts` a propósito: aquellos
// narran lo que ACABA de pasar en un alta ("se le creó…", "avisa a sistemas") y
// estos describen lo que YA está mal ANTES de apretar, más qué gana apretando.
// Además `cuenta_sin_rol_de_inversionista` —la que llega por el camino de solo
// lectura— no existe allá, porque allá nunca se consulta sin escribir.
//
// Lo que no esté en la lista cae al texto genérico de abajo: jamás se enseña el
// código crudo de la advertencia.
//
// Cada texto va PARTIDO en dos: qué está mal (no cambia nunca) y qué pasa si se
// continúa (sí cambia, y de eso depende si el párrafo miente).
const MOTIVOS_CUENTA_PORTAL_ROTA: Record<
	string,
	{ problema: string; siContinuar: string }
> = {
	cuenta_sin_rol_de_inversionista: {
		problema:
			"Ya tiene cuenta, pero sin el rol de inversionista: entra y no ve sus inversiones.",
		siContinuar: "Al continuar se intenta corregir.",
	},
	rol_no_promovido: {
		problema:
			"Ya tiene cuenta, pero no se le pudo dar el permiso de inversionista: entra y no ve sus inversiones.",
		siContinuar: "Al continuar se intenta corregir.",
	},
	cuenta_creada_sin_rol_ni_dpi: {
		problema:
			"Ya tiene cuenta, pero quedó sin ligar a este inversionista: entra y no ve sus inversiones.",
		siContinuar: "Al continuar se intenta corregir.",
	},
	// Esta NO promete arreglo: continuar no cuadra los correos, y decir que sí
	// mandaría a apretar un botón que no puede resolverlo.
	correo_de_cartera_distinto_al_de_la_cuenta: {
		problema:
			"Ya tiene cuenta en el portal con otro correo, así que al entrar no ve sus inversiones.",
		siContinuar: "Continuar no cuadra los correos: avisá a sistemas.",
	},
};

const MOTIVO_CUENTA_PORTAL_ROTA_GENERICO = {
	problema:
		"Ya tiene cuenta en el portal, pero con un problema que le impide ver sus inversiones.",
	siContinuar: "Al continuar se intenta corregir.",
};

/**
 * La promesa "al continuar se intenta corregir" es FALSA cuando la cuenta se
 * reconoció solo por el correo.
 *
 * `ensureInvestorAccount` se niega estructuralmente a promover una cuenta a la
 * que llegó por correo y que ningún DPI respalda: devuelve `fallo` con motivo
 * `cuenta_anclada_solo_por_correo` sin tocar el rol. O sea que el párrafo de
 * arriba estaría prometiendo justo lo que la escritura tiene prohibido hacer, y
 * quien lo lee aprieta, ve el fallo, vuelve a leer la misma promesa y aprieta
 * otra vez.
 *
 * Esta advertencia sola NO llega acá (`salud-cuenta-portal.ts` la deja fuera de
 * las que rompen la cuenta a propósito, porque sola no la rompe): aparece
 * acompañando a una de las de arriba, y es ahí donde les quita la promesa.
 */
const ANCLADA_SOLO_POR_CORREO = "cuenta_anclada_solo_por_correo";
const SI_CONTINUAR_ANCLADA_SOLO_POR_CORREO =
	"Continuar NO lo corrige: a esa cuenta se la reconoce solo por el correo, y hasta que su DPI la respalde el sistema no le toca el permiso. Avisá a sistemas.";

// ─── Main Page ───────────────────────────────────────────────────────────────

function InvestorLiquidacionesPage() {
	const { inversionistaId } = Route.useParams();
	const investorIdNum = Number(inversionistaId);
	const { data: session } = authClient.useSession();
	const userRole = (session?.user as any)?.role ?? "";
	const isManager = PERMISSIONS.canValidateInvestmentFunds(userRole);
	// El espejo EXACTO del guard que protege las dos puntas del acceso al
	// portal. `darAccesoPortal` y `estadoAccesoPortal` cuelgan de
	// `investmentProcedure` (server/src/routers/investor-documents.ts), que es
	// `requireInvestmentAccess` (server/src/lib/orpc.ts), y ese middleware
	// rechaza con FORBIDDEN a todo el que no pase
	// `PERMISSIONS.canAccessInvestments`: ADMIN, INVESTMENT_ADVISOR_JR,
	// INVESTMENT_ADVISOR_SR e INVESTMENT_MANAGER, y nadie más.
	//
	// Hace falta preguntarlo acá porque esta pantalla NO es solo de
	// inversiones: su ruta no filtra por rol y el resto de sus consultas
	// cuelgan de `crmCobrosOrInvestmentsProcedure`, que además deja entrar a
	// CRM, cobros y contabilidad. Para esa gente la ficha funciona; lo único
	// que el servidor les niega es el acceso al portal.
	const puedeAccesoPortal = PERMISSIONS.canAccessInvestments(userRole);

	const now = new Date();
	const [filterByMonth, setFilterByMonth] = useState(false);
	const [mes, setMes] = useState(now.getMonth() + 1);
	const [anio, setAnio] = useState(now.getFullYear());
	const [page, setPage] = useState(1);
	const PER_PAGE = 25;

	// Liquidar todo el monto aportado (cambia status a pendiente_devolucion)
	const [liquidarTodoOpen, setLiquidarTodoOpen] = useState(false);

	// Compra de cartera
	const [compraCarteraOpen, setCompraCarteraOpen] = useState(false);
	const [compraCarteraMonto, setCompraCarteraMonto] = useState("");
	const [compraCarteraTipoReinversion, setCompraCarteraTipoReinversion] =
		useState<"sin_reinversion" | "reinversion_capital" | "reinversion_total">(
			"sin_reinversion",
		);
	const [compraCarteraModalidad, setCompraCarteraModalidad] =
		useState<ModalidadFacturacion>("p2p_directa");

	// Resuelve por monto las 3 filas del bracket (SQL, fuente única de
	// verdad) y de ahí tomamos la de la modalidad elegida. Solo se necesita
	// mientras el modal está abierto y hay un monto válido. Se debounza el
	// monto que alimenta la query para no disparar un request por cada
	// dígito tecleado (y el parpadeo del warning que eso causaba).
	const compraCarteraMontoNum = Number(compraCarteraMonto) || 0;
	const [compraCarteraMontoDebounced, setCompraCarteraMontoDebounced] =
		useState(compraCarteraMontoNum);
	useEffect(() => {
		const timer = setTimeout(
			() => setCompraCarteraMontoDebounced(compraCarteraMontoNum),
			350,
		);
		return () => clearTimeout(timer);
	}, [compraCarteraMontoNum]);
	const modalidadResolverQuery = useQuery({
		...orpc.resolverModalidadFacturacionSpread.queryOptions({
			input: { monto: compraCarteraMontoDebounced },
		}),
		enabled: compraCarteraOpen && compraCarteraMontoDebounced > 0,
		staleTime: 5 * 60 * 1000,
	});

	// Anulación manual del % Inversionista: el operador puede elegir
	// cualquiera de los 8 brackets de la modalidad (no solo el que
	// corresponde al monto). null = usar la pre-elección automática del
	// sistema. Se resetea al cambiar de modalidad o de monto para no
	// arrastrar una elección que ya no aplica al contexto nuevo.
	const [compraCarteraSpreadOverrideId, setCompraCarteraSpreadOverrideId] =
		useState<number | null>(null);
	useEffect(() => {
		setCompraCarteraSpreadOverrideId(null);
	}, [compraCarteraModalidad, compraCarteraMontoDebounced]);

	const modalidadPorModalidadQuery = useQuery({
		...orpc.listModalidadFacturacionSpreadByModalidad.queryOptions({
			input: { modalidad: compraCarteraModalidad },
		}),
		enabled: compraCarteraOpen,
		staleTime: 5 * 60 * 1000,
	});
	const compraCarteraOverrideRow = compraCarteraSpreadOverrideId
		? modalidadPorModalidadQuery.data?.find(
				(r) => r.id === compraCarteraSpreadOverrideId,
			)
		: undefined;
	const compraCarteraSpreadRow =
		compraCarteraOverrideRow ??
		modalidadResolverQuery.data?.find(
			(r) => r.modalidad === compraCarteraModalidad,
		);
	const compraCarteraPctInvCalc = compraCarteraSpreadRow
		? Number(compraCarteraSpreadRow.spread)
		: undefined;
	const compraCarteraPctCashInCalc =
		compraCarteraPctInvCalc !== undefined ? 100 - compraCarteraPctInvCalc : undefined;
	// Con monto ingresado pero sin bracket válido (ej. < Q1,000) y SIN
	// anulación manual activa, el backend responde sin filas: bloqueamos el
	// confirmar. Con override activo no aplica (el operador ya eligió una
	// fila válida, sin importar el monto).
	const compraCarteraBracketFaltante =
		!compraCarteraSpreadOverrideId &&
		!modalidadResolverQuery.isLoading &&
		!modalidadResolverQuery.isError &&
		compraCarteraMontoDebounced > 0 &&
		!compraCarteraSpreadRow;

	const queryClient = useQueryClient();
	const compraCarteraMutation = useMutation({
		...orpc.compraCartera.mutationOptions(),
		// Mismo motivo que en `darAccesoPortalMutation`: el id sale de lo que se
		// mandó, no del render que cierra el `onSuccess`, que puede ser ya el de
		// otro inversionista si se navegó mientras la respuesta venía en camino.
		onSuccess: (_data: any, variables: any) => {
			const inversionistaId: number = variables.inversionistaId;
			toast.success("Compra de cartera registrada correctamente");
			setCompraCarteraOpen(false);
			setCompraCarteraMonto("");
			setCompraCarteraSpreadOverrideId(null);
			queryClient.invalidateQueries({
				queryKey: orpc.getInvestorActivityLog.queryOptions({
					input: { inversionistaId },
				}).queryKey,
			});
			queryClient.invalidateQueries({
				queryKey: orpc.getInversionistas.queryOptions({
					input: { id: inversionistaId, page: 1, perPage: 1 },
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

	// ─── Dar acceso al portal ──────────────────────────────────────────────
	// Esta acción CREA la cuenta del portal y MANDA una contraseña por correo.
	// El único control que tiene es humano: el diálogo enseña EL CORREO al que
	// va a caer esa contraseña y quien confirma responde por él. Por eso el
	// botón no dispara nada: solo abre la confirmación.
	const [accesoPortalOpen, setAccesoPortalOpen] = useState(false);
	const darAccesoPortalMutation = useMutation({
		...orpc.darAccesoPortal.mutationOptions(),
		// `variables` y no `investorIdNum`: React Query invoca SIEMPRE el último
		// objeto de opciones, y esta ruta no se re-monta por `$inversionistaId`
		// —no está re-keyed—, así que `investorIdNum` es el del render de
		// AHORA. Quien confirma sobre el inversionista 7 y navega al 8 antes de
		// que vuelva la respuesta mandaba la contraseña del 7 e invalidaba las
		// tres consultas del 8: el botón del 7 no se ponía gris y su fila del
		// historial no aparecía hasta recargar. `variables` es lo que se mandó.
		onSuccess: (data: any, variables: any) => {
			const inversionistaId: number = variables.inversionistaId;
			// El tono lo decide el traductor, no un `if` sobre el estado: una
			// cuenta `creada` cuya contraseña NO salió es una ADVERTENCIA, y
			// enseñarla en verde es decirle a conta que ya puede colgar mientras
			// esa persona queda con una cuenta que no sabe que tiene.
			// `"boton"`: quien lee está parada en ESTA pantalla y acaba de apretar
			// este botón. Sin ese dato el traductor le diría "el inversionista sí
			// quedó creado: no lo vuelvas a crear" —acá no se creó nada— y la
			// mandaría a abrir el acceso desde la pantalla en la que ya está.
			//
			// Y el `null` del traductor NO es "salió bien": es "no sé qué pasó".
			// Vuelve en `null` cuando `resultados` viene vacío o con otra forma,
			// cuando el estado es `omitida` con un motivo que no está en la lista,
			// y ante cualquier estado fuera de los cinco conocidos —`candidata`,
			// por ejemplo, que el camino de solo lectura ya emite—. En verde, eso
			// es el mismo bug que este traductor existe para cerrar: quien lee
			// cuelga el teléfono prometiendo una contraseña que no salió.
			const aviso = avisoAccesoPortal(data?.resultados?.[0], "boton");
			if (!aviso)
				toast.warning(
					"No se pudo confirmar si le quedó el acceso al portal. NO le digas todavía que le va a llegar su contraseña: avisa a sistemas para que confirmen si la cuenta quedó creada y si el correo salió.",
					{ duration: 15000 },
				);
			else if (aviso.tono === "advertencia")
				toast.warning(aviso.texto, { duration: 15000 });
			else toast.success(aviso.texto, { duration: 15000 });
			setAccesoPortalOpen(false);
			queryClient.invalidateQueries({
				queryKey: orpc.getInversionistas.queryOptions({
					input: { id: inversionistaId, page: 1, perPage: 1 },
				}).queryKey,
			});
			// Para que el botón se ponga gris solo, sin recargar la pantalla.
			queryClient.invalidateQueries({
				queryKey: orpc.estadoAccesoPortal.queryOptions({
					input: { inversionistaId },
				}).queryKey,
			});
			// El backend deja constancia de QUIÉN autorizó mandar esa contraseña
			// (`action: "acceso_portal"`). Sin invalidar, esa fila no aparece hasta
			// recargar la pantalla — igual que hacen las demás acciones de acá.
			queryClient.invalidateQueries({
				queryKey: orpc.getInvestorActivityLog.queryOptions({
					input: { inversionistaId },
				}).queryKey,
				refetchType: "all",
			});
		},
		onError: (err: any) => {
			toast.error(err?.message ?? "Error al dar acceso al portal");
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
	// "¿Es empresa?" no tiene columna en cartera: se DERIVA de si la fila trae
	// el `dpi_rep_legal` de OTRA persona. `editRepLegalOriginal` guarda el valor con el que se abrió
	// el modal, para detectar que guardar le quitaría el representante a alguien
	// que sí lo tenía.
	const [editEsEmpresa, setEditEsEmpresa] = useState(false);
	const [editRepLegalOriginal, setEditRepLegalOriginal] = useState("");
	// El `dpi` con el que se abrió el modal. Va aparte de `editDpi` (que el
	// operador puede estar tecleando) porque la derivación y la advertencia
	// hablan de la fila TAL COMO ESTABA guardada.
	const [editDpiOriginal, setEditDpiOriginal] = useState("");
	const [confirmarQuitarRepOpen, setConfirmarQuitarRepOpen] = useState(false);
	const [editDpiRepLegal, setEditDpiRepLegal] = useState("");
	const [editMoneda, setEditMoneda] = useState("quetzales");
	const [editEmiteFactura, setEditEmiteFactura] = useState(false);
	const [editTipoReinversion, setEditTipoReinversion] = useState("sin_reinversion");
	const [editMontoReinversion, setEditMontoReinversion] = useState("");
	// Campo que cartera rechazó (dpi | email | nombre duplicado, o
	// dpi_rep_legal inexistente): lo manda el backend en err.data.campo para
	// marcar el input exacto, igual que en el modal de crear.
	const [campoConError, setCampoConError] = useState<{
		campo: string;
		mensaje: string;
	} | null>(null);
	// 🔴 NINGÚN DIÁLOGO SOBREVIVE A UN CAMBIO DE INVERSIONISTA.
	//
	// Esta ruta NO se re-monta al cambiar `$inversionistaId` —no está
	// re-keyed—, así que el estado de los modales viaja con quien navega. Un
	// modal de Radix tampoco bloquea el botón Atrás del navegador, que es el
	// reflejo normal para cancelar.
	//
	// El caso que lo obliga es "Dar acceso al portal": alguien lo abre en el
	// inversionista 7, lee y aprueba `ana@x.com`, le da Atrás, y el diálogo
	// sigue ABIERTO, repintado con los datos del 6 y con el botón vivo. Un clic
	// de memoria muscular manda la contraseña al inversionista equivocado, con
	// la revisión humana hecha sobre otro.
	//
	// Se cierran todos y no solo ese, porque todos escriben contra el id del
	// render de AHORA: la compra de cartera mueve dinero, "liquidar todo" cambia
	// el status, y Editar guarda los campos de una ficha sobre la otra. El
	// mismo bug, la misma línea.
	//
	// El efecto no LEE `investorIdNum`: reacciona a que CAMBIE, igual que el
	// drawer de `components/header.tsx` con la ruta. Quitarlo de la lista lo
	// dejaría sin disparador y devolvería el defecto.
	// biome-ignore lint/correctness/useExhaustiveDependencies: es el disparador, no una lectura
	useEffect(() => {
		setAccesoPortalOpen(false);
		setEditOpen(false);
		setConfirmarQuitarRepOpen(false);
		setLiquidarTodoOpen(false);
		setCompraCarteraOpen(false);
		// Lo mismo que hace el `onOpenChange` de ese modal al cerrarse: cerrarlo
		// por acá sin esto dejaría el monto tecleado para la ficha siguiente.
		setCompraCarteraMonto("");
		setCompraCarteraSpreadOverrideId(null);
	}, [investorIdNum]);

	const errorEn = (campo: string) => campoConError?.campo === campo;
	// Al corregir el dato que falló, la marca deja de aplicar.
	const limpiarError = (campo: string) => {
		if (errorEn(campo)) setCampoConError(null);
	};
	const MensajeCampo = ({ campo }: { campo: string }) =>
		errorEn(campo) ? (
			<p className="text-destructive text-xs">{campoConError?.mensaje}</p>
		) : null;

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
		const repLegalGuardado = inv.dpiRepLegal ?? inv.dpi_rep_legal ?? "";
		setEditDpiRepLegal(repLegalGuardado);
		setEditRepLegalOriginal(repLegalGuardado);
		setEditDpiOriginal(inv.dpi ? String(inv.dpi) : "");
		// El `dpi` de la fila entra en la derivación: un representante que es la
		// PROPIA fila (dpi 4036613 / dpi_rep_legal '04036613') no la vuelve empresa.
		setEditEsEmpresa(esEmpresaInicial(repLegalGuardado, inv.dpi));
		setConfirmarQuitarRepOpen(false);
		setEditMoneda(inv.moneda ?? "quetzales");
		setEditEmiteFactura(inv.emiteFactura ?? inv.emite_factura ?? false);
		setEditTipoReinversion(inv.tipoReinversion ?? inv.tipo_reinversion ?? "sin_reinversion");
		setEditMontoReinversion(inv.monto_reinversion ? String(inv.monto_reinversion) : "");
		setCampoConError(null);
		setEditOpen(true);
	};

	const editMutation = useMutation({
		...orpc.editarInversionista.mutationOptions(),
		// Mismo motivo que en `darAccesoPortalMutation`: el id sale de lo que se
		// mandó, no del render que cierra el `onSuccess`, que puede ser ya el de
		// otro inversionista si se navegó mientras la respuesta venía en camino.
		onSuccess: (_data: any, variables: any) => {
			const inversionistaId: number = variables.inversionistaId;
			toast.success("Inversionista actualizado correctamente");
			setConfirmarQuitarRepOpen(false);
			setEditOpen(false);
			queryClient.invalidateQueries({
				queryKey: orpc.getInversionistas.queryOptions({
					input: { id: inversionistaId, page: 1, perPage: 1 },
				}).queryKey,
				refetchType: "all",
			});
			queryClient.invalidateQueries({
				queryKey: orpc.getInvestorActivityLog.queryOptions({
					input: { inversionistaId },
				}).queryKey,
				refetchType: "all",
			});
			// El estado de la cuenta del portal se calcula con el correo, el DPI y
			// el DPI del representante legal de ESTA fila — los tres se editan
			// acá. Y editar el correo es justo el arreglo que el diálogo de
			// "Dar acceso al portal" recomienda para dos de sus advertencias: sin
			// esto, quien lo corrige reabre el diálogo y ve la MISMA advertencia
			// vieja. `refetchType: "all"` como las dos invalidaciones de arriba:
			// esta consulta está montada mientras la pantalla está abierta, así
			// que "active" alcanzaría, pero con el `staleTime` de 5 minutos que
			// ahora tiene, una copia que quedara inactiva se serviría vencida.
			queryClient.invalidateQueries({
				queryKey: orpc.estadoAccesoPortal.queryOptions({
					input: { inversionistaId },
				}).queryKey,
				refetchType: "all",
			});
		},
		onError: (err: any) => {
			// Si el fallo vino desde la confirmación de borrado, se devuelve al
			// operador al formulario en vez de dejarlo sin modal.
			setConfirmarQuitarRepOpen(false);
			setEditOpen(true);
			const texto = err?.message ?? "Error al actualizar inversionista";
			// El id del input va en kebab-case y el campo del backend en
			// snake_case (dpi_rep_legal → edit-dpi-rep-legal).
			const campo: string | undefined = err?.data?.campo;
			if (campo) {
				setCampoConError({ campo, mensaje: texto });
				document.getElementById(`edit-${campo.replace(/_/g, "-")}`)?.focus();
			} else {
				setCampoConError(null);
			}
			toast.error(texto);
		},
	});

	const guardarEdicion = () => {
		editMutation.mutate({
			inversionistaId: investorIdNum,
			nombre: editNombre.trim(),
			dpi: editDpi.trim() || undefined,
			email: editEmail.trim() || undefined,
			banco: editBanco ? Number(editBanco) : null,
			tipoCuenta: editTipoCuenta || undefined,
			numeroCuenta: editNumeroCuenta.trim() || undefined,
			// Qué se manda del representante lo decide entero
			// `valorRepLegalAlGuardar`: la llave presente con cadena vacía BORRA, y
			// solo se borra lo que se desmarcó a propósito. Al que es su propio
			// representante (`dpi = 4036613`, `dpi_rep_legal = '04036613'`) no se le
			// toca... salvo que se le esté editando el DPI, y entonces el valor
			// guardado le sigue: dejarlo con el viejo convertía la fila en una
			// empresa representada por su identidad anterior.
			dpiRepLegal: valorRepLegalAlGuardar({
				esEmpresa: editEsEmpresa,
				valor: editDpiRepLegal,
				repLegalOriginal: editRepLegalOriginal,
				dpiOriginal: editDpiOriginal,
				dpiDelFormulario: editDpi,
			}),
			moneda: editMoneda as "quetzales" | "dolares",
			emiteFactura: editEmiteFactura,
			tipoReinversion: editTipoReinversion,
			montoReinversion: editMontoReinversion
				? Number(editMontoReinversion)
				: undefined,
		});
	};

	const cambiarStatusMutation = useMutation({
		...orpc.cambiarStatusInversionista.mutationOptions(),
		// Mismo motivo que en `darAccesoPortalMutation`: el id sale de lo que se
		// mandó, no del render que cierra el `onSuccess`, que puede ser ya el de
		// otro inversionista si se navegó mientras la respuesta venía en camino.
		onSuccess: (_data: any, variables: any) => {
			const inversionistaId: number = variables.inversionistaId;
			toast.success(
				"Inversionista marcado para devolución total. Se liquidará en la próxima corrida.",
			);
			setLiquidarTodoOpen(false);
			queryClient.invalidateQueries({
				queryKey: orpc.getInversionistas.queryOptions({
					input: { id: inversionistaId, page: 1, perPage: 1 },
				}).queryKey,
				refetchType: "all",
			});
			queryClient.invalidateQueries({
				queryKey: orpc.getInvestorActivityLog.queryOptions({
					input: { inversionistaId },
				}).queryKey,
				refetchType: "all",
			});
		},
		onError: (err: any) => {
			toast.error(err?.message ?? "Error al cambiar el status del inversionista");
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

	// 🔴 EL CORREO DEL DIÁLOGO NO PUEDE SALIR DE `investorsQuery`.
	//
	// `getInversionistas` se sirve de la caché EN PROCESO del servidor
	// (`cartera-back-client.ts`, `getInvestors()` pide con `useCache = true`,
	// TTL 5 minutos, `CARTERA_BACK_ENABLE_CACHE=true`) y NADIE la invalida
	// nunca: no hay un solo llamador de `invalidateCache`/`clearCache` en todo
	// el servidor. O sea que después de corregir el correo en Editar, la
	// invalidación de TanStack refetchea… y el servidor vuelve a contestar la
	// fila VIEJA hasta cinco minutos.
	//
	// Con el correo saliendo de ahí, el diálogo enseñaba el correo viejo, la
	// persona lo aprobaba, y cartera —que lee la tabla fresca al provisionar—
	// mandaba la contraseña al NUEVO. El único control humano de este botón
	// terminaba aprobando una dirección que no es la que recibe la contraseña.
	// Lo mismo con "¿es empresa?": recién marcada como empresa, el diálogo
	// seguía ofreciendo el flujo de persona.
	//
	// Así que el diálogo se pinta con DOS lecturas sin caché:
	//
	//  1. `estadoAccesoPortal` (abajo) decide empresa-vs-persona. Va sin caché
	//     de punta a punta —`consultarAccesoPortal` deja `useCache` en su
	//     default y el controlador de cartera hace su propio `select` sobre
	//     `inversionistas`— y `omitida/es_empresa` es exactamente la decisión
	//     que va a tomar el camino que escribe.
	//  2. `identidadInversionista` (abajo) trae el NOMBRE y el CORREO frescos.
	//     También va sin caché por las dos puntas: el cliente la pide con
	//     `useCache = false` a propósito, y acá se pide con `staleTime: 0` y
	//     `gcTime: 0`, igual que ya lo hace la detección de empresas del alta
	//     (`liquidaciones.index.tsx`), que es el gemelo de este mismo defecto.
	//
	// Lo de la fila cacheada se usa SOLO como pista de búsqueda (el DPI y el
	// correo con los que preguntar), nunca como dato que se enseñe: si la pista
	// está vieja, la respuesta no casa por id y el diálogo se declara incapaz
	// de confirmar en vez de enseñar algo falso. Falla cerrado.
	const accesoPortalPistaDpi = String((investor as any)?.dpi ?? "").trim();
	const accesoPortalPistaEmail = ((investor?.email ?? "") as string).trim();

	// ¿Ya tiene cuenta en el portal? Solo lectura: sirve para poner el botón en
	// gris sin tener que apretarlo para averiguarlo.
	//
	// 🔴 Este dato solo puede DESHABILITAR cuando AFIRMA que la cuenta está sana.
	// Mientras carga, si la consulta falla o si no vuelve nada, el botón queda
	// HABILITADO. La operación de abajo es idempotente —sobre una cuenta que ya
	// existe cartera contesta "ya tenía" y NO le reenvía ninguna contraseña a
	// nadie—, así que el peor caso de un falso negativo es un clic inútil,
	// mientras que apagar el botón por un error de red deja a alguien sin poder
	// trabajar y sin entender por qué. Nunca deshabilitar por ausencia de dato.
	const estadoAccesoPortalQuery = useQuery({
		...orpc.estadoAccesoPortal.queryOptions({
			input: { inversionistaId: investorIdNum },
		}),
		// 🔴 El rol es parte de la condición, no un detalle de presentación.
		// `estadoAccesoPortal` es `investmentProcedure`: a quien no pasa
		// `canAccessInvestments` el servidor le contesta FORBIDDEN, siempre. Y el
		// `QueryCache` global (`utils/orpc.ts`) pinta un `toast.error` ante
		// CUALQUIER consulta que falle, sin mirar cuál. Sin esta condición un
		// vendedor, un cobrador, un abogado o un contador abrían esta ficha —que
		// para ellos funciona— y se comían un rojo en cada carga. No se dispara lo
		// que ya se sabe que va a ser rechazado.
		enabled:
			puedeAccesoPortal && Number.isInteger(investorIdNum) && investorIdNum > 0,
		// Igual que las dos consultas hermanas de este archivo
		// (`resolverModalidadFacturacionSpread`,
		// `listModalidadFacturacionSpreadByModalidad`). Sin esto —el QueryClient
		// no define `defaultOptions`, así que rige el `staleTime: 0` de v5— la
		// cadena entera (CRM → cartera → auth-google) se vuelve a recorrer en
		// cada montaje, cada reconexión y cada vez que se vuelve a la pestaña.
		// El único momento en que este valor cambia es el botón de abajo, y ese
		// ya invalida esta misma llave a mano.
		staleTime: 5 * 60 * 1000,
		// 🔴 SIN REINTENTOS. Esta consulta corre en CADA carga de esta pantalla
		// y el modo de fallo no es un tropiezo de red: con `CARTERA_USER` mal
		// configurado —un estado real y documentado
		// (`cartera-back/DEPLOYMENT.md`)— cartera contesta 403 SIEMPRE. Con los
		// 3 reintentos por defecto de TanStack eso son 4 llamadas por vista, y
		// cada una hace que el cliente del servidor tire y renueve el token de
		// servicio que comparte TODO el CRM. Reintentar un permiso que falta no
		// lo consigue: solo multiplica el daño.
		//
		// Y que quede dicho: un fallo acá NO es silencioso. El `QueryCache` del
		// cliente (`utils/orpc.ts`) pinta un `toast.error("Error: …")` por cada
		// consulta que falla, sin mirar la query, así que ese 403 de cartera sale
		// en rojo en cada carga que haga alguien de inversiones —los demás ya no
		// la disparan, ver el `enabled` de arriba—. No se puede callar desde acá
		// —el manejador es global— y prometer lo contrario en este comentario
		// sería la misma mentira que hizo falta venir a arreglar. Lo que sí queda
		// acotado es el número de toasts: uno por carga, no cuatro.
		retry: false,
	});
	const estadoAccesoPortal = estadoAccesoPortalQuery.data as
		| {
				tieneCuentaSana?: boolean;
				estado?: string;
				// Sin `usuarioEmail`: `estadoAccesoPortal` dejó de devolverlo a
				// propósito —corre en cada carga, con un id que elige quien llama,
				// así que devolver el correo convertía un barrido de ids en una
				// cosecha de buzones—. El camino de ESCRITURA sí lo trae y ahí se
				// sigue usando: `lib/acceso-portal.ts` y la bitácora del historial.
				advertencias?: string[] | null;
				motivo?: string | null;
		  }
		| undefined;
	const yaTieneAccesoPortal = estadoAccesoPortal?.tieneCuentaSana === true;

	// ─── Lo que el diálogo puede AFIRMAR ───────────────────────────────────
	//
	// "¿Es empresa?" sale de acá y no de `dpi_rep_legal` de la fila cacheada:
	// es la MISMA decisión que va a tomar el camino que escribe
	// (`decidirProvisionamiento` → `omitida/es_empresa`), leída sin caché.
	const accesoPortalEsEmpresa =
		estadoAccesoPortal?.estado === "omitida" &&
		estadoAccesoPortal?.motivo === "es_empresa";
	// ¿La consulta sin caché contestó? Si no, esta pantalla no sabe si es
	// empresa ni a dónde iría la contraseña, y el diálogo lo dice en vez de
	// elegir una de las dos ramas a ciegas.
	const accesoPortalBaseFresca = estadoAccesoPortalQuery.isSuccess;
	// Que la fila NO tiene correo también es una respuesta fresca, y es mejor
	// que la genérica: cartera acaba de leer la tabla y contestó
	// `omitida/sin_correo`. Sin esto, una fila sin correo caía en "no se pudo
	// confirmar" —que manda a reintentar— en vez de en "agregáselo en Editar",
	// que es el arreglo de verdad.
	const accesoPortalSinCorreoFresco =
		estadoAccesoPortal?.estado === "omitida" &&
		estadoAccesoPortal?.motivo === "sin_correo";

	// El NOMBRE y el CORREO frescos, para el diálogo. Solo se pide con el
	// diálogo abierto: es una consulta que sale hasta cartera y la dispara un
	// humano que ya decidió mirar, no cada carga de la pantalla.
	//
	// Se pregunta con el DPI Y el correo que tenga la fila cacheada porque el
	// endpoint busca por cualquiera de los dos (`buscarIdentidad`, un `OR`):
	// son pistas, y con dos hay más chance de acertar la fila aunque una esté
	// vieja.
	const accesoPortalPuedePreguntar =
		!!accesoPortalPistaDpi || !!accesoPortalPistaEmail;
	const identidadFrescaQuery = useQuery({
		...orpc.identidadInversionista.queryOptions({
			input: {
				...(accesoPortalPistaDpi ? { dpi: accesoPortalPistaDpi } : {}),
				...(accesoPortalPistaEmail ? { email: accesoPortalPistaEmail } : {}),
			},
		}),
		enabled:
			accesoPortalOpen &&
			!accesoPortalEsEmpresa &&
			// Ya se sabe, sin caché, que no hay correo: no hay nada que confirmar.
			!accesoPortalSinCorreoFresco &&
			accesoPortalPuedePreguntar,
		// El gemelo exacto de la detección de empresas del alta: un dato de
		// identidad no envejece bien, y este en particular es el que una persona
		// está por aprobar. Ni un segundo de caché.
		staleTime: 0,
		gcTime: 0,
		// Mismo criterio que la consulta de arriba: si no se pudo confirmar, el
		// diálogo lo dice y bloquea. Reintentar tres veces solo retrasa ese
		// aviso y multiplica las llamadas.
		retry: false,
	});
	const identidadFresca = identidadFrescaQuery.data as
		| {
				inversionista_id?: number;
				nombre?: string;
				email?: string | null;
		  }
		| null
		| undefined;
	// 🔴 LA COMPROBACIÓN QUE HACE QUE ESTO SEA SEGURO.
	//
	// `buscarIdentidad` devuelve siempre a la PERSONA: si la pista casa con una
	// sociedad, salta a su representante; y un correo compartido por dos filas
	// (pasa en producción) lo desempata por orden. O sea que la fila que vuelve
	// puede no ser esta. Se acepta ÚNICAMENTE cuando el id coincide, y entonces
	// la garantía es total: sea cual sea el camino por el que se llegó, lo que
	// volvió es la fila de ESTE inversionista leída recién de la tabla, así que
	// su `email` es el correo al que cartera va a mandar la contraseña.
	//
	// Cuando no coincide —pista vieja, fila sin DPI, correo compartido, cartera
	// caída— no se enseña ningún correo. Falla cerrado: un diálogo que dice "no
	// pudimos confirmarlo" no engaña a nadie; uno que enseña el correo
	// equivocado, sí.
	const destinoFresco =
		identidadFresca && identidadFresca.inversionista_id === investorIdNum
			? identidadFresca
			: null;
	const accesoPortalEmail = (destinoFresco?.email ?? "").trim();
	const accesoPortalNombre = destinoFresco?.nombre ?? null;
	/**
	 * En qué situación está el diálogo, para no confundir "todavía no sé" con
	 * "no tiene correo". Son tres textos distintos y tres desenlaces distintos.
	 */
	const accesoPortalDestino:
		| "cargando"
		| "confirmado"
		| "sin_correo"
		| "no_confirmado" = accesoPortalSinCorreoFresco
		? "sin_correo"
		: !accesoPortalPuedePreguntar
			? // Sin DPI y sin correo en la fila no hay con qué preguntar. Una
				// consulta deshabilitada se queda en `isPending` para siempre, así
				// que sin esta rama el diálogo giraría un spinner eterno.
				"no_confirmado"
			: identidadFrescaQuery.isPending || identidadFrescaQuery.isFetching
				? "cargando"
				: destinoFresco
					? accesoPortalEmail
						? "confirmado"
						: "sin_correo"
					: "no_confirmado";

	// ¿Se puede abrir el diálogo? Hace falta la fila cacheada (de ahí salen las
	// pistas de búsqueda) y que la consulta sin caché haya contestado algo,
	// bien o mal: con ella pendiente el diálogo no sabría ni qué rama pintar.
	// La guarda va en el `onClick` y no en `disabled` por lo que explica el
	// botón: lo que apaga ese botón significa "ya tiene cuenta".
	const accesoPortalDatosListos =
		!!investor &&
		(estadoAccesoPortalQuery.isSuccess || estadoAccesoPortalQuery.isError);

	// Cuenta que EXISTE pero no sirve. El booleano ya vino en `false`, así que
	// el botón sigue vivo; lo que falta es decir por qué conviene apretarlo.
	// Una empresa (`estado: "omitida"`) NO entra acá: su cuenta es la del
	// representante legal y eso no es una cuenta rota.
	const avisosCuentaPortalRota = useMemo(() => {
		if (yaTieneAccesoPortal) return [] as string[];
		const advertencias = estadoAccesoPortal?.advertencias ?? [];
		const entradas = advertencias
			// `valorDeTabla` y no `TABLA[a]`: estas advertencias vienen del
			// servidor y una clave del prototipo (`constructor`, `toString`…)
			// devuelve algo truthy que pasa el filtro de abajo y se pinta como
			// `"undefined undefined"` en el aviso que lee quien va a mandar una
			// contraseña.
			.map((a) => valorDeTabla(MOTIVOS_CUENTA_PORTAL_ROTA, a))
			.filter((t): t is (typeof MOTIVOS_CUENTA_PORTAL_ROTA)[string] => !!t);
		const base =
			entradas.length > 0
				? entradas
				: // "Ya tenía" sin advertencia traducible sigue siendo una cuenta que
					// el servidor no pudo declarar sana: se dice, sin enseñar el código.
					estadoAccesoPortal?.estado === "ya_tenia"
					? [MOTIVO_CUENTA_PORTAL_ROTA_GENERICO]
					: [];
		// Con la cuenta anclada solo por el correo, NINGUNA de estas se corrige
		// continuando: la escritura corta antes de tocar el rol.
		const ancladaSoloPorCorreo = advertencias.includes(ANCLADA_SOLO_POR_CORREO);
		return Array.from(
			new Set(
				base.map(
					(e) =>
						`${e.problema} ${
							ancladaSoloPorCorreo
								? SI_CONTINUAR_ANCLADA_SOLO_POR_CORREO
								: e.siContinuar
						}`,
				),
			),
		);
	}, [yaTieneAccesoPortal, estadoAccesoPortal]);

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
								<div className="flex flex-wrap items-center gap-2">
									<h1 className="font-bold text-lg leading-tight">
										{investor?.nombre ?? "Inversionista"}
									</h1>
									<InvestorStatusBadge status={investor?.status} />
								</div>
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
							{investor?.status === "activo" && (
								<Button
									variant="outline"
									size="sm"
									className="gap-2 border-orange-500/60 text-orange-700 hover:bg-orange-500/10 hover:text-orange-800 dark:text-orange-300 dark:hover:text-orange-200"
									onClick={() => setLiquidarTodoOpen(true)}
								>
									<Banknote className="h-4 w-4" />
									Liquidar todo el monto aportado
								</Button>
							)}
							<Button
								variant="outline"
								size="sm"
								className="gap-2"
								onClick={() => {
									// Mismo hermano que el de "Dar acceso al portal": sin la
									// fila cargada, el `?? "sin_reinversion"` de abajo no es un
									// valor por omisión, es un dato que todavía no llegó, y el
									// modal se abriría con la reinversión equivocada
									// preseleccionada. El "Editar" vecino ya se guarda así.
									if (!investor) return;
									const inv =
										(investor?.tipoReinversion as string | undefined) ??
										(investor as any)?.tipo_reinversion ??
										"sin_reinversion";
									const allowed = [
										"sin_reinversion",
										"reinversion_capital",
										"reinversion_total",
									];
									const next = allowed.includes(inv)
										? (inv as
												| "sin_reinversion"
												| "reinversion_capital"
												| "reinversion_total")
										: "sin_reinversion";
									console.log("[CompraCartera] abrir modal", {
										investorTipoReinversion: investor?.tipoReinversion,
										investor_tipo_reinversion: (investor as any)
											?.tipo_reinversion,
										resolved: inv,
										preselected: next,
									});
									setCompraCarteraTipoReinversion(next);
									setCompraCarteraOpen(true);
								}}
							>
								<ShoppingCart className="h-4 w-4" />
								Compra de Cartera
							</Button>
							{/* Ni el botón ni su tooltip existen para quien no puede usarlos. La
								mutación de atrás (`darAccesoPortal`) es `investmentProcedure`, igual
								que la consulta de estado: a quien no pasa `canAccessInvestments` el
								servidor le contesta FORBIDDEN. Dejárselo a la vista no era solo un
								clic perdido — el diálogo le enseña un correo y le pide aprobarlo, o
								sea le hace creer que está por mandarle una contraseña a alguien.

								Mismo criterio con el que esta pantalla ya esconde el historial de
								actividad y el ojo de visibilidad, que cuelgan de
								`investmentManagerProcedure` y se piden con `isManager`. */}
							{/* Gris SOLO cuando el servidor afirma que la cuenta está sana.
								Cargando, con error o sin dato queda habilitado: apretar de más
								cuesta un clic ("ya tenía", sin reenviar contraseña), y apagarlo
								por un error de red deja a alguien trabado sin saber por qué.

								El porqué del gris NO puede vivir en el `title` del botón:
								`components/ui/button.tsx` trae `disabled:pointer-events-none`,
								así que el botón deshabilitado no recibe el mouse y el tooltip
								nativo nunca llega a dispararse. Quien escucha el mouse es el
								<span> que lo envuelve, que no está deshabilitado y ocupa el
								mismo recuadro.

								El hover no es el único camino: el texto del propio botón ya
								dice "Ya tiene acceso al portal", que es el motivo del gris, y
								el tooltip no agrega ningún dato que no esté ahí —el correo de
								la cuenta ya no viaja hasta esta pantalla—. Un botón
								deshabilitado no recibe foco, y Radix ignora a propósito
								el `pointerType: "touch"`, así que ni por teclado ni por toque
								se abre — de ahí que el motivo tenga que seguir estando en la
								etiqueta y no solo acá. */}
							{puedeAccesoPortal && (
								<Tooltip>
									<TooltipTrigger asChild>
										<span className="inline-flex">
											<Button
												variant="outline"
												size="sm"
												className="gap-2"
												// Guarda de carga, igual que el "Editar" vecino
												// (`if (investor) openEditModal(investor)`): hacen falta
												// la fila —de ahí salen las pistas con las que se
												// pregunta el correo fresco— y que la consulta sin caché
												// haya contestado algo. Con esa consulta todavía en el
												// aire, el diálogo no sabe ni si es empresa, y sus dos
												// ramas dicen cosas distintas sobre a dónde va una
												// contraseña.
												//
												// Que la consulta FALLE sí abre el diálogo: adentro dice
												// que no se pudo confirmar nada y no deja continuar. Es
												// mejor que un botón que no responde y no explica.
												//
												// La guarda va en el `onClick` y NO en `disabled`: lo
												// que apaga este botón significa "ya tiene cuenta", y
												// apagarlo por otra razón estaría afirmando eso sin que
												// sea cierto. Quien explica por qué todavía no abre es
												// la etiqueta, que dice "Cargando…".
												onClick={() => {
													if (accesoPortalDatosListos)
														setAccesoPortalOpen(true);
												}}
												disabled={yaTieneAccesoPortal}
											>
												<KeyRound className="h-4 w-4" />
												{yaTieneAccesoPortal
													? "Ya tiene acceso al portal"
													: accesoPortalDatosListos
														? "Dar acceso al portal"
														: "Cargando…"}
											</Button>
										</span>
									</TooltipTrigger>
									{/* El contenido se monta SIEMPRE, con texto para los tres
										estados del botón. Antes solo existía con
										`yaTieneAccesoPortal`, y con el botón habilitado el Root se
										abría igual al pasar el mouse: el Trigger ponía
										`aria-describedby` apuntando a un id que nunca se renderiza
										—`aria-valid-attr-value` lo marca, y un lector de pantalla
										que siguiera la referencia no encontraba nada—, y el ciclo
										de apertura y cierre corría en cada hover para no enseñar
										nada. Y así queda igual que el otro tooltip nuevo de este
										archivo, el del ojo de `InvestorDocumentsSection`, que
										también monta su contenido siempre. */}
									<TooltipContent side="bottom" className="max-w-xs">
										{yaTieneAccesoPortal
											? // Sin el correo: esta consulta ya no lo devuelve, y el motivo
												// del gris tampoco lo necesita.
												"Ya tiene cuenta en el portal. Por eso el botón está apagado."
											: !accesoPortalDatosListos
												? "Todavía se están cargando sus datos. En cuanto carguen vas a poder abrirle el acceso."
												: accesoPortalEsEmpresa
													? // Siendo empresa, desde esta fila no sale ninguna
														// contraseña: el diálogo lo dice con todas las letras y
														// cartera responde
														// `es_empresa_el_acceso_es_del_representante`.
														// Prometer acá el correo con la contraseña
														// contradiría lo que se lee dos clics después.
														"Es una empresa: al portal entra su representante legal. Al continuar, cartera te va a decir desde qué fila abrirle el acceso."
													: "Le crea su cuenta del portal y le manda su contraseña por correo. Antes de mandarla vas a poder revisar a qué correo va."}
									</TooltipContent>
								</Tooltip>
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
									{/* Mismo criterio que las demás tablas de este archivo: la
										clave la manda cartera y un objeto literal contesta a
										`constructor` o `toString` con algo truthy que se pinta en
										la insignia. */}
									{valorDeTabla(
										ETIQUETAS_REINVERSION,
										investor.tipoReinversion,
									) ?? "Reinversión"}
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
								onChange={(e) => {
									setEditNombre(e.target.value);
									limpiarError("nombre");
								}}
								aria-invalid={errorEn("nombre")}
								className={
									errorEn("nombre") ? "border-destructive" : undefined
								}
							/>
							<MensajeCampo campo="nombre" />
						</div>

						<div className="grid grid-cols-2 gap-3">
							<div className="space-y-1.5">
								<Label htmlFor="edit-dpi">DPI</Label>
								<Input
									id="edit-dpi"
									value={editDpi}
									onChange={(e) => {
										setEditDpi(e.target.value);
										limpiarError("dpi");
									}}
									aria-invalid={errorEn("dpi")}
									className={
										errorEn("dpi") ? "border-destructive" : undefined
									}
								/>
								<MensajeCampo campo="dpi" />
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="edit-email">Email</Label>
								<Input
									id="edit-email"
									type="email"
									value={editEmail}
									onChange={(e) => {
										setEditEmail(e.target.value);
										limpiarError("email");
									}}
									aria-invalid={errorEn("email")}
									className={
										errorEn("email") ? "border-destructive" : undefined
									}
								/>
								<MensajeCampo campo="email" />
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

						<div className="space-y-3">
							<div className="flex items-center gap-2">
								<Checkbox
									id="edit-es-empresa"
									checked={editEsEmpresa}
									onCheckedChange={(v) => {
										setEditEsEmpresa(v === true);
										// El "obligatorio" cuelga del interruptor: al
										// desmarcar, la marca del campo deja de aplicar.
										limpiarError("dpi_rep_legal");
									}}
								/>
								<Label htmlFor="edit-es-empresa">¿Es empresa?</Label>
							</div>
							{editEsEmpresa && (
								<div className="space-y-1.5">
									<Label htmlFor="edit-dpi-rep-legal">
										DPI del representante legal
									</Label>
									<Input
										id="edit-dpi-rep-legal"
										value={editDpiRepLegal}
										onChange={(e) => {
											setEditDpiRepLegal(e.target.value.replace(/\D/g, ""));
											limpiarError("dpi_rep_legal");
										}}
										placeholder="DPI de quien representa a la empresa"
										maxLength={20}
										inputMode="numeric"
										aria-invalid={errorEn("dpi_rep_legal")}
										className={
											errorEn("dpi_rep_legal") ? "border-destructive" : undefined
										}
									/>
									<MensajeCampo campo="dpi_rep_legal" />
								</div>
							)}
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
								// Con "¿Es empresa?" marcado el DPI del representante es
								// obligatorio: se marca el input con el mismo mecanismo que
								// usan los rechazos de cartera.
								const errorRep = errorRepLegal(editEsEmpresa, editDpiRepLegal);
								if (errorRep) {
									setCampoConError({
										campo: "dpi_rep_legal",
										mensaje: errorRep,
									});
									document.getElementById("edit-dpi-rep-legal")?.focus();
									return;
								}
								// Desmarcar el interruptor en alguien que YA tenía
								// representante borra su acceso al portal, y esa persona no
								// está frente a la pantalla para enterarse: se confirma antes.
								if (
									requiereConfirmacionBorrado(
										editRepLegalOriginal,
										editEsEmpresa,
										editDpiOriginal,
									)
								) {
									// Un modal a la vez: se cierra el de edición (su estado
									// vive fuera, así que no se pierde nada) y al cancelar
									// la confirmación se vuelve a abrir tal cual estaba.
									setEditOpen(false);
									setConfirmarQuitarRepOpen(true);
									return;
								}
								guardarEdicion();
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

			{/* Modal confirmación — quitar el representante legal */}
			<Dialog
				open={confirmarQuitarRepOpen}
				onOpenChange={(open) => {
					if (editMutation.isPending) return;
					setConfirmarQuitarRepOpen(open);
					// Cerrar la confirmación (Esc, clic afuera, Cancelar) devuelve al
					// formulario de edición con todo lo que ya se había tecleado.
					if (!open) setEditOpen(true);
				}}
			>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<div className="flex items-center gap-3">
							<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-orange-500/15 text-orange-600 dark:text-orange-300">
								<AlertCircle className="h-5 w-5" />
							</div>
							<DialogTitle>Quitar el representante legal</DialogTitle>
						</div>
						<DialogDescription className="pt-2">
							Este inversionista tiene registrado el DPI{" "}
							<span className="font-semibold">{editRepLegalOriginal}</span> como
							representante legal. Al guardar sin “¿Es empresa?” ese dato se
							borra y{" "}
							<span className="font-semibold text-orange-700 dark:text-orange-300">
								esa persona pierde el acceso al portal
							</span>
							.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter className="gap-2 sm:justify-between">
						<Button
							variant="outline"
							onClick={() => {
								setConfirmarQuitarRepOpen(false);
								setEditOpen(true);
							}}
							disabled={editMutation.isPending}
						>
							Cancelar
						</Button>
						<Button
							variant="destructive"
							onClick={() => guardarEdicion()}
							disabled={editMutation.isPending}
						>
							{editMutation.isPending ? (
								<>
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									Guardando...
								</>
							) : (
								"Sí, quitar el representante"
							)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Modal confirmación — devolución total del monto aportado */}
			<Dialog
				open={liquidarTodoOpen}
				onOpenChange={(open) => {
					if (cambiarStatusMutation.isPending) return;
					setLiquidarTodoOpen(open);
				}}
			>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<div className="flex items-center gap-3">
							<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-orange-500/15 text-orange-600 dark:text-orange-300">
								<AlertCircle className="h-5 w-5" />
							</div>
							<DialogTitle>Liquidar todo el monto aportado</DialogTitle>
						</div>
						<DialogDescription className="pt-2">
							Estás por marcar a{" "}
							<span className="font-semibold">
								{investor?.nombre ?? "este inversionista"}
							</span>{" "}
							como{" "}
							<span className="font-semibold text-orange-700 dark:text-orange-300">
								pendiente de devolución
							</span>
							{". "}
							En la próxima corrida de liquidación se le entregará la
							totalidad de su monto aportado.
						</DialogDescription>
					</DialogHeader>

					<div className="rounded-md border border-orange-300/60 bg-orange-50 p-3 text-sm text-orange-900 dark:border-orange-800/60 dark:bg-orange-950/40 dark:text-orange-200">
						<p className="font-semibold">Esta acción no se puede revertir.</p>
						<p className="mt-1 text-xs">
							Una vez confirmada, el inversionista quedará bloqueado para
							nuevas operaciones hasta completarse la devolución.
						</p>
					</div>

					<DialogFooter className="gap-2 sm:gap-2">
						<Button
							variant="outline"
							onClick={() => setLiquidarTodoOpen(false)}
							disabled={cambiarStatusMutation.isPending}
						>
							Cancelar
						</Button>
						<Button
							className="gap-2 bg-orange-600 text-white hover:bg-orange-700"
							onClick={() =>
								cambiarStatusMutation.mutate({
									inversionistaId: investorIdNum,
									status: "pendiente_devolucion",
								})
							}
							disabled={cambiarStatusMutation.isPending}
						>
							{cambiarStatusMutation.isPending ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : (
								<Banknote className="h-4 w-4" />
							)}
							Sí, marcar para devolución total
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Confirmación de acceso al portal.
				El correo va GRANDE y arriba: es el único dato que hay que revisar
				antes de que salga una contraseña, y quien confirma responde por él.
				Salvo cuando es empresa: ahí el correo de la fila NO es el destino de
				nada, y enseñarlo con esa promesa apuntaba el control humano a la
				dirección equivocada. */}
			{/* El rol vuelve a preguntarse acá y no solo en el botón: este diálogo
				es el que enseña un correo y pide aprobarlo, y hoy la única forma de
				abrirlo es ese botón. Repetir la condición es lo que hace que siga
				siendo cierto si mañana aparece otro camino —un atajo de teclado, un
				enlace— que ponga `accesoPortalOpen` en true sin pasar por él. */}
			<Dialog
				open={puedeAccesoPortal && accesoPortalOpen}
				onOpenChange={(open) => {
					if (!darAccesoPortalMutation.isPending) setAccesoPortalOpen(open);
				}}
			>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<KeyRound className="h-5 w-5" />
							Dar acceso al portal
						</DialogTitle>
						<DialogDescription className="pt-2">
							{!accesoPortalBaseFresca ? (
								// Sin la consulta sin caché no se sabe ni si es empresa. Las
								// dos ramas de abajo AFIRMAN cosas distintas sobre a dónde va
								// una contraseña: elegir una a ciegas es justo lo que no se
								// puede hacer.
								<>
									No se pudo consultar el estado de esta persona en el portal,
									así que esta pantalla no puede decir a dónde iría su
									contraseña.
								</>
							) : accesoPortalEsEmpresa ? (
								<>
									<span className="font-semibold">
										{investor?.nombre ?? "Este inversionista"}
									</span>{" "}
									está capturado como empresa, y al Portal del Inversionista
									entra con su representante legal.
								</>
							) : (
								<>
									Se le va a crear la cuenta del Portal del Inversionista a{" "}
									{/* El nombre sale de la MISMA lectura sin caché que el
										correo: es contra el nombre que se juzga si el correo
										cuadra, así que un nombre viejo al lado de un correo
										fresco rompe la comparación que hace este diálogo. */}
									<span className="font-semibold">
										{accesoPortalNombre ?? "este inversionista"}
									</span>{" "}
									y se le va a mandar su contraseña a este correo:
								</>
							)}
						</DialogDescription>
					</DialogHeader>

					{/* EL ORDEN NO ES COSMÉTICO.
						Antes el correo de la SOCIEDAD iba primero, grande y presentado como
						"a este correo se le manda su contraseña", y que es empresa se decía
						dos párrafos más abajo. Ese vistazo humano al correo es el único
						control que tiene este botón, y apuntarlo a una dirección que cartera
						nunca va a usar —la cuenta es del representante legal— lo anulaba:
						quien aprueba termina aprobando el correo equivocado.

						Siendo empresa, el correo de la sociedad NO se enseña: no hay ningún
						correo que aprobar acá, porque desde esta fila no sale ninguna
						contraseña (`portalProvisioning.ts` devuelve
						`es_empresa_el_acceso_es_del_representante` en cuanto el llamador es
						este botón). */}
					{!accesoPortalBaseFresca ? (
						// Sin la consulta sin caché no se sabe ni si es empresa, así que no
						// se pinta ninguna de las dos ramas: las dos AFIRMAN cosas distintas
						// sobre a dónde va una contraseña.
						<div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/40">
							<p className="font-bold text-amber-900 text-base dark:text-amber-100">
								No se pudo confirmar nada de esta persona.
							</p>
							<p className="pt-1 text-amber-900 text-sm dark:text-amber-100">
								Volvé a cargar la pantalla. Si se repite, avisa a sistemas: sin
								esa consulta no se puede saber a qué correo caería su
								contraseña, y a ciegas no se manda ninguna.
							</p>
						</div>
					) : accesoPortalEsEmpresa ? (
						<div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/40">
							<p className="font-bold text-amber-900 text-base dark:text-amber-100">
								Desde esta fila no se abre ninguna cuenta ni sale ninguna
								contraseña.
							</p>
							<p className="pt-1 text-amber-900 text-sm dark:text-amber-100">
								El acceso se abre desde la fila del representante legal, que es
								donde vas a poder revisar SU correo antes de que le salga la
								contraseña. Al continuar, cartera te va a decir a qué fila ir —
								no hace falta capturarle un correo propio a la empresa.
							</p>
						</div>
					) : accesoPortalDestino === "cargando" ? (
						// El correo todavía no está confirmado. Se dice que se está
						// consultando en vez de enseñar el hueco: "— sin correo capturado —"
						// sobre alguien que SÍ tiene manda a quien lee a buscar en Editar
						// algo que ya está ahí.
						<div className="flex items-center gap-2 rounded-lg border-2 border-sky-300 bg-sky-50 p-4 text-sky-900 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-100">
							<Loader2 className="h-4 w-4 animate-spin" />
							<span className="text-sm">
								Consultando a qué correo iría su contraseña…
							</span>
						</div>
					) : accesoPortalDestino === "no_confirmado" ? (
						// No se pudo confirmar CONTRA LA TABLA FRESCA a qué correo va la
						// contraseña. El de la fila cacheada existe y es lo que se enseñaba
						// antes, pero puede tener hasta cinco minutos de atraso: aprobarlo
						// es aprobar una dirección que puede no ser la que recibe. Se calla
						// y se bloquea.
						<div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/40">
							<p className="font-bold text-amber-900 text-base dark:text-amber-100">
								No se pudo confirmar a qué correo iría su contraseña.
							</p>
							<p className="pt-1 text-amber-900 text-sm dark:text-amber-100">
								Por eso no se enseña ninguno: el que tiene cargado esta pantalla
								puede estar viejo, y la contraseña sale al que tenga cartera en
								ese momento. Cerrá y volvé a abrir; si se repite, avisa a
								sistemas.
							</p>
						</div>
					) : (
						<>
							<div className="rounded-lg border-2 border-sky-300 bg-sky-50 p-4 dark:border-sky-700 dark:bg-sky-950/40">
								<p className="break-all font-bold text-base text-sky-900 dark:text-sky-100">
									{accesoPortalEmail || "— sin correo capturado —"}
								</p>
							</div>

							<p className="text-muted-foreground text-sm">
								Confirmá que ese correo es de esta persona antes de continuar.
								Quien reciba ese mensaje va a poder entrar a ver sus
								liquidaciones, sus documentos y sus datos bancarios.
							</p>

							{!accesoPortalEmail && (
								<p className="font-bold text-red-700 text-sm dark:text-red-400">
									Sin correo capturado no se le puede abrir la cuenta.
									Agregáselo primero desde Editar.
								</p>
							)}
						</>
					)}
					{/* La cuenta EXISTE pero no sirve. Va acá y no en el botón: el botón
						queda habilitado porque apretarlo es lo que puede corregirlo, y sin
						este párrafo nadie sabría que hay algo que corregir. */}
					{avisosCuentaPortalRota.map((aviso) => (
						<p
							key={aviso}
							className="font-bold text-amber-700 text-sm dark:text-amber-400"
						>
							{aviso}
						</p>
					))}

					<DialogFooter className="gap-2 sm:gap-2">
						<Button
							variant="outline"
							onClick={() => setAccesoPortalOpen(false)}
							disabled={darAccesoPortalMutation.isPending}
						>
							Cancelar
						</Button>
						<Button
							className="gap-2 bg-sky-600 text-white hover:bg-sky-700"
							// 🔴 SE MANDA EL CORREO QUE ESTE DIÁLOGO ENSEÑÓ, NO SOLO EL ID.
							// Con el id solo, cartera volvía a LEER la fila para saber a
							// dónde mandar la contraseña: lo aprobado y lo usado eran dos
							// lecturas distintas de una tabla que se puede reescribir en el
							// medio, y quien la reescribe (`editarInversionista`) no es
							// quien aprueba (este botón). Mandando el correo, cartera lo
							// compara contra la fila y, si cambió, corta sin provisionar
							// (`fallo/correo_aprobado_no_coincide`).
							//
							// `accesoPortalEmail` y NO una relectura acá: es la MISMA
							// expresión que pinta el correo grande de arriba, así que este
							// `onClick` cierra sobre el valor del render que la persona
							// tiene delante. Releerlo al apretar —de la fila cacheada, o
							// pidiéndolo de nuevo— reabriría exactamente la ventana que
							// esto cierra.
							onClick={() => {
								// EMPRESA: la llave va AUSENTE, que es el único camino sin
								// aprobación que el servidor acepta. Y es correcto que no
								// haya nada que aprobar: desde esta fila no sale ninguna
								// contraseña —cartera contesta a qué fila ir— y por eso el
								// diálogo no enseñó ningún correo. Mandar el de la sociedad
								// sería aprobar una dirección que nadie miró.
								if (accesoPortalEsEmpresa) {
									darAccesoPortalMutation.mutate({
										inversionistaId: investorIdNum,
									});
									return;
								}
								// Sin correo NO se manda la llave vacía: el servidor la
								// rechaza con 400 (`.trim().min(1)`) y ese rojo genérico no
								// explica nada, mientras que el diálogo ya dijo arriba, en
								// palabras, por qué no hay correo que aprobar. No debería
								// llegarse acá —el `disabled` de abajo exige
								// `accesoPortalDestino === "confirmado"`, que solo es cierto
								// con `accesoPortalEmail` no vacío—; es el cierre del
								// camino, no el control.
								if (!accesoPortalEmail) return;
								darAccesoPortalMutation.mutate({
									inversionistaId: investorIdNum,
									correoAprobado: accesoPortalEmail,
								});
							}}
							// 🔴 SOLO SE PUEDE APROBAR LO QUE SE PUDO ENSEÑAR.
							// Sobre una empresa no sale ninguna contraseña —cartera
							// contesta a qué fila ir—, así que ahí no hay correo que
							// aprobar. En el camino de persona hace falta que el correo
							// venga CONFIRMADO contra la tabla fresca: mientras carga, si
							// no se pudo confirmar, o si la fila no tiene correo, el
							// diálogo ya dijo por qué y el botón no dispara nada.
							disabled={
								darAccesoPortalMutation.isPending ||
								(!accesoPortalEsEmpresa &&
									(!accesoPortalBaseFresca ||
										accesoPortalDestino !== "confirmado"))
							}
						>
							{darAccesoPortalMutation.isPending ? (
								<>
									<Loader2 className="h-4 w-4 animate-spin" />
									{accesoPortalEsEmpresa ? "Consultando…" : "Abriendo…"}
								</>
							) : (
								<>
									<KeyRound className="h-4 w-4" />
									{/* Sobre una empresa no se le manda el acceso a nadie: el
										botón dice lo que de verdad va a pasar. */}
									{accesoPortalEsEmpresa
										? "Ver a qué fila ir"
										: "Sí, mandarle su acceso"}
								</>
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
						setCompraCarteraSpreadOverrideId(null);
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

					<div className="space-y-4 py-2">
						<div className="space-y-1.5">
							<Label htmlFor="compra-modalidad">Modelo de Inversión</Label>
							<Select
								value={compraCarteraTipoReinversion}
								onValueChange={(v) =>
									setCompraCarteraTipoReinversion(
										v as
											| "sin_reinversion"
											| "reinversion_capital"
											| "reinversion_total",
									)
								}
							>
								<SelectTrigger id="compra-modalidad">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="sin_reinversion">Tradicional</SelectItem>
									<SelectItem value="reinversion_capital">
										Reinversión Capital
									</SelectItem>
									<SelectItem value="reinversion_total">
										Interés Compuesto
									</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="compra-monto">Monto aportado</Label>
							<CurrencyInput
								id="compra-monto"
								value={compraCarteraMonto}
								onChange={setCompraCarteraMonto}
							/>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="compra-modalidad-fact">
								Modalidad de Facturación
							</Label>
							<Select
								value={compraCarteraModalidad}
								onValueChange={(v) =>
									setCompraCarteraModalidad(v as ModalidadFacturacion)
								}
							>
								<SelectTrigger id="compra-modalidad-fact">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="p2p_directa">
										{MODALIDAD_FACTURACION_LABELS.p2p_directa}
									</SelectItem>
									<SelectItem value="factura_cube">
										{MODALIDAD_FACTURACION_LABELS.factura_cube}
									</SelectItem>
									<SelectItem value="factura_cube_pequeno">
										{MODALIDAD_FACTURACION_LABELS.factura_cube_pequeno}
									</SelectItem>
								</SelectContent>
							</Select>
						</div>
						{/* % Inversionista: pre-elegido por el sistema según monto +
						    modalidad, pero editable — el combobox solo permite elegir
						    entre los spreads válidos de la modalidad actual (los 8
						    brackets), sin importar si corresponde al monto. % CCI y
						    Tasa se derivan del spread elegido. */}
						{compraCarteraBracketFaltante ? (
							<p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
								El monto ingresado no cae en ningún rango del catálogo
								(mínimo Q1,000). Ajusta el monto.
							</p>
						) : (
							<>
								<div className="grid grid-cols-2 gap-3">
									<div className="space-y-1.5">
										<Label htmlFor="compra-pct-inv">% Inversiónista</Label>
										<Select
											value={compraCarteraSpreadRow?.id?.toString() ?? ""}
											onValueChange={(v) =>
												setCompraCarteraSpreadOverrideId(Number(v))
											}
										>
											<SelectTrigger id="compra-pct-inv">
												{/* Texto explícito: Radix solo registra el texto de
												    un SelectItem cuando el dropdown se abre al menos
												    una vez, así que un valor pre-seleccionado por
												    monto (sin que el usuario haya abierto el combo)
												    se vería en blanco si dependemos del lookup automático. */}
												<SelectValue placeholder="—">
													{compraCarteraSpreadRow
														? `${Number(compraCarteraSpreadRow.spread).toFixed(4)}%`
														: undefined}
												</SelectValue>
											</SelectTrigger>
											<SelectContent>
												{modalidadPorModalidadQuery.data?.map((row) => (
													<SelectItem key={row.id} value={row.id.toString()}>
														{Number(row.spread).toFixed(4)}%
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>
									<div className="space-y-1.5">
										<Label>% CCI</Label>
										<div className="rounded-md border bg-muted px-3 py-2 text-sm font-semibold tabular-nums">
											{compraCarteraPctCashInCalc !== undefined
												? `${compraCarteraPctCashInCalc.toFixed(4)}%`
												: "—"}
										</div>
									</div>
								</div>
								{compraCarteraSpreadRow && (
									<div className="flex items-center justify-between rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2">
										<span className="text-xs font-medium text-emerald-700">
											Tasa del inversionista
										</span>
										<span className="text-sm font-bold text-emerald-800 tabular-nums">
											{Number(compraCarteraSpreadRow.tasa).toFixed(4)}%
										</span>
									</div>
								)}
							</>
						)}
					</div>

					<DialogFooter className="gap-3 sm:gap-3">
						<Button
							variant="outline"
							onClick={() => {
								setCompraCarteraOpen(false);
								setCompraCarteraMonto("");
								setCompraCarteraSpreadOverrideId(null);
							}}
						>
							Cancelar
						</Button>
						<Button
							disabled={
								compraCarteraMutation.isPending ||
								!compraCarteraMonto ||
								Number(compraCarteraMonto) <= 0 ||
								// Sin bracket válido no hay spread que aplicar.
								!compraCarteraSpreadRow ||
								// El debounce todavía no alcanzó al monto tecleado: el
								// spread mostrado podría no corresponder al monto actual.
								compraCarteraMontoNum !== compraCarteraMontoDebounced ||
								modalidadResolverQuery.isFetching
							}
							onClick={() => {
								if (!compraCarteraSpreadRow) return;
								compraCarteraMutation.mutate({
									inversionistaId: investorIdNum,
									montoAportado: Number(compraCarteraMonto),
									tipoReinversion: compraCarteraTipoReinversion,
									modalidadFacturacion: compraCarteraModalidad,
									// Solo se manda con anulación manual explícita: sin
									// esto, el backend re-resuelve y valida por monto.
									modalidadFacturacionSpreadId: compraCarteraOverrideRow?.id,
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

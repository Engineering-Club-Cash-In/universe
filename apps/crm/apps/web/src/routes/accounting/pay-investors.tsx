import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	ArrowDown,
	ArrowUp,
	Banknote,
	ChevronLeft,
	ChevronRight,
	CreditCard,
	Download,
	Eye,
	FileCheck,
	Loader2,
	Search,
	Send,
	Sparkles,
	Upload,
	X,
} from "lucide-react";
import { PDFDocument } from "pdf-lib";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { authClient } from "@/lib/auth-client";
import { PERMISSIONS } from "@/lib/roles";
import { orpc, queryClient } from "@/utils/orpc";

export const Route = createFileRoute("/accounting/pay-investors")({
	component: PagarInversionistas,
});

// ─── Types ────────────────────────────────────────────────────────────────────

interface BoletaPendiente {
	boleta_id: number;
	inversionista_id: number;
	boleta_url: string;
	estado: string;
	notas: string | null;
	monto_boleta: string;
	fecha_subida: string;
}

interface CuentaExtra {
	cuenta_extra_id: number;
	banco_id: number;
	banco_nombre: string | null;
	tipo_cuenta: string;
	numero_cuenta: string;
	moneda: "quetzales" | "dolares";
	motivo_cuenta: string;
}

interface ResumenInversionista {
	inversionista_id: number;
	nombre: string;
	moneda: "quetzales" | "dolares";
	currencySymbol: string;
	emite_factura: boolean;
	reinversion: string;
	banco: string | null;
	tipo_cuenta: string | null;
	numero_cuenta: string | null;
	cuentas_extra?: CuentaExtra[] | null;
	total_abono_capital: string;
	total_abono_interes: string;
	total_abono_iva: string;
	total_isr: string;
	total_cuota?: string;
	total_a_recibir_sin_reinversion: string;
	total_reinversion: string;
	total_a_recibir_con_reinversion: string;
	boleta_pendiente?: BoletaPendiente | null;
	boleta_liquidacion?: BoletaPendiente | null;
	estado_liquidacion_resumen?: "pending" | "uploaded" | "liquidated";
}

type EstadoBoletaFilter = "all" | "pending" | "liquidated";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

const formatCurrency = (value: string | number, symbol = "Q") => {
	const num = typeof value === "string" ? Number.parseFloat(value) : value;
	if (Number.isNaN(num)) return `${symbol}0.00`;
	const locale = symbol === "$" ? "en-US" : "es-GT";
	return `${symbol}${num.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const invalidateResumenGlobalInversionistas = () =>
	queryClient.invalidateQueries({
		predicate: (query) =>
			JSON.stringify(query.queryKey).includes("getResumenGlobalInversionistas"),
	});

const MONTH_OPTIONS = [
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
];

// ─── Merge de archivos a un solo PDF ─────────────────────────────────────────

const MAX_BOLETA_FILES = 5;
const MAX_BOLETA_TOTAL_BYTES = 20 * 1024 * 1024; // 20 MB
const ACCEPTED_BOLETA_MIMES = new Set([
	"application/pdf",
	"image/png",
	"image/jpeg",
	"image/jpg",
]);
const ACCEPT_BOLETA_INPUT = ".pdf,image/png,image/jpeg,image/jpg";

async function mergeFilesToPdf(
	files: File[],
	outputName: string,
): Promise<File> {
	// Atajo: 1 solo PDF → no re-encode, se sube tal cual.
	if (files.length === 1 && files[0].type === "application/pdf") {
		return files[0];
	}

	const merged = await PDFDocument.create();

	for (const file of files) {
		const bytes = new Uint8Array(await file.arrayBuffer());

		if (file.type === "application/pdf") {
			const src = await PDFDocument.load(bytes);
			const copied = await merged.copyPages(src, src.getPageIndices());
			for (const page of copied) merged.addPage(page);
			continue;
		}

		if (
			file.type === "image/png" ||
			file.type === "image/jpeg" ||
			file.type === "image/jpg"
		) {
			const image =
				file.type === "image/png"
					? await merged.embedPng(bytes)
					: await merged.embedJpg(bytes);
			const page = merged.addPage([image.width, image.height]);
			page.drawImage(image, {
				x: 0,
				y: 0,
				width: image.width,
				height: image.height,
			});
			continue;
		}

		throw new Error(
			`Tipo de archivo no soportado: ${file.name}. Solo PDF, PNG o JPG.`,
		);
	}

	const pdfBytes = await merged.save();
	return new File([pdfBytes as BlobPart], outputName, {
		type: "application/pdf",
	});
}

// ─── Upload boleta hook ───────────────────────────────────────────────────────

function useUploadBoleta() {
	const createBoletaMutation = useMutation({
		...orpc.createBoleta.mutationOptions(),
		onSuccess: () => {
			invalidateResumenGlobalInversionistas();
		},
	});

	const upload = useCallback(
		async (params: {
			file: File;
			inversionista_id: number;
			monto_boleta: string;
			notas?: string;
		}) => {
			// 1. Subir archivo a cartera-back
			const formData = new FormData();
			formData.append("file", params.file);

			const serverUrl = import.meta.env.VITE_SERVER_URL;
			const uploadRes = await fetch(
				`${serverUrl}/api/accounting/upload-boleta`,
				{
					method: "POST",
					body: formData,
					credentials: "include",
				},
			);

			if (!uploadRes.ok) {
				const err = await uploadRes.json();
				throw new Error(err.error || "Error al subir archivo");
			}

			const { url } = await uploadRes.json();

			console.log("Archivo subido, URL:", url);

			// 2. Crear boleta en cartera-back
			await createBoletaMutation.mutateAsync({
				inversionista_id: params.inversionista_id,
				boleta_url: url,
				monto_boleta: String(params.monto_boleta),
				notas: params.notas || undefined,
			});
		},
		[createBoletaMutation],
	);

	return { upload, isPending: createBoletaMutation.isPending };
}

// ─── Dialog para subir boleta ─────────────────────────────────────────────────

function SubirBoletaDialog({
	inv,
	open,
	onOpenChange,
}: {
	inv: ResumenInversionista;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const [files, setFiles] = useState<File[]>([]);
	const [notas, setNotas] = useState("");
	const [uploading, setUploading] = useState(false);
	const [merging, setMerging] = useState(false);
	const [dragActive, setDragActive] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const { upload } = useUploadBoleta();

	const totalBytes = files.reduce((acc, f) => acc + f.size, 0);

	let dropzoneLabel: string;
	if (dragActive) dropzoneLabel = "Soltá los archivos aquí";
	else if (files.length === 0) dropzoneLabel = "Arrastrá archivos o hacé click";
	else dropzoneLabel = "Agregar más archivos";

	const handleAddFiles = (incoming: FileList | null) => {
		if (!incoming || incoming.length === 0) return;
		const incomingArr = Array.from(incoming);

		const invalid = incomingArr.find((f) => !ACCEPTED_BOLETA_MIMES.has(f.type));
		if (invalid) {
			toast.error(
				`Tipo no soportado: ${invalid.name}. Solo PDF, PNG o JPG.`,
			);
			return;
		}

		const next = [...files, ...incomingArr];
		if (next.length > MAX_BOLETA_FILES) {
			toast.error(`Máximo ${MAX_BOLETA_FILES} archivos`);
			return;
		}
		const nextBytes = next.reduce((acc, f) => acc + f.size, 0);
		if (nextBytes > MAX_BOLETA_TOTAL_BYTES) {
			toast.error("El tamaño total supera 20 MB");
			return;
		}
		setFiles(next);
	};

	const removeFile = (index: number) => {
		setFiles((prev) => prev.filter((_, i) => i !== index));
	};

	const moveFile = (index: number, direction: -1 | 1) => {
		setFiles((prev) => {
			const target = index + direction;
			if (target < 0 || target >= prev.length) return prev;
			const next = [...prev];
			[next[index], next[target]] = [next[target], next[index]];
			return next;
		});
	};

	const handleDrag = (e: React.DragEvent<HTMLDivElement>) => {
		e.preventDefault();
		e.stopPropagation();
		if (uploading || files.length >= MAX_BOLETA_FILES) return;
		if (e.type === "dragenter" || e.type === "dragover") setDragActive(true);
		else if (e.type === "dragleave") setDragActive(false);
	};

	const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
		e.preventDefault();
		e.stopPropagation();
		setDragActive(false);
		if (uploading || files.length >= MAX_BOLETA_FILES) return;
		if (e.dataTransfer?.files?.length) {
			handleAddFiles(e.dataTransfer.files);
		}
	};

	const handleSubmit = async () => {
		if (files.length === 0) {
			toast.error("Selecciona al menos un archivo");
			return;
		}

		setUploading(true);
		try {
			let toUpload: File;
			if (files.length === 1 && files[0].type === "application/pdf") {
				toUpload = files[0];
			} else {
				setMerging(true);
				toUpload = await mergeFilesToPdf(
					files,
					`boleta-${inv.inversionista_id}-${Date.now()}.pdf`,
				);
				setMerging(false);
			}

			await upload({
				file: toUpload,
				inversionista_id: inv.inversionista_id,
				monto_boleta: String(inv.total_a_recibir_con_reinversion),
				notas: notas.trim() || undefined,
			});
			toast.success("Boleta subida correctamente");
			setFiles([]);
			setNotas("");
			onOpenChange(false);
		} catch (err: any) {
			toast.error(err.message || "Error al subir boleta");
		} finally {
			setMerging(false);
			setUploading(false);
		}
	};

	const handleClose = (value: boolean) => {
		if (!uploading) {
			setFiles([]);
			setNotas("");
			onOpenChange(value);
		}
	};

	return (
		<Dialog open={open} onOpenChange={handleClose}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Subir Boleta</DialogTitle>
					<DialogDescription>
						{inv.nombre} — {formatCurrency(inv.total_a_recibir_con_reinversion, inv.currencySymbol)}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-2">
					{/* Banner: nueva funcionalidad de múltiples boletas */}
					<div className="relative overflow-hidden rounded-lg border border-emerald-200 bg-linear-to-br from-emerald-50 to-teal-50 px-3.5 py-3 dark:border-emerald-900/50 dark:from-emerald-950/40 dark:to-teal-950/40">
						<div className="flex items-start gap-2.5">
							<div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/60">
								<Sparkles className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-300" />
							</div>
							<div className="min-w-0 flex-1">
								<div className="mb-0.5 flex items-center gap-1.5">
									<p className="font-semibold text-[13px] text-emerald-900 dark:text-emerald-100">
										¡Ahora podés subir varias boletas!
									</p>
								</div>
								<p className="text-[11.5px] text-emerald-800/90 leading-snug dark:text-emerald-200/80">
									Arrastrá o seleccioná varios PDFs, PNGs o JPGs a la vez. Se
									unirán automáticamente en un solo archivo y se subirán como
									una sola boleta.
								</p>
							</div>
						</div>
					</div>

					{/* Archivos */}
					<div className="space-y-2">
						<div className="flex items-center justify-between">
							<Label htmlFor="boleta-file">
								Archivos{" "}
								<span className="font-normal text-muted-foreground text-xs">
									(máx. 5 — 20 MB)
								</span>
							</Label>
							{files.length > 0 && (
								<span className="text-muted-foreground text-xs tabular-nums">
									{files.length}/{MAX_BOLETA_FILES} ·{" "}
									{(totalBytes / 1024 / 1024).toFixed(1)} MB
								</span>
							)}
						</div>

						<div
							className={`flex cursor-pointer items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 transition-colors ${
								dragActive
									? "border-primary bg-primary/5"
									: "hover:border-primary/50 hover:bg-muted/50"
							} ${
								files.length >= MAX_BOLETA_FILES
									? "pointer-events-none opacity-50"
									: ""
							}`}
							onClick={() => fileInputRef.current?.click()}
							onKeyDown={() => {}}
							onDragEnter={handleDrag}
							onDragLeave={handleDrag}
							onDragOver={handleDrag}
							onDrop={handleDrop}
						>
							<div className="text-center">
								<Upload
									className={`mx-auto mb-1 h-6 w-6 transition-colors ${
										dragActive ? "text-primary" : "text-muted-foreground"
									}`}
								/>
								<p
									className={`font-medium text-sm transition-colors ${
										dragActive ? "text-primary" : "text-foreground"
									}`}
								>
									{dropzoneLabel}
								</p>
								<p className="mt-0.5 text-[11px] text-muted-foreground/70">
									PDF, PNG o JPG — se unirán en un solo PDF
								</p>
							</div>
						</div>
						<input
							ref={fileInputRef}
							id="boleta-file"
							type="file"
							accept={ACCEPT_BOLETA_INPUT}
							multiple
							className="hidden"
							onChange={(e) => {
								handleAddFiles(e.target.files);
								if (fileInputRef.current) fileInputRef.current.value = "";
							}}
						/>

						{files.length > 0 && (
							<ul className="space-y-1.5">
								{files.map((f, index) => (
									<li
										key={`${f.name}-${index}`}
										className="flex items-center gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5"
									>
										<span className="w-5 shrink-0 text-center font-mono text-muted-foreground text-xs tabular-nums">
											{index + 1}
										</span>
										<FileCheck className="h-4 w-4 shrink-0 text-emerald-600" />
										<div className="min-w-0 flex-1">
											<p className="truncate font-medium text-xs">{f.name}</p>
											<p className="text-[10px] text-muted-foreground">
												{(f.size / 1024).toFixed(0)} KB
											</p>
										</div>
										<div className="flex items-center gap-0.5">
											<Button
												type="button"
												variant="ghost"
												size="icon"
												className="h-7 w-7"
												disabled={index === 0 || uploading}
												onClick={() => moveFile(index, -1)}
												title="Subir"
											>
												<ArrowUp className="h-3.5 w-3.5" />
											</Button>
											<Button
												type="button"
												variant="ghost"
												size="icon"
												className="h-7 w-7"
												disabled={index === files.length - 1 || uploading}
												onClick={() => moveFile(index, 1)}
												title="Bajar"
											>
												<ArrowDown className="h-3.5 w-3.5" />
											</Button>
											<Button
												type="button"
												variant="ghost"
												size="icon"
												className="h-7 w-7 text-muted-foreground hover:text-destructive"
												disabled={uploading}
												onClick={() => removeFile(index)}
												title="Quitar"
											>
												<X className="h-3.5 w-3.5" />
											</Button>
										</div>
									</li>
								))}
							</ul>
						)}
					</div>

					{/* Notas */}
					<div className="space-y-2">
						<Label htmlFor="boleta-notas">Notas (opcional)</Label>
						<Textarea
							id="boleta-notas"
							placeholder="Agregar una nota..."
							value={notas}
							onChange={(e) => setNotas(e.target.value)}
							rows={3}
						/>
					</div>
				</div>

				<DialogFooter>
					<Button
						variant="outline"
						onClick={() => handleClose(false)}
						disabled={uploading}
					>
						Cancelar
					</Button>
					<Button
						onClick={handleSubmit}
						disabled={uploading || files.length === 0}
					>
						{uploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
						{merging ? "Uniendo archivos..." : "Subir boleta"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

// ─── Card del inversionista ───────────────────────────────────────────────────

function DetailItem({ label, value }: { label: string; value: string }) {
	return (
		<span className="text-[10px] text-muted-foreground">
			{label} <span className="font-medium text-foreground/70">{value}</span>
		</span>
	);
}

function CuentasExtraIndicator({ cuentas }: { cuentas: CuentaExtra[] }) {
	const count = cuentas.length;
	const label = count === 1 ? "1 cuenta adicional" : `${count} cuentas adicionales`;

	return (
		<Popover>
			<PopoverTrigger asChild>
				<button
					type="button"
					className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 font-medium text-[11px] text-sky-700 transition-colors hover:bg-sky-100 dark:border-sky-900/60 dark:bg-sky-950/50 dark:text-sky-300 dark:hover:bg-sky-900/40"
				>
					<Eye className="h-3.5 w-3.5" />
					{label}
				</button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-80 p-0">
				<div className="border-b px-3.5 py-2.5">
					<p className="font-semibold text-sm">Cuentas adicionales</p>
					<p className="text-[11px] text-muted-foreground">
						Cuentas extra registradas para este inversionista
					</p>
				</div>
				<ul className="max-h-72 divide-y overflow-y-auto">
					{cuentas.map((c) => (
						<li key={c.cuenta_extra_id} className="px-3.5 py-2.5">
							<div className="flex items-baseline justify-between gap-2">
								<p className="truncate font-semibold text-[13px]">
									{c.banco_nombre ?? "Sin banco"}
								</p>
								<span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground uppercase">
									{c.moneda === "dolares" ? "USD" : "GTQ"}
								</span>
							</div>
							<div className="mt-0.5 flex items-baseline justify-between gap-2">
								<p className="font-mono text-[12px] text-foreground/80 tabular-nums tracking-wider">
									{c.numero_cuenta}
								</p>
								<p className="shrink-0 text-[10px] text-muted-foreground">
									{c.tipo_cuenta}
								</p>
							</div>
							{c.motivo_cuenta && (
								<p className="mt-1.5 rounded-md bg-muted/60 px-2 py-1 text-[11px] text-foreground/70 leading-snug">
									{c.motivo_cuenta}
								</p>
							)}
						</li>
					))}
				</ul>
			</PopoverContent>
		</Popover>
	);
}

function InversionistaCard({ inv }: { inv: ResumenInversionista }) {
	const [dialogOpen, setDialogOpen] = useState(false);
	const [confirmLiquidarSinBoletaOpen, setConfirmLiquidarSinBoletaOpen] =
		useState(false);
	const tieneBoleta = inv.boleta_pendiente != null;
	const tieneBoletaLiquidacion = inv.boleta_liquidacion != null;
	const estadoResumen =
		inv.estado_liquidacion_resumen ?? (tieneBoleta ? "uploaded" : "pending");
	const montoPrincipal = inv.total_cuota ?? inv.total_a_recibir_con_reinversion;
	const badge =
		estadoResumen === "liquidated"
			? {
					label: "Liquidada",
					className:
						"bg-slate-100 text-slate-700 dark:bg-slate-900/60 dark:text-slate-300",
				}
			: estadoResumen === "uploaded"
				? {
						label: "Boleta",
						className:
							"bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400",
					}
				: {
						label: "Pendiente",
						className:
							"bg-orange-50 text-orange-600 dark:bg-orange-950/60 dark:text-orange-400",
					};

	const liquidateMutation = useMutation({
		...orpc.liquidateInversionista.mutationOptions(),
		onSuccess: (res) => {
			// Si la petición no lanza error (200 OK), asumimos éxito a menos que traiga un flag explícito de error
			if (res && res.error) {
				toast.error(res.error || res.message || "Error al liquidar");
			} else {
				toast.success(res?.message || "Liquidación completada correctamente");
				invalidateResumenGlobalInversionistas();
			}
		},
		onError: (err) => {
			toast.error(err instanceof Error ? err.message : "Error al liquidar");
		},
	});

	return (
		<>
			<Card className="group gap-0 overflow-hidden py-0 transition-all hover:shadow-md">
				{/* Header: nombre + estado */}
				<div className="flex items-start justify-between gap-2 px-5 pt-5">
					<p className="truncate font-medium text-sm leading-snug">
						{inv.nombre}
					</p>
					<span
						className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-medium text-[11px] ${badge.className}`}
					>
						{estadoResumen === "uploaded" && <FileCheck className="h-3 w-3" />}
						{badge.label}
					</span>
				</div>

				{/* Monto hero */}
				<div className="px-5 pt-1.5 pb-4">
					<p className="font-bold text-[28px] tabular-nums leading-none tracking-tighter">
						{formatCurrency(montoPrincipal, inv.currencySymbol)}
					</p>
				</div>

				{/* Banco — panel con fondo sutil */}
				<div className="mx-3 rounded-lg bg-muted/50 px-3.5 py-2.5">
					{inv.banco ? (
						<>
							<div className="flex items-baseline justify-between gap-2">
								<p className="font-semibold text-[13px]">{inv.banco}</p>
								{inv.tipo_cuenta && (
									<p className="text-[11px] text-muted-foreground">
										{inv.tipo_cuenta}
									</p>
								)}
							</div>
							{inv.numero_cuenta && (
								<p className="mt-0.5 font-mono text-base text-foreground/80 tabular-nums tracking-wider">
									{inv.numero_cuenta}
								</p>
							)}
						</>
					) : (
						<p className="text-muted-foreground/50 text-xs italic">
							Sin banco asignado
						</p>
					)}
				</div>

				{inv.cuentas_extra && inv.cuentas_extra.length > 0 && (
					<div className="px-3 pt-2">
						<CuentasExtraIndicator cuentas={inv.cuentas_extra} />
					</div>
				)}

				{/* Detalle financiero + tags */}
				<div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 pt-3 pb-1.5">
					<DetailItem label="Cap" value={formatCurrency(inv.total_abono_capital, inv.currencySymbol)} />
					<DetailItem label="Int" value={formatCurrency(inv.total_abono_interes, inv.currencySymbol)} />
					<DetailItem label="IVA" value={formatCurrency(inv.total_abono_iva, inv.currencySymbol)} />
					{Number.parseFloat(inv.total_isr) > 0 && (
						<DetailItem label="ISR" value={formatCurrency(inv.total_isr, inv.currencySymbol)} />
					)}
					{inv.emite_factura && (
						<span className="text-[10px] text-muted-foreground/40">
							Factura
						</span>
					)}
					{inv.reinversion !== "sin_reinversion" && (
						<span className="text-[10px] text-muted-foreground/40">
							Reinversión
						</span>
					)}
				</div>

				{/* Acción */}
				<div className="px-4 pt-1 pb-4">
					{estadoResumen === "liquidated" ? (
						tieneBoletaLiquidacion ? (
							<Button
								variant="ghost"
								size="sm"
								className="h-8 w-full gap-1.5 text-xs"
								onClick={() =>
									window.open(inv.boleta_liquidacion!.boleta_url, "_blank")
								}
							>
								<Eye className="h-3.5 w-3.5" />
								Ver boleta
							</Button>
						) : (
							<div className="flex h-8 w-full items-center justify-center rounded-md bg-muted font-medium text-muted-foreground text-xs">
								Completada
							</div>
						)
					) : tieneBoleta ? (
						<div className="flex gap-2">
							<Button
								variant="ghost"
								size="sm"
								className="h-8 flex-1 gap-1.5 text-xs"
								onClick={() =>
									window.open(inv.boleta_pendiente!.boleta_url, "_blank")
								}
							>
								<Eye className="h-3.5 w-3.5" />
								Ver
							</Button>
							<Button
								size="sm"
								className="h-8 flex-1 gap-1.5 bg-emerald-600 text-xs text-white shadow-sm hover:bg-emerald-700"
								disabled={liquidateMutation.isPending}
								onClick={() =>
									liquidateMutation.mutate({
										inversionista_id: inv.inversionista_id,
									})
								}
							>
								{liquidateMutation.isPending ? (
									<Loader2 className="h-3.5 w-3.5 animate-spin" />
								) : (
									<Banknote className="h-3.5 w-3.5" />
								)}
								Liquidar
							</Button>
						</div>
					) : (
						<div className="flex flex-col gap-2">
							<Button
								size="sm"
								className="h-9 w-full gap-1.5 bg-emerald-600 text-xs text-white shadow-sm hover:bg-emerald-700"
								disabled={liquidateMutation.isPending}
								onClick={() => setDialogOpen(true)}
							>
								<Upload className="h-3.5 w-3.5" />
								Subir y liquidar
							</Button>
							<Button
								size="sm"
								className="h-9 w-full gap-1.5 bg-amber-600 text-xs text-white shadow-sm hover:bg-amber-700"
								disabled={liquidateMutation.isPending}
								onClick={() => setConfirmLiquidarSinBoletaOpen(true)}
							>
								{liquidateMutation.isPending ? (
									<Loader2 className="h-3.5 w-3.5 animate-spin" />
								) : (
									<Banknote className="h-3.5 w-3.5" />
								)}
								Liquidar sin boleta
							</Button>
						</div>
					)}
				</div>
			</Card>

			<SubirBoletaDialog
				inv={inv}
				open={dialogOpen}
				onOpenChange={setDialogOpen}
			/>

			<AlertDialog
				open={confirmLiquidarSinBoletaOpen}
				onOpenChange={setConfirmLiquidarSinBoletaOpen}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>¿Liquidar sin boleta?</AlertDialogTitle>
						<AlertDialogDescription>
							{inv.nombre} se liquidará sin una boleta subida. Esta acción
							continuará el proceso de liquidación de todas formas.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={liquidateMutation.isPending}>
							Cancelar
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={liquidateMutation.isPending}
							onClick={() =>
								liquidateMutation.mutate({
									inversionista_id: inv.inversionista_id,
								})
							}
						>
							{liquidateMutation.isPending
								? "Liquidando..."
								: "Liquidar sin boleta"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

// ─── Página principal ─────────────────────────────────────────────────────────

function PagarInversionistas() {
	const { data: session } = authClient.useSession();
	const today = new Date();
	const currentYear = today.getFullYear();
	const userProfile = useQuery({
		...orpc.getUserProfile.queryOptions(),
		enabled: !!session,
	});
	const userRole = userProfile.data?.role;

	const [search, setSearch] = useState("");
	const [page, setPage] = useState(1);
	const [downloadingExcel, setDownloadingExcel] = useState(false);
	const [downloadingTransferencia, setDownloadingTransferencia] = useState<
		null | "ach" | "no-ach"
	>(null);
	const [estadoBoletaFilter, setEstadoBoletaFilter] =
		useState<EstadoBoletaFilter>("all");
	const [mesFiltro, setMesFiltro] = useState(today.getMonth() + 1);
	const [anioFiltro, setAnioFiltro] = useState(today.getFullYear());
	const canAccessAccounting =
		!!session && !!userRole && PERMISSIONS.canAccessAccounting(userRole);
	const requiresPeriodo =
		estadoBoletaFilter === "all" || estadoBoletaFilter === "liquidated";
	const years = useMemo(() => {
		return Array.from({ length: 5 }, (_, index) => currentYear - index);
	}, [currentYear]);
	const resumenInput = useMemo(
		() => ({
			estado: estadoBoletaFilter,
			...(requiresPeriodo ? { mes: mesFiltro, anio: anioFiltro } : {}),
		}),
		[anioFiltro, estadoBoletaFilter, mesFiltro, requiresPeriodo],
	);

	const handleDownloadTransferencias = async (
		ach: boolean,
		moneda?: "quetzales" | "dolar",
	) => {
		const key = ach ? "ach" : "no-ach";
		setDownloadingTransferencia(key);
		try {
			const serverUrl = import.meta.env.VITE_SERVER_URL;
			const queryParams = new URLSearchParams({
				mes: String(mesFiltro),
				anio: String(anioFiltro),
				ach: ach ? "true" : "false",
			});
			if (moneda) queryParams.set("moneda", moneda);

			const res = await fetch(
				`${serverUrl}/api/accounting/resumen-transferencias-excel?${queryParams.toString()}`,
				{ credentials: "include" },
			);
			if (!res.ok) {
				const err = await res.json();
				throw new Error(err.error || "Error al descargar");
			}
			const data = await res.json();
			if (!data.success || !data.url) {
				throw new Error("No se pudo generar el Excel");
			}
			window.open(data.url, "_blank");
			toast.success("Excel de transferencias descargado");
		} catch (err: any) {
			toast.error(err.message || "Error al descargar Excel");
		} finally {
			setDownloadingTransferencia(null);
		}
	};

	const handleDownloadExcel = async () => {
		setDownloadingExcel(true);
		try {
			const serverUrl = import.meta.env.VITE_SERVER_URL;
			const queryParams = new URLSearchParams({ estado: estadoBoletaFilter });
			if (requiresPeriodo) {
				queryParams.set("mes", String(mesFiltro));
				queryParams.set("anio", String(anioFiltro));
			}
			const res = await fetch(
				`${serverUrl}/api/accounting/resumen-global-excel?${queryParams.toString()}`,
				{ credentials: "include" },
			);
			if (!res.ok) {
				const err = await res.json();
				throw new Error(err.error || "Error al descargar");
			}
			const data = await res.json();
			if (!data.success || !data.url) {
				throw new Error("No se pudo generar el Excel");
			}
			window.open(data.url, "_blank");
			toast.success("Excel descargado correctamente");
		} catch (err: any) {
			toast.error(err.message || "Error al descargar Excel");
		} finally {
			setDownloadingExcel(false);
		}
	};

	const pendientesQuery = useQuery({
		...orpc.getResumenGlobalInversionistas.queryOptions({
			input: resumenInput,
		}),
		enabled: canAccessAccounting,
	});
	const inversionistas = (pendientesQuery.data ?? []) as ResumenInversionista[];
	const conBoleta = inversionistas.filter(
		(inv) => inv.boleta_pendiente != null,
	).length;
	const totalLiquidadas = inversionistas.filter(
		(inv) => inv.estado_liquidacion_resumen === "liquidated",
	).length;
	const pendientesDeLiquidar = inversionistas.filter(
		(inv) => inv.estado_liquidacion_resumen !== "liquidated",
	).length;

	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		if (!q) return inversionistas;

		return inversionistas.filter(
			(inv) =>
				inv.nombre.toLowerCase().includes(q) ||
				String(inv.inversionista_id).includes(q),
		);
	}, [inversionistas, search]);

	const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
	const safePage = Math.min(page, totalPages);
	const paginatedData = filtered.slice(
		(safePage - 1) * PAGE_SIZE,
		safePage * PAGE_SIZE,
	);

	const handleSearch = (value: string) => {
		setSearch(value);
		setPage(1);
	};

	if (!userRole || !PERMISSIONS.canAccessAccounting(userRole)) {
		return (
			<div className="flex min-h-screen items-center justify-center">
				<div className="text-center">
					<h1 className="mb-4 font-bold text-2xl">Acceso Denegado</h1>
					<p className="text-muted-foreground">
						No tienes permisos para acceder a esta sección.
					</p>
				</div>
			</div>
		);
	}

	if (pendientesQuery.isLoading) {
		return (
			<div className="flex min-h-screen items-center justify-center">
				<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
			</div>
		);
	}

	if (pendientesQuery.error) {
		return (
			<div className="flex min-h-screen items-center justify-center">
				<div className="text-center">
					<h1 className="mb-4 font-bold text-2xl text-destructive">Error</h1>
					<p className="text-muted-foreground">
						No se pudo cargar el resumen de inversionistas.
					</p>
				</div>
			</div>
		);
	}

	const totalPendienteLiquidar = inversionistas
		.filter((inv) => inv.estado_liquidacion_resumen !== "liquidated")
		.reduce(
			(acc, inv) =>
				acc + Number.parseFloat(inv.total_a_recibir_con_reinversion || "0"),
			0,
		);
	return (
		<div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="font-bold text-2xl tracking-tight">
						Pagar Inversionistas
					</h1>
					<p className="text-muted-foreground text-sm">
						Resumen global de pagos pendientes
					</p>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button
						variant="outline"
						size="sm"
						className="gap-2"
						disabled={downloadingExcel}
						onClick={handleDownloadExcel}
					>
						{downloadingExcel ? (
							<Loader2 className="h-4 w-4 animate-spin" />
						) : (
							<Download className="h-4 w-4" />
						)}
						Exportar Excel
					</Button>

					<TransferenciasDropdown
						label="Transferencia a Terceros"
						loading={downloadingTransferencia === "no-ach"}
						disabled={downloadingTransferencia !== null}
						onSelect={(moneda) => handleDownloadTransferencias(false, moneda)}
					/>

					<TransferenciasDropdown
						label="Transferencias ACH"
						loading={downloadingTransferencia === "ach"}
						disabled={downloadingTransferencia !== null}
						onSelect={(moneda) => handleDownloadTransferencias(true, moneda)}
					/>
				</div>
			</div>

			{/* Stats */}
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
				<StatCard
					label="Inversionistas"
					value={String(inversionistas.length)}
					icon={<CreditCard className="h-4 w-4 text-muted-foreground" />}
				/>
				<StatCard
					label="Total pendiente de liquidar"
					value={formatCurrency(totalPendienteLiquidar, "Q")}
					icon={<Banknote className="h-4 w-4 text-emerald-600" />}
					highlight
				/>
				<StatCard
					label="Total liquidadas"
					value={String(totalLiquidadas)}
					icon={<FileCheck className="h-4 w-4 text-emerald-600" />}
				/>
				<StatCard
					label="Pendientes de liquidar"
					value={String(pendientesDeLiquidar)}
					icon={<Upload className="h-4 w-4 text-orange-500" />}
				/>
			</div>

			{/* Buscador + paginación */}
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="relative max-w-xs flex-1">
					<Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						placeholder="Buscar por nombre o ID..."
						value={search}
						onChange={(e) => handleSearch(e.target.value)}
						className="pl-9"
					/>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button
						variant={estadoBoletaFilter === "all" ? "default" : "outline"}
						size="sm"
						onClick={() => {
							setEstadoBoletaFilter("all");
							setPage(1);
						}}
					>
						Todas
					</Button>
					<Button
						variant={estadoBoletaFilter === "pending" ? "default" : "outline"}
						size="sm"
						onClick={() => {
							setEstadoBoletaFilter("pending");
							setPage(1);
						}}
					>
						Pendientes
					</Button>
					<Button
						variant={
							estadoBoletaFilter === "liquidated" ? "default" : "outline"
						}
						size="sm"
						onClick={() => {
							setEstadoBoletaFilter("liquidated");
							setPage(1);
						}}
					>
						Liquidadas
					</Button>
				</div>
				{requiresPeriodo && (
					<div className="flex flex-wrap gap-2">
						<Select
							value={String(mesFiltro)}
							onValueChange={(value) => {
								setMesFiltro(Number(value));
								setPage(1);
							}}
						>
							<SelectTrigger size="sm" className="min-w-36">
								<SelectValue placeholder="Mes" />
							</SelectTrigger>
							<SelectContent size="sm">
								{MONTH_OPTIONS.map((month) => (
									<SelectItem key={month.value} value={String(month.value)}>
										{month.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<Select
							value={String(anioFiltro)}
							onValueChange={(value) => {
								setAnioFiltro(Number(value));
								setPage(1);
							}}
						>
							<SelectTrigger size="sm" className="min-w-28">
								<SelectValue placeholder="Año" />
							</SelectTrigger>
							<SelectContent size="sm">
								{years.map((year) => (
									<SelectItem key={year} value={String(year)}>
										{year}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				)}
				<PaginationControls
					page={safePage}
					totalPages={totalPages}
					totalItems={filtered.length}
					onPageChange={setPage}
				/>
			</div>

			{/* Grid de cards */}
			{paginatedData.length === 0 ? (
				<div className="flex items-center justify-center py-16">
					<p className="text-muted-foreground text-sm">
						No se encontraron inversionistas.
					</p>
				</div>
			) : (
				<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{paginatedData.map((inv) => (
						<InversionistaCard key={inv.inversionista_id} inv={inv} />
					))}
				</div>
			)}

			{/* Paginación inferior */}
			{filtered.length > PAGE_SIZE && (
				<div className="flex justify-center pb-4">
					<PaginationControls
						page={safePage}
						totalPages={totalPages}
						totalItems={filtered.length}
						onPageChange={setPage}
					/>
				</div>
			)}
		</div>
	);
}

// ─── Componentes auxiliares ───────────────────────────────────────────────────

function StatCard({
	label,
	value,
	icon,
	highlight,
}: {
	label: string;
	value: string;
	icon: React.ReactNode;
	highlight?: boolean;
}) {
	return (
		<Card className="gap-0 py-0">
			<CardContent className="flex items-center gap-3 px-4 py-3">
				{icon}
				<div>
					<p className="text-[11px] text-muted-foreground uppercase tracking-wide">
						{label}
					</p>
					<p
						className={`font-semibold tabular-nums ${highlight ? "text-base" : "text-sm"}`}
					>
						{value}
					</p>
				</div>
			</CardContent>
		</Card>
	);
}

function TransferenciasDropdown({
	label,
	loading,
	disabled,
	onSelect,
}: {
	label: string;
	loading: boolean;
	disabled: boolean;
	onSelect: (moneda?: "quetzales" | "dolar") => void;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="outline"
					size="sm"
					className="gap-2"
					disabled={disabled}
				>
					{loading ? (
						<Loader2 className="h-4 w-4 animate-spin" />
					) : (
						<Send className="h-4 w-4" />
					)}
					{label}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuLabel>Seleccionar moneda</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<DropdownMenuItem onSelect={() => onSelect("quetzales")}>
					Quetzales (Q)
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => onSelect("dolar")}>
					Dólares ($)
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => onSelect(undefined)}>
					Ambas
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function PaginationControls({
	page,
	totalPages,
	totalItems,
	onPageChange,
}: {
	page: number;
	totalPages: number;
	totalItems: number;
	onPageChange: (page: number) => void;
}) {
	return (
		<div className="flex items-center gap-2">
			<span className="text-muted-foreground text-xs tabular-nums">
				{totalItems} resultado{totalItems !== 1 ? "s" : ""}
			</span>
			<Button
				variant="outline"
				size="icon"
				className="h-8 w-8"
				disabled={page <= 1}
				onClick={() => onPageChange(page - 1)}
			>
				<ChevronLeft className="h-4 w-4" />
			</Button>
			<span className="text-sm tabular-nums">
				{page}/{totalPages}
			</span>
			<Button
				variant="outline"
				size="icon"
				className="h-8 w-8"
				disabled={page >= totalPages}
				onClick={() => onPageChange(page + 1)}
			>
				<ChevronRight className="h-4 w-4" />
			</Button>
		</div>
	);
}

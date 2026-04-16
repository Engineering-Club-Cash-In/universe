import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	Banknote,
	ChevronLeft,
	ChevronRight,
	CreditCard,
	Download,
	Eye,
	FileCheck,
	Loader2,
	Search,
	Upload,
} from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
	const [file, setFile] = useState<File | null>(null);
	const [notas, setNotas] = useState("");
	const [uploading, setUploading] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const { upload } = useUploadBoleta();

	const handleSubmit = async () => {
		if (!file) {
			toast.error("Selecciona un archivo");
			return;
		}

		setUploading(true);
		try {
			await upload({
				file,
				inversionista_id: inv.inversionista_id,
				monto_boleta: String(inv.total_a_recibir_con_reinversion),
				notas: notas.trim() || undefined,
			});
			toast.success("Boleta subida correctamente");
			setFile(null);
			setNotas("");
			onOpenChange(false);
		} catch (err: any) {
			toast.error(err.message || "Error al subir boleta");
		} finally {
			setUploading(false);
		}
	};

	const handleClose = (value: boolean) => {
		if (!uploading) {
			setFile(null);
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
					{/* Archivo */}
					<div className="space-y-2">
						<Label htmlFor="boleta-file">Archivo</Label>
						<div
							className="flex cursor-pointer items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 transition-colors hover:border-primary/50 hover:bg-muted/50"
							onClick={() => fileInputRef.current?.click()}
							onKeyDown={() => {}}
						>
							{file ? (
								<div className="text-center">
									<FileCheck className="mx-auto mb-1 h-6 w-6 text-emerald-600" />
									<p className="font-medium text-sm">{file.name}</p>
									<p className="text-muted-foreground text-xs">
										{(file.size / 1024).toFixed(0)} KB
									</p>
								</div>
							) : (
								<div className="text-center">
									<Upload className="mx-auto mb-1 h-6 w-6 text-muted-foreground" />
									<p className="text-muted-foreground text-sm">
										Click para seleccionar archivo
									</p>
								</div>
							)}
						</div>
						<input
							ref={fileInputRef}
							id="boleta-file"
							type="file"
							accept="image/*,.pdf"
							className="hidden"
							onChange={(e) => setFile(e.target.files?.[0] ?? null)}
						/>
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
					<Button onClick={handleSubmit} disabled={uploading || !file}>
						{uploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
						Subir boleta
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
				<div className="flex gap-2 px-4 pt-1 pb-4">
					{estadoResumen === "liquidated" ? (
						tieneBoletaLiquidacion ? (
							<Button
								variant="ghost"
								size="sm"
								className="h-8 flex-1 gap-1.5 text-xs"
								onClick={() =>
									window.open(inv.boleta_liquidacion!.boleta_url, "_blank")
								}
							>
								<Eye className="h-3.5 w-3.5" />
								Ver boleta
							</Button>
						) : (
							<div className="flex h-8 flex-1 items-center justify-center rounded-md bg-muted font-medium text-muted-foreground text-xs">
								Completada
							</div>
						)
					) : tieneBoleta ? (
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
					) : (
						<Button
							variant="outline"
							size="sm"
							className="h-8 flex-1 gap-1.5 text-xs"
							onClick={() => setDialogOpen(true)}
						>
							<Upload className="h-3.5 w-3.5" />
							Subir
						</Button>
					)}

					{estadoResumen !== "liquidated" && (
						<Button
							variant="default"
							size="sm"
							className="h-8 flex-1 gap-1.5 bg-emerald-600 text-xs hover:bg-emerald-700"
							disabled={liquidateMutation.isPending}
							onClick={() => {
								if (!tieneBoleta) {
									setConfirmLiquidarSinBoletaOpen(true);
									return;
								}

								liquidateMutation.mutate({
									inversionista_id: inv.inversionista_id,
								});
							}}
						>
							{liquidateMutation.isPending ? (
								<Loader2 className="h-3.5 w-3.5 animate-spin" />
							) : (
								<Banknote className="h-3.5 w-3.5" />
							)}
							Liquidar
						</Button>
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

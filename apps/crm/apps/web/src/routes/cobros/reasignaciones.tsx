import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Search, UserCog } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
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
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { authClient } from "@/lib/auth-client";
import { estiloBucket } from "@/lib/cobros/buckets-catalogo";
import { PERMISSIONS } from "@/lib/roles";
import { client, orpc, queryClient } from "@/utils/orpc";

export const Route = createFileRoute("/cobros/reasignaciones")({
	component: RouteComponent,
});

// Buckets del funnel operativo B0-B5 (clave estable del motor). El label real
// por fila viene del objeto `bucket` que trae cada crédito; esto solo alimenta
// el selector de filtro.
const BUCKETS_FILTRO: { numero: number; label: string }[] = [
	{ numero: 0, label: "B0 · Cartera Sana" },
	{ numero: 1, label: "B1 · Alerta Temprana" },
	{ numero: 2, label: "B2 · Gestión Activa" },
	{ numero: 3, label: "B3 · Rescate" },
	{ numero: 4, label: "B4 · Última Instancia / Pre Jurídico" },
	{ numero: 5, label: "B5 · Jurídico" },
];

type CreditoFila = {
	creditoId: number;
	numeroCreditoSifco: string;
	cliente: string;
	asesorId: number | null;
	asesorNombre: string | null;
	bucket: {
		numero: number;
		prefijo: string;
		nombre: string;
		color: string | null;
	} | null;
};

const fmtFecha = (v: string) => {
	const d = new Date(v);
	if (Number.isNaN(d.getTime())) return v;
	return d.toLocaleString("es-GT", {
		timeZone: "America/Guatemala",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});
};

function BucketBadge({ bucket }: { bucket: CreditoFila["bucket"] }) {
	if (!bucket) return <span className="text-muted-foreground text-xs">—</span>;
	const color = bucket.color || "#64748b";
	return (
		<Badge
			variant="outline"
			className="whitespace-nowrap font-semibold"
			style={estiloBucket(color)}
			title={`${bucket.prefijo} · ${bucket.nombre}`}
		>
			{bucket.prefijo}
		</Badge>
	);
}

function ReasignarModal({
	credito,
	onClose,
}: {
	credito: CreditoFila;
	onClose: () => void;
}) {
	const [asesorNuevoId, setAsesorNuevoId] = useState<string>("");
	const [motivo, setMotivo] = useState("");

	const bucketNumero = credito.bucket?.numero ?? null;

	const poolQuery = useQuery({
		...orpc.getPoolAsesoresPorBucket.queryOptions({
			input: { bucket: bucketNumero ?? -1 },
		}),
		enabled: bucketNumero !== null,
	});

	// Historial de reasignaciones MANUALES previas de ESTE crédito (contexto:
	// ¿ya movieron esta cuenta antes?). Solo API_MANUAL para no meter el ruido
	// de las reasignaciones automáticas del motor.
	const histQuery = useQuery(
		orpc.getHistorialReasignaciones.queryOptions({
			input: {
				creditoId: credito.creditoId,
				origen: "API_MANUAL",
				pageSize: 10,
			},
		}),
	);
	// El backend ya excluye la siembra inicial de COBROS-02 (motivo fijo del
	// script SQL, no una decisión humana) — sin filtro client-side para no
	// desalinear paginación/resumen con lo mostrado (review Codex).
	const historial = histQuery.data?.data ?? [];

	const mutation = useMutation({
		mutationFn: () =>
			client.reasignarAsesorCredito({
				creditoId: credito.creditoId,
				asesorNuevoId: Number(asesorNuevoId),
				motivo: motivo.trim(),
			}),
		onSuccess: () => {
			toast.success("Crédito reasignado");
			// key() (sin input) = prefijo del path → invalida TODAS las variantes
			// de la query (cualquier bucket/página/filtro), no solo input:{}. Con
			// queryKey({input:{}}) la tabla activa (input lleno) quedaba stale.
			queryClient.invalidateQueries({
				queryKey: orpc.getCreditosPorBucket.key(),
			});
			queryClient.invalidateQueries({
				queryKey: orpc.getHistorialReasignaciones.key(),
			});
			onClose();
		},
		onError: (err: Error) => toast.error(err.message),
	});

	const pool = poolQuery.data ?? [];
	const elegibles = pool.filter((a) => a.asesor_id !== credito.asesorId);
	// El pool NO está vacío pero el único elegible es el asesor actual: no hay a
	// quién reasignar dentro del bucket (mensaje distinto a "pool sin asesores").
	// isError se distingue de poolVacio: un fetch fallido NO es lo mismo que un
	// pool realmente vacío (mensaje distinto — review Codex).
	const soloElAsesorActual =
		!poolQuery.isLoading &&
		!poolQuery.isError &&
		pool.length > 0 &&
		elegibles.length === 0;
	const poolVacio =
		!poolQuery.isLoading && !poolQuery.isError && pool.length === 0;
	const placeholderAsesor = poolQuery.isLoading
		? "Cargando..."
		: poolQuery.isError
			? "Error al cargar asesores"
			: soloElAsesorActual
				? "No hay otros asesores en este bucket"
				: poolVacio
					? "El bucket no tiene asesores en su pool"
					: "Selecciona un asesor";
	const motivoValido = motivo.trim().length > 0;
	const puedeGuardar = !!asesorNuevoId && motivoValido && !mutation.isPending;

	return (
		<Dialog open onOpenChange={(o) => !o && onClose()}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Reasignar asesor</DialogTitle>
				</DialogHeader>

				<dl className="space-y-1.5 rounded-md border bg-muted/40 p-3 text-sm">
					<div className="flex justify-between gap-4">
						<dt className="text-muted-foreground">Crédito</dt>
						<dd className="text-right font-medium">
							{credito.numeroCreditoSifco}
						</dd>
					</div>
					<div className="flex justify-between gap-4">
						<dt className="text-muted-foreground">Cliente</dt>
						<dd className="text-right font-medium">{credito.cliente}</dd>
					</div>
					<div className="flex justify-between gap-4">
						<dt className="text-muted-foreground">Asesor actual</dt>
						<dd className="text-right font-medium">
							{credito.asesorNombre ?? "Sin asesor"}
						</dd>
					</div>
				</dl>

				<div className="space-y-4 py-2">
					<div className="space-y-2">
						<Label>Nuevo asesor (elegibles del bucket)</Label>
						<Select value={asesorNuevoId} onValueChange={setAsesorNuevoId}>
							<SelectTrigger className="w-full">
								<SelectValue placeholder={placeholderAsesor} />
							</SelectTrigger>
							<SelectContent className="w-(--radix-select-trigger-width)">
								{elegibles.map((a) => (
									<SelectItem key={a.asesor_id} value={String(a.asesor_id)}>
										{a.nombre}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						{poolQuery.isError && (
							<p className="text-destructive text-xs">
								No se pudo cargar el pool de asesores de este bucket. Intenta de
								nuevo.
							</p>
						)}
						{!poolQuery.isError && (soloElAsesorActual || poolVacio) && (
							<p className="text-muted-foreground text-xs">
								{soloElAsesorActual
									? "Este bucket solo tiene un asesor en su pool. Agrega otro asesor al pool del bucket para poder reasignar."
									: "Este bucket no tiene asesores configurados en su pool."}
							</p>
						)}
					</div>

					<div className="space-y-2">
						<Label>Motivo (obligatorio)</Label>
						<Textarea
							value={motivo}
							onChange={(e) => setMotivo(e.target.value)}
							placeholder="Explica por qué se reasigna este crédito..."
							rows={3}
						/>
					</div>

					<div className="space-y-2 border-t pt-3">
						<p className="font-semibold text-muted-foreground text-xs uppercase tracking-wide">
							Reasignaciones manuales previas
						</p>
						{histQuery.isLoading ? (
							<p className="text-muted-foreground text-xs">Cargando...</p>
						) : histQuery.isError ? (
							<p className="text-destructive text-xs">
								No se pudo cargar el historial de este crédito.
							</p>
						) : historial.length === 0 ? (
							<p className="text-muted-foreground text-xs italic">
								Esta cuenta no ha sido reasignada manualmente antes.
							</p>
						) : (
							<ul className="max-h-48 space-y-2 overflow-y-auto">
								{historial.map((h) => (
									<li
										key={h.historial_id}
										className="rounded-md border bg-muted/40 p-2.5 text-xs"
									>
										<div className="mb-1 flex items-center justify-between text-muted-foreground">
											<span className="font-medium">{fmtFecha(h.fecha)}</span>
											<span>{h.usuario || "sistema"}</span>
										</div>
										<div className="flex items-center gap-1.5">
											<span className="text-muted-foreground">
												{h.asesor_anterior ?? "Sin asesor"}
											</span>
											<span className="text-muted-foreground">→</span>
											<span className="font-semibold text-foreground">
												{h.asesor_nuevo ?? "—"}
											</span>
										</div>
										{h.motivo ? (
											<p className="mt-1 text-muted-foreground italic">
												“{h.motivo}”
											</p>
										) : null}
									</li>
								))}
							</ul>
						)}
					</div>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={onClose}>
						Cancelar
					</Button>
					<Button disabled={!puedeGuardar} onClick={() => mutation.mutate()}>
						{mutation.isPending ? "Reasignando..." : "Reasignar"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function OrigenBadge({ origen }: { origen: string }) {
	const esManual = origen === "API_MANUAL";
	return (
		<Badge
			variant="outline"
			className={
				esManual
					? "border-amber-300 bg-amber-50 text-amber-700"
					: "border-slate-300 bg-slate-50 text-slate-600"
			}
		>
			{esManual ? "Manual" : "Automático"}
		</Badge>
	);
}

function HistorialReasignaciones() {
	const [origen, setOrigen] = useState<string>("todos");
	const [bucket, setBucket] = useState<string>("todos");
	const [asesor, setAsesor] = useState<string>("todos");
	const [sifcoInput, setSifcoInput] = useState("");
	const [sifco, setSifco] = useState("");
	const [page, setPage] = useState(1);
	const pageSize = 20;

	// getAsesores limita perPage a 100 en el server; se pagina hasta traer
	// todos los asesores para que el Select pueda filtrar por cualquiera,
	// no solo los primeros 100.
	const asesoresQuery = useQuery({
		queryKey: ["cobros", "asesores-todos"],
		queryFn: async () => {
			const perPage = 100;
			const todos: Awaited<
				ReturnType<typeof client.getAsesores>
			>["asesores"] = [];
			let page = 1;
			let hayMasPaginas = true;
			while (hayMasPaginas) {
				const respuesta = await client.getAsesores({ page, perPage });
				todos.push(...respuesta.asesores);
				hayMasPaginas = page < respuesta.pagination.totalPages;
				page++;
			}
			return todos;
		},
	});
	const asesores = asesoresQuery.data ?? [];

	const query = useQuery(
		orpc.getHistorialReasignaciones.queryOptions({
			input: {
				origen:
					origen === "todos"
						? undefined
						: (origen as "PROCESO_AUTO" | "API_MANUAL"),
				bucket: bucket === "todos" ? undefined : Number(bucket),
				asesorId: asesor === "todos" ? undefined : Number(asesor),
				numeroCredito: sifco || undefined,
				page,
				pageSize,
			},
		}),
	);

	// El backend ya excluye la siembra inicial de COBROS-02 (review Codex:
	// filtrar client-side después de paginar desalineaba "Página X de Y" y el
	// resumen, que contaban filas ya excluidas visualmente, con lo mostrado).
	const rows = query.data?.data ?? [];
	const resumen = query.data?.resumen;
	const totalPages = query.data?.pagination?.totalPages ?? 1;

	const aplicar = () => {
		setSifco(sifcoInput.trim());
		setPage(1);
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-base">Historial de reasignaciones</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="flex flex-wrap items-end gap-4">
					<div className="space-y-2">
						<Label>Origen</Label>
						<Select
							value={origen}
							onValueChange={(v) => {
								setOrigen(v);
								setPage(1);
							}}
						>
							<SelectTrigger className="w-[160px]">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="todos">Todos</SelectItem>
								<SelectItem value="API_MANUAL">Manual</SelectItem>
								<SelectItem value="PROCESO_AUTO">Automático</SelectItem>
							</SelectContent>
						</Select>
					</div>
					<div className="space-y-2">
						<Label>Bucket</Label>
						<Select
							value={bucket}
							onValueChange={(v) => {
								setBucket(v);
								setPage(1);
							}}
						>
							<SelectTrigger className="w-[200px]">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="todos">Todos</SelectItem>
								{BUCKETS_FILTRO.map((b) => (
									<SelectItem key={b.numero} value={String(b.numero)}>
										{b.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<div className="space-y-2">
						<Label>Asesor nuevo</Label>
						<Select
							value={asesor}
							onValueChange={(v) => {
								setAsesor(v);
								setPage(1);
							}}
						>
							<SelectTrigger className="w-[180px]">
								<SelectValue placeholder="Todos los asesores" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="todos">Todos</SelectItem>
								{asesores.map((a) => (
									<SelectItem key={a.asesorId} value={String(a.asesorId)}>
										{a.nombre}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						{asesoresQuery.isError && (
							<p className="text-destructive text-xs">
								No se pudo cargar la lista de asesores; el filtro no está
								disponible.
							</p>
						)}
					</div>
					<div className="space-y-2">
						<Label>No. SIFCO</Label>
						<Input
							placeholder="Buscar SIFCO..."
							value={sifcoInput}
							onChange={(e) => setSifcoInput(e.target.value)}
							onKeyDown={(e) => e.key === "Enter" && aplicar()}
							className="w-[180px]"
						/>
					</div>
					<Button variant="outline" onClick={aplicar}>
						<Search className="mr-1 h-4 w-4" /> Buscar
					</Button>
				</div>

				{resumen && (
					<div className="flex flex-wrap gap-4 text-sm">
						<span className="text-muted-foreground">
							Total: <b className="text-foreground">{resumen.total}</b>
						</span>
						<span className="text-muted-foreground">
							Manuales: <b className="text-amber-700">{resumen.manuales}</b>
						</span>
						<span className="text-muted-foreground">
							Automáticos:{" "}
							<b className="text-slate-700">{resumen.automaticos}</b>
						</span>
					</div>
				)}

				{query.isLoading ? (
					<div className="py-10 text-center text-muted-foreground">
						Cargando...
					</div>
				) : query.isError ? (
					<div className="py-10 text-center text-destructive">
						Error al cargar el historial de reasignaciones
					</div>
				) : rows.length === 0 ? (
					<div className="py-10 text-center text-muted-foreground">
						No hay reasignaciones para los filtros seleccionados
					</div>
				) : (
					<div className="overflow-x-auto">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Fecha</TableHead>
									<TableHead>No. SIFCO</TableHead>
									<TableHead>Cliente</TableHead>
									<TableHead>Cambio de asesor</TableHead>
									<TableHead className="text-center">Bucket</TableHead>
									<TableHead className="text-center">Origen</TableHead>
									<TableHead>Motivo</TableHead>
									<TableHead>Usuario</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{rows.map((r) => (
									<TableRow key={r.historial_id}>
										<TableCell className="whitespace-nowrap text-muted-foreground text-xs">
											{fmtFecha(r.fecha)}
										</TableCell>
										<TableCell className="font-medium text-xs">
											{r.numero_credito_sifco}
										</TableCell>
										<TableCell>{r.cliente}</TableCell>
										<TableCell className="text-xs">
											<span className="text-muted-foreground">
												{r.asesor_anterior ?? "Sin asesor"}
											</span>{" "}
											→{" "}
											<span className="font-semibold">
												{r.asesor_nuevo ?? "—"}
											</span>
										</TableCell>
										<TableCell className="text-center">
											<BucketBadge
												bucket={
													r.bucket !== null
														? {
																numero: r.bucket,
																prefijo: r.bucket_prefijo ?? `B${r.bucket}`,
																nombre: r.bucket_nombre ?? "",
																color: null,
															}
														: null
												}
											/>
										</TableCell>
										<TableCell className="text-center">
											<OrigenBadge origen={r.origen} />
										</TableCell>
										<TableCell
											className="max-w-[240px] truncate text-muted-foreground text-xs"
											title={r.motivo ?? undefined}
										>
											{r.motivo || "—"}
										</TableCell>
										<TableCell className="text-muted-foreground text-xs">
											{r.usuario || "sistema"}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				)}

				<div className="flex items-center justify-between">
					<span className="text-muted-foreground text-sm">
						Página {page} de {totalPages}
					</span>
					<div className="flex gap-2">
						<Button
							variant="outline"
							size="sm"
							disabled={page <= 1}
							onClick={() => setPage((p) => p - 1)}
						>
							Anterior
						</Button>
						<Button
							variant="outline"
							size="sm"
							disabled={page >= totalPages}
							onClick={() => setPage((p) => p + 1)}
						>
							Siguiente
						</Button>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}

function RouteComponent() {
	const { data: session } = authClient.useSession();
	const userRole = session?.user.role;

	const [bucket, setBucket] = useState<string>("todos");
	const [buscarInput, setBuscarInput] = useState("");
	const [buscar, setBuscar] = useState("");
	const [page, setPage] = useState(1);
	const [seleccionado, setSeleccionado] = useState<CreditoFila | null>(null);
	const perPage = 20;

	const bucketNumero = bucket === "todos" ? undefined : Number(bucket);

	const query = useQuery({
		...orpc.getCreditosPorBucket.queryOptions({
			input: {
				bucket: bucketNumero,
				page,
				perPage,
				numeroCredito: buscar || undefined,
			},
		}),
		enabled: !!session,
	});

	if (!userRole || !PERMISSIONS.canAssignCobros(userRole)) {
		return (
			<div className="flex min-h-screen items-center justify-center">
				<div className="text-center text-muted-foreground">
					No tienes permiso para acceder a esta página.
				</div>
			</div>
		);
	}

	const filas = (query.data?.data ?? []) as CreditoFila[];
	const totalPages = query.data?.totalPages ?? 1;

	const aplicarBusqueda = () => {
		setBuscar(buscarInput.trim());
		setPage(1);
	};

	return (
		<div className="container mx-auto space-y-6 p-4 md:p-8">
			<div className="flex items-center gap-2">
				<UserCog className="h-6 w-6" />
				<h1 className="font-bold text-2xl">
					Buckets — Reasignación de cuentas
				</h1>
			</div>
			<p className="text-muted-foreground text-sm">
				Créditos por bucket. Reasigna manualmente el asesor a un elegible del
				pool del bucket (motivo obligatorio, queda auditado).
			</p>

			<Tabs defaultValue="buckets">
				<TabsList>
					<TabsTrigger value="buckets">Buckets</TabsTrigger>
					<TabsTrigger value="historial">
						Historial de reasignaciones
					</TabsTrigger>
				</TabsList>

				<TabsContent value="buckets" className="space-y-6">
					<Card>
						<CardHeader>
							<CardTitle className="text-base">Filtros</CardTitle>
						</CardHeader>
						<CardContent className="flex flex-wrap items-end gap-4">
							<div className="space-y-2">
								<Label>Bucket</Label>
								<Select
									value={bucket}
									onValueChange={(v) => {
										setBucket(v);
										setPage(1);
									}}
								>
									<SelectTrigger className="w-[220px]">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="todos">Todos</SelectItem>
										{BUCKETS_FILTRO.map((b) => (
											<SelectItem key={b.numero} value={String(b.numero)}>
												{b.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div className="min-w-[200px] flex-1 space-y-2">
								<Label>No. SIFCO</Label>
								<Input
									placeholder="Buscar por número de crédito..."
									value={buscarInput}
									onChange={(e) => setBuscarInput(e.target.value)}
									onKeyDown={(e) => e.key === "Enter" && aplicarBusqueda()}
								/>
							</div>
							<Button variant="outline" onClick={aplicarBusqueda}>
								<Search className="mr-1 h-4 w-4" /> Buscar
							</Button>
						</CardContent>
					</Card>

					<Card>
						<CardContent className="p-0">
							{query.isLoading ? (
								<div className="py-16 text-center text-muted-foreground">
									Cargando...
								</div>
							) : query.isError ? (
								<div className="py-16 text-center text-destructive">
									Error al cargar los créditos
								</div>
							) : filas.length === 0 ? (
								<div className="py-16 text-center text-muted-foreground">
									No hay créditos para los filtros seleccionados
								</div>
							) : (
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>No. SIFCO</TableHead>
											<TableHead>Cliente</TableHead>
											<TableHead>Asesor actual</TableHead>
											<TableHead className="text-center">Bucket</TableHead>
											<TableHead className="text-right">Acción</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{filas.map((c) => (
											<TableRow key={c.creditoId}>
												<TableCell className="font-medium">
													{c.numeroCreditoSifco}
												</TableCell>
												<TableCell>{c.cliente}</TableCell>
												<TableCell>
													{c.asesorNombre ?? (
														<span className="text-muted-foreground italic">
															Sin asesor
														</span>
													)}
												</TableCell>
												<TableCell className="text-center">
													<BucketBadge bucket={c.bucket} />
												</TableCell>
												<TableCell className="text-right">
													<Button
														size="sm"
														variant="outline"
														onClick={() => setSeleccionado(c)}
													>
														Reasignar
													</Button>
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							)}
						</CardContent>
					</Card>

					<div className="flex items-center justify-between">
						<span className="text-muted-foreground text-sm">
							Página {page} de {totalPages}
						</span>
						<div className="flex gap-2">
							<Button
								variant="outline"
								size="sm"
								disabled={page <= 1}
								onClick={() => setPage((p) => p - 1)}
							>
								Anterior
							</Button>
							<Button
								variant="outline"
								size="sm"
								disabled={page >= totalPages}
								onClick={() => setPage((p) => p + 1)}
							>
								Siguiente
							</Button>
						</div>
					</div>
				</TabsContent>

				<TabsContent value="historial">
					<HistorialReasignaciones />
				</TabsContent>
			</Tabs>

			{seleccionado && (
				<ReasignarModal
					credito={seleccionado}
					onClose={() => setSeleccionado(null)}
				/>
			)}
		</div>
	);
}

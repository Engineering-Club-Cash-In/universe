import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { LayoutDashboard, Loader2, Pencil } from "lucide-react";
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
import { Progress } from "@/components/ui/progress";
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
import { estiloBucket } from "@/lib/cobros/buckets-catalogo";
import { PERMISSIONS } from "@/lib/roles";
import { orpc, queryClient } from "@/utils/orpc";

export const Route = createFileRoute("/cobros/carga")({
	component: RouteComponent,
});

// Buckets del funnel operativo B0-B5 (clave estable del motor), igual patrón
// que reasignaciones.tsx — solo alimenta el selector de filtro. El label real
// por fila viene del objeto bucket que trae cada respuesta del endpoint.
const BUCKETS_FILTRO: { numero: number; label: string }[] = [
	{ numero: 0, label: "B0 · Cartera Sana" },
	{ numero: 1, label: "B1 · Alerta Temprana" },
	{ numero: 2, label: "B2 · Gestión Activa" },
	{ numero: 3, label: "B3 · Rescate" },
	{ numero: 4, label: "B4 · Última Instancia / Pre Jurídico" },
	{ numero: 5, label: "B5 · Jurídico" },
];

// El color depende de las banderas que YA resolvió el backend (sobrecarga /
// alerta_nueva_posicion), no de comparar % contra un umbral propio — el
// margen que dispara la alerta puede ser % o cantidad fija (asesor_bucket.
// margen_alerta_tipo/valor), así que "pct >= umbral" ya no es válido en
// general. Rojo = sobrecarga (pasó capacidad_base), ámbar = alerta (pasó
// capacidad_base + margen), verde = normal.
function claseUtilizacion(sobrecarga: boolean, alerta: boolean): string {
	if (sobrecarga) return "bg-red-500";
	if (alerta) return "bg-amber-500";
	return "bg-emerald-500";
}

function textoUtilizacion(sobrecarga: boolean, alerta: boolean): string {
	if (sobrecarga) return "text-red-600";
	if (alerta) return "text-amber-600";
	return "text-emerald-600";
}

function BucketBadge({
	prefijo,
	nombre,
	color,
}: {
	prefijo: string;
	nombre: string;
	color: string | null;
}) {
	return (
		<Badge variant="outline" style={color ? estiloBucket(color) : undefined}>
			{prefijo} · {nombre}
		</Badge>
	);
}

function BarraUtilizacion({
	pct,
	sobrecarga,
	alerta,
}: {
	pct: number;
	sobrecarga: boolean;
	alerta: boolean;
}) {
	return (
		<div className="flex items-center gap-2">
			<div className="relative w-28">
				<Progress value={Math.min(pct, 100)} className="h-2.5" />
				<div
					className={`absolute top-0 left-0 h-2.5 rounded-full ${claseUtilizacion(sobrecarga, alerta)}`}
					style={{ width: `${Math.min(pct, 100)}%` }}
				/>
			</div>
			<span
				className={`font-medium text-sm ${textoUtilizacion(sobrecarga, alerta)}`}
			>
				{pct.toFixed(1)}%
			</span>
		</div>
	);
}

// CB-019 (review) · Mismos topes que el server (cobros.ts actualizarCapacidadAsesorBucket
// + actualizarAsesorBucket.ts en cartera-back) — validar acá es solo UX, el
// server sigue siendo la fuente de verdad. Devuelve el motivo por el que no
// se puede guardar, o null si todo es válido.
function motivoInvalido(
	capacidad: string,
	margenTipo: "porcentaje" | "fijo",
	margenValor: string,
): string | null {
	const capacidadNum = Number(capacidad);
	if (capacidad.trim() === "" || !Number.isFinite(capacidadNum)) {
		return "Capacidad máxima debe ser un número";
	}
	if (!Number.isInteger(capacidadNum) || capacidadNum <= 0) {
		return "Capacidad máxima debe ser un entero mayor a 0";
	}
	if (capacidadNum > 2000) {
		return "Capacidad máxima no puede ser mayor a 2000";
	}
	const margenNum = Number(margenValor);
	if (margenValor.trim() === "" || !Number.isFinite(margenNum)) {
		return "Valor de margen debe ser un número";
	}
	if (margenNum < 0) {
		return "Valor de margen no puede ser negativo";
	}
	if (margenTipo === "porcentaje" && margenNum > 100) {
		return "Valor de margen no puede ser mayor a 100 cuando es porcentaje";
	}
	if (margenTipo === "fijo" && margenNum > 500) {
		return "Valor de margen no puede ser mayor a 500 cuando es fijo";
	}
	return null;
}

// CB-019 · Modal de edición de capacidad_base/margen_alerta por asesor+bucket.
// Antes solo editable a mano por SQL (ver cargaAsesorBucket.ts) — este modal
// es el único camino de escritura, vía PATCH /buckets/asesor-bucket/:id/:bucket.
function EditarCapacidadDialog({
	asesorId,
	nombre,
	bucket,
	capacidadBase,
	margenAlertaTipo,
	margenAlertaValor,
	open,
	onOpenChange,
}: {
	asesorId: number;
	nombre: string;
	bucket: number;
	capacidadBase: number;
	margenAlertaTipo: "porcentaje" | "fijo";
	margenAlertaValor: number;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const [capacidad, setCapacidad] = useState(String(capacidadBase));
	const [margenTipo, setMargenTipo] = useState<"porcentaje" | "fijo">(
		margenAlertaTipo,
	);
	const [margenValor, setMargenValor] = useState(String(margenAlertaValor));
	const error = motivoInvalido(capacidad, margenTipo, margenValor);

	const mutation = useMutation({
		...orpc.actualizarCapacidadAsesorBucket.mutationOptions(),
		onSuccess: () => {
			toast.success("Capacidad actualizada");
			// .key() = prefijo del path → invalida TODAS las variantes de la query
			// (cualquier bucket filtrado), no solo input:{} (review code-review:
			// mismo patrón documentado en reasignaciones.tsx:145-149 — con
			// queryOptions({input:{}}).queryKey la tabla con filtro activo quedaba
			// stale tras guardar).
			queryClient.invalidateQueries({
				queryKey: orpc.getCargaPorAsesorBucket.key(),
			});
			onOpenChange(false);
		},
		onError: (error: Error) => {
			toast.error(error.message);
		},
	});

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) {
					setCapacidad(String(capacidadBase));
					setMargenTipo(margenAlertaTipo);
					setMargenValor(String(margenAlertaValor));
				}
				onOpenChange(next);
			}}
		>
			<DialogContent className="sm:max-w-sm">
				<DialogHeader>
					<DialogTitle>
						Capacidad — {nombre} · B{bucket}
					</DialogTitle>
				</DialogHeader>
				<div className="space-y-4">
					<div className="space-y-1.5">
						<Label htmlFor="capacidad-base">Capacidad máxima (cuentas)</Label>
						<Input
							id="capacidad-base"
							type="number"
							min="1"
							value={capacidad}
							onChange={(e) => setCapacidad(e.target.value)}
						/>
					</div>
					<div className="grid grid-cols-2 gap-3">
						<div className="space-y-1.5">
							<Label htmlFor="margen-tipo">Margen de alerta</Label>
							<Select
								value={margenTipo}
								onValueChange={(v) => setMargenTipo(v as "porcentaje" | "fijo")}
							>
								<SelectTrigger id="margen-tipo">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="porcentaje">Porcentaje</SelectItem>
									<SelectItem value="fijo">Cuentas fijas</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="margen-valor">
								Valor {margenTipo === "porcentaje" ? "(%)" : "(cuentas)"}
							</Label>
							<Input
								id="margen-valor"
								type="number"
								min="0"
								value={margenValor}
								onChange={(e) => setMargenValor(e.target.value)}
							/>
						</div>
					</div>
				</div>
				<DialogFooter className="sm:flex-col sm:items-end sm:gap-2">
					{error && <p className="text-destructive text-xs">{error}</p>}
					<Button
						disabled={mutation.isPending || !!error}
						onClick={() =>
							mutation.mutate({
								asesorId,
								bucket,
								capacidadBase: Number(capacidad),
								margenAlertaTipo: margenTipo,
								margenAlertaValor: Number(margenValor),
							})
						}
					>
						{mutation.isPending ? (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						) : null}
						Guardar
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function RouteComponent() {
	const { data: session } = authClient.useSession();
	const userRole = session?.user.role;

	const [bucket, setBucket] = useState<string>("todos");
	const bucketNumero = bucket === "todos" ? undefined : Number(bucket);
	const [editando, setEditando] = useState<{
		asesorId: number;
		nombre: string;
		bucket: number;
		capacidadBase: number;
		margenAlertaTipo: "porcentaje" | "fijo";
		margenAlertaValor: number;
	} | null>(null);

	const query = useQuery({
		...orpc.getCargaPorAsesorBucket.queryOptions({
			input: { bucket: bucketNumero },
		}),
		enabled: !!session,
	});

	// Gate solo de UX (ocultar la página) — la seguridad real vive en el
	// procedure oRPC getCargaPorAsesorBucket (requireCobrosSupervisor,
	// server/src/lib/orpc.ts), que es 1 de 3 gates independientes protegiendo
	// esta ruta de datos. Ver el mapa completo en cartera-back/src/routers/
	// buckets.ts (requireBucketsRole).
	if (!userRole || !PERMISSIONS.canAssignCobros(userRole)) {
		return (
			<div className="flex min-h-screen items-center justify-center">
				<div className="text-center text-muted-foreground">
					No tienes permiso para acceder a esta página.
				</div>
			</div>
		);
	}

	const buckets = query.data?.buckets ?? [];
	const porAsesor = query.data?.porAsesor ?? [];

	// Capacidad/% utilización/sobrecarga son SIEMPRE por asesor+bucket (ticket,
	// confirmado con el informador: el techo de 300 es "la cantidad que puede
	// atender un asesor", no un agregado del bucket completo). Los KPIs
	// globales suman/promedian sobre el detalle por asesor, no sobre buckets[].
	const filasAsesorBucket = porAsesor.flatMap((a) => a.porBucket);
	const cuentasTotales = filasAsesorBucket.reduce((s, d) => s + d.cuentas, 0);
	const capacidadTotal = filasAsesorBucket.reduce(
		(s, d) => s + d.capacidad_base,
		0,
	);
	const utilizacionGlobalPct =
		capacidadTotal > 0
			? Math.round((cuentasTotales / capacidadTotal) * 1000) / 10
			: 0;
	const asesoresEnAlerta = filasAsesorBucket.filter(
		(d) => d.alerta_nueva_posicion,
	).length;
	const asesoresSobrecargados = filasAsesorBucket.filter(
		(d) => d.sobrecarga,
	).length;

	// Filas planas asesor × bucket para la tabla de reparto (con capacidad y
	// utilización propias de esa combinación). El servidor ya filtra por
	// bucketNumero (input del query, línea de arriba) — porBucket llega
	// acotado, no hace falta re-filtrar aquí.
	const filas = porAsesor.flatMap((a) =>
		a.porBucket.map((d) => ({
			asesorId: a.asesor_id,
			nombre: a.nombre,
			emailAsesor: a.email_asesor,
			...d,
		})),
	);

	return (
		<div className="container mx-auto space-y-6 p-4 md:p-8">
			<div className="flex items-center gap-2">
				<LayoutDashboard className="h-6 w-6" />
				<h1 className="font-bold text-2xl">Carga de Cuentas por Asesor</h1>
			</div>
			<p className="text-muted-foreground text-sm">
				Cuentas activas por asesor y bucket, capacidad base, % de utilización y
				alertas de sobrecarga — para decidir nuevas posiciones. El techo es por
				asesor dentro de cada bucket.
			</p>

			{query.isError && (
				<p className="text-destructive text-sm">
					No se pudo cargar la carga por asesor y bucket. Intenta de nuevo.
				</p>
			)}

			<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="font-medium text-muted-foreground text-sm">
							Cuentas totales
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="font-bold text-2xl">{cuentasTotales}</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="font-medium text-muted-foreground text-sm">
							Capacidad total (asesores)
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="font-bold text-2xl">{capacidadTotal}</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="font-medium text-muted-foreground text-sm">
							% Utilización global
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div
							className={`font-bold text-2xl ${textoUtilizacion(asesoresSobrecargados > 0, asesoresEnAlerta > 0)}`}
						>
							{utilizacionGlobalPct.toFixed(1)}%
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="font-medium text-muted-foreground text-sm">
							Alertas de nueva posición
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div
							className={`font-bold text-2xl ${asesoresEnAlerta > 0 ? "text-red-600" : ""}`}
						>
							{asesoresEnAlerta}
						</div>
						<p className="text-muted-foreground text-xs">
							{asesoresSobrecargados} asesor(es) sobrecargado(s)
						</p>
					</CardContent>
				</Card>
			</div>

			<Card>
				<CardHeader>
					<CardTitle className="text-base">Carga por bucket</CardTitle>
				</CardHeader>
				<CardContent>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Bucket</TableHead>
								<TableHead>Asesores en pool</TableHead>
								<TableHead>Cuentas totales</TableHead>
								<TableHead>Asesores en alerta</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{buckets.map((b) => (
								<TableRow key={b.numero}>
									<TableCell>
										<BucketBadge
											prefijo={b.prefijo}
											nombre={b.nombre}
											color={b.color}
										/>
									</TableCell>
									<TableCell>{b.asesores_en_pool}</TableCell>
									<TableCell>{b.cuentas_totales}</TableCell>
									<TableCell>
										{b.asesores_en_alerta > 0 ? (
											<Badge variant="destructive">
												{b.asesores_en_alerta} de {b.asesores_en_pool} en alerta
											</Badge>
										) : (
											<span className="text-muted-foreground text-xs">—</span>
										)}
									</TableCell>
								</TableRow>
							))}
							{buckets.length === 0 && !query.isLoading && (
								<TableRow>
									<TableCell
										colSpan={4}
										className="text-center text-muted-foreground"
									>
										Sin datos.
									</TableCell>
								</TableRow>
							)}
						</TableBody>
					</Table>
				</CardContent>
			</Card>

			<Card>
				<CardHeader className="flex flex-row items-center justify-between">
					<CardTitle className="text-base">Reparto por asesor</CardTitle>
					<Select value={bucket} onValueChange={setBucket}>
						<SelectTrigger className="w-56">
							<SelectValue placeholder="Bucket" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="todos">Todos los buckets</SelectItem>
							{BUCKETS_FILTRO.map((b) => (
								<SelectItem key={b.numero} value={String(b.numero)}>
									{b.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</CardHeader>
				<CardContent>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Asesor</TableHead>
								<TableHead>Bucket</TableHead>
								<TableHead>Cuentas</TableHead>
								<TableHead>Capacidad</TableHead>
								<TableHead>Utilización</TableHead>
								<TableHead className="w-10" />
							</TableRow>
						</TableHeader>
						<TableBody>
							{filas.map((f) => (
								<TableRow key={`${f.asesorId}-${f.bucket}`}>
									<TableCell>
										<div className="font-medium">{f.nombre}</div>
										{f.emailAsesor && (
											<div className="text-muted-foreground text-xs">
												{f.emailAsesor}
											</div>
										)}
									</TableCell>
									<TableCell>B{f.bucket}</TableCell>
									<TableCell>
										{f.cuentas}
										{f.sobrecarga && (
											<Badge variant="destructive" className="ml-2">
												Sobrecarga
											</Badge>
										)}
									</TableCell>
									<TableCell>{f.capacidad_base}</TableCell>
									<TableCell>
										<BarraUtilizacion
											pct={f.utilizacion_pct}
											sobrecarga={f.sobrecarga}
											alerta={f.alerta_nueva_posicion}
										/>
									</TableCell>
									<TableCell>
										{userRole === "admin" && (
											<Button
												variant="ghost"
												size="icon"
												disabled={!f.elegible}
												title={
													f.elegible
														? undefined
														: "Este asesor no tiene una fila activa en el pool de este bucket — no se puede editar su capacidad"
												}
												onClick={() =>
													setEditando({
														asesorId: f.asesorId,
														nombre: f.nombre,
														bucket: f.bucket,
														capacidadBase: f.capacidad_base,
														margenAlertaTipo: f.margen_alerta_tipo,
														margenAlertaValor: f.margen_alerta_valor,
													})
												}
											>
												<Pencil className="h-4 w-4" />
											</Button>
										)}
									</TableCell>
								</TableRow>
							))}
							{filas.length === 0 && !query.isLoading && (
								<TableRow>
									<TableCell
										colSpan={6}
										className="text-center text-muted-foreground"
									>
										Sin datos.
									</TableCell>
								</TableRow>
							)}
						</TableBody>
					</Table>
				</CardContent>
			</Card>

			{editando && (
				<EditarCapacidadDialog
					key={`${editando.asesorId}-${editando.bucket}`}
					asesorId={editando.asesorId}
					nombre={editando.nombre}
					bucket={editando.bucket}
					capacidadBase={editando.capacidadBase}
					margenAlertaTipo={editando.margenAlertaTipo}
					margenAlertaValor={editando.margenAlertaValor}
					open={!!editando}
					onOpenChange={(next) => {
						if (!next) setEditando(null);
					}}
				/>
			)}
		</div>
	);
}

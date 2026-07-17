import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { LayoutDashboard } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { orpc } from "@/utils/orpc";

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
		<Badge
			variant="outline"
			style={color ? estiloBucket(color) : undefined}
		>
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
			<span className={`font-medium text-sm ${textoUtilizacion(sobrecarga, alerta)}`}>
				{pct.toFixed(1)}%
			</span>
		</div>
	);
}

function RouteComponent() {
	const { data: session } = authClient.useSession();
	const userRole = session?.user.role;

	const [bucket, setBucket] = useState<string>("todos");
	const bucketNumero = bucket === "todos" ? undefined : Number(bucket);

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
	const capacidadTotal = filasAsesorBucket.reduce((s, d) => s + d.capacidad_base, 0);
	const utilizacionGlobalPct =
		capacidadTotal > 0 ? Math.round((cuentasTotales / capacidadTotal) * 1000) / 10 : 0;
	const asesoresEnAlerta = filasAsesorBucket.filter((d) => d.alerta_nueva_posicion).length;
	const asesoresSobrecargados = filasAsesorBucket.filter((d) => d.sobrecarga).length;

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
				Cuentas activas por asesor y bucket, capacidad base, % de
				utilización y alertas de sobrecarga — para decidir nuevas
				posiciones. El techo es por asesor dentro de cada bucket.
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
												{b.asesores_en_alerta} de {b.asesores_en_pool} en
												alerta
											</Badge>
										) : (
											<span className="text-muted-foreground text-xs">—</span>
										)}
									</TableCell>
								</TableRow>
							))}
							{buckets.length === 0 && !query.isLoading && (
								<TableRow>
									<TableCell colSpan={4} className="text-center text-muted-foreground">
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
								</TableRow>
							))}
							{filas.length === 0 && !query.isLoading && (
								<TableRow>
									<TableCell colSpan={5} className="text-center text-muted-foreground">
										Sin datos.
									</TableCell>
								</TableRow>
							)}
						</TableBody>
					</Table>
				</CardContent>
			</Card>
		</div>
	);
}

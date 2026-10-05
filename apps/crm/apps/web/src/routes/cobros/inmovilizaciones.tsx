import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	Check,
	ChevronLeft,
	ChevronRight,
	FileText,
	Loader2,
	Lock,
	LockOpen,
	X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DecisionInmovilizacionModal } from "@/components/cobros/inmovilizacion-decision-modal";
import { RespaldoReactivacionResumen } from "@/components/cobros/inmovilizacion-respaldo";
import { UbicacionGuardada } from "@/components/cobros/inmovilizacion-ubicacion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
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
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { authClient } from "@/lib/auth-client";
import { PERMISSIONS } from "@/lib/roles";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/cobros/inmovilizaciones")({
	component: InmovilizacionesPage,
});

/**
 * CB-041 — Cola del supervisor: solicitudes de apagado/reactivación
 * pendientes de aprobación, y aprobadas pendientes de que LEGION las
 * ejecute (modo manual, ver services/inmovilizacion/ejecutor.ts).
 */
function InmovilizacionesPage() {
	// `isPending`: mientras la sesión carga, `userRole` es undefined y sin
	// distinguirlo se pinta "sin permiso" un instante a un supervisor
	// legítimo — mismo patrón que apertura.tsx.
	const { data: session, isPending: sesionCargando } = authClient.useSession();
	const userRole = session?.user?.role;

	if (sesionCargando) {
		return (
			<div className="flex min-h-[50vh] items-center justify-center text-muted-foreground">
				<Loader2 className="mr-2 h-5 w-5 animate-spin" />
				Cargando…
			</div>
		);
	}

	if (!userRole || !PERMISSIONS.canAssignCobros(userRole)) {
		return (
			<div className="p-6">
				<Card>
					<CardContent className="pt-6 text-center text-muted-foreground">
						No tiene permiso para ver esta página.
					</CardContent>
				</Card>
			</div>
		);
	}

	return (
		<div className="space-y-4 p-4 md:p-6">
			<div>
				<h1 className="font-semibold text-2xl">
					Apagado y reactivación de unidades
				</h1>
				<p className="text-muted-foreground text-sm">
					Solicitudes de apagado/reactivación pendientes de aprobación o de
					ejecución manual por LEGION.
				</p>
			</div>
			<Tabs className="w-full" defaultValue="cola">
				<TabsList>
					<TabsTrigger value="cola">Cola</TabsTrigger>
					<TabsTrigger value="historial">Historial</TabsTrigger>
				</TabsList>
				<TabsContent value="cola">
					<ColaInmovilizaciones />
				</TabsContent>
				<TabsContent value="historial">
					<HistorialInmovilizaciones />
				</TabsContent>
			</Tabs>
		</div>
	);
}

function ColaInmovilizaciones() {
	const queryClient = useQueryClient();
	const [decisionAbierta, setDecisionAbierta] = useState<{
		id: string;
		decision: "aprobar" | "rechazar";
		resumen: string;
	} | null>(null);

	const cola = useQuery({
		...orpc.getColaInmovilizaciones.queryOptions(),
		refetchOnWindowFocus: false,
	});

	const invalidar = () =>
		queryClient.invalidateQueries({
			queryKey: orpc.getColaInmovilizaciones.key(),
		});

	if (cola.isLoading) {
		return (
			<Card>
				<CardContent className="pt-6 text-center text-muted-foreground">
					Cargando...
				</CardContent>
			</Card>
		);
	}

	const todos = cola.data ?? [];
	const pendientes = todos.filter((i) => i.estado === "pendiente_aprobacion");
	const aprobadas = todos.filter((i) => i.estado === "aprobada");

	const resumenDe = (item: (typeof todos)[number]) =>
		`${item.accion === "apagado" ? "Apagado" : "Reactivación"} — ${item.clienteNombre ?? item.numeroCreditoSifco}`;

	return (
		<div className="space-y-4">
			<Card>
				<CardHeader>
					<CardTitle>Por aprobar</CardTitle>
					<CardDescription>
						{pendientes.length} solicitud{pendientes.length === 1 ? "" : "es"}{" "}
						esperando decisión.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{pendientes.length === 0 ? (
						<p className="py-6 text-center text-muted-foreground text-sm">
							No hay solicitudes pendientes.
						</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Cliente / Crédito</TableHead>
									<TableHead>Acción</TableHead>
									<TableHead>Motivo</TableHead>
									<TableHead>Solicitado por</TableHead>
									<TableHead className="text-right">Decisión</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{pendientes.map((item) => (
									<TableRow key={item.id}>
										<TableCell>
											<LinkFicha item={item} />
										</TableCell>
										<TableCell>
											<Badge
												variant={
													item.accion === "apagado"
														? "destructive"
														: "secondary"
												}
											>
												{item.accion === "apagado" ? (
													<Lock className="mr-1 h-3 w-3" />
												) : (
													<LockOpen className="mr-1 h-3 w-3" />
												)}
												{item.accion === "apagado" ? "Apagado" : "Reactivación"}
											</Badge>
										</TableCell>
										<TableCell className="max-w-72 text-sm">
											<p className="truncate" title={item.motivo}>
												{item.motivo}
											</p>
											{/* Dónde estaba el vehículo al solicitarlo (y si va en
											    marcha): lo que el supervisor mira antes de aprobar. */}
											<div className="mt-1 space-y-1">
												<UbicacionGuardada
													etiqueta="Ubicación al solicitar"
													ubicacion={item.ubicacionSolicitud}
												/>
												{item.accion === "reactivacion" && (
													<RespaldoReactivacionResumen
														bucket={
															item.bucketSnapshot != null
																? `B${item.bucketSnapshot} al solicitar`
																: null
														}
														quePaso={item.quePaso}
														respaldo={item.respaldoReactivacion}
													/>
												)}
											</div>
										</TableCell>
										<TableCell className="text-sm">
											{item.solicitanteNombre}
										</TableCell>
										<TableCell className="text-right">
											<div className="flex justify-end gap-2">
												<Button
													onClick={() =>
														setDecisionAbierta({
															id: item.id,
															decision: "aprobar",
															resumen: resumenDe(item),
														})
													}
													size="sm"
													variant="default"
												>
													<Check className="mr-1 h-4 w-4" />
													Aprobar
												</Button>
												<Button
													onClick={() =>
														setDecisionAbierta({
															id: item.id,
															decision: "rechazar",
															resumen: resumenDe(item),
														})
													}
													size="sm"
													variant="outline"
												>
													<X className="mr-1 h-4 w-4" />
													Rechazar
												</Button>
											</div>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Por ejecutar</CardTitle>
					<CardDescription>
						Aprobadas, esperando que LEGION las aplique. El asesor registra la
						ejecución desde la Ficha 360, con la confirmación de LEGION; aquí
						solo se muestra lo pendiente.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{aprobadas.length === 0 ? (
						<p className="py-6 text-center text-muted-foreground text-sm">
							No hay solicitudes aprobadas pendientes de ejecución.
						</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Cliente / Crédito</TableHead>
									<TableHead>Acción</TableHead>
									<TableHead className="text-right">Ejecución</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{aprobadas.map((item) => (
									<TableRow key={item.id}>
										<TableCell>
											<LinkFicha item={item} />
										</TableCell>
										<TableCell>
											<Badge
												variant={
													item.accion === "apagado"
														? "destructive"
														: "secondary"
												}
											>
												{item.accion === "apagado" ? (
													<Lock className="mr-1 h-3 w-3" />
												) : (
													<LockOpen className="mr-1 h-3 w-3" />
												)}
												{item.accion === "apagado" ? "Apagado" : "Reactivación"}
											</Badge>
										</TableCell>
										<TableCell className="text-right">
											<span className="text-muted-foreground text-xs">
												Lo registra el asesor en la Ficha 360
											</span>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			{decisionAbierta && (
				<DecisionInmovilizacionModal
					decision={decisionAbierta.decision}
					id={decisionAbierta.id}
					onOpenChange={(open) => !open && setDecisionAbierta(null)}
					onResuelto={invalidar}
					open={!!decisionAbierta}
					resumen={decisionAbierta.resumen}
				/>
			)}
		</div>
	);
}

function LinkFicha({
	item,
}: {
	item: {
		casoCobroId: string;
		clienteNombre: string | null;
		numeroCreditoSifco: string;
	};
}) {
	return (
		<Link
			className="block hover:underline"
			params={{ id: item.casoCobroId }}
			search={{ tipo: "caso" as const }}
			to="/cobros/$id"
		>
			<p className="font-medium text-primary">
				{item.clienteNombre ?? "Ver caso"}
			</p>
			<p className="font-mono text-muted-foreground text-xs">
				{item.numeroCreditoSifco}
			</p>
		</Link>
	);
}

const ESTADO_LABEL: Record<string, string> = {
	pendiente_aprobacion: "Pendiente de aprobación",
	aprobada: "Aprobada — por ejecutar",
	rechazada: "Rechazada",
	ejecutada: "Ejecutada",
	cancelada: "Cancelada",
};

const ESTADO_BADGE_VARIANT: Record<
	string,
	"default" | "secondary" | "destructive" | "outline"
> = {
	pendiente_aprobacion: "outline",
	aprobada: "secondary",
	rechazada: "destructive",
	ejecutada: "default",
	cancelada: "outline",
};

const PER_PAGE = 25;

function formatFechaGT(date: Date | string): string {
	return new Date(date).toLocaleDateString("es-GT", {
		timeZone: "America/Guatemala",
	});
}

/**
 * Historial COMPLETO de inmovilizaciones — todos los estados, de todos los
 * casos, con paginación (getHistorialInmovilizaciones). A diferencia de
 * ColaInmovilizaciones (solo pendiente_aprobacion/aprobada), acá se ve el
 * ciclo entero: rechazadas, canceladas, y ejecutadas con quién decidió y
 * quién ejecutó.
 */
function HistorialInmovilizaciones() {
	const [page, setPage] = useState(1);

	const historial = useQuery({
		...orpc.getHistorialInmovilizaciones.queryOptions({
			input: { page, perPage: PER_PAGE },
		}),
		refetchOnWindowFocus: false,
	});

	if (historial.isLoading) {
		return (
			<Card>
				<CardContent className="pt-6 text-center text-muted-foreground">
					Cargando...
				</CardContent>
			</Card>
		);
	}

	const items = historial.data?.items ?? [];
	const totalPages = historial.data?.totalPages ?? 1;
	const total = historial.data?.total ?? 0;

	return (
		<Card>
			<CardHeader>
				<CardTitle>Historial completo</CardTitle>
				<CardDescription>
					{total} solicitud{total === 1 ? "" : "es"} en total, de todos los
					estados.
				</CardDescription>
			</CardHeader>
			<CardContent>
				{items.length === 0 ? (
					<p className="py-6 text-center text-muted-foreground text-sm">
						No hay solicitudes registradas.
					</p>
				) : (
					<>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Cliente / Crédito</TableHead>
									<TableHead>Acción</TableHead>
									<TableHead>Estado</TableHead>
									<TableHead>Solicitado por</TableHead>
									<TableHead>Decidido por</TableHead>
									<TableHead>Ejecutado por</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{items.map((item) => (
									<TableRow key={item.id}>
										<TableCell>
											<LinkFicha item={item} />
										</TableCell>
										<TableCell>
											<Badge
												variant={
													item.accion === "apagado"
														? "destructive"
														: "secondary"
												}
											>
												{item.accion === "apagado" ? (
													<Lock className="mr-1 h-3 w-3" />
												) : (
													<LockOpen className="mr-1 h-3 w-3" />
												)}
												{item.accion === "apagado" ? "Apagado" : "Reactivación"}
											</Badge>
										</TableCell>
										<TableCell>
											<Badge
												variant={ESTADO_BADGE_VARIANT[item.estado] ?? "outline"}
											>
												{ESTADO_LABEL[item.estado] ?? item.estado}
											</Badge>
											{item.estado === "rechazada" && item.motivoRechazo && (
												<p className="mt-1 max-w-56 truncate text-muted-foreground text-xs">
													{item.motivoRechazo}
												</p>
											)}
										</TableCell>
										<TableCell className="text-sm">
											<p>{item.solicitanteNombre}</p>
											<p className="text-muted-foreground text-xs">
												{formatFechaGT(item.solicitadoAt)}
											</p>
										</TableCell>
										<TableCell className="text-sm">
											{item.decididoPorNombre ? (
												<>
													<p>{item.decididoPorNombre}</p>
													{item.decididoAt && (
														<p className="text-muted-foreground text-xs">
															{formatFechaGT(item.decididoAt)}
														</p>
													)}
												</>
											) : (
												<span className="text-muted-foreground">—</span>
											)}
										</TableCell>
										<TableCell className="text-sm">
											{item.ejecutadoPorNombre ? (
												<>
													<p>{item.ejecutadoPorNombre}</p>
													{item.ejecutadoAt && (
														<p className="text-muted-foreground text-xs">
															{formatFechaGT(item.ejecutadoAt)}
														</p>
													)}
													{item.referenciaEjecucion && (
														<p className="text-muted-foreground text-xs">
															Ref: {item.referenciaEjecucion}
														</p>
													)}
													{item.evidenciaUrl && (
														<a
															className="inline-flex items-center gap-1 text-primary text-xs hover:underline"
															href={item.evidenciaUrl}
															rel="noreferrer"
															target="_blank"
														>
															<FileText className="h-3.5 w-3.5" />
															{item.evidenciaNombreArchivo ?? "Confirmación"}
														</a>
													)}
													<UbicacionGuardada
														etiqueta="Ubicación al ejecutar"
														ubicacion={item.ubicacionEjecucion}
													/>
												</>
											) : (
												<span className="text-muted-foreground">—</span>
											)}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
						{totalPages > 1 && (
							<div className="mt-4 flex items-center justify-between border-t pt-4">
								<span className="text-muted-foreground text-sm">
									Página {page} de {totalPages}
								</span>
								<div className="flex items-center gap-2">
									<Button
										disabled={page <= 1}
										onClick={() => setPage((p) => p - 1)}
										size="sm"
										variant="outline"
									>
										<ChevronLeft className="h-4 w-4" />
										Anterior
									</Button>
									<Button
										disabled={page >= totalPages}
										onClick={() => setPage((p) => p + 1)}
										size="sm"
										variant="outline"
									>
										Siguiente
										<ChevronRight className="h-4 w-4" />
									</Button>
								</div>
							</div>
						)}
					</>
				)}
			</CardContent>
		</Card>
	);
}

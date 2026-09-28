import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	Check,
	ChevronLeft,
	ChevronRight,
	Loader2,
	Lock,
	LockOpen,
	X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
import { Textarea } from "@/components/ui/textarea";
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
						No tenés permiso para ver esta página.
					</CardContent>
				</Card>
			</div>
		);
	}

	return (
		<div className="space-y-4 p-4 md:p-6">
			<div>
				<h1 className="font-semibold text-2xl">Inmovilización de unidades</h1>
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

type Decision = "aprobar" | "rechazar";

function ColaInmovilizaciones() {
	const queryClient = useQueryClient();
	const [decisionAbierta, setDecisionAbierta] = useState<{
		id: string;
		decision: Decision;
		resumen: string;
	} | null>(null);
	const [ejecutarAbierto, setEjecutarAbierto] = useState<{
		id: string;
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
									<TableHead>Solicitó</TableHead>
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
										<TableCell className="max-w-64 truncate text-sm">
											{item.motivo}
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
						Aprobadas, esperando que LEGION las aplique. Marcá "ejecutada"
						cuando LEGION confirme el apagado/reactivación.
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
											<Button
												onClick={() =>
													setEjecutarAbierto({
														id: item.id,
														resumen: resumenDe(item),
													})
												}
												size="sm"
											>
												Marcar ejecutada
											</Button>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			{decisionAbierta && (
				<DecisionModal
					decision={decisionAbierta.decision}
					id={decisionAbierta.id}
					onOpenChange={(open) => !open && setDecisionAbierta(null)}
					onResuelto={invalidar}
					open={!!decisionAbierta}
					resumen={decisionAbierta.resumen}
				/>
			)}
			{ejecutarAbierto && (
				<EjecutarModal
					id={ejecutarAbierto.id}
					onOpenChange={(open) => !open && setEjecutarAbierto(null)}
					onEjecutado={invalidar}
					open={!!ejecutarAbierto}
					resumen={ejecutarAbierto.resumen}
				/>
			)}
		</div>
	);
}

function DecisionModal({
	id,
	decision,
	resumen,
	open,
	onOpenChange,
	onResuelto,
}: {
	id: string;
	decision: Decision;
	resumen: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onResuelto: () => void;
}) {
	const [motivoRechazo, setMotivoRechazo] = useState("");
	const motivoValido = motivoRechazo.trim().length >= 5;

	const mutation = useMutation({
		...orpc.decidirInmovilizacion.mutationOptions(),
		onSuccess: () => {
			toast.success(
				decision === "aprobar" ? "Solicitud aprobada." : "Solicitud rechazada.",
			);
			onResuelto();
			onOpenChange(false);
			setMotivoRechazo("");
		},
		onError: (error) => {
			toast.error(error.message || "No se pudo procesar la decisión.", {
				duration: 8000,
			});
		},
	});

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{decision === "aprobar"
							? "Aprobar solicitud"
							: "Rechazar solicitud"}
					</DialogTitle>
					<DialogDescription>{resumen}</DialogDescription>
				</DialogHeader>

				{decision === "rechazar" && (
					<div>
						<Label htmlFor="motivo-rechazo-inmov">Motivo del rechazo</Label>
						<Textarea
							id="motivo-rechazo-inmov"
							onChange={(e) => setMotivoRechazo(e.target.value)}
							rows={3}
							value={motivoRechazo}
						/>
						{!motivoValido && motivoRechazo.length > 0 && (
							<p className="mt-1 text-destructive text-xs">
								Ingresá al menos 5 caracteres.
							</p>
						)}
					</div>
				)}

				<DialogFooter>
					<Button onClick={() => onOpenChange(false)} variant="outline">
						Cancelar
					</Button>
					<Button
						disabled={
							mutation.isPending || (decision === "rechazar" && !motivoValido)
						}
						onClick={() =>
							mutation.mutate({
								id,
								decision,
								motivoRechazo:
									decision === "rechazar" ? motivoRechazo.trim() : undefined,
							})
						}
						variant={decision === "aprobar" ? "default" : "destructive"}
					>
						Confirmar
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function EjecutarModal({
	id,
	resumen,
	open,
	onOpenChange,
	onEjecutado,
}: {
	id: string;
	resumen: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onEjecutado: () => void;
}) {
	const [referencia, setReferencia] = useState("");

	const mutation = useMutation({
		...orpc.marcarEjecutada.mutationOptions(),
		onSuccess: () => {
			toast.success("Marcada como ejecutada.");
			onEjecutado();
			onOpenChange(false);
			setReferencia("");
		},
		onError: (error) => {
			toast.error(error.message || "No se pudo marcar como ejecutada.", {
				duration: 8000,
			});
		},
	});

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Marcar como ejecutada</DialogTitle>
					<DialogDescription>
						{resumen} — confirmá que LEGION ya aplicó la acción sobre la unidad.
					</DialogDescription>
				</DialogHeader>

				<div>
					<Label htmlFor="referencia-ejecucion">
						Referencia o ticket de LEGION (opcional)
					</Label>
					<Input
						id="referencia-ejecucion"
						onChange={(e) => setReferencia(e.target.value)}
						value={referencia}
					/>
				</div>

				<DialogFooter>
					<Button onClick={() => onOpenChange(false)} variant="outline">
						Cancelar
					</Button>
					<Button
						disabled={mutation.isPending}
						onClick={() =>
							mutation.mutate({
								id,
								referencia: referencia.trim() || undefined,
							})
						}
					>
						Confirmar ejecución
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/**
 * El supervisor necesita revisar el caso (GPS, pagos, promesas) antes de
 * aprobar o de confirmar el apagado — la fila lleva a la Ficha 360. Cliente y
 * SIFCO van en el mismo link: son la misma fila del caso, no dos datos
 * sueltos, y separarlos en columnas distintas dejaba el sifco como texto
 * plano sin poder clickearlo directo.
 */
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
									<TableHead>Solicitó</TableHead>
									<TableHead>Decidió</TableHead>
									<TableHead>Ejecutó</TableHead>
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
													item.accion === "apagado" ? "destructive" : "secondary"
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
											<Badge variant={ESTADO_BADGE_VARIANT[item.estado] ?? "outline"}>
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

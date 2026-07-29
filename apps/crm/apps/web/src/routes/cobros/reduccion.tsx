import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	BellOff,
	Loader2,
	RefreshCw,
	ShieldCheck,
	TrendingDown,
} from "lucide-react";
import { useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
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
import { client, orpc, queryClient } from "@/utils/orpc";

export const Route = createFileRoute("/cobros/reduccion")({
	component: ReduccionRecordatoriosPage,
});

// Pasos del embudo que el gerente puede quitar. D-0 nunca se quita (monitoreo
// preventivo) — se muestra bloqueado en el diálogo.
const PASOS = [
	{ dia: 5, label: "Recordatorio D-5", sub: "5 días antes de vencer" },
	{ dia: 3, label: "Recordatorio D-3", sub: "3 días antes de vencer" },
	{ dia: 1, label: "Recordatorio D-1", sub: "1 día antes de vencer" },
] as const;
const MAX_PASOS = 2;

function pasoLabel(dia: number) {
	return `D-${dia}`;
}

function fmtQ(v: string | null | undefined) {
	if (v == null || v === "") return "—";
	const n = Number(v);
	return Number.isFinite(n)
		? `Q${n.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
		: "—";
}

function fmtFecha(v: string | null | undefined) {
	if (!v) return "—";
	// "YYYY-MM-DD" → "dd/mm/aaaa" sin desfases de zona horaria.
	const [y, m, d] = v.split("-");
	return y && m && d ? `${d}/${m}/${y}` : v;
}

// Enlace al detalle 360 del crédito (misma vista individual de cobros que usan
// Agenda/Cola): el param es el numero_credito_sifco.
function CreditoLink({ sifco }: { sifco: string }) {
	return (
		<Link
			to="/cobros/$id"
			params={{ id: sifco }}
			search={{ tipo: "caso" }}
			className="font-mono text-primary text-sm underline-offset-2 hover:underline"
		>
			{sifco}
		</Link>
	);
}

function ReduccionRecordatoriosPage() {
	const { data: session } = authClient.useSession();
	const userRole = session?.user?.role;

	// Diálogo de configuración: opera sobre UNO o VARIOS créditos (mismo set de
	// pasos). `dialogTargets` vacío = cerrado. `dialogLabel` es lo que se muestra
	// (nombre del cliente para uno, "N créditos" para el lote).
	const [dialogTargets, setDialogTargets] = useState<string[]>([]);
	const [dialogLabel, setDialogLabel] = useState<string>("");
	const [dialogSteps, setDialogSteps] = useState<number[]>([]);
	const [revocarSifco, setRevocarSifco] = useState<string | null>(null);
	// Selección múltiple de elegibles para configurar en lote.
	const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());

	const puedeAcceder = !!userRole && PERMISSIONS.canAssignCobros(userRole);

	const elegiblesQuery = useQuery({
		...orpc.getCreditosElegiblesReduccion.queryOptions(),
		enabled: puedeAcceder,
	});
	const configuradasQuery = useQuery({
		...orpc.getReduccionesConfiguradas.queryOptions(),
		enabled: puedeAcceder,
	});
	const revocadasQuery = useQuery({
		...orpc.getReduccionesAutoRevocadas.queryOptions(),
		enabled: puedeAcceder,
	});

	const invalidarTodo = () => {
		queryClient.invalidateQueries({
			queryKey: orpc.getCreditosElegiblesReduccion.key(),
		});
		queryClient.invalidateQueries({
			queryKey: orpc.getReduccionesConfiguradas.key(),
		});
		queryClient.invalidateQueries({
			queryKey: orpc.getReduccionesAutoRevocadas.key(),
		});
	};

	const configurarMutation = useMutation({
		mutationFn: (vars: {
			numerosCreditoSifco: string[];
			pasosRemovidos: number[];
		}) => client.configurarReduccion(vars),
		onSuccess: (res) => {
			const aplicados = res?.aplicados ?? 0;
			const omitidos = res?.omitidos ?? 0;
			toast.success(
				omitidos > 0
					? `Reducción aplicada a ${aplicados}; ${omitidos} omitido(s) por no ser elegibles`
					: `Reducción aplicada a ${aplicados} crédito(s)`,
			);
			cerrarDialog();
			setSeleccionados(new Set());
			invalidarTodo();
		},
		onError: (error: Error) => toast.error(error.message),
	});

	const revocarMutation = useMutation({
		mutationFn: (numeroCreditoSifco: string) =>
			client.revocarReduccion({ numeroCreditoSifco }),
		onSuccess: () => {
			toast.success("Reducción retirada; el crédito vuelve al embudo completo");
			setRevocarSifco(null);
			invalidarTodo();
		},
		onError: (error: Error) => toast.error(error.message),
	});

	const recalcularMutation = useMutation({
		mutationFn: () => client.recalcularElegibilidad(),
		onSuccess: (res) => {
			const r = res?.resumen;
			toast.success(
				r
					? `Datos actualizados: ${r.evaluados} evaluados · ${r.elegibles} elegibles · ${r.autoRevocados} retirados`
					: "Datos actualizados",
			);
			invalidarTodo();
		},
		onError: (error: Error) => toast.error(error.message),
	});

	// Configurar UN crédito (botón por fila / editar): abre el diálogo con ese
	// solo target y, si edita, sus pasos actuales.
	function abrirDialogUno(
		sifco: string,
		cliente: string | null,
		pasosActuales: number[] = [],
	) {
		setDialogTargets([sifco]);
		setDialogLabel(cliente ? `${cliente} · ${sifco}` : sifco);
		setDialogSteps(pasosActuales);
	}
	// Configurar TODOS los seleccionados con la misma config.
	function abrirDialogSeleccionados() {
		const targets = [...seleccionados];
		if (targets.length === 0) return;
		setDialogTargets(targets);
		setDialogLabel(`${targets.length} crédito(s) seleccionado(s)`);
		setDialogSteps([]);
	}
	function cerrarDialog() {
		setDialogTargets([]);
		setDialogLabel("");
		setDialogSteps([]);
	}

	function toggleSeleccion(sifco: string) {
		setSeleccionados((prev) => {
			const next = new Set(prev);
			if (next.has(sifco)) next.delete(sifco);
			else next.add(sifco);
			return next;
		});
	}

	function toggleStep(dia: number) {
		setDialogSteps((prev) => {
			if (prev.includes(dia)) return prev.filter((d) => d !== dia);
			if (prev.length >= MAX_PASOS) {
				toast.warning(`Máximo ${MAX_PASOS} recordatorios; quita uno primero`);
				return prev;
			}
			return [...prev, dia];
		});
	}

	if (!puedeAcceder) {
		return (
			<div className="flex min-h-screen items-center justify-center">
				<div className="text-center">
					<h1 className="mb-4 font-bold text-2xl text-gray-800">
						Acceso Denegado
					</h1>
					<p className="text-gray-600">
						Solo el Gerente de Cobros y administradores pueden gestionar la
						reducción de recordatorios.
					</p>
				</div>
			</div>
		);
	}

	const elegibles = elegiblesQuery.data?.creditos ?? [];
	const configuradas = configuradasQuery.data?.reducciones ?? [];
	const revocadas = revocadasQuery.data?.revocadas ?? [];

	const todosSeleccionados =
		elegibles.length > 0 && seleccionados.size === elegibles.length;
	function toggleSeleccionTodos() {
		setSeleccionados(
			todosSeleccionados
				? new Set()
				: new Set(
						elegibles.map(
							(c: { numeroCreditoSifco: string }) => c.numeroCreditoSifco,
						),
					),
		);
	}

	return (
		<div className="container mx-auto space-y-6 p-6">
			<div className="flex items-start justify-between gap-4">
				<div>
					<h1 className="flex items-center gap-2 font-bold text-3xl">
						<BellOff className="h-7 w-7" />
						Reducción de recordatorios
					</h1>
					<p className="mt-1 text-muted-foreground">
						Los clientes que pagan al día 4 cuotas seguidas pueden recibir menos
						recordatorios premora. El sistema los marca elegibles; tú decides
						qué pasos quitarles. El recordatorio del día de vencimiento (D-0)
						siempre se envía.
					</p>
				</div>
				<Button
					variant="outline"
					disabled={recalcularMutation.isPending}
					onClick={() => recalcularMutation.mutate()}
				>
					{recalcularMutation.isPending ? (
						<Loader2 className="mr-2 h-4 w-4 animate-spin" />
					) : (
						<RefreshCw className="mr-2 h-4 w-4" />
					)}
					Actualizar datos
				</Button>
			</div>

			<Tabs defaultValue="elegibles">
				<TabsList>
					<TabsTrigger value="elegibles">
						Elegibles ({elegibles.length})
					</TabsTrigger>
					<TabsTrigger value="configuradas">
						Configurados ({configuradas.length})
					</TabsTrigger>
					<TabsTrigger value="revocadas">
						Retirados automáticamente ({revocadas.length})
					</TabsTrigger>
				</TabsList>

				{/* ── Elegibles ─────────────────────────────────────────────── */}
				<TabsContent value="elegibles">
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<ShieldCheck className="h-5 w-5 text-green-600" />
								Clientes que pagan al día
							</CardTitle>
							<CardDescription>
								Elegibles sin reducción aplicada. Elige a quién quitarle
								recordatorios.
							</CardDescription>
						</CardHeader>
						<CardContent>
							{elegiblesQuery.isLoading ? (
								<Cargando />
							) : elegibles.length === 0 ? (
								<Vacio texto="No hay créditos elegibles por ahora." />
							) : (
								<>
									{/* Toolbar de lote: aparece al seleccionar ≥1 crédito. */}
									{seleccionados.size > 0 && (
										<div className="mb-3 flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2">
											<span className="text-sm">
												{seleccionados.size} crédito(s) seleccionado(s)
											</span>
											<div className="flex gap-2">
												<Button
													size="sm"
													variant="ghost"
													onClick={() => setSeleccionados(new Set())}
												>
													Limpiar
												</Button>
												<Button size="sm" onClick={abrirDialogSeleccionados}>
													Configurar seleccionados
												</Button>
											</div>
										</div>
									)}
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead className="w-10">
													<Checkbox
														checked={todosSeleccionados}
														onCheckedChange={toggleSeleccionTodos}
														aria-label="Seleccionar todos"
													/>
												</TableHead>
												<TableHead>Cliente</TableHead>
												<TableHead>Crédito</TableHead>
												<TableHead>Cuota mensual</TableHead>
												<TableHead>Próximo pago</TableHead>
												<TableHead>Cuotas al día</TableHead>
												<TableHead className="text-right">Acción</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{elegibles.map((c) => (
												<TableRow key={c.numeroCreditoSifco}>
													<TableCell>
														<Checkbox
															checked={seleccionados.has(c.numeroCreditoSifco)}
															onCheckedChange={() =>
																toggleSeleccion(c.numeroCreditoSifco)
															}
															aria-label={`Seleccionar ${c.numeroCreditoSifco}`}
														/>
													</TableCell>
													<TableCell className="font-medium">
														{c.cliente ?? "—"}
													</TableCell>
													<TableCell>
														<CreditoLink sifco={c.numeroCreditoSifco} />
													</TableCell>
													<TableCell>{fmtQ(c.cuotaMensual)}</TableCell>
													<TableCell>{fmtFecha(c.proximaFechaPago)}</TableCell>
													<TableCell>
														<Badge className="bg-green-100 text-green-800">
															{c.racha} al día
														</Badge>
													</TableCell>
													<TableCell className="text-right">
														<Button
															size="sm"
															// Con selección múltiple activa se usa el botón de lote
															// ("Configurar seleccionados"); los individuales se apagan.
															disabled={seleccionados.size > 0}
															onClick={() =>
																abrirDialogUno(c.numeroCreditoSifco, c.cliente)
															}
														>
															Configurar
														</Button>
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								</>
							)}
						</CardContent>
					</Card>
				</TabsContent>

				{/* ── Configurados ──────────────────────────────────────────── */}
				<TabsContent value="configuradas">
					<Card>
						<CardHeader>
							<CardTitle>Reducciones activas</CardTitle>
							<CardDescription>
								Créditos con recordatorios reducidos. Puedes editar los pasos o
								retirar la reducción.
							</CardDescription>
						</CardHeader>
						<CardContent>
							{configuradasQuery.isLoading ? (
								<Cargando />
							) : configuradas.length === 0 ? (
								<Vacio texto="Aún no has configurado ninguna reducción." />
							) : (
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Cliente</TableHead>
											<TableHead>Crédito</TableHead>
											<TableHead>Cuota mensual</TableHead>
											<TableHead>Próximo pago</TableHead>
											<TableHead>Recordatorios quitados</TableHead>
											<TableHead>Cuotas al día</TableHead>
											<TableHead>Configurado por</TableHead>
											<TableHead className="text-right">Acciones</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{configuradas.map((r) => (
											<TableRow key={r.numeroCreditoSifco}>
												<TableCell className="font-medium">
													{r.cliente ?? "—"}
												</TableCell>
												<TableCell>
													<CreditoLink sifco={r.numeroCreditoSifco} />
												</TableCell>
												<TableCell>{fmtQ(r.cuotaMensual)}</TableCell>
												<TableCell>{fmtFecha(r.proximaFechaPago)}</TableCell>
												<TableCell>
													<div className="flex flex-wrap gap-1">
														{[...(r.pasosRemovidos ?? [])]
															.sort((a, b) => b - a)
															.map((d) => (
																<Badge
																	key={d}
																	variant="secondary"
																	className="bg-amber-100 text-amber-800"
																>
																	{pasoLabel(d)}
																</Badge>
															))}
													</div>
												</TableCell>
												<TableCell>
													{r.racha != null ? (
														<Badge className="bg-green-100 text-green-800">
															{r.racha} al día
														</Badge>
													) : (
														"—"
													)}
												</TableCell>
												<TableCell className="text-muted-foreground text-sm">
													{r.configuradoPorNombre ?? "—"}
												</TableCell>
												<TableCell className="text-right">
													<div className="flex justify-end gap-2">
														<Button
															size="sm"
															variant="outline"
															onClick={() =>
																abrirDialogUno(
																	r.numeroCreditoSifco,
																	r.cliente,
																	[...(r.pasosRemovidos ?? [])],
																)
															}
														>
															Editar
														</Button>
														<Button
															size="sm"
															variant="destructive"
															onClick={() =>
																setRevocarSifco(r.numeroCreditoSifco)
															}
														>
															Retirar
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
				</TabsContent>

				{/* ── Auto-revocados ────────────────────────────────────────── */}
				<TabsContent value="revocadas">
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<TrendingDown className="h-5 w-5 text-red-600" />
								Retirados por el sistema
							</CardTitle>
							<CardDescription>
								Reducciones que el sistema retiró automáticamente porque el
								cliente dejó de pagar al día.
							</CardDescription>
						</CardHeader>
						<CardContent>
							{revocadasQuery.isLoading ? (
								<Cargando />
							) : revocadas.length === 0 ? (
								<Vacio texto="No hay reducciones retiradas automáticamente." />
							) : (
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Cliente</TableHead>
											<TableHead>Crédito</TableHead>
											<TableHead>Tenía quitados</TableHead>
											<TableHead>Cuotas al día ahora</TableHead>
											<TableHead>Retirado</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{revocadas.map((r) => (
											<TableRow key={r.numeroCreditoSifco}>
												<TableCell className="font-medium">
													{r.cliente ?? "—"}
												</TableCell>
												<TableCell>
													<CreditoLink sifco={r.numeroCreditoSifco} />
												</TableCell>
												<TableCell>
													<div className="flex flex-wrap gap-1">
														{[...(r.pasosRemovidos ?? [])]
															.sort((a, b) => b - a)
															.map((d) => (
																<Badge
																	key={d}
																	variant="outline"
																	className="text-muted-foreground"
																>
																	{pasoLabel(d)}
																</Badge>
															))}
													</div>
												</TableCell>
												<TableCell>{r.racha ?? "—"}</TableCell>
												<TableCell className="text-muted-foreground text-sm">
													{r.revocadoAt
														? new Date(r.revocadoAt).toLocaleDateString("es-GT")
														: "—"}
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							)}
						</CardContent>
					</Card>
				</TabsContent>
			</Tabs>

			{/* ── Diálogo configurar / editar (uno o varios) ────────────────── */}
			<Dialog
				open={dialogTargets.length > 0}
				onOpenChange={(o) => {
					if (!o) cerrarDialog();
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Reducir recordatorios</DialogTitle>
						<DialogDescription>
							{dialogLabel}. Marca los recordatorios que NO quieres enviarle
							(máximo {MAX_PASOS}).
						</DialogDescription>
					</DialogHeader>

					<div className="space-y-3 py-2">
						{PASOS.map((p) => {
							const checked = dialogSteps.includes(p.dia);
							return (
								<label
									key={p.dia}
									htmlFor={`paso-${p.dia}`}
									className="flex cursor-pointer items-center gap-3 rounded-md border p-3 hover:bg-muted/50"
								>
									<Checkbox
										id={`paso-${p.dia}`}
										checked={checked}
										onCheckedChange={() => toggleStep(p.dia)}
									/>
									<div>
										<div className="font-medium">{p.label}</div>
										<div className="text-muted-foreground text-sm">{p.sub}</div>
									</div>
								</label>
							);
						})}
						<div className="flex items-center gap-3 rounded-md border border-dashed p-3 opacity-60">
							<Checkbox checked disabled />
							<div>
								<div className="font-medium">Recordatorio D-0</div>
								<div className="text-muted-foreground text-sm">
									El día de vencimiento — siempre se envía
								</div>
							</div>
						</div>
					</div>

					<DialogFooter>
						<Button variant="outline" onClick={cerrarDialog}>
							Cancelar
						</Button>
						<Button
							disabled={
								dialogSteps.length === 0 || configurarMutation.isPending
							}
							onClick={() =>
								dialogTargets.length > 0 &&
								configurarMutation.mutate({
									numerosCreditoSifco: dialogTargets,
									pasosRemovidos: dialogSteps,
								})
							}
						>
							{configurarMutation.isPending && (
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							)}
							Aplicar
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* ── Confirmar retiro manual ───────────────────────────────────── */}
			<AlertDialog
				open={revocarSifco != null}
				onOpenChange={(o) => {
					if (!o) setRevocarSifco(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>¿Retirar la reducción?</AlertDialogTitle>
						<AlertDialogDescription>
							El crédito {revocarSifco} volverá a recibir todos los
							recordatorios del embudo (D-5, D-3, D-1 y D-0).
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancelar</AlertDialogCancel>
						<AlertDialogAction
							onClick={() =>
								revocarSifco && revocarMutation.mutate(revocarSifco)
							}
						>
							Retirar
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

function Cargando() {
	return (
		<div className="flex items-center justify-center py-10 text-muted-foreground">
			<Loader2 className="mr-2 h-5 w-5 animate-spin" />
			Cargando…
		</div>
	);
}

function Vacio({ texto }: { texto: string }) {
	return <div className="py-10 text-center text-muted-foreground">{texto}</div>;
}

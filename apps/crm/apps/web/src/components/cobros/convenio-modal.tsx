/**
 * CB-032 — Convenio de pago desde la Ficha 360.
 *
 * Promesa y convenio son conceptos distintos y por eso este modal es OTRO
 * componente, no una variante más de ContactoModal:
 *
 * - Una PROMESA es una gestión del CRM: "el cliente dice que paga X el día
 *   Y". Vive en contactos_cobros, se puede registrar en cualquier bucket.
 * - Un CONVENIO es una reestructura que vive en CARTERA: toma la deuda de las
 *   cuotas elegidas (+ la mora vigente) y la reparte en N cuotas mensuales
 *   que se cobran junto con la cuota normal. Al crearse, cartera borra la
 *   mora, saca al crédito del funnel (EN_CONVENIO) y lo deja pendiente de
 *   ACTIVACIÓN por conta/admin en carteraFront. Solo a partir de B2.
 *
 * Es la misma acción que hoy solo existe en carteraFront ("Crear Convenio de
 * Pago"), con la misma fórmula de total (cuota × n + mora) y el mismo
 * endpoint de cartera detrás — acá solo se eligen cuotas; el server del CRM
 * traduce a los recibos que cartera espera (crearConvenioDesdeFicha).
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Handshake, Loader } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CurrencyInput } from "@/components/ui/currency-input";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatFechaLocal } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import { client, orpc } from "@/utils/orpc";

export interface CuotaConvenioUI {
	cuotaId: number;
	numeroCuota: number;
	fechaVencimiento?: string | null;
	monto: number;
	/** Ya vencida (la ficha lo decide con el mismo criterio que la promesa). */
	vencida: boolean;
}

interface ConvenioModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/**
	 * Caso de cobro: es la LLAVE DE ACCESO del procedure, no un extra. El
	 * servidor verifica que el asesor tenga el caso y resuelve el crédito
	 * desde ahí — por eso el SIFCO ya no viaja en el input.
	 */
	casoCobroId: string;
	clienteNombre: string;
	/** Cuotas PENDIENTES del crédito (no pagadas, no en validación). */
	cuotas: CuotaConvenioUI[];
	cuotaMensual: number;
	/** Mora vigente del crédito. Entra SIEMPRE al convenio (cartera la borra). */
	montoMora: number;
	/** Tope de meses (getConvenioConfig). */
	maxMeses: number;
	/** Se llama tras crear con éxito, ANTES de cerrar — el padre refresca. */
	onCreado?: () => void;
}

/**
 * Forma real de `crearConvenioDesdeFicha` (routers/cobros.ts). El cliente
 * ORPC del web infiere `unknown` para las procedures nuevas mientras el
 * server no esté compilado (mismo motivo por el que $id.tsx declara
 * CasoDetalle a mano) — mantener alineado con el return del handler.
 */
interface ResultadoConvenio {
	convenioId: number;
	montoTotal: number;
	cuotaMensual: number;
	numeroMeses: number;
	cantidadCuotas: number;
	pendienteActivacion: boolean;
}

const Q = (n: number) =>
	`Q${n.toLocaleString("es-GT", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})}`;

export function ConvenioModal({
	open,
	onOpenChange,
	casoCobroId,
	clienteNombre,
	cuotas,
	cuotaMensual,
	montoMora,
	maxMeses,
	onCreado,
}: ConvenioModalProps) {
	const queryClient = useQueryClient();

	// Regla de negocio (CB-032): al convenio entran SOLO las cuotas vencidas y
	// la cuota ACTUAL (la primera que todavía no venció). Las futuras no: un
	// convenio reestructura deuda exigible, no adelanta el calendario. El
	// server aplica la misma regla sobre la data real de cartera.
	const cuotasOrdenadas = useMemo(() => {
		const ordenadas = [...cuotas].sort((a, b) => a.numeroCuota - b.numeroCuota);
		const vencidas = ordenadas.filter((c) => c.vencida);
		const actual = ordenadas.find((c) => !c.vencida);
		return actual ? [...vencidas, actual] : vencidas;
	}, [cuotas]);
	const cuotaActualId = useMemo(
		() => cuotasOrdenadas.find((c) => !c.vencida)?.cuotaId ?? null,
		[cuotasOrdenadas],
	);
	const idsVencidas = useMemo(
		() => cuotasOrdenadas.filter((c) => c.vencida).map((c) => c.cuotaId),
		[cuotasOrdenadas],
	);

	const [seleccion, setSeleccion] = useState<number[]>([]);
	const [meses, setMeses] = useState<number>(1);
	// null = usar la fórmula; string = el asesor lo editó a mano.
	const [montoManual, setMontoManual] = useState<string | null>(null);
	const [motivo, setMotivo] = useState("");
	const [observaciones, setObservaciones] = useState("");

	// Cada vez que se abre arranca limpio, con las vencidas preseleccionadas:
	// es lo que casi siempre entra al convenio (las "1 y 2" que ya no pagó).
	// Depende de `open`, no de la lista, para no pisar lo que el asesor toque
	// mientras el modal está abierto.
	// biome-ignore lint/correctness/useExhaustiveDependencies: solo al abrir
	useEffect(() => {
		if (!open) return;
		setSeleccion(idsVencidas);
		setMeses(1);
		setMontoManual(null);
		setMotivo("");
		setObservaciones("");
	}, [open]);

	const seleccionadas = cuotasOrdenadas.filter((c) =>
		seleccion.includes(c.cuotaId),
	);
	const totalCuotas = seleccionadas.reduce((acc, c) => acc + c.monto, 0);
	const totalFormula = Math.round((totalCuotas + montoMora) * 100) / 100;
	const montoManualNum =
		montoManual !== null ? Number(montoManual) : Number.NaN;
	const total =
		montoManual !== null && Number.isFinite(montoManualNum)
			? montoManualNum
			: totalFormula;
	const cuotaConvenio = meses > 0 ? total / meses : 0;

	const toggle = (cuotaId: number) =>
		setSeleccion((prev) =>
			prev.includes(cuotaId)
				? prev.filter((id) => id !== cuotaId)
				: [...prev, cuotaId],
		);

	const crear = useMutation({
		mutationFn: async (): Promise<ResultadoConvenio> =>
			(await client.crearConvenioDesdeFicha({
				casoCobroId,
				cuotaIds: seleccion,
				numeroMeses: meses,
				motivo: motivo.trim(),
				observaciones: observaciones.trim() || undefined,
				montoTotal:
					montoManual !== null && Number.isFinite(montoManualNum)
						? montoManualNum
						: undefined,
			})) as ResultadoConvenio,
		onSuccess: (r) => {
			toast.success(
				`Convenio creado: ${r.cantidadCuotas} cuota(s) por ${Q(r.montoTotal)} en ${r.numeroMeses} mes(es) de ${Q(r.cuotaMensual)}.${
					r.pendienteActivacion
						? " Queda pendiente de activación en cartera."
						: ""
				}`,
				{ duration: 8000 },
			);
			// El listado de convenios (/cobros/convenios) y todo lo que muestre el
			// estado del crédito quedan viejos; lo específico de la ficha lo
			// refresca el padre con sus inputs (onCreado).
			queryClient.invalidateQueries({
				queryKey: orpc.getConveniosListado.key(),
			});
			onCreado?.();
			onOpenChange(false);
		},
		onError: (error: Error) => {
			toast.error(error.message || "No se pudo crear el convenio", {
				duration: 8000,
			});
		},
	});

	const motivoValido = motivo.trim().length >= 3;
	const puedeCrear =
		seleccion.length > 0 && meses >= 1 && total > 0 && motivoValido;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
				<DialogHeader className="px-6 pt-6">
					<DialogTitle className="flex items-center gap-2">
						<Handshake className="h-4 w-4 text-blue-700 dark:text-blue-300" />
						Convenio de Pago - {clienteNombre}
					</DialogTitle>
					<DialogDescription>
						Toma la deuda de las cuotas elegidas más la mora vigente y la
						reparte en cuotas mensuales que se cobran junto con la cuota normal.
						Al crearse, la mora se elimina y el crédito pasa a En Convenio;
						queda pendiente de activación en cartera.
					</DialogDescription>
				</DialogHeader>

				<form
					className="flex min-h-0 flex-1 flex-col"
					onSubmit={(e) => {
						e.preventDefault();
						if (!puedeCrear || crear.isPending) return;
						crear.mutate();
					}}
				>
					<div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-4">
						{/* Cuotas */}
						<div className="space-y-2">
							<div className="flex flex-wrap items-start justify-between gap-2">
								<div>
									<Label>Cuotas que entran al convenio</Label>
									<p className="text-muted-foreground text-xs">
										Solo las vencidas y la cuota actual; las futuras no entran.
									</p>
								</div>
								<div className="flex gap-1">
									<Button
										type="button"
										variant="ghost"
										size="sm"
										className="h-7 px-2 text-xs"
										disabled={idsVencidas.length === 0}
										onClick={() => setSeleccion(idsVencidas)}
									>
										Solo vencidas ({idsVencidas.length})
									</Button>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										className="h-7 px-2 text-xs"
										onClick={() =>
											setSeleccion(cuotasOrdenadas.map((c) => c.cuotaId))
										}
									>
										Vencidas + actual
									</Button>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										className="h-7 px-2 text-destructive text-xs"
										disabled={seleccion.length === 0}
										onClick={() => setSeleccion([])}
									>
										Limpiar
									</Button>
								</div>
							</div>

							<div className="rounded-md border">
								{cuotasOrdenadas.length === 0 ? (
									<p className="px-3 py-4 text-muted-foreground text-sm">
										Este crédito no tiene cuotas vencidas ni cuota actual para
										reestructurar.
									</p>
								) : (
									<div className="max-h-[240px] overflow-y-auto">
										{cuotasOrdenadas.map((c, i) => {
											const marcada = seleccion.includes(c.cuotaId);
											return (
												<label
													key={c.cuotaId}
													htmlFor={`convenio-cuota-${c.cuotaId}`}
													className={cn(
														"flex min-h-[44px] cursor-pointer items-center gap-3 px-3 py-2 transition-colors",
														i > 0 && "border-t",
														marcada ? "bg-primary/5" : "hover:bg-muted/50",
													)}
												>
													<Checkbox
														id={`convenio-cuota-${c.cuotaId}`}
														checked={marcada}
														onCheckedChange={() => toggle(c.cuotaId)}
													/>
													<div className="flex-1">
														<p className="flex items-center gap-2 font-medium text-sm">
															Cuota #{c.numeroCuota}
															{c.vencida ? (
																<Badge
																	variant="outline"
																	className="border-transparent bg-red-100 text-[10px] text-red-800 dark:bg-red-900/40 dark:text-red-300"
																>
																	Vencida
																</Badge>
															) : c.cuotaId === cuotaActualId ? (
																<Badge
																	variant="outline"
																	className="border-transparent bg-amber-100 text-[10px] text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
																>
																	Actual
																</Badge>
															) : null}
														</p>
														{c.fechaVencimiento && (
															<p className="text-muted-foreground text-xs">
																Vence {formatFechaLocal(c.fechaVencimiento)}
															</p>
														)}
													</div>
													<span className="font-medium text-sm tabular-nums">
														{Q(c.monto)}
													</span>
												</label>
											);
										})}
									</div>
								)}

								{/* Mora: fija. No es opcional porque cartera la BORRA al crear
								    el convenio — si no entra al total, se condona sin decidirlo. */}
								<div className="flex items-center justify-between border-t px-3 py-2 text-sm">
									<div>
										<p className="font-medium">Mora vigente</p>
										<p className="text-muted-foreground text-xs">
											Se incluye siempre: al crear el convenio deja de correr.
										</p>
									</div>
									<span className="tabular-nums">+{Q(montoMora)}</span>
								</div>
								<div className="flex items-center justify-between border-t bg-muted/40 px-3 py-2">
									<span className="font-medium text-sm">
										Total según selección ({seleccionadas.length} cuota
										{seleccionadas.length === 1 ? "" : "s"})
									</span>
									<span className="font-bold text-base tabular-nums">
										{Q(totalFormula)}
									</span>
								</div>
							</div>
						</div>

						{/* Plazo + total */}
						<div className="grid gap-4 sm:grid-cols-2">
							<div className="space-y-2">
								<Label htmlFor="convenio-meses">Plazo del convenio</Label>
								<Select
									value={String(meses)}
									onValueChange={(v) => setMeses(Number(v))}
								>
									<SelectTrigger id="convenio-meses">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{Array.from({ length: maxMeses }, (_, i) => i + 1).map(
											(n) => (
												<SelectItem key={n} value={String(n)}>
													{n} {n === 1 ? "mes" : "meses"}
												</SelectItem>
											),
										)}
									</SelectContent>
								</Select>
								<p className="text-muted-foreground text-xs">
									Máximo {maxMeses} meses.
								</p>
							</div>
							<div className="space-y-2">
								<div className="flex items-center justify-between">
									<Label htmlFor="convenio-total">Monto total (editable)</Label>
									{montoManual !== null && (
										<button
											type="button"
											className="text-primary text-xs underline-offset-2 hover:underline"
											onClick={() => setMontoManual(null)}
										>
											Restablecer
										</button>
									)}
								</div>
								<CurrencyInput
									id="convenio-total"
									value={
										montoManual !== null ? montoManual : totalFormula.toFixed(2)
									}
									onChange={(v) => setMontoManual(v)}
								/>
							</div>
						</div>

						<div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm dark:border-blue-900 dark:bg-blue-950/40">
							<div className="flex items-center justify-between">
								<span className="font-medium">Cuota del convenio</span>
								<span className="font-bold tabular-nums">
									{Q(cuotaConvenio)} / mes
								</span>
							</div>
							<p className="mt-1 text-muted-foreground text-xs">
								Se cobra además de la cuota normal de {Q(cuotaMensual)}: el
								cliente pagará {Q(cuotaConvenio + cuotaMensual)} al mes durante{" "}
								{meses} {meses === 1 ? "mes" : "meses"}.
							</p>
						</div>

						{/* Motivo / observaciones */}
						<div className="space-y-2">
							<Label htmlFor="convenio-motivo">Motivo del convenio *</Label>
							<Textarea
								id="convenio-motivo"
								value={motivo}
								onChange={(e) => setMotivo(e.target.value)}
								placeholder="Ejemplo: cliente solicita convenio por dificultades económicas temporales"
								rows={2}
								required
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="convenio-observaciones">
								Observaciones (opcional)
							</Label>
							<Textarea
								id="convenio-observaciones"
								value={observaciones}
								onChange={(e) => setObservaciones(e.target.value)}
								placeholder="Información adicional relevante…"
								rows={2}
							/>
						</div>
					</div>

					<DialogFooter className="border-t bg-background px-6 py-4">
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
							disabled={crear.isPending}
						>
							Cancelar
						</Button>
						<Button type="submit" disabled={!puedeCrear || crear.isPending}>
							{crear.isPending ? (
								<>
									<Loader className="mr-2 h-4 w-4 animate-spin" />
									Creando convenio…
								</>
							) : (
								<>
									<Handshake className="mr-2 h-4 w-4" />
									Crear convenio
								</>
							)}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

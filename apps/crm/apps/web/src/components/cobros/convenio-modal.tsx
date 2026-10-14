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
import { Handshake, Loader, Receipt } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
	type PagoRegistrado,
	RegistrarPagoForm,
} from "@/components/cobros/registrar-pago-form";
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
import { PopoverPortalContext } from "@/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
	type CuotaConvenio,
	soloVencidasYActual,
} from "@/lib/cobros/convenio-cuotas";
import { formatFechaLocal } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import { client, orpc } from "@/utils/orpc";

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
	/**
	 * Cuotas elegibles del crédito, ya filtradas por
	 * `cuotasElegiblesParaConvenio` (pendientes de verdad, sin pagos esperando
	 * a conta, con `vencida` medida en días GT).
	 */
	cuotas: CuotaConvenio[];
	cuotaMensual: number;
	/** Mora vigente del crédito. Entra SIEMPRE al convenio (cartera la borra). */
	montoMora: number;
	/** Tope de meses (getConvenioConfig). */
	maxMeses: number;
	/**
	 * Pagos de HOY del crédito ya validados por contabilidad, que pueden entrar
	 * como abono inicial (`abonosDeHoy` de `lib/cobros/abonos-convenio.ts`).
	 * Pasarlo (o `creditoId`) muestra el bloque «Abono de hoy» también en modo
	 * diálogo (Ficha 360).
	 */
	abonos?: AbonoConvenio[];
	/**
	 * W4 · Mismo id que la ruta de la Ficha 360 (SIFCO o caso). Con él, el
	 * bloque «Abono de hoy» ofrece «Registrar abono con comprobante»
	 * (`RegistrarPagoForm` embebido) y el pago registrado queda elegido.
	 */
	creditoId?: string;
	/**
	 * Se llama tras crear con éxito, ANTES de cerrar — el padre refresca.
	 * Recibe lo que devolvió cartera (montos, meses, si queda pendiente de
	 * activación): el Workspace lo usa para el resumen de «Gestión registrada».
	 */
	onCreado?: (resultado: ResultadoConvenio) => void;
	/** Workspace: se pinta dentro del panel de gestión, sin Dialog. */
	embebido?: boolean;
	/** Solo con `embebido`: el botón secundario del pie («Cancelar»). */
	onCancelar?: () => void;
}

/** Un pago del día que puede descontarse del convenio (`abonoInicialPagoId`). */
export interface AbonoConvenio {
	pagoId: number;
	/** Monto del pago (el de la boleta), para mostrarlo. */
	monto: number;
	/** Lo que el pago aplicó a cada cuota (por `cuotaId`). */
	aplicadoPorCuota: Record<number, number>;
	/**
	 * Contabilidad ya lo validó (`validated` o `capital_validated`). `false`:
	 * el abono recién registrado desde el modal, que espera validación y
	 * cartera todavía no acepta. Sin el campo, validado.
	 */
	validado?: boolean;
}

/**
 * Forma real de `crearConvenioDesdeFicha` (routers/cobros.ts). El cliente
 * ORPC del web infiere `unknown` para las procedures nuevas mientras el
 * server no esté compilado (mismo motivo por el que $id.tsx declara
 * CasoDetalle a mano) — mantener alineado con el return del handler.
 */
export interface ResultadoConvenio {
	convenioId: number;
	montoTotal: number;
	cuotaMensual: number;
	numeroMeses: number;
	cantidadCuotas: number;
	pendienteActivacion: boolean;
	abonoInicialPagoId?: number | null;
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
	abonos: abonosProp,
	creditoId,
	onCreado,
	embebido = false,
	onCancelar,
}: ConvenioModalProps) {
	const queryClient = useQueryClient();
	// «Abono de hoy»: en el Workspace siempre; en el diálogo, si el padre pasa
	// los abonos o el crédito para registrarlos.
	const ofrecerAbono = embebido || abonosProp !== undefined || !!creditoId;
	// W4 · El abono que se acaba de registrar desde aquí: queda elegido aunque
	// el plan todavía no lo traiga (o lo traiga sin validar).
	const [abonoRegistrado, setAbonoRegistrado] = useState<AbonoConvenio | null>(
		null,
	);
	const [registrandoAbono, setRegistrandoAbono] = useState(false);
	const [cajaDialogo, setCajaDialogo] = useState<HTMLDivElement | null>(null);
	const abonos = useMemo(() => {
		const base = abonosProp ?? [];
		return abonoRegistrado &&
			!base.some((a) => a.pagoId === abonoRegistrado.pagoId)
			? [...base, abonoRegistrado]
			: base;
	}, [abonosProp, abonoRegistrado]);

	// Regla de negocio (CB-032): al convenio entran SOLO las cuotas vencidas y
	// la cuota ACTUAL (la primera que todavía no venció). Las futuras no: un
	// convenio reestructura deuda exigible, no adelanta el calendario. El
	// server aplica la misma regla sobre la data real de cartera.
	const cuotasOrdenadas = useMemo(() => soloVencidasYActual(cuotas), [cuotas]);
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
	const [motivo, setMotivo] = useState("");
	const [observaciones, setObservaciones] = useState("");
	const [abonoId, setAbonoId] = useState<number | null>(null);

	// Cada vez que se abre arranca limpio, con las vencidas preseleccionadas:
	// es lo que casi siempre entra al convenio (las "1 y 2" que ya no pagó).
	// Depende de `open`, no de la lista, para no pisar lo que el asesor toque
	// mientras el modal está abierto.
	// Embebido (Workspace) se considera siempre abierto: arranca limpio al
	// montar y el Workspace lo remonta con `key` al cambiar de caso.
	const abierto = embebido || open;
	// biome-ignore lint/correctness/useExhaustiveDependencies: solo al abrir
	useEffect(() => {
		if (!abierto) return;
		setSeleccion(idsVencidas);
		setMeses(1);
		setMotivo("");
		setObservaciones("");
		setAbonoId(null);
		setAbonoRegistrado(null);
		setRegistrandoAbono(false);
	}, [abierto]);

	// Embebido: el Workspace puede montar el formulario mientras el plan de
	// cuotas todavía carga. Cuando la lista pasa de vacía a llena y el asesor
	// no marcó nada, se preseleccionan las vencidas (lo mismo que al abrir el
	// Dialog). En modo Dialog no aplica: ahí manda el efecto de `abierto`.
	const sinCuotasAntes = useRef(cuotasOrdenadas.length === 0);
	useEffect(() => {
		if (!embebido) return;
		if (cuotasOrdenadas.length === 0) {
			sinCuotasAntes.current = true;
			return;
		}
		if (!sinCuotasAntes.current) return;
		sinCuotasAntes.current = false;
		setSeleccion((prev) => (prev.length === 0 ? idsVencidas : prev));
	}, [embebido, cuotasOrdenadas, idsVencidas]);

	const seleccionadas = cuotasOrdenadas.filter((c) =>
		seleccion.includes(c.cuotaId),
	);
	const totalCuotas = seleccionadas.reduce((acc, c) => acc + c.monto, 0);
	// El total NO se edita (pedido del PM, 2026-10-01): son las cuotas que se
	// marquen más la mora. Para cambiarlo se marcan o desmarcan cuotas.
	// Con un abono inicial el convenio cubre solo el remanente. Se descuenta lo
	// que el abono aplicó a las cuotas elegidas: la parte que fue a mora ya
	// está en `montoMora`, que es la mora vigente.
	const abono = abonos.find((a) => a.pagoId === abonoId) ?? null;
	const descuentoAbono = abono
		? seleccionadas.reduce(
				(acc, c) => acc + (abono.aplicadoPorCuota[c.cuotaId] ?? 0),
				0,
			)
		: 0;
	const totalSinAbono = Math.round((totalCuotas + montoMora) * 100) / 100;
	const total = Math.max(
		0,
		Math.round((totalSinAbono - descuentoAbono) * 100) / 100,
	);
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
				// Solo las que siguen en la lista: si el plan se refresca con el
				// modal abierto (p. ej. tras registrar un abono, su cuota queda en
				// validación), una cuota que salió no viaja al servidor.
				cuotaIds: seleccionadas.map((c) => c.cuotaId),
				numeroMeses: meses,
				motivo: motivo.trim(),
				observaciones: observaciones.trim() || undefined,
				// SIEMPRE el total que el asesor tiene en pantalla. Si no se
				// manda, el server recalcula con la cuota estándar del crédito:
				// si alguna cuota tenía otro monto, o la mora cambiaba entre que
				// se abrió el modal y se confirmó, el convenio nacía por una
				// cifra distinta a la aprobada (hallazgo de Codex, PR #1570).
				montoTotal: total,
				...(abono ? { abonoInicialPagoId: abono.pagoId } : {}),
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
			onCreado?.(r);
			// Embebido no hay Dialog que cerrar: el Workspace pasa a «Gestión
			// registrada» con onCreado.
			if (!embebido) onOpenChange(false);
		},
		onError: (error: Error) => {
			toast.error(error.message || "No se pudo crear el convenio", {
				duration: 8000,
			});
		},
	});

	const motivoValido = motivo.trim().length >= 3;
	// Un abono que espera a contabilidad no sirve todavía: cartera lo rechaza.
	const abonoSinValidar = !!abono && abono.validado === false;
	const puedeCrear =
		seleccionadas.length > 0 &&
		meses >= 1 &&
		total > 0 &&
		motivoValido &&
		!abonoSinValidar;

	/** W4 · El abono registrado desde el modal queda elegido. */
	const alRegistrarAbono = (r: PagoRegistrado) => {
		setRegistrandoAbono(false);
		// El plan de cuotas trae el pago nuevo (y su cuota pasa a validación).
		queryClient.invalidateQueries({ queryKey: orpc.getHistorialPagos.key() });
		if (r.pagoId == null) {
			toast.warning(
				"El abono se registró, pero no se pudo identificar para el convenio. Elíjalo en «Abono de hoy» cuando aparezca.",
			);
			return;
		}
		setAbonoRegistrado({
			pagoId: r.pagoId,
			monto: r.montoBoleta,
			aplicadoPorCuota: {},
			validado: false,
		});
		setAbonoId(r.pagoId);
	};

	const descripcion =
		"Toma la deuda de las cuotas seleccionadas más la mora vigente y la reparte en cuotas mensuales que se cobran junto con la cuota normal. Al crearse, la mora se elimina y el crédito pasa a En Convenio; queda pendiente de activación en cartera.";

	const onSubmit = (e: FormEvent) => {
		e.preventDefault();
		if (!puedeCrear || crear.isPending) return;
		crear.mutate();
	};

	const botonCrear = (
		<Button
			type="submit"
			disabled={!puedeCrear || crear.isPending}
			className={cn(embebido && "flex-1")}
		>
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
	);

	// Cuerpo compartido por el Dialog y el modo embebido. Embebido, las
	// rejillas responden al ancho del panel (`@container` en la raíz embebida),
	// no al del viewport; en el Dialog quedan los breakpoints de siempre (sin
	// `@container` aquí: recortaría los popovers que no usan Portal).
	const cuerpo = (
		<div
			className={cn(
				"min-h-0 flex-1 overflow-y-auto",
				embebido ? "space-y-4 pr-1" : "space-y-5 px-6 py-4",
			)}
		>
			{embebido && (
				<p className="text-muted-foreground text-sm">{descripcion}</p>
			)}
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
						<span className="font-bold text-base tabular-nums">{Q(total)}</span>
					</div>
				</div>
			</div>

			{/* Plazo + total */}
			<div
				className={cn(
					"grid gap-4",
					embebido ? "@md:grid-cols-2" : "sm:grid-cols-2",
				)}
			>
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
							{Array.from({ length: maxMeses }, (_, i) => i + 1).map((n) => (
								<SelectItem key={n} value={String(n)}>
									{n} {n === 1 ? "mes" : "meses"}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<p className="text-muted-foreground text-xs">
						Máximo {maxMeses} meses.
					</p>
				</div>
				<div className="space-y-2">
					<Label htmlFor="convenio-total">Monto total</Label>
					<CurrencyInput
						id="convenio-total"
						value={total.toFixed(2)}
						onChange={() => {}}
						disabled
					/>
					<p className="text-muted-foreground text-xs">
						Cuotas seleccionadas más la mora.
					</p>
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
					Se cobra además de la cuota normal de {Q(cuotaMensual)}: el cliente
					pagará {Q(cuotaConvenio + cuotaMensual)} al mes durante {meses}{" "}
					{meses === 1 ? "mes" : "meses"}.
				</p>
			</div>

			{ofrecerAbono && (
				<div className="space-y-2 rounded-md border border-dashed p-3">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<Label htmlFor="convenio-abono-hoy">Abono de hoy (opcional)</Label>
						{creditoId ? (
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={crear.isPending}
								onClick={() => setRegistrandoAbono(true)}
							>
								<Receipt aria-hidden className="mr-1.5 h-4 w-4" />
								Registrar abono con comprobante
							</Button>
						) : null}
					</div>
					{abonos.length === 0 ? (
						<p className="text-muted-foreground text-xs">
							{creditoId
								? "El cliente no tiene abonos de hoy. Registre el abono con su comprobante: queda elegido aquí y el convenio se puede crear cuando contabilidad lo valide."
								: "El cliente no tiene abonos validados hoy. Para descontar un abono, regístrelo primero como pago con su comprobante y espere la validación de contabilidad."}
						</p>
					) : (
						<>
							<Select
								value={abonoId === null ? "ninguno" : String(abonoId)}
								onValueChange={(v) =>
									setAbonoId(v === "ninguno" ? null : Number(v))
								}
							>
								<SelectTrigger id="convenio-abono-hoy">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="ninguno">Sin abono inicial</SelectItem>
									{abonos.map((a) => (
										<SelectItem key={a.pagoId} value={String(a.pagoId)}>
											Pago #{a.pagoId} · {Q(a.monto)}
											{a.validado === false ? " · en validación" : ""}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							{abonoSinValidar ? (
								<p className="text-warning-text text-xs">
									Contabilidad todavía no valida este abono. El convenio se
									puede crear con él cuando esté validado, hoy mismo. Para
									crearlo ya, elija «Sin abono inicial».
								</p>
							) : null}
							{abono && !abonoSinValidar && total > 0 ? (
								<p className="text-muted-foreground text-xs">
									{descuentoAbono > 0
										? `Se descuentan ${Q(descuentoAbono)} del total: el convenio cubre solo el remanente de ${Q(total)}.`
										: "Este abono no se aplicó a las cuotas seleccionadas; la mora ya lo refleja, así que el total no cambia."}
								</p>
							) : null}
							{abono && total <= 0 && seleccion.length > 0 ? (
								<p className="text-danger-text text-xs">
									El abono cubre todo lo seleccionado: no queda deuda para el
									convenio. Elija otro abono o quite el abono inicial.
								</p>
							) : null}
						</>
					)}
				</div>
			)}

			{/* Motivo / observaciones */}
			<div className="space-y-2">
				<Label htmlFor="convenio-motivo">Motivo del convenio *</Label>
				<Textarea
					id="convenio-motivo"
					value={motivo}
					onChange={(e) => setMotivo(e.target.value)}
					placeholder="Ej.: cliente solicita convenio por dificultades económicas temporales"
					rows={2}
					required
				/>
			</div>
			<div className="space-y-2">
				<Label htmlFor="convenio-observaciones">Observaciones (opcional)</Label>
				<Textarea
					id="convenio-observaciones"
					value={observaciones}
					onChange={(e) => setObservaciones(e.target.value)}
					placeholder="Información adicional relevante…"
					rows={2}
				/>
			</div>
		</div>
	);

	// W4 · Registrar el abono sin salir del convenio. El formulario del
	// convenio sigue montado en el estado de este componente: al volver, las
	// cuotas, el plazo y el motivo están como se dejaron.
	const registroAbono = creditoId ? (
		<RegistrarPagoForm
			embebido
			creditoId={creditoId}
			onVolver={() => setRegistrandoAbono(false)}
			onExito={alRegistrarAbono}
		/>
	) : null;

	if (embebido && registrandoAbono && registroAbono) {
		return (
			<div className="@container flex min-h-0 flex-1 flex-col gap-3">
				<p className="shrink-0 text-muted-foreground text-sm">
					Registre el comprobante del abono. Al terminar vuelve al convenio con
					el abono elegido como «Abono de hoy».
				</p>
				{registroAbono}
			</div>
		);
	}

	if (embebido) {
		return (
			<div className="@container flex min-h-0 flex-1 flex-col">
				<form
					className="flex min-h-0 flex-1 flex-col gap-3"
					onSubmit={onSubmit}
				>
					{cuerpo}
					<div className="mt-auto flex gap-2 border-line-subtle border-t pt-3">
						<Button
							type="button"
							variant="outline"
							onClick={() => onCancelar?.()}
							disabled={crear.isPending}
						>
							Cancelar
						</Button>
						{botonCrear}
					</div>
				</form>
			</div>
		);
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				ref={setCajaDialogo}
				className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
			>
				<DialogHeader className="px-6 pt-6">
					<DialogTitle className="flex items-center gap-2">
						<Handshake className="h-4 w-4 text-blue-700 dark:text-blue-300" />
						{registrandoAbono && registroAbono
							? `Abono del convenio - ${clienteNombre}`
							: `Convenio de pago - ${clienteNombre}`}
					</DialogTitle>
					<DialogDescription>
						{registrandoAbono && registroAbono
							? "Registre el comprobante del abono. Al terminar vuelve al convenio con el abono elegido como «Abono de hoy»."
							: descripcion}
					</DialogDescription>
				</DialogHeader>

				{registrandoAbono && registroAbono ? (
					// El calendario de la boleta se monta en la caja del diálogo: el
					// formulario embebido usa `@container` (ver PopoverPortalContext).
					<div className="flex min-h-0 flex-1 flex-col px-6 pt-4 pb-4">
						<PopoverPortalContext.Provider value={cajaDialogo}>
							{registroAbono}
						</PopoverPortalContext.Provider>
					</div>
				) : (
					<form className="flex min-h-0 flex-1 flex-col" onSubmit={onSubmit}>
						{cuerpo}

						<DialogFooter className="border-t bg-background px-6 py-4">
							<Button
								type="button"
								variant="outline"
								onClick={() => onOpenChange(false)}
								disabled={crear.isPending}
							>
								Cancelar
							</Button>
							{botonCrear}
						</DialogFooter>
					</form>
				)}
			</DialogContent>
		</Dialog>
	);
}

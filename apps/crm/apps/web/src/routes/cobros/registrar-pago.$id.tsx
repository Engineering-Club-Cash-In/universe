import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
	ArrowLeft,
	CalendarIcon,
	CheckCircle2,
	DollarSign,
	Loader2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { DistribucionPagoDetalle } from "@/components/cobros/distribucion-pago-detalle";
import { aFechaISO, aFechaISO_GT } from "@/components/cobros/historial/formato";
import {
	ConvenioActivoCard,
	ResumenCreditoPago,
} from "@/components/cobros/resumen-credito-pago";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { CurrencyInput } from "@/components/ui/currency-input";
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
import {
	calcularDistribucionPago,
	getConvenioAplicado,
	getDisplayedPartialContribution,
} from "@/lib/cobros/registrar-pago";
import { cn } from "@/lib/utils";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/cobros/registrar-pago/$id")({
	component: RegistrarPagoPage,
});

interface UploadBoletaResponse {
	success: boolean;
	data?: { filename: string };
	error?: string;
}

/**
 * CB-128: réplica funcional del registro de pago de carteraFront
 * (PagoForm.tsx + registerPayment.ts) como página dedicada de la Ficha 360
 * (antes era un Dialog — ver historial de registrar-pago-modal.tsx). Los
 * cálculos de distribución/excedente son informativos para el asesor —
 * cartera-back sigue siendo quien aplica y persiste el pago real en
 * POST /newPayment, igual que cuando lo registra tesorería desde carteraFront.
 */
function RegistrarPagoPage() {
	const { id } = Route.useParams();
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const casoDetails = useQuery({
		...orpc.getDetallesCreditoCarteraBack.queryOptions({
			input: { creditoId: id },
		}),
		enabled: !!id,
	});
	const caso = casoDetails.data as
		| { id?: string | null; numeroCreditoSifco?: string | null }
		| undefined;
	const casoCobroId = caso?.id ?? "";
	const numeroCreditoSifco = caso?.numeroCreditoSifco ?? "";

	const [cuotaSeleccionada, setCuotaSeleccionada] = useState<
		number | undefined
	>(undefined);
	const [montoBoleta, setMontoBoleta] = useState("");
	const [otros, setOtros] = useState("");
	const [bancoId, setBancoId] = useState<string | null>(null);
	const [origenPago, setOrigenPago] = useState<
		"transferencia" | "cheque" | "boleta" | ""
	>("");
	const [numeroAutorizacion, setNumeroAutorizacion] = useState("");
	// CB-128: el default no puede ser new Date() (día calendario del
	// navegador) — en un offset adelantado (ej. UTC+14) preseleccionaría un
	// día que en Guatemala aún no llega, y el cutoff de fecha futura lo
	// marcaría disabled sin que el asesor entienda por qué. Se inicializa
	// directo desde el día calendario GT.
	const [fechaBoleta, setFechaBoleta] = useState<Date | undefined>(
		() => new Date(`${aFechaISO_GT(new Date())}T12:00:00`),
	);
	const [observaciones, setObservaciones] = useState("");
	const [archivo, setArchivo] = useState<File | null>(null);
	const [confirmacionAbierta, setConfirmacionAbierta] = useState(false);

	const creditoQuery = useQuery({
		...orpc.getCreditoParaPago.queryOptions({
			input: { numeroSifco: numeroCreditoSifco },
		}),
		enabled: !!numeroCreditoSifco,
	});

	const bancosQuery = useQuery({
		...orpc.getBancosParaPago.queryOptions(),
	});

	const promesaActivaQuery = useQuery({
		...orpc.getPromesaActivaParaPago.queryOptions({
			input: { creditoId: creditoQuery.data?.credito.credito_id ?? 0 },
		}),
		enabled: !!creditoQuery.data?.credito.credito_id,
	});

	const abonosCuotaQuery = useQuery({
		...orpc.getAbonosCuotaParaPago.queryOptions({
			input: {
				numeroSifco: numeroCreditoSifco,
				numeroCuota: cuotaSeleccionada ?? 0,
			},
		}),
		enabled: !!cuotaSeleccionada,
	});

	const credito = creditoQuery.data;
	const convenioActivo = credito?.convenioActivo;
	// CB-128: el cutoff de "fecha futura" debe usar el día calendario de
	// GUATEMALA, no el del reloj del navegador — fechaPago ya se manda con
	// aFechaISO_GT(new Date()) al confirmar, así que un asesor en un offset
	// adelantado (ej. UTC+14, donde "hoy" del navegador ya es "mañana" en GT)
	// no debe poder seleccionar una fechaBoleta posterior al fechaPago real.
	const hoyGT = aFechaISO_GT(new Date());
	// CB-128: cartera-back rechaza el pago en /newPayment si el crédito está
	// PENDIENTE_CANCELACION (registerPaymentPolicy.ts), pero solo DESPUÉS de
	// subir la boleta — bloquear acá evita el archivo huérfano y el
	// formulario en vano. CANCELADO tampoco tiene cuotas pagables (dead end).
	const statusBloqueado =
		credito?.credito.statusCredit === "PENDIENTE_CANCELACION" ||
		credito?.credito.statusCredit === "CANCELADO";
	const bancoOptions: ComboboxOption[] = useMemo(
		() =>
			(bancosQuery.data ?? []).map((b) => ({
				value: String(b.banco_id),
				label: b.nombre,
			})),
		[bancosQuery.data],
	);

	const mora = Number(credito?.moraActual ?? credito?.mora?.monto_mora ?? 0);
	const cuotaBase = Number(credito?.credito.cuota ?? 0);
	const cuotaConvenio = Number(
		credito?.convenioActivo?.cuotaConvenioAPagar ?? 0,
	);
	const saldoAFavor = Number(credito?.usuario.saldo_a_favor ?? 0);
	const abonosYaHechos = getDisplayedPartialContribution(
		abonosCuotaQuery.data ?? null,
	);
	const montoBoletaNum = Number(montoBoleta || 0);
	const otrosNum = Number(otros || 0);

	const { distribucion, montoRestante } = calcularDistribucionPago({
		montoBoleta: montoBoletaNum,
		otros: otrosNum,
		mora,
		cuotaConvenio,
		cuotaBase,
		abonosYaHechos,
		cuotaSeleccionada,
	});

	const convenioAplicado = getConvenioAplicado(
		montoBoletaNum,
		otrosNum,
		mora,
		cuotaConvenio,
	);

	// CB-128: mismo criterio que cardInfo.tsx de carteraFront — el asesor no
	// elige libremente cualquier cuota atrasada, siempre paga la más antigua
	// pagable primero (no se salta deuda anterior). Filtra las ya validadas.
	const todasLasCuotas = useMemo(
		() =>
			credito
				? [...credito.cuotasAtrasadas, ...credito.cuotasPendientes].sort(
						(a, b) => a.numero_cuota - b.numero_cuota,
					)
				: [],
		[credito],
	);
	const cuotaPagable = useMemo(() => {
		return todasLasCuotas.find((c) => {
			// ValidationStatusEnum del server no declara "capital_validated"
			// (solo lo usa cartera-back en algunos créditos con abono directo a
			// capital), así que se compara como string libre en vez de forzar
			// el enum incompleto — mismo valor real que filtra cardInfo.tsx.
			const status: string | null | undefined = c.validationStatus;
			return status !== "validated" && status !== "capital_validated";
		});
	}, [todasLasCuotas]);

	// cuotaActual puede venir como objeto o como número plano (mismo comentario
	// "antes era número, ahora es objeto" que registerPayment.ts:296-300).
	const cuotaActualObj =
		typeof credito?.cuotaActual === "object" ? credito.cuotaActual : undefined;
	const cuotaActualNumero =
		cuotaActualObj?.numero_cuota ??
		(typeof credito?.cuotaActual === "number"
			? credito.cuotaActual
			: undefined);

	// Fallback en cascada: cuota pagable filtrada → cuota actual del crédito →
	// la primera cuota atrasada/pendiente sin filtrar (más segura que dejar la
	// selección vacía cuando ninguna de las dos fuentes de arriba trae dato).
	useEffect(() => {
		setCuotaSeleccionada(
			cuotaPagable?.numero_cuota ??
				cuotaActualNumero ??
				todasLasCuotas[0]?.numero_cuota,
		);
	}, [cuotaPagable, cuotaActualNumero, todasLasCuotas]);

	function volverAlCredito() {
		navigate({ to: "/cobros/$id", params: { id }, search: { tipo: "caso" } });
	}

	const registrarPagoMutation = useMutation({
		mutationFn: async () => {
			if (!cuotaSeleccionada) throw new Error("Selecciona una cuota a pagar");
			if (!fechaBoleta) throw new Error("Selecciona la fecha de la boleta");
			if (!credito) throw new Error("No se pudo cargar el crédito");
			if (!bancoId) throw new Error("Selecciona el banco");
			if (!origenPago) throw new Error("Selecciona el origen del pago");

			let urlBoletas: string[] = [];
			if (archivo) {
				const formData = new FormData();
				formData.append("file", archivo);
				// La ruta es del server (Hono), no del dev server de Vite — sin el
				// prefijo, una URL relativa pega contra el origen del frontend
				// (localhost:3001) y el SPA fallback devuelve HTML, no JSON.
				const res = await fetch(
					`${import.meta.env.VITE_SERVER_URL}/api/upload-boleta-pago`,
					{
						method: "POST",
						body: formData,
						credentials: "include",
					},
				);
				const text = await res.text();
				let json: unknown;
				try {
					json = JSON.parse(text);
				} catch {
					throw new Error(
						`Respuesta inesperada del servidor al subir la boleta (HTTP ${res.status})`,
					);
				}
				const respuesta = json as UploadBoletaResponse;
				if (!res.ok || !respuesta.success) {
					throw new Error(respuesta.error || "Error al subir la boleta");
				}
				const filename = respuesta.data?.filename;
				if (typeof filename !== "string" || !filename) {
					throw new Error(
						"Respuesta inesperada del servidor al subir la boleta (falta el nombre del archivo)",
					);
				}
				urlBoletas = [filename];
			}

			return orpc.registrarPagoCompleto.call({
				casoCobroId,
				numeroSifco: numeroCreditoSifco,
				creditoId: credito.credito.credito_id,
				usuarioId: credito.usuario.usuario_id,
				cuotaApagar: cuotaSeleccionada,
				montoBoleta: montoBoletaNum,
				// fecha_pago es "hoy" (día en que se registra), distinto de
				// fechaBoleta (fecha que trae la boleta física) — mismo campo
				// separado que carteraFront. Día calendario de GUATEMALA (no
				// UTC): toISOString().split("T")[0] corría el día después de las
				// 18:00 hora GT (UTC-6), registrando el pago con fecha de mañana.
				fechaPago: aFechaISO_GT(new Date()),
				// El Calendar produce un Date a medianoche LOCAL del navegador del
				// asesor — convertir esa medianoche directo a ISO corre el día en
				// cualquier offset positivo. Anclar a mediodía LOCAL antes de
				// convertir tampoco alcanza: en UTC+13/+14 (Samoa, Kiribati, NZ en
				// horario de verano) el mediodía local sigue cayendo en el día UTC
				// anterior. Se construye el instante directo en UTC a partir de los
				// componentes de fecha (aFechaISO ya da el día calendario LOCAL del
				// asesor en YYYY-MM-DD) — sin pasar por ningún Date que interprete
				// hora local, así que ningún offset puede correr el día.
				fechaBoleta: `${aFechaISO(fechaBoleta)}T12:00:00.000Z`,
				otros: otrosNum || undefined,
				bancoId: Number(bancoId),
				origenPago: origenPago,
				// normalizeForSubmit es para valores de moneda (trata el texto como
				// intPart.decPart) — aplicarlo a texto libre trunca todo después del
				// segundo punto ("Ref. 123. confirmado" → "Ref. 123") o corrompe un
				// texto que empieza con punto (".pendiente" → "0.pendiente"). Estos
				// campos solo necesitan trim + undefined si quedan vacíos.
				numeroAutorizacion: numeroAutorizacion.trim() || undefined,
				observaciones: observaciones.trim() || undefined,
				urlBoletas,
			});
		},
		onSuccess: (data) => {
			// El mensaje puede ser informativo (ej. "Pago parcial de mora
			// aplicado...") en vez del genérico — mismo texto que carteraFront
			// muestra como notificación de éxito en este caso.
			toast.success(data?.message || "Pago registrado correctamente");
			// El dinero SÍ se aplicó en cartera-back — esto solo avisa que la
			// gestión no quedó anotada en el historial/cumplimiento de agenda del
			// caso (insert best-effort, ver registrarPagoCompleto). Sin este aviso
			// el asesor no se entera y el objetivo del feature se pierde en
			// silencio.
			if (data?.gestionRegistrada === false) {
				toast.warning(
					"El pago se aplicó correctamente, pero no se pudo registrar como gestión en el historial del caso. Avisa a soporte para que lo agregue manualmente.",
					{ duration: 10000 },
				);
			}
			queryClient.invalidateQueries(
				orpc.getHistorialContactos.queryOptions({ input: { casoCobroId } }),
			);
			queryClient.invalidateQueries({
				predicate: (query) =>
					query.queryKey.some(
						(k) =>
							typeof k === "string" &&
							(k.includes("getDetallesCreditoCarteraBack") ||
								k.includes("getHistorialAgendas") ||
								k.includes("getHistorialPagosCarteraBack")),
					),
			});
			setConfirmacionAbierta(false);
			volverAlCredito();
		},
		onError: (error: unknown) => {
			const mensaje = error instanceof Error ? error.message : undefined;
			toast.error(mensaje || "Error al registrar el pago");
			setConfirmacionAbierta(false);
		},
	});

	function handleAbrirConfirmacion() {
		if (!cuotaSeleccionada) {
			toast.error("Selecciona una cuota a pagar");
			return;
		}
		// CB-128: mientras getAbonosCuotaParaPago carga o falla, abonosYaHechos
		// cae a 0 por el fallback (abonosCuotaQuery.data ?? null) — si la cuota
		// sí tiene abonos previos, la vista previa de distribución mostraría un
		// monto de cuota más alto del real. cartera-back igual calcula bien el
		// pago server-side, pero el asesor vería una distribución incorrecta
		// antes de confirmar.
		if (abonosCuotaQuery.isLoading) {
			toast.error("Cargando abonos previos de la cuota, espera un momento");
			return;
		}
		if (abonosCuotaQuery.isError) {
			toast.error(
				"No se pudieron cargar los abonos previos de la cuota, intenta de nuevo",
			);
			return;
		}
		if (!montoBoletaNum || montoBoletaNum <= 0) {
			toast.error("Indica el monto de la boleta");
			return;
		}
		// CB-128: mismo refine (en centavos enteros) que registrarPagoCompleto
		// — sin este chequeo acá, el submit subía la boleta y recién el backend
		// rechazaba, dejando el archivo huérfano en storage.
		if (Math.round(otrosNum * 100) > Math.round(montoBoletaNum * 100)) {
			toast.error('El monto de "Otros" no puede ser mayor que la boleta');
			return;
		}
		if (!bancoId) {
			toast.error("Selecciona el banco");
			return;
		}
		if (!origenPago) {
			toast.error("Selecciona el origen del pago");
			return;
		}
		if (!fechaBoleta) {
			toast.error("Selecciona la fecha de la boleta");
			return;
		}
		// CB-128: segunda capa de defensa además del disabled del Calendar —
		// evita registrar una fecha de boleta posterior al día calendario GT
		// aunque fechaBoleta llegue con un valor inválido por otra vía.
		if (aFechaISO(fechaBoleta) > hoyGT) {
			toast.error("La fecha de la boleta no puede ser futura");
			return;
		}
		if (!archivo) {
			toast.error("Adjunta la boleta o comprobante de pago");
			return;
		}
		// CB-128: mismos límites de registrarPagoCompleto (cobros.ts:4371-4372)
		// — sin este chequeo acá, el submit subía la boleta y recién el backend
		// rechazaba, dejando el archivo huérfano en storage.
		if (numeroAutorizacion.length > 100) {
			toast.error("El número de autorización no puede superar 100 caracteres");
			return;
		}
		if (observaciones.length > 2000) {
			toast.error("Las observaciones no pueden superar 2000 caracteres");
			return;
		}
		setConfirmacionAbierta(true);
	}

	return (
		<div className="container mx-auto max-w-5xl space-y-6 p-6">
			<div className="flex items-center gap-2 text-muted-foreground text-sm">
				<Link to="/cobros/$id" params={{ id }} search={{ tipo: "caso" }}>
					Cobros
				</Link>
				<span>/</span>
				<Link to="/cobros/$id" params={{ id }} search={{ tipo: "caso" }}>
					Crédito {numeroCreditoSifco || "..."}
				</Link>
				<span>/</span>
				<span className="text-foreground">Registrar pago</span>
			</div>

			<div className="flex items-center gap-3">
				<Button variant="ghost" size="icon" onClick={volverAlCredito}>
					<ArrowLeft className="h-4 w-4" />
				</Button>
				<h1 className="flex items-center gap-2 font-bold text-2xl tracking-tight">
					<DollarSign className="h-6 w-6 text-primary" />
					Registrar pago
				</h1>
			</div>

			{casoDetails.isLoading || creditoQuery.isLoading ? (
				<Card>
					<CardContent className="flex items-center justify-center gap-2 py-12 text-muted-foreground text-sm">
						<Loader2 className="h-4 w-4 animate-spin" />
						Cargando crédito...
					</CardContent>
				</Card>
			) : credito && statusBloqueado ? (
				<Card>
					<CardContent className="py-12 text-center text-muted-foreground text-sm">
						{credito.credito.statusCredit === "PENDIENTE_CANCELACION"
							? "Este crédito está pendiente de cancelación y no admite nuevos pagos."
							: "Este crédito está cancelado y no admite nuevos pagos."}
					</CardContent>
				</Card>
			) : credito ? (
				<div className="space-y-6">
					<div
						className={cn(
							"grid gap-6",
							convenioActivo ? "lg:grid-cols-2" : "lg:grid-cols-1",
						)}
					>
						<Card>
							<CardHeader>
								<CardTitle className="text-base">Resumen del crédito</CardTitle>
							</CardHeader>
							<CardContent>
								<ResumenCreditoPago
									credito={credito}
									cuotaActualNumero={cuotaActualNumero}
									cuotaActualPagada={!!credito.cuotaActualPagada}
									cuotaActualStatus={credito.cuotaActualStatus}
									abonosTotal={abonosYaHechos}
									promesaActiva={promesaActivaQuery.data}
								/>
							</CardContent>
						</Card>

						{convenioActivo && (
							<Card>
								<CardHeader>
									<CardTitle className="flex items-center gap-2 text-base">
										Convenio de Pago
										<span className="rounded-full bg-secondary px-2 py-0.5 font-medium text-secondary-foreground text-xs">
											Activo
										</span>
									</CardTitle>
								</CardHeader>
								<CardContent>
									<ConvenioActivoCard convenio={convenioActivo} />
								</CardContent>
							</Card>
						)}
					</div>

					<Card>
						<CardHeader>
							<CardTitle className="text-base">Datos del pago</CardTitle>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
								<div className="space-y-1.5">
									<Label>Cuota a pagar</Label>
									<div className="flex h-9 items-center rounded-md border bg-muted/30 px-3 font-medium text-sm">
										{cuotaSeleccionada
											? `Cuota #${cuotaSeleccionada}`
											: "Sin cuotas pendientes"}
									</div>
								</div>

								<div className="space-y-1.5">
									<Label>Monto boleta *</Label>
									<CurrencyInput
										value={montoBoleta}
										onChange={setMontoBoleta}
									/>
								</div>

								<div className="space-y-1.5">
									<Label>Otros (opcional)</Label>
									<CurrencyInput value={otros} onChange={setOtros} />
								</div>

								<div className="space-y-1.5">
									<Label>Banco *</Label>
									<Combobox
										options={bancoOptions}
										value={bancoId}
										onChange={setBancoId}
										isLoading={bancosQuery.isLoading}
										width="full"
										popOverWidth="full"
										placeholder="Selecciona banco"
									/>
								</div>

								<div className="space-y-1.5">
									<Label>Origen de pago *</Label>
									<Select
										value={origenPago}
										onValueChange={(v) => setOrigenPago(v as typeof origenPago)}
									>
										<SelectTrigger className="w-full">
											<SelectValue placeholder="Selecciona origen" />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="transferencia">
												Transferencia
											</SelectItem>
											<SelectItem value="cheque">Cheque</SelectItem>
											<SelectItem value="boleta">Boleta</SelectItem>
										</SelectContent>
									</Select>
								</div>

								<div className="space-y-1.5">
									<Label>No. Autorización (opcional)</Label>
									<Input
										value={numeroAutorizacion}
										onChange={(e) => setNumeroAutorizacion(e.target.value)}
										placeholder="Ej: 123456789"
										maxLength={100}
									/>
								</div>

								<div className="space-y-1.5">
									<Label>Fecha de boleta *</Label>
									<Popover>
										<PopoverTrigger asChild>
											<Button
												type="button"
												variant="outline"
												className={cn(
													"w-full justify-start text-left font-normal",
													!fechaBoleta && "text-muted-foreground",
												)}
											>
												<CalendarIcon className="mr-2 h-4 w-4" />
												{fechaBoleta
													? format(fechaBoleta, "dd MMM, yyyy", { locale: es })
													: "Seleccionar fecha"}
											</Button>
										</PopoverTrigger>
										<PopoverContent className="w-auto p-0" align="start">
											<Calendar
												mode="single"
												selected={fechaBoleta}
												onSelect={setFechaBoleta}
												disabled={(dia) => aFechaISO(dia) > hoyGT}
											/>
										</PopoverContent>
									</Popover>
								</div>

								<div className="space-y-1.5">
									<Label>Boleta / comprobante *</Label>
									<Input
										type="file"
										accept="image/*,application/pdf"
										onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
									/>
									{archivo && (
										<p className="truncate text-muted-foreground text-xs">
											{archivo.name}
										</p>
									)}
								</div>
							</div>

							<div className="space-y-1.5">
								<Label>Observaciones (opcional)</Label>
								<Textarea
									value={observaciones}
									onChange={(e) => setObservaciones(e.target.value)}
									placeholder="Notas adicionales..."
									rows={3}
									maxLength={2000}
								/>
							</div>
						</CardContent>
					</Card>

					<div className="flex justify-end gap-2">
						<Button variant="outline" onClick={volverAlCredito}>
							Cancelar
						</Button>
						<Button onClick={handleAbrirConfirmacion}>Registrar pago</Button>
					</div>
				</div>
			) : (
				<Card>
					<CardContent className="py-12 text-center text-muted-foreground text-sm">
						No se pudo cargar la información del crédito.
					</CardContent>
				</Card>
			)}

			<Dialog open={confirmacionAbierta} onOpenChange={setConfirmacionAbierta}>
				<DialogContent className="max-w-lg">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<CheckCircle2 className="h-6 w-6 text-green-600" />
							Confirmar registro de pago
						</DialogTitle>
					</DialogHeader>

					<DistribucionPagoDetalle
						distribucion={distribucion}
						montoRestante={montoRestante}
						montoBoleta={montoBoletaNum}
						saldoAFavor={saldoAFavor}
						otros={otrosNum}
						mora={mora}
						convenioAplicado={convenioAplicado}
					/>

					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setConfirmacionAbierta(false)}
						>
							Volver
						</Button>
						<Button
							onClick={() => registrarPagoMutation.mutate()}
							disabled={registrarPagoMutation.isPending}
						>
							{registrarPagoMutation.isPending ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : (
								"Confirmar pago"
							)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}

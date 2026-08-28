import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
	AlertTriangle,
	ArrowLeft,
	CalendarIcon,
	CheckCircle2,
	DollarSign,
	FileText,
	ImageIcon,
	Loader2,
	Upload,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { bancosSugeridos } from "server/src/lib/bot-cobros/bancos-boleta";
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
	// CB-128: preserva el "tipo" con que se llegó (mismo search param que
	// $id.tsx) para no perder el contexto de navegación al volver — un id de
	// tipo=contrato es el numeroSifco, no un casoCobroId, y $id.tsx decide con
	// tipo qué queries correr (ej. getRecuperacionVehiculo solo si tipo ===
	// "caso"). Forzar siempre "caso" al volver rompía esa distinción para
	// callers como cobros/reportes.tsx que enlazan con tipo=contrato.
	validateSearch: (search: Record<string, unknown>) => ({
		tipo: (search.tipo as "caso" | "contrato") || "caso",
	}),
});

interface UploadBoletaResponse {
	success: boolean;
	data?: { filename: string };
	error?: string;
}

/** Lo que devuelve /api/leer-boleta-pago (mismo lector que usa el bot). */
type BoletaLeidaCRM = {
	esBoletaDePago: boolean;
	monto: number | null;
	bancoId: number | null;
	bancoNombre: string | null;
	bancoLeido: string | null;
	fechaBoleta: string;
	fechaCorregida: boolean;
	numeroAutorizacion: string | null;
	origenPago: "transferencia" | "cheque" | "boleta" | null;
	observaciones: string | null;
	camposNoLeidos: string[];
};

/** Etiqueta del campo autocompletado, para el aviso de "revisá esto". */
const ETIQUETA_CAMPO: Record<string, string> = {
	banco: "banco",
	monto: "monto",
	fechaBoleta: "fecha de la boleta",
	numeroAutorizacion: "número de autorización",
	cuentaDestino: "cuenta destino",
};

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
	const { tipo } = Route.useSearch();
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
	// Casi todos los pagos entran por transferencia: se deja puesta y el asesor
	// la cambia si el comprobante es otra cosa. El lector NO la pisa — el tipo
	// de operación impreso no dice cómo entró el dinero a la cuenta.
	const [origenPago, setOrigenPago] = useState<
		"transferencia" | "cheque" | "boleta" | ""
	>("transferencia");
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
	const [lectura, setLectura] = useState<BoletaLeidaCRM | null>(null);
	const [errorLectura, setErrorLectura] = useState<string | null>(null);
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);
	const inputArchivoRef = useRef<HTMLInputElement>(null);
	const [arrastrando, setArrastrando] = useState(false);

	const creditoQuery = useQuery({
		...orpc.getCreditoParaPago.queryOptions({
			input: { numeroSifco: numeroCreditoSifco },
		}),
		enabled: !!numeroCreditoSifco,
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
	// MISMO catálogo que usa el lector de boletas del bot (bancos-boleta.ts):
	// `cartera.bancos` tiene 24 filas para ~15 bancos reales (Banrural dos
	// veces, BAM tres, y un "test" con 92 pagos encima). Elegir de la tabla
	// cruda es elegir en cuál de las copias va a buscar conta el dinero.
	const bancoOptions: ComboboxOption[] = useMemo(
		() =>
			bancosSugeridos().map((b: { id: number; nombre: string }) => ({
				value: String(b.id),
				label: b.nombre,
			})),
		[],
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

	// Lectura de la boleta con IA. El archivo NO se sube acá: se manda, se lee
	// y se descarta. La subida a R2 sigue pasando al registrar el pago, así una
	// boleta que el asesor descarta no deja basura en storage.
	const leerBoletaMutation = useMutation({
		mutationFn: async (file: File) => {
			const formData = new FormData();
			formData.append("file", file);
			const res = await fetch(
				`${import.meta.env.VITE_SERVER_URL}/api/leer-boleta-pago`,
				{ method: "POST", body: formData, credentials: "include" },
			);
			const texto = await res.text();
			let json: unknown;
			try {
				json = JSON.parse(texto);
			} catch {
				throw new Error(
					`Respuesta inesperada del servidor al leer la boleta (HTTP ${res.status})`,
				);
			}
			const respuesta = json as {
				success?: boolean;
				data?: BoletaLeidaCRM;
				error?: string;
			};
			if (!res.ok || !respuesta.success || !respuesta.data) {
				throw new Error(
					respuesta.error || "No se pudo leer la boleta automáticamente",
				);
			}
			return respuesta.data;
		},
		onSuccess: (datos) => {
			setLectura(datos);
			setErrorLectura(null);
			if (!datos.esBoletaDePago) return;

			if (datos.monto !== null) setMontoBoleta(datos.monto.toFixed(2));
			if (datos.bancoId !== null) setBancoId(String(datos.bancoId));
			if (datos.numeroAutorizacion) {
				setNumeroAutorizacion(datos.numeroAutorizacion.slice(0, 100));
			}
			// `fechaCorregida` = el modelo no la leyó (o vino futura) y el servicio
			// la acotó a hoy: eso NO es un dato de la boleta, así que se deja el
			// default en vez de escribir una fecha que nadie leyó.
			if (!datos.fechaCorregida) {
				setFechaBoleta(new Date(`${datos.fechaBoleta}T12:00:00`));
			}
		},
		onError: (error: unknown) => {
			setLectura(null);
			setErrorLectura(
				error instanceof Error
					? error.message
					: "No se pudo leer la boleta automáticamente",
			);
		},
	});

	function seleccionarArchivo(file: File | null) {
		setArchivo(file);
		setLectura(null);
		setErrorLectura(null);
		setPreviewUrl((anterior) => {
			if (anterior) URL.revokeObjectURL(anterior);
			return file && file.type.startsWith("image/")
				? URL.createObjectURL(file)
				: null;
		});
		if (file) leerBoletaMutation.mutate(file);
	}

	// El objectURL vive fuera de React: sin esto, cada boleta que el asesor
	// cambia deja su blob retenido hasta que recargue la página.
	useEffect(
		() => () => {
			if (previewUrl) URL.revokeObjectURL(previewUrl);
		},
		[previewUrl],
	);

	function volverAlCredito() {
		navigate({ to: "/cobros/$id", params: { id }, search: { tipo } });
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
			// La lista que PINTA la ficha es la paginada: sin esto, el contacto
			// recién registrado no aparece hasta un refresh.
			queryClient.invalidateQueries(
				orpc.getHistorialContactosPaginado.queryOptions({
					input: { casoCobroId },
				}),
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
				<Link to="/cobros/$id" params={{ id }} search={{ tipo }}>
					Cobros
				</Link>
				<span>/</span>
				<Link to="/cobros/$id" params={{ id }} search={{ tipo }}>
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
				// Dos columnas: a la izquierda lo que el asesor HACE (subir la
				// boleta y revisar los datos), a la derecha el crédito como
				// contexto fijo. Antes todo iba apilado y el formulario quedaba
				// debajo del pliegue, después de un resumen de media pantalla.
				<div className="grid gap-6 lg:grid-cols-5 lg:items-start">
					<div className="space-y-6 lg:col-span-3">
						<Card>
							<CardHeader className="space-y-1">
								<CardTitle className="flex items-center gap-2 text-base">
									<span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground text-xs">
										1
									</span>
									Boleta de pago
								</CardTitle>
								<p className="text-muted-foreground text-sm">
									Subí el comprobante y leemos los datos automáticamente — mismo
									lector que usa el bot de WhatsApp. Revisalos antes de
									registrar.
								</p>
							</CardHeader>
							<CardContent className="space-y-4">
								<input
									accept="image/*,application/pdf"
									className="hidden"
									onChange={(e) =>
										seleccionarArchivo(e.target.files?.[0] ?? null)
									}
									ref={inputArchivoRef}
									type="file"
								/>
								{archivo ? (
									<div className="flex items-center gap-3 rounded-lg border p-3">
										{previewUrl ? (
											<img
												alt="Boleta"
												className="h-16 w-16 shrink-0 rounded-md border object-cover"
												src={previewUrl}
											/>
										) : (
											<span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border bg-muted/40">
												<FileText className="h-6 w-6 text-muted-foreground" />
											</span>
										)}
										<div className="min-w-0 flex-1">
											<p className="truncate font-medium text-sm">
												{archivo.name}
											</p>
											<p className="text-muted-foreground text-xs">
												{(archivo.size / 1024).toFixed(0)} KB
											</p>
										</div>
										<Button
											onClick={() => inputArchivoRef.current?.click()}
											size="sm"
											type="button"
											variant="outline"
										>
											Cambiar
										</Button>
									</div>
								) : (
									<button
										className={cn(
											"flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors hover:border-primary/50 hover:bg-muted/30",
											arrastrando && "border-primary bg-primary/5",
										)}
										onClick={() => inputArchivoRef.current?.click()}
										onDragLeave={() => setArrastrando(false)}
										onDragOver={(e) => {
											e.preventDefault();
											setArrastrando(true);
										}}
										onDrop={(e) => {
											e.preventDefault();
											setArrastrando(false);
											seleccionarArchivo(e.dataTransfer.files?.[0] ?? null);
										}}
										type="button"
									>
										<span className="flex h-11 w-11 items-center justify-center rounded-full bg-muted">
											<Upload className="h-5 w-5 text-muted-foreground" />
										</span>
										<span className="font-medium text-sm">
											Arrastrá la boleta acá o hacé clic para elegirla
										</span>
										<span className="text-muted-foreground text-xs">
											JPG, PNG o PDF · hasta 10 MB
										</span>
									</button>
								)}

								{leerBoletaMutation.isPending && (
									<div className="flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50/60 p-3 text-sm dark:border-violet-900 dark:bg-violet-950/30">
										<Loader2 className="h-4 w-4 animate-spin text-violet-600" />
										Leyendo la boleta…
									</div>
								)}

								{!leerBoletaMutation.isPending && errorLectura && (
									<div className="flex items-start justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900 text-sm dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
										<span className="flex items-start gap-2">
											<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
											{errorLectura}
										</span>
										<Button
											className="shrink-0"
											onClick={() =>
												archivo && leerBoletaMutation.mutate(archivo)
											}
											size="sm"
											type="button"
											variant="outline"
										>
											Reintentar
										</Button>
									</div>
								)}

								{!leerBoletaMutation.isPending &&
									lectura &&
									!lectura.esBoletaDePago && (
										<div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-red-900 text-sm dark:border-red-900 dark:bg-red-950/30 dark:text-red-100">
											<ImageIcon className="mt-0.5 h-4 w-4 shrink-0" />
											<span>
												El archivo no parece un comprobante bancario. Revisá que
												sea la boleta correcta; podés registrar el pago igual
												llenando los datos a mano.
											</span>
										</div>
									)}

								{!leerBoletaMutation.isPending && lectura?.esBoletaDePago && (
									<div className="space-y-3 rounded-lg border border-green-300 bg-green-50/60 p-3 dark:border-green-900 dark:bg-green-950/20">
										<p className="flex items-center gap-2 font-medium text-green-800 text-sm dark:text-green-300">
											<CheckCircle2 className="h-4 w-4" />
											Datos leídos de la boleta
										</p>
										<div className="grid gap-2 sm:grid-cols-2">
											{[
												{
													label: "Monto",
													valor:
														lectura.monto !== null
															? `Q${lectura.monto.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
															: null,
												},
												{ label: "Banco", valor: lectura.bancoNombre },
												{
													label: "Fecha",
													valor: lectura.fechaCorregida
														? null
														: lectura.fechaBoleta,
												},
												{
													label: "No. autorización",
													valor: lectura.numeroAutorizacion,
												},
											].map((dato) => (
												<div
													className="rounded-md bg-background/70 px-3 py-2"
													key={dato.label}
												>
													<p className="text-muted-foreground text-xs">
														{dato.label}
													</p>
													<p
														className={cn(
															"truncate font-medium text-sm",
															!dato.valor && "text-muted-foreground",
														)}
													>
														{dato.valor ?? "No se leyó"}
													</p>
												</div>
											))}
										</div>
										{(lectura.bancoId === null ||
											lectura.fechaCorregida ||
											lectura.monto === null ||
											lectura.camposNoLeidos.length > 0) && (
											<ul className="space-y-1 text-amber-800 text-xs dark:text-amber-300">
												{lectura.monto === null && (
													<li>• No se leyó el monto: escribilo a mano.</li>
												)}
												{lectura.bancoId === null && (
													<li>
														• No reconocimos el banco
														{lectura.bancoLeido
															? ` ("${lectura.bancoLeido}")`
															: ""}
														: elegilo de la lista.
													</li>
												)}
												{lectura.fechaCorregida && (
													<li>
														• No se leyó la fecha: quedó la de hoy, corregila si
														la boleta es de otro día.
													</li>
												)}
												{lectura.camposNoLeidos
													.filter(
														(campo) =>
															campo !== "banco" &&
															campo !== "monto" &&
															campo !== "fechaBoleta",
													)
													.map((campo) => (
														<li key={campo}>
															• Sin {ETIQUETA_CAMPO[campo] ?? campo} en la
															boleta.
														</li>
													))}
											</ul>
										)}
									</div>
								)}
							</CardContent>
						</Card>

						<Card>
							<CardHeader className="space-y-1">
								<CardTitle className="flex items-center gap-2 text-base">
									<span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground text-xs">
										2
									</span>
									Datos del pago
								</CardTitle>
								<p className="text-muted-foreground text-sm">
									Se llenan con lo que leímos del comprobante. Corregí lo que
									haga falta.
								</p>
							</CardHeader>
							<CardContent className="space-y-4">
								<div className="grid gap-4 sm:grid-cols-2">
									<div className="space-y-1.5">
										<Label>Monto boleta *</Label>
										<CurrencyInput
											onChange={setMontoBoleta}
											value={montoBoleta}
										/>
									</div>

									<div className="space-y-1.5">
										<Label>Otros (opcional)</Label>
										<CurrencyInput onChange={setOtros} value={otros} />
									</div>

									<div className="space-y-1.5">
										<Label>Banco *</Label>
										<Combobox
											onChange={setBancoId}
											options={bancoOptions}
											placeholder="Selecciona banco"
											popOverWidth="full"
											value={bancoId}
											width="full"
										/>
									</div>

									<div className="space-y-1.5">
										<Label>Origen de pago *</Label>
										<Select
											onValueChange={(v) =>
												setOrigenPago(v as typeof origenPago)
											}
											value={origenPago}
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
											maxLength={100}
											onChange={(e) => setNumeroAutorizacion(e.target.value)}
											placeholder="Ej: 123456789"
											value={numeroAutorizacion}
										/>
									</div>

									<div className="space-y-1.5">
										<Label>Fecha de boleta *</Label>
										<Popover>
											<PopoverTrigger asChild>
												<Button
													className={cn(
														"w-full justify-start text-left font-normal",
														!fechaBoleta && "text-muted-foreground",
													)}
													type="button"
													variant="outline"
												>
													<CalendarIcon className="mr-2 h-4 w-4" />
													{fechaBoleta
														? format(fechaBoleta, "dd MMM, yyyy", {
																locale: es,
															})
														: "Seleccionar fecha"}
												</Button>
											</PopoverTrigger>
											<PopoverContent align="start" className="w-auto p-0">
												<Calendar
													disabled={(dia) => aFechaISO(dia) > hoyGT}
													mode="single"
													onSelect={setFechaBoleta}
													selected={fechaBoleta}
												/>
											</PopoverContent>
										</Popover>
									</div>
								</div>

								<div className="space-y-1.5">
									<Label>Observaciones (opcional)</Label>
									<Textarea
										maxLength={2000}
										onChange={(e) => setObservaciones(e.target.value)}
										placeholder="Notas adicionales..."
										rows={3}
										value={observaciones}
									/>
								</div>
							</CardContent>
						</Card>

						<div className="flex justify-end gap-2">
							<Button onClick={volverAlCredito} variant="outline">
								Cancelar
							</Button>
							<Button onClick={handleAbrirConfirmacion}>Registrar pago</Button>
						</div>
					</div>

					<div className="space-y-6 lg:sticky lg:top-6 lg:col-span-2">
						<Card>
							<CardHeader>
								<CardTitle className="text-base">Resumen del crédito</CardTitle>
							</CardHeader>
							<CardContent>
								<ResumenCreditoPago
									abonosTotal={abonosYaHechos}
									credito={credito}
									cuotaActualNumero={cuotaActualNumero}
									cuotaActualPagada={!!credito.cuotaActualPagada}
									cuotaActualStatus={credito.cuotaActualStatus}
									cuotaAPagar={cuotaSeleccionada}
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

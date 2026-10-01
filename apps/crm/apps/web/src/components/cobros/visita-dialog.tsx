/**
 * CB-037 / CB-038 · Formulario de la visita de cobros: programarla o
 * registrar lo que pasó.
 *
 * Pensado para llenarse EN EL LUGAR, desde el celular: en pantalla chica ocupa
 * toda la pantalla, con el botón de guardar siempre a la vista, y las fotos se
 * toman con la cámara (o se eligen de la galería). Cada foto se achica en el
 * teléfono antes de subirla: una foto de celular pesa 3-8 MB y se sube con
 * datos móviles.
 *
 * El resultado no se queda acá: al guardar, la ficha abre el flujo que ya
 * existe para cada uno (promesa, convenio, entrega voluntaria, registrar
 * pago) — `onRegistrada` le dice cuál.
 *
 * El monto pagado no se teclea (pedido del PM, 2026-10-01): «Pago total» es
 * lo vencido completo, y en «Pago parcial + promesa» se indica el porcentaje
 * y el resto queda para la promesa.
 *
 * Las reglas son las MISMAS del servidor (server/src/lib/visitas-cobros): el
 * botón se habilita con lo mismo que el servidor va a aceptar.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Briefcase,
	Camera,
	CheckCircle2,
	ChevronDown,
	Home,
	ImagePlus,
	Loader2,
	LocateFixed,
	RotateCw,
	X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	erroresProgramacionVisita,
	erroresRegistroVisita,
	MAX_EVIDENCIAS_VISITA,
	MIN_COMENTARIOS_VISITA,
	MOTIVOS_SIN_CONTACTO,
	montoPagoParcial,
	PORCENTAJE_PAGO_PARCIAL_MAX,
	PORCENTAJE_PAGO_PARCIAL_MIN,
	programarVisitaSchema,
	RESULTADO_VISITA_DESCRIPCION,
	RESULTADO_VISITA_LABEL,
	RESULTADOS_VISITA,
	type RegistrarVisitaInput,
	type ResultadoVisita,
	registrarVisitaSchema,
	siguientesPasos,
	TIPO_VISITA_LABEL,
	type TipoVisita,
} from "server/src/lib/visitas-cobros";
import { toast } from "sonner";
import { GpsUbicacionesClaveCard } from "@/components/cobros/gps-ubicaciones-clave-card";
import { AvisoFaltante } from "@/components/cobros/recuperacion-vehiculo-dialog";
import {
	ahoraRedondeado,
	FechaHoraPicker,
} from "@/components/fecha-hora-picker";
import { Button } from "@/components/ui/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
	Dialog,
	DialogContent,
	DialogDescription,
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
import { Textarea } from "@/components/ui/textarea";
import { authClient } from "@/lib/auth-client";
import {
	comprimirFoto,
	conLimite,
	LIMITE_PUT_MS,
} from "@/lib/subida-evidencia";
import { uploadFileToR2WithRetry } from "@/lib/upload-to-r2";
import { cn } from "@/lib/utils";
import { client, orpc } from "@/utils/orpc";

/** Las direcciones que ya tiene el CRM, para precargar el formulario. */
export type DireccionesCliente = {
	residencia: string | null;
	trabajo: {
		direccion: string | null;
		empresa: string | null;
		horario: string | null;
	} | null;
};

/** Una visita programada a la que se le registra el resultado. */
export type VisitaProgramadaParaCompletar = {
	id: string;
	tipo: TipoVisita;
	direccion: string;
	referencia: string | null;
	empresa: string | null;
	responsableId: string;
};

export type VisitaRegistrada = {
	visitaId: string;
	tipo: TipoVisita;
	resultado: ResultadoVisita;
	siguientes: {
		pago: boolean;
		promesa: boolean;
		convenio: boolean;
		entrega: boolean;
	};
	direccion: string;
	fechaVisita: Date;
	montoRecibido: number | null;
	bucket: number | null;
};

interface VisitaDialogProps {
	open: boolean;
	onOpenChange: (abierto: boolean) => void;
	casoCobroId: string;
	tipoInicial: TipoVisita;
	modoInicial?: "registrar" | "programar";
	/** Si viene, se registra el resultado de esa visita (no se programa otra). */
	programada?: VisitaProgramadaParaCompletar | null;
	direcciones: DireccionesCliente;
	/** Cuotas vencidas × cuota + mora: lo que paga un «Pago total». */
	deudaVencida: number;
	/** Por qué no se puede registrar un convenio (null = sí se puede). */
	convenioBloqueo?: string | null;
	/** En B4 se puede comparar con las ubicaciones clave del GPS (CB-119). */
	bucketNumero: number | null;
	vehicleId: string | null;
	onRegistrada?: (r: VisitaRegistrada) => void;
}

type Foto = {
	id: string;
	nombre: string;
	preview: string;
	estado: "subiendo" | "lista" | "error";
	key?: string;
	error?: string;
};

const quetzales = (n: number) =>
	`Q${n.toLocaleString("es-GT", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})}`;

/** Inicio del día de hoy, para deshabilitar días en el calendario. */
const inicioDeHoy = () => new Date(new Date().setHours(0, 0, 0, 0));

export function VisitaDialog(props: VisitaDialogProps) {
	// El formulario se remonta en cada apertura: arranca limpio sin tener que
	// resetear campo por campo.
	return (
		<Dialog open={props.open} onOpenChange={props.onOpenChange}>
			{props.open && <FormularioVisita {...props} />}
		</Dialog>
	);
}

function FormularioVisita({
	onOpenChange,
	casoCobroId,
	tipoInicial,
	modoInicial = "registrar",
	programada,
	direcciones,
	deudaVencida,
	convenioBloqueo = null,
	bucketNumero,
	vehicleId,
	onRegistrada,
}: VisitaDialogProps) {
	const queryClient = useQueryClient();
	const { data: session } = authClient.useSession();
	const completando = !!programada;

	const direccionDe = (t: TipoVisita) =>
		(t === "trabajo"
			? direcciones.trabajo?.direccion
			: direcciones.residencia) ?? "";

	const [modo, setModo] = useState<"registrar" | "programar">(
		completando ? "registrar" : modoInicial,
	);
	const [tipo, setTipo] = useState<TipoVisita>(programada?.tipo ?? tipoInicial);
	const [direccion, setDireccion] = useState(
		programada?.direccion ?? direccionDe(programada?.tipo ?? tipoInicial),
	);
	const [referencia, setReferencia] = useState(programada?.referencia ?? "");
	const [empresa, setEmpresa] = useState(
		programada?.empresa ?? direcciones.trabajo?.empresa ?? "",
	);
	const [responsableId, setResponsableId] = useState(
		programada?.responsableId ?? "",
	);
	const [fechaProgramada, setFechaProgramada] = useState<Date | undefined>();
	const [notas, setNotas] = useState("");
	const [fechaVisita, setFechaVisita] = useState<Date | undefined>(
		ahoraRedondeado,
	);
	const [resultado, setResultado] = useState<ResultadoVisita | null>(null);
	const [motivoSinContacto, setMotivoSinContacto] = useState("");
	const [porcentaje, setPorcentaje] = useState("");
	// Solo si no se pudo calcular lo vencido (el caso no trae cuotas o mora):
	// entonces sí se teclea el monto.
	const [montoManual, setMontoManual] = useState("");
	const [comentarios, setComentarios] = useState("");
	const [proximoPaso, setProximoPaso] = useState("");
	const [fotos, setFotos] = useState<Foto[]>([]);
	const [ubicacion, setUbicacion] = useState<{
		lat: number;
		lng: number;
		precisionM?: number;
	} | null>(null);
	const [ubicandose, setUbicandose] = useState(false);
	const [avisoUbicacion, setAvisoUbicacion] = useState<string | null>(null);
	const [intentoEnviar, setIntentoEnviar] = useState(false);
	const inputCamara = useRef<HTMLInputElement>(null);
	const inputGaleria = useRef<HTMLInputElement>(null);

	const responsables = useQuery(
		orpc.getResponsablesVisita.queryOptions({ input: { casoCobroId } }),
	);
	// Por defecto va quien registra (si puede ir) o el que lleva el crédito.
	useEffect(() => {
		if (responsableId || !responsables.data?.length) return;
		const yo = responsables.data.find((r) => r.id === session?.user?.id);
		setResponsableId((yo ?? responsables.data[0]).id);
	}, [responsables.data, responsableId, session?.user?.id]);

	// Las vistas previas son URLs del navegador: se liberan al cerrar.
	const fotosRef = useRef(fotos);
	fotosRef.current = fotos;
	useEffect(
		() => () => {
			for (const f of fotosRef.current) URL.revokeObjectURL(f.preview);
		},
		[],
	);

	const cambiarTipo = (t: TipoVisita) => {
		if (t === tipo) return;
		setTipo(t);
		setDireccion(direccionDe(t));
	};

	const cambiarResultado = (r: ResultadoVisita) => {
		setResultado(r);
		if (r !== "sin_contacto") setMotivoSinContacto("");
		if (r !== "pago_parcial_promesa") setPorcentaje("");
		if (!siguientesPasos(r).pago) setMontoManual("");
	};

	// El archivo original de cada foto, para poder reintentarla, y el intento
	// vigente: si una subida vieja (vencida o reintentada) contesta tarde, no
	// pisa a la nueva.
	const archivosRef = useRef(new Map<string, File>());
	const intentosRef = useRef(new Map<string, number>());

	const subirFoto = async (id: string) => {
		const original = archivosRef.current.get(id);
		if (!original) return;
		const intento = (intentosRef.current.get(id) ?? 0) + 1;
		intentosRef.current.set(id, intento);
		const vigente = () => intentosRef.current.get(id) === intento;
		setFotos((f) =>
			f.map((x) =>
				x.id === id ? { ...x, estado: "subiendo", error: undefined } : x,
			),
		);
		try {
			const { archivo, key } = await conLimite(async () => {
				const archivo = await comprimirFoto(original);
				const { key } = await uploadFileToR2WithRetry(
					archivo,
					{ resourceType: "cobros_visita_evidencia", resourceId: casoCobroId },
					{ timeoutMs: LIMITE_PUT_MS },
				);
				return { archivo, key };
			});
			if (!vigente()) return;
			setFotos((f) =>
				f.map((x) =>
					x.id === id
						? { ...x, estado: "lista", key, nombre: archivo.name }
						: x,
				),
			);
		} catch (e) {
			if (!vigente()) return;
			setFotos((f) =>
				f.map((x) =>
					x.id === id
						? {
								...x,
								estado: "error",
								error:
									e instanceof Error ? e.message : "No se pudo subir la foto",
							}
						: x,
				),
			);
		}
	};

	const agregarFotos = (lista: FileList | null) => {
		if (!lista || lista.length === 0) return;
		const libres = MAX_EVIDENCIAS_VISITA - fotos.length;
		const archivos = Array.from(lista).slice(0, Math.max(0, libres));
		if (lista.length > archivos.length) {
			toast.warning(`Hasta ${MAX_EVIDENCIAS_VISITA} fotos por visita.`);
		}
		const nuevas = archivos.map((original) => {
			const id = crypto.randomUUID();
			archivosRef.current.set(id, original);
			return {
				id,
				nombre: original.name || "foto.jpg",
				preview: URL.createObjectURL(original),
				estado: "subiendo" as const,
			};
		});
		setFotos((f) => [...f, ...nuevas]);
		// En paralelo: una foto que se traba no frena a las demás.
		for (const n of nuevas) void subirFoto(n.id);
	};

	const quitarFoto = (id: string) => {
		archivosRef.current.delete(id);
		intentosRef.current.delete(id);
		setFotos((f) => {
			const foto = f.find((x) => x.id === id);
			if (foto) URL.revokeObjectURL(foto.preview);
			return f.filter((x) => x.id !== id);
		});
	};

	const tomarUbicacion = () => {
		if (!("geolocation" in navigator)) {
			setAvisoUbicacion("Este navegador no permite obtener la ubicación.");
			return;
		}
		setUbicandose(true);
		setAvisoUbicacion(null);
		navigator.geolocation.getCurrentPosition(
			(pos) => {
				setUbicacion({
					lat: pos.coords.latitude,
					lng: pos.coords.longitude,
					precisionM: Math.round(pos.coords.accuracy),
				});
				setUbicandose(false);
			},
			(err) => {
				setAvisoUbicacion(
					err.code === err.PERMISSION_DENIED
						? "No se otorgó permiso de ubicación. La visita puede guardarse sin ella."
						: "No se pudo obtener la ubicación. La visita puede guardarse sin ella.",
				);
				setUbicandose(false);
			},
			{ enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
		);
	};

	// ── Lo que se manda, y lo que falta ────────────────────────────────────

	// El monto pagado sale de lo vencido: completo en «Pago total», el
	// porcentaje indicado en «Pago parcial + promesa».
	const hayDeuda = deudaVencida > 0;
	const porcentajeTexto = porcentaje.trim();
	const porcentajeNum = /^\d{1,2}$/.test(porcentajeTexto)
		? Number(porcentajeTexto)
		: null;
	const porcentajeValido =
		porcentajeNum !== null &&
		porcentajeNum >= PORCENTAJE_PAGO_PARCIAL_MIN &&
		porcentajeNum <= PORCENTAJE_PAGO_PARCIAL_MAX;
	const montoManualTexto = montoManual.trim().replace(/,/g, "");
	const montoManualNum = /^\d+(\.\d{1,2})?$/.test(montoManualTexto)
		? Number(montoManualTexto)
		: null;
	const montoPagado: number | undefined = (() => {
		if (resultado === "pago") {
			return hayDeuda ? deudaVencida : (montoManualNum ?? undefined);
		}
		if (resultado === "pago_parcial_promesa") {
			if (!hayDeuda) return montoManualNum ?? undefined;
			return porcentajeValido && porcentajeNum !== null
				? montoPagoParcial(deudaVencida, porcentajeNum)
				: undefined;
		}
		return undefined;
	})();
	const saldoParaPromesa =
		resultado === "pago_parcial_promesa" && hayDeuda && montoPagado !== undefined
			? Math.max(0, Math.round((deudaVencida - montoPagado) * 100) / 100)
			: null;

	const payloadRegistro: RegistrarVisitaInput = {
		casoCobroId,
		visitaId: programada?.id,
		tipo,
		direccion,
		referencia,
		empresa: tipo === "trabajo" ? empresa : undefined,
		responsableId,
		fechaVisita: fechaVisita ?? new Date(Number.NaN),
		resultado: (resultado ?? "sin_contacto") as ResultadoVisita,
		motivoSinContacto: (motivoSinContacto ||
			undefined) as RegistrarVisitaInput["motivoSinContacto"],
		montoRecibido: montoPagado && montoPagado > 0 ? montoPagado : undefined,
		porcentajePagado:
			resultado === "pago_parcial_promesa" && porcentajeValido
				? (porcentajeNum ?? undefined)
				: undefined,
		comentarios,
		proximoPaso,
		ubicacion: ubicacion ?? undefined,
		evidencias: fotos
			.filter((f) => f.estado === "lista" && f.key)
			.map((f) => ({ key: f.key as string, nombreArchivo: f.nombre })),
	};

	const payloadProgramacion = {
		casoCobroId,
		tipo,
		direccion,
		referencia,
		empresa: tipo === "trabajo" ? empresa : undefined,
		responsableId,
		fechaProgramada: fechaProgramada ?? new Date(Number.NaN),
		notas,
	};

	// El primer problema basta: el asesor lo resuelve y aparece el siguiente.
	const faltante = (() => {
		if (direccion.trim().length < 5) return "Falta la dirección de la visita.";
		if (!responsableId) return "Seleccione el responsable de la visita.";
		if (modo === "programar") {
			if (!fechaProgramada) return "Falta la fecha de la visita.";
			const p = programarVisitaSchema.safeParse(payloadProgramacion);
			if (!p.success)
				return p.error.issues[0]?.message ?? "Revise el formulario.";
			return erroresProgramacionVisita(p.data);
		}
		if (!resultado) return "Seleccione el resultado de la visita.";
		if (resultado === "convenio" && convenioBloqueo) return convenioBloqueo;
		if (resultado === "pago_parcial_promesa" && !porcentajeValido) {
			return `Indique el porcentaje pagado (de ${PORCENTAJE_PAGO_PARCIAL_MIN} a ${PORCENTAJE_PAGO_PARCIAL_MAX}).`;
		}
		if (siguientesPasos(resultado).pago && !hayDeuda && montoManualNum === null)
			return "Indique el monto pagado en números, por ejemplo 1250.50";
		if (comentarios.trim().length < MIN_COMENTARIOS_VISITA)
			return `Los comentarios son obligatorios (al menos ${MIN_COMENTARIOS_VISITA} caracteres).`;
		if (fotos.some((f) => f.estado === "subiendo"))
			return "Espere a que terminen de subir las fotos.";
		if (fotos.some((f) => f.estado === "error"))
			return "Una foto no se pudo subir: reinténtela o quítela.";
		const p = registrarVisitaSchema.safeParse(payloadRegistro);
		if (!p.success)
			return p.error.issues[0]?.message ?? "Revise el formulario.";
		return erroresRegistroVisita(p.data);
	})();

	const programar = useMutation({
		mutationFn: () =>
			client.programarVisitaCobro(
				programarVisitaSchema.parse(payloadProgramacion),
			),
		onSuccess: () => {
			const quien = responsables.data?.find((r) => r.id === responsableId);
			toast.success(
				quien && quien.id !== session?.user?.id
					? `Visita programada. Se notificó a ${quien.nombre}.`
					: "Visita programada. El día de la visita recibirá un aviso.",
			);
			queryClient.invalidateQueries({ queryKey: orpc.getVisitasCaso.key() });
			onOpenChange(false);
		},
		onError: (e: Error) =>
			toast.error(e.message || "No se pudo programar la visita"),
	});

	const registrar = useMutation({
		mutationFn: () =>
			client.registrarVisitaCobro(registrarVisitaSchema.parse(payloadRegistro)),
		onSuccess: (r) => {
			queryClient.invalidateQueries({ queryKey: orpc.getVisitasCaso.key() });
			queryClient.invalidateQueries({
				queryKey: orpc.getHistorialContactosPaginado.key(),
			});
			queryClient.invalidateQueries({
				queryKey: orpc.getDetallesCreditoCarteraBack.key(),
			});
			const res = resultado as ResultadoVisita;
			toast.success(
				r.siguientes.entrega
					? "Visita registrada. Continúe con la entrega voluntaria."
					: r.siguientes.convenio
						? "Visita registrada. Continúe con el convenio de pago."
						: r.siguientes.promesa
							? "Visita registrada. Continúe con la promesa de pago."
							: r.siguientes.pago
								? "Visita registrada. El pago se registra en «Registrar Pago»."
								: "Visita registrada.",
			);
			onOpenChange(false);
			onRegistrada?.({
				visitaId: r.visitaId,
				tipo,
				resultado: res,
				siguientes: r.siguientes,
				direccion: direccion.trim(),
				fechaVisita: fechaVisita ?? new Date(),
				montoRecibido: payloadRegistro.montoRecibido ?? null,
				bucket: r.bucket,
			});
		},
		onError: (e: Error) =>
			toast.error(e.message || "No se pudo guardar la visita"),
	});

	const enviando = programar.isPending || registrar.isPending;
	// Mientras suba una foto no se guarda: el botón queda apagado y el motivo
	// a la vista (no solo después de intentar).
	const subiendoFotos =
		modo === "registrar" && fotos.some((f) => f.estado === "subiendo");
	const enviar = () => {
		setIntentoEnviar(true);
		if (faltante || enviando) return;
		if (modo === "programar") programar.mutate();
		else registrar.mutate();
	};

	// Respaldo: si el caso no trae cuotas o mora no hay de dónde calcular el
	// monto, y se teclea.
	const campoMontoManual = (
		<div className="space-y-1.5">
			<Label htmlFor="visita-monto">
				Monto pagado <span className="text-red-600">*</span>
			</Label>
			<Input
				id="visita-monto"
				inputMode="decimal"
				className="h-10"
				value={montoManual}
				onChange={(e) => setMontoManual(e.target.value)}
				placeholder="0.00"
			/>
			<p className="text-muted-foreground text-xs">
				No se pudo calcular lo vencido de este caso. Ingrese el monto que pagó
				el cliente.
			</p>
		</div>
	);

	const pasos = resultado ? siguientesPasos(resultado) : null;
	const textoBoton =
		modo === "programar"
			? "Programar visita"
			: pasos?.entrega
				? "Guardar y continuar con la entrega"
				: pasos?.convenio
					? "Guardar y registrar el convenio"
					: pasos?.promesa
						? "Guardar y registrar la promesa"
						: "Guardar visita";
	const direccionSolicitud = direccionDe(tipo);
	const puedeCompararGps = bucketNumero === 4 && !!vehicleId;

	return (
		<DialogContent className="flex h-[100dvh] max-h-[100dvh] w-full max-w-full flex-col gap-0 rounded-none p-0 sm:h-auto sm:max-h-[90vh] sm:max-w-2xl sm:rounded-lg">
			<DialogHeader className="border-b px-4 pt-4 pb-3 text-left sm:px-6">
				<DialogTitle className="pr-8">
					{completando
						? `Resultado de la ${TIPO_VISITA_LABEL[tipo].toLowerCase()}`
						: modo === "programar"
							? "Programar visita"
							: "Registrar visita"}
				</DialogTitle>
				<DialogDescription>
					{modo === "programar"
						? "La visita queda agendada con su responsable, quien recibirá un aviso ese día."
						: "Registre el resultado de la visita, la evidencia y el siguiente paso."}
				</DialogDescription>
			</DialogHeader>

			<div className="flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-6">
				{/* Visita realizada / por programar */}
				{!completando && (
					<div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
						{(
							[
								["registrar", "Visita realizada"],
								["programar", "Programar visita"],
							] as const
						).map(([valor, texto]) => (
							<button
								key={valor}
								type="button"
								onClick={() => setModo(valor)}
								className={cn(
									"h-10 rounded-md font-medium text-sm transition-colors",
									modo === valor
										? "bg-background shadow-sm"
										: "text-muted-foreground",
								)}
							>
								{texto}
							</button>
						))}
					</div>
				)}

				{/* 1 · Adónde */}
				<section className="space-y-3">
					{!completando && (
						<div className="grid grid-cols-2 gap-2">
							{(
								[
									["residencia", "Residencia", Home],
									["trabajo", "Lugar de trabajo", Briefcase],
								] as const
							).map(([valor, texto, Icono]) => (
								<button
									key={valor}
									type="button"
									onClick={() => cambiarTipo(valor)}
									className={cn(
										"flex h-11 items-center justify-center gap-2 rounded-md border font-medium text-sm transition-colors",
										tipo === valor
											? "border-primary bg-primary/5 text-primary"
											: "hover:bg-muted/50",
									)}
								>
									<Icono className="h-4 w-4" />
									{texto}
								</button>
							))}
						</div>
					)}

					{tipo === "trabajo" && (
						<div className="space-y-1.5">
							<Label htmlFor="visita-empresa">Empresa</Label>
							<Input
								id="visita-empresa"
								value={empresa}
								onChange={(e) => setEmpresa(e.target.value)}
								placeholder="Nombre de la empresa"
							/>
						</div>
					)}
					<div className="space-y-1.5">
						<Label htmlFor="visita-direccion">
							Dirección <span className="text-red-600">*</span>
						</Label>
						<Textarea
							id="visita-direccion"
							value={direccion}
							onChange={(e) => setDireccion(e.target.value)}
							rows={2}
							placeholder={
								tipo === "trabajo"
									? "Dirección del lugar de trabajo"
									: "Dirección de residencia"
							}
						/>
						{!direccionSolicitud ? (
							<p className="text-muted-foreground text-xs">
								{tipo === "trabajo"
									? "La solicitud de crédito no tiene dirección de trabajo. Ingrésela manualmente."
									: "El CRM no tiene la dirección de residencia. Ingrésela manualmente."}
							</p>
						) : (
							direccion.trim() !== direccionSolicitud.trim() && (
								<button
									type="button"
									className="text-primary text-xs hover:underline"
									onClick={() => setDireccion(direccionSolicitud)}
								>
									Volver a la dirección de la solicitud
								</button>
							)
						)}
						{tipo === "trabajo" && direcciones.trabajo?.horario && (
							<p className="text-muted-foreground text-xs">
								Horario declarado: {direcciones.trabajo.horario}
							</p>
						)}
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="visita-referencia">
							Puntos de referencia{" "}
							<span className="text-muted-foreground">(opcional)</span>
						</Label>
						<Input
							id="visita-referencia"
							value={referencia}
							onChange={(e) => setReferencia(e.target.value)}
							placeholder="Ej.: casa verde, portón negro, frente a la tienda"
						/>
					</div>
					{puedeCompararGps && vehicleId && (
						<Collapsible>
							<CollapsibleTrigger className="flex items-center gap-1 text-primary text-sm hover:underline">
								<ChevronDown className="h-4 w-4" />
								Comparar con las ubicaciones del GPS
							</CollapsibleTrigger>
							<CollapsibleContent className="pt-2">
								<GpsUbicacionesClaveCard
									casoCobroId={casoCobroId}
									vehicleId={vehicleId}
								/>
							</CollapsibleContent>
						</Collapsible>
					)}
				</section>

				{/* 2 · Quién y cuándo */}
				<section className="grid gap-3 sm:grid-cols-2">
					<div className="space-y-1.5">
						<Label>
							Responsable de la visita <span className="text-red-600">*</span>
						</Label>
						<Select
							value={responsableId}
							onValueChange={setResponsableId}
							disabled={responsables.isLoading}
						>
							<SelectTrigger className="h-10 w-full">
								<SelectValue
									placeholder={
										responsables.isLoading ? "Cargando…" : "Seleccionar responsable"
									}
								/>
							</SelectTrigger>
							<SelectContent>
								{(responsables.data ?? []).map((r) => (
									<SelectItem key={r.id} value={r.id}>
										{r.nombre}
										{r.motivo && (
											<span className="text-muted-foreground text-xs">
												{" "}
												· {r.motivo}
											</span>
										)}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						{responsables.isError && (
							<p className="text-destructive text-xs">
								{responsables.error?.message ??
									"No se pudo cargar la lista de responsables."}
							</p>
						)}
					</div>
					{modo === "programar" ? (
						<div className="space-y-1.5">
							<Label htmlFor="visita-fecha-programada">
								Fecha y hora <span className="text-red-600">*</span>
							</Label>
							<FechaHoraPicker
								id="visita-fecha-programada"
								value={fechaProgramada}
								onChange={setFechaProgramada}
								deshabilitar={(dia) => dia < inicioDeHoy()}
							/>
						</div>
					) : (
						<div className="space-y-1.5">
							<Label htmlFor="visita-fecha">
								Fecha y hora de la visita <span className="text-red-600">*</span>
							</Label>
							<FechaHoraPicker
								id="visita-fecha"
								value={fechaVisita}
								onChange={setFechaVisita}
								deshabilitar={(dia) => dia > new Date()}
							/>
						</div>
					)}
				</section>

				{modo === "programar" ? (
					<section className="space-y-1.5">
						<Label htmlFor="visita-notas">
							Indicaciones para la visita{" "}
							<span className="text-muted-foreground">(opcional)</span>
						</Label>
						<Textarea
							id="visita-notas"
							value={notas}
							onChange={(e) => setNotas(e.target.value)}
							rows={2}
							placeholder="Ej.: consultar por la entrega del vehículo; el cliente llega a las 6 p. m."
						/>
					</section>
				) : (
					<>
						{/* 3 · Resultado */}
						<section className="space-y-2">
							<Label>
								Resultado de la visita <span className="text-red-600">*</span>
							</Label>
							<div className="grid gap-2 sm:grid-cols-2">
								{RESULTADOS_VISITA.map((r) => {
									const bloqueo = r === "convenio" ? convenioBloqueo : null;
									return (
										<button
											key={r}
											type="button"
											disabled={!!bloqueo}
											onClick={() => cambiarResultado(r)}
											className={cn(
												"rounded-md border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
												resultado === r
													? "border-primary bg-primary/5"
													: "hover:bg-muted/50",
											)}
										>
											<p className="font-medium text-sm">
												{RESULTADO_VISITA_LABEL[r]}
											</p>
											<p className="text-muted-foreground text-xs">
												{bloqueo ?? RESULTADO_VISITA_DESCRIPCION[r]}
											</p>
										</button>
									);
								})}
							</div>

							{resultado === "sin_contacto" && (
								<div className="space-y-1.5 pt-1">
									<Label>
										Motivo <span className="text-red-600">*</span>
									</Label>
									<Select
										value={motivoSinContacto}
										onValueChange={setMotivoSinContacto}
									>
										<SelectTrigger className="h-10 w-full">
											<SelectValue placeholder="Seleccionar motivo" />
										</SelectTrigger>
										<SelectContent>
											{Object.entries(MOTIVOS_SIN_CONTACTO).map(
												([clave, label]) => (
													<SelectItem key={clave} value={clave}>
														{label}
													</SelectItem>
												),
											)}
										</SelectContent>
									</Select>
								</div>
							)}

							{resultado === "pago" && (
								<div className="space-y-2 rounded-md border bg-muted/30 p-3">
									{hayDeuda ? (
										<>
											<div className="flex items-center justify-between gap-2 text-sm">
												<span className="font-medium">Monto pagado</span>
												<span className="font-semibold tabular-nums">
													{quetzales(deudaVencida)}
												</span>
											</div>
											<p className="text-muted-foreground text-xs">
												Total de lo vencido: cuotas vencidas más mora.
											</p>
										</>
									) : (
										campoMontoManual
									)}
									<p className="text-muted-foreground text-xs">
										El monto queda anotado en la visita; el pago se registra
										en «Registrar Pago» (link o boleta).
									</p>
								</div>
							)}

							{resultado === "pago_parcial_promesa" && (
								<div className="space-y-3 rounded-md border bg-muted/30 p-3">
									<div className="space-y-1.5">
										<Label htmlFor="visita-porcentaje">
											Porcentaje pagado <span className="text-red-600">*</span>
										</Label>
										<div className="flex flex-wrap items-center gap-2">
											<div className="relative w-24">
												<Input
													id="visita-porcentaje"
													inputMode="numeric"
													className="h-10 pr-7"
													value={porcentaje}
													onChange={(e) =>
														setPorcentaje(
															e.target.value.replace(/\D/g, "").slice(0, 2),
														)
													}
													placeholder="50"
												/>
												<span className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-3 text-muted-foreground text-sm">
													%
												</span>
											</div>
											{[25, 50, 75].map((n) => (
												<Button
													key={n}
													type="button"
													size="sm"
													variant={porcentajeNum === n ? "default" : "outline"}
													className="h-10 px-3"
													onClick={() => setPorcentaje(String(n))}
												>
													{n}%
												</Button>
											))}
										</div>
									</div>
									{hayDeuda ? (
										<dl className="space-y-1 text-sm">
											<div className="flex justify-between gap-2">
												<dt className="text-muted-foreground">
													Total vencido (cuotas + mora)
												</dt>
												<dd className="tabular-nums">
													{quetzales(deudaVencida)}
												</dd>
											</div>
											<div className="flex justify-between gap-2">
												<dt className="font-medium">Monto pagado</dt>
												<dd className="font-semibold tabular-nums">
													{montoPagado !== undefined
														? quetzales(montoPagado)
														: "—"}
												</dd>
											</div>
											<div className="flex justify-between gap-2">
												<dt className="font-medium">Saldo para la promesa</dt>
												<dd className="font-semibold tabular-nums">
													{saldoParaPromesa !== null
														? quetzales(saldoParaPromesa)
														: "—"}
												</dd>
											</div>
										</dl>
									) : (
										campoMontoManual
									)}
									<p className="text-muted-foreground text-xs">
										Al guardar se abre la promesa de pago por el saldo
										pendiente. El pago se registra en «Registrar Pago» (link o
										boleta).
									</p>
								</div>
							)}
						</section>

						{/* 4 · Evidencia */}
						<section className="space-y-2">
							<Label>
								Evidencia fotográfica{" "}
								<span className="text-muted-foreground">
									(opcional, hasta {MAX_EVIDENCIAS_VISITA} fotos)
								</span>
							</Label>
							<p className="text-muted-foreground text-xs">
								Fachada, número de casa o lugar visitado. No se deben tomar
								fotos del cliente ni de otras personas.
							</p>
							<div className="grid grid-cols-2 gap-2">
								<Button
									type="button"
									variant="outline"
									className="h-11"
									disabled={fotos.length >= MAX_EVIDENCIAS_VISITA}
									onClick={() => inputCamara.current?.click()}
								>
									<Camera className="mr-2 h-4 w-4" />
									Tomar foto
								</Button>
								<Button
									type="button"
									variant="outline"
									className="h-11"
									disabled={fotos.length >= MAX_EVIDENCIAS_VISITA}
									onClick={() => inputGaleria.current?.click()}
								>
									<ImagePlus className="mr-2 h-4 w-4" />
									Elegir de la galería
								</Button>
							</div>
							{/* `capture` abre la cámara trasera directo en el celular; en la
							    compu cae al selector de archivos. */}
							<input
								ref={inputCamara}
								type="file"
								accept="image/*"
								capture="environment"
								className="hidden"
								onChange={(e) => {
									agregarFotos(e.target.files);
									e.target.value = "";
								}}
							/>
							<input
								ref={inputGaleria}
								type="file"
								accept="image/jpeg,image/png,image/webp"
								multiple
								className="hidden"
								onChange={(e) => {
									agregarFotos(e.target.files);
									e.target.value = "";
								}}
							/>
							{fotos.length > 0 && (
								<div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
									{fotos.map((f) => (
										<div
											key={f.id}
											className="relative aspect-square overflow-hidden rounded-md border bg-muted"
										>
											<img
												src={f.preview}
												alt={f.nombre}
												className={cn(
													"h-full w-full object-cover",
													f.estado !== "lista" && "opacity-50",
												)}
											/>
											{f.estado === "subiendo" && (
												<Loader2 className="absolute inset-0 m-auto h-5 w-5 animate-spin" />
											)}
											{f.estado === "error" && (
												<button
													type="button"
													title={f.error}
													className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-destructive/90 px-1 py-1 text-[11px] text-white"
													onClick={() => void subirFoto(f.id)}
												>
													<RotateCw className="h-3 w-3" />
													Error · Reintentar
												</button>
											)}
											<button
												type="button"
												aria-label={`Quitar ${f.nombre}`}
												className="absolute top-1 right-1 rounded-full bg-background/90 p-1 shadow"
												onClick={() => quitarFoto(f.id)}
											>
												<X className="h-3.5 w-3.5" />
											</button>
										</div>
									))}
								</div>
							)}
						</section>

						{/* 5 · Ubicación: un botón de verdad, no un enlace suelto (el PM no
						    lo veía). Toma el punto donde está el teléfono AHORA: si el
						    asesor ya se fue del lugar, mejor no registrarla. */}
						<section className="space-y-2">
							<Label>
								Ubicación de la visita{" "}
								<span className="text-muted-foreground">(opcional)</span>
							</Label>
							<p className="text-muted-foreground text-xs">
								Registra la ubicación actual del teléfono. Úselo solo si se
								encuentra en el lugar de la visita.
							</p>
							{ubicacion ? (
								<div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-900 text-sm dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
									<span className="flex items-center gap-2 font-medium">
										<CheckCircle2 className="h-4 w-4" />
										Ubicación registrada
										{ubicacion.precisionM != null
											? ` (±${ubicacion.precisionM} m)`
											: ""}
									</span>
									<div className="flex gap-2">
										<Button
											type="button"
											variant="outline"
											size="sm"
											className="h-9 bg-background"
											disabled={ubicandose}
											onClick={tomarUbicacion}
										>
											{ubicandose ? (
												<Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
											) : (
												<LocateFixed className="mr-1.5 h-4 w-4" />
											)}
											Actualizar
										</Button>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											className="h-9"
											onClick={() => setUbicacion(null)}
										>
											Quitar
										</Button>
									</div>
								</div>
							) : (
								<Button
									type="button"
									variant="outline"
									className="h-11 w-full border-primary/50 text-primary hover:bg-primary/5 hover:text-primary"
									disabled={ubicandose}
									onClick={tomarUbicacion}
								>
									{ubicandose ? (
										<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									) : (
										<LocateFixed className="mr-2 h-4 w-4" />
									)}
									{ubicandose
										? "Obteniendo ubicación…"
										: "Registrar mi ubicación actual"}
								</Button>
							)}
							{avisoUbicacion && (
								<p className="text-muted-foreground text-xs">{avisoUbicacion}</p>
							)}
						</section>

						{/* 6 · Comentarios y próximo paso */}
						<section className="space-y-3">
							<div className="space-y-1.5">
								<Label htmlFor="visita-comentarios">
									Comentarios <span className="text-red-600">*</span>
								</Label>
								<Textarea
									id="visita-comentarios"
									value={comentarios}
									onChange={(e) => setComentarios(e.target.value)}
									rows={3}
									placeholder="Persona con quien se habló, lo que indicó y lo acordado"
								/>
								{comentarios.trim().length < MIN_COMENTARIOS_VISITA && (
									<p className="text-muted-foreground text-xs">
										Mínimo {MIN_COMENTARIOS_VISITA} caracteres.
									</p>
								)}
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="visita-proximo-paso">
									Próximo paso{" "}
									<span className="text-muted-foreground">(opcional)</span>
								</Label>
								<Input
									id="visita-proximo-paso"
									value={proximoPaso}
									onChange={(e) => setProximoPaso(e.target.value)}
									placeholder="Ej.: regresar el viernes por la tarde"
								/>
							</div>
						</section>
					</>
				)}
			</div>

			{/* El botón siempre a la vista, también en el celular con el teclado. */}
			<div className="flex flex-col gap-2 border-t bg-background px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
				<AvisoFaltante
					faltante={faltante}
					visible={intentoEnviar || subiendoFotos}
				/>
				<div className="flex gap-2">
					<Button
						type="button"
						variant="outline"
						className="h-11 flex-1 sm:h-9 sm:flex-none"
						onClick={() => onOpenChange(false)}
						disabled={enviando}
					>
						Cancelar
					</Button>
					<Button
						type="button"
						className="h-11 flex-1 sm:h-9 sm:flex-none"
						onClick={enviar}
						disabled={enviando || subiendoFotos}
					>
						{(enviando || subiendoFotos) && (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						)}
						{textoBoton}
					</Button>
				</div>
			</div>
		</DialogContent>
	);
}

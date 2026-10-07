/**
 * CB-042 · Formulario de los dos envíos a recuperación de vehículo:
 *
 *  · Recuperación forzosa: el asesor decide quitar la unidad. Motivos, dónde
 *    está y en qué estado — lo que el asesor de B4 necesita para ir a buscarla.
 *  · Entrega voluntaria: el cliente la entrega. Además fecha, lugar y quién
 *    la entrega.
 *
 * De B2 a B3 el envío traslada el crédito a B4 (`enviarCreditoARecuperacion`).
 * La entrega voluntaria también se registra con el crédito ya en B4: ahí solo
 * se guarda el formulario (`registrarEntregaVoluntariaEnB4`).
 *
 * CB-043: la forzosa es una SOLICITUD, la pida quien la pida. Lleva la
 * justificación y el checklist de lo que ya se hizo, y la aprueba OTRO
 * supervisor o admin antes de que el crédito se mueva.
 *
 * Las reglas del formulario son las MISMAS del servidor (se importan de
 * server/src/lib/recuperacion-vehiculo): el botón se habilita con lo mismo que
 * el servidor va a aceptar.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MapPin, Navigation, Send, TriangleAlert } from "lucide-react";
import { useState } from "react";
import {
	faltanteDePaso,
	type RespuestaPasoInput,
} from "server/src/lib/recuperacion-solicitud";
import {
	type DetalleRecuperacionInput,
	detalleRecuperacionSchema,
	ESTADOS_VEHICULO,
	erroresDetalleRecuperacion,
	MIN_JUSTIFICACION_FORZOSA,
	motivosDelTipo,
	type OperacionRecuperacion,
	TIPO_RECUPERACION_LABEL,
	type TipoEnvioRecuperacion,
} from "server/src/lib/recuperacion-vehiculo";
import { toast } from "sonner";
import {
	ChecklistFormulario,
	type RespuestasChecklist,
	respuestasIniciales,
} from "@/components/cobros/recuperacion-checklist";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
	formatUltimaSenal,
	googleMapsUrl,
	resolveEstadoSenal,
} from "@/routes/cobros/-gps-ficha";
import { client, orpc } from "@/utils/orpc";

/** El motivo de la consulta de GPS queda en la bitácora de CB-118. */
const MOTIVO_CONSULTA_GPS = "Registro de recuperación de vehículo (CB-042)";

type UbicacionGps = {
	lat: number;
	lng: number;
	unidad: string | null;
	senalAt: Date | null;
};

/**
 * Lo que pasó al enviar, para el resumen de «Gestión registrada» del
 * Workspace:
 *  · `solicitud`: la forzosa quedó esperando la aprobación de otro supervisor.
 *  · `trasladado`: el crédito pasó a B4 (`bucketNuevo`).
 *  · `registrado`: entrega voluntaria registrada con el crédito ya en B4.
 */
export type ResultadoRecuperacion = {
	tipo: TipoEnvioRecuperacion;
	operacion: OperacionRecuperacion;
	modo: "solicitud" | "trasladado" | "registrado";
	recuperacionId: string | null;
	bucketNuevo: number | null;
	/** El mismo texto del aviso (toast) que se mostró. */
	mensaje: string;
};

interface RecuperacionVehiculoDialogProps {
	/** Obligatorio sin `embebido`; con `embebido` se ignora (siempre abierto). */
	open?: boolean;
	/** Obligatorio sin `embebido`; con `embebido` no se llama. */
	onOpenChange?: (abierto: boolean) => void;
	tipo: TipoEnvioRecuperacion;
	operacion: OperacionRecuperacion;
	casoCobroId: string;
	/** Sin vehículo no se puede consultar el GPS; el resto del formulario sigue. */
	vehicleId: string | null;
	/**
	 * CB-037/038: la entrega sale de una visita. Llega con el lugar y la fecha
	 * de la visita ya puestos (editables), y el registro queda vinculado a ella.
	 */
	desdeVisita?: { visitaId: string; lugar: string; fecha: Date };
	/** Se llama tras enviar con éxito (después de cerrar, sin `embebido`). */
	onExito?: (r: ResultadoRecuperacion) => void;
	/** Workspace: se pinta dentro del panel de gestión, sin Dialog. */
	embebido?: boolean;
	/** Solo con `embebido`: el botón secundario del pie («Cancelar»). */
	onCancelar?: () => void;
}

/** `datetime-local` quiere "YYYY-MM-DDTHH:mm" en hora local. */
function aDatetimeLocal(fecha: Date): string {
	const p = (n: number) => String(n).padStart(2, "0");
	return `${fecha.getFullYear()}-${p(fecha.getMonth() + 1)}-${p(fecha.getDate())}T${p(fecha.getHours())}:${p(fecha.getMinutes())}`;
}

/**
 * Qué le falta al formulario, junto al botón. Antes de intentar enviar va
 * discreto; después del primer intento, en ámbar para que no se pierda.
 */
export function AvisoFaltante({
	faltante,
	visible,
}: {
	faltante: string | null;
	visible: boolean;
}) {
	if (!faltante) return <span />;
	return (
		<p
			className={
				visible
					? "flex items-center gap-1.5 font-medium text-amber-700 text-sm dark:text-amber-400"
					: "text-muted-foreground text-xs"
			}
		>
			{visible && <TriangleAlert className="h-4 w-4 shrink-0" />}
			{faltante}
		</p>
	);
}

export function RecuperacionVehiculoDialog(
	props: RecuperacionVehiculoDialogProps,
) {
	// Embebido (Workspace) no hay Dialog: el formulario se monta directo y el
	// Workspace lo remonta con `key` al cambiar de caso.
	if (props.embebido) return <FormularioRecuperacion {...props} />;
	// El formulario se remonta en cada apertura: arranca limpio sin tener que
	// resetear campo por campo (y no arrastra lo de un tipo al otro).
	return (
		<Dialog open={props.open} onOpenChange={props.onOpenChange}>
			{props.open && <FormularioRecuperacion {...props} />}
		</Dialog>
	);
}

function FormularioRecuperacion({
	onOpenChange,
	tipo,
	operacion,
	casoCobroId,
	vehicleId,
	desdeVisita,
	onExito,
	embebido = false,
	onCancelar,
}: RecuperacionVehiculoDialogProps) {
	const queryClient = useQueryClient();
	const voluntaria = tipo === "entrega_voluntaria";
	const catalogoMotivos = motivosDelTipo(tipo);
	/** La forzosa se solicita, no se traslada (CB-043). */
	const esSolicitud = !voluntaria;

	// CB-043: el checklist de la solicitud, con la evidencia que el CRM tiene hoy.
	const checklist = useQuery({
		...orpc.getChecklistRecuperacion.queryOptions({ input: { casoCobroId } }),
		enabled: !voluntaria,
		// Mientras se llena no se refresca: cambiaría pasos bajo los dedos.
		staleTime: Number.POSITIVE_INFINITY,
		refetchOnWindowFocus: false,
	});
	const pasos = checklist.data?.pasos ?? [];
	const [respuestas, setRespuestas] = useState<RespuestasChecklist | null>(
		null,
	);
	const respuestasActuales =
		respuestas ?? (checklist.data ? respuestasIniciales(pasos) : {});
	const cambiarPaso = (paso: string, cambio: Partial<RespuestaPasoInput>) =>
		setRespuestas({
			...respuestasActuales,
			[paso]: {
				...respuestasActuales[paso],
				paso: paso as RespuestaPasoInput["paso"],
				...cambio,
			},
		});
	const faltantesChecklist: Record<string, string | null> = Object.fromEntries(
		pasos.map((p) => [
			p.paso,
			faltanteDePaso(p, respuestasActuales[p.paso], p.opciones),
		]),
	);

	const [motivos, setMotivos] = useState<string[]>([]);
	const [motivoDetalle, setMotivoDetalle] = useState("");
	const [direccion, setDireccion] = useState("");
	const [enlace, setEnlace] = useState("");
	const [gps, setGps] = useState<UbicacionGps | null>(null);
	const [avisoGps, setAvisoGps] = useState<string | null>(null);
	const [estado, setEstado] = useState<string>("");
	const [estadoDetalle, setEstadoDetalle] = useState("");
	const [kilometraje, setKilometraje] = useState("");
	const [fechaEntrega, setFechaEntrega] = useState(
		desdeVisita ? aDatetimeLocal(desdeVisita.fecha) : "",
	);
	const [lugarEntrega, setLugarEntrega] = useState(desdeVisita?.lugar ?? "");
	const [persona, setPersona] = useState("");
	const [relacion, setRelacion] = useState("");
	const [observaciones, setObservaciones] = useState("");
	const [intentoEnviar, setIntentoEnviar] = useState(false);

	const alternar = (lista: string[], valor: string) =>
		lista.includes(valor)
			? lista.filter((v) => v !== valor)
			: [...lista, valor];

	const detalle: DetalleRecuperacionInput = {
		motivos,
		motivoDetalle,
		ubicacion:
			direccion.trim() || enlace.trim() || gps
				? {
						direccion,
						enlace,
						lat: gps?.lat,
						lng: gps?.lng,
						fuente: gps ? "gps" : "manual",
						gpsUnidad: gps?.unidad ?? undefined,
						gpsSenalAt: gps?.senalAt ?? null,
					}
				: undefined,
		estadoVehiculo: (estado ||
			undefined) as DetalleRecuperacionInput["estadoVehiculo"],
		estadoVehiculoDetalle: estadoDetalle,
		kilometraje: kilometraje.trim() ? Number(kilometraje) : undefined,
		entrega: voluntaria
			? {
					fecha: fechaEntrega ? new Date(fechaEntrega) : new Date(Number.NaN),
					lugar: lugarEntrega,
					persona,
					relacion,
				}
			: undefined,
		observaciones,
	};

	// Lo que falta, con las reglas del servidor. El primer problema basta: el
	// asesor lo resuelve y aparece el siguiente.
	const faltante = (() => {
		if (motivos.length === 0) return "Seleccione al menos un motivo.";
		if (motivos.includes("otro") && !motivoDetalle.trim())
			return "Seleccionó «Otro»: indique el motivo en el detalle.";
		if (!voluntaria) {
			if (motivoDetalle.trim().length < MIN_JUSTIFICACION_FORZOSA)
				return `Escriba la justificación para el supervisor (mínimo ${MIN_JUSTIFICACION_FORZOSA} caracteres).`;
			if (checklist.isPending) return "Cargando el checklist…";
			if (checklist.isError)
				return "No se pudo cargar el checklist. Cierre el formulario e intente de nuevo.";
			const pasoFaltante = Object.values(faltantesChecklist).find(Boolean);
			if (pasoFaltante) return pasoFaltante;
		}
		if (voluntaria && !fechaEntrega) return "Falta la fecha de la entrega.";
		if (voluntaria && lugarEntrega.trim().length < 3)
			return "Falta el lugar de la entrega.";
		if (kilometraje.trim() && !/^\d+$/.test(kilometraje.trim()))
			return "Ingrese el kilometraje en números enteros.";
		const parsed = detalleRecuperacionSchema.safeParse(detalle);
		if (!parsed.success)
			return parsed.error.issues[0]?.message ?? "Revise el formulario.";
		return erroresDetalleRecuperacion(tipo, parsed.data);
	})();

	const tomarGps = useMutation({
		mutationFn: () => {
			if (!vehicleId) throw new Error("El caso no tiene vehículo asociado.");
			return client.getGpsVehiculo({
				casoCobroId,
				vehicleId,
				motivo: MOTIVO_CONSULTA_GPS,
			});
		},
		onSuccess: (r) => {
			if (r.estado !== "vinculado") {
				setAvisoGps(
					r.estado === "sin_vinculo"
						? "Este vehículo no tiene GPS vinculado. Ingrese la ubicación manualmente."
						: `No se pudo consultar el GPS${r.error?.message ? `: ${r.error.message}` : "."}`,
				);
				return;
			}
			const t = r.telemetria;
			if (t.latitude == null || t.longitude == null) {
				setAvisoGps(
					"El GPS respondió sin posición. Ingrese la ubicación manualmente.",
				);
				return;
			}
			const senalAt = t.ultimaPosicionAt ?? t.ultimaSenalAt ?? null;
			setGps({
				lat: t.latitude,
				lng: t.longitude,
				unidad: r.unitName ?? null,
				senalAt,
			});
			if (!enlace.trim())
				setEnlace(googleMapsUrl(t.latitude, t.longitude) ?? "");
			if (!kilometraje.trim() && t.mileageKm != null) {
				setKilometraje(String(Math.round(t.mileageKm)));
			}
			// Una posición vieja no dice dónde está el carro: dice que el GPS dejó
			// de reportar, y eso también es información para B4.
			setAvisoGps(
				resolveEstadoSenal(senalAt) === "vieja"
					? `Atención: la última posición es de ${formatUltimaSenal(senalAt).toLowerCase()}. El GPS no está reportando.`
					: null,
			);
		},
		onError: (e: Error) =>
			setAvisoGps(e.message || "No se pudo consultar el GPS."),
	});

	const enviar = useMutation({
		mutationFn: async () => {
			const parsed = detalleRecuperacionSchema.parse(detalle);
			if (operacion === "solo_registrar") {
				await client.registrarEntregaVoluntariaEnB4({
					casoCobroId,
					detalle: parsed,
					visitaId: desdeVisita?.visitaId,
				});
				return null;
			}
			return client.enviarCreditoARecuperacion({
				casoCobroId,
				tipo,
				detalle: parsed,
				visitaId: desdeVisita?.visitaId,
				checklist: voluntaria
					? undefined
					: pasos.map((p) => {
							const r = respuestasActuales[p.paso];
							return {
								paso: p.paso,
								justificacion: r?.justificacion,
								nota: r?.nota,
							};
						}),
			});
		},
		onSuccess: (r) => {
			let resultado: ResultadoRecuperacion;
			if (r === null) {
				resultado = {
					tipo,
					operacion,
					modo: "registrado",
					recuperacionId: null,
					bucketNuevo: null,
					mensaje:
						"Entrega voluntaria registrada. Se notificó al asesor de B4.",
				};
			} else if (r.modo === "solicitud") {
				resultado = {
					tipo,
					operacion,
					modo: "solicitud",
					recuperacionId: r.recuperacionId,
					bucketNuevo: null,
					mensaje:
						"Solicitud enviada. El crédito pasa a B4 cuando un supervisor la apruebe.",
				};
			} else {
				resultado = {
					tipo,
					operacion,
					modo: "trasladado",
					recuperacionId: r.recuperacionId,
					bucketNuevo: r.bucket_nuevo,
					mensaje: r.asesor_sin_cambio
						? `Crédito trasladado a B${r.bucket_nuevo}. El asesor no cambia porque ya tiene asignado ese bucket.`
						: `Crédito trasladado a B${r.bucket_nuevo} y reasignado. Se notificó al asesor.`,
				};
			}
			toast.success(resultado.mensaje);
			queryClient.invalidateQueries({
				queryKey: orpc.getRecuperacionesVehiculoCaso.key(),
			});
			queryClient.invalidateQueries({
				queryKey: orpc.getSolicitudesRecuperacion.key(),
			});
			queryClient.invalidateQueries({
				queryKey: orpc.getVisitasCaso.key(),
			});
			queryClient.invalidateQueries({
				queryKey: orpc.getBucketActualCredito.key(),
			});
			queryClient.invalidateQueries({
				queryKey: orpc.getDetallesCreditoCarteraBack.key(),
			});
			// Embebido no hay Dialog que cerrar: el Workspace pasa a «Gestión
			// registrada» con onExito.
			if (!embebido) onOpenChange?.(false);
			onExito?.(resultado);
		},
		onError: (e: Error) => {
			toast.error(e.message || "No se pudo registrar la recuperación");
		},
	});

	const titulo = esSolicitud
		? "Solicitar recuperación del vehículo"
		: TIPO_RECUPERACION_LABEL[tipo];

	const descripcion = (
		<>
			{esSolicitud ? (
				<p>
					La recuperación debe aprobarla{" "}
					<strong>otro supervisor o administrador</strong>. Recibirá esta
					solicitud con su justificación y el checklist de las gestiones
					realizadas; al aprobarla, el crédito pasa a{" "}
					<strong>B4 · Última Instancia / Pre Jurídico</strong> en estado{" "}
					<strong>En recuperación</strong>. Hasta entonces permanece en su
					bucket actual.
				</p>
			) : operacion === "trasladar" ? (
				<p>
					El crédito pasa a{" "}
					<strong>B4 · Última Instancia / Pre Jurídico</strong> en estado{" "}
					<strong>En recuperación</strong> y queda con el asesor de ese bucket.
					Ese asesor verá la información de este formulario para{" "}
					{voluntaria ? "recibir la unidad" : "recuperar la unidad"}.
				</p>
			) : (
				<p>
					El crédito ya está en <strong>B4</strong>: se registra la entrega sin
					cambiarlo de bucket y se notifica al asesor responsable.
				</p>
			)}
			{operacion === "trasladar" && (
				<p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900 text-xs dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
					El estado se levanta <strong>solo</strong> si el cliente paga todo lo
					que debe —cuotas vencidas y mora— y contabilidad valida ese pago. Un
					convenio de pago no lo levanta.
				</p>
			)}
			{desdeVisita && (
				<p className="rounded-md border border-sky-200 bg-sky-50 p-2 text-sky-900 text-xs dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200">
					Registro desde la visita: el lugar y la fecha ya están cargados.
					Revíselos y complete el resto.
				</p>
			)}
		</>
	);

	// Cuerpo compartido por el Dialog y el modo embebido. Embebido, las
	// rejillas responden al ancho del panel (`@container` en la raíz embebida);
	// en el Dialog quedan los breakpoints de viewport de siempre.
	const cuerpo = (
		<>
			{/* 1 · Por qué */}
			<section className="space-y-2">
				<Label>
					{voluntaria ? "Motivo de la entrega" : "Motivo de la recuperación"}{" "}
					<span className="text-red-600">*</span>
				</Label>
				<div
					className={cn(
						"grid gap-2",
						embebido ? "@md:grid-cols-2" : "sm:grid-cols-2",
					)}
				>
					{Object.entries(catalogoMotivos).map(([clave, label]) => (
						<label
							key={clave}
							htmlFor={`motivo-${clave}`}
							className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/50"
						>
							<Checkbox
								id={`motivo-${clave}`}
								checked={motivos.includes(clave)}
								onCheckedChange={() => setMotivos((m) => alternar(m, clave))}
							/>
							{label}
						</label>
					))}
				</div>
				<Label htmlFor="motivo-detalle" className="pt-1 font-normal text-sm">
					{voluntaria ? "Detalle" : "Justificación para el supervisor"}{" "}
					{!voluntaria || motivos.includes("otro") ? (
						<span className="text-red-600">*</span>
					) : (
						<span className="text-muted-foreground">(opcional)</span>
					)}
				</Label>
				<Textarea
					id="motivo-detalle"
					value={motivoDetalle}
					onChange={(e) => setMotivoDetalle(e.target.value)}
					placeholder={
						voluntaria
							? "Ej.: Perdió el trabajo y prefiere entregar el vehículo antes de seguir atrasándose"
							: "Explique por qué no hay otra alternativa. Ej.: Tercera promesa incumplida, no contesta desde el 10/09 y en la visita la familia indicó que salió del país"
					}
					rows={voluntaria ? 2 : 3}
				/>
			</section>

			{/* CB-043 · Lo que ya se hizo (solo la forzosa) */}
			{!voluntaria && (
				<section className="space-y-2">
					<div>
						<h3 className="font-medium text-sm">
							Gestiones realizadas <span className="text-red-600">*</span>
						</h3>
						<p className="text-muted-foreground text-xs">
							Lo marcado proviene de lo registrado en el CRM
							{checklist.data
								? ` desde el ${new Date(checklist.data.desde).toLocaleDateString("es-GT")}`
								: ""}
							. Justifique lo que no se realizó: es lo primero que revisa el
							supervisor.
						</p>
					</div>
					{checklist.isPending ? (
						<p className="flex items-center gap-2 text-muted-foreground text-sm">
							<Loader2 className="h-4 w-4 animate-spin" />
							Revisando la gestión del caso…
						</p>
					) : checklist.isError ? (
						<p className="text-red-600 text-sm">
							{checklist.error.message || "No se pudo cargar el checklist."}
						</p>
					) : (
						<ChecklistFormulario
							pasos={pasos}
							respuestas={respuestasActuales}
							onChange={cambiarPaso}
							faltantes={faltantesChecklist}
							mostrarFaltantes={intentoEnviar}
						/>
					)}
				</section>
			)}

			{/* 2 · La entrega (solo voluntaria) */}
			{voluntaria && (
				<section className="space-y-3">
					<h3 className="font-medium text-sm">Datos de la entrega</h3>
					<div
						className={cn(
							"grid gap-3",
							embebido ? "@md:grid-cols-2" : "sm:grid-cols-2",
						)}
					>
						<div className="space-y-1.5">
							<Label htmlFor="fecha-entrega">
								Fecha y hora <span className="text-red-600">*</span>
							</Label>
							<Input
								id="fecha-entrega"
								type="datetime-local"
								value={fechaEntrega}
								onChange={(e) => setFechaEntrega(e.target.value)}
							/>
							<button
								type="button"
								className="text-primary text-xs hover:underline"
								onClick={() => setFechaEntrega(aDatetimeLocal(new Date()))}
							>
								Ya se entregó: usar fecha actual
							</button>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="lugar-entrega">
								Lugar <span className="text-red-600">*</span>
							</Label>
							<Input
								id="lugar-entrega"
								value={lugarEntrega}
								onChange={(e) => setLugarEntrega(e.target.value)}
								placeholder="Ej.: Agencia zona 9 o la dirección"
							/>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="persona-entrega">Persona que entrega</Label>
							<Input
								id="persona-entrega"
								value={persona}
								onChange={(e) => setPersona(e.target.value)}
								placeholder="Nombre (dejar vacío si es el cliente)"
							/>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="relacion-entrega">Relación con el cliente</Label>
							<Input
								id="relacion-entrega"
								value={relacion}
								onChange={(e) => setRelacion(e.target.value)}
								placeholder="Ej.: hermano, esposa"
							/>
						</div>
					</div>
				</section>
			)}

			{/* 3 · Dónde está */}
			<section className="space-y-2">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<h3 className="font-medium text-sm">
						{voluntaria
							? "Ubicación actual del vehículo"
							: "Ubicación del vehículo"}
					</h3>
					{vehicleId && (
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={tomarGps.isPending}
							onClick={() => tomarGps.mutate()}
						>
							{tomarGps.isPending ? (
								<Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
							) : (
								<Navigation className="mr-1.5 h-3.5 w-3.5" />
							)}
							{gps ? "Actualizar desde el GPS" : "Obtener del GPS"}
						</Button>
					)}
				</div>
				{gps && (
					<p className="flex items-center gap-1.5 text-muted-foreground text-xs">
						<MapPin className="h-3.5 w-3.5 text-emerald-600" />
						GPS{gps.unidad ? ` · ${gps.unidad}` : ""} · {gps.lat.toFixed(5)},{" "}
						{gps.lng.toFixed(5)} ·{" "}
						{formatUltimaSenal(gps.senalAt).toLowerCase()}
						<button
							type="button"
							className="ml-1 text-primary hover:underline"
							onClick={() => {
								setGps(null);
								setAvisoGps(null);
							}}
						>
							quitar
						</button>
					</p>
				)}
				{avisoGps && (
					<p className="text-amber-700 text-xs dark:text-amber-400">
						{avisoGps}
					</p>
				)}
				<Input
					aria-label="Dirección o referencia"
					value={direccion}
					onChange={(e) => setDireccion(e.target.value)}
					placeholder="Dirección o referencia (Ej.: casa de un familiar, 3a. calle 4-10 zona 7)"
				/>
				<Input
					aria-label="Enlace de mapa"
					value={enlace}
					onChange={(e) => setEnlace(e.target.value)}
					placeholder="Enlace de Google Maps o WhatsApp (opcional)"
				/>
			</section>

			{/* 4 · Estado */}
			<section className="space-y-2">
				<h3 className="font-medium text-sm">
					Estado del vehículo{" "}
					{voluntaria && <span className="text-red-600">*</span>}
				</h3>
				<div
					className={cn(
						"grid gap-3",
						embebido ? "@md:grid-cols-[1fr_10rem]" : "sm:grid-cols-[1fr_10rem]",
					)}
				>
					<Select value={estado} onValueChange={setEstado}>
						<SelectTrigger aria-label="Estado del vehículo">
							<SelectValue
								placeholder={
									voluntaria
										? "Seleccionar estado"
										: "Seleccionar estado (si se conoce)"
								}
							/>
						</SelectTrigger>
						<SelectContent>
							{Object.entries(ESTADOS_VEHICULO).map(([clave, label]) => (
								<SelectItem key={clave} value={clave}>
									{label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Input
						aria-label="Kilometraje"
						inputMode="numeric"
						value={kilometraje}
						onChange={(e) => setKilometraje(e.target.value)}
						placeholder="Kilometraje"
					/>
				</div>
				<Textarea
					aria-label="Detalle del estado"
					value={estadoDetalle}
					onChange={(e) => setEstadoDetalle(e.target.value)}
					placeholder="Daños, golpes, llantas u otros detalles conocidos (opcional)"
					rows={2}
				/>
			</section>

			{/* Solo en la entrega voluntaria: en la solicitud de recuperación
				    forzosa lo cubre la justificación (QA de CB-043). */}
			{voluntaria && (
				<section className="space-y-1.5">
					<Label htmlFor="observaciones-recuperacion">Observaciones</Label>
					<Textarea
						id="observaciones-recuperacion"
						value={observaciones}
						onChange={(e) => setObservaciones(e.target.value)}
						placeholder="Información adicional para quien recibe la unidad"
						rows={2}
					/>
				</section>
			)}
		</>
	);

	const intentarEnviar = () => {
		if (faltante) {
			setIntentoEnviar(true);
			toast.warning(faltante);
			return;
		}
		enviar.mutate();
	};

	// El botón NO se deshabilita por el formulario: deshabilitado no dice qué
	// falta, y el asesor llegaba abajo sin saber por qué no avanzaba. Al hacer
	// clic se le dice qué falta.
	const botonEnviar = (
		<Button
			disabled={enviar.isPending}
			className={embebido ? "flex-1" : undefined}
			onClick={intentarEnviar}
		>
			{enviar.isPending ? (
				<Loader2 className="mr-2 h-4 w-4 animate-spin" />
			) : (
				<Send className="mr-2 h-4 w-4" />
			)}
			{esSolicitud
				? "Enviar solicitud"
				: operacion === "trasladar"
					? "Enviar a B4"
					: "Registrar entrega"}
		</Button>
	);

	if (embebido) {
		return (
			<div className="@container flex min-h-0 flex-1 flex-col">
				<div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
					<div className="space-y-2 text-muted-foreground text-sm">
						{descripcion}
					</div>
					{cuerpo}
				</div>
				<div className="mt-auto flex flex-col gap-2 border-line-subtle border-t pt-3">
					<AvisoFaltante faltante={faltante} visible={intentoEnviar} />
					<div className="flex gap-2">
						<Button
							variant="outline"
							disabled={enviar.isPending}
							onClick={() => onCancelar?.()}
						>
							Cancelar
						</Button>
						{botonEnviar}
					</div>
				</div>
			</div>
		);
	}

	return (
		<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
			<DialogHeader>
				<DialogTitle>{titulo}</DialogTitle>
				<DialogDescription asChild>
					<div className="space-y-2">{descripcion}</div>
				</DialogDescription>
			</DialogHeader>

			<div className="space-y-5">{cuerpo}</div>

			<DialogFooter className="items-center gap-2 sm:justify-between">
				<AvisoFaltante faltante={faltante} visible={intentoEnviar} />
				<div className="flex gap-2">
					<Button variant="outline" onClick={() => onOpenChange?.(false)}>
						Cancelar
					</Button>
					{botonEnviar}
				</div>
			</DialogFooter>
		</DialogContent>
	);
}

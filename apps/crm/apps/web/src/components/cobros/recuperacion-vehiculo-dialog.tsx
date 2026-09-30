/**
 * CB-042 · Formulario de los dos envíos a recuperación de vehículo:
 *
 *  · Recuperación forzosa: el asesor decide quitar la unidad. Motivos, dónde
 *    está y en qué estado — lo que el asesor de B4 necesita para ir a buscarla.
 *  · Entrega voluntaria: el cliente la entrega. Además fecha, lugar, quién la
 *    entrega y qué documentos trae.
 *
 * De B1 a B3 el envío traslada el crédito a B4 (`enviarCreditoARecuperacion`).
 * La entrega voluntaria también se registra con el crédito ya en B4: ahí solo
 * se guarda el formulario (`registrarEntregaVoluntariaEnB4`).
 *
 * Las reglas del formulario son las MISMAS del servidor (se importan de
 * server/src/lib/recuperacion-vehiculo): el botón se habilita con lo mismo que
 * el servidor va a aceptar.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, MapPin, Navigation, Send, TriangleAlert } from "lucide-react";
import { useState } from "react";
import {
	type DetalleRecuperacionInput,
	DOCUMENTOS_VEHICULO,
	detalleRecuperacionSchema,
	ESTADOS_VEHICULO,
	erroresDetalleRecuperacion,
	motivosDelTipo,
	type OperacionRecuperacion,
	TIPO_RECUPERACION_LABEL,
	type TipoEnvioRecuperacion,
} from "server/src/lib/recuperacion-vehiculo";
import { toast } from "sonner";
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
import {
	formatUltimaSenal,
	googleMapsUrl,
	resolveEstadoSenal,
} from "@/routes/cobros/-gps-ficha";
import { client, orpc } from "@/utils/orpc";

/** El motivo de la consulta de GPS queda en la bitácora de CB-118. */
const MOTIVO_CONSULTA_GPS = "Registro de recuperación de vehículo (CB-042)";

type DocumentosEntrega = NonNullable<
	DetalleRecuperacionInput["entrega"]
>["documentos"];

type UbicacionGps = {
	lat: number;
	lng: number;
	unidad: string | null;
	senalAt: Date | null;
};

interface RecuperacionVehiculoDialogProps {
	open: boolean;
	onOpenChange: (abierto: boolean) => void;
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
}: RecuperacionVehiculoDialogProps) {
	const queryClient = useQueryClient();
	const voluntaria = tipo === "entrega_voluntaria";
	const catalogoMotivos = motivosDelTipo(tipo);

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
	const [documentos, setDocumentos] = useState<string[]>([]);
	const [documentosOtros, setDocumentosOtros] = useState("");
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
					documentos: documentos as DocumentosEntrega,
					documentosOtros,
				}
			: undefined,
		observaciones,
	};

	// Lo que falta, con las reglas del servidor. El primer problema basta: el
	// asesor lo resuelve y aparece el siguiente.
	const faltante = (() => {
		if (motivos.length === 0) return "Elegí al menos un motivo.";
		if (motivos.includes("otro") && !motivoDetalle.trim())
			return "Marcaste «Otro»: contá en el detalle cuál es el motivo.";
		if (voluntaria && !fechaEntrega) return "Falta la fecha de la entrega.";
		if (voluntaria && lugarEntrega.trim().length < 3)
			return "Falta el lugar de la entrega.";
		if (kilometraje.trim() && !/^\d+$/.test(kilometraje.trim()))
			return "El kilometraje va en números enteros.";
		const parsed = detalleRecuperacionSchema.safeParse(detalle);
		if (!parsed.success)
			return parsed.error.issues[0]?.message ?? "Revisá el formulario.";
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
						? "Este vehículo no tiene GPS vinculado. Escribí la ubicación a mano."
						: `No se pudo consultar el GPS${r.error?.message ? `: ${r.error.message}` : "."}`,
				);
				return;
			}
			const t = r.telemetria;
			if (t.latitude == null || t.longitude == null) {
				setAvisoGps(
					"El GPS respondió, pero sin posición. Escribí la ubicación a mano.",
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
					? `Ojo: la última posición es de ${formatUltimaSenal(senalAt).toLowerCase()}. El GPS no está reportando.`
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
			});
		},
		onSuccess: (r) => {
			if (r === null) {
				toast.success(
					"Entrega voluntaria registrada. El asesor de B4 ya tiene el aviso.",
				);
			} else {
				toast.success(
					r.asesor_sin_cambio
						? `Crédito trasladado a B${r.bucket_nuevo}. El asesor no cambia: ya cubre ese bucket.`
						: `Crédito trasladado a B${r.bucket_nuevo} y reasignado. Ya se le avisó al asesor.`,
				);
			}
			queryClient.invalidateQueries({
				queryKey: orpc.getRecuperacionesVehiculoCaso.key(),
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
			onOpenChange(false);
		},
		onError: (e: Error) => {
			toast.error(e.message || "No se pudo registrar la recuperación");
		},
	});

	return (
		<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
			<DialogHeader>
				<DialogTitle>{TIPO_RECUPERACION_LABEL[tipo]}</DialogTitle>
				<DialogDescription asChild>
					<div className="space-y-2">
						{operacion === "trasladar" ? (
							<p>
								El crédito pasa a{" "}
								<strong>B4 · Última Instancia / Pre Jurídico</strong> en estado{" "}
								<strong>En recuperación</strong> y queda con el asesor de ese
								bucket. Lo que llenes acá es lo que va a ver para{" "}
								{voluntaria ? "recibir la unidad" : "ir a buscar la unidad"}.
							</p>
						) : (
							<p>
								El crédito ya está en <strong>B4</strong>: se guarda la entrega
								sin moverlo, y le llega el aviso al asesor que lo lleva.
							</p>
						)}
						{operacion === "trasladar" && (
							<p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900 text-xs dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
								El estado se levanta <strong>solo</strong> si el cliente paga
								todo lo que debe —cuotas vencidas y mora— y contabilidad valida
								ese pago. Un convenio no lo levanta.
							</p>
						)}
						{desdeVisita && (
							<p className="rounded-md border border-sky-200 bg-sky-50 p-2 text-sky-900 text-xs dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200">
								Viene de la visita: el lugar y la fecha ya están puestos.
								Revisalos y completá el resto.
							</p>
						)}
					</div>
				</DialogDescription>
			</DialogHeader>

			<div className="space-y-5">
				{/* 1 · Por qué */}
				<section className="space-y-2">
					<Label>
						{voluntaria ? "¿Por qué la entrega?" : "¿Por qué se recupera?"}{" "}
						<span className="text-red-600">*</span>
					</Label>
					<div className="grid gap-2 sm:grid-cols-2">
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
						Detalle{" "}
						{motivos.includes("otro") ? (
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
								? "Ej: Perdió el trabajo, prefiere entregar el carro antes de seguir atrasándose"
								: "Ej: Tercera promesa rota este mes y ya no contesta"
						}
						rows={2}
					/>
				</section>

				{/* 2 · La entrega (solo voluntaria) */}
				{voluntaria && (
					<section className="space-y-3">
						<h3 className="font-medium text-sm">La entrega</h3>
						<div className="grid gap-3 sm:grid-cols-2">
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
									Ya la entregó: usar ahora
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
									placeholder="Ej: Agencia zona 9, o la dirección"
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="persona-entrega">Quién la entrega</Label>
								<Input
									id="persona-entrega"
									value={persona}
									onChange={(e) => setPersona(e.target.value)}
									placeholder="Nombre (vacío si es el cliente)"
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="relacion-entrega">
									Relación con el cliente
								</Label>
								<Input
									id="relacion-entrega"
									value={relacion}
									onChange={(e) => setRelacion(e.target.value)}
									placeholder="Ej: hermano, esposa"
								/>
							</div>
						</div>
						<div className="space-y-2">
							<Label>Documentos que entrega</Label>
							<div className="grid gap-2 sm:grid-cols-3">
								{Object.entries(DOCUMENTOS_VEHICULO).map(([clave, label]) => (
									<label
										key={clave}
										htmlFor={`doc-${clave}`}
										className="flex cursor-pointer items-center gap-2 text-sm"
									>
										<Checkbox
											id={`doc-${clave}`}
											checked={documentos.includes(clave)}
											onCheckedChange={() =>
												setDocumentos((d) => alternar(d, clave))
											}
										/>
										{label}
									</label>
								))}
							</div>
							<Input
								aria-label="Otros documentos"
								value={documentosOtros}
								onChange={(e) => setDocumentosOtros(e.target.value)}
								placeholder="Otros documentos (opcional)"
							/>
						</div>
					</section>
				)}

				{/* 3 · Dónde está */}
				<section className="space-y-2">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<h3 className="font-medium text-sm">
							{voluntaria
								? "Dónde está el vehículo ahora"
								: "Dónde está el vehículo"}
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
								{gps ? "Actualizar del GPS" : "Tomar del GPS"}
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
						placeholder="Dirección o referencia (ej: casa de la mamá, 3a calle 4-10 zona 7)"
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
					<div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
						<Select value={estado} onValueChange={setEstado}>
							<SelectTrigger aria-label="Estado del vehículo">
								<SelectValue
									placeholder={voluntaria ? "Elegí el estado" : "Si se sabe"}
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
						placeholder="Daños, golpes, llantas, lo que se sepa (opcional)"
						rows={2}
					/>
				</section>

				<section className="space-y-1.5">
					<Label htmlFor="observaciones-recuperacion">Observaciones</Label>
					<Textarea
						id="observaciones-recuperacion"
						value={observaciones}
						onChange={(e) => setObservaciones(e.target.value)}
						placeholder={
							voluntaria
								? "Algo más que deba saber quien recibe"
								: "Horarios, con quién vive, a qué se dedica… (opcional)"
						}
						rows={2}
					/>
				</section>
			</div>

			<DialogFooter className="items-center gap-2 sm:justify-between">
				<AvisoFaltante faltante={faltante} visible={intentoEnviar} />
				<div className="flex gap-2">
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancelar
					</Button>
					{/* El botón NO se deshabilita por el formulario: deshabilitado no
					    dice qué falta, y el asesor llegaba abajo sin saber por qué no
					    avanzaba. Al hacer clic se le dice qué falta. */}
					<Button
						disabled={enviar.isPending}
						onClick={() => {
							if (faltante) {
								setIntentoEnviar(true);
								toast.warning(faltante);
								return;
							}
							enviar.mutate();
						}}
					>
						{enviar.isPending ? (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						) : (
							<Send className="mr-2 h-4 w-4" />
						)}
						{operacion === "trasladar" ? "Enviar a B4" : "Registrar entrega"}
					</Button>
				</div>
			</DialogFooter>
		</DialogContent>
	);
}

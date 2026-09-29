/**
 * CB-042 · Lo que ve el asesor de B4 cuando le llega un crédito a recuperación:
 * por qué llegó, si el cliente entrega la unidad (cuándo, dónde, qué trae),
 * dónde está el vehículo, en qué estado y cuánto debía al momento del envío.
 *
 * Va arriba del Resumen de la Ficha 360 y en la pestaña Vehículo. Sin
 * registros no pinta nada. El registro vigente es el más reciente; los
 * anteriores quedan plegados abajo.
 *
 * La recepción de la unidad se confirma desde acá, y solo con el crédito en
 * B4 (el servidor lo vuelve a exigir).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Car,
	CheckCircle2,
	ChevronDown,
	ExternalLink,
	Loader2,
	MapPin,
	PackageCheck,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import {
	DOCUMENTOS_VEHICULO,
	ESTADOS_VEHICULO,
	etiquetaMotivo,
	TIPO_RECUPERACION_LABEL,
} from "server/src/lib/recuperacion-vehiculo";
import { toast } from "sonner";
import { AvisoFaltante } from "@/components/cobros/recuperacion-vehiculo-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import { formatUltimaSenal, googleMapsUrl } from "@/routes/cobros/-gps-ficha";
import { client, orpc } from "@/utils/orpc";

type Registro = Awaited<
	ReturnType<typeof client.getRecuperacionesVehiculoCaso>
>[number];

const TIPO_BADGE: Record<string, string> = {
	entrega_voluntaria:
		"bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
	tomado:
		"bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
	orden_secuestro:
		"bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
};

const fechaHora = (v: Date | string | null | undefined) =>
	v
		? new Date(v).toLocaleString("es-GT", {
				weekday: "short",
				day: "2-digit",
				month: "2-digit",
				year: "numeric",
				hour: "2-digit",
				minute: "2-digit",
			})
		: "—";

const fecha = (v: Date | string | null | undefined) =>
	v ? new Date(v).toLocaleDateString("es-GT") : "—";

const quetzales = (v: string | number | null | undefined) =>
	v == null
		? "—"
		: `Q${Number(v).toLocaleString("es-GT", {
				minimumFractionDigits: 2,
				maximumFractionDigits: 2,
			})}`;

const etiquetaEstado = (clave: string | null) =>
	clave ? ((ESTADOS_VEHICULO as Record<string, string>)[clave] ?? clave) : null;

const etiquetaDocumento = (clave: string) =>
	(DOCUMENTOS_VEHICULO as Record<string, string>)[clave] ?? clave;

/** "en 2 días" / "hace 3 horas", para que la fecha de entrega se lea de un vistazo. */
function relativo(v: Date | string | null | undefined): string | null {
	if (!v) return null;
	const diff = new Date(v).getTime() - Date.now();
	const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
	const horas = Math.round(diff / 3_600_000);
	if (Math.abs(horas) < 24) return rtf.format(horas, "hour");
	return rtf.format(Math.round(horas / 24), "day");
}

function Dato({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="min-w-0">
			<p className="text-muted-foreground text-xs">{label}</p>
			<div className="break-words font-medium text-sm">{children}</div>
		</div>
	);
}

interface RecuperacionVehiculoCardProps {
	casoCobroId: string;
	bucketNumero: number | null;
	enRecuperacion: boolean;
	/** Si puede confirmar la recepción (equipo de cobros). */
	puedeGestionar: boolean;
	/** Solo en el Resumen: lleva a la pestaña Vehículo (GPS en vivo y ubicaciones clave). */
	onVerVehiculo?: () => void;
}

export function RecuperacionVehiculoCard({
	casoCobroId,
	bucketNumero,
	enRecuperacion,
	puedeGestionar,
	onVerVehiculo,
}: RecuperacionVehiculoCardProps) {
	const [recepcionAbierta, setRecepcionAbierta] = useState(false);
	const registros = useQuery(
		orpc.getRecuperacionesVehiculoCaso.queryOptions({ input: { casoCobroId } }),
	);

	const lista = registros.data ?? [];
	if (lista.length === 0) return null;
	const [vigente, ...anteriores] = lista;
	const enB4 = bucketNumero === 4;

	const estadoBadge = vigente.completada
		? {
				texto: "Unidad recibida",
				clase:
					"bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
			}
		: enRecuperacion || (bucketNumero !== null && bucketNumero >= 4)
			? {
					texto: "En recuperación",
					clase: "bg-muted text-foreground",
				}
			: {
					texto: "Ya salió de recuperación",
					clase: "bg-muted text-muted-foreground",
				};

	return (
		<Card>
			<CardHeader className="pb-3">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<CardTitle className="flex items-center gap-2">
						<Car className="h-5 w-5" />
						Recuperación de vehículo
					</CardTitle>
					<div className="flex flex-wrap gap-1.5">
						<Badge className={TIPO_BADGE[vigente.tipo] ?? TIPO_BADGE.tomado}>
							{TIPO_RECUPERACION_LABEL[vigente.tipo]}
						</Badge>
						<Badge variant="secondary" className={estadoBadge.clase}>
							{estadoBadge.texto}
						</Badge>
					</div>
				</div>
				<p className="text-muted-foreground text-xs">
					{vigente.trasladado
						? `Enviado a recuperación el ${fecha(vigente.createdAt)}${vigente.registradoPor ? ` por ${vigente.registradoPor}` : ""}${vigente.bucketOrigen != null ? `, de B${vigente.bucketOrigen} a B${vigente.bucketDestino ?? 4}` : ""}`
						: `Registrado el ${fecha(vigente.createdAt)}${vigente.registradoPor ? ` por ${vigente.registradoPor}` : ""}, con el crédito ya en B${vigente.bucketOrigen ?? 4}`}
					{vigente.responsable ? ` · lo lleva ${vigente.responsable}` : ""}
				</p>
			</CardHeader>
			<CardContent className="space-y-4">
				<DetalleRegistro registro={vigente} />

				{vigente.completada ? (
					<Recepcion registro={vigente} />
				) : (
					<div className="flex flex-wrap gap-2 border-t pt-3">
						{puedeGestionar && enB4 && (
							<Button size="sm" onClick={() => setRecepcionAbierta(true)}>
								<PackageCheck className="mr-1.5 h-4 w-4" />
								Confirmar recepción de la unidad
							</Button>
						)}
						{onVerVehiculo && (
							<Button size="sm" variant="outline" onClick={onVerVehiculo}>
								<MapPin className="mr-1.5 h-4 w-4" />
								Ver GPS y ubicaciones clave
							</Button>
						)}
					</div>
				)}

				{anteriores.length > 0 && (
					<Collapsible className="border-t pt-3">
						<CollapsibleTrigger className="flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground">
							<ChevronDown className="h-3.5 w-3.5" />
							Registros anteriores ({anteriores.length})
						</CollapsibleTrigger>
						<CollapsibleContent className="mt-2 space-y-1.5">
							{anteriores.map((r) => (
								<p key={r.id} className="text-muted-foreground text-xs">
									{fecha(r.createdAt)} · {TIPO_RECUPERACION_LABEL[r.tipo]}
									{r.registradoPor ? ` · ${r.registradoPor}` : ""}
									{r.motivos.length > 0
										? ` · ${r.motivos.map(etiquetaMotivo).join(", ")}`
										: r.motivoDetalle
											? ` · ${r.motivoDetalle}`
											: ""}
									{r.completada ? " · unidad recibida" : ""}
								</p>
							))}
						</CollapsibleContent>
					</Collapsible>
				)}
			</CardContent>

			{recepcionAbierta && (
				<ConfirmarRecepcionDialog
					registro={vigente}
					onOpenChange={setRecepcionAbierta}
				/>
			)}
		</Card>
	);
}

function DetalleRegistro({ registro: r }: { registro: Registro }) {
	const lat = r.ubicacionLat != null ? Number(r.ubicacionLat) : undefined;
	const lng = r.ubicacionLng != null ? Number(r.ubicacionLng) : undefined;
	const mapa = r.ubicacionEnlace ?? googleMapsUrl(lat, lng);
	const motivos = r.motivos.filter((m) => m !== "otro").map(etiquetaMotivo);
	const noEntrega = Object.keys(DOCUMENTOS_VEHICULO).filter(
		(d) => !r.documentos.includes(d),
	);
	const hayUbicacion = r.ubicacionDireccion || mapa;

	return (
		<div className="space-y-4">
			{/* Por qué */}
			<div className="space-y-1.5">
				{motivos.length > 0 && (
					<div className="flex flex-wrap gap-1.5">
						{motivos.map((m) => (
							<Badge key={m} variant="outline" className="font-normal">
								{m}
							</Badge>
						))}
					</div>
				)}
				{r.motivoDetalle && <p className="text-sm">“{r.motivoDetalle}”</p>}
			</div>

			{/* La entrega */}
			{r.tipo === "entrega_voluntaria" && (
				<div className="grid gap-3 rounded-md border border-sky-200 bg-sky-50/60 p-3 sm:grid-cols-2 dark:border-sky-900 dark:bg-sky-950/30">
					<Dato label="Entrega">
						{fechaHora(r.fechaEntrega)}
						{relativo(r.fechaEntrega) && (
							<span className="ml-1 font-normal text-muted-foreground text-xs">
								({relativo(r.fechaEntrega)})
							</span>
						)}
					</Dato>
					<Dato label="Lugar">{r.lugarEntrega ?? "—"}</Dato>
					<Dato label="Quién entrega">
						{r.entregaPersona
							? `${r.entregaPersona}${r.entregaRelacion ? ` (${r.entregaRelacion})` : ""}`
							: "El cliente"}
					</Dato>
					<Dato label="Documentos">
						{r.documentos.length > 0
							? r.documentos.map(etiquetaDocumento).join(", ")
							: "Ninguno"}
						{r.documentosOtros ? `, ${r.documentosOtros}` : ""}
						{noEntrega.length > 0 && r.documentos.length > 0 && (
							<p className="font-normal text-muted-foreground text-xs">
								No trae: {noEntrega.map(etiquetaDocumento).join(", ")}
							</p>
						)}
					</Dato>
				</div>
			)}

			<div className="grid gap-3 sm:grid-cols-2">
				{/* Dónde está */}
				<Dato label="Dónde está el vehículo">
					{hayUbicacion ? (
						<div className="space-y-1">
							{r.ubicacionDireccion && <p>{r.ubicacionDireccion}</p>}
							{mapa && (
								<a
									href={mapa}
									target="_blank"
									rel="noopener noreferrer"
									className="inline-flex items-center gap-1 text-primary text-xs hover:underline"
								>
									<ExternalLink className="h-3 w-3" />
									Abrir en el mapa
								</a>
							)}
							{r.ubicacionFuente === "gps" && (
								<p className="font-normal text-muted-foreground text-xs">
									Del GPS{r.gpsUnidad ? ` (${r.gpsUnidad})` : ""}: posición de{" "}
									{formatUltimaSenal(
										r.gpsSenalAt,
										new Date(r.createdAt),
									).toLowerCase()}{" "}
									al registrar
								</p>
							)}
						</div>
					) : (
						<span className="font-normal text-muted-foreground">
							No se indicó
						</span>
					)}
				</Dato>

				{/* Estado */}
				<Dato label="Estado del vehículo">
					{etiquetaEstado(r.estadoVehiculo) ?? (
						<span className="font-normal text-muted-foreground">
							No se indicó
						</span>
					)}
					{r.kilometraje != null && (
						<span className="ml-1 font-normal text-muted-foreground text-xs">
							· {r.kilometraje.toLocaleString("es-GT")} km
						</span>
					)}
					{r.estadoVehiculoDetalle && (
						<p className="font-normal text-sm">{r.estadoVehiculoDetalle}</p>
					)}
				</Dato>
			</div>

			{/* Saldo al registrar */}
			{r.saldoTomadoAt && (
				<div className="rounded-md bg-muted/50 p-3">
					<p className="mb-2 text-muted-foreground text-xs">
						Saldo al {fecha(r.saldoTomadoAt)} (foto de cartera al registrar)
					</p>
					<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
						<Dato label="Saldo pendiente">{quetzales(r.saldoPendiente)}</Dato>
						<Dato label={`Vencido (${r.cuotasVencidas ?? 0} cuotas)`}>
							{quetzales(r.montoVencido)}
						</Dato>
						<Dato label="Mora">{quetzales(r.montoMora)}</Dato>
						<Dato label="Para ponerse al día">
							{quetzales(r.totalParaPonerseAlDia)}
						</Dato>
					</div>
				</div>
			)}

			{r.observaciones && (
				<Dato label="Observaciones">
					<span className="font-normal">{r.observaciones}</span>
				</Dato>
			)}
		</div>
	);
}

function Recepcion({ registro: r }: { registro: Registro }) {
	return (
		<div className="space-y-2 rounded-md border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
			<p className="flex items-center gap-1.5 font-medium text-emerald-900 text-sm dark:text-emerald-200">
				<CheckCircle2 className="h-4 w-4" />
				Unidad recibida el {fechaHora(r.fechaRecepcion)}
				{r.recepcionLugar ? ` en ${r.recepcionLugar}` : ""}
			</p>
			<div className="grid gap-3 sm:grid-cols-2">
				<Dato label="Estado al recibir">
					{etiquetaEstado(r.recepcionEstadoVehiculo) ?? "—"}
					{r.recepcionKilometraje != null && (
						<span className="ml-1 font-normal text-muted-foreground text-xs">
							· {r.recepcionKilometraje.toLocaleString("es-GT")} km
						</span>
					)}
					{r.recepcionEstadoDetalle && (
						<p className="font-normal">{r.recepcionEstadoDetalle}</p>
					)}
				</Dato>
				<Dato label="Documentos recibidos">
					{r.recepcionDocumentos && r.recepcionDocumentos.length > 0
						? r.recepcionDocumentos.map(etiquetaDocumento).join(", ")
						: "Ninguno"}
					{r.recepcionDocumentosOtros ? `, ${r.recepcionDocumentosOtros}` : ""}
				</Dato>
			</div>
			{r.recepcionNotas && <p className="text-sm">{r.recepcionNotas}</p>}
			<p className="text-muted-foreground text-xs">
				Registró {r.recepcionRegistradaPor ?? "—"} el{" "}
				{fecha(r.recepcionRegistradaAt)}
			</p>
		</div>
	);
}

function aDatetimeLocal(v: Date): string {
	const p = (n: number) => String(n).padStart(2, "0");
	return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}T${p(v.getHours())}:${p(v.getMinutes())}`;
}

type DatosRecepcion = Parameters<
	typeof client.confirmarRecepcionUnidad
>[0]["recepcion"];

function ConfirmarRecepcionDialog({
	registro,
	onOpenChange,
}: {
	registro: Registro;
	onOpenChange: (abierto: boolean) => void;
}) {
	const queryClient = useQueryClient();
	// Arranca con lo que se reportó al enviar: el asesor de B4 solo corrige lo
	// que no coincide con lo que llegó.
	const [fechaRecepcion, setFechaRecepcion] = useState(
		aDatetimeLocal(new Date()),
	);
	const [lugar, setLugar] = useState(
		registro.lugarEntrega ?? registro.ubicacionDireccion ?? "",
	);
	const [estado, setEstado] = useState(registro.estadoVehiculo ?? "");
	const [estadoDetalle, setEstadoDetalle] = useState(
		registro.estadoVehiculoDetalle ?? "",
	);
	const [kilometraje, setKilometraje] = useState(
		registro.kilometraje != null ? String(registro.kilometraje) : "",
	);
	const [documentos, setDocumentos] = useState<string[]>(registro.documentos);
	const [documentosOtros, setDocumentosOtros] = useState(
		registro.documentosOtros ?? "",
	);
	const [notas, setNotas] = useState("");
	const [intentoEnviar, setIntentoEnviar] = useState(false);

	const faltante = !fechaRecepcion
		? "Falta la fecha de recepción."
		: new Date(fechaRecepcion).getTime() > Date.now() + 10 * 60_000
			? "La fecha de recepción no puede ser futura."
			: lugar.trim().length < 3
				? "Falta dónde se recibió."
				: !estado
					? "Falta el estado en que llegó."
					: kilometraje.trim() && !/^\d+$/.test(kilometraje.trim())
						? "El kilometraje va en números enteros."
						: null;

	const confirmar = useMutation({
		mutationFn: (recepcion: DatosRecepcion) =>
			client.confirmarRecepcionUnidad({
				recuperacionId: registro.id,
				recepcion,
			}),
		onSuccess: () => {
			toast.success("Recepción de la unidad registrada.");
			queryClient.invalidateQueries({
				queryKey: orpc.getRecuperacionesVehiculoCaso.key(),
			});
			onOpenChange(false);
		},
		onError: (e: Error) => {
			toast.error(e.message || "No se pudo registrar la recepción");
		},
	});

	return (
		<Dialog open onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>Confirmar recepción de la unidad</DialogTitle>
					<DialogDescription>
						Registrá cómo llegó la unidad. Viene lleno con lo que se reportó al
						enviarla: cambiá lo que no coincida.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4">
					<div className="grid gap-3 sm:grid-cols-2">
						<div className="space-y-1.5">
							<Label htmlFor="fecha-recepcion">
								Fecha y hora <span className="text-red-600">*</span>
							</Label>
							<Input
								id="fecha-recepcion"
								type="datetime-local"
								value={fechaRecepcion}
								onChange={(e) => setFechaRecepcion(e.target.value)}
							/>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="lugar-recepcion">
								Dónde se recibió <span className="text-red-600">*</span>
							</Label>
							<Input
								id="lugar-recepcion"
								value={lugar}
								onChange={(e) => setLugar(e.target.value)}
							/>
						</div>
					</div>
					<div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
						<Select value={estado} onValueChange={setEstado}>
							<SelectTrigger aria-label="Estado en que llegó">
								<SelectValue placeholder="Estado en que llegó" />
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
						placeholder="Daños, faltantes, lo que se vea al recibir"
						rows={2}
					/>
					<div className="space-y-2">
						<Label>Documentos recibidos</Label>
						<div className="grid gap-2 sm:grid-cols-3">
							{Object.entries(DOCUMENTOS_VEHICULO).map(([clave, label]) => (
								<label
									key={clave}
									htmlFor={`rec-doc-${clave}`}
									className="flex cursor-pointer items-center gap-2 text-sm"
								>
									<Checkbox
										id={`rec-doc-${clave}`}
										checked={documentos.includes(clave)}
										onCheckedChange={() =>
											setDocumentos((d) =>
												d.includes(clave)
													? d.filter((x) => x !== clave)
													: [...d, clave],
											)
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
					<Textarea
						aria-label="Notas"
						value={notas}
						onChange={(e) => setNotas(e.target.value)}
						placeholder="Notas (opcional): quién la recibió, dónde quedó guardada…"
						rows={2}
					/>
				</div>
				<DialogFooter className="items-center gap-2 sm:justify-between">
					<AvisoFaltante faltante={faltante} visible={intentoEnviar} />
					<div className="flex gap-2">
						<Button variant="outline" onClick={() => onOpenChange(false)}>
							Cancelar
						</Button>
						<Button
							disabled={confirmar.isPending}
							onClick={() => {
								if (faltante) {
									setIntentoEnviar(true);
									toast.warning(faltante);
									return;
								}
								confirmar.mutate({
									fechaRecepcion: new Date(fechaRecepcion),
									lugar,
									estadoVehiculo: estado as DatosRecepcion["estadoVehiculo"],
									estadoVehiculoDetalle: estadoDetalle,
									kilometraje: kilometraje.trim()
										? Number(kilometraje)
										: undefined,
									documentos: documentos as DatosRecepcion["documentos"],
									documentosOtros,
									notas,
								});
							}}
						>
							{confirmar.isPending ? (
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							) : (
								<PackageCheck className="mr-2 h-4 w-4" />
							)}
							Confirmar recepción
						</Button>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

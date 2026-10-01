/**
 * CB-037 / CB-038 · Las visitas del caso en la Ficha 360.
 *
 * Arriba las programadas (lo que hay que hacer), con "Registrar resultado" y
 * "Cancelar". Después las realizadas: qué pasó, quién fue, las fotos y lo que
 * falta — si la visita terminó en promesa o en entrega voluntaria y eso
 * todavía no se registró, el botón para hacerlo está acá mismo.
 *
 * Sin visitas no pinta nada.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Briefcase,
	CalendarClock,
	ChevronDown,
	ExternalLink,
	HandCoins,
	Handshake,
	Home,
	KeyRound,
	MapPin,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import {
	etiquetaMotivoSinContacto,
	RESULTADO_VISITA_LABEL,
	type ResultadoVisita,
	TIPO_VISITA_LABEL,
} from "server/src/lib/visitas-cobros";
import { toast } from "sonner";
import type { VisitaProgramadaParaCompletar } from "@/components/cobros/visita-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { googleMapsUrl } from "@/routes/cobros/-gps-ficha";
import { client, orpc } from "@/utils/orpc";

export type Visita = Awaited<ReturnType<typeof client.getVisitasCaso>>[number];

const RESULTADO_BADGE: Record<string, string> = {
	pago: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
	promesa:
		"bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
	pago_parcial_promesa:
		"bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
	convenio: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
	entrega_voluntaria:
		"bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
	sin_contacto: "bg-muted text-muted-foreground",
};

const fechaHora = (v: Date | string | null | undefined) =>
	v
		? new Date(v).toLocaleString("es-GT", {
				weekday: "short",
				day: "2-digit",
				month: "2-digit",
				hour: "2-digit",
				minute: "2-digit",
			})
		: "—";

const fecha = (v: Date | string | null | undefined) =>
	v ? new Date(v).toLocaleDateString("es-GT") : "—";

const quetzales = (v: string | number | null | undefined) =>
	v == null
		? null
		: `Q${Number(v).toLocaleString("es-GT", {
				minimumFractionDigits: 2,
				maximumFractionDigits: 2,
			})}`;

/** "en 2 días" / "hace 3 horas". */
function relativo(v: Date | string | null | undefined): string | null {
	if (!v) return null;
	const diff = new Date(v).getTime() - Date.now();
	const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
	const horas = Math.round(diff / 3_600_000);
	if (Math.abs(horas) < 24) return rtf.format(horas, "hour");
	return rtf.format(Math.round(horas / 24), "day");
}

const IconoTipo = ({ tipo }: { tipo: string }) =>
	tipo === "trabajo" ? (
		<Briefcase className="h-4 w-4 shrink-0 text-muted-foreground" />
	) : (
		<Home className="h-4 w-4 shrink-0 text-muted-foreground" />
	);

interface VisitasCardProps {
	casoCobroId: string;
	/** Registrar resultados y cancelar (equipo de cobros). */
	puedeGestionar: boolean;
	onRegistrarResultado: (visita: VisitaProgramadaParaCompletar) => void;
	onRegistrarPromesa: (visita: Visita) => void;
	onRegistrarEntrega: (visita: Visita) => void;
	/**
	 * Abre el convenio. Viene solo si el crédito todavía puede tenerlo (sin
	 * convenio vigente ni pendiente): la visita no guarda el convenio, así que
	 * "no hay convenio" es la señal de que falta registrarlo.
	 */
	onRegistrarConvenio?: () => void;
	/** Botones de "Registrar Pago" (link o boleta) para las visitas con pago. */
	accionesPago?: ReactNode;
}

export function VisitasCard({
	casoCobroId,
	puedeGestionar,
	onRegistrarResultado,
	onRegistrarPromesa,
	onRegistrarEntrega,
	onRegistrarConvenio,
	accionesPago,
}: VisitasCardProps) {
	const [cancelando, setCancelando] = useState<Visita | null>(null);
	const visitas = useQuery(
		orpc.getVisitasCaso.queryOptions({ input: { casoCobroId } }),
	);

	const lista = visitas.data ?? [];
	if (lista.length === 0) return null;
	const programadas = lista.filter((v) => v.estado === "programada");
	const resto = lista.filter((v) => v.estado !== "programada");
	const recientes = resto.slice(0, 3);
	const anteriores = resto.slice(3);
	// El pago de una visita solo se ofrece en la más reciente: en las viejas ya
	// no dice nada útil.
	const ultimaRealizada = resto.find((v) => v.estado === "realizada")?.id;

	const fila = (v: Visita) => (
		<FilaVisita
			key={v.id}
			visita={v}
			puedeGestionar={puedeGestionar}
			onRegistrarResultado={onRegistrarResultado}
			onRegistrarPromesa={onRegistrarPromesa}
			onRegistrarEntrega={onRegistrarEntrega}
			onRegistrarConvenio={
				v.id === ultimaRealizada ? onRegistrarConvenio : undefined
			}
			onCancelar={setCancelando}
			accionesPago={v.id === ultimaRealizada ? accionesPago : undefined}
		/>
	);

	return (
		<Card>
			<CardHeader className="pb-3">
				<CardTitle className="flex items-center gap-2">
					<MapPin className="h-5 w-5" />
					Visitas
				</CardTitle>
				<p className="text-muted-foreground text-xs">
					{programadas.length > 0
						? `${programadas.length === 1 ? "1 programada" : `${programadas.length} programadas`} · `
						: ""}
					{resto.filter((v) => v.estado === "realizada").length} realizadas
				</p>
			</CardHeader>
			<CardContent className="space-y-3">
				{programadas.map(fila)}
				{recientes.map(fila)}
				{anteriores.length > 0 && (
					<Collapsible>
						<CollapsibleTrigger className="flex items-center gap-1 text-muted-foreground text-sm hover:text-foreground">
							<ChevronDown className="h-4 w-4" />
							{anteriores.length === 1
								? "Ver 1 anterior"
								: `Ver ${anteriores.length} anteriores`}
						</CollapsibleTrigger>
						<CollapsibleContent className="space-y-3 pt-3">
							{anteriores.map(fila)}
						</CollapsibleContent>
					</Collapsible>
				)}
			</CardContent>
			<CancelarVisitaDialog
				visita={cancelando}
				onClose={() => setCancelando(null)}
			/>
		</Card>
	);
}

function FilaVisita({
	visita: v,
	puedeGestionar,
	onRegistrarResultado,
	onRegistrarPromesa,
	onRegistrarEntrega,
	onRegistrarConvenio,
	onCancelar,
	accionesPago,
}: {
	visita: Visita;
	puedeGestionar: boolean;
	onRegistrarResultado: (visita: VisitaProgramadaParaCompletar) => void;
	onRegistrarPromesa: (visita: Visita) => void;
	onRegistrarEntrega: (visita: Visita) => void;
	onRegistrarConvenio?: () => void;
	onCancelar: (visita: Visita) => void;
	accionesPago?: ReactNode;
}) {
	const mapa =
		v.ubicacionLat != null && v.ubicacionLng != null
			? googleMapsUrl(Number(v.ubicacionLat), Number(v.ubicacionLng))
			: null;

	if (v.estado === "programada") {
		const vencida =
			v.fechaProgramada != null &&
			new Date(v.fechaProgramada).getTime() < Date.now();
		return (
			<div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<p className="flex items-center gap-2 font-medium text-sm">
						<IconoTipo tipo={v.tipo} />
						{TIPO_VISITA_LABEL[v.tipo]}
					</p>
					<Badge variant="secondary" className="gap-1">
						<CalendarClock className="h-3 w-3" />
						{vencida ? "Pendiente de registrar" : "Programada"}
					</Badge>
				</div>
				<p className="text-sm">
					{fechaHora(v.fechaProgramada)}
					<span className="text-muted-foreground">
						{" "}
						· {relativo(v.fechaProgramada)} · va {v.responsable ?? "—"}
					</span>
				</p>
				<p className="break-words text-muted-foreground text-sm">
					{v.empresa ? `${v.empresa} · ` : ""}
					{v.direccion}
					{v.referencia ? ` (${v.referencia})` : ""}
				</p>
				{v.notasProgramacion && (
					<p className="text-sm">
						<span className="text-muted-foreground">Notas: </span>
						{v.notasProgramacion}
					</p>
				)}
				{v.programadaPor && (
					<p className="text-muted-foreground text-xs">
						La programó {v.programadaPor} el {fecha(v.createdAt)}
					</p>
				)}
				{puedeGestionar && (
					<div className="flex flex-wrap gap-2 pt-1">
						<Button
							size="sm"
							className="h-9"
							onClick={() =>
								onRegistrarResultado({
									id: v.id,
									tipo: v.tipo,
									direccion: v.direccion,
									referencia: v.referencia,
									empresa: v.empresa,
									responsableId: v.responsableId,
								})
							}
						>
							Registrar resultado
						</Button>
						<Button
							size="sm"
							variant="outline"
							className="h-9"
							onClick={() => onCancelar(v)}
						>
							Cancelar visita
						</Button>
					</div>
				)}
			</div>
		);
	}

	if (v.estado === "cancelada") {
		return (
			<div className="space-y-1 rounded-md border border-dashed p-3 text-sm">
				<p className="flex items-center gap-2 text-muted-foreground">
					<IconoTipo tipo={v.tipo} />
					{TIPO_VISITA_LABEL[v.tipo]} · cancelada
					{v.canceladaAt ? ` el ${fecha(v.canceladaAt)}` : ""}
					{v.canceladaPor ? ` por ${v.canceladaPor}` : ""}
				</p>
				{v.motivoCancelacion && (
					<p className="text-muted-foreground">{v.motivoCancelacion}</p>
				)}
			</div>
		);
	}

	const resultado = v.resultado as ResultadoVisita | null;
	const monto = quetzales(v.montoRecibido);
	return (
		<div className="space-y-2 rounded-md border p-3">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<p className="flex items-center gap-2 font-medium text-sm">
					<IconoTipo tipo={v.tipo} />
					{TIPO_VISITA_LABEL[v.tipo]}
				</p>
				{resultado && (
					<Badge className={RESULTADO_BADGE[resultado] ?? ""}>
						{RESULTADO_VISITA_LABEL[resultado] ?? resultado}
					</Badge>
				)}
			</div>
			<p className="text-sm">
				{fechaHora(v.fechaVisita)}
				<span className="text-muted-foreground">
					{" "}
					· fue {v.responsable ?? "—"}
				</span>
			</p>
			<p className="break-words text-muted-foreground text-sm">
				{v.empresa ? `${v.empresa} · ` : ""}
				{v.direccion}
				{mapa && (
					<>
						{" "}
						<a
							href={mapa}
							target="_blank"
							rel="noreferrer"
							className="inline-flex items-center gap-0.5 text-primary hover:underline"
						>
							dónde se registró
							<ExternalLink className="h-3 w-3" />
						</a>
					</>
				)}
			</p>
			{(v.motivoSinContacto || monto) && (
				<p className="text-sm">
					{v.motivoSinContacto &&
						etiquetaMotivoSinContacto(v.motivoSinContacto)}
					{monto && `Pagó ${monto}`}
				</p>
			)}
			{v.comentarios && <p className="text-sm">{v.comentarios}</p>}
			{v.proximoPaso && (
				<p className="text-sm">
					<span className="text-muted-foreground">Próximo paso: </span>
					{v.proximoPaso}
				</p>
			)}
			{v.evidencias.length > 0 && (
				<div className="flex flex-wrap gap-2 pt-1">
					{v.evidencias.map((e) =>
						e.url ? (
							<a
								key={e.id}
								href={e.url}
								target="_blank"
								rel="noreferrer"
								className="block h-16 w-16 overflow-hidden rounded-md border bg-muted"
								title={e.nombreArchivo}
							>
								<img
									src={e.url}
									alt={e.nombreArchivo}
									loading="lazy"
									className="h-full w-full object-cover"
								/>
							</a>
						) : null,
					)}
				</div>
			)}

			{puedeGestionar && (v.falta.promesa || v.falta.entrega) && (
				<div className="flex flex-wrap items-center gap-2 rounded-md bg-amber-50 p-2 text-amber-900 text-sm dark:bg-amber-950/40 dark:text-amber-200">
					<span>
						{v.falta.entrega
							? "Falta registrar la entrega voluntaria."
							: "Falta registrar la promesa."}
					</span>
					{v.falta.promesa && (
						<Button
							size="sm"
							variant="outline"
							className="h-8 bg-background"
							onClick={() => onRegistrarPromesa(v)}
						>
							<HandCoins className="mr-1.5 h-4 w-4" />
							Registrar promesa
						</Button>
					)}
					{v.falta.entrega && (
						<Button
							size="sm"
							variant="outline"
							className="h-8 bg-background"
							onClick={() => onRegistrarEntrega(v)}
						>
							<KeyRound className="mr-1.5 h-4 w-4" />
							Registrar entrega
						</Button>
					)}
				</div>
			)}
			{puedeGestionar && v.pasos?.convenio && onRegistrarConvenio && (
				<div className="flex flex-wrap items-center gap-2 rounded-md bg-amber-50 p-2 text-amber-900 text-sm dark:bg-amber-950/40 dark:text-amber-200">
					<span>Falta registrar el convenio de pago.</span>
					<Button
						size="sm"
						variant="outline"
						className="h-8 bg-background"
						onClick={onRegistrarConvenio}
					>
						<Handshake className="mr-1.5 h-4 w-4" />
						Registrar convenio
					</Button>
				</div>
			)}
			{puedeGestionar && v.pasos?.pago && accionesPago && (
				<div className="flex flex-wrap items-center gap-2 border-t pt-2 text-sm">
					<span className="text-muted-foreground">
						El pago se registra aparte:
					</span>
					{accionesPago}
				</div>
			)}
			{v.registradaPor && (
				<p className="text-muted-foreground text-xs">
					Registrada por {v.registradaPor}
				</p>
			)}
		</div>
	);
}

function CancelarVisitaDialog({
	visita,
	onClose,
}: {
	visita: Visita | null;
	onClose: () => void;
}) {
	const queryClient = useQueryClient();
	const [motivo, setMotivo] = useState("");
	const cancelar = useMutation({
		mutationFn: () =>
			client.cancelarVisitaCobro({
				visitaId: visita?.id ?? "",
				motivo,
			}),
		onSuccess: () => {
			toast.success("Visita cancelada.");
			queryClient.invalidateQueries({ queryKey: orpc.getVisitasCaso.key() });
			setMotivo("");
			onClose();
		},
		onError: (e: Error) =>
			toast.error(e.message || "No se pudo cancelar la visita"),
	});
	return (
		<Dialog
			open={!!visita}
			onOpenChange={(abierto) => {
				if (!abierto) {
					setMotivo("");
					onClose();
				}
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>¿Cancelar la visita?</DialogTitle>
					<DialogDescription>
						{visita
							? `${TIPO_VISITA_LABEL[visita.tipo]} del ${fechaHora(visita.fechaProgramada)}. Queda en el historial como cancelada.`
							: ""}
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-1.5">
					<Label htmlFor="motivo-cancelar-visita">
						Motivo <span className="text-red-600">*</span>
					</Label>
					<Textarea
						id="motivo-cancelar-visita"
						value={motivo}
						onChange={(e) => setMotivo(e.target.value)}
						rows={3}
						placeholder="Ej: el cliente pagó antes de la visita"
					/>
				</div>
				<DialogFooter>
					<Button
						variant="outline"
						onClick={onClose}
						disabled={cancelar.isPending}
					>
						Volver
					</Button>
					<Button
						onClick={() => {
							if (motivo.trim().length < 5) {
								toast.error("Contá por qué no se hizo (mínimo 5 caracteres).");
								return;
							}
							cancelar.mutate();
						}}
						disabled={cancelar.isPending}
					>
						Cancelar visita
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

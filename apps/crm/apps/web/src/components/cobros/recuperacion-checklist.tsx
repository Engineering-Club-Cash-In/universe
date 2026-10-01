/**
 * CB-043 · El checklist de la solicitud de recuperación, en sus dos caras:
 *
 *  · `ChecklistFormulario` — lo llena quien pide. Cada paso llega con lo que el
 *    CRM (o cartera) encontró —llamadas, convenio, visitas, referencias,
 *    apagado…—; lo que no está hecho se justifica con una de las razones de
 *    ESE paso (catálogo en la base, `opciones`). Nada se marca a mano y la
 *    nota es siempre opcional.
 *  · `ChecklistVista` — lo lee el supervisor antes de decidir, y el asesor de
 *    B4 cuando le llega el crédito.
 *
 * Y el diálogo para aprobar o rechazar (`DecidirSolicitudDialog`), que usan la
 * ficha y la pantalla de Solicitudes. Las reglas son las del servidor
 * (server/src/lib/recuperacion-solicitud).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
	CheckCircle2,
	CircleDashed,
	CircleDot,
	Loader2,
	ShieldCheck,
	XCircle,
} from "lucide-react";
import { useState } from "react";
import {
	ESTADO_SOLICITUD_LABEL,
	type EstadoPaso,
	type EstadoSolicitudRecuperacion,
	MIN_MOTIVO_RECHAZO,
	type OpcionJustificacion,
	type PasoChecklist,
	type RespuestaPasoInput,
	resumenChecklist,
} from "server/src/lib/recuperacion-solicitud";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { client, orpc } from "@/utils/orpc";

// ── Estados ─────────────────────────────────────────────────────────────────

const ICONO_PASO: Record<
	EstadoPaso,
	{ Icono: typeof CheckCircle2; clase: string }
> = {
	hecho: { Icono: CheckCircle2, clase: "text-emerald-600" },
	parcial: { Icono: CircleDot, clase: "text-amber-600" },
	pendiente: { Icono: CircleDashed, clase: "text-muted-foreground" },
};

const CLASE_ESTADO_SOLICITUD: Record<EstadoSolicitudRecuperacion, string> = {
	pendiente:
		"bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
	aprobada:
		"bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
	rechazada: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
	cancelada: "bg-muted text-muted-foreground",
	sin_efecto: "bg-muted text-muted-foreground",
};

export function EstadoSolicitudBadge({ estado }: { estado: string | null }) {
	if (!estado) return null;
	const e = estado as EstadoSolicitudRecuperacion;
	return (
		<Badge variant="secondary" className={CLASE_ESTADO_SOLICITUD[e] ?? ""}>
			{ESTADO_SOLICITUD_LABEL[e] ?? estado}
		</Badge>
	);
}

// ── Vista (solo lectura) ────────────────────────────────────────────────────

export function ChecklistVista({ pasos }: { pasos: PasoChecklist[] }) {
	if (pasos.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">
				Sin checklist: se envió sin formulario de gestión.
			</p>
		);
	}
	const resumen = resumenChecklist(pasos);
	return (
		<div className="space-y-2">
			<p className="text-muted-foreground text-xs">
				{resumen.texto}
				{resumen.justificados > 0
					? ` · ${resumen.justificados} justificados`
					: ""}
			</p>
			<ul className="divide-y rounded-md border">
				{pasos.map((p) => {
					const { Icono, clase } = ICONO_PASO[p.estado];
					return (
						<li key={p.paso} className="flex gap-2.5 px-3 py-2">
							<Icono className={cn("mt-0.5 h-4 w-4 shrink-0", clase)} />
							<div className="min-w-0 space-y-0.5">
								<p className="font-medium text-sm">{p.titulo}</p>
								{p.evidencia && (
									<p className="text-muted-foreground text-xs">{p.evidencia}</p>
								)}
								{p.justificacion && (
									<p className="text-amber-800 text-xs dark:text-amber-300">
										Justificación: {p.justificacionEtiqueta ?? p.justificacion}
									</p>
								)}
								{p.nota && <p className="text-xs">“{p.nota}”</p>}
							</div>
						</li>
					);
				})}
			</ul>
		</div>
	);
}

// ── Formulario ──────────────────────────────────────────────────────────────

export type PasoParaLlenar = {
	paso: string;
	titulo: string;
	ayuda: string;
	estado: EstadoPaso;
	evidencia: string;
	/** "¿Por qué no hay llamadas al cliente?", etc. */
	pregunta: string;
	/** Las razones activas de este paso (del catálogo en la base). */
	opciones: readonly OpcionJustificacion[];
	sugerencia: string | null;
};

export type RespuestasChecklist = Record<string, RespuestaPasoInput>;

/** Arranca con la justificación sugerida ya elegida en los pasos que la tienen. */
export function respuestasIniciales(
	pasos: readonly PasoParaLlenar[],
): RespuestasChecklist {
	const r: RespuestasChecklist = {};
	for (const p of pasos) {
		r[p.paso] = {
			paso: p.paso as RespuestaPasoInput["paso"],
			...(p.sugerencia ? { justificacion: p.sugerencia } : {}),
		};
	}
	return r;
}

export function ChecklistFormulario({
	pasos,
	respuestas,
	onChange,
	faltantes,
	mostrarFaltantes,
}: {
	pasos: readonly PasoParaLlenar[];
	respuestas: RespuestasChecklist;
	onChange: (paso: string, cambio: Partial<RespuestaPasoInput>) => void;
	/** Qué le falta a cada paso (por clave), con las reglas del servidor. */
	faltantes: Record<string, string | null>;
	mostrarFaltantes: boolean;
}) {
	return (
		<ul className="divide-y rounded-md border">
			{pasos.map((p) => {
				const r = respuestas[p.paso];
				const estado = p.estado;
				const { Icono, clase } = ICONO_PASO[estado];
				const falta = mostrarFaltantes ? faltantes[p.paso] : null;
				return (
					<li
						key={p.paso}
						className={cn(
							"space-y-2 px-3 py-2.5",
							falta && "bg-amber-50/70 dark:bg-amber-950/20",
						)}
					>
						<div className="flex gap-2.5">
							<Icono className={cn("mt-0.5 h-4 w-4 shrink-0", clase)} />
							<div className="min-w-0 flex-1">
								<p className="font-medium text-sm">{p.titulo}</p>
								<p className="text-muted-foreground text-xs">{p.evidencia}</p>
							</div>
						</div>

						{estado !== "hecho" && (
							<div className="ml-6.5 space-y-1">
								<Label
									htmlFor={`justificacion-${p.paso}`}
									className="font-normal text-muted-foreground text-xs"
								>
									{p.pregunta || "Motivo por el que no se realizó"}
								</Label>
								<Select
									value={r?.justificacion ?? ""}
									onValueChange={(v) => onChange(p.paso, { justificacion: v })}
								>
									<SelectTrigger
										id={`justificacion-${p.paso}`}
										aria-label={`Justificación de ${p.titulo}`}
										className="h-8 text-sm"
									>
										<SelectValue placeholder="Seleccionar justificación" />
									</SelectTrigger>
									<SelectContent>
										{p.opciones.map((o) => (
											<SelectItem key={o.clave} value={o.clave}>
												{o.etiqueta}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						)}

						{estado !== "hecho" && (
							<div className="ml-6.5">
								<Input
									aria-label={`Nota de ${p.titulo}`}
									className="h-8 text-sm"
									value={r?.nota ?? ""}
									onChange={(e) => onChange(p.paso, { nota: e.target.value })}
									placeholder="Nota (opcional)"
								/>
							</div>
						)}

						{falta && (
							<p className="ml-6.5 text-amber-700 text-xs dark:text-amber-400">
								{falta}
							</p>
						)}
					</li>
				);
			})}
		</ul>
	);
}

// ── Aprobar / rechazar ──────────────────────────────────────────────────────

export function DecidirSolicitudDialog({
	solicitud,
	decision,
	onOpenChange,
}: {
	solicitud: { id: string; quien: string };
	decision: "aprobar" | "rechazar";
	onOpenChange: (abierto: boolean) => void;
}) {
	const queryClient = useQueryClient();
	const [motivo, setMotivo] = useState("");
	const aprobar = decision === "aprobar";
	const motivoCorto = !aprobar && motivo.trim().length < MIN_MOTIVO_RECHAZO;

	const decidir = useMutation({
		mutationFn: () =>
			client.decidirSolicitudRecuperacion({
				recuperacionId: solicitud.id,
				decision,
				motivo: aprobar ? undefined : motivo.trim(),
			}),
		onSuccess: (r) => {
			toast.success(
				r.decision === "aprobada"
					? r.asesorSinCambio
						? `Solicitud aprobada: el crédito pasó a B${r.bucketNuevo}. El asesor ya tenía asignado ese bucket.`
						: `Solicitud aprobada: el crédito pasó a B${r.bucketNuevo} y se reasignó. Se enviaron las notificaciones.`
					: "Solicitud rechazada. Se notificó al solicitante.",
			);
			onOpenChange(false);
		},
		onError: (e: Error) => {
			toast.error(e.message || "No se pudo decidir la solicitud");
		},
		onSettled: () => {
			// Aunque falle (otro supervisor decidió, o quedó sin efecto), la vista
			// tiene que reflejar el estado real.
			for (const key of [
				orpc.getSolicitudesRecuperacion.key(),
				orpc.getRecuperacionesVehiculoCaso.key(),
				orpc.getBucketActualCredito.key(),
				orpc.getDetallesCreditoCarteraBack.key(),
			]) {
				queryClient.invalidateQueries({ queryKey: key });
			}
		},
	});

	return (
		<Dialog open onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						{aprobar ? (
							<ShieldCheck className="h-5 w-5 text-emerald-600" />
						) : (
							<XCircle className="h-5 w-5 text-red-600" />
						)}
						{aprobar
							? "Aprobar la recuperación del vehículo"
							: "Rechazar la recuperación del vehículo"}
					</DialogTitle>
					<DialogDescription>
						{aprobar ? (
							<>
								{solicitud.quien} pasa ahora a{" "}
								<strong>B4 · Última Instancia / Pre Jurídico</strong> en estado{" "}
								<strong>En recuperación</strong>, con el asesor de ese bucket,
								aunque todavía no tenga cuatro cuotas vencidas.
							</>
						) : (
							<>
								{solicitud.quien} permanece en su bucket. El motivo se
								notificará a quien solicitó la recuperación.
							</>
						)}
					</DialogDescription>
				</DialogHeader>
				{!aprobar && (
					<div className="space-y-1.5">
						<Label htmlFor="motivo-rechazo">
							Motivo <span className="text-red-600">*</span>
						</Label>
						<Textarea
							id="motivo-rechazo"
							value={motivo}
							onChange={(e) => setMotivo(e.target.value)}
							placeholder="Ej.: Falta visitar el lugar de trabajo antes de enviarlo a B4"
							rows={3}
						/>
					</div>
				)}
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancelar
					</Button>
					<Button
						variant={aprobar ? "default" : "destructive"}
						disabled={decidir.isPending || motivoCorto}
						onClick={() => decidir.mutate()}
					>
						{decidir.isPending && (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						)}
						{aprobar ? "Aprobar y enviar a B4" : "Rechazar"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

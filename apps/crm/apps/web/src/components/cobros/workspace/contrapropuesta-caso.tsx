/**
 * #1895 · M4 — El asesor responde la contrapropuesta del supervisor.
 *
 * El supervisor revisó el convenio pendiente y, en vez de aprobarlo o
 * rechazarlo, se lo devolvió al asesor con otro número de cuotas y otra fecha
 * de primer pago (el total no cambia). Mientras espera respuesta, el convenio
 * no se puede decidir. Aquí el asesor ve el aviso «El supervisor le propone
 * otro plan», lo compara con el suyo y lo acepta (cartera reescribe el plan y
 * el convenio sigue pendiente de aprobación) o lo descarta (el supervisor
 * decide con el plan original). Un supervisor que mira el caso solo puede
 * retirarla.
 *
 * Lee `getContrapropuestaPendienteDelCaso` (por caso: la ficha no conoce el
 * convenio) y responde con `responderContrapropuesta`. Presentación
 * (`ContrapropuestaAvisoVista`) separada del conectado (`ContrapropuestaCaso`),
 * que se monta igual en el Workspace y en la Ficha 360.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2, MessageSquareReply } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { CrmCard, CrmPill, crmText } from "@/components/ds/cards-credito";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogIcon,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
	fechaLargaGT,
	formatoQuetzales as fmtQ,
} from "@/lib/cobros/reglas-caso";
import { cn } from "@/lib/utils";
import { type client, orpc } from "@/utils/orpc";

/* ── Tipos ──────────────────────────────────────────────────────────────────── */

export type ContrapropuestaPendiente = NonNullable<
	Awaited<ReturnType<typeof client.getContrapropuestaPendienteDelCaso>>
>;

export type AccionContrapropuesta = "aceptar" | "descartar";

/** Lo que pinta el aviso. */
export type ContrapropuestaVista = {
	convenioId: number;
	/** «Ana López · 14 oct 2026». */
	deQuien: string;
	nota: string;
	/** Total del convenio (no cambia). */
	total: string;
	filas: Array<{
		label: string;
		original: string;
		propuesta: string;
		cambia: boolean;
	}>;
	/**
	 * asesor: el que lleva el crédito (Aceptar y Descartar).
	 * supervisor: solo retirarla.
	 * consulta: la ve alguien que no la puede responder (p. ej. un suplente).
	 */
	modo: "asesor" | "supervisor" | "consulta";
	/** Texto para la confirmación de «Aceptar». */
	resumenPropuesta: string;
};

/* ── Mapeo puro ─────────────────────────────────────────────────────────────── */

const cuotasTexto = (n: number) => `${n} ${n === 1 ? "cuota" : "cuotas"}`;

export function vistaDeContrapropuesta(
	c: ContrapropuestaPendiente,
): ContrapropuestaVista {
	const fecha = (v: string | null) => (v ? fechaLargaGT(v) || v : "—");
	const filas = [
		{
			label: "Cuotas",
			original: cuotasTexto(c.original.numeroMeses),
			propuesta: cuotasTexto(c.propuesta.numeroMeses),
			cambia: c.original.numeroMeses !== c.propuesta.numeroMeses,
		},
		{
			label: "Cuota del convenio",
			original: `${fmtQ(c.original.cuotaMensual)} / mes`,
			propuesta: `${fmtQ(c.propuesta.cuotaMensual)} / mes`,
			cambia: c.original.cuotaMensual !== c.propuesta.cuotaMensual,
		},
		{
			label: "Primer pago",
			original: fecha(c.original.primerPago),
			propuesta: fecha(c.propuesta.primerPago),
			cambia: c.original.primerPago !== c.propuesta.primerPago,
		},
	];
	// Sin saber quién lleva el crédito (cartera no respondió), se ofrece lo del
	// asesor: el servidor vuelve a validar al responder.
	const modo: ContrapropuestaVista["modo"] =
		c.puedeAceptar !== false
			? "asesor"
			: c.esSupervisor && c.puedeDescartar !== false
				? "supervisor"
				: "consulta";
	return {
		convenioId: c.convenioId,
		deQuien: [c.creadaPor ?? "Supervisor", fechaLargaGT(c.creadaEn)]
			.filter(Boolean)
			.join(" · "),
		nota: c.nota,
		total: fmtQ(c.montoTotal),
		filas,
		modo,
		resumenPropuesta: `${cuotasTexto(c.propuesta.numeroMeses)} de ${fmtQ(c.propuesta.cuotaMensual)}, con primer pago el ${fecha(c.propuesta.primerPago)}`,
	};
}

/* ── Presentación ───────────────────────────────────────────────────────────── */

const CONFIRMACION: Record<
	"aceptar" | "descartar" | "retirar",
	{
		titulo: string;
		descripcion: (v: ContrapropuestaVista) => string;
		boton: string;
		variante: "default" | "destructive" | "outline";
	}
> = {
	aceptar: {
		titulo: "¿Aceptar el plan del supervisor?",
		descripcion: (v) =>
			`El convenio queda en ${v.resumenPropuesta}. El total no cambia (${v.total}) y el convenio sigue pendiente de aprobación.`,
		boton: "Aceptar plan",
		variante: "default",
	},
	descartar: {
		titulo: "¿Descartar la contrapropuesta?",
		descripcion: () =>
			"El convenio sigue con el plan que usted propuso y el supervisor lo decide así.",
		boton: "Descartar",
		variante: "destructive",
	},
	retirar: {
		titulo: "¿Retirar la contrapropuesta?",
		descripcion: () =>
			"El convenio vuelve al plan que propuso el asesor y queda pendiente de su decisión.",
		boton: "Retirar contrapropuesta",
		variante: "destructive",
	},
};

/**
 * El aviso «El supervisor le propone otro plan»: de quién, su nota, el plan
 * comparado con el original y las acciones (con confirmación y una nota
 * opcional para el supervisor).
 */
export function ContrapropuestaAvisoVista({
	datos,
	onResponder,
	enviando = null,
	className,
}: {
	datos: ContrapropuestaVista;
	/** Sin esto no hay acciones (solo lectura). */
	onResponder?: (accion: AccionContrapropuesta, nota: string) => void;
	/** La acción en vuelo. */
	enviando?: AccionContrapropuesta | null;
	className?: string;
}) {
	const [confirmar, setConfirmar] = React.useState<
		"aceptar" | "descartar" | "retirar" | null
	>(null);
	const [nota, setNota] = React.useState("");
	const abrir = (accion: "aceptar" | "descartar" | "retirar") => {
		setNota("");
		setConfirmar(accion);
	};
	const conf = confirmar ? CONFIRMACION[confirmar] : null;
	const ocupado = enviando !== null;

	return (
		<CrmCard
			superficie="outline"
			className={cn("gap-3 border-brand/40 bg-brand-subtle/40 p-4", className)}
			aria-label="Contrapropuesta del supervisor"
		>
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div className="flex min-w-0 items-center gap-2.5">
					<span
						aria-hidden
						className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand text-on-brand"
					>
						<MessageSquareReply className="size-4" />
					</span>
					<div className="flex min-w-0 flex-col gap-0.5">
						<span className={cn(crmText.title, "wrap-break-word")}>
							{datos.modo === "asesor"
								? "El supervisor le propone otro plan"
								: "Contrapropuesta esperando al asesor"}
						</span>
						<span className={crmText.sub}>{datos.deQuien}</span>
					</div>
				</div>
				<CrmPill kind="chip" tone="brand">
					Convenio #{datos.convenioId}
				</CrmPill>
			</div>

			{datos.nota ? (
				<p className="wrap-break-word rounded-md bg-surface px-3 py-2 text-fg-secondary text-xs leading-snug">
					<span className="font-semibold text-fg">Nota del supervisor: </span>
					{datos.nota}
				</p>
			) : null}

			<div className="overflow-hidden rounded-lg border border-line-subtle bg-surface">
				<div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-2 border-line-subtle border-b px-3 py-2">
					<span className={crmText.label}>Plan</span>
					<span className={crmText.label}>
						{datos.modo === "asesor" ? "Su propuesta" : "Del asesor"}
					</span>
					<span aria-hidden />
					<span className={crmText.label}>Del supervisor</span>
				</div>
				{datos.filas.map((f) => (
					<div
						key={f.label}
						className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-2 not-last:border-line-subtle not-last:border-b px-3 py-2"
					>
						<span className="wrap-break-word text-fg-secondary text-xs">
							{f.label}
						</span>
						<span
							className={cn(
								"wrap-break-word text-[13px] tabular-nums",
								f.cambia ? "text-fg-tertiary line-through" : "text-fg",
							)}
						>
							{f.original}
						</span>
						<ArrowRight
							aria-hidden
							className={cn(
								"size-3.5",
								f.cambia ? "text-brand" : "text-fg-tertiary",
							)}
						/>
						<span
							className={cn(
								"wrap-break-word text-[13px] tabular-nums",
								f.cambia ? "font-semibold text-brand" : "text-fg",
							)}
						>
							{f.propuesta}
						</span>
					</div>
				))}
			</div>
			<p className="text-fg-secondary text-xs leading-snug">
				El total del convenio no cambia: {datos.total}.
				{datos.modo === "asesor"
					? " Si acepta, el convenio sigue pendiente de aprobación con este plan; si la descarta, el supervisor decide con el plan original."
					: datos.modo === "supervisor"
						? " Mientras el asesor no responda, el convenio no se puede decidir."
						: " La responde el asesor que lleva el crédito."}
			</p>

			{onResponder && datos.modo !== "consulta" ? (
				<div className="flex flex-wrap justify-end gap-2">
					{datos.modo === "asesor" ? (
						<>
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={ocupado}
								onClick={() => abrir("descartar")}
							>
								{enviando === "descartar" ? (
									<Loader2 aria-hidden className="animate-spin" />
								) : null}
								Descartar
							</Button>
							<Button
								type="button"
								size="sm"
								disabled={ocupado}
								onClick={() => abrir("aceptar")}
							>
								{enviando === "aceptar" ? (
									<Loader2 aria-hidden className="animate-spin" />
								) : null}
								Aceptar plan
							</Button>
						</>
					) : (
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={ocupado}
							onClick={() => abrir("retirar")}
						>
							{enviando === "descartar" ? (
								<Loader2 aria-hidden className="animate-spin" />
							) : null}
							Retirar contrapropuesta
						</Button>
					)}
				</div>
			) : null}

			<AlertDialog
				open={confirmar !== null}
				onOpenChange={(abierto) => {
					if (!abierto) setConfirmar(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogIcon
							variant={confirmar === "aceptar" ? undefined : "warning"}
						/>
						<AlertDialogTitle>{conf?.titulo}</AlertDialogTitle>
						<AlertDialogDescription>
							{conf?.descripcion(datos)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<div className="space-y-2">
						<Label htmlFor="contrapropuesta-nota">
							Nota para el supervisor (opcional)
						</Label>
						<Textarea
							id="contrapropuesta-nota"
							value={nota}
							onChange={(e) => setNota(e.target.value)}
							rows={2}
							maxLength={1000}
						/>
					</div>
					<AlertDialogFooter>
						<AlertDialogCancel>Volver</AlertDialogCancel>
						<Button
							type="button"
							size="sm"
							variant={conf?.variante ?? "default"}
							onClick={() => {
								if (!confirmar) return;
								onResponder?.(
									confirmar === "aceptar" ? "aceptar" : "descartar",
									nota.trim(),
								);
								setConfirmar(null);
							}}
						>
							{conf?.boton}
						</Button>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</CrmCard>
	);
}

/* ── Conectado ──────────────────────────────────────────────────────────────── */

/** La contrapropuesta pendiente del caso (las mismas llaves que el Workspace). */
export function useContrapropuestaDelCaso(
	casoCobroId: string | null | undefined,
) {
	return useQuery({
		...orpc.getContrapropuestaPendienteDelCaso.queryOptions({
			input: { casoCobroId: casoCobroId ?? "" },
		}),
		enabled: !!casoCobroId,
		staleTime: 30_000,
	});
}

/**
 * El aviso conectado: no pinta nada si no hay contrapropuesta pendiente. Al
 * responder invalida la contrapropuesta, el convenio, las alertas del caso y
 * la bandeja de notificaciones.
 */
export function ContrapropuestaCaso({
	casoCobroId,
	onRespondida,
	className,
}: {
	casoCobroId: string | null | undefined;
	/** Tras aceptar o descartar (el Workspace refresca el caso). */
	onRespondida?: (accion: AccionContrapropuesta) => void;
	className?: string;
}) {
	const queryClient = useQueryClient();
	const consulta = useContrapropuestaDelCaso(casoCobroId);
	const contrapropuesta = consulta.data ?? null;

	const invalidar = () => {
		for (const queryKey of [
			orpc.getContrapropuestaPendienteDelCaso.key(),
			orpc.getContrapropuestasConvenio.key(),
			orpc.getPlanConvenio.key(),
			orpc.getConveniosListado.key(),
			orpc.getConvenioVigenteDelCaso.key(),
			orpc.getAlertaConvenioDelCaso.key(),
			orpc.getAlertasCaso.key(),
			orpc.getNotificationsByAssign.key(),
			orpc.getUnreadNotificationCount.key(),
		]) {
			queryClient.invalidateQueries({ queryKey });
		}
	};

	const responder = useMutation({
		mutationFn: (v: {
			id: string;
			accion: AccionContrapropuesta;
			nota: string;
		}) =>
			orpc.responderContrapropuesta.call({
				id: v.id,
				accion: v.accion,
				nota: v.nota || undefined,
			}),
		onSuccess: (_r, v) => {
			toast.success(
				v.accion === "aceptar"
					? "Plan aceptado: el convenio sigue pendiente de aprobación con el nuevo plan."
					: contrapropuesta?.puedeAceptar === false
						? "Contrapropuesta retirada."
						: "Contrapropuesta descartada: el supervisor decide con el plan original.",
				{ duration: 8000 },
			);
			invalidar();
			onRespondida?.(v.accion);
		},
		onError: (error: Error) => {
			toast.error(error.message || "No se pudo responder la contrapropuesta", {
				duration: 8000,
			});
			// Pudo quedar sin efecto o ya respondida: la vista se pone al día.
			invalidar();
		},
	});

	if (!contrapropuesta) return null;
	return (
		<ContrapropuestaAvisoVista
			className={className}
			datos={vistaDeContrapropuesta(contrapropuesta)}
			enviando={
				responder.isPending ? (responder.variables?.accion ?? null) : null
			}
			onResponder={(accion, nota) =>
				responder.mutate({ id: contrapropuesta.id, accion, nota })
			}
		/>
	);
}

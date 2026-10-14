/**
 * Aprobar o rechazar una rebaja de mora (W2), un escalado a Jurídico (W3) o
 * una solicitud de documento (F6) desde el Espacio de aprobación. Mismo patrón
 * que los modales de decisión de siempre (`DecisionInmovilizacionModal`,
 * `DecidirSolicitudDialog`): confirma la decisión, pide la nota cuando hace
 * falta y muestra la respuesta del servidor.
 *
 *  - `DecidirSolicitudVista`: solo presentación (la usa el showcase).
 *  - `DecidirSolicitudModal`: el modal conectado a los procedimientos.
 *
 * La regla de cuatro ojos y los estados que se pueden decidir los valida el
 * servidor; el Espacio solo no ofrece decidir lo propio.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { FieldMessage } from "@/components/ui/field-message";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { orpc, orpcAparte } from "@/utils/orpc";
import { quetzales } from "./piezas";

export type TipoDecisionSimple = "rebaja" | "juridico" | "documentos";
export type DecisionSimple = "aprobar" | "rechazar";

/** Mínimo de la nota al rechazar (lo exige el servidor en rebaja y Jurídico). */
export const MINIMO_NOTA_RECHAZO: Record<TipoDecisionSimple, number> = {
	rebaja: 10,
	juridico: 10,
	documentos: 0,
};
/** Igual que el esquema de los tres procedimientos. */
export const MAXIMO_NOTA_DECISION = 1000;

/** Lo que pasó después de llamar al servidor. */
export type SalidaDecision =
	| {
			tipo: "decidida";
			decision: "aprobada" | "rechazada";
			descripcion?: string;
	  }
	| { tipo: "ofrecer_rechazo"; mensaje: string }
	| { tipo: "error"; mensaje: string };

/**
 * Lee el error del servidor. Algunos cierran la solicitud aunque respondan con
 * error (cartera la rechazó o ya la había aplicado): el panel pasa a
 * «Resuelto». Si al aprobar una rebaja la mora ya no alcanza (o el crédito
 * cambió de estado), el servidor pide rechazarla: se ofrece hacerlo ahí mismo.
 */
export function salidaDeError(
	tipo: TipoDecisionSimple,
	decision: DecisionSimple,
	error: { code?: unknown; message?: string } | null | undefined,
): SalidaDecision {
	const mensaje = error?.message?.trim() || "No se pudo registrar la decisión.";
	if (/quedó rechazad[ao]/i.test(mensaje)) {
		return { tipo: "decidida", decision: "rechazada", descripcion: mensaje };
	}
	if (/(quedó|se marcó) como aplicada/i.test(mensaje)) {
		return { tipo: "decidida", decision: "aprobada", descripcion: mensaje };
	}
	if (
		tipo !== "documentos" &&
		decision === "aprobar" &&
		error?.code === "CONFLICT" &&
		/rechácel[ao]/i.test(mensaje)
	) {
		return { tipo: "ofrecer_rechazo", mensaje };
	}
	return { tipo: "error", mensaje };
}

/* ── Textos ─────────────────────────────────────────────────────────────────── */

const TITULO: Record<TipoDecisionSimple, Record<DecisionSimple, string>> = {
	rebaja: {
		aprobar: "Aprobar la rebaja de mora",
		rechazar: "Rechazar la rebaja de mora",
	},
	juridico: {
		aprobar: "Aprobar el escalado a Jurídico",
		rechazar: "Rechazar el escalado a Jurídico",
	},
	documentos: {
		aprobar: "Aprobar la solicitud de documento",
		rechazar: "Rechazar la solicitud de documento",
	},
};

function descripcionDe(
	tipo: TipoDecisionSimple,
	decision: DecisionSimple,
	quien: string,
	reintento: boolean,
) {
	if (decision === "rechazar") {
		return tipo === "documentos"
			? `La solicitud de ${quien} queda rechazada con su nota.`
			: `La solicitud de ${quien} se cierra y se avisa al asesor con su nota.`;
	}
	switch (tipo) {
		case "rebaja":
			return reintento
				? `Se vuelve a pedir a cartera la rebaja de ${quien}. Cartera no descuenta dos veces la misma solicitud.`
				: `Antes de aplicarla se vuelve a leer la mora de ${quien} en cartera: si ya no alcanza, no se aprueba y podrá rechazarla.`;
		case "juridico":
			return reintento
				? `Se vuelve a pedir a cartera el escalado de ${quien}.`
				: `${quien} pasa a B5 en estado En Jurídico y sale de la cartera del asesor (se asigna a otro asesor del pool de B5).`;
		case "documentos":
			return `La solicitud de ${quien} queda aprobada con su nota. La entrega del documento se coordina aparte.`;
	}
}

const BOTON: Record<TipoDecisionSimple, string> = {
	rebaja: "Aprobar rebaja",
	juridico: "Aprobar y enviar a Jurídico",
	documentos: "Aprobar",
};

/* ── Vista ──────────────────────────────────────────────────────────────────── */

export type DecidirSolicitudVistaProps = {
	tipo: TipoDecisionSimple;
	decision: DecisionSimple;
	/** «Carlos Mendoza (crédito 0101…)». */
	quien: string;
	/** Lo que se decide, en una línea («Rebaja de Q 500.00 sobre Q 1,200.00 de mora»). */
	resumen?: string | null;
	/** Rebaja o escalado que cartera no pudo aplicar: aprobar es reintentar. */
	reintento?: boolean;
	nota: string;
	onNota: (nota: string) => void;
	/** Mensaje del servidor que pide rechazar (la mora ya no alcanza…). */
	ofrecerRechazo?: string | null;
	onPasarARechazo?: () => void;
	errorServidor?: string | null;
	pendiente: boolean;
	onCancelar: () => void;
	onConfirmar: () => void;
};

export function DecidirSolicitudVista(p: DecidirSolicitudVistaProps) {
	const notaId = React.useId();
	const aprobar = p.decision === "aprobar";
	const minimo = aprobar ? 0 : MINIMO_NOTA_RECHAZO[p.tipo];
	const largo = p.nota.trim().length;
	const errorNota =
		largo > MAXIMO_NOTA_DECISION
			? `La nota no puede pasar de ${MAXIMO_NOTA_DECISION} caracteres.`
			: largo < minimo
				? `La nota del rechazo necesita al menos ${minimo} caracteres: es lo que va a leer el asesor.`
				: null;
	return (
		<>
			<DialogHeader>
				<DialogTitle>{TITULO[p.tipo][p.decision]}</DialogTitle>
				<DialogDescription>
					{descripcionDe(p.tipo, p.decision, p.quien, !!p.reintento)}
				</DialogDescription>
			</DialogHeader>

			{p.resumen ? (
				<p className="wrap-break-word rounded-lg bg-muted px-3 py-2.5 text-[13px] text-fg-secondary leading-snug">
					{p.resumen}
				</p>
			) : null}

			<div className="flex flex-col gap-1.5">
				<Label htmlFor={notaId}>
					{aprobar
						? "Nota (opcional)"
						: minimo > 0
							? "Motivo del rechazo"
							: "Motivo del rechazo (opcional)"}
				</Label>
				<Textarea
					id={notaId}
					rows={3}
					value={p.nota}
					disabled={p.pendiente}
					aria-invalid={!!errorNota && largo > 0}
					placeholder={
						aprobar
							? "Queda guardada con la aprobación…"
							: "Explique al asesor por qué se rechaza…"
					}
					onChange={(e) => p.onNota(e.target.value)}
				/>
				<p className="type-caption text-fg-tertiary">
					{minimo > 0
						? `Mínimo ${minimo} caracteres (${largo}/${MAXIMO_NOTA_DECISION}).`
						: `${largo}/${MAXIMO_NOTA_DECISION} caracteres.`}
				</p>
				{errorNota && largo > 0 ? (
					<FieldMessage variant="help">{errorNota}</FieldMessage>
				) : null}
			</div>

			{p.ofrecerRechazo ? (
				<div
					role="alert"
					className="flex flex-col gap-2 rounded-lg bg-warning-subtle px-3 py-2.5 text-[13px] text-warning-text leading-snug"
				>
					<p className="wrap-break-word">{p.ofrecerRechazo}</p>
					{p.onPasarARechazo ? (
						<div>
							<Button
								type="button"
								variant="secondary"
								size="sm"
								onClick={p.onPasarARechazo}
							>
								Rechazar la solicitud
							</Button>
						</div>
					) : null}
				</div>
			) : p.errorServidor ? (
				<FieldMessage role="alert">{p.errorServidor}</FieldMessage>
			) : null}

			<DialogFooter>
				<Button
					type="button"
					variant="outline"
					disabled={p.pendiente}
					onClick={p.onCancelar}
				>
					Cancelar
				</Button>
				<Button
					type="button"
					variant={aprobar ? "default" : "destructive"}
					loading={p.pendiente}
					disabled={p.pendiente || !!errorNota}
					onClick={p.onConfirmar}
				>
					{aprobar
						? p.reintento
							? "Reintentar aplicación"
							: BOTON[p.tipo]
						: "Rechazar"}
				</Button>
			</DialogFooter>
		</>
	);
}

/* ── Conectado ──────────────────────────────────────────────────────────────── */

export type DecidirSolicitudModalProps = {
	tipo: TipoDecisionSimple;
	solicitudId: string;
	/** Decisión con la que se abre (el modal puede pasar a rechazar). */
	decision: DecisionSimple;
	quien: string;
	resumen?: string | null;
	reintento?: boolean;
	/** Las «Notas del supervisor» del Espacio. */
	notaInicial?: string;
	onOpenChange: (abierto: boolean) => void;
	/** Solo cuando la solicitud quedó cerrada (por esta decisión o por cartera). */
	onDecidido: (
		decision: "aprobada" | "rechazada",
		descripcion?: string,
	) => void;
};

/** Montos de la respuesta de la rebaja («1200.00» → «Q 1,200.00»). */
function moraNuevaTexto(mora: string | undefined) {
	return mora ? `La mora del crédito quedó en ${quetzales(mora)}.` : null;
}

export function DecidirSolicitudModal({
	tipo,
	solicitudId,
	decision: decisionInicial,
	quien,
	resumen,
	reintento,
	notaInicial,
	onOpenChange,
	onDecidido,
}: DecidirSolicitudModalProps) {
	const queryClient = useQueryClient();
	const [decision, setDecision] = React.useState(decisionInicial);
	const [nota, setNota] = React.useState(notaInicial ?? "");
	const [salida, setSalida] = React.useState<SalidaDecision | null>(null);

	const decidir = useMutation({
		mutationFn: async (): Promise<SalidaDecision> => {
			const notaLimpia = nota.trim() || undefined;
			if (tipo === "rebaja") {
				const r = await orpc.decidirSolicitudRebajaMora.call({
					solicitudId,
					decision,
					nota: notaLimpia,
				});
				return r.decision === "aplicada"
					? {
							tipo: "decidida",
							decision: "aprobada",
							descripcion: [
								"Cartera aplicó la rebaja.",
								moraNuevaTexto(r.moraNueva),
								"Se avisó al asesor.",
							]
								.filter(Boolean)
								.join(" "),
						}
					: { tipo: "decidida", decision: "rechazada" };
			}
			if (tipo === "juridico") {
				const r = await orpc.decidirSolicitudJuridico.call({
					solicitudId,
					decision,
					nota: notaLimpia,
				});
				return {
					tipo: "decidida",
					decision: r.decision === "aplicada" ? "aprobada" : "rechazada",
				};
			}
			await orpcAparte.resolverSolicitudDocumento.call({
				solicitudId,
				decision: decision === "aprobar" ? "aprobada" : "rechazada",
				nota: notaLimpia,
			});
			return {
				tipo: "decidida",
				decision: decision === "aprobar" ? "aprobada" : "rechazada",
			};
		},
		retry: false,
		onSuccess: (r) => {
			if (r.tipo !== "decidida") return;
			toast.success(
				r.decision === "aprobada"
					? "Solicitud aprobada"
					: "Solicitud rechazada",
			);
			onDecidido(r.decision, r.descripcion);
			onOpenChange(false);
		},
		onError: (e: Error & { code?: unknown }) => {
			const s = salidaDeError(tipo, decision, e);
			if (s.tipo === "decidida") {
				toast.info(s.descripcion ?? "La solicitud ya estaba resuelta.");
				onDecidido(s.decision, s.descripcion);
				onOpenChange(false);
				return;
			}
			setSalida(s);
		},
		onSettled: () => {
			// Aunque falle (otro supervisor decidió, quedó en error de aplicación…),
			// la bandeja y el Dashboard tienen que reflejar el estado real.
			const llaves =
				tipo === "rebaja"
					? [
							orpc.getSolicitudesRebajaMora.key(),
							orpc.getSolicitudesRebajaMoraDelCaso.key(),
							orpc.getDetallesCreditoCarteraBack.key(),
						]
					: tipo === "juridico"
						? [
								orpc.getSolicitudesJuridico.key(),
								orpc.getSolicitudesJuridicoDelCaso.key(),
								orpc.getBucketActualCredito.key(),
								orpc.getDetallesCreditoCarteraBack.key(),
							]
						: [orpcAparte.getSolicitudesDocumentos.key()];
			for (const queryKey of llaves) {
				void queryClient.invalidateQueries({ queryKey });
			}
		},
	});

	return (
		<Dialog open onOpenChange={(v) => !decidir.isPending && onOpenChange(v)}>
			<DialogContent className="sm:max-w-lg">
				<DecidirSolicitudVista
					tipo={tipo}
					decision={decision}
					quien={quien}
					resumen={resumen}
					reintento={reintento}
					nota={nota}
					onNota={(v) => {
						setNota(v);
						if (salida?.tipo === "error") setSalida(null);
					}}
					ofrecerRechazo={
						salida?.tipo === "ofrecer_rechazo" ? salida.mensaje : null
					}
					onPasarARechazo={() => {
						setSalida(null);
						setDecision("rechazar");
					}}
					errorServidor={salida?.tipo === "error" ? salida.mensaje : null}
					pendiente={decidir.isPending}
					onCancelar={() => onOpenChange(false)}
					onConfirmar={() => {
						setSalida(null);
						decidir.mutate();
					}}
				/>
			</DialogContent>
		</Dialog>
	);
}

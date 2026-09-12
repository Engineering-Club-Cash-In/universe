/**
 * CB-033 — Aprobar o rechazar un convenio pendiente de aprobación.
 *
 * Un solo componente parametrizado por `decision` (aprobar | rechazar),
 * siguiendo el patrón de ConvenioModal: un modal, dos variantes de UI según
 * la decisión.
 *
 * El `operacionId` es la clave de la idempotencia — se genera al abrir el
 * modal (no al confirmar) y se persiste en `localStorage` (vía
 * decision-intentos.ts) ANTES de disparar la llamada. Si la respuesta se
 * pierde (timeout, cierre de pestaña), el mismo id se reusa al reintentar:
 * cartera responde con el resultado original en vez de duplicar el efecto.
 * Generarlo en el server, o uno nuevo por click, no protegería nada — cada
 * intento del usuario sería una operación distinta.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader } from "lucide-react";
import { useEffect, useState } from "react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
	borrarIntentoPendiente,
	type ConvenioDecisionResumen,
	errorPruebaQueNoSeAplico,
	leerIntentoPendiente,
	reservarIntentoPendiente,
} from "@/lib/cobros/decision-intentos";
import { client, orpc } from "@/utils/orpc";

interface ConvenioAprobacionModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	decision: "aprobar" | "rechazar";
	convenioId: number;
	userId: string;
	resumen: ConvenioDecisionResumen;
	onResuelto?: () => void;
}

/**
 * Otra pestaña dejó una decisión distinta esperando confirmación. No es un
 * fallo de red ni de negocio: es un cruce entre pestañas, y corta el envío
 * antes de que un botón ejecute la decisión equivocada.
 */
class ConflictoDecisionPendiente extends Error {
	constructor(readonly decisionPendiente: "aprobado" | "rechazado") {
		super(
			decisionPendiente === "rechazado"
				? "Hay un RECHAZO de este convenio esperando confirmación (probablemente desde otra pestaña). No se envió nada: revisá el aviso de decisiones por confirmar."
				: "Hay una APROBACIÓN de este convenio esperando confirmación (probablemente desde otra pestaña). No se envió nada: revisá el aviso de decisiones por confirmar.",
		);
		this.name = "ConflictoDecisionPendiente";
	}
}

/** Forma real de `decidirConvenio` (routers/cobros.ts). */
interface ResultadoDecision {
	decisionId: number;
	convenioId: number;
	creditoId: number;
	decision: "aprobado" | "rechazado";
	idempotente: boolean;
}

export function ConvenioAprobacionModal({
	open,
	onOpenChange,
	decision,
	convenioId,
	userId,
	resumen,
	onResuelto,
}: ConvenioAprobacionModalProps) {
	const queryClient = useQueryClient();
	const [motivo, setMotivo] = useState("");
	const esRechazo = decision === "rechazar";

	// Intento de una confirmación anterior que quedó sin respuesta (timeout,
	// pestaña cerrada). Si existe, este modal NO es una decisión nueva: es el
	// reenvío de ESA, y el payload queda congelado — el `operacion_id` viaja
	// con un fingerprint del contenido, así que reenviarlo con un motivo
	// distinto da 409 y pierde el rastro del original en vez de recuperarlo.
	const [intentoPrevio] = useState(() =>
		leerIntentoPendiente(userId, convenioId),
	);
	const esReenvio = intentoPrevio !== null;

	const [operacionId] = useState(
		() => intentoPrevio?.operacionId ?? crypto.randomUUID(),
	);

	// En un reenvío el motivo es el que se mandó la primera vez (se muestra,
	// no se edita). En una decisión nueva arranca vacío cada apertura.
	useEffect(() => {
		if (open) setMotivo(intentoPrevio?.motivo ?? "");
	}, [open, intentoPrevio]);

	const mutation = useMutation({
		mutationFn: async (): Promise<
			ResultadoDecision & { operacionIdUsado: string }
		> => {
			// Payload propuesto: en un reenvío es EXACTAMENTE el guardado; en
			// el primer intento sale del formulario.
			const propuesto = {
				operacionId,
				convenioId,
				decision: esReenvio
					? intentoPrevio.decision
					: esRechazo
						? ("rechazado" as const)
						: ("aprobado" as const),
				motivo: esReenvio
					? intentoPrevio.motivo
					: esRechazo
						? motivo.trim()
						: null,
				creadoEn: intentoPrevio?.creadoEn ?? new Date().toISOString(),
				resumen: intentoPrevio?.resumen ?? resumen,
			};

			// Se reserva ANTES de disparar: si la respuesta nunca llega, esto
			// es lo único que le queda al usuario para saber qué pasó.
			const reserva = await reservarIntentoPendiente(userId, propuesto);

			// Otra pestaña reservó una decisión DISTINTA mientras este modal
			// estaba abierto. NO se envía: podría ser un rechazo mientras el
			// usuario apretó "Aprobar", y mandarlo borraría el convenio sin
			// que nadie lo pidiera. Se corta acá y el banner muestra cuál es
			// la decisión pendiente para que la reenvíe explícitamente.
			if (reserva.estado === "conflicto") {
				throw new ConflictoDecisionPendiente(reserva.intento.decision);
			}

			const vigente = reserva.intento;
			const resultado = (await client.decidirConvenio({
				convenioId,
				decision: vigente.decision,
				motivo: vigente.motivo ?? undefined,
				operacionId: vigente.operacionId,
			})) as ResultadoDecision;
			// El id realmente usado viaja al callback: es con el que hay que
			// borrar, no con el del estado del modal (pueden diferir si otra
			// pestaña había reservado antes).
			return { ...resultado, operacionIdUsado: vigente.operacionId };
		},
		onSuccess: (r) => {
			// Confirmada (éxito, o idempotente = cartera ya la había resuelto
			// antes) — el intento cumplió su propósito. Se borra solo si sigue
			// siendo el mismo: otra pestaña pudo haber reservado uno nuevo.
			void borrarIntentoPendiente(userId, convenioId, r.operacionIdUsado);
			toast.success(
				r.decision === "aprobado"
					? "Convenio aprobado."
					: "Convenio rechazado: se eliminó y se recalculó la mora del crédito.",
				{ duration: 6000 },
			);
			// Invalida TODAS las instancias del listado (otras pantallas, otros
			// filtros), no solo la de quien abrió el modal. El `refetch` que hace
			// `onResuelto` es lo que recarga ESTA vista — son cosas distintas, y
			// TanStack deduplica si terminan pidiendo lo mismo.
			queryClient.invalidateQueries({
				queryKey: orpc.getConveniosListado.key(),
			});
			onResuelto?.();
			onOpenChange(false);
		},
		onError: (error: unknown) => {
			// Cruce entre pestañas: no se envió NADA y el intento de la otra
			// pestaña queda intacto. Solo se avisa y se cierra para que el
			// usuario lo reenvíe desde el banner, viendo cuál es.
			if (error instanceof ConflictoDecisionPendiente) {
				toast.warning(error.message, { duration: 10000 });
				onResuelto?.();
				onOpenChange(false);
				return;
			}

			// El intento SOLO se descarta si el error prueba que la decisión no
			// se aplicó (código de negocio definitivo). Ante cualquier
			// resultado incierto —5xx, timeout, red caída, sesión vencida—
			// sobrevive: es el caso que el banner existe para recuperar.
			const noSeAplico = errorPruebaQueNoSeAplico(error);
			if (noSeAplico) {
				void borrarIntentoPendiente(userId, convenioId, operacionId);
			}
			const mensaje =
				(error as { message?: string } | null)?.message ??
				"No se pudo procesar la decisión";
			toast.error(
				noSeAplico
					? mensaje
					: `${mensaje}. No se pudo confirmar si se aplicó: usá "Reenviar" en el aviso de arriba para verificarlo.`,
				{ duration: 8000 },
			);
			onResuelto?.();
			onOpenChange(false);
		},
	});

	// En un reenvío el motivo ya está fijado y validado desde el intento
	// original; el formulario solo lo muestra.
	const motivoValido = esReenvio || !esRechazo || motivo.trim().length >= 5;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{esRechazo
							? "Rechazar convenio de pago"
							: "Aprobar convenio de pago"}
					</DialogTitle>
					<DialogDescription>
						{resumen.clienteNombre && <>{resumen.clienteNombre} · </>}
						{resumen.numeroCreditoSifco}
						{resumen.montoTotalConvenio && (
							<>
								{" "}
								· Q
								{Number(resumen.montoTotalConvenio).toLocaleString("es-GT", {
									minimumFractionDigits: 2,
								})}
							</>
						)}
					</DialogDescription>
				</DialogHeader>

				{esReenvio && (
					<div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-800 text-sm">
						<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
						<span>
							Ya se envió esta decisión y no se pudo confirmar el resultado. Al
							reenviar se manda <strong>exactamente la misma</strong>: si
							cartera ya la aplicó, te devuelve lo que pasó sin repetir el
							efecto. Por eso no se puede cambiar el motivo acá.
						</span>
					</div>
				)}

				{esRechazo ? (
					<div className="space-y-3">
						{!esReenvio && (
							<div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-800 text-sm">
								<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
								<span>
									Esta acción <strong>elimina el convenio</strong> y{" "}
									<strong>recalcula la mora</strong> del crédito con las cuotas
									vencidas reales. No se puede deshacer.
								</span>
							</div>
						)}
						<div className="space-y-2">
							<Label htmlFor="motivo-rechazo">
								{esReenvio
									? "Motivo enviado"
									: "Motivo del rechazo (obligatorio)"}
							</Label>
							<Textarea
								id="motivo-rechazo"
								value={motivo}
								onChange={(e) => setMotivo(e.target.value)}
								placeholder="Explicá por qué se rechaza este convenio (mínimo 5 caracteres)"
								rows={3}
								readOnly={esReenvio}
								className={esReenvio ? "bg-muted" : undefined}
							/>
							{!esReenvio &&
								motivo.trim().length > 0 &&
								motivo.trim().length < 5 && (
									<p className="text-destructive text-xs">
										El motivo debe tener al menos 5 caracteres.
									</p>
								)}
						</div>
					</div>
				) : (
					<p className="text-muted-foreground text-sm">
						El convenio pasa a activo. El cliente empieza a pagar la cuota del
						convenio junto con la cuota normal desde el próximo ciclo.
					</p>
				)}

				<DialogFooter>
					<Button
						variant="outline"
						onClick={() => onOpenChange(false)}
						disabled={mutation.isPending}
					>
						Cancelar
					</Button>
					<Button
						className={
							esRechazo ? "bg-red-600 text-white hover:bg-red-700" : undefined
						}
						onClick={() => mutation.mutate()}
						disabled={mutation.isPending || !motivoValido}
					>
						{mutation.isPending ? (
							<>
								<Loader className="mr-1 h-4 w-4 animate-spin" />
								Procesando...
							</>
						) : esReenvio ? (
							"Reenviar y ver resultado"
						) : esRechazo ? (
							"Confirmar rechazo"
						) : (
							"Confirmar aprobación"
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

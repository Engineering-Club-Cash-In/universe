/**
 * CB-033 — Historial de aprobaciones/rechazos de convenio de un crédito.
 *
 * Se consulta por CASO (el server resuelve el crédito y valida el acceso con
 * `assertAccesoCasoCobro`), no por convenio: el rechazo BORRA la fila de
 * `convenios_pago`, así que preguntar por `convenio_id` perdería justo el
 * historial del caso que hay que auditar. Por eso este bloque se muestra
 * aunque el crédito ya no tenga convenio vigente.
 */

import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import {
	HistorialGestiones,
	SeccionHistorial,
} from "@/components/cobros/ficha/ficha-pestanas";
import { Badge } from "@/components/ui/badge";
import { orpc } from "@/utils/orpc";

interface ConvenioDecision {
	decisionId: number;
	convenioId: number;
	decision: "aprobado" | "rechazado";
	motivo: string | null;
	origen: "crm" | "cartera_front";
	decididoPorEmail: string;
	decididoEn: string;
	snapshot?: {
		monto_total_convenio?: string;
		numero_meses?: number;
	} | null;
}

function fechaHoraLegible(iso: string) {
	const d = new Date(iso);
	return d.toLocaleString("es-GT", {
		day: "2-digit",
		month: "2-digit",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function montoLegible(valor?: string) {
	if (!valor) return null;
	return `Q${Number(valor).toLocaleString("es-GT", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})}`;
}

export function ConvenioDecisionesHistorial({
	casoCobroId,
}: {
	casoCobroId: string;
}) {
	const { data, isPending, isError, isFetching, refetch } = useQuery({
		...orpc.getDecisionesConvenio.queryOptions({ input: { casoCobroId } }),
		enabled: !!casoCobroId,
	});

	const decisiones = (data ?? []) as ConvenioDecision[];

	// Un fallo NO se muestra como "sin historial": en una pantalla de
	// auditoría hay que poder distinguir "este crédito nunca tuvo
	// decisiones" de "no se pudieron consultar", y poder reintentar.
	// Sin decisiones no se pinta nada: el crédito nunca tuvo un convenio que
	// alguien haya aprobado o rechazado.
	if (!isError && (isPending || decisiones.length === 0)) return null;

	return (
		<SeccionHistorial
			titulo="Aprobaciones del convenio"
			conteo={decisiones.length}
			icono={<History />}
			descripcion="Decisiones sobre los convenios de este crédito. Se conservan aunque el convenio haya sido eliminado por un rechazo."
			estado={isError ? "error" : "ok"}
			onReintentar={isFetching ? undefined : () => refetch()}
		>
			<HistorialGestiones
				items={decisiones.map((d) => {
					const rechazado = d.decision === "rechazado";
					const monto = montoLegible(d.snapshot?.monto_total_convenio);
					return {
						id: String(d.decisionId),
						cuando: fechaHoraLegible(d.decididoEn),
						titulo: monto
							? `Convenio por ${monto}${d.snapshot?.numero_meses ? ` · ${d.snapshot.numero_meses} meses` : ""}`
							: "Convenio de pago",
						badge: (
							<span className="inline-flex items-center gap-1.5">
								<Badge
									className={
										rechazado
											? "bg-red-100 text-red-800"
											: "bg-green-100 text-green-800"
									}
								>
									{rechazado ? "Rechazado" : "Aprobado"}
								</Badge>
								{d.origen === "cartera_front" && (
									<Badge variant="outline" className="text-[10px]">
										desde cartera
									</Badge>
								)}
							</span>
						),
						subtitulo: `Por: ${d.decididoPorEmail}`,
						tono: rechazado ? "fallido" : "logrado",
						nota: d.motivo ? `Motivo: ${d.motivo}` : null,
					};
				})}
			/>
		</SeccionHistorial>
	);
}

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
import { CheckCircle2, History, Loader2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
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
	if (isError) {
		return (
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<History className="h-5 w-5" />
						Historial de aprobaciones
					</CardTitle>
					<CardDescription>
						No se pudo cargar el historial de decisiones de este crédito.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Button
						variant="outline"
						size="sm"
						onClick={() => refetch()}
						disabled={isFetching}
					>
						{isFetching ? (
							<>
								<Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
								Reintentando...
							</>
						) : (
							"Reintentar"
						)}
					</Button>
				</CardContent>
			</Card>
		);
	}

	// Sin decisiones no se pinta nada: el crédito nunca tuvo un convenio que
	// alguien haya aprobado o rechazado.
	if (isPending || decisiones.length === 0) return null;

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<History className="h-5 w-5" />
					Historial de aprobaciones
				</CardTitle>
				<CardDescription>
					Decisiones sobre los convenios de este crédito. Se conservan aunque el
					convenio haya sido eliminado por un rechazo.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				{decisiones.map((d) => {
					const rechazado = d.decision === "rechazado";
					const monto = montoLegible(d.snapshot?.monto_total_convenio);
					return (
						<div
							key={d.decisionId}
							className="flex items-start gap-3 rounded-lg border p-3"
						>
							{rechazado ? (
								<XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
							) : (
								<CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
							)}
							<div className="min-w-0 flex-1 space-y-1">
								<div className="flex flex-wrap items-center gap-2">
									<Badge
										className={
											rechazado
												? "bg-red-100 text-red-800"
												: "bg-green-100 text-green-800"
										}
									>
										{rechazado ? "Rechazado" : "Aprobado"}
									</Badge>
									{monto && (
										<span className="text-muted-foreground text-xs">
											Convenio por {monto}
											{d.snapshot?.numero_meses
												? ` · ${d.snapshot.numero_meses} meses`
												: ""}
										</span>
									)}
									{d.origen === "cartera_front" && (
										<Badge variant="outline" className="text-[10px]">
											desde cartera
										</Badge>
									)}
								</div>
								<p className="text-muted-foreground text-xs">
									{d.decididoPorEmail} · {fechaHoraLegible(d.decididoEn)}
								</p>
								{d.motivo && (
									<p className="text-sm">
										<span className="font-medium">Motivo:</span> {d.motivo}
									</p>
								)}
							</div>
						</div>
					);
				})}
			</CardContent>
		</Card>
	);
}

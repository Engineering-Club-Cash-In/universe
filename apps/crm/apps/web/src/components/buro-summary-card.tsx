import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { RenapBuroValidation } from "@/components/analysis/RenapBuroValidation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { client, orpc } from "@/utils/orpc";

type ResultadoBuro = "aprobado" | "rechazado" | "sin_registro" | "error";
type EstadoResumen =
	| "pendiente"
	| "completado"
	| "error"
	| "vencido"
	| "desactualizado";

function ResultadoBadge({ resultado }: { resultado: ResultadoBuro | null }) {
	if (!resultado) return null;
	if (resultado === "aprobado") {
		return (
			<Badge className="bg-green-100 text-green-800 hover:bg-green-100">
				Aprobado
			</Badge>
		);
	}
	if (resultado === "rechazado") {
		return <Badge variant="destructive">Rechazado</Badge>;
	}
	if (resultado === "sin_registro") {
		return (
			<Badge
				variant="outline"
				className="border-blue-300 bg-blue-100 text-blue-800 hover:bg-blue-100"
			>
				Sin registro
			</Badge>
		);
	}
	return (
		<Badge
			variant="outline"
			className="border-orange-300 bg-orange-100 text-orange-800 hover:bg-orange-100"
		>
			Error
		</Badge>
	);
}

function EstadoResumenBadge({
	estado,
	resultado,
}: {
	estado: EstadoResumen;
	resultado: ResultadoBuro | null;
}) {
	if (estado === "pendiente")
		return <Badge variant="secondary">Pendiente</Badge>;
	if (estado === "vencido") return <Badge variant="secondary">Vencido</Badge>;
	if (estado === "desactualizado")
		return <Badge variant="secondary">DPI desactualizado</Badge>;
	return <ResultadoBadge resultado={resultado} />;
}

export function BuroSummaryCard({
	opportunityId,
	open,
	userRole,
}: {
	opportunityId: string;
	open: boolean;
	userRole: string;
}) {
	const [detalleAbierto, setDetalleAbierto] = useState(false);
	const [validacionAutomaticaEnCurso, setValidacionAutomaticaEnCurso] =
		useState(false);
	const [validacionDetalleEnCurso, setValidacionDetalleEnCurso] =
		useState(false);
	const consultasIniciadas = useRef(new Set<string>());
	const consultaAutomaticaEnCurso = useRef(false);
	const resumenBuroQuery = useQuery({
		...orpc.getResumenBuroOportunidad.queryOptions({
			input: { opportunityId },
		}),
		enabled: open,
		refetchInterval: open ? 15_000 : false,
	});
	const resumen = resumenBuroQuery.data;
	const resumenActualizadoEn = resumenBuroQuery.dataUpdatedAt;
	const refetchResumenBuro = resumenBuroQuery.refetch;
	const permitirReejecucion = resumen?.permitirReejecucion ?? false;
	useEffect(() => {
		if (resumenActualizadoEn === 0 || !open || !resumen) return;
		const pendientes = ["pendiente", "vencido", "desactualizado"];
		const titularPendiente =
			!resumen.faltaDpi && pendientes.includes(resumen.titular);
		const cofirmantesPendientes = resumen.cofirmantes.some((cofirmante) =>
			pendientes.includes(cofirmante.estado),
		);
		if (!titularPendiente && !cofirmantesPendientes) {
			consultasIniciadas.current.clear();
			return;
		}
		if (
			consultaAutomaticaEnCurso.current ||
			validacionDetalleEnCurso ||
			!resumen.permitirReejecucion ||
			resumen.exento ||
			resumen.faltaConsentimiento
		)
			return;
		const clave = `${opportunityId}:${resumen.titular}:${resumen.cofirmantes.map((cofirmante) => `${cofirmante.id}:${cofirmante.estado}`).join(",")}`;
		if (consultasIniciadas.current.has(clave)) return;
		consultasIniciadas.current.add(clave);
		consultaAutomaticaEnCurso.current = true;
		setValidacionAutomaticaEnCurso(true);
		void client
			.asegurarBuroOportunidad({ opportunityId })
			// Libera la guarda con el resumen ya actualizado, no con uno parcial.
			.then(() => refetchResumenBuro())
			.catch((error) => {
				consultasIniciadas.current.delete(clave);
				console.error("No se pudo iniciar Buró", error);
			})
			.finally(() => {
				consultaAutomaticaEnCurso.current = false;
				setValidacionAutomaticaEnCurso(false);
			});
	}, [
		open,
		opportunityId,
		resumen,
		resumenActualizadoEn,
		refetchResumenBuro,
		validacionDetalleEnCurso,
	]);

	return (
		<>
			<div className="space-y-2 rounded-lg border bg-muted/30 p-4 text-sm">
				<div className="flex items-start justify-between gap-3">
					<p className="font-semibold">Revisión de Buró (Infornet)</p>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => setDetalleAbierto(true)}
					>
						Ver
					</Button>
				</div>
				{resumenBuroQuery.isPending ? (
					<p>Consultando estado...</p>
				) : resumenBuroQuery.isError ? (
					<p>No se pudo consultar el estado de Buró.</p>
				) : resumen?.exento ? (
					<p>Validación cubierta por el flujo de WhatsApp.</p>
				) : resumen?.faltaConsentimiento ? (
					<p>Falta cargar la cláusula de consentimiento.</p>
				) : (
					<>
						{resumen?.faltaDpi ? (
							<p>Falta guardar el número de DPI del titular.</p>
						) : (
							<div className="flex flex-wrap items-center gap-2">
								<span>Titular: {resumen?.titularNombre ?? "Sin nombre"}</span>
								{resumen && (
									<EstadoResumenBadge
										estado={resumen.titular}
										resultado={resumen.titularResultado}
									/>
								)}
							</div>
						)}
						{resumen?.cofirmantes.map((cofirmante) => (
							<div
								key={cofirmante.id}
								className="flex flex-wrap items-center gap-2"
							>
								<span>Cofirmante {cofirmante.nombre}</span>
								<EstadoResumenBadge
									estado={cofirmante.estado}
									resultado={cofirmante.resultado}
								/>
							</div>
						))}
					</>
				)}
			</div>
			<Dialog open={detalleAbierto} onOpenChange={setDetalleAbierto}>
				<DialogContent className="max-h-[90vh] w-[95vw] max-w-[95vw] overflow-y-auto overflow-x-hidden sm:max-w-[95vw] md:w-[850px]">
					<DialogHeader>
						<DialogTitle className="sr-only">
							Detalle de Buró (Infornet)
						</DialogTitle>
					</DialogHeader>
					{detalleAbierto && (
						<RenapBuroValidation
							opportunityId={opportunityId}
							currentUserRole={userRole}
							permitirReejecucion={permitirReejecucion}
							ejecucionExterna={validacionAutomaticaEnCurso}
							permitirValidacionManualBuro={
								resumen?.permitirValidacionManualBuro ?? false
							}
							expandirDetalleInicialmente
							actualizarAutomaticamente
							onEjecucionChange={(ejecutando) => {
								setValidacionDetalleEnCurso(ejecutando);
								if (!ejecutando) void resumenBuroQuery.refetch();
							}}
						/>
					)}
				</DialogContent>
			</Dialog>
		</>
	);
}

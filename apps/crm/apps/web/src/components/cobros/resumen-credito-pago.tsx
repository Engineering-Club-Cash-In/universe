import { AlertTriangle, BadgeCheck, Calendar } from "lucide-react";
import type {
	CarteraConvenio,
	CarteraCuotaCredito,
	CreditoDirectoResponse,
	PromesaActivaCredito,
} from "server/src/types/cartera-back";
import { Badge } from "@/components/ui/badge";

function formatQ(value: number | string | undefined | null): string {
	const num = Number(value ?? 0);
	return `Q${num.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * CB-128: réplica del MiniCardCredito de carteraFront
 * (carteraFront/src/private/cartera/components/cardInfo.tsx) con componentes
 * shadcn del CRM — mismo contenido/estructura de información, estilo propio.
 */
export function ResumenCreditoPago({
	credito: data,
	cuotaActualNumero,
	cuotaActualPagada,
	cuotaActualStatus,
	abonosTotal,
	promesaActiva,
}: {
	credito: CreditoDirectoResponse;
	cuotaActualNumero: number | undefined;
	cuotaActualPagada: boolean;
	cuotaActualStatus: string | null | undefined;
	abonosTotal: number;
	promesaActiva: PromesaActivaCredito | null | undefined;
}) {
	const { credito, usuario, cuotasAtrasadas, convenioActivo, mora } = data;
	const montoMora = Number(mora?.monto_mora ?? data.moraActual ?? 0);
	const cuotaMensual = Number(credito.cuota);

	return (
		<div className="space-y-3">
			{promesaActiva && (
				<div className="flex flex-wrap items-center justify-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-center text-sm">
					<span className="flex items-center gap-1.5 font-semibold">
						<Calendar className="h-4 w-4" />
						Promesa de Pago
					</span>
					<span className="font-medium">
						{new Date(
							`${promesaActiva.fecha_promesa}T12:00:00`,
						).toLocaleDateString("es-ES", {
							day: "2-digit",
							month: "short",
							year: "numeric",
						})}
					</span>
				</div>
			)}

			<div className="space-y-4 rounded-md border bg-muted/20 p-4">
				{/* Identificación del crédito */}
				<div className="grid grid-cols-2 gap-3">
					<div>
						<p className="text-muted-foreground text-xs">SIFCO</p>
						<p
							className="truncate font-semibold"
							title={credito.numero_credito_sifco}
						>
							{credito.numero_credito_sifco}
						</p>
					</div>
					<div>
						<p className="text-muted-foreground text-xs">Capital</p>
						<p className="font-semibold text-green-700">
							{formatQ(credito.capital)}
						</p>
					</div>
					<div className="col-span-2">
						<p className="text-muted-foreground text-xs">Usuario</p>
						<p className="truncate font-semibold" title={usuario.nombre}>
							{usuario.nombre}
						</p>
					</div>
				</div>

				<div className="space-y-3 border-t pt-3">
					{/* Estado de la cuenta */}
					<div className="grid grid-cols-2 gap-3">
						<div>
							<p className="text-muted-foreground text-xs">Cuota mensual</p>
							<p className="font-semibold">{formatQ(cuotaMensual)}</p>
						</div>
						<div>
							<p className="text-muted-foreground text-xs">Cuota actual</p>
							<div className="flex flex-wrap items-center gap-1.5 font-semibold">
								<span>#{cuotaActualNumero ?? "—"}</span>
								{cuotaActualPagada ? (
									<Badge
										variant="secondary"
										className="gap-1 text-green-700 text-xs"
									>
										<BadgeCheck className="h-3 w-3" /> Pagada
									</Badge>
								) : (
									<Badge
										variant="outline"
										className="gap-1 text-orange-600 text-xs"
									>
										<AlertTriangle className="h-3 w-3" /> Pendiente
									</Badge>
								)}
							</div>
						</div>
						<div className="col-span-2">
							<p className="text-muted-foreground text-xs">Cuotas atrasadas</p>
							<div className="flex flex-wrap items-center gap-1.5 font-semibold">
								<span
									className={cuotasAtrasadas.length > 0 ? "text-red-600" : ""}
								>
									{cuotasAtrasadas.length}
								</span>
								{montoMora > 0 && (
									<Badge variant="destructive" className="text-xs">
										Mora {formatQ(montoMora)}
									</Badge>
								)}
							</div>
						</div>
					</div>

					{cuotasAtrasadas.length > 0 && (
						<p className="text-muted-foreground text-xs">
							Atrasadas:{" "}
							{cuotasAtrasadas
								.slice(0, 6)
								.map((c: CarteraCuotaCredito) => `#${c.numero_cuota}`)
								.join(", ")}
							{cuotasAtrasadas.length > 6 &&
								` +${cuotasAtrasadas.length - 6} más`}
						</p>
					)}
				</div>

				<div className="border-t pt-3">
					{convenioActivo ? (
						<div>
							<p className="text-muted-foreground text-xs">Total a pagar</p>
							<div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 font-semibold">
								<span>
									Convenio {formatQ(convenioActivo.cuotaConvenioAPagar)}
								</span>
								<span>+ Normal {formatQ(cuotaMensual)}</span>
								{abonosTotal > 0 && (
									<span className="text-green-700">
										− Abonos {formatQ(abonosTotal)}
									</span>
								)}
								<span className="font-bold text-base">
									= TOTAL{" "}
									{formatQ(
										Number(convenioActivo.cuotaConvenioAPagar) +
											cuotaMensual -
											abonosTotal,
									)}
								</span>
							</div>
						</div>
					) : (
						<div>
							<p className="text-muted-foreground text-xs">Abonos realizados</p>
							<p className="font-semibold text-green-700">
								{formatQ(abonosTotal)}
								{abonosTotal > 0 && (
									<span className="ml-1 font-normal text-muted-foreground">
										(restante {formatQ(Math.max(0, cuotaMensual - abonosTotal))}
										)
									</span>
								)}
							</p>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

export function ConvenioActivoCard({
	convenio,
}: {
	convenio: CarteraConvenio;
}) {
	return (
		<div className="space-y-3">
			<div className="grid grid-cols-2 gap-3 text-sm">
				<span>
					Total{" "}
					<b className="font-semibold">
						{formatQ(convenio.monto_total_convenio)}
					</b>
				</span>
				<span>
					Cuota mensual{" "}
					<b className="font-semibold">{formatQ(convenio.cuota_mensual)}</b>
				</span>
				<span>
					A pagar este mes{" "}
					<b className="font-semibold">
						{formatQ(convenio.cuotaConvenioAPagar)}
					</b>
				</span>
				<span>
					Progreso{" "}
					<b className="font-semibold">
						{convenio.pagos_realizados}/{convenio.numero_meses}
					</b>
				</span>
				<span className="text-green-700">
					Pagado{" "}
					<b className="font-semibold">{formatQ(convenio.monto_pagado)}</b>
				</span>
				<span className="text-orange-600">
					Pendiente{" "}
					<b className="font-semibold">{formatQ(convenio.monto_pendiente)}</b>
				</span>
			</div>

			{(convenio.cuotasConvenioMensuales?.length ?? 0) > 0 && (
				<div>
					<p className="mb-1.5 flex items-center gap-1.5 font-semibold text-sm">
						<Calendar className="h-3.5 w-3.5" />
						Calendario de Cuotas
					</p>
					<div className="flex flex-wrap gap-2">
						{convenio.cuotasConvenioMensuales?.map((c) => (
							<span
								key={c.cuota_convenio_id}
								className={`rounded border px-2 py-1 text-xs ${
									c.fecha_pago
										? "border-green-300 bg-green-50 dark:bg-green-950/30"
										: "border-orange-300 bg-orange-50 dark:bg-orange-950/30"
								}`}
							>
								#{c.numero_cuota}{" "}
								{new Date(c.fecha_vencimiento).toLocaleDateString("es-GT")}
							</span>
						))}
					</div>
				</div>
			)}

			{convenio.motivo && (
				<p className="text-sm">
					<span className="font-semibold">Motivo: </span>
					<span className="text-muted-foreground">{convenio.motivo}</span>
				</p>
			)}
		</div>
	);
}

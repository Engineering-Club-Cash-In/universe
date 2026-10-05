import { CalendarClock, Handshake, Wallet } from "lucide-react";
import {
	labelQuePasoReactivacion,
	type PagoRespaldo,
	type RespaldoReactivacion,
} from "server/src/lib/inmovilizacion-unidad";

export function formatQuetzales(monto: string | number | null | undefined) {
	const n = Number(monto);
	if (monto == null || !Number.isFinite(n)) return "—";
	return n.toLocaleString("es-GT", { style: "currency", currency: "GTQ" });
}

/** Fecha de un pago de cartera (YYYY-MM-DD): se arma al mediodía para que la zona horaria no la corra de día. */
export function formatFechaPago(fecha: string) {
	return new Date(`${fecha.slice(0, 10)}T12:00:00`).toLocaleDateString("es-GT");
}

export function formatFechaPrometida(iso: string) {
	return new Date(iso).toLocaleDateString("es-GT", {
		timeZone: "America/Guatemala",
	});
}

/** "Cuota 3 · Capital Q500.00 · Mora Q50.00": a dónde se fue el pago. Null si no hay datos (respaldos viejos). */
export function resumenAplicacionPago(pago: PagoRespaldo): string | null {
	const partes: string[] = [];
	if (pago.numeroCuota != null) partes.push(`Cuota ${pago.numeroCuota}`);
	for (const r of pago.aplicacion ?? []) {
		partes.push(`${r.rubro} ${formatQuetzales(r.monto)}`);
	}
	return partes.length > 0 ? partes.join(" · ") : null;
}

/** Aplicación del pago en forma de cuadrícula (rubro a la izquierda, monto a la derecha). Null si no hay datos. */
export function AplicacionPagoDetalle({ pago }: { pago: PagoRespaldo }) {
	const rubros = pago.aplicacion ?? [];
	if (pago.numeroCuota == null && rubros.length === 0) return null;
	return (
		<div className="basis-full space-y-1.5 pl-6 text-xs">
			<p className="font-medium text-muted-foreground uppercase tracking-wide">
				Aplicado a
				{pago.numeroCuota != null && (
					<span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-foreground normal-case tracking-normal">
						Cuota {pago.numeroCuota}
					</span>
				)}
			</p>
			{rubros.length > 0 && (
				<dl className="grid grid-cols-1 gap-x-6 gap-y-0.5 sm:grid-cols-2">
					{rubros.map((r) => (
						<div
							className="flex items-baseline justify-between gap-2 border-b border-dashed py-0.5"
							key={r.rubro}
						>
							<dt className="text-muted-foreground">{r.rubro}</dt>
							<dd className="font-medium tabular-nums">
								{formatQuetzales(r.monto)}
							</dd>
						</div>
					))}
				</dl>
			)}
		</div>
	);
}

/** Aviso cuando contabilidad todavía no validó el pago en cartera-back. */
export function PagoPendienteBadge({
	validacion,
}: {
	validacion: string | null | undefined;
}) {
	if (validacion !== "pending") return null;
	return (
		<span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-[11px] text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
			Pendiente de validación
		</span>
	);
}

export const labelQuePaso = labelQuePasoReactivacion;

/**
 * Lo que respalda una solicitud de reactivación, tal como lo vio el server al
 * crearla: la opción elegida, el pago (monto, fecha, referencia) y la promesa
 * (fecha, monto). Es lo que el supervisor mira antes de aprobar. `bucket` es el
 * del crédito hoy (o al solicitar, en la cola).
 */
export function RespaldoReactivacionResumen({
	quePaso,
	respaldo,
	bucket,
}: {
	quePaso: string | null | undefined;
	respaldo: RespaldoReactivacion | null | undefined;
	/** Texto ya armado, p. ej. "B3 (hoy)" o "B2 al solicitar". */
	bucket?: string | null;
}) {
	const etiqueta = labelQuePaso(quePaso);
	if (!etiqueta && !respaldo) return null;
	return (
		<div className="space-y-1 text-xs">
			{etiqueta && (
				<p className="font-medium">
					Motivo de la reactivación:{" "}
					<span className="font-normal">{etiqueta}</span>
				</p>
			)}
			{respaldo?.pago && (
				<p className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
					<Wallet className="h-3.5 w-3.5 text-emerald-600" />
					Pago {formatQuetzales(respaldo.pago.monto)} ·{" "}
					{formatFechaPago(respaldo.pago.fechaPago)}
					{respaldo.pago.referencia
						? ` · ref. ${respaldo.pago.referencia}`
						: ""}
					<PagoPendienteBadge validacion={respaldo.pago.validacion} />
				</p>
			)}
			{respaldo?.pago && resumenAplicacionPago(respaldo.pago) && (
				<p className="pl-5 text-muted-foreground">
					Aplicado a: {resumenAplicacionPago(respaldo.pago)}
				</p>
			)}
			{respaldo?.convenio && (
				<p className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
					<Handshake className="h-3.5 w-3.5 text-blue-700" />
					{respaldo.convenio.activo
						? "Convenio vigente"
						: "Convenio pendiente de activación"}
					{respaldo.convenio.numeroMeses
						? ` · ${respaldo.convenio.numeroMeses} ${respaldo.convenio.numeroMeses === 1 ? "mes" : "meses"}`
						: ""}
					{respaldo.convenio.cuotaMensual
						? ` · ${formatQuetzales(respaldo.convenio.cuotaMensual)} al mes`
						: ""}
				</p>
			)}
			{respaldo?.promesa && (
				<p className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
					<CalendarClock className="h-3.5 w-3.5 text-sky-600" />
					Promesa para el{" "}
					{formatFechaPrometida(respaldo.promesa.fechaPrometida)}
					{respaldo.promesa.monto
						? ` · ${formatQuetzales(respaldo.promesa.monto)}`
						: ""}
				</p>
			)}
			{bucket && <p className="text-muted-foreground">Bucket: {bucket}</p>}
		</div>
	);
}

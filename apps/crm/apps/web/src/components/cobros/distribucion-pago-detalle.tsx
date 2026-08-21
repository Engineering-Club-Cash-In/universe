import { FileText } from "lucide-react";
import type { DistribucionPagoItem } from "@/lib/cobros/registrar-pago";

/**
 * CB-128: mismo desglose que el modal de confirmación de carteraFront
 * (PagoForm.tsx:262-421) — distribución en cascada + resumen Boleta/Saldo a
 * favor/Otros/Mora/Convenio/Total. Compartido entre la vista previa en vivo
 * del sheet y el modal de confirmación final, para que el asesor vea
 * exactamente el mismo desglose en ambos pasos.
 */
export function DistribucionPagoDetalle({
	distribucion,
	montoRestante,
	montoBoleta,
	saldoAFavor,
	otros,
	mora,
	convenioAplicado,
}: {
	distribucion: DistribucionPagoItem[];
	montoRestante: number;
	montoBoleta: number;
	saldoAFavor: number;
	otros: number;
	mora: number;
	convenioAplicado: number;
}) {
	return (
		<div className="space-y-2.5 rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-900 dark:bg-green-950/20">
			<p className="flex items-center gap-1.5 font-bold text-green-900 text-xs dark:text-green-100">
				<FileText className="h-3.5 w-3.5" />
				Distribución del Pago
			</p>

			<div className="space-y-1">
				{distribucion.map((item) => (
					<div
						key={item.concepto}
						className="flex items-center justify-between border-green-200 border-b py-1 text-xs last:border-0 dark:border-green-900"
					>
						<span className="font-medium">{item.concepto}</span>
						<span className="font-bold text-green-700 dark:text-green-400">
							Q{item.monto.toFixed(2)}
						</span>
					</div>
				))}
				{distribucion.length === 0 && (
					<p className="text-muted-foreground text-xs">
						Indica el monto de la boleta para ver la distribución.
					</p>
				)}
			</div>

			{montoRestante > 0.01 && (
				<div className="space-y-0.5 rounded-md border border-amber-300 bg-amber-50 p-2 dark:border-amber-800 dark:bg-amber-950/30">
					<div className="flex items-center justify-between">
						<span className="font-bold text-[11px] text-amber-800 dark:text-amber-300">
							⚠ Excedente (nuevo saldo a favor)
						</span>
						<span className="font-bold text-amber-700 text-xs dark:text-amber-400">
							Q{montoRestante.toFixed(2)}
						</span>
					</div>
					<p className="text-[10px] text-amber-700 italic dark:text-amber-500">
						Este monto se guardará como saldo a favor para futuros pagos.
					</p>
				</div>
			)}

			<div className="space-y-1 border-green-300 border-t pt-2 text-xs dark:border-green-800">
				<div className="flex justify-between">
					<span className="font-medium">Boleta:</span>
					<span className="font-bold">Q{montoBoleta.toFixed(2)}</span>
				</div>
				{saldoAFavor > 0 && (
					<div className="flex justify-between text-purple-700 dark:text-purple-400">
						<span className="font-medium">+ Saldo a Favor:</span>
						<span className="font-bold">Q{saldoAFavor.toFixed(2)}</span>
					</div>
				)}
				{otros > 0 && (
					<div className="flex justify-between text-muted-foreground">
						<span className="font-medium">- Otros:</span>
						<span className="font-bold">Q{otros.toFixed(2)}</span>
					</div>
				)}
				{mora > 0 && (
					<div className="flex justify-between text-muted-foreground">
						<span className="font-medium">- Mora:</span>
						<span className="font-bold">Q{mora.toFixed(2)}</span>
					</div>
				)}
				{convenioAplicado > 0 && (
					<div className="flex justify-between text-muted-foreground">
						<span className="font-medium">- Cuota Convenio:</span>
						<span className="font-bold">Q{convenioAplicado.toFixed(2)}</span>
					</div>
				)}
				<div className="flex justify-between border-green-200 border-t pt-1 text-sm dark:border-green-900">
					<span className="font-bold text-green-900 dark:text-green-100">
						= Total Disponible:
					</span>
					<span className="font-extrabold text-green-700 dark:text-green-400">
						Q{montoBoleta.toFixed(2)}
					</span>
				</div>
			</div>
		</div>
	);
}

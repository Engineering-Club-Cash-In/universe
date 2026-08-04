/**
 * CB-030 — badge "Promesa activa", única definición para las tres superficies
 * que lo muestran (detalle del caso, listado de cobros, cola del día).
 *
 * Estaba triplicado con estilos y tooltips divergentes (la cola incluso sin
 * tooltip, o sea un badge sin explicación). Con tres copias, el próximo
 * cambio de texto o color sale desparejo — y este badge existe justamente
 * para explicar algo no obvio: por qué un crédito con promesa dejó de subir
 * de bucket.
 *
 * SIEMPRE de display: acompaña al bucket, nunca lo reemplaza. El estado que
 * se muestra ya viene congelado del servidor (isOverdueInstallmentForMora en
 * cartera-back) — este badge no recalcula ni duplica el freeze.
 */

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const TOOLTIP =
	"Promesa de pago vigente: las cuotas prometidas no generan mora ni suben el bucket mientras la promesa esté vigente. Si vence sin pago, el bucket refleja de inmediato la mora real acumulada.";

export function PromesaActivaBadge({
	/** `compact` = variante para tablas/listas (texto 10px). */
	compact = false,
	className,
}: {
	compact?: boolean;
	className?: string;
}) {
	return (
		<Badge
			variant="outline"
			className={cn(
				"whitespace-nowrap border-transparent bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
				compact && "text-[10px]",
				className,
			)}
			title={TOOLTIP}
		>
			Promesa activa
		</Badge>
	);
}

import { Check, Copy } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { CrmPill } from "@/components/ds/cards-credito";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Cuenta Nexa del crédito (el token con el que el cliente paga por Nexa). Solo
 * informativa para el asesor y el supervisor: si el cliente la perdió, se la
 * dictan o la copian de aquí. Sin cuenta, el badge lo dice en vez de esconder
 * el dato, para que siempre se sepa dónde buscarla.
 *
 * `cuentaNexa` llega de cartera (`/credito`) y ya viene vacía si el binding
 * está desactivado o vencido, o si el crédito no acepta pagos Nexa.
 */
export function CuentaNexa({
	cuenta,
	conEtiqueta = false,
	className,
}: {
	cuenta: string | null | undefined;
	/** Antepone «Cuenta Nexa» (donde no hay un label alrededor, como un badge suelto). */
	conEtiqueta?: boolean;
	className?: string;
}) {
	const token = cuenta?.trim() ?? "";
	const [copiada, setCopiada] = React.useState(false);

	React.useEffect(() => {
		if (!copiada) return;
		const t = setTimeout(() => setCopiada(false), 1500);
		return () => clearTimeout(t);
	}, [copiada]);

	if (!token) {
		return (
			<CrmPill kind="chip" tone="neutral" className={className}>
				Sin cuenta Nexa
			</CrmPill>
		);
	}

	const copiar = async () => {
		// En HTTP (contexto no seguro) navigator.clipboard ni existe, y writeText
		// también rechaza si la pestaña pierde el foco: avisar en vez de fallar
		// en silencio (mismo criterio que el enlace del GPS).
		try {
			await navigator.clipboard.writeText(token);
			setCopiada(true);
			toast.success("Cuenta Nexa copiada");
		} catch {
			toast.error(
				"No se pudo copiar la cuenta. Selecciónela y cópiela manualmente.",
			);
		}
	};

	return (
		<span
			className={cn(
				"inline-flex min-w-0 max-w-full items-center gap-1.5",
				className,
			)}
		>
			{conEtiqueta ? (
				<span className="whitespace-nowrap text-fg-secondary text-xs">
					Cuenta Nexa
				</span>
			) : null}
			<span
				className="min-w-0 select-all break-all font-mono font-semibold text-fg"
				title="Cuenta Nexa del cliente"
			>
				{token}
			</span>
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				className="shrink-0"
				onClick={copiar}
				aria-label="Copiar cuenta Nexa"
				title="Copiar cuenta Nexa"
			>
				{copiada ? <Check aria-hidden /> : <Copy aria-hidden />}
			</Button>
		</span>
	);
}
